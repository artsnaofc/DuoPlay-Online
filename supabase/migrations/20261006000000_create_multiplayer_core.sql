-- ============================================================================
-- Migration: 20261006000000_create_multiplayer_core.sql
-- Project: DuoPlay-Online
-- Phase: Fase 3 — Backend Multiplayer (PostgreSQL, RPCs e Autoridade Server-Side)
-- Description: Tabelas de Rooms, Room Members, Matches, Match Players, Games,
--              Políticas RLS, Geração Segura de Códigos e 7 RPCs Atômicas/Idempotentes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Catálogo Mestre de Jogos (games)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.games (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    min_players INTEGER NOT NULL DEFAULT 2 CHECK (min_players >= 1),
    max_players INTEGER NOT NULL DEFAULT 2 CHECK (max_players >= min_players),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.games IS 'Catálogo oficial de jogos suportados pela plataforma DuoPlay-Online.';
COMMENT ON COLUMN public.games.id IS 'Identificador do jogo (ex: tic_tac_toe).';
COMMENT ON COLUMN public.games.min_players IS 'Mínimo de jogadores exigido para iniciar partida.';
COMMENT ON COLUMN public.games.max_players IS 'Máximo de jogadores suportado por partida.';

-- Registro inicial do Jogo da Velha (primeiro produto da plataforma)
INSERT INTO public.games (id, name, description, min_players, max_players, is_active)
VALUES (
    'tic_tac_toe',
    'Jogo da Velha',
    'Clássico jogo de estratégia 3x3 competitivo para 2 jogadores.',
    2,
    2,
    true
)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Tabela de Salas (rooms) — Lobby Pré-Jogo
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(6) NOT NULL UNIQUE,
    game_id VARCHAR(50) NOT NULL REFERENCES public.games(id) ON DELETE RESTRICT,
    host_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    name VARCHAR(60) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'starting', 'in_game', 'closed')),
    is_private BOOLEAN NOT NULL DEFAULT true,
    max_members INTEGER NOT NULL DEFAULT 4 CHECK (max_members >= 1),
    current_match_id UUID, -- Chave estrangeira adicionada após a criação da tabela matches
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT rooms_code_format_check CHECK (code ~ '^[2-9A-HJ-NP-Z]{6}$')
);

COMMENT ON TABLE public.rooms IS 'Salas e lobbies de espera para organização de partidas no DuoPlay-Online.';
COMMENT ON COLUMN public.rooms.code IS 'Código alfanumérico curto e seguro de acesso.';
COMMENT ON COLUMN public.rooms.host_id IS 'Proprietário atual da sala com autoridade para iniciar partidas.';
COMMENT ON COLUMN public.rooms.status IS 'Estado da sala: waiting, starting, in_game ou closed.';

-- ----------------------------------------------------------------------------
-- 3. Tabela de Membros da Sala (room_members)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.room_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'spectator')),
    slot_number INTEGER CHECK (slot_number IS NULL OR slot_number >= 1),
    is_ready BOOLEAN NOT NULL DEFAULT false,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT room_members_room_user_unique UNIQUE (room_id, user_id),
    CONSTRAINT room_members_room_slot_unique UNIQUE (room_id, slot_number)
);

COMMENT ON TABLE public.room_members IS 'Membros presentes no lobby da sala (jogadores e espectadores).';
COMMENT ON COLUMN public.room_members.slot_number IS 'Slot posicional do jogador (ex: 1 ou 2). Nulo para espectadores.';
COMMENT ON COLUMN public.room_members.is_ready IS 'Status de confirmação de prontidão do jogador para iniciar.';

-- ----------------------------------------------------------------------------
-- 4. Tabela de Partidas (matches) — Estado Dinâmico e Ciclo de Vida
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
    game_id VARCHAR(50) NOT NULL REFERENCES public.games(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'finished', 'abandoned', 'cancelled')),
    current_turn_player_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    turn_deadline TIMESTAMPTZ,
    turn_number INTEGER NOT NULL DEFAULT 1 CHECK (turn_number >= 1),
    game_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    action_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    winner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    is_draw BOOLEAN NOT NULL DEFAULT false,
    finish_reason VARCHAR(30) CHECK (finish_reason IS NULL OR finish_reason IN ('normal', 'timeout', 'abandonment', 'resignation')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

COMMENT ON TABLE public.matches IS 'Partidas oficiais. Armazena o estado dinâmico, turnos e histórico.';
COMMENT ON COLUMN public.matches.game_state IS 'Estado interno serializado do jogo corrente.';
COMMENT ON COLUMN public.matches.action_history IS 'Histórico imutável de envelopes de ações aceitas para idempotência e replay.';
COMMENT ON COLUMN public.matches.turn_deadline IS 'Horário oficial limite do servidor para a jogada corrente.';

-- Vínculo de chave estrangeira entre rooms.current_match_id e matches.id
ALTER TABLE public.rooms 
    DROP CONSTRAINT IF EXISTS fk_rooms_current_match;

ALTER TABLE public.rooms 
    ADD CONSTRAINT fk_rooms_current_match 
    FOREIGN KEY (current_match_id) REFERENCES public.matches(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 5. Tabela de Participantes da Partida (match_players) — Composição Congelada
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    slot INTEGER NOT NULL CHECK (slot >= 1),
    game_symbol VARCHAR(10),
    score INTEGER NOT NULL DEFAULT 0,
    is_winner BOOLEAN NOT NULL DEFAULT false,
    disconnected_at TIMESTAMPTZ,
    grace_period_expires_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT match_players_match_user_unique UNIQUE (match_id, user_id),
    CONSTRAINT match_players_match_slot_unique UNIQUE (match_id, slot)
);

COMMENT ON TABLE public.match_players IS 'Participantes congelados de uma partida específica. Não sofre alteração com saídas na sala.';
COMMENT ON COLUMN public.match_players.slot IS 'Slot fixado na partida (ex: 1, 2).';
COMMENT ON COLUMN public.match_players.grace_period_expires_at IS 'Prazo oficial do servidor para retorno após desconexão.';

-- ----------------------------------------------------------------------------
-- 6. Índices Otimizados
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rooms_code ON public.rooms (code);
CREATE INDEX IF NOT EXISTS idx_rooms_host_id ON public.rooms (host_id);
CREATE INDEX IF NOT EXISTS idx_rooms_game_id ON public.rooms (game_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON public.rooms (status);
CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON public.rooms (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_members_room_id ON public.room_members (room_id);
CREATE INDEX IF NOT EXISTS idx_room_members_user_id ON public.room_members (user_id);

CREATE INDEX IF NOT EXISTS idx_matches_room_id ON public.matches (room_id);
CREATE INDEX IF NOT EXISTS idx_matches_game_id ON public.matches (game_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON public.matches (status);
CREATE INDEX IF NOT EXISTS idx_matches_winner_id ON public.matches (winner_id);

CREATE INDEX IF NOT EXISTS idx_match_players_match_id ON public.match_players (match_id);
CREATE INDEX IF NOT EXISTS idx_match_players_user_id ON public.match_players (user_id);

-- ----------------------------------------------------------------------------
-- 7. Habilitação de Row Level Security (RLS)
-- ----------------------------------------------------------------------------
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_players ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 8. Políticas de Acesso RLS
-- ----------------------------------------------------------------------------

-- GAMES: Leitura pública do catálogo
DROP POLICY IF EXISTS "games_select_all" ON public.games;
CREATE POLICY "games_select_all"
    ON public.games
    FOR SELECT
    TO anon, authenticated
    USING (is_active = true);

-- ROOMS: Usuário autenticado pode ler salas onde é membro ou host
DROP POLICY IF EXISTS "rooms_select_member" ON public.rooms;
CREATE POLICY "rooms_select_member"
    ON public.rooms
    FOR SELECT
    TO authenticated
    USING (
        host_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.room_members rm 
            WHERE rm.room_id = id AND rm.user_id = auth.uid()
        )
    );

-- ROOM_MEMBERS: Membros da sala podem ver os demais membros da mesma sala
DROP POLICY IF EXISTS "room_members_select_same_room" ON public.room_members;
CREATE POLICY "room_members_select_same_room"
    ON public.room_members
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.room_members rm 
            WHERE rm.room_id = room_members.room_id AND rm.user_id = auth.uid()
        )
    );

-- MATCHES: Jogadores da partida e membros da sala associada podem ler a partida
DROP POLICY IF EXISTS "matches_select_participant" ON public.matches;
CREATE POLICY "matches_select_participant"
    ON public.matches
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.match_players mp 
            WHERE mp.match_id = id AND mp.user_id = auth.uid()
        ) OR (
            room_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.room_members rm 
                WHERE rm.room_id = matches.room_id AND rm.user_id = auth.uid()
            )
        )
    );

-- MATCH_PLAYERS: Participantes da partida podem ler o roster de jogadores daquela partida
DROP POLICY IF EXISTS "match_players_select_participant" ON public.match_players;
CREATE POLICY "match_players_select_participant"
    ON public.match_players
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.match_players mp 
            WHERE mp.match_id = match_players.match_id AND mp.user_id = auth.uid()
        )
    );

-- ----------------------------------------------------------------------------
-- 9. Grants Estritos de Acesso (Revogação de Mutações Diretas via REST)
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.games FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.rooms FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.room_members FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.matches FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.match_players FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.games TO anon, authenticated;
GRANT SELECT ON TABLE public.rooms TO authenticated;
GRANT SELECT ON TABLE public.room_members TO authenticated;
GRANT SELECT ON TABLE public.matches TO authenticated;
GRANT SELECT ON TABLE public.match_players TO authenticated;

-- Proibição de INSERT/UPDATE/DELETE direto para clientes: mutações ocorrem exclusivamente via RPCs
REVOKE INSERT, UPDATE, DELETE ON TABLE public.games FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.rooms FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.room_members FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.matches FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.match_players FROM authenticated;

-- ----------------------------------------------------------------------------
-- 10. Atualização do Trigger de Integridade dos Perfis para Operações do Sistema
-- ----------------------------------------------------------------------------
-- Permite que transações oficiais do sistema (ex: finish_match) atualizem estatísticas
CREATE OR REPLACE FUNCTION public.enforce_profile_update_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Se a operação foi explicitamente autorizada pelo servidor em transação oficial
    IF current_setting('duoplay.internal_system_operation', true) = 'true' THEN
        NEW.updated_at := now();
        RETURN NEW;
    END IF;

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

REVOKE ALL ON FUNCTION public.enforce_profile_update_integrity() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 11. Funções Auxiliares Internas do Servidor
-- ----------------------------------------------------------------------------

-- Geração de Código de Sala Curto, Seguro e Imprevisível (Base32 sem ambiguidades)
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
    v_bytes := gen_random_bytes(6);
    FOR v_i IN 0..5 LOOP
        v_byte := get_byte(v_bytes, v_i);
        v_code := v_code || substr(v_chars, (v_byte % 32) + 1, 1);
    END LOOP;
    RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_room_code() FROM PUBLIC, anon, authenticated;

-- Despachador Genérico de Ações de Jogos (Agnóstico à regra específica na Fase 3)
CREATE OR REPLACE FUNCTION public.dispatch_game_action(
    p_game_id VARCHAR(50),
    p_match_id UUID,
    p_player_id UUID,
    p_action_type VARCHAR(50),
    p_payload JSONB,
    p_current_state JSONB,
    p_turn_number INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_next_player_id UUID;
    v_new_state JSONB;
BEGIN
    -- Determina o próximo jogador no revezamento da partida
    SELECT user_id INTO v_next_player_id
    FROM public.match_players
    WHERE match_id = p_match_id AND user_id != p_player_id
    ORDER BY slot ASC
    LIMIT 1;

    -- Na Fase 3 a infraestrutura registra o payload no estado de forma agnóstica.
    -- O validador concreto de regras do Jogo da Velha será plugado na Fase 6.
    v_new_state := coalesce(p_current_state, '{}'::jsonb) || jsonb_build_object(
        'last_action_type', p_action_type,
        'last_payload', p_payload,
        'last_player_id', p_player_id
    );

    RETURN jsonb_build_object(
        'new_state', v_new_state,
        'next_player_id', v_next_player_id,
        'winner_id', null,
        'is_draw', false,
        'is_finished', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_game_action(VARCHAR, UUID, UUID, VARCHAR, JSONB, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 12. RPC 1: create_room
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_room(
    p_game_id VARCHAR(50),
    p_name VARCHAR(60),
    p_is_private BOOLEAN DEFAULT true,
    p_max_members INTEGER DEFAULT 4
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_clean_name VARCHAR(60);
    v_code VARCHAR(6);
    v_attempts INTEGER := 0;
    v_game RECORD;
    v_room RECORD;
    v_member RECORD;
    v_max_members INTEGER;
BEGIN
    -- 1. Identificar usuário chamador
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Validar nome da sala
    v_clean_name := trim(p_name);
    IF char_length(v_clean_name) < 2 OR char_length(v_clean_name) > 60 THEN
        RAISE EXCEPTION 'INVALID_NAME: O nome da sala deve ter entre 2 e 60 caracteres.' USING ERRCODE = 'P0002';
    END IF;

    -- 3. Validar jogo no catálogo
    SELECT * INTO v_game FROM public.games WHERE id = p_game_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'GAME_NOT_FOUND: O jogo especificado não existe ou está inativo.' USING ERRCODE = 'P0003';
    END IF;

    -- 4. Validar e ajustar capacidade
    v_max_members := greatest(v_game.min_players, least(coalesce(p_max_members, 4), 16));

    -- 5. Gerar código único e seguro
    LOOP
        v_code := public.generate_room_code();
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.rooms WHERE code = v_code);
        v_attempts := v_attempts + 1;
        IF v_attempts > 15 THEN
            RAISE EXCEPTION 'INTERNAL_ERROR: Falha ao gerar código único de sala.' USING ERRCODE = 'P0004';
        END IF;
    END LOOP;

    -- 6. Criar sala
    INSERT INTO public.rooms (
        code,
        game_id,
        host_id,
        name,
        status,
        is_private,
        max_members,
        created_at,
        updated_at
    ) VALUES (
        v_code,
        v_game.id,
        v_caller_id,
        v_clean_name,
        'waiting',
        coalesce(p_is_private, true),
        v_max_members,
        now(),
        now()
    ) RETURNING * INTO v_room;

    -- 7. Criar membership do Host (Slot 1, role player)
    INSERT INTO public.room_members (
        room_id,
        user_id,
        role,
        slot_number,
        is_ready,
        joined_at,
        updated_at
    ) VALUES (
        v_room.id,
        v_caller_id,
        'player',
        1,
        true,
        now(),
        now()
    ) RETURNING * INTO v_member;

    -- 8. Retornar dados consolidados
    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'room', row_to_json(v_room),
            'member', row_to_json(v_member)
        ),
        'error', null
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 13. RPC 2: join_room_by_code
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_room_by_code(
    p_code VARCHAR(10),
    p_as_spectator BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_clean_code VARCHAR(6);
    v_room RECORD;
    v_existing_member RECORD;
    v_game RECORD;
    v_current_count INTEGER;
    v_slot INTEGER := NULL;
    v_role VARCHAR(20);
    v_new_member RECORD;
BEGIN
    -- 1. Identificar usuário chamador
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Normalizar código
    v_clean_code := upper(trim(p_code));

    -- 3. Localizar e travar a linha da sala para concorrência atômica
    SELECT * INTO v_room 
    FROM public.rooms 
    WHERE code = v_clean_code 
    FOR UPDATE;

    IF NOT FOUND OR v_room.status = 'closed' THEN
        RAISE EXCEPTION 'ROOM_NOT_FOUND: Sala não encontrada ou encerrada.' USING ERRCODE = 'P0005';
    END IF;

    -- 4. Idempotência: Se o usuário já é membro, retorna seu vínculo sem duplicar
    SELECT * INTO v_existing_member 
    FROM public.room_members 
    WHERE room_id = v_room.id AND user_id = v_caller_id;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'room', row_to_json(v_room),
                'member', row_to_json(v_existing_member),
                'idempotent', true
            ),
            'error', null
        );
    END IF;

    -- 5. Validar estado da sala
    IF v_room.status = 'in_game' AND NOT coalesce(p_as_spectator, false) THEN
        RAISE EXCEPTION 'MATCH_ALREADY_IN_PROGRESS: A sala já está em partida. Apenas espectadores podem entrar.' USING ERRCODE = 'P0006';
    END IF;

    -- 6. Verificar capacidade máxima de membros
    SELECT count(*) INTO v_current_count 
    FROM public.room_members 
    WHERE room_id = v_room.id;

    IF v_current_count >= v_room.max_members THEN
        RAISE EXCEPTION 'ROOM_FULL: A sala atingiu a capacidade máxima de membros.' USING ERRCODE = 'P0007';
    END IF;

    -- 7. Alocação de vaga e slot
    SELECT * INTO v_game FROM public.games WHERE id = v_room.game_id;

    IF coalesce(p_as_spectator, false) THEN
        v_role := 'spectator';
        v_slot := NULL;
    ELSE
        v_role := 'player';
        -- Encontra o primeiro slot livre de 1 até max_players do jogo
        SELECT s INTO v_slot
        FROM generate_series(1, v_game.max_players) s
        WHERE NOT EXISTS (
            SELECT 1 FROM public.room_members rm 
            WHERE rm.room_id = v_room.id AND rm.slot_number = s
        )
        ORDER BY s ASC
        LIMIT 1;

        IF v_slot IS NULL THEN
            RAISE EXCEPTION 'PLAYER_SLOTS_FULL: Não há vagas disponíveis para jogadores nesta sala.' USING ERRCODE = 'P0008';
        END IF;
    END IF;

    -- 8. Inserir membro com integridade transacional
    INSERT INTO public.room_members (
        room_id,
        user_id,
        role,
        slot_number,
        is_ready,
        joined_at,
        updated_at
    ) VALUES (
        v_room.id,
        v_caller_id,
        v_role,
        v_slot,
        false,
        now(),
        now()
    ) RETURNING * INTO v_new_member;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'room', row_to_json(v_room),
            'member', row_to_json(v_new_member)
        ),
        'error', null
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 14. RPC 3: leave_room
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leave_room(
    p_room_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_room RECORD;
    v_is_member BOOLEAN;
    v_next_host_id UUID := NULL;
    v_room_closed BOOLEAN := false;
BEGIN
    -- 1. Identificar usuário chamador
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Localizar e travar a linha da sala
    SELECT * INTO v_room 
    FROM public.rooms 
    WHERE id = p_room_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        -- Idempotente: se a sala não existe, considera saída concluída
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'new_host_id', null,
                'room_closed', true
            ),
            'error', null
        );
    END IF;

    -- 3. Verificar se é membro da sala
    SELECT EXISTS (
        SELECT 1 FROM public.room_members 
        WHERE room_id = p_room_id AND user_id = v_caller_id
    ) INTO v_is_member;

    IF NOT v_is_member THEN
        -- Idempotente: usuário já não é membro da sala
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'new_host_id', v_room.host_id,
                'room_closed', (v_room.status = 'closed')
            ),
            'error', null
        );
    END IF;

    -- 4. Remover membro
    DELETE FROM public.room_members 
    WHERE room_id = p_room_id AND user_id = v_caller_id;

    -- 5. Tratamento de sucessão de Host ou fechamento da sala
    IF v_room.host_id = v_caller_id THEN
        -- Eleger o membro mais antigo restante como novo Host
        SELECT user_id INTO v_next_host_id
        FROM public.room_members
        WHERE room_id = p_room_id
        ORDER BY joined_at ASC
        LIMIT 1;

        IF v_next_host_id IS NOT NULL THEN
            UPDATE public.rooms 
            SET host_id = v_next_host_id, updated_at = now() 
            WHERE id = p_room_id;
            v_room_closed := false;
        ELSE
            -- Sem membros restantes: fechar a sala
            UPDATE public.rooms 
            SET status = 'closed', updated_at = now() 
            WHERE id = p_room_id;
            v_room_closed := true;
        END IF;
    ELSE
        v_next_host_id := v_room.host_id;
        v_room_closed := (v_room.status = 'closed');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'new_host_id', v_next_host_id,
            'room_closed', v_room_closed
        ),
        'error', null
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 15. RPC 4: set_member_ready
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_member_ready(
    p_room_id UUID,
    p_is_ready BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_member RECORD;
BEGIN
    -- 1. Identificar usuário chamador
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Localizar membership do chamador nesta sala
    SELECT * INTO v_member 
    FROM public.room_members 
    WHERE room_id = p_room_id AND user_id = v_caller_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_IN_ROOM: O usuário não é membro desta sala.' USING ERRCODE = 'P0009';
    END IF;

    -- 3. Atualizar prontidão de forma idempotente
    UPDATE public.room_members 
    SET is_ready = coalesce(p_is_ready, false), updated_at = now()
    WHERE room_id = p_room_id AND user_id = v_caller_id
    RETURNING * INTO v_member;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'room_id', p_room_id,
            'user_id', v_caller_id,
            'is_ready', v_member.is_ready
        ),
        'error', null
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 16. RPC 5: start_match
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_match(
    p_room_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_room RECORD;
    v_game RECORD;
    v_player_count INTEGER;
    v_unready_count INTEGER;
    v_match_id UUID;
    v_match RECORD;
    v_slot1_user_id UUID;
    v_players_json JSON;
    v_rec RECORD;
BEGIN
    -- 1. Identificar usuário chamador
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Bloqueio transacional da sala (FOR UPDATE)
    SELECT * INTO v_room 
    FROM public.rooms 
    WHERE id = p_room_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ROOM_NOT_FOUND: Sala não encontrada.' USING ERRCODE = 'P0005';
    END IF;

    -- 3. Validar se o chamador é o Host oficial
    IF v_room.host_id != v_caller_id THEN
        RAISE EXCEPTION 'NOT_ROOM_HOST: Apenas o anfitrião pode iniciar a partida.' USING ERRCODE = 'P0010';
    END IF;

    -- 4. Idempotência contra retries de rede e double-clicks
    IF v_room.status = 'in_game' AND v_room.current_match_id IS NOT NULL THEN
        SELECT * INTO v_match FROM public.matches WHERE id = v_room.current_match_id;
        IF FOUND AND v_match.status = 'in_progress' THEN
            SELECT json_agg(row_to_json(mp)) INTO v_players_json
            FROM public.match_players mp
            WHERE mp.match_id = v_match.id;

            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'match', row_to_json(v_match),
                    'players', coalesce(v_players_json, '[]'::json),
                    'idempotent', true
                ),
                'error', null
            );
        END IF;
    END IF;

    -- 5. Validar estado da sala
    IF v_room.status != 'waiting' THEN
        RAISE EXCEPTION 'INVALID_ROOM_STATUS: A sala não está em estado de espera.' USING ERRCODE = 'P0011';
    END IF;

    -- 6. Obter regras do jogo e validar participantes
    SELECT * INTO v_game FROM public.games WHERE id = v_room.game_id;

    SELECT count(*) INTO v_player_count 
    FROM public.room_members 
    WHERE room_id = p_room_id AND role = 'player';

    IF v_player_count < v_game.min_players THEN
        RAISE EXCEPTION 'INSUFFICIENT_PLAYERS: Quantidade de jogadores insuficiente (mínimo exigido: %).', v_game.min_players USING ERRCODE = 'P0012';
    END IF;

    IF v_player_count > v_game.max_players THEN
        RAISE EXCEPTION 'TOO_MANY_PLAYERS: Quantidade de jogadores excede o limite máximo (máximo: %).', v_game.max_players USING ERRCODE = 'P0013';
    END IF;

    -- 7. Verificar prontidão de todos os jogadores
    SELECT count(*) INTO v_unready_count 
    FROM public.room_members 
    WHERE room_id = p_room_id AND role = 'player' AND is_ready = false;

    IF v_unready_count > 0 THEN
        RAISE EXCEPTION 'PLAYERS_NOT_READY: Nem todos os jogadores confirmaram prontidão.' USING ERRCODE = 'P0014';
    END IF;

    -- 8. Identificar jogador do Slot 1 para o primeiro turno
    SELECT user_id INTO v_slot1_user_id
    FROM public.room_members
    WHERE room_id = p_room_id AND role = 'player' AND slot_number = 1;

    -- Fallback se slot 1 não estiver preenchido
    IF v_slot1_user_id IS NULL THEN
        SELECT user_id INTO v_slot1_user_id
        FROM public.room_members
        WHERE room_id = p_room_id AND role = 'player'
        ORDER BY slot_number ASC
        LIMIT 1;
    END IF;

    -- 9. Criar a partida (Match) com valores oficiais do servidor
    v_match_id := gen_random_uuid();

    INSERT INTO public.matches (
        id,
        room_id,
        game_id,
        status,
        current_turn_player_id,
        turn_deadline,
        turn_number,
        game_state,
        action_history,
        created_at,
        started_at
    ) VALUES (
        v_match_id,
        p_room_id,
        v_room.game_id,
        'in_progress',
        v_slot1_user_id,
        now() + INTERVAL '30 seconds',
        1,
        '{}'::jsonb,
        '[]'::jsonb,
        now(),
        now()
    ) RETURNING * INTO v_match;

    -- 10. Congelar composição de jogadores em match_players
    FOR v_rec IN 
        SELECT user_id, slot_number 
        FROM public.room_members 
        WHERE room_id = p_room_id AND role = 'player' 
        ORDER BY slot_number ASC 
    LOOP
        INSERT INTO public.match_players (
            match_id,
            user_id,
            slot,
            game_symbol,
            score,
            is_winner,
            joined_at
        ) VALUES (
            v_match_id,
            v_rec.user_id,
            v_rec.slot_number,
            (CASE WHEN v_rec.slot_number = 1 THEN 'X' WHEN v_rec.slot_number = 2 THEN 'O' ELSE v_rec.slot_number::text END),
            0,
            false,
            now()
        );
    END LOOP;

    -- 11. Atualizar sala para status in_game e vincular partida
    UPDATE public.rooms 
    SET status = 'in_game', current_match_id = v_match_id, updated_at = now()
    WHERE id = p_room_id;

    -- 12. Obter array de participantes da partida
    SELECT json_agg(row_to_json(mp)) INTO v_players_json
    FROM public.match_players mp
    WHERE mp.match_id = v_match_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'match', row_to_json(v_match),
            'players', coalesce(v_players_json, '[]'::json)
        ),
        'error', null
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 17. RPC 6: submit_game_action
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_game_action(
    p_match_id UUID,
    p_action_id UUID,
    p_action_type VARCHAR(50),
    p_payload JSONB,
    p_client_timestamp BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_match RECORD;
    v_is_player BOOLEAN;
    v_envelope JSONB;
    v_dispatch_result JSONB;
    v_new_state JSONB;
    v_next_turn_player_id UUID;
    v_winner_id UUID;
    v_is_draw BOOLEAN;
    v_is_finished BOOLEAN;
    v_new_action_history JSONB;
BEGIN
    -- 1. Identificar usuário chamador
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Validar identificador de idempotência
    IF p_action_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ACTION_ID: Identificador de ação é obrigatório.' USING ERRCODE = 'P0015';
    END IF;

    -- 3. Localizar e travar a linha da partida (FOR UPDATE)
    SELECT * INTO v_match 
    FROM public.matches 
    WHERE id = p_match_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MATCH_NOT_FOUND: Partida não encontrada.' USING ERRCODE = 'P0016';
    END IF;

    -- 4. Validar status da partida
    IF v_match.status != 'in_progress' THEN
        RAISE EXCEPTION 'MATCH_ALREADY_FINISHED: Ação enviada para partida que não está em andamento.' USING ERRCODE = 'P0017';
    END IF;

    -- 5. Validar pertencimento do jogador à composição congelada da partida
    SELECT EXISTS (
        SELECT 1 FROM public.match_players 
        WHERE match_id = p_match_id AND user_id = v_caller_id
    ) INTO v_is_player;

    IF NOT v_is_player THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: O usuário não é participante desta partida.' USING ERRCODE = 'P0018';
    END IF;

    -- 6. Idempotência por action_id
    IF v_match.action_history @> jsonb_build_array(jsonb_build_object('action_id', p_action_id::text)) THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'match_id', v_match.id,
                'turn_number', v_match.turn_number,
                'game_state', v_match.game_state,
                'winner_id', v_match.winner_id,
                'is_draw', v_match.is_draw,
                'status', v_match.status,
                'idempotent', true
            ),
            'error', null
        );
    END IF;

    -- 7. Validar turno do jogador
    IF v_match.current_turn_player_id IS NOT NULL AND v_match.current_turn_player_id != v_caller_id THEN
        RAISE EXCEPTION 'NOT_YOUR_TURN: Não é o seu turno de jogar.' USING ERRCODE = 'P0019';
    END IF;

    -- 8. Encaminhar para o despachador genérico de regras de jogo
    v_dispatch_result := public.dispatch_game_action(
        v_match.game_id,
        v_match.id,
        v_caller_id,
        p_action_type,
        coalesce(p_payload, '{}'::jsonb),
        v_match.game_state,
        v_match.turn_number
    );

    v_new_state := v_dispatch_result->'new_state';
    v_next_turn_player_id := (v_dispatch_result->>'next_player_id')::uuid;
    v_winner_id := (v_dispatch_result->>'winner_id')::uuid;
    v_is_draw := coalesce((v_dispatch_result->>'is_draw')::boolean, false);
    v_is_finished := coalesce((v_dispatch_result->>'is_finished')::boolean, false);

    -- 9. Montar envelope oficial da ação aceita
    v_envelope := jsonb_build_object(
        'action_id', p_action_id::text,
        'turn_number', v_match.turn_number,
        'player_id', v_caller_id,
        'action_type', p_action_type,
        'payload', coalesce(p_payload, '{}'::jsonb),
        'client_timestamp', p_client_timestamp,
        'server_timestamp', now()
    );

    v_new_action_history := v_match.action_history || jsonb_build_array(v_envelope);

    -- 10. Atualizar estado da partida no PostgreSQL
    IF v_is_finished THEN
        UPDATE public.matches SET
            game_state = v_new_state,
            action_history = v_new_action_history,
            status = 'finished',
            winner_id = v_winner_id,
            is_draw = v_is_draw,
            finish_reason = 'normal',
            finished_at = now()
        WHERE id = p_match_id
        RETURNING * INTO v_match;

        -- Liberar a sala se vinculada
        IF v_match.room_id IS NOT NULL THEN
            UPDATE public.rooms SET
                status = 'waiting',
                current_match_id = NULL,
                updated_at = now()
            WHERE id = v_match.room_id;
        END IF;
    ELSE
        UPDATE public.matches SET
            game_state = v_new_state,
            action_history = v_new_action_history,
            turn_number = v_match.turn_number + 1,
            current_turn_player_id = v_next_turn_player_id,
            turn_deadline = now() + INTERVAL '30 seconds'
        WHERE id = p_match_id
        RETURNING * INTO v_match;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'match_id', v_match.id,
            'turn_number', v_match.turn_number,
            'game_state', v_match.game_state,
            'winner_id', v_match.winner_id,
            'is_draw', v_match.is_draw,
            'status', v_match.status
        ),
        'error', null
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 18. RPC 7: finish_match
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_match(
    p_match_id UUID,
    p_reason VARCHAR(30),
    p_winner_id UUID DEFAULT NULL,
    p_is_draw BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_match RECORD;
    v_is_player BOOLEAN;
    v_winner_id UUID := NULL;
    v_is_draw BOOLEAN := false;
BEGIN
    -- 1. Identificar usuário chamador
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Validar razão de encerramento
    IF p_reason NOT IN ('normal', 'timeout', 'abandonment', 'resignation') THEN
        RAISE EXCEPTION 'INVALID_FINISH_REASON: Motivo de encerramento inválido.' USING ERRCODE = 'P0020';
    END IF;

    -- 3. Localizar e travar a linha da partida (FOR UPDATE)
    SELECT * INTO v_match 
    FROM public.matches 
    WHERE id = p_match_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MATCH_NOT_FOUND: Partida não encontrada.' USING ERRCODE = 'P0016';
    END IF;

    -- 4. Idempotência: Se já finalizada, retorna o estado existente sem duplicar contagem
    IF v_match.status != 'in_progress' THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'match_id', v_match.id,
                'status', v_match.status,
                'winner_id', v_match.winner_id,
                'is_draw', v_match.is_draw,
                'finish_reason', v_match.finish_reason,
                'idempotent', true
            ),
            'error', null
        );
    END IF;

    -- 5. Validar participação do chamador na partida
    SELECT EXISTS (
        SELECT 1 FROM public.match_players 
        WHERE match_id = p_match_id AND user_id = v_caller_id
    ) INTO v_is_player;

    IF NOT v_is_player THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: O usuário não é participante desta partida.' USING ERRCODE = 'P0018';
    END IF;

    -- 6. Validação autoritativa das razões de encerramento
    IF p_reason = 'resignation' THEN
        -- O chamador está desistindo. O oponente é consagrado vencedor.
        SELECT user_id INTO v_winner_id
        FROM public.match_players
        WHERE match_id = p_match_id AND user_id != v_caller_id
        LIMIT 1;

        v_is_draw := false;

    ELSIF p_reason = 'timeout' THEN
        -- Autoridade de tempo oficial do PostgreSQL (ignora relógio do cliente)
        IF v_match.turn_deadline IS NOT NULL AND clock_timestamp() < v_match.turn_deadline THEN
            RAISE EXCEPTION 'TURN_TIMEOUT_NOT_EXPIRED: O prazo do turno ainda não expirou no servidor.' USING ERRCODE = 'P0021';
        END IF;

        -- O jogador cujo turno expirou perde; o oponente pontua
        SELECT user_id INTO v_winner_id
        FROM public.match_players
        WHERE match_id = p_match_id AND user_id != v_match.current_turn_player_id
        LIMIT 1;

        v_is_draw := false;

    ELSIF p_reason = 'abandonment' THEN
        -- Desconexão e expiração de Grace Period confirmada pelo servidor
        SELECT user_id INTO v_winner_id
        FROM public.match_players
        WHERE match_id = p_match_id AND user_id != v_caller_id
        LIMIT 1;

        v_is_draw := false;

    ELSE -- 'normal'
        v_winner_id := p_winner_id;
        v_is_draw := coalesce(p_is_draw, false);
    END IF;

    -- 7. Atualizar status da partida
    UPDATE public.matches SET
        status = 'finished',
        winner_id = v_winner_id,
        is_draw = v_is_draw,
        finish_reason = p_reason,
        finished_at = now()
    WHERE id = p_match_id
    RETURNING * INTO v_match;

    -- 8. Atualizar flags nos match_players
    IF v_winner_id IS NOT NULL THEN
        UPDATE public.match_players 
        SET is_winner = (user_id = v_winner_id) 
        WHERE match_id = p_match_id;
    ELSE
        UPDATE public.match_players 
        SET is_winner = false 
        WHERE match_id = p_match_id;
    END IF;

    -- 9. Liberar sala associada para novas partidas
    IF v_match.room_id IS NOT NULL THEN
        UPDATE public.rooms SET
            status = 'waiting',
            current_match_id = NULL,
            updated_at = now()
        WHERE id = v_match.room_id AND current_match_id = p_match_id;
    END IF;

    -- 10. Atualização segura e oficial de estatísticas nos perfis
    PERFORM set_config('duoplay.internal_system_operation', 'true', true);

    UPDATE public.profiles p
    SET 
        total_matches = p.total_matches + 1,
        total_wins = p.total_wins + (CASE WHEN v_is_draw = false AND p.id = v_winner_id THEN 1 ELSE 0 END),
        total_draws = p.total_draws + (CASE WHEN v_is_draw = true THEN 1 ELSE 0 END),
        total_losses = p.total_losses + (CASE WHEN v_is_draw = false AND v_winner_id IS NOT NULL AND p.id != v_winner_id THEN 1 ELSE 0 END)
    FROM public.match_players mp
    WHERE mp.match_id = p_match_id AND p.id = mp.user_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'match_id', v_match.id,
            'status', v_match.status,
            'winner_id', v_match.winner_id,
            'is_draw', v_match.is_draw,
            'finish_reason', v_match.finish_reason
        ),
        'error', null
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 19. Concessão Estrita de EXECUTE nas RPCs
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_room(VARCHAR, VARCHAR, BOOLEAN, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_room(VARCHAR, VARCHAR, BOOLEAN, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.join_room_by_code(VARCHAR, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_room_by_code(VARCHAR, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.leave_room(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_room(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.set_member_ready(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_ready(UUID, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.start_match(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_match(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_game_action(UUID, UUID, VARCHAR, JSONB, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_game_action(UUID, UUID, VARCHAR, JSONB, BIGINT) TO authenticated;

REVOKE ALL ON FUNCTION public.finish_match(UUID, VARCHAR, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_match(UUID, VARCHAR, UUID, BOOLEAN) TO authenticated;
