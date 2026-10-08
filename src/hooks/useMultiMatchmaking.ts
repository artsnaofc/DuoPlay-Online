// ============================================================================
// Hook / State: useMultiMatchmaking — DuoPlay-Online
// Phase: Fase 23 — Matchmaking Simultâneo Multijogo
// Description: Gerencia o ciclo de vida de múltiplas filas de matchmaking
//              simultâneas (um por game_id), polling seguro sem sobreposição,
//              cancelamento individual/total e transição atômica quando um match é encontrado.
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  joinMatchmakingQueue,
  cancelMatchmakingQueue,
  getMyActiveMatchmakingQueues,
  type MatchmakingQueueInfo,
} from '@/services/matchmaking';
import { useAuth } from '@/hooks/useAuth';

export interface GameQueueState {
  gameId: string;
  status: 'idle' | 'joining' | 'waiting' | 'matched' | 'cancelled' | 'error';
  queueId?: string;
  matchId?: string | null;
  enteredAt?: number;
  error?: string | null;
}

export interface MultiMatchmakingState {
  queues: Record<string, GameQueueState>;
  activeCount: number;
  isSearchingAny: boolean;
  startSearch: (gameIds: string[]) => Promise<void>;
  cancelGameSearch: (gameId: string) => Promise<void>;
  cancelAllSearches: () => Promise<void>;
  syncActiveQueues: () => Promise<void>;
}

export const normalizeGameId = (id: string): string => id.replace(/-/g, '_');

export function useMultiMatchmaking(
  onMatchFound?: (matchId: string, gameId?: string) => void
): MultiMatchmakingState {
  const { isAuthenticated, user } = useAuth();
  const [queues, setQueues] = useState<Record<string, GameQueueState>>({});

  const isMountedRef = useRef<boolean>(true);
  const isPollingRef = useRef<boolean>(false);
  const navigatedMatchIdRef = useRef<string | null>(null);
  const onMatchFoundRef = useRef(onMatchFound);
  onMatchFoundRef.current = onMatchFound;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Sincroniza e reconcilia filas ativas do servidor
  const syncActiveQueues = useCallback(async () => {
    if (!isAuthenticated || !user || isPollingRef.current || !isMountedRef.current) return;
    isPollingRef.current = true;

    try {
      const res = await getMyActiveMatchmakingQueues();
      if (!isMountedRef.current) return;

      if (res.success && res.data) {
        const activeList = res.data;

        // Verifica se há alguma fila pareada com match_id válido
        const matchedItem = activeList.find((item) => item.status === 'matched' && item.match_id);

        if (matchedItem && matchedItem.match_id) {
          const matchId = matchedItem.match_id;
          if (navigatedMatchIdRef.current !== matchId) {
            navigatedMatchIdRef.current = matchId;
            setQueues({});
            onMatchFoundRef.current?.(matchId, matchedItem.game_id);
            return;
          }
        }

        // Mapeia o estado retornado para as filas locais com mapeamento duplo (hífen e underscore)
        setQueues((prev) => {
          const updated: Record<string, GameQueueState> = {};

          // Preserva filas em estado 'joining' em voo que ainda não retornaram
          for (const [k, v] of Object.entries(prev)) {
            if (v.status === 'joining') {
              updated[k] = v;
              updated[normalizeGameId(k)] = v;
            }
          }

          // Mantém ou atualiza filas que estão no backend
          for (const item of activeList) {
            if (!item.game_id) continue;
            const normId = normalizeGameId(item.game_id);
            const hyphenId = normId.replace(/_/g, '-');
            const existing = prev[normId] || prev[hyphenId] || prev[item.game_id];
            const state: GameQueueState = {
              gameId: normId,
              status: item.status === 'matched' ? 'matched' : 'waiting',
              queueId: item.queue_id,
              matchId: item.match_id,
              enteredAt: existing?.enteredAt || (item.created_at ? new Date(item.created_at).getTime() : Date.now()),
              error: null,
            };
            updated[normId] = state;
            updated[hyphenId] = state;
            updated[item.game_id] = state;
          }

          return updated;
        });
      }
    } catch {
      // Ignora erros transitórios no loop
    } finally {
      isPollingRef.current = false;
    }
  }, [isAuthenticated, user]);

  // Recupera buscas ativas na inicialização / login
  useEffect(() => {
    if (isAuthenticated && user) {
      syncActiveQueues();
    } else {
      setQueues({});
    }
  }, [isAuthenticated, user, syncActiveQueues]);

  // Contagem de filas ativas únicas (desduplicando aliases de id)
  const uniqueActiveGameIds = new Set(
    Object.values(queues)
      .filter((q) => q.status === 'waiting' || q.status === 'joining')
      .map((q) => normalizeGameId(q.gameId))
  );
  const activeCount = uniqueActiveGameIds.size;
  const isSearchingAny = activeCount > 0;

  useEffect(() => {
    if (!isSearchingAny || !isAuthenticated) return;

    const interval = setInterval(() => {
      syncActiveQueues();
    }, 2000);

    const handleVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        syncActiveQueues();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      clearInterval(interval);
      if (typeof window !== 'undefined') {
        window.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [isSearchingAny, isAuthenticated, syncActiveQueues]);

  // Iniciar busca para uma lista de jogos simultaneamente
  const startSearch = useCallback(
    async (gameIds: string[]) => {
      if (!isAuthenticated || gameIds.length === 0) return;

      // Coloca os jogos selecionados em estado 'joining'
      setQueues((prev) => {
        const next = { ...prev };
        for (const gId of gameIds) {
          const normId = normalizeGameId(gId);
          const hyphenId = normId.replace(/_/g, '-');
          const entry: GameQueueState = {
            gameId: normId,
            status: 'joining',
            enteredAt: Date.now(),
            error: null,
          };
          next[normId] = entry;
          next[hyphenId] = entry;
        }
        return next;
      });

      // Dispara a entrada no backend para cada jogo
      await Promise.all(
        gameIds.map(async (gId) => {
          const normId = normalizeGameId(gId);
          const hyphenId = normId.replace(/_/g, '-');
          try {
            const res = await joinMatchmakingQueue(normId);
            if (!isMountedRef.current) return;

            if (res.success && res.data) {
              const data = res.data;
              if (data.status === 'matched' && data.match_id) {
                // Match imediato encontrado!
                if (navigatedMatchIdRef.current !== data.match_id) {
                  navigatedMatchIdRef.current = data.match_id;
                  setQueues({});
                  onMatchFoundRef.current?.(data.match_id, data.game_id || normId);
                }
              } else {
                setQueues((prev) => {
                  const state: GameQueueState = {
                    gameId: normId,
                    status: 'waiting',
                    queueId: data.queue_id,
                    matchId: null,
                    enteredAt: prev[normId]?.enteredAt || Date.now(),
                    error: null,
                  };
                  return {
                    ...prev,
                    [normId]: state,
                    [hyphenId]: state,
                  };
                });
              }
            } else {
              setQueues((prev) => {
                const state: GameQueueState = {
                  gameId: normId,
                  status: 'error',
                  error: res.error || 'Falha ao entrar na fila.',
                };
                return {
                  ...prev,
                  [normId]: state,
                  [hyphenId]: state,
                };
              });
            }
          } catch (err) {
            if (!isMountedRef.current) return;
            setQueues((prev) => {
              const state: GameQueueState = {
                gameId: normId,
                status: 'error',
                error: err instanceof Error ? err.message : 'Erro ao conectar à fila.',
              };
              return {
                ...prev,
                [normId]: state,
                [hyphenId]: state,
              };
            });
          }
        })
      );
    },
    [isAuthenticated]
  );

  // Cancelar a busca de um jogo individual
  const cancelGameSearch = useCallback(async (gameId: string) => {
    const normId = normalizeGameId(gameId);
    const hyphenId = normId.replace(/_/g, '-');

    // Atualiza imediatamente a UI
    setQueues((prev) => {
      const next = { ...prev };
      delete next[normId];
      delete next[hyphenId];
      delete next[gameId];
      return next;
    });

    try {
      const res = await cancelMatchmakingQueue(normId);
      if (res.success && res.data?.status === 'matched' && res.data.match_id) {
        // Se foi pareado concorrentemente no momento do cancelamento
        if (navigatedMatchIdRef.current !== res.data.match_id) {
          navigatedMatchIdRef.current = res.data.match_id;
          setQueues({});
          onMatchFoundRef.current?.(res.data.match_id, normId);
        }
      }
    } catch {
      // Ignora falhas isoladas de cancelamento
    }
  }, []);

  // Cancelar todas as buscas ativas
  const cancelAllSearches = useCallback(async () => {
    setQueues({});
    try {
      const res = await cancelMatchmakingQueue();
      if (res.success && res.data?.status === 'matched' && res.data.match_id) {
        if (navigatedMatchIdRef.current !== res.data.match_id) {
          navigatedMatchIdRef.current = res.data.match_id;
          onMatchFoundRef.current?.(res.data.match_id);
        }
      }
    } catch {
      // Falha silenciosa
    }
  }, []);

  return {
    queues,
    activeCount,
    isSearchingAny,
    startSearch,
    cancelGameSearch,
    cancelAllSearches,
    syncActiveQueues,
  };
}
