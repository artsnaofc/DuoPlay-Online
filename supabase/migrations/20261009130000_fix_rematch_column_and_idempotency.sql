-- ============================================================================
-- Migration: 20261009130000_fix_rematch_column_and_idempotency.sql
-- Project: DuoPlay-Online
-- Phase: Fase 22.2 — Correção Crítica de Rematch (new_match_id) + Idempotência
-- Description:
--   1. Corrige o UPDATE na função respond_to_rematch para gravar em `new_match_id`
--      (ao invés do inexistente `created_match_id`).
--   2. Implementa garantia de idempotência para aceitação concorrente:
--      se a revanche já tiver sido aceita, retorna o novo match_id sem recriar partida.
--   3. Atualiza o status da sala associada em public.rooms para 'in_game' com current_match_id.
-- ============================================================================

DROP FUNCTION IF EXISTS public.respond_to_rematch(UUID, BOOLEAN);

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
    v_new_match_id UUID;
    v_slot1_user_id UUID;
    v_slot2_user_id UUID;
    v_game RECORD;
    v_config JSONB;
    v_initial_game_state JSONB;
    v_req_conn_status VARCHAR(20);
    v_req_last_seen TIMESTAMPTZ;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED: Apenas usuários autenticados podem responder a pedidos de revanche.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_req FROM public.rematch_requests WHERE id = p_rematch_request_id FOR UPDATE;
    IF v_req.id IS NULL THEN
        RAISE EXCEPTION 'REMATCH_NOT_FOUND: Pedido de revanche não encontrado.' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.opponent_id != v_caller_id THEN
        RAISE EXCEPTION 'FORBIDDEN_NOT_OPPONENT: Você não é o destinatário deste pedido de revanche.' USING ERRCODE = 'P0003';
    END IF;

    -- Idempotência de aceitação: se já foi aceito, retorna os dados da partida sem duplicar
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

    IF v_req.status != 'pending' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Este pedido de revanche já foi processado ou não está mais ativo.',
            'code', 'REMATCH_ALREADY_PROCESSED'
        );
    END IF;

    IF v_req.expires_at < clock_timestamp() THEN
        UPDATE public.rematch_requests SET status = 'expired', updated_at = clock_timestamp() WHERE id = v_req.id;
        RETURN jsonb_build_object(
            'success', false,
            'error', 'O pedido de revanche expirou.',
            'code', 'REMATCH_EXPIRED'
        );
    END IF;

    IF NOT p_accept THEN
        UPDATE public.rematch_requests SET status = 'declined', updated_at = clock_timestamp() WHERE id = v_req.id;
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

    -- Validação de conexão do solicitante
    SELECT connection_status, last_seen_at
    INTO v_req_conn_status, v_req_last_seen
    FROM public.match_players
    WHERE match_id = v_req.original_match_id AND user_id = v_req.requester_id;

    IF v_req_conn_status = 'disconnected' OR (v_req_last_seen IS NOT NULL AND v_req_last_seen < (clock_timestamp() - INTERVAL '20 seconds')) THEN
        UPDATE public.rematch_requests SET status = 'expired', updated_at = clock_timestamp() WHERE id = v_req.id;
        RETURN jsonb_build_object(
            'success', false,
            'error', 'O solicitante da revanche se desconectou.',
            'code', 'REQUESTER_DISCONNECTED'
        );
    END IF;

    v_slot1_user_id := v_req.opponent_id;
    v_slot2_user_id := v_req.requester_id;
    v_new_match_id := gen_random_uuid();

    SELECT * INTO v_game FROM public.games WHERE id = v_req.game_id;
    v_config := coalesce(v_game.config, '{}'::jsonb);

    IF v_req.game_id = 'carta_duo' THEN
        v_initial_game_state := public.initialize_carta_duo_state_for_players(ARRAY[v_slot1_user_id, v_slot2_user_id], v_config);
    ELSIF v_req.game_id = 'snake' THEN
        v_initial_game_state := public.initialize_snake_state_for_players(ARRAY[v_slot1_user_id, v_slot2_user_id], v_config);
    ELSE
        v_initial_game_state := jsonb_build_object('config', v_config);
    END IF;

    INSERT INTO public.matches (
        id, game_id, room_id, status, current_turn_player_id, turn_number,
        game_state, action_history, config, created_at, started_at
    ) VALUES (
        v_new_match_id, v_req.game_id, v_req.room_id, 'in_progress',
        CASE WHEN v_req.game_id = 'snake' THEN NULL ELSE v_slot1_user_id END,
        1, v_initial_game_state, '[]'::jsonb, v_config,
        clock_timestamp(), clock_timestamp()
    );

    INSERT INTO public.match_players (match_id, user_id, slot, game_symbol, score, is_winner, joined_at)
    VALUES
        (v_new_match_id, v_slot1_user_id, 1, NULL, 0, false, clock_timestamp()),
        (v_new_match_id, v_slot2_user_id, 2, NULL, 0, false, clock_timestamp());

    -- Gravação oficial e correta na coluna new_match_id da tabela public.rematch_requests
    UPDATE public.rematch_requests
    SET status = 'accepted', new_match_id = v_new_match_id, updated_at = clock_timestamp()
    WHERE id = v_req.id;

    IF v_req.room_id IS NOT NULL THEN
        UPDATE public.rooms
        SET status = 'in_game',
            current_match_id = v_new_match_id,
            updated_at = clock_timestamp()
        WHERE id = v_req.room_id;
    END IF;

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
