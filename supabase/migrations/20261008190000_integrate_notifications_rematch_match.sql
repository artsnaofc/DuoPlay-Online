-- ============================================================================
-- Migration: 20261008190000_integrate_notifications_rematch_match.sql
-- Project: DuoPlay-Online
-- Phase: Fase 16.1 — Integração, Auditoria e Hardening do Sistema de Notificações
-- Description: Integração autoritativa de notificações para requisições e respostas
--              de revanche (rematch) e conclusão de partidas (finish_match), além
--              da inclusão de event_key na RPC get_my_notifications.
-- ============================================================================

-- 1. Incluir event_key na RPC get_my_notifications
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
            n.event_key,
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

-- 2. Atualizar request_rematch com emissão de notificação rematch_received
CREATE OR REPLACE FUNCTION public.request_rematch(
    p_original_match_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_orig_match RECORD;
    v_opponent_id UUID;
    v_existing_req RECORD;
    v_req RECORD;
    v_opp_last_seen TIMESTAMPTZ;
    v_opp_conn_status VARCHAR(20);
    v_caller_name VARCHAR(255);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 1. Validar EXPLICITAMENTE que auth.uid() participou da partida original
    IF NOT EXISTS (
        SELECT 1 FROM public.match_players
        WHERE match_id = p_original_match_id AND user_id = v_caller_id
    ) THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: O usuário não participou desta partida.' USING ERRCODE = 'P0018';
    END IF;

    -- 2. Travar e verificar a partida original
    SELECT * INTO v_orig_match
    FROM public.matches
    WHERE id = p_original_match_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MATCH_NOT_FOUND: Partida original não encontrada.' USING ERRCODE = 'P0016';
    END IF;

    IF v_orig_match.status NOT IN ('finished', 'abandoned', 'cancelled') THEN
        RAISE EXCEPTION 'INVALID_MATCH_STATUS: Revanche só é permitida em partidas finalizadas.' USING ERRCODE = 'P0013';
    END IF;

    -- 3. Localizar oponente na partida original e checar presença autoritativa
    SELECT user_id, last_seen_at, connection_status INTO v_opponent_id, v_opp_last_seen, v_opp_conn_status
    FROM public.match_players
    WHERE match_id = p_original_match_id AND user_id != v_caller_id
    LIMIT 1;

    IF v_opponent_id IS NULL THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: Oponente não encontrado nesta partida.' USING ERRCODE = 'P0018';
    END IF;

    -- Se a partida terminou por abandono ou desistência do oponente, oponente está indisponível
    IF v_orig_match.finish_reason = 'abandonment' 
       OR (v_orig_match.finish_reason = 'resignation' AND v_orig_match.winner_id = v_caller_id)
       OR v_opp_conn_status = 'disconnected' 
       OR (v_opp_last_seen IS NOT NULL AND v_opp_last_seen < (clock_timestamp() - INTERVAL '20 seconds')) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'O oponente não está mais disponível para revanche.',
            'code', 'OPPONENT_UNAVAILABLE'
        );
    END IF;

    -- 4. Checar se já existe um pedido de revanche para esta partida
    SELECT * INTO v_existing_req
    FROM public.rematch_requests
    WHERE original_match_id = p_original_match_id
      AND status IN ('pending', 'accepted')
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
        IF v_existing_req.status = 'accepted' THEN
            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'rematch_request_id', v_existing_req.id,
                    'status', 'accepted',
                    'new_match_id', v_existing_req.new_match_id,
                    'original_match_id', p_original_match_id
                ),
                'error', null
            );
        ELSIF v_existing_req.status = 'pending' THEN
            IF clock_timestamp() > v_existing_req.expires_at THEN
                UPDATE public.rematch_requests
                SET status = 'expired', updated_at = clock_timestamp()
                WHERE id = v_existing_req.id;
            ELSE
                RETURN jsonb_build_object(
                    'success', true,
                    'data', jsonb_build_object(
                        'rematch_request_id', v_existing_req.id,
                        'status', 'pending',
                        'original_match_id', p_original_match_id,
                        'requester_id', v_existing_req.requester_id,
                        'opponent_id', v_existing_req.opponent_id,
                        'is_my_request', (v_existing_req.requester_id = v_caller_id),
                        'expires_at', v_existing_req.expires_at
                    ),
                    'error', null
                );
            END IF;
        END IF;
    END IF;

    -- 5. Criar novo registro de solicitação de revanche
    INSERT INTO public.rematch_requests (
        original_match_id,
        game_id,
        room_id,
        requester_id,
        opponent_id,
        status,
        expires_at
    ) VALUES (
        p_original_match_id,
        v_orig_match.game_id,
        v_orig_match.room_id,
        v_caller_id,
        v_opponent_id,
        'pending',
        clock_timestamp() + INTERVAL '30 seconds'
    ) RETURNING * INTO v_req;

    SELECT coalesce(display_name, username, 'Oponente') INTO v_caller_name
    FROM public.profiles WHERE id = v_caller_id;

    -- Notifica o oponente sobre o pedido de revanche
    PERFORM public.create_notification_internal(
        v_opponent_id,
        'rematch_received',
        v_caller_id,
        'Pedido de Revanche',
        v_caller_name || ' pediu uma revanche.',
        jsonb_build_object(
            'rematch_id', v_req.id,
            'original_match_id', p_original_match_id,
            'actor_id', v_caller_id
        ),
        'rematch_received:' || v_req.id
    );

    UPDATE public.matches
    SET updated_at = clock_timestamp()
    WHERE id = p_original_match_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'rematch_request_id', v_req.id,
            'status', 'pending',
            'original_match_id', p_original_match_id,
            'requester_id', v_caller_id,
            'opponent_id', v_opponent_id,
            'is_my_request', true,
            'expires_at', v_req.expires_at
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.request_rematch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_rematch(UUID) TO authenticated;

-- 3. Atualizar respond_to_rematch com emissão de notificações rematch_accepted / rematch_declined
CREATE OR REPLACE FUNCTION public.respond_to_rematch(
    p_rematch_request_id UUID,
    p_accept BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_req RECORD;
    v_slot1_user_id UUID;
    v_slot2_user_id UUID;
    v_new_match_id UUID;
    v_req_last_seen TIMESTAMPTZ;
    v_req_conn_status VARCHAR(20);
    v_caller_name VARCHAR(255);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_req
    FROM public.rematch_requests
    WHERE id = p_rematch_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REMATCH_NOT_FOUND: Pedido de revanche não encontrado.' USING ERRCODE = 'P0016';
    END IF;

    IF v_req.requester_id = v_caller_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED: O solicitante não pode aceitar seu próprio pedido de revanche.' USING ERRCODE = 'P0001';
    END IF;

    IF v_req.opponent_id != v_caller_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Você não é o destinatário deste pedido de revanche.' USING ERRCODE = 'P0001';
    END IF;

    IF v_req.status = 'accepted' AND v_req.new_match_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'status', 'accepted',
                'rematch_request_id', v_req.id,
                'new_match_id', v_req.new_match_id,
                'original_match_id', v_req.original_match_id
            ),
            'error', null
        );
    END IF;

    IF v_req.status = 'declined' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'O pedido de revanche foi recusado.',
            'code', 'REMATCH_DECLINED'
        );
    END IF;

    IF v_req.status = 'expired' OR clock_timestamp() > v_req.expires_at THEN
        UPDATE public.rematch_requests
        SET status = 'expired', updated_at = clock_timestamp()
        WHERE id = v_req.id;

        RETURN jsonb_build_object(
            'success', false,
            'error', 'O pedido de revanche expirou.',
            'code', 'REMATCH_EXPIRED'
        );
    END IF;

    SELECT coalesce(display_name, username, 'Oponente') INTO v_caller_name
    FROM public.profiles WHERE id = v_caller_id;

    -- Caso de Recusa Explicitada pelo Jogador Convidado
    IF p_accept IS FALSE THEN
        UPDATE public.rematch_requests
        SET status = 'declined', updated_at = clock_timestamp()
        WHERE id = v_req.id;

        PERFORM public.create_notification_internal(
            v_req.requester_id,
            'rematch_declined',
            v_caller_id,
            'Revanche Recusada',
            v_caller_name || ' recusou o pedido de revanche.',
            jsonb_build_object(
                'rematch_id', v_req.id,
                'original_match_id', v_req.original_match_id,
                'actor_id', v_caller_id
            ),
            'rematch_declined:' || v_req.id
        );

        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'status', 'declined',
                'rematch_request_id', v_req.id,
                'original_match_id', v_req.original_match_id
            ),
            'error', null
        );
    END IF;

    -- Checagem autoritativa de presença do SOLICITANTE antes de aceitar
    SELECT last_seen_at, connection_status INTO v_req_last_seen, v_req_conn_status
    FROM public.match_players
    WHERE match_id = v_req.original_match_id AND user_id = v_req.requester_id;

    IF v_req_conn_status = 'disconnected' OR (v_req_last_seen IS NOT NULL AND v_req_last_seen < (clock_timestamp() - INTERVAL '20 seconds')) THEN
        UPDATE public.rematch_requests
        SET status = 'expired', updated_at = clock_timestamp()
        WHERE id = v_req.id;

        RETURN jsonb_build_object(
            'success', false,
            'error', 'O solicitante da revanche se desconectou.',
            'code', 'REQUESTER_DISCONNECTED'
        );
    END IF;

    -- Caso de Aceite
    v_slot1_user_id := v_req.requester_id;
    v_slot2_user_id := v_req.opponent_id;

    INSERT INTO public.matches (
        game_id,
        room_id,
        status,
        current_turn_player_id,
        turn_number,
        match_state
    ) VALUES (
        v_req.game_id,
        v_req.room_id,
        'in_progress',
        v_slot1_user_id,
        1,
        '{}'::jsonb
    ) RETURNING id INTO v_new_match_id;

    INSERT INTO public.match_players (match_id, user_id, slot_number, game_symbol)
    VALUES
        (v_new_match_id, v_slot1_user_id, 1, 'X'),
        (v_new_match_id, v_slot2_user_id, 2, 'O');

    UPDATE public.rematch_requests
    SET status = 'accepted',
        new_match_id = v_new_match_id,
        updated_at = clock_timestamp()
    WHERE id = v_req.id;

    IF v_req.room_id IS NOT NULL THEN
        UPDATE public.rooms
        SET status = 'in_game',
            current_match_id = v_new_match_id,
            updated_at = clock_timestamp()
        WHERE id = v_req.room_id;
    END IF;

    PERFORM public.create_notification_internal(
        v_req.requester_id,
        'rematch_accepted',
        v_caller_id,
        'Revanche Aceita!',
        v_caller_name || ' aceitou a revanche. A nova partida foi iniciada!',
        jsonb_build_object(
            'rematch_id', v_req.id,
            'match_id', v_new_match_id,
            'original_match_id', v_req.original_match_id,
            'actor_id', v_caller_id
        ),
        'rematch_accepted:' || v_req.id
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'status', 'accepted',
            'rematch_request_id', v_req.id,
            'new_match_id', v_new_match_id,
            'original_match_id', v_req.original_match_id
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_rematch(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_rematch(UUID, BOOLEAN) TO authenticated;

-- 4. Atualizar finish_match com emissão de notificação match_finished
CREATE OR REPLACE FUNCTION public.finish_match(
    p_match_id UUID,
    p_reason VARCHAR(30),
    p_winner_id UUID DEFAULT NULL,
    p_is_draw BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_match RECORD;
    v_is_player BOOLEAN;
    v_player_count INTEGER;
    v_winner_id UUID := NULL;
    v_is_draw BOOLEAN := false;
    v_opponent RECORD;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_mp RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    IF p_reason NOT IN ('normal', 'timeout', 'abandonment', 'resignation') THEN
        RAISE EXCEPTION 'INVALID_FINISH_REASON: Motivo de encerramento inválido.' USING ERRCODE = 'P0020';
    END IF;

    SELECT * INTO v_match 
    FROM public.matches 
    WHERE id = p_match_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MATCH_NOT_FOUND: Partida não encontrada.' USING ERRCODE = 'P0016';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.match_players 
        WHERE match_id = p_match_id AND user_id = v_caller_id
    ) INTO v_is_player;

    IF NOT v_is_player THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: O usuário não é participante desta partida.' USING ERRCODE = 'P0018';
    END IF;

    IF v_match.status != 'in_progress' THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'match_id', v_match.id,
                'status', v_match.status,
                'winner_id', v_match.winner_id,
                'is_draw', v_match.is_draw,
                'finish_reason', v_match.finish_reason,
                'idempotent', true
            ),
            'error', null
        );
    END IF;

    SELECT count(*) INTO v_player_count
    FROM public.match_players
    WHERE match_id = p_match_id;

    IF p_reason = 'normal' THEN
        RAISE EXCEPTION 'NORMAL_FINISH_NOT_AVAILABLE: Conclusão normal requer validador server-side de regras.' USING ERRCODE = 'P0025';

    ELSIF p_reason = 'abandonment' THEN
        IF v_player_count = 2 THEN
            SELECT * INTO v_opponent
            FROM public.match_players
            WHERE match_id = p_match_id AND user_id != v_caller_id
            LIMIT 1;

            IF v_opponent.connection_status = 'connected' AND v_opponent.last_seen_at < (v_now - interval '12 seconds') THEN
                v_opponent.connection_status := 'disconnected';
                v_opponent.disconnected_at := coalesce(v_opponent.disconnected_at, v_opponent.last_seen_at + interval '12 seconds');
                v_opponent.grace_period_expires_at := v_opponent.disconnected_at + interval '45 seconds';
                
                UPDATE public.match_players
                SET connection_status = 'disconnected',
                    disconnected_at = v_opponent.disconnected_at,
                    grace_period_expires_at = v_opponent.grace_period_expires_at
                WHERE id = v_opponent.id;
            END IF;

            IF v_opponent.connection_status != 'disconnected' THEN
                RAISE EXCEPTION 'OPPONENT_NOT_DISCONNECTED: O adversário ainda está conectado.' USING ERRCODE = 'P0034';
            END IF;

            IF v_opponent.grace_period_expires_at IS NULL OR v_now < v_opponent.grace_period_expires_at THEN
                RAISE EXCEPTION 'GRACE_PERIOD_NOT_EXPIRED: O prazo de carência do adversário ainda não expirou no servidor.' USING ERRCODE = 'P0035';
            END IF;

            v_winner_id := v_caller_id;
            v_is_draw := false;
        ELSE
            RAISE EXCEPTION 'MULTI_PLAYER_ABANDONMENT_POLICY_PENDING: Não suportado para 3+ jogadores.' USING ERRCODE = 'P0036';
        END IF;

    ELSIF p_reason = 'resignation' THEN
        IF v_player_count = 2 THEN
            SELECT user_id INTO v_winner_id
            FROM public.match_players
            WHERE match_id = p_match_id AND user_id != v_caller_id
            LIMIT 1;

            v_is_draw := false;

            UPDATE public.match_players
            SET connection_status = 'disconnected',
                disconnected_at = v_now
            WHERE match_id = p_match_id AND user_id = v_caller_id;
        ELSIF v_player_count = 1 THEN
            v_winner_id := NULL;
            v_is_draw := false;

            UPDATE public.match_players
            SET connection_status = 'disconnected',
                disconnected_at = v_now
            WHERE match_id = p_match_id AND user_id = v_caller_id;
        ELSE
            RAISE EXCEPTION 'MULTI_PLAYER_RESIGNATION_POLICY_PENDING: Não suportado para 3+ jogadores.' USING ERRCODE = 'P0027';
        END IF;

    ELSIF p_reason = 'timeout' THEN
        IF v_match.turn_deadline IS NULL OR v_now < v_match.turn_deadline THEN
            RAISE EXCEPTION 'TURN_TIMEOUT_NOT_EXPIRED: O prazo do turno ainda não expirou no servidor.' USING ERRCODE = 'P0021';
        END IF;

        IF v_player_count = 2 THEN
            SELECT user_id INTO v_winner_id
            FROM public.match_players
            WHERE match_id = p_match_id AND user_id != v_match.current_turn_player_id
            LIMIT 1;

            v_is_draw := false;
        ELSE
            RAISE EXCEPTION 'MULTI_PLAYER_TIMEOUT_POLICY_PENDING: Não suportado para 3+ jogadores.' USING ERRCODE = 'P0028';
        END IF;
    END IF;

    UPDATE public.matches SET
        status = 'finished',
        winner_id = v_winner_id,
        is_draw = v_is_draw,
        finish_reason = p_reason,
        finished_at = v_now,
        updated_at = v_now
    WHERE id = p_match_id
    RETURNING * INTO v_match;

    IF v_winner_id IS NOT NULL THEN
        UPDATE public.match_players 
        SET is_winner = (user_id = v_winner_id) 
        WHERE match_id = p_match_id;
    ELSE
        UPDATE public.match_players 
        SET is_winner = false 
        WHERE match_id = p_match_id;
    END IF;

    IF p_reason IN ('resignation', 'abandonment') THEN
        UPDATE public.rematch_requests
        SET status = 'expired',
            updated_at = v_now
        WHERE original_match_id = p_match_id
          AND status = 'pending';
    END IF;

    IF v_match.room_id IS NOT NULL THEN
        UPDATE public.rooms SET
            status = 'waiting',
            current_match_id = NULL,
            updated_at = v_now
        WHERE id = v_match.room_id AND current_match_id = p_match_id;
    END IF;

    PERFORM set_config('duoplay.internal_system_operation', 'true', true);

    UPDATE public.profiles p
    SET 
        total_matches = p.total_matches + 1,
        total_wins = p.total_wins + (CASE WHEN v_is_draw = false AND p.id = v_winner_id THEN 1 ELSE 0 END),
        total_draws = p.total_draws + (CASE WHEN v_is_draw = true THEN 1 ELSE 0 END),
        total_losses = p.total_losses + (CASE WHEN v_is_draw = false AND v_winner_id IS NOT NULL AND p.id != v_winner_id THEN 1 ELSE 0 END)
    FROM public.match_players mp
    WHERE mp.match_id = p_match_id AND p.id = mp.user_id;

    -- Emite notificações de término de partida para os participantes
    FOR v_mp IN SELECT user_id FROM public.match_players WHERE match_id = p_match_id LOOP
        IF v_is_draw THEN
            PERFORM public.create_notification_internal(
                v_mp.user_id,
                'match_finished',
                NULL,
                'Partida Encerrada',
                'A partida terminou em empate!',
                jsonb_build_object('match_id', p_match_id, 'result', 'draw'),
                'match_finished:' || p_match_id || ':' || v_mp.user_id
            );
        ELSIF v_winner_id IS NOT NULL THEN
            IF v_mp.user_id = v_winner_id THEN
                PERFORM public.create_notification_internal(
                    v_mp.user_id,
                    'match_finished',
                    NULL,
                    'Partida Encerrada',
                    'Você venceu a partida!',
                    jsonb_build_object('match_id', p_match_id, 'result', 'win'),
                    'match_finished:' || p_match_id || ':' || v_mp.user_id
                );
            ELSE
                PERFORM public.create_notification_internal(
                    v_mp.user_id,
                    'match_finished',
                    NULL,
                    'Partida Encerrada',
                    'Você perdeu a partida.',
                    jsonb_build_object('match_id', p_match_id, 'result', 'loss'),
                    'match_finished:' || p_match_id || ':' || v_mp.user_id
                );
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'match_id', v_match.id,
            'status', v_match.status,
            'winner_id', v_match.winner_id,
            'is_draw', v_match.is_draw,
            'finish_reason', v_match.finish_reason
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.finish_match(UUID, VARCHAR, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_match(UUID, VARCHAR, UUID, BOOLEAN) TO authenticated;
