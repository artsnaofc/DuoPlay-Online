// ============================================================================
// Component: MatchResultModal — DuoPlay-Online
// Phase: Fase 8.1 — Implementação do Resultado da Partida + Histórico
// Description: Modal oficial de resultado pós-jogo consumindo apenas dados
//              autoritativos do PostgreSQL.
// ============================================================================

import React from 'react';
import {
  Trophy,
  ShieldAlert,
  HelpCircle,
  Clock,
  Home,
  History,
  X,
  Sparkles,
} from 'lucide-react';
import type { MatchPlayerSnapshot } from '@/multiplayer/network/types';
import { RematchControl } from './RematchControl';

export interface MatchResultPlayerInfo {
  userId?: string | null;
  gameSymbol?: string | null;
  slot?: number;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface MatchResultModalProps {
  isOpen: boolean;
  matchId: string;
  gameName?: string;
  status: 'finished' | 'abandoned' | 'cancelled' | string;
  winnerId: string | null;
  isDraw: boolean;
  finishReason: 'normal' | 'resignation' | 'abandonment' | 'timeout' | 'rules_violation' | string | null;
  currentUserId: string | null;
  myPlayer?: MatchResultPlayerInfo | null;
  opponentPlayer?: MatchResultPlayerInfo | null;
  onGoHome: () => void;
  onViewHistory: () => void;
  onStartRematch?: (newMatchId: string) => void;
  onFindNewOpponent?: () => void;
  onViewUserProfile?: (userId: string) => void;
}

export const MatchResultModal: React.FC<MatchResultModalProps> = ({
  isOpen,
  matchId,
  gameName = 'Jogo da Velha',
  status,
  winnerId,
  isDraw,
  finishReason,
  currentUserId,
  myPlayer,
  opponentPlayer,
  onGoHome,
  onViewHistory,
  onStartRematch,
  onFindNewOpponent,
  onViewUserProfile,
}) => {
  if (!isOpen) return null;

  const markAsSeen = () => {
    if (currentUserId && matchId && typeof window !== 'undefined') {
      const seenKey = `seen_match_result_${currentUserId}_${matchId}`;
      localStorage.setItem(seenKey, 'true');
      sessionStorage.setItem(seenKey, 'true');
    }
  };

  const handleGoHome = () => {
    markAsSeen();
    onGoHome();
  };

  const handleViewHistory = () => {
    markAsSeen();
    onViewHistory();
  };

  const handleStartRematch = (newMatchId: string) => {
    markAsSeen();
    if (onStartRematch) {
      onStartRematch(newMatchId);
    }
  };

  const handleFindNewOpponent = () => {
    markAsSeen();
    if (onFindNewOpponent) {
      onFindNewOpponent();
    }
  };

  const isFinished = status === 'finished' || status === 'abandoned' || status === 'cancelled';
  if (!isFinished) return null;

  const isWinner = Boolean(currentUserId && winnerId === currentUserId && !isDraw);
  const isLoser = Boolean(currentUserId && winnerId && winnerId !== currentUserId && !isDraw);

  // Derivação estrita de título e motivo com base nos dados autoritativos do PostgreSQL
  let title = 'Fim de Partida';
  let reasonLabel = 'Partida Concluída';
  let description = 'A partida foi finalizada pelo servidor.';
  let theme: 'win' | 'loss' | 'draw' | 'neutral' = 'neutral';

  if (isDraw) {
    title = 'Empate!';
    reasonLabel = 'Empate técnico';
    description = 'Todas as casas foram preenchidas sem vencedor.';
    theme = 'draw';
  } else if (isWinner) {
    title = 'Você Venceu!';
    theme = 'win';

    if (finishReason === 'abandonment') {
      reasonLabel = 'Vitória por W.O.';
      description = 'O adversário não retornou dentro do prazo de tolerância e a vitória oficial foi concedida a você.';
    } else if (finishReason === 'resignation') {
      reasonLabel = 'Vitória por abandono';
      description = 'O adversário desistiu da partida.';
    } else if (finishReason === 'timeout') {
      reasonLabel = 'Vitória por tempo (Timeout)';
      description = 'O tempo limite do turno do adversário expirou no servidor.';
    } else {
      reasonLabel = 'Vitória normal';
      description = 'Parabéns! Sua estratégia garantiu a vitória nesta rodada.';
    }
  } else if (isLoser) {
    theme = 'loss';

    if (finishReason === 'resignation') {
      title = 'Partida Abandonada';
      reasonLabel = 'Desistência confirmada';
      description = 'Você confirmou a desistência da partida.';
    } else if (finishReason === 'abandonment') {
      title = 'Você Perdeu';
      reasonLabel = 'Derrota por W.O.';
      description = 'O tempo limite de tolerância para reconexão expirou no servidor.';
    } else if (finishReason === 'timeout') {
      title = 'Você Perdeu';
      reasonLabel = 'Derrota por tempo (Timeout)';
      description = 'Seu tempo limite do turno expirou no servidor.';
    } else {
      title = 'Você Perdeu';
      reasonLabel = 'Adversário venceu';
      description = 'O adversário completou a sequência primeiro.';
    }
  } else if (status === 'abandoned') {
    title = 'Partida Abandonada';
    reasonLabel = 'Cancelamento';
    description = 'A partida foi encerrada por abandono.';
    theme = 'neutral';
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="result-modal-title"
    >
      <div
        className={`w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border p-5 sm:p-8 space-y-6 shadow-2xl transition-all ${
          theme === 'win'
            ? 'bg-gradient-to-b from-emerald-950/80 via-slate-900 to-slate-950 border-emerald-500/50 ring-1 ring-emerald-500/20'
            : theme === 'loss'
            ? 'bg-gradient-to-b from-red-950/80 via-slate-900 to-slate-950 border-red-500/50 ring-1 ring-red-500/20'
            : theme === 'draw'
            ? 'bg-gradient-to-b from-amber-950/80 via-slate-900 to-slate-950 border-amber-500/50 ring-1 ring-amber-500/20'
            : 'bg-slate-900 border-slate-800'
        }`}
      >
        {/* Game Badge & Close */}
        <div className="flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5 font-medium">
            <span className="text-white font-semibold">{gameName}</span>
            <span aria-hidden="true">·</span>
            <span>Resultado Oficial</span>
          </div>
          <button
            onClick={onGoHome}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
            aria-label="Fechar e voltar à tela inicial"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Big Outcome Hero Icon */}
        <div className="text-center space-y-3">
          <div
            className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl shadow-lg mx-auto ${
              theme === 'win'
                ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 shadow-emerald-950/50'
                : theme === 'loss'
                ? 'bg-red-600/20 text-red-400 border border-red-500/40 shadow-red-950/50'
                : theme === 'draw'
                ? 'bg-amber-600/20 text-amber-400 border border-amber-500/40 shadow-amber-950/50'
                : 'bg-slate-800 text-slate-300 border border-slate-700'
            }`}
          >
            {theme === 'win' && <Trophy className="w-8 h-8" />}
            {theme === 'loss' && <ShieldAlert className="w-8 h-8" />}
            {theme === 'draw' && <HelpCircle className="w-8 h-8" />}
            {theme === 'neutral' && <Sparkles className="w-8 h-8" />}
          </div>

          <div className="space-y-1">
            <h2
              id="result-modal-title"
              className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white"
            >
              {title}
            </h2>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-center gap-2">
              <span
                className={
                  theme === 'win'
                    ? 'text-emerald-400'
                    : theme === 'loss'
                    ? 'text-red-400'
                    : theme === 'draw'
                    ? 'text-amber-400'
                    : 'text-slate-400'
                }
              >
                {reasonLabel}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 max-w-xs mx-auto leading-relaxed pt-1">
              {description}
            </p>
          </div>
        </div>

        {/* XP & Progression Rewards Banner */}
        <div className="flex items-center justify-around p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80 text-center">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase block">XP Recompensa</span>
            <span className="text-sm font-extrabold text-amber-400 font-mono">
              {isWinner ? '+100 XP' : isDraw ? '+40 XP' : '+20 XP'}
            </span>
          </div>

          <div className="w-px h-8 bg-slate-800" />

          <div className="space-y-0.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase block">Ajuste Rating</span>
            <span
              className={`text-sm font-extrabold font-mono ${
                isWinner ? 'text-emerald-400' : isDraw ? 'text-slate-400' : 'text-red-400'
              }`}
            >
              {isWinner ? '+25 Rating' : isDraw ? '0 Rating' : '-15 Rating'}
            </span>
          </div>
        </div>

        {/* Players Summary Section */}
        <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 block truncate">
              {myPlayer?.displayName || 'Você'}
            </span>
            <div className="font-bold text-white truncate flex items-center gap-1.5">
              <span>{myPlayer?.gameSymbol ? `(${myPlayer.gameSymbol})` : `Slot ${myPlayer?.slot || 1}`}</span>
              {isWinner && <span className="text-emerald-400 text-[11px]">Vencedor</span>}
              {isLoser && <span className="text-slate-400 text-[11px]">Derrota</span>}
            </div>
          </div>

          <div className="space-y-1 text-right">
            {opponentPlayer?.userId && onViewUserProfile ? (
              <button
                type="button"
                onClick={() => onViewUserProfile(opponentPlayer.userId!)}
                className="text-[10px] uppercase font-bold text-blue-400 hover:text-blue-300 hover:underline transition-colors block truncate ml-auto focus-visible:outline-2 focus-visible:outline-blue-400 rounded"
                title="Ver perfil do competidor"
              >
                {opponentPlayer?.displayName || 'Adversário'} ↗
              </button>
            ) : (
              <span className="text-[10px] uppercase font-bold text-slate-400 block truncate">
                {opponentPlayer?.displayName || 'Adversário'}
              </span>
            )}
            <div className="font-bold text-white truncate flex items-center justify-end gap-1.5">
              <span>{opponentPlayer?.gameSymbol ? `(${opponentPlayer.gameSymbol})` : `Slot ${opponentPlayer?.slot || 2}`}</span>
              {!isWinner && !isDraw && isFinished && <span className="text-emerald-400 text-[11px]">Vencedor</span>}
            </div>
          </div>
        </div>

        {/* Rematch Section */}
        <RematchControl
          originalMatchId={matchId}
          currentUserId={currentUserId}
          onStartRematch={handleStartRematch}
          onFindNewOpponent={handleFindNewOpponent}
          finishReason={finishReason}
          isOpponentAvailable={
            finishReason !== 'resignation' &&
            finishReason !== 'abandonment'
          }
        />

        {/* Action Buttons */}
        <div className="pt-2 flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={handleGoHome}
            className="flex-1 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs sm:text-sm shadow-lg shadow-blue-950/40 transition-colors flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-blue-400 active:scale-[0.98]"
          >
            <Home className="w-4 h-4" />
            <span>Voltar para Home</span>
          </button>

          <button
            type="button"
            onClick={handleViewHistory}
            className="flex-1 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs sm:text-sm transition-colors flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-slate-400 active:scale-[0.98]"
          >
            <History className="w-4 h-4 text-slate-400" />
            <span>Ver Histórico</span>
          </button>
        </div>
      </div>
    </div>
  );
};
