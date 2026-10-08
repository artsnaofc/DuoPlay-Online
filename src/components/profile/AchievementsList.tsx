// ============================================================================
// Component: AchievementsList — DuoPlay-Online
// Phase: Fase 18 — Conquistas e Badges
// Description: Lista responsiva de conquistas e badges do jogador com progresso,
//              categoria, suporte a ícones dinâmicos do Lucide-React e filtragem.
// ============================================================================

import React, { useState } from 'react';
import {
  Trophy,
  Gamepad,
  Award,
  Zap,
  Swords,
  Crown,
  Grid,
  Lock,
  CheckCircle2,
  Medal,
  Star,
  Target,
} from 'lucide-react';
import { useAchievements } from '@/hooks/useAchievements';

// Mapeamento dinâmico de strings para Componentes Lucide
const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Trophy,
  Gamepad,
  Award,
  Zap,
  Swords,
  Crown,
  Grid,
};

export interface AchievementsListProps {
  userId: string;
  showOnlyUnlocked?: boolean;
}

export const AchievementsList: React.FC<AchievementsListProps> = ({
  userId,
  showOnlyUnlocked = false,
}) => {
  const { achievements, isLoading, error } = useAchievements(userId);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  if (isLoading) {
    return (
      <div className="py-6 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
        <svg className="animate-spin h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span>Carregando conquistas...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/40 text-center text-xs text-red-300">
        {error}
      </div>
    );
  }

  const filteredAchievements = achievements.filter((ach) => {
    // Se deve mostrar apenas desbloqueados
    if (showOnlyUnlocked && !ach.unlocked) return false;
    // Filtro por categoria
    if (activeCategory !== 'all' && ach.category !== activeCategory) return false;
    return true;
  });

  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const totalCount = achievements.length;

  return (
    <div className="space-y-4">
      {/* Resumo & Progresso Geral */}
      {!showOnlyUnlocked && totalCount > 0 && (
        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs">
          <div>
            <p className="font-bold text-white flex items-center gap-1.5">
              <Medal className="w-4 h-4 text-amber-400" />
              <span>Sua Coleção de Badges</span>
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Desbloqueie conquistas oficiais jogando e vencendo partidas!
            </p>
          </div>
          <div className="text-right">
            <span className="text-base font-black text-amber-400 font-mono tabular-nums">
              {unlockedCount}
            </span>
            <span className="text-slate-500 font-bold font-mono">/{totalCount}</span>
            <p className="text-[9px] uppercase tracking-widest font-extrabold text-slate-500">concluídas</p>
          </div>
        </div>
      )}

      {/* Categorias - Filtro */}
      {!showOnlyUnlocked && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar Conquistas">
          {[
            { id: 'all', label: 'Todas', icon: Star },
            { id: 'general', label: 'Gerais', icon: Medal },
            { id: 'matches_played', label: 'Partidas', icon: Gamepad },
            { id: 'win_streak', label: 'Sequências', icon: Zap },
            { id: 'game_specific', label: 'Por Jogo', icon: Grid },
          ].map((cat) => {
            const Icon = cat.icon;
            const isSelected = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                role="tab"
                aria-selected={isSelected}
                onClick={() => setActiveCategory(cat.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all focus:outline-none ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20'
                    : 'bg-slate-950/40 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800/80'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Grade de Conquistas */}
      {filteredAchievements.length === 0 ? (
        <div className="p-6 rounded-xl bg-slate-950/40 border border-slate-800/60 text-center text-xs text-slate-400">
          {showOnlyUnlocked 
            ? 'Nenhuma conquista desbloqueada por este jogador ainda.'
            : 'Nenhuma conquista encontrada nesta categoria.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 max-h-[300px] overflow-y-auto pr-1">
          {filteredAchievements.map((ach) => {
            const IconComponent = ICON_MAP[ach.iconBadge] || Medal;
            const isUnlocked = ach.unlocked;
            const progressPct = ach.conditionValue > 0 
              ? Math.min(100, Math.round((ach.progress / ach.conditionValue) * 100))
              : 0;

            return (
              <div
                key={ach.achievementId}
                className={`flex gap-3.5 p-3 rounded-xl border transition-all ${
                  isUnlocked
                    ? 'bg-slate-950/80 border-indigo-500/25 shadow-sm shadow-indigo-950/10'
                    : 'bg-slate-950/30 border-slate-800/80 grayscale opacity-65'
                }`}
              >
                {/* Badge Icon Slot */}
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border relative ${
                  isUnlocked
                    ? 'bg-gradient-to-br from-indigo-950/60 to-purple-950/40 border-indigo-500/30 text-amber-300'
                    : 'bg-slate-900/60 border-slate-800/60 text-slate-500'
                }`}>
                  <IconComponent className="w-5.5 h-5.5" />
                  {!isUnlocked && (
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-slate-850 rounded-full border border-slate-800 flex items-center justify-center">
                      <Lock className="w-2.5 h-2.5 text-slate-500" />
                    </div>
                  )}
                  {isUnlocked && (
                    <div className="absolute -bottom-1 -right-1 w-4.5 h-4.5 bg-emerald-500 rounded-full flex items-center justify-center text-[8px] text-slate-950 font-black shadow-sm">
                      ✓
                    </div>
                  )}
                </div>

                {/* Info & Progress */}
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h4 className={`text-xs font-black truncate ${isUnlocked ? 'text-white' : 'text-slate-400'}`}>
                        {ach.name}
                      </h4>
                      {isUnlocked && ach.unlockedAt && (
                        <span className="text-[9px] text-indigo-400 font-semibold font-mono">
                          {new Date(ach.unlockedAt).toLocaleDateString('pt-BR')}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5">
                      {ach.description}
                    </p>
                  </div>

                  {/* Progress bar (not shown for simple 1/1 general achievements if already completed, but nice for numerical ones) */}
                  {!isUnlocked && ach.conditionValue > 1 && (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between text-[9px] text-slate-500 font-bold">
                        <span>Progresso</span>
                        <span className="font-mono tabular-nums">{ach.progress}/{ach.conditionValue} ({progressPct}%)</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-800/50">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
