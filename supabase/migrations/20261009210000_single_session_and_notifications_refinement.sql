-- ============================================================================
-- Migration: 20261009210000_single_session_and_notifications_refinement.sql
-- Project: DuoPlay-Online
-- Phase: Controle de Sessão Única, Validação de Concorrência e Sincronização
-- Description: Criação da tabela user_active_sessions, RPCs de registro e validação de sessão única,
--              garantindo que apenas uma sessão ativa exista por conta no backend.
-- ============================================================================

-- 1. Tabela user_active_sessions
CREATE TABLE IF NOT EXISTS public.user_active_sessions (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_active_sessions IS 'Controle autoritativo de sessão única ativa por usuário na plataforma.';
COMMENT ON COLUMN public.user_active_sessions.user_id IS 'UUID do usuário.';
COMMENT ON COLUMN public.user_active_sessions.session_id IS 'Identificador único da sessão autorizada mais recente.';

ALTER TABLE public.user_active_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_active_sessions_select_own" ON public.user_active_sessions;
CREATE POLICY "user_active_sessions_select_own"
    ON public.user_active_sessions
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.user_active_sessions FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.user_active_sessions TO authenticated;

-- Inclusão na Publicação Realtime
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'user_active_sessions'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.user_active_sessions;
        END IF;
    END IF;
END;
$$;

-- 2. RPC: register_active_session
CREATE OR REPLACE FUNCTION public.register_active_session(p_session_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    IF p_session_id IS NULL OR trim(p_session_id) = '' THEN
        RAISE EXCEPTION 'INVALID_SESSION: Identificador de sessão inválido.' USING ERRCODE = 'P0070';
    END IF;

    INSERT INTO public.user_active_sessions (user_id, session_id, updated_at, created_at)
    VALUES (v_caller_id, p_session_id, v_now, v_now)
    ON CONFLICT (user_id)
    DO UPDATE SET
        session_id = EXCLUDED.session_id,
        updated_at = EXCLUDED.updated_at;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'user_id', v_caller_id,
            'session_id', p_session_id,
            'registered_at', v_now
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.register_active_session(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_active_session(TEXT) TO authenticated;

-- 3. RPC: validate_session
CREATE OR REPLACE FUNCTION public.validate_session(p_session_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_active_session TEXT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'valid', false, 'reason', 'UNAUTHORIZED');
    END IF;

    SELECT session_id INTO v_active_session
    FROM public.user_active_sessions
    WHERE user_id = v_caller_id;

    IF v_active_session IS NULL OR v_active_session <> p_session_id THEN
        RETURN jsonb_build_object('success', true, 'valid', false, 'reason', 'SESSION_REPLACED');
    END IF;

    RETURN jsonb_build_object('success', true, 'valid', true);
END;
$$;

REVOKE ALL ON FUNCTION public.validate_session(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_session(TEXT) TO authenticated;
