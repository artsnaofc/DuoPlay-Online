// ============================================================================
// React Hook: usePresenceHeartbeat — DuoPlay-Online
// Phase: Fase 14.2 — Sincronização de Status Online com Lease de Presença & Heartbeat
// Description: Mantém a presença global do usuário ativa enviando ticks periódicos
//              ao Supabase enquanto a aba/app estiver aberta e o usuário autenticado.
// ============================================================================

import { useEffect, useRef } from 'react';
import { useAuth } from './useAuth';
import { sendPresenceHeartbeat } from '@/services/presence';

const HEARTBEAT_INTERVAL_MS = 10_000; // 10 segundos (Lease TTL no backend é de 25s)

export function usePresenceHeartbeat(): void {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const currentUserId = user?.id || null;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || !currentUserId) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Disparo imediato ao autenticar ou restaurar sessão
    sendPresenceHeartbeat().catch(() => {});

    // Configuração do intervalo de heartbeat periódico
    timerRef.current = setInterval(() => {
      // Se a aba estiver visível e conectada, envia o tick
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        sendPresenceHeartbeat().catch(() => {});
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Ouvintes para eventos do navegador (foco, visibilidade, restauração de rede)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sendPresenceHeartbeat().catch(() => {});
      }
    };

    const handleWindowFocus = () => {
      sendPresenceHeartbeat().catch(() => {});
    };

    const handleOnline = () => {
      sendPresenceHeartbeat().catch(() => {});
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('online', handleOnline);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, [currentUserId, isAuthenticated, isAuthLoading]);
}
