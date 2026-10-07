-- ============================================================================
-- Migration: 20261008070000_create_latest_completed_match_rpc.sql
-- Project: DuoPlay-Online
-- Phase: Fase 8.4 — Recuperação Correta da Última Partida Finalizada
-- Description: Cria RPC dedicada para consultar a partida finalizada mais recente
--              do usuário autenticado ordenada estritamente por finished_at DESC.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_latest_completed_match_for_current_user()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_match JSONB;
BEGIN
    -- 1. Verificação de autenticação
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Busca da partida encerrada mais recente por finished_at DESC
    WITH latest_match AS (
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
        ORDER BY m.finished_at DESC NULLS LAST, m.started_at DESC, m.created_at DESC
        LIMIT 1
    ),
    matched_opponents AS (
        SELECT 
            lm.match_id,
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
        FROM latest_match lm
        JOIN public.match_players mp_opp ON mp_opp.match_id = lm.match_id AND mp_opp.user_id != v_caller_id
        LEFT JOIN public.profiles p ON p.id = mp_opp.user_id
        GROUP BY lm.match_id
    )
    SELECT jsonb_build_object(
        'match_id', lm.match_id,
        'game_id', lm.game_id,
        'game_name', coalesce(lm.game_name, 'Jogo da Velha'),
        'status', lm.status,
        'winner_id', lm.winner_id,
        'is_draw', lm.is_draw,
        'finish_reason', lm.finish_reason,
        'turn_number', lm.turn_number,
        'started_at', lm.started_at,
        'finished_at', lm.finished_at,
        'duration_seconds', coalesce(lm.duration_seconds, 0),
        'my_slot', lm.my_slot,
        'my_symbol', lm.my_symbol,
        'my_score', lm.my_score,
        'is_winner', (lm.winner_id = v_caller_id AND lm.is_draw = false),
        'outcome', CASE 
            WHEN lm.is_draw = true THEN 'draw'
            WHEN lm.winner_id = v_caller_id THEN 'win'
            WHEN lm.winner_id IS NOT NULL THEN 'loss'
            ELSE 'cancelled'
        END,
        'opponents', coalesce(mo.opponents, '[]'::jsonb)
    ) INTO v_match
    FROM latest_match lm
    LEFT JOIN matched_opponents mo ON mo.match_id = lm.match_id;

    -- 3. Retorno padronizado
    RETURN jsonb_build_object(
        'success', true,
        'data', v_match,
        'error', null
    );
END;
$$;

-- 4. Permissões
REVOKE ALL ON FUNCTION public.get_latest_completed_match_for_current_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_latest_completed_match_for_current_user() TO authenticated;
