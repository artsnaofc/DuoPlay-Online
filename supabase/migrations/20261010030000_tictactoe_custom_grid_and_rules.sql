-- ============================================================================
-- Migration: 20261010030000_tictactoe_custom_grid_and_rules.sql
-- Project: DuoPlay-Online
-- Description:
--   1. Permite grids dinâmicos (3x3, 4x4, 5x5) e sequência de vitória (win_streak)
--      personalizável no validador oficial server-side validate_tic_tac_toe_action.
--   2. Preserva compatibilidade total com partidas padrão 3x3 legadas.
--   3. Valida posições em tempo de execução com base no tamanho do grid configurado.
-- ============================================================================

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
    v_is_winner BOOLEAN := false;
    v_winning_line JSONB := NULL;
    v_winner_id UUID := NULL;
    v_is_draw BOOLEAN := false;
    v_is_finished BOOLEAN := false;
    v_filled_count INTEGER := 0;
    v_new_board_json JSONB := '[]'::jsonb;
    v_symbols_json JSONB;
    v_new_state JSONB;
    v_match RECORD;
    v_grid_size INTEGER := 3;
    v_win_streak INTEGER := 3;
    v_total_cells INTEGER := 9;
    v_r INTEGER;
    v_c INTEGER;
    v_i INTEGER;
    v_idx INTEGER;
    v_cell_val TEXT;
    v_all_match BOOLEAN;
    v_cur_line INTEGER[];
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
        RAISE EXCEPTION 'INVALID_POSITION: A posição é obrigatória e deve ser um número inteiro.' USING ERRCODE = 'P0033';
    END IF;

    v_position := (p_payload->>'position')::INTEGER;

    -- 3. Obter configurações da partida (grid_size e win_streak)
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match.id IS NULL THEN
        RAISE EXCEPTION 'MATCH_NOT_FOUND: Partida não encontrada.' USING ERRCODE = 'P0016';
    END IF;

    IF v_match.config IS NOT NULL THEN
        v_grid_size := COALESCE((v_match.config->>'grid_size')::INTEGER, 3);
        v_win_streak := COALESCE((v_match.config->>'win_streak')::INTEGER, 3);
    END IF;

    -- Fallback se configurado no próprio p_current_state
    IF p_current_state IS NOT NULL AND p_current_state ? 'config' THEN
        v_grid_size := COALESCE((p_current_state->'config'->>'grid_size')::INTEGER, v_grid_size);
        v_win_streak := COALESCE((p_current_state->'config'->>'win_streak')::INTEGER, v_win_streak);
    END IF;

    -- Sanity check do tamanho do grid
    IF v_grid_size NOT IN (3, 4, 5) THEN
        v_grid_size := 3;
    END IF;

    IF v_win_streak < 3 OR v_win_streak > v_grid_size THEN
        v_win_streak := CASE WHEN v_grid_size = 5 THEN 4 ELSE v_grid_size END;
    END IF;

    v_total_cells := v_grid_size * v_grid_size;

    -- Validar faixa de posição para o grid correspondente
    IF v_position < 0 OR v_position >= v_total_cells THEN
        RAISE EXCEPTION 'INVALID_POSITION: A posição % está fora do tabuleiro (0 a %).', v_position, (v_total_cells - 1) USING ERRCODE = 'P0033';
    END IF;

    -- 4. Identificar os competidores oficiais (slots 1 e 2)
    SELECT user_id INTO v_player1_id
    FROM public.match_players
    WHERE match_id = p_match_id AND slot = 1;

    SELECT user_id INTO v_player2_id
    FROM public.match_players
    WHERE match_id = p_match_id AND slot = 2;

    IF v_player1_id IS NULL OR v_player2_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_MATCH_PLAYERS: A partida requer exatamente 2 competidores.' USING ERRCODE = 'P0036';
    END IF;

    IF p_player_id != v_player1_id AND p_player_id != v_player2_id THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: O usuário não é participante desta partida.' USING ERRCODE = 'P0018';
    END IF;

    -- 5. Determinação autoritativa de símbolo e oponente
    IF p_player_id = v_player1_id THEN
        v_my_symbol := 'X';
        v_next_player_id := v_player2_id;
    ELSE
        v_my_symbol := 'O';
        v_next_player_id := v_player1_id;
    END IF;

    -- 6. Reconstrução ou inicialização do tabuleiro server-side
    v_board := ARRAY[]::TEXT[];
    FOR i IN 0..(v_total_cells - 1) LOOP
        IF p_current_state IS NOT NULL AND p_current_state->'board' IS NOT NULL THEN
            v_board := array_append(v_board, p_current_state->'board'->>i);
        ELSE
            v_board := array_append(v_board, NULL);
        END IF;
    END LOOP;

    -- 7. Validação de casa livre (CELL_ALREADY_OCCUPIED)
    IF v_board[v_position + 1] IS NOT NULL THEN
        RAISE EXCEPTION 'CELL_ALREADY_OCCUPIED: A posição % já está ocupada por %.', v_position, v_board[v_position + 1] USING ERRCODE = 'P0032';
    END IF;

    -- 8. Aplicação da jogada oficial
    v_board[v_position + 1] := v_my_symbol;

    -- Sincronizar game_symbol em match_players
    UPDATE public.match_players
    SET game_symbol = (CASE WHEN slot = 1 THEN 'X' WHEN slot = 2 THEN 'O' ELSE NULL END)
    WHERE match_id = p_match_id AND (game_symbol IS NULL OR game_symbol != (CASE WHEN slot = 1 THEN 'X' WHEN slot = 2 THEN 'O' ELSE NULL END));

    -- 9. Verificação autoritativa de vitória dinâmica para N em linha (win_streak) no grid (grid_size)
    -- 9.1 Horizontais
    FOR v_r IN 0..(v_grid_size - 1) LOOP
        FOR v_c IN 0..(v_grid_size - v_win_streak) LOOP
            v_all_match := true;
            v_cur_line := ARRAY[]::INTEGER[];
            FOR v_i IN 0..(v_win_streak - 1) LOOP
                v_idx := v_r * v_grid_size + (v_c + v_i);
                v_cur_line := array_append(v_cur_line, v_idx);
                IF v_board[v_idx + 1] IS NULL OR v_board[v_idx + 1] != v_my_symbol THEN
                    v_all_match := false;
                    EXIT;
                END IF;
            END LOOP;
            IF v_all_match THEN
                v_is_winner := true;
                v_winning_line := to_jsonb(v_cur_line);
                EXIT;
            END IF;
        END LOOP;
        IF v_is_winner THEN EXIT; END IF;
    END LOOP;

    -- 9.2 Verticais
    IF NOT v_is_winner THEN
        FOR v_c IN 0..(v_grid_size - 1) LOOP
            FOR v_r IN 0..(v_grid_size - v_win_streak) LOOP
                v_all_match := true;
                v_cur_line := ARRAY[]::INTEGER[];
                FOR v_i IN 0..(v_win_streak - 1) LOOP
                    v_idx := (v_r + v_i) * v_grid_size + v_c;
                    v_cur_line := array_append(v_cur_line, v_idx);
                    IF v_board[v_idx + 1] IS NULL OR v_board[v_idx + 1] != v_my_symbol THEN
                        v_all_match := false;
                        EXIT;
                    END IF;
                END LOOP;
                IF v_all_match THEN
                    v_is_winner := true;
                    v_winning_line := to_jsonb(v_cur_line);
                    EXIT;
                END IF;
            END LOOP;
            IF v_is_winner THEN EXIT; END IF;
        END LOOP;
    END IF;

    -- 9.3 Diagonais Principais (top-left -> bottom-right)
    IF NOT v_is_winner THEN
        FOR v_r IN 0..(v_grid_size - v_win_streak) LOOP
            FOR v_c IN 0..(v_grid_size - v_win_streak) LOOP
                v_all_match := true;
                v_cur_line := ARRAY[]::INTEGER[];
                FOR v_i IN 0..(v_win_streak - 1) LOOP
                    v_idx := (v_r + v_i) * v_grid_size + (v_c + v_i);
                    v_cur_line := array_append(v_cur_line, v_idx);
                    IF v_board[v_idx + 1] IS NULL OR v_board[v_idx + 1] != v_my_symbol THEN
                        v_all_match := false;
                        EXIT;
                    END IF;
                END LOOP;
                IF v_all_match THEN
                    v_is_winner := true;
                    v_winning_line := to_jsonb(v_cur_line);
                    EXIT;
                END IF;
            END LOOP;
            IF v_is_winner THEN EXIT; END IF;
        END LOOP;
    END IF;

    -- 9.4 Diagonais Secundárias (top-right -> bottom-left)
    IF NOT v_is_winner THEN
        FOR v_r IN 0..(v_grid_size - v_win_streak) LOOP
            FOR v_c IN (v_win_streak - 1)..(v_grid_size - 1) LOOP
                v_all_match := true;
                v_cur_line := ARRAY[]::INTEGER[];
                FOR v_i IN 0..(v_win_streak - 1) LOOP
                    v_idx := (v_r + v_i) * v_grid_size + (v_c - v_i);
                    v_cur_line := array_append(v_cur_line, v_idx);
                    IF v_board[v_idx + 1] IS NULL OR v_board[v_idx + 1] != v_my_symbol THEN
                        v_all_match := false;
                        EXIT;
                    END IF;
                END LOOP;
                IF v_all_match THEN
                    v_is_winner := true;
                    v_winning_line := to_jsonb(v_cur_line);
                    EXIT;
                END IF;
            END LOOP;
            IF v_is_winner THEN EXIT; END IF;
        END LOOP;
    END IF;

    -- 10. Resolução de resultado da partida
    IF v_is_winner THEN
        v_winner_id := p_player_id;
        v_is_draw := false;
        v_is_finished := true;
        v_next_player_id := NULL;
    ELSE
        -- Contar posições preenchidas
        v_filled_count := 0;
        FOR i IN 1..v_total_cells LOOP
            IF v_board[i] IS NOT NULL THEN
                v_filled_count := v_filled_count + 1;
            END IF;
        END LOOP;

        IF v_filled_count = v_total_cells THEN
            v_winner_id := NULL;
            v_is_draw := true;
            v_is_finished := true;
            v_next_player_id := NULL;
        ELSE
            v_winner_id := NULL;
            v_is_draw := false;
            v_is_finished := false;
        END IF;
    END IF;

    -- 11. Construção determinística do novo game_state
    FOR i IN 1..v_total_cells LOOP
        v_new_board_json := v_new_board_json || to_jsonb(v_board[i]);
    END LOOP;

    v_symbols_json := jsonb_build_object(
        v_player1_id::text, 'X',
        v_player2_id::text, 'O'
    );

    v_new_state := jsonb_build_object(
        'board', v_new_board_json,
        'symbols', v_symbols_json,
        'winning_line', v_winning_line,
        'config', jsonb_build_object(
            'grid_size', v_grid_size,
            'win_streak', v_win_streak
        ),
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

REVOKE ALL ON FUNCTION public.validate_tic_tac_toe_action(UUID, UUID, VARCHAR, JSONB, JSONB, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_tic_tac_toe_action(UUID, UUID, VARCHAR, JSONB, JSONB, INTEGER) TO authenticated;
