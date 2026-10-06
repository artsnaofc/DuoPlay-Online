import React, { useState } from 'react';
import { ArrowRight, Sparkles, Smartphone, ShieldCheck, Users, Zap, KeyRound, Gamepad2, UserPlus } from 'lucide-react';
import { GameCard } from '@/components/GameCard';
import { GameItem, PlatformFeature, HowItWorksStep } from '@/types/platform';
import { useAuth } from '@/hooks/useAuth';
import { AuthModal } from '@/components/auth/AuthModal';

const GAMES: GameItem[] = [
  {
    id: 'tic-tac-toe',
    title: 'Jogo da Velha',
    tagline: 'Clássico duelo de raciocínio rápido',
    description:
      'A tradicional disputa de estratégia por turnos para 2 jogadores. Perfeito para partidas ágeis e revanche instantânea.',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Estratégia por Turnos',
    iconName: 'grid',
    highlights: [
      'Partidas para 2 competidores',
      'Turnos ágeis com cronômetro balanceado',
      'Placar de partidas e opção de revanche',
      'Detecção automática de vitórias e empates',
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
      'Controles simples adaptados para toque e teclado',
      'Modo competitivo mano a mano',
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
      'Suporte para até 4 jogadores simultâneos',
      'Arena dinâmica com itens e obstáculos',
      'Partidas cheias de reviravoltas',
      'Sobreviva mais tempo para vencer',
    ],
    isAvailable: false,
  },
];

const FEATURES: PlatformFeature[] = [
  {
    title: 'Acesso Instantâneo',
    subtitle: 'Sem Instalação Obrigatória',
    description:
      'Abra no navegador do celular ou computador e jogue imediatamente. Sem downloads pesados ou cadastros complicados.',
    iconName: 'zap',
  },
  {
    title: 'Salas com Código Rápido',
    subtitle: 'Conecte-se com Amigos',
    description:
      'Crie sua sala com um código simples de 6 caracteres e compartilhe por mensagem para começar a partida na hora.',
    iconName: 'users',
  },
  {
    title: 'Conexão Estável',
    subtitle: 'Proteção contra Quedas',
    description:
      'Sistema preparado para tolerar oscilações de sinal no celular sem encerrar a partida imediatamente.',
    iconName: 'shield',
  },
  {
    title: 'Instale como App (PWA)',
    subtitle: 'Mobile & Desktop',
    description:
      'Adicione à tela de início do seu smartphone para abrir em tela cheia com a rapidez e o conforto de um aplicativo nativo.',
    iconName: 'smartphone',
  },
];

const HOW_IT_WORKS: HowItWorksStep[] = [
  {
    number: '01',
    title: 'Escolha o Jogo',
    description: 'Navegue pelo catálogo e escolha o jogo multiplayer ideal para o seu momento.',
  },
  {
    number: '02',
    title: 'Crie ou Entre na Sala',
    description: 'Gere um código exclusivo para sua sala ou insira o código enviado pelo seu amigo.',
  },
  {
    number: '03',
    title: 'Jogue em Tempo Real',
    description: 'Dispute jogada a jogada com sincronização fluida e divirta-se sem interrupções.',
  },
];

export interface HomePageProps {
  onPlayGame?: (gameId: string) => void;
  onOpenLobby?: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onPlayGame, onOpenLobby }) => {
  const { isAuthenticated } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const handleGamePlay = (gameId: string) => {
    if (!isAuthenticated) {
      setAuthModalOpen(true);
      return;
    }
    if (onPlayGame) {
      onPlayGame(gameId);
    } else if (onOpenLobby) {
      onOpenLobby();
    }
  };

  return (
    <div className="space-y-24">
      {/* 1. Hero Section */}
      <section id="hero" className="relative pt-12 pb-8 sm:pt-20 sm:pb-16 overflow-hidden">
        {/* Subtle decorative background glow */}
        <div
          className="absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-gradient-to-b from-blue-600/15 via-indigo-600/10 to-transparent blur-3xl pointer-events-none"
          aria-hidden="true"
        />

        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/90 border border-slate-800 text-xs text-slate-300">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <span className="font-semibold text-white">DuoPlay-Online</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-400">Plataforma de Jogos Multiplayer</span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight">
            Jogue com amigos em tempo real{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400">
              direto no navegador
            </span>
          </h1>

          <p className="text-sm sm:text-base text-slate-300 max-w-2xl mx-auto leading-relaxed">
            Partidas rápidas, leves e fluidas. Crie sua sala com um código simples e desafie quem você quiser, no celular ou no computador, sem necessidade de downloads.
          </p>

          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <a
              href="#games"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-semibold shadow-md shadow-blue-900/20 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
            >
              <span>Explorar Jogos</span>
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs sm:text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
            >
              <span>Como Funciona</span>
            </a>
          </div>

          {/* Value Props Line */}
          <div className="pt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-slate-400">
            <span>Partidas Leves</span>
            <span aria-hidden="true">·</span>
            <span>Salas com Código</span>
            <span aria-hidden="true">·</span>
            <span>Mobile & Desktop</span>
            <span aria-hidden="true">·</span>
            <span>Instalável no Smartphone</span>
          </div>
        </div>
      </section>

      {/* 2. Games Catalog */}
      <section id="games" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12 space-y-2">
          <span className="text-xs font-mono uppercase tracking-wider text-blue-400">
            Catálogo
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Jogos da Plataforma
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Conheça os títulos pensados para partidas rápidas e divertidas entre amigos.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {GAMES.map((game) => (
            <GameCard key={game.id} game={game} onPlay={handleGamePlay} />
          ))}
        </div>
      </section>

      {/* 3. Platform Features */}
      <section id="features" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12 space-y-2">
          <span className="text-xs font-mono uppercase tracking-wider text-blue-400">
            Vantagens
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Criado para a Melhor Experiência
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Toda a plataforma foi pensada para você jogar sem barreiras ou complicações.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {FEATURES.map((feature, idx) => (
            <div
              key={idx}
              className="flex flex-col p-6 rounded-xl bg-slate-900/50 border border-slate-800 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-slate-800/80 text-blue-400 mb-4 border border-slate-700/60">
                {feature.iconName === 'zap' && <Zap className="w-5 h-5" />}
                {feature.iconName === 'users' && <Users className="w-5 h-5" />}
                {feature.iconName === 'shield' && <ShieldCheck className="w-5 h-5" />}
                {feature.iconName === 'smartphone' && <Smartphone className="w-5 h-5" />}
              </div>
              <h3 className="text-sm font-bold text-white mb-1">{feature.title}</h3>
              <p className="text-[11px] font-semibold text-blue-400 mb-2">{feature.subtitle}</p>
              <p className="text-xs text-slate-400 leading-relaxed grow">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 4. How it Works */}
      <section id="how-it-works" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12 space-y-2">
          <span className="text-xs font-mono uppercase tracking-wider text-blue-400">
            Simplicidade
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Como Funciona
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Três passos simples para começar a jogar com seus amigos.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {HOW_IT_WORKS.map((step, idx) => (
            <div
              key={idx}
              className="relative p-6 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col justify-between"
            >
              <div>
                <span className="text-3xl font-extrabold text-blue-500/30 font-mono block mb-2">
                  {step.number}
                </span>
                <h3 className="text-base font-bold text-white mb-2">{step.title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{step.description}</p>
              </div>

              <div className="mt-6 pt-3 border-t border-slate-800/60 flex items-center gap-2 text-xs text-slate-500">
                {idx === 0 && <Gamepad2 className="w-4 h-4 text-blue-400" />}
                {idx === 1 && <KeyRound className="w-4 h-4 text-purple-400" />}
                {idx === 2 && <Sparkles className="w-4 h-4 text-emerald-400" />}
                <span>
                  {idx === 0 && 'Catálogo diversificado'}
                  {idx === 1 && 'Convites instantâneos'}
                  {idx === 2 && 'Partidas em tempo real'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Player Account CTA (Unauthenticated Only) */}
      {!isAuthenticated && (
        <section className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-blue-950/30 via-slate-900 to-indigo-950/20 p-8 sm:p-10 text-center relative overflow-hidden">
            <div className="relative z-10 space-y-4 max-w-xl mx-auto">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 mb-1">
                <UserPlus className="w-6 h-6" />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                Garanta seu Nome de Jogador
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                Cadastre-se gratuitamente no DuoPlay-Online para reservar seu identificador único e salvar suas partidas.
              </p>
              <div className="pt-2">
                <button
                  onClick={() => setAuthModalOpen(true)}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-blue-900/40 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
                >
                  <span>Criar Conta Gratuita</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Auth Modal Triggered by CTA */}
      <AuthModal
        isOpen={authModalOpen}
        initialMode="register"
        onClose={() => setAuthModalOpen(false)}
      />
    </div>
  );
};
