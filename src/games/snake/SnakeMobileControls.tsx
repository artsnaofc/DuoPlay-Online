// ============================================================================
// Component: SnakeMobileControls — DuoPlay-Online
// Phase: Fase 22.1 — Motor Multiplayer + Regras
// Description: D-Pad virtual touch responsivo com feedback tátil, sem scroll,
//              sem dependência de teclado, com áreas de toque grandes e safe area.
// ============================================================================

import React from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import type { SnakeDirection } from './types';

interface SnakeMobileControlsProps {
  onDirectionChange: (direction: SnakeDirection) => void;
  currentDirection?: SnakeDirection;
  disabled?: boolean;
}

export const SnakeMobileControls: React.FC<SnakeMobileControlsProps> = ({
  onDirectionChange,
  currentDirection,
  disabled = false,
}) => {
  const handleTouch = (dir: SnakeDirection, e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    onDirectionChange(dir);
  };

  return (
    <div
      className="flex flex-col items-center justify-center select-none touch-none py-2"
      role="group"
      aria-label="Controles direcionais touch da cobrinha"
    >
      {/* Botão Cima */}
      <div className="flex justify-center">
        <button
          type="button"
          onTouchStart={(e) => handleTouch('UP', e)}
          onClick={(e) => handleTouch('UP', e)}
          disabled={disabled}
          aria-label="Mover para cima"
          className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold transition-transform active:scale-90 border shadow-lg ${
            currentDirection === 'UP'
              ? 'bg-emerald-500/30 border-emerald-400 text-emerald-300 shadow-emerald-500/20'
              : 'bg-slate-800/90 border-slate-700 text-slate-200 active:bg-slate-700'
          } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          <ArrowUp className="w-7 h-7 pointer-events-none" />
        </button>
      </div>

      {/* Linha Central: Esquerda, Centro Neutro, Direita */}
      <div className="flex items-center gap-2 my-1">
        <button
          type="button"
          onTouchStart={(e) => handleTouch('LEFT', e)}
          onClick={(e) => handleTouch('LEFT', e)}
          disabled={disabled}
          aria-label="Mover para esquerda"
          className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold transition-transform active:scale-90 border shadow-lg ${
            currentDirection === 'LEFT'
              ? 'bg-emerald-500/30 border-emerald-400 text-emerald-300 shadow-emerald-500/20'
              : 'bg-slate-800/90 border-slate-700 text-slate-200 active:bg-slate-700'
          } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          <ArrowLeft className="w-7 h-7 pointer-events-none" />
        </button>

        <div className="w-12 h-12 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-center text-slate-600 text-[10px] font-mono select-none">
          D-PAD
        </div>

        <button
          type="button"
          onTouchStart={(e) => handleTouch('RIGHT', e)}
          onClick={(e) => handleTouch('RIGHT', e)}
          disabled={disabled}
          aria-label="Mover para direita"
          className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold transition-transform active:scale-90 border shadow-lg ${
            currentDirection === 'RIGHT'
              ? 'bg-emerald-500/30 border-emerald-400 text-emerald-300 shadow-emerald-500/20'
              : 'bg-slate-800/90 border-slate-700 text-slate-200 active:bg-slate-700'
          } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          <ArrowRight className="w-7 h-7 pointer-events-none" />
        </button>
      </div>

      {/* Botão Baixo */}
      <div className="flex justify-center">
        <button
          type="button"
          onTouchStart={(e) => handleTouch('DOWN', e)}
          onClick={(e) => handleTouch('DOWN', e)}
          disabled={disabled}
          aria-label="Mover para baixo"
          className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold transition-transform active:scale-90 border shadow-lg ${
            currentDirection === 'DOWN'
              ? 'bg-emerald-500/30 border-emerald-400 text-emerald-300 shadow-emerald-500/20'
              : 'bg-slate-800/90 border-slate-700 text-slate-200 active:bg-slate-700'
          } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          <ArrowDown className="w-7 h-7 pointer-events-none" />
        </button>
      </div>
    </div>
  );
};
