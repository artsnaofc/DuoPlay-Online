-- ============================================================================
-- Migration: 20261008040000_add_match_presence_and_recovery.sql
-- Project: DuoPlay-Online
-- Phase: Fase 7.1 — Desconexão, Abandono e Retomada de Partida
-- Description: Adiciona colunas de presença/heartbeat em match_players,
--              RPCs de heartbeat, retomada de partida ativa, abandono e
--              reivindicação de vitória por abandono (Grace Period de 45s).
-- ============================================================================

-- 1. Colunas de Presença e Sincronização
ALTER TABLE public.matches
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.match_players
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS connection_status VARCHAR(20) NOT NULL DEFAULT 'connected' CHECK (connection_status IN ('connected', 'disconnected'));

-- Índice para otimizar busca de partidas ativas por jogador
CREATE INDEX IF NOT EXISTS idx_match_players_user_match_status
    ON public.match_players (user_id, match_id);

-- ----------------------------------------------------------------------------
-- 2. RPC: heartbeat_match (Atualização periódica de presença do jogador)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.heartbeat_match(
    p_match_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_match RECORD;
    v_opponent_disconnected BOOLEAN := false;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_players JSONB;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- Localizar e travar partida para atualização atômica
    SELECT * INTO v_match
    FROM public.matches
    WHERE id = p_match_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MATCH_NOT_FOUND: Partida não encontrada.' USING ERRCODE = 'P0016';
    END IF;

    -- Se a partida já terminou, retorna status final sem erro
    IF v_match.status != 'in_progress' THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'match_id', v_match.id,
                'status', v_match.status,
                'winner_id', v_match.winner_id,
                'finish_reason', v_match.finish_reason,
                'is_finished', true
            ),
            'error', null
        );
    END IF;

    -- Validar pertencimento do chamador
    IF NOT EXISTS (
        SELECT 1 FROM public.match_players WHERE match_id = p_match_id AND user_id = v_caller_id
    ) THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: O usuário não participa desta partida.' USING ERRCODE = 'P0018';
    END IF;

    -- 1. Atualizar presença do jogador chamador (reconecta automaticamente se estava desconectado)
    UPDATE public.match_players
    SET last_seen_at = v_now,
        connection_status = 'connected',
        disconnected_at = NULL,
        grace_period_expires_at = NULL
    WHERE match_id = p_match_id AND user_id = v_caller_id;

    -- 2. Detectar se o oponente deixou de enviar heartbeat (> 12 segundos)
    --    Threshold: ~12s (tolerância a pequenos atrasos no heartbeat de 5s)
    UPDATE public.match_players
    SET connection_status = 'disconnected',
        disconnected_at = coalesce(disconnected_at, v_now),
        grace_period_expires_at = coalesce(grace_period_expires_at, v_now + interval '45 seconds')
    WHERE match_id = p_match_id
      AND user_id != v_caller_id
      AND connection_status = 'connected'
      AND last_seen_at < (v_now - interval '12 seconds');

    IF FOUND THEN
        v_opponent_disconnected := true;
    END IF;

    -- 3. Atualizar timestamp de mutação da partida para disparo de Realtime se houve alteração
    UPDATE public.matches
    SET updated_at = v_now
    WHERE id = p_match_id;

    -- 4. Coletar estado consolidado dos participantes
    SELECT jsonb_agg(
        jsonb_build_object(
            'user_id', mp.user_id,
            'slot', mp.slot,
            'connection_status', mp.connection_status,
            'last_seen_at', mp.last_seen_at,
            'disconnected_at', mp.disconnected_at,
            'grace_period_expires_at', mp.grace_period_expires_at
        ) ORDER BY mp.slot ASC
    ) INTO v_players
    FROM public.match_players mp
    WHERE mp.match_id = p_match_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'match_id', v_match.id,
            'status', v_match.status,
            'players', coalesce(v_players, '[]'::jsonb),
            'server_time', v_now
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.heartbeat_match(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.heartbeat_match(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. RPC: get_active_match_for_current_user (Detecção de Partida Ativa ao Iniciar)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_active_match_for_current_user()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_match RECORD;
    v_opponent RECORD;
    v_opponent_profile RECORD;
    v_game RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'data', null, 'error', null);
    END IF;

    -- Localizar a partida ativa mais recente em que o usuário participa
    SELECT m.* INTO v_match
    FROM public.matches m
    JOIN public.match_players mp ON mp.match_id = m.id
    WHERE mp.user_id = v_caller_id
      AND m.status = 'in_progress'
    ORDER BY m.started_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', true, 'data', null, 'error', null);
    END IF;

    -- Dados do jogo
    SELECT * INTO v_game FROM public.games WHERE id = v_match.game_id;

    -- Dados do oponente (para exibição amigável no modal de recuperação)
    SELECT mp.* INTO v_opponent
    FROM public.match_players mp
    WHERE mp.match_id = v_match.id AND mp.user_id != v_caller_id
    LIMIT 1;

    IF FOUND THEN
        SELECT * INTO v_opponent_profile FROM public.profiles WHERE id = v_opponent.user_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'match_id', v_match.id,
            'room_id', v_match.room_id,
            'game_id', v_match.game_id,
            'game_name', coalesce(v_game.name, 'Jogo da Velha'),
            'turn_number', v_match.turn_number,
            'current_turn_player_id', v_match.current_turn_player_id,
            'opponent', CASE WHEN v_opponent.user_id IS NOT NULL THEN jsonb_build_object(
                'user_id', v_opponent.user_id,
                'display_name', coalesce(v_opponent_profile.display_name, 'Adversário'),
                'slot', v_opponent.slot,
                'connection_status', v_opponent.connection_status
            ) ELSE null END
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_match_for_current_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_match_for_current_user() TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Atualização da RPC finish_match com suporte oficial ao Grace Period (abandonment)
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
        ELSIF v_player_count = 1 THEN
            v_winner_id := NULL;
            v_is_draw := false;
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

    -- 10. Liberar sala associada
    IF v_match.room_id IS NOT NULL THEN
        UPDATE public.rooms SET
            status = 'waiting',
            current_match_id = NULL,
            updated_at = v_now
        WHERE id = v_match.room_id AND current_match_id = p_match_id;
    END IF;

    -- 11. Atualização oficial de estatísticas nos perfis
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

REVOKE ALL ON FUNCTION public.finish_match(UUID, VARCHAR, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_match(UUID, VARCHAR, UUID, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. RPC: abandon_match (Ação explícita de desistência/abandono do usuário)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.abandon_match(
    p_match_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public.finish_match(p_match_id, 'resignation');
END;
$$;

REVOKE ALL ON FUNCTION public.abandon_match(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abandon_match(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. RPC: claim_abandonment (Reivindicação de W.O. por expiração do Grace Period)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_abandonment(
    p_match_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public.finish_match(p_match_id, 'abandonment');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_abandonment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_abandonment(UUID) TO authenticated;
