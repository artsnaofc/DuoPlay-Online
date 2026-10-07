-- ============================================================================
-- Migration: 20261008090000_create_matchmaking_queue.sql
-- Project: DuoPlay-Online
-- Phase: Fase 10 & 10.1 — Matchmaking Público e Correção de Concorrência/Reentrada
-- Description: Tabela matchmaking_queue, suporte a status 'completed',
--              reconciliação automática de partidas finalizadas, trava advisory
--              por usuário (pg_advisory_xact_lock), e RPCs autoritativas
--              (join_matchmaking_queue, cancel_matchmaking_queue, get_my_matchmaking_status).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabela de Fila de Matchmaking (matchmaking_queue)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.matchmaking_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    game_id VARCHAR(50) NOT NULL REFERENCES public.games(id),
    status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'matched', 'cancelled', 'expired', 'completed')),
    match_id UUID REFERENCES public.matches(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '5 minutes'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Atualiza a constraint de CHECK para garantir inclusão de 'completed' em bancos onde a tabela já exista
DO $$
BEGIN
    ALTER TABLE public.matchmaking_queue DROP CONSTRAINT IF EXISTS matchmaking_queue_status_check;
    ALTER TABLE public.matchmaking_queue ADD CONSTRAINT matchmaking_queue_status_check CHECK (status IN ('waiting', 'matched', 'cancelled', 'expired', 'completed'));
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

COMMENT ON TABLE public.matchmaking_queue IS 'Fila pública de pareamento autoritativo para partidas rápidas.';

-- Índices otimizados para busca e concorrência
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_game_status ON public.matchmaking_queue (game_id, status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_user_status ON public.matchmaking_queue (user_id, status);

-- Remove índice antigo restrito apenas a 'waiting' se existir
DROP INDEX IF EXISTS public.idx_matchmaking_queue_user_waiting;

-- Garantia do Banco de Dados: Um usuário não pode ter mais de uma busca ativa ('waiting' ou 'matched') simultânea
CREATE UNIQUE INDEX IF NOT EXISTS idx_matchmaking_queue_user_active 
ON public.matchmaking_queue (user_id) 
WHERE status IN ('waiting', 'matched');

-- Row Level Security (RLS)
ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Matchmaking entries viewable by owner" ON public.matchmaking_queue;
CREATE POLICY "Matchmaking entries viewable by owner" ON public.matchmaking_queue
    FOR SELECT USING (
        auth.uid() IS NOT NULL AND auth.uid() = user_id
    );

-- Habilitar publicação Realtime se a publicação existir
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.matchmaking_queue;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Rotina de Reconciliação Interna de Fila (Privada / Não Exposta ao Cliente)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_user_matchmaking_queue(p_user_id UUID)
RETURNS public.matchmaking_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_entry public.matchmaking_queue%ROWTYPE;
    v_match_status VARCHAR(20);
BEGIN
    -- Defesa Adicional Obrigatória: p_user_id deve corresponder estritamente a auth.uid()
    IF p_user_id IS NULL OR auth.uid() IS NULL OR p_user_id != auth.uid() THEN
        RETURN NULL;
    END IF;

    -- Localiza qualquer entrada ativa ('waiting' ou 'matched') do próprio usuário
    SELECT * INTO v_entry
    FROM public.matchmaking_queue
    WHERE user_id = p_user_id
      AND status IN ('waiting', 'matched')
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

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

-- Revoga a permissão de execução de todos os papéis de cliente (rotina puramente interna)
REVOKE ALL ON FUNCTION public.reconcile_user_matchmaking_queue(UUID) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. RPC: cancel_matchmaking_queue()
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_matchmaking_queue()
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
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- Trava transacional por usuário para serializar concorrência da mesma pessoa
    PERFORM pg_advisory_xact_lock(hashtext(v_caller_id::text));

    -- Reconciliar estado da fila do usuário
    v_entry := public.reconcile_user_matchmaking_queue(v_caller_id);

    IF v_entry.id IS NULL OR v_entry.status NOT IN ('waiting', 'matched') THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'status', 'cancelled',
                'match_id', null
            ),
            'error', null
        );
    END IF;

    -- Se 'matched' com partida ainda 'in_progress', retorna a partida ativa sem desfazê-la
    IF v_entry.status = 'matched' AND v_entry.match_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'status', 'matched',
                'match_id', v_entry.match_id
            ),
            'error', null
        );
    END IF;

    -- Se estava 'waiting', altera para 'cancelled'
    IF v_entry.status = 'waiting' THEN
        UPDATE public.matchmaking_queue
        SET status = 'cancelled', updated_at = clock_timestamp()
        WHERE id = v_entry.id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'status', 'cancelled',
            'match_id', null
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_matchmaking_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_matchmaking_queue() TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. RPC: join_matchmaking_queue(p_game_id)
-- ----------------------------------------------------------------------------
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

    -- 1. Validar jogo suportado
    IF p_game_id IS NULL OR p_game_id != 'tic_tac_toe' THEN
        RAISE EXCEPTION 'GAME_NOT_ACTIVE: Apenas o Jogo da Velha possui matchmaking público ativo.' USING ERRCODE = 'P0015';
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

    -- 4. Validar se o usuário não está em uma partida ativa por fora da fila (ex: salas privadas)
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
        -- Tenta pareamento imediato procurando oponente via FOR UPDATE SKIP LOCKED
        SELECT * INTO v_opponent_entry
        FROM public.matchmaking_queue
        WHERE game_id = p_game_id
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
                v_new_match_id, NULL, p_game_id, 'in_progress', v_opponent_entry.user_id,
                clock_timestamp() + INTERVAL '30 seconds', 1, '{}'::jsonb, '[]'::jsonb,
                clock_timestamp(), clock_timestamp()
            );

            INSERT INTO public.match_players (
                match_id, user_id, slot, game_symbol, score, is_winner, joined_at
            ) VALUES
            (v_new_match_id, v_opponent_entry.user_id, 1, 'X', 0, false, clock_timestamp()),
            (v_new_match_id, v_caller_id, 2, 'O', 0, false, clock_timestamp());

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
            -- Nenhum oponente disponível ainda; permanece aguardando
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

    -- 6. Chamador não tem entrada ativa. Procurar oponente disponível em 'waiting'
    SELECT * INTO v_opponent_entry
    FROM public.matchmaking_queue
    WHERE game_id = p_game_id
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
            v_new_match_id, NULL, p_game_id, 'in_progress', v_opponent_entry.user_id,
            clock_timestamp() + INTERVAL '30 seconds', 1, '{}'::jsonb, '[]'::jsonb,
            clock_timestamp(), clock_timestamp()
        );

        INSERT INTO public.match_players (
            match_id, user_id, slot, game_symbol, score, is_winner, joined_at
        ) VALUES
        (v_new_match_id, v_opponent_entry.user_id, 1, 'X', 0, false, clock_timestamp()),
        (v_new_match_id, v_caller_id, 2, 'O', 0, false, clock_timestamp());

        -- Atualizar entrada do oponente para matched
        UPDATE public.matchmaking_queue
        SET status = 'matched', match_id = v_new_match_id, updated_at = clock_timestamp()
        WHERE id = v_opponent_entry.id;

        -- Registrar entrada do chamador como matched
        INSERT INTO public.matchmaking_queue (
            user_id, game_id, status, match_id, expires_at
        ) VALUES (
            v_caller_id, p_game_id, 'matched', v_new_match_id, clock_timestamp() + INTERVAL '5 minutes'
        )
        ON CONFLICT (user_id) WHERE status IN ('waiting', 'matched')
        DO UPDATE SET status = 'matched', match_id = v_new_match_id, updated_at = clock_timestamp()
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
    END IF;

    -- 7. Nenhum oponente disponível. Criar nova entrada em 'waiting'
    INSERT INTO public.matchmaking_queue (
        user_id, game_id, status, expires_at
    ) VALUES (
        v_caller_id, p_game_id, 'waiting', clock_timestamp() + INTERVAL '5 minutes'
    )
    ON CONFLICT (user_id) WHERE status IN ('waiting', 'matched')
    DO UPDATE SET updated_at = clock_timestamp()
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
END;
$$;

REVOKE ALL ON FUNCTION public.join_matchmaking_queue(VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_matchmaking_queue(VARCHAR) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. RPC: get_my_matchmaking_status()
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

    -- Trava transacional por usuário
    PERFORM pg_advisory_xact_lock(hashtext(v_caller_id::text));

    -- Reconciliar estado da fila do usuário
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
