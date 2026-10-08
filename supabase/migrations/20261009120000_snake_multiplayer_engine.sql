-- ============================================================================
-- Migration: 20261009120000_snake_multiplayer_engine.sql
-- Project: DuoPlay-Online
-- Phase: Fase 22.1 — Snake Competitivo | Motor Multiplayer + Regras
-- Description:
--   1. Ativa 'snake' no catálogo oficial public.games (2 jogadores, real_time, arena 20x20).
--   2. Registra a função de inicialização autoritativa initialize_snake_state_for_players.
--   3. Implementa o validador server-side oficial validate_snake_action.
--   4. Registra 'snake' no despachador genérico dispatch_game_action.
--   5. Integra 'snake' em start_match, join_matchmaking_queue e respond_to_rematch.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Ativação Oficial do Jogo no Catálogo (Upsert Idempotente)
-- ----------------------------------------------------------------------------
INSERT INTO public.games (
    id,
    name,
    description,
    min_players,
    max_players,
    game_type,
    config,
    is_active
) VALUES (
    'snake',
    'Cobrinha Competitiva',
    'Arena multiplayer em tempo real onde 2 cobras disputam espaço, comida e sobrevivência.',
    2,
    2,
    'real_time',
    jsonb_build_object(
        'category_label', 'Tempo Real',
        'requires_timer', false,
        'grid_width', 20,
        'grid_height', 20,
        'tick_rate_ms', 150,
        'countdown_seconds', 3
    ),
    true
)
ON CONFLICT (id) DO UPDATE
SET is_active = true,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    min_players = EXCLUDED.min_players,
    max_players = EXCLUDED.max_players,
    game_type = EXCLUDED.game_type,
    config = EXCLUDED.config;

-- ----------------------------------------------------------------------------
-- 2. Inicializador de Estado Autoritativo do Snake (2 Jogadores)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.initialize_snake_state_for_players(
    p_player_ids UUID[],
    p_config JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_p1 UUID;
    v_p2 UUID;
    v_grid_w INTEGER := 20;
    v_grid_h INTEGER := 20;
    v_snakes JSONB := '{}'::jsonb;
    v_food JSONB;
    v_now_ms BIGINT;
    v_p1_body JSONB;
    v_p2_body JSONB;
BEGIN
    IF cardinality(p_player_ids) < 2 THEN
        RAISE EXCEPTION 'SNAKE_REQUIRES_TWO_PLAYERS: Snake Competitivo requer exatamente 2 jogadores.' USING ERRCODE = 'P0070';
    END IF;

    v_p1 := p_player_ids[1];
    v_p2 := p_player_ids[2];

    v_grid_w := COALESCE((p_config->>'grid_width')::INTEGER, 20);
    v_grid_h := COALESCE((p_config->>'grid_height')::INTEGER, 20);
    v_now_ms := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;

    -- P1 (Slot 1 - Esquerda): Cabeça em (3, 10), corpo em (2, 10), (1, 10), apontando para RIGHT (Verde/Ciano)
    v_p1_body := jsonb_build_array(
        jsonb_build_object('x', 3, 'y', 10),
        jsonb_build_object('x', 2, 'y', 10),
        jsonb_build_object('x', 1, 'y', 10)
    );

    -- P2 (Slot 2 - Direita): Cabeça em (16, 10), corpo em (17, 10), (18, 10), apontando para LEFT (Laranja/Rosa)
    v_p2_body := jsonb_build_array(
        jsonb_build_object('x', 16, 'y', 10),
        jsonb_build_object('x', 17, 'y', 10),
        jsonb_build_object('x', 18, 'y', 10)
    );

    v_snakes := jsonb_build_object(
        v_p1::text, jsonb_build_object(
            'userId', v_p1,
            'slot', 1,
            'direction', 'RIGHT',
            'nextDirection', 'RIGHT',
            'body', v_p1_body,
            'alive', true,
            'score', 0,
            'color', '#10B981'
        ),
        v_p2::text, jsonb_build_object(
            'userId', v_p2,
            'slot', 2,
            'direction', 'LEFT',
            'nextDirection', 'LEFT',
            'body', v_p2_body,
            'alive', true,
            'score', 0,
            'color', '#F59E0B'
        )
    );

    -- Comida inicial no centro da arena (10, 10)
    v_food := jsonb_build_object('x', 10, 'y', 5);

    RETURN jsonb_build_object(
        'config', jsonb_build_object(
            'gridWidth', v_grid_w,
            'gridHeight', v_grid_h,
            'tickRateMs', COALESCE((p_config->>'tick_rate_ms')::INTEGER, 150),
            'countdownSeconds', COALESCE((p_config->>'countdown_seconds')::INTEGER, 3)
        ),
        'status', 'countdown',
        'tick', 0,
        'snakes', v_snakes,
        'food', v_food,
        'startTime', v_now_ms,
        'lastTickTime', v_now_ms,
        'winnerId', NULL,
        'isDraw', false
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Validador Server-Side Oficial de Regras do Snake (validate_snake_action)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_snake_action(
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
DECLARE
    v_match RECORD;
    v_caller_player RECORD;
    v_status TEXT;
    v_tick INTEGER;
    v_snakes JSONB;
    v_food JSONB;
    v_grid_w INTEGER;
    v_grid_h INTEGER;
    v_player_key TEXT := p_player_id::text;
    v_player_snake JSONB;
    v_requested_dir TEXT;
    v_current_dir TEXT;
    v_new_state JSONB;
    v_p1_key TEXT;
    v_p2_key TEXT;
    v_p1_snake JSONB;
    v_p2_snake JSONB;
    v_p1_alive BOOLEAN;
    v_p2_alive BOOLEAN;
    v_p1_dead_this_tick BOOLEAN := false;
    v_p2_dead_this_tick BOOLEAN := false;
    v_p1_head JSONB;
    v_p2_head JSONB;
    v_p1_new_head JSONB;
    v_p2_new_head JSONB;
    v_p1_body JSONB;
    v_p2_body JSONB;
    v_p1_dir TEXT;
    v_p2_dir TEXT;
    v_p1_ate BOOLEAN := false;
    v_p2_ate BOOLEAN := false;
    v_p1_score INTEGER;
    v_p2_score INTEGER;
    v_winner_id UUID := NULL;
    v_is_draw BOOLEAN := false;
    v_is_finished BOOLEAN := false;
    v_target_tick INTEGER;
    v_food_x INTEGER;
    v_food_y INTEGER;
    v_candidate_x INTEGER;
    v_candidate_y INTEGER;
    v_food_found BOOLEAN := false;
    v_attempt INTEGER := 0;
    v_pos_occupied BOOLEAN;
    elem JSONB;
BEGIN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match.id IS NULL THEN
        RAISE EXCEPTION 'MATCH_NOT_FOUND: Partida não encontrada.' USING ERRCODE = 'P0002';
    END IF;

    IF v_match.status != 'in_progress' THEN
        RAISE EXCEPTION 'MATCH_NOT_ACTIVE: A partida já foi finalizada ou não está em andamento.' USING ERRCODE = 'P0020';
    END IF;

    SELECT * INTO v_caller_player
    FROM public.match_players
    WHERE match_id = p_match_id AND user_id = p_player_id;

    IF v_caller_player.id IS NULL THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: O jogador não é participante desta partida.' USING ERRCODE = 'P0018';
    END IF;

    v_status := COALESCE(p_current_state->>'status', 'countdown');
    v_tick := COALESCE((p_current_state->>'tick')::INTEGER, 0);
    v_snakes := p_current_state->'snakes';
    v_food := p_current_state->'food';
    v_grid_w := COALESCE((p_current_state->'config'->>'gridWidth')::INTEGER, 20);
    v_grid_h := COALESCE((p_current_state->'config'->>'gridHeight')::INTEGER, 20);

    -- Identificar as duas chaves dos jogadores
    SELECT key INTO v_p1_key FROM jsonb_each(v_snakes) WHERE (value->>'slot')::int = 1 LIMIT 1;
    SELECT key INTO v_p2_key FROM jsonb_each(v_snakes) WHERE (value->>'slot')::int = 2 LIMIT 1;

    v_p1_snake := v_snakes->v_p1_key;
    v_p2_snake := v_snakes->v_p2_key;

    -- ========================================================================
    -- AÇÃO 1: snake_start (Inicia a partida após a contagem regressiva)
    -- ========================================================================
    IF p_action_type = 'snake_start' THEN
        IF v_status = 'in_game' THEN
            -- Idempotente se já começou
            RETURN jsonb_build_object(
                'accepted', true,
                'new_state', p_current_state,
                'next_player_id', NULL,
                'winner_id', NULL,
                'is_draw', false,
                'is_finished', false
            );
        END IF;

        v_new_state := p_current_state || jsonb_build_object(
            'status', 'in_game',
            'lastTickTime', (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT
        );

        RETURN jsonb_build_object(
            'accepted', true,
            'new_state', v_new_state,
            'next_player_id', NULL,
            'winner_id', NULL,
            'is_draw', false,
            'is_finished', false
        );

    -- ========================================================================
    -- AÇÃO 2: snake_set_direction (Intenção de direção de um jogador)
    -- ========================================================================
    ELSIF p_action_type = 'snake_set_direction' THEN
        v_requested_dir := UPPER(TRIM(p_payload->>'direction'));
        IF v_requested_dir NOT IN ('UP', 'DOWN', 'LEFT', 'RIGHT') THEN
            RAISE EXCEPTION 'INVALID_DIRECTION: Direção solicitada é inválida (UP, DOWN, LEFT, RIGHT).' USING ERRCODE = 'P0071';
        END IF;

        v_player_snake := v_snakes->v_player_key;
        IF v_player_snake IS NULL THEN
            RAISE EXCEPTION 'PLAYER_SNAKE_NOT_FOUND: Cobra do jogador não encontrada no estado.' USING ERRCODE = 'P0072';
        END IF;

        IF COALESCE((v_player_snake->>'alive')::boolean, true) IS NOT TRUE THEN
            RAISE EXCEPTION 'PLAYER_ELIMINATED: Jogador já está eliminado e não pode enviar comandos.' USING ERRCODE = 'P0073';
        END IF;

        v_current_dir := v_player_snake->>'direction';

        -- Regra Anti-180°: Proibir reversão instantânea que cause colisão com o próprio pescoço
        IF (v_current_dir = 'UP' AND v_requested_dir = 'DOWN') OR
           (v_current_dir = 'DOWN' AND v_requested_dir = 'UP') OR
           (v_current_dir = 'LEFT' AND v_requested_dir = 'RIGHT') OR
           (v_current_dir = 'RIGHT' AND v_requested_dir = 'LEFT') THEN
            -- Ignora a reversão inválida sem quebrar o jogo
            v_requested_dir := v_current_dir;
        END IF;

        -- Atualizar nextDirection do jogador
        v_player_snake := v_player_snake || jsonb_build_object('nextDirection', v_requested_dir);
        v_snakes := v_snakes || jsonb_build_object(v_player_key, v_player_snake);
        v_new_state := p_current_state || jsonb_build_object('snakes', v_snakes);

        RETURN jsonb_build_object(
            'accepted', true,
            'new_state', v_new_state,
            'next_player_id', NULL,
            'winner_id', NULL,
            'is_draw', false,
            'is_finished', false
        );

    -- ========================================================================
    -- AÇÃO 3: snake_tick (Avanço autoritativo de tick da arena)
    -- ========================================================================
    ELSIF p_action_type = 'snake_tick' THEN
        IF v_status != 'in_game' THEN
            -- Se a partida estiver em countdown ou finished, aceita sem mutação de tick
            RETURN jsonb_build_object(
                'accepted', true,
                'new_state', p_current_state,
                'next_player_id', NULL,
                'winner_id', NULL,
                'is_draw', false,
                'is_finished', false
            );
        END IF;

        v_target_tick := COALESCE((p_payload->>'tick')::INTEGER, v_tick + 1);

        -- Se já processou este tick ou superior (idempotência de tick)
        IF v_target_tick <= v_tick THEN
            RETURN jsonb_build_object(
                'accepted', true,
                'new_state', p_current_state,
                'next_player_id', NULL,
                'winner_id', NULL,
                'is_draw', false,
                'is_finished', false
            );
        END IF;

        -- Obter direções efetivas
        v_p1_dir := COALESCE(v_p1_snake->>'nextDirection', v_p1_snake->>'direction');
        v_p2_dir := COALESCE(v_p2_snake->>'nextDirection', v_p2_snake->>'direction');

        v_p1_head := v_p1_snake->'body'->0;
        v_p2_head := v_p2_snake->'body'->0;

        -- Calcular nova cabeça P1
        CASE v_p1_dir
            WHEN 'UP' THEN v_p1_new_head := jsonb_build_object('x', (v_p1_head->>'x')::int, 'y', (v_p1_head->>'y')::int - 1);
            WHEN 'DOWN' THEN v_p1_new_head := jsonb_build_object('x', (v_p1_head->>'x')::int, 'y', (v_p1_head->>'y')::int + 1);
            WHEN 'LEFT' THEN v_p1_new_head := jsonb_build_object('x', (v_p1_head->>'x')::int - 1, 'y', (v_p1_head->>'y')::int);
            WHEN 'RIGHT' THEN v_p1_new_head := jsonb_build_object('x', (v_p1_head->>'x')::int + 1, 'y', (v_p1_head->>'y')::int);
        END CASE;

        -- Calcular nova cabeça P2
        CASE v_p2_dir
            WHEN 'UP' THEN v_p2_new_head := jsonb_build_object('x', (v_p2_head->>'x')::int, 'y', (v_p2_head->>'y')::int - 1);
            WHEN 'DOWN' THEN v_p2_new_head := jsonb_build_object('x', (v_p2_head->>'x')::int, 'y', (v_p2_head->>'y')::int + 1);
            WHEN 'LEFT' THEN v_p2_new_head := jsonb_build_object('x', (v_p2_head->>'x')::int - 1, 'y', (v_p2_head->>'y')::int);
            WHEN 'RIGHT' THEN v_p2_new_head := jsonb_build_object('x', (v_p2_head->>'x')::int + 1, 'y', (v_p2_head->>'y')::int);
        END CASE;

        -- 1. Colisão com Parede
        IF (v_p1_new_head->>'x')::int < 0 OR (v_p1_new_head->>'x')::int >= v_grid_w OR
           (v_p1_new_head->>'y')::int < 0 OR (v_p1_new_head->>'y')::int >= v_grid_h THEN
            v_p1_dead_this_tick := true;
        END IF;

        IF (v_p2_new_head->>'x')::int < 0 OR (v_p2_new_head->>'x')::int >= v_grid_w OR
           (v_p2_new_head->>'y')::int < 0 OR (v_p2_new_head->>'y')::int >= v_grid_h THEN
            v_p2_dead_this_tick := true;
        END IF;

        -- 2. Colisão Cabeça com Cabeça (Simultânea: Empate determinístico)
        IF (v_p1_new_head->>'x')::int = (v_p2_new_head->>'x')::int AND
           (v_p1_new_head->>'y')::int = (v_p2_new_head->>'y')::int THEN
            v_p1_dead_this_tick := true;
            v_p2_dead_this_tick := true;
        END IF;

        -- 3. Colisão com o próprio corpo
        -- P1 consigo mesma
        FOR elem IN SELECT * FROM jsonb_array_elements(v_p1_snake->'body') LOOP
            IF (elem->>'x')::int = (v_p1_new_head->>'x')::int AND (elem->>'y')::int = (v_p1_new_head->>'y')::int THEN
                v_p1_dead_this_tick := true;
            END IF;
        END LOOP;

        -- P2 consigo mesma
        FOR elem IN SELECT * FROM jsonb_array_elements(v_p2_snake->'body') LOOP
            IF (elem->>'x')::int = (v_p2_new_head->>'x')::int AND (elem->>'y')::int = (v_p2_new_head->>'y')::int THEN
                v_p2_dead_this_tick := true;
            END IF;
        END LOOP;

        -- 4. Colisão de Cabeça com o Corpo do Adversário
        -- P1 colide no corpo de P2
        FOR elem IN SELECT * FROM jsonb_array_elements(v_p2_snake->'body') LOOP
            IF (elem->>'x')::int = (v_p1_new_head->>'x')::int AND (elem->>'y')::int = (v_p1_new_head->>'y')::int THEN
                v_p1_dead_this_tick := true;
            END IF;
        END LOOP;

        -- P2 colide no corpo de P1
        FOR elem IN SELECT * FROM jsonb_array_elements(v_p1_snake->'body') LOOP
            IF (elem->>'x')::int = (v_p2_new_head->>'x')::int AND (elem->>'y')::int = (v_p2_new_head->>'y')::int THEN
                v_p2_dead_this_tick := true;
            END IF;
        END LOOP;

        -- 5. Consumo de Comida e Crescimento do Corpo
        IF NOT v_p1_dead_this_tick THEN
            IF (v_p1_new_head->>'x')::int = (v_food->>'x')::int AND (v_p1_new_head->>'y')::int = (v_food->>'y')::int THEN
                v_p1_ate := true;
            END IF;
        END IF;

        IF NOT v_p2_dead_this_tick THEN
            IF (v_p2_new_head->>'x')::int = (v_food->>'x')::int AND (v_p2_new_head->>'y')::int = (v_food->>'y')::int THEN
                v_p2_ate := true;
            END IF;
        END IF;

        -- Atualizar corpo P1
        IF NOT v_p1_dead_this_tick THEN
            v_p1_body := jsonb_build_array(v_p1_new_head);
            IF v_p1_ate THEN
                -- Cresce: mantém a cauda antiga
                v_p1_body := v_p1_body || (v_p1_snake->'body');
            ELSE
                -- Anda: remove a última célula da cauda
                FOR elem IN SELECT * FROM jsonb_array_elements(v_p1_snake->'body') LIMIT (jsonb_array_length(v_p1_snake->'body') - 1) LOOP
                    v_p1_body := v_p1_body || jsonb_build_array(elem);
                END LOOP;
            END IF;
        ELSE
            v_p1_body := v_p1_snake->'body';
        END IF;

        -- Atualizar corpo P2
        IF NOT v_p2_dead_this_tick THEN
            v_p2_body := jsonb_build_array(v_p2_new_head);
            IF v_p2_ate THEN
                v_p2_body := v_p2_body || (v_p2_snake->'body');
            ELSE
                FOR elem IN SELECT * FROM jsonb_array_elements(v_p2_snake->'body') LIMIT (jsonb_array_length(v_p2_snake->'body') - 1) LOOP
                    v_p2_body := v_p2_body || jsonb_build_array(elem);
                END LOOP;
            END IF;
        ELSE
            v_p2_body := v_p2_snake->'body';
        END IF;

        -- Reposicionar Comida se foi consumida
        IF v_p1_ate OR v_p2_ate THEN
            v_food_found := false;
            v_attempt := 0;
            WHILE NOT v_food_found AND v_attempt < 50 LOOP
                v_attempt := v_attempt + 1;
                -- Geração pseudo-determinística baseada no tick e relógio
                v_candidate_x := ((v_tick * 7 + v_attempt * 13 + 3) % (v_grid_w - 2)) + 1;
                v_candidate_y := ((v_tick * 11 + v_attempt * 17 + 5) % (v_grid_h - 2)) + 1;
                v_pos_occupied := false;

                -- Verificar se está sobre P1
                FOR elem IN SELECT * FROM jsonb_array_elements(v_p1_body) LOOP
                    IF (elem->>'x')::int = v_candidate_x AND (elem->>'y')::int = v_candidate_y THEN
                        v_pos_occupied := true;
                    END IF;
                END LOOP;

                -- Verificar se está sobre P2
                FOR elem IN SELECT * FROM jsonb_array_elements(v_p2_body) LOOP
                    IF (elem->>'x')::int = v_candidate_x AND (elem->>'y')::int = v_candidate_y THEN
                        v_pos_occupied := true;
                    END IF;
                END LOOP;

                IF NOT v_pos_occupied THEN
                    v_food := jsonb_build_object('x', v_candidate_x, 'y', v_candidate_y);
                    v_food_found := true;
                END IF;
            END LOOP;

            IF NOT v_food_found THEN
                v_food := jsonb_build_object('x', 10, 'y', 10);
            END IF;
        END IF;

        -- Atualizar scores
        v_p1_score := (v_p1_snake->>'score')::int + (CASE WHEN v_p1_ate THEN 10 ELSE 0 END);
        v_p2_score := (v_p2_snake->>'score')::int + (CASE WHEN v_p2_ate THEN 10 ELSE 0 END);

        -- Montar novo estado de cobras
        v_snakes := jsonb_build_object(
            v_p1_key, v_p1_snake || jsonb_build_object(
                'direction', v_p1_dir,
                'nextDirection', v_p1_dir,
                'body', v_p1_body,
                'alive', NOT v_p1_dead_this_tick,
                'score', v_p1_score
            ),
            v_p2_key, v_p2_snake || jsonb_build_object(
                'direction', v_p2_dir,
                'nextDirection', v_p2_dir,
                'body', v_p2_body,
                'alive', NOT v_p2_dead_this_tick,
                'score', v_p2_score
            )
        );

        -- Determinar Vitória / Empate
        IF v_p1_dead_this_tick AND v_p2_dead_this_tick THEN
            -- Ambas morreram no mesmo tick: Empate oficial
            v_is_finished := true;
            v_is_draw := true;
            v_winner_id := NULL;
        ELSIF v_p1_dead_this_tick THEN
            -- P1 morreu, P2 vence
            v_is_finished := true;
            v_is_draw := false;
            v_winner_id := v_p2_key::uuid;
        ELSIF v_p2_dead_this_tick THEN
            -- P2 morreu, P1 vence
            v_is_finished := true;
            v_is_draw := false;
            v_winner_id := v_p1_key::uuid;
        ELSE
            v_is_finished := false;
            v_is_draw := false;
            v_winner_id := NULL;
        END IF;

        v_new_state := p_current_state || jsonb_build_object(
            'tick', v_target_tick,
            'snakes', v_snakes,
            'food', v_food,
            'status', CASE WHEN v_is_finished THEN 'finished' ELSE 'in_game' END,
            'winnerId', v_winner_id,
            'isDraw', v_is_draw,
            'lastTickTime', (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT
        );

        -- Atualizar pontuação oficial nos match_players
        UPDATE public.match_players
        SET score = CASE WHEN user_id = v_p1_key::uuid THEN v_p1_score ELSE v_p2_score END
        WHERE match_id = p_match_id;

        RETURN jsonb_build_object(
            'accepted', true,
            'new_state', v_new_state,
            'next_player_id', NULL,
            'winner_id', v_winner_id,
            'is_draw', v_is_draw,
            'is_finished', v_is_finished
        );

    ELSE
        RAISE EXCEPTION 'UNKNOWN_SNAKE_ACTION: Ação % não é suportada pelas regras do Snake.', p_action_type USING ERRCODE = 'P0074';
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Registrar Snake no Despachador Oficial de Ações (dispatch_game_action)
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
    IF p_game_id = 'tic_tac_toe' THEN
        RETURN public.validate_tic_tac_toe_action(
            p_match_id,
            p_player_id,
            p_action_type,
            p_payload,
            p_current_state,
            p_turn_number
        );
    ELSIF p_game_id = 'carta_duo' OR p_game_id = 'carta-duo' THEN
        RETURN public.validate_carta_duo_action(
            p_match_id,
            p_player_id,
            p_action_type,
            p_payload,
            p_current_state,
            p_turn_number
        );
    ELSIF p_game_id = 'snake' THEN
        RETURN public.validate_snake_action(
            p_match_id,
            p_player_id,
            p_action_type,
            p_payload,
            p_current_state,
            p_turn_number
        );
    ELSE
        RAISE EXCEPTION 'GAME_VALIDATOR_NOT_AVAILABLE: As regras deste jogo ainda não estão disponíveis no servidor para validar esta ação.' USING ERRCODE = 'P0030';
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Atualizar start_match para Inicializar Corretamente o Estado do Snake
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
    v_player_ids UUID[];
    v_slot1_user_id UUID;
    v_match_id UUID;
    v_config JSONB;
    v_initial_game_state JSONB;
    v_match RECORD;
    v_rec RECORD;
    v_players_json JSON;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED: Apenas usuários autenticados podem iniciar partidas.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id;
    IF v_room.id IS NULL THEN
        RAISE EXCEPTION 'ROOM_NOT_FOUND: Sala não encontrada.' USING ERRCODE = 'P0002';
    END IF;

    IF v_room.host_id != v_caller_id THEN
        RAISE EXCEPTION 'FORBIDDEN_NOT_HOST: Apenas o anfitrião pode iniciar a partida.' USING ERRCODE = 'P0003';
    END IF;

    IF v_room.status != 'waiting' THEN
        RAISE EXCEPTION 'ROOM_NOT_READY: A sala não está em estado de espera.' USING ERRCODE = 'P0004';
    END IF;

    SELECT * INTO v_game FROM public.games WHERE id = v_room.game_id;
    IF v_game.id IS NULL OR v_game.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'GAME_NOT_ACTIVE: O jogo desta sala não está ativo na plataforma.' USING ERRCODE = 'P0015';
    END IF;

    SELECT COUNT(*) INTO v_player_count
    FROM public.room_members
    WHERE room_id = p_room_id AND role = 'player';

    IF v_player_count < v_game.min_players OR v_player_count > v_game.max_players THEN
        RAISE EXCEPTION 'INVALID_PLAYER_COUNT: A partida requer entre % e % jogadores.', v_game.min_players, v_game.max_players USING ERRCODE = 'P0007';
    END IF;

    SELECT array_agg(user_id ORDER BY slot_number ASC) INTO v_player_ids
    FROM public.room_members
    WHERE room_id = p_room_id AND role = 'player';

    v_slot1_user_id := v_player_ids[1];
    v_match_id := gen_random_uuid();
    v_config := coalesce(v_room.config, v_game.config, '{}'::jsonb);

    IF v_game.id = 'carta_duo' THEN
        v_initial_game_state := public.initialize_carta_duo_state_for_players(v_player_ids, v_config);
        v_slot1_user_id := (v_initial_game_state->>'current_turn_player_id')::uuid;
    ELSIF v_game.id = 'snake' THEN
        v_initial_game_state := public.initialize_snake_state_for_players(v_player_ids, v_config);
        v_slot1_user_id := NULL; -- Real-time simultâneo
    ELSE
        v_initial_game_state := jsonb_build_object('config', v_config);
    END IF;

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
        config,
        created_at,
        started_at
    ) VALUES (
        v_match_id,
        p_room_id,
        v_game.id,
        'in_progress',
        v_slot1_user_id,
        CASE WHEN v_game.id = 'snake' THEN NULL ELSE now() + (COALESCE((v_config->>'turn_timer')::INTEGER, 30) || ' seconds')::INTERVAL END,
        1,
        v_initial_game_state,
        '[]'::jsonb,
        v_config,
        now(),
        now()
    ) RETURNING * INTO v_match;

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
            NULL,
            0,
            false,
            now()
        );
    END LOOP;

    UPDATE public.rooms 
    SET status = 'in_game', current_match_id = v_match_id, updated_at = now()
    WHERE id = p_room_id;

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
-- 6. Atualizar join_matchmaking_queue para Suporte Autoritativo ao Snake
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_matchmaking_queue(
    p_game_id VARCHAR(50)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_game RECORD;
    v_norm_game_id VARCHAR(50);
    v_my_entry RECORD;
    v_opponent_queue_ids UUID[];
    v_opponent_user_ids UUID[];
    v_all_user_ids UUID[];
    v_new_match_id UUID;
    v_first_player_id UUID;
    v_initial_game_state JSONB;
    v_config JSONB;
    v_required_opponents INTEGER;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED: Apenas usuários autenticados podem entrar na fila.' USING ERRCODE = 'P0001';
    END IF;

    -- Bloqueio por partida 'in_progress' ativa
    IF EXISTS (
        SELECT 1 FROM public.match_players mp
        JOIN public.matches m ON m.id = mp.match_id
        WHERE mp.user_id = v_caller_id AND m.status = 'in_progress'
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Você possui uma partida em andamento. Conclua-a antes de buscar outra.',
            'code', 'ACTIVE_MATCH_EXISTS'
        );
    END IF;

    -- Normalização e validação no catálogo de jogos
    v_norm_game_id := replace(p_game_id, '-', '_');
    SELECT * INTO v_game FROM public.games WHERE id = v_norm_game_id AND is_active = true;
    IF v_game.id IS NULL THEN
        RAISE EXCEPTION 'GAME_NOT_ACTIVE: O jogo especificado não existe ou não possui matchmaking público ativo.' USING ERRCODE = 'P0015';
    END IF;

    -- Limpar fila expirada
    DELETE FROM public.matchmaking_queue WHERE expires_at < clock_timestamp();

    -- Verificar se o usuário já tem entrada ativa
    SELECT * INTO v_my_entry
    FROM public.matchmaking_queue
    WHERE user_id = v_caller_id AND status IN ('waiting', 'matched')
    LIMIT 1;

    IF v_my_entry.id IS NOT NULL THEN
        IF v_my_entry.status = 'matched' AND v_my_entry.match_id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'queue_id', v_my_entry.id,
                    'game_id', v_my_entry.game_id,
                    'status', 'matched',
                    'match_id', v_my_entry.match_id,
                    'expires_at', v_my_entry.expires_at
                ),
                'error', null
            );
        END IF;

        IF v_my_entry.game_id <> v_game.id THEN
            DELETE FROM public.matchmaking_queue WHERE user_id = v_caller_id;
            v_my_entry := NULL;
        END IF;
    END IF;

    v_required_opponents := 1; -- Pareamento 1v1
    v_new_match_id := gen_random_uuid();

    SELECT array_agg(id), array_agg(user_id)
    INTO v_opponent_queue_ids, v_opponent_user_ids
    FROM (
        SELECT id, user_id
        FROM public.matchmaking_queue
        WHERE game_id = v_game.id
          AND status = 'waiting'
          AND user_id != v_caller_id
          AND expires_at > clock_timestamp()
        ORDER BY created_at ASC
        LIMIT v_required_opponents
        FOR UPDATE SKIP LOCKED
    ) sub;

    IF v_opponent_queue_ids IS NOT NULL AND cardinality(v_opponent_queue_ids) = v_required_opponents THEN
        v_all_user_ids := array_append(v_opponent_user_ids, v_caller_id);
        v_first_player_id := v_all_user_ids[1];
        v_config := coalesce(v_game.config, '{}'::jsonb);

        IF v_game.id = 'carta_duo' THEN
            v_initial_game_state := public.initialize_carta_duo_state_for_players(v_all_user_ids, v_config);
            v_first_player_id := (v_initial_game_state->>'current_turn_player_id')::uuid;
        ELSIF v_game.id = 'snake' THEN
            v_initial_game_state := public.initialize_snake_state_for_players(v_all_user_ids, v_config);
            v_first_player_id := NULL;
        ELSE
            v_initial_game_state := jsonb_build_object('config', v_config);
        END IF;

        INSERT INTO public.matches (
            id, room_id, game_id, status, current_turn_player_id,
            turn_deadline, turn_number, game_state, action_history, config, created_at, started_at
        ) VALUES (
            v_new_match_id, NULL, v_game.id, 'in_progress', v_first_player_id,
            CASE WHEN v_game.id = 'snake' THEN NULL ELSE clock_timestamp() + (COALESCE((v_config->>'turn_timer')::INTEGER, 30) || ' seconds')::INTERVAL END,
            1, v_initial_game_state, '[]'::jsonb, v_config,
            clock_timestamp(), clock_timestamp()
        );

        FOR i IN 1..cardinality(v_all_user_ids) LOOP
            INSERT INTO public.match_players (
                match_id, user_id, slot, game_symbol, score, is_winner, joined_at
            ) VALUES (
                v_new_match_id, v_all_user_ids[i], i, NULL, 0, false, clock_timestamp()
            );
        END LOOP;

        UPDATE public.matchmaking_queue
        SET status = 'matched', match_id = v_new_match_id, updated_at = clock_timestamp()
        WHERE id = ANY(v_opponent_queue_ids);

        IF v_my_entry.id IS NOT NULL THEN
            UPDATE public.matchmaking_queue
            SET status = 'matched', match_id = v_new_match_id, updated_at = clock_timestamp()
            WHERE id = v_my_entry.id
            RETURNING * INTO v_my_entry;
        ELSE
            INSERT INTO public.matchmaking_queue (
                user_id, game_id, status, match_id, expires_at
            ) VALUES (
                v_caller_id, v_game.id, 'matched', v_new_match_id, clock_timestamp() + INTERVAL '5 minutes'
            )
            ON CONFLICT (user_id) WHERE status IN ('waiting', 'matched')
            DO UPDATE SET status = 'matched', match_id = v_new_match_id, updated_at = clock_timestamp()
            RETURNING * INTO v_my_entry;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'queue_id', v_my_entry.id,
                'game_id', v_game.id,
                'status', 'matched',
                'match_id', v_new_match_id,
                'expires_at', v_my_entry.expires_at
            ),
            'error', null
        );
    ELSE
        IF v_my_entry.id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'queue_id', v_my_entry.id,
                    'game_id', v_my_entry.game_id,
                    'status', 'waiting',
                    'match_id', null,
                    'expires_at', v_my_entry.expires_at
                ),
                'error', null
            );
        END IF;

        INSERT INTO public.matchmaking_queue (
            user_id, game_id, status, expires_at
        ) VALUES (
            v_caller_id, v_game.id, 'waiting', clock_timestamp() + INTERVAL '5 minutes'
        )
        ON CONFLICT (user_id) WHERE status IN ('waiting', 'matched')
        DO UPDATE SET game_id = EXCLUDED.game_id, status = 'waiting', match_id = NULL, expires_at = EXCLUDED.expires_at, updated_at = clock_timestamp()
        RETURNING * INTO v_my_entry;

        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'queue_id', v_my_entry.id,
                'game_id', v_my_entry.game_id,
                'status', 'waiting',
                'match_id', null,
                'expires_at', v_my_entry.expires_at
            ),
            'error', null
        );
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Atualizar respond_to_rematch para Suporte ao Snake
-- ----------------------------------------------------------------------------
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

    IF v_req.status != 'pending' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Este pedido de revanche já foi processado ou expirou.',
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
                'rematch_request_id', v_req.id
            ),
            'error', null
        );
    END IF;

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

    UPDATE public.rematch_requests
    SET status = 'accepted', created_match_id = v_new_match_id, updated_at = clock_timestamp()
    WHERE id = v_req.id;

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
