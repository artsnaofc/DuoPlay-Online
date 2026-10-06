// ============================================================================
// Network Engine: Synchronization & Realtime Subscription — DuoPlay-Online
// Phase: Fase 6 — Supabase Realtime + Sincronização Multiplayer
// ============================================================================

import { supabase } from '@/lib/supabase';
import type { GameSnapshot, MatchSnapshotListener } from './types';
import { getMatchSnapshot } from './snapshot';
import type { RealtimeChannel } from '@supabase/supabase-js';

// Fila de sincronização com coalescência para evitar tempestade de requisições concorrentes
interface SyncQueueItem<TState = unknown> {
  inFlightPromise: Promise<GameSnapshot<TState>> | null;
  hasPendingSync: boolean;
  latestSnapshot: GameSnapshot<TState> | null;
}

const syncQueues = new Map<string, SyncQueueItem<unknown>>();

function getOrCreateSyncQueue<TState>(matchId: string): SyncQueueItem<TState> {
  let queue = syncQueues.get(matchId) as SyncQueueItem<TState> | undefined;
  if (!queue) {
    queue = {
      inFlightPromise: null,
      hasPendingSync: false,
      latestSnapshot: null,
    };
    syncQueues.set(matchId, queue as SyncQueueItem<unknown>);
  }
  return queue;
}

/**
 * Sincroniza o estado local do cliente com a verdade absoluta do PostgreSQL.
 * Implementa coalescência de requisições concorrentes (evita tempestade de requests
 * caso múltiplos eventos Realtime cheguem em milissegundos próximos).
 * O PostgreSQL vence sempre.
 */
export async function syncMatch<TState = unknown>(
  matchId: string,
  _currentSnapshot?: GameSnapshot<TState> | null
): Promise<GameSnapshot<TState>> {
  if (!matchId || typeof matchId !== 'string') {
    throw new Error('INVALID_MATCH_ID: matchId obrigatório para sincronização.');
  }

  const queue = getOrCreateSyncQueue<TState>(matchId);

  // Se já houver um sync em andamento para este matchId, marcar que há novo sync pendente
  if (queue.inFlightPromise) {
    queue.hasPendingSync = true;
    return queue.inFlightPromise;
  }

  // Executar sincronização com o PostgreSQL
  const executeSync = async (): Promise<GameSnapshot<TState>> => {
    try {
      const snapshot = await getMatchSnapshot<TState>(matchId);
      queue.latestSnapshot = snapshot;
      return snapshot;
    } finally {
      queue.inFlightPromise = null;

      // Se novos eventos chegaram enquanto o sync estava em voo, executar mais um ciclo
      if (queue.hasPendingSync) {
        queue.hasPendingSync = false;
        queue.inFlightPromise = executeSync();
      }
    }
  };

  queue.inFlightPromise = executeSync();
  return queue.inFlightPromise;
}

/**
 * Executa a rotina de reconexão de rede após perda de conectividade física ou do socket.
 * Dispara sincronização com o PostgreSQL para obter o estado oficial mais recente.
 */
export async function reconnectMatch<TState = unknown>(
  matchId: string,
  currentSnapshot?: GameSnapshot<TState> | null
): Promise<GameSnapshot<TState>> {
  return syncMatch<TState>(matchId, currentSnapshot);
}

/**
 * Assina atualizações de uma partida via Supabase Realtime (Channel: `match:{matchId}`).
 * 
 * REGRA ARQUITETURAL FUNDAMENTAL (Fase 6):
 * O evento Realtime recebido NÃO é a fonte da verdade. Ele atua exclusivamente como
 * notificação de que houve alteração persistida em `public.matches`.
 * Ao receber a notificação, dispara `syncMatch(matchId)` para consultar o PostgreSQL
 * e notificar o listener com o snapshot oficial e íntegro.
 */
export function subscribeToMatch<TState = unknown>(
  matchId: string,
  listener: MatchSnapshotListener<TState>,
  onStatusChange?: (status: string) => void
): () => void {
  if (!matchId) {
    return () => {};
  }

  const channelName = `match:${matchId}`;

  try {
    // Criar canal específico para a partida no Supabase Realtime
    const channel: RealtimeChannel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'matches',
          filter: `id=eq.${matchId}`,
        },
        async (_payload) => {
          // REGRA DE OURO: Não aplicar o payload diretamente no estado do jogo.
          // O evento Realtime é apenas um gatilho ("algo mudou no banco").
          try {
            const authoritativeSnapshot = await syncMatch<TState>(matchId);
            listener(authoritativeSnapshot);
          } catch {
            // Em caso de falha de rede transitória no sync, o GameSessionController gerencia o estado de erro
          }
        }
      )
      .subscribe((status) => {
        onStatusChange?.(status);

        // Quando o canal for subscrito com sucesso, realizar um sync inicial para garantir alinhamento
        if (status === 'SUBSCRIBED') {
          syncMatch<TState>(matchId)
            .then((snapshot) => listener(snapshot))
            .catch(() => {});
        }
      });

    // Função de cancelamento e limpeza total (unsubscribe)
    const unsubscribe = () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // Ignora erros caso o canal já tenha sido descartado
      }
      syncQueues.delete(matchId);
    };

    return unsubscribe;
  } catch {
    // Fallback gracioso para ambientes de teste sem WebSocket
    return () => {
      syncQueues.delete(matchId);
    };
  }
}
