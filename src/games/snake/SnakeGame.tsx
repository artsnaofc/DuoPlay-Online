// ============================================================================
// Component: SnakeGame — DuoPlay-Online
// Phase: Fase 22.1 — Motor Multiplayer + Regras (Snake Competitivo)
// Description: Arena multiplayer 1v1 em tempo real com autoridade no PostgreSQL,
//              controles mobile touch (D-Pad), teclado desktop (WASD / Setas),
//              recuperação oficial após refresh e reconexão, contagem regressiva,
//              colisões determinísticas e integração total ao ecossistema DuoPlay.
// ============================================================================

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  RefreshCw,
  AlertCircle,
  ArrowLeft,
  Sparkles,
  HelpCircle,
  ShieldAlert,
  Flag,
  Trophy,
} from 'lucide-react';
import { useGameSession } from '@/multiplayer/hooks/useGameSession';
import { useAuth } from '@/hooks/useAuth';
import { AbandonMatchModal } from '@/components/match/AbandonMatchModal';
import { MatchResultModal } from '@/components/match/MatchResultModal';
import { abandonMatch, claimAbandonment } from '@/services/matchSession';
import { PlayerAvatar } from '@/components/profile/PlayerAvatar';
import { fetchPublicProfile, type PublicPlayerProfile } from '@/services/profile';
import { ConnectionStatusIndicator } from '@/components/match/ConnectionStatusIndicator';
import type { SnakeGameState, SnakeDirection } from './types';
import { SnakeArenaView } from './SnakeArenaView';
import { SnakeMobileControls } from './SnakeMobileControls';
import { setSnakeDirection, OPPOSITE_DIRECTIONS, createInitialSnakeState } from './snakeEngine';
import { telemetry } from '@/services/multiplayerTelemetry';

interface SnakeGameProps {
  matchId: string;
  onLeave: () => void;
  onViewHistory?: () => void;
  onPlayAgain?: () => void;
  onStartRematch?: (newMatchId: string) => void;
  onViewPlayerProfile?: (userId: string) => void;
}

export const SnakeGame: React.FC<SnakeGameProps> = ({
  matchId,
  onLeave,
  onViewHistory,
  onPlayAgain,
  onStartRematch,
  onViewPlayerProfile,
}) => {
  const { user } = useAuth();
  const currentUserId = user?.id || null;

  // 1. Sessão Multiplayer Unificada
  const {
    snapshot,
    syncState,
    error,
    isLoading,
    submitAction,
    reconnect,
  } = useGameSession<SnakeGameState>(matchId);

  // Estados locais de interface
  const [isAbandonModalOpen, setIsAbandonModalOpen] = useState(false);
  const [isAbandoning, setIsAbandoning] = useState(false);
  const [isClaimingAbandonment, setIsClaimingAbandonment] = useState(false);
  const [opponentProfile, setOpponentProfile] = useState<PublicPlayerProfile | null>(null);
  const [myProfile, setMyProfile] = useState<PublicPlayerProfile | null>(null);
  const [actionErrorMsg, setActionErrorMsg] = useState<string | null>(null);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [predictedDirection, setPredictedDirection] = useState<SnakeDirection | null>(null);
  const [displayCount, setDisplayCount] = useState<number>(3);

  // Buffer de direção pendente no cliente para prevenir múltiplos inputs no mesmo tick
  const pendingDirectionRef = useRef<SnakeDirection | null>(null);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSubmittedTickRef = useRef<number>(0);
  const inFlightTickRef = useRef<boolean>(false);
  const lastReceivedTickTimeRef = useRef<number>(Date.now());
  const isTabVisibleRef = useRef<boolean>(
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true
  );

  // Inicialização de telemetria e monitoramento de visibilidade da aba
  useEffect(() => {
    telemetry.reset(matchId);
    const handleVisibilityChange = () => {
      isTabVisibleRef.current = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [matchId]);

  // Atualizar timestamp de recepção de tick e registrar evento Realtime
  useEffect(() => {
    if (snapshot?.state?.tick !== undefined) {
      lastReceivedTickTimeRef.current = Date.now();
      telemetry.recordRealtimeUpdate();
    }
  }, [snapshot?.state?.tick]);

  // 2. Extrair e Normalizar Estado Oficial da Partida
  const gameState: SnakeGameState | null = useMemo(() => {
    if (!snapshot?.state) return null;
    const raw = snapshot.state as Partial<SnakeGameState>;
    if (!raw.snakes || !raw.config) {
      // Estado preliminar ou fallback determinístico
      if (snapshot.players && snapshot.players.length >= 2) {
        return createInitialSnakeState(snapshot.players[0].userId, snapshot.players[1].userId);
      }
      return null;
    }
    return raw as SnakeGameState;
  }, [snapshot]);

  // Jogadores da Partida
  const myPlayer = useMemo(() => {
    if (!snapshot?.players || !currentUserId) return null;
    return snapshot.players.find((p) => p.userId === currentUserId) || null;
  }, [snapshot?.players, currentUserId]);

  const opponentPlayer = useMemo(() => {
    if (!snapshot?.players || !currentUserId) return null;
    return snapshot.players.find((p) => p.userId !== currentUserId) || null;
  }, [snapshot?.players, currentUserId]);

  const isHost = myPlayer?.slot === 1;

  // Carregar perfis públicos para exibição nos avatares
  useEffect(() => {
    let isSubscribed = true;
    if (opponentPlayer?.userId) {
      fetchPublicProfile(opponentPlayer.userId).then((res) => {
        if (isSubscribed && res.success && res.data) {
          setOpponentProfile(res.data);
        }
      });
    }
    if (currentUserId) {
      fetchPublicProfile(currentUserId).then((res) => {
        if (isSubscribed && res.success && res.data) {
          setMyProfile(res.data);
        }
      });
    }
    return () => {
      isSubscribed = false;
    };
  }, [opponentPlayer?.userId, currentUserId]);

  // Cobra do jogador atual e direção
  const mySnake = useMemo(() => {
    if (!gameState || !currentUserId) return null;
    return gameState.snakes[currentUserId] || null;
  }, [gameState, currentUserId]);

  const opponentSnake = useMemo(() => {
    if (!gameState || !opponentPlayer?.userId) return null;
    return gameState.snakes[opponentPlayer.userId] || null;
  }, [gameState, opponentPlayer?.userId]);

  // 3. Gerenciamento de Input de Direção (Teclado e Touch)
  const handleDirectionInput = useCallback(
    async (requestedDir: SnakeDirection) => {
      if (!currentUserId || !gameState || gameState.status === 'finished' || !mySnake?.alive) {
        return;
      }

      const currentDir = pendingDirectionRef.current || mySnake.direction;
      if (OPPOSITE_DIRECTIONS[currentDir] === requestedDir || currentDir === requestedDir) {
        return; // Proibido inversão direta ou repetição desnecessária
      }

      // Feedback visual e lógico imediato (Client-side prediction)
      pendingDirectionRef.current = requestedDir;
      setPredictedDirection(requestedDir);

      const rpcStart = Date.now();
      try {
        const res = await submitAction('snake_set_direction', {
          direction: requestedDir,
          tick: gameState.tick,
        });

        telemetry.recordRpc('snake_set_direction', Date.now() - rpcStart, res.accepted);

        if (!res.accepted) {
          pendingDirectionRef.current = null;
          setPredictedDirection(null);
          if (res.error?.message) {
            setActionErrorMsg(res.error.message);
          }
        }
      } catch {
        telemetry.recordRpc('snake_set_direction', Date.now() - rpcStart, false);
        pendingDirectionRef.current = null;
        setPredictedDirection(null);
      }
    },
    [currentUserId, gameState, mySnake, submitAction]
  );

  // Escutar Teclado Desktop (WASD e Setas)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }

      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          handleDirectionInput('UP');
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          handleDirectionInput('DOWN');
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          handleDirectionInput('LEFT');
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          handleDirectionInput('RIGHT');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleDirectionInput]);

  // 4. Ciclo de Vida da Partida & Loop Autoritativo de Ticks
  // Apenas o jogador Host (Slot 1) comanda o tick autoritativo periódico para o PostgreSQL
  // O jogador não-host recebe as atualizações via Realtime/polling
  useEffect(() => {
    if (!gameState || gameState.status === 'finished') {
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = null;
      }
      return;
    }

    // Se estiver em countdown, calcula tempo restante e atualiza displayCount com proteção contra clock-skew
    if (gameState.status === 'countdown') {
      const countdownSecs = gameState.config.countdownSeconds || 3;
      const startTime = gameState.startTime || Date.now();
      const referenceStart = Math.abs(Date.now() - startTime) > 15000 ? Date.now() : startTime;

      const updateCountdown = () => {
        const elapsed = (Date.now() - referenceStart) / 1000;
        const left = Math.ceil(countdownSecs - elapsed);
        if (left > 0) {
          setDisplayCount(left);
        } else {
          setDisplayCount(0);
          submitAction('snake_start', {}).catch(() => {});
        }
      };

      updateCountdown();
      const interval = setInterval(updateCountdown, 100);

      return () => clearInterval(interval);
    }

    // Partida in_game: Coordenador cooperativo de ticks (Host primário + Fallback resiliente)
    if (gameState.status === 'in_game') {
      const tickRate = gameState.config.tickRateMs || 150;
      const staleGraceMs = Math.round(tickRate * 2.5); // ~375ms sem avanço ativa o fallback

      if (!tickIntervalRef.current) {
        tickIntervalRef.current = setInterval(async () => {
          // Se a aba estiver oculta/segundo plano, pausa coordenação de ticks
          if (!isTabVisibleRef.current) return;

          // Se já há um tick em voo, aguarda resolução para não encadear chamadas HTTP
          if (inFlightTickRef.current) return;

          const now = Date.now();
          const isStale = now - lastReceivedTickTimeRef.current >= staleGraceMs;

          // Regra Cooperativa:
          // O Host é o coordenador primário. O Não-Host monitora e só assume se o Host estiver estagnado
          if (!isHost && !isStale) {
            telemetry.setDriverRole('idle');
            return;
          }

          telemetry.setDriverRole(isHost ? 'primary' : 'fallback');

          const nextTick = (gameState.tick || 0) + 1;
          if (nextTick <= lastSubmittedTickRef.current) return;

          lastSubmittedTickRef.current = nextTick;
          inFlightTickRef.current = true;

          const rpcStart = Date.now();
          try {
            const res = await submitAction('snake_tick', {
              tick: nextTick,
              clientTime: rpcStart,
            });
            const rpcDuration = Date.now() - rpcStart;
            const isIdempotent = Boolean(res.isIdempotent);
            telemetry.recordRpc('snake_tick', rpcDuration, res.accepted, isIdempotent);
          } catch {
            telemetry.recordRpc('snake_tick', Date.now() - rpcStart, false, false);
          } finally {
            inFlightTickRef.current = false;
          }
        }, tickRate);
      }
    }

    return () => {
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = null;
      }
    };
  }, [gameState?.status, gameState?.tick, gameState?.config, isHost, submitAction]);

  // Limpeza de Pending Direction quando o tick avança
  useEffect(() => {
    if (gameState?.tick) {
      pendingDirectionRef.current = null;
      setPredictedDirection(null);
    }
  }, [gameState?.tick]);

  // 5. Finalização e Ações de Abandono
  const handleConfirmAbandon = async () => {
    setIsAbandoning(true);
    try {
      const res = await abandonMatch(matchId);
      if (res.success) {
        setIsAbandonModalOpen(false);
        onLeave();
      } else {
        setActionErrorMsg(res.error || 'Erro ao abandonar partida.');
      }
    } finally {
      setIsAbandoning(false);
    }
  };

  const handleClaimAbandonment = async () => {
    setIsClaimingAbandonment(true);
    try {
      const res = await claimAbandonment(matchId);
      if (!res.success) {
        setActionErrorMsg(res.error || 'Não foi possível reivindicar abandono.');
      }
    } finally {
      setIsClaimingAbandonment(false);
    }
  };

  // Reconciliação se o estado oficial já incorporou a nova direção
  useEffect(() => {
    if (mySnake?.direction && predictedDirection === mySnake.direction) {
      setPredictedDirection(null);
    }
  }, [mySnake?.direction, predictedDirection]);

  // 6. Renders de Loading e Erro Inicial
  if (isLoading && !snapshot) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 animate-pulse">
          <RefreshCw className="w-6 h-6 animate-spin" />
        </div>
        <div className="text-center space-y-1">
          <h2 className="text-base font-bold text-white">Carregando Snake Competitivo</h2>
          <p className="text-xs text-slate-400">Sincronizando com a autoridade oficial...</p>
        </div>
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-red-950/60 border border-red-800/80 flex items-center justify-center text-red-400 mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-bold text-white">Falha ao Conectar à Partida</h2>
          <p className="text-xs text-slate-400">{error.message}</p>
        </div>
        <div className="flex justify-center gap-3 pt-2">
          <button
            onClick={() => reconnect()}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
          >
            Tentar Reconectar
          </button>
          <button
            onClick={onLeave}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  const isFinished = snapshot?.status === 'finished' || gameState?.status === 'finished';

  return (
    <div className="flex flex-col min-h-[85vh] w-full max-w-lg mx-auto px-3 py-2 select-none">
      {/* 1. Header do Jogo */}
      <header className="flex items-center justify-between pb-2 border-b border-slate-800/80">
        <button
          onClick={onLeave}
          className="p-2 -ml-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/60 active:scale-95 transition-all"
          aria-label="Voltar para o lobby"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1.5 text-xs font-bold text-white tracking-wide">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>SNAKE COMPETITIVO</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-400">
            <span>Tick #{gameState?.tick || 0}</span>
            <span>•</span>
            <ConnectionStatusIndicator syncState={syncState} />
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsRulesModalOpen(true)}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-all"
            aria-label="Ver regras do jogo"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          <button
            onClick={() => setIsAbandonModalOpen(true)}
            disabled={isFinished}
            className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-950/30 transition-all disabled:opacity-30"
            aria-label="Abandonar partida"
          >
            <Flag className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* 2. Placar Superior dos Jogadores */}
      <section className="grid grid-cols-2 gap-2 my-2" aria-label="Placar dos Jogadores">
        {/* Meu Perfil */}
        <div
          className={`flex items-center gap-2.5 p-2 rounded-xl border transition-all ${
            mySnake?.alive
              ? 'bg-slate-900/80 border-emerald-500/40 shadow-sm shadow-emerald-950/30'
              : 'bg-slate-950/60 border-slate-800 opacity-60'
          }`}
        >
          <div className="relative">
            <PlayerAvatar
              avatarUrl={myProfile?.avatarUrl || null}
              displayName={myProfile?.displayName || user?.email?.split('@')[0] || 'Você'}
              size="sm"
            />
            <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border border-slate-950" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white truncate">
                {myProfile?.displayName || 'Você'}
              </span>
              <span className="text-xs font-black text-emerald-400">
                {mySnake?.score || 0}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              {mySnake?.alive ? '🟢 Vivo' : '💀 Eliminado'}
            </div>
          </div>
        </div>

        {/* Adversário */}
        <div
          className={`flex items-center gap-2.5 p-2 rounded-xl border transition-all ${
            opponentSnake?.alive
              ? 'bg-slate-900/80 border-amber-500/40 shadow-sm shadow-amber-950/30'
              : 'bg-slate-950/60 border-slate-800 opacity-60'
          }`}
        >
          <div className="relative">
            <PlayerAvatar
              avatarUrl={opponentProfile?.avatarUrl || null}
              displayName={opponentProfile?.displayName || 'Oponente'}
              size="sm"
            />
            <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-amber-500 border border-slate-950" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white truncate">
                {opponentProfile?.displayName || 'Oponente'}
              </span>
              <span className="text-xs font-black text-amber-400">
                {opponentSnake?.score || 0}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              {opponentSnake?.alive ? '🟡 Vivo' : '💀 Eliminado'}
            </div>
          </div>
        </div>
      </section>

      {/* Banner de Erro Temporário */}
      {actionErrorMsg && (
        <div className="mb-2 p-2 rounded-lg bg-red-950/60 border border-red-800 text-red-300 text-xs flex items-center justify-between">
          <span>{actionErrorMsg}</span>
          <button
            onClick={() => setActionErrorMsg(null)}
            className="text-xs font-bold hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* 3. Arena Central com Grade e Cobras */}
      <main className="flex-1 flex flex-col items-center justify-center min-h-0">
        {gameState && (
          <SnakeArenaView
            state={gameState}
            myUserId={currentUserId}
            predictedDirection={predictedDirection}
            displayCount={displayCount}
          />
        )}
      </main>

      {/* 4. Controles Mobile (D-Pad Touch) */}
      <footer className="mt-auto pt-2">
        <SnakeMobileControls
          onDirectionChange={handleDirectionInput}
          currentDirection={predictedDirection || mySnake?.direction}
          disabled={isFinished || !mySnake?.alive}
        />
      </footer>

      {/* 5. Modais de Abandono e Resultado Oficial */}
      <AbandonMatchModal
        isOpen={isAbandonModalOpen}
        isLoading={isAbandoning}
        onCancel={() => setIsAbandonModalOpen(false)}
        onConfirm={handleConfirmAbandon}
      />

      {isFinished && snapshot && (
        <MatchResultModal
          isOpen={true}
          matchId={matchId}
          gameName="Cobrinha Competitiva"
          status={snapshot.status}
          winnerId={snapshot.winnerId || gameState?.winnerId || null}
          isDraw={snapshot.isDraw || Boolean(gameState?.isDraw)}
          finishReason={snapshot.finishReason}
          currentUserId={currentUserId}
          myPlayer={
            myPlayer
              ? {
                  userId: myPlayer.userId,
                  gameSymbol: myPlayer.gameSymbol,
                  slot: myPlayer.slot,
                  displayName: myProfile?.displayName || user?.email?.split('@')[0] || 'Você',
                  avatarUrl: myProfile?.avatarUrl || null,
                }
              : undefined
          }
          opponentPlayer={
            opponentPlayer
              ? {
                  userId: opponentPlayer.userId,
                  gameSymbol: opponentPlayer.gameSymbol,
                  slot: opponentPlayer.slot,
                  displayName: opponentProfile?.displayName || 'Oponente',
                  avatarUrl: opponentProfile?.avatarUrl || null,
                }
              : undefined
          }
          onGoHome={onLeave}
          onViewHistory={() => {
            if (onViewHistory) onViewHistory();
            else onLeave();
          }}
          onFindNewOpponent={() => {
            if (onPlayAgain) onPlayAgain();
            else onLeave();
          }}
          onStartRematch={(newMatchId) => {
            if (onStartRematch) onStartRematch(newMatchId);
            else onLeave();
          }}
        />
      )}

      {/* Modal de Regras Oficiais do Snake */}
      {isRulesModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl animate-scaleUp">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span>Regras: Snake Competitivo</span>
              </div>
              <button
                onClick={() => setIsRulesModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <ul className="text-xs text-slate-300 space-y-2 leading-relaxed">
              <li>
                • <strong className="text-emerald-400">Sobrevivência:</strong> O objetivo é fazer o adversário colidir antes de você.
              </li>
              <li>
                • <strong className="text-white">Comida:</strong> Cada orbe vermelho consumido aumenta o tamanho da cobra e soma 10 pontos.
              </li>
              <li>
                • <strong className="text-amber-400">Colisões:</strong> Bater na parede, no próprio corpo ou no corpo do adversário elimina a cobra.
              </li>
              <li>
                • <strong className="text-sky-400">Empate Simultâneo:</strong> Se ambas as cabeças colidirem simultaneamente, a partida termina em empate oficial.
              </li>
              <li>
                • <strong className="text-purple-400">Controles:</strong> Use o D-pad virtual touch no celular ou WASD/Setas no computador.
              </li>
            </ul>
            <button
              onClick={() => setIsRulesModalOpen(false)}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold text-xs text-white transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
