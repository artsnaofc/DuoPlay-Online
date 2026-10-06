// ============================================================================
// Network Engine: Client Facade — DuoPlay-Online
// Phase: Fase 5 — Game Snapshot + Network/Sync Engine
// ============================================================================

import { getMatchSnapshot } from './snapshot';
import { submitAction, generateActionId } from './actions';
import { syncMatch, reconnectMatch, subscribeToMatch } from './sync';
import type {
  GameSnapshot,
  SubmitActionInput,
  ActionResult,
  MatchSnapshotListener,
} from './types';

/**
 * Cliente Universal da Network Engine.
 * Abstrai as operações de leitura, envio e sincronização com o PostgreSQL.
 */
export class NetworkEngineClient {
  /**
   * Consulta snapshot oficial da partida.
   */
  async getSnapshot<TState = unknown>(matchId: string): Promise<GameSnapshot<TState>> {
    return getMatchSnapshot<TState>(matchId);
  }

  /**
   * Submete intenção de ação do jogador ao PostgreSQL via RPC.
   */
  async submitAction<TState = unknown, TPayload = unknown>(
    input: SubmitActionInput<TPayload>
  ): Promise<ActionResult<TState>> {
    return submitAction<TState, TPayload>(input);
  }

  /**
   * Sincroniza snapshot com a verdade oficial do servidor.
   */
  async sync<TState = unknown>(
    matchId: string,
    currentSnapshot?: GameSnapshot<TState> | null
  ): Promise<GameSnapshot<TState>> {
    return syncMatch<TState>(matchId, currentSnapshot);
  }

  /**
   * Executa recuperação pós-reconexão de rede.
   */
  async reconnect<TState = unknown>(
    matchId: string,
    currentSnapshot?: GameSnapshot<TState> | null
  ): Promise<GameSnapshot<TState>> {
    return reconnectMatch<TState>(matchId, currentSnapshot);
  }

  /**
   * Assina atualizações de estado via Supabase Realtime (com reconciliação autoritativa no PostgreSQL).
   */
  subscribe<TState = unknown>(
    matchId: string,
    listener: MatchSnapshotListener<TState>,
    onStatusChange?: (status: string) => void
  ): () => void {
    return subscribeToMatch<TState>(matchId, listener, onStatusChange);
  }

  /**
   * Gera UUID v4 para idempotência de ações.
   */
  generateActionId(): string {
    return generateActionId();
  }
}

export const networkEngine = new NetworkEngineClient();
