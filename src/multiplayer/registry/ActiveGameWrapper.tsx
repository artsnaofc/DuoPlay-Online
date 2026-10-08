// ============================================================================
// Component: ActiveGameWrapper — DuoPlay-Online
// Phase: Fase 19 — Infraestrutura para Novos Jogos
// Description: Wrapper universal que resolve e renderiza dinamicamente o jogo ativo
//              com base no snapshot oficial obtido pelo core multiplayer.
// ============================================================================

import React from 'react';
import { RefreshCw, AlertCircle, ArrowLeft } from 'lucide-react';
import { useGameSession } from '@/multiplayer/hooks/useGameSession';
import { getGameDefinition } from './index';

interface ActiveGameWrapperProps {
  matchId: string;
  onLeave: () => void;
  onViewHistory?: () => void;
  onPlayAgain?: (gameId?: string) => void;
  onStartRematch?: (newMatchId: string) => void;
  onViewPlayerProfile?: (userId: string) => void;
}

export const ActiveGameWrapper: React.FC<ActiveGameWrapperProps> = ({
  matchId,
  onLeave,
  onViewHistory,
  onPlayAgain,
  onStartRematch,
  onViewPlayerProfile,
}) => {
  const { snapshot, error, isLoading } = useGameSession(matchId);

  // 1. Render de carregamento genérico da infraestrutura
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 animate-pulse">
          <RefreshCw className="w-6 h-6 animate-spin" />
        </div>
        <div className="text-center space-y-1">
          <h2 className="text-base font-bold text-white">Carregando Partida Oficial</h2>
          <p className="text-xs text-slate-400">Consultando o estado mais recente no servidor...</p>
        </div>
      </div>
    );
  }

  // 2. Render de erro de conexão ou partida inválida
  if (error || !snapshot) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-red-950/60 border border-red-800/80 flex items-center justify-center text-red-400 mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-bold text-white">Partida Indisponível</h2>
          <p className="text-xs text-slate-400">
            {error?.message || 'Não foi possível carregar as informações desta partida no servidor.'}
          </p>
        </div>
        <button
          onClick={onLeave}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar para Home</span>
        </button>
      </div>
    );
  }

  // 3. Resolver definição do jogo e seu componente de renderização no GameRegistry
  const gameDef = getGameDefinition(snapshot.gameId);

  if (!gameDef) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-amber-950/60 border border-amber-800/80 flex items-center justify-center text-amber-400 mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-bold text-white">Jogo Não Registrado</h2>
          <p className="text-xs text-slate-400">
            O jogo com identificador <code className="font-mono text-amber-400">"{snapshot.gameId}"</code> não está cadastrado no Game Registry central da plataforma.
          </p>
        </div>
        <button
          onClick={onLeave}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar para Home</span>
        </button>
      </div>
    );
  }

  if (!gameDef.component) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-indigo-950/60 border border-indigo-800/80 flex items-center justify-center text-indigo-400 mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-bold text-white">{gameDef.title}</h2>
          <p className="text-xs text-slate-400">
            Este jogo está catalogado na plataforma, mas sua interface/módulo visual de renderização ainda não foi ativado para o cliente.
          </p>
        </div>
        <button
          onClick={onLeave}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar para Home</span>
        </button>
      </div>
    );
  }

  // 4. Renderizar dinamicamente a interface oficial do jogo
  const DynamicGameComponent = gameDef.component;

  return (
    <DynamicGameComponent
      matchId={matchId}
      onLeave={onLeave}
      onViewHistory={onViewHistory}
      onPlayAgain={() => onPlayAgain?.(snapshot.gameId)}
      onStartRematch={onStartRematch}
      onViewPlayerProfile={onViewPlayerProfile}
    />
  );
};
