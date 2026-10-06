// ============================================================================
// Network Engine Universal Types — DuoPlay-Online
// Phase: Fase 5 — Game Snapshot + Network/Sync Engine
// ============================================================================

import type {
  UserId,
  MatchId,
  RoomId,
  GameId,
  MatchStatus,
  FinishReason,
  GameActionEnvelope
} from '@/types/multiplayer';
import type { NetworkError } from './errors';

/**
 * Snapshot congelado de um jogador da partida.
 * Agnóstico a regras específicas de jogos individuais.
 */
export interface MatchPlayerSnapshot {
  userId: UserId;
  slot: number;
  gameSymbol: string | null;
  score: number;
  isWinner: boolean;
  disconnectedAt: string | null;
  gracePeriodExpiresAt: string | null;
  joinedAt: string;
}

/**
 * Snapshot oficial e imutável de uma partida no PostgreSQL.
 * TState representa o estado serializado específico do jogo (ex: TicTacToeState, SnakeState, PongState).
 */
export interface GameSnapshot<TState = unknown> {
  matchId: MatchId;
  roomId: RoomId | null;
  gameId: GameId;
  status: MatchStatus;
  state: TState;
  currentTurnPlayerId: UserId | null;
  turnNumber: number;
  turnDeadline: string | null;
  winnerId: UserId | null;
  isDraw: boolean;
  finishReason: FinishReason | null;
  players: MatchPlayerSnapshot[];
  version: number;
  actionHistory: GameActionEnvelope[];
  createdAt: string;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * Estados explícitos de sincronização do cliente com o PostgreSQL.
 */
export type SyncState =
  | 'synced'   // Snapshot local alinhado com o PostgreSQL
  | 'syncing'  // Operação de busca ou sincronização em andamento
  | 'stale'    // Snapshot potencialmente desatualizado ou divergente
  | 'error'    // Falha de rede ou de transporte no último sync
  | 'offline'; // Dispositivo desconectado da rede

/**
 * Envelope de intenção de jogada enviado pelo cliente.
 * Não contém dados autoritativos de vitória, tabuleiro ou próximo turno.
 */
export interface SubmitActionInput<TPayload = unknown> {
  matchId: MatchId;
  actionType: string;
  payload: TPayload;
  actionId?: string;
  clientTimestamp?: number;
}

/**
 * Resultado oficial retornado após a submissão de uma ação.
 */
export interface ActionResult<TState = unknown> {
  accepted: boolean;
  snapshot: GameSnapshot<TState> | null;
  error: NetworkError | null;
  isIdempotent?: boolean;
}

/**
 * Assinatura de callback para atualizações oficiais de snapshot.
 */
export type MatchSnapshotListener<TState = unknown> = (
  snapshot: GameSnapshot<TState>
) => void;

/**
 * Assinatura de callback para mudanças no estado de sincronização.
 */
export type SyncStateListener = (syncState: SyncState) => void;
