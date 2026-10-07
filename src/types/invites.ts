// ============================================================================
// Types: Game Invites Domain — DuoPlay-Online
// Phase: Fase 14.2 — Convites de Partida entre Amigos + Convite pela Sala de Espera
// Description: Tipos e interfaces de convites diretos para salas de jogo.
// ============================================================================

export type GameInviteStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'cancelled';

export interface GameInvite {
  invite_id: string;
  sender_id: string;
  receiver_id: string;
  room_id: string;
  game_id: string;
  status: GameInviteStatus;
  created_at: string;
  expires_at: string;
  sender_username: string;
  sender_display_name: string;
  sender_avatar_url: string | null;
  room_code: string;
  room_status?: string;
  game_title: string;
}

export interface RoomInviteInfo {
  invite_id: string;
  receiver_id: string;
  sender_id?: string;
  room_id?: string;
  game_id?: string;
  status: GameInviteStatus;
  created_at: string;
  expires_at: string;
  responded_at?: string | null;
  receiver_username: string;
  receiver_display_name: string;
  receiver_avatar_url: string | null;
}

export interface GameInviteOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}
