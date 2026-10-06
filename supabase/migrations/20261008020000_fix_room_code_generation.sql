-- ============================================================================
-- Migration: 20261008020000_fix_room_code_generation.sql
-- Project: DuoPlay-Online
-- Phase: Fase 7.0.1 — Correção da Geração do Código da Sala
-- Description: Habilita pgcrypto no schema extensions e qualifica a chamada a
--              gen_random_bytes em generate_room_code() para resolver o erro
--              "function gen_random_bytes(integer) does not exist".
-- ============================================================================

-- 1. Habilitar a extensão pgcrypto no schema extensions (padrão oficial Supabase)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Atualizar a função generate_room_code() com qualificação explícita do schema
--    e fallback resiliente de alta entropia criptográfica.
CREATE OR REPLACE FUNCTION public.generate_room_code()
RETURNS VARCHAR(6)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_chars TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    v_code VARCHAR(6) := '';
    v_i INTEGER;
    v_bytes BYTEA;
    v_byte INTEGER;
BEGIN
    -- Obtenção de 6 bytes de alta entropia criptográfica:
    -- Tentativa 1: extensions.gen_random_bytes(6) (schema padrão de extensões no Supabase)
    -- Tentativa 2: public.gen_random_bytes(6) (caso pgcrypto tenha sido instalado no schema public)
    -- Tentativa 3: decodificação de pg_catalog.gen_random_uuid() (CSPRNG nativo do PostgreSQL 13+)
    BEGIN
        v_bytes := extensions.gen_random_bytes(6);
    EXCEPTION
        WHEN undefined_function THEN
            BEGIN
                v_bytes := public.gen_random_bytes(6);
            EXCEPTION
                WHEN undefined_function THEN
                    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
            END;
    END;

    FOR v_i IN 0..5 LOOP
        v_byte := get_byte(v_bytes, v_i);
        v_code := v_code || substr(v_chars, (v_byte % 32) + 1, 1);
    END LOOP;
    RETURN v_code;
END;
$$;

-- 3. Preservar estrita restrição de privilégios da função interna
REVOKE ALL ON FUNCTION public.generate_room_code() FROM PUBLIC, anon, authenticated;
