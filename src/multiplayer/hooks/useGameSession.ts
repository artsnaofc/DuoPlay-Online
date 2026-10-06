// ============================================================================
// React Hook: useGameSession — DuoPlay-Online
// Phase: Fase 5 — Game Snapshot + Network/Sync Engine
// ============================================================================

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import type {
  GameSnapshot,
  SyncState,
  ActionResult,
  MatchPlayerSnapshot,
} from '../network/types';
import type { NetworkError } from '../network/errors';
import { GameSessionController } from '../controllers/GameSessionController';

export interface UseGameSessionReturn<TState = unknown> {
  snapshot: GameSnapshot<TState> | null;
  syncState: SyncState;
  error: NetworkError | null;
  isLoading: boolean;
  isMyTurn: boolean;
  myPlayer: MatchPlayerSnapshot | null;
  opponentPlayer: MatchPlayerSnapshot | null;
  submitAction: <TPayload = unknown>(
    actionType: string,
    payload: TPayload,
    actionId?: string
  ) => Promise<ActionResult<TState>>;
  refresh: () => Promise<GameSnapshot<TState> | null>;
  reconnect: () => Promise<GameSnapshot<TState> | null>;
}

/**
 * Hook universal para consumo de partidas multiplayer no React.
 * Permite tipagem genérica do estado do jogo (ex: useGameSession<TicTacToeState>(matchId)).
 * O hook não possui conhecimento sobre as regras específicas de nenhum jogo.
 */
export function useGameSession<TState = unknown>(
  matchId: string | null
): UseGameSessionReturn<TState> {
  const { user } = useAuth();
  const currentUserId = user?.id || null;

  const [snapshot, setSnapshot] = useState<GameSnapshot<TState> | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('syncing');
  const [error, setError] = useState<NetworkError | null>(null);

  const controllerRef = useRef<GameSessionController<TState> | null>(null);

  useEffect(() => {
    if (!matchId) {
      setSnapshot(null);
      setSyncState('stale');
      setError(null);
      return;
    }

    const controller = new GameSessionController<TState>(matchId);
    controllerRef.current = controller;

    const unsubscribe = controller.subscribe((newSnapshot, newSyncState, newError) => {
      setSnapshot(newSnapshot);
      setSyncState(newSyncState);
      setError(newError);
    });

    controller.init();

    // Eventos de conectividade do navegador para recuperação automática
    const handleOnline = () => {
      controller.reconnect();
    };

    const handleOffline = () => {
      controller.submitAction; // no-op reference
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
      unsubscribe();
      controller.destroy();
      controllerRef.current = null;
    };
  }, [matchId]);

  const submitAction = useCallback(
    async <TPayload = unknown>(
      actionType: string,
      payload: TPayload,
      actionId?: string
    ): Promise<ActionResult<TState>> => {
      if (!controllerRef.current) {
        return {
          accepted: false,
          snapshot: null,
          error: {
            code: 'NO_ACTIVE_SESSION',
            message: 'Nenhuma sessão de jogo ativa.',
            category: 'infrastructure',
          },
        };
      }
      return controllerRef.current.submitAction<TPayload>(actionType, payload, actionId);
    },
    []
  );

  const refresh = useCallback(async (): Promise<GameSnapshot<TState> | null> => {
    if (!controllerRef.current) return null;
    return controllerRef.current.refresh();
  }, []);

  const reconnect = useCallback(async (): Promise<GameSnapshot<TState> | null> => {
    if (!controllerRef.current) return null;
    return controllerRef.current.reconnect();
  }, []);

  // Identificação do jogador atual e oponente
  const myPlayer = useMemo(() => {
    if (!snapshot || !currentUserId) return null;
    return snapshot.players.find((p) => p.userId === currentUserId) || null;
  }, [snapshot, currentUserId]);

  const opponentPlayer = useMemo(() => {
    if (!snapshot || !currentUserId) return null;
    return snapshot.players.find((p) => p.userId !== currentUserId) || null;
  }, [snapshot, currentUserId]);

  const isMyTurn = useMemo(() => {
    if (!snapshot || !currentUserId) return false;
    return (
      snapshot.status === 'in_progress' &&
      snapshot.currentTurnPlayerId === currentUserId
    );
  }, [snapshot, currentUserId]);

  const isLoading = syncState === 'syncing' && snapshot === null;

  return {
    snapshot,
    syncState,
    error,
    isLoading,
    isMyTurn,
    myPlayer,
    opponentPlayer,
    submitAction,
    refresh,
    reconnect,
  };
}
