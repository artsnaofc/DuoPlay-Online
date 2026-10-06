// ============================================================================
// Component: TicTacToeGame — DuoPlay-Online
// Phase: Fase 7 — Integração End-to-End do Jogo da Velha
// Description: Tela oficial do Jogo da Velha integrada ao useGameSession.
//              PostgreSQL é a autoridade absoluta; sem otimismo no tabuleiro.
// ============================================================================

import React, { useState, useMemo, useCallback } from 'react';
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
} from 'lucide-react';
import { useGameSession } from '@/multiplayer/hooks/useGameSession';
import { useAuth } from '@/hooks/useAuth';
import type { TicTacToeState, TicTacToeBoard as BoardArray } from './types';
import { TicTacToeBoard } from './TicTacToeBoard';

interface TicTacToeGameProps {
  matchId: string;
  onLeave: () => void;
  onPlayAgain?: () => void;
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
  onPlayAgain,
}) => {
  const { user } = useAuth();
  const currentUserId = user?.id || null;

  const {
    snapshot,
    syncState,
    error: sessionError,
    isLoading,
    isMyTurn,
    myPlayer,
    opponentPlayer,
    submitAction,
    reconnect,
  } = useGameSession<TicTacToeState>(matchId);

  const [submittingPosition, setSubmittingPosition] = useState<number | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

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

  const status = snapshot?.status || 'in_progress';
  const isFinished = status === 'finished' || status === 'abandoned' || status === 'cancelled';
  const isWinner = isFinished && snapshot?.winnerId === currentUserId;
  const isLoser = isFinished && snapshot?.winnerId !== null && snapshot?.winnerId !== currentUserId;
  const isDraw = isFinished && Boolean(snapshot?.isDraw);

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

  // 6. Skeleton de Carregamento Inicial
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

  return (
    <div className="max-w-xl mx-auto px-4 py-6 sm:py-10 space-y-6">
      {/* Top Header & Status Bar */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <button
          onClick={onLeave}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Sair</span>
        </button>

        {/* Sync / Connectivity status */}
        <div className="flex items-center gap-2 text-xs">
          {syncState === 'synced' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/80 text-emerald-400 font-medium text-[11px]">
              <Wifi className="w-3.5 h-3.5" />
              <span>Conectado</span>
            </span>
          )}
          {syncState === 'syncing' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-950/60 border border-blue-800/80 text-blue-400 font-medium text-[11px]">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Sincronizando...</span>
            </span>
          )}
          {syncState === 'offline' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/60 border border-amber-800/80 text-amber-400 font-medium text-[11px]">
              <WifiOff className="w-3.5 h-3.5" />
              <span>Offline</span>
            </span>
          )}
          {syncState === 'error' && (
            <button
              onClick={() => reconnect()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-950/60 border border-red-800/80 text-red-400 font-medium text-[11px] hover:bg-red-900/60 transition-colors"
            >
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Reconectar</span>
            </button>
          )}
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
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Você
            </span>
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
            {user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Jogador'}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            Slot {myPlayer?.slot || 1}
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
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Adversário
            </span>
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
          <div className="text-sm sm:text-base font-extrabold text-white truncate">
            {opponentPlayer ? `Oponente (Slot ${opponentPlayer.slot})` : 'Aguardando jogador...'}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            Slot {opponentPlayer?.slot || 2}
          </div>
        </div>
      </div>

      {/* Turn indicator banner */}
      {!isFinished && (
        <div
          className={`py-2 px-4 rounded-xl text-center text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 ${
            isMyTurn
              ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40 shadow-sm'
              : 'bg-slate-800/60 text-slate-300 border border-slate-700/60'
          }`}
        >
          <Clock className="w-4 h-4" />
          {isMyTurn ? (
            <span>
              Sua vez de jogar! Selecione uma casa livre com seu símbolo <strong>({mySymbol})</strong>.
            </span>
          ) : (
            <span>
              Aguardando jogada do adversário <strong>({currentTurnPlayer?.symbol})</strong>...
            </span>
          )}
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
              {isWinner && 'Você Venceu!'}
              {isLoser && 'Fim de Jogo — Derrota'}
              {isDraw && 'Empate!'}
              {status === 'abandoned' && 'Partida Abandonada'}
              {status === 'cancelled' && 'Partida Cancelada'}
            </h3>
            <p className="text-xs text-slate-300">
              {isWinner && 'Parabéns! Sua estratégia garantiu a vitória nesta rodada.'}
              {isLoser && 'O adversário completou a sequência primeiro. Tente a revanche!'}
              {isDraw && 'Todas as 9 posições foram preenchidas sem vencedor.'}
              {status === 'abandoned' && 'O oponente se desconectou ou abandonou a partida.'}
              {status === 'cancelled' && 'A partida foi cancelada antes da conclusão.'}
            </p>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            {onPlayAgain && (
              <button
                onClick={onPlayAgain}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-semibold shadow-md shadow-blue-900/30 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Jogar Novamente</span>
              </button>
            )}
            <button
              onClick={onLeave}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs sm:text-sm font-semibold transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar ao Menu</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
