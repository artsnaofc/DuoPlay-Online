// ============================================================================
// Component: SelectGameForRoomModal — DuoPlay-Online
// Phase: Fase 23 — Criação de Sala Privada com Escolha de Jogo
// Description: Modal moderno Mobile-First para selecionar um jogo
//              do Game Registry antes de abrir o lobby privado com código.
// ============================================================================

import React, { useState } from 'react';
import { KeyRound, X, ArrowRight, Users, Check } from 'lucide-react';
import { listGames, type GameDefinition } from '@/multiplayer/registry/index';

export interface SelectGameForRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectGame: (gameId: string) => void;
}

export const SelectGameForRoomModal: React.FC<SelectGameForRoomModalProps> = ({
  isOpen,
  onClose,
  onSelectGame,
}) => {
  // Jogadores podem criar salas privadas para qualquer jogo disponível na plataforma
  const availableGames = listGames().filter((g) => g.isAvailable);
  const [selectedGameId, setSelectedGameId] = useState<string>(
    availableGames[0]?.id || 'tic_tac_toe'
  );

  if (!isOpen) return null;

  const handleContinue = () => {
    if (!selectedGameId) return;
    onSelectGame(selectedGameId);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="select-game-room-title"
    >
      <div className="w-full max-w-md max-h-[90vh] flex flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl relative overflow-hidden">
        {/* Glow Superior */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500 z-10" />

        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 id="select-game-room-title" className="text-base sm:text-lg font-extrabold text-white">
                Criar Sala Privada
              </h2>
              <p className="text-xs text-slate-400">Escolha o jogo para a sua sala com amigos.</p>
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

        {/* Lista de Jogos com Seleção Única */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-2.5 grow">
          {availableGames.map((game) => {
            const isSelected = selectedGameId === game.id;

            return (
              <div
                key={game.id}
                onClick={() => setSelectedGameId(game.id)}
                className={`flex items-center gap-3.5 p-3 rounded-xl border transition-all cursor-pointer select-none ${
                  isSelected
                    ? 'bg-amber-950/30 border-amber-500/60 shadow-md shadow-amber-950/30'
                    : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700 opacity-80 hover:opacity-100'
                }`}
              >
                {/* Indicador de Seleção Única (Radio) */}
                <div className="shrink-0">
                  <div
                    className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                      isSelected
                        ? 'border-amber-400 bg-amber-500 text-slate-950 font-bold'
                        : 'border-slate-600 bg-slate-800'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>
                </div>

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
                    <KeyRound className="w-6 h-6" />
                  </div>
                )}

                {/* Detalhes */}
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
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleContinue}
            disabled={!selectedGameId}
            className="py-3 px-6 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs sm:text-sm shadow-xl shadow-amber-950/50 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
          >
            <span>Continuar</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
