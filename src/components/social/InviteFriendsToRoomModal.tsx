// ============================================================================
// Component: InviteFriendsToRoomModal — DuoPlay-Online
// Phase: Fase 14.2 — Convites de Partida entre Amigos + Convite pela Sala de Espera
// Description: Modal de seleção e convite de amigos diretamente pela sala de espera.
// ============================================================================

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users,
  Search,
  X,
  Send,
  Check,
  RotateCw,
  AlertCircle,
  Clock,
  UserCheck,
} from 'lucide-react';
import { PlayerAvatar } from '@/components/profile/PlayerAvatar';
import { useSocial } from '@/hooks/useSocial';
import { createGameInvite, getRoomInvites } from '@/services/invites';
import type { RoomInviteInfo } from '@/types/invites';
import type { RoomWithMembers } from '@/services/rooms';

interface InviteFriendsToRoomModalProps {
  isOpen: boolean;
  roomId: string;
  roomCode: string;
  currentRoom: RoomWithMembers | null;
  onClose: () => void;
}

export const InviteFriendsToRoomModal: React.FC<InviteFriendsToRoomModalProps> = ({
  isOpen,
  roomId,
  currentRoom,
  onClose,
}) => {
  const { friends, isLoading: isSocialLoading, refresh: refreshFriends } = useSocial();
  const [searchQuery, setSearchQuery] = useState('');
  const [roomInvites, setRoomInvites] = useState<RoomInviteInfo[]>([]);
  const [sendingFriendId, setSendingFriendId] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);

  const isRoomFull = useMemo(() => {
    if (!currentRoom) return false;
    return currentRoom.members.length >= currentRoom.max_members;
  }, [currentRoom]);

  const loadRoomInvites = useCallback(async () => {
    if (!roomId) return;
    const res = await getRoomInvites(roomId, true);
    if (res.success && res.data) {
      setRoomInvites(res.data);
    }
  }, [roomId]);

  useEffect(() => {
    if (isOpen && roomId) {
      setFeedbackError(null);
      setFeedbackSuccess(null);
      refreshFriends(true);
      loadRoomInvites();
    }
  }, [isOpen, roomId, refreshFriends, loadRoomInvites]);

  // Mapa de status do convite por ID do amigo
  const invitesMap = useMemo(() => {
    const map = new Map<string, RoomInviteInfo>();
    const now = Date.now();
    for (const inv of roomInvites) {
      // Se for pending e expirou, ignora pending ativo
      const isExpired = inv.status === 'pending' && new Date(inv.expires_at).getTime() <= now;
      if (!isExpired) {
        map.set(inv.receiver_id, inv);
      }
    }
    return map;
  }, [roomInvites]);

  // Lista de amigos filtrada
  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) return friends;
    const q = searchQuery.toLowerCase().trim();
    return friends.filter(
      (f) =>
        f.display_name.toLowerCase().includes(q) ||
        f.username.toLowerCase().includes(q)
    );
  }, [friends, searchQuery]);

  const handleSendInvite = async (friendId: string, friendName: string) => {
    if (sendingFriendId || isRoomFull) return;
    setSendingFriendId(friendId);
    setFeedbackError(null);
    setFeedbackSuccess(null);

    try {
      const res = await createGameInvite(friendId, roomId);
      if (res.success) {
        setFeedbackSuccess(`Convite enviado para ${friendName}!`);
        await loadRoomInvites();
      } else {
        setFeedbackError(res.error || 'Não foi possível enviar o convite.');
      }
    } catch {
      setFeedbackError('Erro de conexão ao enviar convite.');
    } finally {
      setSendingFriendId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-friends-title"
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 id="invite-friends-title" className="text-base font-bold text-white leading-tight">
                Convidar Amigos
              </h2>
              <p className="text-xs text-slate-400">
                Convide seus amigos diretamente para esta sala
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Fechar"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback alerts */}
        {feedbackError && (
          <div className="m-3 p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{feedbackError}</span>
          </div>
        )}

        {feedbackSuccess && (
          <div className="m-3 p-3 rounded-xl bg-emerald-950/60 border border-emerald-800/80 text-emerald-200 text-xs flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{feedbackSuccess}</span>
          </div>
        )}

        {/* Search bar */}
        <div className="p-3 border-b border-slate-800/80 bg-slate-900/50">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar amigo por nome ou @username..."
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Friends List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 divide-y divide-slate-800/40">
          {isSocialLoading && friends.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <RotateCw className="w-6 h-6 animate-spin mx-auto text-blue-400" />
              <p className="text-xs">Carregando lista de amigos...</p>
            </div>
          ) : filteredFriends.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <Users className="w-8 h-8 mx-auto text-slate-600" />
              <p className="text-xs font-semibold">
                {friends.length === 0
                  ? 'Você ainda não possui amigos adicionados.'
                  : 'Nenhum amigo encontrado na busca.'}
              </p>
            </div>
          ) : (
            filteredFriends.map((friend) => {
              const inviteInfo = invitesMap.get(friend.friend_id);
              const isSending = sendingFriendId === friend.friend_id;
              const isMember = currentRoom?.members.some((m) => m.user_id === friend.friend_id);

              return (
                <div
                  key={friend.friend_id}
                  className="pt-2 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      <PlayerAvatar
                        avatarUrl={friend.avatar_url}
                        displayName={friend.display_name}
                        size="md"
                      />
                      <span
                        className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-slate-900 ${
                          friend.is_online ? 'bg-emerald-500' : 'bg-slate-500'
                        }`}
                        title={friend.is_online ? 'Online' : 'Offline'}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">
                        {friend.display_name}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        @{friend.username} {friend.is_online ? '· Online' : '· Offline'}
                      </div>
                    </div>
                  </div>

                  {/* Actions / Status */}
                  <div className="shrink-0">
                    {isMember ? (
                      <span className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-bold flex items-center gap-1">
                        <UserCheck className="w-3.5 h-3.5" /> Na Sala
                      </span>
                    ) : inviteInfo?.status === 'pending' ? (
                      <span className="px-2.5 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[11px] font-bold flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 animate-pulse" /> Convite enviado
                      </span>
                    ) : inviteInfo?.status === 'declined' ? (
                      <button
                        type="button"
                        disabled={isSending || isRoomFull}
                        onClick={() => handleSendInvite(friend.friend_id, friend.display_name)}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {isSending ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        <span>Reenviar</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isSending || isRoomFull}
                        onClick={() => handleSendInvite(friend.friend_id, friend.display_name)}
                        className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-900/30 transition-all disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {isSending ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        <span>Convidar</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            {isRoomFull ? 'Sala cheia' : 'Envie convites para jogar em tempo real'}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-bold transition-colors"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
};
