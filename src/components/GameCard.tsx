import React from 'react';
import { Grid3X3, Activity, Orbit, Users, Clock, Sparkles } from 'lucide-react';
import { PlannedGame } from '@/types/platform';

interface GameCardProps {
  game: PlannedGame;
}

export const GameCard: React.FC<GameCardProps> = ({ game }) => {
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

  const isFirstGame = game.status === 'development';

  return (
    <article
      className={`relative flex flex-col rounded-xl border bg-slate-900/60 p-6 transition-all duration-200 hover:border-slate-700 ${
        isFirstGame
          ? 'border-blue-500/40 shadow-lg shadow-blue-950/20'
          : 'border-slate-800'
      }`}
    >
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
        <span className="flex items-center gap-1 font-mono text-slate-300">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          {game.phaseTarget}
        </span>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-300 leading-relaxed mb-5 grow">
        {game.description}
      </p>

      {/* Planned Feature Highlights */}
      <div className="space-y-1.5 mb-6 text-[11px] text-slate-400">
        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-1">
          Destaques da Integração:
        </span>
        {game.features.map((feature, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500/80 shrink-0" />
            <span className="truncate">{feature}</span>
          </div>
        ))}
      </div>

      {/* Footer / Status Indicator (Not a fake playable button) */}
      <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isFirstGame ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'
            }`}
          />
          <span
            className={`text-xs font-medium ${
              isFirstGame ? 'text-amber-300' : 'text-slate-400'
            }`}
          >
            {game.statusLabel}
          </span>
        </div>

        <span className="text-[11px] text-slate-400 font-mono">
          {isFirstGame ? 'Foco Atual' : 'Extensão Futura'}
        </span>
      </div>
    </article>
  );
};
