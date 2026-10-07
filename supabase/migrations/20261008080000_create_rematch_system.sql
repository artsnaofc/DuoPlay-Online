-- ============================================================================
-- Migration: 20261008080000_create_rematch_system.sql
-- Project: DuoPlay-Online
-- Phase: Fase 9.1 — Correção de Segurança da Migration de Rematch
-- Description: Tabela de solicitações de revanche e 3 RPCs autoritativas
--              (request_rematch, respond_to_rematch, get_pending_rematch_for_match)
--              com suporte a concorrência, índice único parcial para pending,
--              bloqueio a terceiros e função VOLATILE para atualização de expiração.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabela de Solicitações de Revanche (rematch_requests)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rematch_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    game_id VARCHAR(50) NOT NULL REFERENCES public.games(id),
    room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
    requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    opponent_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
    new_match_id UUID REFERENCES public.matches(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '2 minutes'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT rematch_requests_players_diff_check CHECK (requester_id != opponent_id)
);

COMMENT ON TABLE public.rematch_requests IS 'Solicitações autoritativas de revanche bilateral pós-jogo.';

-- Índices otimizados
CREATE INDEX IF NOT EXISTS idx_rematch_requests_original_match ON public.rematch_requests (original_match_id);
CREATE INDEX IF NOT EXISTS idx_rematch_requests_requester ON public.rematch_requests (requester_id);
CREATE INDEX IF NOT EXISTS idx_rematch_requests_opponent ON public.rematch_requests (opponent_id);
CREATE INDEX IF NOT EXISTS idx_rematch_requests_status ON public.rematch_requests (status);

-- Proteção de concorrência no banco: no máximo um pedido pendente por partida original
CREATE UNIQUE INDEX IF NOT EXISTS idx_rematch_requests_pending_unique 
ON public.rematch_requests (original_match_id) 
WHERE status = 'pending';

-- Row Level Security (RLS)
ALTER TABLE public.rematch_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Rematch requests viewable by match participants" ON public.rematch_requests;
CREATE POLICY "Rematch requests viewable by match participants" ON public.rematch_requests
    FOR SELECT USING (
        auth.uid() IS NOT NULL AND (auth.uid() = requester_id OR auth.uid() = opponent_id)
    );

-- Habilitar publicação Realtime se a publicação existir
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.rematch_requests;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 2. RPC: respond_to_rematch(p_rematch_request_id, p_accept)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_to_rematch(
    p_rematch_request_id UUID,
    p_accept BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_req RECORD;
    v_slot1_user_id UUID;
    v_slot2_user_id UUID;
    v_new_match_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- Trava a solicitação para garantir execução atômica contra requisições concorrentes
    SELECT * INTO v_req
    FROM public.rematch_requests
    WHERE id = p_rematch_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REMATCH_NOT_FOUND: Pedido de revanche não encontrado.' USING ERRCODE = 'P0016';
    END IF;

    -- Validar destinatário do pedido
    IF v_req.requester_id = v_caller_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED: O solicitante não pode aceitar seu próprio pedido de revanche.' USING ERRCODE = 'P0001';
    END IF;

    IF v_req.opponent_id != v_caller_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Você não é o destinatário deste pedido de revanche.' USING ERRCODE = 'P0001';
    END IF;

    -- Idempotência: Se já tiver sido aceito anteriormente, retorna a partida já criada
    IF v_req.status = 'accepted' AND v_req.new_match_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'status', 'accepted',
                'rematch_request_id', v_req.id,
                'new_match_id', v_req.new_match_id,
                'original_match_id', v_req.original_match_id
            ),
            'error', null
        );
    END IF;

    -- Se já estiver recusado
    IF v_req.status = 'declined' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'O pedido de revanche foi recusado.',
            'code', 'REMATCH_DECLINED'
        );
    END IF;

    -- Se já tiver expirado
    IF v_req.status = 'expired' OR clock_timestamp() > v_req.expires_at THEN
        UPDATE public.rematch_requests
        SET status = 'expired', updated_at = clock_timestamp()
        WHERE id = v_req.id;

        RETURN jsonb_build_object(
            'success', false,
            'error', 'O pedido de revanche expirou.',
            'code', 'REMATCH_EXPIRED'
        );
    END IF;

    IF v_req.status != 'pending' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'O pedido de revanche não está mais ativo.',
            'code', 'REMATCH_INACTIVE'
        );
    END IF;

    -- Tratar recusa
    IF p_accept IS FALSE THEN
        UPDATE public.rematch_requests
        SET status = 'declined', updated_at = clock_timestamp()
        WHERE id = v_req.id;

        -- Notifica ouvintes da partida original via Realtime
        UPDATE public.matches
        SET updated_at = clock_timestamp()
        WHERE id = v_req.original_match_id;

        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'status', 'declined',
                'rematch_request_id', v_req.id,
                'original_match_id', v_req.original_match_id
            ),
            'error', null
        );
    END IF;

    -- Tratar aceite explícito: criar nova partida limpa com os mesmos participantes
    SELECT user_id INTO v_slot1_user_id
    FROM public.match_players
    WHERE match_id = v_req.original_match_id AND slot = 1;

    SELECT user_id INTO v_slot2_user_id
    FROM public.match_players
    WHERE match_id = v_req.original_match_id AND slot = 2;

    IF v_slot1_user_id IS NULL OR v_slot2_user_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_PLAYERS: Participantes da partida original não encontrados.' USING ERRCODE = 'P0018';
    END IF;

    v_new_match_id := gen_random_uuid();

    -- Inserir nova partida oficial zerada
    INSERT INTO public.matches (
        id,
        room_id,
        game_id,
        status,
        current_turn_player_id,
        turn_deadline,
        turn_number,
        game_state,
        action_history,
        created_at,
        started_at
    ) VALUES (
        v_new_match_id,
        v_req.room_id,
        v_req.game_id,
        'in_progress',
        v_slot1_user_id,
        clock_timestamp() + INTERVAL '30 seconds',
        1,
        '{}'::jsonb,
        '[]'::jsonb,
        clock_timestamp(),
        clock_timestamp()
    );

    -- Inserir participantes com estado zerado
    INSERT INTO public.match_players (
        match_id, user_id, slot, game_symbol, score, is_winner, joined_at
    ) VALUES
    (v_new_match_id, v_slot1_user_id, 1, 'X', 0, false, clock_timestamp()),
    (v_new_match_id, v_slot2_user_id, 2, 'O', 0, false, clock_timestamp());

    -- Atualizar referência na sala, se houver
    IF v_req.room_id IS NOT NULL THEN
        UPDATE public.rooms
        SET current_match_id = v_new_match_id, status = 'in_game', updated_at = clock_timestamp()
        WHERE id = v_req.room_id;
    END IF;

    -- Atualizar registro do pedido de revanche
    UPDATE public.rematch_requests
    SET status = 'accepted', new_match_id = v_new_match_id, updated_at = clock_timestamp()
    WHERE id = v_req.id;

    -- Notifica ouvintes Realtime da partida anterior
    UPDATE public.matches
    SET updated_at = clock_timestamp()
    WHERE id = v_req.original_match_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'status', 'accepted',
            'rematch_request_id', v_req.id,
            'new_match_id', v_new_match_id,
            'original_match_id', v_req.original_match_id
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_rematch(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_rematch(UUID, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. RPC: request_rematch(p_original_match_id)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_rematch(
    p_original_match_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_orig_match RECORD;
    v_opponent_id UUID;
    v_existing_req RECORD;
    v_req RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 1. Validar EXPLICITAMENTE que auth.uid() participou da partida original
    IF NOT EXISTS (
        SELECT 1 FROM public.match_players
        WHERE match_id = p_original_match_id AND user_id = v_caller_id
    ) THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: O usuário não participou desta partida.' USING ERRCODE = 'P0018';
    END IF;

    -- 2. Travar e verificar a partida original
    SELECT * INTO v_orig_match
    FROM public.matches
    WHERE id = p_original_match_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MATCH_NOT_FOUND: Partida original não encontrada.' USING ERRCODE = 'P0016';
    END IF;

    IF v_orig_match.status NOT IN ('finished', 'abandoned', 'cancelled') THEN
        RAISE EXCEPTION 'INVALID_MATCH_STATUS: Revanche só é permitida em partidas finalizadas.' USING ERRCODE = 'P0013';
    END IF;

    -- 3. Localizar oponente na partida original
    SELECT user_id INTO v_opponent_id
    FROM public.match_players
    WHERE match_id = p_original_match_id AND user_id != v_caller_id
    LIMIT 1;

    IF v_opponent_id IS NULL THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: Oponente não encontrado nesta partida.' USING ERRCODE = 'P0018';
    END IF;

    -- 4. Checar se já existe um pedido ativo de revanche para esta partida
    SELECT * INTO v_existing_req
    FROM public.rematch_requests
    WHERE original_match_id = p_original_match_id
      AND status IN ('pending', 'accepted')
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
        -- Caso tenha sido aceito anteriormente
        IF v_existing_req.status = 'accepted' THEN
            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'rematch_request_id', v_existing_req.id,
                    'status', 'accepted',
                    'new_match_id', v_existing_req.new_match_id,
                    'original_match_id', p_original_match_id
                ),
                'error', null
            );
        ELSIF v_existing_req.status = 'pending' THEN
            -- Caso o pedido tenha expirado
            IF clock_timestamp() > v_existing_req.expires_at THEN
                UPDATE public.rematch_requests
                SET status = 'expired', updated_at = clock_timestamp()
                WHERE id = v_existing_req.id;
            ELSE
                -- Aceite Bilateral Estrito: Se já existe um pedido pendente (seja meu ou do oponente),
                -- RETORNA OS DADOS DO PEDIDO PENDENTE sem criar partida nem aceitar automaticamente.
                RETURN jsonb_build_object(
                    'success', true,
                    'data', jsonb_build_object(
                        'rematch_request_id', v_existing_req.id,
                        'status', 'pending',
                        'original_match_id', p_original_match_id,
                        'requester_id', v_existing_req.requester_id,
                        'opponent_id', v_existing_req.opponent_id,
                        'is_my_request', (v_existing_req.requester_id = v_caller_id),
                        'expires_at', v_existing_req.expires_at
                    ),
                    'error', null
                );
            END IF;
        END IF;
    END IF;

    -- 5. Criar novo registro de solicitação de revanche
    INSERT INTO public.rematch_requests (
        original_match_id,
        game_id,
        room_id,
        requester_id,
        opponent_id,
        status,
        expires_at
    ) VALUES (
        p_original_match_id,
        v_orig_match.game_id,
        v_orig_match.room_id,
        v_caller_id,
        v_opponent_id,
        'pending',
        clock_timestamp() + INTERVAL '2 minutes'
    ) RETURNING * INTO v_req;

    -- Força disparo no Realtime da partida original
    UPDATE public.matches
    SET updated_at = clock_timestamp()
    WHERE id = p_original_match_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'rematch_request_id', v_req.id,
            'status', 'pending',
            'original_match_id', p_original_match_id,
            'requester_id', v_caller_id,
            'opponent_id', v_opponent_id,
            'is_my_request', true,
            'expires_at', v_req.expires_at
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.request_rematch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_rematch(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. RPC: get_pending_rematch_for_match(p_original_match_id)
--    Declarada como VOLATILE pois pode atualizar o status para 'expired'.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pending_rematch_for_match(
    p_original_match_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_req RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'data', null, 'error', null);
    END IF;

    -- Filtro de segurança: apenas os dois participantes da partida podem consultar
    SELECT * INTO v_req
    FROM public.rematch_requests
    WHERE original_match_id = p_original_match_id
      AND (requester_id = v_caller_id OR opponent_id = v_caller_id)
      AND status IN ('pending', 'accepted', 'declined')
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', true, 'data', null, 'error', null);
    END IF;

    -- Se pendente mas expirado, atualiza autoritativamente para expired
    IF v_req.status = 'pending' AND clock_timestamp() > v_req.expires_at THEN
        UPDATE public.rematch_requests
        SET status = 'expired', updated_at = clock_timestamp()
        WHERE id = v_req.id;
        v_req.status := 'expired';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'rematch_request_id', v_req.id,
            'original_match_id', v_req.original_match_id,
            'game_id', v_req.game_id,
            'requester_id', v_req.requester_id,
            'opponent_id', v_req.opponent_id,
            'status', v_req.status,
            'new_match_id', v_req.new_match_id,
            'is_my_request', (v_req.requester_id = v_caller_id),
            'expires_at', v_req.expires_at,
            'created_at', v_req.created_at
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_rematch_for_match(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_rematch_for_match(UUID) TO authenticated;
