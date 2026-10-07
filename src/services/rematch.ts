// ============================================================================
// Service: Rematch System — DuoPlay-Online
// Phase: Fase 9 — Rematch com Aceite Bilateral
// Description: Consome as RPCs autoritativas de solicitação, resposta e
//              consulta de status de revanche (request_rematch, respond_to_rematch,
//              get_pending_rematch_for_match).
// ============================================================================

import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface RematchInfo {
  rematch_request_id: string;
  original_match_id: string;
  game_id?: string;
  requester_id?: string;
  opponent_id?: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';
  new_match_id?: string | null;
  is_my_request?: boolean;
  expires_at?: string;
  created_at?: string;
}

export interface RematchResult<T = RematchInfo> {
  success: boolean;
  data?: T | null;
  error?: string;
  code?: string;
}

/**
  Solicita uma revanche para a partida original encerrada.
 */
export async function requestRematch(
  originalMatchId: string
): Promise<RematchResult> {
  if (!isSupabaseConfigured || !originalMatchId) {
    return {
      success: false,
      data: null,
      error: 'Supabase não configurado ou ID da partida original inválido.',
      code: 'INVALID_PARAMS',
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('request_rematch', {
      p_original_match_id: originalMatchId,
    });

    if (error) {
      return {
        success: false,
        data: null,
        error: error.message || 'Erro ao solicitar revanche.',
        code: error.code,
      };
    }

    const payload = data as {
      success?: boolean;
      data?: RematchInfo;
      code?: string;
      error?: { message?: string; code?: string } | string | null;
    } | null;

    if (!payload || payload.success !== true || !payload.data) {
      const errorMsg =
        typeof payload?.error === 'string'
          ? payload.error
          : payload?.error?.message || 'Falha ao processar solicitação de revanche.';
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
      err instanceof Error ? err.message : 'Erro inesperado ao solicitar revanche.';
    return {
      success: false,
      data: null,
      error: errorMsg,
      code: 'UNEXPECTED_ERROR',
    };
  }
}

/**
  Responde (aceita ou recusa) a uma solicitação de revanche.
 */
export async function respondToRematch(
  rematchRequestId: string,
  accept: boolean
): Promise<RematchResult> {
  if (!isSupabaseConfigured || !rematchRequestId) {
    return {
      success: false,
      data: null,
      error: 'Supabase não configurado ou ID de revanche inválido.',
      code: 'INVALID_PARAMS',
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('respond_to_rematch', {
      p_rematch_request_id: rematchRequestId,
      p_accept: accept,
    });

    if (error) {
      return {
        success: false,
        data: null,
        error: error.message || 'Erro ao responder pedido de revanche.',
        code: error.code,
      };
    }

    const payload = data as {
      success?: boolean;
      data?: RematchInfo;
      code?: string;
      error?: { message?: string; code?: string } | string | null;
    } | null;

    if (!payload || payload.success !== true || !payload.data) {
      const errorMsg =
        typeof payload?.error === 'string'
          ? payload.error
          : payload?.error?.message || 'Falha ao responder solicitação de revanche.';
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
      err instanceof Error ? err.message : 'Erro inesperado ao responder solicitação de revanche.';
    return {
      success: false,
      data: null,
      error: errorMsg,
      code: 'UNEXPECTED_ERROR',
    };
  }
}

/**
  Consulta o estado atual de revanche para uma determinada partida original.
 */
export async function getPendingRematchForMatch(
  originalMatchId: string
): Promise<RematchResult> {
  if (!isSupabaseConfigured || !originalMatchId) {
    return {
      success: false,
      data: null,
      error: 'Supabase não configurado ou ID da partida original inválido.',
      code: 'INVALID_PARAMS',
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_pending_rematch_for_match', {
      p_original_match_id: originalMatchId,
    });

    if (error) {
      return {
        success: false,
        data: null,
        error: error.message || 'Erro ao consultar revanche.',
        code: error.code,
      };
    }

    const payload = data as {
      success?: boolean;
      data?: RematchInfo | null;
      error?: { message?: string; code?: string } | string | null;
    } | null;

    if (!payload || payload.success !== true) {
      const errorMsg =
        typeof payload?.error === 'string'
          ? payload.error
          : payload?.error?.message || 'Falha ao consultar estado de revanche.';
      return {
        success: false,
        data: null,
        error: errorMsg,
        code: typeof payload?.error === 'object' ? payload?.error?.code : undefined,
      };
    }

    return { success: true, data: payload.data || null };
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : 'Erro inesperado ao consultar revanche.';
    return {
      success: false,
      data: null,
      error: errorMsg,
      code: 'UNEXPECTED_ERROR',
    };
  }
}
