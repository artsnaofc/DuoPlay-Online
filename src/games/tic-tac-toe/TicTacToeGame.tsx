// ============================================================================
// Component: TicTacToeGame — DuoPlay-Online
// Phase: Fase 7 — Integração End-to-End do Jogo da Velha
// Description: Tela oficial do Jogo da Velha integrada ao useGameSession.
//              PostgreSQL é a autoridade absoluta; sem otimismo no tabuleiro.
// ============================================================================

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Trophy,
  RotateCcw,
  Wifi,
  WifiOff,
  RefreshCw,
  AlertCircle,
  ArrowLeft,
  Clock,
  Sparkles,
  HelpCircle,
  ShieldAlert,
  Flag,
} from 'lucide-react';
import { useGameSession } from '@/multiplayer/hooks/useGameSession';
import { useAuth } from '@/hooks/useAuth';
import type { TicTacToeState, TicTacToeBoard as BoardArray } from './types';
import { TicTacToeBoard } from './TicTacToeBoard';
import { AbandonMatchModal } from '@/components/match/AbandonMatchModal';
import { MatchResultModal } from '@/components/match/MatchResultModal';
import { abandonMatch, claimAbandonment } from '@/services/matchSession';
import { PlayerAvatar } from '@/components/profile/PlayerAvatar';
import { fetchPublicProfile, type PublicPlayerProfile } from '@/services/profile';
import { ConnectionStatusIndicator } from '@/components/match/ConnectionStatusIndicator';
import { TurnTimer } from '@/components/match/TurnTimer';

interface TicTacToeGameProps {
  matchId: string;
  onLeave: () => void;
  onViewHistory?: () => void;
  onPlayAgain?: () => void;
  onStartRematch?: (newMatchId: string) => void;
  onViewPlayerProfile?: (userId: string) => void;
}

// 8 combinações clássicas de vitória para derivação visual caso o servidor não envie explicitamente
const WINNING_COMBINATIONS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // Linhas
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // Colunas
  [0, 4, 8], [2, 4, 6],             // Diagonais
];

function deriveWinningLine(board: (string | null)[]): [number, number, number] | null {
  for (const combo of WINNING_COMBINATIONS) {
    const [a, b, c] = combo;
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return [a, b, c];
    }
  }
  return null;
}

export const TicTacToeGame: React.FC<TicTacToeGameProps> = ({
  matchId,
  onLeave,
  onViewHistory,
  onPlayAgain,
  onStartRematch,
  onViewPlayerProfile,
}) => {
  const { user, profile } = useAuth();
  const currentUserId = user?.id || null;
  const [opponentProfile, setOpponentProfile] = useState<PublicPlayerProfile | null>(null);

  const {
    snapshot,
    syncState,
    error: sessionError,
    isLoading,
    isMyTurn,
    myPlayer,
    opponentPlayer,
    submitAction,
    refresh,
    reconnect,
  } = useGameSession<TicTacToeState>(matchId);

  const [submittingPosition, setSubmittingPosition] = useState<number | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [isResultModalOpen, setIsResultModalOpen] = useState(true);

  // 1. Determinação de Símbolos baseada estritamente no slot autoritativo (Slot 1 = X, Slot 2 = O)
  const mySymbol = useMemo<'X' | 'O' | null>(() => {
    if (!myPlayer) return null;
    return myPlayer.slot === 1 ? 'X' : myPlayer.slot === 2 ? 'O' : null;
  }, [myPlayer]);

  const opponentSymbol = useMemo<'X' | 'O' | null>(() => {
    if (!opponentPlayer) return null;
    return opponentPlayer.slot === 1 ? 'X' : opponentPlayer.slot === 2 ? 'O' : null;
  }, [opponentPlayer]);

  // 2. Tabuleiro e Estado do Jogo Derivados do Snapshot
  const board = useMemo<(string | null)[]>(() => {
    if (snapshot?.state?.board && Array.isArray(snapshot.state.board)) {
      return snapshot.state.board;
    }
    return [null, null, null, null, null, null, null, null, null];
  }, [snapshot]);

  // Presence & Grace Period do Adversário
  const [graceSecondsLeft, setGraceSecondsLeft] = useState<number | null>(null);
  const [isClaimingWO, setIsClaimingWO] = useState(false);
  const [isAbandonModalOpen, setIsAbandonModalOpen] = useState(false);
  const [isAbandoning, setIsAbandoning] = useState(false);

  // Reabre o modal de resultado caso a partida mude para finalizada
  const status = snapshot?.status || 'in_progress';
  const isFinished = status === 'finished' || status === 'abandoned' || status === 'cancelled';
  const isWinner = isFinished && snapshot?.winnerId === currentUserId;
  const isLoser = isFinished && snapshot?.winnerId !== null && snapshot?.winnerId !== currentUserId;
  const isDraw = isFinished && Boolean(snapshot?.isDraw);

  // Verificação periódica automática a cada 4 segundos da presença real do oponente no PostgreSQL
  useEffect(() => {
    if (isFinished || !matchId) return;

    const presenceInterval = setInterval(() => {
      refresh();
    }, 4000);

    return () => clearInterval(presenceInterval);
  }, [isFinished, matchId, refresh]);

  useEffect(() => {
    if (isFinished) {
      setIsResultModalOpen(true);
    }
  }, [isFinished]);

  // Carrega perfil público do adversário para identificação visual e estatísticas
  useEffect(() => {
    if (!opponentPlayer?.userId) return;

    let isMounted = true;
    fetchPublicProfile(opponentPlayer.userId).then((res) => {
      if (isMounted && res.success && res.data) {
        setOpponentProfile(res.data);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [opponentPlayer?.userId]);

  const isOpponentDisconnected = opponentPlayer?.connectionStatus === 'disconnected';

  // Cronômetro do Grace Period
  useEffect(() => {
    if (!isOpponentDisconnected || !opponentPlayer?.gracePeriodExpiresAt || isFinished) {
      setGraceSecondsLeft(null);
      return;
    }

    const updateCountdown = () => {
      const expiresAt = new Date(opponentPlayer.gracePeriodExpiresAt!).getTime();
      const now = Date.now();
      const diffSec = Math.max(0, Math.ceil((expiresAt - now) / 1000));
      setGraceSecondsLeft(diffSec);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [isOpponentDisconnected, opponentPlayer?.gracePeriodExpiresAt, isFinished]);

  // 3. Linha Vencedora para Destaque Visual
  const winningLine = useMemo(() => {
    if (snapshot?.state?.winning_line) {
      return snapshot.state.winning_line;
    }
    if (isFinished && snapshot?.winnerId) {
      return deriveWinningLine(board);
    }
    return null;
  }, [snapshot, isFinished, board]);

  // 4. Jogador do Turno Atual
  const currentTurnPlayer = useMemo(() => {
    if (!snapshot || !snapshot.currentTurnPlayerId) return null;
    if (snapshot.currentTurnPlayerId === myPlayer?.userId) return { name: 'Você', symbol: mySymbol };
    if (snapshot.currentTurnPlayerId === opponentPlayer?.userId) return { name: 'Adversário', symbol: opponentSymbol };
    return { name: 'Aguardando', symbol: null };
  }, [snapshot, myPlayer, opponentPlayer, mySymbol, opponentSymbol]);

  // 5. Envio de Jogada Autorizada pelo Servidor
  const handleCellClick = useCallback(
    async (position: number) => {
      if (!isMyTurn || isFinished || board[position] !== null || submittingPosition !== null) {
        return;
      }

      setFeedbackError(null);
      setSubmittingPosition(position);

      try {
        const result = await submitAction('place_mark', { position });

        if (!result.accepted && result.error) {
          const errCode = result.error.code;
          if (errCode === 'NOT_YOUR_TURN' || errCode === 'P0019') {
            setFeedbackError('Não é a sua vez de jogar.');
          } else if (errCode === 'CELL_ALREADY_OCCUPIED' || errCode === 'P0032') {
            setFeedbackError('Esta casa já está ocupada.');
          } else if (errCode === 'MATCH_FINISHED' || errCode === 'P0013') {
            setFeedbackError('A partida já terminou.');
          } else if (errCode === 'INVALID_POSITION' || errCode === 'P0033') {
            setFeedbackError('Posição de jogada inválida.');
          } else {
            setFeedbackError(result.error.message || 'Erro ao registrar jogada.');
          }
        }
      } catch {
        setFeedbackError('Erro de conexão ao processar jogada. Tente novamente.');
      } finally {
        setSubmittingPosition(null);
      }
    },
    [isMyTurn, isFinished, board, submittingPosition, submitAction]
  );

  // 6. Reivindicação de Vitória por Abandono (Grace Period Expirado no Servidor)
  const handleClaimAbandonment = async () => {
    if (isClaimingWO || isFinished) return;
    setIsClaimingWO(true);
    setFeedbackError(null);
    try {
      const res = await claimAbandonment(matchId);
      if (res.success) {
        await reconnect();
      } else {
        setFeedbackError(res.error || 'Não foi possível reivindicar vitória por abandono no momento.');
      }
    } catch {
      setFeedbackError('Erro ao comunicar com o servidor.');
    } finally {
      setIsClaimingWO(false);
    }
  };

  // 7. Abandono Voluntário da Partida (Ação Irreversível)
  const handleConfirmAbandon = async () => {
    if (isAbandoning || isFinished) return;
    setIsAbandoning(true);
    try {
      const res = await abandonMatch(matchId);
      if (res.success) {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(`abandoned_match_${matchId}`, 'true');
        }
        setIsAbandonModalOpen(false);
        onLeave();
      } else {
        setFeedbackError(res.error || 'Não foi possível abandonar a partida. Você continua nela.');
        setIsAbandonModalOpen(false);
      }
    } catch {
      setFeedbackError('Erro ao processar abandono da partida. Você continua nela.');
      setIsAbandonModalOpen(false);
    } finally {
      setIsAbandoning(false);
    }
  };

  // 8. Skeleton de Carregamento Inicial
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 animate-pulse">
          <RefreshCw className="w-6 h-6 animate-spin" />
        </div>
        <div className="text-center space-y-1">
          <h2 className="text-base font-bold text-white">Carregando Partida Oficial</h2>
          <p className="text-xs text-slate-400">Consultando o estado mais recente no servidor...</p>
        </div>
      </div>
    );
  }

  // Fallback seguro caso a partida seja inválida ou inexistente
  if (!snapshot && sessionError) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-red-950/60 border border-red-800/80 flex items-center justify-center text-red-400 mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-bold text-white">Partida Indisponível</h2>
          <p className="text-xs text-slate-400">
            {sessionError.message || 'Não foi possível carregar as informações desta partida no servidor.'}
          </p>
        </div>
        <button
          onClick={onLeave}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar para Home</span>
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6 sm:py-10 space-y-6">
      {/* Top Header & Status Bar */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          {!isFinished ? (
            <button
              type="button"
              onClick={() => setIsAbandonModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 border border-red-900/60 text-xs font-semibold text-red-300 transition-colors focus-visible:outline-2 focus-visible:outline-red-400 active:scale-95"
            >
              <Flag className="w-3.5 h-3.5 text-red-400" />
              <span>Abandonar Partida</span>
            </button>
          ) : (
            <button
              onClick={onLeave}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar para Home</span>
            </button>
          )}
        </div>

        {/* Sync / Connectivity status */}
        <div className="flex items-center gap-2">
          <ConnectionStatusIndicator
            syncState={syncState}
            onReconnect={() => reconnect()}
          />
        </div>
      </div>

      {/* Players HUD */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {/* My Player HUD */}
        <div
          className={`p-3.5 sm:p-4 rounded-xl border transition-all ${
            isMyTurn && !isFinished
              ? 'bg-blue-950/40 border-blue-500/80 shadow-[0_0_15px_rgba(59,130,246,0.15)] ring-1 ring-blue-500/30'
              : 'bg-slate-900/60 border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <PlayerAvatar
                avatarUrl={profile?.avatar_url}
                displayName={profile?.display_name || user?.email?.split('@')[0]}
                username={profile?.username}
                size="xs"
              />
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Você
              </span>
            </div>
            <span
              className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-black ${
                mySymbol === 'X'
                  ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40'
                  : 'bg-purple-600/30 text-purple-400 border border-purple-500/40'
              }`}
            >
              {mySymbol || '?'}
            </span>
          </div>
          <div className="text-sm sm:text-base font-extrabold text-white truncate">
            {profile?.display_name || user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Jogador'}
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px]">
            <span className="text-slate-400">Slot {myPlayer?.slot || 1}</span>
            <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Online</span>
            </span>
          </div>
        </div>

        {/* Opponent Player HUD */}
        <div
          className={`p-3.5 sm:p-4 rounded-xl border transition-all ${
            !isMyTurn && !isFinished
              ? 'bg-purple-950/40 border-purple-500/80 shadow-[0_0_15px_rgba(168,85,247,0.15)] ring-1 ring-purple-500/30'
              : 'bg-slate-900/60 border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <PlayerAvatar
                avatarUrl={opponentProfile?.avatarUrl}
                displayName={opponentProfile?.displayName || 'Adversário'}
                username={opponentProfile?.username}
                size="xs"
              />
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Adversário
              </span>
            </div>
            <span
              className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-black ${
                opponentSymbol === 'X'
                  ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40'
                  : 'bg-purple-600/30 text-purple-400 border border-purple-500/40'
              }`}
            >
              {opponentSymbol || '?'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm sm:text-base font-extrabold text-white truncate">
              {opponentProfile?.displayName || (opponentPlayer ? `Oponente (Slot ${opponentPlayer.slot})` : 'Aguardando jogador...')}
            </div>
            {opponentPlayer?.userId && onViewPlayerProfile && (
              <button
                type="button"
                onClick={() => onViewPlayerProfile(opponentPlayer.userId)}
                className="text-[10px] font-semibold text-purple-400 hover:text-purple-300 hover:underline shrink-0"
                title="Ver perfil do adversário"
              >
                Perfil ↗
              </button>
            )}
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px]">
            <span className="text-slate-400">Slot {opponentPlayer?.slot || 2}</span>
            {isOpponentDisconnected ? (
              <span className="inline-flex items-center gap-1 text-red-400 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span>Desconectado</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>Conectado</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Banner de Desconexão / Grace Period do Adversário */}
      {isOpponentDisconnected && !isFinished && (
        <div className="p-4 rounded-xl bg-red-950/70 border border-red-800 text-red-200 space-y-2.5 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-xs sm:text-sm text-red-300">
              <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
              <span>Adversário desconectado</span>
            </div>
            {graceSecondsLeft !== null && graceSecondsLeft > 0 ? (
              <span className="px-2.5 py-1 rounded-full bg-red-900/90 border border-red-700 text-xs font-mono font-bold text-white">
                Tolerância: {graceSecondsLeft}s
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-full bg-amber-900/90 border border-amber-700 text-xs font-bold text-amber-200">
                Prazo expirado
              </span>
            )}
          </div>

          <p className="text-xs text-red-200/90 leading-relaxed">
            {graceSecondsLeft !== null && graceSecondsLeft > 0
              ? 'O adversário perdeu a conexão com o servidor. Ele possui um prazo de carência para retornar antes que a vitória por W.O. possa ser concedida.'
              : 'O prazo de tolerância (Grace Period) do adversário expirou no servidor. Você pode reivindicar a vitória oficial por abandono.'}
          </p>

          {graceSecondsLeft === 0 && (
            <button
              type="button"
              onClick={handleClaimAbandonment}
              disabled={isClaimingWO}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-colors flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
            >
              {isClaimingWO ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Reivindicando vitória no servidor...</span>
                </>
              ) : (
                <>
                  <Trophy className="w-4 h-4 text-amber-300" />
                  <span>Reivindicar Vitória por Abandono (W.O.)</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Turn indicator banner */}
      {!isFinished && (
        <div
          className={`py-2 px-4 rounded-xl text-center text-xs sm:text-sm font-semibold flex items-center justify-between gap-3 ${
            isMyTurn
              ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40 shadow-sm'
              : 'bg-slate-800/60 text-slate-300 border border-slate-700/60'
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 truncate">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isMyTurn ? 'bg-blue-400 animate-pulse' : 'bg-purple-400'
              }`}
              aria-hidden="true"
            />
            {isMyTurn ? (
              <span className="truncate">
                Sua vez de jogar <strong>({mySymbol})</strong>
              </span>
            ) : isOpponentDisconnected ? (
              <span className="truncate text-amber-300">
                Aguardando retorno do adversário <strong>({opponentSymbol})</strong>...
              </span>
            ) : (
              <span className="truncate">
                Vez de {opponentProfile?.displayName || 'Adversário'} <strong>({opponentSymbol})</strong>
              </span>
            )}
          </div>

          <TurnTimer
            turnDeadline={snapshot?.turnDeadline || null}
            isMyTurn={isMyTurn}
            isSuspended={isOpponentDisconnected}
            className="shrink-0"
          />
        </div>
      )}

      {/* Feedback / Error banner */}
      {(feedbackError || sessionError) && (
        <div className="p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          <span className="grow">{feedbackError || sessionError?.message}</span>
          <button
            onClick={() => setFeedbackError(null)}
            className="text-[10px] uppercase font-bold text-red-400 hover:text-red-300 px-1"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Game Board */}
      <div className="py-2">
        <TicTacToeBoard
          board={board as BoardArray}
          isMyTurn={isMyTurn}
          disabled={isFinished || !isMyTurn}
          submittingPosition={submittingPosition}
          winningLine={winningLine}
          onCellClick={handleCellClick}
        />
      </div>

      {/* Game Result Card (Finished Match) */}
      {isFinished && (
        <div
          className={`p-6 rounded-2xl border text-center space-y-4 shadow-xl ${
            isWinner
              ? 'bg-gradient-to-b from-emerald-950/60 to-slate-900 border-emerald-500/60 ring-1 ring-emerald-500/30'
              : isLoser
              ? 'bg-gradient-to-b from-red-950/60 to-slate-900 border-red-500/60 ring-1 ring-red-500/30'
              : isDraw
              ? 'bg-gradient-to-b from-amber-950/60 to-slate-900 border-amber-500/60 ring-1 ring-amber-500/30'
              : 'bg-slate-900/90 border-slate-800'
          }`}
        >
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-slate-800/80 mx-auto">
            {isWinner && <Trophy className="w-6 h-6 text-emerald-400" />}
            {isLoser && <ShieldAlert className="w-6 h-6 text-red-400" />}
            {isDraw && <HelpCircle className="w-6 h-6 text-amber-400" />}
            {!isWinner && !isLoser && !isDraw && <Sparkles className="w-6 h-6 text-blue-400" />}
          </div>

          <div className="space-y-1">
            <h3 className="text-xl sm:text-2xl font-black text-white">
              {isWinner && (snapshot?.finishReason === 'abandonment' ? 'Vitória por Abandono (W.O.)!' : snapshot?.finishReason === 'resignation' ? 'Vitória por Desistência!' : 'Você Venceu!')}
              {isLoser && (snapshot?.finishReason === 'resignation' ? 'Você Abandonou a Partida' : snapshot?.finishReason === 'abandonment' ? 'Derrota por Desconexão (W.O.)' : 'Fim de Jogo — Derrota')}
              {isDraw && 'Empate!'}
              {!isWinner && !isLoser && !isDraw && (status === 'abandoned' ? 'Partida Abandonada' : 'Fim de Partida')}
            </h3>
            <p className="text-xs text-slate-300">
              {isWinner && snapshot?.finishReason === 'abandonment' && 'O adversário não retornou dentro do prazo de carência e a vitória oficial foi concedida a você.'}
              {isWinner && snapshot?.finishReason === 'resignation' && 'O adversário desistiu da partida.'}
              {isWinner && snapshot?.finishReason === 'normal' && 'Parabéns! Sua estratégia garantiu a vitória nesta rodada.'}
              {isWinner && !snapshot?.finishReason && 'Parabéns! Sua estratégia garantiu a vitória nesta rodada.'}
              {isLoser && snapshot?.finishReason === 'resignation' && 'Você confirmou a desistência da partida.'}
              {isLoser && snapshot?.finishReason === 'abandonment' && 'O tempo de tolerância para reconexão expirou no servidor.'}
              {isLoser && (!snapshot?.finishReason || snapshot?.finishReason === 'normal') && 'O adversário completou a sequência primeiro. Tente a revanche!'}
              {isDraw && 'Todas as 9 posições foram preenchidas sem vencedor.'}
            </p>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onLeave}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-semibold shadow-md shadow-blue-900/30 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar para Home</span>
            </button>

            {onViewHistory && (
              <button
                type="button"
                onClick={onViewHistory}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs sm:text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-slate-400"
              >
                <Trophy className="w-4 h-4 text-amber-400" />
                <span>Ver Histórico</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modal Autoritativo de Resultado da Partida */}
      <MatchResultModal
        isOpen={isFinished && isResultModalOpen}
        matchId={matchId}
        gameName="Jogo da Velha"
        status={status}
        winnerId={snapshot?.winnerId || null}
        isDraw={Boolean(snapshot?.isDraw)}
        finishReason={snapshot?.finishReason || null}
        currentUserId={currentUserId}
        myPlayer={
          myPlayer
            ? {
                userId: currentUserId,
                gameSymbol: mySymbol,
                slot: myPlayer.slot,
                displayName:
                  profile?.display_name ||
                  user?.user_metadata?.display_name ||
                  user?.email?.split('@')[0] ||
                  'Você',
                avatarUrl: profile?.avatar_url,
              }
            : null
        }
        opponentPlayer={
          opponentPlayer
            ? {
                userId: opponentPlayer.userId,
                gameSymbol: opponentSymbol,
                slot: opponentPlayer.slot,
                displayName:
                  opponentProfile?.displayName ||
                  opponentProfile?.username ||
                  `Oponente (Slot ${opponentPlayer.slot})`,
                avatarUrl: opponentProfile?.avatarUrl,
              }
            : null
        }
        onViewUserProfile={onViewPlayerProfile}
        onGoHome={() => {
          if (isFinished && currentUserId && typeof window !== 'undefined') {
            const seenKey = `seen_match_result_${currentUserId}_${matchId}`;
            localStorage.setItem(seenKey, 'true');
            sessionStorage.setItem(seenKey, 'true');
          }
          onLeave();
        }}
        onViewHistory={() => {
          if (isFinished && currentUserId && typeof window !== 'undefined') {
            const seenKey = `seen_match_result_${currentUserId}_${matchId}`;
            localStorage.setItem(seenKey, 'true');
            sessionStorage.setItem(seenKey, 'true');
          }
          if (onViewHistory) {
            onViewHistory();
          } else {
            onLeave();
          }
        }}
        onStartRematch={(newMatchId) => {
          if (currentUserId && typeof window !== 'undefined') {
            const seenKey = `seen_match_result_${currentUserId}_${matchId}`;
            localStorage.setItem(seenKey, 'true');
            sessionStorage.setItem(seenKey, 'true');
          }
          if (onStartRematch) {
            onStartRematch(newMatchId);
          }
        }}
        onFindNewOpponent={() => {
          if (isFinished && currentUserId && typeof window !== 'undefined') {
            const seenKey = `seen_match_result_${currentUserId}_${matchId}`;
            localStorage.setItem(seenKey, 'true');
            sessionStorage.setItem(seenKey, 'true');
          }
          if (onPlayAgain) {
            onPlayAgain();
          } else {
            onLeave();
          }
        }}
      />

      {/* Modal de Confirmação de Abandono */}
      <AbandonMatchModal
        isOpen={isAbandonModalOpen}
        isLoading={isAbandoning}
        onCancel={() => setIsAbandonModalOpen(false)}
        onConfirm={handleConfirmAbandon}
      />
    </div>
  );
};
