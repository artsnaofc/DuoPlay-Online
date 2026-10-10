-- ============================================================================
-- Migration: 20261010010000_production_hardening_and_idempotency.sql
-- Project: DuoPlay-Online
-- Phase: Fase de Hardening — Desempenho, Segurança e Idempotência de Produção
-- Description:
--   1. Atualiza submit_game_action para garantir que ticks concorrentes ou repetidos
--      em jogos em tempo real (ex: 'snake_tick') não executem updates desnecessários
--      na tabela matches, não inflem action_history e não alterem turn_number quando
--      o tick já foi processado pelo outro participante.
--   2. Garante que snake_start seja estritamente idempotente.
--   3. Preserva RLS estrito e validação autoritativa no PostgreSQL.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_game_action(
    p_match_id UUID,
    p_action_id UUID,
    p_action_type VARCHAR(50),
    p_payload JSONB DEFAULT '{}'::jsonb,
    p_client_timestamp BIGINT DEFAULT NULL
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
    v_dispatch_result JSONB;
    v_new_state JSONB;
    v_next_turn_player_id UUID;
    v_winner_id UUID;
    v_is_draw BOOLEAN;
    v_is_finished BOOLEAN;
    v_envelope JSONB;
    v_new_action_history JSONB;
    v_current_tick INTEGER;
    v_new_tick INTEGER;
BEGIN
    -- 1. Identificar usuário chamador
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Bloqueio transacional da partida (FOR UPDATE)
    SELECT * INTO v_match 
    FROM public.matches 
    WHERE id = p_match_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MATCH_NOT_FOUND: Partida não encontrada.' USING ERRCODE = 'P0016';
    END IF;

    -- 3. Validar estado da partida
    IF v_match.status != 'in_progress' THEN
        RAISE EXCEPTION 'MATCH_NOT_IN_PROGRESS: A partida não está em andamento.' USING ERRCODE = 'P0017';
    END IF;

    -- 4. Validar pertencimento do jogador à partida
    SELECT EXISTS (
        SELECT 1 FROM public.match_players 
        WHERE match_id = p_match_id AND user_id = v_caller_id
    ) INTO v_is_player;

    IF NOT v_is_player THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: O usuário não é participante desta partida.' USING ERRCODE = 'P0018';
    END IF;

    -- 5. Idempotência por action_id
    IF v_match.action_history @> jsonb_build_array(jsonb_build_object('action_id', p_action_id::text)) THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'match_id', v_match.id,
                'turn_number', v_match.turn_number,
                'game_state', v_match.game_state,
                'winner_id', v_match.winner_id,
                'is_draw', v_match.is_draw,
                'status', v_match.status,
                'idempotent', true
            ),
            'error', null
        );
    END IF;

    -- 6. Validar turno do jogador (jogos por turno)
    -- Exceções autoritativas: jogos em tempo real (snake) ou ações fora de turno
    IF v_match.current_turn_player_id IS NOT NULL 
       AND v_match.current_turn_player_id != v_caller_id 
       AND p_action_type NOT IN ('declare_last_card', 'challenge_last_card', 'snake_tick', 'snake_set_direction', 'snake_start') THEN
        RAISE EXCEPTION 'NOT_YOUR_TURN: Não é o seu turno de jogar.' USING ERRCODE = 'P0019';
    END IF;

    -- 7. Despacho para o validador autoritativo
    v_dispatch_result := public.dispatch_game_action(
        v_match.game_id,
        v_match.id,
        v_caller_id,
        p_action_type,
        coalesce(p_payload, '{}'::jsonb),
        v_match.game_state,
        v_match.turn_number
    );

    -- 8. Validar aprovação explícita do validador
    IF v_dispatch_result IS NULL OR coalesce((v_dispatch_result->>'accepted')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'INVALID_GAME_ACTION: Ação rejeitada pelas regras do jogo.' USING ERRCODE = 'P0031';
    END IF;

    v_new_state := coalesce(v_dispatch_result->'new_state', v_match.game_state);
    v_next_turn_player_id := (v_dispatch_result->>'next_player_id')::uuid;
    v_winner_id := (v_dispatch_result->>'winner_id')::uuid;
    v_is_draw := coalesce((v_dispatch_result->>'is_draw')::boolean, false);
    v_is_finished := coalesce((v_dispatch_result->>'is_finished')::boolean, false);

    -- Otimização Crítica de Desempenho e Concorrência para Ticks em Tempo Real:
    -- Se for um snake_tick que não gerou avanço de tick (porque já foi processado concorrentemente
    -- pela outra aba) e não finalizou a partida, retornar imediatamente sem mutação de banco.
    IF p_action_type = 'snake_tick' AND NOT v_is_finished THEN
        v_current_tick := COALESCE((v_match.game_state->>'tick')::INTEGER, 0);
        v_new_tick := COALESCE((v_new_state->>'tick')::INTEGER, 0);

        IF v_new_tick <= v_current_tick THEN
            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'match_id', v_match.id,
                    'turn_number', v_match.turn_number,
                    'game_state', v_match.game_state,
                    'winner_id', v_match.winner_id,
                    'is_draw', v_match.is_draw,
                    'status', v_match.status,
                    'idempotent', true
                ),
                'error', null
            );
        END IF;
    END IF;

    -- Otimização para snake_start idempotente (já iniciado)
    IF p_action_type = 'snake_start' AND v_match.game_state->>'status' = 'in_game' THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'match_id', v_match.id,
                'turn_number', v_match.turn_number,
                'game_state', v_match.game_state,
                'winner_id', v_match.winner_id,
                'is_draw', v_match.is_draw,
                'status', v_match.status,
                'idempotent', true
            ),
            'error', null
        );
    END IF;

    -- 9. Montar envelope oficial da ação validada
    v_envelope := jsonb_build_object(
        'action_id', p_action_id::text,
        'turn_number', v_match.turn_number,
        'player_id', v_caller_id,
        'action_type', p_action_type,
        'payload', coalesce(p_payload, '{}'::jsonb),
        'client_timestamp', p_client_timestamp,
        'server_timestamp', now()
    );

    v_new_action_history := v_match.action_history || jsonb_build_array(v_envelope);

    -- 10. Atualizar estado da partida no PostgreSQL
    IF v_is_finished THEN
        UPDATE public.matches SET
            game_state = v_new_state,
            action_history = v_new_action_history,
            status = 'finished',
            winner_id = v_winner_id,
            is_draw = v_is_draw,
            finish_reason = 'normal',
            finished_at = now()
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

        IF v_match.room_id IS NOT NULL THEN
            UPDATE public.rooms SET
                status = 'waiting',
                current_match_id = NULL,
                updated_at = now()
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
    ELSE
        UPDATE public.matches SET
            game_state = v_new_state,
            action_history = v_new_action_history,
            turn_number = v_match.turn_number + 1,
            current_turn_player_id = v_next_turn_player_id,
            turn_deadline = CASE 
                WHEN p_action_type IN ('declare_last_card', 'challenge_last_card', 'snake_tick', 'snake_set_direction', 'snake_start') THEN v_match.turn_deadline
                ELSE now() + (COALESCE((v_match.config->>'turn_timer')::INTEGER, 30) || ' seconds')::INTERVAL 
            END
        WHERE id = p_match_id
        RETURNING * INTO v_match;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'match_id', v_match.id,
            'turn_number', v_match.turn_number,
            'game_state', v_match.game_state,
            'winner_id', v_match.winner_id,
            'is_draw', v_match.is_draw,
            'status', v_match.status,
            'idempotent', false
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_game_action(UUID, UUID, VARCHAR, JSONB, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_game_action(UUID, UUID, VARCHAR, JSONB, BIGINT) TO authenticated;
