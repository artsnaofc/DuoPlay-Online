-- ============================================================================
-- Migration: 20261008000000_enable_realtime_matches.sql
-- Project: DuoPlay-Online
-- Phase: Fase 6 — Supabase Realtime + Sincronização Multiplayer
-- Description: Habilita publicação de Realtime na tabela public.matches para permitir
--              que clientes autenticados recebam notificações de UPDATE via WebSocket.
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
          AND schemaname = 'public' 
          AND tablename = 'matches'
    ) THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
        EXCEPTION WHEN OTHERS THEN
            -- Tratamento seguro caso a publicação supabase_realtime não exista em mock/test
            NULL;
        END;
    END IF;
END;
$$;
