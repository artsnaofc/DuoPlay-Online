// ============================================================================
// Component: CartaDuoGame — DuoPlay-Online
// Phase: Fase 20 — Carta Duo 🃏
// Description: Tela oficial do jogo de cartas multiplayer por turnos "Carta Duo".
//              Suporta de 2 a 6 competidores, com regras configuráveis,
//              validações server-side, animações de sentido de turnos e HUD completo.
// ============================================================================

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Trophy,
  RotateCcw,
  RefreshCw,
  AlertCircle,
  ArrowLeft,
  Clock,
  Sparkles,
  HelpCircle,
  ShieldAlert,
  Flag,
  UserCheck,
  UserX,
  Plus,
  Play,
  Ban,
  Shuffle,
  Layers,
  Check,
  Flame,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useGameSession } from '@/multiplayer/hooks/useGameSession';
import { useAuth } from '@/hooks/useAuth';
import { AbandonMatchModal } from '@/components/match/AbandonMatchModal';
import { MatchResultModal } from '@/components/match/MatchResultModal';
import { abandonMatch, claimAbandonment } from '@/services/matchSession';
import { PlayerAvatar } from '@/components/profile/PlayerAvatar';
import { fetchPublicProfile, type PublicPlayerProfile } from '@/services/profile';
import { ConnectionStatusIndicator } from '@/components/match/ConnectionStatusIndicator';
import { TurnTimer } from '@/components/match/TurnTimer';

interface CartaDuoGameProps {
  matchId: string;
  onLeave: () => void;
  onViewHistory?: () => void;
  onPlayAgain?: () => void;
  onStartRematch?: (newMatchId: string) => void;
  onViewPlayerProfile?: (userId: string) => void;
}

interface CartaDuoState {
  config: {
    initial_cards?: number;
    cumulative_draw?: boolean;
    force_draw?: boolean;
    play_immediately?: boolean;
    turn_timer?: number;
  };
  deck?: string[];
  discard_pile?: string[];
  hands?: Record<string, string[]>;
  active_color?: 'red' | 'blue' | 'green' | 'yellow' | 'wild';
  active_value?: string;
  direction?: number;
  turn_order?: string[];
  current_turn_player_id?: string | null;
  pending_draws?: number;
  winner_id?: string | null;
  is_finished?: boolean;
}

export const CartaDuoGame: React.FC<CartaDuoGameProps> = ({
  matchId,
  onLeave,
  onViewHistory,
  onPlayAgain,
  onStartRematch,
  onViewPlayerProfile,
}) => {
  const { user } = useAuth();
  const currentUserId = user?.id || null;

  // Estado de carregamento dos perfis públicos dos oponentes
  const [opponentsProfiles, setOpponentsProfiles] = useState<Record<string, PublicPlayerProfile>>({});
  const [soundEnabled, setSoundEnabled] = useState(true);

  const {
    snapshot,
    syncState,
    error: sessionError,
    isLoading,
    isMyTurn,
    myPlayer,
    submitAction,
    refresh,
    reconnect,
  } = useGameSession<CartaDuoState>(matchId);

  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [isResultModalOpen, setIsResultModalOpen] = useState(true);
  const [isAbandonModalOpen, setIsAbandonModalOpen] = useState(false);
  const [isAbandoning, setIsAbandoning] = useState(false);

  // Seleção de cor para cartas Wild
  const [wildSelectCard, setWildSelectCard] = useState<string | null>(null);

  // Detalhes da partida
  const status = snapshot?.status || 'in_progress';
  const isFinished = status === 'finished' || status === 'abandoned' || status === 'cancelled';
  const state = snapshot?.state;
  const isInitialized = state && Array.isArray(state.deck) && typeof state.hands === 'object';

  // Configurações
  const gameConfig = useMemo(() => {
    return {
      initial_cards: state?.config?.initial_cards ?? 7,
      cumulative_draw: state?.config?.cumulative_draw ?? true,
      force_draw: state?.config?.force_draw ?? true,
      play_immediately: state?.config?.play_immediately ?? true,
      turn_timer: state?.config?.turn_timer ?? 30,
    };
  }, [state?.config]);

  // Lista todos os outros jogadores da partida (oponentes)
  const opponents = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.players.filter((p) => p.userId !== currentUserId);
  }, [snapshot, currentUserId]);

  // Carrega perfis dos oponentes quando houver novos competidores na partida
  useEffect(() => {
    if (opponents.length === 0) return;

    opponents.forEach((opp) => {
      if (opponentsProfiles[opp.userId]) return; // Já carregado

      fetchPublicProfile(opp.userId).then((res) => {
        if (res.success && res.data) {
          setOpponentsProfiles((prev) => ({
            ...prev,
            [opp.userId]: res.data!,
          }));
        }
      });
    });
  }, [opponents, opponentsProfiles]);

  // Monitorar periodicamente a presença a cada 4 segundos
  useEffect(() => {
    if (isFinished || !matchId) return;

    const interval = setInterval(() => {
      refresh();
    }, 4000);

    return () => clearInterval(interval);
  }, [isFinished, matchId, refresh]);

  // Reabre modal de resultado caso mude para finalizado
  useEffect(() => {
    if (isFinished) {
      setIsResultModalOpen(true);
    }
  }, [isFinished]);

  // Minha mão de cartas
  const myHand = useMemo<string[]>(() => {
    if (isInitialized && state?.hands && currentUserId) {
      return state.hands[currentUserId] || [];
    }
    return [];
  }, [isInitialized, state?.hands, currentUserId]);

  // Tradução do código da carta em cor e valor
  const parseCard = useCallback((cardCode: string) => {
    if (!cardCode) return { color: 'wild', value: 'color' };
    const parts = cardCode.split(':');
    return {
      color: parts[0] as 'red' | 'blue' | 'green' | 'yellow' | 'wild',
      value: parts[1] || '',
    };
  }, []);

  // Verifica se uma carta específica da mão é jogável no momento
  const isCardPlayable = useCallback((cardCode: string) => {
    if (!isMyTurn || isFinished || !isInitialized) return false;

    const card = parseCard(cardCode);
    const activeColor = state?.active_color;
    const activeValue = state?.active_value;
    const pendingDraws = state?.pending_draws ?? 0;

    // Regra de acúmulo de cartas
    if (pendingDraws > 0) {
      if (gameConfig.cumulative_draw) {
        return card.value === 'draw2' || card.value === 'draw4';
      }
      return false; // Deve comprar primeiro
    }

    // Regras de descarte comum
    if (card.color === 'wild') return true;
    if (activeColor === 'wild') return true; // Coringa sem cor escolhida no primeiro turno
    return card.color === activeColor || card.value === activeValue;
  }, [isMyTurn, isFinished, isInitialized, state, parseCard, gameConfig]);

  // Executa jogada
  const handlePlayCard = async (cardCode: string, chosenColor?: string) => {
    if (!isMyTurn || isFinished || submittingAction) return;

    const card = parseCard(cardCode);

    // Se for um coringa (Wild) e nenhuma cor foi selecionada ainda, abre modal de seleção
    if (card.color === 'wild' && !chosenColor) {
      setWildSelectCard(cardCode);
      return;
    }

    setFeedbackError(null);
    setSubmittingAction(true);
    setWildSelectCard(null);

    try {
      const payload: Record<string, any> = { card: cardCode };
      if (chosenColor) {
        payload.choose_color = chosenColor;
      }

      const res = await submitAction('play_card', payload);

      if (!res.accepted && res.error) {
        setFeedbackError(res.error.message || 'Jogada inválida rejeitada pelo servidor.');
      } else {
        // Toca som de descarte se habilitado
        if (soundEnabled && typeof window !== 'undefined') {
          // Play sound indicator placeholder
        }
      }
    } catch {
      setFeedbackError('Erro ao enviar jogada ao servidor.');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Compra carta
  const handleDrawCard = async () => {
    if (!isMyTurn || isFinished || submittingAction) return;

    setFeedbackError(null);
    setSubmittingAction(true);

    try {
      const res = await submitAction('draw_card', {});

      if (!res.accepted && res.error) {
        setFeedbackError(res.error.message || 'Erro ao comprar carta.');
      }
    } catch {
      setFeedbackError('Erro ao comunicar compra de carta.');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Encerra turno (usado após comprar e escolher não jogar)
  const handleEndTurn = async () => {
    if (!isMyTurn || isFinished || submittingAction) return;

    setFeedbackError(null);
    setSubmittingAction(true);

    try {
      const res = await submitAction('end_turn', {});

      if (!res.accepted && res.error) {
        setFeedbackError(res.error.message || 'Erro ao passar a vez.');
      }
    } catch {
      setFeedbackError('Erro ao comunicar final de turno.');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Reivindicação por W.O.
  const handleClaimWO = async () => {
    if (submittingAction || isFinished) return;
    setSubmittingAction(true);
    setFeedbackError(null);

    try {
      const res = await claimAbandonment(matchId);
      if (res.success) {
        await reconnect();
      } else {
        setFeedbackError(res.error || 'Não foi possível reivindicar vitória por W.O.');
      }
    } catch {
      setFeedbackError('Erro de conexão com o servidor.');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Abandono voluntário
  const handleConfirmAbandon = async () => {
    if (isAbandoning || isFinished) return;
    setIsAbandoning(true);

    try {
      const res = await abandonMatch(matchId);
      if (res.success) {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(`abandoned_match_${matchId}`, 'true');
        }
        setIsAbandonModalOpen(false);
        onLeave();
      } else {
        setFeedbackError(res.error || 'Não foi possível abandonar a partida.');
        setIsAbandonModalOpen(false);
      }
    } catch {
      setFeedbackError('Erro ao processar abandono.');
      setIsAbandonModalOpen(false);
    } finally {
      setIsAbandoning(false);
    }
  };

  // Cores de fundo e textos para as cartas
  const getCardColorClass = (colorCode: string) => {
    switch (colorCode) {
      case 'red':
        return 'from-red-600 to-red-800 text-white border-red-500 shadow-red-950/40';
      case 'blue':
        return 'from-blue-600 to-blue-800 text-white border-blue-500 shadow-blue-950/40';
      case 'green':
        return 'from-emerald-600 to-emerald-800 text-white border-emerald-500 shadow-emerald-950/40';
      case 'yellow':
        return 'from-yellow-500 to-amber-600 text-slate-900 border-yellow-400 shadow-amber-950/40';
      case 'wild':
        return 'from-slate-800 to-slate-950 text-amber-400 border-slate-700 shadow-slate-950';
      default:
        return 'from-slate-700 to-slate-900 text-white border-slate-600';
    }
  };

  const getCardSymbolText = (valueCode: string) => {
    switch (valueCode) {
      case 'skip':
        return <Ban className="w-8 h-8 sm:w-10 sm:h-10 text-white drop-shadow" />;
      case 'reverse':
        return <Shuffle className="w-8 h-8 sm:w-10 sm:h-10 text-white drop-shadow" />;
      case 'draw2':
        return <span className="text-xl sm:text-2xl font-black drop-shadow text-white">+2</span>;
      case 'draw4':
        return <span className="text-2xl sm:text-3xl font-black drop-shadow text-amber-400">+4</span>;
      case 'color':
        return <Sparkles className="w-8 h-8 sm:w-10 sm:h-10 text-amber-400 drop-shadow" />;
      default:
        return <span className="text-3xl sm:text-4xl font-extrabold tracking-tighter drop-shadow">{valueCode}</span>;
    }
  };

  // Exibe o esqueleto se estiver sincronizando no início
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 animate-pulse">
          <RefreshCw className="w-6 h-6 animate-spin" />
        </div>
        <div className="text-center space-y-1">
          <h2 className="text-base font-bold text-white">Conectando ao Carta Duo</h2>
          <p className="text-xs text-slate-400">Puxando informações oficiais do PostgreSQL...</p>
        </div>
      </div>
    );
  }

  // Falha de carregamento
  if (!snapshot && sessionError) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-red-950/60 border border-red-800/80 flex items-center justify-center text-red-400 mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-bold text-white">Partida não encontrada</h2>
          <p className="text-xs text-slate-400">
            {sessionError.message || 'Não foi possível localizar o estado desta partida no servidor.'}
          </p>
        </div>
        <button
          onClick={onLeave}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar ao Lobby</span>
        </button>
      </div>
    );
  }

  // Estado desconectado de oponentes
  const disconnectedOpponentWithWO = opponents.find(
    (opp) => opp.connectionStatus === 'disconnected' && opp.gracePeriodExpiresAt
  );

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-8 space-y-5 select-none relative">
      {/* 1. TOP HEADER STATUS */}
      <div className="flex items-center justify-between pb-3.5 border-b border-slate-800/80 gap-3">
        <div className="flex items-center gap-2">
          {!isFinished ? (
            <button
              type="button"
              onClick={() => setIsAbandonModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 border border-red-900/60 text-xs font-bold text-red-300 transition-all active:scale-95"
            >
              <Flag className="w-3.5 h-3.5 text-red-400" />
              <span>Desistir</span>
            </button>
          ) : (
            <button
              onClick={onLeave}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-bold text-slate-300 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Sair</span>
            </button>
          )}

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            title={soundEnabled ? 'Desativar som' : 'Ativar som'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-blue-400" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>

        {/* Informações básicas */}
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Carta Duo</span>
            <span className="text-[11px] text-slate-500">Mínimo: 2 · Máximo: 6 jogadores</span>
          </div>
          <ConnectionStatusIndicator
            syncState={syncState}
            onReconnect={() => reconnect()}
          />
        </div>
      </div>

      {/* 2. AREA DOS OUTROS JOGADORES (HUD ADVERSÁRIOS) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3.5 pb-2">
        {opponents.map((opp) => {
          const oppProfile = opponentsProfiles[opp.userId];
          const isOppTurn = state?.current_turn_player_id === opp.userId && !isFinished;
          const oppCardCount = state?.hands?.[opp.userId]?.length ?? 0;
          const isOppDisconnected = opp.connectionStatus === 'disconnected';

          return (
            <div
              key={opp.userId}
              className={`p-3 rounded-xl border transition-all flex flex-col justify-between gap-2.5 relative overflow-hidden ${
                isOppTurn
                  ? 'bg-purple-950/40 border-purple-500/80 shadow-[0_0_12px_rgba(168,85,247,0.15)] ring-1 ring-purple-500/30'
                  : 'bg-slate-900/60 border-slate-800/80'
              }`}
            >
              {/* Highlight do Turno */}
              {isOppTurn && (
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-purple-500 to-pink-500 animate-pulse" />
              )}

              <div className="flex items-center gap-2.5 min-w-0">
                <PlayerAvatar
                  avatarUrl={oppProfile?.avatarUrl}
                  displayName={oppProfile?.displayName || `Oponente ${opp.slot}`}
                  username={oppProfile?.username}
                  size="xs"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-black text-white truncate flex items-center gap-1">
                    <span>{oppProfile?.displayName || `Jogador ${opp.slot}`}</span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Slot {opp.slot}
                  </div>
                </div>
              </div>

              {/* Status do Oponente (Conexão e Cartas) */}
              <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/60 gap-2">
                <div className="flex items-center gap-1 shrink-0">
                  <Layers className="w-3.5 h-3.5 text-blue-400" />
                  <span className="font-extrabold text-white font-mono">{oppCardCount} cartas</span>
                </div>

                {isOppDisconnected ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-950/50 px-1.5 py-0.5 rounded border border-red-900/40">
                    <span className="w-1 h-1 bg-red-500 rounded-full animate-pulse" />
                    <span>Off</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400 bg-emerald-950/30 px-1.5 py-0.5 rounded border border-emerald-900/30">
                    <span className="w-1 h-1 bg-emerald-500 rounded-full" />
                    <span>On</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* BANNER DE DESCONEXÃO / REIVINDICAÇÃO W.O. */}
      {disconnectedOpponentWithWO && !isFinished && (
        <div className="p-4 rounded-xl bg-red-950/70 border border-red-800 text-red-200 space-y-2 animate-in fade-in">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-bold text-red-300 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-400" />
              <span>Adversário Desconectado detectado</span>
            </span>
            <button
              type="button"
              onClick={handleClaimWO}
              className="py-1.5 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition-all active:scale-95"
            >
              Reivindicar Vitória (W.O.)
            </button>
          </div>
          <p className="text-[11px] text-red-200/90 leading-relaxed">
            Se algum jogador permanecer desconectado além do prazo de carência regulamentar do servidor, a vitória oficial será deferida para os jogadores restantes.
          </p>
        </div>
      )}

      {/* 3. TELA DE INICIALIZAÇÃO (LAZY START DO PRIMEIRO TURNO) */}
      {!isInitialized && !isFinished && (
        <div className="p-8 rounded-2xl bg-slate-900/90 border border-slate-800 text-center space-y-5 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />
          <div className="w-16 h-16 rounded-3xl bg-blue-600/10 border border-blue-500/30 flex items-center justify-center text-blue-400 mx-auto animate-bounce">
            <Layers className="w-8 h-8" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h3 className="text-lg font-extrabold text-white">Partida Pronta!</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              O baralho de 108 cartas e as mãos dos jogadores serão gerados deterministicamente no PostgreSQL na primeira ação.
            </p>
          </div>

          <div className="pt-2">
            {isMyTurn ? (
              <button
                type="button"
                onClick={handleDrawCard}
                disabled={submittingAction}
                className="py-3 px-8 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-sm shadow-xl shadow-blue-900/40 transition-all flex items-center gap-2 mx-auto active:scale-95 disabled:opacity-40"
              >
                {submittingAction ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                <span>Distribuir Mãos e Começar</span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-2 text-xs text-amber-300 font-semibold bg-amber-950/40 px-4 py-2.5 rounded-xl border border-amber-900/30">
                <Clock className="w-4 h-4 animate-spin text-amber-400" />
                <span>Aguardando o Anfitrião (Slot 1) iniciar o embaralhamento...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. ARENA PRINCIPAL DO JOGO (MESA) */}
      {isInitialized && !isFinished && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LADO ESQUERDO: BARALHO DE COMPRA */}
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col items-center justify-center text-center gap-4 relative">
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Baralho</span>
              <h4 className="text-2xl font-black text-white font-mono">{state?.deck?.length ?? 0}</h4>
              <p className="text-[10px] text-slate-500">Cartas restantes para compra</p>
            </div>

            {/* Ilustração do Stack */}
            <div
              onClick={handleDrawCard}
              className={`w-28 h-40 sm:w-32 sm:h-44 rounded-2xl border-2 border-dashed border-blue-500/30 bg-slate-950 flex flex-col items-center justify-center cursor-pointer transition-all ${
                isMyTurn
                  ? 'hover:scale-105 hover:border-blue-500 active:scale-95 shadow-[0_0_20px_rgba(59,130,246,0.15)] ring-2 ring-blue-500/20'
                  : 'opacity-50 cursor-not-allowed'
              }`}
            >
              <div className="w-20 h-28 sm:w-24 sm:h-32 rounded-xl bg-gradient-to-br from-blue-700 via-indigo-850 to-blue-950 border-2 border-blue-400 shadow-xl flex items-center justify-center relative transform -rotate-6 group-hover:rotate-0 transition-transform">
                <span className="text-2xl font-black text-blue-200 tracking-widest font-mono select-none">DUO</span>
              </div>
            </div>

            {/* Ações Rápidas */}
            <div className="w-full space-y-2">
              {isMyTurn && (state?.pending_draws ?? 0) > 0 && (
                <div className="p-2.5 rounded-xl bg-red-950/70 border border-red-800 text-red-200 text-xs font-bold animate-pulse flex items-center justify-center gap-2">
                  <Flame className="w-4 h-4 text-red-400" />
                  <span>Compre {state.pending_draws} cartas acumuladas!</span>
                </div>
              )}

              {isMyTurn && (
                <button
                  type="button"
                  onClick={handleDrawCard}
                  disabled={submittingAction}
                  className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md transition-colors flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Comprar Carta</span>
                </button>
              )}
            </div>
          </div>

          {/* LADO CENTRAL: PILHA DE DESCARTE (CARTA ATIVA) */}
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col items-center justify-center text-center gap-4 relative">
            {/* Indicador de Sentido de Turno */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div
                className={`w-64 h-64 border-4 border-dashed border-slate-800/30 rounded-full flex items-center justify-center ${
                  state?.direction === 1 ? 'animate-[spin_40s_linear_infinite]' : 'animate-[spin_40s_linear_infinite_reverse]'
                }`}
              />
            </div>

            <div className="space-y-1 relative z-10">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Carta Descartada</span>
              <div className="flex items-center gap-1.5 justify-center">
                <span className="text-xs text-slate-400">Cor Ativa:</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                    state?.active_color === 'red'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                      : state?.active_color === 'blue'
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                      : state?.active_color === 'green'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : state?.active_color === 'yellow'
                      ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
                      : 'bg-slate-700/20 text-slate-400 border border-slate-500/40'
                  }`}
                >
                  {state?.active_color === 'red' && 'Vermelho'}
                  {state?.active_color === 'blue' && 'Azul'}
                  {state?.active_color === 'green' && 'Verde'}
                  {state?.active_color === 'yellow' && 'Amarelo'}
                  {state?.active_color === 'wild' && 'Escolha a cor'}
                </span>
              </div>
            </div>

            {/* RENDER DA CARTA DO DESCARTE */}
            {state?.discard_pile && state.discard_pile.length > 0 ? (
              <div className="relative z-10 py-1">
                {/* Halo de Cor Ativa */}
                <div
                  className={`absolute -inset-4 rounded-[2rem] blur-xl opacity-20 transition-all ${
                    state?.active_color === 'red'
                      ? 'bg-red-500'
                      : state?.active_color === 'blue'
                      ? 'bg-blue-500'
                      : state?.active_color === 'green'
                      ? 'bg-emerald-500'
                      : state?.active_color === 'yellow'
                      ? 'bg-yellow-400'
                      : 'bg-slate-500'
                  }`}
                />

                {/* Carta */}
                {(() => {
                  const topCardCode = state.discard_pile[state.discard_pile.length - 1];
                  const parsed = parseCard(topCardCode);
                  return (
                    <div
                      className={`relative w-28 h-40 sm:w-32 sm:h-44 rounded-2xl border-2 bg-gradient-to-br p-3 flex flex-col justify-between shadow-2xl ${getCardColorClass(
                        parsed.color
                      )}`}
                    >
                      <div className="text-[10px] font-black tracking-wider uppercase text-left">
                        {parsed.color !== 'wild' ? parsed.color : 'Coringa'}
                      </div>
                      <div className="flex items-center justify-center grow">
                        {getCardSymbolText(parsed.value)}
                      </div>
                      <div className="text-[10px] font-black tracking-wider uppercase text-right">
                        {parsed.value}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="w-28 h-40 border border-dashed border-slate-800 rounded-2xl flex items-center justify-center text-slate-600">
                Pilha Vazia
              </div>
            )}

            <div className="text-xs text-slate-500 relative z-10">
              Direção: {state?.direction === 1 ? 'Sentido Horário' : 'Sentido Anti-horário'}
            </div>
          </div>

          {/* LADO DIREITO: HUD TURNO & AÇÕES GERAIS */}
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col justify-between gap-4">
            <div className="space-y-4">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Status da Mesa</span>

              {/* Placar e Turno */}
              <div className="space-y-2">
                <div
                  className={`py-2 px-3 rounded-xl text-center text-xs font-semibold flex items-center justify-between gap-2 ${
                    isMyTurn
                      ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40'
                      : 'bg-slate-800/40 text-slate-400 border border-slate-750'
                  }`}
                >
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className={`w-2 h-2 rounded-full ${isMyTurn ? 'bg-blue-400 animate-pulse' : 'bg-slate-500'}`} />
                    <span>{isMyTurn ? 'Seu Turno de Jogar' : 'Aguardando Jogador'}</span>
                  </span>

                  <TurnTimer
                    turnDeadline={snapshot?.turnDeadline || null}
                    isMyTurn={isMyTurn}
                    isSuspended={false}
                    className="shrink-0 font-mono"
                  />
                </div>

                {/* Configurações visíveis */}
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-850 space-y-1.5 text-[11px] text-slate-400">
                  <div className="font-bold text-slate-300 mb-1">Configurações da Rodada:</div>
                  <div className="flex justify-between">
                    <span>Cartas Iniciais:</span>
                    <span className="font-bold text-white">{gameConfig.initial_cards}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Acúmulo de Compra (+2/+4):</span>
                    <span className={`font-bold ${gameConfig.cumulative_draw ? 'text-emerald-400' : 'text-red-400'}`}>
                      {gameConfig.cumulative_draw ? 'Ativado' : 'Desativado'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Compra Forçada:</span>
                    <span className={`font-bold ${gameConfig.force_draw ? 'text-emerald-400' : 'text-red-400'}`}>
                      {gameConfig.force_draw ? 'Ativado (Apenas Sem Jogada)' : 'Desativado (Livre)'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Ações do Turno */}
            {isMyTurn && (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-400 italic">
                  Você comprou carta e não tem ou escolheu não descartar?
                </p>
                <button
                  type="button"
                  onClick={handleEndTurn}
                  disabled={submittingAction}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-750 font-bold text-xs transition-all flex items-center justify-center gap-1.5"
                >
                  Passar a Vez (End Turn)
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. MINHA MÃO DE CARTAS (FAN DECK) */}
      {isInitialized && !isFinished && (
        <section className="space-y-3.5 pt-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-400" />
              <span>Sua Mão</span>
              <span className="px-2 py-0.5 rounded-full bg-blue-950/60 border border-blue-500/40 text-[11px] font-black text-blue-400 font-mono">
                {myHand.length} cartas
              </span>
            </h3>

            {isMyTurn && (
              <span className="text-[11px] text-blue-400 font-bold animate-pulse">
                Clique em uma carta destacada para descartá-la!
              </span>
            )}
          </div>

          {/* Grid de Cartas */}
          <div className="flex flex-wrap gap-3.5 p-4 rounded-2xl bg-slate-900/40 border border-slate-800/80 min-h-[14rem] items-center justify-center overflow-x-auto">
            {myHand.length === 0 ? (
              <span className="text-xs text-slate-500 font-medium">Nenhuma carta na mão.</span>
            ) : (
              myHand.map((cardCode, idx) => {
                const parsed = parseCard(cardCode);
                const playable = isCardPlayable(cardCode);

                return (
                  <button
                    key={`${cardCode}-${idx}`}
                    type="button"
                    disabled={!playable || submittingAction}
                    onClick={() => handlePlayCard(cardCode)}
                    className={`relative w-24 h-36 sm:w-26 sm:h-38 rounded-2xl border-2 bg-gradient-to-br p-2.5 flex flex-col justify-between shadow-lg transition-all duration-300 transform outline-none text-left select-none ${getCardColorClass(
                      parsed.color
                    )} ${
                      playable
                        ? 'hover:-translate-y-4 hover:rotate-2 hover:shadow-2xl cursor-pointer ring-2 ring-emerald-400/80 hover:ring-emerald-400'
                        : 'opacity-40 cursor-not-allowed border-transparent'
                    }`}
                  >
                    {/* Elemento de Brilho se for Jogável */}
                    {playable && (
                      <span className="absolute inset-0 rounded-2xl border border-emerald-400 animate-pulse pointer-events-none" />
                    )}

                    <div className="text-[9px] font-bold tracking-wider uppercase">
                      {parsed.color !== 'wild' ? parsed.color : 'Coringa'}
                    </div>

                    <div className="flex items-center justify-center grow">
                      {getCardSymbolText(parsed.value)}
                    </div>

                    <div className="text-[9px] font-bold tracking-wider uppercase text-right">
                      {parsed.value}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>
      )}

      {/* FEEDBACK DE ERRO / ALERTAS */}
      {(feedbackError || sessionError) && (
        <div className="p-3.5 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 text-xs flex items-center gap-2.5">
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

      {/* MODAL PARA ESCOLHA DE COR DO CORINGA (WILD) */}
      {wildSelectCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-center space-y-4">
            <h3 className="text-base font-extrabold text-white">Escolha a Cor Ativa</h3>
            <p className="text-xs text-slate-400">
              Você jogou uma carta Wild. Selecione a cor que o próximo jogador deve seguir:
            </p>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => handlePlayCard(wildSelectCard, 'red')}
                className="py-3 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow transition-all active:scale-95"
              >
                Vermelho
              </button>
              <button
                type="button"
                onClick={() => handlePlayCard(wildSelectCard, 'blue')}
                className="py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow transition-all active:scale-95"
              >
                Azul
              </button>
              <button
                type="button"
                onClick={() => handlePlayCard(wildSelectCard, 'green')}
                className="py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition-all active:scale-95"
              >
                Verde
              </button>
              <button
                type="button"
                onClick={() => handlePlayCard(wildSelectCard, 'yellow')}
                className="py-3 px-4 rounded-xl bg-yellow-500 hover:bg-yellow-450 text-slate-900 font-bold text-xs shadow transition-all active:scale-95"
              >
                Amarelo
              </button>
            </div>

            <button
              type="button"
              onClick={() => setWildSelectCard(null)}
              className="w-full py-2 rounded-xl bg-slate-850 hover:bg-slate-850 text-slate-400 font-semibold text-xs border border-slate-800"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* RESULTADO DA PARTIDA (MODAL FINAL) */}
      {isFinished && (
        <MatchResultModal
          isOpen={isFinished && isResultModalOpen}
          matchId={matchId}
          gameName="Carta Duo"
          status={status}
          winnerId={snapshot?.winnerId || null}
          isDraw={Boolean(snapshot?.isDraw)}
          finishReason={snapshot?.finishReason || null}
          currentUserId={currentUserId}
          myPlayer={
            myPlayer
              ? {
                  userId: currentUserId,
                  gameSymbol: 'Carta Duo',
                  slot: myPlayer.slot,
                  displayName: user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Você',
                }
              : null
          }
          opponentPlayer={
            opponents[0]
              ? {
                  userId: opponents[0].userId,
                  gameSymbol: 'Carta Duo',
                  slot: opponents[0].slot,
                  displayName: opponentsProfiles[opponents[0].userId]?.displayName || `Jogador ${opponents[0].slot}`,
                  avatarUrl: opponentsProfiles[opponents[0].userId]?.avatarUrl,
                }
              : null
          }
          onViewUserProfile={onViewPlayerProfile}
          onGoHome={() => {
            if (isFinished && currentUserId && typeof window !== 'undefined') {
              const seenKey = `seen_match_result_${currentUserId}_${matchId}`;
              localStorage.setItem(seenKey, 'true');
              sessionStorage.setItem(seenKey, 'true');
            }
            onLeave();
          }}
          onViewHistory={() => {
            if (isFinished && currentUserId && typeof window !== 'undefined') {
              const seenKey = `seen_match_result_${currentUserId}_${matchId}`;
              localStorage.setItem(seenKey, 'true');
              sessionStorage.setItem(seenKey, 'true');
            }
            if (onViewHistory) {
              onViewHistory();
            } else {
              onLeave();
            }
          }}
          onStartRematch={(newMatchId) => {
            if (currentUserId && typeof window !== 'undefined') {
              const seenKey = `seen_match_result_${currentUserId}_${matchId}`;
              localStorage.setItem(seenKey, 'true');
              sessionStorage.setItem(seenKey, 'true');
            }
            if (onStartRematch) {
              onStartRematch(newMatchId);
            }
          }}
          onFindNewOpponent={() => {
            if (isFinished && currentUserId && typeof window !== 'undefined') {
              const seenKey = `seen_match_result_${currentUserId}_${matchId}`;
              localStorage.setItem(seenKey, 'true');
              sessionStorage.setItem(seenKey, 'true');
            }
            if (onPlayAgain) {
              onPlayAgain();
            } else {
              onLeave();
            }
          }}
        />
      )}

      {/* CONFIRMAÇÃO DE ABANDONO */}
      <AbandonMatchModal
        isOpen={isAbandonModalOpen}
        isLoading={isAbandoning}
        onCancel={() => setIsAbandonModalOpen(false)}
        onConfirm={handleConfirmAbandon}
      />
    </div>
  );
};
