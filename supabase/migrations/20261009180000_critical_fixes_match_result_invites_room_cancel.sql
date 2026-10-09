-- ============================================================================
-- Migration: 20261009180000_critical_fixes_match_result_invites_room_cancel.sql
-- Project: DuoPlay-Online
-- Phase: Auditoria e Correções Críticas (Resultados, Convites 15s, Cancelamento de Salas)
-- Description:
--   1. Adiciona coluna result_dismissed_at em match_players e cria RPC dismiss_match_result.
--   2. Atualiza get_latest_completed_match_for_current_user para ignorar partidas dispensadas.
--   3. Altera prazo padrão de convites de partida (game_invites) para 15 segundos.
--   4. Cancela automaticamente convites pendentes de um jogador ao sair da sala (leave_room/create_room).
--   5. Impede aceitação de convites cujo anfitrião/remetente não seja mais membro da sala.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Resultado Oficial da Última Partida: Persistência de Leitura / Dispensado
-- ----------------------------------------------------------------------------
ALTER TABLE public.match_players
ADD COLUMN IF NOT EXISTS result_dismissed_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.match_players.result_dismissed_at IS 'Data/hora em que o jogador dispensou o modal de resultado oficial da partida.';

CREATE INDEX IF NOT EXISTS idx_match_players_result_dismissed
ON public.match_players(user_id, result_dismissed_at)
WHERE result_dismissed_at IS NULL;

-- RPC: dismiss_match_result
CREATE OR REPLACE FUNCTION public.dismiss_match_result(
    p_match_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.match_players
    SET result_dismissed_at = now()
    WHERE match_id = p_match_id AND user_id = v_caller_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'match_id', p_match_id,
            'dismissed_at', now()
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_match_result(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_match_result(UUID) TO authenticated;

-- Atualizar get_latest_completed_match_for_current_user para não reaparecer após dispensado
CREATE OR REPLACE FUNCTION public.get_latest_completed_match_for_current_user()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_match JSONB;
BEGIN
    -- 1. Verificação de autenticação
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Busca da partida encerrada mais recente por finished_at DESC que NÃO tenha sido dispensada
    WITH latest_match AS (
        SELECT 
            m.id AS match_id,
            m.game_id,
            g.name AS game_name,
            m.status,
            m.winner_id,
            m.is_draw,
            m.finish_reason,
            m.turn_number,
            m.started_at,
            m.finished_at,
            ROUND(EXTRACT(EPOCH FROM (coalesce(m.finished_at, m.updated_at, m.started_at) - m.started_at)))::INTEGER AS duration_seconds,
            mp_me.slot AS my_slot,
            mp_me.game_symbol AS my_symbol,
            mp_me.score AS my_score,
            mp_me.is_winner AS is_my_win
        FROM public.matches m
        JOIN public.match_players mp_me ON mp_me.match_id = m.id AND mp_me.user_id = v_caller_id
        LEFT JOIN public.games g ON g.id = m.game_id
        WHERE m.status IN ('finished', 'abandoned', 'cancelled')
          AND mp_me.result_dismissed_at IS NULL
        ORDER BY m.finished_at DESC NULLS LAST, m.started_at DESC, m.created_at DESC
        LIMIT 1
    ),
    matched_opponents AS (
        SELECT 
            lm.match_id,
            jsonb_agg(
                jsonb_build_object(
                    'user_id', mp_opp.user_id,
                    'display_name', coalesce(p.display_name, 'Adversário'),
                    'username', coalesce(p.username, 'player'),
                    'slot', mp_opp.slot,
                    'game_symbol', mp_opp.game_symbol,
                    'is_winner', mp_opp.is_winner,
                    'score', mp_opp.score
                ) ORDER BY mp_opp.slot ASC
            ) AS opponents
        FROM latest_match lm
        JOIN public.match_players mp_opp ON mp_opp.match_id = lm.match_id AND mp_opp.user_id != v_caller_id
        LEFT JOIN public.profiles p ON p.id = mp_opp.user_id
        GROUP BY lm.match_id
    )
    SELECT jsonb_build_object(
        'match_id', lm.match_id,
        'game_id', lm.game_id,
        'game_name', coalesce(lm.game_name, 'Jogo da Velha'),
        'status', lm.status,
        'winner_id', lm.winner_id,
        'is_draw', lm.is_draw,
        'finish_reason', lm.finish_reason,
        'turn_number', lm.turn_number,
        'started_at', lm.started_at,
        'finished_at', lm.finished_at,
        'duration_seconds', coalesce(lm.duration_seconds, 0),
        'my_slot', lm.my_slot,
        'my_symbol', lm.my_symbol,
        'my_score', lm.my_score,
        'is_winner', (lm.winner_id = v_caller_id AND lm.is_draw = false),
        'outcome', CASE 
            WHEN lm.is_draw = true THEN 'draw'
            WHEN lm.winner_id = v_caller_id THEN 'win'
            WHEN lm.winner_id IS NOT NULL THEN 'loss'
            ELSE 'cancelled'
        END,
        'opponents', coalesce(mo.opponents, '[]'::jsonb)
    ) INTO v_match
    FROM latest_match lm
    LEFT JOIN matched_opponents mo ON mo.match_id = lm.match_id;

    IF v_match IS NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', null,
            'error', null
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', v_match,
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_latest_completed_match_for_current_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_latest_completed_match_for_current_user() TO authenticated;


-- ----------------------------------------------------------------------------
-- 2. Convites de Partida: Prazo Reduzido para Exatamente 15 Segundos
-- ----------------------------------------------------------------------------
ALTER TABLE public.game_invites
ALTER COLUMN expires_at SET DEFAULT (now() + INTERVAL '15 seconds');

COMMENT ON COLUMN public.game_invites.expires_at IS 'Data limite para resposta do convite (TTL estrito: 15 segundos).';

-- Atualiza send_game_invite para expiração em 15 segundos
CREATE OR REPLACE FUNCTION public.send_game_invite(
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
    v_receiver_profile RECORD;
    v_sender_member RECORD;
    v_current_count INTEGER;
    v_new_invite RECORD;
BEGIN
    -- 1. Validar autenticação do remetente
    v_sender_id := auth.uid();
    IF v_sender_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Remetente não pode convidar a si mesmo
    IF v_sender_id = p_receiver_id THEN
        RAISE EXCEPTION 'CANNOT_INVITE_SELF: Você não pode enviar convite para você mesmo.' USING ERRCODE = 'P0050';
    END IF;

    -- 3. Validar se o destinatário existe
    SELECT * INTO v_receiver_profile
    FROM public.profiles
    WHERE id = p_receiver_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'RECEIVER_NOT_FOUND: Jogador convidado não encontrado.' USING ERRCODE = 'P0051';
    END IF;

    -- 4. Validar se são amigos mútuos aceitos
    IF NOT public.are_friends(v_sender_id, p_receiver_id) THEN
        RAISE EXCEPTION 'NOT_FRIENDS: Você só pode convidar jogadores que são seus amigos mútuos.' USING ERRCODE = 'P0052';
    END IF;

    -- 5. Validar a sala
    SELECT * INTO v_room
    FROM public.rooms
    WHERE id = p_room_id AND status = 'waiting';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ROOM_NOT_FOUND: Sala não encontrada ou não está em espera.' USING ERRCODE = 'P0005';
    END IF;

    -- 6. Validar se o remetente é anfitrião / membro da sala
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

    -- 10. Criar o convite com prazo de exatamente 15 segundos
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
        now() + INTERVAL '15 seconds'
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

REVOKE ALL ON FUNCTION public.send_game_invite(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_game_invite(UUID, UUID) TO authenticated;


-- ----------------------------------------------------------------------------
-- 3. Cancelamento Automático de Convites e Validação de Saída da Sala
-- ----------------------------------------------------------------------------

-- Atualiza leave_room para cancelar atomicamente todos os convites do jogador saindo
CREATE OR REPLACE FUNCTION public.leave_room(
    p_room_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_room RECORD;
    v_is_member BOOLEAN;
    v_next_host_id UUID := NULL;
    v_room_closed BOOLEAN := false;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_room 
    FROM public.rooms 
    WHERE id = p_room_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        -- Cancela qualquer convite órfão que o usuário possa ter enviado para esta sala
        UPDATE public.game_invites
        SET status = 'cancelled', responded_at = now()
        WHERE room_id = p_room_id
          AND sender_id = v_caller_id
          AND status = 'pending';

        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'new_host_id', null,
                'room_closed', true
            ),
            'error', null
        );
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.room_members 
        WHERE room_id = p_room_id AND user_id = v_caller_id
    ) INTO v_is_member;

    IF NOT v_is_member THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'new_host_id', v_room.host_id,
                'room_closed', (v_room.status = 'closed')
            ),
            'error', null
        );
    END IF;

    -- 1. Remove membro da sala
    DELETE FROM public.room_members 
    WHERE room_id = p_room_id AND user_id = v_caller_id;

    -- 2. Cancela atomicamente todos os convites pendentes enviados pelo jogador saindo
    UPDATE public.game_invites
    SET status = 'cancelled', responded_at = now()
    WHERE room_id = p_room_id
      AND sender_id = v_caller_id
      AND status = 'pending';

    -- 3. Transição ou fechamento de sala se o jogador era host
    IF v_room.host_id = v_caller_id THEN
        SELECT user_id INTO v_next_host_id
        FROM public.room_members
        WHERE room_id = p_room_id
        ORDER BY joined_at ASC
        LIMIT 1;

        IF v_next_host_id IS NOT NULL THEN
            UPDATE public.rooms 
            SET host_id = v_next_host_id, updated_at = now() 
            WHERE id = p_room_id;
            v_room_closed := false;
        ELSE
            UPDATE public.rooms 
            SET status = 'closed', updated_at = now() 
            WHERE id = p_room_id;
            v_room_closed := true;

            -- Se a sala foi fechada, cancela todos os convites pendentes restantes para esta sala
            UPDATE public.game_invites
            SET status = 'cancelled', responded_at = now()
            WHERE room_id = p_room_id
              AND status = 'pending';
        END IF;
    ELSE
        v_next_host_id := v_room.host_id;
        v_room_closed := (v_room.status = 'closed');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'new_host_id', v_next_host_id,
            'room_closed', v_room_closed
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.leave_room(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_room(UUID) TO authenticated;

-- Atualizar accept_game_invite para validar se o remetente ainda é membro da sala
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
    v_existing_member RECORD;
    v_current_count INTEGER;
    v_game RECORD;
    v_slot INTEGER;
    v_new_member RECORD;
BEGIN
    -- 1. Validar autenticação do recebedor
    v_receiver_id := auth.uid();
    IF v_receiver_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Travar e validar convite
    SELECT * INTO v_invite
    FROM public.game_invites
    WHERE id = p_invite_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVITE_NOT_FOUND: Convite de partida não encontrado.' USING ERRCODE = 'P0056';
    END IF;

    -- 3. Apenas o destinatário oficial pode aceitar
    IF v_invite.receiver_id <> v_receiver_id THEN
        RAISE EXCEPTION 'FORBIDDEN: Você não tem permissão para responder este convite.' USING ERRCODE = 'P0003';
    END IF;

    -- 4. Validar estado do convite
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

    -- Validação de expiração (15 segundos)
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

    -- 6. Validar se o remetente ainda é membro ativo da sala (garante autoridade e impede convite fantasma)
    IF NOT EXISTS (
        SELECT 1 FROM public.room_members
        WHERE room_id = v_room.id AND user_id = v_invite.sender_id
    ) THEN
        UPDATE public.game_invites
        SET status = 'cancelled', responded_at = now()
        WHERE id = p_invite_id;
        RAISE EXCEPTION 'INVITE_CANCELLED: O anfitrião ou remetente não está mais nesta sala.' USING ERRCODE = 'P0058';
    END IF;

    -- 7. Verificar se já é membro da sala
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

    -- 8. Validar capacidade da sala e vagas disponíveis
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

    -- 9. Inserir membro na sala de forma atômica
    INSERT INTO public.room_members (
        room_id,
        user_id,
        role,
        slot_number,
        is_ready,
        joined_at
    ) VALUES (
        v_room.id,
        v_receiver_id,
        'player',
        v_slot,
        false,
        now()
    ) RETURNING * INTO v_new_member;

    -- 10. Atualizar convite para aceito
    UPDATE public.game_invites
    SET status = 'accepted', responded_at = now()
    WHERE id = p_invite_id;

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

REVOKE ALL ON FUNCTION public.accept_game_invite(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_game_invite(UUID) TO authenticated;
