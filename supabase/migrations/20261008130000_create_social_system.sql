-- ============================================================================
-- Migration: 20261008130000_create_social_system.sql
-- Project: DuoPlay-Online
-- Phase: Fase 14 — Sistema Social: Amigos e Jogadores
-- Description: Criação da infraestrutura social oficial (amizades bidirecionais,
--              solicitações de amizade, busca de jogadores, RLS estrito e RPCs seguras).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabela: public.friendships (Amizades Bidirecionais Canônicas)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    user_b_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Garante ordem canônica estrita para tratar A-B e B-A como o mesmo registro
    CONSTRAINT friendships_user_order_check CHECK (user_a_id < user_b_id),
    CONSTRAINT friendships_unique_pair UNIQUE (user_a_id, user_b_id)
);

COMMENT ON TABLE public.friendships IS 'Relacionamentos de amizade bidirecionais normalizados entre jogadores.';
COMMENT ON COLUMN public.friendships.user_a_id IS 'Primeiro jogador do par (sempre menor lexicograficamente).';
COMMENT ON COLUMN public.friendships.user_b_id IS 'Segundo jogador do par (sempre maior lexicograficamente).';

CREATE INDEX IF NOT EXISTS idx_friendships_user_a ON public.friendships(user_a_id);
CREATE INDEX IF NOT EXISTS idx_friendships_user_b ON public.friendships(user_b_id);

-- ----------------------------------------------------------------------------
-- 2. Tabela: public.friend_requests (Solicitações de Amizade)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.friend_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at TIMESTAMPTZ,
    CONSTRAINT friend_requests_different_users CHECK (requester_id <> recipient_id)
);

COMMENT ON TABLE public.friend_requests IS 'Solicitações de amizade entre jogadores.';

-- Índice e restrição única parcial para impedir mais de uma solicitação pendente entre o mesmo par
CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_unique_pending_pair
    ON public.friend_requests (LEAST(requester_id, recipient_id), GREATEST(requester_id, recipient_id))
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_friend_requests_recipient ON public.friend_requests(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_requester ON public.friend_requests(requester_id, status);

-- ----------------------------------------------------------------------------
-- 3. Habilitação de RLS e Políticas Estritas
-- ----------------------------------------------------------------------------
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;

-- friendships: Leitura apenas de amizades das quais o usuário faz parte
DROP POLICY IF EXISTS "friendships_select_own" ON public.friendships;
CREATE POLICY "friendships_select_own"
    ON public.friendships
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

-- friend_requests: Leitura apenas de solicitações enviadas ou recebidas
DROP POLICY IF EXISTS "friend_requests_select_own" ON public.friend_requests;
CREATE POLICY "friend_requests_select_own"
    ON public.friend_requests
    FOR SELECT
    TO authenticated
    USING (auth.uid() = requester_id OR auth.uid() = recipient_id);

-- Revisão de permissões: Nenhuma mutação direta pelo cliente (apenas via RPCs)
REVOKE ALL ON TABLE public.friendships FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.friendships TO authenticated;

REVOKE ALL ON TABLE public.friend_requests FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.friend_requests TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. RPC: send_friend_request
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_friend_request(
    p_recipient_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_requester_id UUID;
    v_user_a UUID;
    v_user_b UUID;
    v_existing_req RECORD;
    v_new_req RECORD;
    v_recipient_profile RECORD;
BEGIN
    v_requester_id := auth.uid();
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    IF v_requester_id = p_recipient_id THEN
        RAISE EXCEPTION 'CANNOT_FRIEND_SELF: Não é permitido enviar solicitação para si mesmo.' USING ERRCODE = 'P0040';
    END IF;

    -- Validar existência do destinatário
    SELECT id, username, display_name INTO v_recipient_profile
    FROM public.profiles
    WHERE id = p_recipient_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'USER_NOT_FOUND: Jogador destinatário não encontrado.' USING ERRCODE = 'P0041';
    END IF;

    v_user_a := LEAST(v_requester_id, p_recipient_id);
    v_user_b := GREATEST(v_requester_id, p_recipient_id);

    -- 1. Verificar se já são amigos
    IF EXISTS (
        SELECT 1 FROM public.friendships
        WHERE user_a_id = v_user_a AND user_b_id = v_user_b
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'FRIENDSHIP_EXISTS',
            'error', 'Você e este jogador já são amigos.'
        );
    END IF;

    -- 2. Verificar se existe solicitação pendente entre eles
    SELECT * INTO v_existing_req
    FROM public.friend_requests
    WHERE status = 'pending'
      AND ((requester_id = v_requester_id AND recipient_id = p_recipient_id)
        OR (requester_id = p_recipient_id AND recipient_id = v_requester_id))
    FOR UPDATE;

    IF FOUND THEN
        -- Se o próprio usuário já havia enviado a solicitação pendente
        IF v_existing_req.requester_id = v_requester_id THEN
            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'request_id', v_existing_req.id,
                    'status', 'pending',
                    'action', 'already_sent'
                )
            );
        END IF;

        -- Se o outro usuário já havia enviado uma solicitação pendente (concorrência ou pedido inverso)
        -- Resolução mútua: ambos manifestaram interesse em serem amigos -> aceita automaticamente!
        UPDATE public.friend_requests
        SET status = 'accepted',
            responded_at = now(),
            updated_at = now()
        WHERE id = v_existing_req.id;

        INSERT INTO public.friendships (user_a_id, user_b_id)
        VALUES (v_user_a, v_user_b)
        ON CONFLICT (user_a_id, user_b_id) DO NOTHING;

        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'request_id', v_existing_req.id,
                'status', 'accepted',
                'action', 'mutual_accepted'
            )
        );
    END IF;

    -- 3. Criar nova solicitação pendente
    INSERT INTO public.friend_requests (requester_id, recipient_id, status)
    VALUES (v_requester_id, p_recipient_id, 'pending')
    RETURNING * INTO v_new_req;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'request_id', v_new_req.id,
            'status', 'pending',
            'action', 'created'
        )
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. RPC: accept_friend_request
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_friend_request(
    p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_req RECORD;
    v_user_a UUID;
    v_user_b UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- Localizar e travar a solicitação
    SELECT * INTO v_req
    FROM public.friend_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REQUEST_NOT_FOUND: Solicitação de amizade não encontrada.' USING ERRCODE = 'P0042';
    END IF;

    -- Apenas o destinatário tem autoridade para aceitar
    IF v_req.recipient_id <> v_caller_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Somente o destinatário pode aceitar esta solicitação.' USING ERRCODE = 'P0043';
    END IF;

    -- Se já foi aceita anteriormente, retorna idempotente com sucesso
    IF v_req.status = 'accepted' THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'request_id', v_req.id,
                'status', 'accepted'
            )
        );
    END IF;

    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'INVALID_REQUEST_STATUS: A solicitação não está mais pendente.' USING ERRCODE = 'P0044';
    END IF;

    -- Atualiza estado da solicitação
    UPDATE public.friend_requests
    SET status = 'accepted',
        responded_at = now(),
        updated_at = now()
    WHERE id = v_req.id;

    -- Insere o relacionamento canônico de amizade
    v_user_a := LEAST(v_req.requester_id, v_req.recipient_id);
    v_user_b := GREATEST(v_req.requester_id, v_req.recipient_id);

    INSERT INTO public.friendships (user_a_id, user_b_id)
    VALUES (v_user_a, v_user_b)
    ON CONFLICT (user_a_id, user_b_id) DO NOTHING;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'request_id', v_req.id,
            'status', 'accepted'
        )
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. RPC: decline_friend_request
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decline_friend_request(
    p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_req RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_req
    FROM public.friend_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REQUEST_NOT_FOUND: Solicitação de amizade não encontrada.' USING ERRCODE = 'P0042';
    END IF;

    IF v_req.recipient_id <> v_caller_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Somente o destinatário pode recusar esta solicitação.' USING ERRCODE = 'P0043';
    END IF;

    IF v_req.status = 'declined' THEN
        RETURN jsonb_build_object('success', true, 'data', jsonb_build_object('request_id', v_req.id, 'status', 'declined'));
    END IF;

    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'INVALID_REQUEST_STATUS: A solicitação não está mais pendente.' USING ERRCODE = 'P0044';
    END IF;

    UPDATE public.friend_requests
    SET status = 'declined',
        responded_at = now(),
        updated_at = now()
    WHERE id = v_req.id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'request_id', v_req.id,
            'status', 'declined'
        )
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. RPC: cancel_friend_request
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_friend_request(
    p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_req RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_req
    FROM public.friend_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REQUEST_NOT_FOUND: Solicitação de amizade não encontrada.' USING ERRCODE = 'P0042';
    END IF;

    IF v_req.requester_id <> v_caller_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Somente quem enviou a solicitação pode cancelá-la.' USING ERRCODE = 'P0045';
    END IF;

    IF v_req.status = 'cancelled' THEN
        RETURN jsonb_build_object('success', true, 'data', jsonb_build_object('request_id', v_req.id, 'status', 'cancelled'));
    END IF;

    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'INVALID_REQUEST_STATUS: A solicitação não está mais pendente.' USING ERRCODE = 'P0044';
    END IF;

    UPDATE public.friend_requests
    SET status = 'cancelled',
        updated_at = now()
    WHERE id = v_req.id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'request_id', v_req.id,
            'status', 'cancelled'
        )
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. RPC: remove_friend
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_friend(
    p_friend_id UUID
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
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    v_user_a := LEAST(v_caller_id, p_friend_id);
    v_user_b := GREATEST(v_caller_id, p_friend_id);

    DELETE FROM public.friendships
    WHERE user_a_id = v_user_a AND user_b_id = v_user_b;

    -- Marca solicitações antigas entre eles como canceladas para permitir novos pedidos no futuro
    UPDATE public.friend_requests
    SET status = 'cancelled',
        updated_at = now()
    WHERE (requester_id = v_user_a AND recipient_id = v_user_b)
       OR (requester_id = v_user_b AND recipient_id = v_user_a);

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'friend_id', p_friend_id,
            'removed', true
        )
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. RPC: get_my_friends (Lista de Amigos com Presença Integrada)
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
            -- Presença: jogador ativo em partida in_progress com heartbeat nos últimos 30s
            'is_online', coalesce(pres.is_active_online, false),
            'last_seen_at', pres.last_seen_at
        )
        ORDER BY
            coalesce(pres.is_active_online, false) DESC,
            pres.last_seen_at DESC NULLS LAST,
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
            true AS is_active_online,
            max(mp.last_seen_at) AS last_seen_at
        FROM public.match_players mp
        JOIN public.matches m ON m.id = mp.match_id
        WHERE mp.user_id = f_sub.other_user_id
          AND m.status = 'in_progress'
          AND mp.connection_status = 'connected'
          AND mp.last_seen_at > (clock_timestamp() - interval '30 seconds')
    ) pres ON true;

    RETURN jsonb_build_object('success', true, 'data', v_friends);
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. RPC: get_received_friend_requests (Solicitações Recebidas Pendentes)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_received_friend_requests()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_requests JSONB;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'request_id', fr.id,
            'requester_id', fr.requester_id,
            'username', p.username,
            'display_name', p.display_name,
            'avatar_url', p.avatar_url,
            'created_at', fr.created_at
        )
        ORDER BY fr.created_at DESC
    ), '[]'::jsonb) INTO v_requests
    FROM public.friend_requests fr
    JOIN public.profiles p ON p.id = fr.requester_id
    WHERE fr.recipient_id = v_caller_id
      AND fr.status = 'pending';

    RETURN jsonb_build_object('success', true, 'data', v_requests);
END;
$$;

-- ----------------------------------------------------------------------------
-- 11. RPC: get_sent_friend_requests (Solicitações Enviadas Pendentes)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sent_friend_requests()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_requests JSONB;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'request_id', fr.id,
            'recipient_id', fr.recipient_id,
            'username', p.username,
            'display_name', p.display_name,
            'avatar_url', p.avatar_url,
            'created_at', fr.created_at
        )
        ORDER BY fr.created_at DESC
    ), '[]'::jsonb) INTO v_requests
    FROM public.friend_requests fr
    JOIN public.profiles p ON p.id = fr.recipient_id
    WHERE fr.requester_id = v_caller_id
      AND fr.status = 'pending';

    RETURN jsonb_build_object('success', true, 'data', v_requests);
END;
$$;

-- ----------------------------------------------------------------------------
-- 12. RPC: get_friendship_status (Status de Relacionamento entre 2 Jogadores)
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

    -- Checar presença online
    SELECT EXISTS (
        SELECT 1
        FROM public.match_players mp
        JOIN public.matches m ON m.id = mp.match_id
        WHERE mp.user_id = p_other_user_id
          AND m.status = 'in_progress'
          AND mp.connection_status = 'connected'
          AND mp.last_seen_at > (clock_timestamp() - interval '30 seconds')
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

-- ----------------------------------------------------------------------------
-- 13. RPC: search_players (Busca Segura de Jogadores com Ranking de Prioridade)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_players(
    p_query TEXT,
    p_limit INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_clean_query TEXT;
    v_limit INT;
    v_results JSONB;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- Sanitizar query e remover prefixo @ caso fornecido
    v_clean_query := lower(trim(replace(p_query, '@', '')));
    IF char_length(v_clean_query) < 2 THEN
        RETURN jsonb_build_object('success', true, 'data', '[]'::jsonb);
    END IF;

    v_limit := LEAST(GREATEST(p_limit, 1), 20);

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'user_id', p.id,
            'username', p.username,
            'display_name', p.display_name,
            'avatar_url', p.avatar_url,
            'total_matches', p.total_matches,
            'total_wins', p.total_wins,
            'win_rate', CASE WHEN p.total_matches > 0 THEN round((p.total_wins::numeric / p.total_matches::numeric) * 100) ELSE 0 END,
            'is_friend', (f.id IS NOT NULL),
            'relationship_status',
                CASE
                    WHEN f.id IS NOT NULL THEN 'friends'
                    WHEN fr.requester_id = v_caller_id THEN 'request_sent'
                    WHEN fr.recipient_id = v_caller_id THEN 'request_received'
                    ELSE 'none'
                END
        )
        ORDER BY
            -- Prioridade 1: username exato
            CASE WHEN lower(p.username) = v_clean_query THEN 1 ELSE 2 END,
            -- Prioridade 2: username iniciando com a query
            CASE WHEN lower(p.username) LIKE (v_clean_query || '%') THEN 1 ELSE 2 END,
            -- Prioridade 3: display_name iniciando com a query
            CASE WHEN lower(p.display_name) LIKE (v_clean_query || '%') THEN 1 ELSE 2 END,
            p.display_name ASC
    ), '[]'::jsonb) INTO v_results
    FROM public.profiles p
    LEFT JOIN public.friendships f ON (
        (f.user_a_id = LEAST(v_caller_id, p.id) AND f.user_b_id = GREATEST(v_caller_id, p.id))
    )
    LEFT JOIN public.friend_requests fr ON (
        fr.status = 'pending' AND (
            (fr.requester_id = v_caller_id AND fr.recipient_id = p.id) OR
            (fr.requester_id = p.id AND fr.recipient_id = v_caller_id)
        )
    )
    WHERE p.id <> v_caller_id
      AND (
          lower(p.username) LIKE ('%' || v_clean_query || '%') OR
          lower(p.display_name) LIKE ('%' || v_clean_query || '%')
      )
    LIMIT v_limit;

    RETURN jsonb_build_object('success', true, 'data', v_results);
END;
$$;

-- ----------------------------------------------------------------------------
-- 14. Grants das RPCs
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.send_friend_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_friend_request(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.accept_friend_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_friend_request(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.decline_friend_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_friend_request(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_friend_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_friend_request(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.remove_friend(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_friend(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_friends() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_friends() TO authenticated;

REVOKE ALL ON FUNCTION public.get_received_friend_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_received_friend_requests() TO authenticated;

REVOKE ALL ON FUNCTION public.get_sent_friend_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sent_friend_requests() TO authenticated;

REVOKE ALL ON FUNCTION public.get_friendship_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_friendship_status(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.search_players(TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_players(TEXT, INT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 15. Inclusão Opcional na Publicação Realtime do Supabase
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
              AND tablename = 'friend_requests'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_requests;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'friendships'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
        END IF;
    END IF;
END;
$$;
