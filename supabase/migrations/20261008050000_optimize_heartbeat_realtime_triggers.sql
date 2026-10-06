-- ============================================================================
-- Migration: 20261008050000_optimize_heartbeat_realtime_triggers.sql
-- Project: DuoPlay-Online
-- Phase: Fase 7.1.1 — Integração Real de Presence, Recovery e Abandono
-- Description: Otimiza heartbeat_match para atualizar matches.updated_at
--              exclusivamente quando houver mudança real no status de presença
--              (conexão/desconexão), evitando loops e disparos excessivos de Realtime.
-- ============================================================================

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
    v_status_changed BOOLEAN := false;
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

    -- 1. Atualizar presença do jogador chamador
    -- Se o jogador estava desconectado, reconecta e sinaliza mudança de estado
    UPDATE public.match_players
    SET last_seen_at = v_now,
        connection_status = 'connected',
        disconnected_at = NULL,
        grace_period_expires_at = NULL
    WHERE match_id = p_match_id 
      AND user_id = v_caller_id
      AND connection_status != 'connected';

    IF FOUND THEN
        v_status_changed := true;
    END IF;

    -- Atualiza last_seen_at para chamador que já estava conectado
    UPDATE public.match_players
    SET last_seen_at = v_now
    WHERE match_id = p_match_id 
      AND user_id = v_caller_id
      AND connection_status = 'connected';

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
        v_status_changed := true;
    END IF;

    -- 3. Atualizar timestamp de mutação da partida para disparo de Realtime
    -- APENAS se houve transição no status de presença (evita tempestade de notificações)
    IF v_status_changed THEN
        UPDATE public.matches
        SET updated_at = v_now
        WHERE id = p_match_id;
    END IF;

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
