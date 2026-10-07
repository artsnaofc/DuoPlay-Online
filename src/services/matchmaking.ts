// ============================================================================
// Service: Public Matchmaking — DuoPlay-Online
// Phase: Fase 10 — Matchmaking Público para Jogo da Velha
// Description: Consome as RPCs autoritativas (join_matchmaking_queue,
//              cancel_matchmaking_queue, get_my_matchmaking_status) para
//              fila de pareamento pública em tempo real no PostgreSQL.
// ============================================================================

import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface MatchmakingQueueInfo {
  queue_id?: string;
  game_id?: string;
  status: 'waiting' | 'matched' | 'cancelled' | 'expired' | 'completed';
  match_id?: string | null;
  expires_at?: string;
  created_at?: string;
}

export interface MatchmakingResult<T = MatchmakingQueueInfo> {
  success: boolean;
  data?: T | null;
  error?: string;
  code?: string;
}

/**
 * Entra na fila pública de matchmaking para o jogo especificado (padrão: tic_tac_toe).
 */
export async function joinMatchmakingQueue(
  gameId: string = 'tic_tac_toe'
): Promise<MatchmakingResult> {
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
    const { data, error } = await (supabase.rpc as any)('join_matchmaking_queue', {
      p_game_id: gameId,
    });

    if (error) {
      return {
        success: false,
        data: null,
        error: error.message || 'Erro ao entrar na fila de matchmaking.',
        code: error.code,
      };
    }

    const payload = data as {
      success?: boolean;
      data?: MatchmakingQueueInfo;
      code?: string;
      error?: { message?: string; code?: string } | string | null;
    } | null;

    if (!payload || payload.success !== true || !payload.data) {
      const errorMsg =
        typeof payload?.error === 'string'
          ? payload.error
          : payload?.error?.message || 'Falha ao processar entrada na fila de matchmaking.';
      const errorCode =
        payload?.code ||
        (typeof payload?.error === 'object' ? payload?.error?.code : undefined);
      return {
        success: false,
        data: null,
        error: errorMsg,
        code: errorCode,
      };
    }

    return { success: true, data: payload.data };
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : 'Erro inesperado ao entrar na fila de matchmaking.';
    return {
      success: false,
      data: null,
      error: errorMsg,
      code: 'UNEXPECTED_ERROR',
    };
  }
}

/**
 * Cancela a busca na fila pública de matchmaking do usuário atual.
 */
export async function cancelMatchmakingQueue(): Promise<MatchmakingResult> {
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
    const { data, error } = await (supabase.rpc as any)('cancel_matchmaking_queue');

    if (error) {
      return {
        success: false,
        data: null,
        error: error.message || 'Erro ao cancelar fila de matchmaking.',
        code: error.code,
      };
    }

    const payload = data as {
      success?: boolean;
      data?: MatchmakingQueueInfo;
      code?: string;
      error?: { message?: string; code?: string } | string | null;
    } | null;

    if (!payload || payload.success !== true || !payload.data) {
      const errorMsg =
        typeof payload?.error === 'string'
          ? payload.error
          : payload?.error?.message || 'Falha ao cancelar busca na fila.';
      const errorCode =
        payload?.code ||
        (typeof payload?.error === 'object' ? payload?.error?.code : undefined);
      return {
        success: false,
        data: null,
        error: errorMsg,
        code: errorCode,
      };
    }

    return { success: true, data: payload.data };
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : 'Erro inesperado ao cancelar busca na fila.';
    return {
      success: false,
      data: null,
      error: errorMsg,
      code: 'UNEXPECTED_ERROR',
    };
  }
}

/**
 * Consulta o status atual da busca na fila pública de matchmaking do usuário autenticado.
 */
export async function getMyMatchmakingStatus(): Promise<MatchmakingResult> {
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
    const { data, error } = await (supabase.rpc as any)('get_my_matchmaking_status');

    if (error) {
      return {
        success: false,
        data: null,
        error: error.message || 'Erro ao consultar status da fila.',
        code: error.code,
      };
    }

    const payload = data as {
      success?: boolean;
      data?: MatchmakingQueueInfo | null;
      code?: string;
      error?: { message?: string; code?: string } | string | null;
    } | null;

    if (!payload || payload.success !== true) {
      const errorMsg =
        typeof payload?.error === 'string'
          ? payload.error
          : payload?.error?.message || 'Falha ao consultar status da fila de matchmaking.';
      const errorCode =
        payload?.code ||
        (typeof payload?.error === 'object' ? payload?.error?.code : undefined);
      return {
        success: false,
        data: null,
        error: errorMsg,
        code: errorCode,
      };
    }

    return { success: true, data: payload.data || null };
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : 'Erro inesperado ao consultar status da fila.';
    return {
      success: false,
      data: null,
      error: errorMsg,
      code: 'UNEXPECTED_ERROR',
    };
  }
}
