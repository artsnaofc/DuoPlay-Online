-- ============================================================================
-- Migration: 20261009110000_carta_duo_instant_penalty_and_turn_timeout.sql
-- Project: DuoPlay-Online
-- Phase: Carta Duo — Regras de Compra Imediata, Sem Passar Turno e Turn Timeout
-- Description:
--   1. Regra Sem Acúmulo: +2 e +4 aplicam a penalidade de compra imediatamente
--      ao próximo jogador, adicionando as cartas à sua mão e avançando o turno
--      para o jogador seguinte (sem cadeia ou resposta com outra carta de compra).
--   2. Remoção definitiva de qualquer ação de "passar turno": jogadores só podem
--      jogar carta válida ou comprar do baralho (que avança o turno automaticamente).
--   3. Carta descartada é colocada imediatamente no topo da pilha de descarte (índice 1 no PostgreSQL / 0 no JSON).
--   4. RPC timeout_match_turn com verificação autoritativa no servidor (clock_timestamp() >= turn_deadline),
--      exclusão mútua concorrente (FOR UPDATE) e proteção contra avanço duplo por turn_number.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Validador Oficial Atualizado do Carta Duo (validate_carta_duo_action)
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
    v_turn_timer INTEGER := 30;

    v_deck TEXT[];
    v_discard_pile TEXT[];
    v_hands JSONB;
    v_active_color VARCHAR(15);
    v_active_value VARCHAR(15);
    v_direction INTEGER := 1;
    v_turn_order UUID[];
    v_current_turn_player_id UUID;
    v_winner_id UUID := NULL;
    v_is_finished BOOLEAN := false;

    v_card TEXT;
    v_choose_color VARCHAR(15);
    v_card_parts TEXT[];
    v_card_color VARCHAR(15);
    v_card_value VARCHAR(15);
    v_penalized_player_id UUID;
    v_penalty_cards_count INTEGER := 0;
    v_new_state JSONB;
    v_player_id UUID;
    v_draw_card TEXT;
    v_hand_cards TEXT[];
    i INTEGER;
BEGIN
    -- 1. Bloquear estritamente qualquer tentativa de passar turno
    IF p_action_type = 'pass_turn' OR p_action_type = 'end_turn' OR p_action_type = 'skip_turn' THEN
        RAISE EXCEPTION 'ACTION_NOT_ALLOWED: No Carta Duo não existe ação de passar turno. Jogue uma carta válida ou compre do baralho.' USING ERRCODE = 'P0078';
    END IF;

    -- 2. Obter configurações da partida
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
    v_turn_timer := COALESCE((v_config->>'turn_timer')::INTEGER, 30);

    IF p_action_type = 'update_config' THEN
        RAISE EXCEPTION 'FORBIDDEN: Não é permitido alterar as configurações oficiais após o início da partida.' USING ERRCODE = 'P0071';
    END IF;

    -- 3. Montar lista de competidores ordenada por slot
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
        v_winner_id := (p_current_state->>'winner_id')::UUID;
        v_is_finished := COALESCE((p_current_state->>'is_finished')::BOOLEAN, false);
    END IF;

    IF v_is_finished THEN
        RAISE EXCEPTION 'MATCH_FINISHED: A partida já foi encerrada.' USING ERRCODE = 'P0017';
    END IF;

    -- Validar turno do jogador
    IF p_player_id <> v_current_turn_player_id THEN
        RAISE EXCEPTION 'NOT_YOUR_TURN: Não é o seu turno de jogar.' USING ERRCODE = 'P0019';
    END IF;

    -- ------------------------------------------------------------------------
    -- 5. PROCESSAMENTO: JOGAR CARTA (play_card)
    -- ------------------------------------------------------------------------
    IF p_action_type = 'play_card' THEN
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

        -- Validação de descarte legal por cor, valor ou carta Wild
        IF v_card_color <> 'wild' THEN
            IF v_card_color <> v_active_color AND v_card_value <> v_active_value THEN
                RAISE EXCEPTION 'INVALID_CARD: A carta jogada não corresponde à cor ativa ou ao valor ativo.' USING ERRCODE = 'P0075';
            END IF;
        END IF;

        -- Remover exatamente uma instância da carta jogada da mão do jogador
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

        -- Colocar no topo oficial do descarte (array_prepend)
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

        -- Verificar condição de vitória (mão esvaziada)
        IF jsonb_array_length(v_hands->(p_player_id::text)) = 0 THEN
            v_winner_id := p_player_id;
            v_is_finished := true;
        END IF;

        -- --------------------------------------------------------------------
        -- APLICAÇÃO IMEDIATA DE EFEITOS ESPECIAIS (SEM ACÚMULO)
        -- --------------------------------------------------------------------
        IF v_card_value = 'draw2' OR v_card_value = 'draw4' THEN
            -- Penalidade imediata: próximo jogador compra e perde o turno
            v_penalty_cards_count := CASE WHEN v_card_value = 'draw2' THEN 2 ELSE 4 END;
            v_penalized_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);

            -- Comprar cartas da pilha para o jogador penalizado
            FOR i IN 1..v_penalty_cards_count LOOP
                -- Reciclar descarte se o baralho esvaziar
                IF array_length(v_deck, 1) IS NULL OR array_length(v_deck, 1) = 0 THEN
                    IF array_length(v_discard_pile, 1) > 1 THEN
                        DECLARE
                            v_top_card TEXT := v_discard_pile[1];
                            v_recycle_cards TEXT[] := v_discard_pile[2:array_length(v_discard_pile, 1)];
                        BEGIN
                            SELECT array_agg(card ORDER BY random()) INTO v_deck
                            FROM unnest(v_recycle_cards) AS card;
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

            -- O jogador penalizado perde o turno: turno passa para o seguinte após ele
            v_current_turn_player_id := public.get_next_carta_duo_player_id(v_penalized_player_id, v_turn_order, v_direction, 1);

        ELSIF v_card_value = 'skip' THEN
            -- Pular próximo jogador (2 passos)
            v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 2);

        ELSIF v_card_value = 'reverse' THEN
            -- Inverter direção
            v_direction := v_direction * -1;
            IF array_length(v_turn_order, 1) = 2 THEN
                -- Em duelo 1v1, reverse age como skip
                v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 2);
            ELSE
                v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);
            END IF;

        ELSE
            -- Carta normal ou wild simples: avança 1 passo
            v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);
        END IF;

    -- ------------------------------------------------------------------------
    -- 6. PROCESSAMENTO: COMPRAR CARTA (draw_card)
    -- ------------------------------------------------------------------------
    ELSIF p_action_type = 'draw_card' THEN
        -- O jogador compra 1 carta do baralho e o turno passa imediatamente para o próximo
        IF array_length(v_deck, 1) IS NULL OR array_length(v_deck, 1) = 0 THEN
            IF array_length(v_discard_pile, 1) > 1 THEN
                DECLARE
                    v_top_card TEXT := v_discard_pile[1];
                    v_recycle_cards TEXT[] := v_discard_pile[2:array_length(v_discard_pile, 1)];
                BEGIN
                    SELECT array_agg(card ORDER BY random()) INTO v_deck
                    FROM unnest(v_recycle_cards) AS card;
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

        -- Turno avança imediatamente para o próximo jogador
        v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);

    ELSE
        RAISE EXCEPTION 'INVALID_ACTION_TYPE: Tipo de ação não suportado: %', p_action_type USING ERRCODE = 'P0078';
    END IF;

    -- 7. Sincronizar Placar dos Jogadores em match_players
    FOREACH v_player_id IN ARRAY v_turn_order LOOP
        UPDATE public.match_players
        SET score = jsonb_array_length(v_hands->(v_player_id::text))
        WHERE match_id = p_match_id AND user_id = v_player_id;
    END LOOP;

    -- 8. Construir Novo Estado Oficial Consolidado
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

-- ----------------------------------------------------------------------------
-- 2. RPC: timeout_match_turn (Avanço Autoritativo por Exceder Turn Deadline)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.timeout_match_turn(
    p_match_id UUID,
    p_turn_number INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_match RECORD;
    v_next_turn_player_id UUID;
    v_timed_out_player_id UUID;
    v_turn_timer INTEGER;
    v_new_deadline TIMESTAMPTZ;
    v_new_action_history JSONB;
    v_envelope JSONB;
    v_new_state JSONB;
    v_turn_order UUID[];
    v_direction INTEGER := 1;
    v_deck TEXT[];
    v_discard_pile TEXT[];
    v_hands JSONB;
    v_hand_cards TEXT[];
    v_draw_card TEXT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 1. Trava transacional exclusiva da partida
    SELECT * INTO v_match
    FROM public.matches
    WHERE id = p_match_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MATCH_NOT_FOUND: Partida não encontrada.' USING ERRCODE = 'P0016';
    END IF;

    -- Se a partida já estiver finalizada
    IF v_match.status != 'in_progress' THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object('match_id', v_match.id, 'status', v_match.status, 'idempotent', true),
            'error', null
        );
    END IF;

    -- Validar que o usuário autenticado participa da partida
    IF NOT EXISTS (
        SELECT 1 FROM public.match_players WHERE match_id = p_match_id AND user_id = v_caller_id
    ) THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: Usuário não é participante da partida.' USING ERRCODE = 'P0018';
    END IF;

    -- 2. Proteção Concorrente contra Duplo Avanço: se o turno já avançou, retorna sucesso idempotente
    IF v_match.turn_number != p_turn_number THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'match_id', v_match.id,
                'turn_number', v_match.turn_number,
                'current_turn_player_id', v_match.current_turn_player_id,
                'idempotent', true
            ),
            'error', null
        );
    END IF;

    -- 3. Validação Autoritativa de Tempo no Servidor: agora >= turn_deadline
    IF v_match.turn_deadline IS NOT NULL AND clock_timestamp() < v_match.turn_deadline THEN
        RAISE EXCEPTION 'TURN_NOT_EXPIRED: O prazo oficial do turno ainda não expirou no servidor.' USING ERRCODE = 'P0080';
    END IF;

    v_timed_out_player_id := v_match.current_turn_player_id;
    v_turn_timer := COALESCE((v_match.config->>'turn_timer')::INTEGER, 30);
    v_new_deadline := clock_timestamp() + (v_turn_timer || ' seconds')::INTERVAL;
    v_new_state := v_match.game_state;

    -- 4. Transição de Turno Conforme o Jogo
    IF v_match.game_id = 'carta_duo' THEN
        SELECT array_agg(user_id ORDER BY slot ASC) INTO v_turn_order
        FROM public.match_players
        WHERE match_id = p_match_id;

        v_direction := COALESCE((v_new_state->>'direction')::INTEGER, 1);
        v_next_turn_player_id := public.get_next_carta_duo_player_id(v_timed_out_player_id, v_turn_order, v_direction, 1);

        -- Penalidade de timeout no Carta Duo: compra forçada de 1 carta
        v_deck := ARRAY(SELECT jsonb_array_elements_text(v_new_state->'deck'));
        v_discard_pile := ARRAY(SELECT jsonb_array_elements_text(v_new_state->'discard_pile'));
        v_hands := v_new_state->'hands';

        IF array_length(v_deck, 1) IS NULL OR array_length(v_deck, 1) = 0 THEN
            IF array_length(v_discard_pile, 1) > 1 THEN
                DECLARE
                    v_top TEXT := v_discard_pile[1];
                    v_rest TEXT[] := v_discard_pile[2:array_length(v_discard_pile, 1)];
                BEGIN
                    SELECT array_agg(card ORDER BY random()) INTO v_deck FROM unnest(v_rest) AS card;
                    v_discard_pile := ARRAY[v_top];
                END;
            END IF;
        END IF;

        IF array_length(v_deck, 1) > 0 THEN
            v_draw_card := v_deck[1];
            v_deck := v_deck[2:array_length(v_deck, 1)];

            SELECT COALESCE(array_agg(c), ARRAY[]::TEXT[]) INTO v_hand_cards
            FROM jsonb_array_elements_text(v_hands->(v_timed_out_player_id::text)) AS c;

            v_hand_cards := array_append(v_hand_cards, v_draw_card);
            v_hands := v_hands || jsonb_build_object(v_timed_out_player_id::text, to_jsonb(v_hand_cards));
        END IF;

        v_new_state := v_new_state || jsonb_build_object(
            'deck', to_jsonb(COALESCE(v_deck, ARRAY[]::TEXT[])),
            'discard_pile', to_jsonb(COALESCE(v_discard_pile, ARRAY[]::TEXT[])),
            'top_card', v_discard_pile[1],
            'hands', v_hands,
            'current_turn_player_id', v_next_turn_player_id
        );

        -- Atualizar placar de cartas
        UPDATE public.match_players
        SET score = jsonb_array_length(v_hands->(v_timed_out_player_id::text))
        WHERE match_id = p_match_id AND user_id = v_timed_out_player_id;

    ELSE
        -- Tic-Tac-Toe ou outro jogo: passa o turno para o oponente seguinte
        SELECT user_id INTO v_next_turn_player_id
        FROM public.match_players
        WHERE match_id = p_match_id AND user_id != v_timed_out_player_id
        ORDER BY slot ASC
        LIMIT 1;
    END IF;

    -- 5. Registrar no histórico de ações oficiais
    v_envelope := jsonb_build_object(
        'action_id', gen_random_uuid()::text,
        'turn_number', v_match.turn_number,
        'player_id', v_timed_out_player_id,
        'action_type', 'timeout_turn',
        'payload', '{}'::jsonb,
        'server_timestamp', clock_timestamp()
    );
    v_new_action_history := v_match.action_history || jsonb_build_array(v_envelope);

    -- 6. Atualizar a partida oficialmente no PostgreSQL
    UPDATE public.matches SET
        game_state = v_new_state,
        action_history = v_new_action_history,
        turn_number = v_match.turn_number + 1,
        current_turn_player_id = v_next_turn_player_id,
        turn_deadline = v_new_deadline,
        updated_at = clock_timestamp()
    WHERE id = p_match_id
    RETURNING * INTO v_match;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'match_id', v_match.id,
            'turn_number', v_match.turn_number,
            'current_turn_player_id', v_match.current_turn_player_id,
            'turn_deadline', v_match.turn_deadline,
            'game_state', v_match.game_state
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.timeout_match_turn(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timeout_match_turn(UUID, INTEGER) TO authenticated;
