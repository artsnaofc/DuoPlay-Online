// ============================================================================
// Component: ActiveMatchRecoveryModal — DuoPlay-Online
// Phase: Fase 7.1 — Desconexão, Abandono e Retomada de Partida
// Description: Modal exibido ao abrir o app caso o usuário possua uma partida
//              ativa em andamento no PostgreSQL, permitindo retomar ou abandonar.
// ============================================================================

import React from 'react';
import { Gamepad2, Play, Flag, RotateCw } from 'lucide-react';
import type { ActiveMatchInfo } from '@/services/matchSession';

interface ActiveMatchRecoveryModalProps {
  isOpen: boolean;
  matchInfo: ActiveMatchInfo | null;
  isLoading?: boolean;
  onResume: (matchId: string) => void;
  onRequestAbandon: (matchId: string) => void;
}

export const ActiveMatchRecoveryModal: React.FC<ActiveMatchRecoveryModalProps> = ({
  isOpen,
  matchInfo,
  isLoading = false,
  onResume,
  onRequestAbandon,
}) => {
  if (!isOpen || !matchInfo) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 overflow-hidden space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-400 flex items-center justify-center shrink-0">
            <Gamepad2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white leading-tight">Partida em andamento</h2>
            <p className="text-xs text-slate-400">Identificamos uma partida ativa no servidor.</p>
          </div>
        </div>

        {/* Card informativo da partida */}
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Jogo
            </span>
            <span className="text-xs font-bold text-white px-2 py-0.5 rounded bg-blue-950/60 border border-blue-800/60 text-blue-300">
              {matchInfo.game_name}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Adversário:</span>
            <span className="font-semibold text-slate-200">
              {matchInfo.opponent?.display_name || 'Jogador Adversário'}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Turno atual:</span>
            <span className="font-semibold text-slate-200">Rodada {matchInfo.turn_number}</span>
          </div>
        </div>

        {/* Botões de Ação */}
        <div className="space-y-2.5 pt-1">
          <button
            type="button"
            onClick={() => onResume(matchInfo.match_id)}
            disabled={isLoading}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs sm:text-sm shadow-md shadow-blue-900/30 transition-all flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
          >
            {isLoading ? (
              <RotateCw className="w-4 h-4 animate-spin text-white" />
            ) : (
              <Play className="w-4 h-4 text-white" />
            )}
            <span>Voltar para a partida</span>
          </button>

          <button
            type="button"
            onClick={() => onRequestAbandon(matchInfo.match_id)}
            disabled={isLoading}
            className="w-full py-2.5 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-750 text-slate-300 hover:text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Flag className="w-3.5 h-3.5 text-slate-400" />
            <span>Abandonar partida</span>
          </button>
        </div>
      </div>
    </div>
  );
};
