// ============================================================================
// Service: Match History — DuoPlay-Online
// Phase: Fase 8.1 — Implementação do Resultado da Partida + Histórico
// Description: Consome a RPC get_my_match_history com paginação, normalização
//              e tratamento seguro de erros.
// ============================================================================

import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface MatchHistoryOpponent {
  user_id: string;
  display_name: string;
  username: string;
  slot: number;
  game_symbol: string | null;
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
      success: boolean;
      data?: MatchHistoryData;
      error?: { message: string; code: string } | string | null;
    };

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

    return {
      success: true,
      data: {
        matches: Array.isArray(payload.data.matches) ? payload.data.matches : [],
        total_count: Number(payload.data.total_count) || 0,
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
