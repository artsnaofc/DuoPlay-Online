// ============================================================================
// Component: GameCard — DuoPlay-Online
// Phase: Fase 10.4 — Card de Jogo para Lobby de Plataforma
// Description: Card visual de jogo com suporte a artwork de destaque,
//              botão primário autoritativo "Encontrar partida" e secundário "Criar sala".
// ============================================================================

import React from 'react';
import { Grid3X3, Activity, Orbit, Users, Sparkles, Clock, Swords, KeyRound } from 'lucide-react';
import { GameItem } from '@/types/platform';

interface GameCardProps {
  game: GameItem;
  imageSrc?: string;
  onMatchmaking?: (gameId: string) => void;
  onCreateRoom?: (gameId: string) => void;
}

export const GameCard: React.FC<GameCardProps> = ({
  game,
  imageSrc,
  onMatchmaking,
  onCreateRoom,
}) => {
  const renderIcon = () => {
    switch (game.iconName) {
      case 'grid':
        return <Grid3X3 className="w-5 h-5 text-blue-400" />;
      case 'activity':
        return <Activity className="w-5 h-5 text-purple-400" />;
      case 'worm':
        return <Orbit className="w-5 h-5 text-emerald-400" />;
      default:
        return <Sparkles className="w-5 h-5 text-blue-400" />;
    }
  };

  return (
    <article className="group relative flex flex-col rounded-2xl border border-slate-800/90 bg-slate-900/80 p-5 sm:p-6 transition-all duration-300 hover:border-slate-700 hover:shadow-2xl hover:shadow-blue-950/20 overflow-hidden">
      {/* Visual Artwork Banner (Se fornecido) */}
      {imageSrc ? (

<div className="relative isolate mb-5 h-44 w-full shrink-0 overflow-hidden rounded-xl border border-slate-700/70 bg-slate-950 shadow-lg shadow-black/20 sm:h-48">
  {/* Imagem de capa */}
  <img
    src={imageSrc}
    alt={`Capa do jogo ${game.title}`}
    loading="lazy"
    decoding="async"
    referrerPolicy="no-referrer"
    className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-500 ease-out motion-safe:group-hover:scale-105"
    draggable={false}
  />

  {/* Camada de contraste para legibilidade */}
  <div
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/10 to-slate-950/10"
  />

  {/* Leve vinheta nas bordas */}
  <div
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/5"
  />

  {/* Indicador de disponibilidade */}
  <div className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-slate-950/85 px-2.5 py-1 text-[11px] font-bold tracking-wide text-emerald-300 shadow-lg shadow-black/20 backdrop-blur-md">
    <span
      aria-hidden="true"
      className="relative flex h-2 w-2"
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60 motion-reduce:animate-none" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
    </span>
    <span>Disponível</span>
  </div>
</div>

      ) : null}

      {/* Header of Card */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-slate-800/90 border border-slate-700/70 text-white shrink-0 shadow-inner">
            {renderIcon()}
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
              {game.title}
            </h3>
            <p className="text-xs text-slate-400 leading-snug">{game.tagline}</p>
          </div>
        </div>
      </div>

      {/* Metadata Line - Zero-Pill Discipline with Typographic Separators */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mb-3.5 pb-3.5 border-b border-slate-800/80">
        <span className="flex items-center gap-1.5 text-slate-300 font-medium">
          <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          {game.minPlayers === game.maxPlayers
            ? `${game.minPlayers} jogadores`
            : `${game.minPlayers}-${game.maxPlayers} jogadores`}
        </span>
        <span aria-hidden="true" className="text-slate-600">·</span>
        <span>{game.category}</span>
        <span aria-hidden="true" className="text-slate-600">·</span>
        <span className="text-blue-400 font-semibold">Multiplayer Realtime</span>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-300 leading-relaxed mb-5 grow">
        {game.description}
      </p>

      {/* Action Buttons & Status */}
      <div className="pt-2 border-t border-slate-800/80">
        {game.isAvailable ? (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <button
              type="button"
              onClick={() => onMatchmaking?.(game.id)}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-extrabold text-xs shadow-md shadow-blue-950/40 transition-all flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-blue-400 active:scale-95"
            >
              <Swords className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">Encontrar partida</span>
            </button>

            {onCreateRoom && (
              <button
                type="button"
                onClick={() => onCreateRoom(game.id)}
                className="py-2.5 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 focus-visible:outline-2 focus-visible:outline-slate-400 active:scale-95"
                title="Criar sala com código privado"
              >
                <KeyRound className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="whitespace-nowrap">Criar sala</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-slate-950/60 border border-slate-800/60 text-xs">
            <div className="flex items-center gap-2 text-amber-300 font-semibold">
              <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Em breve na plataforma</span>
            </div>
            <span className="text-[11px] text-slate-500">Desenvolvimento</span>
          </div>
        )}
      </div>
    </article>
  );
};
