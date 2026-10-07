-- ============================================================================
-- Migration: 20261008170000_fix_accept_game_invite_legacy_presence.sql
-- Description: Correção crítica na RPC accept_game_invite para remover referência
--              à coluna legada/inexistente room_members.is_connected.
--              A presença global continua sendo responsabilidade exclusiva de
--              public.user_presence e heartbeat_presence().
-- ============================================================================

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
    -- 1. Identificar usuário autenticado
    v_receiver_id := auth.uid();
    IF v_receiver_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Travar linha do convite para concorrência atômica
    SELECT * INTO v_invite
    FROM public.game_invites
    WHERE id = p_invite_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVITE_NOT_FOUND: Convite de partida não encontrado.' USING ERRCODE = 'P0056';
    END IF;

    -- 3. Validar destinatário (apenas o receiver pode aceitar)
    IF v_invite.receiver_id <> v_receiver_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Você não é o destinatário deste convite.' USING ERRCODE = 'P0001';
    END IF;

    -- 4. Validar status do convite
    IF v_invite.status = 'accepted' THEN
        -- Retorno idempotente caso o usuário já tenha aceito anteriormente
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

    -- 6. Verificar se já é membro da sala
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

    -- 7. Validar capacidade da sala e vagas disponíveis
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

    -- 8. Inserir membro na sala de forma atômica (usando somente colunas existentes em room_members)
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

    -- 9. Atualizar status do convite para aceito
    UPDATE public.game_invites
    SET status = 'accepted', responded_at = now()
    WHERE id = p_invite_id
    RETURNING * INTO v_invite;

    -- 10. Se a sala atingiu a capacidade máxima, cancelar outros convites pendentes
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

-- Permissões de Execução
REVOKE ALL ON FUNCTION public.accept_game_invite(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_game_invite(UUID) TO authenticated;
