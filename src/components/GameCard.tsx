import React from 'react';
import { Grid3X3, Activity, Orbit, Users, Sparkles, Clock } from 'lucide-react';
import { GameItem } from '@/types/platform';

interface GameCardProps {
  game: GameItem;
  onPlay?: (gameId: string) => void;
}

export const GameCard: React.FC<GameCardProps> = ({ game, onPlay }) => {
  const renderIcon = () => {
    switch (game.iconName) {
      case 'grid':
        return <Grid3X3 className="w-6 h-6 text-blue-400" />;
      case 'activity':
        return <Activity className="w-6 h-6 text-purple-400" />;
      case 'worm':
        return <Orbit className="w-6 h-6 text-emerald-400" />;
      default:
        return <Sparkles className="w-6 h-6 text-blue-400" />;
    }
  };

  return (
    <article className="relative flex flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-6 transition-all duration-200 hover:border-slate-700">
      {/* Header of Card */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-slate-800/80 border border-slate-700/60">
            {renderIcon()}
          </div>
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">
              {game.title}
            </h3>
            <p className="text-xs text-slate-400">{game.tagline}</p>
          </div>
        </div>
      </div>

      {/* Metadata Line - Zero-Pill Discipline with Typographic Separators */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mb-4 pb-4 border-b border-slate-800/80">
        <span className="flex items-center gap-1 text-slate-300">
          <Users className="w-3.5 h-3.5 text-slate-400" />
          {game.minPlayers === game.maxPlayers
            ? `${game.minPlayers} jogadores`
            : `${game.minPlayers}-${game.maxPlayers} jogadores`}
        </span>
        <span aria-hidden="true" className="text-slate-600">·</span>
        <span>{game.category}</span>
        <span aria-hidden="true" className="text-slate-600">·</span>
        <span>Multiplayer Online</span>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-300 leading-relaxed mb-5 grow">
        {game.description}
      </p>

      {/* Game Highlights */}
      <div className="space-y-1.5 mb-6 text-[11px] text-slate-400">
        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-1">
          Destaques do Jogo:
        </span>
        {game.highlights.map((highlight, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500/80 shrink-0" />
            <span className="truncate">{highlight}</span>
          </div>
        ))}
      </div>

      {/* Footer / Availability Status */}
      <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between">
        {game.isAvailable ? (
          <>
            <button
              type="button"
              onClick={() => onPlay?.(game.id)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-900/30 transition-all cursor-pointer active:scale-95"
            >
              <span>Jogar Agora</span>
            </button>
            <span className="text-[11px] font-semibold text-emerald-400">
              Disponível Online
            </span>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-medium text-amber-300">
                Disponível em breve
              </span>
            </div>
            <span className="text-[11px] text-slate-500">
              Partidas Online
            </span>
          </>
        )}
      </div>
    </article>
  );
};
