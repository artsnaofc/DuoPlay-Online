// ============================================================================
// Application Entry: DuoPlay-Online App
// Phase: Fase 10.4 — Integração do Matchmaking e Redesign da Home
// Description: Orquestração do ciclo de vida da aplicação com suporte a
//              recuperação de partidas ativas, matchmaking público, salas privadas e modais.
// ============================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { HomePage } from '@/pages/HomePage';
import { TicTacToeGame } from '@/games/tic-tac-toe/TicTacToeGame';
import { RoomLobbyModal } from '@/components/lobby/RoomLobbyModal';
import { PublicMatchmakingModal } from '@/components/matchmaking/PublicMatchmakingModal';
import { ActiveMatchRecoveryModal } from '@/components/match/ActiveMatchRecoveryModal';
import { AbandonMatchModal } from '@/components/match/AbandonMatchModal';
import { MatchResultModal } from '@/components/match/MatchResultModal';
import { MatchHistoryModal } from '@/components/history/MatchHistoryModal';
import { PlayerProfileModal } from '@/components/profile/PlayerProfileModal';
import { PublicPlayerProfileModal } from '@/components/profile/PublicPlayerProfileModal';
import { FriendsModal } from '@/components/social/FriendsModal';
import {
  getActiveMatchForCurrentUser,
  abandonMatch,
  type ActiveMatchInfo,
} from '@/services/matchSession';
import {
  getLatestCompletedMatchForCurrentUser,
  type MatchHistoryItem,
} from '@/services/matchHistory';
import { getMyMatchmakingStatus } from '@/services/matchmaking';
import { createRoom } from '@/services/rooms';
import { createGameInvite } from '@/services/invites';
import { useGameInvites } from '@/hooks/useGameInvites';
import { usePresenceHeartbeat } from '@/hooks/usePresenceHeartbeat';
import { ReceivedGameInviteModal } from '@/components/social/ReceivedGameInviteModal';
import type { Friend } from '@/types/social';

function MainApp() {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [isLobbyOpen, setIsLobbyOpen] = useState(false);
  const [isMatchmakingOpen, setIsMatchmakingOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isFriendsOpen, setIsFriendsOpen] = useState(false);
  const [viewingPublicUserId, setViewingPublicUserId] = useState<string | null>(null);
  const [initialRoomCode, setInitialRoomCode] = useState<string | null>(null);

  // Heartbeat de Presença Global (Fase 14.2 — Lease de Presença)
  usePresenceHeartbeat();

  // Convites de Partida em Tempo Real (Fase 14.2)
  const { activeInvite, accept: acceptGameInviteAction, decline: declineGameInviteAction } = useGameInvites();

  // Recovery & Abandonment State
  const [recoveryMatchInfo, setRecoveryMatchInfo] = useState<ActiveMatchInfo | null>(null);
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false);
  const [isRecoveryLoading] = useState(false);
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

  // Checagem de partida ativa / matchmaking no startup / login
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
          return;
        }
      } else if (res.success && res.data === null) {
        // Fase 10.4: Checa se havia uma busca de matchmaking em andamento antes do reload
        const mmStatusRes = await getMyMatchmakingStatus();
        if (mmStatusRes.success && mmStatusRes.data) {
          if (mmStatusRes.data.status === 'matched' && mmStatusRes.data.match_id) {
            handleStartMatch(mmStatusRes.data.match_id);
            return;
          } else if (mmStatusRes.data.status === 'waiting') {
            setIsMatchmakingOpen(true);
            return;
          }
        }

        // Consulta a partida finalizada mais recente quando não houver partida ativa nem matchmaking
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

          if (!isSeen) {
            setCompletedMatchRecovery(lastMatch);
            setIsCompletedResultOpen(true);
          }
        }
      }
    } catch {
      // Erros temporários de rede são ignorados no startup
    }
  }, [activeMatchId]);

  // Efeito de transição de autenticação (suporta troca de conta User A -> Logout -> User B)
  useEffect(() => {
    if (isAuthLoading) return;

    if (!isAuthenticated || !user) {
      lastCheckedUserIdRef.current = null;
      setRecoveryMatchInfo(null);
      setCompletedMatchRecovery(null);
      setIsRecoveryModalOpen(false);
      setIsCompletedResultOpen(false);
      setIsAbandonConfirmOpen(false);
      setIsMatchmakingOpen(false);
      return;
    }

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
    setIsMatchmakingOpen(false);
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
        setIsAbandonConfirmOpen(false);
      }
    } catch {
      setIsAbandonConfirmOpen(false);
    } finally {
      setIsAbandoning(false);
    }
  };

  const handlePlayWithFriend = async (friend: Friend) => {
    setIsFriendsOpen(false);
    try {
      const result = await createRoom('tic_tac_toe', `Duelo contra ${friend.display_name}`);
      if (result.success && result.data?.room?.id && result.data?.room?.code) {
        // Envia automaticamente o convite direto para o amigo selecionado
        await createGameInvite(friend.friend_id, result.data.room.id);
        setInitialRoomCode(result.data.room.code);
        setIsLobbyOpen(true);
      } else if (result.success && result.data?.room?.code) {
        setInitialRoomCode(result.data.room.code);
        setIsLobbyOpen(true);
      } else {
        setIsLobbyOpen(true);
      }
    } catch {
      setIsLobbyOpen(true);
    }
  };

  const handleAcceptInvite = async (inviteId: string) => {
    const res = await acceptGameInviteAction(inviteId);
    if (res.success && res.data?.room?.code) {
      setInitialRoomCode(res.data.room.code);
      setIsLobbyOpen(true);
      return { success: true };
    }
    return { success: false, error: res.error };
  };

  const handleDeclineInvite = async (inviteId: string) => {
    return await declineGameInviteAction(inviteId);
  };

  const handlePlayWithPlayerId = async () => {
    setViewingPublicUserId(null);
    try {
      const result = await createRoom('tic_tac_toe', 'Duelo Amistoso');
      if (result.success && result.data?.room?.code) {
        setInitialRoomCode(result.data.room.code);
        setIsLobbyOpen(true);
      } else {
        setIsLobbyOpen(true);
      }
    } catch {
      setIsLobbyOpen(true);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#090d16] text-slate-100 selection:bg-blue-600 selection:text-white">
      {/* Platform Header */}
      <Header
        onOpenMatchmaking={() => setIsMatchmakingOpen(true)}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onOpenProfile={() => setIsProfileOpen(true)}
        onOpenFriends={() => setIsFriendsOpen(true)}
        hasActiveMatch={Boolean(recoveryMatchInfo)}
        onResumeActiveMatch={() => setIsRecoveryModalOpen(true)}
      />

      {/* Main Content Area */}
      <main className="grow">
        {activeMatchId ? (
          <TicTacToeGame
            matchId={activeMatchId}
            onLeave={handleLeaveMatch}
            onViewHistory={() => setIsHistoryOpen(true)}
            onStartRematch={handleStartMatch}
            onViewPlayerProfile={(userId) => setViewingPublicUserId(userId)}
            onPlayAgain={() => {
              handleLeaveMatch();
              setIsMatchmakingOpen(true);
            }}
          />
        ) : (
          <HomePage
            onOpenMatchmaking={() => setIsMatchmakingOpen(true)}
            onOpenLobby={() => setIsLobbyOpen(true)}
            onOpenHistory={() => setIsHistoryOpen(true)}
            onOpenProfile={() => setIsProfileOpen(true)}
            onOpenFriends={() => setIsFriendsOpen(true)}
            hasActiveMatch={Boolean(recoveryMatchInfo)}
            onResumeActiveMatch={() => setIsRecoveryModalOpen(true)}
          />
        )}
      </main>

      {/* Platform Footer */}
      <Footer />

      {/* PWA Offline Connectivity Indicator */}
      <OfflineIndicator />

      {/* Modal de Matchmaking Público Autoritatívo */}
      <PublicMatchmakingModal
        isOpen={isMatchmakingOpen && !activeMatchId}
        onClose={() => setIsMatchmakingOpen(false)}
        onMatchFound={handleStartMatch}
      />

      {/* Modal de Salas & Lobby para Partidas Privadas */}
      <RoomLobbyModal
        isOpen={isLobbyOpen}
        initialCode={initialRoomCode}
        onClose={() => {
          setIsLobbyOpen(false);
          setInitialRoomCode(null);
        }}
        onMatchStarted={handleStartMatch}
      />

      {/* Modal de Amigos & Comunidade Social */}
      <FriendsModal
        isOpen={isFriendsOpen}
        onClose={() => setIsFriendsOpen(false)}
        onViewUserProfile={(userId) => {
          setIsFriendsOpen(false);
          setViewingPublicUserId(userId);
        }}
        onPlayWithFriend={handlePlayWithFriend}
      />

      {/* Modal de Histórico Paginado de Partidas */}
      <MatchHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onPlayGame={() => setIsMatchmakingOpen(true)}
        onViewUserProfile={(userId) => setViewingPublicUserId(userId)}
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
            userId: user?.id || null,
            gameSymbol: completedMatchRecovery.my_symbol,
            slot: completedMatchRecovery.my_slot,
            displayName: user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Você',
          }}
          opponentPlayer={
            completedMatchRecovery.opponents?.[0]
              ? {
                  userId: completedMatchRecovery.opponents[0].user_id,
                  gameSymbol: completedMatchRecovery.opponents[0].game_symbol,
                  slot: completedMatchRecovery.opponents[0].slot,
                  displayName:
                    completedMatchRecovery.opponents[0].display_name ||
                    completedMatchRecovery.opponents[0].username ||
                    'Adversário',
                  avatarUrl: completedMatchRecovery.opponents[0].avatar_url,
                }
              : null
          }
          onGoHome={handleDismissCompletedRecovery}
          onViewHistory={() => {
            handleDismissCompletedRecovery();
            setIsHistoryOpen(true);
          }}
          onStartRematch={handleStartMatch}
          onFindNewOpponent={() => {
            handleDismissCompletedRecovery();
            setIsMatchmakingOpen(true);
          }}
          onViewUserProfile={(userId) => setViewingPublicUserId(userId)}
        />
      )}

      {/* Modal de Perfil Próprio com Estatísticas e Edição */}
      <PlayerProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        onOpenHistory={() => {
          setIsProfileOpen(false);
          setIsHistoryOpen(true);
        }}
      />

      {/* Modal de Perfil Público de Outro Competidor */}
      <PublicPlayerProfileModal
        userId={viewingPublicUserId}
        isOpen={Boolean(viewingPublicUserId)}
        onClose={() => setViewingPublicUserId(null)}
        onPlayWithPlayer={handlePlayWithPlayerId}
      />

      {/* Modal de Confirmação de Abandono (Origem: Recovery) */}
      <AbandonMatchModal
        isOpen={isAbandonConfirmOpen}
        isLoading={isAbandoning}
        onCancel={() => setIsAbandonConfirmOpen(false)}
        onConfirm={handleConfirmAbandonFromRecovery}
      />

      {/* Modal de Convite de Partida Recebido em Tempo Real (Fase 14.2) */}
      <ReceivedGameInviteModal
        invite={activeInvite}
        onAccept={handleAcceptInvite}
        onDecline={handleDeclineInvite}
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
