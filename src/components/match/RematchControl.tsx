// ============================================================================
// Component: RematchControl — DuoPlay-Online
// Phase: Fase 9 — Rematch com Aceite Bilateral
// Description: Componente para gerenciamento de solicitação, aceite, recusa
//              e navegação de revanche com sincronização autoritativa.
// ============================================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  RotateCcw,
  Check,
  X,
  RefreshCw,
  Clock,
  Swords,
  AlertCircle,
} from 'lucide-react';
import {
  requestRematch,
  respondToRematch,
  getPendingRematchForMatch,
  type RematchInfo,
} from '@/services/rematch';

export interface RematchControlProps {
  originalMatchId: string;
  currentUserId: string | null;
  onStartRematch?: (newMatchId: string) => void;
  onFindNewOpponent?: () => void;
  className?: string;
}

export const RematchControl: React.FC<RematchControlProps> = ({
  originalMatchId,
  currentUserId,
  onStartRematch,
  onFindNewOpponent,
  className = '',
}) => {
  const [rematchInfo, setRematchInfo] = useState<RematchInfo | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // Evita re-disparar o callback de navegação para a mesma nova partida
  const transitionedMatchIdRef = useRef<string | null>(null);

  // Função para consultar o estado do pedido no servidor
  const checkStatus = useCallback(async () => {
    if (!originalMatchId) return;

    try {
      const res = await getPendingRematchForMatch(originalMatchId);
      if (res.success && res.data) {
        setRematchInfo(res.data);
        setErrorMsg(null);
        setErrorCode(null);

        // Se o pedido foi aceito e há uma nova partida criada
        if (
          res.data.status === 'accepted' &&
          res.data.new_match_id &&
          transitionedMatchIdRef.current !== res.data.new_match_id
        ) {
          transitionedMatchIdRef.current = res.data.new_match_id;
          if (onStartRematch) {
            onStartRematch(res.data.new_match_id);
          }
        }
      } else if (res.success && res.data === null) {
        // Sem pedido ativo
        setRematchInfo(null);
      }
    } catch {
      // Falhas temporárias são ignoradas na sondagem
    }
  }, [originalMatchId, onStartRematch]);

  // Cronômetro do TTL da revanche (30s)
  useEffect(() => {
    if (rematchInfo?.status !== 'pending' || !rematchInfo.expires_at) {
      setSecondsLeft(null);
      return;
    }

    const updateCountdown = () => {
      const expires = new Date(rematchInfo.expires_at!).getTime();
      const diff = Math.max(0, Math.ceil((expires - Date.now()) / 1000));
      setSecondsLeft(diff);
      if (diff === 0) {
        checkStatus();
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [rematchInfo?.status, rematchInfo?.expires_at, checkStatus]);

  // Polling automático a cada 2.5 segundos para atualização em tempo real
  useEffect(() => {
    checkStatus();

    const interval = setInterval(() => {
      checkStatus();
    }, 2500);

    return () => clearInterval(interval);
  }, [checkStatus]);

  // Handler para solicitar revanche
  const handleRequestRematch = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setErrorCode(null);

    try {
      const res = await requestRematch(originalMatchId);
      if (res.success && res.data) {
        setRematchInfo(res.data);
        if (
          res.data.status === 'accepted' &&
          res.data.new_match_id &&
          transitionedMatchIdRef.current !== res.data.new_match_id
        ) {
          transitionedMatchIdRef.current = res.data.new_match_id;
          if (onStartRematch) {
            onStartRematch(res.data.new_match_id);
          }
        }
      } else {
        setErrorMsg(res.error || 'Não foi possível solicitar revanche.');
        setErrorCode(res.code || null);
      }
    } catch {
      setErrorMsg('Erro de conexão ao solicitar revanche.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handler para aceitar ou recusar revanche
  const handleRespondRematch = async (accept: boolean) => {
    if (!rematchInfo?.rematch_request_id) return;

    setIsLoading(true);
    setErrorMsg(null);
    setErrorCode(null);

    try {
      const res = await respondToRematch(rematchInfo.rematch_request_id, accept);
      if (res.success && res.data) {
        setRematchInfo(res.data);
        if (
          accept &&
          res.data.status === 'accepted' &&
          res.data.new_match_id &&
          transitionedMatchIdRef.current !== res.data.new_match_id
        ) {
          transitionedMatchIdRef.current = res.data.new_match_id;
          if (onStartRematch) {
            onStartRematch(res.data.new_match_id);
          }
        }
      } else {
        setErrorMsg(res.error || 'Não foi possível responder ao pedido de revanche.');
        setErrorCode(res.code || null);
      }
    } catch {
      setErrorMsg('Erro de conexão ao responder pedido de revanche.');
    } finally {
      setIsLoading(false);
    }
  };

  // 1. Estado: Carregando ação do usuário
  if (isLoading) {
    return (
      <div className={`p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-center space-y-1 ${className}`}>
        <div className="flex items-center justify-center gap-2 text-xs font-semibold text-blue-400">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Comunicando com o servidor...</span>
        </div>
      </div>
    );
  }

  // 2. Estado: Pedido pendente enviado por mim (Aguardando resposta do oponente)
  if (rematchInfo?.status === 'pending' && rematchInfo.is_my_request) {
    return (
      <div className={`p-3.5 rounded-xl bg-blue-950/60 border border-blue-800/80 text-blue-200 text-xs space-y-2 text-center animate-fade-in ${className}`}>
        <div className="flex items-center justify-center gap-2 font-bold text-blue-300">
          <Clock className="w-4 h-4 animate-pulse text-blue-400" />
          <span>Solicitação de Revanche Enviada</span>
          {secondsLeft !== null && (
            <span className="ml-1 px-2 py-0.5 rounded-full bg-blue-900/80 text-[10px] font-mono font-bold text-blue-200">
              {secondsLeft}s
            </span>
          )}
        </div>
        <p className="text-[11px] text-blue-300/80">
          Aguardando a resposta do adversário...
        </p>
      </div>
    );
  }

  // 3. Estado: Pedido pendente recebido do oponente (Devo aceitar ou recusar)
  if (rematchInfo?.status === 'pending' && !rematchInfo.is_my_request) {
    return (
      <div className={`p-4 rounded-xl bg-purple-950/70 border border-purple-800 text-purple-100 text-xs space-y-3 animate-fade-in ${className}`}>
        <div className="flex items-center justify-between font-bold text-purple-200">
          <div className="flex items-center gap-2">
            <Swords className="w-4 h-4 text-purple-400 shrink-0" />
            <span>O adversário pediu uma revanche!</span>
          </div>
          {secondsLeft !== null && (
            <span className="px-2 py-0.5 rounded-full bg-purple-900/80 text-[10px] font-mono font-bold text-purple-200">
              {secondsLeft}s
            </span>
          )}
        </div>
        <p className="text-[11px] text-purple-300/90 leading-relaxed">
          Você deseja jogar uma nova partida contra o mesmo adversário?
        </p>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => handleRespondRematch(true)}
            className="flex-1 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-colors flex items-center justify-center gap-1.5 focus-visible:outline-2 focus-visible:outline-emerald-400 active:scale-95"
          >
            <Check className="w-4 h-4" />
            <span>Aceitar Revanche</span>
          </button>
          <button
            type="button"
            onClick={() => handleRespondRematch(false)}
            className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 focus-visible:outline-2 focus-visible:outline-slate-400 active:scale-95"
          >
            <X className="w-4 h-4" />
            <span>Recusar</span>
          </button>
        </div>
      </div>
    );
  }

  // 4. Estado: Revanche Recusada
  if (rematchInfo?.status === 'declined') {
    return (
      <div className={`p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs space-y-3 text-center ${className}`}>
        <div className="text-slate-400 font-medium">
          O pedido de revanche foi recusado pelo adversário.
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-1">
          {onFindNewOpponent && (
            <button
              type="button"
              onClick={onFindNewOpponent}
              className="w-full sm:flex-1 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md transition-colors flex items-center justify-center gap-1.5 focus-visible:outline-2 focus-visible:outline-blue-400 active:scale-95"
            >
              <Swords className="w-4 h-4" />
              <span>Encontrar outro jogador</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleRequestRematch}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-400 hover:text-slate-200 transition-colors py-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Pedir revanche novamente</span>
          </button>
        </div>
      </div>
    );
  }

  // 5. Estado: Revanche Expirada
  if (rematchInfo?.status === 'expired') {
    return (
      <div className={`p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs space-y-3 text-center ${className}`}>
        <div className="text-slate-400 font-medium">
          O pedido de revanche expirou por tempo (30s) ou o oponente está indisponível.
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-1">
          {onFindNewOpponent && (
            <button
              type="button"
              onClick={onFindNewOpponent}
              className="w-full sm:flex-1 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md transition-colors flex items-center justify-center gap-1.5 focus-visible:outline-2 focus-visible:outline-blue-400 active:scale-95"
            >
              <Swords className="w-4 h-4" />
              <span>Encontrar outro jogador</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleRequestRematch}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-400 hover:text-slate-200 transition-colors py-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Tentar revanche novamente</span>
          </button>
        </div>
      </div>
    );
  }

  // 6. Erro de ação ou oponente indisponível
  if (errorMsg) {
    const isOpponentUnavailable = errorCode === 'OPPONENT_UNAVAILABLE';
    return (
      <div className={`p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs space-y-3 text-center ${className}`}>
        <div className="flex items-center justify-center gap-1.5 font-medium text-amber-300">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-1">
          {onFindNewOpponent && (
            <button
              type="button"
              onClick={onFindNewOpponent}
              className="w-full sm:flex-1 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md transition-colors flex items-center justify-center gap-1.5 focus-visible:outline-2 focus-visible:outline-blue-400 active:scale-95"
            >
              <Swords className="w-4 h-4" />
              <span>Encontrar outro jogador</span>
            </button>
          )}
          {!isOpponentUnavailable && (
            <button
              type="button"
              onClick={handleRequestRematch}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-[11px] transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Tentar Novamente</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // 7. Estado Padrão (Sem pedido de revanche ativo)
  return (
    <div className={`w-full ${className}`}>
      <button
        type="button"
        onClick={handleRequestRematch}
        className="w-full py-3 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs sm:text-sm shadow-lg shadow-purple-950/40 transition-colors flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-purple-400 active:scale-[0.98]"
      >
        <RotateCcw className="w-4 h-4" />
        <span>Solicitar Revanche</span>
      </button>
    </div>
  );
};
