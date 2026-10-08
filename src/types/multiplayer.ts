// ============================================================================
// Tipos de Domínio TypeScript (DTOs) — DuoPlay-Online Backend Contract v1.0
// ============================================================================

export type UserId = string;
export type RoomId = string;
export type MatchId = string;
export type GameId = 'tic_tac_toe' | string;

export type RoomStatus = 'waiting' | 'starting' | 'in_game' | 'closed';
export type MatchStatus = 'in_progress' | 'finished' | 'abandoned' | 'cancelled';
export type MemberRole = 'player' | 'spectator';
export type FinishReason = 'normal' | 'timeout' | 'abandonment' | 'resignation';

export interface UserProfileDTO {
  id: UserId;
  username: string;
  display_name: string;
  avatar_url: string | null;
  total_matches: number;
  total_wins: number;
  total_draws: number;
  total_losses: number;
  created_at: string;
  updated_at: string;
}

export interface GameDTO {
  id: GameId;
  name: string;
  description: string;
  min_players: number;
  max_players: number;
  game_type: string;
  capabilities: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export interface RoomDTO {
  id: RoomId;
  code: string;
  game_id: GameId;
  host_id: UserId;
  name: string;
  status: RoomStatus;
  is_private: boolean;
  max_members: number;
  config?: Record<string, any>; // Regras personalizadas da sala (JSONB)
  current_match_id: MatchId | null;
  created_at: string;
  updated_at: string;
}

export interface RoomMemberDTO {
  id: string;
  room_id: RoomId;
  user_id: UserId;
  role: MemberRole;
  slot_number: number | null;
  is_ready: boolean;
  joined_at: string;
  updated_at: string;
  profile?: UserProfileDTO;
}

export interface MatchDTO<TGameState = unknown> {
  id: MatchId;
  room_id: RoomId | null;
  game_id: GameId;
  status: MatchStatus;
  current_turn_player_id: UserId | null;
  turn_deadline: string | null;
  turn_number: number;
  game_state: TGameState;
  action_history: GameActionEnvelope[];
  winner_id: UserId | null;
  is_draw: boolean;
  finish_reason: FinishReason | null;
  created_at: string;
  started_at: string;
  finished_at: string | null;
}

export interface MatchPlayerDTO {
  id: string;
  match_id: MatchId;
  user_id: UserId;
  slot: number;
  game_symbol: string | null;
  score: number;
  is_winner: boolean;
  disconnected_at: string | null;
  grace_period_expires_at: string | null;
  joined_at: string;
  profile?: UserProfileDTO;
}

export interface GameActionEnvelope<TPayload = unknown> {
  action_id: string;
  turn_number: number;
  player_id: UserId;
  action_type: string;
  payload: TPayload;
  client_timestamp?: number | null;
  server_timestamp: string;
}

// ============================================================================
// Tipos de Domínio do Jogo da Velha (tic_tac_toe) — Fase 4
// ============================================================================

export type TicTacToeCell = 'X' | 'O' | null;

export type TicTacToeBoard = [
  TicTacToeCell, TicTacToeCell, TicTacToeCell,
  TicTacToeCell, TicTacToeCell, TicTacToeCell,
  TicTacToeCell, TicTacToeCell, TicTacToeCell
];

export interface TicTacToeState {
  board: TicTacToeBoard;
  symbols: Record<UserId, 'X' | 'O'>;
  winning_line?: [number, number, number] | null;
  last_move?: {
    position: number;
    player_id: UserId;
    symbol: 'X' | 'O';
  } | null;
}

export interface TicTacToePlaceMarkPayload {
  position: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T | null;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } | null;
}
