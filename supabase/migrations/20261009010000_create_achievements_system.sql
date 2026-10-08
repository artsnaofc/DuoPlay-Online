-- ============================================================================
-- Migration: 20261009010000_create_achievements_system.sql
-- Project: DuoPlay-Online
-- Phase: Fase 18 — Conquistas e Badges
-- Description: Cria tabelas de conquistas e conquistas de usuário, RPCs de avaliação
--              e consulta, e integra a verificação de conquistas à RPC finish_match.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabela de Definição de Conquistas (public.achievements)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    icon_badge VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL,
    condition_type VARCHAR(50) NOT NULL,
    condition_value INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.achievements IS 'Tabela com as definições de todas as conquistas e badges da plataforma.';

-- ----------------------------------------------------------------------------
-- 2. Tabela de Conquistas Desbloqueadas por Usuário (public.user_achievements)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    achievement_id UUID NOT NULL REFERENCES public.achievements(id) ON DELETE CASCADE,
    unlocked_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    progress INTEGER DEFAULT 0 NOT NULL,
    CONSTRAINT user_achievements_user_achievement_unique UNIQUE (user_id, achievement_id)
);

COMMENT ON TABLE public.user_achievements IS 'Tabela que armazena os desbloqueios de conquistas por usuário, garantindo a idempotência.';

-- ----------------------------------------------------------------------------
-- 3. Índices Otimizados
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id ON public.user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user_ach ON public.user_achievements(user_id, achievement_id);

-- ----------------------------------------------------------------------------
-- 4. Habilitação de RLS e Permissões Estritas
-- ----------------------------------------------------------------------------
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

-- Política RLS: Usuários autenticados podem ler conquistas disponíveis
DROP POLICY IF EXISTS "achievements_select_authenticated" ON public.achievements;
CREATE POLICY "achievements_select_authenticated"
    ON public.achievements
    FOR SELECT
    TO authenticated
    USING (is_active = true);

-- Política RLS: Usuários autenticados podem ler conquistas de qualquer perfil (para perfis públicos)
DROP POLICY IF EXISTS "user_achievements_select_authenticated" ON public.user_achievements;
CREATE POLICY "user_achievements_select_authenticated"
    ON public.user_achievements
    FOR SELECT
    TO authenticated
    USING (true);

REVOKE ALL ON TABLE public.achievements FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.achievements TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.achievements FROM authenticated;

REVOKE ALL ON TABLE public.user_achievements FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.user_achievements TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.user_achievements FROM authenticated;

-- ----------------------------------------------------------------------------
-- 5. Inclusão na Publicação Realtime (para notificar em tempo real quando desbloquear)
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
              AND tablename = 'user_achievements'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.user_achievements;
        END IF;
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Inserção das Conquistas Iniciais
-- ----------------------------------------------------------------------------
INSERT INTO public.achievements (code, name, description, icon_badge, category, condition_type, condition_value, is_active)
VALUES 
    (
        'first_win',
        'Primeira Vitória',
        'Vença a sua primeira partida na plataforma.',
        'Trophy',
        'general',
        'first_win',
        1,
        true
    ),
    (
        '10_matches',
        'Estreante Ativo',
        'Complete 10 partidas na plataforma.',
        'Gamepad',
        'matches_played',
        'matches_count',
        10,
        true
    ),
    (
        '10_wins',
        'Campeão em Ascensão',
        'Alcance 10 vitórias na plataforma.',
        'Award',
        'wins_count',
        'wins_count',
        10,
        true
    ),
    (
        '5_consecutive_wins',
        'Imparável',
        'Consiga uma sequência de 5 vitórias consecutivas.',
        'Zap',
        'win_streak',
        'streak_count',
        5,
        true
    ),
    (
        '50_matches',
        'Veterano de Combate',
        'Complete 50 partidas na plataforma.',
        'Swords',
        'matches_played',
        'matches_count',
        50,
        true
    ),
    (
        '100_matches',
        'Lenda do DuoPlay',
        'Complete 100 partidas na plataforma.',
        'Crown',
        'matches_played',
        'matches_count',
        100,
        true
    ),
    (
        'first_win_tic_tac_toe',
        'Mestre do Alinhamento',
        'Vença sua primeira partida de Jogo da Velha.',
        'Grid',
        'game_specific',
        'first_win_game',
        1,
        true
    )
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    icon_badge = EXCLUDED.icon_badge,
    category = EXCLUDED.category,
    condition_type = EXCLUDED.condition_type,
    condition_value = EXCLUDED.condition_value,
    is_active = EXCLUDED.is_active;

-- ----------------------------------------------------------------------------
-- 7. Função de Avaliação e Desbloqueio de Conquistas (public.evaluate_user_achievements)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_user_achievements(
    p_user_id UUID,
    p_game_id VARCHAR(50)
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_profile RECORD;
    v_game_stats RECORD;
    v_ach RECORD;
    v_unlocked BOOLEAN;
    v_progress INTEGER;
    v_inserted_id UUID;
BEGIN
    -- 1. Buscar os dados oficiais consolidados
    SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT * INTO v_game_stats FROM public.user_game_stats WHERE user_id = p_user_id AND game_id = p_game_id;

    -- 2. Iterar sobre cada conquista ativa
    FOR v_ach IN SELECT * FROM public.achievements WHERE is_active = true LOOP
        v_unlocked := false;
        v_progress := 0;

        CASE v_ach.code
            WHEN 'first_win' THEN
                v_progress := COALESCE(v_profile.total_wins, 0);
                IF v_progress >= 1 THEN
                    v_unlocked := true;
                END IF;

            WHEN '10_matches' THEN
                v_progress := COALESCE(v_profile.total_matches, 0);
                IF v_progress >= 10 THEN
                    v_unlocked := true;
                END IF;

            WHEN '10_wins' THEN
                v_progress := COALESCE(v_profile.total_wins, 0);
                IF v_progress >= 10 THEN
                    v_unlocked := true;
                END IF;

            WHEN '5_consecutive_wins' THEN
                v_progress := GREATEST(COALESCE(v_profile.best_streak, 0), COALESCE(v_game_stats.best_streak, 0));
                IF v_progress >= 5 THEN
                    v_unlocked := true;
                END IF;

            WHEN '50_matches' THEN
                v_progress := COALESCE(v_profile.total_matches, 0);
                IF v_progress >= 50 THEN
                    v_unlocked := true;
                END IF;

            WHEN '100_matches' THEN
                v_progress := COALESCE(v_profile.total_matches, 0);
                IF v_progress >= 100 THEN
                    v_unlocked := true;
                END IF;

            WHEN 'first_win_tic_tac_toe' THEN
                IF p_game_id = 'tic-tac-toe' AND COALESCE(v_game_stats.total_wins, 0) >= 1 THEN
                    v_unlocked := true;
                    v_progress := COALESCE(v_game_stats.total_wins, 0);
                ELSE
                    -- Se o jogador atingiu a vitória anteriormente
                    DECLARE
                        v_ttt_stats RECORD;
                    BEGIN
                        SELECT * INTO v_ttt_stats FROM public.user_game_stats WHERE user_id = p_user_id AND game_id = 'tic-tac-toe';
                        v_progress := COALESCE(v_ttt_stats.total_wins, 0);
                        IF v_progress >= 1 THEN
                            v_unlocked := true;
                        END IF;
                    END;
                END IF;

            ELSE
                -- Suporte dinâmico a conquistas de vitórias específicas de novos jogos
                IF v_ach.code LIKE 'first_win_%' THEN
                    DECLARE
                        v_target_game VARCHAR(50);
                        v_specific_stats RECORD;
                    BEGIN
                        v_target_game := substring(v_ach.code from 11);
                        IF p_game_id = v_target_game AND COALESCE(v_game_stats.total_wins, 0) >= 1 THEN
                            v_unlocked := true;
                            v_progress := COALESCE(v_game_stats.total_wins, 0);
                        ELSE
                            SELECT * INTO v_specific_stats FROM public.user_game_stats WHERE user_id = p_user_id AND game_id = v_target_game;
                            v_progress := COALESCE(v_specific_stats.total_wins, 0);
                            IF v_progress >= 1 THEN
                                v_unlocked := true;
                            END IF;
                        END IF;
                    END;
                END IF;
        END CASE;

        -- 3. Se atingiu as condições, tenta inserir com tratamento de duplicação
        IF v_unlocked THEN
            INSERT INTO public.user_achievements (
                user_id,
                achievement_id,
                unlocked_at,
                progress
            ) VALUES (
                p_user_id,
                v_ach.id,
                now(),
                v_progress
            )
            ON CONFLICT (user_id, achievement_id) DO NOTHING
            RETURNING id INTO v_inserted_id;

            -- 4. Se a inserção de fato ocorreu, dispara notificação idempotente no canal central
            IF v_inserted_id IS NOT NULL THEN
                PERFORM public.create_notification_internal(
                    p_user_id,
                    'achievement_unlocked',
                    NULL,
                    'Conquista Desbloqueada!',
                    'Você desbloqueou a conquista: ' || v_ach.name || ' (' || v_ach.description || ')',
                    jsonb_build_object(
                        'achievement_id', v_ach.id,
                        'achievement_code', v_ach.code,
                        'achievement_name', v_ach.name,
                        'achievement_description', v_ach.description,
                        'achievement_icon', v_ach.icon_badge,
                        'unlocked_at', now()
                    ),
                    'achievement_unlocked:' || v_ach.code || ':' || p_user_id
                );
            END IF;
        END IF;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_user_achievements(UUID, VARCHAR) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. RPC para Listar Conquistas e Progresso (public.get_user_achievements)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_achievements(
    p_user_id UUID
)
RETURNS TABLE (
    achievement_id UUID,
    code VARCHAR(50),
    name VARCHAR(255),
    description TEXT,
    icon_badge VARCHAR(255),
    category VARCHAR(50),
    condition_type VARCHAR(50),
    condition_value INTEGER,
    unlocked BOOLEAN,
    unlocked_at TIMESTAMPTZ,
    progress INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_profile RECORD;
    v_ttt_stats RECORD;
BEGIN
    -- Validar autenticação do chamador
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT * INTO v_ttt_stats FROM public.user_game_stats WHERE user_id = p_user_id AND game_id = 'tic-tac-toe';

    RETURN QUERY
    SELECT 
        a.id AS achievement_id,
        a.code,
        a.name,
        a.description,
        a.icon_badge,
        a.category,
        a.condition_type,
        a.condition_value,
        (ua.id IS NOT NULL) AS unlocked,
        ua.unlocked_at,
        CASE a.code
            WHEN 'first_win' THEN COALESCE(v_profile.total_wins, 0)
            WHEN '10_matches' THEN COALESCE(v_profile.total_matches, 0)
            WHEN '10_wins' THEN COALESCE(v_profile.total_wins, 0)
            WHEN '5_consecutive_wins' THEN GREATEST(COALESCE(v_profile.best_streak, 0), COALESCE(v_ttt_stats.best_streak, 0))
            WHEN '50_matches' THEN COALESCE(v_profile.total_matches, 0)
            WHEN '100_matches' THEN COALESCE(v_profile.total_matches, 0)
            WHEN 'first_win_tic_tac_toe' THEN COALESCE(v_ttt_stats.total_wins, 0)
            ELSE 
                CASE 
                    WHEN a.code LIKE 'first_win_%' THEN
                        COALESCE((
                            SELECT ugs.total_wins 
                            FROM public.user_game_stats ugs 
                            WHERE ugs.user_id = p_user_id 
                              AND ugs.game_id = substring(a.code from 11)
                        ), 0)
                    ELSE 0
                END
        END AS progress
    FROM public.achievements a
    LEFT JOIN public.user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = p_user_id
    WHERE a.is_active = true
    ORDER BY a.category ASC, a.condition_value ASC, a.name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_achievements(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_achievements(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Redefinição de finish_match Integrando Conquistas
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

        -- ====================================================================
        -- Integração da Fase 18: Avaliar conquistas do usuário
        -- ====================================================================
        PERFORM public.evaluate_user_achievements(v_mp.user_id, v_match.game_id);

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
