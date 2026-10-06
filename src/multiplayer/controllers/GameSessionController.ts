// ============================================================================
// Game Session Controller — DuoPlay-Online
// Phase: Fase 6.1 — Hardening do Supabase Realtime
// ============================================================================

import type {
  GameSnapshot,
  SyncState,
  SubmitActionInput,
  ActionResult,
} from '../network/types';
import type { NetworkError } from '../network/errors';
import { networkEngine } from '../network/client';
import { heartbeatMatch } from '@/services/matchSession';

export type SessionChangeListener<TState = unknown> = (
  snapshot: GameSnapshot<TState> | null,
  syncState: SyncState,
  error: NetworkError | null
) => void;

/**
 * Controlador de Sessão de Partida.
 * Orquestra o ciclo de vida do snapshot, estado de sincronização e submissão de ações.
 * Agnóstico às regras de qualquer jogo específico.
 * 
 * GARANTIAS DE HARDENING (Fase 6.1):
 * - Idempotência em init() múltiplo (impede subscriptions duplicadas para a mesma sessão).
 * - Proteção contra callbacks tardios após destroy().
 * - Limpeza total de recursos, listeners e canais de rede.
 */
export class GameSessionController<TState = unknown> {
  private matchId: string;
  private snapshot: GameSnapshot<TState> | null = null;
  private syncState: SyncState = 'syncing';
  private error: NetworkError | null = null;
  private listeners: Set<SessionChangeListener<TState>> = new Set();
  private unsubscribeNetwork: (() => void) | null = null;
  private isDestroyed = false;
  private isInitialized = false;
  private initPromise: Promise<GameSnapshot<TState> | null> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private isHeartbeatInFlight = false;

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
   * Verifica se a sessão foi destruída.
   */
  getIsDestroyed(): boolean {
    return this.isDestroyed;
  }

  /**
   * Inicializa a sessão carregando o snapshot oficial do PostgreSQL.
   * Idempotente: chamadas concorrentes ou repetidas retornam a inicialização em andamento
   * sem criar subscriptions duplicadas.
   */
  async init(): Promise<GameSnapshot<TState> | null> {
    if (this.isDestroyed) {
      return null;
    }

    if (!this.matchId) {
      this.updateState(null, 'error', {
        code: 'INVALID_MATCH_ID',
        message: 'Identificador de partida ausente.',
        category: 'rule',
      });
      return null;
    }

    // Se já estiver inicializado, retorna o snapshot atual
    if (this.isInitialized && this.snapshot) {
      return this.snapshot;
    }

    // Se já houver uma inicialização em voo, reutiliza a Promise para evitar duplicação
    if (this.initPromise) {
      return this.initPromise;
    }

    if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.updateState(this.snapshot, 'offline', {
        code: 'OFFLINE',
        message: 'Dispositivo sem conexão com a internet.',
        category: 'transport',
      });
      return null;
    }

    this.updateState(this.snapshot, 'syncing', null);

    const executeInit = async (): Promise<GameSnapshot<TState> | null> => {
      try {
        const initialSnapshot = await networkEngine.getSnapshot<TState>(this.matchId);
        if (this.isDestroyed) return null;

        // Limpar subscription anterior caso tenha existido
        if (this.unsubscribeNetwork) {
          this.unsubscribeNetwork();
          this.unsubscribeNetwork = null;
        }

        this.updateState(initialSnapshot, 'synced', null);

        // Registrar subscription única para a partida
        this.unsubscribeNetwork = networkEngine.subscribe<TState>(
          this.matchId,
          (updatedSnapshot) => {
            if (!this.isDestroyed) {
              this.updateState(updatedSnapshot, 'synced', null);
            }
          }
        );

        this.isInitialized = true;
        if (initialSnapshot.status === 'in_progress') {
          this.startHeartbeat();
        }
        return initialSnapshot;
      } catch (err) {
        if (this.isDestroyed) return null;
        const errorObj = err as NetworkError;
        this.updateState(null, 'error', errorObj);
        return null;
      } finally {
        this.initPromise = null;
      }
    };

    this.initPromise = executeInit();
    return this.initPromise;
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

    if (this.isDestroyed) {
      return result;
    }

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
    const refreshed = await this.refresh();
    if (refreshed && refreshed.status === 'in_progress') {
      this.startHeartbeat();
    }
    return refreshed;
  }

  /**
   * Dispara um tick único de heartbeat para o PostgreSQL.
   * Atualiza a presença do jogador e reflete alterações nos listeners.
   */
  async triggerHeartbeatTick(): Promise<void> {
    if (this.isDestroyed || !this.matchId || this.isHeartbeatInFlight) return;
    if (this.snapshot && this.snapshot.status !== 'in_progress') {
      this.stopHeartbeat();
      return;
    }

    this.isHeartbeatInFlight = true;
    try {
      const res = await heartbeatMatch(this.matchId);
      if (this.isDestroyed) return;

      if (res.success && res.data) {
        if (res.data.is_finished || res.data.status !== 'in_progress') {
          this.stopHeartbeat();
          await this.refresh();
          return;
        }

        if (Array.isArray(res.data.players) && this.snapshot) {
          let hasPresenceChange = false;
          const updatedPlayers = this.snapshot.players.map((currentP) => {
            const serverP = res.data!.players!.find((sp) => sp.user_id === currentP.userId);
            if (!serverP) return currentP;
            if (
              currentP.connectionStatus !== serverP.connection_status ||
              currentP.gracePeriodExpiresAt !== serverP.grace_period_expires_at ||
              currentP.disconnectedAt !== serverP.disconnected_at
            ) {
              hasPresenceChange = true;
              return {
                ...currentP,
                connectionStatus: serverP.connection_status,
                lastSeenAt: serverP.last_seen_at,
                disconnectedAt: serverP.disconnected_at,
                gracePeriodExpiresAt: serverP.grace_period_expires_at,
              };
            }
            return currentP;
          });

          if (hasPresenceChange) {
            const updatedSnapshot: GameSnapshot<TState> = {
              ...this.snapshot,
              players: updatedPlayers,
            };
            this.updateState(updatedSnapshot, this.syncState, this.error);
          }
        }
      }
    } catch {
      // Falhas transitórias no heartbeat não quebram a sessão
    } finally {
      this.isHeartbeatInFlight = false;
    }
  }

  /**
   * Inicia o envio periódico de heartbeat a cada 5 segundos.
   * Idempotente: impede timers duplicados para a mesma sessão.
   */
  startHeartbeat(intervalMs = 5000): void {
    if (this.isDestroyed || !this.matchId) return;
    if (this.snapshot && this.snapshot.status !== 'in_progress') return;
    if (this.heartbeatTimer !== null) return;

    this.triggerHeartbeatTick();

    const isTestEnv =
      typeof window === 'undefined' &&
      typeof process !== 'undefined' &&
      (process.env.NODE_ENV === 'test' ||
        Boolean(process.env.NODE_TEST_CONTEXT) ||
        (Array.isArray(process.argv) && process.argv.some((arg) => arg.includes('--test'))));

    if (isTestEnv) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      this.triggerHeartbeatTick();
    }, intervalMs);

    // Evita travar o processo Node.js se for executado em backend/SSR
    if (
      this.heartbeatTimer &&
      typeof this.heartbeatTimer === 'object' &&
      typeof (this.heartbeatTimer as unknown as { unref?: () => void }).unref === 'function'
    ) {
      (this.heartbeatTimer as unknown as { unref: () => void }).unref();
    }
  }

  /**
   * Interrompe o envio de heartbeat e limpa o timer ativo.
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.isHeartbeatInFlight = false;
  }

  /**
   * Verifica se o heartbeat está ativo para esta sessão.
   */
  getIsHeartbeatActive(): boolean {
    return this.heartbeatTimer !== null;
  }

  /**
   * Inscreve um ouvinte para alterações no estado da sessão.
   */
  subscribe(listener: SessionChangeListener<TState>): () => void {
    if (this.isDestroyed) {
      return () => {};
    }

    this.listeners.add(listener);
    // Notifica o estado corrente imediatamente
    listener(this.snapshot, this.syncState, this.error);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Encerra a sessão e libera todos os recursos.
   * Cancela subscriptions e impede que qualquer callback futuro modifique o estado.
   */
  destroy(): void {
    this.isDestroyed = true;
    this.isInitialized = false;
    this.initPromise = null;
    this.stopHeartbeat();

    if (this.unsubscribeNetwork) {
      try {
        this.unsubscribeNetwork();
      } catch {
        // Ignora erros no descarte
      }
      this.unsubscribeNetwork = null;
    }

    this.listeners.clear();
  }

  private updateState(
    snapshot: GameSnapshot<TState> | null,
    syncState: SyncState,
    error: NetworkError | null
  ): void {
    if (this.isDestroyed) {
      return;
    }

    this.snapshot = snapshot;
    this.syncState = syncState;
    this.error = error;

    if (snapshot && snapshot.status !== 'in_progress') {
      this.stopHeartbeat();
    }

    this.listeners.forEach((listener) => {
      listener(this.snapshot, this.syncState, this.error);
    });
  }
}
