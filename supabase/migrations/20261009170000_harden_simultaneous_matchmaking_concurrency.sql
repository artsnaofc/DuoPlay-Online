-- ============================================================================
-- Migration: 20261009170000_harden_simultaneous_matchmaking_concurrency.sql
-- Project: DuoPlay-Online
-- Phase: Fase 22.3 — Hardening de Concorrência e Reconciliação do Matchmaking Multijogo
-- Description:
--   1. Protege atomicamente contra pareamentos concorrentes quase simultâneos entre
--      jogos diferentes para o mesmo jogador (advisory locks de todos os participantes
--      em ordem determinística e re-validação estrita sob trava).
--   2. Garante que, ao formar partida para um jogo, todas as outras filas 'waiting'
--      de todos os participantes sejam canceladas atomicamente.
--   3. Reconcilia automaticamente em get_my_active_matchmaking_queues:
--      - Remove filas 'waiting' expiradas (expires_at < clock_timestamp()).
--      - Atualiza para 'completed' filas 'matched' cujas partidas já foram finalizadas
--        ou abandonadas (m.status != 'in_progress').
--   4. Garante ordenação determinística em get_my_active_matchmaking_queues ('matched' primeiro).
--   5. Habilita REPLICA IDENTITY FULL em matchmaking_queue para entrega sem falhas
--      de eventos Realtime via RLS.
--   6. Mantém 100% de retrocompatibilidade com todas as RPCs e rotinas existentes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Configuração de Réplica Realtime na Tabela matchmaking_queue
-- ----------------------------------------------------------------------------
ALTER TABLE public.matchmaking_queue REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' 
              AND schemaname = 'public' 
              AND tablename = 'matchmaking_queue'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.matchmaking_queue;
        END IF;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 2. RPC: get_my_active_matchmaking_queues com Auto-Reconciliação e Limpeza
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_active_matchmaking_queues()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_rows JSONB;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'data', '[]'::jsonb, 'error', null);
    END IF;

    -- Trava consultiva de concorrência por usuário
    PERFORM pg_advisory_xact_lock(hashtext(v_caller_id::text));

    -- 1. Remove filas 'waiting' expiradas do usuário
    DELETE FROM public.matchmaking_queue 
    WHERE user_id = v_caller_id 
      AND status = 'waiting' 
      AND expires_at < clock_timestamp();

    -- 2. Reconcilia filas 'matched' cuja partida já não está mais 'in_progress'
    -- (evita que partidas finalizadas continuem reaparecendo como buscas ativas após refresh)
    UPDATE public.matchmaking_queue q
    SET status = 'completed', updated_at = clock_timestamp()
    WHERE q.user_id = v_caller_id
      AND q.status = 'matched'
      AND (
          q.match_id IS NULL
          OR EXISTS (
              SELECT 1 FROM public.matches m
              WHERE m.id = q.match_id AND m.status != 'in_progress'
          )
          OR NOT EXISTS (
              SELECT 1 FROM public.matches m
              WHERE m.id = q.match_id
          )
      );

    -- 3. Retorna todas as filas ativas restantes priorizando 'matched'
    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'queue_id', q.id,
            'game_id', q.game_id,
            'status', q.status,
            'match_id', q.match_id,
            'expires_at', q.expires_at,
            'created_at', q.created_at
        ) ORDER BY CASE WHEN q.status = 'matched' THEN 0 ELSE 1 END, q.created_at DESC
    ), '[]'::jsonb)
    INTO v_rows
    FROM public.matchmaking_queue q
    WHERE q.user_id = v_caller_id
      AND q.status IN ('waiting', 'matched');

    RETURN jsonb_build_object(
        'success', true,
        'data', v_rows,
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_active_matchmaking_queues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_active_matchmaking_queues() TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. RPC: join_matchmaking_queue com Proteção Atômica Multijogo e Anti-Race
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_matchmaking_queue(
    p_game_id VARCHAR(50)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_game public.games%ROWTYPE;
    v_norm_game_id VARCHAR(50);
    v_my_entry public.matchmaking_queue%ROWTYPE;
    v_opponent_queue_ids UUID[];
    v_opponent_user_ids UUID[];
    v_valid_opponent_queue_ids UUID[] := ARRAY[]::uuid[];
    v_valid_opponent_user_ids UUID[] := ARRAY[]::uuid[];
    v_all_user_ids UUID[];
    v_new_match_id UUID;
    v_first_player_id UUID;
    v_initial_game_state JSONB;
    v_config JSONB;
    v_opponents_count INTEGER;
    v_total_players INTEGER;
    v_u_id UUID;
    v_opp_user_id UUID;
    v_opp_q_id UUID;
    v_i INTEGER;
    v_is_opp_valid BOOLEAN;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED: Apenas usuários autenticados podem entrar na fila.' USING ERRCODE = 'P0001';
    END IF;

    -- Trava transacional primária para o chamador
    PERFORM pg_advisory_xact_lock(hashtext(v_caller_id::text));

    -- Auto-limpeza de partidas in_progress obsoletas/abandonadas (> 2 horas)
    UPDATE public.matches
    SET status = 'finished', finish_reason = 'timeout', updated_at = clock_timestamp()
    WHERE status = 'in_progress'
      AND started_at < (clock_timestamp() - INTERVAL '2 hours')
      AND id IN (
          SELECT match_id FROM public.match_players WHERE user_id = v_caller_id
      );

    -- Bloqueio se o jogador já estiver em alguma partida 'in_progress' ativa
    IF EXISTS (
        SELECT 1 FROM public.match_players mp
        JOIN public.matches m ON m.id = mp.match_id
        WHERE mp.user_id = v_caller_id AND m.status = 'in_progress'
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Você possui uma partida em andamento. Conclua-a antes de buscar outra.',
            'code', 'ACTIVE_MATCH_EXISTS'
        );
    END IF;

    -- Normalização e validação no catálogo de jogos
    v_norm_game_id := replace(p_game_id, '-', '_');
    SELECT * INTO v_game FROM public.games WHERE id = v_norm_game_id AND is_active = true;
    IF NOT FOUND OR v_game.id IS NULL THEN
        RAISE EXCEPTION 'GAME_NOT_ACTIVE: O jogo especificado não existe ou não possui matchmaking público ativo.' USING ERRCODE = 'P0015';
    END IF;

    -- Limpar filas expiradas globalmente para manter sanidade
    DELETE FROM public.matchmaking_queue WHERE expires_at < clock_timestamp();

    -- Reconciliar fila específica deste usuário para este jogo
    v_my_entry := public.reconcile_user_matchmaking_queue(v_caller_id, v_game.id);

    IF v_my_entry.id IS NOT NULL THEN
        -- Se já estiver matched para este jogo
        IF v_my_entry.status = 'matched' AND v_my_entry.match_id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'queue_id', v_my_entry.id,
                    'game_id', v_my_entry.game_id,
                    'status', 'matched',
                    'match_id', v_my_entry.match_id,
                    'expires_at', v_my_entry.expires_at
                ),
                'error', null
            );
        END IF;
    END IF;

    -- Buscar oponentes candidatos na mesma fila (mesmo game_id)
    -- Filtra oponentes que comprovadamente já estejam em partida in_progress
    -- ou já estejam com fila 'matched'
    SELECT 
        coalesce(array_agg(sub.id), ARRAY[]::uuid[]),
        coalesce(array_agg(sub.user_id), ARRAY[]::uuid[])
    INTO v_opponent_queue_ids, v_opponent_user_ids
    FROM (
        SELECT q.id, q.user_id
        FROM public.matchmaking_queue q
        WHERE q.game_id = v_game.id
          AND q.status = 'waiting'
          AND q.user_id != v_caller_id
          AND clock_timestamp() < q.expires_at
          AND NOT EXISTS (
              SELECT 1 FROM public.match_players mp
              JOIN public.matches m ON m.id = mp.match_id
              WHERE mp.user_id = q.user_id AND m.status = 'in_progress'
          )
          AND NOT EXISTS (
              SELECT 1 FROM public.matchmaking_queue mq_other
              WHERE mq_other.user_id = q.user_id
                AND mq_other.status = 'matched'
          )
        ORDER BY q.created_at ASC
        LIMIT (v_game.max_players - 1)
        FOR UPDATE SKIP LOCKED
    ) sub;

    -- ========================================================================
    -- PROTEÇÃO ATÔMICA MULTIJOGO CONTRA RACE CONDITIONS QUASE SIMULTÂNEAS
    -- ========================================================================
    -- Se houver candidatos suficientes, adquirimos as travas consultivas de todos
    -- os participantes em ordem determinística para prevenir deadlocks e re-validamos
    -- sob lock exclusivo.
    IF (cardinality(v_opponent_user_ids) + 1) >= v_game.min_players THEN
        v_all_user_ids := array_append(v_opponent_user_ids, v_caller_id);

        -- Adquire advisory locks de todos os jogadores em ordem alfanumérica/hash estável
        FOR v_u_id IN (
            SELECT DISTINCT unnest(v_all_user_ids) ORDER BY 1
        ) LOOP
            PERFORM pg_advisory_xact_lock(hashtext(v_u_id::text));
        END LOOP;

        -- Re-validação estrita sob a trava de todos os oponentes candidatos:
        FOR v_i IN 1..cardinality(v_opponent_user_ids) LOOP
            v_opp_user_id := v_opponent_user_ids[v_i];
            v_opp_q_id := v_opponent_queue_ids[v_i];
            v_is_opp_valid := true;

            -- 1. O oponente ainda tem esta fila específica como 'waiting'?
            IF NOT EXISTS (
                SELECT 1 FROM public.matchmaking_queue
                WHERE id = v_opp_q_id AND status = 'waiting' AND expires_at > clock_timestamp()
            ) THEN
                v_is_opp_valid := false;
            END IF;

            -- 2. O oponente tem alguma outra fila 'matched'?
            IF v_is_opp_valid AND EXISTS (
                SELECT 1 FROM public.matchmaking_queue
                WHERE user_id = v_opp_user_id AND status = 'matched'
            ) THEN
                v_is_opp_valid := false;
            END IF;

            -- 3. O oponente entrou em alguma partida in_progress no ínterim?
            IF v_is_opp_valid AND EXISTS (
                SELECT 1 FROM public.match_players mp
                JOIN public.matches m ON m.id = mp.match_id
                WHERE mp.user_id = v_opp_user_id AND m.status = 'in_progress'
            ) THEN
                v_is_opp_valid := false;
            END IF;

            IF v_is_opp_valid THEN
                v_valid_opponent_queue_ids := array_append(v_valid_opponent_queue_ids, v_opp_q_id);
                v_valid_opponent_user_ids := array_append(v_valid_opponent_user_ids, v_opp_user_id);
            END IF;
        END LOOP;

        v_opponents_count := cardinality(v_valid_opponent_user_ids);
        v_total_players := v_opponents_count + 1;
    ELSE
        v_valid_opponent_queue_ids := ARRAY[]::uuid[];
        v_valid_opponent_user_ids := ARRAY[]::uuid[];
        v_total_players := 1;
    END IF;

    -- Se após re-validação atômica ainda temos o número mínimo de jogadores: CRIA A PARTIDA!
    IF v_total_players >= v_game.min_players THEN
        v_new_match_id := gen_random_uuid();
        v_all_user_ids := array_append(v_valid_opponent_user_ids, v_caller_id);
        v_first_player_id := v_all_user_ids[1];
        v_config := coalesce(v_game.config, '{}'::jsonb);

        IF v_game.id = 'carta_duo' THEN
            v_initial_game_state := public.initialize_carta_duo_state_for_players(v_all_user_ids, v_config);
            v_first_player_id := (v_initial_game_state->>'current_turn_player_id')::uuid;
        ELSIF v_game.id = 'snake' THEN
            v_initial_game_state := public.initialize_snake_state_for_players(v_all_user_ids, v_config);
            v_first_player_id := NULL;
        ELSE
            v_initial_game_state := jsonb_build_object('config', v_config);
        END IF;

        -- Inserir partida autoritativa
        INSERT INTO public.matches (
            id, room_id, game_id, status, current_turn_player_id,
            turn_deadline, turn_number, game_state, action_history, config, created_at, started_at
        ) VALUES (
            v_new_match_id, NULL, v_game.id, 'in_progress', v_first_player_id,
            CASE WHEN v_game.id = 'snake' THEN NULL ELSE clock_timestamp() + (COALESCE((v_config->>'turn_timer')::INTEGER, 30) || ' seconds')::INTERVAL END,
            1, v_initial_game_state, '[]'::jsonb, v_config,
            clock_timestamp(), clock_timestamp()
        );

        -- Inserir participantes
        FOR i IN 1..cardinality(v_all_user_ids) LOOP
            INSERT INTO public.match_players (
                match_id, user_id, slot, game_symbol, score, is_winner, joined_at
            ) VALUES (
                v_new_match_id, v_all_user_ids[i], i, NULL, 0, false, clock_timestamp()
            );
        END LOOP;

        -- Atualizar status da fila deste jogo para 'matched' para os oponentes
        UPDATE public.matchmaking_queue
        SET status = 'matched', match_id = v_new_match_id, updated_at = clock_timestamp()
        WHERE id = ANY(v_valid_opponent_queue_ids);

        -- Atualizar ou inserir entrada do chamador como 'matched'
        IF v_my_entry.id IS NOT NULL THEN
            UPDATE public.matchmaking_queue
            SET status = 'matched', match_id = v_new_match_id, updated_at = clock_timestamp()
            WHERE id = v_my_entry.id
            RETURNING * INTO v_my_entry;
        ELSE
            INSERT INTO public.matchmaking_queue (
                user_id, game_id, status, match_id, expires_at
            ) VALUES (
                v_caller_id, v_game.id, 'matched', v_new_match_id, clock_timestamp() + INTERVAL '5 minutes'
            )
            ON CONFLICT (user_id, game_id) WHERE status IN ('waiting', 'matched')
            DO UPDATE SET status = 'matched', match_id = v_new_match_id, updated_at = clock_timestamp()
            RETURNING * INTO v_my_entry;
        END IF;

        -- ====================================================================
        -- REGRA CRÍTICA MULTIJOGO: Cancelar automaticamente TODAS as outras
        -- filas 'waiting' de TODOS os jogadores pareados nesta partida!
        -- ====================================================================
        FOREACH v_u_id IN ARRAY v_all_user_ids LOOP
            UPDATE public.matchmaking_queue
            SET status = 'cancelled', updated_at = clock_timestamp()
            WHERE user_id = v_u_id
              AND status = 'waiting'
              AND game_id != v_game.id;
        END LOOP;

        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'queue_id', v_my_entry.id,
                'game_id', v_game.id,
                'status', 'matched',
                'match_id', v_new_match_id,
                'expires_at', v_my_entry.expires_at
            ),
            'error', null
        );

    ELSE
        -- Menos jogadores que o mínimo: permanecer ou entrar em 'waiting' para este jogo
        IF v_my_entry.id IS NOT NULL AND v_my_entry.status = 'waiting' THEN
            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'queue_id', v_my_entry.id,
                    'game_id', v_my_entry.game_id,
                    'status', 'waiting',
                    'match_id', null,
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
            ON CONFLICT (user_id, game_id) WHERE status IN ('waiting', 'matched')
            DO UPDATE SET status = 'waiting', match_id = NULL, expires_at = EXCLUDED.expires_at, updated_at = clock_timestamp()
            RETURNING * INTO v_my_entry;

            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'queue_id', v_my_entry.id,
                    'game_id', v_my_entry.game_id,
                    'status', 'waiting',
                    'match_id', null,
                    'expires_at', v_my_entry.expires_at
                ),
                'error', null
            );
        END IF;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.join_matchmaking_queue(VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_matchmaking_queue(VARCHAR) TO authenticated;
