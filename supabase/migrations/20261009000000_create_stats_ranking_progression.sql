-- ============================================================================
-- Migration: 20261009000000_create_stats_ranking_progression.sql
-- Project: DuoPlay-Online
-- Phase: Fase 17 — Estatísticas, Ranking e Progressão
-- Description: Adiciona estatísticas avançadas (streaks, rating, xp, level) aos perfis,
--              tabela user_game_stats por jogo, RPCs de Leaderboard e Estatísticas do Jogador,
--              e atualiza a RPC finish_match com cálculo atômico e idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Novas Colunas em public.profiles (Estatísticas Globais e Progressão)
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS current_streak INTEGER DEFAULT 0 NOT NULL CHECK (current_streak >= 0),
    ADD COLUMN IF NOT EXISTS best_streak INTEGER DEFAULT 0 NOT NULL CHECK (best_streak >= 0),
    ADD COLUMN IF NOT EXISTS rating INTEGER DEFAULT 1000 NOT NULL CHECK (rating >= 0),
    ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0 NOT NULL CHECK (xp >= 0),
    ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1 NOT NULL CHECK (level >= 1);

COMMENT ON COLUMN public.profiles.current_streak IS 'Sequência atual de vitórias consecutivas do jogador (backend).';
COMMENT ON COLUMN public.profiles.best_streak IS 'Melhor sequência histórica de vitórias consecutivas (backend).';
COMMENT ON COLUMN public.profiles.rating IS 'Pontuação de habilidade/rating global do jogador (backend).';
COMMENT ON COLUMN public.profiles.xp IS 'Pontos de experiência acumulados pelo jogador (backend).';
COMMENT ON COLUMN public.profiles.level IS 'Nível do jogador baseado no XP total (backend).';

-- Índices Otimizados para Leaderboard Global
CREATE INDEX IF NOT EXISTS idx_profiles_leaderboard_rating ON public.profiles (rating DESC, total_wins DESC, total_matches DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_level ON public.profiles (level DESC, xp DESC);

-- ----------------------------------------------------------------------------
-- 2. Tabela de Estatísticas por Jogo (public.user_game_stats)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_game_stats (
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    game_id VARCHAR(50) NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
    total_matches INTEGER DEFAULT 0 NOT NULL CHECK (total_matches >= 0),
    total_wins INTEGER DEFAULT 0 NOT NULL CHECK (total_wins >= 0),
    total_draws INTEGER DEFAULT 0 NOT NULL CHECK (total_draws >= 0),
    total_losses INTEGER DEFAULT 0 NOT NULL CHECK (total_losses >= 0),
    current_streak INTEGER DEFAULT 0 NOT NULL CHECK (current_streak >= 0),
    best_streak INTEGER DEFAULT 0 NOT NULL CHECK (best_streak >= 0),
    rating INTEGER DEFAULT 1000 NOT NULL CHECK (rating >= 0),
    xp INTEGER DEFAULT 0 NOT NULL CHECK (xp >= 0),
    level INTEGER DEFAULT 1 NOT NULL CHECK (level >= 1),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    PRIMARY KEY (user_id, game_id)
);

COMMENT ON TABLE public.user_game_stats IS 'Estatísticas consolidadas e progressão por jogo específico para cada jogador.';

-- Índices Otimizados para Leaderboard por Jogo
CREATE INDEX IF NOT EXISTS idx_user_game_stats_leaderboard ON public.user_game_stats (game_id, rating DESC, total_wins DESC, total_matches DESC);

-- Habilitar RLS
ALTER TABLE public.user_game_stats ENABLE ROW LEVEL SECURITY;

-- Política RLS: Todos os usuários autenticados podem visualizar estatísticas por jogo
DROP POLICY IF EXISTS "user_game_stats_select_authenticated" ON public.user_game_stats;
CREATE POLICY "user_game_stats_select_authenticated"
    ON public.user_game_stats
    FOR SELECT
    TO authenticated
    USING (true);

-- Permissões estritas em user_game_stats
REVOKE ALL ON TABLE public.user_game_stats FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.user_game_stats TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Função Auxiliar Determinística para Cálculo de Nível por XP
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_user_level(p_xp INTEGER)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT GREATEST(1, 1 + FLOOR(COALESCE(p_xp, 0)::NUMERIC / 200.0)::INTEGER);
$$;

COMMENT ON FUNCTION public.calculate_user_level(INTEGER) IS 'Calcula o nível do jogador com base no XP acumulado (1 nível a cada 200 XP).';

-- ----------------------------------------------------------------------------
-- 4. Atualização do Trigger de Integridade do Perfil (Proteção das Novas Colunas)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_profile_update_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Permitir atualizações internas feitas por RPCs autorizadas do sistema
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
       (NEW.total_losses IS DISTINCT FROM OLD.total_losses) OR
       (NEW.current_streak IS DISTINCT FROM OLD.current_streak) OR
       (NEW.best_streak IS DISTINCT FROM OLD.best_streak) OR
       (NEW.rating IS DISTINCT FROM OLD.rating) OR
       (NEW.xp IS DISTINCT FROM OLD.xp) OR
       (NEW.level IS DISTINCT FROM OLD.level) THEN
        RAISE EXCEPTION 'Estatísticas oficiais e dados de ranking/nível não podem ser alterados diretamente pelo usuário.';
    END IF;

    -- 4. Garantir que updated_at seja sempre atribuído com o horário oficial do servidor
    NEW.updated_at := now();

    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. RPC: get_leaderboard
-- Retorna o ranking global (p_game_id IS NULL) ou por jogo (p_game_id preenchido)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_leaderboard(
    p_game_id VARCHAR(50) DEFAULT NULL,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    rank BIGINT,
    user_id UUID,
    username VARCHAR(32),
    display_name VARCHAR(50),
    avatar_url TEXT,
    level INTEGER,
    xp INTEGER,
    rating INTEGER,
    total_matches INTEGER,
    total_wins INTEGER,
    total_draws INTEGER,
    total_losses INTEGER,
    win_rate NUMERIC,
    current_streak INTEGER,
    best_streak INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_safe_limit INTEGER;
    v_safe_offset INTEGER;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    v_safe_limit := LEAST(GREATEST(p_limit, 1), 100);
    v_safe_offset := GREATEST(p_offset, 0);

    IF p_game_id IS NULL OR trim(p_game_id) = '' THEN
        -- Leaderboard Global baseado em public.profiles
        RETURN QUERY
        SELECT 
            ROW_NUMBER() OVER (
                ORDER BY 
                    p.rating DESC, 
                    p.total_wins DESC, 
                    ROUND((p.total_wins * 100.0) / GREATEST(p.total_matches, 1), 1) DESC,
                    p.total_matches DESC, 
                    p.id ASC
            ) AS rank,
            p.id AS user_id,
            p.username,
            p.display_name,
            p.avatar_url,
            p.level,
            p.xp,
            p.rating,
            p.total_matches,
            p.total_wins,
            p.total_draws,
            p.total_losses,
            ROUND((p.total_wins * 100.0) / GREATEST(p.total_matches, 1), 1) AS win_rate,
            p.current_streak,
            p.best_streak
        FROM public.profiles p
        LIMIT v_safe_limit OFFSET v_safe_offset;
    ELSE
        -- Leaderboard Por Jogo baseado em public.user_game_stats
        RETURN QUERY
        SELECT 
            ROW_NUMBER() OVER (
                ORDER BY 
                    ugs.rating DESC, 
                    ugs.total_wins DESC, 
                    ROUND((ugs.total_wins * 100.0) / GREATEST(ugs.total_matches, 1), 1) DESC,
                    ugs.total_matches DESC, 
                    p.id ASC
            ) AS rank,
            p.id AS user_id,
            p.username,
            p.display_name,
            p.avatar_url,
            ugs.level,
            ugs.xp,
            ugs.rating,
            ugs.total_matches,
            ugs.total_wins,
            ugs.total_draws,
            ugs.total_losses,
            ROUND((ugs.total_wins * 100.0) / GREATEST(ugs.total_matches, 1), 1) AS win_rate,
            ugs.current_streak,
            ugs.best_streak
        FROM public.user_game_stats ugs
        JOIN public.profiles p ON p.id = ugs.user_id
        WHERE ugs.game_id = p_game_id
        LIMIT v_safe_limit OFFSET v_safe_offset;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_leaderboard(VARCHAR, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(VARCHAR, INTEGER, INTEGER) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. RPC: get_player_stats
-- Retorna estatísticas completas, posição no ranking e histórico do jogador
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_player_stats(
    p_user_id UUID,
    p_game_id VARCHAR(50) DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_profile RECORD;
    v_global_rank BIGINT;
    v_game_rank BIGINT := NULL;
    v_game_stats RECORD;
    v_all_game_stats JSONB := '[]'::jsonb;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_profile
    FROM public.profiles
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'USER_NOT_FOUND: Jogador não encontrado.' USING ERRCODE = 'P0041';
    END IF;

    -- Posição no Ranking Global
    SELECT count(*) + 1 INTO v_global_rank
    FROM public.profiles p
    WHERE (p.rating > v_profile.rating)
       OR (p.rating = v_profile.rating AND p.total_wins > v_profile.total_wins)
       OR (p.rating = v_profile.rating AND p.total_wins = v_profile.total_wins AND p.total_matches > v_profile.total_matches)
       OR (p.rating = v_profile.rating AND p.total_wins = v_profile.total_wins AND p.total_matches = v_profile.total_matches AND p.id < v_profile.id);

    -- Estatísticas por jogo específico se p_game_id for informado
    IF p_game_id IS NOT NULL AND trim(p_game_id) != '' THEN
        SELECT * INTO v_game_stats
        FROM public.user_game_stats
        WHERE user_id = p_user_id AND game_id = p_game_id;

        IF FOUND THEN
            SELECT count(*) + 1 INTO v_game_rank
            FROM public.user_game_stats ugs
            WHERE ugs.game_id = p_game_id
              AND ((ugs.rating > v_game_stats.rating)
                OR (ugs.rating = v_game_stats.rating AND ugs.total_wins > v_game_stats.total_wins)
                OR (ugs.rating = v_game_stats.rating AND ugs.total_wins = v_game_stats.total_wins AND ugs.total_matches > v_game_stats.total_matches)
                OR (ugs.rating = v_game_stats.rating AND ugs.total_wins = v_game_stats.total_wins AND ugs.total_matches = v_game_stats.total_matches AND ugs.user_id < v_game_stats.user_id));
        END IF;
    END IF;

    -- Compilar lista de todas as estatísticas por jogo do jogador
    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'game_id', ugs.game_id,
            'total_matches', ugs.total_matches,
            'total_wins', ugs.total_wins,
            'total_draws', ugs.total_draws,
            'total_losses', ugs.total_losses,
            'win_rate', ROUND((ugs.total_wins * 100.0) / GREATEST(ugs.total_matches, 1), 1),
            'current_streak', ugs.current_streak,
            'best_streak', ugs.best_streak,
            'rating', ugs.rating,
            'xp', ugs.xp,
            'level', ugs.level
        )
    ), '[]'::jsonb) INTO v_all_game_stats
    FROM public.user_game_stats ugs
    WHERE ugs.user_id = p_user_id;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'user_id', v_profile.id,
            'username', v_profile.username,
            'display_name', v_profile.display_name,
            'avatar_url', v_profile.avatar_url,
            'global_rank', v_global_rank,
            'global_stats', jsonb_build_object(
                'total_matches', v_profile.total_matches,
                'total_wins', v_profile.total_wins,
                'total_draws', v_profile.total_draws,
                'total_losses', v_profile.total_losses,
                'win_rate', ROUND((v_profile.total_wins * 100.0) / GREATEST(v_profile.total_matches, 1), 1),
                'current_streak', v_profile.current_streak,
                'best_streak', v_profile.best_streak,
                'rating', v_profile.rating,
                'xp', v_profile.xp,
                'level', v_profile.level
            ),
            'selected_game_id', p_game_id,
            'game_rank', v_game_rank,
            'game_stats_list', v_all_game_stats
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_player_stats(UUID, VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_player_stats(UUID, VARCHAR) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Atualização da RPC finish_match (Processamento Atômico de Estatísticas,
--    Rating, XP, Nível e Notificações)
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
    v_opponent RECORD;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_mp RECORD;
    
    -- Variáveis de cálculo de estatísticas e progressão
    v_win_inc INTEGER;
    v_draw_inc INTEGER;
    v_loss_inc INTEGER;
    v_xp_delta INTEGER;
    v_rating_delta INTEGER;
    v_new_current_streak INTEGER;
    v_old_profile RECORD;
    v_new_xp INTEGER;
    v_new_level INTEGER;
    v_new_rating INTEGER;
    v_old_game_stats RECORD;
    v_new_game_xp INTEGER;
    v_new_game_level INTEGER;
    v_new_game_rating INTEGER;
    v_new_game_streak INTEGER;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    IF p_reason NOT IN ('normal', 'timeout', 'abandonment', 'resignation') THEN
        RAISE EXCEPTION 'INVALID_FINISH_REASON: Motivo de encerramento inválido.' USING ERRCODE = 'P0020';
    END IF;

    SELECT * INTO v_match 
    FROM public.matches 
    WHERE id = p_match_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MATCH_NOT_FOUND: Partida não encontrada.' USING ERRCODE = 'P0016';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.match_players 
        WHERE match_id = p_match_id AND user_id = v_caller_id
    ) INTO v_is_player;

    IF NOT v_is_player THEN
        RAISE EXCEPTION 'NOT_MATCH_PLAYER: O usuário não é participante desta partida.' USING ERRCODE = 'P0018';
    END IF;

    -- IDEMPOTÊNCIA: Se a partida já estiver encerrada, retorna estado atual sem reprocessar estatísticas
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

    SELECT count(*) INTO v_player_count
    FROM public.match_players
    WHERE match_id = p_match_id;

    IF p_reason = 'normal' THEN
        RAISE EXCEPTION 'NORMAL_FINISH_NOT_AVAILABLE: Conclusão normal requer validador server-side de regras.' USING ERRCODE = 'P0025';

    ELSIF p_reason = 'abandonment' THEN
        IF v_player_count = 2 THEN
            SELECT * INTO v_opponent
            FROM public.match_players
            WHERE match_id = p_match_id AND user_id != v_caller_id
            LIMIT 1;

            IF v_opponent.connection_status = 'connected' AND v_opponent.last_seen_at < (v_now - interval '12 seconds') THEN
                v_opponent.connection_status := 'disconnected';
                v_opponent.disconnected_at := coalesce(v_opponent.disconnected_at, v_opponent.last_seen_at + interval '12 seconds');
                v_opponent.grace_period_expires_at := v_opponent.disconnected_at + interval '45 seconds';
                
                UPDATE public.match_players
                SET connection_status = 'disconnected',
                    disconnected_at = v_opponent.disconnected_at,
                    grace_period_expires_at = v_opponent.grace_period_expires_at
                WHERE id = v_opponent.id;
            END IF;

            IF v_opponent.connection_status != 'disconnected' THEN
                RAISE EXCEPTION 'OPPONENT_NOT_DISCONNECTED: O adversário ainda está conectado.' USING ERRCODE = 'P0034';
            END IF;

            IF v_opponent.grace_period_expires_at IS NULL OR v_now < v_opponent.grace_period_expires_at THEN
                RAISE EXCEPTION 'GRACE_PERIOD_NOT_EXPIRED: O prazo de carência do adversário ainda não expirou no servidor.' USING ERRCODE = 'P0035';
            END IF;

            v_winner_id := v_caller_id;
            v_is_draw := false;
        ELSE
            RAISE EXCEPTION 'MULTI_PLAYER_ABANDONMENT_POLICY_PENDING: Não suportado para 3+ jogadores.' USING ERRCODE = 'P0036';
        END IF;

    ELSIF p_reason = 'resignation' THEN
        IF v_player_count = 2 THEN
            SELECT user_id INTO v_winner_id
            FROM public.match_players
            WHERE match_id = p_match_id AND user_id != v_caller_id
            LIMIT 1;

            v_is_draw := false;

            UPDATE public.match_players
            SET connection_status = 'disconnected',
                disconnected_at = v_now
            WHERE match_id = p_match_id AND user_id = v_caller_id;
        ELSIF v_player_count = 1 THEN
            v_winner_id := NULL;
            v_is_draw := false;

            UPDATE public.match_players
            SET connection_status = 'disconnected',
                disconnected_at = v_now
            WHERE match_id = p_match_id AND user_id = v_caller_id;
        ELSE
            RAISE EXCEPTION 'MULTI_PLAYER_RESIGNATION_POLICY_PENDING: Não suportado para 3+ jogadores.' USING ERRCODE = 'P0027';
        END IF;

    ELSIF p_reason = 'timeout' THEN
        IF v_match.turn_deadline IS NULL OR v_now < v_match.turn_deadline THEN
            RAISE EXCEPTION 'TURN_TIMEOUT_NOT_EXPIRED: O prazo do turno ainda não expirou no servidor.' USING ERRCODE = 'P0021';
        END IF;

        IF v_player_count = 2 THEN
            SELECT user_id INTO v_winner_id
            FROM public.match_players
            WHERE match_id = p_match_id AND user_id != v_match.current_turn_player_id
            LIMIT 1;

            v_is_draw := false;
        ELSE
            RAISE EXCEPTION 'MULTI_PLAYER_TIMEOUT_POLICY_PENDING: Não suportado para 3+ jogadores.' USING ERRCODE = 'P0028';
        END IF;
    END IF;

    -- Atualiza estado da partida para finished
    UPDATE public.matches SET
        status = 'finished',
        winner_id = v_winner_id,
        is_draw = v_is_draw,
        finish_reason = p_reason,
        finished_at = v_now,
        updated_at = v_now
    WHERE id = p_match_id
    RETURNING * INTO v_match;

    IF v_winner_id IS NOT NULL THEN
        UPDATE public.match_players 
        SET is_winner = (user_id = v_winner_id) 
        WHERE match_id = p_match_id;
    ELSE
        UPDATE public.match_players 
        SET is_winner = false 
        WHERE match_id = p_match_id;
    END IF;

    IF p_reason IN ('resignation', 'abandonment') THEN
        UPDATE public.rematch_requests
        SET status = 'expired',
            updated_at = v_now
        WHERE original_match_id = p_match_id
          AND status = 'pending';
    END IF;

    IF v_match.room_id IS NOT NULL THEN
        UPDATE public.rooms SET
            status = 'waiting',
            current_match_id = NULL,
            updated_at = v_now
        WHERE id = v_match.room_id AND current_match_id = p_match_id;
    END IF;

    -- Sinaliza operação interna para permitir atualização das colunas protegidas do perfil
    PERFORM set_config('duoplay.internal_system_operation', 'true', true);

    -- Atualização Atômica de Estatísticas Globais (profiles) e por Jogo (user_game_stats)
    FOR v_mp IN SELECT user_id FROM public.match_players WHERE match_id = p_match_id LOOP
        SELECT * INTO v_old_profile FROM public.profiles WHERE id = v_mp.user_id FOR UPDATE;

        IF v_is_draw THEN
            v_win_inc := 0;
            v_draw_inc := 1;
            v_loss_inc := 0;
            v_xp_delta := 40;
            v_rating_delta := 0;
            v_new_current_streak := 0;
        ELSIF v_winner_id IS NOT NULL AND v_mp.user_id = v_winner_id THEN
            v_win_inc := 1;
            v_draw_inc := 0;
            v_loss_inc := 0;
            v_xp_delta := 100;
            v_rating_delta := 25;
            v_new_current_streak := v_old_profile.current_streak + 1;
        ELSIF v_winner_id IS NOT NULL AND v_mp.user_id != v_winner_id THEN
            v_win_inc := 0;
            v_draw_inc := 0;
            v_loss_inc := 1;
            v_xp_delta := 20;
            v_rating_delta := -15;
            v_new_current_streak := 0;
        ELSE
            -- Caso sem vencedor ou empate explícito
            v_win_inc := 0;
            v_draw_inc := 0;
            v_loss_inc := 0;
            v_xp_delta := 20;
            v_rating_delta := 0;
            v_new_current_streak := 0;
        END IF;

        -- Cálculo de novos totais no perfil
        v_new_xp := v_old_profile.xp + v_xp_delta;
        v_new_level := public.calculate_user_level(v_new_xp);
        v_new_rating := GREATEST(0, v_old_profile.rating + v_rating_delta);

        -- Atualizar public.profiles
        UPDATE public.profiles
        SET 
            total_matches = total_matches + 1,
            total_wins = total_wins + v_win_inc,
            total_draws = total_draws + v_draw_inc,
            total_losses = total_losses + v_loss_inc,
            current_streak = v_new_current_streak,
            best_streak = GREATEST(best_streak, v_new_current_streak),
            rating = v_new_rating,
            xp = v_new_xp,
            level = v_new_level,
            updated_at = v_now
        WHERE id = v_mp.user_id;

        -- Atualizar/Inserir em public.user_game_stats
        SELECT * INTO v_old_game_stats 
        FROM public.user_game_stats 
        WHERE user_id = v_mp.user_id AND game_id = v_match.game_id 
        FOR UPDATE;

        IF FOUND THEN
            v_new_game_xp := v_old_game_stats.xp + v_xp_delta;
            v_new_game_level := public.calculate_user_level(v_new_game_xp);
            v_new_game_rating := GREATEST(0, v_old_game_stats.rating + v_rating_delta);
            v_new_game_streak := CASE WHEN v_win_inc = 1 THEN v_old_game_stats.current_streak + 1 ELSE 0 END;

            UPDATE public.user_game_stats
            SET total_matches = total_matches + 1,
                total_wins = total_wins + v_win_inc,
                total_draws = total_draws + v_draw_inc,
                total_losses = total_losses + v_loss_inc,
                current_streak = v_new_game_streak,
                best_streak = GREATEST(best_streak, v_new_game_streak),
                rating = v_new_game_rating,
                xp = v_new_game_xp,
                level = v_new_game_level,
                updated_at = v_now
            WHERE user_id = v_mp.user_id AND game_id = v_match.game_id;
        ELSE
            v_new_game_xp := v_xp_delta;
            v_new_game_level := public.calculate_user_level(v_new_game_xp);
            v_new_game_rating := GREATEST(0, 1000 + v_rating_delta);
            v_new_game_streak := CASE WHEN v_win_inc = 1 THEN 1 ELSE 0 END;

            INSERT INTO public.user_game_stats (
                user_id,
                game_id,
                total_matches,
                total_wins,
                total_draws,
                total_losses,
                current_streak,
                best_streak,
                rating,
                xp,
                level,
                updated_at
            ) VALUES (
                v_mp.user_id,
                v_match.game_id,
                1,
                v_win_inc,
                v_draw_inc,
                v_loss_inc,
                v_new_game_streak,
                v_new_game_streak,
                v_new_game_rating,
                v_new_game_xp,
                v_new_game_level,
                v_now
            );
        END IF;

        -- Emissão da notificação com payload enriquecido (XP, rating, level)
        IF v_is_draw THEN
            PERFORM public.create_notification_internal(
                v_mp.user_id,
                'match_finished',
                NULL,
                'Partida Encerrada',
                'A partida terminou em empate! (+40 XP)',
                jsonb_build_object(
                    'match_id', p_match_id,
                    'result', 'draw',
                    'xp_earned', 40,
                    'rating_change', 0,
                    'level', v_new_level
                ),
                'match_finished:' || p_match_id || ':' || v_mp.user_id
            );
        ELSIF v_winner_id IS NOT NULL THEN
            IF v_mp.user_id = v_winner_id THEN
                PERFORM public.create_notification_internal(
                    v_mp.user_id,
                    'match_finished',
                    NULL,
                    'Partida Encerrada',
                    'Você venceu a partida! (+100 XP, +25 Rating)',
                    jsonb_build_object(
                        'match_id', p_match_id,
                        'result', 'win',
                        'xp_earned', 100,
                        'rating_change', 25,
                        'level', v_new_level
                    ),
                    'match_finished:' || p_match_id || ':' || v_mp.user_id
                );
            ELSE
                PERFORM public.create_notification_internal(
                    v_mp.user_id,
                    'match_finished',
                    NULL,
                    'Partida Encerrada',
                    'Você perdeu a partida. (+20 XP, -15 Rating)',
                    jsonb_build_object(
                        'match_id', p_match_id,
                        'result', 'loss',
                        'xp_earned', 20,
                        'rating_change', -15,
                        'level', v_new_level
                    ),
                    'match_finished:' || p_match_id || ':' || v_mp.user_id
                );
            END IF;
        END IF;
    END LOOP;

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

REVOKE ALL ON FUNCTION public.finish_match(UUID, VARCHAR, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_match(UUID, VARCHAR, UUID, BOOLEAN) TO authenticated;
