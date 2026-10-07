// ============================================================================
// Component: MatchHistoryModal — DuoPlay-Online
// Phase: Fase 8.1 — Implementação do Resultado da Partida + Histórico
// Description: Visualização paginada e detalhada do histórico de partidas
//              finalizadas do usuário autenticado consumindo get_my_match_history RPC.
// ============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  History,
  Trophy,
  ShieldAlert,
  HelpCircle,
  Clock,
  RefreshCw,
  AlertCircle,
  Gamepad2,
  ChevronRight,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Flag,
} from 'lucide-react';
import {
  getMyMatchHistory,
  type MatchHistoryItem,
} from '@/services/matchHistory';
import { useAuth } from '@/hooks/useAuth';

export interface MatchHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPlayGame?: () => void;
  onViewUserProfile?: (userId: string) => void;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export const MatchHistoryModal: React.FC<MatchHistoryModalProps> = ({
  isOpen,
  onClose,
  onPlayGame,
  onViewUserProfile,
}) => {
  const { isAuthenticated } = useAuth();

  const [matches, setMatches] = useState<MatchHistoryItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [currentOffset, setCurrentOffset] = useState(0);

  const PAGE_SIZE = 20;

  // Carregamento inicial do histórico
  const loadInitialHistory = useCallback(async () => {
    if (!isAuthenticated) return;

    setIsLoading(true);
    setError(null);
    try {
      const res = await getMyMatchHistory(PAGE_SIZE, 0);
      if (res.success && res.data) {
        setMatches(res.data.matches);
        setTotalCount(res.data.total_count);
        setHasMore(res.data.has_more);
        setCurrentOffset(res.data.matches.length);
      } else {
        setError(res.error || 'Não foi possível carregar seu histórico de partidas.');
      }
    } catch {
      setError('Erro de conexão ao buscar histórico. Verifique sua rede.');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  // Carregamento de páginas adicionais (paginação por offset)
  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    try {
      const res = await getMyMatchHistory(PAGE_SIZE, currentOffset);
      if (res.success && res.data) {
        setMatches((prev) => {
          const existingIds = new Set(prev.map((m) => m.match_id));
          const newItems = res.data!.matches.filter((m) => !existingIds.has(m.match_id));
          return [...prev, ...newItems];
        });
        setTotalCount(res.data.total_count);
        setHasMore(res.data.has_more);
        setCurrentOffset((prev) => prev + res.data!.matches.length);
      } else {
        setError(res.error || 'Erro ao carregar mais partidas.');
      }
    } catch {
      setError('Erro ao carregar mais partidas.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadInitialHistory();
    }
  }, [isOpen, loadInitialHistory]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-modal-title"
    >
      <div className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h2 id="history-modal-title" className="text-sm sm:text-base font-bold text-white">
                Histórico de Partidas
              </h2>
              <p className="text-[11px] text-slate-400">
                {totalCount > 0
                  ? `${totalCount} ${totalCount === 1 ? 'partida registrada' : 'partidas registradas'}`
                  : 'Suas disputas na plataforma'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
            aria-label="Fechar histórico"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content / Scrollable Area */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3 grow">
          {/* Loading State Skeleton */}
          {isLoading && (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 animate-pulse space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-28 h-4 bg-slate-800 rounded" />
                    <div className="w-20 h-4 bg-slate-800 rounded" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="w-36 h-3 bg-slate-800/60 rounded" />
                    <div className="w-16 h-3 bg-slate-800/60 rounded" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error State */}
          {!isLoading && error && (
            <div className="p-6 rounded-xl bg-red-950/40 border border-red-900/60 text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-red-900/50 text-red-300 flex items-center justify-center mx-auto">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-red-200">Não foi possível carregar seu histórico</h3>
                <p className="text-xs text-red-300/80">{error}</p>
              </div>
              <button
                type="button"
                onClick={loadInitialHistory}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-900/80 hover:bg-red-800 text-white text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-red-400"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Tentar novamente</span>
              </button>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !error && matches.length === 0 && (
            <div className="py-12 px-4 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center text-slate-400 mx-auto">
                <Gamepad2 className="w-7 h-7" />
              </div>
              <div className="space-y-1 max-w-xs mx-auto">
                <h3 className="text-sm sm:text-base font-bold text-white">
                  Você ainda não jogou nenhuma partida.
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Crie ou entre em uma sala com amigos para registrar seus primeiros confrontos.
                </p>
              </div>
              {onPlayGame && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onPlayGame();
                    }}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-900/30 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
                  >
                    <span>Jogar Agora</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Match Items List */}
          {!isLoading && !error && matches.length > 0 && (
            <div className="space-y-2.5">
              {matches.map((item) => {
                const isWin = item.outcome === 'win';
                const isLoss = item.outcome === 'loss';
                const isDraw = item.outcome === 'draw';
                const isCancelled = item.outcome === 'cancelled';

                const opponent = item.opponents?.[0];
                const opponentName = opponent
                  ? opponent.display_name || opponent.username || `Jogador (Slot ${opponent.slot})`
                  : 'Adversário';

                // Descrição amigável do motivo
                let reasonText = 'Partida normal';
                if (isDraw) {
                  reasonText = 'Empate técnico';
                } else if (item.finish_reason === 'abandonment') {
                  reasonText = isWin ? 'Vitória por W.O.' : 'Derrota por W.O.';
                } else if (item.finish_reason === 'resignation') {
                  reasonText = isWin ? 'Vitória por abandono' : 'Você abandonou';
                } else if (item.finish_reason === 'normal') {
                  reasonText = isWin ? 'Vitória normal' : 'Adversário venceu';
                } else if (isCancelled) {
                  reasonText = 'Partida cancelada';
                }

                return (
                  <div
                    key={item.match_id}
                    className={`p-3.5 sm:p-4 rounded-xl border transition-all ${
                      isWin
                        ? 'bg-slate-950/60 border-emerald-900/40 hover:border-emerald-700/60'
                        : isLoss
                        ? 'bg-slate-950/60 border-red-950/60 hover:border-red-800/60'
                        : isDraw
                        ? 'bg-slate-950/60 border-amber-950/60 hover:border-amber-800/60'
                        : 'bg-slate-950/40 border-slate-800'
                    }`}
                  >
                    {/* Top row: Game Name & Outcome */}
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">
                          {item.game_name || 'Jogo da Velha'}
                        </span>
                        <span className="text-xs text-slate-400">
                          vs{' '}
                          {item.opponents?.[0]?.user_id && onViewUserProfile ? (
                            <button
                              type="button"
                              onClick={() => onViewUserProfile(item.opponents![0].user_id)}
                              className="font-bold text-blue-400 hover:text-blue-300 hover:underline transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 rounded"
                              title="Ver perfil do adversário"
                            >
                              {opponentName}
                            </button>
                          ) : (
                            <strong className="text-slate-200">{opponentName}</strong>
                          )}
                        </span>
                      </div>

                      {/* Outcome Badge */}
                      <div className="flex items-center gap-1.5 text-xs font-semibold shrink-0">
                        {isWin && (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Vitória</span>
                          </span>
                        )}
                        {isLoss && (
                          <span className="inline-flex items-center gap-1 text-red-400">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Derrota</span>
                          </span>
                        )}
                        {isDraw && (
                          <span className="inline-flex items-center gap-1 text-amber-400">
                            <MinusCircle className="w-3.5 h-3.5" />
                            <span>Empate</span>
                          </span>
                        )}
                        {isCancelled && (
                          <span className="inline-flex items-center gap-1 text-slate-400">
                            <Flag className="w-3.5 h-3.5" />
                            <span>Cancelada</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Bottom row: Reason & Timestamp & Duration */}
                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
                      <span className="text-slate-300 font-medium">{reasonText}</span>
                      <div className="flex items-center gap-2 text-slate-400 font-mono">
                        <span>{formatDate(item.started_at)}</span>
                        {item.duration_seconds > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-500" />
                              {formatDuration(item.duration_seconds)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Load More Button */}
              {hasMore && (
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                    className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-blue-400"
                  >
                    {isLoadingMore ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
                        <span>Carregando mais partidas...</span>
                      </>
                    ) : (
                      <span>Carregar mais</span>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/40 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-slate-400"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
