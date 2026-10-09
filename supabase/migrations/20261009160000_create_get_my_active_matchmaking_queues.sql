-- ============================================================================
-- Migration: 20261009160000_create_get_my_active_matchmaking_queues.sql
-- Project: DuoPlay-Online
-- Description: Cria a RPC get_my_active_matchmaking_queues para retornar todas as
--              filas de matchmaking ativas ('waiting' ou 'matched') do usuário autenticado,
--              permitindo suporte robusto ao matchmaking simultâneo multijogo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_my_active_matchmaking_queues()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_rows JSONB;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'data', '[]'::jsonb, 'error', null);
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_caller_id::text));

    -- Remove expiradas do usuário
    DELETE FROM public.matchmaking_queue 
    WHERE user_id = v_caller_id 
      AND status = 'waiting' 
      AND expires_at < clock_timestamp();

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'queue_id', q.id,
            'game_id', q.game_id,
            'status', q.status,
            'match_id', q.match_id,
            'expires_at', q.expires_at,
            'created_at', q.created_at
        ) ORDER BY CASE WHEN q.status = 'matched' THEN 0 ELSE 1 END, q.created_at DESC
    ), '[]'::jsonb)
    INTO v_rows
    FROM public.matchmaking_queue q
    WHERE q.user_id = v_caller_id
      AND q.status IN ('waiting', 'matched');

    RETURN jsonb_build_object(
        'success', true,
        'data', v_rows,
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_active_matchmaking_queues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_active_matchmaking_queues() TO authenticated;
