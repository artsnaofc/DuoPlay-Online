-- ============================================================================
-- Migration: 20261007000000_create_tic_tac_toe_validator.sql
-- Project: DuoPlay-Online
-- Phase: Fase 4 — Validador Server-Side do Jogo da Velha (tic_tac_toe)
-- Description:
--   1. validate_tic_tac_toe_action(): Validador server-side oficial das regras
--      do Jogo da Velha (3x3). Determina de forma autoritativa:
--      - Validação estrita do payload (action_type = 'place_mark', position ∈ [0..8])
--      - Atribuição oficial de símbolos (Slot 1 = 'X', Slot 2 = 'O')
--      - Verificação de ocupação de casas (CELL_ALREADY_OCCUPIED)
--      - Detecção de vitória nas 8 linhas/colunas/diagonais
--      - Detecção de empate após 9 jogadas sem vencedor
--      - Alternância de turnos para o oponente
--      - Construção determinística do novo game_state
--   2. dispatch_game_action(): Registra o validador para 'tic_tac_toe' e
--      mantém o bloqueio estrito GAME_VALIDATOR_NOT_AVAILABLE para qualquer outro jogo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Validador Server-Side de Regras do Jogo da Velha (validate_tic_tac_toe_action)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_tic_tac_toe_action(
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
    v_my_symbol VARCHAR(1);
    v_next_player_id UUID;
    v_position INTEGER;
    v_board TEXT[];
    v_lines INTEGER[][];
    v_a INTEGER;
    v_b INTEGER;
    v_c INTEGER;
    v_is_winner BOOLEAN := false;
    v_winning_line JSONB := NULL;
    v_winner_id UUID := NULL;
    v_is_draw BOOLEAN := false;
    v_is_finished BOOLEAN := false;
    v_filled_count INTEGER := 0;
    v_new_board_json JSONB;
    v_symbols_json JSONB;
    v_new_state JSONB;
    i INTEGER;
BEGIN
    -- 1. Validar tipo de ação permitido
    IF p_action_type IS NULL OR p_action_type != 'place_mark' THEN
        RAISE EXCEPTION 'INVALID_ACTION_TYPE: Tipo de ação não reconhecido para Jogo da Velha (esperado: place_mark).' USING ERRCODE = 'P0034';
    END IF;

    -- 2. Validar payload da jogada
    IF p_payload IS NULL OR jsonb_typeof(p_payload) != 'object' THEN
        RAISE EXCEPTION 'INVALID_PAYLOAD: O payload da ação deve ser um objeto JSON.' USING ERRCODE = 'P0035';
    END IF;

    IF NOT (p_payload ? 'position') OR jsonb_typeof(p_payload->'position') != 'number' THEN
        RAISE EXCEPTION 'INVALID_POSITION: A posição é obrigatória e deve ser um número inteiro entre 0 e 8.' USING ERRCODE = 'P0033';
    END IF;

    -- Validação estrita de número inteiro 0..8 (rejeita strings, decimais como 4.5 e fora de faixa)
    IF NOT (p_payload->>'position' ~ '^[0-8]$') THEN
        RAISE EXCEPTION 'INVALID_POSITION: A posição deve ser um número inteiro entre 0 e 8.' USING ERRCODE = 'P0033';
    END IF;

    v_position := (p_payload->>'position')::INTEGER;

    -- 3. Identificar os 2 competidores oficiais congelados da partida
    SELECT user_id INTO v_player1_id
    FROM public.match_players
    WHERE match_id = p_match_id AND slot = 1;

    SELECT user_id INTO v_player2_id
    FROM public.match_players
    WHERE match_id = p_match_id AND slot = 2;

    IF v_player1_id IS NULL OR v_player2_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_MATCH_PLAYERS: A partida do Jogo da Velha requer exatamente 2 competidores (slots 1 e 2).' USING ERRCODE = 'P0036';
    END IF;

    IF p_player_id != v_player1_id AND p_player_id != v_player2_id THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: O usuário não é participante desta partida.' USING ERRCODE = 'P0018';
    END IF;

    -- 4. Determinação autoritativa de símbolo e oponente (Slot 1 = X, Slot 2 = O)
    -- O símbolo enviado pelo cliente (se houver) é expressamente ignorado.
    IF p_player_id = v_player1_id THEN
        v_my_symbol := 'X';
        v_next_player_id := v_player2_id;
    ELSE
        v_my_symbol := 'O';
        v_next_player_id := v_player1_id;
    END IF;

    -- 5. Reconstrução ou inicialização do tabuleiro server-side
    IF p_current_state IS NULL OR p_current_state->'board' IS NULL OR jsonb_typeof(p_current_state->'board') != 'array' THEN
        v_board := ARRAY[NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL]::TEXT[];
    ELSE
        v_board := ARRAY[
            p_current_state->'board'->>0,
            p_current_state->'board'->>1,
            p_current_state->'board'->>2,
            p_current_state->'board'->>3,
            p_current_state->'board'->>4,
            p_current_state->'board'->>5,
            p_current_state->'board'->>6,
            p_current_state->'board'->>7,
            p_current_state->'board'->>8
        ]::TEXT[];
    END IF;

    -- 6. Validação de casa livre (CELL_ALREADY_OCCUPIED)
    IF v_board[v_position + 1] IS NOT NULL THEN
        RAISE EXCEPTION 'CELL_ALREADY_OCCUPIED: A posição % já está ocupada por %.', v_position, v_board[v_position + 1] USING ERRCODE = 'P0032';
    END IF;

    -- 7. Aplicação da jogada oficial
    v_board[v_position + 1] := v_my_symbol;

    -- Sincronizar game_symbol em match_players caso necessário
    UPDATE public.match_players
    SET game_symbol = (CASE WHEN slot = 1 THEN 'X' WHEN slot = 2 THEN 'O' ELSE NULL END)
    WHERE match_id = p_match_id AND (game_symbol IS NULL OR game_symbol != (CASE WHEN slot = 1 THEN 'X' WHEN slot = 2 THEN 'O' ELSE NULL END));

    -- 8. Verificação autoritativa de vitória (8 combinações clássicas)
    v_lines := ARRAY[
        ARRAY[0, 1, 2], -- Linha superior
        ARRAY[3, 4, 5], -- Linha central
        ARRAY[6, 7, 8], -- Linha inferior
        ARRAY[0, 3, 6], -- Coluna esquerda
        ARRAY[1, 4, 7], -- Coluna central
        ARRAY[2, 5, 8], -- Coluna direita
        ARRAY[0, 4, 8], -- Diagonal principal
        ARRAY[2, 4, 6]  -- Diagonal secundária
    ];

    FOR i IN 1..8 LOOP
        v_a := v_lines[i][1];
        v_b := v_lines[i][2];
        v_c := v_lines[i][3];

        IF v_board[v_a + 1] IS NOT NULL AND 
           v_board[v_a + 1] = v_board[v_b + 1] AND 
           v_board[v_b + 1] = v_board[v_c + 1] THEN
            v_is_winner := true;
            v_winning_line := jsonb_build_array(v_a, v_b, v_c);
            EXIT;
        END IF;
    END LOOP;

    -- 9. Resolução de resultado da partida
    IF v_is_winner THEN
        v_winner_id := p_player_id;
        v_is_draw := false;
        v_is_finished := true;
        v_next_player_id := NULL;
    ELSE
        -- Contar posições preenchidas
        v_filled_count := 0;
        FOR i IN 1..9 LOOP
            IF v_board[i] IS NOT NULL THEN
                v_filled_count := v_filled_count + 1;
            END IF;
        END LOOP;

        IF v_filled_count = 9 THEN
            -- Tabuleiro completo sem vencedor: Empate (Draw)
            v_winner_id := NULL;
            v_is_draw := true;
            v_is_finished := true;
            v_next_player_id := NULL;
        ELSE
            -- Partida continua: Próximo turno para o oponente
            v_winner_id := NULL;
            v_is_draw := false;
            v_is_finished := false;
        END IF;
    END IF;

    -- 10. Construção determinística do novo game_state
    v_new_board_json := jsonb_build_array(
        v_board[1],
        v_board[2],
        v_board[3],
        v_board[4],
        v_board[5],
        v_board[6],
        v_board[7],
        v_board[8],
        v_board[9]
    );

    v_symbols_json := jsonb_build_object(
        v_player1_id::text, 'X',
        v_player2_id::text, 'O'
    );

    v_new_state := jsonb_build_object(
        'board', v_new_board_json,
        'symbols', v_symbols_json,
        'winning_line', v_winning_line,
        'last_move', jsonb_build_object(
            'position', v_position,
            'player_id', p_player_id,
            'symbol', v_my_symbol
        )
    );

    RETURN jsonb_build_object(
        'accepted', true,
        'new_state', v_new_state,
        'next_player_id', v_next_player_id,
        'winner_id', v_winner_id,
        'is_draw', v_is_draw,
        'is_finished', v_is_finished
    );
END;
$$;

-- Revogação estrita de permissões de execução externa direta no validador
REVOKE ALL ON FUNCTION public.validate_tic_tac_toe_action(UUID, UUID, VARCHAR, JSONB, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Despachador de Ações (dispatch_game_action)
-- ----------------------------------------------------------------------------
-- Encaminha ações de 'tic_tac_toe' para o validador oficial.
-- Mantém bloqueio explícito GAME_VALIDATOR_NOT_AVAILABLE ('P0030') para outros jogos.
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
    -- Roteamento autoritativo por game_id
    IF p_game_id = 'tic_tac_toe' THEN
        RETURN public.validate_tic_tac_toe_action(
            p_match_id,
            p_player_id,
            p_action_type,
            p_payload,
            p_current_state,
            p_turn_number
        );
    ELSE
        -- Jogos sem validador oficial registrado continuam com transação abortada
        RAISE EXCEPTION 'GAME_VALIDATOR_NOT_AVAILABLE: As regras deste jogo ainda não estão disponíveis no servidor para validar esta ação.' USING ERRCODE = 'P0030';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_game_action(VARCHAR, UUID, UUID, VARCHAR, JSONB, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
