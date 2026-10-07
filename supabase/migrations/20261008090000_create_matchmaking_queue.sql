-- ============================================================================
-- Migration: 20261008090000_create_matchmaking_queue.sql
-- Project: DuoPlay-Online
-- Phase: Fase 10 — Matchmaking Público para Jogo da Velha
-- Description: Tabela matchmaking_queue e 3 RPCs autoritativas
--              (join_matchmaking_queue, cancel_matchmaking_queue, get_my_matchmaking_status)
--              com suporte a concorrência atômica via FOR UPDATE SKIP LOCKED,
--              índice único parcial para busca ativa e expiração segura.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabela de Fila de Matchmaking (matchmaking_queue)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.matchmaking_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    game_id VARCHAR(50) NOT NULL REFERENCES public.games(id),
    status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'matched', 'cancelled', 'expired')),
    match_id UUID REFERENCES public.matches(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '5 minutes'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.matchmaking_queue IS 'Fila pública de pareamento autoritativo para partidas rápidas.';

-- Índices otimizados para busca e concorrência
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_game_status ON public.matchmaking_queue (game_id, status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_user_status ON public.matchmaking_queue (user_id, status);

-- Garantia do Banco de Dados: Um usuário não pode ter mais de uma busca 'waiting' ativa simultânea
CREATE UNIQUE INDEX IF NOT EXISTS idx_matchmaking_queue_user_waiting 
ON public.matchmaking_queue (user_id) 
WHERE status = 'waiting';

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
-- 2. RPC: cancel_matchmaking_queue()
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
    v_entry RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- Localizar registro ativo de fila do próprio chamador
    SELECT * INTO v_entry
    FROM public.matchmaking_queue
    WHERE user_id = v_caller_id
      AND status IN ('waiting', 'matched')
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'status', 'cancelled',
                'match_id', null
            ),
            'error', null
        );
    END IF;

    -- Se já tiver sido pareado no momento do cancelamento, não desfaz a partida criada
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

    -- Atualiza status para cancelado
    UPDATE public.matchmaking_queue
    SET status = 'cancelled', updated_at = clock_timestamp()
    WHERE id = v_entry.id;

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
-- 3. RPC: join_matchmaking_queue(p_game_id)
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
    v_my_entry RECORD;
    v_opponent_entry RECORD;
    v_new_match_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 1. Validar jogo suportado nesta fase (apenas tic_tac_toe)
    IF p_game_id IS NULL OR p_game_id != 'tic_tac_toe' THEN
        RAISE EXCEPTION 'GAME_NOT_ACTIVE: Apenas o Jogo da Velha possui matchmaking público ativo.' USING ERRCODE = 'P0015';
    END IF;

    -- 2. Validar que o usuário não está em uma partida ativa
    SELECT m.id INTO v_active_match_id
    FROM public.matches m
    JOIN public.match_players mp ON mp.match_id = m.id
    WHERE mp.user_id = v_caller_id
      AND m.status = 'in_progress'
    LIMIT 1;

    IF v_active_match_id IS NOT NULL THEN
        RAISE EXCEPTION 'PLAYER_IN_ACTIVE_MATCH: Você já está em uma partida em andamento.' USING ERRCODE = 'P0013';
    END IF;

    -- 3. Verificar se a própria pessoa já tem uma busca 'waiting' ou 'matched' ativa
    SELECT * INTO v_my_entry
    FROM public.matchmaking_queue
    WHERE user_id = v_caller_id
      AND status IN ('waiting', 'matched')
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        IF v_my_entry.status = 'matched' AND v_my_entry.match_id IS NOT NULL THEN
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
        ELSIF v_my_entry.status = 'waiting' THEN
            -- Se tiver expirado, marca expired para liberar novo cadastro
            IF clock_timestamp() > v_my_entry.expires_at THEN
                UPDATE public.matchmaking_queue
                SET status = 'expired', updated_at = clock_timestamp()
                WHERE id = v_my_entry.id;
            ELSE
                -- Tenta pareamento imediato reutilizando a entrada ativa
                -- Procura um oponente na fila 'waiting' usando FOR UPDATE SKIP LOCKED
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
                    -- Parear v_my_entry e v_opponent_entry na mesma partida
                    v_new_match_id := gen_random_uuid();

                    -- Inserir nova partida oficial
                    INSERT INTO public.matches (
                        id, room_id, game_id, status, current_turn_player_id,
                        turn_deadline, turn_number, game_state, action_history, created_at, started_at
                    ) VALUES (
                        v_new_match_id, NULL, p_game_id, 'in_progress', v_opponent_entry.user_id,
                        clock_timestamp() + INTERVAL '30 seconds', 1, '{}'::jsonb, '[]'::jsonb,
                        clock_timestamp(), clock_timestamp()
                    );

                    -- Inserir participantes (Slot 1 = Oponente que esperou primeiro, Slot 2 = Chamador)
                    INSERT INTO public.match_players (
                        match_id, user_id, slot, game_symbol, score, is_winner, joined_at
                    ) VALUES
                    (v_new_match_id, v_opponent_entry.user_id, 1, 'X', 0, false, clock_timestamp()),
                    (v_new_match_id, v_caller_id, 2, 'O', 0, false, clock_timestamp());

                    -- Atualizar entradas da fila
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
                    -- Nenhum oponente disponível ainda; permanece em waiting
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
        END IF;
    END IF;

    -- 4. Procurar oponente disponível em 'waiting' via FOR UPDATE SKIP LOCKED
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
        -- Criar partida instantânea entre v_opponent_entry e v_caller_id
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

        -- Atualizar a entrada do oponente
        UPDATE public.matchmaking_queue
        SET status = 'matched', match_id = v_new_match_id, updated_at = clock_timestamp()
        WHERE id = v_opponent_entry.id;

        -- Registrar minha entrada já como 'matched'
        INSERT INTO public.matchmaking_queue (
            user_id, game_id, status, match_id, expires_at
        ) VALUES (
            v_caller_id, p_game_id, 'matched', v_new_match_id, clock_timestamp() + INTERVAL '5 minutes'
        )
        ON CONFLICT (user_id) WHERE status = 'waiting'
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

    -- 5. Se nenhum oponente foi encontrado, cria novo registro em 'waiting'
    INSERT INTO public.matchmaking_queue (
        user_id, game_id, status, expires_at
    ) VALUES (
        v_caller_id, p_game_id, 'waiting', clock_timestamp() + INTERVAL '5 minutes'
    )
    ON CONFLICT (user_id) WHERE status = 'waiting'
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
-- 4. RPC: get_my_matchmaking_status()
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
    v_entry RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'data', null, 'error', null);
    END IF;

    SELECT * INTO v_entry
    FROM public.matchmaking_queue
    WHERE user_id = v_caller_id
      AND status IN ('waiting', 'matched')
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', true, 'data', null, 'error', null);
    END IF;

    -- Se estiver aguardando mas expirou por tempo (> 5 min)
    IF v_entry.status = 'waiting' AND clock_timestamp() > v_entry.expires_at THEN
        UPDATE public.matchmaking_queue
        SET status = 'expired', updated_at = clock_timestamp()
        WHERE id = v_entry.id;

        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'queue_id', v_entry.id,
                'game_id', v_entry.game_id,
                'status', 'expired',
                'match_id', null,
                'expires_at', v_entry.expires_at,
                'created_at', v_entry.created_at
            ),
            'error', null
        );
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
