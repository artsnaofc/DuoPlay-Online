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
import {
  getActiveMatchForCurrentUser,
  abandonMatch,
  type ActiveMatchInfo,
} from '@/services/matchSession';

function MainApp() {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [isLobbyOpen, setIsLobbyOpen] = useState(false);
  const [initialRoomCode, setInitialRoomCode] = useState<string | null>(null);

  // Recovery & Abandonment State
  const [recoveryMatchInfo, setRecoveryMatchInfo] = useState<ActiveMatchInfo | null>(null);
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false);
  const [isRecoveryLoading, setIsRecoveryLoading] = useState(false);
  const [isAbandonConfirmOpen, setIsAbandonConfirmOpen] = useState(false);
  const [isAbandoning, setIsAbandoning] = useState(false);

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
      setIsRecoveryModalOpen(false);
      setIsAbandonConfirmOpen(false);
      return;
    }

    // Usuário logou ou trocou de conta
    if (user.id !== lastCheckedUserIdRef.current) {
      lastCheckedUserIdRef.current = user.id;
      setRecoveryMatchInfo(null);
      setIsRecoveryModalOpen(false);
      checkActiveMatchOnStartup(user.id);
    }
  }, [isAuthLoading, isAuthenticated, user, checkActiveMatchOnStartup]);

  const handleStartMatch = (matchId: string) => {
    setIsLobbyOpen(false);
    setIsRecoveryModalOpen(false);
    setRecoveryMatchInfo(null);
    setActiveMatchId(matchId);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('match', matchId);
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleLeaveMatch = () => {
    setActiveMatchId(null);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('match');
      window.history.replaceState({}, '', url.toString());
    }
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
      <Header />

      {/* Main Content Area */}
      <main className="grow">
        {activeMatchId ? (
          <TicTacToeGame
            matchId={activeMatchId}
            onLeave={handleLeaveMatch}
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

      {/* Modal de Recuperação de Partida Ativa */}
      <ActiveMatchRecoveryModal
        isOpen={isRecoveryModalOpen && !activeMatchId}
        matchInfo={recoveryMatchInfo}
        isLoading={isRecoveryLoading}
        onResume={handleResumeRecovery}
        onRequestAbandon={handleRequestAbandonFromRecovery}
      />

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
