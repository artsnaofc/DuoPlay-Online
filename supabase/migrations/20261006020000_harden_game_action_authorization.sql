-- ============================================================================
-- Migration: 20261006020000_harden_game_action_authorization.sql
-- Project: DuoPlay-Online
-- Phase: Fase 3.1 — Hardening Final do Backend Multiplayer
-- Description:
--   1. dispatch_game_action(): Garante que payload arbitrário do cliente
--      NUNCA seja incorporado diretamente ao game_state oficial persistido.
--      O game_state permanece inalterado até ser processado por um validator
--      server-side de regras de jogo na Fase 6.
--   2. finish_match(): Validação obrigatória de autorização e pertencimento
--      do chamador (auth.uid() em match_players) ANTES do retorno idempotente,
--      impedindo que terceiros espionem resultados ou timestamps de partidas finalizadas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Hardening do Despachador de Ações (dispatch_game_action)
-- ----------------------------------------------------------------------------
-- Preserva rotação determinística 1 -> 2 -> ... -> N -> 1.
-- NÃO persiste payload do cliente em game_state.
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

    -- 4. O game_state oficial NÃO é derivado do payload arbitrário do cliente.
    -- Ele permanece strictly intacto até ser gerado por um validador server-side oficial (Fase 6).
    RETURN jsonb_build_object(
        'new_state', coalesce(p_current_state, '{}'::jsonb),
        'next_player_id', v_next_player_id,
        'winner_id', null,
        'is_draw', false,
        'is_finished', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_game_action(VARCHAR, UUID, UUID, VARCHAR, JSONB, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Hardening da RPC finish_match (Autorização Antes da Idempotência)
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

    -- 4. VALIDAR PARTICIPAÇÃO ANTES DE QUALQUER RETORNO IDEMPOTENTE OU EXPOSIÇÃO DE DADOS
    SELECT EXISTS (
        SELECT 1 FROM public.match_players 
        WHERE match_id = p_match_id AND user_id = v_caller_id
    ) INTO v_is_player;

    IF NOT v_is_player THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: O usuário não é participante desta partida.' USING ERRCODE = 'P0018';
    END IF;

    -- 5. Idempotência: Se já finalizada, retorna o estado existente EXCLUSIVAMENTE para participantes autorizados
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
-- 3. Concessão Estrita de Permissões
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.finish_match(UUID, VARCHAR, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_match(UUID, VARCHAR, UUID, BOOLEAN) TO authenticated;
