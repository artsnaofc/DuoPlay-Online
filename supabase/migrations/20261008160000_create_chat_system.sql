-- ============================================================================
-- Migration: 20261008160000_create_chat_system.sql
-- Project: DuoPlay-Online
-- Phase: Fase 15 — Comunicação Entre Jogadores (Chat Privado 1:1 Entre Amigos)
-- Description: Criação da infraestrutura oficial de conversas e mensagens privadas,
--              RLS estrito, publicação Realtime e RPCs atômicas com validação de amizade,
--              determinação de sender_id no backend, cálculo de não lidas e paginação.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabela: public.conversations (Conversas)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(20) NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'match', 'group')),
    direct_user_a UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    direct_user_b UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT conversations_direct_order CHECK (
        type <> 'direct' OR (
            direct_user_a IS NOT NULL AND
            direct_user_b IS NOT NULL AND
            direct_user_a < direct_user_b
        )
    ),
    CONSTRAINT conversations_direct_unique UNIQUE (type, direct_user_a, direct_user_b)
);

COMMENT ON TABLE public.conversations IS 'Registro canônico de conversas entre jogadores no DuoPlay-Online.';
COMMENT ON COLUMN public.conversations.type IS 'Tipo de conversa: direct (1:1), match (partida) ou group (futuro).';
COMMENT ON COLUMN public.conversations.direct_user_a IS 'Primeiro participante canônico (menor UUID em 1:1).';
COMMENT ON COLUMN public.conversations.direct_user_b IS 'Segundo participante canônico (maior UUID em 1:1).';
COMMENT ON COLUMN public.conversations.last_message_at IS 'Timestamp da última mensagem para ordenação eficiente de conversas.';

-- Índices otimizados para busca de conversas
CREATE INDEX IF NOT EXISTS idx_conversations_direct ON public.conversations (direct_user_a, direct_user_b) WHERE type = 'direct';
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON public.conversations (last_message_at DESC);

-- ----------------------------------------------------------------------------
-- 2. Tabela: public.conversation_members (Participantes & Leitura)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversation_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT conversation_members_unique UNIQUE (conversation_id, user_id)
);

COMMENT ON TABLE public.conversation_members IS 'Membros participantes de uma conversa e rastreamento de leitura individual.';
COMMENT ON COLUMN public.conversation_members.last_read_at IS 'Timestamp até onde o usuário visualizou mensagens da conversa.';

CREATE INDEX IF NOT EXISTS idx_conv_members_user ON public.conversation_members (user_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_members_conv ON public.conversation_members (conversation_id);

-- ----------------------------------------------------------------------------
-- 3. Tabela: public.messages (Mensagens)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    body VARCHAR(2000) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT messages_body_check CHECK (
        char_length(trim(body)) > 0 AND
        char_length(body) <= 2000
    )
);

COMMENT ON TABLE public.messages IS 'Mensagens persistidas do sistema de comunicação do DuoPlay-Online.';
COMMENT ON COLUMN public.messages.sender_id IS 'Remetente autoritativo da mensagem (sempre auth.uid()).';
COMMENT ON COLUMN public.messages.body IS 'Conteúdo textual da mensagem (máximo 2.000 caracteres).';

-- Índice determinístico para paginação e busca reversa rápida
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON public.messages (conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages (sender_id);

-- ----------------------------------------------------------------------------
-- 4. Habilitação de RLS e Políticas Estritas
-- ----------------------------------------------------------------------------
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Conversations: Leitura apenas para participantes
DROP POLICY IF EXISTS "conversations_select_members" ON public.conversations;
CREATE POLICY "conversations_select_members"
    ON public.conversations
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.conversation_members cm
            WHERE cm.conversation_id = id AND cm.user_id = auth.uid()
        )
    );

-- Conversation Members: Leitura para participantes da mesma conversa
DROP POLICY IF EXISTS "conv_members_select" ON public.conversation_members;
CREATE POLICY "conv_members_select"
    ON public.conversation_members
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.conversation_members cm2
            WHERE cm2.conversation_id = conversation_id AND cm2.user_id = auth.uid()
        )
    );

-- Messages: Leitura apenas para participantes da conversa
DROP POLICY IF EXISTS "messages_select_members" ON public.messages;
CREATE POLICY "messages_select_members"
    ON public.messages
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.conversation_members cm
            WHERE cm.conversation_id = conversation_id AND cm.user_id = auth.uid()
        )
    );

-- Sem mutação direta pelo cliente (apenas via RPCs SECURITY DEFINER)
REVOKE ALL ON TABLE public.conversations FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.conversations TO authenticated;

REVOKE ALL ON TABLE public.conversation_members FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.conversation_members TO authenticated;

REVOKE ALL ON TABLE public.messages FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.messages TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Inclusão na Publicação Realtime
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
              AND tablename = 'messages'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'conversations'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
        END IF;
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. RPC: get_or_create_direct_conversation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(
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
    v_conv RECORD;
    v_other_profile RECORD;
    v_is_online BOOLEAN := false;
    v_last_seen TIMESTAMPTZ;
    v_unread_count INTEGER := 0;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    IF v_caller_id = p_other_user_id THEN
        RAISE EXCEPTION 'CANNOT_CHAT_SELF: Não é permitido iniciar uma conversa consigo mesmo.' USING ERRCODE = 'P0060';
    END IF;

    -- 1. Validar que o outro usuário existe
    SELECT id, username, display_name, avatar_url INTO v_other_profile
    FROM public.profiles
    WHERE id = p_other_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'USER_NOT_FOUND: Jogador destinatário não encontrado.' USING ERRCODE = 'P0041';
    END IF;

    -- 2. Validar que os usuários são amigos ativos
    v_user_a := LEAST(v_caller_id, p_other_user_id);
    v_user_b := GREATEST(v_caller_id, p_other_user_id);

    IF NOT EXISTS (
        SELECT 1 FROM public.friendships
        WHERE user_a_id = v_user_a AND user_b_id = v_user_b
    ) THEN
        RAISE EXCEPTION 'USER_NOT_FRIEND: Você só pode conversar com jogadores que estão na sua lista de amigos.' USING ERRCODE = 'P0051';
    END IF;

    -- 3. Obter ou criar a conversa 1:1 de forma atômica
    SELECT * INTO v_conv
    FROM public.conversations
    WHERE type = 'direct'
      AND direct_user_a = v_user_a
      AND direct_user_b = v_user_b;

    IF NOT FOUND THEN
        INSERT INTO public.conversations (type, direct_user_a, direct_user_b)
        VALUES ('direct', v_user_a, v_user_b)
        ON CONFLICT (type, direct_user_a, direct_user_b)
        DO UPDATE SET updated_at = clock_timestamp()
        RETURNING * INTO v_conv;

        -- Inserir os dois membros participantes
        INSERT INTO public.conversation_members (conversation_id, user_id, last_read_at)
        VALUES
            (v_conv.id, v_user_a, clock_timestamp()),
            (v_conv.id, v_user_b, clock_timestamp())
        ON CONFLICT (conversation_id, user_id) DO NOTHING;
    END IF;

    -- 4. Obter status de presença do destinatário
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

    SELECT GREATEST(up.last_seen_at, max(mp.last_seen_at)) INTO v_last_seen
    FROM public.user_presence up
    LEFT JOIN public.match_players mp ON mp.user_id = p_other_user_id
    WHERE up.user_id = p_other_user_id
    GROUP BY up.last_seen_at;

    -- 5. Calcular mensagens não lidas para o chamador
    SELECT count(*)::INTEGER INTO v_unread_count
    FROM public.messages m
    JOIN public.conversation_members cm ON cm.conversation_id = v_conv.id AND cm.user_id = v_caller_id
    WHERE m.conversation_id = v_conv.id
      AND m.sender_id <> v_caller_id
      AND m.created_at > cm.last_read_at;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'conversation_id', v_conv.id,
            'type', v_conv.type,
            'created_at', v_conv.created_at,
            'last_message_at', v_conv.last_message_at,
            'unread_count', coalesce(v_unread_count, 0),
            'other_user', jsonb_build_object(
                'id', v_other_profile.id,
                'username', v_other_profile.username,
                'display_name', v_other_profile.display_name,
                'avatar_url', v_other_profile.avatar_url,
                'is_online', v_is_online,
                'last_seen_at', v_last_seen
            )
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_direct_conversation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. RPC: get_my_conversations (Lista de Conversas com Última Mensagem e Badge)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_conversations()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_conversations JSONB;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'conversation_id', c.id,
            'type', c.type,
            'created_at', c.created_at,
            'last_message_at', c.last_message_at,
            'unread_count', coalesce(unread_sub.cnt, 0),
            'other_user', jsonb_build_object(
                'id', p.id,
                'username', p.username,
                'display_name', p.display_name,
                'avatar_url', p.avatar_url,
                'is_online', coalesce(pres.is_active_online, false),
                'last_seen_at', pres.effective_last_seen
            ),
            'last_message', CASE WHEN lm.id IS NOT NULL THEN jsonb_build_object(
                'id', lm.id,
                'sender_id', lm.sender_id,
                'body', lm.body,
                'created_at', lm.created_at
            ) ELSE NULL END
        )
        ORDER BY c.last_message_at DESC
    ), '[]'::jsonb) INTO v_conversations
    FROM public.conversations c
    JOIN public.conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = v_caller_id
    -- Destinatário da conversa 1:1
    CROSS JOIN LATERAL (
        SELECT CASE WHEN c.direct_user_a = v_caller_id THEN c.direct_user_b ELSE c.direct_user_a END AS other_id
    ) other_sub
    JOIN public.profiles p ON p.id = other_sub.other_id
    -- Presença do destinatário
    LEFT JOIN LATERAL (
        SELECT
            (
                coalesce(up.last_seen_at > (clock_timestamp() - interval '25 seconds'), false)
                OR coalesce(max(mp.last_seen_at) > (clock_timestamp() - interval '25 seconds'), false)
            ) AS is_active_online,
            GREATEST(up.last_seen_at, max(mp.last_seen_at)) AS effective_last_seen
        FROM public.user_presence up
        LEFT JOIN public.match_players mp ON mp.user_id = other_sub.other_id AND mp.connection_status = 'connected'
        LEFT JOIN public.matches m ON m.id = mp.match_id AND m.status = 'in_progress'
        WHERE up.user_id = other_sub.other_id
        GROUP BY up.last_seen_at
    ) pres ON true
    -- Última mensagem da conversa
    LEFT JOIN LATERAL (
        SELECT id, sender_id, body, created_at
        FROM public.messages
        WHERE conversation_id = c.id
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    ) lm ON true
    -- Contagem de mensagens não lidas
    LEFT JOIN LATERAL (
        SELECT count(*)::INTEGER AS cnt
        FROM public.messages m
        WHERE m.conversation_id = c.id
          AND m.sender_id <> v_caller_id
          AND m.created_at > cm.last_read_at
    ) unread_sub ON true;

    RETURN jsonb_build_object(
        'success', true,
        'data', v_conversations
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_conversations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_conversations() TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. RPC: get_conversation_messages (Histórico com Paginação Determinística)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_conversation_messages(
    p_conversation_id UUID,
    p_limit INTEGER DEFAULT 30,
    p_before_created_at TIMESTAMPTZ DEFAULT NULL,
    p_before_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_limit INTEGER;
    v_messages JSONB;
    v_has_more BOOLEAN := false;
    v_count INTEGER;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- Validar que o usuário é membro da conversa
    IF NOT EXISTS (
        SELECT 1 FROM public.conversation_members
        WHERE conversation_id = p_conversation_id AND user_id = v_caller_id
    ) THEN
        RAISE EXCEPTION 'FORBIDDEN: Você não participa desta conversa.' USING ERRCODE = 'P0002';
    END IF;

    v_limit := LEAST(GREATEST(coalesce(p_limit, 30), 1), 100);

    -- Busca (v_limit + 1) mensagens anteriores ordenadas para verificar se há mais
    WITH page_rows AS (
        SELECT
            m.id,
            m.conversation_id,
            m.sender_id,
            m.body,
            m.created_at,
            m.updated_at,
            p.username AS sender_username,
            p.display_name AS sender_display_name,
            p.avatar_url AS sender_avatar_url
        FROM public.messages m
        JOIN public.profiles p ON p.id = m.sender_id
        WHERE m.conversation_id = p_conversation_id
          AND (
            p_before_created_at IS NULL
            OR m.created_at < p_before_created_at
            OR (m.created_at = p_before_created_at AND m.id < p_before_id)
          )
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT (v_limit + 1)
    ),
    sliced_rows AS (
        SELECT * FROM page_rows
        LIMIT v_limit
    )
    SELECT
        coalesce(jsonb_agg(
            jsonb_build_object(
                'id', sr.id,
                'conversation_id', sr.conversation_id,
                'sender_id', sr.sender_id,
                'sender_username', sr.sender_username,
                'sender_display_name', sr.sender_display_name,
                'sender_avatar_url', sr.sender_avatar_url,
                'body', sr.body,
                'created_at', sr.created_at,
                'is_mine', (sr.sender_id = v_caller_id)
            )
            ORDER BY sr.created_at ASC, sr.id ASC
        ), '[]'::jsonb),
        (SELECT count(*) FROM page_rows)
    INTO v_messages, v_count
    FROM sliced_rows sr;

    IF v_count > v_limit THEN
        v_has_more := true;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'messages', v_messages,
            'has_more', v_has_more
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_conversation_messages(UUID, INTEGER, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversation_messages(UUID, INTEGER, TIMESTAMPTZ, UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. RPC: send_message (Envio Autoritativo de Mensagem)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_message(
    p_conversation_id UUID,
    p_body TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_conv RECORD;
    v_trimmed TEXT;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_new_msg RECORD;
    v_sender_profile RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- Validar formato do corpo da mensagem
    v_trimmed := trim(p_body);
    IF v_trimmed IS NULL OR char_length(v_trimmed) = 0 THEN
        RAISE EXCEPTION 'EMPTY_MESSAGE: A mensagem não pode ser vazia.' USING ERRCODE = 'P0061';
    END IF;

    IF char_length(p_body) > 2000 THEN
        RAISE EXCEPTION 'MESSAGE_TOO_LONG: A mensagem ultrapassou o limite máximo de 2.000 caracteres.' USING ERRCODE = 'P0062';
    END IF;

    -- Validar conversa e participação
    SELECT * INTO v_conv
    FROM public.conversations
    WHERE id = p_conversation_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CONVERSATION_NOT_FOUND: Conversa não encontrada.' USING ERRCODE = 'P0063';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.conversation_members
        WHERE conversation_id = p_conversation_id AND user_id = v_caller_id
    ) THEN
        RAISE EXCEPTION 'FORBIDDEN: Você não participa desta conversa.' USING ERRCODE = 'P0002';
    END IF;

    -- Para conversas diretas, garantir que ainda há amizade ativa
    IF v_conv.type = 'direct' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.friendships
            WHERE user_a_id = v_conv.direct_user_a AND user_b_id = v_conv.direct_user_b
        ) THEN
            RAISE EXCEPTION 'USER_NOT_FRIEND: Você só pode enviar mensagens para jogadores que são seus amigos.' USING ERRCODE = 'P0051';
        END IF;
    END IF;

    -- Inserir a mensagem oficial com sender_id = auth.uid()
    INSERT INTO public.messages (conversation_id, sender_id, body, created_at, updated_at)
    VALUES (p_conversation_id, v_caller_id, v_trimmed, v_now, v_now)
    RETURNING * INTO v_new_msg;

    -- Atualizar timestamp da conversa e last_read_at do remetente
    UPDATE public.conversations
    SET last_message_at = v_now,
        updated_at = v_now
    WHERE id = p_conversation_id;

    UPDATE public.conversation_members
    SET last_read_at = v_now
    WHERE conversation_id = p_conversation_id AND user_id = v_caller_id;

    -- Perfil do remetente para payload completo
    SELECT username, display_name, avatar_url INTO v_sender_profile
    FROM public.profiles
    WHERE id = v_caller_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'id', v_new_msg.id,
            'conversation_id', v_new_msg.conversation_id,
            'sender_id', v_caller_id,
            'sender_username', v_sender_profile.username,
            'sender_display_name', v_sender_profile.display_name,
            'sender_avatar_url', v_sender_profile.avatar_url,
            'body', v_new_msg.body,
            'created_at', v_new_msg.created_at,
            'is_mine', true
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.send_message(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_message(UUID, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 10. RPC: mark_conversation_read
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_conversation_read(
    p_conversation_id UUID
)
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

    UPDATE public.conversation_members
    SET last_read_at = v_now
    WHERE conversation_id = p_conversation_id AND user_id = v_caller_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'FORBIDDEN: Você não participa desta conversa.' USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'conversation_id', p_conversation_id,
            'last_read_at', v_now
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_conversation_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(UUID) TO authenticated;
