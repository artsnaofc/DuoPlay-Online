// ============================================================================
// React Hook: useGameInvites — DuoPlay-Online
// Phase: Fase 14.2 — Convites de Partida entre Amigos + Convite pela Sala de Espera
// Description: Hook reativo para consumo de convites de partida recebidos em tempo real,
//              com cálculo de expiração local e sincronização autoritativa.
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import {
  getPendingReceivedInvites,
  acceptGameInvite,
  declineGameInvite,
  clearInvitesCache,
} from '@/services/invites';
import type { GameInvite } from '@/types/invites';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface UseGameInvitesReturn {
  invites: GameInvite[];
  activeInvite: GameInvite | null;
  isLoading: boolean;
  error: string | null;
  refresh: (force?: boolean) => Promise<void>;
  accept: (inviteId: string) => Promise<{ success: boolean; data?: { room: { id: string; code: string } }; error?: string }>;
  decline: (inviteId: string) => Promise<{ success: boolean; error?: string }>;
}

export function useGameInvites(): UseGameInvitesReturn {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const currentUserId = user?.id || null;

  const [invites, setInvites] = useState<GameInvite[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef<boolean>(true);
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchInvites = useCallback(async (force = false) => {
    if (isAuthLoading) return;

    if (!currentUserId || !isAuthenticated) {
      if (isMountedRef.current) {
        setInvites([]);
        setIsLoading(false);
        setError(null);
      }
      return;
    }

    if (isMountedRef.current) {
      setIsLoading(true);
      setError(null);
    }

    try {
      const result = await getPendingReceivedInvites(force);
      if (!isMountedRef.current) return;

      if (result.success && result.data) {
        // Filtra apenas convites que ainda não expiraram
        const now = Date.now();
        const valid = result.data.filter((inv) => new Date(inv.expires_at).getTime() > now);
        setInvites(valid);
        setError(null);
      } else if (!result.success) {
        setError(result.error || 'Erro ao carregar convites de partida.');
      }
    } catch {
      if (isMountedRef.current) {
        setError('Erro de conexão ao sincronizar convites.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [currentUserId, isAuthenticated, isAuthLoading]);

  // Efeito de transição de usuário
  useEffect(() => {
    if (isAuthLoading) return;

    if (currentUserId !== lastUserIdRef.current) {
      lastUserIdRef.current = currentUserId;
      clearInvitesCache();
      if (!currentUserId || !isAuthenticated) {
        setInvites([]);
        setError(null);
      } else {
        fetchInvites(true);
      }
    }
  }, [currentUserId, isAuthenticated, isAuthLoading, fetchInvites]);

  // Timer de expiração em tempo real na interface (executa a cada segundo para remover expirados)
  useEffect(() => {
    if (invites.length === 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      setInvites((prev) => {
        const remaining = prev.filter((inv) => new Date(inv.expires_at).getTime() > now);
        return remaining.length !== prev.length ? remaining : prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [invites.length]);

  // Realtime subscription para convites recebidos
  useEffect(() => {
    if (!isSupabaseConfigured || !currentUserId || !isAuthenticated) return;

    const subId = Math.random().toString(36).slice(2, 9) + '_' + Date.now();
    const channelName = `invites_user_${currentUserId}_${subId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_invites',
          filter: `receiver_id=eq.${currentUserId}`,
        },
        () => {
          fetchInvites(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, isAuthenticated, fetchInvites]);

  const handleAccept = useCallback(
    async (inviteId: string) => {
      const res = await acceptGameInvite(inviteId);
      if (res.success && res.data) {
        await fetchInvites(true);
        return {
          success: true,
          data: {
            room: {
              id: res.data.room.id,
              code: res.data.room.code,
            },
          },
        };
      }
      return { success: false, error: res.error };
    },
    [fetchInvites]
  );

  const handleDecline = useCallback(
    async (inviteId: string) => {
      const res = await declineGameInvite(inviteId);
      if (res.success) {
        await fetchInvites(true);
        return { success: true };
      }
      return { success: false, error: res.error };
    },
    [fetchInvites]
  );

  return {
    invites,
    activeInvite: invites[0] || null,
    isLoading,
    error,
    refresh: fetchInvites,
    accept: handleAccept,
    decline: handleDecline,
  };
}
