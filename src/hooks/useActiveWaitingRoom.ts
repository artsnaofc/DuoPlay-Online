// ============================================================================
// Hook: useActiveWaitingRoom — DuoPlay-Online
// Description: Detecta se o usuário autenticado atual é membro de alguma sala de espera
//              ativa (status = 'waiting') no PostgreSQL e permite retornar ou sair dela.
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  getMyActiveWaitingRoom,
  leaveRoom,
  type RoomWithMembers,
} from '@/services/rooms';

export function useActiveWaitingRoom() {
  const { user, isAuthenticated } = useAuth();
  const [activeRoom, setActiveRoom] = useState<RoomWithMembers | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const isCheckingRef = useRef(false);

  const checkActiveRoom = useCallback(async () => {
    if (!isAuthenticated || !user || isCheckingRef.current) return;
    isCheckingRef.current = true;

    try {
      const res = await getMyActiveWaitingRoom();
      if (res.success) {
        setActiveRoom(res.data || null);
      } else {
        setActiveRoom(null);
      }
    } catch {
      // Ignora falhas temporárias de rede
    } finally {
      isCheckingRef.current = false;
      setIsLoading(false);
    }
  }, [isAuthenticated, user]);

  // Polling periódico a cada 5s e na alteração de autenticação
  useEffect(() => {
    if (!isAuthenticated || !user) {
      setActiveRoom(null);
      return;
    }

    checkActiveRoom();

    const intervalId = window.setInterval(() => {
      checkActiveRoom();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isAuthenticated, user, checkActiveRoom]);

  const leaveActiveWaitingRoom = async () => {
    if (!activeRoom) return;
    const targetRoomId = activeRoom.id;
    // Otimista: remove a sala ativa da UI de forma síncrona imediata
    setActiveRoom(null);
    setIsLoading(true);
    try {
      await leaveRoom(targetRoomId);
    } catch {
      // Silencia erros
    } finally {
      setIsLoading(false);
    }
  };

  return {
    activeRoom,
    isLoading,
    refreshActiveRoom: checkActiveRoom,
    leaveActiveWaitingRoom,
  };
}
