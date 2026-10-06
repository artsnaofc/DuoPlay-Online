// ============================================================================
// Network Engine: Synchronization & Subscription — DuoPlay-Online
// Phase: Fase 5 — Game Snapshot + Network/Sync Engine
// ============================================================================

import type { GameSnapshot, MatchSnapshotListener } from './types';
import { getMatchSnapshot } from './snapshot';

/**
 * Sincroniza o estado local do cliente com a verdade absoluta do PostgreSQL.
 * Se o snapshot do servidor for mais recente, substitui integralmente o snapshot local.
 * PostgreSQL vence sempre.
 */
export async function syncMatch<TState = unknown>(
  matchId: string,
  _currentSnapshot?: GameSnapshot<TState> | null
): Promise<GameSnapshot<TState>> {
  const authoritativeSnapshot = await getMatchSnapshot<TState>(matchId);
  return authoritativeSnapshot;
}

/**
 * Executa a rotina de reconexão de rede após perda de conectividade ou retorno à aba.
 * Dispara sincronização com o PostgreSQL para obter o estado oficial mais recente.
 */
export async function reconnectMatch<TState = unknown>(
  matchId: string,
  currentSnapshot?: GameSnapshot<TState> | null
): Promise<GameSnapshot<TState>> {
  return syncMatch<TState>(matchId, currentSnapshot);
}

/**
 * Contrato universal de assinatura para atualizações de partidas.
 *
 * NOTA ARQUITETURAL (Fase 5):
 * O Supabase Realtime ainda NÃO está conectado nesta fase.
 * Esta função estabelece o contrato formal da arquitetura e retorna a função de cancelamento (unsubscribe).
 * Na fase correspondente, ela se integrará ao canal postgres_changes / broadcast.
 */
export function subscribeToMatch<TState = unknown>(
  matchId: string,
  _listener: MatchSnapshotListener<TState>
): () => void {
  if (!matchId) {
    return () => {};
  }

  // Placeholder arquitetural preparado para Supabase Realtime Channel
  const unsubscribe = () => {
    // Cleanup de canal de streaming em fases futuras
  };

  return unsubscribe;
}
