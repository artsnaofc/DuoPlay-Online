// ============================================================================
// React Hook: useSocial — DuoPlay-Online
// Phase: Fase 14 — Sistema Social: Amigos e Jogadores
// Description: Hook reativo para consumo do estado de amigos, solicitações
//              e presença com sincronização Supabase Realtime e limpeza em logout/unmount.
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import {
  getMyFriends,
  getReceivedFriendRequests,
  getSentFriendRequests,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  removeFriend,
  clearSocialCache,
} from '@/services/social';
import type { Friend, FriendRequest } from '@/types/social';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface UseSocialReturn {
  friends: Friend[];
  receivedRequests: FriendRequest[];
  sentRequests: FriendRequest[];
  pendingCount: number;
  isLoading: boolean;
  error: string | null;
  refresh: (force?: boolean) => Promise<void>;
  sendRequest: (recipientId: string) => Promise<{ success: boolean; error?: string }>;
  acceptRequest: (requestId: string) => Promise<{ success: boolean; error?: string }>;
  declineRequest: (requestId: string) => Promise<{ success: boolean; error?: string }>;
  cancelRequest: (requestId: string) => Promise<{ success: boolean; error?: string }>;
  removeFriendship: (friendId: string) => Promise<{ success: boolean; error?: string }>;
}

export function useSocial(): UseSocialReturn {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const currentUserId = user?.id || null;

  const [friends, setFriends] = useState<Friend[]>([]);
  const [receivedRequests, setReceivedRequests] = useState<FriendRequest[]>([]);
  const [sentRequests, setSentRequests] = useState<FriendRequest[]>([]);
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

  const fetchSocialState = useCallback(async (force = false) => {
    // Se a autenticação ainda estiver sendo resolvida, aguarda
    if (isAuthLoading) {
      return;
    }

    if (!currentUserId || !isAuthenticated) {
      if (isMountedRef.current) {
        setFriends([]);
        setReceivedRequests([]);
        setSentRequests([]);
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
      const [friendsRes, receivedRes, sentRes] = await Promise.all([
        getMyFriends(force),
        getReceivedFriendRequests(force),
        getSentFriendRequests(force),
      ]);

      if (!isMountedRef.current) return;

      if (friendsRes.success && friendsRes.data) {
        setFriends(friendsRes.data);
      }
      if (receivedRes.success && receivedRes.data) {
        setReceivedRequests(receivedRes.data);
      }
      if (sentRes.success && sentRes.data) {
        setSentRequests(sentRes.data);
      }

      if (!friendsRes.success || !receivedRes.success || !sentRes.success) {
        const firstErr = friendsRes.error || receivedRes.error || sentRes.error;
        setError(firstErr || 'Erro ao sincronizar informações sociais.');
      } else {
        setError(null);
      }
    } catch {
      if (isMountedRef.current) {
        setError('Erro de conexão ao atualizar informações de amigos.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [currentUserId, isAuthenticated, isAuthLoading]);

  // Limpeza e recarregamento estrito ao trocar de usuário ou deslogar
  useEffect(() => {
    if (isAuthLoading) return;

    if (currentUserId !== lastUserIdRef.current) {
      lastUserIdRef.current = currentUserId;
      clearSocialCache();
      if (!currentUserId || !isAuthenticated) {
        setFriends([]);
        setReceivedRequests([]);
        setSentRequests([]);
        setError(null);
      } else {
        fetchSocialState(true);
      }
    }
  }, [currentUserId, isAuthenticated, isAuthLoading, fetchSocialState]);

  // Inscrição Realtime única por usuário para receber novas solicitações e atualizações
  useEffect(() => {
    if (!isSupabaseConfigured || !currentUserId || !isAuthenticated) return;

    const subId = Math.random().toString(36).slice(2, 9) + '_' + Date.now();
    const channelName = `social_user_${currentUserId}_${subId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'friend_requests',
          filter: `recipient_id=eq.${currentUserId}`,
        },
        () => {
          fetchSocialState(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'friend_requests',
          filter: `requester_id=eq.${currentUserId}`,
        },
        () => {
          fetchSocialState(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'friendships',
        },
        () => {
          fetchSocialState(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_presence',
        },
        () => {
          fetchSocialState(true);
        }
      )
      .subscribe();

    // Sincronização periódica da lista e TTL de presença (a cada 15 segundos)
    const presenceInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchSocialState(true);
      }
    }, 15_000);

    return () => {
      clearInterval(presenceInterval);
      supabase.removeChannel(channel);
    };
  }, [currentUserId, isAuthenticated, fetchSocialState]);

  // Ações de mutação
  const handleSendRequest = useCallback(
    async (recipientId: string) => {
      const res = await sendFriendRequest(recipientId);
      if (res.success) {
        await fetchSocialState(true);
        return { success: true };
      }
      return { success: false, error: res.error };
    },
    [fetchSocialState]
  );

  const handleAcceptRequest = useCallback(
    async (requestId: string) => {
      const res = await acceptFriendRequest(requestId);
      if (res.success) {
        await fetchSocialState(true);
        return { success: true };
      }
      return { success: false, error: res.error };
    },
    [fetchSocialState]
  );

  const handleDeclineRequest = useCallback(
    async (requestId: string) => {
      const res = await declineFriendRequest(requestId);
      if (res.success) {
        await fetchSocialState(true);
        return { success: true };
      }
      return { success: false, error: res.error };
    },
    [fetchSocialState]
  );

  const handleCancelRequest = useCallback(
    async (requestId: string) => {
      const res = await cancelFriendRequest(requestId);
      if (res.success) {
        await fetchSocialState(true);
        return { success: true };
      }
      return { success: false, error: res.error };
    },
    [fetchSocialState]
  );

  const handleRemoveFriend = useCallback(
    async (friendId: string) => {
      const res = await removeFriend(friendId);
      if (res.success) {
        await fetchSocialState(true);
        return { success: true };
      }
      return { success: false, error: res.error };
    },
    [fetchSocialState]
  );

  return {
    friends,
    receivedRequests,
    sentRequests,
    pendingCount: receivedRequests.length,
    isLoading,
    error,
    refresh: fetchSocialState,
    sendRequest: handleSendRequest,
    acceptRequest: handleAcceptRequest,
    declineRequest: handleDeclineRequest,
    cancelRequest: handleCancelRequest,
    removeFriendship: handleRemoveFriend,
  };
}
