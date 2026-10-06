// ============================================================================
// Component: TicTacToeBoard — DuoPlay-Online
// Phase: Fase 7 — Integração End-to-End do Jogo da Velha
// Description: Tabuleiro 3x3 puramente visual e responsivo.
//              O estado exibido é 100% derivado do snapshot autoritativo.
// ============================================================================

import React from 'react';
import type { TicTacToeBoard as BoardArray, TicTacToeCell } from './types';

interface TicTacToeBoardProps {
  board: BoardArray | (string | null)[];
  isMyTurn: boolean;
  disabled?: boolean;
  submittingPosition: number | null;
  winningLine?: [number, number, number] | number[] | null;
  onCellClick: (position: number) => void;
}

export const TicTacToeBoard: React.FC<TicTacToeBoardProps> = ({
  board,
  isMyTurn,
  disabled = false,
  submittingPosition,
  winningLine,
  onCellClick,
}) => {
  const isWinningCell = (index: number) => {
    if (!winningLine || !Array.isArray(winningLine)) return false;
    return winningLine.includes(index);
  };

  const renderMark = (cell: TicTacToeCell | string | null, isWin: boolean) => {
    if (cell === 'X') {
      return (
        <svg
          viewBox="0 0 40 40"
          className={`w-10 h-10 sm:w-14 sm:h-14 stroke-current stroke-[4] stroke-linecap-round ${
            isWin ? 'text-emerald-300 drop-shadow-[0_0_12px_rgba(52,211,153,0.8)]' : 'text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.5)]'
          }`}
          fill="none"
          aria-hidden="true"
        >
          <line x1="8" y1="8" x2="32" y2="32" />
          <line x1="32" y1="8" x2="8" y2="32" />
        </svg>
      );
    }

    if (cell === 'O') {
      return (
        <svg
          viewBox="0 0 40 40"
          className={`w-10 h-10 sm:w-14 sm:h-14 stroke-current stroke-[4] ${
            isWin ? 'text-emerald-300 drop-shadow-[0_0_12px_rgba(52,211,153,0.8)]' : 'text-purple-400 drop-shadow-[0_0_8px_rgba(192,132,252,0.5)]'
          }`}
          fill="none"
          aria-hidden="true"
        >
          <circle cx="20" cy="20" r="12" />
        </svg>
      );
    }

    return null;
  };

  return (
    <div className="relative w-full max-w-[340px] sm:max-w-[400px] aspect-square mx-auto p-3 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl backdrop-blur-sm">
      {/* 3x3 Grid container */}
      <div className="grid grid-cols-3 grid-rows-3 gap-2.5 h-full w-full">
        {Array.from({ length: 9 }).map((_, idx) => {
          const cell = (board && board[idx]) ?? null;
          const isOccupied = cell !== null;
          const isPendingSubmission = submittingPosition === idx;
          const isWinning = isWinningCell(idx);
          const isClickable = !disabled && isMyTurn && !isOccupied && submittingPosition === null;

          return (
            <button
              key={idx}
              type="button"
              onClick={() => {
                if (isClickable) {
                  onCellClick(idx);
                }
              }}
              disabled={disabled || isOccupied || submittingPosition !== null}
              aria-label={`Casa ${idx + 1}: ${cell ? cell : 'vazia'}`}
              className={`
                relative flex items-center justify-center rounded-xl font-bold transition-all duration-200 select-none
                min-h-[72px] sm:min-h-[96px]
                ${
                  isWinning
                    ? 'bg-emerald-950/60 border-2 border-emerald-400/90 shadow-[0_0_15px_rgba(16,185,129,0.35)] scale-[1.02]'
                    : isOccupied
                    ? 'bg-slate-800/80 border border-slate-700/80 cursor-default'
                    : isClickable
                    ? 'bg-slate-800/40 border border-slate-700/60 hover:bg-blue-950/30 hover:border-blue-500/60 cursor-pointer active:scale-95'
                    : 'bg-slate-850/30 border border-slate-800/40 cursor-not-allowed opacity-60'
                }
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900
              `}
            >
              {/* Mark rendering */}
              {renderMark(cell, isWinning)}

              {/* In-flight indicator for the clicked cell */}
              {isPendingSubmission && (
                <div
                  className="absolute inset-0 flex items-center justify-center bg-blue-950/40 rounded-xl"
                  aria-label="Enviando jogada..."
                >
                  <span className="w-5 h-5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
