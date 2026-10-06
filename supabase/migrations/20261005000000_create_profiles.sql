-- ============================================================================
-- Migration: 20261005000000_create_profiles.sql
-- Project: DuoPlay-Online
-- Phase: Fase 2 — Supabase + Segurança (Hardening)
-- Description: Criação da tabela de perfis de usuário, proteção estrita de
--              estatísticas e campos de sistema, RLS, grants por coluna e triggers.
-- ============================================================================

-- 1. Criação da Tabela de Perfis
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username VARCHAR(32) NOT NULL,
    display_name VARCHAR(50) NOT NULL,
    avatar_url TEXT,
    total_matches INTEGER DEFAULT 0 NOT NULL CHECK (total_matches >= 0),
    total_wins INTEGER DEFAULT 0 NOT NULL CHECK (total_wins >= 0),
    total_draws INTEGER DEFAULT 0 NOT NULL CHECK (total_draws >= 0),
    total_losses INTEGER DEFAULT 0 NOT NULL CHECK (total_losses >= 0),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT profiles_username_unique UNIQUE (username),
    CONSTRAINT profiles_username_length_check CHECK (char_length(username) >= 3 AND char_length(username) <= 32),
    CONSTRAINT profiles_username_format_check CHECK (username ~ '^[a-z0-9_]{3,32}$')
);

-- Comentários documentais na tabela e colunas
COMMENT ON TABLE public.profiles IS 'Perfis públicos e estatísticas consolidadas dos jogadores no DuoPlay-Online.';
COMMENT ON COLUMN public.profiles.id IS 'Chave primária correspondente ao UUID em auth.users (gerenciado pelo sistema).';
COMMENT ON COLUMN public.profiles.username IS 'Nome de usuário único legível (editável pelo usuário).';
COMMENT ON COLUMN public.profiles.display_name IS 'Nome de exibição visível para outros competidores (editável pelo usuário).';
COMMENT ON COLUMN public.profiles.avatar_url IS 'URL do avatar do jogador (editável pelo usuário).';
COMMENT ON COLUMN public.profiles.total_matches IS 'Total de partidas disputadas (estatística oficial do backend).';
COMMENT ON COLUMN public.profiles.total_wins IS 'Total de vitórias acumuladas (estatística oficial do backend).';
COMMENT ON COLUMN public.profiles.total_draws IS 'Total de empates acumulados (estatística oficial do backend).';
COMMENT ON COLUMN public.profiles.total_losses IS 'Total de derrotas acumuladas (estatística oficial do backend).';

-- 2. Índices Otimizados
CREATE INDEX IF NOT EXISTS idx_profiles_username_lower ON public.profiles (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON public.profiles (created_at DESC);

-- 3. Habilitação de Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4. Políticas de Acesso Específicas (RLS)

-- SELECT: Usuário autenticado pode ler apenas o próprio perfil
CREATE POLICY "profiles_select_own"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

-- INSERT: Usuário autenticado só pode criar perfil para o próprio ID
CREATE POLICY "profiles_insert_own"
    ON public.profiles
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id);

-- UPDATE: Usuário autenticado só pode atualizar o próprio perfil
CREATE POLICY "profiles_update_own"
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- DELETE: Proibido via cliente (remoção exclusivamente em cascata via exclusão de conta em auth.users)

-- 5. Revisão Estrita de Grants de Acesso
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;

-- Concede leitura e inserção de perfil ao usuário autenticado
GRANT SELECT, INSERT ON TABLE public.profiles TO authenticated;

-- Proteção de Colunas: Concede permissão de UPDATE EXCLUSIVAMENTE nas colunas editáveis pelo cliente
REVOKE UPDATE ON TABLE public.profiles FROM authenticated;
GRANT UPDATE (username, display_name, avatar_url) ON TABLE public.profiles TO authenticated;

-- 6. Trigger de Integridade e Proteção de Campos Gerenciados pelo Sistema
CREATE OR REPLACE FUNCTION public.enforce_profile_update_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- 1. Impedir modificação de ID
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Não é permitido alterar o ID do perfil.';
    END IF;

    -- 2. Impedir modificação manual de created_at
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Não é permitido alterar a data de criação (created_at).';
    END IF;

    -- 3. Blindagem de Estatísticas Oficiais contra alteração direta pelo cliente
    IF (NEW.total_matches IS DISTINCT FROM OLD.total_matches) OR
       (NEW.total_wins IS DISTINCT FROM OLD.total_wins) OR
       (NEW.total_draws IS DISTINCT FROM OLD.total_draws) OR
       (NEW.total_losses IS DISTINCT FROM OLD.total_losses) THEN
        RAISE EXCEPTION 'Estatísticas oficiais de partidas não podem ser alteradas diretamente pelo usuário.';
    END IF;

    -- 4. Garantir que updated_at seja sempre atribuído com o horário oficial do servidor
    NEW.updated_at := now();

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_profiles_update_integrity ON public.profiles;
CREATE TRIGGER trigger_profiles_update_integrity
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_profile_update_integrity();

-- 7. Trigger Automático para Criação de Perfil no Cadastro em auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_raw_username TEXT;
    v_clean_username VARCHAR(32);
    v_display_name VARCHAR(50);
    v_attempts INTEGER := 0;
BEGIN
    -- Extrair metadados informados no cadastro
    v_raw_username := NEW.raw_user_meta_data->>'username';
    
    IF v_raw_username IS NOT NULL THEN
        -- Sanitizar: letras minúsculas, números e underscores
        v_clean_username := lower(regexp_replace(trim(v_raw_username), '[^a-zA-Z0-9_]', '', 'g'));
    ELSE
        v_clean_username := '';
    END IF;

    -- Validar tamanho mínimo (se < 3 caracteres, como no caso de '@@@', gera fallback determinístico)
    IF char_length(v_clean_username) < 3 THEN
        v_clean_username := 'player_' || substring(replace(NEW.id::text, '-', '') from 1 for 8);
    ELSE
        v_clean_username := substring(v_clean_username from 1 for 24);
    END IF;

    -- Obter display_name ou usar o username
    v_display_name := coalesce(
        nullif(trim(NEW.raw_user_meta_data->>'display_name'), ''),
        v_clean_username
    );

    -- Inserção robusta com tratamento de colisão concorrente
    LOOP
        BEGIN
            INSERT INTO public.profiles (
                id,
                username,
                display_name,
                avatar_url,
                total_matches,
                total_wins,
                total_draws,
                total_losses
            ) VALUES (
                NEW.id,
                v_clean_username,
                substring(v_display_name from 1 for 50),
                NEW.raw_user_meta_data->>'avatar_url',
                0,
                0,
                0,
                0
            )
            ON CONFLICT (id) DO NOTHING;

            EXIT; -- Inserido com sucesso ou ID já existente
        EXCEPTION WHEN unique_violation THEN
            v_attempts := v_attempts + 1;
            IF v_attempts > 5 THEN
                -- Fallback com UUID para garantir unicidade definitiva
                v_clean_username := 'player_' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 16);
            ELSE
                -- Sufixo aleatório para resolver corrida concorrente
                v_clean_username := substring(v_clean_username from 1 for 18) || '_' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6);
            END IF;
        END;
    END LOOP;

    RETURN NEW;
END;
$$;

-- Vincular trigger ao auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- 8. Restrição Estrita de EXECUTE nas Funções SECURITY DEFINER
-- Usuários públicos, anônimos e autenticados NÃO devem ter permissão de execução direta via RPC/SQL
REVOKE ALL ON FUNCTION public.enforce_profile_update_integrity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
