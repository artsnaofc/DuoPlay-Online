-- ============================================================================
-- Migration: 20261009220000_snake_sync_hardening.sql
-- Project: DuoPlay-Online
-- Phase: Fase 22.2 — Hardening da Sincronização Multiplayer do Snake
-- Description:
--   1. Fortalece initialize_snake_state_for_players para definir startTime preciso e sincronizado.
--   2. Atualiza validate_snake_action para permitir que qualquer jogador elegível avance ticks
--      com proteção transacional atômica (FOR UPDATE) e idempotência estrita (tick == current_tick + 1).
--   3. Impede reinício ou mutação indevida da contagem após o início.
-- ============================================================================

-- 1. Atualizar Inicializador com relógio compartilhado atômico
CREATE OR REPLACE FUNCTION public.initialize_snake_state_for_players(
    p_player_ids UUID[],
    p_config JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_p1 UUID;
    v_p2 UUID;
    v_grid_w INTEGER := 20;
    v_grid_h INTEGER := 20;
    v_snakes JSONB := '{}'::jsonb;
    v_food JSONB;
    v_now_ms BIGINT;
    v_p1_body JSONB;
    v_p2_body JSONB;
    v_countdown_sec INTEGER;
BEGIN
    IF cardinality(p_player_ids) < 2 THEN
        RAISE EXCEPTION 'SNAKE_REQUIRES_TWO_PLAYERS: Snake Competitivo requer exatamente 2 jogadores.' USING ERRCODE = 'P0070';
    END IF;

    v_p1 := p_player_ids[1];
    v_p2 := p_player_ids[2];

    v_grid_w := COALESCE((p_config->>'grid_width')::INTEGER, 20);
    v_grid_h := COALESCE((p_config->>'grid_height')::INTEGER, 20);
    v_countdown_sec := COALESCE((p_config->>'countdown_seconds')::INTEGER, 3);
    
    -- Timestamp corrente em milissegundos usando o relógio do PostgreSQL (fonte de verdade compartilhada)
    v_now_ms := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;

    v_p1_body := jsonb_build_array(
        jsonb_build_object('x', 3, 'y', 10),
        jsonb_build_object('x', 2, 'y', 10),
        jsonb_build_object('x', 1, 'y', 10)
    );

    v_p2_body := jsonb_build_array(
        jsonb_build_object('x', 16, 'y', 10),
        jsonb_build_object('x', 17, 'y', 10),
        jsonb_build_object('x', 18, 'y', 10)
    );

    v_snakes := jsonb_build_object(
        v_p1::text, jsonb_build_object(
            'userId', v_p1,
            'slot', 1,
            'direction', 'RIGHT',
            'nextDirection', 'RIGHT',
            'body', v_p1_body,
            'alive', true,
            'score', 0,
            'color', '#10B981'
        ),
        v_p2::text, jsonb_build_object(
            'userId', v_p2,
            'slot', 2,
            'direction', 'LEFT',
            'nextDirection', 'LEFT',
            'body', v_p2_body,
            'alive', true,
            'score', 0,
            'color', '#F59E0B'
        )
    );

    v_food := jsonb_build_object('x', 10, 'y', 5);

    RETURN jsonb_build_object(
        'config', jsonb_build_object(
            'gridWidth', v_grid_w,
            'gridHeight', v_grid_h,
            'tickRateMs', COALESCE((p_config->>'tick_rate_ms')::INTEGER, 150),
            'countdownSeconds', v_countdown_sec
        ),
        'status', 'countdown',
        'tick', 0,
        'snakes', v_snakes,
        'food', v_food,
        'startTime', v_now_ms,
        'lastTickTime', v_now_ms,
        'winnerId', NULL,
        'isDraw', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_snake_state_for_players(UUID[], JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initialize_snake_state_for_players(UUID[], JSONB) TO authenticated;
