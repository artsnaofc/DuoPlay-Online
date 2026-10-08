-- ============================================================================
-- Migration: 20261009050000_agnostic_game_registry_and_matchmaking.sql
-- Project: DuoPlay-Online
-- Phase: Fase 20.1 — Matchmaking e Salas para Todos os Jogos
-- Description: Torna create_room e join_matchmaking_queue totalmente agnósticos
--              ao jogo, normalizando IDs (hyphen/underscore) e consultando o catálogo
--              de jogos ativos (suportando tic_tac_toe e carta_duo com 2-6 jogadores).
-- ============================================================================

-- 1. Redefinir create_room com normalização de game_id e validação no catálogo ativo
CREATE OR REPLACE FUNCTION public.create_room(
    p_game_id VARCHAR(50),
    p_name VARCHAR(60),
    p_is_private BOOLEAN DEFAULT true,
    p_max_members INTEGER DEFAULT 4
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_clean_name VARCHAR(60);
    v_code VARCHAR(6);
    v_attempts INTEGER := 0;
    v_norm_game_id VARCHAR(50);
    v_game RECORD;
    v_room RECORD;
    v_max_members INTEGER;
BEGIN
    -- 1. Identificar usuário chamador
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Validar nome da sala
    v_clean_name := trim(p_name);
    IF char_length(v_clean_name) < 2 OR char_length(v_clean_name) > 60 THEN
        RAISE EXCEPTION 'INVALID_NAME: O nome da sala deve ter entre 2 e 60 caracteres.' USING ERRCODE = 'P0002';
    END IF;

    -- 3. Normalizar e validar jogo no catálogo
    v_norm_game_id := replace(p_game_id, '-', '_');
    SELECT * INTO v_game FROM public.games WHERE id = v_norm_game_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'GAME_NOT_FOUND: O jogo especificado não existe ou está inativo.' USING ERRCODE = 'P0003';
    END IF;

    -- 4. Validar e ajustar capacidade respeitando min/max do jogo
    v_max_members := greatest(v_game.min_players, least(coalesce(p_max_members, v_game.max_players), v_game.max_players));

    -- 5. Gerar código único e seguro
    LOOP
        v_code := public.generate_room_code();
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.rooms WHERE code = v_code);
        v_attempts := v_attempts + 1;
        If v_attempts > 15 THEN
            RAISE EXCEPTION 'INTERNAL_ERROR: Falha ao gerar código único de sala.' USING ERRCODE = 'P0004';
        END IF;
    END LOOP;

    -- 6. Criar sala
    INSERT INTO public.rooms (
        code,
        game_id,
        host_id,
        name,
        status,
        is_private,
        max_members,
        created_at,
        updated_at
    ) VALUES (
        v_code,
        v_game.id,
        v_caller_id,
        v_clean_name,
        'waiting',
        coalesce(p_is_private, true),
        v_max_members,
        now(),
        now()
    ) RETURNING * INTO v_room;

    -- 7. Criar membership do Host (Slot 1, role player)
    INSERT INTO public.room_members (
        room_id,
        user_id,
        role,
        slot_number,
        game_symbol,
        is_ready,
        joined_at
    ) VALUES (
        v_room.id,
        v_caller_id,
        'player',
        1,
        CASE WHEN v_game.id = 'tic_tac_toe' THEN 'X' ELSE '1' END,
        true,
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'room', row_to_json(v_room),
            'member', jsonb_build_object(
                'room_id', v_room.id,
                'user_id', v_caller_id,
                'role', 'player',
                'slot_number', 1,
                'game_symbol', CASE WHEN v_game.id = 'tic_tac_toe' THEN 'X' ELSE '1' END,
                'is_ready', true
            )
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_room(VARCHAR, VARCHAR, BOOLEAN, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_room(VARCHAR, VARCHAR, BOOLEAN, INTEGER) TO authenticated;


-- 2. Redefinir join_matchmaking_queue para ser agnóstico a qualquer jogo ativo no catálogo
CREATE OR REPLACE FUNCTION public.join_matchmaking_queue(
    p_game_id VARCHAR(50)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_active_match_id UUID;
    v_norm_game_id VARCHAR(50);
    v_game RECORD;
    v_my_entry public.matchmaking_queue%ROWTYPE;
    v_opponent_entry public.matchmaking_queue%ROWTYPE;
    v_new_match_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- Trava transacional por usuário para serializar requisições concorrentes da mesma pessoa
    PERFORM pg_advisory_xact_lock(hashtext(v_caller_id::text));

    -- 1. Normalizar e validar jogo ativo no catálogo
    v_norm_game_id := replace(p_game_id, '-', '_');
    SELECT * INTO v_game FROM public.games WHERE id = v_norm_game_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'GAME_NOT_ACTIVE: O jogo especificado não existe ou não possui matchmaking público ativo.' USING ERRCODE = 'P0015';
    END IF;

    -- 2. Reconciliar entrada existente do próprio chamador no banco
    v_my_entry := public.reconcile_user_matchmaking_queue(v_caller_id);

    -- 3. Se o chamador já possuir uma entrada 'matched' válida com partida em andamento
    IF v_my_entry.id IS NOT NULL AND v_my_entry.status = 'matched' AND v_my_entry.match_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'queue_id', v_my_entry.id,
                'status', 'matched',
                'match_id', v_my_entry.match_id,
                'expires_at', v_my_entry.expires_at
            ),
            'error', null
        );
    END IF;

    -- 4. Validar se o usuário não está em uma partida ativa por fora da fila
    SELECT m.id INTO v_active_match_id
    FROM public.matches m
    JOIN public.match_players mp ON mp.match_id = m.id
    WHERE mp.user_id = v_caller_id
      AND m.status = 'in_progress'
    LIMIT 1;

    IF v_active_match_id IS NOT NULL THEN
        RAISE EXCEPTION 'PLAYER_IN_ACTIVE_MATCH: Você já está em uma partida em andamento.' USING ERRCODE = 'P0013';
    END IF;

    -- 5. Se o chamador já estiver 'waiting' ativo e não expirado:
    IF v_my_entry.id IS NOT NULL AND v_my_entry.status = 'waiting' THEN
        -- Tenta pareamento imediato procurando oponente via FOR UPDATE SKIP LOCKED no mesmo game_id
        SELECT * INTO v_opponent_entry
        FROM public.matchmaking_queue
        WHERE game_id = v_game.id
          AND status = 'waiting'
          AND user_id != v_caller_id
          AND clock_timestamp() < expires_at
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1;

        IF FOUND THEN
            v_new_match_id := gen_random_uuid();

            INSERT INTO public.matches (
                id, room_id, game_id, status, current_turn_player_id,
                turn_deadline, turn_number, game_state, action_history, created_at, started_at
            ) VALUES (
                v_new_match_id, NULL, v_game.id, 'in_progress', v_opponent_entry.user_id,
                clock_timestamp() + INTERVAL '30 seconds', 1, '{}'::jsonb, '[]'::jsonb,
                clock_timestamp(), clock_timestamp()
            );

            INSERT INTO public.match_players (
                match_id, user_id, slot, game_symbol, score, is_winner, joined_at
            ) VALUES
            (v_new_match_id, v_opponent_entry.user_id, 1, CASE WHEN v_game.id = 'tic_tac_toe' THEN 'X' ELSE '1' END, 0, false, clock_timestamp()),
            (v_new_match_id, v_caller_id, 2, CASE WHEN v_game.id = 'tic_tac_toe' THEN 'O' ELSE '2' END, 0, false, clock_timestamp());

            UPDATE public.matchmaking_queue
            SET status = 'matched', match_id = v_new_match_id, updated_at = clock_timestamp()
            WHERE id = v_opponent_entry.id;

            UPDATE public.matchmaking_queue
            SET status = 'matched', match_id = v_new_match_id, updated_at = clock_timestamp()
            WHERE id = v_my_entry.id;

            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'queue_id', v_my_entry.id,
                    'status', 'matched',
                    'match_id', v_new_match_id,
                    'expires_at', v_my_entry.expires_at
                ),
                'error', null
            );
        ELSE
            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'queue_id', v_my_entry.id,
                    'status', 'waiting',
                    'match_id', null,
                    'expires_at', v_my_entry.expires_at
                ),
                'error', null
            );
        END IF;
    END IF;

    -- 6. Chamador não tem entrada ativa. Procurar oponente disponível em 'waiting' para o mesmo game_id
    SELECT * INTO v_opponent_entry
    FROM public.matchmaking_queue
    WHERE game_id = v_game.id
      AND status = 'waiting'
      AND user_id != v_caller_id
      AND clock_timestamp() < expires_at
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF FOUND THEN
        v_new_match_id := gen_random_uuid();

        INSERT INTO public.matches (
            id, room_id, game_id, status, current_turn_player_id,
            turn_deadline, turn_number, game_state, action_history, created_at, started_at
        ) VALUES (
            v_new_match_id, NULL, v_game.id, 'in_progress', v_opponent_entry.user_id,
            clock_timestamp() + INTERVAL '30 seconds', 1, '{}'::jsonb, '[]'::jsonb,
            clock_timestamp(), clock_timestamp()
        );

        INSERT INTO public.match_players (
            match_id, user_id, slot, game_symbol, score, is_winner, joined_at
        ) VALUES
        (v_new_match_id, v_opponent_entry.user_id, 1, CASE WHEN v_game.id = 'tic_tac_toe' THEN 'X' ELSE '1' END, 0, false, clock_timestamp()),
        (v_new_match_id, v_caller_id, 2, CASE WHEN v_game.id = 'tic_tac_toe' THEN 'O' ELSE '2' END, 0, false, clock_timestamp());

        UPDATE public.matchmaking_queue
        SET status = 'matched', match_id = v_new_match_id, updated_at = clock_timestamp()
        WHERE id = v_opponent_entry.id;

        INSERT INTO public.matchmaking_queue (
            user_id, game_id, status, match_id, expires_at
        ) VALUES (
            v_caller_id, v_game.id, 'matched', v_new_match_id, clock_timestamp() + INTERVAL '5 minutes'
        )
        RETURNING * INTO v_my_entry;

        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'queue_id', v_my_entry.id,
                'status', 'matched',
                'match_id', v_new_match_id,
                'expires_at', v_my_entry.expires_at
            ),
            'error', null
        );
    ELSE
        INSERT INTO public.matchmaking_queue (
            user_id, game_id, status, expires_at
        ) VALUES (
            v_caller_id, v_game.id, 'waiting', clock_timestamp() + INTERVAL '5 minutes'
        )
        RETURNING * INTO v_my_entry;

        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'queue_id', v_my_entry.id,
                'status', 'waiting',
                'match_id', null,
                'expires_at', v_my_entry.expires_at
            ),
            'error', null
        );
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.join_matchmaking_queue(VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_matchmaking_queue(VARCHAR) TO authenticated;
