-- ============================================================================
-- Migration: 20261005000000_create_profiles.sql
-- Project: DuoPlay-Online
-- Phase: Fase 2 (Supabase + Segurança)
-- Description: Criação da tabela de perfis de usuário, índices, RLS e triggers.
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
    CONSTRAINT profiles_username_length_check CHECK (char_length(username) >= 3)
);

-- Comentários documentais na tabela e colunas
COMMENT ON TABLE public.profiles IS 'Perfis públicos e estatísticas consolidadas dos jogadores no DuoPlay-Online.';
COMMENT ON COLUMN public.profiles.id IS 'Chave primária correspondente ao UUID em auth.users.';
COMMENT ON COLUMN public.profiles.username IS 'Nome de usuário único legível (mínimo 3 caracteres).';
COMMENT ON COLUMN public.profiles.display_name IS 'Nome de exibição visível para outros competidores.';

-- 2. Índices Otimizados
CREATE INDEX IF NOT EXISTS idx_profiles_username_lower ON public.profiles (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON public.profiles (created_at DESC);

-- 3. Habilitação de Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4. Políticas de Acesso Específicas (RLS)

-- SELECT: Usuário autenticado pode ler o próprio perfil
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

-- UPDATE: Usuário autenticado só pode atualizar o próprio perfil e não pode alterar o ID
CREATE POLICY "profiles_update_own"
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- DELETE: Proibido via cliente (remoção em cascata via exclusão de conta em auth.users)

-- 5. Revisão de Grants de Acesso
REVOKE ALL ON TABLE public.profiles FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
-- Role 'anon' não possui permissão de leitura nem escrita direta nesta fase
REVOKE ALL ON TABLE public.profiles FROM anon;

-- 6. Trigger para Atualização Automática de updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_profiles_updated_at ON public.profiles;
CREATE TRIGGER trigger_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

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
BEGIN
    -- Extrair do metadata enviado no cadastro ou derivar do email/UUID
    v_raw_username := NEW.raw_user_meta_data->>'username';
    
    IF v_raw_username IS NOT NULL AND char_length(trim(v_raw_username)) >= 3 THEN
        -- Sanitizar: apenas letras, números e underscores
        v_clean_username := lower(regexp_replace(trim(v_raw_username), '[^a-zA-Z0-9_]', '', 'g'));
        v_clean_username := substring(v_clean_username FROM 1 FOR 30);
    ELSE
        -- Fallback seguro: derivar da parte local do email ou prefixo 'user_'
        v_clean_username := 'player_' || substring(NEW.id::text FROM 1 FOR 8);
    END IF;

    -- Garantir unicidade caso já exista username idêntico
    IF EXISTS (SELECT 1 FROM public.profiles WHERE username = v_clean_username) THEN
        v_clean_username := substring(v_clean_username FROM 1 FOR 22) || '_' || substring(gen_random_uuid()::text FROM 1 FOR 6);
    END IF;

    -- Obter display_name ou usar o username
    v_display_name := coalesce(
        nullif(trim(NEW.raw_user_meta_data->>'display_name'), ''),
        v_clean_username
    );

    -- Inserir o perfil correspondente
    INSERT INTO public.profiles (id, username, display_name, avatar_url)
    VALUES (
        NEW.id,
        v_clean_username,
        substring(v_display_name FROM 1 FOR 50),
        NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

-- Vincular trigger ao auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();
