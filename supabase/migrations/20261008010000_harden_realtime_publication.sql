-- ============================================================================
-- Migration: 20261008010000_harden_realtime_publication.sql
-- Project: DuoPlay-Online
-- Phase: Fase 6.1 — Hardening do Supabase Realtime
-- Description: Validação estrita da publicação supabase_realtime sem mascarar
--              erros de configuração em produção, com fallback explícito apenas
--              se a publicação do sistema não existir em ambientes de teste isolados.
-- ============================================================================

DO $$
BEGIN
    -- Verifica se a publicação supabase_realtime existe no cluster
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        -- Se a publicação existe, garante que public.matches está incluída
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' 
              AND schemaname = 'public' 
              AND tablename = 'matches'
        ) THEN
            -- Executa a adição direta; erros aqui NÃO devem ser mascarados com EXCEPTION WHEN OTHERS THEN NULL
            ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
        END IF;
    ELSE
        -- Em ambientes locais/testes sem a extensão pg_graphql / realtime do Supabase, emite aviso explícito
        RAISE NOTICE 'Publicação supabase_realtime não encontrada no ambiente; publicação de matches ignorada.';
    END IF;
END;
$$;
