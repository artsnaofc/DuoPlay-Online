// ============================================================================
// Network Engine: Action Submission — DuoPlay-Online
// Phase: Fase 5 — Game Snapshot + Network/Sync Engine
// ============================================================================

import { supabase } from '@/lib/supabase';
import type { ActionResult, SubmitActionInput } from './types';
import { normalizeNetworkError } from './errors';
import { getMatchSnapshot } from './snapshot';

/**
 * Gera um identificador de ação único universal (UUID v4).
 * Sobrevive ao ciclo de retries da requisição garantindo idempotência.
 */
export function generateActionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback RFC4122 v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Submete uma intenção de ação do jogador ao PostgreSQL via RPC oficial submit_game_action.
 * O cliente nunca determina vencedor, estado ou próximo jogador diretamente.
 */
export async function submitAction<TState = unknown, TPayload = unknown>(
  input: SubmitActionInput<TPayload>
): Promise<ActionResult<TState>> {
  // 1. Validação básica de formato local (não substitui regras do servidor)
  if (!input.matchId || typeof input.matchId !== 'string') {
    return {
      accepted: false,
      snapshot: null,
      error: normalizeNetworkError({
        code: 'INVALID_MATCH_ID',
        message: 'Identificador da partida é obrigatório.',
        category: 'rule',
      }),
    };
  }

  if (!input.actionType || typeof input.actionType !== 'string') {
    return {
      accepted: false,
      snapshot: null,
      error: normalizeNetworkError({
        code: 'INVALID_ACTION_TYPE',
        message: 'Tipo de ação é obrigatório.',
        category: 'rule',
      }),
    };
  }

  const actionId = input.actionId || generateActionId();
  const clientTimestamp = input.clientTimestamp ?? Date.now();

  try {
    // 2. Chamar RPC oficial submit_game_action
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rpcResponse, error: rpcError } = await (supabase.rpc as any)(
      'submit_game_action',
      {
        p_match_id: input.matchId,
        p_action_id: actionId,
        p_action_type: input.actionType,
        p_payload: (input.payload ?? {}) as any,
        p_client_timestamp: clientTimestamp,
      }
    );

    if (rpcError) {
      const normalized = normalizeNetworkError(rpcError);
      return {
        accepted: false,
        snapshot: null,
        error: normalized,
      };
    }

    // 3. Validar se a resposta da RPC indica sucesso
    const responseData = rpcResponse as {
      success?: boolean;
      data?: {
        match_id?: string;
        turn_number?: number;
        game_state?: unknown;
        winner_id?: string | null;
        is_draw?: boolean;
        status?: string;
        idempotent?: boolean;
      };
      error?: { code?: string; message?: string } | null;
    } | null;

    if (responseData && responseData.success === false && responseData.error) {
      return {
        accepted: false,
        snapshot: null,
        error: normalizeNetworkError(responseData.error),
      };
    }

    // 4. Obter snapshot oficial atualizado do PostgreSQL
    const freshSnapshot = await getMatchSnapshot<TState>(input.matchId);

    return {
      accepted: true,
      snapshot: freshSnapshot,
      error: null,
      isIdempotent: Boolean(responseData?.data?.idempotent),
    };
  } catch (err) {
    const normalized = normalizeNetworkError(err);
    return {
      accepted: false,
      snapshot: null,
      error: normalized,
    };
  }
}
