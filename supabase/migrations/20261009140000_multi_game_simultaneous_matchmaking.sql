-- ============================================================================
-- Migration: 20261009140000_multi_game_simultaneous_matchmaking.sql
-- Project: DuoPlay-Online
-- Phase: Fase 23 — Matchmaking Simultâneo Multijogo e Concorrência Atômica
-- Description:
--   1. Altera a restrição de unicidade em public.matchmaking_queue de:
--      (user_id) WHERE status IN ('waiting', 'matched')
--      para:
--      (user_id, game_id) WHERE status IN ('waiting', 'matched')
--      Permitindo exatamente UMA fila ativa por usuário por jogo.
--   2. Atualiza join_matchmaking_queue para suportar inscrição simultânea em
--      múltiplos jogos diferentes, sem cancelar automaticamente as filas dos outros jogos.
--   3. Ao encontrar uma partida (status 'matched'):
--      - Cria a nova partida atomicamente.
--      - Cancela automaticamente todas as outras filas ativas ('waiting')
--        de todos os jogadores participantes daquela partida (concorrência e limpeza atômica).
--   4. Atualiza cancel_matchmaking_queue para aceitar p_game_id opcional:
--      - Se p_game_id for fornecido, cancela a fila específica daquele jogo.
--      - Se p_game_id for NULL/omitido, cancela todas as filas ativas do usuário.
--   5. Adiciona RPC get_my_active_matchmaking_queues() que retorna todas as
--      filas ativas ('waiting' ou 'matched') do usuário com status de cada jogo.
--   6. Mantém get_my_matchmaking_status() 100% retrocompatível (retornando a primeira
--      fila matched ou a mais recente waiting).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Atualizar Índice de Unicidade: Uma fila ativa por (user_id, game_id)
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_matchmaking_queue_user_active;

CREATE UNIQUE INDEX idx_matchmaking_queue_user_game_active
ON public.matchmaking_queue (user_id, game_id)
WHERE status IN ('waiting', 'matched');

-- ----------------------------------------------------------------------------
-- 2. Rotina de Reconciliação com suporte a Game ID opcional
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_user_matchmaking_queue(
    p_user_id UUID,
    p_game_id VARCHAR(50) DEFAULT NULL
)
RETURNS public.matchmaking_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_entry public.matchmaking_queue%ROWTYPE;
    v_match_status VARCHAR(20);
BEGIN
    IF p_user_id IS NULL OR auth.uid() IS NULL OR p_user_id != auth.uid() THEN
        RETURN NULL;
    END IF;

    -- Se fornecido p_game_id, busca para o jogo específico; senão busca qualquer ativo priorizando matched
    IF p_game_id IS NOT NULL THEN
        SELECT * INTO v_entry
        FROM public.matchmaking_queue
        WHERE user_id = p_user_id
          AND game_id = p_game_id
          AND status IN ('waiting', 'matched')
        ORDER BY CASE WHEN status = 'matched' THEN 0 ELSE 1 END, created_at DESC
        LIMIT 1
        FOR UPDATE;
    ELSE
        SELECT * INTO v_entry
        FROM public.matchmaking_queue
        WHERE user_id = p_user_id
          AND status IN ('waiting', 'matched')
        ORDER BY CASE WHEN status = 'matched' THEN 0 ELSE 1 END, created_at DESC
        LIMIT 1
        FOR UPDATE;
    END IF;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Reconciliação de entradas 'waiting' expiradas
    IF v_entry.status = 'waiting' THEN
        IF clock_timestamp() > v_entry.expires_at THEN
            UPDATE public.matchmaking_queue
            SET status = 'expired', updated_at = clock_timestamp()
            WHERE id = v_entry.id
            RETURNING * INTO v_entry;
        END IF;
    -- Reconciliação de entradas 'matched' cuja partida terminou
    ELSIF v_entry.status = 'matched' THEN
        IF v_entry.match_id IS NULL THEN
            UPDATE public.matchmaking_queue
            SET status = 'completed', updated_at = clock_timestamp()
            WHERE id = v_entry.id
            RETURNING * INTO v_entry;
        ELSE
            SELECT m.status INTO v_match_status
            FROM public.matches m
            WHERE m.id = v_entry.match_id;

            IF v_match_status IS NULL OR v_match_status != 'in_progress' THEN
                UPDATE public.matchmaking_queue
                SET status = 'completed', updated_at = clock_timestamp()
                WHERE id = v_entry.id
                RETURNING * INTO v_entry;
            END IF;
        END IF;
    END IF;

    RETURN v_entry;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. RPC: join_matchmaking_queue (com pareamento e cancelamento cruzado atômico)
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
    v_game RECORD;
    v_norm_game_id VARCHAR(50);
    v_my_entry RECORD;
    v_opponent_queue_ids UUID[];
    v_opponent_user_ids UUID[];
    v_all_user_ids UUID[];
    v_new_match_id UUID;
    v_first_player_id UUID;
    v_initial_game_state JSONB;
    v_config JSONB;
    v_opponents_count INTEGER;
    v_total_players INTEGER;
    v_u_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED: Apenas usuários autenticados podem entrar na fila.' USING ERRCODE = 'P0001';
    END IF;

    -- Trava transacional de concorrência por usuário
    PERFORM pg_advisory_xact_lock(hashtext(v_caller_id::text));

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
    IF v_game.id IS NULL THEN
        RAISE EXCEPTION 'GAME_NOT_ACTIVE: O jogo especificado não existe ou não possui matchmaking público ativo.' USING ERRCODE = 'P0015';
    END IF;

    -- Limpar fila expirada globalmente para manter sanidade
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

        -- Se já estiver em waiting para este jogo específico, retorna a entrada existente
        IF v_my_entry.status = 'waiting' THEN
            -- Continua a verificação de pareamento abaixo
        END IF;
    END IF;

    -- Buscar oponentes elegíveis na mesma fila (mesmo game_id)
    SELECT 
        coalesce(array_agg(id), ARRAY[]::uuid[]),
        coalesce(array_agg(user_id), ARRAY[]::uuid[])
    INTO v_opponent_queue_ids, v_opponent_user_ids
    FROM (
        SELECT id, user_id
        FROM public.matchmaking_queue
        WHERE game_id = v_game.id
          AND status = 'waiting'
          AND user_id != v_caller_id
          AND clock_timestamp() < expires_at
        ORDER BY created_at ASC
        LIMIT (v_game.max_players - 1)
        FOR UPDATE SKIP LOCKED
    ) sub;

    v_opponents_count := coalesce(cardinality(v_opponent_user_ids), 0);
    v_total_players := v_opponents_count + 1;

    -- Se houver oponentes suficientes: FORMAR PARTIDA ATOMICAMENTE!
    IF v_total_players >= v_game.min_players THEN
        v_new_match_id := gen_random_uuid();
        v_all_user_ids := array_append(v_opponent_user_ids, v_caller_id);
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
        WHERE id = ANY(v_opponent_queue_ids);

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

        -- REGRA CRÍTICA MULTIJOGO: Cancelar automaticamente TODAS as outras filas 'waiting'
        -- de TODOS os jogadores pareados nesta partida!
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
        -- Menos jogadores que o mínimo: permanecer ou entrar em 'waiting'
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

-- ----------------------------------------------------------------------------
-- 4. RPC: cancel_matchmaking_queue (com suporte a p_game_id opcional)
-- ----------------------------------------------------------------------------
-- Drop versões anteriores se existirem com diferentes assinaturas
DROP FUNCTION IF EXISTS public.cancel_matchmaking_queue();
DROP FUNCTION IF EXISTS public.cancel_matchmaking_queue(VARCHAR);

CREATE OR REPLACE FUNCTION public.cancel_matchmaking_queue(
    p_game_id VARCHAR(50) DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_norm_game_id VARCHAR(50) := NULL;
    v_matched_id UUID := NULL;
    v_cancelled_count INTEGER := 0;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_caller_id::text));

    IF p_game_id IS NOT NULL THEN
        v_norm_game_id := replace(p_game_id, '-', '_');
    END IF;

    -- Verifica se já possui algum match em status 'matched'
    IF v_norm_game_id IS NOT NULL THEN
        SELECT match_id INTO v_matched_id
        FROM public.matchmaking_queue
        WHERE user_id = v_caller_id
          AND game_id = v_norm_game_id
          AND status = 'matched'
          AND match_id IS NOT NULL
        LIMIT 1;
    ELSE
        SELECT match_id INTO v_matched_id
        FROM public.matchmaking_queue
        WHERE user_id = v_caller_id
          AND status = 'matched'
          AND match_id IS NOT NULL
        LIMIT 1;
    END IF;

    -- Se já estiver pareado em partida ativa, preserva o match
    IF v_matched_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'status', 'matched',
                'match_id', v_matched_id
            ),
            'error', null
        );
    END IF;

    -- Cancela as filas 'waiting' especificadas ou todas
    IF v_norm_game_id IS NOT NULL THEN
        UPDATE public.matchmaking_queue
        SET status = 'cancelled', updated_at = clock_timestamp()
        WHERE user_id = v_caller_id
          AND game_id = v_norm_game_id
          AND status = 'waiting';
        GET DIAGNOSTICS v_cancelled_count = ROW_COUNT;
    ELSE
        UPDATE public.matchmaking_queue
        SET status = 'cancelled', updated_at = clock_timestamp()
        WHERE user_id = v_caller_id
          AND status = 'waiting';
        GET DIAGNOSTICS v_cancelled_count = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'status', 'cancelled',
            'game_id', v_norm_game_id,
            'cancelled_count', v_cancelled_count,
            'match_id', null
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_matchmaking_queue(VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_matchmaking_queue(VARCHAR) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. RPC: get_my_active_matchmaking_queues (Retorna todas as filas ativas)
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
    v_results JSONB;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'data', '[]'::jsonb, 'error', null);
    END IF;

    -- Limpa registros expirados deste usuário
    UPDATE public.matchmaking_queue
    SET status = 'expired', updated_at = clock_timestamp()
    WHERE user_id = v_caller_id
      AND status = 'waiting'
      AND expires_at < clock_timestamp();

    SELECT jsonb_agg(
        jsonb_build_object(
            'queue_id', q.id,
            'game_id', q.game_id,
            'status', q.status,
            'match_id', q.match_id,
            'expires_at', q.expires_at,
            'created_at', q.created_at
        )
    ) INTO v_results
    FROM public.matchmaking_queue q
    WHERE q.user_id = v_caller_id
      AND q.status IN ('waiting', 'matched');

    RETURN jsonb_build_object(
        'success', true,
        'data', coalesce(v_results, '[]'::jsonb),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_active_matchmaking_queues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_active_matchmaking_queues() TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. RPC: get_my_matchmaking_status (Retrocompatibilidade 100%)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_matchmaking_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_entry public.matchmaking_queue%ROWTYPE;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'data', null, 'error', null);
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_caller_id::text));

    -- Reconcilia primeiro qualquer matched ou a fila mais recente
    v_entry := public.reconcile_user_matchmaking_queue(v_caller_id);

    IF v_entry.id IS NULL OR v_entry.status NOT IN ('waiting', 'matched') THEN
        RETURN jsonb_build_object('success', true, 'data', null, 'error', null);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'queue_id', v_entry.id,
            'game_id', v_entry.game_id,
            'status', v_entry.status,
            'match_id', v_entry.match_id,
            'expires_at', v_entry.expires_at,
            'created_at', v_entry.created_at
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_matchmaking_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_matchmaking_status() TO authenticated;
