import React, { useState } from 'react';
import { Gamepad2, Shield, Layers, Smartphone, Sparkles, ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import { GameCard } from '@/components/GameCard';
import { PlannedGame, PlatformPillar, RoadmapStep } from '@/types/platform';

const PLANNED_GAMES: PlannedGame[] = [
  {
    id: 'tic-tac-toe',
    title: 'Jogo da Velha',
    tagline: 'O primeiro jogo da plataforma DuoPlay-Online',
    description:
      'Clássico duelo estratégico de turnos para 2 competidores. Servirá como primeira prova de conceito e validação da Network Engine e das RPCs transacionais.',
    minPlayers: 2,
    maxPlayers: 2,
    status: 'development',
    statusLabel: 'Em desenvolvimento (Fase 14)',
    phaseTarget: 'Fase 14',
    category: 'Estratégia por Turnos',
    accentColor: '#38bdf8',
    iconName: 'grid',
    features: [
      'Validação de jogadas autoritativa no PostgreSQL',
      'Detecção determinística de vitória e empate',
      'Tolerância a desconexão temporária (Grace Period de 45s)',
      'Consome Network Engine via useGameMatch hook',
    ],
  },
  {
    id: 'pong',
    title: 'Pong Competitivo',
    tagline: 'Duelo arcade de reflexos e alta taxa de atualização',
    description:
      'Partida em tempo real de raquetes e bola com física sincronizada. Projetado para estender a infraestrutura para dinâmicas de baixa latência.',
    minPlayers: 2,
    maxPlayers: 2,
    status: 'planned',
    statusLabel: 'Planejado para fases futuras',
    phaseTarget: 'Fase 15+',
    category: 'Ação / Arcade',
    accentColor: '#a855f7',
    iconName: 'activity',
    features: [
      'Sincronização de posições de raquete via Realtime Broadcast',
      'Arbitragem transacional de pontos no banco de dados',
      'Mesma infraestrutura de salas e gerenciamento de partida',
      'Zero alterações na Network Engine base',
    ],
  },
  {
    id: 'snake',
    title: 'Cobrinha Competitiva',
    tagline: 'Arena multiplayer de sobrevivência e reflexos',
    description:
      'Arena compartilhada para 2 a 4 competidores simultâneos disputando espaço e colecionáveis. Demonstra que a plataforma suporta múltiplos jogadores por partida.',
    minPlayers: 2,
    maxPlayers: 4,
    status: 'planned',
    statusLabel: 'Planejado para fases futuras',
    phaseTarget: 'Fase 15+',
    category: 'Sobrevivência / Arena',
    accentColor: '#10b981',
    iconName: 'worm',
    features: [
      'Suporte a 2 ou mais jogadores por sala e partida',
      'Tick de movimentação em grid sincronizado',
      'Ranking de sobrevivência por partida',
      'Reutilização integral do subsistema de conexão',
    ],
  },
];

const PLATFORM_PILLARS: PlatformPillar[] = [
  {
    title: 'Camada de Jogos Agnóstica',
    subtitle: 'Desacoplamento Total',
    description:
      'Nenhum jogo importa o Supabase ou conhece detalhes de WebSocket. Todos consomem um contrato limpo (GameDefinition) através do hook universal useGameMatch.',
    iconName: 'layers',
  },
  {
    title: 'PostgreSQL como Fonte da Verdade',
    subtitle: 'Serverless sem Trapaça',
    description:
      'O estado oficial das partidas e a validação de regras residem em transações ACID no banco. Manipulações no navegador não alteram o placar ou o tabuleiro.',
    iconName: 'shield',
  },
  {
    title: 'Grace Period de 45s no Servidor',
    subtitle: 'Resiliência a Quedas Móveis',
    description:
      'Ao bloquear a tela do celular ou alternar conexões (Wi-Fi/4G), o cronômetro do turno é suspenso no servidor e a vaga permanece reservada durante 45 segundos.',
    iconName: 'zap',
  },
  {
    title: 'Mobile-First & PWA Standalone',
    subtitle: 'Instalável em Celulares e Desktop',
    description:
      'Interface otimizada para toque em telas compactas e excelente ergonomia com teclado e mouse em desktops, com suporte a Progressive Web App.',
    iconName: 'smartphone',
  },
];

const ROADMAP_STEPS: RoadmapStep[] = [
  {
    phase: 'Fase 0',
    title: 'Arquitetura e Documentação',
    description: 'Especificação técnica consolidada em 9 documentos formais em docs/.',
    isCompleted: true,
  },
  {
    phase: 'Fase 1',
    title: 'Fundação Frontend',
    description: 'React, Vite, TypeScript, Tailwind, PWA e estrutura da plataforma.',
    isCurrent: true,
  },
  {
    phase: 'Fases 2 a 5',
    title: 'Supabase, Schemas e RPCs',
    description: 'Autenticação, tabelas relacionais, regras RLS e stored procedures transacionais.',
  },
  {
    phase: 'Fases 6 a 10',
    title: 'Network Engine e Realtime',
    description: 'Connection, Presence, Reconnect (Grace Period) e multiplexação de canais.',
  },
  {
    phase: 'Fases 11 a 13',
    title: 'Salas, Partidas e Testes de Rede',
    description: 'Lobby social, congelamento de competidores e testes sob latência artificial.',
  },
  {
    phase: 'Fases 14 e 15',
    title: 'Jogo da Velha e Lançamento',
    description: 'Primeiro jogo funcional integrado à engine e testes multiplayer E2E.',
  },
];

export const HomePage: React.FC = () => {
  const [filter, setFilter] = useState<'all' | 'first' | 'future'>('all');

  const filteredGames = PLANNED_GAMES.filter((game) => {
    if (filter === 'first') return game.status === 'development';
    if (filter === 'future') return game.status === 'planned';
    return true;
  });

  return (
    <div className="space-y-24">
      {/* 1. Hero Section */}
      <section id="hero" className="relative pt-12 pb-8 sm:pt-20 sm:pb-16 overflow-hidden">
        {/* Subtle decorative background gradient */}
        <div
          className="absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-gradient-to-b from-blue-600/15 via-indigo-600/10 to-transparent blur-3xl pointer-events-none"
          aria-hidden="true"
        />

        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/90 border border-slate-800 text-xs text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-white">DuoPlay-Online v1.0</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-400">Fase 1: Fundação Frontend</span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight">
            Plataforma Web de Jogos{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400">
              Multiplayer
            </span>
          </h1>

          <p className="text-sm sm:text-base text-slate-300 max-w-2xl mx-auto leading-relaxed">
            Uma fundação modular e serverless construída para múltiplos jogos em tempo real. 
            Projetada para tolerar quedas móveis temporárias, assegurar regras invioláveis e conectar jogadores em qualquer dispositivo.
          </p>

          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <a
              href="#games"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-semibold shadow-md shadow-blue-900/20 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
            >
              <span>Ver Jogos Planejados</span>
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="#architecture"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs sm:text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
            >
              <span>Conhecer a Arquitetura</span>
            </a>
          </div>

          {/* Quick Technical Badges - Zero-Pill Text Format */}
          <div className="pt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-slate-400">
            <span>React 19 + Vite</span>
            <span aria-hidden="true">·</span>
            <span>TypeScript Estrito</span>
            <span aria-hidden="true">·</span>
            <span>Tailwind CSS</span>
            <span aria-hidden="true">·</span>
            <span>PWA Standalone</span>
            <span aria-hidden="true">·</span>
            <span>Pronto para Vercel</span>
          </div>
        </div>
      </section>

      {/* 2. Platform Architecture Pillars */}
      <section id="architecture" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12 space-y-2">
          <span className="text-xs font-mono uppercase tracking-wider text-blue-400">
            Arquitetura Aprovada
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Pilares da Infraestrutura
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            DuoPlay-Online é arquitetada em camadas bem definidas, garantindo que novos jogos possam ser adicionados sem reescrever a base de rede.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {PLATFORM_PILLARS.map((pillar, idx) => (
            <div
              key={idx}
              className="flex flex-col p-6 rounded-xl bg-slate-900/50 border border-slate-800 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-slate-800/80 text-blue-400 mb-4 border border-slate-700/60">
                {pillar.iconName === 'layers' && <Layers className="w-5 h-5" />}
                {pillar.iconName === 'shield' && <Shield className="w-5 h-5" />}
                {pillar.iconName === 'zap' && <Sparkles className="w-5 h-5" />}
                {pillar.iconName === 'smartphone' && <Smartphone className="w-5 h-5" />}
              </div>
              <h3 className="text-sm font-bold text-white mb-1">{pillar.title}</h3>
              <p className="text-[11px] font-semibold text-blue-400 mb-2">{pillar.subtitle}</p>
              <p className="text-xs text-slate-400 leading-relaxed grow">{pillar.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Planned Games Catalog */}
      <section id="games" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10 pb-6 border-b border-slate-800">
          <div className="space-y-2 max-w-xl">
            <span className="text-xs font-mono uppercase tracking-wider text-blue-400">
              Catálogo da Plataforma
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Jogos da Plataforma
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              O DuoPlay-Online suportará múltiplos jogos. O <strong className="text-slate-200">Jogo da Velha</strong> é o foco inicial da Fase 14, preparando o terreno para expansões futuras.
            </p>
          </div>

          {/* Functional Filter Tabs (Allowed button segmented control per design rules) */}
          <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg self-start md:self-auto">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === 'all'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Todos ({PLANNED_GAMES.length})
            </button>
            <button
              onClick={() => setFilter('first')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === 'first'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Primeiro Jogo (Fase 14)
            </button>
            <button
              onClick={() => setFilter('future')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === 'future'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Futuros Planejados
            </button>
          </div>
        </div>

        {/* Game Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredGames.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      </section>

      {/* 4. Development Roadmap Progress */}
      <section id="roadmap" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12 space-y-2">
          <span className="text-xs font-mono uppercase tracking-wider text-blue-400">
            Cronograma Oficial
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Sequência de Desenvolvimento
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            O projeto é implementado em fases controladas. Cada fase requer validação integral antes de iniciar a próxima.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ROADMAP_STEPS.map((step, idx) => (
            <div
              key={idx}
              className={`p-5 rounded-xl border flex flex-col justify-between transition-colors ${
                step.isCurrent
                  ? 'bg-blue-950/20 border-blue-500/60 shadow-md shadow-blue-950/30'
                  : step.isCompleted
                  ? 'bg-slate-900/40 border-emerald-500/40'
                  : 'bg-slate-900/30 border-slate-800/80 opacity-75'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-mono text-xs font-bold text-slate-400">
                    {step.phase}
                  </span>
                  {step.isCompleted ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Concluída
                    </span>
                  ) : step.isCurrent ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-400">
                      <Circle className="w-3 h-3 fill-blue-400 animate-pulse" />
                      Fase Atual
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500">Próxima</span>
                  )}
                </div>
                <h3 className="text-sm font-bold text-white mb-1.5">{step.title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{step.description}</p>
              </div>

              {step.isCurrent && (
                <div className="mt-4 pt-3 border-t border-blue-900/40 flex items-center justify-between text-[11px] text-blue-300 font-mono">
                  <span>Status: Em Execução</span>
                  <span>React + Vite + PWA</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
