// ============================================================================
// Types: Snake Competitivo — DuoPlay-Online
// Phase: Fase 22.1 — Motor Multiplayer + Regras
// ============================================================================

export type SnakeDirection = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export interface SnakePoint {
  x: number;
  y: number;
}

export interface SnakePlayerState {
  userId: string;
  slot: number;
  direction: SnakeDirection;
  nextDirection: SnakeDirection;
  body: SnakePoint[]; // body[0] é a cabeça da cobra
  alive: boolean;
  score: number;
  color: string;
}

export interface SnakeArenaConfig {
  gridWidth: number;
  gridHeight: number;
  tickRateMs: number;
  countdownSeconds: number;
}

export interface SnakeGameState {
  config: SnakeArenaConfig;
  status: 'countdown' | 'in_game' | 'finished';
  tick: number;
  snakes: Record<string, SnakePlayerState>; // chave: userId
  food: SnakePoint;
  startTime: number;
  lastTickTime: number;
  winnerId: string | null;
  isDraw: boolean;
  finishReason?: string;
}

// Payloads de ações suportadas pelo validador server-side
export interface SnakeSetDirectionPayload {
  direction: SnakeDirection;
  tick?: number;
}

export interface SnakeTickPayload {
  tick: number;
  clientTime?: number;
}
