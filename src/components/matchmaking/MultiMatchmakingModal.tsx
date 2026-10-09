// ============================================================================
// Component: MultiMatchmakingModal — DuoPlay-Online
// Phase: Fase 23 — Matchmaking Simultâneo Multijogo na Home
// Description: Modal moderno Mobile-First para seleção múltipla de jogos
//              com checkboxes, ações 'Selecionar todos' / 'Limpar seleção',
//              acompanhamento em tempo real das buscas ativas e cancelamento individual.
// ============================================================================

import React, { useState, useEffect } from 'react';
import {
  Swords,
  X,
  Check,
  RotateCcw,
  Search,
  CheckSquare,
  Square,
  Users,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { listGames, type GameDefinition } from '@/multiplayer/registry/index';
import type { GameQueueState } from '@/hooks/useMultiMatchmaking';

export interface MultiMatchmakingModalProps {
  isOpen: boolean;
  onClose: () => void;
  queues: Record<string, GameQueueState>;
  onStartSearch: (gameIds: string[]) => void;
  onCancelGameSearch: (gameId: string) => void;
  onCancelAllSearches: () => void;
  preSelectedGameId?: string | null;
}

export const MultiMatchmakingModal: React.FC<MultiMatchmakingModalProps> = ({
  isOpen,
  onClose,
  queues,
  onStartSearch,
  onCancelGameSearch,
  onCancelAllSearches,
  preSelectedGameId,
}) => {
  // Lista dinâmica dos jogos disponíveis para matchmaking autoritativo na plataforma
  const availableGames = listGames().filter((g) => g.isAvailable);

  const [selectedGameIds, setSelectedGameIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const normalizeId = (id: string) => id.replace(/-/g, '_');

  // Inicializa a seleção com base em buscas ativas existentes ou no jogo clicado
  useEffect(() => {
    if (isOpen) {
      const activeIds = availableGames
        .filter((g) => {
          const norm = normalizeId(g.id);
          const hyphen = norm.replace(/_/g, '-');
          const q = queues[norm] || queues[hyphen] || queues[g.id];
          return q?.status === 'waiting' || q?.status === 'joining';
        })
        .map((g) => g.id);

      if (activeIds.length > 0) {
        setSelectedGameIds(activeIds);
      } else if (preSelectedGameId) {
        const matchingGame = availableGames.find(
          (g) => normalizeId(g.id) === normalizeId(preSelectedGameId)
        );
        setSelectedGameIds([matchingGame ? matchingGame.id : preSelectedGameId]);
      } else {
        // Se nenhuma busca ativa e nenhum pré-selecionado, seleciona todos os jogos disponíveis
        setSelectedGameIds(availableGames.map((g) => g.id));
      }
    }
  }, [isOpen, preSelectedGameId]);

  if (!isOpen) return null;

  const uniqueActiveQueues = Object.values(queues).filter(
    (q, idx, arr) =>
      (q.status === 'waiting' || q.status === 'joining') &&
      arr.findIndex((other) => normalizeId(other.gameId) === normalizeId(q.gameId)) === idx
  );
  const isSearching = uniqueActiveQueues.length > 0;

  // Erros ativos reportados nas filas
  const errorQueues = Object.values(queues).filter((q) => q.status === 'error' && q.error);
  const latestErrorMessage = errorQueues[0]?.error;

  const toggleGame = (gameId: string) => {
    const norm = normalizeId(gameId);
    setSelectedGameIds((prev) =>
      prev.some((id) => normalizeId(id) === norm)
        ? prev.filter((id) => normalizeId(id) !== norm)
        : [...prev, gameId]
    );
  };

  const handleSelectAll = () => {
    setSelectedGameIds(availableGames.map((g) => g.id));
  };

  const handleClearSelection = () => {
    setSelectedGameIds([]);
  };

  const handleConfirmSearch = async () => {
    if (selectedGameIds.length === 0) return;
    setIsSubmitting(true);
    try {
      await onStartSearch(selectedGameIds);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="multi-matchmaking-title"
    >
      <div className="w-full max-w-lg max-h-[92vh] flex flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl relative overflow-hidden">
        {/* Glow Superior */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 z-10" />

        {/* Header Bar */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <Swords className="w-5 h-5" />
            </div>
            <div>
              <h2 id="multi-matchmaking-title" className="text-base sm:text-lg font-extrabold text-white">
                Encontrar Partida Rápida
              </h2>
              <p className="text-xs text-slate-400">
                {isSearching
                  ? `Buscando em ${uniqueActiveQueues.length} ${uniqueActiveQueues.length === 1 ? 'jogo' : 'jogos'} simultaneamente...`
                  : 'Escolha os jogos que você quer procurar.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Fechar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conteúdo Principal com Scroll Interno */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 grow">
          {/* Banner de Erro caso alguma busca tenha falhado */}
          {latestErrorMessage && !isSearching && (
            <div className="p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-xs text-red-300 flex items-start gap-2.5 animate-fade-in">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold block">Aviso ao iniciar busca:</span>
                <span className="text-red-300/90">{latestErrorMessage}</span>
              </div>
            </div>
          )}

          {/* Barra de Ações Rápidas de Seleção */}
          {!isSearching && (
            <div className="flex items-center justify-between gap-2 pb-1 text-xs">
              <span className="text-slate-400 font-medium">
                {selectedGameIds.length} de {availableGames.length} selecionados
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold transition-colors"
                >
                  Selecionar todos
                </button>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 font-medium transition-colors"
                >
                  Limpar seleção
                </button>
              </div>
            </div>
          )}

          {/* Lista Dinâmica de Jogos */}
          <div className="space-y-2.5">
            {availableGames.map((game) => {
              const normId = normalizeId(game.id);
              const hyphenId = normId.replace(/_/g, '-');
              const isSelected = selectedGameIds.some((id) => normalizeId(id) === normId);
              const queueState = queues[normId] || queues[hyphenId] || queues[game.id];
              const isGameSearching = queueState?.status === 'waiting' || queueState?.status === 'joining';
              const hasGameError = queueState?.status === 'error';

              return (
                <div
                  key={game.id}
                  onClick={() => {
                    if (!isSearching) {
                      toggleGame(game.id);
                    }
                  }}
                  className={`flex items-center gap-3.5 p-3 rounded-xl border transition-all select-none ${
                    isGameSearching
                      ? 'bg-blue-950/40 border-blue-500/50 shadow-md shadow-blue-950/30'
                      : hasGameError
                      ? 'bg-red-950/30 border-red-800/60 shadow-sm cursor-pointer'
                      : isSelected
                      ? 'bg-slate-800/90 border-blue-500/40 shadow-sm cursor-pointer'
                      : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700 cursor-pointer opacity-70 hover:opacity-100'
                  }`}
                >
                  {/* Checkbox / Toggle Visual */}
                  {!isSearching && (
                    <div className="shrink-0 text-blue-400">
                      {isSelected ? (
                        <div className="w-5 h-5 rounded-md bg-blue-600 flex items-center justify-center text-white">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded-md border border-slate-600 bg-slate-800" />
                      )}
                    </div>
                  )}

                  {/* Thumbnail do Jogo */}
                  {game.coverImage ? (
                    <img
                      src={game.coverImage}
                      alt={game.title}
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-lg object-cover object-center shrink-0 border border-slate-700/60"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 shrink-0">
                      <Swords className="w-6 h-6" />
                    </div>
                  )}

                  {/* Detalhes do Jogo */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-white truncate">{game.title}</h3>
                      <span className="text-[10px] text-slate-400 flex items-center gap-1 shrink-0 font-medium">
                        <Users className="w-3 h-3 text-slate-500" />
                        {game.minPlayers === game.maxPlayers ? `${game.minPlayers}p` : `${game.minPlayers}-${game.maxPlayers}p`}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 truncate leading-snug">
                      {game.tagline || game.description}
                    </p>

                    {/* Status em tempo real quando está procurando */}
                    {isGameSearching && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-blue-400 font-semibold">
                        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                        <span>Procurando oponente...</span>
                      </div>
                    )}

                    {/* Status de erro no card */}
                    {hasGameError && queueState?.error && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-red-400 font-medium">
                        <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                        <span className="truncate">{queueState.error}</span>
                      </div>
                    )}
                  </div>

                  {/* Ação de Cancelamento Individual durante a busca */}
                  {isGameSearching && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCancelGameSearch(normId);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/60 border border-red-800/70 text-red-300 text-xs font-bold transition-colors shrink-0 active:scale-95"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Dica de Funcionamento */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-400 flex items-start gap-2.5">
            <Search className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <span>
              O sistema busca adversários em todos os jogos selecionados ao mesmo tempo. O primeiro jogo a encontrar uma partida vence, e as outras buscas são canceladas automaticamente!
            </span>
          </div>
        </div>

        {/* Footer com Botões de Ação */}
        <div className="p-4 sm:p-5 border-t border-slate-800 bg-slate-950/50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
          {isSearching ? (
            <>
              <button
                type="button"
                onClick={onCancelAllSearches}
                className="py-2.5 px-4 rounded-xl bg-red-950/70 hover:bg-red-900 border border-red-800 text-red-200 font-bold text-xs transition-colors flex items-center justify-center gap-2 active:scale-95"
              >
                <X className="w-4 h-4" />
                <span>Cancelar todas as buscas</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="py-2.5 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition-colors flex items-center justify-center gap-2"
              >
                <span>Buscar em segundo plano</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleConfirmSearch}
                disabled={selectedGameIds.length === 0 || isSubmitting}
                className="py-3 px-6 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-xs sm:text-sm shadow-xl shadow-blue-950/50 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Swords className="w-4 h-4" />
                )}
                <span>
                  Procurar partida ({selectedGameIds.length})
                </span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
