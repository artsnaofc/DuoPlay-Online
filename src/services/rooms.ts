// ============================================================================
// Service: Room & Match Orchestration — DuoPlay-Online
// Phase: Fase 7 — Integração End-to-End do Jogo da Velha
// Description: Gerenciamento do ciclo de vida de salas e início de partidas
//              utilizando as RPCs oficiais do PostgreSQL com autenticação.
// ============================================================================

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { RoomDTO, RoomMemberDTO } from '@/types/multiplayer';

export interface RoomOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface RoomWithMembers extends RoomDTO {
  members: (RoomMemberDTO & {
    display_name?: string;
    username?: string;
  })[];
}

export function translateRoomError(error: unknown): { message: string; code: string } {
  if (!error || typeof error !== 'object') {
    return { message: 'Ocorreu um erro inesperado na sala. Tente novamente.', code: 'UNKNOWN_ERROR' };
  }

  const errObj = error as { code?: string; message?: string };
  const rawMsg = errObj.message || '';
  const code = errObj.code || 'UNKNOWN_ERROR';

  if (code === '42P17' || rawMsg.includes('42P17') || rawMsg.includes('infinite recursion')) {
    return {
      message: 'Erro no banco de dados: recursão de RLS detectada nas salas/membros.',
      code: 'RLS_RECURSION_ERROR',
    };
  }
  if (code === '42501' || rawMsg.includes('42501') || rawMsg.includes('permission denied')) {
    return {
      message: 'Permissão negada para visualizar esta sala ou seus membros.',
      code: 'PERMISSION_DENIED',
    };
  }
  if (rawMsg.includes('P0001') || rawMsg.includes('UNAUTHORIZED')) {
    return { message: 'Você precisa estar logado para entrar ou criar salas.', code: 'UNAUTHORIZED' };
  }
  if (rawMsg.includes('P0005') || rawMsg.includes('ROOM_NOT_FOUND')) {
    return { message: 'Sala não encontrada ou código incorreto.', code: 'ROOM_NOT_FOUND' };
  }
  if (rawMsg.includes('P0006') || rawMsg.includes('MATCH_ALREADY_IN_PROGRESS')) {
    return { message: 'A partida desta sala já foi iniciada.', code: 'MATCH_ALREADY_IN_PROGRESS' };
  }
  if (rawMsg.includes('P0007') || rawMsg.includes('ROOM_FULL')) {
    return { message: 'Esta sala já atingiu o limite máximo de jogadores.', code: 'ROOM_FULL' };
  }
  if (rawMsg.includes('P0008') || rawMsg.includes('PLAYER_SLOTS_FULL')) {
    return { message: 'Todas as vagas de jogador já foram preenchidas.', code: 'PLAYER_SLOTS_FULL' };
  }
  if (rawMsg.includes('P0010') || rawMsg.includes('NOT_ROOM_HOST')) {
    return { message: 'Apenas o anfitrião (Host) pode iniciar a partida.', code: 'NOT_ROOM_HOST' };
  }
  if (rawMsg.includes('P0011') || rawMsg.includes('INVALID_ROOM_STATUS')) {
    return { message: 'A sala não está pronta para iniciar.', code: 'INVALID_ROOM_STATUS' };
  }
  if (rawMsg.includes('P0012') || rawMsg.includes('INSUFFICIENT_PLAYERS')) {
    return { message: 'Aguarde o segundo jogador entrar para iniciar.', code: 'INSUFFICIENT_PLAYERS' };
  }
  if (rawMsg.includes('P0013') || rawMsg.includes('PLAYERS_NOT_READY')) {
    return { message: 'Todos os jogadores precisam confirmar "Pronto" antes de iniciar.', code: 'PLAYERS_NOT_READY' };
  }
  if (rawMsg.includes('Failed to fetch') || rawMsg.includes('NetworkError') || rawMsg.includes('fetch')) {
    return { message: 'Erro de conexão com o servidor. Verifique sua conexão.', code: 'NETWORK_ERROR' };
  }
  if (rawMsg.includes('invalid input syntax for type uuid') || rawMsg.includes('violates foreign key')) {
    return { message: 'A sala solicitada não foi encontrada ou não está disponível.', code: 'ROOM_NOT_FOUND' };
  }

  return { message: rawMsg || 'Erro ao processar sala.', code };
}

/**
 * Cria uma nova sala de jogo no PostgreSQL via RPC create_room.
 */
export async function createRoom(
  gameId: string = 'tic_tac_toe',
  name: string = 'Sala de Jogo da Velha'
): Promise<RoomOperationResult<{ room: RoomDTO; member: RoomMemberDTO }>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase não está configurado.', code: 'NOT_CONFIGURED' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('create_room', {
      p_game_id: gameId,
      p_name: name,
      p_is_private: true,
      p_max_members: 2,
    });

    if (error) {
      const translated = translateRoomError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    const payload = data as { success: boolean; data?: { room: RoomDTO; member: RoomMemberDTO }; error?: { message: string; code: string } };
    if (!payload.success || !payload.data) {
      const translated = translateRoomError(payload.error);
      return { success: false, error: translated.message, code: translated.code };
    }

    return { success: true, data: payload.data };
  } catch (err) {
    const translated = translateRoomError(err);
    return { success: false, error: translated.message, code: translated.code };
  }
}

/**
 * Entra em uma sala existente através do código de 6 caracteres via RPC join_room_by_code.
 */
export async function joinRoomByCode(
  code: string
): Promise<RoomOperationResult<{ room: RoomDTO; member: RoomMemberDTO }>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase não está configurado.', code: 'NOT_CONFIGURED' };
  }

  const cleanCode = code.trim().toUpperCase();
  if (cleanCode.length < 4 || cleanCode.length > 8) {
    return { success: false, error: 'Código de sala inválido. Deve ter 6 caracteres.', code: 'INVALID_CODE' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('join_room_by_code', {
      p_code: cleanCode,
      p_as_spectator: false,
    });

    if (error) {
      const translated = translateRoomError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    const payload = data as { success: boolean; data?: { room: RoomDTO; member: RoomMemberDTO }; error?: { message: string; code: string } };
    if (!payload.success || !payload.data) {
      const translated = translateRoomError(payload.error);
      return { success: false, error: translated.message, code: translated.code };
    }

    return { success: true, data: payload.data };
  } catch (err) {
    const translated = translateRoomError(err);
    return { success: false, error: translated.message, code: translated.code };
  }
}

/**
 * Atualiza o status de prontidão (is_ready) do jogador na sala.
 */
export async function setMemberReady(
  roomId: string,
  isReady: boolean
): Promise<RoomOperationResult> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase não está configurado.', code: 'NOT_CONFIGURED' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('set_member_ready', {
      p_room_id: roomId,
      p_is_ready: isReady,
    });

    if (error) {
      const translated = translateRoomError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    return { success: true };
  } catch (err) {
    const translated = translateRoomError(err);
    return { success: false, error: translated.message, code: translated.code };
  }
}

/**
 * Inicia a partida oficial da sala através da RPC start_match.
 * Retorna o ID da partida criada no PostgreSQL.
 */
export async function startMatch(
  roomId: string
): Promise<RoomOperationResult<{ matchId: string }>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase não está configurado.', code: 'NOT_CONFIGURED' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('start_match', {
      p_room_id: roomId,
    });

    if (error) {
      const translated = translateRoomError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    const payload = data as {
      success: boolean;
      data?: { match: { id: string } };
      error?: { message: string; code: string };
    };

    if (!payload.success || !payload.data?.match?.id) {
      const translated = translateRoomError(payload.error);
      return { success: false, error: translated.message, code: translated.code };
    }

    return { success: true, data: { matchId: payload.data.match.id } };
  } catch (err) {
    const translated = translateRoomError(err);
    return { success: false, error: translated.message, code: translated.code };
  }
}

/**
 * Sai de uma sala de jogo via RPC leave_room.
 */
export async function leaveRoom(roomId: string): Promise<RoomOperationResult> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase não está configurado.', code: 'NOT_CONFIGURED' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('leave_room', {
      p_room_id: roomId,
    });

    if (error) {
      const translated = translateRoomError(error);
      return { success: false, error: translated.message, code: translated.code };
    }

    return { success: true };
  } catch (err) {
    const translated = translateRoomError(err);
    return { success: false, error: translated.message, code: translated.code };
  }
}

/**
 * Consulta detalhes da sala e seus membros atuais do PostgreSQL.
 * Retorna RoomOperationResult com dados completos ou erro detalhado (sem engolir falhas).
 */
export async function getRoomDetails(roomId: string): Promise<RoomOperationResult<RoomWithMembers>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase não está configurado.', code: 'NOT_CONFIGURED' };
  }
  if (!roomId || !roomId.trim()) {
    return { success: false, error: 'Identificador de sala inválido.', code: 'INVALID_ID' };
  }

  try {
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', roomId.trim())
      .maybeSingle();

    if (roomError) {
      const translated = translateRoomError(roomError);
      return { success: false, error: translated.message, code: translated.code };
    }

    if (!room) {
      return { success: false, error: 'Sala não encontrada ou acesso não autorizado.', code: 'ROOM_NOT_FOUND' };
    }

    const { data: members, error: membersError } = await supabase
      .from('room_members')
      .select('id, room_id, user_id, role, slot_number, is_ready, joined_at, updated_at')
      .eq('room_id', roomId.trim())
      .order('slot_number', { ascending: true });

    if (membersError) {
      const translated = translateRoomError(membersError);
      return { success: false, error: translated.message, code: translated.code };
    }

    // Buscar perfis para obter nomes visíveis
    const userIds = (members || []).map((m) => m.user_id);
    let profilesMap: Record<string, { display_name: string; username: string }> = {};

    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, username')
        .in('id', userIds);

      if (profiles) {
        profilesMap = profiles.reduce((acc, p) => {
          acc[p.id] = { display_name: p.display_name, username: p.username };
          return acc;
        }, {} as Record<string, { display_name: string; username: string }>);
      }
    }

    const enrichedMembers = (members || []).map((m) => ({
      ...m,
      display_name: profilesMap[m.user_id]?.display_name || `Jogador ${m.slot_number || 1}`,
      username: profilesMap[m.user_id]?.username || `player_${m.slot_number || 1}`,
    }));

    return {
      success: true,
      data: {
        ...room,
        members: enrichedMembers,
      },
    };
  } catch (err) {
    const translated = translateRoomError(err);
    return { success: false, error: translated.message, code: translated.code };
  }
}

/**
 * Consulta se o usuário autenticado atual é membro de alguma sala em estado de espera ('waiting').
 */
export async function getMyActiveWaitingRoom(): Promise<RoomOperationResult<RoomWithMembers | null>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase não está configurado.', code: 'NOT_CONFIGURED' };
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: true, data: null };

    const { data: myMemberships, error: memberErr } = await supabase
      .from('room_members')
      .select('room_id')
      .eq('user_id', user.id);

    if (memberErr || !myMemberships || myMemberships.length === 0) {
      return { success: true, data: null };
    }

    const roomIds = myMemberships.map((m) => m.room_id);

    const { data: rooms, error: roomsErr } = await supabase
      .from('rooms')
      .select('id, status, created_at')
      .eq('status', 'waiting')
      .in('id', roomIds)
      .order('created_at', { ascending: false })
      .limit(1);

    if (roomsErr || !rooms || rooms.length === 0) {
      return { success: true, data: null };
    }

    const activeCandidate = rooms[0];
    const roomCreatedAt = new Date(activeCandidate.created_at).getTime();
    const now = Date.now();
    const MAX_WAITING_ROOM_AGE_MS = 60 * 60 * 1000; // 1 hora max

    if (now - roomCreatedAt > MAX_WAITING_ROOM_AGE_MS) {
      return { success: true, data: null };
    }

    const detailsRes = await getRoomDetails(activeCandidate.id);
    if (!detailsRes.success || !detailsRes.data) {
      return { success: true, data: null };
    }

    // Se a sala não estiver em 'waiting' ou o usuário não for membro ativo
    const isUserMember = detailsRes.data.members.some((m) => m.user_id === user.id);
    if (detailsRes.data.status !== 'waiting' || !isUserMember) {
      return { success: true, data: null };
    }

    return detailsRes;
  } catch (err) {
    const translated = translateRoomError(err);
    return { success: false, error: translated.message, code: translated.code };
  }
}
