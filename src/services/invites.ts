// ============================================================================
// Service: Game Invites Orchestration — DuoPlay-Online
// Phase: Fase 14.2 — Convites de Partida entre Amigos + Convite pela Sala de Espera
// Description: Gerenciamento autoritativo de convites diretos para salas de jogo
//              com proteção de sessão/JWT, retry transparente e cache em memória.
// ============================================================================

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { safeRefreshSession, isAuthOrTokenExpiredError } from '@/services/auth';
import type {
  GameInvite,
  RoomInviteInfo,
  GameInviteOperationResult,
} from '@/types/invites';

interface InvitesCache {
  pendingReceived: { data: GameInvite[]; timestamp: number } | null;
  roomInvitesMap: Map<string, { data: RoomInviteInfo[]; timestamp: number }>;
}

const CACHE_TTL_MS = 10000; // 10 segundos

let invitesCache: InvitesCache = {
  pendingReceived: null,
  roomInvitesMap: new Map(),
};

export function clearInvitesCache(): void {
  invitesCache = {
    pendingReceived: null,
    roomInvitesMap: new Map(),
  };
}

export function translateInviteError(error: unknown): { message: string; code: string } {
  if (!error || typeof error !== 'object') {
    return { message: 'Ocorreu um erro inesperado no convite. Tente novamente.', code: 'UNKNOWN_ERROR' };
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
  if (rawMsg.includes('P0050') || rawMsg.includes('CANNOT_INVITE_SELF')) {
    return { message: 'Você não pode convidar a si mesmo para uma partida.', code: 'CANNOT_INVITE_SELF' };
  }
  if (rawMsg.includes('P0041') || rawMsg.includes('USER_NOT_FOUND')) {
    return { message: 'Jogador não encontrado na plataforma.', code: 'USER_NOT_FOUND' };
  }
  if (rawMsg.includes('P0051') || rawMsg.includes('USER_NOT_FRIEND')) {
    return { message: 'Você só pode convidar jogadores da sua lista de amigos.', code: 'USER_NOT_FRIEND' };
  }
  if (rawMsg.includes('P0052') || rawMsg.includes('ROOM_NOT_FOUND')) {
    return { message: 'A sala selecionada não foi encontrada ou foi encerrada.', code: 'ROOM_NOT_FOUND' };
  }
  if (rawMsg.includes('P0053') || rawMsg.includes('NOT_ROOM_HOST')) {
    return { message: 'Apenas membros da sala podem enviar convites.', code: 'NOT_ROOM_HOST' };
  }
  if (rawMsg.includes('P0054') || rawMsg.includes('ROOM_FULL')) {
    return { message: 'Esta sala já atingiu a capacidade máxima de jogadores.', code: 'ROOM_FULL' };
  }
  if (rawMsg.includes('P0055') || rawMsg.includes('INVITE_ALREADY_SENT')) {
    return { message: 'Já existe um convite pendente para este amigo nesta sala.', code: 'INVITE_ALREADY_SENT' };
  }
  if (rawMsg.includes('P0056') || rawMsg.includes('INVITE_NOT_FOUND')) {
    return { message: 'Convite de partida não encontrado.', code: 'INVITE_NOT_FOUND' };
  }
  if (rawMsg.includes('P0057') || rawMsg.includes('INVITE_EXPIRED')) {
    return { message: 'Este convite de partida expirou.', code: 'INVITE_EXPIRED' };
  }
  if (rawMsg.includes('P0058') || rawMsg.includes('INVITE_ALREADY_RESPONDED')) {
    return { message: 'Este convite já foi aceito, recusado ou cancelado.', code: 'INVITE_ALREADY_RESPONDED' };
  }
  if (rawMsg.includes('P0059') || rawMsg.includes('ROOM_UNAVAILABLE')) {
    return { message: 'A sala não está mais disponível para novos participantes.', code: 'ROOM_UNAVAILABLE' };
  }
  if (lowerMsg.includes('failed to fetch') || lowerMsg.includes('networkerror') || lowerMsg.includes('fetch')) {
    return { message: 'Erro de conexão com o servidor. Verifique sua internet.', code: 'NETWORK_ERROR' };
  }

  return { message: rawMsg || 'Erro ao processar convite de partida.', code };
}

async function executeInviteRpc<T>(
  rpcName: string,
  params?: Record<string, unknown>
): Promise<GameInviteOperationResult<T>> {
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
        const refreshResult = await safeRefreshSession();
        if (refreshResult.success) {
          const retryRes = await runCall();
          if (!retryRes.error) {
            const rawData = retryRes.data;
            if (rawData && typeof rawData === 'object' && 'success' in rawData) {
              if (rawData.success) {
                return { success: true, data: rawData.data as T };
              }
              const errParsed = translateInviteError(rawData.error || rawData);
              return { success: false, error: errParsed.message, code: errParsed.code };
            }
            return { success: true, data: rawData as T };
          }
        }
        clearInvitesCache();
        return {
          success: false,
          error: 'Sua sessão expirou. Entre novamente.',
          code: 'SESSION_EXPIRED',
        };
      }

      const errParsed = translateInviteError(error);
      return { success: false, error: errParsed.message, code: errParsed.code };
    }

    const rawData = data;
    if (rawData && typeof rawData === 'object' && 'success' in rawData) {
      if (!rawData.success) {
        const errParsed = translateInviteError(rawData.error || rawData);
        return { success: false, error: errParsed.message, code: errParsed.code };
      }
      return { success: true, data: rawData.data as T };
    }

    return { success: true, data: rawData as T };
  } catch (err) {
    if (isAuthOrTokenExpiredError(err)) {
      clearInvitesCache();
      return {
        success: false,
        error: 'Sua sessão expirou. Entre novamente.',
        code: 'SESSION_EXPIRED',
      };
    }
    const errParsed = translateInviteError(err);
    return { success: false, error: errParsed.message, code: errParsed.code };
  }
}

/**
 * Cria um convite direto de partida para um amigo em uma sala existente.
 */
export async function createGameInvite(
  receiverId: string,
  roomId: string
): Promise<GameInviteOperationResult<{ invite: unknown }>> {
  const result = await executeInviteRpc<{ invite: unknown }>('create_game_invite', {
    p_receiver_id: receiverId,
    p_room_id: roomId,
  });

  if (result.success) {
    invitesCache.roomInvitesMap.delete(roomId);
  }

  return result;
}

/**
 * Aceita atomicamente um convite de partida recebido e vincula o jogador à sala.
 */
export async function acceptGameInvite(
  inviteId: string
): Promise<GameInviteOperationResult<{ invite: unknown; room: { id: string; code: string; status: string }; member: unknown }>> {
  const result = await executeInviteRpc<{ invite: unknown; room: { id: string; code: string; status: string }; member: unknown }>(
    'accept_game_invite',
    { p_invite_id: inviteId }
  );

  if (result.success) {
    clearInvitesCache();
  }

  return result;
}

/**
 * Recusa um convite de partida recebido.
 */
export async function declineGameInvite(
  inviteId: string
): Promise<GameInviteOperationResult<{ invite_id: string }>> {
  const result = await executeInviteRpc<{ invite_id: string }>('decline_game_invite', {
    p_invite_id: inviteId,
  });

  if (result.success) {
    clearInvitesCache();
  }

  return result;
}

/**
 * Cancela um convite de partida enviado pelo próprio usuário.
 */
export async function cancelGameInvite(
  inviteId: string
): Promise<GameInviteOperationResult<{ invite_id: string }>> {
  const result = await executeInviteRpc<{ invite_id: string }>('cancel_game_invite', {
    p_invite_id: inviteId,
  });

  if (result.success) {
    clearInvitesCache();
  }

  return result;
}

/**
 * Retorna todos os convites pendentes e não expirados recebidos pelo usuário autenticado.
 */
export async function getPendingReceivedInvites(
  force = false
): Promise<GameInviteOperationResult<GameInvite[]>> {
  const now = Date.now();
  if (!force && invitesCache.pendingReceived && now - invitesCache.pendingReceived.timestamp < CACHE_TTL_MS) {
    return { success: true, data: invitesCache.pendingReceived.data };
  }

  const result = await executeInviteRpc<GameInvite[]>('get_pending_received_invites');

  if (result.success && result.data) {
    const list = Array.isArray(result.data) ? result.data : [];
    invitesCache.pendingReceived = { data: list, timestamp: now };
    return { success: true, data: list };
  }

  return result;
}

/**
 * Retorna o histórico e status de convites emitidos para uma sala específica.
 */
export async function getRoomInvites(
  roomId: string,
  force = false
): Promise<GameInviteOperationResult<RoomInviteInfo[]>> {
  const now = Date.now();
  const cached = invitesCache.roomInvitesMap.get(roomId);
  if (!force && cached && now - cached.timestamp < CACHE_TTL_MS) {
    return { success: true, data: cached.data };
  }

  const result = await executeInviteRpc<RoomInviteInfo[]>('get_room_invites', {
    p_room_id: roomId,
  });

  if (result.success && result.data) {
    const list = Array.isArray(result.data) ? result.data : [];
    invitesCache.roomInvitesMap.set(roomId, { data: list, timestamp: now });
    return { success: true, data: list };
  }

  return result;
}
