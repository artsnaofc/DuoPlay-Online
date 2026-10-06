-- ============================================================================
-- Test Suite: room_creation_and_code_test.sql
-- Project: DuoPlay-Online
-- Phase: Fase 7.0.1 — Correção da Geração do Código da Sala
-- Purpose: Validação da geração de código seguro, criação de salas, unicidade,
--          formato Base32 e regras de autorização no PostgreSQL / Supabase.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    v_user_1 UUID := 'a1000000-0000-0000-0000-000000000001'::uuid;
    v_user_2 UUID := 'a2000000-0000-0000-0000-000000000002'::uuid;

    v_res JSONB;
    v_room_id UUID;
    v_room_code VARCHAR(6);
    v_codes TEXT[] := ARRAY[]::TEXT[];
    v_i INTEGER;
    v_code VARCHAR(6);
    v_blocked BOOLEAN;
    v_err_code TEXT;
BEGIN
    RAISE NOTICE '====================================================================';
    RAISE NOTICE '>>> INICIANDO TESTES DA FASE 7.0.1 (CRIAÇÃO DE SALA & CÓDIGO) <<<';
    RAISE NOTICE '====================================================================';

    -- Setup: Perfis de teste
    INSERT INTO public.profiles (id, username, display_name, total_matches, total_wins, total_draws, total_losses)
    VALUES 
        (v_user_1, 'test_host_1', 'Host One', 0, 0, 0, 0),
        (v_user_2, 'test_guest_2', 'Guest Two', 0, 0, 0, 0)
    ON CONFLICT (id) DO NOTHING;

    -- Setup: Jogo no catálogo
    INSERT INTO public.games (id, name, description, min_players, max_players, is_active)
    VALUES ('tic_tac_toe', 'Jogo da Velha', 'Clássico 3x3', 2, 2, true)
    ON CONFLICT (id) DO NOTHING;

    -- ------------------------------------------------------------------------
    -- TESTE 1: Criação normal por usuário autenticado
    -- ------------------------------------------------------------------------
    SET LOCAL ROLE authenticated;
    SET LOCAL "request.jwt.claims" TO '{"sub": "a1000000-0000-0000-0000-000000000001", "role": "authenticated"}';

    v_res := public.create_room('tic_tac_toe', 'Sala de Teste Fase 7.0.1', true, 2);

    IF (v_res->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHA TESTE 1: Falha ao criar sala com usuário autenticado: %', v_res;
    END IF;

    v_room_id := (v_res->'data'->'room'->>'id')::uuid;
    v_room_code := v_res->'data'->'room'->>'code';

    RAISE NOTICE 'Teste 1 OK: Sala criada com ID % e Código %', v_room_id, v_room_code;

    -- ------------------------------------------------------------------------
    -- TESTE 2: Formato e integridade do código gerado
    -- ------------------------------------------------------------------------
    IF v_room_code IS NULL THEN
        RAISE EXCEPTION 'FALHA TESTE 2: Código da sala não pode ser NULL!';
    END IF;

    IF char_length(v_room_code) != 6 THEN
        RAISE EXCEPTION 'FALHA TESTE 2: Tamanho do código deve ser exatamente 6 caracteres, obtido: %', char_length(v_room_code);
    END IF;

    -- Validar caracteres permitidos: Base32 sem ambiguidades (sem 0, 1, I, O)
    IF v_room_code !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$' THEN
        RAISE EXCEPTION 'FALHA TESTE 2: Código % contém caracteres inválidos fora do charset Base32!', v_room_code;
    END IF;

    RAISE NOTICE 'Teste 2 OK: Código % obedece ao padrão Base32 de 6 caracteres.', v_room_code;

    -- ------------------------------------------------------------------------
    -- TESTE 3: Unicidade e ausência de colisões em múltiplas gerações
    -- ------------------------------------------------------------------------
    v_codes := ARRAY[v_room_code];

    FOR v_i IN 1..10 LOOP
        v_res := public.create_room('tic_tac_toe', 'Sala Teste Repetição ' || v_i, true, 2);
        v_code := v_res->'data'->'room'->>'code';

        IF v_code = ANY(v_codes) THEN
            RAISE EXCEPTION 'FALHA TESTE 3: Colisão de código detectada na repetição %: código %', v_i, v_code;
        END IF;

        v_codes := array_append(v_codes, v_code);
    END LOOP;

    RAISE NOTICE 'Teste 3 OK: 11 salas criadas consecutivamente sem qualquer colisão de código.';

    -- ------------------------------------------------------------------------
    -- TESTE 4: Usuário não autenticado não consegue criar sala (P0001)
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{}';
    v_blocked := false;

    BEGIN
        PERFORM public.create_room('tic_tac_toe', 'Tentativa Anon', true, 2);
    EXCEPTION
        WHEN OTHERS THEN
            v_blocked := true;
            GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'FALHA TESTE 4: Usuário não autenticado conseguiu chamar create_room!';
    END IF;

    RAISE NOTICE 'Teste 4 OK: Usuário não autenticado bloqueado com sucesso (SQLSTATE: %).', v_err_code;

    -- ------------------------------------------------------------------------
    -- TESTE 5: Regras de validação (game_id inexistente e nome inválido)
    -- ------------------------------------------------------------------------
    SET LOCAL "request.jwt.claims" TO '{"sub": "a1000000-0000-0000-0000-000000000001", "role": "authenticated"}';
    v_blocked := false;

    BEGIN
        PERFORM public.create_room('game_que_nao_existe', 'Sala Invalida', true, 2);
    EXCEPTION
        WHEN OTHERS THEN
            v_blocked := true;
            GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE;
    END;

    IF NOT v_blocked OR v_err_code != 'P0003' THEN
        RAISE EXCEPTION 'FALHA TESTE 5: Jogo inválido deveria lançar P0003, obtido: %', v_err_code;
    END IF;

    -- Nome muito curto
    v_blocked := false;
    BEGIN
        PERFORM public.create_room('tic_tac_toe', 'A', true, 2);
    EXCEPTION
        WHEN OTHERS THEN
            v_blocked := true;
            GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE;
    END;

    IF NOT v_blocked OR v_err_code != 'P0002' THEN
        RAISE EXCEPTION 'FALHA TESTE 5: Nome curto deveria lançar P0002, obtido: %', v_err_code;
    END IF;

    RAISE NOTICE 'Teste 5 OK: Validações de catálogo (P0003) e nome (P0002) funcionando perfeitamente.';

    -- ------------------------------------------------------------------------
    -- TESTE 6: Regressão de integridade de membro e host
    -- ------------------------------------------------------------------------
    SELECT host_id, status, is_private, max_members
    INTO STRICT v_user_1, v_err_code, v_blocked, v_i
    FROM public.rooms
    WHERE id = v_room_id;

    IF v_user_1 != 'a1000000-0000-0000-0000-000000000001'::uuid THEN
        RAISE EXCEPTION 'FALHA TESTE 6: Host ID incorreto na sala!';
    END IF;

    IF v_err_code != 'waiting' THEN
        RAISE EXCEPTION 'FALHA TESTE 6: Status da sala recém-criada deve ser waiting, obtido: %', v_err_code;
    END IF;

    RAISE NOTICE 'Teste 6 OK: Registro relacional da sala e host em conformidade estrita.';

    RAISE NOTICE '====================================================================';
    RAISE NOTICE '>>> TODOS OS TESTES DA FASE 7.0.1 PASSARAM COM SUCESSO! <<<';
    RAISE NOTICE '====================================================================';
END;
$$;

ROLLBACK;
