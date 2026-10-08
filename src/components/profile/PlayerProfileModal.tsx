// ============================================================================
// Component: PlayerProfileModal — DuoPlay-Online
// Phase: Fase 12 — Perfil do Jogador + Identidade da Plataforma
// Description: Modal completo para visualização e edição de perfil próprio,
//              com estatísticas oficiais consolidadas, histórico recente e avatares.
// ============================================================================

import React, { useState, useEffect } from 'react';
import {
  X,
  Trophy,
  Swords,
  Calendar,
  Edit3,
  Check,
  AlertCircle,
  RefreshCw,
  History,
  ShieldCheck,
  Percent,
  Sparkles,
  Zap,
  Flame,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { PlayerAvatar } from './PlayerAvatar';
import { calculateLevelProgress } from '@/services/stats';
import {
  updateMyProfile,
  PRESET_AVATARS,
  validateUsername,
  validateDisplayName,
  type PlayerProfile,
  mapRowToPlayerProfile,
} from '@/services/profile';
import { getMyMatchHistory, type MatchHistoryItem } from '@/services/matchHistory';
import { AchievementsList } from './AchievementsList';

export interface PlayerProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenHistory?: () => void;
}

export const PlayerProfileModal: React.FC<PlayerProfileModalProps> = ({
  isOpen,
  onClose,
  onOpenHistory,
}) => {
  const { user, profile, refreshProfile } = useAuth();

  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<'stats' | 'achievements'>('stats');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [selectedAvatarUrl, setSelectedAvatarUrl] = useState<string | null>(null);
  const [customAvatarInput, setCustomAvatarInput] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Histórico resumido
  const [recentMatches, setRecentMatches] = useState<MatchHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Carrega dados iniciais do perfil ao abrir ou alternar
  useEffect(() => {
    if (!profile) return;
    setDisplayNameInput(profile.display_name || '');
    setUsernameInput(profile.username || '');
    setSelectedAvatarUrl(profile.avatar_url || null);
    setCustomAvatarInput(profile.avatar_url || '');
    setErrorMessage(null);
    setSuccessMessage(null);
  }, [profile, isEditing]);

  // Carrega histórico recente (últimas 3 partidas)
  useEffect(() => {
    if (!isOpen || !user) return;

    let isMounted = true;
    setIsLoadingHistory(true);

    getMyMatchHistory(3, 0)
      .then((res) => {
        if (isMounted && res.success && res.data) {
          setRecentMatches(res.data.matches);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingHistory(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, user]);

  if (!isOpen || !user) return null;

  const currentProfile: PlayerProfile = profile
    ? mapRowToPlayerProfile(profile)
    : {
        id: user.id,
        username: user.email?.split('@')[0] || 'player',
        displayName: user.user_metadata?.display_name || user.email?.split('@')[0] || 'Jogador',
        avatarUrl: null,
        totalMatches: 0,
        totalWins: 0,
        totalDraws: 0,
        totalLosses: 0,
        winRate: 0,
        currentStreak: 0,
        bestStreak: 0,
        rating: 1000,
        xp: 0,
        level: 1,
        createdAt: user.created_at || new Date().toISOString(),
      };

  const memberSinceDate = new Date(currentProfile.createdAt).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanUsername = usernameInput.trim().toLowerCase();
    const cleanDisplayName = displayNameInput.trim();

    const usernameVal = validateUsername(cleanUsername);
    if (!usernameVal.isValid) {
      setErrorMessage(usernameVal.error || 'Nome de usuário inválido.');
      return;
    }

    const displayNameVal = validateDisplayName(cleanDisplayName);
    if (!displayNameVal.isValid) {
      setErrorMessage(displayNameVal.error || 'Nome de exibição inválido.');
      return;
    }

    setIsSaving(true);

    try {
      const res = await updateMyProfile(user.id, {
        username: cleanUsername,
        displayName: cleanDisplayName,
        avatarUrl: selectedAvatarUrl,
      });

      if (res.success) {
        setSuccessMessage('Perfil atualizado com sucesso!');
        await refreshProfile();
        setTimeout(() => {
          setIsEditing(false);
          setSuccessMessage(null);
        }, 1200);
      } else {
        setErrorMessage(res.error || 'Erro ao atualizar perfil.');
      }
    } catch {
      setErrorMessage('Erro de conexão ao salvar perfil.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="player-profile-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-7 space-y-6 shadow-2xl relative my-8 overflow-hidden">
        {/* Glow Header */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />

        {/* Top Bar */}
        <div className="flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-400" />
            <span className="font-bold uppercase tracking-wider text-slate-300">
              {isEditing ? 'Editar Perfil' : 'Perfil do Jogador'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
            aria-label="Fechar perfil"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* View Mode vs Edit Mode */}
        {!isEditing ? (
          <div className="space-y-6">
            {/* Identity Hero */}
            <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <PlayerAvatar
                avatarUrl={currentProfile.avatarUrl}
                displayName={currentProfile.displayName}
                username={currentProfile.username}
                size="lg"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2
                    id="player-profile-modal-title"
                    className="text-lg sm:text-xl font-extrabold text-white truncate"
                  >
                    {currentProfile.displayName}
                  </h2>
                </div>
                <p className="text-xs text-blue-400 font-mono truncate">
                  @{currentProfile.username}
                </p>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-1">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Membro desde {memberSinceDate}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 shrink-0"
                title="Editar Perfil"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs Selector */}
            <div className="flex border-b border-slate-800 mb-2" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'stats'}
                onClick={() => setActiveTab('stats')}
                className={`flex-1 py-2 font-bold text-xs border-b-2 transition-colors ${
                  activeTab === 'stats'
                    ? 'border-blue-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Estatísticas
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'achievements'}
                onClick={() => setActiveTab('achievements')}
                className={`flex-1 py-2 font-bold text-xs border-b-2 transition-colors ${
                  activeTab === 'achievements'
                    ? 'border-blue-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Conquistas & Badges
              </button>
            </div>

            {activeTab === 'achievements' ? (
              <AchievementsList userId={currentProfile.id} />
            ) : (
              <>
                {/* Level & Progression Bar */}
                {(() => {
                  const levelProgress = calculateLevelProgress(currentProfile.xp);
                  return (
                    <div className="p-4 rounded-xl bg-slate-950/80 border border-indigo-500/20 space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <div className="flex items-center gap-2 text-indigo-300">
                          <Sparkles className="w-4 h-4 text-amber-400" />
                          <span>Nível {levelProgress.level}</span>
                          <span className="text-[10px] text-slate-400 font-normal">
                            ({currentProfile.xp} XP total)
                          </span>
                        </div>
                        <span className="text-[11px] font-mono text-slate-300">
                          {levelProgress.xpInCurrentLevel} / {levelProgress.xpForNextLevel} XP
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800 p-0.5">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-amber-400 rounded-full transition-all duration-500"
                          style={{ width: `${levelProgress.progressPercentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })()}

            {/* Rating & Streaks Bar */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
                <span className="text-[10px] font-bold text-amber-400 uppercase block flex items-center justify-center gap-1">
                  <Zap className="w-3 h-3 text-amber-400" /> Rating
                </span>
                <span className="text-lg font-black text-amber-300 font-mono tabular-nums">
                  {currentProfile.rating}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 text-center">
                <span className="text-[10px] font-bold text-orange-400 uppercase block flex items-center justify-center gap-1">
                  <Flame className="w-3 h-3 text-orange-400" /> Sequência
                </span>
                <span className="text-lg font-black text-orange-300 font-mono tabular-nums">
                  {currentProfile.currentStreak}x
                </span>
              </div>

              <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-center">
                <span className="text-[10px] font-bold text-purple-400 uppercase block flex items-center justify-center gap-1">
                  <Flame className="w-3 h-3 text-purple-400" /> Recorde
                </span>
                <span className="text-lg font-black text-purple-300 font-mono tabular-nums">
                  {currentProfile.bestStreak}x
                </span>
              </div>
            </div>

            {/* Official Statistics Grid */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-300 uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5 text-amber-400" />
                  Estatísticas Oficiais
                </span>
                <span className="text-[10px] text-slate-500 font-normal lowercase">
                  atualizado pelo servidor
                </span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-center">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Partidas</span>
                  <span className="text-lg font-black text-white font-mono tabular-nums">
                    {currentProfile.totalMatches}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-center">
                  <span className="text-[10px] font-bold text-emerald-400 uppercase block">Vitórias</span>
                  <span className="text-lg font-black text-emerald-300 font-mono tabular-nums">
                    {currentProfile.totalWins}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-red-950/30 border border-red-800/40 text-center">
                  <span className="text-[10px] font-bold text-red-400 uppercase block">Derrotas</span>
                  <span className="text-lg font-black text-red-300 font-mono tabular-nums">
                    {currentProfile.totalLosses}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-center">
                  <span className="text-[10px] font-bold text-amber-400 uppercase block">Empates</span>
                  <span className="text-lg font-black text-amber-300 font-mono tabular-nums">
                    {currentProfile.totalDraws}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-800/40 text-center col-span-3 sm:col-span-1">
                  <span className="text-[10px] font-bold text-blue-400 uppercase block flex items-center justify-center gap-0.5">
                    <Percent className="w-2.5 h-2.5" /> Vitória
                  </span>
                  <span className="text-lg font-black text-blue-300 font-mono tabular-nums">
                    {currentProfile.winRate}%
                  </span>
                </div>
              </div>
            </div>

            {/* Recent Match History Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-300 uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-blue-400" />
                  Últimas Partidas
                </span>
                {onOpenHistory && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenHistory();
                    }}
                    className="text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors lowercase"
                  >
                    ver histórico completo →
                  </button>
                )}
              </div>

              {isLoadingHistory ? (
                <div className="py-6 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                  <span>Carregando partidas...</span>
                </div>
              ) : recentMatches.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800/60 text-center text-xs text-slate-400">
                  Nenhuma partida disputada ainda. Entre em ação no lobby!
                </div>
              ) : (
                <div className="space-y-1.5">
                  {recentMatches.map((m) => {
                    const opponentName = m.opponents?.[0]?.display_name || 'Adversário';
                    const isWin = m.is_winner;
                    const isDraw = m.is_draw;

                    return (
                      <div
                        key={m.match_id}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isWin
                                ? 'bg-emerald-400'
                                : isDraw
                                ? 'bg-amber-400'
                                : 'bg-red-400'
                            }`}
                          />
                          <div className="truncate">
                            <span className="font-bold text-white mr-1.5">{m.game_name}</span>
                            <span className="text-slate-400">vs {opponentName}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                              isWin
                                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                                : isDraw
                                ? 'bg-amber-950/60 text-amber-400 border border-amber-800/60'
                                : 'bg-red-950/60 text-red-400 border border-red-800/60'
                            }`}
                          >
                            {isWin ? 'Vitória' : isDraw ? 'Empate' : 'Derrota'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

            {/* Actions */}
            <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-colors flex items-center justify-center gap-2 shadow-md shadow-blue-900/30 active:scale-95"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Editar Dados do Perfil</span>
              </button>

              {onOpenHistory && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenHistory();
                  }}
                  className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs transition-colors flex items-center justify-center gap-2 active:scale-95"
                >
                  <History className="w-3.5 h-3.5 text-slate-400" />
                  <span>Ver Histórico Completo</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Edit Mode Form */
          <form onSubmit={handleSaveProfile} className="space-y-5 animate-fade-in">
            {/* Feedback Banners */}
            {errorMessage && (
              <div className="p-3 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{errorMessage}</span>
              </div>
            )}
            {successMessage && (
              <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-200 text-xs flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>{successMessage}</span>
              </div>
            )}

            {/* Avatar Selection & Preview */}
            <div className="space-y-3">
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                Avatar do Jogador
              </label>

              <div className="flex items-center gap-4 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
                <PlayerAvatar
                  avatarUrl={selectedAvatarUrl}
                  displayName={displayNameInput || currentProfile.displayName}
                  username={usernameInput || currentProfile.username}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white">Pré-visualização</p>
                  <p className="text-[11px] text-slate-400">
                    Selecione um dos avatares oficiais abaixo ou informe uma URL personalizada.
                  </p>
                </div>
                {selectedAvatarUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAvatarUrl(null);
                      setCustomAvatarInput('');
                    }}
                    className="text-[10px] font-bold text-slate-400 hover:text-slate-200 uppercase px-2 py-1 rounded bg-slate-800"
                  >
                    Usar Iniciais
                  </button>
                )}
              </div>

              {/* Preset Avatar Grid */}
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 pt-1">
                {PRESET_AVATARS.map((av) => {
                  const isSelected = selectedAvatarUrl === av.url;
                  return (
                    <button
                      key={av.id}
                      type="button"
                      onClick={() => {
                        setSelectedAvatarUrl(av.url);
                        setCustomAvatarInput(av.url);
                      }}
                      className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all p-0.5 ${
                        isSelected
                          ? 'border-blue-500 ring-2 ring-blue-500/40 scale-105'
                          : 'border-slate-800 hover:border-slate-600 opacity-80 hover:opacity-100'
                      }`}
                      title={av.label}
                    >
                      <img
                        src={av.url}
                        alt={av.label}
                        className="w-full h-full object-cover rounded-lg"
                        referrerPolicy="no-referrer"
                      />
                      {isSelected && (
                        <span className="absolute top-1 right-1 w-3 h-3 bg-blue-500 rounded-full flex items-center justify-center text-[8px] text-white">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Custom Image URL Input */}
              <div className="pt-1">
                <input
                  type="url"
                  placeholder="Ou cole a URL da sua imagem (opcional)..."
                  value={customAvatarInput}
                  onChange={(e) => {
                    setCustomAvatarInput(e.target.value);
                    setSelectedAvatarUrl(e.target.value.trim() || null);
                  }}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Display Name Input */}
            <div className="space-y-1.5">
              <label
                htmlFor="display-name-input"
                className="block text-xs font-bold text-slate-300 uppercase tracking-wider"
              >
                Nome de Exibição
              </label>
              <input
                id="display-name-input"
                type="text"
                required
                minLength={2}
                maxLength={50}
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value)}
                placeholder="Como outros jogadores verão você"
                className="w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <p className="text-[11px] text-slate-400">
                Nome visível no tabuleiro, lobby e notificações (2 a 50 caracteres).
              </p>
            </div>

            {/* Username Input */}
            <div className="space-y-1.5">
              <label
                htmlFor="username-input"
                className="block text-xs font-bold text-slate-300 uppercase tracking-wider"
              >
                Nome de Usuário (@username)
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 font-mono text-sm">
                  @
                </span>
                <input
                  id="username-input"
                  type="text"
                  required
                  minLength={3}
                  maxLength={32}
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="username_unico"
                  className="w-full pl-8 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
              <p className="text-[11px] text-slate-400">
                Identificador exclusivo (3 a 32 caracteres; apenas letras minúsculas, números e sublinhados).
              </p>
            </div>

            {/* Form Actions */}
            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setErrorMessage(null);
                }}
                disabled={isSaving}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors focus-visible:outline-2 focus-visible:outline-slate-400 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="py-2.5 px-5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-colors flex items-center gap-2 shadow-md shadow-blue-900/40 active:scale-95 disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Salvando...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Salvar Alterações</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
