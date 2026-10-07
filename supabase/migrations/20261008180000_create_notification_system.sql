-- ============================================================================
-- Migration: 20261008180000_create_notification_system.sql
-- Project: DuoPlay-Online
-- Phase: Fase 16 — Sistema Central de Notificações e Atividade
-- Description: Tabela de notificações persistentes, tabela de atividade do usuário,
--              índices otimizados, RLS estrito, RPCs autoritativas e integração
--              atômica via banco de dados com convites, amizades e mensagens.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabela: public.notifications
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    event_key VARCHAR(255) UNIQUE,
    read_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notifications IS 'Central de notificações persistente e em tempo real dos usuários.';
COMMENT ON COLUMN public.notifications.event_key IS 'Chave única para garantir idempotência estrita de eventos.';

-- ----------------------------------------------------------------------------
-- 2. Tabela: public.activity_events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.activity_events IS 'Histórico e registro de atividades de conta do usuário.';

-- ----------------------------------------------------------------------------
-- 3. Índices Otimizados
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_id ON public.notifications(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_event_key ON public.notifications(event_key) WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_events_user_id ON public.activity_events(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_user_created ON public.activity_events(user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. Habilitação de RLS e Permissões Estritas
-- ----------------------------------------------------------------------------
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
    ON public.notifications
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "activity_events_select_own" ON public.activity_events;
CREATE POLICY "activity_events_select_own"
    ON public.activity_events
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.notifications TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.notifications FROM authenticated;

REVOKE ALL ON TABLE public.activity_events FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.activity_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.activity_events FROM authenticated;

-- ----------------------------------------------------------------------------
-- 5. Inclusão na Publicação Realtime
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'notifications'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
        END IF;
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Função Interna de Criação Idempotente de Notificações
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_notification_internal(
    p_user_id UUID,
    p_type VARCHAR,
    p_actor_id UUID,
    p_title VARCHAR,
    p_body VARCHAR,
    p_data JSONB DEFAULT '{}'::jsonb,
    p_event_key VARCHAR DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_notification_id UUID;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF p_event_key IS NOT NULL THEN
        INSERT INTO public.notifications (
            user_id,
            type,
            actor_id,
            title,
            body,
            data,
            event_key,
            created_at
        ) VALUES (
            p_user_id,
            p_type,
            p_actor_id,
            p_title,
            p_body,
            coalesce(p_data, '{}'::jsonb),
            p_event_key,
            now()
        )
        ON CONFLICT (event_key) DO NOTHING
        RETURNING id INTO v_notification_id;
    ELSE
        INSERT INTO public.notifications (
            user_id,
            type,
            actor_id,
            title,
            body,
            data,
            created_at
        ) VALUES (
            p_user_id,
            p_type,
            p_actor_id,
            p_title,
            p_body,
            coalesce(p_data, '{}'::jsonb),
            now()
        )
        RETURNING id INTO v_notification_id;
    END IF;

    -- Registro no histórico privado de atividade
    INSERT INTO public.activity_events (
        user_id,
        actor_id,
        type,
        data,
        created_at
    ) VALUES (
        p_user_id,
        p_actor_id,
        p_type,
        coalesce(p_data, '{}'::jsonb),
        now()
    );

    RETURN v_notification_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. RPC: get_my_notifications (Paginação Determinística)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_notifications(
    p_limit INTEGER DEFAULT 30,
    p_before_created_at TIMESTAMPTZ DEFAULT NULL,
    p_before_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_limit INTEGER;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    v_limit := coalesce(p_limit, 30);
    IF v_limit < 1 OR v_limit > 100 THEN
        v_limit := 30;
    END IF;

    SELECT coalesce(jsonb_agg(notif), '[]'::jsonb) INTO v_result
    FROM (
        SELECT 
            n.id,
            n.user_id,
            n.type,
            n.actor_id,
            n.title,
            n.body,
            n.data,
            n.read_at,
            n.created_at,
            p.username AS actor_username,
            p.display_name AS actor_display_name,
            p.avatar_url AS actor_avatar_url
        FROM public.notifications n
        LEFT JOIN public.profiles p ON p.id = n.actor_id
        WHERE n.user_id = v_user_id
          AND (
            p_before_created_at IS NULL 
            OR n.created_at < p_before_created_at
            OR (n.created_at = p_before_created_at AND n.id < p_before_id)
          )
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT v_limit
    ) notif;

    RETURN jsonb_build_object(
        'success', true,
        'data', v_result,
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_notifications(INTEGER, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_notifications(INTEGER, TIMESTAMPTZ, UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. RPC: get_unread_notification_count
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_unread_notification_count()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_count INTEGER;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT count(*) INTO v_count
    FROM public.notifications
    WHERE user_id = v_user_id AND read_at IS NULL;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object('unread_count', coalesce(v_count, 0)),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_unread_notification_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count() TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. RPC: mark_notification_read
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_notification_read(
    p_notification_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.notifications
    SET read_at = now()
    WHERE id = p_notification_id AND user_id = v_user_id AND read_at IS NULL;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object('notification_id', p_notification_id, 'read', true),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notification_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 10. RPC: mark_all_notifications_read
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_updated_count INTEGER;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    WITH updated AS (
        UPDATE public.notifications
        SET read_at = now()
        WHERE user_id = v_user_id AND read_at IS NULL
        RETURNING id
    )
    SELECT count(*) INTO v_updated_count FROM updated;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object('updated_count', coalesce(v_updated_count, 0)),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;

-- ----------------------------------------------------------------------------
-- 11. Integração Transacional em RPCs Existentes
-- ----------------------------------------------------------------------------

-- A. Solicitações de Amizade (send_friend_request)
CREATE OR REPLACE FUNCTION public.send_friend_request(
    p_recipient_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_requester_id UUID;
    v_user_a UUID;
    v_user_b UUID;
    v_existing_req RECORD;
    v_new_req RECORD;
    v_recipient_profile RECORD;
    v_requester_profile RECORD;
BEGIN
    v_requester_id := auth.uid();
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    IF v_requester_id = p_recipient_id THEN
        RAISE EXCEPTION 'CANNOT_FRIEND_SELF: Não é permitido enviar solicitação para si mesmo.' USING ERRCODE = 'P0040';
    END IF;

    SELECT id, username, display_name INTO v_recipient_profile
    FROM public.profiles
    WHERE id = p_recipient_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'USER_NOT_FOUND: Jogador destinatário não encontrado.' USING ERRCODE = 'P0041';
    END IF;

    SELECT id, username, display_name INTO v_requester_profile
    FROM public.profiles
    WHERE id = v_requester_id;

    v_user_a := LEAST(v_requester_id, p_recipient_id);
    v_user_b := GREATEST(v_requester_id, p_recipient_id);

    IF EXISTS (
        SELECT 1 FROM public.friendships
        WHERE user_a_id = v_user_a AND user_b_id = v_user_b
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'FRIENDSHIP_EXISTS',
            'error', 'Você e este jogador já são amigos.'
        );
    END IF;

    SELECT * INTO v_existing_req
    FROM public.friend_requests
    WHERE status = 'pending'
      AND ((requester_id = v_requester_id AND recipient_id = p_recipient_id)
        OR (requester_id = p_recipient_id AND recipient_id = v_requester_id))
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_req.requester_id = v_requester_id THEN
            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'request_id', v_existing_req.id,
                    'status', 'pending',
                    'action', 'already_sent'
                )
            );
        END IF;

        UPDATE public.friend_requests
        SET status = 'accepted',
            responded_at = now(),
            updated_at = now()
        WHERE id = v_existing_req.id;

        INSERT INTO public.friendships (user_a_id, user_b_id)
        VALUES (v_user_a, v_user_b)
        ON CONFLICT (user_a_id, user_b_id) DO NOTHING;

        -- Notifica aceitação mútua
        PERFORM public.create_notification_internal(
            v_existing_req.requester_id,
            'friend_request_accepted',
            v_requester_id,
            'Solicitação de Amizade Aceita',
            v_requester_profile.display_name || ' aceitou sua solicitação de amizade.',
            jsonb_build_object('friend_request_id', v_existing_req.id, 'actor_id', v_requester_id),
            'friend_request_accepted:' || v_existing_req.id
        );

        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'request_id', v_existing_req.id,
                'status', 'accepted',
                'action', 'mutual_accepted'
            )
        );
    END IF;

    INSERT INTO public.friend_requests (requester_id, recipient_id, status)
    VALUES (v_requester_id, p_recipient_id, 'pending')
    RETURNING * INTO v_new_req;

    -- Notifica recebimento de solicitação
    PERFORM public.create_notification_internal(
        p_recipient_id,
        'friend_request_received',
        v_requester_id,
        'Nova Solicitação de Amizade',
        v_requester_profile.display_name || ' enviou uma solicitação de amizade.',
        jsonb_build_object('friend_request_id', v_new_req.id, 'actor_id', v_requester_id),
        'friend_request_received:' || v_new_req.id
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'request_id', v_new_req.id,
            'status', 'pending',
            'action', 'created'
        )
    );
END;
$$;

-- B. Aceite de Amizade (accept_friend_request)
CREATE OR REPLACE FUNCTION public.accept_friend_request(
    p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_req RECORD;
    v_user_a UUID;
    v_user_b UUID;
    v_caller_profile RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_req
    FROM public.friend_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REQUEST_NOT_FOUND: Solicitação de amizade não encontrada.' USING ERRCODE = 'P0042';
    END IF;

    IF v_req.recipient_id <> v_caller_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Somente o destinatário pode aceitar esta solicitação.' USING ERRCODE = 'P0043';
    END IF;

    IF v_req.status = 'accepted' THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'request_id', v_req.id,
                'status', 'accepted'
            )
        );
    END IF;

    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'INVALID_REQUEST_STATUS: A solicitação não está mais pendente.' USING ERRCODE = 'P0044';
    END IF;

    UPDATE public.friend_requests
    SET status = 'accepted',
        responded_at = now(),
        updated_at = now()
    WHERE id = v_req.id;

    v_user_a := LEAST(v_req.requester_id, v_req.recipient_id);
    v_user_b := GREATEST(v_req.requester_id, v_req.recipient_id);

    INSERT INTO public.friendships (user_a_id, user_b_id)
    VALUES (v_user_a, v_user_b)
    ON CONFLICT (user_a_id, user_b_id) DO NOTHING;

    SELECT id, display_name INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id;

    -- Notifica o remetente original que a solicitação foi aceita
    PERFORM public.create_notification_internal(
        v_req.requester_id,
        'friend_request_accepted',
        v_caller_id,
        'Solicitação de Amizade Aceita',
        v_caller_profile.display_name || ' aceitou sua solicitação de amizade.',
        jsonb_build_object('friend_request_id', p_request_id, 'actor_id', v_caller_id),
        'friend_request_accepted:' || p_request_id
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'request_id', v_req.id,
            'status', 'accepted'
        )
    );
END;
$$;

-- C. Convites de Partida (create_game_invite)
CREATE OR REPLACE FUNCTION public.create_game_invite(
    p_receiver_id UUID,
    p_room_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sender_id UUID;
    v_room RECORD;
    v_sender_member RECORD;
    v_receiver_profile RECORD;
    v_sender_profile RECORD;
    v_is_friend BOOLEAN;
    v_current_count INTEGER;
    v_new_invite RECORD;
BEGIN
    v_sender_id := auth.uid();
    IF v_sender_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    IF v_sender_id = p_receiver_id THEN
        RAISE EXCEPTION 'CANNOT_INVITE_SELF: Não é permitido convidar a si mesmo.' USING ERRCODE = 'P0050';
    END IF;

    SELECT id, username, display_name INTO v_receiver_profile
    FROM public.profiles
    WHERE id = p_receiver_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'USER_NOT_FOUND: Jogador destinatário não encontrado.' USING ERRCODE = 'P0041';
    END IF;

    SELECT id, username, display_name INTO v_sender_profile
    FROM public.profiles
    WHERE id = v_sender_id;

    SELECT EXISTS (
        SELECT 1 FROM public.friendships
        WHERE (user_a_id = LEAST(v_sender_id, p_receiver_id) AND user_b_id = GREATEST(v_sender_id, p_receiver_id))
    ) INTO v_is_friend;

    IF NOT v_is_friend THEN
        RAISE EXCEPTION 'USER_NOT_FRIEND: Você só pode convidar jogadores da sua lista de amigos.' USING ERRCODE = 'P0051';
    END IF;

    SELECT * INTO v_room
    FROM public.rooms
    WHERE id = p_room_id
    FOR UPDATE;

    IF NOT FOUND OR v_room.status <> 'waiting' THEN
        RAISE EXCEPTION 'ROOM_NOT_FOUND: Sala não encontrada ou não está disponível para novos jogadores.' USING ERRCODE = 'P0052';
    END IF;

    SELECT * INTO v_sender_member
    FROM public.room_members
    WHERE room_id = p_room_id AND user_id = v_sender_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_ROOM_HOST: Apenas membros da sala podem enviar convites.' USING ERRCODE = 'P0053';
    END IF;

    SELECT count(*) INTO v_current_count
    FROM public.room_members
    WHERE room_id = p_room_id;

    IF v_current_count >= v_room.max_members THEN
        RAISE EXCEPTION 'ROOM_FULL: A sala já atingiu a capacidade máxima.' USING ERRCODE = 'P0054';
    END IF;

    UPDATE public.game_invites
    SET status = 'expired', responded_at = now()
    WHERE room_id = p_room_id
      AND receiver_id = p_receiver_id
      AND status = 'pending'
      AND expires_at <= now();

    IF EXISTS (
        SELECT 1 FROM public.game_invites
        WHERE room_id = p_room_id
          AND receiver_id = p_receiver_id
          AND status = 'pending'
          AND expires_at > now()
    ) THEN
        RAISE EXCEPTION 'INVITE_ALREADY_SENT: Já existe um convite pendente para este amigo nesta sala.' USING ERRCODE = 'P0055';
    END IF;

    INSERT INTO public.game_invites (
        sender_id,
        receiver_id,
        room_id,
        game_id,
        status,
        expires_at
    ) VALUES (
        v_sender_id,
        p_receiver_id,
        p_room_id,
        v_room.game_id,
        'pending',
        now() + INTERVAL '2 minutes'
    )
    RETURNING * INTO v_new_invite;

    -- Notifica o jogador convidado
    PERFORM public.create_notification_internal(
        p_receiver_id,
        'game_invite_received',
        v_sender_id,
        'Convite para Partida',
        v_sender_profile.display_name || ' convidou você para jogar uma partida.',
        jsonb_build_object('invite_id', v_new_invite.id, 'room_id', p_room_id, 'game_id', v_room.game_id, 'room_code', v_room.code),
        'game_invite_received:' || v_new_invite.id
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'invite', row_to_json(v_new_invite)
        ),
        'error', null
    );
END;
$$;

-- D. Aceite de Convite de Partida (accept_game_invite)
CREATE OR REPLACE FUNCTION public.accept_game_invite(
    p_invite_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_receiver_id UUID;
    v_invite RECORD;
    v_room RECORD;
    v_game RECORD;
    v_current_count INTEGER;
    v_slot INTEGER := NULL;
    v_existing_member RECORD;
    v_new_member RECORD;
    v_receiver_profile RECORD;
BEGIN
    v_receiver_id := auth.uid();
    IF v_receiver_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_invite
    FROM public.game_invites
    WHERE id = p_invite_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVITE_NOT_FOUND: Convite de partida não encontrado.' USING ERRCODE = 'P0056';
    END IF;

    IF v_invite.receiver_id <> v_receiver_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Você não é o destinatário deste convite.' USING ERRCODE = 'P0001';
    END IF;

    SELECT id, display_name INTO v_receiver_profile FROM public.profiles WHERE id = v_receiver_id;

    IF v_invite.status = 'accepted' THEN
        SELECT * INTO v_room FROM public.rooms WHERE id = v_invite.room_id;
        SELECT * INTO v_existing_member FROM public.room_members WHERE room_id = v_invite.room_id AND user_id = v_receiver_id;
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'invite', row_to_json(v_invite),
                'room', row_to_json(v_room),
                'member', row_to_json(v_existing_member),
                'idempotent', true
            ),
            'error', null
        );
    END IF;

    IF v_invite.status IN ('declined', 'cancelled') THEN
        RAISE EXCEPTION 'INVITE_ALREADY_RESPONDED: Este convite já foi respondido ou cancelado.' USING ERRCODE = 'P0058';
    END IF;

    IF v_invite.status = 'expired' OR v_invite.expires_at <= now() THEN
        UPDATE public.game_invites
        SET status = 'expired', responded_at = now()
        WHERE id = p_invite_id AND status = 'pending';
        RAISE EXCEPTION 'INVITE_EXPIRED: Este convite de partida expirou.' USING ERRCODE = 'P0057';
    END IF;

    SELECT * INTO v_room
    FROM public.rooms
    WHERE id = v_invite.room_id
    FOR UPDATE;

    IF NOT FOUND OR v_room.status <> 'waiting' THEN
        UPDATE public.game_invites
        SET status = 'cancelled', responded_at = now()
        WHERE id = p_invite_id;
        RAISE EXCEPTION 'ROOM_UNAVAILABLE: A sala não está mais disponível.' USING ERRCODE = 'P0059';
    END IF;

    SELECT * INTO v_existing_member
    FROM public.room_members
    WHERE room_id = v_room.id AND user_id = v_receiver_id;

    IF v_existing_member.id IS NOT NULL THEN
        UPDATE public.game_invites
        SET status = 'accepted', responded_at = now()
        WHERE id = p_invite_id;

        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'invite', row_to_json(v_invite),
                'room', row_to_json(v_room),
                'member', row_to_json(v_existing_member),
                'idempotent', true
            ),
            'error', null
        );
    END IF;

    SELECT count(*) INTO v_current_count
    FROM public.room_members
    WHERE room_id = v_room.id;

    IF v_current_count >= v_room.max_members THEN
        UPDATE public.game_invites
        SET status = 'cancelled', responded_at = now()
        WHERE id = p_invite_id;
        RAISE EXCEPTION 'ROOM_FULL: A sala atingiu a capacidade máxima de jogadores.' USING ERRCODE = 'P0054';
    END IF;

    SELECT * INTO v_game FROM public.games WHERE id = v_room.game_id;

    SELECT s INTO v_slot
    FROM generate_series(1, v_game.max_players) s
    WHERE NOT EXISTS (
        SELECT 1 FROM public.room_members rm
        WHERE rm.room_id = v_room.id AND rm.slot_number = s
    )
    ORDER BY s ASC
    LIMIT 1;

    IF v_slot IS NULL THEN
        UPDATE public.game_invites
        SET status = 'cancelled', responded_at = now()
        WHERE id = p_invite_id;
        RAISE EXCEPTION 'ROOM_FULL: Não há vagas disponíveis para novos jogadores nesta sala.' USING ERRCODE = 'P0054';
    END IF;

    INSERT INTO public.room_members (
        room_id,
        user_id,
        role,
        slot_number,
        is_ready
    ) VALUES (
        v_room.id,
        v_receiver_id,
        'player',
        v_slot,
        false
    )
    RETURNING * INTO v_new_member;

    UPDATE public.game_invites
    SET status = 'accepted', responded_at = now()
    WHERE id = p_invite_id
    RETURNING * INTO v_invite;

    IF (v_current_count + 1) >= v_room.max_members THEN
        UPDATE public.game_invites
        SET status = 'cancelled', responded_at = now()
        WHERE room_id = v_room.id
          AND id <> p_invite_id
          AND status = 'pending';
    END IF;

    -- Notifica o remetente do convite que o convidado aceitou
    PERFORM public.create_notification_internal(
        v_invite.sender_id,
        'game_invite_accepted',
        v_receiver_id,
        'Convite Aceito',
        v_receiver_profile.display_name || ' aceitou seu convite e entrou na sala.',
        jsonb_build_object('invite_id', p_invite_id, 'room_id', v_room.id, 'room_code', v_room.code),
        'game_invite_accepted:' || p_invite_id
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'invite', row_to_json(v_invite),
            'room', row_to_json(v_room),
            'member', row_to_json(v_new_member)
        ),
        'error', null
    );
END;
$$;

-- E. Recusa de Convite de Partida (decline_game_invite)
CREATE OR REPLACE FUNCTION public.decline_game_invite(
    p_invite_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_receiver_id UUID;
    v_invite RECORD;
    v_receiver_profile RECORD;
BEGIN
    v_receiver_id := auth.uid();
    IF v_receiver_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_invite
    FROM public.game_invites
    WHERE id = p_invite_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVITE_NOT_FOUND: Convite não encontrado.' USING ERRCODE = 'P0056';
    END IF;

    IF v_invite.receiver_id <> v_receiver_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Você não é o destinatário deste convite.' USING ERRCODE = 'P0001';
    END IF;

    IF v_invite.status IN ('accepted', 'declined', 'cancelled') THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object('invite_id', p_invite_id, 'status', v_invite.status)
        );
    END IF;

    UPDATE public.game_invites
    SET status = 'declined', responded_at = now()
    WHERE id = p_invite_id;

    SELECT id, display_name INTO v_receiver_profile FROM public.profiles WHERE id = v_receiver_id;

    -- Notifica o remetente
    PERFORM public.create_notification_internal(
        v_invite.sender_id,
        'game_invite_declined',
        v_receiver_id,
        'Convite Recusado',
        v_receiver_profile.display_name || ' recusou o convite de partida.',
        jsonb_build_object('invite_id', p_invite_id, 'room_id', v_invite.room_id),
        'game_invite_declined:' || p_invite_id
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object('invite_id', p_invite_id, 'status', 'declined')
    );
END;
$$;

-- F. Mensagens de Chat Privado (send_message)
CREATE OR REPLACE FUNCTION public.send_message(
    p_conversation_id UUID,
    p_body TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_conv RECORD;
    v_trimmed TEXT;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_new_msg RECORD;
    v_sender_profile RECORD;
    v_recipient_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    v_trimmed := trim(p_body);
    IF v_trimmed IS NULL OR char_length(v_trimmed) = 0 THEN
        RAISE EXCEPTION 'EMPTY_MESSAGE: A mensagem não pode ser vazia.' USING ERRCODE = 'P0061';
    END IF;

    IF char_length(p_body) > 2000 THEN
        RAISE EXCEPTION 'MESSAGE_TOO_LONG: A mensagem ultrapassou o limite de 2.000 caracteres.' USING ERRCODE = 'P0062';
    END IF;

    SELECT * INTO v_conv
    FROM public.conversations
    WHERE id = p_conversation_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CONVERSATION_NOT_FOUND: Conversa não encontrada.' USING ERRCODE = 'P0063';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.conversation_members
        WHERE conversation_id = p_conversation_id AND user_id = v_caller_id
    ) THEN
        RAISE EXCEPTION 'FORBIDDEN: Você não participa desta conversa.' USING ERRCODE = 'P0002';
    END IF;

    IF v_conv.type = 'direct' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.friendships
            WHERE user_a_id = v_conv.direct_user_a AND user_b_id = v_conv.direct_user_b
        ) THEN
            RAISE EXCEPTION 'USER_NOT_FRIEND: Você só pode enviar mensagens para jogadores que são seus amigos.' USING ERRCODE = 'P0051';
        END IF;

        v_recipient_id := CASE WHEN v_conv.direct_user_a = v_caller_id THEN v_conv.direct_user_b ELSE v_conv.direct_user_a END;
    END IF;

    INSERT INTO public.messages (conversation_id, sender_id, body, created_at, updated_at)
    VALUES (p_conversation_id, v_caller_id, v_trimmed, v_now, v_now)
    RETURNING * INTO v_new_msg;

    UPDATE public.conversations
    SET last_message_at = v_now,
        updated_at = v_now
    WHERE id = p_conversation_id;

    UPDATE public.conversation_members
    SET last_read_at = v_now
    WHERE conversation_id = p_conversation_id AND user_id = v_caller_id;

    SELECT username, display_name, avatar_url INTO v_sender_profile
    FROM public.profiles
    WHERE id = v_caller_id;

    -- Cria notificação para o destinatário da mensagem direta
    IF v_recipient_id IS NOT NULL THEN
        PERFORM public.create_notification_internal(
            v_recipient_id,
            'new_message',
            v_caller_id,
            'Nova Mensagem',
            v_sender_profile.display_name || ' enviou uma mensagem.',
            jsonb_build_object('conversation_id', p_conversation_id, 'message_id', v_new_msg.id),
            'new_message:' || v_new_msg.id
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'id', v_new_msg.id,
            'conversation_id', v_new_msg.conversation_id,
            'sender_id', v_caller_id,
            'sender_username', v_sender_profile.username,
            'sender_display_name', v_sender_profile.display_name,
            'sender_avatar_url', v_sender_profile.avatar_url,
            'body', v_new_msg.body,
            'created_at', v_new_msg.created_at,
            'is_mine', true
        )
    );
END;
$$;
