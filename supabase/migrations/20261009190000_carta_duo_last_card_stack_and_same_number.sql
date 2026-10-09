-- ============================================================================
-- Migration: 20261009190000_carta_duo_last_card_stack_and_same_number.sql
-- Project: DuoPlay-Online
-- Phase: Carta Duo — Regras de Acúmulo (+2/+4), Múltiplas Cartas e Última Carta
-- Description:
--   1. Suporte a "Última Carta" com declaração explícita (declare_last_card)
--      e contestação autoritativa (challenge_last_card) com penalidade de +2 cartas.
--   2. Acúmulo de +2 e +4 (cumulative_draw):
--      - Quando ativado: qualquer jogador que receba penalidade de compra pode
--        acumular com outro +2 ou +4 compatível, passando o acúmulo adiante.
--      - Encerramento voluntário (accept_penalty) compra o total acumulado e passa o turno.
--      - Quando desativado: compra imediata sem acúmulo e turno pulado.
--   3. Múltiplas cartas do mesmo número (allow_same_number):
--      - Quando ativado: permite jogar sequências de cartas com mesmo número
--        (independentemente da cor) no mesmo turno.
--      - Encerramento voluntário da sequência (end_sequence).
--      - Quando desativado: estritamente 1 carta por turno.
--   4. Congelamento e aplicação estrita das configurações da sala na partida.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Inicializador Oficial Atualizado do Carta Duo
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.initialize_carta_duo_state_for_players(
    p_player_ids UUID[],
    p_config JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_initial_cards INTEGER;
    v_cumulative_draw BOOLEAN;
    v_allow_same_number BOOLEAN;
    v_raw_deck TEXT[] := ARRAY[]::TEXT[];
    v_colors TEXT[] := ARRAY['red', 'blue', 'green', 'yellow'];
    v_shuffled TEXT[];
    v_hands JSONB := '{}'::jsonb;
    v_hand_cards TEXT[];
    v_discard_pile TEXT[];
    v_card TEXT;
    v_card_parts TEXT[];
    v_active_color VARCHAR(15);
    v_active_value VARCHAR(15);
    v_direction INTEGER := 1;
    v_current_turn_player_id UUID;
    v_pending_draws INTEGER := 0;
    v_player_id UUID;
    v_card_color TEXT;
    v_first_player_id UUID;
    i INTEGER;
BEGIN
    v_initial_cards := COALESCE((p_config->>'initial_cards')::INTEGER, 7);
    v_cumulative_draw := COALESCE((p_config->>'cumulative_draw')::BOOLEAN, true);
    v_allow_same_number := COALESCE((p_config->>'allow_same_number')::BOOLEAN, false);

    -- Construir baralho clássico de 108 cartas
    FOREACH v_card_color IN ARRAY v_colors LOOP
        v_raw_deck := array_append(v_raw_deck, v_card_color || ':0');
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
    FOR i IN 1..4 LOOP
        v_raw_deck := array_append(v_raw_deck, 'wild:color');
        v_raw_deck := array_append(v_raw_deck, 'wild:draw4');
    END LOOP;

    -- Embaralhar aleatoriamente
    SELECT array_agg(card ORDER BY random()) INTO v_shuffled
    FROM unnest(v_raw_deck) AS card;

    -- Distribuir cartas para cada jogador
    IF p_player_ids IS NOT NULL THEN
        FOREACH v_player_id IN ARRAY p_player_ids LOOP
            v_hand_cards := ARRAY[]::TEXT[];
            FOR i IN 1..v_initial_cards LOOP
                IF array_length(v_shuffled, 1) > 0 THEN
                    v_hand_cards := array_append(v_hand_cards, v_shuffled[1]);
                    v_shuffled := v_shuffled[2:array_length(v_shuffled, 1)];
                END IF;
            END LOOP;
            v_hands := v_hands || jsonb_build_object(v_player_id::text, to_jsonb(v_hand_cards));
        END LOOP;
    END IF;

    -- Puxar primeira carta de descarte que não seja Wild
    WHILE array_length(v_shuffled, 1) > 0 AND v_shuffled[1] LIKE 'wild:%' LOOP
        v_shuffled := array_append(v_shuffled, v_shuffled[1]);
        v_shuffled := v_shuffled[2:array_length(v_shuffled, 1)];
    END LOOP;

    IF array_length(v_shuffled, 1) > 0 THEN
        v_card := v_shuffled[1];
        v_shuffled := v_shuffled[2:array_length(v_shuffled, 1)];
    ELSE
        v_card := 'red:0';
    END IF;

    v_card_parts := string_to_array(v_card, ':');
    v_active_color := COALESCE(v_card_parts[1], 'red');
    v_active_value := COALESCE(v_card_parts[2], '0');

    v_discard_pile := ARRAY[v_card];
    v_first_player_id := p_player_ids[1];
    v_current_turn_player_id := v_first_player_id;

    -- Efeito inicial da primeira carta de descarte
    IF v_active_value = 'skip' AND array_length(p_player_ids, 1) > 1 THEN
        v_current_turn_player_id := public.get_next_carta_duo_player_id(v_first_player_id, p_player_ids, v_direction, 1);
    ELSIF v_active_value = 'reverse' THEN
        v_direction := -1;
        IF array_length(p_player_ids, 1) = 2 THEN
            v_current_turn_player_id := public.get_next_carta_duo_player_id(v_first_player_id, p_player_ids, 1, 1);
        ELSIF array_length(p_player_ids, 1) > 2 THEN
            v_current_turn_player_id := public.get_next_carta_duo_player_id(v_first_player_id, p_player_ids, v_direction, 0);
        END IF;
    ELSIF v_active_value = 'draw2' THEN
        IF v_cumulative_draw THEN
            v_pending_draws := 2;
        ELSE
            -- Sem acúmulo: primeiro jogador compra 2 cartas e perde a vez
            IF array_length(v_shuffled, 1) >= 2 THEN
                v_hand_cards := ARRAY[v_shuffled[1], v_shuffled[2]];
                v_shuffled := v_shuffled[3:array_length(v_shuffled, 1)];
            ELSE
                v_hand_cards := ARRAY[]::TEXT[];
            END IF;
            v_hands := v_hands || jsonb_build_object(
                v_first_player_id::text,
                to_jsonb(ARRAY(SELECT jsonb_array_elements_text(v_hands->(v_first_player_id::text))) || v_hand_cards)
            );
            v_current_turn_player_id := public.get_next_carta_duo_player_id(v_first_player_id, p_player_ids, v_direction, 1);
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'config', p_config,
        'deck', to_jsonb(v_shuffled),
        'discard_pile', to_jsonb(v_discard_pile),
        'top_card', v_discard_pile[1],
        'hands', v_hands,
        'active_color', v_active_color,
        'active_value', v_active_value,
        'direction', v_direction,
        'turn_order', to_jsonb(p_player_ids),
        'current_turn_player_id', v_current_turn_player_id,
        'pending_draws', v_pending_draws,
        'same_number_sequence', jsonb_build_object('active', false, 'player_id', NULL, 'number', NULL),
        'last_card_declarations', '{}'::jsonb,
        'winner_id', NULL,
        'is_finished', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_carta_duo_state_for_players(UUID[], JSONB) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Validador Oficial de Ações do Carta Duo (validate_carta_duo_action)
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
    v_config JSONB;
    v_initial_cards INTEGER := 7;
    v_cumulative_draw BOOLEAN := true;
    v_allow_same_number BOOLEAN := false;
    v_turn_timer INTEGER := 30;

    v_deck TEXT[];
    v_discard_pile TEXT[];
    v_hands JSONB;
    v_active_color VARCHAR(15);
    v_active_value VARCHAR(15);
    v_direction INTEGER := 1;
    v_turn_order UUID[];
    v_current_turn_player_id UUID;
    v_pending_draws INTEGER := 0;
    v_same_number_sequence JSONB;
    v_last_card_declarations JSONB;
    v_winner_id UUID := NULL;
    v_is_finished BOOLEAN := false;

    v_card TEXT;
    v_choose_color VARCHAR(15);
    v_card_parts TEXT[];
    v_card_color VARCHAR(15);
    v_card_value VARCHAR(15);
    v_target_id UUID;
    v_penalized_player_id UUID;
    v_penalty_cards_count INTEGER := 0;
    v_new_state JSONB;
    v_player_id UUID;
    v_draw_card TEXT;
    v_hand_cards TEXT[];
    v_remaining_matching_count INTEGER := 0;
    i INTEGER;
BEGIN
    -- 1. Bloquear tentativas espúrias de passar turno
    IF p_action_type = 'pass_turn' OR p_action_type = 'skip_turn' THEN
        RAISE EXCEPTION 'ACTION_NOT_ALLOWED: No Carta Duo não existe ação de passar turno. Jogue uma carta válida, compre do baralho ou encerre sua sequência.' USING ERRCODE = 'P0078';
    END IF;

    -- 2. Obter configurações congeladas da partida
    IF p_current_state ? 'config' THEN
        v_config := p_current_state->'config';
    ELSE
        SELECT coalesce(m.config, r.config, '{}'::jsonb) INTO v_config
        FROM public.matches m
        LEFT JOIN public.rooms r ON r.id = m.room_id
        WHERE m.id = p_match_id;
    END IF;

    v_config := coalesce(v_config, '{}'::jsonb);
    v_initial_cards := COALESCE((v_config->>'initial_cards')::INTEGER, 7);
    v_cumulative_draw := COALESCE((v_config->>'cumulative_draw')::BOOLEAN, true);
    v_allow_same_number := COALESCE((v_config->>'allow_same_number')::BOOLEAN, false);
    v_turn_timer := COALESCE((v_config->>'turn_timer')::INTEGER, 30);

    IF p_action_type = 'update_config' THEN
        RAISE EXCEPTION 'FORBIDDEN: Não é permitido alterar as configurações oficiais após o início da partida.' USING ERRCODE = 'P0071';
    END IF;

    -- 3. Lista de competidores ordenada por slot
    SELECT array_agg(user_id ORDER BY slot ASC) INTO v_turn_order
    FROM public.match_players
    WHERE match_id = p_match_id;

    -- 4. Reidratar ou Inicializar Estado
    IF p_current_state IS NULL OR NOT (p_current_state ? 'deck') THEN
        v_new_state := public.initialize_carta_duo_state_for_players(v_turn_order, v_config);
        v_deck := ARRAY(SELECT jsonb_array_elements_text(v_new_state->'deck'));
        v_discard_pile := ARRAY(SELECT jsonb_array_elements_text(v_new_state->'discard_pile'));
        v_hands := v_new_state->'hands';
        v_active_color := v_new_state->>'active_color';
        v_active_value := v_new_state->>'active_value';
        v_direction := (v_new_state->>'direction')::INTEGER;
        v_current_turn_player_id := (v_new_state->>'current_turn_player_id')::UUID;
        v_pending_draws := COALESCE((v_new_state->>'pending_draws')::INTEGER, 0);
        v_same_number_sequence := COALESCE(v_new_state->'same_number_sequence', jsonb_build_object('active', false, 'player_id', NULL, 'number', NULL));
        v_last_card_declarations := COALESCE(v_new_state->'last_card_declarations', '{}'::jsonb);
        v_winner_id := NULL;
        v_is_finished := false;
    ELSE
        v_deck := ARRAY(SELECT jsonb_array_elements_text(p_current_state->'deck'));
        v_discard_pile := ARRAY(SELECT jsonb_array_elements_text(p_current_state->'discard_pile'));
        v_hands := p_current_state->'hands';
        v_active_color := p_current_state->>'active_color';
        v_active_value := p_current_state->>'active_value';
        v_direction := COALESCE((p_current_state->>'direction')::INTEGER, 1);
        v_current_turn_player_id := (p_current_state->>'current_turn_player_id')::UUID;
        v_pending_draws := COALESCE((p_current_state->>'pending_draws')::INTEGER, 0);
        v_same_number_sequence := COALESCE(p_current_state->'same_number_sequence', jsonb_build_object('active', false, 'player_id', NULL, 'number', NULL));
        v_last_card_declarations := COALESCE(p_current_state->'last_card_declarations', '{}'::jsonb);
        v_winner_id := (p_current_state->>'winner_id')::UUID;
        v_is_finished := COALESCE((p_current_state->>'is_finished')::BOOLEAN, false);
    END IF;

    IF v_is_finished THEN
        RAISE EXCEPTION 'MATCH_FINISHED: A partida já foi encerrada.' USING ERRCODE = 'P0017';
    END IF;

    -- ========================================================================
    -- AÇÃO 1: DECLARAR ÚLTIMA CARTA (declare_last_card)
    -- ========================================================================
    IF p_action_type = 'declare_last_card' THEN
        -- Elegibilidade: o jogador deve possuir 1 ou 2 cartas na mão (para declarar ao jogar ou logo após)
        IF jsonb_array_length(v_hands->(p_player_id::text)) > 2 THEN
            RAISE EXCEPTION 'NOT_ELIGIBLE_FOR_LAST_CARD: Você só pode declarar Última Carta quando estiver prestes a ficar ou estiver com apenas 1 carta.' USING ERRCODE = 'P0079';
        END IF;

        v_last_card_declarations := v_last_card_declarations || jsonb_build_object(p_player_id::text, true);

        v_new_state := jsonb_build_object(
            'deck', to_jsonb(COALESCE(v_deck, ARRAY[]::TEXT[])),
            'discard_pile', to_jsonb(COALESCE(v_discard_pile, ARRAY[]::TEXT[])),
            'top_card', v_discard_pile[1],
            'hands', v_hands,
            'active_color', v_active_color,
            'active_value', v_active_value,
            'direction', v_direction,
            'turn_order', to_jsonb(v_turn_order),
            'current_turn_player_id', v_current_turn_player_id,
            'pending_draws', v_pending_draws,
            'same_number_sequence', v_same_number_sequence,
            'last_card_declarations', v_last_card_declarations,
            'winner_id', v_winner_id,
            'is_finished', v_is_finished,
            'config', v_config
        );

        RETURN jsonb_build_object(
            'accepted', true,
            'new_state', v_new_state,
            'next_player_id', v_current_turn_player_id,
            'winner_id', v_winner_id,
            'is_draw', false,
            'is_finished', v_is_finished
        );
    END IF;

    -- ========================================================================
    -- AÇÃO 2: CONTESTAR ÚLTIMA CARTA (challenge_last_card)
    -- ========================================================================
    IF p_action_type = 'challenge_last_card' THEN
        v_target_id := (p_payload->>'target_player_id')::UUID;
        IF v_target_id IS NULL OR NOT (v_turn_order @> ARRAY[v_target_id]) THEN
            RAISE EXCEPTION 'INVALID_TARGET: Jogador alvo da contestação é inválido.' USING ERRCODE = 'P0080';
        END IF;

        IF jsonb_array_length(v_hands->(v_target_id::text)) <> 1 THEN
            RAISE EXCEPTION 'CANNOT_CHALLENGE: O jogador alvo não possui exatamente 1 carta.' USING ERRCODE = 'P0081';
        END IF;

        IF COALESCE((v_last_card_declarations->>(v_target_id::text))::BOOLEAN, false) = true THEN
            RAISE EXCEPTION 'ALREADY_DECLARED: O jogador alvo declarou Última Carta corretamente e não pode ser penalizado.' USING ERRCODE = 'P0082';
        END IF;

        -- Penalidade: o jogador alvo compra 2 cartas por não ter declarado
        FOR i IN 1..2 LOOP
            IF array_length(v_deck, 1) IS NULL OR array_length(v_deck, 1) = 0 THEN
                IF array_length(v_discard_pile, 1) > 1 THEN
                    DECLARE
                        v_top_card TEXT := v_discard_pile[1];
                        v_recycle TEXT[] := v_discard_pile[2:array_length(v_discard_pile, 1)];
                    BEGIN
                        SELECT array_agg(card ORDER BY random()) INTO v_deck
                        FROM unnest(v_recycle) AS card;
                        v_discard_pile := ARRAY[v_top_card];
                    END;
                END IF;
            END IF;

            IF array_length(v_deck, 1) > 0 THEN
                v_draw_card := v_deck[1];
                v_deck := v_deck[2:array_length(v_deck, 1)];

                SELECT COALESCE(array_agg(c), ARRAY[]::TEXT[]) INTO v_hand_cards
                FROM jsonb_array_elements_text(v_hands->(v_target_id::text)) AS c;

                v_hand_cards := array_append(v_hand_cards, v_draw_card);
                v_hands := v_hands || jsonb_build_object(v_target_id::text, to_jsonb(v_hand_cards));
            END IF;
        END LOOP;

        v_last_card_declarations := v_last_card_declarations || jsonb_build_object(v_target_id::text, false);

        -- Atualizar score
        UPDATE public.match_players
        SET score = jsonb_array_length(v_hands->(v_target_id::text))
        WHERE match_id = p_match_id AND user_id = v_target_id;

        v_new_state := jsonb_build_object(
            'deck', to_jsonb(COALESCE(v_deck, ARRAY[]::TEXT[])),
            'discard_pile', to_jsonb(COALESCE(v_discard_pile, ARRAY[]::TEXT[])),
            'top_card', v_discard_pile[1],
            'hands', v_hands,
            'active_color', v_active_color,
            'active_value', v_active_value,
            'direction', v_direction,
            'turn_order', to_jsonb(v_turn_order),
            'current_turn_player_id', v_current_turn_player_id,
            'pending_draws', v_pending_draws,
            'same_number_sequence', v_same_number_sequence,
            'last_card_declarations', v_last_card_declarations,
            'winner_id', v_winner_id,
            'is_finished', v_is_finished,
            'config', v_config
        );

        RETURN jsonb_build_object(
            'accepted', true,
            'new_state', v_new_state,
            'next_player_id', v_current_turn_player_id,
            'winner_id', v_winner_id,
            'is_draw', false,
            'is_finished', v_is_finished
        );
    END IF;

    -- Para as demais ações, o chamador DEVE ser o jogador do turno atual
    IF p_player_id <> v_current_turn_player_id THEN
        RAISE EXCEPTION 'NOT_YOUR_TURN: Não é o seu turno de jogar.' USING ERRCODE = 'P0019';
    END IF;

    -- ========================================================================
    -- AÇÃO 3: ENCERRAR SEQUÊNCIA DE MESMO NÚMERO (end_sequence)
    -- ========================================================================
    IF p_action_type = 'end_sequence' THEN
        IF COALESCE((v_same_number_sequence->>'active')::BOOLEAN, false) = false OR
           (v_same_number_sequence->>'player_id')::UUID <> p_player_id THEN
            RAISE EXCEPTION 'NO_ACTIVE_SEQUENCE: Não há sequência de cartas ativas para encerrar.' USING ERRCODE = 'P0083';
        END IF;

        -- Encerra a sequência de cartas iguais e avança o turno para o próximo jogador
        v_same_number_sequence := jsonb_build_object('active', false, 'player_id', NULL, 'number', NULL);
        v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);

    -- ========================================================================
    -- AÇÃO 4: RECEBER PENALIDADE ACUMULADA (accept_penalty)
    -- ========================================================================
    ELSIF p_action_type = 'accept_penalty' THEN
        IF v_pending_draws <= 0 THEN
            RAISE EXCEPTION 'NO_PENDING_PENALTY: Não há penalidade de compra pendente para aceitar.' USING ERRCODE = 'P0084';
        END IF;

        -- Comprar todas as cartas acumuladas
        FOR i IN 1..v_pending_draws LOOP
            IF array_length(v_deck, 1) IS NULL OR array_length(v_deck, 1) = 0 THEN
                IF array_length(v_discard_pile, 1) > 1 THEN
                    DECLARE
                        v_top_card TEXT := v_discard_pile[1];
                        v_recycle TEXT[] := v_discard_pile[2:array_length(v_discard_pile, 1)];
                    BEGIN
                        SELECT array_agg(card ORDER BY random()) INTO v_deck
                        FROM unnest(v_recycle) AS card;
                        v_discard_pile := ARRAY[v_top_card];
                    END;
                END IF;
            END IF;

            IF array_length(v_deck, 1) > 0 THEN
                v_draw_card := v_deck[1];
                v_deck := v_deck[2:array_length(v_deck, 1)];

                SELECT COALESCE(array_agg(c), ARRAY[]::TEXT[]) INTO v_hand_cards
                FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c;

                v_hand_cards := array_append(v_hand_cards, v_draw_card);
                v_hands := v_hands || jsonb_build_object(p_player_id::text, to_jsonb(v_hand_cards));
            END IF;
        END LOOP;

        v_pending_draws := 0;
        -- Perde a vez após receber a penalidade
        v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);

    -- ========================================================================
    -- AÇÃO 5: COMPRAR CARTA DO BARALHO (draw_card)
    -- ========================================================================
    ELSIF p_action_type = 'draw_card' THEN
        -- Se estiver em sequência de mesmo número, não pode comprar; deve encerrar a sequência
        IF COALESCE((v_same_number_sequence->>'active')::BOOLEAN, false) = true THEN
            RAISE EXCEPTION 'IN_SEQUENCE: Encerre a sequência de cartas antes de comprar do baralho.' USING ERRCODE = 'P0085';
        END IF;

        -- Se houver penalidade pendente, comprar funciona como aceitar a penalidade
        IF v_pending_draws > 0 THEN
            v_penalty_cards_count := v_pending_draws;
            v_pending_draws := 0;
        ELSE
            v_penalty_cards_count := 1;
        END IF;

        FOR i IN 1..v_penalty_cards_count LOOP
            IF array_length(v_deck, 1) IS NULL OR array_length(v_deck, 1) = 0 THEN
                IF array_length(v_discard_pile, 1) > 1 THEN
                    DECLARE
                        v_top_card TEXT := v_discard_pile[1];
                        v_recycle TEXT[] := v_discard_pile[2:array_length(v_discard_pile, 1)];
                    BEGIN
                        SELECT array_agg(card ORDER BY random()) INTO v_deck
                        FROM unnest(v_recycle) AS card;
                        v_discard_pile := ARRAY[v_top_card];
                    END;
                END IF;
            END IF;

            IF array_length(v_deck, 1) > 0 THEN
                v_draw_card := v_deck[1];
                v_deck := v_deck[2:array_length(v_deck, 1)];

                SELECT COALESCE(array_agg(c), ARRAY[]::TEXT[]) INTO v_hand_cards
                FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c;

                v_hand_cards := array_append(v_hand_cards, v_draw_card);
                v_hands := v_hands || jsonb_build_object(p_player_id::text, to_jsonb(v_hand_cards));
            END IF;
        END LOOP;

        -- Avança o turno para o próximo jogador
        v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);

    -- ========================================================================
    -- AÇÃO 6: JOGAR CARTA (play_card)
    -- ========================================================================
    ELSIF p_action_type = 'play_card' THEN
        v_card := p_payload->>'card';
        IF v_card IS NULL THEN
            RAISE EXCEPTION 'INVALID_PAYLOAD: Campo card é obrigatório.' USING ERRCODE = 'P0072';
        END IF;

        IF NOT (v_hands->(p_player_id::text) @> to_jsonb(v_card)) THEN
            RAISE EXCEPTION 'CARD_NOT_IN_HAND: A carta informada não está na mão do jogador.' USING ERRCODE = 'P0073';
        END IF;

        v_card_parts := string_to_array(v_card, ':');
        v_card_color := v_card_parts[1];
        v_card_value := v_card_parts[2];

        -- --------------------------------------------------------------------
        -- CENÁRIO A: Jogador está em sequência de cartas com o mesmo número
        -- --------------------------------------------------------------------
        IF COALESCE((v_same_number_sequence->>'active')::BOOLEAN, false) = true THEN
            IF (v_same_number_sequence->>'player_id')::UUID <> p_player_id THEN
                RAISE EXCEPTION 'NOT_YOUR_SEQUENCE: Sequência de jogada pertence a outro jogador.' USING ERRCODE = 'P0086';
            END IF;

            IF v_card_value <> (v_same_number_sequence->>'number') THEN
                RAISE EXCEPTION 'SAME_NUMBER_REQUIRED: A carta deve possuir o mesmo número (%) da sequência atual.' , (v_same_number_sequence->>'number') USING ERRCODE = 'P0087';
            END IF;

            -- Remover a carta da mão
            SELECT COALESCE(array_agg(c), ARRAY[]::TEXT[]) INTO v_hand_cards
            FROM (
                SELECT c, row_number() OVER () AS rn
                FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c
            ) sub
            WHERE NOT (c = v_card AND rn = (
                SELECT min(rn) FROM (
                    SELECT c2, row_number() OVER () AS rn 
                    FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c2
                ) s2 WHERE c2 = v_card
            ));

            v_hands := v_hands || jsonb_build_object(p_player_id::text, to_jsonb(COALESCE(v_hand_cards, ARRAY[]::TEXT[])));
            v_discard_pile := array_prepend(v_card, v_discard_pile);

            -- Atualiza a cor ativa para a cor da carta jogada na sequência
            IF v_card_color <> 'wild' THEN
                v_active_color := v_card_color;
            END IF;
            v_active_value := v_card_value;

            -- Checar vitória
            IF jsonb_array_length(v_hands->(p_player_id::text)) = 0 THEN
                v_winner_id := p_player_id;
                v_is_finished := true;
                v_same_number_sequence := jsonb_build_object('active', false, 'player_id', NULL, 'number', NULL);
            ELSE
                -- Verifica se ainda restam cartas com este mesmo número na mão
                SELECT count(*) INTO v_remaining_matching_count
                FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c
                WHERE c LIKE '%:' || v_card_value;

                IF v_remaining_matching_count = 0 THEN
                    -- Não há mais cartas com esse número: finaliza a sequência e avança o turno
                    v_same_number_sequence := jsonb_build_object('active', false, 'player_id', NULL, 'number', NULL);
                    v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);
                ELSE
                    -- O jogador pode continuar jogando ou encerrar voluntariamente
                    v_same_number_sequence := jsonb_build_object('active', true, 'player_id', p_player_id, 'number', v_card_value);
                END IF;
            END IF;

        -- --------------------------------------------------------------------
        -- CENÁRIO B: Jogador está respondendo a penalidade acumulada (+2 / +4)
        -- --------------------------------------------------------------------
        ELSIF v_pending_draws > 0 THEN
            IF NOT v_cumulative_draw THEN
                RAISE EXCEPTION 'STACKING_DISABLED: O acúmulo de cartas de compra está desativado nesta partida. Aceite a penalidade.' USING ERRCODE = 'P0088';
            END IF;

            -- Para defender e acumular, DEVE ser +2 ou +4
            IF v_card_value NOT IN ('draw2', 'draw4') THEN
                RAISE EXCEPTION 'MUST_DEFEND_OR_ACCEPT: Você deve jogar uma carta de compra (+2 ou +4) para acumular ou receber a penalidade.' USING ERRCODE = 'P0074';
            END IF;

            -- Remover da mão
            SELECT COALESCE(array_agg(c), ARRAY[]::TEXT[]) INTO v_hand_cards
            FROM (
                SELECT c, row_number() OVER () AS rn
                FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c
            ) sub
            WHERE NOT (c = v_card AND rn = (
                SELECT min(rn) FROM (
                    SELECT c2, row_number() OVER () AS rn 
                    FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c2
                ) s2 WHERE c2 = v_card
            ));

            v_hands := v_hands || jsonb_build_object(p_player_id::text, to_jsonb(COALESCE(v_hand_cards, ARRAY[]::TEXT[])));
            v_discard_pile := array_prepend(v_card, v_discard_pile);
            v_active_value := v_card_value;

            IF v_card_color = 'wild' THEN
                v_choose_color := p_payload->>'choose_color';
                IF v_choose_color NOT IN ('red', 'blue', 'green', 'yellow') THEN
                    RAISE EXCEPTION 'INVALID_COLOR: Cor escolhida para Wild é inválida.' USING ERRCODE = 'P0076';
                END IF;
                v_active_color := v_choose_color;
            ELSE
                v_active_color := v_card_color;
            END IF;

            -- Acumular penalidade
            IF v_card_value = 'draw2' THEN
                v_pending_draws := v_pending_draws + 2;
            ELSE
                v_pending_draws := v_pending_draws + 4;
            END IF;

            -- Checar vitória
            IF jsonb_array_length(v_hands->(p_player_id::text)) = 0 THEN
                v_winner_id := p_player_id;
                v_is_finished := true;
            END IF;

            -- Passa a penalidade acumulada para o próximo participante elegível
            v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);

        -- --------------------------------------------------------------------
        -- CENÁRIO C: Jogada Normal (fora de sequência e sem penalidade pendente)
        -- --------------------------------------------------------------------
        ELSE
            -- Validação de descarte legal
            IF v_card_color <> 'wild' THEN
                IF v_card_color <> v_active_color AND v_card_value <> v_active_value THEN
                    RAISE EXCEPTION 'INVALID_CARD: A carta jogada não corresponde à cor ativa ou ao valor ativo.' USING ERRCODE = 'P0075';
                END IF;
            END IF;

            -- Remover da mão
            SELECT COALESCE(array_agg(c), ARRAY[]::TEXT[]) INTO v_hand_cards
            FROM (
                SELECT c, row_number() OVER () AS rn
                FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c
            ) sub
            WHERE NOT (c = v_card AND rn = (
                SELECT min(rn) FROM (
                    SELECT c2, row_number() OVER () AS rn 
                    FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c2
                ) s2 WHERE c2 = v_card
            ));

            v_hands := v_hands || jsonb_build_object(p_player_id::text, to_jsonb(COALESCE(v_hand_cards, ARRAY[]::TEXT[])));
            v_discard_pile := array_prepend(v_card, v_discard_pile);
            v_active_value := v_card_value;

            IF v_card_color = 'wild' THEN
                v_choose_color := p_payload->>'choose_color';
                IF v_choose_color NOT IN ('red', 'blue', 'green', 'yellow') THEN
                    RAISE EXCEPTION 'INVALID_COLOR: Cor escolhida para Wild é inválida.' USING ERRCODE = 'P0076';
                END IF;
                v_active_color := v_choose_color;
            ELSE
                v_active_color := v_card_color;
            END IF;

            -- Checar vitória
            IF jsonb_array_length(v_hands->(p_player_id::text)) = 0 THEN
                v_winner_id := p_player_id;
                v_is_finished := true;
            END IF;

            -- Efeitos das cartas
            IF v_card_value = 'draw2' OR v_card_value = 'draw4' THEN
                IF v_cumulative_draw THEN
                    -- Modo com Acúmulo: define penalidade pendente e passa para o próximo responder
                    v_pending_draws := CASE WHEN v_card_value = 'draw2' THEN 2 ELSE 4 END;
                    v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);
                ELSE
                    -- Modo sem Acúmulo: penalidade imediata ao próximo jogador, que perde a vez
                    v_penalty_cards_count := CASE WHEN v_card_value = 'draw2' THEN 2 ELSE 4 END;
                    v_penalized_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);

                    FOR i IN 1..v_penalty_cards_count LOOP
                        IF array_length(v_deck, 1) IS NULL OR array_length(v_deck, 1) = 0 THEN
                            IF array_length(v_discard_pile, 1) > 1 THEN
                                DECLARE
                                    v_top_card TEXT := v_discard_pile[1];
                                    v_recycle TEXT[] := v_discard_pile[2:array_length(v_discard_pile, 1)];
                                BEGIN
                                    SELECT array_agg(card ORDER BY random()) INTO v_deck
                                    FROM unnest(v_recycle) AS card;
                                    v_discard_pile := ARRAY[v_top_card];
                                END;
                            END IF;
                        END IF;

                        IF array_length(v_deck, 1) > 0 THEN
                            v_draw_card := v_deck[1];
                            v_deck := v_deck[2:array_length(v_deck, 1)];

                            SELECT COALESCE(array_agg(c), ARRAY[]::TEXT[]) INTO v_hand_cards
                            FROM jsonb_array_elements_text(v_hands->(v_penalized_player_id::text)) AS c;

                            v_hand_cards := array_append(v_hand_cards, v_draw_card);
                            v_hands := v_hands || jsonb_build_object(v_penalized_player_id::text, to_jsonb(v_hand_cards));
                        END IF;
                    END LOOP;

                    v_current_turn_player_id := public.get_next_carta_duo_player_id(v_penalized_player_id, v_turn_order, v_direction, 1);
                END IF;

            ELSIF v_card_value = 'skip' THEN
                v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 2);

            ELSIF v_card_value = 'reverse' THEN
                v_direction := v_direction * -1;
                IF array_length(v_turn_order, 1) = 2 THEN
                    v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 2);
                ELSE
                    v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);
                END IF;

            ELSIF v_card_value ~ '^[0-9]$' AND v_allow_same_number THEN
                -- Carta com número (0-9) com regra de múltiplas cartas ativada:
                -- Checa se o jogador ainda possui mais cartas com o mesmo número na mão
                SELECT count(*) INTO v_remaining_matching_count
                FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c
                WHERE c LIKE '%:' || v_card_value;

                IF v_remaining_matching_count > 0 AND NOT v_is_finished THEN
                    -- Inicia a sequência de mesmo número mantendo o turno com o jogador atual
                    v_same_number_sequence := jsonb_build_object('active', true, 'player_id', p_player_id, 'number', v_card_value);
                ELSE
                    v_same_number_sequence := jsonb_build_object('active', false, 'player_id', NULL, 'number', NULL);
                    v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);
                END IF;

            ELSE
                v_same_number_sequence := jsonb_build_object('active', false, 'player_id', NULL, 'number', NULL);
                v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);
            END IF;
        END IF;

    ELSE
        RAISE EXCEPTION 'INVALID_ACTION_TYPE: Tipo de ação não suportado: %', p_action_type USING ERRCODE = 'P0078';
    END IF;

    -- 7. Resetar status de Última Carta se o jogador ficou com mais de 1 carta
    FOREACH v_player_id IN ARRAY v_turn_order LOOP
        IF jsonb_array_length(v_hands->(v_player_id::text)) > 1 THEN
            v_last_card_declarations := v_last_card_declarations || jsonb_build_object(v_player_id::text, false);
        END IF;
    END LOOP;

    -- 8. Sincronizar Placar dos Jogadores em match_players
    FOREACH v_player_id IN ARRAY v_turn_order LOOP
        UPDATE public.match_players
        SET score = jsonb_array_length(v_hands->(v_player_id::text))
        WHERE match_id = p_match_id AND user_id = v_player_id;
    END LOOP;

    -- 9. Consolidar Novo Estado Oficial
    v_new_state := jsonb_build_object(
        'deck', to_jsonb(COALESCE(v_deck, ARRAY[]::TEXT[])),
        'discard_pile', to_jsonb(COALESCE(v_discard_pile, ARRAY[]::TEXT[])),
        'top_card', v_discard_pile[1],
        'hands', v_hands,
        'active_color', v_active_color,
        'active_value', v_active_value,
        'direction', v_direction,
        'turn_order', to_jsonb(v_turn_order),
        'current_turn_player_id', v_current_turn_player_id,
        'pending_draws', v_pending_draws,
        'same_number_sequence', v_same_number_sequence,
        'last_card_declarations', v_last_card_declarations,
        'winner_id', v_winner_id,
        'is_finished', v_is_finished,
        'config', v_config
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
