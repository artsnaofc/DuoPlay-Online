// ============================================================================
// Game Session Controller — DuoPlay-Online
// Phase: Fase 5 — Game Snapshot + Network/Sync Engine
// ============================================================================

import type {
  GameSnapshot,
  SyncState,
  SubmitActionInput,
  ActionResult,
} from '../network/types';
import type { NetworkError } from '../network/errors';
import { networkEngine } from '../network/client';

export type SessionChangeListener<TState = unknown> = (
  snapshot: GameSnapshot<TState> | null,
  syncState: SyncState,
  error: NetworkError | null
) => void;

/**
 * Controlador de Sessão de Partida.
 * Orquestra o ciclo de vida do snapshot, estado de sincronização e submissão de ações.
 * Agnóstico às regras de qualquer jogo específico.
 */
export class GameSessionController<TState = unknown> {
  private matchId: string;
  private snapshot: GameSnapshot<TState> | null = null;
  private syncState: SyncState = 'syncing';
  private error: NetworkError | null = null;
  private listeners: Set<SessionChangeListener<TState>> = new Set();
  private unsubscribeNetwork: (() => void) | null = null;
  private isDestroyed = false;

  constructor(matchId: string) {
    this.matchId = matchId;
  }

  /**
   * Obtém o snapshot atual em memória.
   */
  getSnapshot(): GameSnapshot<TState> | null {
    return this.snapshot;
  }

  /**
   * Obtém o estado atual de sincronização.
   */
  getSyncState(): SyncState {
    return this.syncState;
  }

  /**
   * Obtém o último erro registrado.
   */
  getError(): NetworkError | null {
    return this.error;
  }

  /**
   * Inicializa a sessão carregando o snapshot oficial do PostgreSQL.
   */
  async init(): Promise<GameSnapshot<TState> | null> {
    if (!this.matchId) {
      this.updateState(null, 'error', {
        code: 'INVALID_MATCH_ID',
        message: 'Identificador de partida ausente.',
        category: 'rule',
      });
      return null;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.updateState(this.snapshot, 'offline', {
        code: 'OFFLINE',
        message: 'Dispositivo sem conexão com a internet.',
        category: 'transport',
      });
      return null;
    }

    this.updateState(this.snapshot, 'syncing', null);

    try {
      const initialSnapshot = await networkEngine.getSnapshot<TState>(this.matchId);
      if (this.isDestroyed) return null;

      this.updateState(initialSnapshot, 'synced', null);

      // Registrar contrato de assinatura
      this.unsubscribeNetwork = networkEngine.subscribe<TState>(
        this.matchId,
        (updatedSnapshot) => {
          if (!this.isDestroyed) {
            this.updateState(updatedSnapshot, 'synced', null);
          }
        }
      );

      return initialSnapshot;
    } catch (err) {
      if (this.isDestroyed) return null;
      const errorObj = err as NetworkError;
      this.updateState(null, 'error', errorObj);
      return null;
    }
  }

  /**
   * Submete uma ação através da Network Engine e atualiza o estado oficial.
   */
  async submitAction<TPayload = unknown>(
    actionType: string,
    payload: TPayload,
    actionId?: string
  ): Promise<ActionResult<TState>> {
    const resolvedActionId =
      actionId && typeof actionId === 'string' && actionId.trim() !== ''
        ? actionId.trim()
        : networkEngine.generateActionId();

    if (this.isDestroyed) {
      return {
        accepted: false,
        snapshot: null,
        error: {
          code: 'SESSION_DESTROYED',
          message: 'Sessão encerrada.',
          category: 'infrastructure',
        },
        actionId: resolvedActionId,
      };
    }

    const input: SubmitActionInput<TPayload> = {
      matchId: this.matchId,
      actionType,
      payload,
      actionId: resolvedActionId,
    };

    const result = await networkEngine.submitAction<TState, TPayload>(input);

    if (result.accepted && result.snapshot) {
      this.updateState(result.snapshot, 'synced', null);
    } else if (result.error) {
      // Mantém o snapshot existente, mas atualiza o erro e marca estado conforme categoria
      const newSyncState: SyncState =
        result.error.category === 'transport' ? 'error' : this.syncState;
      this.updateState(this.snapshot, newSyncState, result.error);
    }

    return result;
  }

  /**
   * Força sincronização do snapshot com o PostgreSQL.
   */
  async refresh(): Promise<GameSnapshot<TState> | null> {
    if (this.isDestroyed || !this.matchId) return null;

    this.updateState(this.snapshot, 'syncing', null);

    try {
      const refreshed = await networkEngine.sync<TState>(this.matchId, this.snapshot);
      if (this.isDestroyed) return null;

      this.updateState(refreshed, 'synced', null);
      return refreshed;
    } catch (err) {
      if (this.isDestroyed) return null;
      const errorObj = err as NetworkError;
      this.updateState(this.snapshot, 'error', errorObj);
      return null;
    }
  }

  /**
   * Executa recuperação pós-reconexão com o PostgreSQL.
   */
  async reconnect(): Promise<GameSnapshot<TState> | null> {
    if (this.isDestroyed || !this.matchId) return null;
    return this.refresh();
  }

  /**
   * Inscreve um ouvinte para alterações no estado da sessão.
   */
  subscribe(listener: SessionChangeListener<TState>): () => void {
    this.listeners.add(listener);
    // Notifica o estado corrente imediatamente
    listener(this.snapshot, this.syncState, this.error);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Encerra a sessão e libera recursos.
   */
  destroy(): void {
    this.isDestroyed = true;
    if (this.unsubscribeNetwork) {
      this.unsubscribeNetwork();
      this.unsubscribeNetwork = null;
    }
    this.listeners.clear();
  }

  private updateState(
    snapshot: GameSnapshot<TState> | null,
    syncState: SyncState,
    error: NetworkError | null
  ): void {
    this.snapshot = snapshot;
    this.syncState = syncState;
    this.error = error;

    this.listeners.forEach((listener) => {
      listener(this.snapshot, this.syncState, this.error);
    });
  }
}
