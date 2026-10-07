-- ============================================================================
-- Migration: 20261008120000_harden_rematch_abandonment.sql
-- Project: DuoPlay-Online
-- Phase: Fase 12.1 — Correção de Fluidez da Revanche após Abandono
-- Description: Garante que abandonos e desistências invalidem imediatamente qualquer
--              revanche, desconectem o desistente no match_players, bloqueiem novas
--              solicitações no servidor com OPPONENT_UNAVAILABLE e notifiquem Realtime.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RPC Atualizada: finish_match (Marca desconexão no abandono & expira revanches)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_match(
    p_match_id UUID,
    p_reason VARCHAR(30),
    p_winner_id UUID DEFAULT NULL,
    p_is_draw BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_match RECORD;
    v_is_player BOOLEAN;
    v_player_count INTEGER;
    v_winner_id UUID := NULL;
    v_is_draw BOOLEAN := false;
    v_opponent RECORD;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    -- 1. Identificar usuário chamador
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Validar razão de encerramento
    IF p_reason NOT IN ('normal', 'timeout', 'abandonment', 'resignation') THEN
        RAISE EXCEPTION 'INVALID_FINISH_REASON: Motivo de encerramento inválido.' USING ERRCODE = 'P0020';
    END IF;

    -- 3. Localizar e travar a linha da partida (FOR UPDATE)
    SELECT * INTO v_match 
    FROM public.matches 
    WHERE id = p_match_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MATCH_NOT_FOUND: Partida não encontrada.' USING ERRCODE = 'P0016';
    END IF;

    -- 4. Validar pertencimento
    SELECT EXISTS (
        SELECT 1 FROM public.match_players 
        WHERE match_id = p_match_id AND user_id = v_caller_id
    ) INTO v_is_player;

    IF NOT v_is_player THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: O usuário não é participante desta partida.' USING ERRCODE = 'P0018';
    END IF;

    -- 5. Idempotência: Se já finalizada, retorna estado existente
    IF v_match.status != 'in_progress' THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'match_id', v_match.id,
                'status', v_match.status,
                'winner_id', v_match.winner_id,
                'is_draw', v_match.is_draw,
                'finish_reason', v_match.finish_reason,
                'idempotent', true
            ),
            'error', null
        );
    END IF;

    -- 6. Contagem de participantes
    SELECT count(*) INTO v_player_count
    FROM public.match_players
    WHERE match_id = p_match_id;

    -- 7. Validação e autoridade estrita do servidor por motivo de encerramento
    IF p_reason = 'normal' THEN
        RAISE EXCEPTION 'NORMAL_FINISH_NOT_AVAILABLE: Conclusão normal requer validador server-side de regras.' USING ERRCODE = 'P0025';

    ELSIF p_reason = 'abandonment' THEN
        -- Reivindicação de vitória por abandono do adversário após expiração do Grace Period
        IF v_player_count = 2 THEN
            SELECT * INTO v_opponent
            FROM public.match_players
            WHERE match_id = p_match_id AND user_id != v_caller_id
            LIMIT 1;

            -- Se o oponente não estava explicitamente desconectado, checa ausência de heartbeat
            IF v_opponent.connection_status = 'connected' AND v_opponent.last_seen_at < (v_now - interval '12 seconds') THEN
                v_opponent.connection_status := 'disconnected';
                v_opponent.disconnected_at := coalesce(v_opponent.disconnected_at, v_opponent.last_seen_at + interval '12 seconds');
                v_opponent.grace_period_expires_at := v_opponent.disconnected_at + interval '45 seconds';
                
                UPDATE public.match_players
                SET connection_status = 'disconnected',
                    disconnected_at = v_opponent.disconnected_at,
                    grace_period_expires_at = v_opponent.grace_period_expires_at
                WHERE id = v_opponent.id;
            END IF;

            IF v_opponent.connection_status != 'disconnected' THEN
                RAISE EXCEPTION 'OPPONENT_NOT_DISCONNECTED: O adversário ainda está conectado.' USING ERRCODE = 'P0034';
            END IF;

            IF v_opponent.grace_period_expires_at IS NULL OR v_now < v_opponent.grace_period_expires_at THEN
                RAISE EXCEPTION 'GRACE_PERIOD_NOT_EXPIRED: O prazo de carência do adversário ainda não expirou no servidor.' USING ERRCODE = 'P0035';
            END IF;

            v_winner_id := v_caller_id;
            v_is_draw := false;
        ELSE
            RAISE EXCEPTION 'MULTI_PLAYER_ABANDONMENT_POLICY_PENDING: Não suportado para 3+ jogadores.' USING ERRCODE = 'P0036';
        END IF;

    ELSIF p_reason = 'resignation' THEN
        -- Desistência voluntária do próprio chamador
        IF v_player_count = 2 THEN
            -- O adversário é declarado vencedor
            SELECT user_id INTO v_winner_id
            FROM public.match_players
            WHERE match_id = p_match_id AND user_id != v_caller_id
            LIMIT 1;

            v_is_draw := false;

            -- O desistente/abandonador é imediatamente marcado como desconectado
            UPDATE public.match_players
            SET connection_status = 'disconnected',
                disconnected_at = v_now
            WHERE match_id = p_match_id AND user_id = v_caller_id;
        ELSIF v_player_count = 1 THEN
            v_winner_id := NULL;
            v_is_draw := false;

            UPDATE public.match_players
            SET connection_status = 'disconnected',
                disconnected_at = v_now
            WHERE match_id = p_match_id AND user_id = v_caller_id;
        ELSE
            RAISE EXCEPTION 'MULTI_PLAYER_RESIGNATION_POLICY_PENDING: Não suportado para 3+ jogadores.' USING ERRCODE = 'P0027';
        END IF;

    ELSIF p_reason = 'timeout' THEN
        IF v_match.turn_deadline IS NULL OR v_now < v_match.turn_deadline THEN
            RAISE EXCEPTION 'TURN_TIMEOUT_NOT_EXPIRED: O prazo do turno ainda não expirou no servidor.' USING ERRCODE = 'P0021';
        END IF;

        IF v_player_count = 2 THEN
            SELECT user_id INTO v_winner_id
            FROM public.match_players
            WHERE match_id = p_match_id AND user_id != v_match.current_turn_player_id
            LIMIT 1;

            v_is_draw := false;
        ELSE
            RAISE EXCEPTION 'MULTI_PLAYER_TIMEOUT_POLICY_PENDING: Não suportado para 3+ jogadores.' USING ERRCODE = 'P0028';
        END IF;
    END IF;

    -- 8. Atualizar status da partida no PostgreSQL
    UPDATE public.matches SET
        status = 'finished',
        winner_id = v_winner_id,
        is_draw = v_is_draw,
        finish_reason = p_reason,
        finished_at = v_now,
        updated_at = v_now
    WHERE id = p_match_id
    RETURNING * INTO v_match;

    -- 9. Atualizar flags nos match_players
    IF v_winner_id IS NOT NULL THEN
        UPDATE public.match_players 
        SET is_winner = (user_id = v_winner_id) 
        WHERE match_id = p_match_id;
    ELSE
        UPDATE public.match_players 
        SET is_winner = false 
        WHERE match_id = p_match_id;
    END IF;

    -- 10. Em caso de abandono ou desistência, invalidar qualquer revanche pendente
    IF p_reason IN ('resignation', 'abandonment') THEN
        UPDATE public.rematch_requests
        SET status = 'expired',
            updated_at = v_now
        WHERE original_match_id = p_match_id
          AND status = 'pending';
    END IF;

    -- 11. Liberar sala associada
    IF v_match.room_id IS NOT NULL THEN
        UPDATE public.rooms SET
            status = 'waiting',
            current_match_id = NULL,
            updated_at = v_now
        WHERE id = v_match.room_id AND current_match_id = p_match_id;
    END IF;

    -- 12. Atualização oficial de estatísticas nos perfis
    PERFORM set_config('duoplay.internal_system_operation', 'true', true);

    UPDATE public.profiles p
    SET 
        total_matches = p.total_matches + 1,
        total_wins = p.total_wins + (CASE WHEN v_is_draw = false AND p.id = v_winner_id THEN 1 ELSE 0 END),
        total_draws = p.total_draws + (CASE WHEN v_is_draw = true THEN 1 ELSE 0 END),
        total_losses = p.total_losses + (CASE WHEN v_is_draw = false AND v_winner_id IS NOT NULL AND p.id != v_winner_id THEN 1 ELSE 0 END)
    FROM public.match_players mp
    WHERE mp.match_id = p_match_id AND p.id = mp.user_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'match_id', v_match.id,
            'status', v_match.status,
            'winner_id', v_match.winner_id,
            'is_draw', v_match.is_draw,
            'finish_reason', v_match.finish_reason
        ),
        'error', null
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. RPC Atualizada: request_rematch (Recusa explícita se adversário abandonou)
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
    v_opp_last_seen TIMESTAMPTZ;
    v_opp_conn_status VARCHAR(20);
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

    -- 3. Localizar oponente na partida original e checar presença autoritativa
    SELECT user_id, last_seen_at, connection_status INTO v_opponent_id, v_opp_last_seen, v_opp_conn_status
    FROM public.match_players
    WHERE match_id = p_original_match_id AND user_id != v_caller_id
    LIMIT 1;

    IF v_opponent_id IS NULL THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: Oponente não encontrado nesta partida.' USING ERRCODE = 'P0018';
    END IF;

    -- Se a partida terminou por abandono ou desistência do oponente, oponente está indisponível
    IF v_orig_match.finish_reason = 'abandonment' 
       OR (v_orig_match.finish_reason = 'resignation' AND v_orig_match.winner_id = v_caller_id)
       OR v_opp_conn_status = 'disconnected' 
       OR (v_opp_last_seen IS NOT NULL AND v_opp_last_seen < (clock_timestamp() - INTERVAL '20 seconds')) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'O oponente não está mais disponível para revanche.',
            'code', 'OPPONENT_UNAVAILABLE'
        );
    END IF;

    -- 4. Checar se já existe um pedido de revanche para esta partida
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
            -- Caso o pedido tenha expirado por tempo (> 30s)
            IF clock_timestamp() > v_existing_req.expires_at THEN
                UPDATE public.rematch_requests
                SET status = 'expired', updated_at = clock_timestamp()
                WHERE id = v_existing_req.id;
            ELSE
                -- Aceite Bilateral Estrito: Se já existe um pedido pendente ativo, retorna os dados sem duplicar
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

    -- 5. Criar novo registro de solicitação de revanche com TTL centralizado de 30 segundos
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
        clock_timestamp() + INTERVAL '30 seconds'
    ) RETURNING * INTO v_req;

    -- Disparo de atualização no Realtime
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

-- ----------------------------------------------------------------------------
-- 3. RPC Atualizada: get_pending_rematch_for_match (Expira se oponente abandonou)
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
    v_orig_match RECORD;
    v_opp_last_seen TIMESTAMPTZ;
    v_opp_conn_status VARCHAR(20);
    v_target_opponent_id UUID;
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

    -- Se o pedido estiver pendente, checa tempo de expiração E disponibilidade do oponente
    IF v_req.status = 'pending' THEN
        SELECT * INTO v_orig_match FROM public.matches WHERE id = p_original_match_id;

        -- 1. Checagem de TTL (30 segundos)
        IF clock_timestamp() > v_req.expires_at THEN
            UPDATE public.rematch_requests
            SET status = 'expired', updated_at = clock_timestamp()
            WHERE id = v_req.id;
            v_req.status := 'expired';
        ELSE
            v_target_opponent_id := (CASE WHEN v_req.requester_id = v_caller_id THEN v_req.opponent_id ELSE v_req.requester_id END);
            
            -- 2. Checagem autoritativa de presença do oponente na partida original
            SELECT last_seen_at, connection_status INTO v_opp_last_seen, v_opp_conn_status
            FROM public.match_players
            WHERE match_id = p_original_match_id
              AND user_id = v_target_opponent_id;

            IF v_orig_match.finish_reason = 'abandonment'
               OR (v_orig_match.finish_reason = 'resignation' AND v_orig_match.winner_id != v_target_opponent_id)
               OR v_opp_conn_status = 'disconnected' 
               OR (v_opp_last_seen IS NOT NULL AND v_opp_last_seen < (clock_timestamp() - INTERVAL '20 seconds')) THEN
                UPDATE public.rematch_requests
                SET status = 'expired', updated_at = clock_timestamp()
                WHERE id = v_req.id;
                v_req.status := 'expired';
            END IF;
        END IF;
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

-- ----------------------------------------------------------------------------
-- 4. Adicionar public.rematch_requests à publicação Realtime se existir
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' 
              AND schemaname = 'public' 
              AND tablename = 'rematch_requests'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.rematch_requests;
        END IF;
    END IF;
END;
$$;
