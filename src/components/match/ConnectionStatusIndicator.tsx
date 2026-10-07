// ============================================================================
// Component: ConnectionStatusIndicator — DuoPlay-Online
// Phase: Fase 13 — UX e Robustez da Experiência Multiplayer
// Description: Indicador de status de conexão discreto, acessível e mobile-first.
//              Apresenta estados CONNECTED, RECONNECTING e DISCONNECTED sem poluição visual.
// ============================================================================

import React from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import type { SyncState } from '@/multiplayer/network/types';

export interface ConnectionStatusIndicatorProps {
  syncState: SyncState;
  onReconnect?: () => void;
  className?: string;
  isCompact?: boolean;
}

export const ConnectionStatusIndicator: React.FC<ConnectionStatusIndicatorProps> = ({
  syncState,
  onReconnect,
  className = '',
  isCompact = false,
}) => {
  // Estado 1: Conectado (Normal) — Discreto, sem animações desnecessárias
  if (syncState === 'synced') {
    return (
      <div
        className={`inline-flex items-center gap-1.5 text-xs text-slate-300 ${className}`}
        role="status"
        aria-live="polite"
      >
        <span
          className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"
          aria-hidden="true"
        />
        <span className="text-[11px] font-medium text-emerald-400">
          {isCompact ? 'Conectado' : 'Conectado'}
        </span>
      </div>
    );
  }

  // Estado 2: Sincronizando / Reconectando — Indicação clara de trabalho em andamento
  if (syncState === 'syncing') {
    return (
      <div
        className={`inline-flex items-center gap-1.5 text-xs text-blue-300 ${className}`}
        role="status"
        aria-live="polite"
      >
        <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" aria-hidden="true" />
        <span className="text-[11px] font-medium text-blue-300">
          Reconectando...
        </span>
      </div>
    );
  }

  // Estado 3: Offline ou Erro de Conexão — Aviso claro com opção de reconectar
  return (
    <div
      className={`inline-flex items-center gap-2 text-xs text-red-300 ${className}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-center gap-1.5">
        <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-red-400">
          {syncState === 'offline' ? 'Sem internet' : 'Conexão perdida'}
        </span>
      </div>

      {onReconnect && (
        <button
          type="button"
          onClick={onReconnect}
          className="px-2 py-0.5 rounded text-[10px] font-bold text-white bg-red-800/80 hover:bg-red-700 transition-colors focus-visible:outline-2 focus-visible:outline-red-400 active:scale-95"
          aria-label="Tentar reconectar ao servidor"
        >
          Reconectar
        </button>
      )}
    </div>
  );
};
