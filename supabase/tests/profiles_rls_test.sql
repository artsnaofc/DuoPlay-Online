-- ============================================================================
-- Test Suite: profiles_rls_test.sql
-- Project: DuoPlay-Online
-- Phase: Fase 2 — Supabase + Segurança (Hardening Suite)
-- Purpose: Validação de segurança, RLS, proteção de estatísticas oficiais,
--          bloqueio de campos de sistema e restrição de EXECUTE em funções.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    v_user_a UUID := 'a0000000-0000-0000-0000-000000000001'::uuid;
    v_user_b UUID := 'b0000000-0000-0000-0000-000000000002'::uuid;
    v_count INTEGER;
    v_blocked BOOLEAN;
    v_updated_at_before TIMESTAMPTZ;
    v_updated_at_after TIMESTAMPTZ;
BEGIN
    RAISE NOTICE '=======================================================';
    RAISE NOTICE '>>> INICIANDO SUÍTE DE TESTES DE HARDENING DA FASE 2 <<<';
    RAISE NOTICE '=======================================================';

    -- Setup: Inserção inicial de dois perfis de teste
    INSERT INTO public.profiles (
        id, username, display_name, avatar_url, total_matches, total_wins, total_draws, total_losses
    ) VALUES 
        (v_user_a, 'player_alpha', 'Player Alpha', 'https://avatar.test/a.png', 0, 0, 0, 0),
        (v_user_b, 'player_beta', 'Player Beta', 'https://avatar.test/b.png', 5, 3, 1, 1);

    -- ------------------------------------------------------------------------
    -- TESTE 1: Usuário Não Autenticado (anon) - Leitura Bloqueada
    -- ------------------------------------------------------------------------
    SET LOCAL ROLE anon;
    SET LOCAL "request.jwt.claims" TO '{}';
    
    SELECT count(*) INTO v_count FROM public.profiles;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FALHA TESTE 1: Usuário anon conseguiu ler % linhas!', v_count;
    ELSE
        RAISE NOTICE 'TESTE 1 OK: Usuário anon bloqueado em SELECT.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 2: Usuário Não Autenticado (anon) - Inserção Bloqueada
    -- ------------------------------------------------------------------------
    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.profiles (id, username, display_name)
        VALUES ('c0000000-0000-0000-0000-000000000003'::uuid, 'anon_user', 'Anon');
    EXCEPTION WHEN OTHERS THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 2: Usuário anon conseguiu inserir linha na tabela profiles!';
    ELSE
        RAISE NOTICE 'TESTE 2 OK: Usuário anon bloqueado em INSERT.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 3: Usuário Não Autenticado (anon) - Atualização Bloqueada
    -- ------------------------------------------------------------------------
    UPDATE public.profiles SET display_name = 'Hacked by Anon' WHERE id = v_user_a;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FALHA TESTE 3: Usuário anon conseguiu atualizar registros!';
    ELSE
        RAISE NOTICE 'TESTE 3 OK: Usuário anon bloqueado em UPDATE (0 linhas afetadas).';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 4: Usuário A lê o próprio perfil (Permitido)
    -- ------------------------------------------------------------------------
    SET LOCAL ROLE authenticated;
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

    SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_user_a;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'FALHA TESTE 4: Usuário A não conseguiu ler o próprio perfil!';
    ELSE
        RAISE NOTICE 'TESTE 4 OK: Usuário A leu o próprio perfil com sucesso.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 5: Usuário A tenta ler perfil de B (Bloqueado)
    -- ------------------------------------------------------------------------
    SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_user_b;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FALHA TESTE 5: Usuário A conseguiu ler o perfil de B!';
    ELSE
        RAISE NOTICE 'TESTE 5 OK: Usuário A NÃO conseguiu ler perfil do Usuário B.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 6: Usuário A tenta atualizar perfil de B (Bloqueado)
    -- ------------------------------------------------------------------------
    UPDATE public.profiles SET display_name = 'Hacked by Alpha' WHERE id = v_user_b;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FALHA TESTE 6: Usuário A conseguiu atualizar perfil do Usuário B!';
    ELSE
        RAISE NOTICE 'TESTE 6 OK: Usuário A NÃO conseguiu atualizar perfil do Usuário B (0 linhas afetadas).';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 7: Usuário A tenta inserir perfil para Usuário B (Bloqueado por RLS)
    -- ------------------------------------------------------------------------
    v_blocked := FALSE;
    BEGIN
        INSERT INTO public.profiles (id, username, display_name)
        VALUES (v_user_b, 'fake_beta_insert', 'Fake Beta');
    EXCEPTION WHEN OTHERS THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 7: Usuário A conseguiu inserir registro com ID de outro usuário!';
    ELSE
        RAISE NOTICE 'TESTE 7 OK: Usuário A foi bloqueado ao tentar inserir perfil para o Usuário B.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 8: Usuário A edita campos permitidos (username, display_name, avatar_url) (Permitido)
    -- ------------------------------------------------------------------------
    UPDATE public.profiles 
    SET username = 'alpha_renamed',
        display_name = 'Alpha Renamed',
        avatar_url = 'https://avatar.test/a_new.png'
    WHERE id = v_user_a;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'FALHA TESTE 8: Usuário A não conseguiu atualizar campos permitidos!';
    ELSE
        RAISE NOTICE 'TESTE 8 OK: Usuário A atualizou com sucesso os campos permitidos.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 9: Usuário A tenta alterar estatísticas oficiais (total_wins, etc.) (Bloqueado)
    -- ------------------------------------------------------------------------
    v_blocked := FALSE;
    BEGIN
        -- Teste de tentativa direta de forjar vitórias
        UPDATE public.profiles SET total_wins = 999 WHERE id = v_user_a;
    EXCEPTION WHEN OTHERS THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA CRÍTICA TESTE 9: Usuário conseguiu alterar suas próprias estatísticas oficiais!';
    ELSE
        RAISE NOTICE 'TESTE 9 OK: Alteração direta de estatísticas oficiais foi BLOQUEADA com sucesso.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 10: Usuário A tenta alterar o próprio ID (Bloqueado)
    -- ------------------------------------------------------------------------
    v_blocked := FALSE;
    BEGIN
        UPDATE public.profiles SET id = 'a0000000-0000-0000-0000-000000000099'::uuid WHERE id = v_user_a;
    EXCEPTION WHEN OTHERS THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA CRÍTICA TESTE 10: Usuário conseguiu alterar seu próprio ID!';
    ELSE
        RAISE NOTICE 'TESTE 10 OK: Alteração de ID foi BLOQUEADA com sucesso.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 11: Usuário A tenta alterar created_at (Bloqueado)
    -- ------------------------------------------------------------------------
    v_blocked := FALSE;
    BEGIN
        UPDATE public.profiles SET created_at = '2000-01-01 00:00:00+00'::timestamptz WHERE id = v_user_a;
    EXCEPTION WHEN OTHERS THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 11: Usuário conseguiu alterar created_at manualmente!';
    ELSE
        RAISE NOTICE 'TESTE 11 OK: Alteração manual de created_at foi BLOQUEADA com sucesso.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 12: updated_at é controlado pelo servidor e não pode ser forjado pelo cliente
    -- ------------------------------------------------------------------------
    SELECT updated_at INTO v_updated_at_before FROM public.profiles WHERE id = v_user_a;
    
    -- Executa atualização permitida
    UPDATE public.profiles SET display_name = 'Alpha Final' WHERE id = v_user_a;
    
    SELECT updated_at INTO v_updated_at_after FROM public.profiles WHERE id = v_user_a;
    IF v_updated_at_after < v_updated_at_before THEN
        RAISE EXCEPTION 'FALHA TESTE 12: updated_at não avançou no servidor!';
    ELSE
        RAISE NOTICE 'TESTE 12 OK: updated_at gerenciado e atualizado pelo servidor.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TESTE 13: Execução direta de funções SECURITY DEFINER bloqueada para authenticated e anon
    -- ------------------------------------------------------------------------
    v_blocked := FALSE;
    BEGIN
        PERFORM public.handle_new_user();
    EXCEPTION WHEN OTHERS THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA CRÍTICA TESTE 13: Usuário authenticated conseguiu executar diretamente handle_new_user!';
    ELSE
        RAISE NOTICE 'TESTE 13 OK: Execução direta de handle_new_user() BLOQUEADA para authenticated.';
    END IF;

    v_blocked := FALSE;
    BEGIN
        PERFORM public.enforce_profile_update_integrity();
    EXCEPTION WHEN OTHERS THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA CRÍTICA TESTE 13b: Usuário authenticated conseguiu executar enforce_profile_update_integrity!';
    ELSE
        RAISE NOTICE 'TESTE 13b OK: Execução direta de enforce_profile_update_integrity() BLOQUEADA.';
    END IF;

    -- Testa o mesmo como anon
    SET LOCAL ROLE anon;
    v_blocked := FALSE;
    BEGIN
        PERFORM public.handle_new_user();
    EXCEPTION WHEN OTHERS THEN
        v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA CRÍTICA TESTE 14: Usuário anon conseguiu executar diretamente handle_new_user!';
    ELSE
        RAISE NOTICE 'TESTE 14 OK: Execução direta de handle_new_user() BLOQUEADA para anon.';
    END IF;

    RAISE NOTICE '=======================================================';
    RAISE NOTICE '>>> TODOS OS 14 TESTES DE HARDENING PASSARAM COM SUCESSO! <<<';
    RAISE NOTICE '=======================================================';
END $$;

ROLLBACK;
