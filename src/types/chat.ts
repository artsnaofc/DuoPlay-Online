// ============================================================================
// Types: Chat & Communication Domain — DuoPlay-Online
// Phase: Fase 15 — Comunicação Entre Jogadores (Chat Privado 1:1 Entre Amigos)
// Description: Tipos e interfaces de domínio para conversas privadas, mensagens,
//              histórico paginado, estado de leitura e presença.
// ============================================================================

export type ConversationType = 'direct' | 'match' | 'group';

export type MessageDeliveryStatus = 'pending' | 'sent' | 'failed';

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_username?: string;
  sender_display_name?: string;
  sender_avatar_url?: string | null;
  body: string;
  created_at: string;
  is_mine: boolean;
  delivery_status?: MessageDeliveryStatus;
}

export interface ChatParticipant {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_online: boolean;
  last_seen_at: string | null;
}

export interface ConversationSummary {
  conversation_id: string;
  type: ConversationType;
  created_at: string;
  last_message_at: string;
  unread_count: number;
  other_user: ChatParticipant;
  last_message: {
    id: string;
    sender_id: string;
    body: string;
    created_at: string;
  } | null;
}

export interface GetMessagesResponse {
  messages: ChatMessage[];
  has_more: boolean;
}

export interface ChatOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}
