// ============================================================================
// Service: Social & Friends Orchestration — DuoPlay-Online
// Phase: Fase 14 — Sistema Social: Amigos e Jogadores
// Description: Gerenciamento autoritativo de amizades, solicitações, busca de
//              jogadores e presença através das RPCs oficiais do PostgreSQL.
// ============================================================================

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
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

  const errObj = error as { code?: string; message?: string };
  const rawMsg = errObj.message || '';
  const code = errObj.code || 'UNKNOWN_ERROR';

  if (rawMsg.includes('P0001') || rawMsg.includes('UNAUTHORIZED')) {
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
  if (rawMsg.includes('Failed to fetch') || rawMsg.includes('NetworkError') || rawMsg.includes('fetch')) {
    return { message: 'Erro de conexão com o servidor. Verifique sua internet.', code: 'NETWORK_ERROR' };
  }
  if (rawMsg.startsWith('SQLSTATE') || rawMsg.includes('PostgresError')) {
    return { message: 'Erro ao processar ação social no servidor.', code };
  }

  return { message: rawMsg || 'Erro ao processar ação social.', code };
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

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('search_players', {
      p_query: cleanQuery,
      p_limit: limit,
    });

    if (error) {
      const translated = translateSocialError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    const payload = data as { success: boolean; data?: FriendSearchResult[]; error?: string };
    if (!payload?.success) {
      return { success: false, error: payload?.error || 'Erro ao pesquisar jogadores.' };
    }

    return { success: true, data: payload.data || [] };
  } catch (err: unknown) {
    const errorObj = translateSocialError(err);
    return { success: false, error: errorObj.message, code: errorObj.code };
  }
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

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('send_friend_request', {
      p_recipient_id: recipientId,
    });

    if (error) {
      const translated = translateSocialError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    const payload = data as {
      success: boolean;
      data?: { request_id: string; status: string; action: string };
      error?: string;
      code?: string;
    };

    if (!payload?.success) {
      return {
        success: false,
        error: payload?.error || 'Não foi possível enviar a solicitação.',
        code: payload?.code,
      };
    }

    clearSocialCache();
    return { success: true, data: payload.data };
  } catch (err: unknown) {
    const errorObj = translateSocialError(err);
    return { success: false, error: errorObj.message, code: errorObj.code };
  }
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

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('accept_friend_request', {
      p_request_id: requestId,
    });

    if (error) {
      const translated = translateSocialError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    const payload = data as { success: boolean; data?: { request_id: string; status: string }; error?: string };
    if (!payload?.success) {
      return { success: false, error: payload?.error || 'Falha ao aceitar solicitação.' };
    }

    clearSocialCache();
    return { success: true, data: payload.data };
  } catch (err: unknown) {
    const errorObj = translateSocialError(err);
    return { success: false, error: errorObj.message, code: errorObj.code };
  }
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

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('decline_friend_request', {
      p_request_id: requestId,
    });

    if (error) {
      const translated = translateSocialError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    const payload = data as { success: boolean; data?: { request_id: string; status: string }; error?: string };
    if (!payload?.success) {
      return { success: false, error: payload?.error || 'Falha ao recusar solicitação.' };
    }

    clearSocialCache();
    return { success: true, data: payload.data };
  } catch (err: unknown) {
    const errorObj = translateSocialError(err);
    return { success: false, error: errorObj.message, code: errorObj.code };
  }
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

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('cancel_friend_request', {
      p_request_id: requestId,
    });

    if (error) {
      const translated = translateSocialError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    const payload = data as { success: boolean; data?: { request_id: string; status: string }; error?: string };
    if (!payload?.success) {
      return { success: false, error: payload?.error || 'Falha ao cancelar solicitação.' };
    }

    clearSocialCache();
    return { success: true, data: payload.data };
  } catch (err: unknown) {
    const errorObj = translateSocialError(err);
    return { success: false, error: errorObj.message, code: errorObj.code };
  }
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

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('remove_friend', {
      p_friend_id: friendId,
    });

    if (error) {
      const translated = translateSocialError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    const payload = data as { success: boolean; data?: { friend_id: string; removed: boolean }; error?: string };
    if (!payload?.success) {
      return { success: false, error: payload?.error || 'Falha ao desfazer amizade.' };
    }

    clearSocialCache();
    return { success: true, data: payload.data };
  } catch (err: unknown) {
    const errorObj = translateSocialError(err);
    return { success: false, error: errorObj.message, code: errorObj.code };
  }
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

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_my_friends');

    if (error) {
      const translated = translateSocialError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    const payload = data as { success: boolean; data?: Friend[]; error?: string };
    if (!payload?.success) {
      return { success: false, error: payload?.error || 'Erro ao carregar lista de amigos.' };
    }

    const friends = payload.data || [];
    socialCache.friends = { data: friends, timestamp: Date.now() };
    return { success: true, data: friends };
  } catch (err: unknown) {
    const errorObj = translateSocialError(err);
    return { success: false, error: errorObj.message, code: errorObj.code };
  }
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

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_received_friend_requests');

    if (error) {
      const translated = translateSocialError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    const payload = data as { success: boolean; data?: FriendRequest[]; error?: string };
    if (!payload?.success) {
      return { success: false, error: payload?.error || 'Erro ao carregar solicitações recebidas.' };
    }

    const requests = payload.data || [];
    socialCache.receivedRequests = { data: requests, timestamp: Date.now() };
    return { success: true, data: requests };
  } catch (err: unknown) {
    const errorObj = translateSocialError(err);
    return { success: false, error: errorObj.message, code: errorObj.code };
  }
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

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_sent_friend_requests');

    if (error) {
      const translated = translateSocialError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    const payload = data as { success: boolean; data?: FriendRequest[]; error?: string };
    if (!payload?.success) {
      return { success: false, error: payload?.error || 'Erro ao carregar solicitações enviadas.' };
    }

    const requests = payload.data || [];
    socialCache.sentRequests = { data: requests, timestamp: Date.now() };
    return { success: true, data: requests };
  } catch (err: unknown) {
    const errorObj = translateSocialError(err);
    return { success: false, error: errorObj.message, code: errorObj.code };
  }
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

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_friendship_status', {
      p_other_user_id: otherUserId,
    });

    if (error) {
      const translated = translateSocialError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    const payload = data as { success: boolean; data?: FriendshipStatusData; error?: string };
    if (!payload?.success || !payload.data) {
      return { success: false, error: payload?.error || 'Erro ao consultar status de amizade.' };
    }

    socialCache.statusMap.set(otherUserId, { data: payload.data, timestamp: Date.now() });
    return { success: true, data: payload.data };
  } catch (err: unknown) {
    const errorObj = translateSocialError(err);
    return { success: false, error: errorObj.message, code: errorObj.code };
  }
}
