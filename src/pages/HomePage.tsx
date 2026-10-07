// ============================================================================
// Component: HomePage — DuoPlay-Online
// Phase: Fase 10.4 — Redesign da Home para Lobby de Plataforma de Jogos
// Description: Interface em estilo de lobby multiplayer com cards interativos,
//              atalhos de matchmaking público, salas privadas e recuperação de partida.
// ============================================================================

import React, { useState } from 'react';
import {
  Swords,
  Users,
  Zap,
  ShieldCheck,
  Smartphone,
  KeyRound,
  History,
  Sparkles,
  Play,
  User,
} from 'lucide-react';
import { GameCard } from '@/components/GameCard';
import { GameItem, PlatformFeature } from '@/types/platform';
import { useAuth } from '@/hooks/useAuth';
import { AuthModal } from '@/components/auth/AuthModal';
import { PlayerAvatar } from '@/components/profile/PlayerAvatar';
import ticTacToeArtwork from '@/assets/images/tic_tac_toe_artwork_1791338972542.jpg';

const GAMES: GameItem[] = [
  {
    id: 'tic-tac-toe',
    title: 'Jogo da Velha',
    tagline: 'Clássico duelo de raciocínio rápido',
    description:
      'A tradicional disputa de estratégia por turnos para 2 jogadores. Partidas rápidas autoritativas no PostgreSQL com suporte a matchmaking público e revanche.',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Estratégia por Turnos',
    iconName: 'grid',
    highlights: [
      'Matchmaking automático autoritativo',
      'Salas privadas com código de 6 caracteres',
      'Turnos ágeis e placar oficial',
      'Revanche com aceite bilateral',
    ],
    isAvailable: true,
  },
  {
    id: 'pong',
    title: 'Pong',
    tagline: 'Duelo arcade de reflexos e agilidade',
    description:
      'O clássico confronto de raquetes em tempo real. Teste seus reflexos em trocas rápidas de bola em ritmo acelerado.',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Arcade / Reflexos',
    iconName: 'activity',
    highlights: [
      'Ação em tempo real com física fluida',
      'Disputa direta ponto a ponto',
      'Controles adaptados para toque e teclado',
    ],
    isAvailable: false,
  },
  {
    id: 'snake',
    title: 'Cobrinha Competitiva',
    tagline: 'Arena multiplayer de sobrevivência',
    description:
      'Controle sua cobrinha na arena compartilhada, colete itens e desvie dos adversários em uma disputa dinâmica de sobrevivência.',
    minPlayers: 2,
    maxPlayers: 4,
    category: 'Arena / Sobrevivência',
    iconName: 'worm',
    highlights: [
      'Suporte para até 4 jogadores',
      'Arena dinâmica com itens e obstáculos',
      'Sobreviva mais tempo para vencer',
    ],
    isAvailable: false,
  },
];

const FEATURES: PlatformFeature[] = [
  {
    title: 'Matchmaking Público',
    subtitle: 'Sem Espera',
    description:
      'Encontre adversários instantaneamente via fila rápida autoritativa com pareamento automático.',
    iconName: 'zap',
  },
  {
    title: 'Salas por Código',
    subtitle: 'Partidas Privadas',
    description:
      'Crie sua sala privada com código simples para desafiar amigos diretamente pelo navegador.',
    iconName: 'users',
  },
  {
    title: 'Conexão Tolerante',
    subtitle: 'Resiliência a Oscilações',
    description:
      'Sistema preparado para tolhar curtas quedas no celular com janela de reconexão automática.',
    iconName: 'shield',
  },
  {
    title: 'App Instalável (PWA)',
    subtitle: 'Mobile & Desktop',
    description:
      'Adicione à tela inicial do smartphone para jogar em tela cheia com alta velocidade.',
    iconName: 'smartphone',
  },
];

export interface HomePageProps {
  onOpenMatchmaking?: () => void;
  onOpenLobby?: () => void;
  onOpenHistory?: () => void;
  onOpenProfile?: () => void;
  hasActiveMatch?: boolean;
  onResumeActiveMatch?: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  onOpenMatchmaking,
  onOpenLobby,
  onOpenHistory,
  onOpenProfile,
  hasActiveMatch,
  onResumeActiveMatch,
}) => {
  const { user, profile, isAuthenticated } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const displayName =
    profile?.display_name ||
    user?.user_metadata?.display_name ||
    user?.email?.split('@')[0] ||
    'Jogador';

  const totalMatches = profile?.total_matches ?? 0;
  const totalWins = profile?.total_wins ?? 0;
  const winRate = totalMatches > 0 ? Math.round((totalWins / totalMatches) * 100) : 0;

  const handleMatchmakingAction = () => {
    if (!isAuthenticated) {
      setAuthModalOpen(true);
      return;
    }
    onOpenMatchmaking?.();
  };

  const handleCreateRoomAction = () => {
    if (!isAuthenticated) {
      setAuthModalOpen(true);
      return;
    }
    onOpenLobby?.();
  };

  return (
    <div className="space-y-12 sm:space-y-16 pb-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
      {/* 1. User Welcome & Active Match Banner */}
      {isAuthenticated && (
        <section className="space-y-4 animate-fade-in">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl relative overflow-hidden">
            <div
              className={`flex items-center gap-3.5 ${onOpenProfile ? 'cursor-pointer group' : ''}`}
              onClick={onOpenProfile}
            >
              <PlayerAvatar
                avatarUrl={profile?.avatar_url}
                displayName={displayName}
                username={profile?.username}
                size="md"
              />
              <div>
                <div className="text-base font-extrabold text-white flex items-center gap-2">
                  <span className="group-hover:text-blue-400 transition-colors">Olá, {displayName}</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400" title="Sessão Ativa" />
                </div>
                <p className="text-xs text-slate-400">
                  {profile ? (
                    <span className="font-mono tabular-nums">
                      {totalMatches} {totalMatches === 1 ? 'partida' : 'partidas'} · {totalWins} {totalWins === 1 ? 'vitória' : 'vitórias'} · {winRate}% taxa
                    </span>
                  ) : (
                    <span>Bem-vindo ao lobby do DuoPlay. Escolha um jogo para entrar em ação.</span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
              {onOpenProfile && (
                <button
                  type="button"
                  onClick={onOpenProfile}
                  className="flex-1 sm:flex-initial py-2 px-3.5 rounded-xl bg-purple-950/40 hover:bg-purple-900/60 border border-purple-800/60 text-purple-300 font-bold text-xs transition-colors flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-purple-400"
                >
                  <User className="w-4 h-4 text-purple-400" />
                  <span>Meu Perfil</span>
                </button>
              )}

              {onOpenHistory && (
                <button
                  type="button"
                  onClick={onOpenHistory}
                  className="flex-1 sm:flex-initial py-2 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs transition-colors flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-slate-400"
                >
                  <History className="w-4 h-4 text-slate-400" />
                  <span>Histórico</span>
                </button>
              )}
            </div>
          </div>

          {/* Active Match Recovery Banner */}
          {hasActiveMatch && onResumeActiveMatch && (
            <div className="p-5 rounded-2xl bg-gradient-to-r from-amber-950/70 via-slate-900 to-amber-950/40 border border-amber-700/80 shadow-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-pulse">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-[11px] font-bold text-amber-300">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span>Partida Ativa em Andamento</span>
                </div>
                <h3 className="text-base font-extrabold text-white">
                  Você tem uma partida em progresso no servidor!
                </h3>
                <p className="text-xs text-slate-300">
                  Retorne ao jogo antes que o cronômetro do seu turno expire.
                </p>
              </div>
              <button
                type="button"
                onClick={onResumeActiveMatch}
                className="py-3 px-5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm shadow-lg shadow-amber-950/50 transition-all flex items-center gap-2 shrink-0 active:scale-95"
              >
                <Play className="w-4 h-4 fill-slate-950" />
                <span>Continuar Partida</span>
              </button>
            </div>
          )}
        </section>
      )}

      {/* 2. Hero Lobby Banner */}
      <section id="hero" className="relative rounded-3xl border border-slate-800 bg-gradient-to-b from-slate-900/90 via-slate-900/60 to-slate-950/90 p-6 sm:p-10 lg:p-12 shadow-2xl overflow-hidden">
        <div
          className="absolute -top-24 left-1/2 -translate-x-1/2 w-[500px] h-[250px] bg-gradient-to-b from-blue-600/20 via-indigo-600/10 to-transparent blur-3xl pointer-events-none"
          aria-hidden="true"
        />

        <div className="relative z-10 max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-950/60 border border-blue-800/60 text-xs text-blue-300 font-bold">
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            <span>Lobby de Jogos Multiplayer</span>
          </div>

          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white leading-tight">
            Desafie jogadores em tempo real{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400">
              sem instalação
            </span>
          </h1>

          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-2xl">
            Partidas ágeis e sincronizadas pelo PostgreSQL. Encontre um oponente público em segundos ou crie uma sala privada com código para seus amigos.
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleMatchmakingAction}
              className="py-3 px-6 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-extrabold text-xs sm:text-sm shadow-xl shadow-blue-950/60 transition-all flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-blue-400 active:scale-95"
            >
              <Swords className="w-4 h-4" />
              <span>Encontrar Partida Rápida</span>
            </button>

            <button
              type="button"
              onClick={handleCreateRoomAction}
              className="py-3 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs sm:text-sm transition-colors flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-slate-400 active:scale-95"
            >
              <KeyRound className="w-4 h-4 text-slate-400" />
              <span>Criar Sala Privada</span>
            </button>
          </div>
        </div>
      </section>

      {/* 3. Games Catalog Section */}
      <section id="games" className="space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              Catálogo de Jogos
            </h2>
            <p className="text-xs text-slate-400">
              Selecione um título para iniciar a busca de adversários ou criar uma sala.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {GAMES.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              imageSrc={game.id === 'tic-tac-toe' ? ticTacToeArtwork : undefined}
              onMatchmaking={handleMatchmakingAction}
              onCreateRoom={handleCreateRoomAction}
            />
          ))}
        </div>
      </section>

      {/* 4. Platform Benefits */}
      <section id="features" className="space-y-6 pt-4">
        <div className="border-b border-slate-800/80 pb-4">
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
            Vantagens da Plataforma
          </h2>
          <p className="text-xs text-slate-400">
            Estrutura desenhada para garantir fluidez e acessibilidade em qualquer dispositivo.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((feature, idx) => (
            <div
              key={idx}
              className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col justify-between"
            >
              <div className="space-y-2">
                <div className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/60 text-blue-400 flex items-center justify-center">
                  {feature.iconName === 'zap' && <Zap className="w-4 h-4" />}
                  {feature.iconName === 'users' && <Users className="w-4 h-4" />}
                  {feature.iconName === 'shield' && <ShieldCheck className="w-4 h-4" />}
                  {feature.iconName === 'smartphone' && <Smartphone className="w-4 h-4" />}
                </div>
                <h3 className="text-sm font-bold text-white">{feature.title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Auth Modal for Unauthenticated Users */}
      <AuthModal
        isOpen={authModalOpen}
        initialMode="login"
        onClose={() => setAuthModalOpen(false)}
      />
    </div>
  );
};
