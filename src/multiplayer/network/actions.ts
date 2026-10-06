// ============================================================================
// Network Engine: Action Submission — DuoPlay-Online
// Phase: Fase 5 — Game Snapshot + Network/Sync Engine
// ============================================================================

import { supabase } from '@/lib/supabase';
import type { ActionResult, SubmitActionInput } from './types';
import { normalizeNetworkError } from './errors';
import { getMatchSnapshot } from './snapshot';

/**
 * Converte um buffer de 16 bytes em string UUID v4 (RFC 4122).
 */
export function formatUuidV4FromBytes(bytes: Uint8Array): string {
  // RFC 4122 v4: define os 4 bits mais significativos do byte 6 como 0100 (versão 4)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // RFC 4122 v4: define os 2 bits mais significativos do byte 8 como 10 (variante 1)
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }

  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/**
 * Gera um UUID v4 utilizando estritamente crypto.getRandomValues().
 */
export function generateActionIdFromRandomValues(
  cryptoInstance?: Pick<Crypto, 'getRandomValues'>
): string {
  const resolvedCrypto =
    cryptoInstance ||
    (typeof globalThis !== 'undefined' && globalThis.crypto ? globalThis.crypto : null);

  if (!resolvedCrypto || typeof resolvedCrypto.getRandomValues !== 'function') {
    throw new Error(
      'SECURE_CRYPTO_UNAVAILABLE: O ambiente não possui suporte à Web Crypto API (getRandomValues).'
    );
  }

  const bytes = new Uint8Array(16);
  resolvedCrypto.getRandomValues(bytes);
  return formatUuidV4FromBytes(bytes);
}

/**
 * Gera um identificador de ação único universal (UUID v4).
 * Prioridade: crypto.randomUUID() nativo.
 * Fallback seguro: crypto.getRandomValues().
 * NUNCA utiliza Math.random() para identificadores de operações multiplayer.
 * Sobrevive ao ciclo de retries da requisição garantindo idempotência.
 */
export function generateActionId(): string {
  const cryptoObj =
    typeof globalThis !== 'undefined' && globalThis.crypto
      ? globalThis.crypto
      : typeof crypto !== 'undefined'
        ? crypto
        : null;

  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }

  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    return generateActionIdFromRandomValues(cryptoObj);
  }

  throw new Error(
    'SECURE_CRYPTO_UNAVAILABLE: Web Crypto API não disponível para geração segura de UUID.'
  );
}

/**
 * Submete uma intenção de ação do jogador ao PostgreSQL via RPC oficial submit_game_action.
 * O cliente nunca determina vencedor, estado ou próximo jogador diretamente.
 * Preserva estritamente o actionId durante retries para garantir idempotência no banco de dados.
 */
export async function submitAction<TState = unknown, TPayload = unknown>(
  input: SubmitActionInput<TPayload>
): Promise<ActionResult<TState>> {
  // 1. Resolver actionId garantindo estabilidade durante retries
  const actionId =
    input.actionId && typeof input.actionId === 'string' && input.actionId.trim() !== ''
      ? input.actionId.trim()
      : generateActionId();

  // Preservar no envelope da requisição se for mutável
  if (input && typeof input === 'object' && !input.actionId) {
    input.actionId = actionId;
  }

  // 2. Validação básica de formato local (não substitui regras do servidor)
  if (!input.matchId || typeof input.matchId !== 'string') {
    return {
      accepted: false,
      snapshot: null,
      error: normalizeNetworkError({
        code: 'INVALID_MATCH_ID',
        message: 'Identificador da partida é obrigatório.',
        category: 'rule',
      }),
      actionId,
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
      actionId,
    };
  }

  const clientTimestamp = input.clientTimestamp ?? Date.now();

  try {
    // 3. Chamar RPC oficial submit_game_action
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
        actionId,
      };
    }

    // 4. Validar se a resposta da RPC indica sucesso
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
        actionId,
      };
    }

    // 5. Obter snapshot oficial atualizado do PostgreSQL
    const freshSnapshot = await getMatchSnapshot<TState>(input.matchId);

    return {
      accepted: true,
      snapshot: freshSnapshot,
      error: null,
      actionId,
      isIdempotent: Boolean(responseData?.data?.idempotent),
    };
  } catch (err) {
    const normalized = normalizeNetworkError(err);
    return {
      accepted: false,
      snapshot: null,
      error: normalized,
      actionId,
    };
  }
}
