// ============================================================================
// Component: PublicPlayerProfileModal — DuoPlay-Online
// Phase: Fase 12 — Perfil do Jogador + Identidade da Plataforma
// Description: Visualização pública restrita do perfil de outro competidor,
//              exibindo estritamente avatar, nome, username e estatísticas oficiais.
// ============================================================================

import React, { useState, useEffect } from 'react';
import {
  X,
  Trophy,
  Calendar,
  Percent,
  RefreshCw,
  AlertCircle,
  Shield,
  UserPlus,
  Check,
  XCircle,
  Gamepad2,
  Trash2,
  MessageSquare,
} from 'lucide-react';
import { PlayerAvatar } from './PlayerAvatar';
import { fetchPublicProfile, type PublicPlayerProfile } from '@/services/profile';
import {
  getFriendshipStatus,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  removeFriend,
} from '@/services/social';
import type { FriendshipStatusData } from '@/types/social';

export interface PublicPlayerProfileModalProps {
  userId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onPlayWithPlayer?: (userId: string) => void;
  onOpenChatWithPlayer?: (userId: string) => void;
}

export const PublicPlayerProfileModal: React.FC<PublicPlayerProfileModalProps> = ({
  userId,
  isOpen,
  onClose,
  onPlayWithPlayer,
  onOpenChatWithPlayer,
}) => {
  const [profile, setProfile] = useState<PublicPlayerProfile | null>(null);
  const [socialStatus, setSocialStatus] = useState<FriendshipStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSocialActionLoading, setIsSocialActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);

  const loadProfileAndSocial = async (targetUserId: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    setIsConfirmingRemove(false);

    try {
      const [profRes, socRes] = await Promise.all([
        fetchPublicProfile(targetUserId),
        getFriendshipStatus(targetUserId, true),
      ]);

      if (profRes.success && profRes.data) {
        setProfile(profRes.data);
      } else {
        setErrorMsg(profRes.error || 'Não foi possível carregar o perfil do jogador.');
      }

      if (socRes.success && socRes.data) {
        setSocialStatus(socRes.data);
      }
    } catch {
      setErrorMsg('Erro de conexão ao consultar perfil do competidor.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !userId) {
      setProfile(null);
      setSocialStatus(null);
      setErrorMsg(null);
      setIsConfirmingRemove(false);
      return;
    }

    loadProfileAndSocial(userId);
  }, [isOpen, userId]);

  const handleSendFriendRequest = async () => {
    if (!userId || isSocialActionLoading) return;
    setIsSocialActionLoading(true);
    const res = await sendFriendRequest(userId);
    setIsSocialActionLoading(false);
    if (res.success) {
      setSocialStatus((prev) =>
        prev
          ? {
              ...prev,
              status: res.data?.action === 'mutual_accepted' ? 'friends' : 'request_sent',
              request_id: res.data?.request_id || null,
            }
          : null
      );
    }
  };

  const handleAcceptFriendRequest = async () => {
    if (!socialStatus?.request_id || isSocialActionLoading) return;
    setIsSocialActionLoading(true);
    const res = await acceptFriendRequest(socialStatus.request_id);
    setIsSocialActionLoading(false);
    if (res.success) {
      setSocialStatus((prev) => (prev ? { ...prev, status: 'friends' } : null));
    }
  };

  const handleDeclineFriendRequest = async () => {
    if (!socialStatus?.request_id || isSocialActionLoading) return;
    setIsSocialActionLoading(true);
    const res = await declineFriendRequest(socialStatus.request_id);
    setIsSocialActionLoading(false);
    if (res.success) {
      setSocialStatus((prev) => (prev ? { ...prev, status: 'none', request_id: null } : null));
    }
  };

  const handleCancelFriendRequest = async () => {
    if (!socialStatus?.request_id || isSocialActionLoading) return;
    setIsSocialActionLoading(true);
    const res = await cancelFriendRequest(socialStatus.request_id);
    setIsSocialActionLoading(false);
    if (res.success) {
      setSocialStatus((prev) => (prev ? { ...prev, status: 'none', request_id: null } : null));
    }
  };

  const handleRemoveFriend = async () => {
    if (!userId || isSocialActionLoading) return;
    setIsSocialActionLoading(true);
    const res = await removeFriend(userId);
    setIsSocialActionLoading(false);
    setIsConfirmingRemove(false);
    if (res.success) {
      setSocialStatus((prev) => (prev ? { ...prev, status: 'none', request_id: null } : null));
    }
  };

  if (!isOpen || !userId) return null;

  const memberSinceDate = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString('pt-BR', {
        month: 'long',
        year: 'numeric',
      })
    : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="public-profile-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-6 shadow-2xl relative overflow-hidden">
        {/* Top Accent Strip */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-purple-500 via-indigo-500 to-blue-500" />

        {/* Modal Header */}
        <div className="flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-slate-300">
            <Shield className="w-3.5 h-3.5 text-purple-400" />
            <span>Perfil do Competidor</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
            aria-label="Fechar perfil público"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body State */}
        {isLoading ? (
          <div className="py-12 text-center space-y-3">
            <div className="w-10 h-10 rounded-xl bg-purple-950/40 border border-purple-800/40 text-purple-400 flex items-center justify-center mx-auto">
              <RefreshCw className="w-5 h-5 animate-spin" />
            </div>
            <p className="text-xs text-slate-400">Consultando perfil do jogador...</p>
          </div>
        ) : errorMsg ? (
          <div className="py-8 text-center space-y-4">
            <div className="w-10 h-10 rounded-xl bg-red-950/40 border border-red-800/40 text-red-400 flex items-center justify-center mx-auto">
              <AlertCircle className="w-5 h-5" />
            </div>
            <p className="text-xs text-slate-300">{errorMsg}</p>
            <button
              onClick={onClose}
              className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
            >
              Fechar
            </button>
          </div>
        ) : profile ? (
          <div className="space-y-6">
            {/* Identity Card */}
            <div className="flex items-center gap-3.5 p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <PlayerAvatar
                avatarUrl={profile.avatarUrl}
                displayName={profile.displayName}
                username={profile.username}
                size="lg"
              />
              <div className="min-w-0 flex-1">
                <h3
                  id="public-profile-title"
                  className="text-base sm:text-lg font-extrabold text-white truncate"
                >
                  {profile.displayName}
                </h3>
                <p className="text-xs text-purple-400 font-mono truncate">
                  @{profile.username}
                </p>
                {memberSinceDate && (
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-1">
                    <Calendar className="w-3 h-3" />
                    <span>Membro desde {memberSinceDate}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Public Statistics */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-300 uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5 text-amber-400" />
                  Estatísticas de Jogo
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 text-center">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Partidas</span>
                  <span className="text-base font-black text-white font-mono tabular-nums">
                    {profile.totalMatches}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-center">
                  <span className="text-[10px] font-bold text-emerald-400 uppercase block">Vitórias</span>
                  <span className="text-base font-black text-emerald-300 font-mono tabular-nums">
                    {profile.totalWins}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-red-950/30 border border-red-800/40 text-center">
                  <span className="text-[10px] font-bold text-red-400 uppercase block">Derrotas</span>
                  <span className="text-base font-black text-red-300 font-mono tabular-nums">
                    {profile.totalLosses}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-blue-950/40 border border-blue-800/40 text-center">
                  <span className="text-[10px] font-bold text-blue-400 uppercase block flex items-center justify-center gap-0.5">
                    <Percent className="w-2.5 h-2.5" /> Taxa
                  </span>
                  <span className="text-base font-black text-blue-300 font-mono tabular-nums">
                    {profile.winRate}%
                  </span>
                </div>
              </div>
            </div>

            {/* Social Relationship & Action Bar */}
            {socialStatus && socialStatus.status !== 'self' && (
              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium">Relacionamento:</span>
                  {socialStatus.status === 'friends' ? (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 font-semibold text-[11px]">
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Amigos</span>
                    </span>
                  ) : socialStatus.status === 'request_sent' ? (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-purple-950/60 border border-purple-800/80 text-purple-300 font-semibold text-[11px]">
                      <span>Solicitação Enviada</span>
                    </span>
                  ) : socialStatus.status === 'request_received' ? (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-950/60 border border-blue-800/80 text-blue-300 font-semibold text-[11px]">
                      <span>Solicitação Recebida</span>
                    </span>
                  ) : (
                    <span className="text-slate-400 text-[11px]">Nenhum vínculo</span>
                  )}
                </div>

                {/* Inline Confirmation for Friend Removal */}
                {isConfirmingRemove ? (
                  <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/60 space-y-2">
                    <p className="text-xs text-red-200">
                      Deseja realmente desfazer a amizade com {profile.displayName}?
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleRemoveFriend}
                        disabled={isSocialActionLoading}
                        className="flex-1 py-1.5 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1"
                      >
                        {isSocialActionLoading ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        <span>Confirmar Remoção</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsConfirmingRemove(false)}
                        disabled={isSocialActionLoading}
                        className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    {socialStatus.status === 'friends' && (
                      <>
                        {onOpenChatWithPlayer && (
                          <button
                            type="button"
                            onClick={() => onOpenChatWithPlayer(profile.id)}
                            className="flex-1 py-2 px-3 rounded-xl bg-violet-650/90 hover:bg-violet-600 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-violet-950/40 active:scale-95 border border-violet-500/30"
                          >
                            <MessageSquare className="w-4 h-4 text-violet-300" />
                            <span>Enviar Mensagem</span>
                          </button>
                        )}
                        {onPlayWithPlayer && (
                          <button
                            type="button"
                            onClick={() => onPlayWithPlayer(profile.id)}
                            className="flex-1 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-blue-950/40 active:scale-95"
                          >
                            <Gamepad2 className="w-4 h-4" />
                            <span>Jogar com Amigo</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setIsConfirmingRemove(true)}
                          disabled={isSocialActionLoading}
                          className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-red-950/40 hover:text-red-300 text-slate-400 text-xs font-semibold transition-colors flex items-center justify-center gap-1 border border-slate-700/60"
                          title="Desfazer amizade"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span className="sm:hidden">Desfazer Amizade</span>
                        </button>
                      </>
                    )}

                    {socialStatus.status === 'request_sent' && (
                      <button
                        type="button"
                        onClick={handleCancelFriendRequest}
                        disabled={isSocialActionLoading}
                        className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 border border-slate-700"
                      >
                        {isSocialActionLoading ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-400" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400" />
                        )}
                        <span>Cancelar Solicitação</span>
                      </button>
                    )}

                    {socialStatus.status === 'request_received' && (
                      <div className="w-full flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleAcceptFriendRequest}
                          disabled={isSocialActionLoading}
                          className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950/50"
                        >
                          {isSocialActionLoading ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                          <span>Aceitar Solicitação</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleDeclineFriendRequest}
                          disabled={isSocialActionLoading}
                          className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors"
                        >
                          Recusar
                        </button>
                      </div>
                    )}

                    {socialStatus.status === 'none' && (
                      <button
                        type="button"
                        onClick={handleSendFriendRequest}
                        disabled={isSocialActionLoading}
                        className="w-full py-2 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition-colors flex items-center justify-center gap-2 shadow-md shadow-purple-950/50 active:scale-95"
                      >
                        {isSocialActionLoading ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <UserPlus className="w-4 h-4" />
                        )}
                        <span>Adicionar aos Amigos</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs transition-colors focus-visible:outline-2 focus-visible:outline-slate-400 active:scale-95"
            >
              Fechar Visualização
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
