// ============================================================================
// Types: Social & Friendship Domain — DuoPlay-Online
// Phase: Fase 14 — Sistema Social: Amigos e Jogadores
// ============================================================================

export type SocialRelationshipStatus =
  | 'self'
  | 'friends'
  | 'request_sent'
  | 'request_received'
  | 'none';

export interface Friend {
  friend_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  total_matches: number;
  total_wins: number;
  is_online: boolean;
  last_seen_at: string | null;
}

export interface FriendRequest {
  request_id: string;
  requester_id?: string;
  recipient_id?: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
}

export interface FriendSearchResult {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  total_matches: number;
  total_wins: number;
  win_rate: number;
  is_friend: boolean;
  relationship_status: SocialRelationshipStatus;
}

export interface FriendshipStatusData {
  status: SocialRelationshipStatus;
  request_id: string | null;
  is_online: boolean;
}

export interface SocialOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}
