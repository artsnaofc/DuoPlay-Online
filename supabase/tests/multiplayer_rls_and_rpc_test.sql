-- ============================================================================
-- Test Suite: multiplayer_rls_and_rpc_test.sql
-- Project: DuoPlay-Online
-- Phase: Fase 3.1 — Hardening Final do Backend Multiplayer
-- Purpose: Validação de segurança, RLS em Rooms/Matches/Members/Players,
--          bloqueio de mutações diretas, impossibilidade de clientes forjarem
--          resultados ou abandonos, rotação determinística 1->2->3->1,
--          imutabilidade estrita de ID/created_at, integridade de estatísticas,
--          NÃO contaminação de game_state por payload arbitrário do cliente, e
--          validação de autorização em finish_match antes da idempotência.
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
    v_stats_matches_before INTEGER;
    v_stats_wins_before INTEGER;
    v_stats_matches_after INTEGER;
    v_stats_wins_after INTEGER;
    v_turn_player UUID;
    v_state_check JSONB;
BEGIN
    RAISE NOTICE '====================================================================';
    RAISE NOTICE '>>> INICIANDO SUÍTE DE TESTES MULTIPLAYER DA FASE 3.1 (HARDENED)  <<<';
    RAISE NOTICE '====================================================================';

    -- Setup: Cadastrar perfis de teste
    INSERT INTO public.profiles (id, username, display_name, total_matches, total_wins)
    VALUES 
        (v_user_a, 'player_alpha', 'Alpha Host', 0, 0),
        (v_user_b, 'player_beta', 'Beta Guest', 0, 0),
        (v_user_c, 'player_gamma', 'Gamma Player', 0, 0),
        (v_user_d, 'player_delta', 'Delta Spectator', 0, 0)
    ON CONFLICT (id) DO NOTHING;

    -- Garantir jogo para 3 jogadores no catálogo para testar cenários 3+
    INSERT INTO public.games (id, name, description, min_players, max_players, is_active)
    VALUES ('trio_arena', 'Trio Arena', 'Jogo para 3 participantes', 3, 3, true)
    ON CONFLICT (id) DO NOTHING;

    -- ------------------------------------------------------------------------
    -- TESTE 1: Cliente anônimo não consegue acessar Rooms privadas
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
    -- TESTE 4: Usuário não consegue modificar Match diretamente via REST
    -- ------------------------------------------------------------------------
    v_blocked := false;
    BEGIN
        INSERT INTO public.matches (game_id, status)
        VALUES ('tic_tac_toe', 'finished');
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 4: Cliente conseguiu executar INSERT direto em matches!';
    ELSE
        RAISE NOTICE 'TESTE 4 OK: INSERT direto em matches bloqueado com sucesso.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 5: Jogador B entra como player em waiting via join_room_by_code
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';

    v_res := public.join_room_by_code(v_room_code);
    IF (v_res->>'success')::boolean IS NOT TRUE OR (v_res->'data'->'member'->>'slot_number')::int <> 2 THEN
        RAISE EXCEPTION 'FALHA TESTE 5: Jogador B falhou ao entrar no Slot 2!';
    ELSE
        RAISE NOTICE 'TESTE 5 OK: Jogador B entrou na sala em waiting e recebeu Slot 2.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 6: Usuário D entra como espectador
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "d0000000-0000-0000-0000-000000000004", "role": "authenticated"}';

    -- Ajustar capacidade da sala para permitir espectador
    UPDATE public.rooms SET max_members = 4 WHERE id = v_room_id;

    v_res := public.join_room_by_code(v_room_code, true);
    IF (v_res->>'success')::boolean IS NOT TRUE OR (v_res->'data'->'member'->>'role') <> 'spectator' THEN
        RAISE EXCEPTION 'FALHA TESTE 6: Espectador D não conseguiu entrar como spectator!';
    ELSE
        RAISE NOTICE 'TESTE 6 OK: Usuário D entrou como espectador (sem slot de jogador).';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 7: Espectador NÃO consegue marcar ready (set_member_ready bloqueado)
    -- ------------------------------------------------------------------------
    v_blocked := false;
    BEGIN
        PERFORM public.set_member_ready(v_room_id, true);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 7: Espectador conseguiu marcar ready!';
    ELSE
        RAISE NOTICE 'TESTE 7 OK: Espectador bloqueado de marcar ready.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 8: Jogador B altera ready com sucesso em waiting
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';

    v_res := public.set_member_ready(v_room_id, true);
    IF (v_res->>'success')::boolean IS NOT TRUE OR (v_res->'data'->>'is_ready')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 8: Jogador B não conseguiu definir ready em waiting!';
    ELSE
        RAISE NOTICE 'TESTE 8 OK: Jogador B confirmou prontidão em waiting.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 9: Host inicia partida via start_match (game_symbol é NULL na infra)
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

    v_res := public.start_match(v_room_id);
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 9: start_match falhou!';
    END IF;

    v_match_id := (v_res->'data'->'match'->>'id')::uuid;

    -- Verificar que game_symbol não contém regras hardcoded de X/O na infraestrutura
    SELECT count(*) INTO v_count FROM public.match_players WHERE match_id = v_match_id AND game_symbol IS NOT NULL;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FALHA TESTE 9: game_symbol contém símbolos de jogo na infraestrutura!';
    ELSE
        RAISE NOTICE 'TESTE 9 OK: Partida iniciada com composição congelada e game_symbol neutro (NULL).';
    END IF;

    -- Verificar que espectador NÃO foi inserido em match_players
    SELECT count(*) INTO v_count FROM public.match_players WHERE match_id = v_match_id AND user_id = v_user_d;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FALHA TESTE 9: Espectador foi inserido indevidamente em match_players!';
    ELSE
        RAISE NOTICE 'TESTE 9 OK: Apenas jogadores competidores foram inseridos em match_players.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 10: Jogador NÃO consegue alterar ready durante in_game
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    v_blocked := false;

    BEGIN
        PERFORM public.set_member_ready(v_room_id, false);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 10: Jogador conseguiu alterar ready com sala in_game!';
    ELSE
        RAISE NOTICE 'TESTE 10 OK: Alteração de ready bloqueada durante in_game.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 11: Novo jogador NÃO consegue entrar como player em sala in_game
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "c0000000-0000-0000-0000-000000000003", "role": "authenticated"}';
    v_blocked := false;

    BEGIN
        PERFORM public.join_room_by_code(v_room_code, false);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 11: Jogador conseguiu entrar como player em sala in_game!';
    ELSE
        RAISE NOTICE 'TESTE 11 OK: Entrada de jogador bloqueada em sala in_game.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 12: Payload arbitrário do cliente NÃO contamina matches.game_state
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    v_action_id := gen_random_uuid();

    v_res := public.submit_game_action(v_match_id, v_action_id, 'fake_action', '{"arbitrary_data": "hacked", "winner": "me"}'::jsonb);
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 12: submit_game_action falhou ao processar envelope!';
    END IF;

    SELECT game_state INTO v_state_check FROM public.matches WHERE id = v_match_id;
    IF v_state_check ? 'last_payload' OR v_state_check ? 'arbitrary_data' THEN
        RAISE EXCEPTION 'FALHA TESTE 12: matches.game_state foi contaminado diretamente pelo payload do cliente: %', v_state_check;
    ELSE
        RAISE NOTICE 'TESTE 12 OK: Payload arbitrário do cliente NÃO alterou o game_state oficial.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 13: finish_match(normal) é REJEITADO para chamadas diretas de clientes
    -- ------------------------------------------------------------------------
    v_blocked := false;
    BEGIN
        PERFORM public.finish_match(v_match_id, 'normal', v_user_a, false);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 13: Cliente conseguiu declarar vitória normal arbitrária!';
    ELSE
        RAISE NOTICE 'TESTE 13 OK: finish_match(normal) bloqueado contra manipulação do cliente.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 14: finish_match(abandonment) é REJEITADO (Grace Period ainda não existe)
    -- ------------------------------------------------------------------------
    v_blocked := false;
    BEGIN
        PERFORM public.finish_match(v_match_id, 'abandonment');
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 14: Cliente conseguiu declarar abandono falso!';
    ELSE
        RAISE NOTICE 'TESTE 14 OK: finish_match(abandonment) bloqueado na Fase 3.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 15: finish_match(timeout) REJEITADO quando prazo do servidor não expirou
    -- ------------------------------------------------------------------------
    v_blocked := false;
    BEGIN
        PERFORM public.finish_match(v_match_id, 'timeout');
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 15: Timeout aceito antes da expiração do prazo oficial!';
    ELSE
        RAISE NOTICE 'TESTE 15 OK: Timeout prematuro rejeitado pelo relógio do servidor.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 16: Jogador que sai da sala NÃO altera a composição congelada de match_players
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';

    PERFORM public.leave_room(v_room_id);

    SELECT count(*) INTO v_count FROM public.match_players WHERE match_id = v_match_id AND user_id = v_user_b;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'FALHA TESTE 16: leave_room alterou indevidamente a composição congelada da partida!';
    ELSE
        RAISE NOTICE 'TESTE 16 OK: Regra Room != Match respeitada (match_players permaneceu congelada).';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 17: Finalização por Desistência (resignation) consagra o oponente
    -- ------------------------------------------------------------------------
    SELECT total_matches, total_wins INTO v_stats_matches_before, v_stats_wins_before
    FROM public.profiles WHERE id = v_user_a;

    -- Jogador B desiste
    v_res := public.finish_match(v_match_id, 'resignation');
    IF (v_res->>'success')::boolean IS NOT TRUE OR (v_res->'data'->>'winner_id')::uuid <> v_user_a THEN
        RAISE EXCEPTION 'FALHA TESTE 17: resignation não consagrou o oponente como vencedor!';
    ELSE
        RAISE NOTICE 'TESTE 17 OK: Desistência voluntária consagrou oponente A como vencedor.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 18: Usuário NÃO PARTICIPANTE NÃO consegue consultar partida finalizada via finish_match
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "c0000000-0000-0000-0000-000000000003", "role": "authenticated"}';
    v_blocked := false;

    BEGIN
        PERFORM public.finish_match(v_match_id, 'resignation');
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 18: Usuário não participante conseguiu obter dados da partida finalizada via finish_match!';
    ELSE
        RAISE NOTICE 'TESTE 18 OK: finish_match autentica e autoriza chamador ANTES do retorno idempotente.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 19: Usuário PARTICIPANTE obtém resposta idempotente de partida finalizada
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

    v_res := public.finish_match(v_match_id, 'resignation');
    IF (v_res->>'success')::boolean IS NOT TRUE OR (v_res->'data'->>'idempotent')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 19: Participante não recebeu resposta idempotente em partida finalizada!';
    ELSE
        RAISE NOTICE 'TESTE 19 OK: Participante autorizado recebeu retorno idempotente em partida finalizada.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 20: Atualização oficial de estatísticas no perfil via sistema
    -- ------------------------------------------------------------------------
    SELECT total_matches, total_wins INTO v_stats_matches_after, v_stats_wins_after
    FROM public.profiles WHERE id = v_user_a;

    IF v_stats_matches_after <> v_stats_matches_before + 1 OR v_stats_wins_after <> v_stats_wins_before + 1 THEN
        RAISE EXCEPTION 'FALHA TESTE 20: Estatísticas oficiais de perfil não foram incrementadas corretamente!';
    ELSE
        RAISE NOTICE 'TESTE 20 OK: Estatísticas incrementadas atomicamente pelo servidor.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 21: Operação interna NÃO permite alterar profiles.id
    -- ------------------------------------------------------------------------
    v_blocked := false;
    BEGIN
        PERFORM set_config('duoplay.internal_system_operation', 'true', true);
        UPDATE public.profiles SET id = gen_random_uuid() WHERE id = v_user_a;
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 21: Operação interna conseguiu alterar o ID do perfil!';
    ELSE
        RAISE NOTICE 'TESTE 21 OK: Modificação de profiles.id bloqueada inclusive sob operação interna.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 22: Operação interna NÃO permite alterar profiles.created_at
    -- ------------------------------------------------------------------------
    v_blocked := false;
    BEGIN
        PERFORM set_config('duoplay.internal_system_operation', 'true', true);
        UPDATE public.profiles SET created_at = '2000-01-01 00:00:00+00' WHERE id = v_user_a;
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 22: Operação interna conseguiu alterar created_at do perfil!';
    ELSE
        RAISE NOTICE 'TESTE 22 OK: Modificação de created_at bloqueada inclusive sob operação interna.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 23: Rotação determinística de turnos para 3 jogadores (1 -> 2 -> 3 -> 1)
    -- ------------------------------------------------------------------------
    -- Criar sala para 3 jogadores
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    v_res := public.create_room('trio_arena', 'Arena Trio', true, 3);
    v_room_id := (v_res->'data'->'room'->>'id')::uuid;
    v_room_code := v_res->'data'->'room'->>'code';

    -- Jogador B entra no Slot 2
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    PERFORM public.join_room_by_code(v_room_code);
    PERFORM public.set_member_ready(v_room_id, true);

    -- Jogador C entra no Slot 3
    SET LOCAL "request.jwt.claims" TO '{"sub": "c0000000-0000-0000-0000-000000000003", "role": "authenticated"}';
    PERFORM public.join_room_by_code(v_room_code);
    PERFORM public.set_member_ready(v_room_id, true);

    -- Host A inicia partida de 3 jogadores
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    v_res := public.start_match(v_room_id);
    v_match_id := (v_res->'data'->'match'->>'id')::uuid;

    -- Turno 1: Jogador A (Slot 1) joga -> próximo deve ser Jogador B (Slot 2)
    v_action_id := gen_random_uuid();
    v_res := public.submit_game_action(v_match_id, v_action_id, 'play', '{"action": 1}'::jsonb);
    SELECT current_turn_player_id INTO v_turn_player FROM public.matches WHERE id = v_match_id;
    IF v_turn_player <> v_user_b THEN
        RAISE EXCEPTION 'FALHA TESTE 23: Rotação após Slot 1 esperava Jogador B (Slot 2), obteve %', v_turn_player;
    END IF;

    -- Turno 2: Jogador B (Slot 2) joga -> próximo deve ser Jogador C (Slot 3)
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    v_action_id := gen_random_uuid();
    v_res := public.submit_game_action(v_match_id, v_action_id, 'play', '{"action": 2}'::jsonb);
    SELECT current_turn_player_id INTO v_turn_player FROM public.matches WHERE id = v_match_id;
    IF v_turn_player <> v_user_c THEN
        RAISE EXCEPTION 'FALHA TESTE 23: Rotação após Slot 2 esperava Jogador C (Slot 3), obteve %', v_turn_player;
    END IF;

    -- Turno 3: Jogador C (Slot 3) joga -> próximo deve fazer wrap-around para Jogador A (Slot 1)
    SET LOCAL "request.jwt.claims" TO '{"sub": "c0000000-0000-0000-0000-000000000003", "role": "authenticated"}';
    v_action_id := gen_random_uuid();
    v_res := public.submit_game_action(v_match_id, v_action_id, 'play', '{"action": 3}'::jsonb);
    SELECT current_turn_player_id INTO v_turn_player FROM public.matches WHERE id = v_match_id;
    IF v_turn_player <> v_user_a THEN
        RAISE EXCEPTION 'FALHA TESTE 23: Rotação após Slot 3 esperava wrap-around para Jogador A (Slot 1), obteve %', v_turn_player;
    ELSE
        RAISE NOTICE 'TESTE 23 OK: Rotação determinística de turnos (1 -> 2 -> 3 -> 1) comprovada.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 24: Desistência em partida de 3+ jogadores rejeita resolução simplista
    -- ------------------------------------------------------------------------
    v_blocked := false;
    BEGIN
        PERFORM public.finish_match(v_match_id, 'resignation');
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 24: Desistência em 3 jogadores atribuiu vencedor único indevidamente!';
    ELSE
        RAISE NOTICE 'TESTE 24 OK: Desistência em 3+ jogadores rejeitou resolução de vencedor único não definida.';
    END IF;

    RAISE NOTICE '====================================================================';
    RAISE NOTICE '>>> TODOS OS 24 TESTES DE HARDENING DA FASE 3.1 CONCLUÍDOS COM SUCESSO <<<';
    RAISE NOTICE '====================================================================';
END;
$$;

ROLLBACK;
