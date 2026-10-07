// ============================================================================
// Service: Social & Friends Orchestration — DuoPlay-Online
// Phase: Fase 14 — Sistema Social: Amigos e Jogadores
// Description: Gerenciamento autoritativo de amizades, solicitações, busca de
//              jogadores e presença através das RPCs oficiais do PostgreSQL.
// ============================================================================

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { safeRefreshSession, isAuthOrTokenExpiredError } from '@/services/auth';
import type {
  Friend,
  FriendRequest,
  FriendSearchResult,
  FriendshipStatusData,
  SocialOperationResult,
} from '@/types/social';

// Cache em memória de curta duração para otimizar renderizações repetidas
interface SocialCache {
  friends: { data: Friend[]; timestamp: number } | null;
  receivedRequests: { data: FriendRequest[]; timestamp: number } | null;
  sentRequests: { data: FriendRequest[]; timestamp: number } | null;
  statusMap: Map<string, { data: FriendshipStatusData; timestamp: number }>;
}

const CACHE_TTL_MS = 15000; // 15 segundos de validade

let socialCache: SocialCache = {
  friends: null,
  receivedRequests: null,
  sentRequests: null,
  statusMap: new Map(),
};

export function clearSocialCache(): void {
  socialCache = {
    friends: null,
    receivedRequests: null,
    sentRequests: null,
    statusMap: new Map(),
  };
}

export function translateSocialError(error: unknown): { message: string; code: string } {
  if (!error || typeof error !== 'object') {
    return { message: 'Ocorreu um erro inesperado. Tente novamente.', code: 'UNKNOWN_ERROR' };
  }

  const errObj = error as { code?: string; message?: string; details?: string; hint?: string };
  const rawMsg = errObj.message || errObj.details || '';
  const lowerMsg = rawMsg.toLowerCase();
  const code = (errObj.code || 'UNKNOWN_ERROR').toUpperCase();

  // Tratamento de sessão / token expirado
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
    return { message: 'Você precisa estar logado para realizar esta ação.', code: 'UNAUTHORIZED' };
  }
  if (rawMsg.includes('P0040') || rawMsg.includes('CANNOT_FRIEND_SELF')) {
    return { message: 'Você não pode enviar solicitação de amizade para si mesmo.', code: 'CANNOT_FRIEND_SELF' };
  }
  if (rawMsg.includes('P0041') || rawMsg.includes('USER_NOT_FOUND')) {
    return { message: 'Jogador não encontrado na plataforma.', code: 'USER_NOT_FOUND' };
  }
  if (rawMsg.includes('P0042') || rawMsg.includes('REQUEST_NOT_FOUND')) {
    return { message: 'Solicitação de amizade não encontrada.', code: 'REQUEST_NOT_FOUND' };
  }
  if (rawMsg.includes('P0043')) {
    return { message: 'Você não tem permissão para responder a esta solicitação.', code: 'UNAUTHORIZED' };
  }
  if (rawMsg.includes('P0044') || rawMsg.includes('INVALID_REQUEST_STATUS')) {
    return { message: 'Esta solicitação não está mais pendente.', code: 'INVALID_REQUEST_STATUS' };
  }
  if (rawMsg.includes('P0045')) {
    return { message: 'Você não tem permissão para cancelar esta solicitação.', code: 'UNAUTHORIZED' };
  }
  if (rawMsg.includes('FRIENDSHIP_EXISTS')) {
    return { message: 'Você e este jogador já são amigos.', code: 'FRIENDSHIP_EXISTS' };
  }
  if (lowerMsg.includes('failed to fetch') || lowerMsg.includes('networkerror') || lowerMsg.includes('fetch')) {
    return { message: 'Erro de conexão com o servidor. Verifique sua internet.', code: 'NETWORK_ERROR' };
  }
  if (rawMsg.startsWith('SQLSTATE') || lowerMsg.includes('postgreserror') || lowerMsg.includes('postgrest')) {
    return { message: 'Erro ao processar ação social no servidor.', code };
  }

  return { message: rawMsg || 'Erro ao processar ação social.', code };
}

/**
 * Executor central de RPCs sociais com renovação transparente de sessão (max 1 retry)
 * e proteção estrita contra vazamento de mensagens brutas de erro de banco/JWT.
 */
async function executeSocialRpc<T>(
  rpcName: string,
  params?: Record<string, unknown>
): Promise<SocialOperationResult<T>> {
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
        // Tenta renovação transparente e compartilhada da sessão
        const refreshRes = await safeRefreshSession();
        if (refreshRes.success) {
          // Repete a chamada uma única vez com o token renovado
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
                  error: retryPayload.error || 'Erro ao processar ação social.',
                  code: retryPayload.code,
                };
              }
              return { success: true, data: retryPayload.data };
            }
            return { success: true, data: retryRes.data as T };
          }

          const translatedRetry = translateSocialError(retryRes.error);
          return { success: false, error: translatedRetry.message, code: translatedRetry.code };
        }

        // Se refresh falhou, limpa cache e retorna mensagem limpa
        clearSocialCache();
        return {
          success: false,
          error: 'Sua sessão expirou. Entre novamente.',
          code: 'SESSION_EXPIRED',
        };
      }

      const translated = translateSocialError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    const payload = data as { success?: boolean; data?: T; error?: string; code?: string };
    if (payload && typeof payload === 'object' && 'success' in payload) {
      if (!payload.success) {
        return {
          success: false,
          error: payload.error || 'Erro ao processar ação social.',
          code: payload.code,
        };
      }
      return { success: true, data: payload.data };
    }

    return { success: true, data: data as T };
  } catch (err: unknown) {
    if (isAuthOrTokenExpiredError(err)) {
      const refreshRes = await safeRefreshSession();
      if (refreshRes.success) {
        try {
          const retryRes = await runCall();
          if (!retryRes.error) {
            const retryPayload = retryRes.data as { success?: boolean; data?: T; error?: string };
            if (retryPayload && typeof retryPayload === 'object' && 'success' in retryPayload) {
              if (retryPayload.success) {
                return { success: true, data: retryPayload.data };
              }
              return { success: false, error: retryPayload.error || 'Erro ao processar ação social.' };
            }
            return { success: true, data: retryRes.data as T };
          }
        } catch {
          // ignora e cai no erro traduzido
        }
      }
      clearSocialCache();
      return {
        success: false,
        error: 'Sua sessão expirou. Entre novamente.',
        code: 'SESSION_EXPIRED',
      };
    }

    const errorObj = translateSocialError(err);
    return { success: false, error: errorObj.message, code: errorObj.code };
  }
}

/**
 * Busca jogadores na plataforma por @username ou display_name.
 */
export async function searchPlayers(
  query: string,
  limit: number = 20
): Promise<SocialOperationResult<FriendSearchResult[]>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase não configurado.', code: 'NOT_CONFIGURED' };
  }

  const cleanQuery = query.trim().replace(/^@/, '');
  if (cleanQuery.length < 2) {
    return { success: true, data: [] };
  }

  return executeSocialRpc<FriendSearchResult[]>('search_players', {
    p_query: cleanQuery,
    p_limit: limit,
  });
}

/**
 * Envia uma solicitação de amizade autoritativa.
 */
export async function sendFriendRequest(
  recipientId: string
): Promise<SocialOperationResult<{ request_id: string; status: string; action: string }>> {
  if (!isSupabaseConfigured || !recipientId) {
    return { success: false, error: 'Supabase não configurado ou ID inválido.', code: 'INVALID_PARAM' };
  }

  const res = await executeSocialRpc<{ request_id: string; status: string; action: string }>(
    'send_friend_request',
    { p_recipient_id: recipientId }
  );

  if (res.success) {
    clearSocialCache();
  }
  return res;
}

/**
 * Aceita uma solicitação de amizade recebida.
 */
export async function acceptFriendRequest(
  requestId: string
): Promise<SocialOperationResult<{ request_id: string; status: string }>> {
  if (!isSupabaseConfigured || !requestId) {
    return { success: false, error: 'Supabase não configurado ou ID inválido.', code: 'INVALID_PARAM' };
  }

  const res = await executeSocialRpc<{ request_id: string; status: string }>('accept_friend_request', {
    p_request_id: requestId,
  });

  if (res.success) {
    clearSocialCache();
  }
  return res;
}

/**
 * Recusa uma solicitação de amizade recebida.
 */
export async function declineFriendRequest(
  requestId: string
): Promise<SocialOperationResult<{ request_id: string; status: string }>> {
  if (!isSupabaseConfigured || !requestId) {
    return { success: false, error: 'Supabase não configurado ou ID inválido.', code: 'INVALID_PARAM' };
  }

  const res = await executeSocialRpc<{ request_id: string; status: string }>('decline_friend_request', {
    p_request_id: requestId,
  });

  if (res.success) {
    clearSocialCache();
  }
  return res;
}

/**
 * Cancela uma solicitação de amizade enviada anteriormente.
 */
export async function cancelFriendRequest(
  requestId: string
): Promise<SocialOperationResult<{ request_id: string; status: string }>> {
  if (!isSupabaseConfigured || !requestId) {
    return { success: false, error: 'Supabase não configurado ou ID inválido.', code: 'INVALID_PARAM' };
  }

  const res = await executeSocialRpc<{ request_id: string; status: string }>('cancel_friend_request', {
    p_request_id: requestId,
  });

  if (res.success) {
    clearSocialCache();
  }
  return res;
}

/**
 * Remove uma amizade existente.
 */
export async function removeFriend(
  friendId: string
): Promise<SocialOperationResult<{ friend_id: string; removed: boolean }>> {
  if (!isSupabaseConfigured || !friendId) {
    return { success: false, error: 'Supabase não configurado ou ID inválido.', code: 'INVALID_PARAM' };
  }

  const res = await executeSocialRpc<{ friend_id: string; removed: boolean }>('remove_friend', {
    p_friend_id: friendId,
  });

  if (res.success) {
    clearSocialCache();
  }
  return res;
}

/**
 * Retorna a lista de amigos do usuário atual com status de presença recente.
 */
export async function getMyFriends(forceRefresh = false): Promise<SocialOperationResult<Friend[]>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase não configurado.', code: 'NOT_CONFIGURED' };
  }

  if (!forceRefresh && socialCache.friends && Date.now() - socialCache.friends.timestamp < CACHE_TTL_MS) {
    return { success: true, data: socialCache.friends.data };
  }

  const res = await executeSocialRpc<Friend[]>('get_my_friends');
  if (res.success && res.data) {
    socialCache.friends = { data: res.data, timestamp: Date.now() };
  }
  return res;
}

/**
 * Retorna as solicitações de amizade recebidas e pendentes.
 */
export async function getReceivedFriendRequests(
  forceRefresh = false
): Promise<SocialOperationResult<FriendRequest[]>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase não configurado.', code: 'NOT_CONFIGURED' };
  }

  if (
    !forceRefresh &&
    socialCache.receivedRequests &&
    Date.now() - socialCache.receivedRequests.timestamp < CACHE_TTL_MS
  ) {
    return { success: true, data: socialCache.receivedRequests.data };
  }

  const res = await executeSocialRpc<FriendRequest[]>('get_received_friend_requests');
  if (res.success && res.data) {
    socialCache.receivedRequests = { data: res.data, timestamp: Date.now() };
  }
  return res;
}

/**
 * Retorna as solicitações de amizade enviadas e pendentes.
 */
export async function getSentFriendRequests(
  forceRefresh = false
): Promise<SocialOperationResult<FriendRequest[]>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase não configurado.', code: 'NOT_CONFIGURED' };
  }

  if (
    !forceRefresh &&
    socialCache.sentRequests &&
    Date.now() - socialCache.sentRequests.timestamp < CACHE_TTL_MS
  ) {
    return { success: true, data: socialCache.sentRequests.data };
  }

  const res = await executeSocialRpc<FriendRequest[]>('get_sent_friend_requests');
  if (res.success && res.data) {
    socialCache.sentRequests = { data: res.data, timestamp: Date.now() };
  }
  return res;
}

/**
 * Consulta o status social e de presença entre o usuário autenticado e outro jogador.
 */
export async function getFriendshipStatus(
  otherUserId: string,
  forceRefresh = false
): Promise<SocialOperationResult<FriendshipStatusData>> {
  if (!isSupabaseConfigured || !otherUserId) {
    return { success: false, error: 'Supabase não configurado ou ID inválido.', code: 'INVALID_PARAM' };
  }

  const cached = socialCache.statusMap.get(otherUserId);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { success: true, data: cached.data };
  }

  const res = await executeSocialRpc<FriendshipStatusData>('get_friendship_status', {
    p_other_user_id: otherUserId,
  });

  if (res.success && res.data) {
    socialCache.statusMap.set(otherUserId, { data: res.data, timestamp: Date.now() });
  }
  return res;
}
