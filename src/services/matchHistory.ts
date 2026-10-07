// ============================================================================
// Service: Match History — DuoPlay-Online
// Phase: Fase 8.2 — Correção de Recovery Pós-Partida e Validação
// Description: Consome a RPC get_my_match_history com validação defensiva,
//              paginação, normalização de dados e recuperação de partidas finalizadas.
// ============================================================================

import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface MatchHistoryOpponent {
  user_id: string;
  display_name: string;
  username: string;
  slot: number;
  game_symbol: string | null;
  avatar_url?: string | null;
  is_winner: boolean;
  score: number;
}

export type MatchOutcome = 'win' | 'loss' | 'draw' | 'cancelled';

export interface MatchHistoryItem {
  match_id: string;
  game_id: string;
  game_name: string;
  status: 'finished' | 'abandoned' | 'cancelled';
  winner_id: string | null;
  is_draw: boolean;
  finish_reason: 'normal' | 'resignation' | 'abandonment' | 'timeout' | 'rules_violation' | string | null;
  turn_number: number;
  started_at: string;
  finished_at: string | null;
  duration_seconds: number;
  my_slot: number;
  my_symbol: string | null;
  my_score: number;
  is_winner: boolean;
  outcome: MatchOutcome;
  opponents: MatchHistoryOpponent[];
}

export interface MatchHistoryData {
  matches: MatchHistoryItem[];
  total_count: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface MatchHistoryResponse {
  success: boolean;
  data?: MatchHistoryData;
  error?: string;
  code?: string;
}

/**
 * Normaliza e valida defensivamente um item de histórico recebido da RPC.
 */
function normalizeMatchItem(raw: unknown): MatchHistoryItem | null {
  if (!raw || typeof raw !== 'object') return null;

  const item = raw as Record<string, unknown>;
  const matchId = typeof item.match_id === 'string' ? item.match_id.trim() : '';
  if (!matchId) return null;

  const gameId = typeof item.game_id === 'string' ? item.game_id : 'tic_tac_toe';
  const gameName = typeof item.game_name === 'string' ? item.game_name : 'Jogo da Velha';

  const statusRaw = typeof item.status === 'string' ? item.status : 'finished';
  const status: 'finished' | 'abandoned' | 'cancelled' =
    statusRaw === 'abandoned' || statusRaw === 'cancelled' ? statusRaw : 'finished';

  const outcomeRaw = typeof item.outcome === 'string' ? item.outcome : 'cancelled';
  const outcome: MatchOutcome =
    outcomeRaw === 'win' || outcomeRaw === 'loss' || outcomeRaw === 'draw' ? outcomeRaw : 'cancelled';

  const opponents: MatchHistoryOpponent[] = [];
  if (Array.isArray(item.opponents)) {
    for (const opp of item.opponents) {
      if (opp && typeof opp === 'object') {
        const oppObj = opp as Record<string, unknown>;
        opponents.push({
          user_id: typeof oppObj.user_id === 'string' ? oppObj.user_id : '',
          display_name: typeof oppObj.display_name === 'string' ? oppObj.display_name : 'Adversário',
          username: typeof oppObj.username === 'string' ? oppObj.username : 'player',
          slot: Number(oppObj.slot) || 2,
          game_symbol: typeof oppObj.game_symbol === 'string' ? oppObj.game_symbol : null,
          is_winner: Boolean(oppObj.is_winner),
          score: Number(oppObj.score) || 0,
        });
      }
    }
  }

  return {
    match_id: matchId,
    game_id: gameId,
    game_name: gameName,
    status,
    winner_id: typeof item.winner_id === 'string' ? item.winner_id : null,
    is_draw: Boolean(item.is_draw),
    finish_reason: typeof item.finish_reason === 'string' ? item.finish_reason : null,
    turn_number: Number(item.turn_number) || 0,
    started_at: typeof item.started_at === 'string' ? item.started_at : new Date().toISOString(),
    finished_at: typeof item.finished_at === 'string' ? item.finished_at : null,
    duration_seconds: Number(item.duration_seconds) || 0,
    my_slot: Number(item.my_slot) || 1,
    my_symbol: typeof item.my_symbol === 'string' ? item.my_symbol : null,
    my_score: Number(item.my_score) || 0,
    is_winner: Boolean(item.is_winner),
    outcome,
    opponents,
  };
}

/**
 * Consulta o histórico paginado de partidas finalizadas do usuário autenticado.
 * A autoridade e a filtragem são estritamente executadas no servidor PostgreSQL via RPC.
 *
 * @param limit Quantidade de itens por página (padrão 20, máx 50)
 * @param offset Deslocamento para paginação (padrão 0)
 */
export async function getMyMatchHistory(
  limit = 20,
  offset = 0
): Promise<MatchHistoryResponse> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: 'Supabase não está configurado.',
      code: 'SUPABASE_NOT_CONFIGURED',
    };
  }

  try {
    const safeLimit = Math.max(1, Math.min(50, limit));
    const safeOffset = Math.max(0, offset);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_my_match_history', {
      p_limit: safeLimit,
      p_offset: safeOffset,
    });

    if (error) {
      return {
        success: false,
        error: error.message || 'Erro ao carregar histórico de partidas.',
        code: error.code,
      };
    }

    const payload = data as {
      success?: boolean;
      data?: {
        matches?: unknown[];
        total_count?: number;
        limit?: number;
        offset?: number;
        has_more?: boolean;
      };
      error?: { message?: string; code?: string } | string | null;
    } | null;

    if (!payload || payload.success !== true || !payload.data) {
      const errorMsg =
        typeof payload?.error === 'string'
          ? payload.error
          : payload?.error?.message || 'Histórico indisponível no momento.';
      return {
        success: false,
        error: errorMsg,
        code: typeof payload?.error === 'object' ? payload?.error?.code : undefined,
      };
    }

    const rawMatches = Array.isArray(payload.data.matches) ? payload.data.matches : [];
    const normalizedMatches: MatchHistoryItem[] = [];

    for (const rawItem of rawMatches) {
      const normalized = normalizeMatchItem(rawItem);
      if (normalized) {
        normalizedMatches.push(normalized);
      }
    }

    return {
      success: true,
      data: {
        matches: normalizedMatches,
        total_count: Number(payload.data.total_count) || normalizedMatches.length,
        limit: Number(payload.data.limit) || safeLimit,
        offset: Number(payload.data.offset) || safeOffset,
        has_more: Boolean(payload.data.has_more),
      },
    };
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : 'Erro inesperado ao consultar histórico.';
    return {
      success: false,
      error: errorMsg,
      code: 'UNEXPECTED_ERROR',
    };
  }
}

/**
 * Consulta a partida finalizada mais recente do usuário (ordenada por finished_at DESC)
 * utilizando a RPC dedicada get_latest_completed_match_for_current_user para recovery oficial de resultado pós-jogo.
 */
export async function getLatestCompletedMatchForCurrentUser(): Promise<{
  success: boolean;
  data: MatchHistoryItem | null;
  error?: string;
  code?: string;
}> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      data: null,
      error: 'Supabase não está configurado.',
      code: 'SUPABASE_NOT_CONFIGURED',
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_latest_completed_match_for_current_user');

    if (error) {
      return {
        success: false,
        data: null,
        error: error.message || 'Erro ao consultar partida finalizada.',
        code: error.code,
      };
    }

    const payload = data as {
      success?: boolean;
      data?: unknown;
      error?: { message?: string; code?: string } | string | null;
    } | null;

    if (!payload || payload.success !== true) {
      const errorMsg =
        typeof payload?.error === 'string'
          ? payload.error
          : payload?.error?.message || 'Dados de partida finalizada indisponíveis.';
      return {
        success: false,
        data: null,
        error: errorMsg,
        code: typeof payload?.error === 'object' ? payload?.error?.code : undefined,
      };
    }

    if (!payload.data) {
      return { success: true, data: null };
    }

    const normalized = normalizeMatchItem(payload.data);
    return { success: true, data: normalized };
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : 'Erro inesperado ao consultar partida finalizada.';
    return {
      success: false,
      data: null,
      error: errorMsg,
      code: 'UNEXPECTED_ERROR',
    };
  }
}
