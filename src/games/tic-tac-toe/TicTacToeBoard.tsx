// ============================================================================
// Component: TicTacToeBoard — DuoPlay-Online
// Phase: Configuração de Grid do Jogo da Velha & Regras Personalizadas
// Description: Tabuleiro responsivo e dinâmico com suporte a grids 3x3, 4x4 e 5x5,
//              linhas vencedoras proporcionais e adaptação mobile/desktop.
// ============================================================================

import React from 'react';
import type { TicTacToeCell } from './types';

interface TicTacToeBoardProps {
  board: (string | null)[];
  gridSize?: number;
  isMyTurn: boolean;
  disabled?: boolean;
  submittingPosition: number | null;
  winningLine?: number[] | null;
  onCellClick: (position: number) => void;
}

export const TicTacToeBoard: React.FC<TicTacToeBoardProps> = ({
  board,
  gridSize = 3,
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
    // Escala dos ícones conforme o tamanho da grade
    const iconSizeClass =
      gridSize === 5
        ? 'w-7 h-7 sm:w-9 sm:h-9 stroke-[3.5]'
        : gridSize === 4
        ? 'w-8 h-8 sm:w-11 sm:h-11 stroke-[4]'
        : 'w-10 h-10 sm:w-14 sm:h-14 stroke-[4]';

    if (cell === 'X') {
      return (
        <svg
          viewBox="0 0 40 40"
          className={`${iconSizeClass} stroke-current stroke-linecap-round ${
            isWin
              ? 'text-emerald-300 drop-shadow-[0_0_12px_rgba(52,211,153,0.8)]'
              : 'text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.5)]'
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
          className={`${iconSizeClass} stroke-current ${
            isWin
              ? 'text-emerald-300 drop-shadow-[0_0_12px_rgba(52,211,153,0.8)]'
              : 'text-purple-400 drop-shadow-[0_0_8px_rgba(192,132,252,0.5)]'
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

  const totalCells = gridSize * gridSize;

  // Grid styling por tamanho
  const gridColsClass =
    gridSize === 5
      ? 'grid-cols-5 grid-rows-5 gap-1.5 sm:gap-2'
      : gridSize === 4
      ? 'grid-cols-4 grid-rows-4 gap-2 sm:gap-2.5'
      : 'grid-cols-3 grid-rows-3 gap-2.5';

  const cellMinHeightClass =
    gridSize === 5
      ? 'min-h-[46px] sm:min-h-[64px]'
      : gridSize === 4
      ? 'min-h-[58px] sm:min-h-[76px]'
      : 'min-h-[72px] sm:min-h-[96px]';

  return (
    <div className="relative w-full max-w-[360px] sm:max-w-[440px] aspect-square mx-auto p-3 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl backdrop-blur-sm select-none">
      <div className={`grid ${gridColsClass} h-full w-full`}>
        {Array.from({ length: totalCells }).map((_, idx) => {
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
                ${cellMinHeightClass}
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
