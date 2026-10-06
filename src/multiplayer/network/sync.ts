// ============================================================================
// Network Engine: Synchronization & Realtime Subscription — DuoPlay-Online
// Phase: Fase 6.1 — Hardening do Supabase Realtime
// ============================================================================

import { supabase } from '@/lib/supabase';
import type { GameSnapshot, MatchSnapshotListener } from './types';
import { getMatchSnapshot } from './snapshot';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Estrutura de gerenciamento de fila de sincronização por partida.
 * Implementa coalescência com garantia de entrega do snapshot mais recente:
 * 
 * 1. inFlightPromise: Sincronização atualmente em execução contra o PostgreSQL.
 * 2. queuedDeferred: Próxima sincronização agendada para rodar assim que a atual terminar.
 *    Todos os chamadores concorrentes que chegam durante o inFlight compartilham
 *    esta mesma Promise futura.
 * 3. latestSnapshot: Cache em memória do último snapshot autoritativo retornado.
 */
interface DeferredSync<TState = unknown> {
  promise: Promise<GameSnapshot<TState>>;
  resolve: (snapshot: GameSnapshot<TState>) => void;
  reject: (error: unknown) => void;
}

interface SyncQueueItem<TState = unknown> {
  inFlightPromise: Promise<GameSnapshot<TState>> | null;
  queuedDeferred: DeferredSync<TState> | null;
  latestSnapshot: GameSnapshot<TState> | null;
}

const syncQueues = new Map<string, SyncQueueItem<unknown>>();

function getOrCreateSyncQueue<TState>(matchId: string): SyncQueueItem<TState> {
  let queue = syncQueues.get(matchId) as SyncQueueItem<TState> | undefined;
  if (!queue) {
    queue = {
      inFlightPromise: null,
      queuedDeferred: null,
      latestSnapshot: null,
    };
    syncQueues.set(matchId, queue as SyncQueueItem<unknown>);
  }
  return queue;
}

/**
 * Sincroniza o estado local com a autoridade absoluta do PostgreSQL.
 * Implementa coalescência estrita (Request Coalescing):
 * 
 * - Se nenhuma requisição estiver em voo: executa imediatamente.
 * - Se já houver uma requisição em voo: enfileira uma próxima requisição.
 * - Se múltiplos eventos chegarem durante o voo: todos aguardam a MESMA próxima
 *   requisição, evitando tempestade de requisições e garantindo que o snapshot
 *   mais recente seja entregue a todos os chamadores.
 */
export async function syncMatch<TState = unknown>(
  matchId: string,
  _currentSnapshot?: GameSnapshot<TState> | null
): Promise<GameSnapshot<TState>> {
  if (!matchId || typeof matchId !== 'string') {
    throw new Error('INVALID_MATCH_ID: matchId obrigatório para sincronização.');
  }

  const queue = getOrCreateSyncQueue<TState>(matchId);

  // Se já houver um sync em andamento:
  if (queue.inFlightPromise) {
    // Se já existir uma requisição enfileirada para depois deste voo, reutilizá-la
    if (queue.queuedDeferred) {
      return queue.queuedDeferred.promise;
    }

    // Criar uma requisição enfileirada compartilhada por todas as chegadas concorrentes
    let resolveDeferred!: (snapshot: GameSnapshot<TState>) => void;
    let rejectDeferred!: (error: unknown) => void;

    const promise = new Promise<GameSnapshot<TState>>((resolve, reject) => {
      resolveDeferred = resolve;
      rejectDeferred = reject;
    });

    queue.queuedDeferred = {
      promise,
      resolve: resolveDeferred,
      reject: rejectDeferred,
    };

    return promise;
  }

  // Função interna que executa o ciclo de busca e drena a fila
  const runSyncCycle = async (): Promise<GameSnapshot<TState>> => {
    try {
      const snapshot = await getMatchSnapshot<TState>(matchId);
      queue.latestSnapshot = snapshot;
      return snapshot;
    } finally {
      queue.inFlightPromise = null;

      // Se houver uma requisição enfileirada que chegou enquanto este sync estava em voo:
      if (queue.queuedDeferred) {
        const nextDeferred = queue.queuedDeferred;
        queue.queuedDeferred = null;

        // Inicia o próximo ciclo imediatamente e conecta a Promise do deferred
        const nextPromise = runSyncCycle();
        queue.inFlightPromise = nextPromise;

        nextPromise
          .then((snap) => nextDeferred.resolve(snap))
          .catch((err) => nextDeferred.reject(err));
      }
    }
  };

  const currentPromise = runSyncCycle();
  queue.inFlightPromise = currentPromise;
  return currentPromise;
}

/**
 * Executa a rotina de reconexão de rede após oscilação ou reconexão física.
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
 * GARANTIAS DE HARDENING (Fase 6.1):
 * 1. Realtime NÃO é fonte de dados — atua unicamente como gatilho de notificação.
 * 2. Ao receber notificação, dispara `syncMatch` que coalescerá chamadas e consultará o PostgreSQL.
 * 3. Flag de ciclo de vida (`isSubscribed`) impede que callbacks tardios de requisições em voo
 *    chamem o listener após `unsubscribe()`.
 * 4. Limpeza completa de recursos e canais do Supabase Realtime.
 */
export function subscribeToMatch<TState = unknown>(
  matchId: string,
  listener: MatchSnapshotListener<TState>,
  onStatusChange?: (status: string) => void
): () => void {
  if (!matchId) {
    return () => {};
  }

  let isSubscribed = true;
  const channelName = `match:${matchId}`;

  try {
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
        async () => {
          if (!isSubscribed) return;

          try {
            const authoritativeSnapshot = await syncMatch<TState>(matchId);
            if (isSubscribed) {
              listener(authoritativeSnapshot);
            }
          } catch {
            // Em caso de falha transitória de rede, o controller gerencia o estado de erro
          }
        }
      )
      .subscribe((status) => {
        if (!isSubscribed) return;
        onStatusChange?.(status);

        // Ao conectar com sucesso, busca o snapshot atual para garantir integridade inicial
        if (status === 'SUBSCRIBED') {
          syncMatch<TState>(matchId)
            .then((snapshot) => {
              if (isSubscribed) {
                listener(snapshot);
              }
            })
            .catch(() => {});
        }
      });

    // Função de desinscrição e limpeza idempotente
    const unsubscribe = () => {
      if (!isSubscribed) return;
      isSubscribed = false;

      try {
        supabase.removeChannel(channel);
      } catch {
        // Ignora erros caso o canal já tenha sido descartado
      }
    };

    return unsubscribe;
  } catch {
    // Fallback gracioso para ambientes isolados de teste
    return () => {
      isSubscribed = false;
    };
  }
}

/**
 * Função utilitária para testes: limpa o estado das filas de sincronização.
 */
export function clearSyncQueuesForTest(): void {
  syncQueues.clear();
}
