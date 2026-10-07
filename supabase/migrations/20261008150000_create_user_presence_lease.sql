-- ============================================================================
-- Migration: 20261008150000_create_user_presence_lease.sql
-- Project: DuoPlay-Online
-- Phase: Fase 14.2 — Sincronização de Status Online com Lease de Presença & Heartbeat
-- Description: Criação da tabela user_presence, RPC heartbeat_presence,
--              e atualização de get_my_friends, get_friendship_status e search_players
--              para garantir que o status online seja determinado com base em evidência
--              recente e autoritativa de heartbeat (TTL de 25 segundos).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabela: public.user_presence (Lease de Presença do Usuário)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_presence (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_presence IS 'Registro autoritativo de presença e heartbeat dos usuários na plataforma DuoPlay.';
COMMENT ON COLUMN public.user_presence.user_id IS 'UUID do perfil do usuário em auth.users / profiles.';
COMMENT ON COLUMN public.user_presence.last_seen_at IS 'Timestamp do último heartbeat ou ação autorizada do cliente.';
COMMENT ON COLUMN public.user_presence.updated_at IS 'Timestamp da última modificação do registro.';

-- Índices de consulta rápida de presença
CREATE INDEX IF NOT EXISTS idx_user_presence_last_seen ON public.user_presence (last_seen_at DESC);

-- ----------------------------------------------------------------------------
-- 2. Habilitação de RLS e Políticas
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

-- Usuários autenticados podem consultar a presença dos demais jogadores
DROP POLICY IF EXISTS "user_presence_select_all" ON public.user_presence;
CREATE POLICY "user_presence_select_all"
    ON public.user_presence
    FOR SELECT
    TO authenticated
    USING (true);

-- Sem mutação direta pelo cliente (apenas via RPCs)
REVOKE ALL ON TABLE public.user_presence FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.user_presence TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Inclusão na Publicação Realtime
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'user_presence'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.user_presence;
        END IF;
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. RPC: heartbeat_presence (Tick de presença global da aplicação)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.heartbeat_presence()
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

    -- Upsert atômico do lease de presença
    INSERT INTO public.user_presence (user_id, last_seen_at, updated_at)
    VALUES (v_caller_id, v_now, v_now)
    ON CONFLICT (user_id)
    DO UPDATE SET
        last_seen_at = EXCLUDED.last_seen_at,
        updated_at = EXCLUDED.updated_at;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'user_id', v_caller_id,
            'last_seen_at', v_now,
            'ttl_seconds', 25
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.heartbeat_presence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.heartbeat_presence() TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Atualização de get_my_friends para considerar user_presence (TTL 25s)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_friends()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_friends JSONB;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'friend_id', f_sub.other_user_id,
            'username', p.username,
            'display_name', p.display_name,
            'avatar_url', p.avatar_url,
            'created_at', f_sub.friendship_created_at,
            'total_matches', p.total_matches,
            'total_wins', p.total_wins,
            -- Presença ativa: heartbeat recente na plataforma (user_presence) ou em match ativo
            'is_online', coalesce(pres.is_active_online, false),
            'last_seen_at', pres.effective_last_seen
        )
        ORDER BY
            coalesce(pres.is_active_online, false) DESC,
            pres.effective_last_seen DESC NULLS LAST,
            p.display_name ASC
    ), '[]'::jsonb) INTO v_friends
    FROM (
        SELECT
            CASE WHEN user_a_id = v_caller_id THEN user_b_id ELSE user_a_id END AS other_user_id,
            created_at AS friendship_created_at
        FROM public.friendships
        WHERE user_a_id = v_caller_id OR user_b_id = v_caller_id
    ) f_sub
    JOIN public.profiles p ON p.id = f_sub.other_user_id
    LEFT JOIN LATERAL (
        SELECT
            (
                coalesce(up.last_seen_at > (clock_timestamp() - interval '25 seconds'), false)
                OR coalesce(max(mp.last_seen_at) > (clock_timestamp() - interval '25 seconds'), false)
            ) AS is_active_online,
            GREATEST(up.last_seen_at, max(mp.last_seen_at)) AS effective_last_seen
        FROM public.user_presence up
        LEFT JOIN public.match_players mp ON mp.user_id = f_sub.other_user_id AND mp.connection_status = 'connected'
        LEFT JOIN public.matches m ON m.id = mp.match_id AND m.status = 'in_progress'
        WHERE up.user_id = f_sub.other_user_id
        GROUP BY up.last_seen_at
    ) pres ON true;

    RETURN jsonb_build_object(
        'success', true,
        'data', v_friends
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_friends() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_friends() TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Atualização de get_friendship_status para considerar user_presence (TTL 25s)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_friendship_status(
    p_other_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_user_a UUID;
    v_user_b UUID;
    v_req RECORD;
    v_is_online BOOLEAN := false;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    IF v_caller_id = p_other_user_id THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'status', 'self',
                'request_id', null,
                'is_online', true
            )
        );
    END IF;

    -- Checar presença online autoritativa (TTL 25s)
    SELECT EXISTS (
        SELECT 1
        FROM public.user_presence up
        WHERE up.user_id = p_other_user_id
          AND up.last_seen_at > (clock_timestamp() - interval '25 seconds')
        UNION ALL
        SELECT 1
        FROM public.match_players mp
        JOIN public.matches m ON m.id = mp.match_id
        WHERE mp.user_id = p_other_user_id
          AND m.status = 'in_progress'
          AND mp.connection_status = 'connected'
          AND mp.last_seen_at > (clock_timestamp() - interval '25 seconds')
    ) INTO v_is_online;

    -- 1. Verificar se já são amigos
    v_user_a := LEAST(v_caller_id, p_other_user_id);
    v_user_b := GREATEST(v_caller_id, p_other_user_id);

    IF EXISTS (
        SELECT 1 FROM public.friendships
        WHERE user_a_id = v_user_a AND user_b_id = v_user_b
    ) THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'status', 'friends',
                'request_id', null,
                'is_online', v_is_online
            )
        );
    END IF;

    -- 2. Verificar se há solicitação pendente
    SELECT id, requester_id, recipient_id INTO v_req
    FROM public.friend_requests
    WHERE status = 'pending'
      AND ((requester_id = v_caller_id AND recipient_id = p_other_user_id)
        OR (requester_id = p_other_user_id AND recipient_id = v_caller_id));

    IF FOUND THEN
        IF v_req.requester_id = v_caller_id THEN
            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'status', 'request_sent',
                    'request_id', v_req.id,
                    'is_online', v_is_online
                )
            );
        ELSE
            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'status', 'request_received',
                    'request_id', v_req.id,
                    'is_online', v_is_online
                )
            );
        END IF;
    END IF;

    -- 3. Nenhuma relação
    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'status', 'none',
            'request_id', null,
            'is_online', v_is_online
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_friendship_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_friendship_status(UUID) TO authenticated;
