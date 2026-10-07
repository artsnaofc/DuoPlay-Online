// ============================================================================
// Types: Notification & Activity System — DuoPlay-Online
// Phase: Fase 16 — Sistema Central de Notificações e Atividade
// Description: Definições de tipos fortes e contratos de dados para central de notificações.
// ============================================================================

export type NotificationType =
  | 'friend_request_received'
  | 'friend_request_accepted'
  | 'game_invite_received'
  | 'game_invite_accepted'
  | 'game_invite_declined'
  | 'game_invite_expired'
  | 'new_message'
  | 'rematch_received'
  | 'rematch_accepted'
  | 'rematch_declined'
  | 'rematch_expired'
  | 'match_started'
  | 'match_finished';

export interface NotificationItem {
  id: string;
  user_id: string;
  type: NotificationType;
  actor_id: string | null;
  actor_username?: string | null;
  actor_display_name?: string | null;
  actor_avatar_url?: string | null;
  title: string;
  body: string;
  data: {
    friend_request_id?: string;
    invite_id?: string;
    room_id?: string;
    room_code?: string;
    game_id?: string;
    conversation_id?: string;
    message_id?: string;
    match_id?: string;
    result?: 'win' | 'loss' | 'draw';
    actor_id?: string;
    [key: string]: unknown;
  };
  read_at: string | null;
  created_at: string;
  event_key?: string | null;
}

export interface ActivityEvent {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface NotificationOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}
