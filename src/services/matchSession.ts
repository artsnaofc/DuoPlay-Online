// ============================================================================
// Service: Match Session, Presence & Recovery — DuoPlay-Online
// Phase: Fase 7.1 — Desconexão, Abandono e Retomada de Partida
// Description: Gerencia o envio de heartbeat, verificação de partida ativa,
//              desistência oficial e reivindicação de abandono por Grace Period.
// ============================================================================

import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface ActiveMatchOpponent {
  user_id: string;
  display_name: string;
  slot: number;
  connection_status: 'connected' | 'disconnected';
}

export interface ActiveMatchInfo {
  match_id: string;
  room_id: string | null;
  game_id: string;
  game_name: string;
  turn_number: number;
  current_turn_player_id: string | null;
  opponent: ActiveMatchOpponent | null;
}

export interface MatchHeartbeatResult {
  match_id: string;
  status: string;
  is_finished?: boolean;
  players?: {
    user_id: string;
    slot: number;
    connection_status: 'connected' | 'disconnected';
    last_seen_at: string;
    disconnected_at: string | null;
    grace_period_expires_at: string | null;
  }[];
  server_time?: string;
}

export interface MatchOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export function sanitizeMatchErrorMessage(rawMsg: string | undefined, defaultMsg: string): string {
  if (!rawMsg) return defaultMsg;
  if (rawMsg.includes('Failed to fetch') || rawMsg.includes('NetworkError') || rawMsg.includes('fetch')) {
    return 'Erro de conexão com o servidor. Verifique sua conexão.';
  }
  if (rawMsg.includes('JWT') || rawMsg.includes('token') || rawMsg.includes('UNAUTHORIZED') || rawMsg.includes('P0001')) {
    return 'Você precisa estar logado para realizar esta ação.';
  }
  if (rawMsg.includes('syntax for type uuid') || rawMsg.includes('violates foreign key')) {
    return 'A partida solicitada não foi encontrada.';
  }
  if (rawMsg.startsWith('SQLSTATE') || rawMsg.includes('PostgresError') || rawMsg.includes('internal error')) {
    return defaultMsg;
  }
  return rawMsg;
}

/**
 * Envia sinal de heartbeat periódico (a cada ~5s) para o PostgreSQL.
 * Atualiza last_seen_at do jogador atual e detecta desconexão do adversário.
 */
export async function heartbeatMatch(
  matchId: string
): Promise<MatchOperationResult<MatchHeartbeatResult>> {
  if (!isSupabaseConfigured || !matchId) {
    return { success: false, error: 'Supabase não configurado ou matchId inválido.' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('heartbeat_match', {
      p_match_id: matchId,
    });

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    const payload = data as { success: boolean; data?: MatchHeartbeatResult; error?: { message: string; code: string } };
    if (!payload?.success || !payload.data) {
      return {
        success: false,
        error: payload?.error?.message || 'Falha no heartbeat.',
        code: payload?.error?.code,
      };
    }

    return { success: true, data: payload.data };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Erro ao enviar heartbeat.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Detecta se o usuário autenticado possui uma partida ativa em andamento no PostgreSQL.
 * Utilizado ao inicializar o app, login ou reload de página.
 */
export async function getActiveMatchForCurrentUser(): Promise<MatchOperationResult<ActiveMatchInfo | null>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase não configurado.' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_active_match_for_current_user');

    if (error) {
      return { success: false, error: sanitizeMatchErrorMessage(error.message, 'Não foi possível buscar partida ativa.'), code: error.code };
    }

    const payload = data as { success: boolean; data?: ActiveMatchInfo | null; error?: { message: string; code: string } };
    if (!payload?.success) {
      return {
        success: false,
        error: sanitizeMatchErrorMessage(payload?.error?.message, 'Falha ao buscar partida ativa.'),
        code: payload?.error?.code,
      };
    }

    return { success: true, data: payload.data || null };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Erro ao verificar partida ativa.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Executa a desistência / abandono voluntário da partida pelo usuário.
 * O backend declara o oponente como vencedor e encerra a partida.
 */
export async function abandonMatch(
  matchId: string
): Promise<MatchOperationResult<{ match_id: string; status: string; winner_id: string | null }>> {
  if (!isSupabaseConfigured || !matchId) {
    return { success: false, error: 'Supabase não configurado ou matchId inválido.' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('abandon_match', {
      p_match_id: matchId,
    });

    if (error) {
      return { success: false, error: sanitizeMatchErrorMessage(error.message, 'Não foi possível abandonar a partida.'), code: error.code };
    }

    const payload = data as {
      success: boolean;
      data?: { match_id: string; status: string; winner_id: string | null };
      error?: { message: string; code: string };
    };

    if (!payload?.success || !payload.data) {
      return {
        success: false,
        error: sanitizeMatchErrorMessage(payload?.error?.message, 'Falha ao processar abandono da partida.'),
        code: payload?.error?.code,
      };
    }

    return { success: true, data: payload.data };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? sanitizeMatchErrorMessage(err.message, 'Erro ao abandonar partida.') : 'Erro ao abandonar partida.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Reivindica vitória por abandono (W.O.) quando o adversário permaneceu desconectado
 * e o Grace Period de 45 segundos expirou segundo o relógio do servidor PostgreSQL.
 */
export async function claimAbandonment(
  matchId: string
): Promise<MatchOperationResult<{ match_id: string; status: string; winner_id: string | null }>> {
  if (!isSupabaseConfigured || !matchId) {
    return { success: false, error: 'Supabase não configurado ou matchId inválido.' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('claim_abandonment', {
      p_match_id: matchId,
    });

    if (error) {
      const msg = error.code === 'P0035'
        ? 'O prazo de tolerância (Grace Period) do adversário ainda não expirou no servidor.'
        : error.code === 'P0034'
        ? 'O adversário ainda está conectado.'
        : sanitizeMatchErrorMessage(error.message, 'Não foi possível reivindicar vitória por abandono.');
      return { success: false, error: msg, code: error.code };
    }

    const payload = data as {
      success: boolean;
      data?: { match_id: string; status: string; winner_id: string | null };
      error?: { message: string; code: string };
    };

    if (!payload?.success || !payload.data) {
      return {
        success: false,
        error: sanitizeMatchErrorMessage(payload?.error?.message, 'Falha ao reivindicar vitória por abandono.'),
        code: payload?.error?.code,
      };
    }

    return { success: true, data: payload.data };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Erro ao reivindicar abandono.';
    return { success: false, error: errorMsg };
  }
}
