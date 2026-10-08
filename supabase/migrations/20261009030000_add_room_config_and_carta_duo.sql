-- ============================================================================
-- Migration: 20261009030000_add_room_config_and_carta_duo.sql
-- Project: DuoPlay-Online
-- Phase: Fase 20 — Carta Duo 🃏
-- Description: Adiciona coluna de config em rooms, cria RPC de configuração de sala,
--              redefine start_match para copiar configs e implementa o validador
--              server-side oficial para as regras do Carta Duo (2-6 jogadores).
-- ============================================================================

-- 1. Adicionar coluna de config em public.rooms para guardar regras personalizadas no lobby
ALTER TABLE public.rooms
    ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb NOT NULL;

COMMENT ON COLUMN public.rooms.config IS 'Configurações de regras personalizadas editáveis pelo Host no lobby pré-jogo.';

-- ----------------------------------------------------------------------------
-- 2. RPC para Atualizar Configurações da Sala (public.update_room_config)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_room_config(
    p_room_id UUID,
    p_config JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_room RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ROOM_NOT_FOUND: Sala não encontrada.' USING ERRCODE = 'P0005';
    END IF;

    IF v_room.host_id <> v_caller_id THEN
        RAISE EXCEPTION 'NOT_ROOM_HOST: Apenas o anfitrião pode alterar as configurações da sala.' USING ERRCODE = 'P0010';
    END IF;

    IF v_room.status <> 'waiting' THEN
        RAISE EXCEPTION 'INVALID_ROOM_STATUS: Configurações só podem ser alteradas no lobby.' USING ERRCODE = 'P0011';
    END IF;

    -- Validar estrutura da configuração básica
    IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
        RAISE EXCEPTION 'INVALID_CONFIG: A configuração deve ser um objeto JSON válido.' USING ERRCODE = 'P0070';
    END IF;

    UPDATE public.rooms
    SET config = coalesce(p_config, '{}'::jsonb),
        updated_at = now()
    WHERE id = p_room_id
    RETURNING * INTO v_room;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'room_id', v_room.id,
            'config', v_room.config
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.update_room_config(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_room_config(UUID, JSONB) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Redefinição de start_match para Clonar as Configurações da Sala
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
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_room 
    FROM public.rooms 
    WHERE id = p_room_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ROOM_NOT_FOUND: Sala não encontrada.' USING ERRCODE = 'P0005';
    END IF;

    IF v_room.host_id != v_caller_id THEN
        RAISE EXCEPTION 'NOT_ROOM_HOST: Apenas o anfitrião pode iniciar a partida.' USING ERRCODE = 'P0010';
    END IF;

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

    IF v_room.status != 'waiting' THEN
        RAISE EXCEPTION 'INVALID_ROOM_STATUS: A sala não está em estado de espera.' USING ERRCODE = 'P0011';
    END IF;

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

    SELECT count(*) INTO v_unready_count 
    FROM public.room_members 
    WHERE room_id = p_room_id AND role = 'player' AND is_ready = false;

    IF v_unready_count > 0 THEN
        RAISE EXCEPTION 'PLAYERS_NOT_READY: Nem todos os jogadores confirmaram prontidão.' USING ERRCODE = 'P0014';
    END IF;

    SELECT user_id INTO v_slot1_user_id
    FROM public.room_members
    WHERE room_id = p_room_id AND role = 'player' AND slot_number = 1;

    IF v_slot1_user_id IS NULL THEN
        SELECT user_id INTO v_slot1_user_id
        FROM public.room_members
        WHERE room_id = p_room_id AND role = 'player'
        ORDER BY slot_number ASC
        LIMIT 1;
    END IF;

    v_match_id := gen_random_uuid();

    -- Clona as configs da sala no game_state inicial da partida
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
        now() + (COALESCE((v_room.config->>'turn_timer')::INTEGER, 30) || ' seconds')::INTERVAL,
        1,
        jsonb_build_object('config', COALESCE(v_room.config, '{}'::jsonb)),
        '[]'::jsonb,
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
            (CASE WHEN v_rec.slot_number = 1 THEN 'X' WHEN v_rec.slot_number = 2 THEN 'O' ELSE v_rec.slot_number::text END),
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

REVOKE ALL ON FUNCTION public.start_match(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_match(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Funções Auxiliares para o Carta Duo
-- ----------------------------------------------------------------------------

-- Função Determinística para calcular o próximo jogador no turno
CREATE OR REPLACE FUNCTION public.get_next_carta_duo_player_id(
    p_current_player_id UUID,
    p_turn_order UUID[],
    p_direction INTEGER,
    p_steps INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_idx INTEGER := 0;
    v_len INTEGER;
    v_next_idx INTEGER;
BEGIN
    v_len := array_length(p_turn_order, 1);
    
    FOR i IN 1..v_len LOOP
        IF p_turn_order[i] = p_current_player_id THEN
            v_idx := i;
            EXIT;
        END IF;
    END LOOP;

    v_next_idx := (v_idx - 1 + p_direction * p_steps) % v_len;
    IF v_next_idx < 0 THEN
        v_next_idx := v_next_idx + v_len;
    END IF;
    v_next_idx := v_next_idx + 1;

    RETURN p_turn_order[v_next_idx];
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Validador Server-Side Oficial de Regras do Carta Duo (validate_carta_duo_action)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_carta_duo_action(
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
    -- Variáveis de Configuração
    v_config JSONB;
    v_initial_cards INTEGER := 7;
    v_cumulative_draw BOOLEAN := true;
    v_force_draw BOOLEAN := true;
    v_play_immediately BOOLEAN := true;
    v_turn_timer INTEGER := 30;

    -- Variáveis de Estado
    v_deck TEXT[];
    v_discard_pile TEXT[];
    v_hands JSONB;
    v_active_color VARCHAR(15);
    v_active_value VARCHAR(15);
    v_direction INTEGER := 1;
    v_turn_order UUID[];
    v_current_turn_player_id UUID;
    v_pending_draws INTEGER := 0;
    v_winner_id UUID := NULL;
    v_is_finished BOOLEAN := false;

    -- Auxiliares de Inicialização
    v_raw_deck TEXT[];
    v_colors TEXT[] := ARRAY['red', 'blue', 'green', 'yellow'];
    v_values TEXT[] := ARRAY['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'];
    v_shuffled TEXT[];
    v_player_id UUID;
    v_player_hand JSONB;
    v_hand_cards TEXT[];
    v_draw_card TEXT;

    -- Auxiliares de Jogada
    v_card TEXT;
    v_choose_color VARCHAR(15);
    v_card_parts TEXT[];
    v_card_color VARCHAR(15);
    v_card_value VARCHAR(15);
    v_next_player_id UUID;
    v_new_state JSONB;
    v_steps INTEGER := 1;
    v_has_playable BOOLEAN;
    v_playable_card TEXT;
BEGIN
    -- 1. Ler ou Inicializar Configuração
    IF p_current_state ? 'config' THEN
        v_config := p_current_state->'config';
    ELSE
        -- Fallback de segurança para matchmaking público
        SELECT config INTO v_config FROM public.rooms r JOIN public.matches m ON m.room_id = r.id WHERE m.id = p_match_id;
        IF v_config IS NULL THEN
            v_config := '{}'::jsonb;
        END IF;
    END IF;

    v_initial_cards := COALESCE((v_config->>'initial_cards')::INTEGER, 7);
    v_cumulative_draw := COALESCE((v_config->>'cumulative_draw')::BOOLEAN, true);
    v_force_draw := COALESCE((v_config->>'force_draw')::BOOLEAN, true);
    v_play_immediately := COALESCE((v_config->>'play_immediately')::BOOLEAN, true);
    v_turn_timer := COALESCE((v_config->>'turn_timer')::INTEGER, 30);

    -- Impedir alteração de configurações de partida em andamento
    IF p_action_type = 'update_config' THEN
        RAISE EXCEPTION 'FORBIDDEN: Não é permitido alterar as configurações oficiais após o início da partida.' USING ERRCODE = 'P0071';
    END IF;

    -- 2. Montar Lista de Competidores ( slots 1 a 6 )
    SELECT array_agg(user_id ORDER BY slot ASC) INTO v_turn_order
    FROM public.match_players
    WHERE match_id = p_match_id;

    -- 3. INICIALIZAÇÃO AUTOMÁTICA (LAZY-INITIALIZATION) NO PRIMEIRO TURNO
    IF p_current_state IS NULL OR NOT (p_current_state ? 'deck') THEN
        -- Construir Baralho de 108 cartas
        v_raw_deck := ARRAY[]::TEXT[];
        FOREACH v_card_color IN ARRAY v_colors LOOP
            -- Um '0' por cor
            v_raw_deck := array_append(v_raw_deck, v_card_color || ':0');
            -- Dois de '1' a '9', skip, reverse, draw2 por cor
            FOR i IN 1..9 LOOP
                v_raw_deck := array_append(v_raw_deck, v_card_color || ':' || i);
                v_raw_deck := array_append(v_raw_deck, v_card_color || ':' || i);
            END LOOP;
            v_raw_deck := array_append(v_raw_deck, v_card_color || ':skip');
            v_raw_deck := array_append(v_raw_deck, v_card_color || ':skip');
            v_raw_deck := array_append(v_raw_deck, v_card_color || ':reverse');
            v_raw_deck := array_append(v_raw_deck, v_card_color || ':reverse');
            v_raw_deck := array_append(v_raw_deck, v_card_color || ':draw2');
            v_raw_deck := array_append(v_raw_deck, v_card_color || ':draw2');
        END LOOP;
        -- Quatro Wild Color e Quatro Wild Draw 4
        FOR i IN 1..4 LOOP
            v_raw_deck := array_append(v_raw_deck, 'wild:color');
            v_raw_deck := array_append(v_raw_deck, 'wild:draw4');
        END LOOP;

        -- Embaralhar Baralho (Shuffle)
        SELECT array_agg(card ORDER BY random()) INTO v_shuffled
        FROM unnest(v_raw_deck) AS card;

        -- Distribuir Mãos Iniciais
        v_hands := '{}'::jsonb;
        FOREACH v_player_id IN ARRAY v_turn_order LOOP
            v_hand_cards := ARRAY[]::TEXT[];
            FOR i IN 1..v_initial_cards LOOP
                v_hand_cards := array_append(v_hand_cards, v_shuffled[1]);
                v_shuffled := v_shuffled[2:array_length(v_shuffled, 1)];
            END LOOP;
            v_hands := v_hands || jsonb_build_object(v_player_id::text, to_jsonb(v_hand_cards));
        END LOOP;

        -- Puxar carta inicial do descarte que não seja Wild
        WHILE v_shuffled[1] LIKE 'wild:%' LOOP
            -- Re-insere no final e pega a próxima
            v_shuffled := array_append(v_shuffled, v_shuffled[1]);
            v_shuffled := v_shuffled[2:array_length(v_shuffled, 1)];
        END LOOP;

        v_card := v_shuffled[1];
        v_shuffled := v_shuffled[2:array_length(v_shuffled, 1)];

        v_card_parts := string_to_array(v_card, ':');
        v_active_color := v_card_parts[1];
        v_active_value := v_card_parts[2];

        v_deck := v_shuffled;
        v_discard_pile := ARRAY[v_card];
        v_direction := 1;
        v_current_turn_player_id := v_turn_order[1];
        v_pending_draws := 0;
        v_winner_id := NULL;
        v_is_finished := false;

        -- Se a primeira carta descartada já tiver efeito imediato
        IF v_active_value = 'skip' THEN
            -- Primeiro jogador é pulado, turno começa no segundo
            v_current_turn_player_id := public.get_next_carta_duo_player_id(v_current_turn_player_id, v_turn_order, v_direction, 1);
        ELSIF v_active_value = 'reverse' THEN
            -- Direção invertida
            v_direction := -1;
            IF array_length(v_turn_order, 1) = 2 THEN
                -- Em 2 jogadores, reverse pula o primeiro jogador
                v_current_turn_player_id := public.get_next_carta_duo_player_id(v_current_turn_player_id, v_turn_order, 1, 1);
            ELSE
                v_current_turn_player_id := public.get_next_carta_duo_player_id(v_turn_order[1], v_turn_order, v_direction, 0);
            END IF;
        ELSIF v_active_value = 'draw2' THEN
            -- Acumula 2 cartas para o primeiro jogador
            v_pending_draws := 2;
        END IF;

    ELSE
        -- Reidratar Estado Existente
        SELECT COALESCE(array_agg(card), ARRAY[]::TEXT[]) INTO v_deck FROM jsonb_array_elements_text(p_current_state->'deck') AS card;
        SELECT COALESCE(array_agg(card), ARRAY[]::TEXT[]) INTO v_discard_pile FROM jsonb_array_elements_text(p_current_state->'discard_pile') AS card;
        v_hands := p_current_state->'hands';
        v_active_color := p_current_state->>'active_color';
        v_active_value := p_current_state->>'active_value';
        v_direction := (p_current_state->>'direction')::INTEGER;
        v_current_turn_player_id := (p_current_state->>'current_turn_player_id')::UUID;
        v_pending_draws := COALESCE((p_current_state->>'pending_draws')::INTEGER, 0);
        v_winner_id := (p_current_state->>'winner_id')::UUID;
        v_is_finished := COALESCE((p_current_state->>'is_finished')::BOOLEAN, false);
    END IF;

    -- 4. VALIDAR SE O JOGO JÁ FOI CONCLUÍDO
    IF v_is_finished THEN
        RAISE EXCEPTION 'MATCH_FINISHED: A partida já foi encerrada.' USING ERRCODE = 'P0017';
    END IF;

    -- 5. VALIDAR TURNO DO JOGADOR CHAMADOR
    IF p_player_id <> v_current_turn_player_id THEN
        RAISE EXCEPTION 'NOT_YOUR_TURN: Não é o seu turno de jogar.' USING ERRCODE = 'P0019';
    END IF;

    -- 6. PROCESSAMENTO DE AÇÃO: JOGAR CARTA (play_card)
    IF p_action_type = 'play_card' THEN
        IF NOT (p_payload ? 'card') THEN
            RAISE EXCEPTION 'INVALID_CARD: A carta a ser jogada é obrigatória.' USING ERRCODE = 'P0072';
        END IF;
        v_card := p_payload->>'card';

        -- Verificar se a carta pertence à mão do jogador
        SELECT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_hands->p_player_id::text) AS c WHERE c = v_card
        ) INTO v_has_playable;

        IF NOT v_has_playable THEN
            RAISE EXCEPTION 'CARD_NOT_IN_HAND: A carta % não pertence à sua mão.', v_card USING ERRCODE = 'P0073';
        END IF;

        v_card_parts := string_to_array(v_card, ':');
        v_card_color := v_card_parts[1];
        v_card_value := v_card_parts[2];

        -- Validar correspondência de cor/número/símbolo ou Wild
        IF v_pending_draws > 0 THEN
            -- Se há compras pendentes acumuladas, o jogador deve rebater com carta de compra (+2 ou +4) ou sofrer as consequências
            IF v_cumulative_draw THEN
                IF v_card_value <> 'draw2' AND v_card_value <> 'draw4' THEN
                    RAISE EXCEPTION 'CUMULATIVE_DRAW_REQUIRED: Você deve responder com um Draw 2 ou Wild Draw 4 para repassar o acúmulo.' USING ERRCODE = 'P0074';
                END IF;
            ELSE
                RAISE EXCEPTION 'DRAW_REQUIRED: Você deve comprar as cartas pendentes primeiro.' USING ERRCODE = 'P0074';
            END IF;
        ELSE
            -- Regras de descarte normal
            IF v_card_color <> 'wild' AND v_card_color <> v_active_color AND v_card_value <> v_active_value THEN
                RAISE EXCEPTION 'INVALID_CARD_PLAY: A carta % não pode ser descartada sobre a cor % ou valor %.', v_card, v_active_color, v_active_value USING ERRCODE = 'P0075';
            END IF;
        END IF;

        -- Tratar escolha de cor para cartas Wild
        IF v_card_color = 'wild' THEN
            IF NOT (p_payload ? 'choose_color') THEN
                RAISE EXCEPTION 'COLOR_CHOICE_REQUIRED: Você deve escolher uma nova cor ativa para a carta Wild.' USING ERRCODE = 'P0076';
            END IF;
            v_choose_color := p_payload->>'choose_color';
            IF v_choose_color NOT IN ('red', 'blue', 'green', 'yellow') THEN
                RAISE EXCEPTION 'INVALID_COLOR_CHOICE: Cor selecionada inválida.' USING ERRCODE = 'P0076';
            END IF;
            v_active_color := v_choose_color;
        ELSE
            v_active_color := v_card_color;
        END IF;

        v_active_value := v_card_value;

        -- Remover a carta da mão do jogador
        SELECT jsonb_agg(c) INTO v_player_hand
        FROM (
            SELECT c, row_number() OVER () AS r
            FROM jsonb_array_elements_text(v_hands->p_player_id::text) AS c
        ) q
        WHERE NOT (c = v_card AND r = (
            SELECT min(r) FROM (
                SELECT c as xc, row_number() OVER () AS r
                FROM jsonb_array_elements_text(v_hands->p_player_id::text) AS c
            ) x WHERE xc = v_card
        ));

        IF v_player_hand IS NULL THEN
            v_player_hand := '[]'::jsonb;
        END IF;

        v_hands := v_hands || jsonb_build_object(p_player_id::text, v_player_hand);

        -- Inserir no descarte
        v_discard_pile := array_append(v_discard_pile, v_card);

        -- Aplicar Efeitos Especiais
        v_steps := 1;
        IF v_card_value = 'skip' THEN
            v_steps := 2;
        ELSIF v_card_value = 'reverse' THEN
            v_direction := v_direction * -1;
            IF array_length(v_turn_order, 1) = 2 THEN
                -- Em 2 jogadores, reverse pula o oponente e volta para o mesmo jogador
                v_steps := 2;
            END IF;
        ELSIF v_card_value = 'draw2' THEN
            v_pending_draws := v_pending_draws + 2;
        ELSIF v_card_value = 'draw4' THEN
            v_pending_draws := v_pending_draws + 4;
        END IF;

        -- Verificar Condição de Vitória (Mão Vazia)
        IF jsonb_array_length(v_player_hand) = 0 THEN
            v_winner_id := p_player_id;
            v_is_finished := true;
            v_current_turn_player_id := NULL;
        ELSE
            -- Avançar Turno
            v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, v_steps);
        END IF;

    -- 7. PROCESSAMENTO DE AÇÃO: COMPRAR CARTA (draw_card)
    ELSIF p_action_type = 'draw_card' THEN
        -- Garantir que haja cartas no deck, se não houver, reidratar reciclando o descarte
        IF array_length(v_deck, 1) IS NULL OR array_length(v_deck, 1) < 5 THEN
            -- Reciclar cartas do descarte (exceto a última jogada)
            SELECT array_agg(card ORDER BY random()) INTO v_shuffled
            FROM unnest(v_discard_pile[1:array_length(v_discard_pile, 1) - 1]) AS card;
            v_deck := array_cat(v_deck, v_shuffled);
            v_discard_pile := ARRAY[v_discard_pile[array_length(v_discard_pile, 1)]];
        END IF;

        IF v_pending_draws > 0 THEN
            -- O jogador deve comprar todo o acúmulo de cartas pendentes e perder a vez
            v_hand_cards := ARRAY[]::TEXT[];
            SELECT COALESCE(array_agg(c), ARRAY[]::TEXT[]) INTO v_hand_cards FROM jsonb_array_elements_text(v_hands->p_player_id::text) AS c;

            FOR i IN 1..v_pending_draws LOOP
                v_draw_card := v_deck[1];
                v_deck := v_deck[2:array_length(v_deck, 1)];
                v_hand_cards := array_append(v_hand_cards, v_draw_card);
            END LOOP;

            v_hands := v_hands || jsonb_build_object(p_player_id::text, to_jsonb(v_hand_cards));
            v_pending_draws := 0;

            -- Perde a vez automaticamente ao comprar acúmulo
            v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);
        ELSE
            -- Compra de 1 carta única por vontade ou por falta de opção
            IF NOT v_force_draw THEN
                -- Validar se o jogador realmente não tinha jogada válida se a regra proibir compra indevida
                v_has_playable := false;
                FOR v_card IN SELECT jsonb_array_elements_text(v_hands->p_player_id::text) LOOP
                    v_card_parts := string_to_array(v_card, ':');
                    v_card_color := v_card_parts[1];
                    v_card_value := v_card_parts[2];
                    IF v_card_color = 'wild' OR v_card_color = v_active_color OR v_card_value = v_active_value THEN
                        v_has_playable := true;
                    END IF;
                END LOOP;

                IF v_has_playable THEN
                    RAISE EXCEPTION 'PLAYABLE_CARD_IN_HAND: Você possui jogadas válidas na sua mão e não pode comprar sob a configuração atual.' USING ERRCODE = 'P0077';
                END IF;
            END IF;

            -- Executar Compra de 1 Carta
            v_draw_card := v_deck[1];
            v_deck := v_deck[2:array_length(v_deck, 1)];

            SELECT COALESCE(array_agg(c), ARRAY[]::TEXT[]) INTO v_hand_cards FROM jsonb_array_elements_text(v_hands->p_player_id::text) AS c;
            v_hand_cards := array_append(v_hand_cards, v_draw_card);
            v_hands := v_hands || jsonb_build_object(p_player_id::text, to_jsonb(v_hand_cards));

            -- Se permitir jogar imediatamente, e a carta comprada for válida
            v_card_parts := string_to_array(v_draw_card, ':');
            v_card_color := v_card_parts[1];
            v_card_value := v_card_parts[2];

            v_has_playable := (v_card_color = 'wild' OR v_card_color = v_active_color OR v_card_value = v_active_value);

            IF v_play_immediately AND v_has_playable THEN
                -- Permanece no turno do jogador para ele decidir se joga ou passa
                -- Criamos um marcador no estado para registrar que ele comprou mas tem a opção
                -- Para manter limpo, deixamos a vez com ele. Se ele decidir passar, chamará 'end_turn'
            ELSE
                -- Avança o turno automaticamente se não puder jogar imediatamente
                v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);
            END IF;
        END IF;

    -- 8. PROCESSAMENTO DE AÇÃO: ENCERRAR TURNO VOLUNTARIAMENTE (end_turn)
    ELSIF p_action_type = 'end_turn' THEN
        -- Permitido apenas após uma compra de carta única sem descarte
        v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);

    ELSE
        RAISE EXCEPTION 'INVALID_ACTION_TYPE: Tipo de ação % desconhecido para o Carta Duo.', p_action_type USING ERRCODE = 'P0034';
    END IF;

    -- 9. Sincronizar Placar dos Jogadores em match_players com a contagem de cartas restante
    FOREACH v_player_id IN ARRAY v_turn_order LOOP
        UPDATE public.match_players
        SET score = jsonb_array_length(v_hands->v_player_id::text)
        WHERE match_id = p_match_id AND user_id = v_player_id;
    END LOOP;

    -- 10. Compilar o novo game_state oficial
    v_new_state := jsonb_build_object(
        'config', v_config,
        'deck', to_jsonb(v_deck),
        'discard_pile', to_jsonb(v_discard_pile),
        'hands', v_hands,
        'active_color', v_active_color,
        'active_value', v_active_value,
        'direction', v_direction,
        'turn_order', to_jsonb(v_turn_order),
        'current_turn_player_id', v_current_turn_player_id,
        'pending_draws', v_pending_draws,
        'winner_id', v_winner_id,
        'is_finished', v_is_finished
    );

    RETURN jsonb_build_object(
        'accepted', true,
        'new_state', v_new_state,
        'next_player_id', v_current_turn_player_id,
        'winner_id', v_winner_id,
        'is_draw', false,
        'is_finished', v_is_finished
    );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_carta_duo_action(UUID, UUID, VARCHAR, JSONB, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Registro do Carta Duo no Despachador de Ações (dispatch_game_action)
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
    ELSE
        RAISE EXCEPTION 'GAME_VALIDATOR_NOT_AVAILABLE: As regras deste jogo ainda não estão disponíveis no servidor para validar esta ação.' USING ERRCODE = 'P0030';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_game_action(VARCHAR, UUID, UUID, VARCHAR, JSONB, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
