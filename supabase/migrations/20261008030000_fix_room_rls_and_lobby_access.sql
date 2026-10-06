-- ============================================================================
-- Migration: 20261008030000_fix_room_rls_and_lobby_access.sql
-- Project: DuoPlay-Online
-- Phase: Fase 7.0.2 — Correção do RLS e Carregamento do Lobby
-- Description: Resolve a recursão infinita de políticas RLS (SQLSTATE 42P17)
--              em room_members, rooms, match_players e matches utilizando
--              funções auxiliares com SECURITY DEFINER e search_path seguro.
-- ============================================================================

-- 1. Função interna segura para verificar se auth.uid() é membro da sala
--    Executa sob SECURITY DEFINER para que a subquery não re-dispare a política RLS.
CREATE OR REPLACE FUNCTION public.is_room_member(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_room_id IS NULL OR auth.uid() IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1 
        FROM public.room_members
        WHERE room_id = p_room_id 
          AND user_id = auth.uid()
    );
END;
$$;

-- Restringe privilégios da função
REVOKE ALL ON FUNCTION public.is_room_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_room_member(UUID) TO authenticated;

-- 2. Função interna segura para verificar se auth.uid() é participante da partida
CREATE OR REPLACE FUNCTION public.is_match_participant(p_match_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_match_id IS NULL OR auth.uid() IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1 
        FROM public.match_players
        WHERE match_id = p_match_id 
          AND user_id = auth.uid()
    );
END;
$$;

-- Restringe privilégios da função
REVOKE ALL ON FUNCTION public.is_match_participant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_match_participant(UUID) TO authenticated;

-- 3. Atualizar política RLS de public.room_members
DROP POLICY IF EXISTS "room_members_select_same_room" ON public.room_members;
CREATE POLICY "room_members_select_same_room"
    ON public.room_members
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid() 
        OR public.is_room_member(room_id)
    );

-- 4. Atualizar política RLS de public.rooms
DROP POLICY IF EXISTS "rooms_select_member" ON public.rooms;
CREATE POLICY "rooms_select_member"
    ON public.rooms
    FOR SELECT
    TO authenticated
    USING (
        host_id = auth.uid() 
        OR public.is_room_member(id)
    );

-- 5. Atualizar política RLS de public.match_players
DROP POLICY IF EXISTS "match_players_select_participant" ON public.match_players;
CREATE POLICY "match_players_select_participant"
    ON public.match_players
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid() 
        OR public.is_match_participant(match_id)
    );

-- 6. Atualizar política RLS de public.matches
DROP POLICY IF EXISTS "matches_select_participant" ON public.matches;
CREATE POLICY "matches_select_participant"
    ON public.matches
    FOR SELECT
    TO authenticated
    USING (
        public.is_match_participant(id) 
        OR (room_id IS NOT NULL AND public.is_room_member(room_id))
    );
