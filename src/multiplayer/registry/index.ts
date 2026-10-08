// ============================================================================
// Game Registry Central — DuoPlay-Online
// Phase: Fase 19 — Infraestrutura para Novos Jogos
// Description: Registro centralizado e agnóstico de jogos da plataforma.
//              Mapeia metadados, capacidades, configurações e componentes de renderização.
// ============================================================================

import React from 'react';
import { TicTacToeGame } from '@/games/tic-tac-toe/TicTacToeGame';
import { CartaDuoGame } from '@/games/carta-duo/CartaDuoGame';
import { SnakeGame } from '@/games/snake/SnakeGame';

// Caminhos estáticos públicos (/images/...) para garantir funcionamento robusto na Vercel em produção
const ticTacToeCover = '/images/tic_tac_toe_cover_1791476928538.jpg';
const ticTacToeArtwork = '/images/tic_tac_toe_artwork_1791338972542.jpg';
const pongCover = '/images/pong_arcade_cover_1791476938506.jpg';
const snakeCover = '/images/snake_arena_cover_1791476948757.jpg';
const cartaDuoCover = '/images/game_cover_carta_duo_1791471015960.jpg';
const billiardsCover = '/images/billiards_8_ball_cover_1791477085001.jpg';
const dominoCover = '/images/domino_duo_cover_1791477094936.jpg';
const hangmanCover = '/images/hangman_game_cover_1791477102833.jpg';
const adedonhaCover = '/images/adedonha_game_cover_1791477111057.jpg';

export type GameType = 'real_time' | 'turn_based' | 'words' | 'physics';

export interface GameDefinition {
  id: string;
  title: string;
  tagline: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  category: string;
  gameType: GameType;
  iconName: string;
  highlights: string[];
  isAvailable: boolean;
  coverImage?: string;
  artworkImage?: string;
  component?: React.ComponentType<any>;
  config: Record<string, any>;
}

const REGISTRY: Record<string, GameDefinition> = {
  'tic-tac-toe': {
    id: 'tic-tac-toe',
    title: 'Jogo da Velha',
    tagline: 'Clássico duelo de raciocínio rápido',
    description:
      'A tradicional disputa de estratégia por turnos para 2 jogadores. Partidas rápidas autoritativas no PostgreSQL com suporte a matchmaking público e revanche.',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Estratégia por Turnos',
    gameType: 'turn_based',
    iconName: 'grid',
    highlights: [
      'Matchmaking automático autoritativo',
      'Salas privadas com código de 6 caracteres',
      'Turnos ágeis e placar oficial',
      'Revanche com aceite bilateral',
    ],
    isAvailable: true,
    coverImage: ticTacToeCover,
    artworkImage: ticTacToeArtwork,
    component: TicTacToeGame,
    config: {
      category_label: 'Turnos',
      requires_timer: true,
    },
  },
  'pong': {
    id: 'pong',
    title: 'Pong Arcade',
    tagline: 'Duelo arcade de reflexos e agilidade',
    description:
      'O clássico confronto de raquetes em tempo real. Teste seus reflexos em trocas rápidas de bola em ritmo acelerado.',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Arcade / Reflexos',
    gameType: 'real_time',
    iconName: 'activity',
    highlights: [
      'Ação em tempo real com física fluida',
      'Disputa direta ponto a ponto',
      'Controles adaptados para toque e teclado',
    ],
    isAvailable: false,
    coverImage: pongCover,
    config: {
      category_label: 'Tempo Real',
      requires_timer: false,
      ball_speed: 5,
    },
  },
  'snake': {
    id: 'snake',
    title: 'Cobrinha Competitiva',
    tagline: 'Arena multiplayer de sobrevivência 1v1',
    description:
      'Controle sua cobrinha na arena compartilhada em tempo real, colete comida e sobreviva aos movimentos do adversário.',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Arena / Sobrevivência',
    gameType: 'real_time',
    iconName: 'worm',
    highlights: [
      'Disputa 1v1 em tempo real com ticks determinísticos',
      'Arena compartilhada com detecção de colisão oficial',
      'Controles touch D-pad e suporte a teclado WASD/Setas',
      'Placar oficial e ranking integrado',
    ],
    isAvailable: true,
    coverImage: snakeCover,
    component: SnakeGame,
    config: {
      category_label: 'Tempo Real',
      requires_timer: false,
      grid_width: 20,
      grid_height: 20,
      tick_rate_ms: 150,
      countdown_seconds: 3,
    },
  },
  'carta_duo': {
    id: 'carta_duo',
    title: 'Carta Duo',
    tagline: 'Descarte e estratégia de cartas multiplayer',
    description:
      'Clássico jogo por turnos de descarte de cartas baseado em correspondência de cor, número ou símbolo com efeitos especiais surpreendentes.',
    minPlayers: 2,
    maxPlayers: 6,
    category: 'Cartas / Turnos',
    gameType: 'turn_based',
    iconName: 'swords',
    highlights: [
      'Partidas de 2 a 6 jogadores simultâneos',
      'Regras oficiais sem acúmulo de compras',
      'Cartas especiais com efeitos táticos',
      'Placar oficial e ranking integrado',
    ],
    isAvailable: true,
    coverImage: cartaDuoCover,
    component: CartaDuoGame,
    config: {
      category_label: 'Turnos',
      requires_timer: true,
      initial_cards: 7,
    },
  },
  'billiards': {
    id: 'billiards',
    title: 'Sinuca 8-Ball',
    tagline: 'Física precisa de bilhar de salão',
    description:
      'Jogo de bilhar clássico com física precisa de colisão e tacadas alternadas. Encacape todas as suas bolas antes do adversário.',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Física / Precisão',
    gameType: 'physics',
    iconName: 'award',
    highlights: [
      'Física ultra-realista de colisões',
      'Mira ajustável com indicador de força',
      'Placar automatizado pelo servidor',
    ],
    isAvailable: false,
    coverImage: billiardsCover,
    config: {
      category_label: 'Física',
      requires_timer: true,
      table_theme: 'classic_green',
    },
  },
  'domino': {
    id: 'domino',
    title: 'Dominó Duo',
    tagline: 'Tradição e raciocínio tático de blocos',
    description:
      'Clássico dominó competitivo de turnos rápidos e tática. Bloqueie as saídas e pontue com inteligência matemática.',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Estratégia / Tabuleiro',
    gameType: 'turn_based',
    iconName: 'zap',
    highlights: [
      'Distribuição de peças 100% aleatória',
      'Validação matemática no PostgreSQL',
      'Partidas dinâmicas de raciocínio lógico',
    ],
    isAvailable: false,
    coverImage: dominoCover,
    config: {
      category_label: 'Turnos',
      requires_timer: true,
      max_tile_value: 6,
    },
  },
  'hangman': {
    id: 'hangman',
    title: 'Jogo da Forca',
    tagline: 'Desafio linguístico cooperativo ou duelo',
    description:
      'Adivinhe a palavra secreta letra por letra antes que o boneco seja desenhado. Dispute quem possui o maior vocabulário.',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'Palavras / Idioma',
    gameType: 'words',
    iconName: 'crown',
    highlights: [
      'Milhares de palavras em português',
      'Placar integrado ao perfil do jogador',
      'Dicas temáticas baseadas na partida',
    ],
    isAvailable: false,
    coverImage: hangmanCover,
    config: {
      category_label: 'Palavras',
      requires_timer: true,
      max_mistakes: 6,
    },
  },
  'adedonha': {
    id: 'adedonha',
    title: 'Adedonha (Stop!)',
    tagline: 'Escreva palavras o mais rápido possível',
    description:
      'Escreva palavras com a letra sorteada o mais rápido possível nas categorias pré-definidas. Grite STOP e congele seus oponentes.',
    minPlayers: 2,
    maxPlayers: 4,
    category: 'Palavras / Velocidade',
    gameType: 'words',
    iconName: 'grid',
    highlights: [
      'Suporte para até 4 jogadores simultâneos',
      'Validação cruzada de respostas',
      'Cronômetro dinâmico e pontuação atômica',
    ],
    isAvailable: false,
    coverImage: adedonhaCover,
    config: {
      category_label: 'Palavras',
      requires_timer: true,
      categories: ['Nome', 'Animal', 'Cor', 'Fruta'],
    },
  },
};

/**
 * Retorna a definição completa de um jogo cadastrado.
 */
export function getGameDefinition(gameId: string): GameDefinition | null {
  if (!gameId) return null;
  // Suporte robusto a normalizações de id (ex: 'tic-tac-toe' vs 'tic_tac_toe', 'carta-duo' vs 'carta_duo')
  const hyphenId = gameId.replace(/_/g, '-');
  const underscoreId = gameId.replace(/-/g, '_');
  return REGISTRY[gameId] || REGISTRY[hyphenId] || REGISTRY[underscoreId] || null;
}

/**
 * Retorna a lista de todos os jogos disponíveis no catálogo da plataforma.
 */
export function listGames(): GameDefinition[] {
  return Object.values(REGISTRY);
}

/**
 * Registra dinamicamente um novo jogo no catálogo mestre de forma modular em tempo de execução.
 */
export function registerGame(game: GameDefinition): void {
  if (!game || !game.id) return;
  REGISTRY[game.id] = game;
}
