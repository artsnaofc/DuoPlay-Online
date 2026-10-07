// ============================================================================
// Service: Stats & Leaderboard — DuoPlay-Online
// Phase: Fase 17 — Estatísticas, Ranking e Progressão
// Description: Serviços para consulta de Leaderboard (Global e Por Jogo) e
//              estatísticas detalhadas de jogadores.
// ============================================================================

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { LeaderboardRow } from '@/types/database';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  level: number;
  xp: number;
  rating: number;
  totalMatches: number;
  totalWins: number;
  totalDraws: number;
  totalLosses: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
}

export interface GameStatsDetail {
  gameId: string;
  totalMatches: number;
  totalWins: number;
  totalDraws: number;
  totalLosses: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
  rating: number;
  xp: number;
  level: number;
}

export interface PlayerStatsSummary {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  globalRank: number;
  globalStats: {
    totalMatches: number;
    totalWins: number;
    totalDraws: number;
    totalLosses: number;
    winRate: number;
    currentStreak: number;
    bestStreak: number;
    rating: number;
    xp: number;
    level: number;
  };
  selectedGameId: string | null;
  gameRank: number | null;
  gameStatsList: GameStatsDetail[];
}

export interface StatsOperationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

/**
 * Retorna o progresso do nível do jogador (0-100%).
 */
export function calculateLevelProgress(xp: number) {
  const safeXp = Math.max(0, xp || 0);
  const level = Math.max(1, 1 + Math.floor(safeXp / 200));
  const currentLevelBaseXp = (level - 1) * 200;
  const xpInCurrentLevel = safeXp - currentLevelBaseXp;
  const xpForNextLevel = 200;
  const progressPercentage = Math.min(100, Math.round((xpInCurrentLevel / xpForNextLevel) * 100));

  return {
    level,
    xp: safeXp,
    xpInCurrentLevel,
    xpForNextLevel,
    progressPercentage,
  };
}

/**
 * Busca a classificação oficial (Leaderboard) global ou por jogo.
 */
export async function fetchLeaderboard(
  gameId?: string | null,
  limit: number = 50,
  offset: number = 0
): Promise<StatsOperationResult<LeaderboardEntry[]>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Serviço de dados indisponível.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_leaderboard', {
      p_game_id: gameId || null,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    const entries: LeaderboardEntry[] = (data as LeaderboardRow[] || []).map((row) => ({
      rank: Number(row.rank),
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name || row.username,
      avatarUrl: row.avatar_url || null,
      level: Number(row.level || 1),
      xp: Number(row.xp || 0),
      rating: Number(row.rating || 1000),
      totalMatches: Number(row.total_matches || 0),
      totalWins: Number(row.total_wins || 0),
      totalDraws: Number(row.total_draws || 0),
      totalLosses: Number(row.total_losses || 0),
      winRate: Number(row.win_rate || 0),
      currentStreak: Number(row.current_streak || 0),
      bestStreak: Number(row.best_streak || 0),
    }));

    return { success: true, data: entries };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro inesperado ao consultar ranking.',
    };
  }
}

/**
 * Busca estatísticas completas e posição de ranking de um jogador.
 */
export async function fetchPlayerStats(
  userId: string,
  gameId?: string | null
): Promise<StatsOperationResult<PlayerStatsSummary>> {
  if (!isSupabaseConfigured || !userId) {
    return { success: false, error: 'Identificador do jogador inválido.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_player_stats', {
      p_user_id: userId,
      p_game_id: gameId || null,
    });

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    const raw = (data as { success?: boolean; data?: any; error?: string })?.data;
    if (!raw) {
      return { success: false, error: 'Dados estatísticos não encontrados.' };
    }

    const summary: PlayerStatsSummary = {
      userId: raw.user_id,
      username: raw.username,
      displayName: raw.display_name,
      avatarUrl: raw.avatar_url,
      globalRank: Number(raw.global_rank || 0),
      globalStats: {
        totalMatches: Number(raw.global_stats?.total_matches || 0),
        totalWins: Number(raw.global_stats?.total_wins || 0),
        totalDraws: Number(raw.global_stats?.total_draws || 0),
        totalLosses: Number(raw.global_stats?.total_losses || 0),
        winRate: Number(raw.global_stats?.win_rate || 0),
        currentStreak: Number(raw.global_stats?.current_streak || 0),
        bestStreak: Number(raw.global_stats?.best_streak || 0),
        rating: Number(raw.global_stats?.rating || 1000),
        xp: Number(raw.global_stats?.xp || 0),
        level: Number(raw.global_stats?.level || 1),
      },
      selectedGameId: raw.selected_game_id || null,
      gameRank: raw.game_rank ? Number(raw.game_rank) : null,
      gameStatsList: (raw.game_stats_list || []).map((gs: any) => ({
        gameId: gs.game_id,
        totalMatches: Number(gs.total_matches || 0),
        totalWins: Number(gs.total_wins || 0),
        totalDraws: Number(gs.total_draws || 0),
        totalLosses: Number(gs.total_losses || 0),
        winRate: Number(gs.win_rate || 0),
        currentStreak: Number(gs.current_streak || 0),
        bestStreak: Number(gs.best_streak || 0),
        rating: Number(gs.rating || 1000),
        xp: Number(gs.xp || 0),
        level: Number(gs.level || 1),
      })),
    };

    return { success: true, data: summary };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao buscar estatísticas do jogador.',
    };
  }
}
