-- ============================================================================
-- Test Suite: multiplayer_rls_and_rpc_test.sql
-- Project: DuoPlay-Online
-- Phase: Fase 3 — Backend Multiplayer (PostgreSQL, RPCs e Autoridade Server-Side)
-- Purpose: Validação de segurança, RLS em Rooms/Matches/Members/Players,
--          RPCs atômicas, idempotência, autorização do Host, turnos e restrições.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    -- Usuários simulados
    v_user_a UUID := 'a0000000-0000-0000-0000-000000000001'::uuid; -- Host Alpha
    v_user_b UUID := 'b0000000-0000-0000-0000-000000000002'::uuid; -- Competidor Beta
    v_user_c UUID := 'c0000000-0000-0000-0000-000000000003'::uuid; -- Invasor / 3º Jogador Gamma

    v_res JSONB;
    v_room_id UUID;
    v_room_code VARCHAR(6);
    v_match_id UUID;
    v_action_id UUID := gen_random_uuid();
    v_count INTEGER;
    v_blocked BOOLEAN;
    v_stats_matches_before INTEGER;
    v_stats_wins_before INTEGER;
    v_stats_matches_after INTEGER;
    v_stats_wins_after INTEGER;
BEGIN
    RAISE NOTICE '================================================================';
    RAISE NOTICE '>>> INICIANDO SUÍTE DE TESTES MULTIPLAYER DA FASE 3 (POSTGRES) <<<';
    RAISE NOTICE '================================================================';

    -- Setup: Criar perfis para os usuários A, B e C
    INSERT INTO public.profiles (id, username, display_name, total_matches, total_wins)
    VALUES 
        (v_user_a, 'player_alpha', 'Alpha Host', 0, 0),
        (v_user_b, 'player_beta', 'Beta Guest', 0, 0),
        (v_user_c, 'player_gamma', 'Gamma Intruder', 0, 0)
    ON CONFLICT (id) DO NOTHING;

    -- ------------------------------------------------------------------------
    -- TESTE 1: Usuário anônimo (anon) bloqueado de criar sala
    -- ------------------------------------------------------------------------
    SET LOCAL ROLE anon;
    SET LOCAL "request.jwt.claims" TO '{}';
    v_blocked := false;

    BEGIN
        PERFORM public.create_room('tic_tac_toe', 'Sala Anonima');
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 1: Usuário anônimo conseguiu invocar create_room!';
    ELSE
        RAISE NOTICE 'TESTE 1 OK: Usuário anônimo bloqueado de criar sala.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 2: Usuário anônimo (anon) bloqueado de ler rooms diretamente
    -- ------------------------------------------------------------------------
    SELECT count(*) INTO v_count FROM public.rooms;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FALHA TESTE 2: Usuário anônimo conseguiu ler linhas da tabela rooms!';
    ELSE
        RAISE NOTICE 'TESTE 2 OK: Usuário anônimo bloqueado de ler rooms (RLS ativo).';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 3: Usuário autenticado A cria sala com sucesso (Host oficial)
    -- ------------------------------------------------------------------------
    SET LOCAL ROLE authenticated;
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

    v_res := public.create_room('tic_tac_toe', 'DuoPlay Arena Alpha', true, 2);
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 3: Falha ao criar sala para o Usuário A!';
    END IF;

    v_room_id := (v_res->'data'->'room'->>'id')::uuid;
    v_room_code := v_res->'data'->'room'->>'code';

    IF v_room_code IS NULL OR char_length(v_room_code) <> 6 THEN
        RAISE EXCEPTION 'FALHA TESTE 3: Código de sala gerado é inválido: %', v_room_code;
    END IF;

    IF (v_res->'data'->'member'->>'slot_number')::int <> 1 THEN
        RAISE EXCEPTION 'FALHA TESTE 3: Host não foi alocado no Slot 1!';
    END IF;

    RAISE NOTICE 'TESTE 3 OK: Usuário A criou sala % com código % (Slot 1 Host).', v_room_id, v_room_code;

    -- ------------------------------------------------------------------------
    -- TESTE 4: Usuário B não consegue ver a sala antes de entrar (privacidade RLS)
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';

    SELECT count(*) INTO v_count FROM public.rooms WHERE id = v_room_id;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FALHA TESTE 4: Usuário B conseguiu listar diretamente a sala de A sem ser membro!';
    ELSE
        RAISE NOTICE 'TESTE 4 OK: Usuário B protegido por RLS (não lista sala alheia via SELECT direto).';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 5: Usuário B tenta entrar com código inválido (deve falhar)
    -- ------------------------------------------------------------------------
    v_blocked := false;
    BEGIN
        PERFORM public.join_room_by_code('ZZZZZZ');
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 5: Entrada com código inexistente não falhou!';
    ELSE
        RAISE NOTICE 'TESTE 5 OK: Código inexistente rejeitado pelo servidor.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 6: Usuário B entra com código correto (alocado no Slot 2)
    -- ------------------------------------------------------------------------
    v_res := public.join_room_by_code(v_room_code);
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 6: Usuário B não conseguiu entrar com código válido!';
    END IF;

    IF (v_res->'data'->'member'->>'slot_number')::int <> 2 THEN
        RAISE EXCEPTION 'FALHA TESTE 6: Usuário B não foi alocado no Slot 2!';
    END IF;

    RAISE NOTICE 'TESTE 6 OK: Usuário B entrou na sala via código e recebeu Slot 2.';

    -- ------------------------------------------------------------------------
    -- TESTE 7: Idempotência de join_room_by_code (Usuário B chama novamente)
    -- ------------------------------------------------------------------------
    v_res := public.join_room_by_code(v_room_code);
    IF (v_res->>'success')::boolean IS NOT TRUE OR (v_res->'data'->>'idempotent')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 7: Chamada repetida de join não retornou idempotente!';
    END IF;

    SELECT count(*) INTO v_count FROM public.room_members WHERE room_id = v_room_id;
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'FALHA TESTE 7: Duplicou membros na sala! Total: %', v_count;
    ELSE
        RAISE NOTICE 'TESTE 7 OK: Idempotência de join confirmada (sem membros duplicados).';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 8: Sala cheia rejeita novo competidor C (limite max_members = 2)
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "c0000000-0000-0000-0000-000000000003", "role": "authenticated"}';
    v_blocked := false;

    BEGIN
        PERFORM public.join_room_by_code(v_room_code);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 8: Terceiro jogador conseguiu entrar em sala com capacidade 2!';
    ELSE
        RAISE NOTICE 'TESTE 8 OK: Sala com capacidade cheia rejeitou novo membro.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 9: Não-Host (Usuário B) tenta iniciar partida (deve falhar)
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    v_blocked := false;

    BEGIN
        PERFORM public.start_match(v_room_id);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 9: Não-Host conseguiu invocar start_match!';
    ELSE
        RAISE NOTICE 'TESTE 9 OK: Permissão de start_match restrita exclusivamente ao Host.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 10: Host (Usuário A) tenta iniciar sem jogadores prontos (deve falhar)
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    v_blocked := false;

    BEGIN
        PERFORM public.start_match(v_room_id);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 10: Partida iniciou com jogador Beta não pronto!';
    ELSE
        RAISE NOTICE 'TESTE 10 OK: Início bloqueado enquanto houver competidores não-prontos.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 11: Usuário B confirma prontidão via set_member_ready
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';

    v_res := public.set_member_ready(v_room_id, true);
    IF (v_res->>'success')::boolean IS NOT TRUE OR (v_res->'data'->>'is_ready')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 11: Usuário B falhou ao definir status ready!';
    ELSE
        RAISE NOTICE 'TESTE 11 OK: Usuário B confirmou prontidão com sucesso.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 12: Host (Usuário A) inicia partida com sucesso (start_match)
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

    v_res := public.start_match(v_room_id);
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 12: Host A falhou ao iniciar a partida!';
    END IF;

    v_match_id := (v_res->'data'->'match'->>'id')::uuid;

    -- Validar congelamento da composição em match_players
    SELECT count(*) INTO v_count FROM public.match_players WHERE match_id = v_match_id;
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'FALHA TESTE 12: Quantidade de competidores congelados <> 2! (% encontrados)', v_count;
    ELSE
        RAISE NOTICE 'TESTE 12 OK: Partida % iniciada e composição de jogadores congelada.', v_match_id;
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 13: Idempotência de start_match (Host chama start novamente por retry)
    -- ------------------------------------------------------------------------
    v_res := public.start_match(v_room_id);
    IF (v_res->>'success')::boolean IS NOT TRUE OR (v_res->'data'->'match'->>'id')::uuid <> v_match_id THEN
        RAISE EXCEPTION 'FALHA TESTE 13: start_match concorrente/repetido não retornou a mesma partida!';
    ELSE
        RAISE NOTICE 'TESTE 13 OK: Idempotência de start_match confirmada.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 14: Jogador fora do turno tenta submeter ação (Usuário B na vez de A)
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
    v_blocked := false;

    BEGIN
        PERFORM public.submit_game_action(v_match_id, v_action_id, 'place_mark', '{"cell": 0}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 14: Jogador B conseguiu jogar fora da sua vez!';
    ELSE
        RAISE NOTICE 'TESTE 14 OK: Ação fora do turno rejeitada com segurança.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 15: Jogador do turno (Usuário A) submete ação oficial
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

    v_res := public.submit_game_action(v_match_id, v_action_id, 'place_mark', '{"cell": 4}'::jsonb);
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 15: Jogador A falhou ao submeter jogada válida!';
    END IF;

    IF (v_res->'data'->>'turn_number')::int <> 2 THEN
        RAISE EXCEPTION 'FALHA TESTE 15: Turn number não avançou para 2!';
    END IF;

    RAISE NOTICE 'TESTE 15 OK: Jogada submetida com sucesso, turno avançou para 2.';

    -- ------------------------------------------------------------------------
    -- TESTE 16: Idempotência de submit_game_action (mesmo action_id reenviado)
    -- ------------------------------------------------------------------------
    v_res := public.submit_game_action(v_match_id, v_action_id, 'place_mark', '{"cell": 4}'::jsonb);
    IF (v_res->>'success')::boolean IS NOT TRUE OR (v_res->'data'->>'idempotent')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 16: Reenvio de ação não foi reconhecido como idempotente!';
    ELSE
        RAISE NOTICE 'TESTE 16 OK: Idempotência de submit_game_action garantida via action_id.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 17: Jogador externo C tenta finalizar ou jogar na partida alheia
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "c0000000-0000-0000-0000-000000000003", "role": "authenticated"}';
    v_blocked := false;

    BEGIN
        PERFORM public.finish_match(v_match_id, 'resignation');
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 17: Jogador C externo conseguiu interferir na partida!';
    ELSE
        RAISE NOTICE 'TESTE 17 OK: Jogador externo bloqueado de intervir na partida alheia.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 18: Finalização autoritativa (Usuário B desiste voluntariamente)
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';

    SELECT total_matches, total_wins INTO v_stats_matches_before, v_stats_wins_before 
    FROM public.profiles WHERE id = v_user_a;

    v_res := public.finish_match(v_match_id, 'resignation');
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 18: Falha ao finalizar partida por desistência!';
    END IF;

    IF (v_res->'data'->>'winner_id')::uuid <> v_user_a THEN
        RAISE EXCEPTION 'FALHA TESTE 18: Vencedor não foi declarado como Jogador A!';
    END IF;

    RAISE NOTICE 'TESTE 18 OK: Partida finalizada com vitória atribuída ao Jogador A.';

    -- ------------------------------------------------------------------------
    -- TESTE 19: Atualização oficial de estatísticas no perfil via sistema
    -- ------------------------------------------------------------------------
    SELECT total_matches, total_wins INTO v_stats_matches_after, v_stats_wins_after 
    FROM public.profiles WHERE id = v_user_a;

    IF v_stats_matches_after <> v_stats_matches_before + 1 OR v_stats_wins_after <> v_stats_wins_before + 1 THEN
        RAISE EXCEPTION 'FALHA TESTE 19: Estatísticas de vitórias/partidas não foram incrementadas corretamente! (Matches: % -> %, Wins: % -> %)',
            v_stats_matches_before, v_stats_matches_after, v_stats_wins_before, v_stats_wins_after;
    ELSE
        RAISE NOTICE 'TESTE 19 OK: Estatísticas oficiais de perfil incrementadas atomicamente pelo servidor.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 20: Idempotência de finish_match (Rechamada não duplica estatísticas)
    -- ------------------------------------------------------------------------
    v_res := public.finish_match(v_match_id, 'resignation');
    SELECT total_matches INTO v_count FROM public.profiles WHERE id = v_user_a;

    IF v_count <> v_stats_matches_after THEN
        RAISE EXCEPTION 'FALHA TESTE 20: Rechamada de finish_match duplicou contagem de estatísticas!';
    ELSE
        RAISE NOTICE 'TESTE 20 OK: Idempotência de finish_match confirmada (sem duplicações).';
    END IF;

    RAISE NOTICE '================================================================';
    RAISE NOTICE '>>> TODOS OS 20 TESTES DA FASE 3 FORAM EXECUTADOS COM SUCESSO <<<';
    RAISE NOTICE '================================================================';
END;
$$;

ROLLBACK;
