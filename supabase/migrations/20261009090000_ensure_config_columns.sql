-- ============================================================================
-- Migration: 20261009090000_ensure_config_columns.sql
-- Project: DuoPlay-Online
-- Description: Ensure 'config' JSONB column exists on public.rooms, public.games, 
--              and public.matches, and make functions robust against missing columns.
-- ============================================================================

-- 1. Assegurar colunas config em public.rooms, public.games e public.matches
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'config'
    ) THEN
        ALTER TABLE public.rooms ADD COLUMN config JSONB DEFAULT '{}'::jsonb NOT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'config'
    ) THEN
        ALTER TABLE public.games ADD COLUMN config JSONB DEFAULT '{}'::jsonb NOT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'matches' AND column_name = 'config'
    ) THEN
        ALTER TABLE public.matches ADD COLUMN config JSONB DEFAULT '{}'::jsonb NOT NULL;
    END IF;
END $$;

COMMENT ON COLUMN public.rooms.config IS 'Configurações de regras personalizadas editáveis pelo Host no lobby pré-jogo.';
COMMENT ON COLUMN public.games.config IS 'Configurações técnicas estruturais e metadados específicos de cada jogo.';
COMMENT ON COLUMN public.matches.config IS 'Configurações congeladas da partida no momento do início.';

-- 2. Atualizar validate_carta_duo_action para robustez total contra coluna config ausente
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
    -- 1. Ler ou Inicializar Configuração com segurança robusta
    IF p_current_state ? 'config' THEN
        v_config := p_current_state->'config';
    ELSE
        -- Tentar buscar da sala via match com tratamento de exceção defensivo
        BEGIN
            SELECT r.config INTO v_config 
            FROM public.rooms r 
            JOIN public.matches m ON m.room_id = r.id 
            WHERE m.id = p_match_id;
        EXCEPTION WHEN OTHERS THEN
            v_config := NULL;
        END;

        IF v_config IS NULL THEN
            BEGIN
                SELECT m.config INTO v_config 
                FROM public.matches m 
                WHERE m.id = p_match_id;
            EXCEPTION WHEN OTHERS THEN
                v_config := NULL;
            END;
        END IF;

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

    -- Se match_players estiver vazio, tentar ordenar por slot number ou user_id
    IF v_turn_order IS NULL OR array_length(v_turn_order, 1) IS NULL THEN
        SELECT array_agg(user_id ORDER BY COALESCE(slot, 1) ASC) INTO v_turn_order
        FROM public.match_players
        WHERE match_id = p_match_id;
    END IF;

    -- 3. INICIALIZAÇÃO AUTOMÁTICA (LAZY-INITIALIZATION) NO PRIMEIRO TURNO
    IF p_current_state IS NULL OR NOT (p_current_state ? 'deck') THEN
        -- Construir Baralho de 108 cartas
        v_raw_deck := ARRAY[]::TEXT[];
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

        -- Embaralhar Baralho
        SELECT array_agg(card ORDER BY random()) INTO v_shuffled
        FROM unnest(v_raw_deck) AS card;

        -- Distribuir Mãos Iniciais (utilizando v_hands->(v_player_id::text) para evitar erro de precedência/jsonb)
        v_hands := '{}'::jsonb;
        IF v_turn_order IS NOT NULL THEN
            FOREACH v_player_id IN ARRAY v_turn_order LOOP
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

        -- Puxar carta inicial do descarte que não seja Wild
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

        v_deck := v_shuffled;
        v_discard_pile := ARRAY[v_card];
        v_direction := 1;
        v_current_turn_player_id := COALESCE(v_turn_order[1], p_player_id);
        v_pending_draws := 0;
        v_winner_id := NULL;
        v_is_finished := false;

        IF v_active_value = 'skip' AND array_length(v_turn_order, 1) > 1 THEN
            v_current_turn_player_id := public.get_next_carta_duo_player_id(v_current_turn_player_id, v_turn_order, v_direction, 1);
        ELSIF v_active_value = 'reverse' THEN
            v_direction := -1;
            IF v_turn_order IS NOT NULL AND array_length(v_turn_order, 1) = 2 THEN
                v_current_turn_player_id := public.get_next_carta_duo_player_id(v_current_turn_player_id, v_turn_order, 1, 1);
            ELSIF v_turn_order IS NOT NULL AND array_length(v_turn_order, 1) > 2 THEN
                v_current_turn_player_id := public.get_next_carta_duo_player_id(v_turn_order[1], v_turn_order, v_direction, 0);
            END IF;
        ELSIF v_active_value = 'draw2' THEN
            v_pending_draws := 2;
        END IF;

    ELSE
        -- Reidratar Estado Existente
        SELECT COALESCE(array_agg(card), ARRAY[]::TEXT[]) INTO v_deck FROM jsonb_array_elements_text(p_current_state->'deck') AS card;
        SELECT COALESCE(array_agg(card), ARRAY[]::TEXT[]) INTO v_discard_pile FROM jsonb_array_elements_text(p_current_state->'discard_pile') AS card;
        v_hands := p_current_state->'hands';
        v_active_color := p_current_state->>'active_color';
        v_active_value := p_current_state->>'active_value';
        v_direction := COALESCE((p_current_state->>'direction')::INTEGER, 1);
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

        -- Verificar se a carta pertence à mão do jogador (usando sintaxe segura v_hands->(p_player_id::text))
        SELECT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c WHERE c = v_card
        ) INTO v_has_playable;

        IF NOT v_has_playable THEN
            RAISE EXCEPTION 'CARD_NOT_IN_HAND: A carta % não pertence à sua mão.', v_card USING ERRCODE = 'P0073';
        END IF;

        v_card_parts := string_to_array(v_card, ':');
        v_card_color := v_card_parts[1];
        v_card_value := v_card_parts[2];

        -- Validar correspondência de cor/número/símbolo ou Wild
        IF v_pending_draws > 0 THEN
            IF v_card_value NOT IN ('draw2', 'draw4') THEN
                RAISE EXCEPTION 'PENDING_DRAWS: Você deve responder ao compra acumulada com +2 ou +4 ou comprar as cartas pendentes.' USING ERRCODE = 'P0074';
            END IF;
        END IF;

        IF v_card_color <> 'wild' AND v_card_color <> v_active_color AND v_card_value <> v_active_value THEN
            RAISE EXCEPTION 'INVALID_MOVE: A carta jogada não corresponde à cor ou valor ativo.' USING ERRCODE = 'P0075';
        END IF;

        -- Remover carta da mão do jogador
        SELECT jsonb_agg(c) INTO v_hand_cards
        FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c
        WHERE c <> v_card OR cctid(c) = (
            SELECT min(ctid) FROM (SELECT ctid, c FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c WHERE c = v_card) sub LIMIT 1
        );
        -- Simplificação robusta para remoção de 1 ocorrência
        SELECT COALESCE(array_agg(c), ARRAY[]::TEXT[]) INTO v_hand_cards
        FROM (
            SELECT c, row_number() over() as rn FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c
        ) t
        WHERE rn <> (
            SELECT min(rn) FROM (
                SELECT c, row_number() over() as rn FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c
            ) sub WHERE sub.c = v_card
        );

        v_hands := v_hands || jsonb_build_object(p_player_id::text, to_jsonb(v_hand_cards));

        -- Verificar vitória (mão vazia)
        IF jsonb_array_length(v_hands->(p_player_id::text)) = 0 THEN
            v_winner_id := p_player_id;
            v_is_finished := true;
        END IF;

        -- Adicionar ao topo do descarte
        v_discard_pile := array_prepend(v_card, v_discard_pile);

        -- Definir nova cor ativa e valor ativo
        v_active_value := v_card_value;
        IF v_card_color = 'wild' THEN
            v_choose_color := p_payload->>'choose_color';
            IF v_choose_color NOT IN ('red', 'blue', 'green', 'yellow') THEN
                RAISE EXCEPTION 'INVALID_COLOR: Cor escolhida para Wild é inválida.' USING ERRCODE = 'P0076';
            END IF;
            v_active_color := v_choose_color;
        else
            v_active_color := v_card_color;
        END IF;

        -- Processar efeitos especiais
        v_steps := 1;
        IF v_card_value = 'skip' THEN
            v_steps := 2;
        ELSIF v_card_value = 'reverse' THEN
            v_direction := v_direction * -1;
            IF array_length(v_turn_order, 1) = 2 THEN
                v_steps := 2;
            END IF;
        ELSIF v_card_value = 'draw2' THEN
            v_pending_draws := v_pending_draws + 2;
        ELSIF v_card_value = 'draw4' THEN
            v_pending_draws := v_pending_draws + 4;
        END IF;

        v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, v_steps);

    -- 7. PROCESSAMENTO DE AÇÃO: COMPRAR CARTA (draw_card)
    ELSIF p_action_type = 'draw_card' THEN
        -- Verificar regra de compra (force_draw / playable check)
        IF v_force_draw AND v_pending_draws = 0 THEN
            SELECT EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c
                WHERE c LIKE 'wild:%' 
                   OR split_part(c, ':', 1) = v_active_color 
                   OR split_part(c, ':', 2) = v_active_value
            ) INTO v_has_playable;

            IF v_has_playable AND v_play_immediately THEN
                RAISE EXCEPTION 'PLAYABLE_CARD_IN_HAND: Você possui jogadas válidas na sua mão e não pode comprar sob a configuração atual.' USING ERRCODE = 'P0077';
            END IF;
        END IF;

        -- Quantidade a comprar
        DECLARE
            v_cards_to_draw INTEGER := GREATEST(1, v_pending_draws);
            v_drawn_list TEXT[] := ARRAY[]::TEXT[];
        BEGIN
            v_pending_draws := 0;

            FOR i IN 1..v_cards_to_draw LOOP
                IF array_length(v_deck, 1) IS NULL OR array_length(v_deck, 1) = 0 THEN
                    -- Reciclar pilha de descarte se baralho esvaziar (mantendo o topo)
                    DECLARE
                        v_top_discard TEXT := v_discard_pile[1];
                        v_rest_discard TEXT[] := v_discard_pile[2:array_length(v_discard_pile, 1)];
                    BEGIN
                        SELECT array_agg(card ORDER BY random()) INTO v_deck
                        FROM unnest(COALESCE(v_rest_discard, ARRAY[]::TEXT[])) AS card;
                        v_discard_pile := ARRAY[v_top_discard];
                    END;
                END IF;

                IF array_length(v_deck, 1) > 0 THEN
                    v_draw_card := v_deck[1];
                    v_deck := v_deck[2:array_length(v_deck, 1)];
                    v_drawn_list := array_append(v_drawn_list, v_draw_card);
                END IF;
            END LOOP;

            -- Adicionar cartas à mão do jogador
            SELECT COALESCE(array_agg(c), ARRAY[]::TEXT[]) INTO v_hand_cards
            FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c;

            v_hand_cards := v_hand_cards || v_drawn_list;
            v_hands := v_hands || jsonb_build_object(p_player_id::text, to_jsonb(v_hand_cards));
        END;

        -- Passar o turno para o próximo jogador
        v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);

    -- 8. PROCESSAMENTO DE AÇÃO: PASSAR TURNO (pass_turn)
    ELSIF p_action_type = 'pass_turn' THEN
        v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);
    ELSE
        RAISE EXCEPTION 'INVALID_ACTION_TYPE: Tipo de ação desconhecido: %', p_action_type USING ERRCODE = 'P0078';
    END IF;

    -- 9. Retornar Novo Estado Consolidado
    v_new_state := jsonb_build_object(
        'deck', to_jsonb(COALESCE(v_deck, ARRAY[]::TEXT[])),
        'discard_pile', to_jsonb(COALESCE(v_discard_pile, ARRAY[]::TEXT[])),
        'hands', v_hands,
        'active_color', v_active_color,
        'active_value', v_active_value,
        'direction', v_direction,
        'turn_order', to_jsonb(v_turn_order),
        'current_turn_player_id', v_current_turn_player_id,
        'pending_draws', v_pending_draws,
        'winner_id', v_winner_id,
        'is_finished', v_is_finished,
        'config', v_config
    );

    RETURN v_new_state;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_carta_duo_action(UUID, UUID, VARCHAR, JSONB, JSONB, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_carta_duo_action(UUID, UUID, VARCHAR, JSONB, JSONB, INTEGER) TO authenticated;
