-- ============================================================================
-- Migration: 20261009030000_create_carta_duo_validator.sql
-- Project: DuoPlay-Online
-- Phase: Fase 20 — Carta Duo 🃏
-- Description: Cria o validador server-side oficial das regras do jogo Carta Duo,
--              e ativa o jogo no catálogo oficial (public.games).
-- ============================================================================

-- 1. Ativar o jogo Carta Duo no catálogo de jogos da plataforma
UPDATE public.games
SET is_active = true
WHERE id = 'carta_duo';

-- 2. Inserir conquista de Primeira Vitória para o Carta Duo se não existir
INSERT INTO public.achievements (code, name, description, icon_badge, category, condition_type, condition_value, is_active)
VALUES (
    'first_win_carta_duo',
    'Mestre do Descarte',
    'Vença sua primeira partida de Carta Duo na plataforma.',
    'Award',
    'game_specific',
    'first_win_game',
    1,
    true
)
ON CONFLICT (code) DO NOTHING;

-- 3. Função Server-Side de Validação de Regras e Ciclo de Turnos do Carta Duo
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
    v_player1_id UUID;
    v_player2_id UUID;
    v_opponent_id UUID;
    
    -- Elementos do estado
    v_deck JSONB := '[]'::jsonb;
    v_discard_pile JSONB := '[]'::jsonb;
    v_hands JSONB := '{}'::jsonb;
    v_current_color VARCHAR(20) := '';
    v_current_value VARCHAR(20) := '';
    v_has_drawn BOOLEAN := false;
    v_turn_player_id UUID;
    
    -- Auxiliares de processamento
    v_card JSONB;
    v_card_id VARCHAR(50);
    v_card_color VARCHAR(20);
    v_card_value VARCHAR(20);
    v_chosen_color VARCHAR(20);
    v_has_card BOOLEAN := false;
    v_is_playable BOOLEAN := false;
    v_player_hand JSONB := '[]'::jsonb;
    v_new_hand JSONB := '[]'::jsonb;
    v_drawn_card JSONB;
    v_next_turn_player_id UUID;
    
    v_winner_id UUID := NULL;
    v_is_finished BOOLEAN := false;
    v_is_draw BOOLEAN := false;
    v_new_state JSONB;
    
    -- Variáveis para inicialização
    v_initial_deck JSONB := '[]'::jsonb;
    v_shuffled_deck JSONB[] := ARRAY[]::jsonb[];
    v_card_id_seq INTEGER := 1;
    v_color TEXT;
    v_val TEXT;
    v_i INTEGER;
    v_starter_card JSONB;
    v_deck_item JSONB;
BEGIN
    -- 1. Identificar jogadores oficiais dos slots 1 e 2
    SELECT user_id INTO v_player1_id FROM public.match_players WHERE match_id = p_match_id AND slot = 1;
    SELECT user_id INTO v_player2_id FROM public.match_players WHERE match_id = p_match_id AND slot = 2;
    
    IF v_player1_id IS NULL OR v_player2_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_MATCH_PLAYERS: Carta Duo requer exatamente 2 competidores.' USING ERRCODE = 'P0036';
    END IF;
    
    IF p_player_id != v_player1_id AND p_player_id != v_player2_id THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: O usuário não participa desta partida.' USING ERRCODE = 'P0018';
    END IF;
    
    v_opponent_id := CASE WHEN p_player_id = v_player1_id THEN v_player2_id ELSE v_player1_id END;

    -- 2. Inicialização On-Demand na primeira jogada
    IF p_current_state IS NULL OR p_current_state = '{}'::jsonb OR p_current_state->'deck' IS NULL THEN
        -- A. Gerar o baralho de 108 cartas
        -- Cores: red, blue, yellow, green
        FOREACH v_color IN ARRAY ARRAY['red', 'blue', 'yellow', 'green'] LOOP
            -- Carta 0 (1 de cada cor)
            v_initial_deck := v_initial_deck || jsonb_build_object('id', 'c_' || v_color || '_0_' || v_card_id_seq, 'color', v_color, 'value', '0');
            v_card_id_seq := v_card_id_seq + 1;
            
            -- Cartas de 1 a 9 (2 de cada cor)
            FOR v_i IN 1..9 LOOP
                v_initial_deck := v_initial_deck || jsonb_build_object('id', 'c_' || v_color || '_' || v_i || '_a_' || v_card_id_seq, 'color', v_color, 'value', v_i::text);
                v_card_id_seq := v_card_id_seq + 1;
                v_initial_deck := v_initial_deck || jsonb_build_object('id', 'c_' || v_color || '_' || v_i || '_b_' || v_card_id_seq, 'color', v_color, 'value', v_i::text);
                v_card_id_seq := v_card_id_seq + 1;
            END LOOP;
            
            -- Cartas Skip, Reverse e Draw Two (2 de cada cor)
            FOREACH v_val IN ARRAY ARRAY['skip', 'reverse', 'draw_two'] LOOP
                v_initial_deck := v_initial_deck || jsonb_build_object('id', 'c_' || v_color || '_' || v_val || '_a_' || v_card_id_seq, 'color', v_color, 'value', v_val);
                v_card_id_seq := v_card_id_seq + 1;
                v_initial_deck := v_initial_deck || jsonb_build_object('id', 'c_' || v_color || '_' || v_val || '_b_' || v_card_id_seq, 'color', v_color, 'value', v_val);
                v_card_id_seq := v_card_id_seq + 1;
            END LOOP;
        END LOOP;
        
        -- Cartas Wild e Wild Draw Four (4 de cada)
        FOR v_i IN 1..4 LOOP
            v_initial_deck := v_initial_deck || jsonb_build_object('id', 'c_wild_wild_a_' || v_card_id_seq, 'color', 'wild', 'value', 'wild');
            v_card_id_seq := v_card_id_seq + 1;
            v_initial_deck := v_initial_deck || jsonb_build_object('id', 'c_wild_draw4_b_' || v_card_id_seq, 'color', 'wild', 'value', 'wild_draw_four');
            v_card_id_seq := v_card_id_seq + 1;
        END LOOP;

        -- B. Embaralhar no PostgreSQL
        SELECT array_agg(elem ORDER BY random())
        INTO v_shuffled_deck
        FROM jsonb_array_elements(v_initial_deck) elem;
        
        -- C. Distribuir 7 cartas para cada jogador
        v_hands := jsonb_build_object(
            v_player1_id::text, jsonb_build_array(
                v_shuffled_deck[1], v_shuffled_deck[2], v_shuffled_deck[3],
                v_shuffled_deck[4], v_shuffled_deck[5], v_shuffled_deck[6], v_shuffled_deck[7]
            ),
            v_player2_id::text, jsonb_build_array(
                v_shuffled_deck[8], v_shuffled_deck[9], v_shuffled_deck[10],
                v_shuffled_deck[11], v_shuffled_deck[12], v_shuffled_deck[13], v_shuffled_deck[14]
            )
        );
        
        -- D. Encontrar carta inicial para descarte (numérica simples, sem ações ou wild)
        v_i := 15;
        LOOP
            v_starter_card := v_shuffled_deck[v_i];
            EXIT WHEN (v_starter_card->>'color' != 'wild' AND v_starter_card->>'value' NOT IN ('skip', 'reverse', 'draw_two'));
            v_i := v_i + 1;
        END LOOP;
        
        v_current_color := v_starter_card->>'color';
        v_current_value := v_starter_card->>'value';
        v_discard_pile := jsonb_build_array(v_starter_card);
        
        -- E. Montar o deck restante
        v_deck := '[]'::jsonb;
        FOR v_card_id_seq IN 15..array_length(v_shuffled_deck, 1) LOOP
            IF v_card_id_seq != v_i THEN
                v_deck := v_deck || v_shuffled_deck[v_card_id_seq];
            END IF;
        END LOOP;
        
        v_turn_player_id := v_player1_id; -- O host joga primeiro
        v_has_drawn := false;
    ELSE
        -- Re-hidratar estado existente
        v_deck := p_current_state->'deck';
        v_discard_pile := p_current_state->'discard_pile';
        v_hands := p_current_state->'hands';
        v_current_color := p_current_state->>'current_color';
        v_current_value := p_current_state->>'current_value';
        v_has_drawn := coalesce((p_current_state->>'has_drawn')::boolean, false);
        v_turn_player_id := (p_current_state->>'turn_player_id')::uuid;
    END IF;

    -- 3. Validar se é a vez do jogador
    IF p_player_id != v_turn_player_id THEN
        RAISE EXCEPTION 'NOT_YOUR_TURN: Não é o seu turno de jogar.' USING ERRCODE = 'P0019';
    END IF;

    -- 4. PROCESSAR AÇÕES
    IF p_action_type = 'play_card' THEN
        v_card_id := p_payload->>'card_id';
        v_chosen_color := p_payload->>'chosen_color';
        
        -- A. Buscar carta na mão do jogador
        v_player_hand := v_hands->(p_player_id::text);
        v_has_card := false;
        v_new_hand := '[]'::jsonb;
        
        FOR v_card IN SELECT * FROM jsonb_array_elements(v_player_hand) LOOP
            IF v_card->>'id' = v_card_id THEN
                v_has_card := true;
                v_card_color := v_card->>'color';
                v_card_value := v_card->>'value';
            ELSE
                v_new_hand := v_new_hand || v_card;
            END IF;
        END LOOP;
        
        IF NOT v_has_card THEN
            RAISE EXCEPTION 'CARD_NOT_IN_HAND: Esta carta não pertence à sua mão.' USING ERRCODE = 'P0036';
        END IF;
        
        -- B. Validar regra de descarte (correspondência de cor, valor, ou wild)
        IF v_card_color = 'wild' OR v_card_color = v_current_color OR v_card_value = v_current_value THEN
            v_is_playable := true;
        END IF;
        
        IF NOT v_is_playable THEN
            RAISE EXCEPTION 'INVALID_CARD_PLAY: Esta carta não pode ser jogada sobre a pilha de descarte atual.' USING ERRCODE = 'P0037';
        END IF;
        
        -- C. Atualizar pilha de descarte e cor/valor corrente
        v_discard_pile := jsonb_insert(v_discard_pile, '{0}', jsonb_build_object('id', v_card_id, 'color', v_card_color, 'value', v_card_value), true);
        
        IF v_card_color = 'wild' THEN
            IF v_chosen_color NOT IN ('red', 'blue', 'yellow', 'green') THEN
                RAISE EXCEPTION 'INVALID_WILD_COLOR: Cor escolhida inválida para carta Wild (esperado: red, blue, yellow, green).' USING ERRCODE = 'P0038';
            END IF;
            v_current_color := v_chosen_color;
        ELSE
            v_current_color := v_card_color;
        END IF;
        v_current_value := v_card_value;
        
        -- D. Atualizar as mãos
        v_hands := jsonb_set(v_hands, ARRAY[p_player_id::text], v_new_hand);
        
        -- E. Regras especiais e alteração de turnos
        -- Em partidas de 2 jogadores, SKIP e REVERSE mantêm o turno com o jogador atual!
        IF v_card_value IN ('skip', 'reverse') THEN
            v_next_turn_player_id := p_player_id;
            
        ELSIF v_card_value = 'draw_two' THEN
            -- Oponente compra 2 cartas e perde o turno
            FOR v_i IN 1..2 LOOP
                IF jsonb_array_length(v_deck) = 0 THEN
                    -- Re-embaralhar descarte se deck estiver vazio
                    SELECT array_agg(elem ORDER BY random()) INTO v_shuffled_deck
                    FROM jsonb_array_elements(v_discard_pile) WITH ORDINALITY t(elem, ord)
                    WHERE ord > 1; -- manter topo
                    
                    v_deck := coalesce(jsonb_concat(v_deck, to_jsonb(v_shuffled_deck)), '[]'::jsonb);
                    v_discard_pile := jsonb_build_array(v_discard_pile->0);
                END IF;
                
                IF jsonb_array_length(v_deck) > 0 THEN
                    v_drawn_card := v_deck->0;
                    v_deck := v_deck - 0;
                    v_hands := jsonb_set(v_hands, ARRAY[v_opponent_id::text], (v_hands->(v_opponent_id::text)) || v_drawn_card);
                END IF;
            END LOOP;
            
            v_next_turn_player_id := p_player_id; -- Mantém com o atual devido ao skip
            
        ELSIF v_card_value = 'wild_draw_four' THEN
            -- Oponente compra 4 cartas e perde o turno
            FOR v_i IN 1..4 LOOP
                IF jsonb_array_length(v_deck) = 0 THEN
                    SELECT array_agg(elem ORDER BY random()) INTO v_shuffled_deck
                    FROM jsonb_array_elements(v_discard_pile) WITH ORDINALITY t(elem, ord)
                    WHERE ord > 1;
                    
                    v_deck := coalesce(jsonb_concat(v_deck, to_jsonb(v_shuffled_deck)), '[]'::jsonb);
                    v_discard_pile := jsonb_build_array(v_discard_pile->0);
                END IF;
                
                IF jsonb_array_length(v_deck) > 0 THEN
                    v_drawn_card := v_deck->0;
                    v_deck := v_deck - 0;
                    v_hands := jsonb_set(v_hands, ARRAY[v_opponent_id::text], (v_hands->(v_opponent_id::text)) || v_drawn_card);
                END IF;
            END LOOP;
            
            v_next_turn_player_id := p_player_id; -- Mantém com o atual devido ao skip
            
        ELSE
            -- Carta normal: passa o turno
            v_next_turn_player_id := v_opponent_id;
        END IF;
        
        v_has_drawn := false;
        
        -- F. Checar vitória (mão vazia)
        IF jsonb_array_length(v_new_hand) = 0 THEN
            v_winner_id := p_player_id;
            v_is_finished := true;
            v_next_turn_player_id := NULL;
        END IF;

    ELSIF p_action_type = 'draw_card' THEN
        IF v_has_drawn THEN
            RAISE EXCEPTION 'ALREADY_DRAWN_THIS_TURN: Você já comprou uma carta neste turno.' USING ERRCODE = 'P0039';
        END IF;
        
        -- A. Comprar carta do deck
        IF jsonb_array_length(v_deck) = 0 THEN
            -- Re-embaralhar descarte
            SELECT array_agg(elem ORDER BY random()) INTO v_shuffled_deck
            FROM jsonb_array_elements(v_discard_pile) WITH ORDINALITY t(elem, ord)
            WHERE ord > 1;
            
            v_deck := coalesce(jsonb_concat(v_deck, to_jsonb(v_shuffled_deck)), '[]'::jsonb);
            v_discard_pile := jsonb_build_array(v_discard_pile->0);
        END IF;
        
        IF jsonb_array_length(v_deck) > 0 THEN
            v_drawn_card := v_deck->0;
            v_deck := v_deck - 0;
            v_hands := jsonb_set(v_hands, ARRAY[p_player_id::text], (v_hands->(p_player_id::text)) || v_drawn_card);
        ELSE
            RAISE EXCEPTION 'NO_CARDS_AVAILABLE: Não há mais cartas disponíveis no baralho.' USING ERRCODE = 'P0041';
        END IF;
        
        v_has_drawn := true;
        v_next_turn_player_id := p_player_id; -- Turno continua com o jogador para ele decidir se joga a carta ou passa

    ELSIF p_action_type = 'pass_turn' THEN
        IF NOT v_has_drawn THEN
            RAISE EXCEPTION 'CANNOT_PASS_WITHOUT_DRAW: Você só pode passar a vez se tiver comprado uma carta primeiro.' USING ERRCODE = 'P0040';
        END IF;
        
        v_next_turn_player_id := v_opponent_id;
        v_has_drawn := false;
        
    ELSE
        RAISE EXCEPTION 'INVALID_ACTION_TYPE: Ação desconhecida no Carta Duo.' USING ERRCODE = 'P0034';
    END IF;

    -- 5. Sincronizar placar (score representará a contagem de cartas na mão para fins informativos no roster)
    UPDATE public.match_players
    SET score = jsonb_array_length(v_hands->>(user_id::text))
    WHERE match_id = p_match_id;

    -- 6. Compilar o novo estado
    v_new_state := jsonb_build_object(
        'deck', v_deck,
        'discard_pile', v_discard_pile,
        'hands', v_hands,
        'current_color', v_current_color,
        'current_value', v_current_value,
        'has_drawn', v_has_drawn,
        'turn_player_id', v_next_turn_player_id,
        'winner_id', v_winner_id,
        'is_finished', v_is_finished,
        'last_move', jsonb_build_object(
            'action_type', p_action_type,
            'player_id', p_player_id,
            'card', v_card
        )
    );

    RETURN jsonb_build_object(
        'accepted', true,
        'new_state', v_new_state,
        'next_player_id', v_next_turn_player_id,
        'winner_id', v_winner_id,
        'is_draw', v_is_draw,
        'is_finished', v_is_finished
    );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_carta_duo_action(UUID, UUID, VARCHAR, JSONB, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;

-- 4. Registrar o roteador de Carta Duo na RPC de despacho central
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
    ELSIF p_game_id = 'carta_duo' THEN
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
