// ============================================================================
// Component: TurnTimer — DuoPlay-Online
// Phase: Fase 13 — UX e Robustez da Experiência Multiplayer
// Description: Contador visual do tempo de turno derivado estritamente do
//              deadline oficial do PostgreSQL (turn_deadline).
//              NUNCA toma decisões autoritativas ou encerra partidas no frontend.
// ============================================================================

import React, { useState, useEffect } from 'react';
import { Clock, PauseCircle } from 'lucide-react';

export interface TurnTimerProps {
  turnDeadline: string | null;
  isMyTurn: boolean;
  isSuspended?: boolean;
  onVisualZero?: () => void;
  className?: string;
}

export const TurnTimer: React.FC<TurnTimerProps> = ({
  turnDeadline,
  isMyTurn,
  isSuspended = false,
  onVisualZero,
  className = '',
}) => {
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!turnDeadline || isSuspended) {
      setSecondsRemaining(null);
      return;
    }

    const calculateRemaining = () => {
      const deadlineMs = new Date(turnDeadline).getTime();
      const nowMs = Date.now();
      const diffSec = Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
      setSecondsRemaining(diffSec);

      if (diffSec === 0 && onVisualZero) {
        onVisualZero();
      }
    };

    calculateRemaining();
    const timerInterval = setInterval(calculateRemaining, 1000);

    return () => {
      clearInterval(timerInterval);
    };
  }, [turnDeadline, isSuspended, onVisualZero]);

  // Se o turno estiver suspenso por desconexão do adversário
  if (isSuspended) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 text-xs text-amber-400 font-medium ${className}`}
        role="status"
        aria-live="polite"
      >
        <PauseCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
        <span className="text-[11px]">Tempo suspenso (jogador desconectado)</span>
      </div>
    );
  }

  // Se não houver deadline ativo no servidor
  if (secondsRemaining === null) {
    return null;
  }

  const isLowTime = secondsRemaining <= 5;

  return (
    <div
      className={`inline-flex items-center gap-1.5 text-xs font-mono font-bold transition-colors ${
        isLowTime
          ? 'text-red-400 animate-pulse'
          : isMyTurn
          ? 'text-blue-300'
          : 'text-slate-300'
      } ${className}`}
      role="timer"
      aria-label={`Tempo restante do turno: ${secondsRemaining} segundos`}
    >
      <Clock className={`w-3.5 h-3.5 ${isLowTime ? 'text-red-400' : 'text-slate-400'}`} aria-hidden="true" />
      <span>{secondsRemaining}s</span>
    </div>
  );
};
