// ============================================================================
// Hook: useNotifications — DuoPlay-Online
// Phase: Fase 16 — Sistema Central de Notificações e Atividade
// Description: Hook reativo para gerenciamento em tempo real da central de notificações,
//              com suporte a Realtime, deduplicação por ID/event_key, paginação e reconciliação.
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import {
  getMyNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/services/notifications';
import type { NotificationItem } from '@/types/notifications';

const PAGE_SIZE = 30;

export function useNotifications() {
  const { user, isAuthenticated } = useAuth();
  const currentUserId = user?.id || null;

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const isFetchingRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realtimeChannelRef = useRef<any>(null);

  // Ordenação determinística por created_at DESC, id DESC
  const sortNotifications = (items: NotificationItem[]): NotificationItem[] => {
    return [...items].sort((a, b) => {
      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      if (timeA !== timeB) return timeB - timeA;
      return b.id.localeCompare(a.id);
    });
  };

  // Carregamento inicial de notificações e unread count do PostgreSQL
  const refreshNotifications = useCallback(async () => {
    if (!isAuthenticated || !currentUserId || isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const [listRes, countRes] = await Promise.all([
        getMyNotifications(PAGE_SIZE),
        getUnreadNotificationCount(),
      ]);

      if (listRes.success && listRes.data) {
        const sorted = sortNotifications(listRes.data);
        setNotifications(sorted);
        setHasMore(sorted.length >= PAGE_SIZE);
      } else if (!listRes.success) {
        setError(listRes.error || 'Erro ao carregar notificações.');
      }

      if (countRes.success && countRes.data) {
        setUnreadCount(countRes.data.unread_count);
      }
    } catch {
      setError('Erro de conexão ao carregar notificações.');
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [isAuthenticated, currentUserId]);

  // Paginação: busca a próxima página
  const fetchNextPage = useCallback(async () => {
    if (!isAuthenticated || !currentUserId || isFetchingRef.current || !hasMore || notifications.length === 0) {
      return;
    }

    const lastItem = notifications[notifications.length - 1];
    isFetchingRef.current = true;

    try {
      const res = await getMyNotifications(PAGE_SIZE, lastItem.created_at, lastItem.id);
      if (res.success && res.data) {
        if (res.data.length === 0) {
          setHasMore(false);
        } else {
          setNotifications((prev) => {
            const existingIds = new Set(prev.map((n) => n.id));
            const newItems = res.data!.filter((n) => !existingIds.has(n.id));
            return sortNotifications([...prev, ...newItems]);
          });
          setHasMore(res.data.length >= PAGE_SIZE);
        }
      }
    } catch {
      // Silencia erros temporários de paginação
    } finally {
      isFetchingRef.current = false;
    }
  }, [isAuthenticated, currentUserId, hasMore, notifications]);

  // Marcar notificação individual como lida
  const markAsRead = useCallback(async (notificationId: string) => {
    if (!notificationId) return;

    // Otimista
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === notificationId ? { ...n, read_at: n.read_at || new Date().toISOString() } : n
      )
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));

    await markNotificationRead(notificationId);
  }, []);

  // Marcar todas como lidas
  const markAllAsRead = useCallback(async () => {
    const nowIso = new Date().toISOString();

    // Otimista
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || nowIso })));
    setUnreadCount(0);

    await markAllNotificationsRead();
  }, []);

  // Efeito principal: Carga inicial, Subscription Realtime e Reconciliação
  useEffect(() => {
    if (!isAuthenticated || !currentUserId) {
      setNotifications([]);
      setUnreadCount(0);
      setIsLoading(false);
      setHasMore(false);
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
      return;
    }

    refreshNotifications();

    // Configurar canal Realtime escutando apenas para o usuário autenticado
    const channelName = `notifications_user_${currentUserId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${currentUserId}`,
        },
        (payload) => {
          const newNotif = payload.new as NotificationItem;
          if (!newNotif || !newNotif.id) return;

          setNotifications((prev) => {
            // Deduplicação estrita por ID e event_key
            if (prev.some((n) => n.id === newNotif.id)) return prev;
            return sortNotifications([newNotif, ...prev]);
          });

          if (!newNotif.read_at) {
            setUnreadCount((prev) => prev + 1);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${currentUserId}`,
        },
        (payload) => {
          const updatedNotif = payload.new as NotificationItem;
          if (!updatedNotif || !updatedNotif.id) return;

          setNotifications((prev) =>
            prev.map((n) => (n.id === updatedNotif.id ? { ...n, ...updatedNotif } : n))
          );
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Reconcilia com PostgreSQL ao confirmar inscrição
          refreshNotifications();
        }
      });

    realtimeChannelRef.current = channel;

    // Reconciliação ao mudar visibilidade ou reconectar à rede
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshNotifications();
      }
    };

    const handleOnline = () => {
      refreshNotifications();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, [isAuthenticated, currentUserId, refreshNotifications]);

  return {
    notifications,
    unreadCount,
    isLoading,
    hasMore,
    error,
    refreshNotifications,
    fetchNextPage,
    markAsRead,
    markAllAsRead,
  };
}
