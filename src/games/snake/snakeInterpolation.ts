// ============================================================================
// Service: Visual Interpolation Engine for Snake Arena — DuoPlay-Online
// Description: Gerenciador de interpolação visual contínua para cobras do Snake.
//              Permite 60fps/120fps via requestAnimationFrame entre ticks lógicos discretos,
//              evitando saltos abruptos sem alterar a autoridade ou regras do jogo.
// ============================================================================

import type { SnakePoint, SnakeDirection, SnakePlayerState } from './types';

export interface InterpolatedPoint {
  x: number;
  y: number;
}

export interface InterpolatedSnake {
  head: InterpolatedPoint;
  body: InterpolatedPoint[];
  direction: SnakeDirection;
}

/**
 * Interpola linearmente entre duas posições (com proteção contra wrap).
 */
export function lerpPoint(
  p0: SnakePoint | InterpolatedPoint,
  p1: SnakePoint | InterpolatedPoint,
  t: number
): InterpolatedPoint {
  const clampedT = Math.max(0, Math.min(1, t));
  return {
    x: p0.x + (p1.x - p0.x) * clampedT,
    y: p0.y + (p1.y - p0.y) * clampedT,
  };
}

/**
 * Calcula os pontos visuais interpolados de uma cobra dados o estado anterior e o estado atual.
 */
export function interpolateSnake(
  previousSnake: SnakePlayerState | null,
  currentSnake: SnakePlayerState,
  progress: number
): InterpolatedSnake {
  const currentBody = currentSnake.body;
  if (!currentBody || currentBody.length === 0) {
    return {
      head: { x: 0, y: 0 },
      body: [],
      direction: currentSnake.direction,
    };
  }

  // Se não houver estado anterior ou se o tamanho mudou drasticamente (ex: spawn/crescimento súbito)
  if (!previousSnake || !previousSnake.body || previousSnake.body.length === 0) {
    return {
      head: { x: currentBody[0].x, y: currentBody[0].y },
      body: currentBody.map((pt) => ({ x: pt.x, y: pt.y })),
      direction: currentSnake.direction,
    };
  }

  const prevBody = previousSnake.body;
  const clampedProgress = Math.max(0, Math.min(1, progress));

  // A cabeça é interpolada entre a cabeça anterior e a cabeça atual
  const head = lerpPoint(prevBody[0], currentBody[0], clampedProgress);

  // Cada segmento i é interpolado entre o segmento i anterior e o segmento i atual
  const interpolatedBody: InterpolatedPoint[] = [];
  for (let i = 0; i < currentBody.length; i++) {
    const curPt = currentBody[i];
    // Se o segmento existia no anterior, interpola; caso contrário, usa o ponto atual
    const prevPt = i < prevBody.length ? prevBody[i] : curPt;
    interpolatedBody.push(lerpPoint(prevPt, curPt, clampedProgress));
  }

  return {
    head,
    body: interpolatedBody,
    direction: currentSnake.direction,
  };
}
