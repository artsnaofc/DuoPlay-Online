// ============================================================================
// Component: CartaDuoGame — DuoPlay-Online
// Phase: Fase 20 — Carta Duo 🃏 (Redesign Mobile First + Regras Oficiais)
// Description: Arena multiplayer por turnos do Carta Duo com design premium
//              estilo fintech/cassino digital, usabilidade com uma mão,
//              topo da mesa oficial do PostgreSQL, sem acúmulo de compras,
//              sem botão de passar turno e transição autoritativa de Turn Timer.
// ============================================================================

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  RefreshCw,
  AlertCircle,
  ArrowLeft,
  Clock,
  Sparkles,
  HelpCircle,
  ShieldAlert,
  Flag,
  Plus,
  Play,
  Ban,
  Shuffle,
  Layers,
  Volume2,
  VolumeX,
  Compass,
  CheckCircle2,
  X,
} from 'lucide-react';
import { useGameSession } from '@/multiplayer/hooks/useGameSession';
import { useAuth } from '@/hooks/useAuth';
import { AbandonMatchModal } from '@/components/match/AbandonMatchModal';
import { MatchResultModal } from '@/components/match/MatchResultModal';
import { abandonMatch, claimAbandonment, timeoutMatchTurn } from '@/services/matchSession';
import { PlayerAvatar } from '@/components/profile/PlayerAvatar';
import { fetchPublicProfile, type PublicPlayerProfile } from '@/services/profile';
import { ConnectionStatusIndicator } from '@/components/match/ConnectionStatusIndicator';
import { TurnTimer } from '@/components/match/TurnTimer';
import { soundService } from '@/services/soundEffects';

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
    allow_same_number?: boolean;
    force_draw?: boolean;
    play_immediately?: boolean;
    turn_timer?: number;
  };
  deck?: string[];
  discard_pile?: string[];
  top_card?: string;
  hands?: Record<string, string[]>;
  active_color?: 'red' | 'blue' | 'green' | 'yellow' | 'wild';
  active_value?: string;
  direction?: number;
  turn_order?: string[];
  current_turn_player_id?: string | null;
  pending_draws?: number;
  same_number_sequence?: {
    active: boolean;
    player_id: string | null;
    number: string | null;
  };
  last_card_declarations?: Record<string, boolean>;
  winner_id?: string | null;
  is_finished?: boolean;
}

// Síntese simples de áudio via Web Audio API para microinterações táteis
const playTone = (type: 'play' | 'draw' | 'wild' | 'timeout' | 'error') => {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'play') {
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(780, now + 0.12);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'draw') {
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.1);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'wild') {
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(554, now + 0.08);
      osc.frequency.setValueAtTime(659, now + 0.16);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'timeout') {
      osc.frequency.setValueAtTime(220, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'error') {
      osc.frequency.setValueAtTime(180, now);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    }
  } catch {
    // Audio context indisponível ou bloqueado por política de autoplay
  }
};

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

  // Estado de perfis públicos dos oponentes
  const [opponentsProfiles, setOpponentsProfiles] = useState<Record<string, PublicPlayerProfile>>({});
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showRulesModal, setShowRulesModal] = useState(false);

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
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const [showCinematicResult, setShowCinematicResult] = useState(false);
  const [cinematicFinished, setCinematicFinished] = useState(false);
  const [isAbandonModalOpen, setIsAbandonModalOpen] = useState(false);
  const [isAbandoning, setIsAbandoning] = useState(false);

  // Seleção de cor para cartas Wild
  const [wildSelectCard, setWildSelectCard] = useState<string | null>(null);

  // Detalhes da partida
  const status = snapshot?.status || 'in_progress';
  const isFinished = status === 'finished' || status === 'abandoned' || status === 'cancelled';
  const state = snapshot?.state;
  const isInitialized = Boolean(state && Array.isArray(state.deck) && typeof state.hands === 'object');

  // Lista todos os outros jogadores da partida (oponentes)
  const opponents = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.players.filter((p) => p.userId !== currentUserId);
  }, [snapshot, currentUserId]);

  // Carrega perfis dos oponentes
  useEffect(() => {
    if (opponents.length === 0) return;

    opponents.forEach((opp) => {
      if (opponentsProfiles[opp.userId]) return;

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

  // Cinematic pause e som ao finalizar partida
  useEffect(() => {
    if (isFinished && !cinematicFinished) {
      setShowCinematicResult(true);
      if (snapshot?.winnerId === currentUserId) {
        soundService.play('win');
      } else {
        soundService.play('lose');
      }

      const timer = setTimeout(() => {
        setShowCinematicResult(false);
        setCinematicFinished(true);
        setIsResultModalOpen(true);
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [isFinished, cinematicFinished, snapshot?.winnerId, currentUserId]);

  // Minha mão oficial de cartas
  const myHand = useMemo<string[]>(() => {
    if (isInitialized && state?.hands && currentUserId) {
      return state.hands[currentUserId] || [];
    }
    return [];
  }, [isInitialized, state?.hands, currentUserId]);

  // Tradução do código da carta em cor e valor
  const parseCard = useCallback((cardCode: string) => {
    if (!cardCode) return { color: 'wild' as const, value: 'color' };
    const parts = cardCode.split(':');
    return {
      color: (parts[0] || 'wild') as 'red' | 'blue' | 'green' | 'yellow' | 'wild',
      value: parts[1] || '',
    };
  }, []);

  // Topo oficial da pilha de descarte
  const topCardCode = useMemo(() => {
    if (!state) return null;
    return state.top_card || state.discard_pile?.[0] || null;
  }, [state]);

  const parsedTopCard = useMemo(() => {
    return topCardCode ? parseCard(topCardCode) : null;
  }, [topCardCode, parseCard]);

  // Cor ativa oficial da mesa
  const activeColor = state?.active_color || parsedTopCard?.color || 'red';
  const activeValue = state?.active_value || parsedTopCard?.value || '';

  // Configurações e estados dinâmicos das regras oficiais
  const pendingDraws = state?.pending_draws || 0;
  const isPendingPenalty = pendingDraws > 0;
  const cumulativeDrawEnabled = state?.config?.cumulative_draw ?? true;
  const allowSameNumberEnabled = state?.config?.allow_same_number ?? false;
  const sameNumberSeq = state?.same_number_sequence;
  const isMySameNumberSeq = Boolean(
    sameNumberSeq?.active && sameNumberSeq?.player_id === currentUserId
  );
  const myLastCardDeclared = Boolean(
    currentUserId && state?.last_card_declarations?.[currentUserId]
  );
  const canDeclareLastCard = Boolean(
    myHand.length <= 2 && myHand.length > 0 && !myLastCardDeclared && !isFinished
  );

  // Verifica se uma carta específica da mão é jogável no momento
  const isCardPlayable = useCallback(
    (cardCode: string) => {
      if (!isMyTurn || isFinished || !isInitialized) return false;

      const card = parseCard(cardCode);

      // Caso 1: Jogador está em sequência ativa de cartas com o mesmo número
      if (isMySameNumberSeq && sameNumberSeq?.number) {
        return card.value === sameNumberSeq.number;
      }

      // Caso 2: Jogador está respondendo a uma penalidade de compra acumulada (+2 ou +4)
      if (isPendingPenalty) {
        if (!cumulativeDrawEnabled) return false;
        return card.value === 'draw2' || card.value === 'draw4';
      }

      // Caso 3: Descarte padrão
      if (card.color === 'wild') return true;
      if (activeColor === 'wild') return true;
      return card.color === activeColor || card.value === activeValue;
    },
    [
      isMyTurn,
      isFinished,
      isInitialized,
      isMySameNumberSeq,
      sameNumberSeq?.number,
      isPendingPenalty,
      cumulativeDrawEnabled,
      activeColor,
      activeValue,
      parseCard,
    ]
  );

  // Executa jogada de carta (play_card)
  const handlePlayCard = async (cardCode: string, chosenColor?: string) => {
    if (!isMyTurn || isFinished || submittingAction) return;

    const card = parseCard(cardCode);

    // Se for coringa (Wild ou draw4) e nenhuma cor foi selecionada ainda, abre seletor táctil
    if (card.color === 'wild' && !chosenColor) {
      setWildSelectCard(cardCode);
      return;
    }

    setFeedbackError(null);
    setSubmittingAction(true);
    setWildSelectCard(null);

    try {
      const payload: Record<string, unknown> = { card: cardCode };
      if (chosenColor) {
        payload.choose_color = chosenColor;
      }

      const res = await submitAction('play_card', payload);

      if (!res.accepted && res.error) {
        if (soundEnabled) playTone('error');
        setFeedbackError(res.error.message || 'Jogada inválida rejeitada pelo servidor.');
      } else {
        if (soundEnabled) playTone(card.color === 'wild' ? 'wild' : 'play');
      }
    } catch {
      if (soundEnabled) playTone('error');
      setFeedbackError('Erro ao enviar jogada ao servidor.');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Compra carta do baralho (draw_card) — avança o turno automaticamente
  const handleDrawCard = async () => {
    if (!isMyTurn || isFinished || submittingAction) return;

    setFeedbackError(null);
    setSubmittingAction(true);

    try {
      const res = await submitAction('draw_card', {});

      if (!res.accepted && res.error) {
        if (soundEnabled) playTone('error');
        setFeedbackError(res.error.message || 'Erro ao comprar carta.');
      } else {
        if (soundEnabled) playTone('draw');
      }
    } catch {
      if (soundEnabled) playTone('error');
      setFeedbackError('Erro ao comunicar compra de carta.');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Declaração de Última Carta
  const handleDeclareLastCard = async () => {
    if (submittingAction || isFinished) return;
    setFeedbackError(null);
    setSubmittingAction(true);

    try {
      const res = await submitAction('declare_last_card', {});
      if (!res.accepted && res.error) {
        if (soundEnabled) playTone('error');
        setFeedbackError(res.error.message || 'Erro ao declarar Última Carta.');
      } else {
        if (soundEnabled) playTone('play');
      }
    } catch {
      if (soundEnabled) playTone('error');
      setFeedbackError('Falha ao comunicar declaração de Última Carta.');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Contestação de Última Carta contra adversário que não declarou
  const handleChallengeLastCard = async (targetPlayerId: string) => {
    if (submittingAction || isFinished) return;
    setFeedbackError(null);
    setSubmittingAction(true);

    try {
      const res = await submitAction('challenge_last_card', { target_player_id: targetPlayerId });
      if (!res.accepted && res.error) {
        if (soundEnabled) playTone('error');
        setFeedbackError(res.error.message || 'Contestação não aceita.');
      } else {
        if (soundEnabled) playTone('play');
      }
    } catch {
      if (soundEnabled) playTone('error');
      setFeedbackError('Falha ao contestar Última Carta.');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Aceitar / Receber Penalidade de Compra Acumulada
  const handleAcceptPenalty = async () => {
    if (!isMyTurn || isFinished || submittingAction || pendingDraws <= 0) return;
    setFeedbackError(null);
    setSubmittingAction(true);

    try {
      const res = await submitAction('accept_penalty', {});
      if (!res.accepted && res.error) {
        if (soundEnabled) playTone('error');
        setFeedbackError(res.error.message || 'Erro ao aceitar penalidade.');
      } else {
        if (soundEnabled) playTone('draw');
      }
    } catch {
      if (soundEnabled) playTone('error');
      setFeedbackError('Falha ao aceitar penalidade de compra.');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Encerrar voluntariamente sequência de cartas do mesmo número
  const handleEndSequence = async () => {
    if (!isMyTurn || isFinished || submittingAction || !isMySameNumberSeq) return;
    setFeedbackError(null);
    setSubmittingAction(true);

    try {
      const res = await submitAction('end_sequence', {});
      if (!res.accepted && res.error) {
        if (soundEnabled) playTone('error');
        setFeedbackError(res.error.message || 'Erro ao encerrar sequência.');
      } else {
        if (soundEnabled) playTone('play');
      }
    } catch {
      if (soundEnabled) playTone('error');
      setFeedbackError('Falha ao comunicar encerramento da sequência.');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Transição Autoritativa do Turn Timer quando o tempo chega visualmente a zero
  const handleTurnTimeout = useCallback(async () => {
    if (isFinished || !snapshot) return;

    try {
      if (soundEnabled) playTone('timeout');
      await timeoutMatchTurn(matchId, snapshot.turnNumber);
    } catch {
      // Falha silenciosa caso o outro cliente ou servidor já tenha transicionado o turno
    }
  }, [isFinished, snapshot, matchId, soundEnabled]);

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

  // Cores visuais consistentes com Design System e contraste alto
  const getCardColorTheme = (colorCode: string) => {
    switch (colorCode) {
      case 'red':
        return {
          bg: 'from-red-600 via-rose-700 to-red-900',
          border: 'border-red-500/70',
          glow: 'shadow-[0_0_20px_rgba(239,68,68,0.35)]',
          badge: 'bg-red-500/20 text-red-400 border-red-500/40',
          textColor: 'text-white',
          label: 'Vermelho',
        };
      case 'blue':
        return {
          bg: 'from-blue-600 via-sky-700 to-blue-900',
          border: 'border-blue-500/70',
          glow: 'shadow-[0_0_20px_rgba(59,130,246,0.35)]',
          badge: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
          textColor: 'text-white',
          label: 'Azul',
        };
      case 'green':
        return {
          bg: 'from-emerald-600 via-teal-700 to-emerald-900',
          border: 'border-emerald-500/70',
          glow: 'shadow-[0_0_20px_rgba(16,185,129,0.35)]',
          badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
          textColor: 'text-white',
          label: 'Verde',
        };
      case 'yellow':
        return {
          bg: 'from-amber-400 via-yellow-500 to-amber-700',
          border: 'border-yellow-400/80',
          glow: 'shadow-[0_0_20px_rgba(245,158,11,0.35)]',
          badge: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
          textColor: 'text-slate-950 font-black',
          label: 'Amarelo',
        };
      case 'wild':
      default:
        return {
          bg: 'from-slate-900 via-purple-950 to-slate-950',
          border: 'border-purple-500/60',
          glow: 'shadow-[0_0_25px_rgba(168,85,247,0.35)]',
          badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
          textColor: 'text-amber-300',
          label: 'Coringa',
        };
    }
  };

  const renderCardSymbol = (valueCode: string, isSmall = false) => {
    const iconSize = isSmall ? 'w-5 h-5' : 'w-10 h-10';
    switch (valueCode) {
      case 'skip':
        return <Ban className={`${iconSize} drop-shadow`} />;
      case 'reverse':
        return <Shuffle className={`${iconSize} drop-shadow`} />;
      case 'draw2':
        return <span className={`${isSmall ? 'text-sm font-black' : 'text-3xl font-black'} tracking-tighter drop-shadow`}>+2</span>;
      case 'draw4':
        return <span className={`${isSmall ? 'text-sm font-black' : 'text-3xl font-black'} text-amber-300 tracking-tighter drop-shadow`}>+4</span>;
      case 'color':
        return <Sparkles className={`${iconSize} text-amber-300 drop-shadow`} />;
      default:
        return <span className={`${isSmall ? 'text-base font-extrabold' : 'text-4xl font-extrabold'} font-mono tracking-tighter drop-shadow`}>{valueCode}</span>;
    }
  };

  // Carregamento inicial do snapshot
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-400 animate-pulse">
          <RefreshCw className="w-7 h-7 animate-spin" />
        </div>
        <div className="text-center space-y-1">
          <h2 className="text-base font-bold text-white">Carregando Carta Duo</h2>
          <p className="text-xs text-slate-400">Sincronizando partida oficial...</p>
        </div>
      </div>
    );
  }

  // Falha de carregamento
  if (!snapshot && sessionError) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-red-950/60 border border-red-800/80 flex items-center justify-center text-red-400 mx-auto">
          <AlertCircle className="w-7 h-7" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-bold text-white">Partida não encontrada</h2>
          <p className="text-xs text-slate-400">
            {sessionError.message || 'Não foi possível carregar o estado oficial da partida.'}
          </p>
        </div>
        <button
          onClick={onLeave}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar ao Menu</span>
        </button>
      </div>
    );
  }

  // Adversário desconectado com Grace Period
  const disconnectedOpponentWithWO = opponents.find(
    (opp) => opp.connectionStatus === 'disconnected' && opp.gracePeriodExpiresAt
  );

  const activeColorTheme = getCardColorTheme(activeColor);
  const playableCardsCount = myHand.filter((c) => isCardPlayable(c)).length;

  return (
    <div className="max-w-5xl mx-auto px-2 sm:px-4 py-3 sm:py-6 space-y-4 select-none relative pb-10">
      {/* Cinematic Victory/Defeat Animation Overlay */}
      {showCinematicResult && (
        <div className="absolute inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-6 rounded-2xl animate-in fade-in zoom-in-95 duration-300">
          <div className="text-center space-y-4">
            {snapshot?.winnerId === currentUserId ? (
              <>
                <div className="text-7xl animate-bounce">🏆</div>
                <h2 className="text-4xl font-black text-amber-400 tracking-wider uppercase drop-shadow-[0_0_25px_rgba(251,191,36,0.6)]">
                  Última Carta Jogada — Vitória!
                </h2>
                <p className="text-slate-200 text-sm font-medium">Você esvaziou sua mão primeiro e venceu o duelo!</p>
              </>
            ) : snapshot?.winnerId !== null ? (
              <>
                <div className="text-7xl animate-pulse">🃏</div>
                <h2 className="text-4xl font-black text-rose-500 tracking-wider uppercase drop-shadow-[0_0_25px_rgba(244,63,94,0.6)]">
                  Derrota — Oponente Bateu
                </h2>
                <p className="text-slate-200 text-sm font-medium">O oponente jogou a última carta da mão e venceu!</p>
              </>
            ) : (
              <>
                <div className="text-7xl animate-pulse">🤝</div>
                <h2 className="text-4xl font-black text-blue-400 tracking-wider uppercase drop-shadow-[0_0_25px_rgba(96,165,250,0.6)]">
                  Fim de Partida
                </h2>
                <p className="text-slate-200 text-sm font-medium">Partida encerrada.</p>
              </>
            )}
          </div>
        </div>
      )}
      {/* 1. TOPO: HEADER STATUS & AÇÕES RÁPIDAS */}
      <header className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-2xl bg-slate-900/90 border border-slate-800 backdrop-blur-md">
        <div className="flex items-center gap-2">
          {!isFinished ? (
            <button
              type="button"
              onClick={() => setIsAbandonModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-900/50 text-xs font-bold text-red-300 transition-all active:scale-95"
              title="Desistir da partida"
            >
              <Flag className="w-3.5 h-3.5 text-red-400" />
              <span className="hidden xs:inline">Desistir</span>
            </button>
          ) : (
            <button
              onClick={onLeave}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Sair</span>
            </button>
          )}

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-750 text-slate-300 transition-colors"
            title={soundEnabled ? 'Desativar som' : 'Ativar som'}
            aria-label="Controle de Som"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
          </button>

          <button
            onClick={() => setShowRulesModal(true)}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-750 text-slate-300 transition-colors"
            title="Regras Oficiais"
            aria-label="Regras Oficiais do Jogo"
          >
            <HelpCircle className="w-4 h-4 text-blue-400" />
          </button>
        </div>

        {/* Indicador Central de Direção de Jogo */}
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-950/80 border border-slate-800/80 text-[11px] font-bold text-slate-300">
          <Compass
            className={`w-3.5 h-3.5 text-purple-400 transition-transform ${
              state?.direction === 1 ? 'animate-[spin_12s_linear_infinite]' : 'animate-[spin_12s_linear_infinite_reverse]'
            }`}
          />
          <span className="hidden sm:inline font-mono">
            {state?.direction === 1 ? 'Horário' : 'Anti-horário'}
          </span>
          <span className="text-[10px] text-slate-500">T#{snapshot?.turnNumber ?? 1}</span>
        </div>

        {/* Conexão e Turn Timer */}
        <div className="flex items-center gap-2.5">
          <ConnectionStatusIndicator syncState={syncState} onReconnect={() => reconnect()} />
          <TurnTimer
            turnDeadline={snapshot?.turnDeadline || null}
            isMyTurn={isMyTurn}
            isSuspended={Boolean(disconnectedOpponentWithWO)}
            onVisualZero={handleTurnTimeout}
            className="px-2.5 py-1 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs"
          />
        </div>
      </header>

      {/* BANNER DINÂMICO DE TURNO */}
      <div
        className={`px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 transition-all ${
          isMyTurn
            ? 'bg-emerald-950/50 border-emerald-500/50 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
            : 'bg-slate-900/60 border-slate-800 text-slate-400'
        }`}
      >
        <div className="flex items-center gap-2 truncate">
          <span className={`w-2 h-2 rounded-full ${isMyTurn ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}`} />
          <span className="truncate">
            {isFinished
              ? 'Partida finalizada'
              : isMyTurn
              ? '⚡ Sua Vez! Jogue uma carta compatível ou toque no baralho para comprar.'
              : 'Aguardando oponente jogar...'}
          </span>
        </div>

        {isMyTurn && (
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-lg bg-emerald-900/60 text-emerald-200 border border-emerald-700/50 shrink-0">
            {playableCardsCount > 0 ? `${playableCardsCount} jogáveis` : 'Compre 1 carta'}
          </span>
        )}
      </div>

      {/* 2. ADVERSÁRIOS (STRIP COMPACTO RESPONSIVO) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
        {opponents.map((opp) => {
          const oppProfile = opponentsProfiles[opp.userId];
          const isOppTurn = state?.current_turn_player_id === opp.userId && !isFinished;
          const oppCardCount = state?.hands?.[opp.userId]?.length ?? 0;
          const isOppDisconnected = opp.connectionStatus === 'disconnected';

          return (
            <div
              key={opp.userId}
              onClick={() => onViewPlayerProfile?.(opp.userId)}
              className={`p-2.5 rounded-2xl border transition-all flex flex-col justify-between gap-2 relative overflow-hidden cursor-pointer ${
                isOppTurn
                  ? 'bg-purple-950/40 border-purple-500/70 shadow-[0_0_14px_rgba(168,85,247,0.25)] ring-1 ring-purple-500/40'
                  : 'bg-slate-900/70 border-slate-800/80 hover:border-slate-700'
              }`}
            >
              {isOppTurn && (
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-indigo-500 animate-pulse" />
              )}

              <div className="flex items-center gap-2 min-w-0">
                <PlayerAvatar
                  avatarUrl={oppProfile?.avatarUrl}
                  displayName={oppProfile?.displayName || `Jogador ${opp.slot}`}
                  username={oppProfile?.username}
                  size="xs"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-white truncate">
                    {oppProfile?.displayName || `Jogador ${opp.slot}`}
                  </div>
                  <div className="text-[10px] text-slate-400">Slot {opp.slot}</div>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-800/60">
                <div className="flex items-center gap-1 font-mono font-bold text-white text-[11px]">
                  <Layers className="w-3.5 h-3.5 text-blue-400" />
                  <span>{oppCardCount}</span>
                </div>

                <div className="flex items-center gap-1">
                  {/* Indicador e Contestação de Última Carta para Oponente com 1 carta */}
                  {oppCardCount === 1 && (
                    state?.last_card_declarations?.[opp.userId] ? (
                      <span className="text-[9px] font-black text-amber-300 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-600/50">
                        🃏 Última Carta
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleChallengeLastCard(opp.userId);
                        }}
                        disabled={submittingAction}
                        className="text-[9px] font-black text-amber-300 bg-red-950/90 hover:bg-red-900 border border-red-600/70 px-1.5 py-0.5 rounded animate-pulse cursor-pointer shadow-sm active:scale-95"
                        title="Contestar oponente que não declarou Última Carta (+2 penalidade)"
                      >
                        Contestar (+2)
                      </button>
                    )
                  )}

                  {isOppDisconnected ? (
                    <span className="text-[9px] font-bold text-red-400 bg-red-950/60 px-1.5 py-0.5 rounded border border-red-900/40">
                      Offline
                    </span>
                  ) : isOppTurn ? (
                    <span className="text-[9px] font-bold text-purple-300 bg-purple-950/80 px-1.5 py-0.5 rounded border border-purple-800/60 animate-pulse">
                      Jogando
                    </span>
                  ) : (
                    <span className="text-[9px] text-emerald-400 bg-emerald-950/30 px-1.5 py-0.5 rounded border border-emerald-900/30">
                      Online
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* BANNER DE DESCONEXÃO / W.O. */}
      {disconnectedOpponentWithWO && !isFinished && (
        <div className="p-3.5 rounded-2xl bg-red-950/70 border border-red-800 text-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2 text-xs">
            <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
            <span>Adversário desconectado. Você pode reivindicar vitória por W.O. após o tempo limite.</span>
          </div>
          <button
            type="button"
            onClick={handleClaimWO}
            className="py-1.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition-all active:scale-95 shrink-0"
          >
            Reivindicar W.O.
          </button>
        </div>
      )}

      {/* BANNER DE PENALIDADE DE COMPRA ACUMULADA (+2 / +4) */}
      {isPendingPenalty && !isFinished && (
        <div className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-950/90 via-red-950/80 to-amber-950/90 border border-amber-500/70 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl animate-in fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/50 text-amber-300 flex items-center justify-center font-black text-sm shrink-0">
              +{pendingDraws}
            </div>
            <div>
              <h4 className="text-xs sm:text-sm font-extrabold text-amber-200 flex items-center gap-1.5">
                <span>Penalidade Acumulada: +{pendingDraws} Cartas!</span>
              </h4>
              <p className="text-[11px] text-amber-300/80">
                {isMyTurn
                  ? cumulativeDrawEnabled
                    ? '⚡ Defenda jogando outro +2 ou +4 para acumular, ou clique em Aceitar Penalidade.'
                    : 'Acúmulo desativado. Aceite as cartas devidas para prosseguir.'
                  : 'Aguardando o jogador da vez acumular ou receber a penalidade.'}
              </p>
            </div>
          </div>

          {isMyTurn && (
            <button
              type="button"
              onClick={handleAcceptPenalty}
              disabled={submittingAction}
              className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-black text-xs shadow-md shadow-amber-950/50 transition-all flex items-center justify-center gap-1.5 shrink-0 active:scale-95 disabled:opacity-50"
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Aceitar Penalidade (+{pendingDraws})</span>
            </button>
          )}
        </div>
      )}

      {/* BANNER DE SEQUÊNCIA DE CARTAS COM MESMO NÚMERO */}
      {isMySameNumberSeq && !isFinished && (
        <div className="p-3.5 rounded-2xl bg-gradient-to-r from-purple-950/90 via-indigo-950/80 to-purple-950/90 border border-purple-500/70 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl animate-in fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/50 text-purple-300 flex items-center justify-center font-black text-base shrink-0 font-mono">
              {sameNumberSeq?.number}
            </div>
            <div>
              <h4 className="text-xs sm:text-sm font-extrabold text-purple-200">
                Sequência Ativa: Cartas Número {sameNumberSeq?.number}
              </h4>
              <p className="text-[11px] text-purple-300/80">
                Você pode jogar outras cartas de número {sameNumberSeq?.number} de qualquer cor, ou encerrar quando quiser.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleEndSequence}
            disabled={submittingAction}
            className="py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-black text-xs shadow-md shadow-purple-950/50 transition-all flex items-center justify-center gap-1.5 shrink-0 active:scale-95 disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Encerrar Sequência</span>
          </button>
        </div>
      )}

      {/* 3. TELA DE INICIALIZAÇÃO (SE BARALHO AINDA NÃO GERADO) */}
      {!isInitialized && !isFinished && (
        <div className="p-8 rounded-3xl bg-slate-900/90 border border-slate-800 text-center space-y-4 shadow-2xl relative overflow-hidden">
          <div className="w-14 h-14 rounded-2xl bg-blue-600/10 border border-blue-500/30 flex items-center justify-center text-blue-400 mx-auto">
            <Layers className="w-7 h-7" />
          </div>
          <div className="space-y-1 max-w-sm mx-auto">
            <h3 className="text-base font-extrabold text-white">Pronto para Jogar!</h3>
            <p className="text-xs text-slate-400">
              O baralho e as mãos dos jogadores estão sendo distribuídos...
            </p>
          </div>
          {isMyTurn ? (
            <button
              type="button"
              onClick={handleDrawCard}
              disabled={submittingAction}
              className="py-3 px-8 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-sm shadow-xl transition-all inline-flex items-center gap-2 active:scale-95 disabled:opacity-50"
            >
              {submittingAction ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              <span>Distribuir Mãos e Começar</span>
            </button>
          ) : (
            <div className="inline-flex items-center gap-2 text-xs text-amber-300 font-semibold bg-amber-950/40 px-4 py-2 rounded-xl border border-amber-900/30">
              <Clock className="w-4 h-4 animate-spin text-amber-400" />
              <span>Aguardando o jogador da vez iniciar...</span>
            </div>
          )}
        </div>
      )}

      {/* 4. ARENA CENTRAL (MESA DE JOGO) */}
      {isInitialized && !isFinished && (
        <div className="rounded-3xl bg-slate-900/70 border border-slate-800 p-4 sm:p-6 relative overflow-hidden backdrop-blur-md">
          {/* Efeito sutil de feltro de mesa com aura da cor ativa */}
          <div
            className={`absolute -inset-10 opacity-15 blur-3xl pointer-events-none transition-all duration-700 bg-gradient-to-r ${activeColorTheme.bg}`}
          />

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 items-center justify-center relative z-10">
            {/* 4.1. PILHA DE COMPRA (BARALHO) */}
            <div className="flex flex-col items-center justify-center gap-2.5 text-center">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                Pilha de Compra
              </span>

              <button
                type="button"
                onClick={handleDrawCard}
                disabled={!isMyTurn || submittingAction}
                className={`relative group w-28 h-40 sm:w-32 sm:h-44 rounded-2xl border-2 transition-all flex flex-col items-center justify-center shadow-xl ${
                  isMyTurn
                    ? 'border-blue-500/70 bg-gradient-to-br from-blue-950 via-slate-900 to-slate-950 hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(59,130,246,0.25)] ring-2 ring-blue-500/30 cursor-pointer'
                    : 'border-slate-800 bg-slate-950/60 opacity-60 cursor-not-allowed'
                }`}
                title={isMyTurn ? (isPendingPenalty ? 'Aceitar penalidade e comprar cartas devidas' : 'Toque para comprar carta') : 'Aguarde o seu turno'}
              >
                {/* Camadas 3D do baralho */}
                <div className="w-20 h-28 sm:w-24 sm:h-32 rounded-xl bg-gradient-to-br from-blue-700 via-indigo-900 to-slate-950 border border-blue-400/50 flex flex-col items-center justify-center shadow-inner">
                  <span className="text-xl sm:text-2xl font-black font-mono tracking-widest text-blue-200">
                    DUO
                  </span>
                  <span className="text-[9px] font-bold text-blue-300/70 mt-1 uppercase">
                    {isPendingPenalty ? `+${pendingDraws}` : 'Comprar'}
                  </span>
                </div>

                {isMyTurn && (
                  <span className={`absolute -bottom-2 px-2.5 py-0.5 rounded-full text-white text-[9px] font-black uppercase tracking-wider shadow ${
                    isPendingPenalty ? 'bg-amber-600' : 'bg-blue-600'
                  }`}>
                    {isPendingPenalty ? `+${pendingDraws} Cartas` : '+1 Carta'}
                  </span>
                )}
              </button>

              <div className="text-[11px] font-mono text-slate-400">
                {state?.deck?.length ?? 0} restantes
              </div>
            </div>

            {/* 4.2. PILHA DE DESCARTE (TOPO OFICIAL DA MESA) */}
            <div className="flex flex-col items-center justify-center gap-2.5 text-center">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                Mesa Oficial
              </span>

              {parsedTopCard ? (
                <div
                  className={`w-28 h-40 sm:w-32 sm:h-44 rounded-2xl border-2 bg-gradient-to-br p-3 flex flex-col justify-between shadow-2xl transition-all duration-300 ${
                    getCardColorTheme(parsedTopCard.color).bg
                  } ${getCardColorTheme(parsedTopCard.color).border} ${
                    getCardColorTheme(parsedTopCard.color).glow
                  }`}
                >
                  <div className={`text-[10px] font-black uppercase tracking-wider text-left ${getCardColorTheme(parsedTopCard.color).textColor}`}>
                    {parsedTopCard.color !== 'wild' ? parsedTopCard.color : 'Coringa'}
                  </div>

                  <div className={`flex items-center justify-center my-auto ${getCardColorTheme(parsedTopCard.color).textColor}`}>
                    {renderCardSymbol(parsedTopCard.value)}
                  </div>

                  <div className={`text-[10px] font-black uppercase tracking-wider text-right ${getCardColorTheme(parsedTopCard.color).textColor}`}>
                    {parsedTopCard.value}
                  </div>
                </div>
              ) : (
                <div className="w-28 h-40 sm:w-32 sm:h-44 rounded-2xl border border-dashed border-slate-800 bg-slate-950 flex items-center justify-center text-slate-600 text-xs">
                  Pilha Vazia
                </div>
              )}

              {/* Indicador Evidente da Cor Ativa Atual */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-400">Cor Ativa:</span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border shadow-sm ${activeColorTheme.badge}`}
                >
                  {activeColorTheme.label}
                </span>
              </div>
            </div>

            {/* 4.3. RESUMO E ESTATÍSTICAS RÁPIDAS DA MESA (COLUNA 3 EM DESKTOP) */}
            <div className="col-span-2 sm:col-span-1 flex flex-col justify-center gap-2 p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-300">
              <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                Configurações da Partida
              </div>
              <ul className="space-y-1 text-[11px] text-slate-400 leading-tight">
                <li>• Acúmulo (+2/+4): <strong className="text-white">{cumulativeDrawEnabled ? 'Ativado' : 'Desativado'}</strong></li>
                <li>• Mesmo número: <strong className="text-white">{allowSameNumberEnabled ? 'Ativado' : 'Desativado'}</strong></li>
                <li>• Última Carta: <strong className="text-amber-300">Declaração Ativa</strong></li>
              </ul>
              <div className="pt-1 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-500">
                <span>Direção:</span>
                <span className="font-bold text-slate-300">{state?.direction === 1 ? 'Horário' : 'Anti-horário'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. MINHA MÃO DE CARTAS (FAN DECK HORIZONTAL ERGONÔMICO) */}
      {isInitialized && !isFinished && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between px-1 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-bold text-white">Sua Mão</h3>
              <span className="px-2 py-0.5 rounded-full bg-blue-950/80 border border-blue-500/40 text-[11px] font-mono font-bold text-blue-300">
                {myHand.length}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Botão e Indicador de Última Carta */}
              {myLastCardDeclared ? (
                <span className="px-2.5 py-1 rounded-xl bg-amber-500/20 border border-amber-500/50 text-amber-300 font-extrabold text-[11px] flex items-center gap-1.5 shadow-sm">
                  <span>🃏</span>
                  <span>Última Carta Declarada!</span>
                </span>
              ) : canDeclareLastCard ? (
                <button
                  type="button"
                  onClick={handleDeclareLastCard}
                  disabled={submittingAction}
                  className="py-1.5 px-3.5 rounded-xl bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 hover:from-amber-400 hover:to-yellow-300 text-slate-950 font-black text-xs shadow-lg shadow-amber-950/50 transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-50 animate-bounce cursor-pointer"
                  title="Declarar Última Carta para evitar contestação e penalidade de +2"
                >
                  <span>🃏</span>
                  <span>Declarar Última Carta!</span>
                </button>
              ) : null}

              {isMyTurn && (
                <span className="text-xs font-bold text-emerald-400">
                  {playableCardsCount > 0
                    ? isMySameNumberSeq
                      ? `Jogue outro ${sameNumberSeq?.number} ou encerre`
                      : isPendingPenalty
                      ? `Defenda com +2/+4 ou aceite a penalidade`
                      : 'Toque em uma carta iluminada para jogar'
                    : isPendingPenalty
                    ? 'Sem defesa — aceite a penalidade'
                    : 'Nenhuma jogável — compre do baralho'}
                </span>
              )}
            </div>
          </div>

          {/* Área de Scroll Horizontal das Cartas */}
          <div className="p-3 sm:p-4 rounded-3xl bg-slate-900/80 border border-slate-800 min-h-[12rem] flex items-center overflow-x-auto gap-3.5 scrollbar-thin scrollbar-thumb-slate-700">
            {myHand.length === 0 ? (
              <div className="w-full text-center py-6 text-xs text-slate-500">
                Nenhuma carta na mão.
              </div>
            ) : (
              myHand.map((cardCode, idx) => {
                const parsed = parseCard(cardCode);
                const playable = isCardPlayable(cardCode);
                const theme = getCardColorTheme(parsed.color);

                return (
                  <button
                    key={`${cardCode}-${idx}`}
                    type="button"
                    disabled={!playable || submittingAction}
                    onClick={() => handlePlayCard(cardCode)}
                    className={`relative shrink-0 w-24 h-36 sm:w-26 sm:h-38 rounded-2xl border-2 bg-gradient-to-br p-2.5 flex flex-col justify-between text-left select-none transition-all duration-200 outline-none ${
                      theme.bg
                    } ${theme.border} ${
                      playable
                        ? 'cursor-pointer hover:-translate-y-3 hover:scale-105 active:scale-95 shadow-xl ring-2 ring-emerald-400/90'
                        : 'opacity-40 cursor-not-allowed filter grayscale-[35%]'
                    }`}
                  >
                    {/* Glow pulsante em cartas jogáveis */}
                    {playable && (
                      <span className="absolute inset-0 rounded-2xl border-2 border-emerald-400/80 animate-pulse pointer-events-none" />
                    )}

                    <div className={`text-[9px] font-black uppercase tracking-wider ${theme.textColor}`}>
                      {parsed.color !== 'wild' ? parsed.color : 'Coringa'}
                    </div>

                    <div className={`flex items-center justify-center my-auto ${theme.textColor}`}>
                      {renderCardSymbol(parsed.value, true)}
                    </div>

                    <div className={`text-[9px] font-black uppercase tracking-wider text-right ${theme.textColor}`}>
                      {parsed.value}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>
      )}

      {/* 6. BOTÃO DE AÇÃO DO JOGADOR NO RODAPÉ (THUMB ZONE) */}
      {isInitialized && !isFinished && isMyTurn && (
        <div className="pt-1 flex flex-col gap-2">
          {isPendingPenalty ? (
            <button
              type="button"
              onClick={handleAcceptPenalty}
              disabled={submittingAction}
              className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-slate-950 font-black text-sm shadow-xl shadow-amber-900/30 transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50"
            >
              {submittingAction ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <ShieldAlert className="w-5 h-5" />
              )}
              <span>Aceitar Penalidade de Compra (+{pendingDraws} cartas)</span>
            </button>
          ) : isMySameNumberSeq ? (
            <button
              type="button"
              onClick={handleEndSequence}
              disabled={submittingAction}
              className="w-full py-3.5 px-6 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-black text-sm shadow-xl shadow-purple-900/30 transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50"
            >
              {submittingAction ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-5 h-5" />
              )}
              <span>Encerrar Sequência e Passar Turno</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDrawCard}
              disabled={submittingAction}
              className="w-full py-3.5 px-6 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-sm shadow-xl shadow-blue-900/30 transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50"
            >
              {submittingAction ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <Plus className="w-5 h-5" />
              )}
              <span>Comprar Carta do Baralho (+1)</span>
            </button>
          )}
          <p className="text-[11px] text-center text-slate-400">
            {isPendingPenalty
              ? 'Ao aceitar a penalidade, você compra o total acumulado e perde a sua vez.'
              : isMySameNumberSeq
              ? 'Encerre quando não quiser mais jogar cartas com o mesmo número.'
              : 'Ao comprar do baralho, o turno avança automaticamente para o próximo jogador.'}
          </p>
        </div>
      )}

      {/* FEEDBACK DE ERRO / ALERTAS */}
      {(feedbackError || sessionError) && (
        <div className="p-3 rounded-2xl bg-red-950/70 border border-red-800 text-red-200 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{feedbackError || sessionError?.message}</span>
          </div>
          <button
            onClick={() => setFeedbackError(null)}
            className="text-[10px] font-bold text-red-400 hover:text-red-300 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* MODAL PARA ESCOLHA DE COR DO CORINGA (WILD) */}
      {wildSelectCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-sm rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-purple-500/20 border border-purple-500/40 text-purple-300 flex items-center justify-center mx-auto">
              <Sparkles className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-black text-white">Escolha a Cor Ativa</h3>
              <p className="text-xs text-slate-400">
                Selecione a cor que os próximos jogadores deverão seguir na mesa:
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => handlePlayCard(wildSelectCard, 'red')}
                className="py-3.5 px-4 rounded-2xl bg-gradient-to-br from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white font-black text-xs shadow-lg transition-all active:scale-95 flex items-center justify-center gap-1.5"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-white" />
                <span>Vermelho</span>
              </button>
              <button
                type="button"
                onClick={() => handlePlayCard(wildSelectCard, 'blue')}
                className="py-3.5 px-4 rounded-2xl bg-gradient-to-br from-blue-600 to-sky-700 hover:from-blue-500 hover:to-sky-600 text-white font-black text-xs shadow-lg transition-all active:scale-95 flex items-center justify-center gap-1.5"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-white" />
                <span>Azul</span>
              </button>
              <button
                type="button"
                onClick={() => handlePlayCard(wildSelectCard, 'green')}
                className="py-3.5 px-4 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white font-black text-xs shadow-lg transition-all active:scale-95 flex items-center justify-center gap-1.5"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-white" />
                <span>Verde</span>
              </button>
              <button
                type="button"
                onClick={() => handlePlayCard(wildSelectCard, 'yellow')}
                className="py-3.5 px-4 rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-500 hover:from-amber-300 hover:to-yellow-400 text-slate-950 font-black text-xs shadow-lg transition-all active:scale-95 flex items-center justify-center gap-1.5"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-slate-950" />
                <span>Amarelo</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setWildSelectCard(null)}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-semibold"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* MODAL DE REGRAS OFICIAIS */}
      {showRulesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-blue-400" />
                <span>Regras Oficiais — Carta Duo</span>
              </h3>
              <button
                onClick={() => setShowRulesModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300 leading-relaxed max-h-[60vh] overflow-y-auto pr-1">
              <div>
                <strong className="text-white block font-bold">1. Objetivo</strong>
                Ser o primeiro competidor a descartar todas as cartas da mão.
              </div>
              <div>
                <strong className="text-white block font-bold">2. Descarte Legal</strong>
                No seu turno, jogue uma carta que coincida em cor ou valor com o topo da mesa, ou qualquer carta Coringa (Wild).
              </div>
              <div>
                <strong className="text-white block font-bold">3. Declaração de Última Carta</strong>
                Ao ficar com apenas 1 carta na mão (ou ao jogá-la), você deve clicar no botão <strong className="text-amber-300">"Declarar Última Carta"</strong>. Se você não declarar e um oponente contestar, você receberá uma penalidade imediata de +2 cartas do baralho!
              </div>
              <div>
                <strong className="text-white block font-bold">4. Acúmulo de Compra (+2 e +4)</strong>
                {cumulativeDrawEnabled ? (
                  <span>
                    <span className="text-emerald-400 font-bold">Ativado nesta partida:</span> Quando receber uma penalidade de +2 ou +4, você pode responder jogando outro +2 ou +4 para acumular e repassar a soma ao próximo jogador. Caso não queira ou não possa defender, clique em "Aceitar Penalidade" para comprar o total acumulado e perder a vez.
                  </span>
                ) : (
                  <span>
                    <span className="text-slate-400 font-bold">Desativado nesta partida:</span> Ao receber +2 ou +4, as cartas são compradas imediatamente pelo próximo jogador, que perde a vez sem direito a repassar.
                  </span>
                )}
              </div>
              <div>
                <strong className="text-white block font-bold">5. Múltiplas Cartas do Mesmo Número</strong>
                {allowSameNumberEnabled ? (
                  <span>
                    <span className="text-purple-300 font-bold">Ativado nesta partida:</span> Você pode jogar cartas adicionais do mesmo número (0-9) no mesmo turno, independente da cor. A sequência mantém sua vez enquanto você quiser jogar ou encerrar voluntariamente no botão "Encerrar Sequência".
                  </span>
                ) : (
                  <span>
                    <span className="text-slate-400 font-bold">Desativado nesta partida:</span> Estritamente 1 carta por turno.
                  </span>
                )}
              </div>
              <div>
                <strong className="text-white block font-bold">6. Compra e Turno</strong>
                Não existe ação de "passar a vez" sem jogar. Se não tiver carta jogável, compre do baralho (+1), o que avança o turno automaticamente para o próximo jogador.
              </div>
              <div>
                <strong className="text-white block font-bold">7. Efeitos das Cartas Especiais</strong>
                <ul className="list-disc pl-4 mt-1 space-y-0.5 text-slate-400">
                  <li><strong>Skip (🚫):</strong> Pula o próximo jogador.</li>
                  <li><strong>Reverse (⇄):</strong> Inverte o sentido do jogo (em 2 jogadores pula o oponente).</li>
                  <li><strong>+2:</strong> Aplica ou acumula +2 cartas de compra.</li>
                  <li><strong>+4 Wild:</strong> Escolhe a cor ativa e aplica ou acumula +4 cartas.</li>
                </ul>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowRulesModal(false)}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* MODAL DE RESULTADO DA PARTIDA */}
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
