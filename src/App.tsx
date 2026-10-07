// ============================================================================
// Application Entry: DuoPlay-Online App
// Phase: Fase 7.1.1 — Integração Real de Presence, Recovery e Abandono
// Description: Orquestração do ciclo de vida da aplicação com recuperação
//              automática de partidas ativas no startup e gerenciamento de modais.
// ============================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { HomePage } from '@/pages/HomePage';
import { TicTacToeGame } from '@/games/tic-tac-toe/TicTacToeGame';
import { RoomLobbyModal } from '@/components/lobby/RoomLobbyModal';
import { ActiveMatchRecoveryModal } from '@/components/match/ActiveMatchRecoveryModal';
import { AbandonMatchModal } from '@/components/match/AbandonMatchModal';
import { MatchResultModal } from '@/components/match/MatchResultModal';
import { MatchHistoryModal } from '@/components/history/MatchHistoryModal';
import {
  getActiveMatchForCurrentUser,
  abandonMatch,
  type ActiveMatchInfo,
} from '@/services/matchSession';
import {
  getLatestCompletedMatchForCurrentUser,
  type MatchHistoryItem,
} from '@/services/matchHistory';

function MainApp() {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [isLobbyOpen, setIsLobbyOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [initialRoomCode, setInitialRoomCode] = useState<string | null>(null);

  // Recovery & Abandonment State
  const [recoveryMatchInfo, setRecoveryMatchInfo] = useState<ActiveMatchInfo | null>(null);
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false);
  const [isRecoveryLoading, setIsRecoveryLoading] = useState(false);
  const [isAbandonConfirmOpen, setIsAbandonConfirmOpen] = useState(false);
  const [isAbandoning, setIsAbandoning] = useState(false);

  // Completed Match Recovery State (Fase 8.2)
  const [completedMatchRecovery, setCompletedMatchRecovery] = useState<MatchHistoryItem | null>(null);
  const [isCompletedResultOpen, setIsCompletedResultOpen] = useState(false);

  const lastCheckedUserIdRef = useRef<string | null>(null);

  // Lê parâmetros de URL na inicialização (?match=UUID ou ?room=CODE)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const matchParam = params.get('match');
      const roomParam = params.get('room');

      if (matchParam) {
        setActiveMatchId(matchParam);
      } else if (roomParam) {
        setInitialRoomCode(roomParam.toUpperCase());
        setIsLobbyOpen(true);
      }
    }
  }, []);

  // Checagem de partida ativa no startup / login
  const checkActiveMatchOnStartup = useCallback(async (currentUserId: string) => {
    // Se já estiver em partida via URL ou estado, não abre modal de recuperação
    if (activeMatchId) return;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('match')) return;
    }

    try {
      const res = await getActiveMatchForCurrentUser();
      if (res.success && res.data) {
        // Verifica se a partida não foi recém-abandonada nesta aba pelo usuário atual
        let isDismissed = false;
        if (typeof window !== 'undefined') {
          isDismissed =
            Boolean(sessionStorage.getItem(`abandoned_match_${currentUserId}_${res.data.match_id}`)) ||
            Boolean(sessionStorage.getItem(`abandoned_match_${res.data.match_id}`));
        }

        if (!isDismissed) {
          setRecoveryMatchInfo(res.data);
          setIsRecoveryModalOpen(true);
        }
      } else if (res.success && res.data === null) {
        // Fase 8.3: Consulta a partida finalizada mais recente somente quando
        // a RPC de partida ativa confirmar com sucesso que não existe partida em andamento.
        const historyRes = await getLatestCompletedMatchForCurrentUser();
        if (historyRes.success && historyRes.data) {
          const lastMatch = historyRes.data;
          let isSeen = false;
          if (typeof window !== 'undefined') {
            const seenKey = `seen_match_result_${currentUserId}_${lastMatch.match_id}`;
            isSeen =
              Boolean(localStorage.getItem(seenKey)) ||
              Boolean(sessionStorage.getItem(seenKey));
          }

          // Exibe o resultado se ainda não foi marcado como visto para este usuário e partida
          if (!isSeen) {
            setCompletedMatchRecovery(lastMatch);
            setIsCompletedResultOpen(true);
          }
        }
      }
    } catch {
      // Erro temporário de rede não interrompe o app
    }
  }, [activeMatchId]);

  // Efeito de transição de autenticação (suporta troca de conta User A -> Logout -> User B)
  useEffect(() => {
    if (isAuthLoading) return;

    if (!isAuthenticated || !user) {
      // Usuário deslogou: limpa estados de recuperação do usuário anterior
      lastCheckedUserIdRef.current = null;
      setRecoveryMatchInfo(null);
      setCompletedMatchRecovery(null);
      setIsRecoveryModalOpen(false);
      setIsCompletedResultOpen(false);
      setIsAbandonConfirmOpen(false);
      return;
    }

    // Usuário logou ou trocou de conta
    if (user.id !== lastCheckedUserIdRef.current) {
      lastCheckedUserIdRef.current = user.id;
      setRecoveryMatchInfo(null);
      setCompletedMatchRecovery(null);
      setIsRecoveryModalOpen(false);
      setIsCompletedResultOpen(false);
      checkActiveMatchOnStartup(user.id);
    }
  }, [isAuthLoading, isAuthenticated, user, checkActiveMatchOnStartup]);

  const handleStartMatch = (matchId: string) => {
    setIsLobbyOpen(false);
    setIsRecoveryModalOpen(false);
    setRecoveryMatchInfo(null);
    setIsCompletedResultOpen(false);
    setCompletedMatchRecovery(null);
    setActiveMatchId(matchId);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('match', matchId);
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleLeaveMatch = () => {
    // Sair da interface durante uma partida ativa não marca o resultado como visto.
    setActiveMatchId(null);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('match');
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleDismissCompletedRecovery = () => {
    if (completedMatchRecovery && typeof window !== 'undefined' && user) {
      const seenKey = `seen_match_result_${user.id}_${completedMatchRecovery.match_id}`;
      localStorage.setItem(seenKey, 'true');
      sessionStorage.setItem(seenKey, 'true');
    }
    setIsCompletedResultOpen(false);
    setCompletedMatchRecovery(null);
  };

  const handleResumeRecovery = (matchId: string) => {
    handleStartMatch(matchId);
  };

  const handleRequestAbandonFromRecovery = () => {
    setIsAbandonConfirmOpen(true);
  };

  const handleConfirmAbandonFromRecovery = async () => {
    if (!recoveryMatchInfo || isAbandoning) return;
    setIsAbandoning(true);

    try {
      const matchId = recoveryMatchInfo.match_id;
      const res = await abandonMatch(matchId);
      if (res.success) {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(`abandoned_match_${matchId}`, 'true');
        }
        setIsAbandonConfirmOpen(false);
        setIsRecoveryModalOpen(false);
        setRecoveryMatchInfo(null);
      } else {
        // Falha no abandono
        setIsAbandonConfirmOpen(false);
      }
    } catch {
      setIsAbandonConfirmOpen(false);
    } finally {
      setIsAbandoning(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#090d16] text-slate-100 selection:bg-blue-600 selection:text-white">
      {/* Platform Header */}
      <Header onOpenHistory={() => setIsHistoryOpen(true)} />

      {/* Main Content Area */}
      <main className="grow">
        {activeMatchId ? (
          <TicTacToeGame
            matchId={activeMatchId}
            onLeave={handleLeaveMatch}
            onViewHistory={() => setIsHistoryOpen(true)}
            onPlayAgain={() => {
              handleLeaveMatch();
              setIsLobbyOpen(true);
            }}
          />
        ) : (
          <HomePage
            onPlayGame={() => setIsLobbyOpen(true)}
            onOpenLobby={() => setIsLobbyOpen(true)}
          />
        )}
      </main>

      {/* Platform Footer */}
      <Footer />

      {/* PWA Offline Connectivity Indicator */}
      <OfflineIndicator />

      {/* Modal de Salas & Lobby para Multiplayer */}
      <RoomLobbyModal
        isOpen={isLobbyOpen}
        initialCode={initialRoomCode}
        onClose={() => {
          setIsLobbyOpen(false);
          setInitialRoomCode(null);
        }}
        onMatchStarted={handleStartMatch}
      />

      {/* Modal de Histórico Paginado de Partidas */}
      <MatchHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onPlayGame={() => setIsLobbyOpen(true)}
      />

      {/* Modal de Recuperação de Partida Ativa */}
      <ActiveMatchRecoveryModal
        isOpen={isRecoveryModalOpen && !activeMatchId}
        matchInfo={recoveryMatchInfo}
        isLoading={isRecoveryLoading}
        onResume={handleResumeRecovery}
        onRequestAbandon={handleRequestAbandonFromRecovery}
      />

      {/* Modal de Resultado de Partida Finalizada Recuperada no Startup (Fase 8.2) */}
      {completedMatchRecovery && (
        <MatchResultModal
          isOpen={isCompletedResultOpen && !activeMatchId}
          matchId={completedMatchRecovery.match_id}
          gameName={completedMatchRecovery.game_name}
          status={completedMatchRecovery.status}
          winnerId={completedMatchRecovery.winner_id}
          isDraw={completedMatchRecovery.is_draw}
          finishReason={completedMatchRecovery.finish_reason}
          currentUserId={user?.id || null}
          myPlayer={{
            gameSymbol: completedMatchRecovery.my_symbol,
            slot: completedMatchRecovery.my_slot,
            displayName: user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Você',
          }}
          opponentPlayer={
            completedMatchRecovery.opponents?.[0]
              ? {
                  gameSymbol: completedMatchRecovery.opponents[0].game_symbol,
                  slot: completedMatchRecovery.opponents[0].slot,
                  displayName:
                    completedMatchRecovery.opponents[0].display_name ||
                    completedMatchRecovery.opponents[0].username ||
                    'Adversário',
                }
              : null
          }
          onGoHome={handleDismissCompletedRecovery}
          onViewHistory={() => {
            handleDismissCompletedRecovery();
            setIsHistoryOpen(true);
          }}
        />
      )}

      {/* Modal de Confirmação de Abandono (Origem: Recovery) */}
      <AbandonMatchModal
        isOpen={isAbandonConfirmOpen}
        isLoading={isAbandoning}
        onCancel={() => setIsAbandonConfirmOpen(false)}
        onConfirm={handleConfirmAbandonFromRecovery}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
