-- ============================================================================
-- Test Suite: room_rls_and_lobby_test.sql
-- Project: DuoPlay-Online
-- Phase: Fase 7.0.2 — Correção do RLS e Carregamento do Lobby
-- Purpose: Validação de ausência de recursão em RLS (SQLSTATE 42P17),
--          leitura correta da sala e membros pelo host e convidados,
--          e bloqueio estrito de leitura para usuários externos.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    v_user_host UUID := 'f1000000-0000-0000-0000-000000000001'::uuid;
    v_user_guest UUID := 'f2000000-0000-0000-0000-000000000002'::uuid;
    v_user_outsider UUID := 'f3000000-0000-0000-0000-000000000003'::uuid;

    v_res JSONB;
    v_room_id UUID;
    v_room_code VARCHAR(6);
    v_count INTEGER;
    v_room_record RECORD;
    v_blocked BOOLEAN;
BEGIN
    RAISE NOTICE '====================================================================';
    RAISE NOTICE '>>> INICIANDO TESTES DA FASE 7.0.2 (RLS & LOBBY ACCESS) <<<';
    RAISE NOTICE '====================================================================';

    -- Setup: Perfis de teste
    INSERT INTO public.profiles (id, username, display_name, total_matches, total_wins, total_draws, total_losses)
    VALUES 
        (v_user_host, 'test_host_rls', 'Host RLS', 0, 0, 0, 0),
        (v_user_guest, 'test_guest_rls', 'Guest RLS', 0, 0, 0, 0),
        (v_user_outsider, 'test_outsider_rls', 'Outsider RLS', 0, 0, 0, 0)
    ON CONFLICT (id) DO NOTHING;

    -- Setup: Jogo no catálogo
    INSERT INTO public.games (id, name, description, min_players, max_players, is_active)
    VALUES ('tic_tac_toe', 'Jogo da Velha', 'Clássico 3x3', 2, 2, true)
    ON CONFLICT (id) DO NOTHING;

    -- ------------------------------------------------------------------------
    -- TESTE 1: Host cria sala e consegue ler sua sala e seus membros sem recursão
    -- ------------------------------------------------------------------------
    SET LOCAL ROLE authenticated;
    SET LOCAL "request.jwt.claims" TO '{"sub": "f1000000-0000-0000-0000-000000000001", "role": "authenticated"}';

    v_res := public.create_room('tic_tac_toe', 'Sala RLS Teste', true, 2);
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 1: Falha ao criar sala!';
    END IF;

    v_room_id := (v_res->'data'->'room'->>'id')::uuid;
    v_room_code := v_res->'data'->'room'->>'code';

    -- Consulta direta da sala pelo Host (Não pode disparar 42P17)
    SELECT * INTO v_room_record FROM public.rooms WHERE id = v_room_id;
    IF v_room_record.id IS NULL THEN
        RAISE EXCEPTION 'FALHA TESTE 1: Host não conseguiu ler sua própria sala via SELECT!';
    END IF;

    -- Consulta direta dos membros pelo Host (Não pode disparar 42P17)
    SELECT count(*) INTO v_count FROM public.room_members WHERE room_id = v_room_id;
    IF v_count != 1 THEN
        RAISE EXCEPTION 'FALHA TESTE 1: Host deve visualizar 1 membro na sala, obtido: %', v_count;
    END IF;

    RAISE NOTICE 'Teste 1 OK: Host conseguiu ler sala e membros sem erro de recursão (42P17).';

    -- ------------------------------------------------------------------------
    -- TESTE 2: Segundo jogador entra por código e ambos leem os 2 membros
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "f2000000-0000-0000-0000-000000000002", "role": "authenticated"}';

    v_res := public.join_room_by_code(v_room_code);
    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 2: Convidado não conseguiu entrar na sala!';
    END IF;

    -- Convidado consulta a sala e os membros
    SELECT * INTO v_room_record FROM public.rooms WHERE id = v_room_id;
    IF v_room_record.id IS NULL THEN
        RAISE EXCEPTION 'FALHA TESTE 2: Convidado não conseguiu ler a sala após entrar!';
    END IF;

    SELECT count(*) INTO v_count FROM public.room_members WHERE room_id = v_room_id;
    IF v_count != 2 THEN
        RAISE EXCEPTION 'FALHA TESTE 2: Convidado deve visualizar 2 membros na sala, obtido: %', v_count;
    END IF;

    -- Host volta e também deve visualizar os 2 membros
    SET LOCAL "request.jwt.claims" TO '{"sub": "f1000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    SELECT count(*) INTO v_count FROM public.room_members WHERE room_id = v_room_id;
    IF v_count != 2 THEN
        RAISE EXCEPTION 'FALHA TESTE 2: Host deve visualizar 2 membros na sala, obtido: %', v_count;
    END IF;

    RAISE NOTICE 'Teste 2 OK: Ambos os jogadores leem a sala e a lista completa de membros.';

    -- ------------------------------------------------------------------------
    -- TESTE 3: Usuário externo (não membro) tem leitura bloqueada pelo RLS
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "f3000000-0000-0000-0000-000000000003", "role": "authenticated"}';

    SELECT count(*) INTO v_count FROM public.rooms WHERE id = v_room_id;
    IF v_count != 0 THEN
        RAISE EXCEPTION 'FALHA TESTE 3: Usuário externo NÃO deve conseguir ler a sala privada!';
    END IF;

    SELECT count(*) INTO v_count FROM public.room_members WHERE room_id = v_room_id;
    IF v_count != 0 THEN
        RAISE EXCEPTION 'FALHA TESTE 3: Usuário externo NÃO deve conseguir ler membros da sala privada!';
    END IF;

    RAISE NOTICE 'Teste 3 OK: Usuário externo tem acesso negado a sala e membros pelo RLS.';

    -- ------------------------------------------------------------------------
    -- TESTE 4: Usuário não autenticado (anon) tem leitura bloqueada
    -- ------------------------------------------------------------------------
    SET LOCAL ROLE anon;
    SET LOCAL "request.jwt.claims" TO '{}';

    SELECT count(*) INTO v_count FROM public.rooms WHERE id = v_room_id;
    IF v_count != 0 THEN
        RAISE EXCEPTION 'FALHA TESTE 4: Anon não pode ler salas privadas!';
    END IF;

    SELECT count(*) INTO v_count FROM public.room_members WHERE room_id = v_room_id;
    IF v_count != 0 THEN
        RAISE EXCEPTION 'FALHA TESTE 4: Anon não pode ler room_members!';
    END IF;

    RAISE NOTICE 'Teste 4 OK: Anon bloqueado com sucesso.';

    RAISE NOTICE '====================================================================';
    RAISE NOTICE '>>> TODOS OS TESTES DA FASE 7.0.2 PASSARAM COM SUCESSO! <<<';
    RAISE NOTICE '====================================================================';
END;
$$;

ROLLBACK;
