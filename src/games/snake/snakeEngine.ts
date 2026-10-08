// ============================================================================
// Logic & Simulation Engine: Snake Competitivo — DuoPlay-Online
// Phase: Fase 22.1 — Motor Multiplayer + Regras
// Description: Funções puras e determinísticas para simulação local/preditiva,
//              validação de colisão, crescimento, comida e regras oficiais.
// ============================================================================

import type {
  SnakeGameState,
  SnakeDirection,
  SnakePoint,
  SnakePlayerState,
} from './types';

export const OPPOSITE_DIRECTIONS: Record<SnakeDirection, SnakeDirection> = {
  UP: 'DOWN',
  DOWN: 'UP',
  LEFT: 'RIGHT',
  RIGHT: 'LEFT',
};

/**
 * Cria o estado inicial determinístico para 2 jogadores.
 */
export function createInitialSnakeState(
  p1UserId: string,
  p2UserId: string,
  gridWidth = 20,
  gridHeight = 20,
  tickRateMs = 150,
  countdownSeconds = 3
): SnakeGameState {
  const p1Body: SnakePoint[] = [
    { x: 3, y: 10 },
    { x: 2, y: 10 },
    { x: 1, y: 10 },
  ];

  const p2Body: SnakePoint[] = [
    { x: 16, y: 10 },
    { x: 17, y: 10 },
    { x: 18, y: 10 },
  ];

  const now = Date.now();

  const snakes: Record<string, SnakePlayerState> = {
    [p1UserId]: {
      userId: p1UserId,
      slot: 1,
      direction: 'RIGHT',
      nextDirection: 'RIGHT',
      body: p1Body,
      alive: true,
      score: 0,
      color: '#10B981', // Verde esmeralda
    },
    [p2UserId]: {
      userId: p2UserId,
      slot: 2,
      direction: 'LEFT',
      nextDirection: 'LEFT',
      body: p2Body,
      alive: true,
      score: 0,
      color: '#F59E0B', // Âmbar ouro
    },
  };

  return {
    config: {
      gridWidth,
      gridHeight,
      tickRateMs,
      countdownSeconds,
    },
    status: 'countdown',
    tick: 0,
    snakes,
    food: { x: 10, y: 5 },
    startTime: now,
    lastTickTime: now,
    winnerId: null,
    isDraw: false,
  };
}

/**
 * Valida e atualiza a intenção de direção de um jogador impedindo reversão de 180°.
 */
export function setSnakeDirection(
  state: SnakeGameState,
  userId: string,
  requestedDirection: SnakeDirection
): SnakeGameState {
  const player = state.snakes[userId];
  if (!player || !player.alive || state.status === 'finished') {
    return state;
  }

  // Regra Anti-180°: Proibir inversão se corpo tiver tamanho >= 2
  const currentDir = player.direction;
  if (OPPOSITE_DIRECTIONS[currentDir] === requestedDirection) {
    // Reversão direta proibida
    return state;
  }

  return {
    ...state,
    snakes: {
      ...state.snakes,
      [userId]: {
        ...player,
        nextDirection: requestedDirection,
      },
    },
  };
}

/**
 * Calcula a nova posição da cabeça a partir de uma coordenada e direção.
 */
export function getNextHeadPosition(head: SnakePoint, direction: SnakeDirection): SnakePoint {
  switch (direction) {
    case 'UP':
      return { x: head.x, y: head.y - 1 };
    case 'DOWN':
      return { x: head.x, y: head.y + 1 };
    case 'LEFT':
      return { x: head.x - 1, y: head.y };
    case 'RIGHT':
      return { x: head.x + 1, y: head.y };
  }
}

/**
 * Gera uma nova posição de comida determinística sem sobrepor os corpos das cobras.
 */
export function spawnNextFood(
  gridWidth: number,
  gridHeight: number,
  tick: number,
  occupiedPoints: SnakePoint[]
): SnakePoint {
  const occupiedSet = new Set(occupiedPoints.map((p) => `${p.x},${p.y}`));

  for (let attempt = 1; attempt <= 50; attempt++) {
    const candidateX = ((tick * 7 + attempt * 13 + 3) % (gridWidth - 2)) + 1;
    const candidateY = ((tick * 11 + attempt * 17 + 5) % (gridHeight - 2)) + 1;

    if (!occupiedSet.has(`${candidateX},${candidateY}`)) {
      return { x: candidateX, y: candidateY };
    }
  }

  return { x: 10, y: 10 };
}

/**
 * Executa exatamente um tick determinístico de física e regras da arena.
 */
export function simulateSnakeTick(state: SnakeGameState): SnakeGameState {
  if (state.status !== 'in_game') {
    return state;
  }

  const { gridWidth, gridHeight } = state.config;
  const userIds = Object.keys(state.snakes);
  if (userIds.length < 2) return state;

  const [u1, u2] = userIds;
  const s1 = state.snakes[u1];
  const s2 = state.snakes[u2];

  const dir1 = s1.nextDirection || s1.direction;
  const dir2 = s2.nextDirection || s2.direction;

  const head1 = s1.body[0];
  const head2 = s2.body[0];

  const newHead1 = getNextHeadPosition(head1, dir1);
  const newHead2 = getNextHeadPosition(head2, dir2);

  let p1Dead = false;
  let p2Dead = false;

  // 1. Colisão com Parede
  if (newHead1.x < 0 || newHead1.x >= gridWidth || newHead1.y < 0 || newHead1.y >= gridHeight) {
    p1Dead = true;
  }
  if (newHead2.x < 0 || newHead2.x >= gridWidth || newHead2.y < 0 || newHead2.y >= gridHeight) {
    p2Dead = true;
  }

  // 2. Colisão Cabeça com Cabeça (Simultânea: Empate determinístico)
  if (newHead1.x === newHead2.x && newHead1.y === newHead2.y) {
    p1Dead = true;
    p2Dead = true;
  }

  // 3. Colisão com o próprio corpo
  for (const seg of s1.body) {
    if (seg.x === newHead1.x && seg.y === newHead1.y) {
      p1Dead = true;
    }
  }
  for (const seg of s2.body) {
    if (seg.x === newHead2.x && seg.y === newHead2.y) {
      p2Dead = true;
    }
  }

  // 4. Colisão com o corpo do adversário
  for (const seg of s2.body) {
    if (seg.x === newHead1.x && seg.y === newHead1.y) {
      p1Dead = true;
    }
  }
  for (const seg of s1.body) {
    if (seg.x === newHead2.x && seg.y === newHead2.y) {
      p2Dead = true;
    }
  }

  // 5. Consumo de Comida
  const p1Ate = !p1Dead && newHead1.x === state.food.x && newHead1.y === state.food.y;
  const p2Ate = !p2Dead && newHead2.x === state.food.x && newHead2.y === state.food.y;

  // Atualizar corpos
  let newBody1: SnakePoint[];
  if (!p1Dead) {
    newBody1 = [newHead1, ...(p1Ate ? s1.body : s1.body.slice(0, -1))];
  } else {
    newBody1 = s1.body;
  }

  let newBody2: SnakePoint[];
  if (!p2Dead) {
    newBody2 = [newHead2, ...(p2Ate ? s2.body : s2.body.slice(0, -1))];
  } else {
    newBody2 = s2.body;
  }

  // Nova comida se algum consumiu
  let newFood = state.food;
  if (p1Ate || p2Ate) {
    const occupied = [...newBody1, ...newBody2];
    newFood = spawnNextFood(gridWidth, gridHeight, state.tick + 1, occupied);
  }

  // Determinar vencedor
  let winnerId: string | null = null;
  let isDraw = false;
  let isFinished = false;

  if (p1Dead && p2Dead) {
    isFinished = true;
    isDraw = true;
    winnerId = null;
  } else if (p1Dead) {
    isFinished = true;
    isDraw = false;
    winnerId = u2;
  } else if (p2Dead) {
    isFinished = true;
    isDraw = false;
    winnerId = u1;
  }

  const nextTick = state.tick + 1;

  return {
    ...state,
    tick: nextTick,
    status: isFinished ? 'finished' : 'in_game',
    food: newFood,
    winnerId,
    isDraw,
    lastTickTime: Date.now(),
    snakes: {
      [u1]: {
        ...s1,
        direction: dir1,
        nextDirection: dir1,
        body: newBody1,
        alive: !p1Dead,
        score: s1.score + (p1Ate ? 10 : 0),
      },
      [u2]: {
        ...s2,
        direction: dir2,
        nextDirection: dir2,
        body: newBody2,
        alive: !p2Dead,
        score: s2.score + (p2Ate ? 10 : 0),
      },
    },
  };
}
