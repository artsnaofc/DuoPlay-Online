// ============================================================================
// Application Entry: DuoPlay-Online App
// Phase: Fase 7 — Integração End-to-End do Jogo da Velha
// ============================================================================

import React, { useState, useEffect } from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { HomePage } from '@/pages/HomePage';
import { TicTacToeGame } from '@/games/tic-tac-toe/TicTacToeGame';
import { RoomLobbyModal } from '@/components/lobby/RoomLobbyModal';

export default function App() {
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [isLobbyOpen, setIsLobbyOpen] = useState(false);
  const [initialRoomCode, setInitialRoomCode] = useState<string | null>(null);

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

  const handleStartMatch = (matchId: string) => {
    setIsLobbyOpen(false);
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

  return (
    <AuthProvider>
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
      </div>
    </AuthProvider>
  );
}
