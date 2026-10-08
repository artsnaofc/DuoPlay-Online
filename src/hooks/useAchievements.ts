// ============================================================================
// Hook: useAchievements — DuoPlay-Online
// Phase: Fase 18 — Conquistas e Badges
// Description: Hook reativo para listar conquistas, consultar progresso e atualizar
//              em tempo real quando novas conquistas forem desbloqueadas pelo backend.
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { fetchUserAchievements, type Achievement } from '@/services/achievements';

export function useAchievements(userId?: string | null) {
  const { user, isAuthenticated } = useAuth();
  const targetUserId = userId || user?.id || null;

  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const isFetchingRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realtimeChannelRef = useRef<any>(null);

  const loadAchievements = useCallback(async () => {
    if (!isAuthenticated || !targetUserId || isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetchUserAchievements(targetUserId);
      if (res.success && res.data) {
        setAchievements(res.data);
      } else {
        setError(res.error || 'Erro ao carregar conquistas.');
      }
    } catch {
      setError('Erro de rede ao carregar conquistas.');
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [isAuthenticated, targetUserId]);

  useEffect(() => {
    if (!isAuthenticated || !targetUserId) {
      setAchievements([]);
      setIsLoading(false);
      setError(null);
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
      return;
    }

    loadAchievements();

    // Configurar canal Realtime escutando novas conquistas do usuário
    const channelName = `achievements_user_${targetUserId}`;
    const channel = supabase
      .channel(channelName)
      .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'user_achievements',
            filter: `user_id=eq.${targetUserId}`,
          },
          () => {
            // Recarrega as conquistas quando uma nova for inserida pelo backend
            loadAchievements();
          }
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    // Recarregar quando a janela voltar a ficar ativa
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadAchievements();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, [isAuthenticated, targetUserId, loadAchievements]);

  return {
    achievements,
    isLoading,
    error,
    refreshAchievements: loadAchievements,
  };
}
