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
} from 'lucide-react';
import { PlayerAvatar } from './PlayerAvatar';
import { fetchPublicProfile, type PublicPlayerProfile } from '@/services/profile';

export interface PublicPlayerProfileModalProps {
  userId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export const PublicPlayerProfileModal: React.FC<PublicPlayerProfileModalProps> = ({
  userId,
  isOpen,
  onClose,
}) => {
  const [profile, setProfile] = useState<PublicPlayerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !userId) {
      setProfile(null);
      setErrorMsg(null);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setErrorMsg(null);

    fetchPublicProfile(userId)
      .then((res) => {
        if (!isMounted) return;
        if (res.success && res.data) {
          setProfile(res.data);
        } else {
          setErrorMsg(res.error || 'Não foi possível carregar o perfil do jogador.');
        }
      })
      .catch(() => {
        if (isMounted) {
          setErrorMsg('Erro de conexão ao consultar perfil do adversário.');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, userId]);

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
