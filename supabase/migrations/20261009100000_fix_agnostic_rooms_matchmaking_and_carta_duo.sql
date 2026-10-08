-- ============================================================================
-- Migration: 20261009100000_fix_agnostic_rooms_matchmaking_and_carta_duo.sql
-- Project: DuoPlay-Online
-- Phase: Correção das Fases 19/20 — Salas, Matchmaking e Carta Duo
-- Description:
--   1. Torna create_room, join_room_by_code, leave_room, start_match e
--      join_matchmaking_queue 100% agnósticos ao jogo, consultando o catálogo
--      oficial public.games (is_active, min_players, max_players, config).
--   2. Remove totalmente regras/símbolos de X/O do core de criação de partidas
--      e matchmaking, fixando slot 1..N e game_symbol como NULL genérico.
--   3. Suporta matchmaking de 2 jogadores (Tic-Tac-Toe) e 2-6 jogadores (Carta Duo),
--      mantendo filas estritamente separadas por game_id.
--   4. Garante limpeza de memberships/salas residuais em saídas/trocas de jogo
--      e impede criação/entrada em salas ou matchmaking se o usuário tiver
--      partida 'in_progress' ativa.
--   5. Corrige o retorno oficial do validador do Carta Duo (validate_carta_duo_action)
--      para conter o envelope 'accepted': true e 'new_state'.
--   6. Corrige criação de partidas em respond_to_rematch para compatibilidade
--      com colunas oficiais (slot e game_state).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Assegurar Catálogo Oficial e Ativação dos Jogos
-- ----------------------------------------------------------------------------
UPDATE public.games
SET is_active = true,
    min_players = 2,
    max_players = 2,
    game_type = 'turn_based',
    config = coalesce(config, '{"category_label": "Turnos", "requires_timer": true}'::jsonb)
WHERE id = 'tic_tac_toe';

UPDATE public.games
SET is_active = true,
    min_players = 2,
    max_players = 6,
    game_type = 'turn_based',
    description = 'Clássico jogo por turnos de descarte de cartas baseado em correspondência de cor, número ou símbolo com efeitos especiais surpreendentes.',
    config = coalesce(config, '{"category_label": "Turnos", "requires_timer": true, "initial_cards": 7, "cumulative_draw": true, "force_draw": true, "play_immediately": true, "turn_timer": 30}'::jsonb)
WHERE id = 'carta_duo';

-- Desativar jogos secundários ainda não implementados
UPDATE public.games
SET is_active = false
WHERE id NOT IN ('tic_tac_toe', 'carta_duo');

-- ----------------------------------------------------------------------------
-- 2. Função Auxiliar: Inicializar Estado do Carta Duo (Baralho de 108 cartas e mãos)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.initialize_carta_duo_state_for_players(
    p_player_ids UUID[],
    p_config JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_initial_cards INTEGER;
    v_raw_deck TEXT[] := ARRAY[]::TEXT[];
    v_colors TEXT[] := ARRAY['red', 'blue', 'green', 'yellow'];
    v_shuffled TEXT[];
    v_hands JSONB := '{}'::jsonb;
    v_hand_cards TEXT[];
    v_discard_pile TEXT[];
    v_card TEXT;
    v_card_parts TEXT[];
    v_active_color VARCHAR(15);
    v_active_value VARCHAR(15);
    v_direction INTEGER := 1;
    v_current_turn_player_id UUID;
    v_pending_draws INTEGER := 0;
    v_player_id UUID;
    v_card_color TEXT;
    i INTEGER;
BEGIN
    v_initial_cards := COALESCE((p_config->>'initial_cards')::INTEGER, 7);

    -- Construir baralho clássico de 108 cartas
    FOREACH v_card_color IN ARRAY v_colors LOOP
        v_raw_deck := array_append(v_raw_deck, v_card_color || ':0');
        FOR i IN 1..9 LOOP
            v_raw_deck := array_append(v_raw_deck, v_card_color || ':' || i);
            v_raw_deck := array_append(v_raw_deck, v_card_color || ':' || i);
        END LOOP;
        v_raw_deck := array_append(v_raw_deck, v_card_color || ':skip');
        v_raw_deck := array_append(v_raw_deck, v_card_color || ':skip');
        v_raw_deck := array_append(v_raw_deck, v_card_color || ':reverse');
        v_raw_deck := array_append(v_raw_deck, v_card_color || ':reverse');
        v_raw_deck := array_append(v_raw_deck, v_card_color || ':draw2');
        v_raw_deck := array_append(v_raw_deck, v_card_color || ':draw2');
    END LOOP;
    FOR i IN 1..4 LOOP
        v_raw_deck := array_append(v_raw_deck, 'wild:color');
        v_raw_deck := array_append(v_raw_deck, 'wild:draw4');
    END LOOP;

    -- Embaralhar aleatoriamente
    SELECT array_agg(card ORDER BY random()) INTO v_shuffled
    FROM unnest(v_raw_deck) AS card;

    -- Distribuir cartas para cada jogador
    IF p_player_ids IS NOT NULL THEN
        FOREACH v_player_id IN ARRAY p_player_ids LOOP
            v_hand_cards := ARRAY[]::TEXT[];
            FOR i IN 1..v_initial_cards LOOP
                IF array_length(v_shuffled, 1) > 0 THEN
                    v_hand_cards := array_append(v_hand_cards, v_shuffled[1]);
                    v_shuffled := v_shuffled[2:array_length(v_shuffled, 1)];
                END IF;
            END LOOP;
            v_hands := v_hands || jsonb_build_object(v_player_id::text, to_jsonb(v_hand_cards));
        END LOOP;
    END IF;

    -- Puxar carta inicial de descarte que não seja Wild
    WHILE array_length(v_shuffled, 1) > 0 AND v_shuffled[1] LIKE 'wild:%' LOOP
        v_shuffled := array_append(v_shuffled, v_shuffled[1]);
        v_shuffled := v_shuffled[2:array_length(v_shuffled, 1)];
    END LOOP;

    IF array_length(v_shuffled, 1) > 0 THEN
        v_card := v_shuffled[1];
        v_shuffled := v_shuffled[2:array_length(v_shuffled, 1)];
    ELSE
        v_card := 'red:0';
    END IF;

    v_card_parts := string_to_array(v_card, ':');
    v_active_color := COALESCE(v_card_parts[1], 'red');
    v_active_value := COALESCE(v_card_parts[2], '0');

    v_discard_pile := ARRAY[v_card];
    v_current_turn_player_id := p_player_ids[1];

    -- Efeito inicial da primeira carta de descarte
    IF v_active_value = 'skip' AND array_length(p_player_ids, 1) > 1 THEN
        v_current_turn_player_id := public.get_next_carta_duo_player_id(v_current_turn_player_id, p_player_ids, v_direction, 1);
    ELSIF v_active_value = 'reverse' THEN
        v_direction := -1;
        IF array_length(p_player_ids, 1) = 2 THEN
            v_current_turn_player_id := public.get_next_carta_duo_player_id(v_current_turn_player_id, p_player_ids, 1, 1);
        ELSIF array_length(p_player_ids, 1) > 2 THEN
            v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_ids[1], p_player_ids, v_direction, 0);
        END IF;
    ELSIF v_active_value = 'draw2' THEN
        v_pending_draws := 2;
    END IF;

    RETURN jsonb_build_object(
        'config', p_config,
        'deck', to_jsonb(v_shuffled),
        'discard_pile', to_jsonb(v_discard_pile),
        'hands', v_hands,
        'active_color', v_active_color,
        'active_value', v_active_value,
        'direction', v_direction,
        'turn_order', to_jsonb(p_player_ids),
        'current_turn_player_id', v_current_turn_player_id,
        'pending_draws', v_pending_draws,
        'winner_id', NULL,
        'is_finished', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_carta_duo_state_for_players(UUID[], JSONB) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. RPC: create_room
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_room(
    p_game_id VARCHAR(50),
    p_name VARCHAR(60),
    p_is_private BOOLEAN DEFAULT true,
    p_max_members INTEGER DEFAULT NULL
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
    v_norm_game_id VARCHAR(50);
    v_game RECORD;
    v_room RECORD;
    v_max_members INTEGER;
    v_default_config JSONB;
BEGIN
    -- 1. Identificar usuário chamador
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- Trava advisory por usuário para serializar operações simultâneas
    PERFORM pg_advisory_xact_lock(hashtext(v_caller_id::text));

    -- 2. Validar se o usuário possui partida realmente ativa
    IF EXISTS (
        SELECT 1 FROM public.matches m
        JOIN public.match_players mp ON mp.match_id = m.id
        WHERE mp.user_id = v_caller_id AND m.status = 'in_progress'
    ) THEN
        RAISE EXCEPTION 'PLAYER_IN_ACTIVE_MATCH: Você já possui uma partida em andamento e não pode criar uma nova sala.' USING ERRCODE = 'P0013';
    END IF;

    -- 3. Validar nome da sala
    v_clean_name := trim(p_name);
    IF char_length(v_clean_name) < 2 OR char_length(v_clean_name) > 60 THEN
        RAISE EXCEPTION 'INVALID_NAME: O nome da sala deve ter entre 2 e 60 caracteres.' USING ERRCODE = 'P0002';
    END IF;

    -- 4. Normalizar e consultar jogo no catálogo oficial
    v_norm_game_id := replace(p_game_id, '-', '_');
    SELECT * INTO v_game FROM public.games WHERE id = v_norm_game_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'GAME_NOT_FOUND: O jogo especificado não existe ou está inativo.' USING ERRCODE = 'P0003';
    END IF;

    -- 5. Limpeza de estado residual: desvincular o usuário de salas anteriores em espera
    DELETE FROM public.room_members
    WHERE user_id = v_caller_id
      AND room_id IN (SELECT id FROM public.rooms WHERE status = 'waiting');

    UPDATE public.rooms
    SET status = 'closed', updated_at = now()
    WHERE host_id = v_caller_id
      AND status = 'waiting'
      AND id NOT IN (SELECT room_id FROM public.room_members);

    -- 6. Calcular capacidade máxima de membros respeitando min e max do jogo
    IF p_max_members IS NULL THEN
        v_max_members := v_game.max_players;
    ELSE
        v_max_members := greatest(v_game.min_players, least(p_max_members, v_game.max_players));
    END IF;

    v_default_config := coalesce(v_game.config, '{}'::jsonb);

    -- 7. Gerar código único e seguro
    LOOP
        v_code := public.generate_room_code();
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.rooms WHERE code = v_code);
        v_attempts := v_attempts + 1;
        IF v_attempts > 15 THEN
            RAISE EXCEPTION 'INTERNAL_ERROR: Falha ao gerar código único de sala.' USING ERRCODE = 'P0004';
        END IF;
    END LOOP;

    -- 8. Criar sala
    INSERT INTO public.rooms (
        code,
        game_id,
        host_id,
        name,
        status,
        is_private,
        max_members,
        config,
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
        v_default_config,
        now(),
        now()
    ) RETURNING * INTO v_room;

    -- 9. Inserir Host como Slot 1 (sem símbolos específicos de jogo)
    INSERT INTO public.room_members (
        room_id,
        user_id,
        role,
        slot_number,
        is_ready,
        joined_at
    ) VALUES (
        v_room.id,
        v_caller_id,
        'player',
        1,
        true,
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'room', row_to_json(v_room),
            'member', jsonb_build_object(
                'room_id', v_room.id,
                'user_id', v_caller_id,
                'role', 'player',
                'slot_number', 1,
                'is_ready', true
            )
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_room(VARCHAR, VARCHAR, BOOLEAN, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_room(VARCHAR, VARCHAR, BOOLEAN, INTEGER) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. RPC: join_room_by_code
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
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- Trava advisory por usuário
    PERFORM pg_advisory_xact_lock(hashtext(v_caller_id::text));

    -- Validar se o usuário possui partida realmente ativa
    IF EXISTS (
        SELECT 1 FROM public.matches m
        JOIN public.match_players mp ON mp.match_id = m.id
        WHERE mp.user_id = v_caller_id AND m.status = 'in_progress'
    ) THEN
        RAISE EXCEPTION 'PLAYER_IN_ACTIVE_MATCH: Você já possui uma partida em andamento e não pode entrar em uma sala.' USING ERRCODE = 'P0013';
    END IF;

    v_clean_code := upper(trim(p_code));

    SELECT * INTO v_room 
    FROM public.rooms 
    WHERE code = v_clean_code 
    FOR UPDATE;

    IF NOT FOUND OR v_room.status = 'closed' THEN
        RAISE EXCEPTION 'ROOM_NOT_FOUND: Sala não encontrada ou encerrada.' USING ERRCODE = 'P0005';
    END IF;

    -- Idempotência: Se já for membro da sala, retorna seus dados
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

    -- Validar estado da sala
    IF v_room.status = 'starting' THEN
        RAISE EXCEPTION 'ROOM_STARTING: A sala está iniciando uma partida e não aceita novos participantes no momento.' USING ERRCODE = 'P0022';
    END IF;

    IF v_room.status = 'in_game' AND NOT coalesce(p_as_spectator, false) THEN
        RAISE EXCEPTION 'MATCH_ALREADY_IN_PROGRESS: A sala já está em partida. Apenas espectadores podem entrar.' USING ERRCODE = 'P0006';
    END IF;

    -- Verificar capacidade máxima de membros na sala
    SELECT count(*) INTO v_current_count 
    FROM public.room_members 
    WHERE room_id = v_room.id;

    IF v_current_count >= v_room.max_members THEN
        RAISE EXCEPTION 'ROOM_FULL: A sala atingiu a capacidade máxima de membros.' USING ERRCODE = 'P0007';
    END IF;

    SELECT * INTO v_game FROM public.games WHERE id = v_room.game_id;

    IF coalesce(p_as_spectator, false) THEN
        v_role := 'spectator';
        v_slot := NULL;
    ELSE
        v_role := 'player';
        SELECT s INTO v_slot
        FROM generate_series(1, v_room.max_members) s
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

REVOKE ALL ON FUNCTION public.join_room_by_code(VARCHAR, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_room_by_code(VARCHAR, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. RPC: leave_room
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
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_room 
    FROM public.rooms 
    WHERE id = p_room_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'new_host_id', null,
                'room_closed', true
            ),
            'error', null
        );
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.room_members 
        WHERE room_id = p_room_id AND user_id = v_caller_id
    ) INTO v_is_member;

    IF NOT v_is_member THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'new_host_id', v_room.host_id,
                'room_closed', (v_room.status = 'closed')
            ),
            'error', null
        );
    END IF;

    DELETE FROM public.room_members 
    WHERE room_id = p_room_id AND user_id = v_caller_id;

    IF v_room.host_id = v_caller_id THEN
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

REVOKE ALL ON FUNCTION public.leave_room(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_room(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. RPC: start_match (Agnóstica ao Jogo e com Suporte a 2-6 Jogadores)
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
    v_player_ids UUID[];
    v_initial_game_state JSONB;
    v_config JSONB;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_room 
    FROM public.rooms 
    WHERE id = p_room_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ROOM_NOT_FOUND: Sala não encontrada.' USING ERRCODE = 'P0005';
    END IF;

    IF v_room.host_id != v_caller_id THEN
        RAISE EXCEPTION 'NOT_ROOM_HOST: Apenas o anfitrião pode iniciar a partida.' USING ERRCODE = 'P0010';
    END IF;

    -- Idempotência
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

    IF v_room.status != 'waiting' THEN
        RAISE EXCEPTION 'INVALID_ROOM_STATUS: A sala não está em estado de espera.' USING ERRCODE = 'P0011';
    END IF;

    -- Consultar jogo no catálogo
    SELECT * INTO v_game FROM public.games WHERE id = v_room.game_id;
    IF NOT FOUND OR v_game.is_active = false THEN
        RAISE EXCEPTION 'GAME_NOT_FOUND: O jogo desta sala não está ativo.' USING ERRCODE = 'P0003';
    END IF;

    -- Contagem de jogadores
    SELECT count(*) INTO v_player_count 
    FROM public.room_members 
    WHERE room_id = p_room_id AND role = 'player';

    IF v_player_count < v_game.min_players THEN
        RAISE EXCEPTION 'INSUFFICIENT_PLAYERS: Quantidade de jogadores insuficiente (mínimo exigido: %).', v_game.min_players USING ERRCODE = 'P0012';
    END IF;

    IF v_player_count > v_game.max_players THEN
        RAISE EXCEPTION 'TOO_MANY_PLAYERS: Quantidade de jogadores excede o limite máximo (máximo: %).', v_game.max_players USING ERRCODE = 'P0013';
    END IF;

    -- Validar prontidão de todos os jogadores
    SELECT count(*) INTO v_unready_count 
    FROM public.room_members 
    WHERE room_id = p_room_id AND role = 'player' AND is_ready = false;

    IF v_unready_count > 0 THEN
        RAISE EXCEPTION 'PLAYERS_NOT_READY: Nem todos os jogadores confirmaram prontidão.' USING ERRCODE = 'P0014';
    END IF;

    -- Lista de IDs de jogadores ordenada por slot
    SELECT array_agg(user_id ORDER BY slot_number ASC) INTO v_player_ids
    FROM public.room_members
    WHERE room_id = p_room_id AND role = 'player';

    v_slot1_user_id := v_player_ids[1];
    v_match_id := gen_random_uuid();
    v_config := coalesce(v_room.config, v_game.config, '{}'::jsonb);

    -- Inicializar estado do jogo de forma determinística
    IF v_game.id = 'carta_duo' THEN
        v_initial_game_state := public.initialize_carta_duo_state_for_players(v_player_ids, v_config);
        v_slot1_user_id := (v_initial_game_state->>'current_turn_player_id')::uuid;
    ELSE
        v_initial_game_state := jsonb_build_object('config', v_config);
    END IF;

    -- Criar registro oficial em public.matches
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
        config,
        created_at,
        started_at
    ) VALUES (
        v_match_id,
        p_room_id,
        v_game.id,
        'in_progress',
        v_slot1_user_id,
        now() + (COALESCE((v_config->>'turn_timer')::INTEGER, 30) || ' seconds')::INTERVAL,
        1,
        v_initial_game_state,
        '[]'::jsonb,
        v_config,
        now(),
        now()
    ) RETURNING * INTO v_match;

    -- Criar participantes oficiais (match_players) de forma genérica
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
            NULL, -- Genérico: sem X ou O no core
            0,
            false,
            now()
        );
    END LOOP;

    UPDATE public.rooms 
    SET status = 'in_game', current_match_id = v_match_id, updated_at = now()
    WHERE id = p_room_id;

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

REVOKE ALL ON FUNCTION public.start_match(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_match(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. RPC: join_matchmaking_queue (Multi-Jogos, 2 a 6 Jogadores, Isolamento Absoluto)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_matchmaking_queue(
    p_game_id VARCHAR(50)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_active_match_id UUID;
    v_norm_game_id VARCHAR(50);
    v_game RECORD;
    v_my_entry public.matchmaking_queue%ROWTYPE;
    v_opponent_queue_ids UUID[];
    v_opponent_user_ids UUID[];
    v_opponents_count INTEGER;
    v_total_players INTEGER;
    v_all_user_ids UUID[];
    v_new_match_id UUID;
    v_first_player_id UUID;
    v_initial_game_state JSONB;
    v_config JSONB;
    i INTEGER;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- Trava advisory por usuário para serializar requisições concorrentes
    PERFORM pg_advisory_xact_lock(hashtext(v_caller_id::text));

    -- 1. Normalizar e validar jogo ativo no catálogo public.games
    v_norm_game_id := replace(p_game_id, '-', '_');
    SELECT * INTO v_game FROM public.games WHERE id = v_norm_game_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'GAME_NOT_ACTIVE: O jogo especificado não existe ou não possui matchmaking público ativo.' USING ERRCODE = 'P0015';
    END IF;

    -- 2. Reconciliar entrada existente do próprio chamador
    v_my_entry := public.reconcile_user_matchmaking_queue(v_caller_id);

    -- 3. Se o chamador já possuir uma entrada 'matched' válida com partida em andamento
    IF v_my_entry.id IS NOT NULL AND v_my_entry.status = 'matched' AND v_my_entry.match_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'queue_id', v_my_entry.id,
                'game_id', v_my_entry.game_id,
                'status', 'matched',
                'match_id', v_my_entry.match_id,
                'expires_at', v_my_entry.expires_at
            ),
            'error', null
        );
    END IF;

    -- 4. Validar se o usuário não está em uma partida ativa por fora da fila
    SELECT m.id INTO v_active_match_id
    FROM public.matches m
    JOIN public.match_players mp ON mp.match_id = m.id
    WHERE mp.user_id = v_caller_id
      AND m.status = 'in_progress'
    LIMIT 1;

    IF v_active_match_id IS NOT NULL THEN
        RAISE EXCEPTION 'PLAYER_IN_ACTIVE_MATCH: Você já está em uma partida em andamento.' USING ERRCODE = 'P0013';
    END IF;

    -- 5. Tratamento de Troca de Jogo: se o usuário já estava em 'waiting' em outro jogo, cancela a fila anterior
    IF v_my_entry.id IS NOT NULL AND v_my_entry.status = 'waiting' THEN
        IF v_my_entry.game_id <> v_game.id THEN
            UPDATE public.matchmaking_queue
            SET status = 'cancelled', updated_at = clock_timestamp()
            WHERE id = v_my_entry.id;
            v_my_entry := NULL;
        END IF;
    END IF;

    -- 6. Buscar oponentes elegíveis na mesma fila (mesmo game_id isolado)
    -- Trava concorrente via FOR UPDATE SKIP LOCKED
    SELECT 
        coalesce(array_agg(id), ARRAY[]::uuid[]),
        coalesce(array_agg(user_id), ARRAY[]::uuid[])
    INTO v_opponent_queue_ids, v_opponent_user_ids
    FROM (
        SELECT id, user_id
        FROM public.matchmaking_queue
        WHERE game_id = v_game.id
          AND status = 'waiting'
          AND user_id != v_caller_id
          AND clock_timestamp() < expires_at
        ORDER BY created_at ASC
        LIMIT (v_game.max_players - 1)
        FOR UPDATE SKIP LOCKED
    ) sub;

    v_opponents_count := coalesce(cardinality(v_opponent_user_ids), 0);
    v_total_players := v_opponents_count + 1;

    -- 7. Se houver oponentes suficientes para atingir o mínimo exigido pelo jogo: FORMAR PARTIDA!
    IF v_total_players >= v_game.min_players THEN
        v_new_match_id := gen_random_uuid();
        v_all_user_ids := array_append(v_opponent_user_ids, v_caller_id);
        v_first_player_id := v_all_user_ids[1];
        v_config := coalesce(v_game.config, '{}'::jsonb);

        IF v_game.id = 'carta_duo' THEN
            v_initial_game_state := public.initialize_carta_duo_state_for_players(v_all_user_ids, v_config);
            v_first_player_id := (v_initial_game_state->>'current_turn_player_id')::uuid;
        ELSE
            v_initial_game_state := jsonb_build_object('config', v_config);
        END IF;

        -- Inserir partida autoritativa
        INSERT INTO public.matches (
            id, room_id, game_id, status, current_turn_player_id,
            turn_deadline, turn_number, game_state, action_history, config, created_at, started_at
        ) VALUES (
            v_new_match_id, NULL, v_game.id, 'in_progress', v_first_player_id,
            clock_timestamp() + (COALESCE((v_config->>'turn_timer')::INTEGER, 30) || ' seconds')::INTERVAL,
            1, v_initial_game_state, '[]'::jsonb, v_config,
            clock_timestamp(), clock_timestamp()
        );

        -- Inserir participantes genéricos (slot 1..N, sem símbolos X/O hardcoded)
        FOR i IN 1..cardinality(v_all_user_ids) LOOP
            INSERT INTO public.match_players (
                match_id, user_id, slot, game_symbol, score, is_winner, joined_at
            ) VALUES (
                v_new_match_id, v_all_user_ids[i], i, NULL, 0, false, clock_timestamp()
            );
        END LOOP;

        -- Atualizar status dos oponentes para 'matched'
        UPDATE public.matchmaking_queue
        SET status = 'matched', match_id = v_new_match_id, updated_at = clock_timestamp()
        WHERE id = ANY(v_opponent_queue_ids);

        -- Atualizar ou inserir entrada do chamador como 'matched'
        IF v_my_entry.id IS NOT NULL THEN
            UPDATE public.matchmaking_queue
            SET status = 'matched', match_id = v_new_match_id, updated_at = clock_timestamp()
            WHERE id = v_my_entry.id
            RETURNING * INTO v_my_entry;
        ELSE
            INSERT INTO public.matchmaking_queue (
                user_id, game_id, status, match_id, expires_at
            ) VALUES (
                v_caller_id, v_game.id, 'matched', v_new_match_id, clock_timestamp() + INTERVAL '5 minutes'
            )
            ON CONFLICT (user_id) WHERE status IN ('waiting', 'matched')
            DO UPDATE SET status = 'matched', match_id = v_new_match_id, updated_at = clock_timestamp()
            RETURNING * INTO v_my_entry;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'queue_id', v_my_entry.id,
                'game_id', v_game.id,
                'status', 'matched',
                'match_id', v_new_match_id,
                'expires_at', v_my_entry.expires_at
            ),
            'error', null
        );

    ELSE
        -- 8. Menos jogadores que o mínimo: permanecer ou entrar em 'waiting'
        IF v_my_entry.id IS NOT NULL AND v_my_entry.status = 'waiting' THEN
            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'queue_id', v_my_entry.id,
                    'game_id', v_my_entry.game_id,
                    'status', 'waiting',
                    'match_id', null,
                    'expires_at', v_my_entry.expires_at
                ),
                'error', null
            );
        ELSE
            INSERT INTO public.matchmaking_queue (
                user_id, game_id, status, expires_at
            ) VALUES (
                v_caller_id, v_game.id, 'waiting', clock_timestamp() + INTERVAL '5 minutes'
            )
            ON CONFLICT (user_id) WHERE status IN ('waiting', 'matched')
            DO UPDATE SET game_id = EXCLUDED.game_id, status = 'waiting', match_id = NULL, expires_at = EXCLUDED.expires_at, updated_at = clock_timestamp()
            RETURNING * INTO v_my_entry;

            RETURN jsonb_build_object(
                'success', true,
                'data', jsonb_build_object(
                    'queue_id', v_my_entry.id,
                    'game_id', v_my_entry.game_id,
                    'status', 'waiting',
                    'match_id', null,
                    'expires_at', v_my_entry.expires_at
                ),
                'error', null
            );
        END IF;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.join_matchmaking_queue(VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_matchmaking_queue(VARCHAR) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. RPC: cancel_matchmaking_queue
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_matchmaking_queue()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_entry public.matchmaking_queue%ROWTYPE;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_caller_id::text));

    v_entry := public.reconcile_user_matchmaking_queue(v_caller_id);

    IF v_entry.id IS NULL OR v_entry.status NOT IN ('waiting', 'matched') THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'status', 'cancelled',
                'match_id', null
            ),
            'error', null
        );
    END IF;

    IF v_entry.status = 'matched' AND v_entry.match_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'status', 'matched',
                'match_id', v_entry.match_id
            ),
            'error', null
        );
    END IF;

    IF v_entry.status = 'waiting' THEN
        UPDATE public.matchmaking_queue
        SET status = 'cancelled', updated_at = clock_timestamp()
        WHERE id = v_entry.id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'status', 'cancelled',
            'match_id', null
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_matchmaking_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_matchmaking_queue() TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. RPC: get_my_matchmaking_status
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_matchmaking_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_entry public.matchmaking_queue%ROWTYPE;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'data', null, 'error', null);
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_caller_id::text));

    v_entry := public.reconcile_user_matchmaking_queue(v_caller_id);

    IF v_entry.id IS NULL OR v_entry.status NOT IN ('waiting', 'matched') THEN
        RETURN jsonb_build_object('success', true, 'data', null, 'error', null);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'queue_id', v_entry.id,
            'game_id', v_entry.game_id,
            'status', v_entry.status,
            'match_id', v_entry.match_id,
            'expires_at', v_entry.expires_at,
            'created_at', v_entry.created_at
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_matchmaking_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_matchmaking_status() TO authenticated;

-- ----------------------------------------------------------------------------
-- 10. Validador Oficial do Carta Duo (validate_carta_duo_action)
--     Garante conformidade com o envelope 'accepted': true esperado por submit_game_action
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_carta_duo_action(
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
    v_config JSONB;
    v_initial_cards INTEGER := 7;
    v_cumulative_draw BOOLEAN := true;
    v_force_draw BOOLEAN := true;
    v_play_immediately BOOLEAN := true;
    v_turn_timer INTEGER := 30;

    v_deck TEXT[];
    v_discard_pile TEXT[];
    v_hands JSONB;
    v_active_color VARCHAR(15);
    v_active_value VARCHAR(15);
    v_direction INTEGER := 1;
    v_turn_order UUID[];
    v_current_turn_player_id UUID;
    v_pending_draws INTEGER := 0;
    v_winner_id UUID := NULL;
    v_is_finished BOOLEAN := false;

    v_card TEXT;
    v_choose_color VARCHAR(15);
    v_card_parts TEXT[];
    v_card_color VARCHAR(15);
    v_card_value VARCHAR(15);
    v_steps INTEGER := 1;
    v_has_playable BOOLEAN;
    v_new_state JSONB;
    v_player_id UUID;
    v_draw_card TEXT;
    v_hand_cards TEXT[];
BEGIN
    -- 1. Obter configurações da partida
    IF p_current_state ? 'config' THEN
        v_config := p_current_state->'config';
    ELSE
        SELECT coalesce(m.config, r.config, '{}'::jsonb) INTO v_config
        FROM public.matches m
        LEFT JOIN public.rooms r ON r.id = m.room_id
        WHERE m.id = p_match_id;
    END IF;

    v_config := coalesce(v_config, '{}'::jsonb);
    v_initial_cards := COALESCE((v_config->>'initial_cards')::INTEGER, 7);
    v_cumulative_draw := COALESCE((v_config->>'cumulative_draw')::BOOLEAN, true);
    v_force_draw := COALESCE((v_config->>'force_draw')::BOOLEAN, true);
    v_play_immediately := COALESCE((v_config->>'play_immediately')::BOOLEAN, true);
    v_turn_timer := COALESCE((v_config->>'turn_timer')::INTEGER, 30);

    IF p_action_type = 'update_config' THEN
        RAISE EXCEPTION 'FORBIDDEN: Não é permitido alterar as configurações oficiais após o início da partida.' USING ERRCODE = 'P0071';
    END IF;

    -- 2. Montar lista de competidores (slots 1 a 6)
    SELECT array_agg(user_id ORDER BY slot ASC) INTO v_turn_order
    FROM public.match_players
    WHERE match_id = p_match_id;

    -- 3. Reidratar ou Inicializar Estado
    IF p_current_state IS NULL OR NOT (p_current_state ? 'deck') THEN
        v_new_state := public.initialize_carta_duo_state_for_players(v_turn_order, v_config);
        v_deck := ARRAY(SELECT jsonb_array_elements_text(v_new_state->'deck'));
        v_discard_pile := ARRAY(SELECT jsonb_array_elements_text(v_new_state->'discard_pile'));
        v_hands := v_new_state->'hands';
        v_active_color := v_new_state->>'active_color';
        v_active_value := v_new_state->>'active_value';
        v_direction := (v_new_state->>'direction')::INTEGER;
        v_current_turn_player_id := (v_new_state->>'current_turn_player_id')::UUID;
        v_pending_draws := (v_new_state->>'pending_draws')::INTEGER;
        v_winner_id := NULL;
        v_is_finished := false;
    ELSE
        v_deck := ARRAY(SELECT jsonb_array_elements_text(p_current_state->'deck'));
        v_discard_pile := ARRAY(SELECT jsonb_array_elements_text(p_current_state->'discard_pile'));
        v_hands := p_current_state->'hands';
        v_active_color := p_current_state->>'active_color';
        v_active_value := p_current_state->>'active_value';
        v_direction := COALESCE((p_current_state->>'direction')::INTEGER, 1);
        v_current_turn_player_id := (p_current_state->>'current_turn_player_id')::UUID;
        v_pending_draws := COALESCE((p_current_state->>'pending_draws')::INTEGER, 0);
        v_winner_id := (p_current_state->>'winner_id')::UUID;
        v_is_finished := COALESCE((p_current_state->>'is_finished')::BOOLEAN, false);
    END IF;

    -- Se o jogo já acabou
    IF v_is_finished THEN
        RAISE EXCEPTION 'MATCH_FINISHED: A partida já foi encerrada.' USING ERRCODE = 'P0017';
    END IF;

    -- Validar turno do jogador
    IF p_player_id <> v_current_turn_player_id THEN
        RAISE EXCEPTION 'NOT_YOUR_TURN: Não é o seu turno de jogar.' USING ERRCODE = 'P0019';
    END IF;

    -- 4. Processamento de Ações
    IF p_action_type = 'play_card' THEN
        v_card := p_payload->>'card';
        IF v_card IS NULL THEN
            RAISE EXCEPTION 'INVALID_PAYLOAD: Campo card é obrigatório.' USING ERRCODE = 'P0072';
        END IF;

        IF NOT (v_hands->(p_player_id::text) @> to_jsonb(v_card)) THEN
            RAISE EXCEPTION 'CARD_NOT_IN_HAND: A carta informada não está na mão do jogador.' USING ERRCODE = 'P0073';
        END IF;

        v_card_parts := string_to_array(v_card, ':');
        v_card_color := v_card_parts[1];
        v_card_value := v_card_parts[2];

        -- Validar regra de compra acumulada pendente
        IF v_pending_draws > 0 THEN
            IF v_cumulative_draw THEN
                IF v_card_value NOT IN ('draw2', 'draw4') THEN
                    RAISE EXCEPTION 'MUST_DEFEND_OR_DRAW: Você possui compras acumuladas pendentes e deve jogar uma carta de compra (+2/+4) ou comprar.' USING ERRCODE = 'P0074';
                END IF;
            ELSE
                RAISE EXCEPTION 'MUST_DRAW_PENDING: Você deve comprar as cartas pendentes antes de jogar.' USING ERRCODE = 'P0074';
            END IF;
        END IF;

        -- Compatibilidade de descarte
        IF v_card_color <> 'wild' THEN
            IF v_card_color <> v_active_color AND v_card_value <> v_active_value THEN
                RAISE EXCEPTION 'INVALID_CARD: A carta jogada não corresponde à cor ativa ou ao valor ativo.' USING ERRCODE = 'P0075';
            END IF;
        END IF;

        -- Remover da mão
        SELECT COALESCE(array_agg(c), ARRAY[]::TEXT[]) INTO v_hand_cards
        FROM (
            SELECT c, row_number() OVER () AS rn
            FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c
        ) sub
        WHERE NOT (c = v_card AND rn = (
            SELECT min(rn) FROM (
                SELECT c2, row_number() OVER () AS rn 
                FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c2
            ) s2 WHERE c2 = v_card
        ));

        v_hands := v_hands || jsonb_build_object(p_player_id::text, to_jsonb(COALESCE(v_hand_cards, ARRAY[]::TEXT[])));

        -- Checar vitória
        IF jsonb_array_length(v_hands->(p_player_id::text)) = 0 THEN
            v_winner_id := p_player_id;
            v_is_finished := true;
        END IF;

        -- Colocar no topo do descarte
        v_discard_pile := array_prepend(v_card, v_discard_pile);

        v_active_value := v_card_value;
        IF v_card_color = 'wild' THEN
            v_choose_color := p_payload->>'choose_color';
            IF v_choose_color NOT IN ('red', 'blue', 'green', 'yellow') THEN
                RAISE EXCEPTION 'INVALID_COLOR: Cor escolhida para Wild é inválida.' USING ERRCODE = 'P0076';
            END IF;
            v_active_color := v_choose_color;
        ELSE
            v_active_color := v_card_color;
        END IF;

        -- Efeitos especiais
        v_steps := 1;
        IF v_card_value = 'skip' THEN
            v_steps := 2;
        ELSIF v_card_value = 'reverse' THEN
            v_direction := v_direction * -1;
            IF array_length(v_turn_order, 1) = 2 THEN
                v_steps := 2;
            END IF;
        ELSIF v_card_value = 'draw2' THEN
            v_pending_draws := v_pending_draws + 2;
        ELSIF v_card_value = 'draw4' THEN
            v_pending_draws := v_pending_draws + 4;
        END IF;

        v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, v_steps);

    ELSIF p_action_type = 'draw_card' THEN
        -- Comprar cartas
        DECLARE
            v_cards_to_draw INTEGER := GREATEST(1, v_pending_draws);
            v_drawn_list TEXT[] := ARRAY[]::TEXT[];
        BEGIN
            v_pending_draws := 0;

            FOR i IN 1..v_cards_to_draw LOOP
                IF array_length(v_deck, 1) IS NULL OR array_length(v_deck, 1) = 0 THEN
                    DECLARE
                        v_top_discard TEXT := v_discard_pile[1];
                        v_rest_discard TEXT[] := v_discard_pile[2:array_length(v_discard_pile, 1)];
                    BEGIN
                        SELECT array_agg(card ORDER BY random()) INTO v_deck
                        FROM unnest(COALESCE(v_rest_discard, ARRAY[]::TEXT[])) AS card;
                        v_discard_pile := ARRAY[v_top_discard];
                    END;
                END IF;

                IF array_length(v_deck, 1) > 0 THEN
                    v_draw_card := v_deck[1];
                    v_deck := v_deck[2:array_length(v_deck, 1)];
                    v_drawn_list := array_append(v_drawn_list, v_draw_card);
                END IF;
            END LOOP;

            SELECT COALESCE(array_agg(c), ARRAY[]::TEXT[]) INTO v_hand_cards
            FROM jsonb_array_elements_text(v_hands->(p_player_id::text)) AS c;

            v_hand_cards := v_hand_cards || v_drawn_list;
            v_hands := v_hands || jsonb_build_object(p_player_id::text, to_jsonb(v_hand_cards));
        END;

        v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);

    ELSIF p_action_type = 'pass_turn' OR p_action_type = 'end_turn' THEN
        v_current_turn_player_id := public.get_next_carta_duo_player_id(p_player_id, v_turn_order, v_direction, 1);

    ELSE
        RAISE EXCEPTION 'INVALID_ACTION_TYPE: Tipo de ação desconhecido: %', p_action_type USING ERRCODE = 'P0078';
    END IF;

    -- Atualizar placar (contagem de cartas na mão)
    FOREACH v_player_id IN ARRAY v_turn_order LOOP
        UPDATE public.match_players
        SET score = jsonb_array_length(v_hands->(v_player_id::text))
        WHERE match_id = p_match_id AND user_id = v_player_id;
    END LOOP;

    v_new_state := jsonb_build_object(
        'deck', to_jsonb(COALESCE(v_deck, ARRAY[]::TEXT[])),
        'discard_pile', to_jsonb(COALESCE(v_discard_pile, ARRAY[]::TEXT[])),
        'hands', v_hands,
        'active_color', v_active_color,
        'active_value', v_active_value,
        'direction', v_direction,
        'turn_order', to_jsonb(v_turn_order),
        'current_turn_player_id', v_current_turn_player_id,
        'pending_draws', v_pending_draws,
        'winner_id', v_winner_id,
        'is_finished', v_is_finished,
        'config', v_config
    );

    RETURN jsonb_build_object(
        'accepted', true,
        'new_state', v_new_state,
        'next_player_id', v_current_turn_player_id,
        'winner_id', v_winner_id,
        'is_draw', false,
        'is_finished', v_is_finished
    );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_carta_duo_action(UUID, UUID, VARCHAR, JSONB, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 11. RPC: respond_to_rematch (Compatibilidade Oficial com Colunas slot e game_state)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_to_rematch(
    p_rematch_request_id UUID,
    p_accept BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_req RECORD;
    v_slot1_user_id UUID;
    v_slot2_user_id UUID;
    v_new_match_id UUID;
    v_req_last_seen TIMESTAMPTZ;
    v_req_conn_status VARCHAR(20);
    v_caller_name VARCHAR(255);
    v_game RECORD;
    v_initial_game_state JSONB;
    v_config JSONB;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_req
    FROM public.rematch_requests
    WHERE id = p_rematch_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REMATCH_NOT_FOUND: Pedido de revanche não encontrado.' USING ERRCODE = 'P0016';
    END IF;

    IF v_req.requester_id = v_caller_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED: O solicitante não pode aceitar seu próprio pedido de revanche.' USING ERRCODE = 'P0001';
    END IF;

    IF v_req.opponent_id != v_caller_id THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Você não é o destinatário deste pedido de revanche.' USING ERRCODE = 'P0001';
    END IF;

    IF v_req.status = 'accepted' AND v_req.new_match_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'status', 'accepted',
                'rematch_request_id', v_req.id,
                'new_match_id', v_req.new_match_id,
                'original_match_id', v_req.original_match_id
            ),
            'error', null
        );
    END IF;

    IF v_req.status = 'declined' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'O pedido de revanche foi recusado.',
            'code', 'REMATCH_DECLINED'
        );
    END IF;

    IF v_req.status = 'expired' OR clock_timestamp() > v_req.expires_at THEN
        UPDATE public.rematch_requests
        SET status = 'expired', updated_at = clock_timestamp()
        WHERE id = v_req.id;

        RETURN jsonb_build_object(
            'success', false,
            'error', 'O pedido de revanche expirou.',
            'code', 'REMATCH_EXPIRED'
        );
    END IF;

    SELECT coalesce(display_name, username, 'Oponente') INTO v_caller_name
    FROM public.profiles WHERE id = v_caller_id;

    IF p_accept IS FALSE THEN
        UPDATE public.rematch_requests
        SET status = 'declined', updated_at = clock_timestamp()
        WHERE id = v_req.id;

        PERFORM public.create_notification_internal(
            v_req.requester_id,
            'rematch_declined',
            v_caller_id,
            'Revanche Recusada',
            v_caller_name || ' recusou o pedido de revanche.',
            jsonb_build_object(
                'rematch_id', v_req.id,
                'original_match_id', v_req.original_match_id,
                'actor_id', v_caller_id
            ),
            'rematch_declined:' || v_req.id
        );

        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'status', 'declined',
                'rematch_request_id', v_req.id,
                'original_match_id', v_req.original_match_id
            ),
            'error', null
        );
    END IF;

    -- Validar presença do solicitante
    SELECT last_seen_at, connection_status INTO v_req_last_seen, v_req_conn_status
    FROM public.match_players
    WHERE match_id = v_req.original_match_id AND user_id = v_req.requester_id;

    IF v_req_conn_status = 'disconnected' OR (v_req_last_seen IS NOT NULL AND v_req_last_seen < (clock_timestamp() - INTERVAL '20 seconds')) THEN
        UPDATE public.rematch_requests
        SET status = 'expired', updated_at = clock_timestamp()
        WHERE id = v_req.id;

        RETURN jsonb_build_object(
            'success', false,
            'error', 'O solicitante da revanche se desconectou.',
            'code', 'REQUESTER_DISCONNECTED'
        );
    END IF;

    -- Aceite da Revanche: Inverter slots para alternância justa
    v_slot1_user_id := v_req.opponent_id;
    v_slot2_user_id := v_req.requester_id;
    v_new_match_id := gen_random_uuid();

    SELECT * INTO v_game FROM public.games WHERE id = v_req.game_id;
    v_config := coalesce(v_game.config, '{}'::jsonb);

    IF v_req.game_id = 'carta_duo' THEN
        v_initial_game_state := public.initialize_carta_duo_state_for_players(ARRAY[v_slot1_user_id, v_slot2_user_id], v_config);
    ELSE
        v_initial_game_state := jsonb_build_object('config', v_config);
    END IF;

    INSERT INTO public.matches (
        id,
        game_id,
        room_id,
        status,
        current_turn_player_id,
        turn_number,
        game_state,
        action_history,
        config,
        created_at,
        started_at
    ) VALUES (
        v_new_match_id,
        v_req.game_id,
        v_req.room_id,
        'in_progress',
        v_slot1_user_id,
        1,
        v_initial_game_state,
        '[]'::jsonb,
        v_config,
        clock_timestamp(),
        clock_timestamp()
    );

    INSERT INTO public.match_players (match_id, user_id, slot, game_symbol, score, is_winner, joined_at)
    VALUES
        (v_new_match_id, v_slot1_user_id, 1, NULL, 0, false, clock_timestamp()),
        (v_new_match_id, v_slot2_user_id, 2, NULL, 0, false, clock_timestamp());

    UPDATE public.rematch_requests
    SET status = 'accepted',
        new_match_id = v_new_match_id,
        updated_at = clock_timestamp()
    WHERE id = v_req.id;

    IF v_req.room_id IS NOT NULL THEN
        UPDATE public.rooms
        SET status = 'in_game',
            current_match_id = v_new_match_id,
            updated_at = clock_timestamp()
        WHERE id = v_req.room_id;
    END IF;

    PERFORM public.create_notification_internal(
        v_req.requester_id,
        'rematch_accepted',
        v_caller_id,
        'Revanche Aceita!',
        v_caller_name || ' aceitou a revanche. Nova partida iniciada!',
        jsonb_build_object(
            'rematch_id', v_req.id,
            'original_match_id', v_req.original_match_id,
            'match_id', v_new_match_id,
            'actor_id', v_caller_id
        ),
        'rematch_accepted:' || v_req.id
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'status', 'accepted',
            'rematch_request_id', v_req.id,
            'new_match_id', v_new_match_id,
            'original_match_id', v_req.original_match_id
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_rematch(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_rematch(UUID, BOOLEAN) TO authenticated;
