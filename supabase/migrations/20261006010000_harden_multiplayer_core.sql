-- ============================================================================
-- Migration: 20261006010000_harden_multiplayer_core.sql
-- Project: DuoPlay-Online
-- Phase: Fase 3 — Correção e Hardening do Backend Multiplayer
-- Description: Endurecimento de segurança das RPCs multiplayer, prevenção de
--              declaração arbitrária de resultados por clientes, rotação
--              determinística de turnos para 1/2/3+ jogadores, validação estrita
--              de status de salas, e blindagem de perfis contra bypass de ID/created_at.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Hardening do Trigger de Integridade dos Perfis (public.profiles)
-- ----------------------------------------------------------------------------
-- Garante que 'id' e 'created_at' permaneçam 100% imutáveis, inclusive sob
-- operações autorizadas do sistema ('duoplay.internal_system_operation').
CREATE OR REPLACE FUNCTION public.enforce_profile_update_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- 1. Impedir modificação de ID SEMPRE (inclusive em operações internas)
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Não é permitido alterar o ID do perfil.';
    END IF;

    -- 2. Impedir modificação manual de created_at SEMPRE (inclusive em operações internas)
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Não é permitido alterar a data de criação (created_at).';
    END IF;

    -- 3. Se a operação for explicitamente autorizada pelo servidor em transação oficial (ex: finish_match)
    IF current_setting('duoplay.internal_system_operation', true) = 'true' THEN
        NEW.updated_at := now();
        RETURN NEW;
    END IF;

    -- 4. Blindagem de Estatísticas Oficiais contra alteração direta pelo cliente
    IF (NEW.total_matches IS DISTINCT FROM OLD.total_matches) OR
       (NEW.total_wins IS DISTINCT FROM OLD.total_wins) OR
       (NEW.total_draws IS DISTINCT FROM OLD.total_draws) OR
       (NEW.total_losses IS DISTINCT FROM OLD.total_losses) THEN
        RAISE EXCEPTION 'Estatísticas oficiais de partidas não podem ser alteradas diretamente pelo usuário.';
    END IF;

    -- 5. Garantir que updated_at seja sempre atribuído com o horário oficial do servidor
    NEW.updated_at := now();

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_profile_update_integrity() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Hardening do Despachador de Ações (dispatch_game_action)
-- ----------------------------------------------------------------------------
-- Rotação de turnos determinística para qualquer número de competidores (1, 2, 3+ jogadores)
-- Slot N -> Próximo Slot disponível em ordem ascendente -> Retorno circular ao menor Slot.
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
    v_current_slot INTEGER;
    v_next_player_id UUID;
    v_new_state JSONB;
BEGIN
    -- 1. Obter o slot do jogador atual
    SELECT slot INTO v_current_slot
    FROM public.match_players
    WHERE match_id = p_match_id AND user_id = p_player_id;

    -- 2. Rotação determinística: Buscar próximo jogador com slot maior
    SELECT user_id INTO v_next_player_id
    FROM public.match_players
    WHERE match_id = p_match_id AND slot > coalesce(v_current_slot, 0)
    ORDER BY slot ASC
    LIMIT 1;

    -- 3. Se não houver slot maior, faz o wrap-around para o menor slot da partida
    IF v_next_player_id IS NULL THEN
        SELECT user_id INTO v_next_player_id
        FROM public.match_players
        WHERE match_id = p_match_id
        ORDER BY slot ASC
        LIMIT 1;
    END IF;

    -- 4. Na Fase 3 a infraestrutura registra o payload no estado de forma agnóstica.
    -- O validador de regras específicas do Jogo da Velha será integrado na Fase 6.
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
-- 3. Hardening da RPC join_room_by_code
-- ----------------------------------------------------------------------------
-- Validação estrita dos estados da sala:
-- - 'closed': Rejeitado.
-- - 'starting': Rejeitado para novos jogadores (evita corrida na composição).
-- - 'in_game': Jogadores bloqueados (composição congelada); apenas espectadores permitidos.
-- - 'waiting': Jogadores e espectadores permitidos conforme vagas e slots.
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

    -- 5. Validar estado da sala para novas entradas
    IF v_room.status = 'starting' THEN
        RAISE EXCEPTION 'ROOM_STARTING: A sala está iniciando uma partida e não aceita novos participantes no momento.' USING ERRCODE = 'P0022';
    END IF;

    IF v_room.status = 'in_game' AND NOT coalesce(p_as_spectator, false) THEN
        RAISE EXCEPTION 'MATCH_ALREADY_IN_PROGRESS: A sala já está em partida. Apenas espectadores podem entrar.' USING ERRCODE = 'P0006';
    END IF;

    -- 6. Verificar capacidade máxima de membros na sala
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
-- 4. Hardening da RPC set_member_ready
-- ----------------------------------------------------------------------------
-- Restrições endurecidas:
-- - Sala DEVE estar em status 'waiting' (bloqueado em starting, in_game ou closed).
-- - Apenas membros com role = 'player' podem ficar ready (espectadores rejeitados).
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
    v_room RECORD;
    v_member RECORD;
BEGIN
    -- 1. Identificar usuário chamador
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Validar estado da sala
    SELECT * INTO v_room 
    FROM public.rooms 
    WHERE id = p_room_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ROOM_NOT_FOUND: Sala não encontrada.' USING ERRCODE = 'P0005';
    END IF;

    IF v_room.status != 'waiting' THEN
        RAISE EXCEPTION 'INVALID_ROOM_STATUS: A alteração de prontidão só é permitida quando a sala está em espera (waiting).' USING ERRCODE = 'P0023';
    END IF;

    -- 3. Localizar membership do chamador nesta sala
    SELECT * INTO v_member 
    FROM public.room_members 
    WHERE room_id = p_room_id AND user_id = v_caller_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_IN_ROOM: O usuário não é membro desta sala.' USING ERRCODE = 'P0009';
    END IF;

    -- 4. Validar papel: Espectadores não participam do ciclo de ready
    IF v_member.role != 'player' THEN
        RAISE EXCEPTION 'SPECTATOR_CANNOT_READY: Apenas jogadores podem confirmar prontidão (ready).' USING ERRCODE = 'P0024';
    END IF;

    -- 5. Atualizar prontidão de forma idempotente
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
-- 5. Hardening da RPC start_match
-- ----------------------------------------------------------------------------
-- Desacoplamento da infraestrutura:
-- - Símbolos de jogo (game_symbol) definidos como NULL (X/O pertencem à camada do Jogo da Velha na Fase 6).
-- - Somente membros 'player' entram em match_players; espectadores são ignorados na partida.
-- - Composição de jogadores congelada em match_players.
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

    -- 6. Obter regras do jogo e validar participantes com role = 'player'
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

    -- 7. Verificar prontidão de todos os jogadores (role = 'player')
    SELECT count(*) INTO v_unready_count 
    FROM public.room_members 
    WHERE room_id = p_room_id AND role = 'player' AND is_ready = false;

    IF v_unready_count > 0 THEN
        RAISE EXCEPTION 'PLAYERS_NOT_READY: Nem todos os jogadores confirmaram prontidão.' USING ERRCODE = 'P0014';
    END IF;

    -- 8. Identificar jogador do menor slot para o primeiro turno
    SELECT user_id INTO v_slot1_user_id
    FROM public.room_members
    WHERE room_id = p_room_id AND role = 'player'
    ORDER BY slot_number ASC
    LIMIT 1;

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

    -- 10. Congelar composição de jogadores em match_players (game_symbol neutro na infraestrutura)
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
            NULL, -- game_symbol será atribuído na camada de jogo específica (Fase 6)
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
-- 6. Hardening da RPC finish_match
-- ----------------------------------------------------------------------------
-- Blindagem contra manipulação de resultados pelo cliente:
-- - 'normal': Rejeitado para chamadas diretas de clientes nesta fase (depende do validador server-side na Fase 6).
-- - 'abandonment': Rejeitado nesta fase (depende da infraestrutura de Grace Period na fase correspondente).
-- - 'resignation': Determinado pelo servidor: em 2 jogadores, oponente vence; em 3+ jogadores, rejeita resolução de vencedor único não configurada.
-- - 'timeout': Determinado exclusivamente pelo servidor via clock_timestamp() >= turn_deadline.
-- - Parâmetros p_winner_id e p_is_draw são desconsiderados/não confiados do cliente.
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
    v_player_count INTEGER;
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

    -- 5. Validar participação do chamador na composição congelada da partida
    SELECT EXISTS (
        SELECT 1 FROM public.match_players 
        WHERE match_id = p_match_id AND user_id = v_caller_id
    ) INTO v_is_player;

    IF NOT v_is_player THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: O usuário não é participante desta partida.' USING ERRCODE = 'P0018';
    END IF;

    -- 6. Contagem de participantes na partida
    SELECT count(*) INTO v_player_count
    FROM public.match_players
    WHERE match_id = p_match_id;

    -- 7. Validação e autoridade estrita do servidor por motivo de encerramento
    IF p_reason = 'normal' THEN
        -- O cliente NÃO pode declarar conclusão normal nem informar vencedor/empate arbitrariamente
        RAISE EXCEPTION 'NORMAL_FINISH_NOT_AVAILABLE: A conclusão normal de partida requer validação server-side das regras do jogo e será habilitada na Fase 6.' USING ERRCODE = 'P0025';

    ELSIF p_reason = 'abandonment' THEN
        -- O encerramento por abandono requer a infraestrutura de Grace Period do servidor
        RAISE EXCEPTION 'ABANDONMENT_NOT_AVAILABLE: O encerramento por abandono requer a infraestrutura de Grace Period e será habilitado na fase correspondente.' USING ERRCODE = 'P0026';

    ELSIF p_reason = 'resignation' THEN
        -- Desistência voluntária do próprio jogador
        IF v_player_count = 2 THEN
            -- Em partidas de 2 jogadores, o oponente é declarado vencedor
            SELECT user_id INTO v_winner_id
            FROM public.match_players
            WHERE match_id = p_match_id AND user_id != v_caller_id
            LIMIT 1;

            v_is_draw := false;
        ELSIF v_player_count = 1 THEN
            -- Partida solo: sem vencedor externo
            v_winner_id := NULL;
            v_is_draw := false;
        ELSE
            -- Partidas com 3+ jogadores: rejeita resolução simplista nesta fase
            RAISE EXCEPTION 'MULTI_PLAYER_RESIGNATION_POLICY_PENDING: A política de eliminação/desistência para partidas com 3 ou mais jogadores será definida na fase correspondente.' USING ERRCODE = 'P0027';
        END IF;

    ELSIF p_reason = 'timeout' THEN
        -- Autoridade cronológica estrita do PostgreSQL (ignora completamente relógio do cliente)
        IF v_match.turn_deadline IS NULL OR clock_timestamp() < v_match.turn_deadline THEN
            RAISE EXCEPTION 'TURN_TIMEOUT_NOT_EXPIRED: O prazo do turno ainda não expirou no servidor.' USING ERRCODE = 'P0021';
        END IF;

        IF v_player_count = 2 THEN
            -- O jogador cujo turno expirou perde; o oponente pontua
            SELECT user_id INTO v_winner_id
            FROM public.match_players
            WHERE match_id = p_match_id AND user_id != v_match.current_turn_player_id
            LIMIT 1;

            v_is_draw := false;
        ELSIF v_player_count = 1 THEN
            v_winner_id := NULL;
            v_is_draw := false;
        ELSE
            -- Partidas com 3+ jogadores: rejeita resolução simplista de timeout nesta fase
            RAISE EXCEPTION 'MULTI_PLAYER_TIMEOUT_POLICY_PENDING: A resolução automática de timeout para partidas com 3 ou mais jogadores será implementada na fase correspondente.' USING ERRCODE = 'P0028';
        END IF;
    END IF;

    -- 8. Atualizar status da partida no PostgreSQL
    UPDATE public.matches SET
        status = 'finished',
        winner_id = v_winner_id,
        is_draw = v_is_draw,
        finish_reason = p_reason,
        finished_at = now()
    WHERE id = p_match_id
    RETURNING * INTO v_match;

    -- 9. Atualizar flags nos match_players
    IF v_winner_id IS NOT NULL THEN
        UPDATE public.match_players 
        SET is_winner = (user_id = v_winner_id) 
        WHERE match_id = p_match_id;
    ELSE
        UPDATE public.match_players 
        SET is_winner = false 
        WHERE match_id = p_match_id;
    END IF;

    -- 10. Liberar sala associada para novas partidas (Room ≠ Match)
    IF v_match.room_id IS NOT NULL THEN
        UPDATE public.rooms SET
            status = 'waiting',
            current_match_id = NULL,
            updated_at = now()
        WHERE id = v_match.room_id AND current_match_id = p_match_id;
    END IF;

    -- 11. Atualização segura e oficial de estatísticas nos perfis
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
-- 7. Concessão Estrita de Permissões nas Funções Atualizadas
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.join_room_by_code(VARCHAR, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_room_by_code(VARCHAR, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.set_member_ready(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_ready(UUID, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.start_match(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_match(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.finish_match(UUID, VARCHAR, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_match(UUID, VARCHAR, UUID, BOOLEAN) TO authenticated;
