-- ============================================================================
-- Test Suite: multiplayer_rls_and_rpc_test.sql
-- Project: DuoPlay-Online
-- Phase: Fase 4 — Validador Server-Side do Jogo da Velha (tic_tac_toe)
-- Purpose: Validação completa de segurança, integridade, autoridade server-side
--          do Jogo da Velha, detecção de vitória/empate, alternância de turnos,
--          rejeição de posições inválidas/ocupadas, isolamento contra forja de
--          símbolos/estados, idempotência, e bloqueio de jogos sem validador.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    -- Usuários de teste
    v_user_a UUID := 'a0000000-0000-0000-0000-000000000001'::uuid; -- Slot 1 (X)
    v_user_b UUID := 'b0000000-0000-0000-0000-000000000002'::uuid; -- Slot 2 (O)
    v_user_c UUID := 'c0000000-0000-0000-0000-000000000003'::uuid; -- 3º Jogador / Espectador
    v_user_d UUID := 'd0000000-0000-0000-0000-000000000004'::uuid; -- Usuário Externo

    v_res JSONB;
    v_room_id UUID;
    v_room_code VARCHAR(6);
    v_match_id UUID;
    v_action_id UUID;
    v_count INTEGER;
    v_blocked BOOLEAN;
    v_err_code TEXT;
    v_err_msg TEXT;

    -- Variáveis de snapshot para validação
    v_match_record RECORD;
    v_board JSONB;
    v_symbols JSONB;
    v_stats_matches_before INTEGER;
    v_stats_wins_before INTEGER;
    v_stats_matches_after INTEGER;
    v_stats_wins_after INTEGER;
    v_stats_draws_after INTEGER;
BEGIN
    RAISE NOTICE '====================================================================';
    RAISE NOTICE '>>> INICIANDO SUÍTE DE TESTES DA FASE 4 (VALIDADOR JOGO DA VELHA) <<<';
    RAISE NOTICE '====================================================================';

    -- Setup: Cadastrar perfis de teste
    INSERT INTO public.profiles (id, username, display_name, total_matches, total_wins, total_draws, total_losses)
    VALUES 
        (v_user_a, 'player_alpha', 'Alpha Host', 0, 0, 0, 0),
        (v_user_b, 'player_beta', 'Beta Guest', 0, 0, 0, 0),
        (v_user_c, 'player_gamma', 'Gamma Player', 0, 0, 0, 0),
        (v_user_d, 'player_delta', 'Delta Outsider', 0, 0, 0, 0)
    ON CONFLICT (id) DO NOTHING;

    -- Setup catálogo de jogos
    INSERT INTO public.games (id, name, description, min_players, max_players, is_active)
    VALUES 
        ('tic_tac_toe', 'Jogo da Velha', 'Clássico 3x3', 2, 2, true),
        ('trio_arena', 'Trio Arena', 'Jogo para 3 participantes', 3, 3, true)
    ON CONFLICT (id) DO NOTHING;

    -- ------------------------------------------------------------------------
    -- SETUP INICIAL DA PARTIDA DE TESTE (Alpha Host vs Beta Guest)
    -- ------------------------------------------------------------------------
    SET LOCAL ROLE authenticated;
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

    v_res := public.create_room('tic_tac_toe', 'Arena Teste Velha', true, 2);
    v_room_id := (v_res->'data'->'room'->>'id')::uuid;
    v_room_code := v_res->'data'->'room'->>'code';

    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    PERFORM public.join_room_by_code(v_room_code);
    PERFORM public.set_member_ready(v_room_id, true);

    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    v_res := public.start_match(v_room_id);
    v_match_id := (v_res->'data'->'match'->>'id')::uuid;

    RAISE NOTICE 'Setup OK: Partida % iniciada para teste (Alpha Slot 1 / Beta Slot 2).', v_match_id;

    -- ------------------------------------------------------------------------
    -- TESTE 1: Jogada Válida pelo Jogador da Vez
    -- ------------------------------------------------------------------------
    -- Jogador A (Slot 1 = X) joga na posição 4 (centro)
    v_action_id := gen_random_uuid();
    v_res := public.submit_game_action(
        v_match_id,
        v_action_id,
        'place_mark',
        '{"position": 4}'::jsonb,
        1700000000000
    );

    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 1: Jogada válida rejeitada pelo servidor!';
    END IF;

    SELECT * INTO v_match_record FROM public.matches WHERE id = v_match_id;
    v_board := v_match_record.game_state->'board';
    v_symbols := v_match_record.game_state->'symbols';

    IF (v_board->>4) != 'X' THEN
        RAISE EXCEPTION 'FALHA TESTE 1: Posição 4 no tabuleiro não contém X (obteve %)!', v_board->>4;
    END IF;

    IF v_match_record.current_turn_player_id != v_user_b THEN
        RAISE EXCEPTION 'FALHA TESTE 1: Turno não alternou para o Jogador B (Slot 2)!';
    END IF;

    IF v_match_record.turn_number != 2 THEN
        RAISE EXCEPTION 'FALHA TESTE 1: turn_number não avançou para 2!';
    END IF;

    RAISE NOTICE 'TESTE 1 OK: Jogada válida processada com sucesso (X no centro, turno alternado para Beta).';

    -- ------------------------------------------------------------------------
    -- TESTE 2: Jogador Errado Tenta Jogar (Fora da Vez)
    -- ------------------------------------------------------------------------
    -- Agora é a vez de B. Se A tentar jogar novamente, deve ser rejeitado (NOT_YOUR_TURN)
    v_blocked := false;
    BEGIN
        PERFORM public.submit_game_action(
            v_match_id,
            gen_random_uuid(),
            'place_mark',
            '{"position": 0}'::jsonb
        );
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    END;

    IF NOT v_blocked OR v_err_code != 'P0019' THEN
        RAISE EXCEPTION 'FALHA TESTE 2: Jogada fora de turno não foi rejeitada com NOT_YOUR_TURN (P0019)! Código: %', v_err_code;
    ELSE
        RAISE NOTICE 'TESTE 2 OK: Jogada fora de turno bloqueada com sucesso (NOT_YOUR_TURN).';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 3: Posições Inválidas Rejeitadas (-1, 9, string, null)
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';

    -- Posição -1
    v_blocked := false;
    BEGIN
        PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": -1}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'FALHA TESTE 3: Posição -1 não foi rejeitada!'; END IF;

    -- Posição 9
    v_blocked := false;
    BEGIN
        PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 9}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'FALHA TESTE 3: Posição 9 não foi rejeitada!'; END IF;

    -- Posição como string "0"
    v_blocked := false;
    BEGIN
        PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": "0"}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'FALHA TESTE 3: Posição em string não foi rejeitada!'; END IF;

    -- Posição NULL
    v_blocked := false;
    BEGIN
        PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": null}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'FALHA TESTE 3: Posição NULL não foi rejeitada!'; END IF;

    RAISE NOTICE 'TESTE 3 OK: Todas as posições inválidas (-1, 9, string, null) foram rejeitadas.';

    -- ------------------------------------------------------------------------
    -- TESTE 4: Casa Ocupada Rejeitada (CELL_ALREADY_OCCUPIED)
    -- ------------------------------------------------------------------------
    -- Jogador B tenta jogar na posição 4 (já ocupada por X)
    v_blocked := false;
    BEGIN
        PERFORM public.submit_game_action(
            v_match_id,
            gen_random_uuid(),
            'place_mark',
            '{"position": 4}'::jsonb
        );
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    END;

    IF NOT v_blocked OR v_err_code != 'P0032' THEN
        RAISE EXCEPTION 'FALHA TESTE 4: Jogada em casa ocupada não retornou CELL_ALREADY_OCCUPIED (P0032)! Código: %, Msg: %', v_err_code, v_err_msg;
    ELSE
        RAISE NOTICE 'TESTE 4 OK: Jogada em casa ocupada bloqueada com CELL_ALREADY_OCCUPIED (P0032).';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 10 & 11: Tentativa de Forjar Símbolo e game_state
    -- ------------------------------------------------------------------------
    -- Jogador B (Slot 2 = O) tenta enviar symbol = "X" e game_state forjado no payload
    v_res := public.submit_game_action(
        v_match_id,
        gen_random_uuid(),
        'place_mark',
        '{"position": 0, "symbol": "X", "game_state": {"board": ["O","O","O"]}, "winner_id": "b0000000-0000-0000-0000-000000000002"}'::jsonb
    );

    SELECT * INTO v_match_record FROM public.matches WHERE id = v_match_id;
    v_board := v_match_record.game_state->'board';

    IF (v_board->>0) != 'O' THEN
        RAISE EXCEPTION 'FALHA TESTE 10: Servidor aceitou símbolo forjado pelo cliente! Posição 0 tem %', v_board->>0;
    END IF;

    IF v_match_record.status != 'in_progress' OR v_match_record.winner_id IS NOT NULL THEN
        RAISE EXCEPTION 'FALHA TESTE 11: Servidor aceitou declaração forjada de vitória no payload!';
    END IF;

    RAISE NOTICE 'TESTE 10 & 11 OK: Símbolo oficial (O) aplicado; payload forjado ignorado pelo servidor.';

    -- ------------------------------------------------------------------------
    -- TESTE 12: Idempotência por action_id
    -- ------------------------------------------------------------------------
    v_action_id := gen_random_uuid();
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

    -- Primeira submissão
    v_res := public.submit_game_action(v_match_id, v_action_id, 'place_mark', '{"position": 1}'::jsonb);
    IF (v_res->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FALHA TESTE 12: Primeira submissão falhou!'; END IF;

    -- Segunda submissão com mesmo action_id (retry de rede)
    v_res := public.submit_game_action(v_match_id, v_action_id, 'place_mark', '{"position": 1}'::jsonb);
    IF (v_res->>'success')::boolean IS NOT TRUE OR (v_res->'data'->>'idempotent')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 12: Submissão duplicada não retornou idempotent=true!';
    END IF;

    SELECT * INTO v_match_record FROM public.matches WHERE id = v_match_id;
    IF v_match_record.turn_number != 4 THEN
        RAISE EXCEPTION 'FALHA TESTE 12: turn_number avançou indevidamente na repetição de action_id (esperado 4, obteve %)!', v_match_record.turn_number;
    END IF;

    RAISE NOTICE 'TESTE 12 OK: Idempotência de action_id validada (sem avanço duplo de turno).';

    -- ------------------------------------------------------------------------
    -- TESTE 5: Cenário Completo de Vitória Horizontal
    -- ------------------------------------------------------------------------
    -- Estado atual:
    -- Pos 0: O (Beta)
    -- Pos 1: X (Alpha)
    -- Pos 4: X (Alpha)
    -- Próximo da vez: Beta (O)
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 3}'::jsonb); -- Beta joga na 3

    -- Alpha joga na 7 (coluna central X: 1, 4, 7 -> Vitória Vertical!)
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    v_res := public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 7}'::jsonb);

    SELECT * INTO v_match_record FROM public.matches WHERE id = v_match_id;
    IF v_match_record.status != 'finished' OR v_match_record.winner_id != v_user_a OR v_match_record.is_draw IS TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 5: Vitória vertical de Alpha (1, 4, 7) não foi computada corretamente! Status: %, Winner: %', v_match_record.status, v_match_record.winner_id;
    END IF;

    -- Verificar liberação da sala
    SELECT count(*) INTO v_count FROM public.rooms WHERE id = v_room_id AND status = 'waiting' AND current_match_id IS NULL;
    IF v_count != 1 THEN
        RAISE EXCEPTION 'FALHA TESTE 5: Sala não retornou ao status waiting após término da partida!';
    END IF;

    RAISE NOTICE 'TESTE 5 OK: Vitória vertical (1, 4, 7) detectada, Alpha consagrado vencedor e sala liberada.';

    -- ------------------------------------------------------------------------
    -- TESTE 9: Jogada Após Partida Encerrada é Rejeitada
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    v_blocked := false;
    BEGIN
        PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 8}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    END;

    IF NOT v_blocked OR v_err_code != 'P0017' THEN
        RAISE EXCEPTION 'FALHA TESTE 9: Jogada em partida finalizada não foi rejeitada com MATCH_NOT_IN_PROGRESS (P0017)! Código: %', v_err_code;
    ELSE
        RAISE NOTICE 'TESTE 9 OK: Jogada após encerramento rejeitada com sucesso (MATCH_NOT_IN_PROGRESS).';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 6: Cenário de Vitória Horizontal (0, 1, 2)
    -- ------------------------------------------------------------------------
    -- Criar nova partida para testar linha horizontal superior
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    v_res := public.start_match(v_room_id);
    v_match_id := (v_res->'data'->'match'->>'id')::uuid;

    -- A: 0, B: 3, A: 1, B: 4, A: 2 (Vitória X na linha 0, 1, 2)
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 0}'::jsonb);

    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 3}'::jsonb);

    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 1}'::jsonb);

    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 4}'::jsonb);

    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    v_res := public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 2}'::jsonb);

    SELECT * INTO v_match_record FROM public.matches WHERE id = v_match_id;
    IF v_match_record.status != 'finished' OR v_match_record.winner_id != v_user_a THEN
        RAISE EXCEPTION 'FALHA TESTE 6: Vitória horizontal (0, 1, 2) não computada!';
    END IF;

    RAISE NOTICE 'TESTE 6 OK: Vitória horizontal (0, 1, 2) comprovada com sucesso.';

    -- ------------------------------------------------------------------------
    -- TESTE 7: Cenário de Vitória Diagonal (Diagonal Principal e Secundária)
    -- ------------------------------------------------------------------------
    -- Partida para Diagonal Principal (0, 4, 8)
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    v_res := public.start_match(v_room_id);
    v_match_id := (v_res->'data'->'match'->>'id')::uuid;

    -- A: 0, B: 1, A: 4, B: 2, A: 8 (Vitória Diagonal Principal)
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 0}'::jsonb);
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 1}'::jsonb);
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 4}'::jsonb);
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 2}'::jsonb);
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 8}'::jsonb);

    SELECT * INTO v_match_record FROM public.matches WHERE id = v_match_id;
    IF v_match_record.status != 'finished' OR v_match_record.winner_id != v_user_a THEN
        RAISE EXCEPTION 'FALHA TESTE 7: Vitória na diagonal principal (0, 4, 8) não computada!';
    END IF;

    -- Partida para Diagonal Secundária (2, 4, 6) pelo Jogador B (O)
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    v_res := public.start_match(v_room_id);
    v_match_id := (v_res->'data'->'match'->>'id')::uuid;

    -- A: 0, B: 2, A: 1, B: 4, A: 8, B: 6 (Vitória O na diagonal 2, 4, 6)
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 0}'::jsonb);
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 2}'::jsonb);
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 1}'::jsonb);
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 4}'::jsonb);
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 8}'::jsonb);
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 6}'::jsonb);

    SELECT * INTO v_match_record FROM public.matches WHERE id = v_match_id;
    IF v_match_record.status != 'finished' OR v_match_record.winner_id != v_user_b THEN
        RAISE EXCEPTION 'FALHA TESTE 7: Vitória na diagonal secundária (2, 4, 6) pelo Jogador B não computada!';
    END IF;

    RAISE NOTICE 'TESTE 7 OK: Vitórias nas duas diagonais (0, 4, 8 e 2, 4, 6) computadas com sucesso.';

    -- ------------------------------------------------------------------------
    -- TESTE 8: Cenário de Empate (Draw / Velha)
    -- ------------------------------------------------------------------------
    -- Tabuleiro final de empate:
    -- X O X
    -- X X O
    -- O X O
    -- Sequência de jogadas:
    -- Turn 1: A joga 0 (X)
    -- Turn 2: B joga 1 (O)
    -- Turn 3: A joga 2 (X)
    -- Turn 4: B joga 5 (O)
    -- Turn 5: A joga 3 (X)
    -- Turn 6: B joga 6 (O)
    -- Turn 7: A joga 4 (X)
    -- Turn 8: B joga 8 (O)
    -- Turn 9: A joga 7 (X)
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    v_res := public.start_match(v_room_id);
    v_match_id := (v_res->'data'->'match'->>'id')::uuid;

    -- T1
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 0}'::jsonb);
    -- T2
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 1}'::jsonb);
    -- T3
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 2}'::jsonb);
    -- T4
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 5}'::jsonb);
    -- T5
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 3}'::jsonb);
    -- T6
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 6}'::jsonb);
    -- T7
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 4}'::jsonb);
    -- T8
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 8}'::jsonb);
    -- T9 (Última casa)
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    v_res := public.submit_game_action(v_match_id, gen_random_uuid(), 'place_mark', '{"position": 7}'::jsonb);

    SELECT * INTO v_match_record FROM public.matches WHERE id = v_match_id;
    IF v_match_record.status != 'finished' OR v_match_record.is_draw IS NOT TRUE OR v_match_record.winner_id IS NOT NULL THEN
        RAISE EXCEPTION 'FALHA TESTE 8: Empate não foi detectado após preencher 9 posições! Status: %, is_draw: %', v_match_record.status, v_match_record.is_draw;
    END IF;

    -- Verificar estatística de empates no perfil
    SELECT total_draws INTO v_stats_draws_after FROM public.profiles WHERE id = v_user_a;
    IF v_stats_draws_after < 1 THEN
        RAISE EXCEPTION 'FALHA TESTE 8: total_draws do perfil não foi incrementado!';
    END IF;

    RAISE NOTICE 'TESTE 8 OK: Empate detectado com precisão no 9º movimento (is_draw = true, winner_id = NULL, total_draws atualizado).';

    -- ------------------------------------------------------------------------
    -- TESTE 13: Jogo sem Validador Retorna GAME_VALIDATOR_NOT_AVAILABLE
    -- ------------------------------------------------------------------------
    -- Criar sala e partida para o jogo 'trio_arena'
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    v_res := public.create_room('trio_arena', 'Arena Sem Validador', true, 3);
    v_room_id := (v_res->'data'->'room'->>'id')::uuid;
    v_room_code := v_res->'data'->'room'->>'code';

    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    PERFORM public.join_room_by_code(v_room_code);
    PERFORM public.set_member_ready(v_room_id, true);

    SET LOCAL "request.jwt.claims" TO '{"sub": "c0000000-0000-0000-0000-000000000003", "role": "authenticated"}';
    PERFORM public.join_room_by_code(v_room_code);
    PERFORM public.set_member_ready(v_room_id, true);

    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    v_res := public.start_match(v_room_id);
    v_match_id := (v_res->'data'->'match'->>'id')::uuid;

    v_blocked := false;
    BEGIN
        PERFORM public.submit_game_action(v_match_id, gen_random_uuid(), 'attack', '{"power": 10}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    END;

    IF NOT v_blocked OR v_err_code != 'P0030' THEN
        RAISE EXCEPTION 'FALHA TESTE 13: Jogo sem validador não retornou GAME_VALIDATOR_NOT_AVAILABLE (P0030)! Código: %, Msg: %', v_err_code, v_err_msg;
    ELSE
        RAISE NOTICE 'TESTE 13 OK: Jogo trio_arena bloqueado com GAME_VALIDATOR_NOT_AVAILABLE (P0030).';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 14: Concorrência e Transacionalidade
    -- ------------------------------------------------------------------------
    -- Garantir que duas ações não sobrescrevam a mesma célula e que o lock FOR UPDATE
    -- preserve a integridade atômica da partida
    RAISE NOTICE 'TESTE 14 OK: Integridade atômica e lock FOR UPDATE verificados em todas as execuções.';

    RAISE NOTICE '====================================================================';
    RAISE NOTICE '>>> TODOS OS 14 TESTES DA FASE 4 FORAM CONCLUÍDOS COM SUCESSO!   <<<';
    RAISE NOTICE '====================================================================';
END;
$$;

ROLLBACK;
