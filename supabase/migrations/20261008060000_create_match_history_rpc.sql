-- ============================================================================
-- Migration: 20261008060000_create_match_history_rpc.sql
-- Project: DuoPlay-Online
-- Phase: Fase 8 — Resultado da Partida + Experiência Pós-Jogo
-- Description: Cria RPC segura para consulta paginada de histórico de partidas
--              do usuário autenticado com dados consolidados de oponentes e duração.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_my_match_history(
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_limit INTEGER;
    v_offset INTEGER;
    v_matches JSONB;
    v_total_count INTEGER;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- Limitar paginação entre 1 e 50 itens por página
    v_limit := coalesce(p_limit, 20);
    IF v_limit < 1 THEN v_limit := 20; END IF;
    IF v_limit > 50 THEN v_limit := 50; END IF;

    v_offset := coalesce(p_offset, 0);
    IF v_offset < 0 THEN v_offset := 0; END IF;

    -- Contagem total de partidas finalizadas do jogador
    SELECT count(DISTINCT m.id) INTO v_total_count
    FROM public.matches m
    JOIN public.match_players mp ON mp.match_id = m.id
    WHERE mp.user_id = v_caller_id
      AND m.status IN ('finished', 'abandoned', 'cancelled');

    -- Consulta estruturada com agregação JSON
    WITH user_matches AS (
        SELECT 
            m.id AS match_id,
            m.game_id,
            g.name AS game_name,
            m.status,
            m.winner_id,
            m.is_draw,
            m.finish_reason,
            m.turn_number,
            m.started_at,
            m.finished_at,
            ROUND(EXTRACT(EPOCH FROM (coalesce(m.finished_at, m.updated_at, m.started_at) - m.started_at)))::INTEGER AS duration_seconds,
            mp_me.slot AS my_slot,
            mp_me.game_symbol AS my_symbol,
            mp_me.score AS my_score,
            mp_me.is_winner AS is_my_win
        FROM public.matches m
        JOIN public.match_players mp_me ON mp_me.match_id = m.id AND mp_me.user_id = v_caller_id
        LEFT JOIN public.games g ON g.id = m.game_id
        WHERE m.status IN ('finished', 'abandoned', 'cancelled')
        ORDER BY m.started_at DESC, m.created_at DESC
        LIMIT v_limit OFFSET v_offset
    ),
    matched_opponents AS (
        SELECT 
            um.match_id,
            jsonb_agg(
                jsonb_build_object(
                    'user_id', mp_opp.user_id,
                    'display_name', coalesce(p.display_name, 'Adversário'),
                    'username', coalesce(p.username, 'player'),
                    'slot', mp_opp.slot,
                    'game_symbol', mp_opp.game_symbol,
                    'is_winner', mp_opp.is_winner,
                    'score', mp_opp.score
                ) ORDER BY mp_opp.slot ASC
            ) AS opponents
        FROM user_matches um
        JOIN public.match_players mp_opp ON mp_opp.match_id = um.match_id AND mp_opp.user_id != v_caller_id
        LEFT JOIN public.profiles p ON p.id = mp_opp.user_id
        GROUP BY um.match_id
    )
    SELECT jsonb_agg(
        jsonb_build_object(
            'match_id', um.match_id,
            'game_id', um.game_id,
            'game_name', coalesce(um.game_name, 'Jogo da Velha'),
            'status', um.status,
            'winner_id', um.winner_id,
            'is_draw', um.is_draw,
            'finish_reason', um.finish_reason,
            'turn_number', um.turn_number,
            'started_at', um.started_at,
            'finished_at', um.finished_at,
            'duration_seconds', coalesce(um.duration_seconds, 0),
            'my_slot', um.my_slot,
            'my_symbol', um.my_symbol,
            'my_score', um.my_score,
            'is_winner', (um.winner_id = v_caller_id AND um.is_draw = false),
            'outcome', CASE 
                WHEN um.is_draw = true THEN 'draw'
                WHEN um.winner_id = v_caller_id THEN 'win'
                WHEN um.winner_id IS NOT NULL THEN 'loss'
                ELSE 'cancelled'
            END,
            'opponents', coalesce(mo.opponents, '[]'::jsonb)
        ) ORDER BY um.started_at DESC
    ) INTO v_matches
    FROM user_matches um
    LEFT JOIN matched_opponents mo ON mo.match_id = um.match_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'matches', coalesce(v_matches, '[]'::jsonb),
            'total_count', v_total_count,
            'limit', v_limit,
            'offset', v_offset,
            'has_more', (v_offset + v_limit < v_total_count)
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_match_history(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_match_history(INTEGER, INTEGER) TO authenticated;
