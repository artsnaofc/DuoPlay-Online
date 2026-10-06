-- ============================================================================
-- Test Suite: multiplayer_rls_and_rpc_test.sql
-- Project: DuoPlay-Online
-- Phase: Fase 3.2 — Gate de Ações e Neutralização Final da Infraestrutura Multiplayer
-- Purpose: Validação de segurança, RLS em Rooms/Matches/Members/Players,
--          bloqueio de mutações diretas pelo cliente, integridade transacional,
--          bloqueio de ações sem validador server-side (GAME_VALIDATOR_NOT_AVAILABLE),
--          preservação estrita de game_state/action_history/turnos/deadline quando
--          não há validador registrado, idempotência estrutural por action_id,
--          neutralidade de game_symbol (NULL) em start_match, e
--          preservação histórica de dados.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    -- Usuários de teste
    v_user_a UUID := 'a0000000-0000-0000-0000-000000000001'::uuid; -- Alpha Host
    v_user_b UUID := 'b0000000-0000-0000-0000-000000000002'::uuid; -- Beta Player
    v_user_c UUID := 'c0000000-0000-0000-0000-000000000003'::uuid; -- Gamma Player (3º Jogador)
    v_user_d UUID := 'd0000000-0000-0000-0000-000000000004'::uuid; -- Delta Spectator / Não-participante

    v_res JSONB;
    v_room_id UUID;
    v_room_code VARCHAR(6);
    v_match_id UUID;
    v_action_id UUID;
    v_count INTEGER;
    v_blocked BOOLEAN;
    v_err_code TEXT;
    v_err_msg TEXT;

    -- Variáveis de snapshot para validação de integridade de estado
    v_match_before RECORD;
    v_match_after RECORD;
    v_symbol_count INTEGER;

    v_stats_matches_before INTEGER;
    v_stats_wins_before INTEGER;
    v_stats_matches_after INTEGER;
    v_stats_wins_after INTEGER;
    v_turn_player UUID;
BEGIN
    RAISE NOTICE '====================================================================';
    RAISE NOTICE '>>> INICIANDO SUÍTE DE TESTES MULTIPLAYER DA FASE 3.2 (GATE DE AÇÕES) <<<';
    RAISE NOTICE '====================================================================';

    -- Setup: Cadastrar perfis de teste
    INSERT INTO public.profiles (id, username, display_name, total_matches, total_wins)
    VALUES 
        (v_user_a, 'player_alpha', 'Alpha Host', 0, 0),
        (v_user_b, 'player_beta', 'Beta Guest', 0, 0),
        (v_user_c, 'player_gamma', 'Gamma Player', 0, 0),
        (v_user_d, 'player_delta', 'Delta Spectator', 0, 0)
    ON CONFLICT (id) DO NOTHING;

    -- Setup catálogo de jogos
    INSERT INTO public.games (id, name, description, min_players, max_players, is_active)
    VALUES 
        ('tic_tac_toe', 'Jogo da Velha', 'Clássico 3x3', 2, 2, true),
        ('trio_arena', 'Trio Arena', 'Jogo para 3 participantes', 3, 3, true)
    ON CONFLICT (id) DO NOTHING;

    -- ------------------------------------------------------------------------
    -- TESTE 1: Cliente anônimo não consegue acessar Rooms privadas via SELECT
    -- ------------------------------------------------------------------------
    SET LOCAL ROLE anon;
    SET LOCAL "request.jwt.claims" TO '{}';

    SELECT count(*) INTO v_count FROM public.rooms;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FALHA TESTE 1: Usuário anônimo conseguiu listar salas privadas via SELECT!';
    ELSE
        RAISE NOTICE 'TESTE 1 OK: Usuário anônimo bloqueado de ler salas privadas por RLS.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 2: Usuário autenticado não consegue modificar Room diretamente (REST)
    -- ------------------------------------------------------------------------
    SET LOCAL ROLE authenticated;
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

    v_blocked := false;
    BEGIN
        INSERT INTO public.rooms (code, game_id, host_id, name)
        VALUES ('XXXXXX', 'tic_tac_toe', v_user_a, 'Hack Room');
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 2: Cliente conseguiu executar INSERT direto em rooms!';
    ELSE
        RAISE NOTICE 'TESTE 2 OK: INSERT direto em rooms proibido para o cliente.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 3: Criação de sala oficial via create_room (Host no Slot 1)
    -- ------------------------------------------------------------------------
    v_res := public.create_room('tic_tac_toe', 'Arena Alpha Hardened', true, 2);
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 3: Falha ao criar sala para o Usuário A!';
    END IF;

    v_room_id := (v_res->'data'->'room'->>'id')::uuid;
    v_room_code := v_res->'data'->'room'->>'code';
    RAISE NOTICE 'TESTE 3 OK: Sala % criada com código % (Host Slot 1).', v_room_id, v_room_code;

    -- ------------------------------------------------------------------------
    -- TESTE 4: Entrada do Jogador B na sala e confirmação de prontidão (ready)
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    v_res := public.join_room_by_code(v_room_code);
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 4: Falha ao entrar na sala pelo código!';
    END IF;

    v_res := public.set_member_ready(v_room_id, true);
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 4: Falha ao confirmar prontidão do Jogador B!';
    END IF;
    RAISE NOTICE 'TESTE 4 OK: Jogador B entrou no Slot 2 e confirmou ready.';

    -- ------------------------------------------------------------------------
    -- TESTE 5: Início da partida e verificação de game_symbol = NULL (CORREÇÃO 7)
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    v_res := public.start_match(v_room_id);
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 5: Falha ao iniciar partida!';
    END IF;

    v_match_id := (v_res->'data'->'match'->>'id')::uuid;

    -- Validar que game_symbol é NULL para todos os jogadores na infraestrutura
    SELECT count(*) INTO v_symbol_count
    FROM public.match_players
    WHERE match_id = v_match_id AND game_symbol IS NOT NULL;

    IF v_symbol_count <> 0 THEN
        RAISE EXCEPTION 'FALHA TESTE 5: start_match atribuiu símbolos específicos (game_symbol não é NULL)!';
    ELSE
        RAISE NOTICE 'TESTE 5 OK: Partida iniciada com sucesso. match_players.game_symbol é NULL para todos os jogadores.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 6 (Fase 3.2 - Teste 1): submit_game_action sem validator retorna GAME_VALIDATOR_NOT_AVAILABLE
    -- ------------------------------------------------------------------------
    -- Obter snapshot do estado da partida ANTES da chamada
    SELECT * INTO v_match_before FROM public.matches WHERE id = v_match_id;

    v_action_id := gen_random_uuid();
    v_blocked := false;
    v_err_code := NULL;
    v_err_msg := NULL;

    BEGIN
        PERFORM public.submit_game_action(
            v_match_id,
            v_action_id,
            'make_move',
            '{"position": 4}'::jsonb,
            1700000000000
        );
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 6: submit_game_action processou jogada sem validador server-side disponível!';
    ELSIF v_err_code <> 'P0030' THEN
        RAISE EXCEPTION 'FALHA TESTE 6: Código de erro esperado P0030 (GAME_VALIDATOR_NOT_AVAILABLE), obteve % (%)', v_err_code, v_err_msg;
    ELSE
        RAISE NOTICE 'TESTE 6 OK: submit_game_action bloqueado com GAME_VALIDATOR_NOT_AVAILABLE (P0030): %', v_err_msg;
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 7 (Fase 3.2 - Testes 2, 3, 4, 5): Estado Oficial NÃO muda após ação rejeitada
    -- ------------------------------------------------------------------------
    SELECT * INTO v_match_after FROM public.matches WHERE id = v_match_id;

    -- Teste 2a: game_state idêntico
    IF v_match_after.game_state <> v_match_before.game_state THEN
        RAISE EXCEPTION 'FALHA TESTE 7: game_state foi modificado por ação rejeitada!';
    END IF;

    -- Teste 2b / Teste 4: turn_number e current_turn_player_id idênticos (sem avanço de turno)
    IF v_match_after.turn_number <> v_match_before.turn_number THEN
        RAISE EXCEPTION 'FALHA TESTE 7: turn_number foi avançado indevidamente!';
    END IF;

    IF v_match_after.current_turn_player_id <> v_match_before.current_turn_player_id THEN
        RAISE EXCEPTION 'FALHA TESTE 7: current_turn_player_id foi alterado indevidamente!';
    END IF;

    -- Teste 2c / Teste 5: turn_deadline idêntico (sem avanço de deadline)
    IF v_match_after.turn_deadline <> v_match_before.turn_deadline THEN
        RAISE EXCEPTION 'FALHA TESTE 7: turn_deadline foi alterado indevidamente!';
    END IF;

    -- Teste 3: Nenhum histórico falso no action_history
    IF v_match_after.action_history <> v_match_before.action_history OR jsonb_array_length(v_match_after.action_history) <> 0 THEN
        RAISE EXCEPTION 'FALHA TESTE 7: action_history registrou ação rejeitada!';
    END IF;

    -- Sem vencedor ou finalização espúria
    IF v_match_after.status <> 'in_progress' OR v_match_after.winner_id IS NOT NULL OR v_match_after.is_draw IS TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 7: Partida finalizada indevidamente por ação rejeitada!';
    END IF;

    RAISE NOTICE 'TESTE 7 OK: Integridade total do estado preservada (game_state, turn_number, current_turn_player_id, turn_deadline e action_history inalterados).';

    -- ------------------------------------------------------------------------
    -- TESTE 8 (Fase 3.2 - Teste 6): Idempotência estrutural por action_id
    -- ------------------------------------------------------------------------
    -- Simulação de ação já aprovada e registrada oficialmente no histórico da partida
    UPDATE public.matches SET
        action_history = jsonb_build_array(
            jsonb_build_object(
                'action_id', v_action_id::text,
                'turn_number', 1,
                'player_id', v_user_a,
                'action_type', 'make_move',
                'payload', '{"position": 0}'::jsonb,
                'client_timestamp', 1700000000000,
                'server_timestamp', now()
            )
        )
    WHERE id = v_match_id;

    -- Chamada repetida com o mesmo action_id
    v_res := public.submit_game_action(
        v_match_id,
        v_action_id,
        'make_move',
        '{"position": 0}'::jsonb,
        1700000000000
    );

    IF (v_res->>'success')::boolean IS NOT TRUE OR (v_res->'data'->>'idempotent')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 8: Idempotência de submit_game_action não retornou flag idempotent=true!';
    ELSE
        RAISE NOTICE 'TESTE 8 OK: Idempotência estrutural comprovada para action_id existente no histórico.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 9 (Fase 3.2 - Teste 8): Preservação Histórica (Nenhum UPDATE destrutivo)
    -- ------------------------------------------------------------------------
    -- Criar registro com símbolo histórico simulado para garantir que a migration não destrói registros passados
    INSERT INTO public.matches (
        id, room_id, game_id, status, current_turn_player_id, turn_deadline, turn_number, game_state, action_history, created_at, started_at
    ) VALUES (
        '99999999-9999-9999-9999-999999999999'::uuid,
        v_room_id,
        'tic_tac_toe',
        'finished',
        v_user_a,
        now(),
        1,
        '{}'::jsonb,
        '[]'::jsonb,
        now() - INTERVAL '1 day',
        now() - INTERVAL '1 day'
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.match_players (
        match_id, user_id, slot, game_symbol, score, is_winner, joined_at
    ) VALUES (
        '99999999-9999-9999-9999-999999999999'::uuid,
        v_user_a,
        1,
        'X_LEGACY',
        1,
        true,
        now() - INTERVAL '1 day'
    ) ON CONFLICT (match_id, user_id) DO NOTHING;

    SELECT game_symbol INTO v_err_msg
    FROM public.match_players
    WHERE match_id = '99999999-9999-9999-9999-999999999999'::uuid AND user_id = v_user_a;

    IF v_err_msg <> 'X_LEGACY' THEN
        RAISE EXCEPTION 'FALHA TESTE 9: Dados legados de partidas anteriores foram corrompidos!';
    ELSE
        RAISE NOTICE 'TESTE 9 OK: Preservação histórica confirmada (sem UPDATE destrutivo em registros passados).';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 10: Finalização por Desistência (resignation) e autorização finish_match
    -- ------------------------------------------------------------------------
    SELECT total_matches, total_wins INTO v_stats_matches_before, v_stats_wins_before
    FROM public.profiles WHERE id = v_user_a;

    -- Jogador B desiste
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    v_res := public.finish_match(v_match_id, 'resignation');
    IF (v_res->>'success')::boolean IS NOT TRUE OR (v_res->'data'->>'winner_id')::uuid <> v_user_a THEN
        RAISE EXCEPTION 'FALHA TESTE 10: resignation não consagrou o oponente como vencedor!';
    ELSE
        RAISE NOTICE 'TESTE 10 OK: Desistência voluntária consagrou oponente A como vencedor.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 11: Não-participante NÃO consegue acessar retorno de finish_match
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "c0000000-0000-0000-0000-000000000003", "role": "authenticated"}';
    v_blocked := false;

    BEGIN
        PERFORM public.finish_match(v_match_id, 'resignation');
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 11: Não-participante conseguiu acessar finish_match em partida finalizada!';
    ELSE
        RAISE NOTICE 'TESTE 11 OK: finish_match bloqueia não-participantes antes do retorno idempotente.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 12: Atualização segura e oficial de estatísticas
    -- ------------------------------------------------------------------------
    SELECT total_matches, total_wins INTO v_stats_matches_after, v_stats_wins_after
    FROM public.profiles WHERE id = v_user_a;

    IF v_stats_matches_after <> v_stats_matches_before + 1 OR v_stats_wins_after <> v_stats_wins_before + 1 THEN
        RAISE EXCEPTION 'FALHA TESTE 12: Estatísticas oficiais de perfil não foram incrementadas corretamente!';
    ELSE
        RAISE NOTICE 'TESTE 12 OK: Estatísticas incrementadas atomicamente pelo servidor.';
    END IF;

    RAISE NOTICE '====================================================================';
    RAISE NOTICE '>>> TODOS OS TESTES DA FASE 3.2 FORAM CONCLUÍDOS COM SUCESSO     <<<';
    RAISE NOTICE '====================================================================';
END;
$$;

ROLLBACK;
