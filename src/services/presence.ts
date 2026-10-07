// ============================================================================
// Service: User Presence & Heartbeat Lease — DuoPlay-Online
// Phase: Fase 14.2 — Sincronização de Status Online com Lease de Presença & Heartbeat
// Description: Envio periódico de heartbeat para manter o lease de presença
//              ativo no PostgreSQL, garantindo que o status online seja reflexo
//              de uma aplicação realmente ativa e conectada.
// ============================================================================

import { supabase } from '@/lib/supabase';
import { safeRefreshSession, isAuthOrTokenExpiredError } from './auth';

let inFlightHeartbeatPromise: Promise<{ success: boolean; error?: string }> | null = null;
let lastSuccessfulHeartbeatTime = 0;

/**
 * Envia um tick de heartbeat de presença para o backend.
 * Atualiza `user_presence.last_seen_at` mantendo o usuário visível como 🟢 Online.
 */
export async function sendPresenceHeartbeat(): Promise<{ success: boolean; error?: string }> {
  // Se o dispositivo no navegador estiver comprovadamente offline, não dispara requisição
  if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { success: false, error: 'Sem conexão com a internet.' };
  }

  // Mutex para evitar múltiplos ticks concorrentes simultâneos
  if (inFlightHeartbeatPromise) {
    return inFlightHeartbeatPromise;
  }

  inFlightHeartbeatPromise = (async () => {
    try {
      const executeCall = async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (supabase.rpc as any)('heartbeat_presence');
      };

      let { data, error } = await executeCall();

      // Tratamento resiliente de JWT expirado
      if (error && isAuthOrTokenExpiredError(error)) {
        const refreshRes = await safeRefreshSession();
        if (refreshRes.success) {
          const retryRes = await executeCall();
          data = retryRes.data;
          error = retryRes.error;
        }
      }

      if (error) {
        return { success: false, error: error.message || 'Erro ao enviar heartbeat de presença.' };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = data as any;
      if (payload && payload.success === false) {
        return { success: false, error: payload.error?.message || 'Falha ao atualizar presença.' };
      }

      lastSuccessfulHeartbeatTime = Date.now();
      return { success: true };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Falha inesperada no heartbeat de presença.';
      return { success: false, error: errMsg };
    } finally {
      inFlightHeartbeatPromise = null;
    }
  })();

  return inFlightHeartbeatPromise;
}

/**
 * Retorna o timestamp (ms) do último heartbeat bem-sucedido.
 */
export function getLastPresenceHeartbeatTime(): number {
  return lastSuccessfulHeartbeatTime;
}
