-- ============================================================================
-- Migration: 20261008140000_create_game_invites.sql
-- Project: DuoPlay-Online
-- Phase: Fase 14.2 — Convites de Partida entre Amigos + Convite pela Sala de Espera
-- Description: Criação da infraestrutura oficial de convites diretos para salas de jogo
--              (tabela game_invites, RLS estrito, Realtime e RPCs atômicas com tratamento de concorrência).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabela: public.game_invites (Convites de Partida Diretos)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    game_id VARCHAR(50) NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '2 minutes'),
    responded_at TIMESTAMPTZ,
    CONSTRAINT game_invites_different_users CHECK (sender_id <> receiver_id)
);

COMMENT ON TABLE public.game_invites IS 'Convites de partida diretos entre jogadores vinculados a salas de espera.';
COMMENT ON COLUMN public.game_invites.sender_id IS 'Jogador anfitrião/membro que enviou o convite.';
COMMENT ON COLUMN public.game_invites.receiver_id IS 'Jogador amigo destinatário do convite.';
COMMENT ON COLUMN public.game_invites.room_id IS 'Sala privada para a qual o jogador foi convidado.';
COMMENT ON COLUMN public.game_invites.game_id IS 'Identificador do jogo da sala.';
COMMENT ON COLUMN public.game_invites.status IS 'Status do ciclo de vida: pending, accepted, declined, expired, cancelled.';
COMMENT ON COLUMN public.game_invites.expires_at IS 'Data limite para resposta do convite (TTL padrão: 2 minutos).';

-- Índice parcial único para impedir convites pendentes duplicados para a mesma sala e destinatário
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_invites_unique_pending
    ON public.game_invites (room_id, receiver_id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_game_invites_receiver ON public.game_invites(receiver_id, status);
CREATE INDEX IF NOT EXISTS idx_game_invites_sender ON public.game_invites(sender_id, status);
CREATE INDEX IF NOT EXISTS idx_game_invites_room ON public.game_invites(room_id, status);
CREATE INDEX IF NOT EXISTS idx_game_invites_expires ON public.game_invites(expires_at) WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- 2. Habilitação de RLS e Políticas Estritas
-- ----------------------------------------------------------------------------
ALTER TABLE public.game_invites ENABLE ROW LEVEL SECURITY;

-- game_invites: Leitura apenas de convites onde o usuário é remetente ou destinatário
DROP POLICY IF EXISTS "game_invites_select_own" ON public.game_invites;
CREATE POLICY "game_invites_select_own"
    ON public.game_invites
    FOR SELECT
    TO authenticated
    USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- Nenhuma mutação direta pelo cliente (apenas via RPCs SECURITY DEFINER)
REVOKE ALL ON TABLE public.game_invites FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.game_invites TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Inclusão na Publicação Realtime do Supabase
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
              AND tablename = 'game_invites'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.game_invites;
        END IF;
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. RPC: create_game_invite
-- ----------------------------------------------------------------------------
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
    v_is_friend BOOLEAN;
    v_current_count INTEGER;
    v_new_invite RECORD;
BEGIN
    -- 1. Identificação do usuário
    v_sender_id := auth.uid();
    IF v_sender_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Impedir auto-convite
    IF v_sender_id = p_receiver_id THEN
        RAISE EXCEPTION 'CANNOT_INVITE_SELF: Não é permitido convidar a si mesmo.' USING ERRCODE = 'P0050';
    END IF;

    -- 3. Validar destinatário existente
    SELECT id, username, display_name INTO v_receiver_profile
    FROM public.profiles
    WHERE id = p_receiver_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'USER_NOT_FOUND: Jogador destinatário não encontrado.' USING ERRCODE = 'P0041';
    END IF;

    -- 4. Validar amizade ativa
    SELECT EXISTS (
        SELECT 1 FROM public.friendships
        WHERE (user_a_id = LEAST(v_sender_id, p_receiver_id) AND user_b_id = GREATEST(v_sender_id, p_receiver_id))
    ) INTO v_is_friend;

    IF NOT v_is_friend THEN
        RAISE EXCEPTION 'USER_NOT_FRIEND: Você só pode convidar jogadores da sua lista de amigos.' USING ERRCODE = 'P0051';
    END IF;

    -- 5. Validar e travar a sala
    SELECT * INTO v_room
    FROM public.rooms
    WHERE id = p_room_id
    FOR UPDATE;

    IF NOT FOUND OR v_room.status <> 'waiting' THEN
        RAISE EXCEPTION 'ROOM_NOT_FOUND: Sala não encontrada ou não está disponível para novos jogadores.' USING ERRCODE = 'P0052';
    END IF;

    -- 6. Validar se o chamador é anfitrião / membro da sala
    SELECT * INTO v_sender_member
    FROM public.room_members
    WHERE room_id = p_room_id AND user_id = v_sender_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_ROOM_HOST: Apenas membros da sala podem enviar convites.' USING ERRCODE = 'P0053';
    END IF;

    -- 7. Validar capacidade da sala
    SELECT count(*) INTO v_current_count
    FROM public.room_members
    WHERE room_id = p_room_id;

    IF v_current_count >= v_room.max_members THEN
        RAISE EXCEPTION 'ROOM_FULL: A sala já atingiu a capacidade máxima.' USING ERRCODE = 'P0054';
    END IF;

    -- 8. Limpar convites expirados anteriores para este par/sala
    UPDATE public.game_invites
    SET status = 'expired', responded_at = now()
    WHERE room_id = p_room_id
      AND receiver_id = p_receiver_id
      AND status = 'pending'
      AND expires_at <= now();

    -- 9. Verificar convite pendente ativo
    IF EXISTS (
        SELECT 1 FROM public.game_invites
        WHERE room_id = p_room_id
          AND receiver_id = p_receiver_id
          AND status = 'pending'
          AND expires_at > now()
    ) THEN
        RAISE EXCEPTION 'INVITE_ALREADY_SENT: Já existe um convite pendente para este amigo nesta sala.' USING ERRCODE = 'P0055';
    END IF;

    -- 10. Criar o convite
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

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'invite', row_to_json(v_new_invite)
        ),
        'error', null
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. RPC: accept_game_invite
-- ----------------------------------------------------------------------------
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
BEGIN
    -- 1. Identificar usuário
    v_receiver_id := auth.uid();
    IF v_receiver_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Travar linha do convite
    SELECT * INTO v_invite
    FROM public.game_invites
    WHERE id = p_invite_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVITE_NOT_FOUND: Convite de partida não encontrado.' USING ERRCODE = 'P0056';
    END IF;

    -- 3. Validar destinatário
    IF v_invite.receiver_id <> v_receiver_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Você não é o destinatário deste convite.' USING ERRCODE = 'P0001';
    END IF;

    -- 4. Validar status do convite
    IF v_invite.status = 'accepted' THEN
        -- Retorno idempotente caso o usuário já tenha aceito
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

    -- 5. Travar e validar a sala
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

    -- 6. Verificar se já é membro
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

    -- 7. Validar capacidade e vagas de jogadores
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

    -- 8. Inserir membro na sala de forma atômica
    INSERT INTO public.room_members (
        room_id,
        user_id,
        role,
        slot_number,
        is_ready,
        is_connected
    ) VALUES (
        v_room.id,
        v_receiver_id,
        'player',
        v_slot,
        false,
        true
    )
    RETURNING * INTO v_new_member;

    -- 9. Atualizar status do convite aceito
    UPDATE public.game_invites
    SET status = 'accepted', responded_at = now()
    WHERE id = p_invite_id
    RETURNING * INTO v_invite;

    -- 10. Se a sala atingiu o limite de membros após a entrada, cancelar outros convites pendentes da sala
    IF (v_current_count + 1) >= v_room.max_members THEN
        UPDATE public.game_invites
        SET status = 'cancelled', responded_at = now()
        WHERE room_id = v_room.id
          AND id <> p_invite_id
          AND status = 'pending';
    END IF;

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

-- ----------------------------------------------------------------------------
-- 6. RPC: decline_game_invite
-- ----------------------------------------------------------------------------
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
        RAISE EXCEPTION 'UNAUTHORIZED: Você não tem permissão para recusar este convite.' USING ERRCODE = 'P0001';
    END IF;

    IF v_invite.status <> 'pending' THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object('invite_id', p_invite_id, 'status', v_invite.status, 'idempotent', true),
            'error', null
        );
    END IF;

    UPDATE public.game_invites
    SET status = 'declined', responded_at = now()
    WHERE id = p_invite_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object('invite_id', p_invite_id, 'status', 'declined'),
        'error', null
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. RPC: cancel_game_invite
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_game_invite(
    p_invite_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sender_id UUID;
    v_invite RECORD;
BEGIN
    v_sender_id := auth.uid();
    IF v_sender_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_invite
    FROM public.game_invites
    WHERE id = p_invite_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVITE_NOT_FOUND: Convite de partida não encontrado.' USING ERRCODE = 'P0056';
    END IF;

    IF v_invite.sender_id <> v_sender_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Você não tem permissão para cancelar este convite.' USING ERRCODE = 'P0001';
    END IF;

    IF v_invite.status <> 'pending' THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object('invite_id', p_invite_id, 'status', v_invite.status, 'idempotent', true),
            'error', null
        );
    END IF;

    UPDATE public.game_invites
    SET status = 'cancelled', responded_at = now()
    WHERE id = p_invite_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object('invite_id', p_invite_id, 'status', 'cancelled'),
        'error', null
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. RPC: get_pending_received_invites
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pending_received_invites()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_user_id UUID;
    v_result JSONB;
BEGIN
    v_current_user_id := auth.uid();
    IF v_current_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- Atualiza convites expirados sob demanda
    UPDATE public.game_invites
    SET status = 'expired', responded_at = now()
    WHERE receiver_id = v_current_user_id
      AND status = 'pending'
      AND expires_at <= now();

    SELECT coalesce(jsonb_agg(inv_data), '[]'::jsonb) INTO v_result
    FROM (
        SELECT 
            gi.id AS invite_id,
            gi.sender_id,
            gi.receiver_id,
            gi.room_id,
            gi.game_id,
            gi.status,
            gi.created_at,
            gi.expires_at,
            p.username AS sender_username,
            p.display_name AS sender_display_name,
            p.avatar_url AS sender_avatar_url,
            r.code AS room_code,
            r.status AS room_status,
            g.name AS game_title
        FROM public.game_invites gi
        JOIN public.profiles p ON p.id = gi.sender_id
        JOIN public.rooms r ON r.id = gi.room_id
        JOIN public.games g ON g.id = gi.game_id
        WHERE gi.receiver_id = v_current_user_id
          AND gi.status = 'pending'
          AND gi.expires_at > now()
          AND r.status = 'waiting'
        ORDER BY gi.created_at DESC
    ) inv_data;

    RETURN jsonb_build_object(
        'success', true,
        'data', v_result,
        'error', null
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. RPC: get_room_invites
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_room_invites(
    p_room_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_user_id UUID;
    v_is_member BOOLEAN;
    v_result JSONB;
BEGIN
    v_current_user_id := auth.uid();
    IF v_current_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- Validar que o chamador pertence à sala
    SELECT EXISTS (
        SELECT 1 FROM public.room_members
        WHERE room_id = p_room_id AND user_id = v_current_user_id
    ) INTO v_is_member;

    IF NOT v_is_member THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Você não é participante desta sala.' USING ERRCODE = 'P0001';
    END IF;

    -- Atualiza convites expirados sob demanda
    UPDATE public.game_invites
    SET status = 'expired', responded_at = now()
    WHERE room_id = p_room_id
      AND status = 'pending'
      AND expires_at <= now();

    SELECT coalesce(jsonb_agg(inv_data), '[]'::jsonb) INTO v_result
    FROM (
        SELECT 
            gi.id AS invite_id,
            gi.receiver_id,
            gi.sender_id,
            gi.room_id,
            gi.game_id,
            gi.status,
            gi.created_at,
            gi.expires_at,
            gi.responded_at,
            p.username AS receiver_username,
            p.display_name AS receiver_display_name,
            p.avatar_url AS receiver_avatar_url
        FROM public.game_invites gi
        JOIN public.profiles p ON p.id = gi.receiver_id
        WHERE gi.room_id = p_room_id
        ORDER BY gi.created_at DESC
    ) inv_data;

    RETURN jsonb_build_object(
        'success', true,
        'data', v_result,
        'error', null
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. Permissões de Execução nas RPCs
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_game_invite(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_game_invite(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.accept_game_invite(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_game_invite(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.decline_game_invite(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_game_invite(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_game_invite(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_game_invite(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_pending_received_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_received_invites() TO authenticated;

REVOKE ALL ON FUNCTION public.get_room_invites(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_room_invites(UUID) TO authenticated;
