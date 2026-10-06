-- ============================================================================
-- Migration: 20261006030000_gate_game_actions_until_validator.sql
-- Project: DuoPlay-Online
-- Phase: Fase 3.2 — Gate de Ações e Neutralização Final da Infraestrutura Multiplayer
-- Description:
--   1. dispatch_game_action(): Implementa o Gate de Validador server-side.
--      Enquanto validadores oficiais de regras de jogo não estiverem registrados
--      no PostgreSQL (Fase 6), qualquer chamada resulta em erro explícito
--      GAME_VALIDATOR_NOT_AVAILABLE ('P0030').
--   2. submit_game_action(): Condiciona qualquer avanço de turno, alteração de
--      game_state, alteração de deadline ou registro em action_history à
--      aprovação explícita (accepted = true) do validador server-side.
--   3. start_match(): Garante a neutralidade de infraestrutura mantendo
--      match_players.game_symbol como NULL (desacoplamento total de regras de X/O).
--   4. Preservação Histórica: Nenhuma partida ou jogador existente é alterado retroativamente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Despachador de Ações com Gate de Validador (dispatch_game_action)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_game_action(
    p_game_id VARCHAR(50),
    p_match_id UUID,
    p_player_id UUID,
    p_action_type VARCHAR(50),
    p_payload JSONB,
    p_current_state JSONB,
    p_turn_number INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Gate de Validação Server-Side de Regras de Jogo
    -- Nesta fase (Fase 3.2), os validadores server-side de regras específicas
    -- (como Jogo da Velha, Cobrinha, Pong) ainda não foram implementados (Fase 6).
    -- A infraestrutura rejeita qualquer tentativa de ação com erro explícito,
    -- impedindo contaminação de estado, avanço de turno ou histórico falso.
    RAISE EXCEPTION 'GAME_VALIDATOR_NOT_AVAILABLE: As regras deste jogo ainda não estão disponíveis no servidor para validar esta ação.' USING ERRCODE = 'P0030';
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_game_action(VARCHAR, UUID, UUID, VARCHAR, JSONB, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Submissão de Ações com Validação Server-Side Estrita (submit_game_action)
-- ----------------------------------------------------------------------------
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

    -- 4. Validar pertencimento do jogador à composição congelada da partida
    SELECT EXISTS (
        SELECT 1 FROM public.match_players 
        WHERE match_id = p_match_id AND user_id = v_caller_id
    ) INTO v_is_player;

    IF NOT v_is_player THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: O usuário não é participante desta partida.' USING ERRCODE = 'P0018';
    END IF;

    -- 5. Idempotência por action_id (somente para ações que já foram oficialmente aceitas no histórico)
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

    -- 6. Validar turno do jogador
    IF v_match.current_turn_player_id IS NOT NULL AND v_match.current_turn_player_id != v_caller_id THEN
        RAISE EXCEPTION 'NOT_YOUR_TURN: Não é o seu turno de jogar.' USING ERRCODE = 'P0019';
    END IF;

    -- 7. Encaminhar para o despachador genérico de regras de jogo (Gate de Validação)
    -- Se o jogo não tiver validador registrado ou a ação for inválida, uma exceção é lançada,
    -- abortando a transação e impedindo qualquer alteração em game_state, turnos, histórico ou deadline.
    v_dispatch_result := public.dispatch_game_action(
        v_match.game_id,
        v_match.id,
        v_caller_id,
        p_action_type,
        coalesce(p_payload, '{}'::jsonb),
        v_match.game_state,
        v_match.turn_number
    );

    -- 8. Validar aprovação explícita do validador (accepted = true)
    IF v_dispatch_result IS NULL OR coalesce((v_dispatch_result->>'accepted')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'INVALID_GAME_ACTION: Ação rejeitada pelas regras do jogo.' USING ERRCODE = 'P0031';
    END IF;

    v_new_state := coalesce(v_dispatch_result->'new_state', v_match.game_state);
    v_next_turn_player_id := (v_dispatch_result->>'next_player_id')::uuid;
    v_winner_id := (v_dispatch_result->>'winner_id')::uuid;
    v_is_draw := coalesce((v_dispatch_result->>'is_draw')::boolean, false);
    v_is_finished := coalesce((v_dispatch_result->>'is_finished')::boolean, false);

    -- 9. Montar envelope oficial da ação VALIDADA
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

    -- 10. Atualizar estado da partida no PostgreSQL apenas após validação oficial
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

        -- Atualizar flags nos match_players
        IF v_winner_id IS NOT NULL THEN
            UPDATE public.match_players 
            SET is_winner = (user_id = v_winner_id) 
            WHERE match_id = p_match_id;
        ELSE
            UPDATE public.match_players 
            SET is_winner = false 
            WHERE match_id = p_match_id;
        END IF;

        -- Liberar a sala vinculada
        IF v_match.room_id IS NOT NULL THEN
            UPDATE public.rooms SET
                status = 'waiting',
                current_match_id = NULL,
                updated_at = now()
            WHERE id = v_match.room_id AND current_match_id = p_match_id;
        END IF;

        -- Atualização segura de estatísticas nos perfis
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
            turn_deadline = now() + INTERVAL '30 seconds'
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
            'status', v_match.status
        ),
        'error', null
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Início de Partida Genérico e Neutro (start_match)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_match(
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
    v_game RECORD;
    v_player_count INTEGER;
    v_unready_count INTEGER;
    v_match_id UUID;
    v_match RECORD;
    v_slot1_user_id UUID;
    v_players_json JSON;
    v_rec RECORD;
BEGIN
    -- 1. Identificar usuário chamador
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Bloqueio transacional da sala (FOR UPDATE)
    SELECT * INTO v_room 
    FROM public.rooms 
    WHERE id = p_room_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ROOM_NOT_FOUND: Sala não encontrada.' USING ERRCODE = 'P0005';
    END IF;

    -- 3. Validar se o chamador é o Host oficial
    IF v_room.host_id != v_caller_id THEN
        RAISE EXCEPTION 'NOT_ROOM_HOST: Apenas o anfitrião pode iniciar a partida.' USING ERRCODE = 'P0010';
    END IF;

    -- 4. Idempotência contra retries de rede e double-clicks
    IF v_room.status = 'in_game' AND v_room.current_match_id IS NOT NULL THEN
        SELECT * INTO v_match FROM public.matches WHERE id = v_room.current_match_id;
        IF FOUND AND v_match.status = 'in_progress' THEN
            SELECT json_agg(row_to_json(mp)) INTO v_players_json
            FROM public.match_players mp
            WHERE mp.match_id = v_match.id;

            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'match', row_to_json(v_match),
                    'players', coalesce(v_players_json, '[]'::json),
                    'idempotent', true
                ),
                'error', null
            );
        END IF;
    END IF;

    -- 5. Validar estado da sala
    IF v_room.status != 'waiting' THEN
        RAISE EXCEPTION 'INVALID_ROOM_STATUS: A sala não está em estado de espera.' USING ERRCODE = 'P0011';
    END IF;

    -- 6. Obter regras do jogo e validar participantes com role = 'player'
    SELECT * INTO v_game FROM public.games WHERE id = v_room.game_id;

    SELECT count(*) INTO v_player_count 
    FROM public.room_members 
    WHERE room_id = p_room_id AND role = 'player';

    IF v_player_count < v_game.min_players THEN
        RAISE EXCEPTION 'INSUFFICIENT_PLAYERS: Quantidade de jogadores insuficiente (mínimo exigido: %).', v_game.min_players USING ERRCODE = 'P0012';
    END IF;

    IF v_player_count > v_game.max_players THEN
        RAISE EXCEPTION 'TOO_MANY_PLAYERS: Quantidade de jogadores excede o limite máximo (máximo: %).', v_game.max_players USING ERRCODE = 'P0013';
    END IF;

    -- 7. Verificar prontidão de todos os jogadores (role = 'player')
    SELECT count(*) INTO v_unready_count 
    FROM public.room_members 
    WHERE room_id = p_room_id AND role = 'player' AND is_ready = false;

    IF v_unready_count > 0 THEN
        RAISE EXCEPTION 'PLAYERS_NOT_READY: Nem todos os jogadores confirmaram prontidão.' USING ERRCODE = 'P0014';
    END IF;

    -- 8. Identificar jogador do menor slot para o primeiro turno
    SELECT user_id INTO v_slot1_user_id
    FROM public.room_members
    WHERE room_id = p_room_id AND role = 'player'
    ORDER BY slot_number ASC
    LIMIT 1;

    -- 9. Criar a partida (Match) com valores oficiais do servidor
    v_match_id := gen_random_uuid();

    INSERT INTO public.matches (
        id,
        room_id,
        game_id,
        status,
        current_turn_player_id,
        turn_deadline,
        turn_number,
        game_state,
        action_history,
        created_at,
        started_at
    ) VALUES (
        v_match_id,
        p_room_id,
        v_room.game_id,
        'in_progress',
        v_slot1_user_id,
        now() + INTERVAL '30 seconds',
        1,
        '{}'::jsonb,
        '[]'::jsonb,
        now(),
        now()
    ) RETURNING * INTO v_match;

    -- 10. Congelar composição de jogadores em match_players (game_symbol neutro NULL na infraestrutura)
    FOR v_rec IN 
        SELECT user_id, slot_number 
        FROM public.room_members 
        WHERE room_id = p_room_id AND role = 'player' 
        ORDER BY slot_number ASC 
    LOOP
        INSERT INTO public.match_players (
            match_id,
            user_id,
            slot,
            game_symbol,
            score,
            is_winner,
            joined_at
        ) VALUES (
            v_match_id,
            v_rec.user_id,
            v_rec.slot_number,
            NULL, -- game_symbol é NULL na infraestrutura; será atribuído na camada do jogo na Fase 6
            0,
            false,
            now()
        );
    END LOOP;

    -- 11. Atualizar sala para status in_game e vincular partida
    UPDATE public.rooms 
    SET status = 'in_game', current_match_id = v_match_id, updated_at = now()
    WHERE id = p_room_id;

    -- 12. Obter array de participantes da partida
    SELECT json_agg(row_to_json(mp)) INTO v_players_json
    FROM public.match_players mp
    WHERE mp.match_id = v_match_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'match', row_to_json(v_match),
            'players', coalesce(v_players_json, '[]'::json)
        ),
        'error', null
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Concessão Estrita de Permissões
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.submit_game_action(UUID, UUID, VARCHAR, JSONB, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_game_action(UUID, UUID, VARCHAR, JSONB, BIGINT) TO authenticated;

REVOKE ALL ON FUNCTION public.start_match(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_match(UUID) TO authenticated;
