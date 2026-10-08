// ============================================================================
// Component: PublicMatchmakingModal — DuoPlay-Online
// Phase: Fase 10.5 — Hardening do Matchmaking
// Description: Modal oficial de matchmaking público autoritativo com
//              proteção contra atualização em unmount, pausa em abas inativas (visibilitychange),
//              polling idempotente sem sobreposição e navegação autoritativa.
// ============================================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Swords,
  Search,
  X,
  RefreshCw,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import {
  joinMatchmakingQueue,
  cancelMatchmakingQueue,
  getMyMatchmakingStatus,
  type MatchmakingQueueInfo,
} from '@/services/matchmaking';
import { getGameDefinition } from '@/multiplayer/registry/index';

export interface PublicMatchmakingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMatchFound: (matchId: string) => void;
  gameId?: string; // NOVO: permite matchmaking para qualquer jogo
}

export const PublicMatchmakingModal: React.FC<PublicMatchmakingModalProps> = ({
  isOpen,
  onClose,
  onMatchFound,
  gameId = 'tic_tac_toe',
}) => {
  const [queueInfo, setQueueInfo] = useState<MatchmakingQueueInfo | null>(null);
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const gameDef = getGameDefinition(gameId);
  const gameTitle = gameDef?.title || 'Jogo';

  // Guardas de ciclo de vida e concorrência
  const isMountedRef = useRef<boolean>(true);
  const isPollingBusyRef = useRef<boolean>(false);
  const navigatedMatchIdRef = useRef<string | null>(null);
  const hasAttemptedAutoJoinRef = useRef<boolean>(false);

  // Mantém rastreio do unmount para evitar setState em componente desmontado
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Iniciar busca na fila pública
  const handleJoinQueue = useCallback(async () => {
    if (!isMountedRef.current || isActionLoading) return;
    setIsActionLoading(true);
    setErrorMsg(null);

    try {
      const res = await joinMatchmakingQueue(gameId);
      if (!isMountedRef.current) return;

      if (res.success && res.data) {
        setQueueInfo(res.data);
        if (
          res.data.status === 'matched' &&
          res.data.match_id &&
          navigatedMatchIdRef.current !== res.data.match_id
        ) {
          navigatedMatchIdRef.current = res.data.match_id;
          onMatchFound(res.data.match_id);
          onClose();
        }
      } else {
        setErrorMsg(res.error || 'Não foi possível entrar na fila de matchmaking.');
      }
    } catch {
      if (isMountedRef.current) {
        setErrorMsg('Erro de conexão ao comunicar com a fila de matchmaking.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsActionLoading(false);
      }
    }
  }, [onMatchFound, onClose]);

  // Consulta o status atual da fila do próprio usuário no PostgreSQL
  const checkQueueStatus = useCallback(async () => {
    if (!isOpen || !isMountedRef.current || isPollingBusyRef.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    isPollingBusyRef.current = true;

    try {
      const res = await getMyMatchmakingStatus();
      if (!isMountedRef.current) return;

      if (res.success && res.data) {
        if (res.data.status === 'completed' || res.data.status === 'cancelled') {
          setQueueInfo(null);
        } else {
          setQueueInfo(res.data);
          setErrorMsg(null);

          // Se o usuário foi pareado com sucesso
          if (
            res.data.status === 'matched' &&
            res.data.match_id &&
            navigatedMatchIdRef.current !== res.data.match_id
          ) {
            navigatedMatchIdRef.current = res.data.match_id;
            onMatchFound(res.data.match_id);
            onClose();
          }
        }
      } else if (res.success && res.data === null) {
        if (!hasAttemptedAutoJoinRef.current) {
          hasAttemptedAutoJoinRef.current = true;
          await handleJoinQueue();
        } else {
          setQueueInfo(null);
        }
      }
    } catch {
      // Falhas transitórias são ignoradas no ciclo de polling
    } finally {
      isPollingBusyRef.current = false;
    }
  }, [isOpen, onMatchFound, onClose, handleJoinQueue]);

  // Lifecycle do Polling e evento de Visibilidade da Aba (visibilitychange)
  useEffect(() => {
    if (!isOpen) {
      setQueueInfo(null);
      setErrorMsg(null);
      hasAttemptedAutoJoinRef.current = false;
      return;
    }

    checkQueueStatus();

    // Polling moderado a cada 2.0s
    const interval = setInterval(() => {
      checkQueueStatus();
    }, 2000);

    // Quando a aba volta a ficar visível, executa checagem imediata
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden && isOpen) {
        checkQueueStatus();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      clearInterval(interval);
      if (typeof window !== 'undefined') {
        window.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [isOpen, checkQueueStatus]);

  // Cancelar busca na fila pública
  const handleCancelQueue = async () => {
    if (!isMountedRef.current || isActionLoading) return;
    setIsActionLoading(true);
    setErrorMsg(null);

    try {
      const res = await cancelMatchmakingQueue();
      if (!isMountedRef.current) return;

      if (res.success && res.data) {
        if (
          res.data.status === 'matched' &&
          res.data.match_id &&
          navigatedMatchIdRef.current !== res.data.match_id
        ) {
          // Se foi pareado concorrentemente no momento do cancelamento, entra na partida
          navigatedMatchIdRef.current = res.data.match_id;
          onMatchFound(res.data.match_id);
          onClose();
        } else {
          setQueueInfo(null);
        }
      } else {
        setErrorMsg(res.error || 'Não foi possível cancelar a busca.');
      }
    } catch {
      if (isMountedRef.current) {
        setErrorMsg('Erro ao solicitar cancelamento da busca.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsActionLoading(false);
      }
    }
  };

  if (!isOpen) return null;

  const isWaiting = queueInfo?.status === 'waiting';
  const isMatched = queueInfo?.status === 'matched';
  const isExpired = queueInfo?.status === 'expired';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="matchmaking-modal-title"
    >
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-8 space-y-6 shadow-2xl relative">
        {/* Ambient Glow Header */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-indigo-500" />

        {/* Header Bar */}
        <div className="flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400">
              <Swords className="w-4 h-4" />
            </span>
            <div>
              <h2 id="matchmaking-modal-title" className="text-base font-bold text-white">
                Partida Rápida
              </h2>
              <p className="text-[11px] text-slate-400">{gameTitle} · Matchmaking Público</p>
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              if (isWaiting) {
                await handleCancelQueue();
              }
              onClose();
            }}
            disabled={isActionLoading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50"
            aria-label="Fechar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main Body depending on queue state */}
        {isMatched ? (
          /* State: Matched */
          <div className="py-6 text-center space-y-3 animate-fade-in">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 shadow-lg shadow-emerald-950/50 mx-auto">
              <CheckCircle2 className="w-8 h-8 animate-bounce" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-extrabold text-white">Adversário Encontrado!</h3>
              <p className="text-xs text-emerald-300">Inicializando tabuleiro autoritativo...</p>
            </div>
          </div>
        ) : isWaiting ? (
          /* State: Waiting in Queue */
          <div className="py-6 text-center space-y-5 animate-fade-in">
            <div className="relative inline-flex items-center justify-center w-20 h-20 mx-auto">
              <div className="absolute inset-0 rounded-full border-2 border-blue-500/30 animate-ping opacity-75" />
              <div className="absolute inset-2 rounded-full border border-blue-400/40 animate-pulse" />
              <div className="relative w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-500/50 text-blue-400 flex items-center justify-center shadow-lg shadow-blue-950/50">
                <Search className="w-7 h-7 animate-pulse" />
              </div>
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-black text-white">Procurando Adversário...</h3>
              <p className="text-xs text-slate-300 max-w-xs mx-auto leading-relaxed">
                Consultando jogadores disponíveis na fila do PostgreSQL em tempo real.
              </p>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleCancelQueue}
                disabled={isActionLoading}
                className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs sm:text-sm transition-colors flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-slate-400 active:scale-[0.98] disabled:opacity-50"
              >
                {isActionLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Cancelando busca...</span>
                  </>
                ) : (
                  <>
                    <X className="w-4 h-4 text-red-400" />
                    <span>Cancelar Busca</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* State: Idle / Expired / Error */
          <div className="space-y-5">
            {errorMsg && (
              <div className="p-3.5 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 text-xs flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="grow">{errorMsg}</span>
              </div>
            )}

            {isExpired && (
              <div className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-800/80 text-amber-200 text-xs flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                <span>O tempo limite da fila (5 minutos) expirou. Você pode tentar novamente.</span>
              </div>
            )}

            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-xs space-y-2 text-slate-300">
              <div className="flex items-center gap-2 font-bold text-white">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Como funciona o Pareamento Público</span>
              </div>
              <ul className="space-y-1.5 text-[11px] text-slate-400 list-disc list-inside leading-relaxed">
                <li>Pareamento automático e instantâneo com o próximo jogador disponível.</li>
                <li>Atribuição autoritativa de símbolos e turnos pelo PostgreSQL.</li>
                <li>Sem necessidade de criar códigos ou convites manuais.</li>
              </ul>
            </div>

            <button
              type="button"
              onClick={handleJoinQueue}
              disabled={isActionLoading}
              className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-extrabold text-xs sm:text-sm shadow-lg shadow-blue-950/50 transition-all flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-blue-400 active:scale-[0.98] disabled:opacity-50"
            >
              {isActionLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Entrando na fila pública...</span>
                </>
              ) : (
                <>
                  <Swords className="w-4 h-4" />
                  <span>Encontrar Adversário</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
