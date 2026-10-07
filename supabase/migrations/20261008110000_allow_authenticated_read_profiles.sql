-- ============================================================================
-- Migration: 20261008110000_allow_authenticated_read_profiles.sql
-- Project: DuoPlay-Online
-- Phase: Fase 12 — Perfil do Jogador + Identidade da Plataforma
-- Description: Permite leitura segura de perfis públicos (public.profiles)
--              por usuários autenticados para exibição de identidade, oponentes
--              e histórico, preservando a proteção estrita de UPDATE e RLS.
-- ============================================================================

-- 1. Atualizar política de SELECT para permitir que usuários autenticados
--    consultem os dados públicos e estatísticas consolidadas de outros jogadores.
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;

CREATE POLICY "profiles_select_authenticated"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (auth.uid() IS NOT NULL);

COMMENT ON POLICY "profiles_select_authenticated" ON public.profiles
IS 'Permite que competidores autenticados consultem dados públicos e estatísticas oficiais de jogadores.';
