-- ============================================================================
-- Test Suite: profiles_rls_test.sql
-- Project: DuoPlay-Online
-- Phase: Fase 2 (Supabase + Segurança)
-- Purpose: Validação de segurança e testes de isolamento de Row Level Security (RLS)
-- ============================================================================

BEGIN;

-- 1. Criação de Usuários Fictícios no contexto de teste
DO $$
DECLARE
    v_user_a UUID := 'a0000000-0000-0000-0000-000000000001'::uuid;
    v_user_b UUID := 'b0000000-0000-0000-0000-000000000002'::uuid;
    v_count INTEGER;
BEGIN
    RAISE NOTICE '>>> INICIANDO TESTES DE RLS DA TABELA PROFILES <<<';

    -- Inserir registros de teste na tabela profiles simulando o trigger
    INSERT INTO public.profiles (id, username, display_name)
    VALUES 
        (v_user_a, 'player_alpha', 'Player Alpha'),
        (v_user_b, 'player_beta', 'Player Beta');

    -- TESTE 1: Usuário Não Autenticado (anon) tenta ler perfis
    SET LOCAL ROLE anon;
    SET LOCAL "request.jwt.claims" TO '{}';
    
    SELECT count(*) INTO v_count FROM public.profiles;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FALHA DE RLS: Usuário anon conseguiu ler % linhas na tabela profiles!', v_count;
    ELSE
        RAISE NOTICE 'TESTE 1 OK: Usuário anon não tem acesso a nenhum perfil.';
    END IF;

    -- TESTE 2: Usuário A autenticado lê o próprio perfil
    SET LOCAL ROLE authenticated;
    SET LOCAL "request.jwt.claims" TO '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

    SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_user_a;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'FALHA DE RLS: Usuário A não conseguiu ler o próprio perfil!';
    ELSE
        RAISE NOTICE 'TESTE 2 OK: Usuário A acessou o próprio perfil com sucesso.';
    END IF;

    -- TESTE 3: Usuário A autenticado tenta ler perfil do Usuário B
    SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_user_b;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FALHA DE RLS: Usuário A conseguiu ler o perfil privado do Usuário B!';
    ELSE
        RAISE NOTICE 'TESTE 3 OK: Usuário A NÃO conseguiu ler o perfil do Usuário B.';
    END IF;

    -- TESTE 4: Usuário A atualiza o próprio display_name
    UPDATE public.profiles 
    SET display_name = 'Player Alpha Updated' 
    WHERE id = v_user_a;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'FALHA DE RLS: Usuário A não conseguiu atualizar o próprio perfil!';
    ELSE
        RAISE NOTICE 'TESTE 4 OK: Usuário A atualizou o próprio perfil.';
    END IF;

    -- TESTE 5: Usuário A tenta alterar o perfil do Usuário B (deve afetar 0 linhas)
    UPDATE public.profiles 
    SET display_name = 'Hacked by Alpha' 
    WHERE id = v_user_b;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FALHA DE RLS: Usuário A conseguiu alterar o perfil do Usuário B!';
    ELSE
        RAISE NOTICE 'TESTE 5 OK: Usuário A foi bloqueado ao tentar alterar perfil do Usuário B.';
    END IF;

    -- TESTE 6: Usuário B autenticado
    SET LOCAL ROLE authenticated;
    SET LOCAL "request.jwt.claims" TO '{"sub": "b0000000-0000-0000-0000-000000000002", "role": "authenticated"}';

    -- Usuário B acessa o próprio perfil
    SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_user_b;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'FALHA DE RLS: Usuário B não conseguiu ler o próprio perfil!';
    ELSE
        RAISE NOTICE 'TESTE 6 OK: Usuário B acessou seu perfil com sucesso.';
    END IF;

    -- Usuário B tenta ler o perfil do Usuário A
    SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_user_a;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'FALHA DE RLS: Usuário B conseguiu ler o perfil privado do Usuário A!';
    ELSE
        RAISE NOTICE 'TESTE 7 OK: Usuário B NÃO conseguiu ler o perfil do Usuário A.';
    END IF;

    RAISE NOTICE '>>> TODOS OS TESTES DE RLS FORAM CONCLUÍDOS COM SUCESSO! <<<';
END $$;

-- Rollback limpo das alterações de teste
ROLLBACK;
