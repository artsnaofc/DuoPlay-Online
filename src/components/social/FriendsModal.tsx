// ============================================================================
// Component: FriendsModal — DuoPlay-Online
// Phase: Fase 14 — Sistema Social: Amigos e Jogadores
// Description: Modal central do sistema social com abas: Amigos, Solicitações
//              e Encontrar Jogadores, com debounce na busca e ações contextuais.
// ============================================================================

import React, { useState, useEffect, useRef } from 'react';
import {
  Users,
  UserPlus,
  Search,
  X,
  RefreshCw,
  Check,
  UserCheck,
  UserX,
  Play,
  Gamepad2,
  AlertCircle,
  Clock,
  Trash2,
} from 'lucide-react';
import { PlayerAvatar } from '@/components/profile/PlayerAvatar';
import { useSocial } from '@/hooks/useSocial';
import { searchPlayers } from '@/services/social';
import type { Friend, FriendSearchResult } from '@/types/social';

export interface FriendsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onViewUserProfile?: (userId: string) => void;
  onPlayWithFriend?: (friend: Friend) => void;
  initialTab?: 'friends' | 'requests' | 'search';
}

export const FriendsModal: React.FC<FriendsModalProps> = ({
  isOpen,
  onClose,
  onViewUserProfile,
  onPlayWithFriend,
  initialTab = 'friends',
}) => {
  const [activeTab, setActiveTab] = useState<'friends' | 'requests' | 'search'>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FriendSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [confirmRemoveFriendId, setConfirmRemoveFriendId] = useState<string | null>(null);

  const {
    friends,
    receivedRequests,
    sentRequests,
    pendingCount,
    isLoading: isSocialLoading,
    error: socialError,
    refresh,
    sendRequest,
    acceptRequest,
    declineRequest,
    cancelRequest,
    removeFriendship,
  } = useSocial();

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      refresh(true);
    } else {
      setSearchQuery('');
      setSearchResults([]);
      setSearchError(null);
    }
  }, [isOpen, initialTab, refresh]);

  // Busca com debounce de 350ms
  useEffect(() => {
    if (activeTab !== 'search') return;

    const trimmed = searchQuery.trim().replace(/^@/, '');
    if (trimmed.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    setIsSearching(true);
    setSearchError(null);

    searchDebounceRef.current = setTimeout(async () => {
      const res = await searchPlayers(trimmed);
      setIsSearching(false);
      if (res.success && res.data) {
        setSearchResults(res.data);
      } else {
        setSearchError(res.error || 'Erro ao buscar jogadores.');
      }
    }, 350);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [searchQuery, activeTab]);

  if (!isOpen) return null;

  const handleActionSend = async (targetUserId: string) => {
    setActionLoadingId(targetUserId);
    await sendRequest(targetUserId);
    // Atualiza resultado da busca localmente
    setSearchResults((prev) =>
      prev.map((r) =>
        r.user_id === targetUserId ? { ...r, relationship_status: 'request_sent' } : r
      )
    );
    setActionLoadingId(null);
  };

  const handleActionAccept = async (requestId: string) => {
    setActionLoadingId(requestId);
    await acceptRequest(requestId);
    setActionLoadingId(null);
  };

  const handleActionDecline = async (requestId: string) => {
    setActionLoadingId(requestId);
    await declineRequest(requestId);
    setActionLoadingId(null);
  };

  const handleActionCancel = async (requestId: string) => {
    setActionLoadingId(requestId);
    await cancelRequest(requestId);
    setActionLoadingId(null);
  };

  const handleActionRemove = async (friendId: string) => {
    setActionLoadingId(friendId);
    await removeFriendship(friendId);
    setActionLoadingId(null);
    setConfirmRemoveFriendId(null);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="friends-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
    >
      <div className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
        {/* Top Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-500/30 text-purple-400 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 id="friends-modal-title" className="text-base font-bold text-white leading-tight">
                Amigos & Jogadores
              </h2>
              <p className="text-[11px] text-slate-400">Comunidade social DuoPlay Online</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
            aria-label="Fechar modal de amigos"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center border-b border-slate-800 bg-slate-950/40 px-3 sm:px-5 shrink-0 gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('friends')}
            className={`py-3 px-3 text-xs font-bold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'friends'
                ? 'border-purple-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Meus Amigos</span>
            <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-slate-300 font-mono">
              {friends.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('requests')}
            className={`py-3 px-3 text-xs font-bold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'requests'
                ? 'border-purple-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Solicitações</span>
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-red-600 text-[10px] font-bold text-white animate-pulse">
                {pendingCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className={`py-3 px-3 text-xs font-bold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'search'
                ? 'border-purple-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>Encontrar Jogadores</span>
          </button>
        </div>

        {/* Error Alert if any */}
        {socialError && (
          <div className="m-3 p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span className="grow">{socialError}</span>
          </div>
        )}

        {/* Tab Body Content with Scroll */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* TAB 1: MEUS AMIGOS */}
          {activeTab === 'friends' && (
            <div className="space-y-3">
              {isSocialLoading && friends.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-purple-400 mx-auto" />
                  <p className="text-xs text-slate-400">Carregando lista de amigos...</p>
                </div>
              ) : friends.length === 0 ? (
                <div className="py-10 px-4 text-center space-y-3 bg-slate-950/40 rounded-2xl border border-dashed border-slate-800">
                  <div className="w-12 h-12 rounded-2xl bg-purple-950/40 border border-purple-800/40 text-purple-400 flex items-center justify-center mx-auto">
                    <UserPlus className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-white">Você ainda não adicionou ninguém</h3>
                    <p className="text-xs text-slate-400 max-w-xs mx-auto">
                      Encontre outros competidores pelo username e comece a montar sua rede no DuoPlay.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('search')}
                    className="py-2 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition-colors inline-flex items-center gap-1.5 shadow-md shadow-purple-950/50"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>Encontrar Jogadores</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {friends.map((friend) => (
                    <div
                      key={friend.friend_id}
                      className="p-3 sm:p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 transition-colors flex items-center justify-between gap-3"
                    >
                      <div
                        className="flex items-center gap-3 min-w-0 cursor-pointer flex-1 group"
                        onClick={() => onViewUserProfile?.(friend.friend_id)}
                      >
                        <PlayerAvatar
                          avatarUrl={friend.avatar_url}
                          displayName={friend.display_name}
                          username={friend.username}
                          size="md"
                          statusIndicator={friend.is_online ? 'connected' : 'disconnected'}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs sm:text-sm font-bold text-white group-hover:text-purple-300 transition-colors truncate">
                              {friend.display_name}
                            </span>
                            {friend.is_online ? (
                              <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-0.5 shrink-0">
                                ● Online
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-500 shrink-0">Offline</span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 font-mono truncate">
                            @{friend.username}
                          </p>
                        </div>
                      </div>

                      {/* Botões de Ação para Amigos */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {confirmRemoveFriendId === friend.friend_id ? (
                          <div className="flex items-center gap-1.5 bg-red-950/60 border border-red-800/80 rounded-lg p-1 animate-fade-in">
                            <span className="text-[10px] text-red-200 px-1 font-semibold hidden sm:inline">Remover?</span>
                            <button
                              type="button"
                              onClick={() => handleActionRemove(friend.friend_id)}
                              disabled={actionLoadingId === friend.friend_id}
                              className="py-1 px-2 rounded bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold transition-colors"
                            >
                              {actionLoadingId === friend.friend_id ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : (
                                'Sim'
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmRemoveFriendId(null)}
                              disabled={actionLoadingId === friend.friend_id}
                              className="py-1 px-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition-colors"
                            >
                              Não
                            </button>
                          </div>
                        ) : (
                          <>
                            {onPlayWithFriend && (
                              <button
                                type="button"
                                onClick={() => onPlayWithFriend(friend)}
                                className="py-1.5 px-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors flex items-center gap-1 shadow-sm active:scale-95"
                                title="Convidar para jogar Jogo da Velha"
                              >
                                <Gamepad2 className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Jogar</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => setConfirmRemoveFriendId(friend.friend_id)}
                              disabled={actionLoadingId === friend.friend_id}
                              className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/40 transition-colors"
                              title="Remover amizade"
                              aria-label={`Remover amizade com ${friend.display_name}`}
                            >
                              {actionLoadingId === friend.friend_id ? (
                                <RefreshCw className="w-4 h-4 animate-spin text-red-400" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SOLICITAÇÕES */}
          {activeTab === 'requests' && (
            <div className="space-y-6">
              {/* Recebidas */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs font-bold text-slate-300 uppercase tracking-wider">
                  <span>Recebidas ({receivedRequests.length})</span>
                </div>

                {receivedRequests.length === 0 ? (
                  <p className="text-xs text-slate-400 p-3 rounded-xl bg-slate-950/40 border border-slate-800 text-center">
                    Nenhuma solicitação de amizade pendente.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {receivedRequests.map((req) => (
                      <div
                        key={req.request_id}
                        className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-3"
                      >
                        <div
                          className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                          onClick={() => req.requester_id && onViewUserProfile?.(req.requester_id)}
                        >
                          <PlayerAvatar
                            avatarUrl={req.avatar_url}
                            displayName={req.display_name}
                            username={req.username}
                            size="sm"
                          />
                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-bold text-white truncate block">
                              {req.display_name}
                            </span>
                            <span className="text-[10px] text-purple-400 font-mono truncate block">
                              @{req.username}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleActionAccept(req.request_id)}
                            disabled={actionLoadingId === req.request_id}
                            className="py-1 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors flex items-center gap-1 shadow-sm disabled:opacity-50"
                          >
                            {actionLoadingId === req.request_id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <UserCheck className="w-3.5 h-3.5" />
                            )}
                            <span>Aceitar</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleActionDecline(req.request_id)}
                            disabled={actionLoadingId === req.request_id}
                            className="py-1 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors"
                          >
                            Recusar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Enviadas */}
              <div className="space-y-2.5 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-wider">
                  <span>Enviadas ({sentRequests.length})</span>
                </div>

                {sentRequests.length === 0 ? (
                  <p className="text-xs text-slate-500 p-3 rounded-xl bg-slate-950/40 border border-slate-800/60 text-center">
                    Nenhuma solicitação enviada pendente.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {sentRequests.map((req) => (
                      <div
                        key={req.request_id}
                        className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/80 flex items-center justify-between gap-3"
                      >
                        <div
                          className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                          onClick={() => req.recipient_id && onViewUserProfile?.(req.recipient_id)}
                        >
                          <PlayerAvatar
                            avatarUrl={req.avatar_url}
                            displayName={req.display_name}
                            username={req.username}
                            size="sm"
                          />
                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-bold text-white truncate block">
                              {req.display_name}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono truncate block">
                              @{req.username}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleActionCancel(req.request_id)}
                          disabled={actionLoadingId === req.request_id}
                          className="py-1 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors flex items-center gap-1 disabled:opacity-50"
                        >
                          {actionLoadingId === req.request_id ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <X className="w-3.5 h-3.5 text-red-400" />
                          )}
                          <span>Cancelar</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: ENCONTRAR JOGADORES */}
          {activeTab === 'search' && (
            <div className="space-y-4">
              {/* Input de Busca */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Pesquisar por @username ou nome..."
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  autoFocus
                />
                {isSearching && (
                  <RefreshCw className="w-4 h-4 animate-spin text-purple-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                )}
              </div>

              {searchError && (
                <div className="p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 text-xs">
                  {searchError}
                </div>
              )}

              {/* Resultados */}
              {searchQuery.trim().length >= 2 && !isSearching && searchResults.length === 0 ? (
                <div className="py-10 text-center space-y-2 bg-slate-950/40 rounded-xl border border-dashed border-slate-800">
                  <UserX className="w-8 h-8 text-slate-500 mx-auto" />
                  <p className="text-xs text-slate-400">Nenhum jogador encontrado para essa busca.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {searchResults.map((player) => (
                    <div
                      key={player.user_id}
                      className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-3"
                    >
                      <div
                        className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                        onClick={() => onViewUserProfile?.(player.user_id)}
                      >
                        <PlayerAvatar
                          avatarUrl={player.avatar_url}
                          displayName={player.display_name}
                          username={player.username}
                          size="md"
                        />
                        <div className="min-w-0 flex-1">
                          <span className="text-xs sm:text-sm font-bold text-white truncate block">
                            {player.display_name}
                          </span>
                          <span className="text-[11px] text-purple-400 font-mono truncate block">
                            @{player.username}
                          </span>
                          <span className="text-[10px] text-slate-400 block mt-0.5">
                            {player.total_matches} jogos · {player.win_rate}% vitórias
                          </span>
                        </div>
                      </div>

                      {/* Botão Contextual de Relacionamento */}
                      <div className="shrink-0">
                        {player.is_friend || player.relationship_status === 'friends' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-400 text-xs font-semibold">
                            <Check className="w-3.5 h-3.5" />
                            <span>Amigos</span>
                          </span>
                        ) : player.relationship_status === 'request_sent' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 text-xs font-semibold">
                            <Clock className="w-3.5 h-3.5" />
                            <span>Enviada</span>
                          </span>
                        ) : player.relationship_status === 'request_received' ? (
                          <button
                            type="button"
                            onClick={() => setActiveTab('requests')}
                            className="py-1.5 px-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-colors"
                          >
                            Responder
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleActionSend(player.user_id)}
                            disabled={actionLoadingId === player.user_id}
                            className="py-1.5 px-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-colors flex items-center gap-1.5 shadow-md shadow-purple-950/50 disabled:opacity-50"
                          >
                            {actionLoadingId === player.user_id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <UserPlus className="w-3.5 h-3.5" />
                            )}
                            <span>Adicionar</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
