// ============================================================================
// Service: Chat & Private Messaging — DuoPlay-Online
// Phase: Fase 15 — Comunicação Entre Jogadores (Chat Privado 1:1 Entre Amigos)
// Description: Gerenciamento autoritativo de conversas privadas, histórico paginado,
//              envio de mensagens, atualização de leitura e resiliência de sessão.
// ============================================================================

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { safeRefreshSession, isAuthOrTokenExpiredError } from '@/services/auth';
import type {
  ChatMessage,
  ConversationSummary,
  GetMessagesResponse,
  ChatOperationResult,
} from '@/types/chat';

interface ChatCache {
  conversations: { data: ConversationSummary[]; timestamp: number } | null;
}

const CACHE_TTL_MS = 8000; // 8 segundos

let chatCache: ChatCache = {
  conversations: null,
};

export function clearChatCache(): void {
  chatCache = {
    conversations: null,
  };
}

export function translateChatError(error: unknown): { message: string; code: string } {
  if (!error || typeof error !== 'object') {
    return { message: 'Ocorreu um erro inesperado na conversa. Tente novamente.', code: 'UNKNOWN_ERROR' };
  }

  const errObj = error as { code?: string; message?: string; details?: string; hint?: string };
  const rawMsg = errObj.message || errObj.details || '';
  const lowerMsg = rawMsg.toLowerCase();
  const code = (errObj.code || 'UNKNOWN_ERROR').toUpperCase();

  if (
    lowerMsg.includes('jwt expired') ||
    lowerMsg.includes('token is expired') ||
    lowerMsg.includes('invalid jwt') ||
    lowerMsg.includes('pgrst301') ||
    lowerMsg.includes('session_expired') ||
    code === 'PGRST301' ||
    code === 'SESSION_EXPIRED'
  ) {
    return { message: 'Sua sessão expirou. Entre novamente.', code: 'SESSION_EXPIRED' };
  }

  if (rawMsg.includes('P0001') || lowerMsg.includes('unauthorized') || code === '401') {
    return { message: 'Você precisa estar logado para utilizar o chat.', code: 'UNAUTHORIZED' };
  }
  if (rawMsg.includes('P0002') || rawMsg.includes('FORBIDDEN')) {
    return { message: 'Você não tem permissão para acessar esta conversa.', code: 'FORBIDDEN' };
  }
  if (rawMsg.includes('P0060') || rawMsg.includes('CANNOT_CHAT_SELF')) {
    return { message: 'Não é permitido iniciar uma conversa consigo mesmo.', code: 'CANNOT_CHAT_SELF' };
  }
  if (rawMsg.includes('P0041') || rawMsg.includes('USER_NOT_FOUND')) {
    return { message: 'Jogador não encontrado na plataforma.', code: 'USER_NOT_FOUND' };
  }
  if (rawMsg.includes('P0051') || rawMsg.includes('USER_NOT_FRIEND')) {
    return { message: 'Você só pode conversar com jogadores da sua lista de amigos.', code: 'USER_NOT_FRIEND' };
  }
  if (rawMsg.includes('P0061') || rawMsg.includes('EMPTY_MESSAGE')) {
    return { message: 'A mensagem não pode ser vazia.', code: 'EMPTY_MESSAGE' };
  }
  if (rawMsg.includes('P0062') || rawMsg.includes('MESSAGE_TOO_LONG')) {
    return { message: 'A mensagem ultrapassou o limite máximo de 2.000 caracteres.', code: 'MESSAGE_TOO_LONG' };
  }
  if (rawMsg.includes('P0063') || rawMsg.includes('CONVERSATION_NOT_FOUND')) {
    return { message: 'Conversa não encontrada.', code: 'CONVERSATION_NOT_FOUND' };
  }
  if (lowerMsg.includes('failed to fetch') || lowerMsg.includes('networkerror') || lowerMsg.includes('fetch')) {
    return { message: 'Erro de conexão com o servidor. Verifique sua internet.', code: 'NETWORK_ERROR' };
  }

  return { message: rawMsg || 'Erro na operação de chat.', code };
}

/**
 * Executor central de RPCs do chat com renovação transparente de sessão
 */
async function executeChatRpc<T>(
  rpcName: string,
  params?: Record<string, unknown>
): Promise<ChatOperationResult<T>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase não configurado.', code: 'NOT_CONFIGURED' };
  }

  const runCall = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return params ? (supabase.rpc as any)(rpcName, params) : (supabase.rpc as any)(rpcName);
  };

  try {
    const { data, error } = await runCall();

    if (error) {
      if (isAuthOrTokenExpiredError(error)) {
        const refreshRes = await safeRefreshSession();
        if (refreshRes.success) {
          const retryRes = await runCall();
          if (!retryRes.error) {
            const retryPayload = retryRes.data as {
              success?: boolean;
              data?: T;
              error?: string;
              code?: string;
            };
            if (retryPayload && typeof retryPayload === 'object' && 'success' in retryPayload) {
              if (!retryPayload.success) {
                return {
                  success: false,
                  error: retryPayload.error || 'Erro ao processar conversa.',
                  code: retryPayload.code,
                };
              }
              return { success: true, data: retryPayload.data };
            }
            return { success: true, data: retryRes.data as T };
          }
          const translatedRetry = translateChatError(retryRes.error);
          return { success: false, error: translatedRetry.message, code: translatedRetry.code };
        }
      }

      const translated = translateChatError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    const payload = data as {
      success?: boolean;
      data?: T;
      error?: string;
      code?: string;
    };

    if (payload && typeof payload === 'object' && 'success' in payload) {
      if (!payload.success) {
        return {
          success: false,
          error: payload.error || 'Falha ao executar operação.',
          code: payload.code,
        };
      }
      return { success: true, data: payload.data };
    }

    return { success: true, data: data as T };
  } catch (err: unknown) {
    const translated = translateChatError(err);
    return { success: false, error: translated.message, code: translated.code };
  }
}

/**
 * Obtém ou cria a conversa canônica 1:1 entre o usuário autenticado e um amigo
 */
export async function getOrCreateDirectConversation(
  otherUserId: string
): Promise<ChatOperationResult<ConversationSummary>> {
  if (!otherUserId || typeof otherUserId !== 'string') {
    return { success: false, error: 'Identificador de usuário inválido.', code: 'INVALID_ID' };
  }

  const res = await executeChatRpc<ConversationSummary>('get_or_create_direct_conversation', {
    p_other_user_id: otherUserId,
  });

  if (res.success) {
    clearChatCache();
  }

  return res;
}

/**
 * Retorna todas as conversas do usuário autenticado ordenadas por atividade recente
 */
export async function getMyConversations(
  force = false
): Promise<ChatOperationResult<ConversationSummary[]>> {
  const now = Date.now();
  if (!force && chatCache.conversations && now - chatCache.conversations.timestamp < CACHE_TTL_MS) {
    return { success: true, data: chatCache.conversations.data };
  }

  const res = await executeChatRpc<ConversationSummary[]>('get_my_conversations');
  if (res.success && res.data) {
    chatCache.conversations = {
      data: res.data,
      timestamp: now,
    };
  }

  return res;
}

/**
 * Busca histórico de mensagens de uma conversa com paginação determinística reversa
 */
export async function getConversationMessages(
  conversationId: string,
  limit = 30,
  beforeCreatedAt?: string,
  beforeId?: string
): Promise<ChatOperationResult<GetMessagesResponse>> {
  if (!conversationId) {
    return { success: false, error: 'Conversa inválida.', code: 'INVALID_CONVERSATION' };
  }

  return executeChatRpc<GetMessagesResponse>('get_conversation_messages', {
    p_conversation_id: conversationId,
    p_limit: limit,
    p_before_created_at: beforeCreatedAt || null,
    p_before_id: beforeId || null,
  });
}

/**
 * Envia uma mensagem para a conversa
 */
export async function sendMessage(
  conversationId: string,
  body: string
): Promise<ChatOperationResult<ChatMessage>> {
  if (!conversationId) {
    return { success: false, error: 'Conversa inválida.', code: 'INVALID_CONVERSATION' };
  }

  const trimmed = body.trim();
  if (!trimmed) {
    return { success: false, error: 'A mensagem não pode ser vazia.', code: 'EMPTY_MESSAGE' };
  }

  if (trimmed.length > 2000) {
    return {
      success: false,
      error: 'A mensagem ultrapassou o limite de 2.000 caracteres.',
      code: 'MESSAGE_TOO_LONG',
    };
  }

  const res = await executeChatRpc<ChatMessage>('send_message', {
    p_conversation_id: conversationId,
    p_body: trimmed,
  });

  if (res.success) {
    clearChatCache();
  }

  return res;
}

/**
 * Marca uma conversa como lida pelo usuário autenticado
 */
export async function markConversationRead(
  conversationId: string
): Promise<ChatOperationResult<{ conversation_id: string; last_read_at: string }>> {
  if (!conversationId) {
    return { success: false, error: 'Conversa inválida.', code: 'INVALID_CONVERSATION' };
  }

  const res = await executeChatRpc<{ conversation_id: string; last_read_at: string }>(
    'mark_conversation_read',
    {
      p_conversation_id: conversationId,
    }
  );

  if (res.success) {
    clearChatCache();
  }

  return res;
}
