// ============================================================================
// Component: LeaderboardModal — DuoPlay-Online
// Phase: Fase 17 — Estatísticas, Ranking e Progressão
// Description: Modal responsivo (Mobile First) de Classificação e Ranking Geral
//              e por Jogo, com suporte a busca, navegação por abas e estatísticas.
// ============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Trophy,
  X,
  Medal,
  Award,
  Zap,
  Flame,
  Search,
  RefreshCw,
  Crown,
  Shield,
  TrendingUp,
  User,
} from 'lucide-react';
import { fetchLeaderboard, LeaderboardEntry, calculateLevelProgress } from '@/services/stats';
import { PlayerAvatar } from '@/components/profile/PlayerAvatar';

interface LeaderboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId?: string | null;
  onSelectPlayer?: (userId: string) => void;
}

export const LeaderboardModal: React.FC<LeaderboardModalProps> = ({
  isOpen,
  onClose,
  currentUserId,
  onSelectPlayer,
}) => {
  const [selectedTab, setSelectedTab] = useState<'global' | 'tic_tac_toe'>('global');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const loadLeaderboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const gameId = selectedTab === 'global' ? null : selectedTab;
    const res = await fetchLeaderboard(gameId, 50, 0);

    if (res.success && res.data) {
      setEntries(res.data);
    } else {
      setError(res.error || 'Não foi possível carregar a classificação.');
    }
    setIsLoading(false);
  }, [selectedTab]);

  useEffect(() => {
    if (isOpen) {
      loadLeaderboard();
    }
  }, [isOpen, loadLeaderboard]);

  if (!isOpen) return null;

  const filteredEntries = entries.filter((entry) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      entry.username.toLowerCase().includes(q) ||
      entry.displayName.toLowerCase().includes(q)
    );
  });

  const currentUserEntry = currentUserId
    ? entries.find((e) => e.userId === currentUserId)
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 sm:p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 leading-tight">
                Classificação & Ranking
              </h2>
              <p className="text-xs text-slate-400">
                Líderes oficiais do DuoPlay Online
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Controls: Tabs & Search */}
        <div className="p-4 space-y-3 bg-slate-900/50 border-b border-slate-800/50">
          {/* Tabs */}
          <div className="grid grid-cols-2 p-1 bg-slate-950 rounded-xl border border-slate-800/80">
            <button
              onClick={() => setSelectedTab('global')}
              className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg transition-all ${
                selectedTab === 'global'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Crown className="w-4 h-4 text-amber-400" />
              <span>Ranking Geral</span>
            </button>
            <button
              onClick={() => setSelectedTab('tic_tac_toe')}
              className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg transition-all ${
                selectedTab === 'tic_tac_toe'
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <GridIcon className="w-4 h-4 text-indigo-400" />
              <span>Jogo da Velha</span>
            </button>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar jogador..."
              className="w-full pl-9 pr-4 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500/50 transition-colors"
            />
          </div>
        </div>

        {/* Current User Card if on rank list */}
        {currentUserEntry && !searchQuery && (
          <div className="px-4 py-2 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border-b border-amber-500/20">
            <div className="flex items-center justify-between text-xs text-amber-300 font-medium mb-1">
              <span className="flex items-center gap-1">
                <User className="w-3.5 h-3.5" />
                Sua Posição
              </span>
              <span>
                #{currentUserEntry.rank} de {entries.length}
              </span>
            </div>
            <LeaderboardItemRow
              entry={currentUserEntry}
              isCurrentUser
              onSelectPlayer={onSelectPlayer}
            />
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {isLoading ? (
            <div className="space-y-3 py-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-16 bg-slate-800/40 animate-pulse rounded-xl"
                />
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
              <p className="text-xs text-red-400 max-w-xs">{error}</p>
              <button
                onClick={loadLeaderboard}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded-xl transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Tentar Novamente</span>
              </button>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-2 text-slate-400">
              <Trophy className="w-10 h-10 stroke-1 text-slate-600" />
              <p className="text-sm font-medium">Nenhum jogador encontrado</p>
              <p className="text-xs text-slate-500">
                {searchQuery
                  ? 'Tente outro termo de busca'
                  : 'Seja o primeiro a subir na classificação jogando uma partida!'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredEntries.map((entry) => (
                <LeaderboardItemRow
                  key={entry.userId}
                  entry={entry}
                  isCurrentUser={entry.userId === currentUserId}
                  onSelectPlayer={onSelectPlayer}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface LeaderboardItemRowProps {
  entry: LeaderboardEntry;
  isCurrentUser?: boolean;
  onSelectPlayer?: (userId: string) => void;
}

const LeaderboardItemRow: React.FC<LeaderboardItemRowProps> = ({
  entry,
  isCurrentUser,
  onSelectPlayer,
}) => {
  const getRankBadge = (rank: number) => {
    if (rank === 1) {
      return (
        <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-amber-300 to-amber-500 text-slate-950 font-black shadow-lg shadow-amber-500/20">
          <Crown className="w-4 h-4" />
        </div>
      );
    }
    if (rank === 2) {
      return (
        <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-slate-300 to-slate-400 text-slate-950 font-black shadow-md">
          <Medal className="w-4 h-4" />
        </div>
      );
    }
    if (rank === 3) {
      return (
        <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-amber-600 to-amber-700 text-amber-100 font-black shadow-md">
          <Award className="w-4 h-4" />
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center w-8 h-8 text-xs font-bold text-slate-400">
        #{rank}
      </div>
    );
  };

  const levelInfo = calculateLevelProgress(entry.xp);

  return (
    <div
      onClick={() => onSelectPlayer && onSelectPlayer(entry.userId)}
      className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
        onSelectPlayer ? 'cursor-pointer hover:border-slate-700 hover:bg-slate-800/80' : ''
      } ${
        isCurrentUser
          ? 'bg-amber-500/10 border-amber-500/30'
          : 'bg-slate-950/60 border-slate-800/80'
      }`}
    >
      {/* Left: Rank & Avatar & User Info */}
      <div className="flex items-center gap-3 min-w-0">
        {getRankBadge(entry.rank)}

        <PlayerAvatar
          avatarUrl={entry.avatarUrl}
          displayName={entry.displayName}
          size="md"
        />

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-xs text-slate-100 truncate">
              {entry.displayName}
            </span>
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              Nív. {entry.level}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400">
            <span className="flex items-center gap-1 text-amber-400 font-semibold">
              <Zap className="w-3 h-3" />
              {entry.rating} Rating
            </span>
            <span>•</span>
            <span className="text-emerald-400 font-medium">
              {entry.totalWins}V / {entry.totalMatches}P ({entry.winRate}%)
            </span>
          </div>
        </div>
      </div>

      {/* Right: Streak & Level */}
      <div className="flex items-center gap-3 pl-2">
        {entry.currentStreak > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-orange-500/15 text-orange-400 border border-orange-500/30 text-[11px] font-bold">
            <Flame className="w-3.5 h-3.5 animate-pulse text-orange-400" />
            <span>{entry.currentStreak}x</span>
          </div>
        )}
      </div>
    </div>
  );
};

const GridIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
    <path d="M3 15h18" />
    <path d="M9 3v18" />
    <path d="M15 3v18" />
  </svg>
);
