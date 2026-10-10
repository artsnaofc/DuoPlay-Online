// ============================================================================
// Unit & Performance Tests: Snake Visual Interpolation & Input Queue
// Project: DuoPlay-Online
// Phase: Fase 22.3 — Otimização de Fluidez e Latência da Cobrinha Multiplayer
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lerpPoint, interpolateSnake } from '@/games/snake/snakeInterpolation';
import { createInitialSnakeState, simulateSnakeTick } from '@/games/snake/snakeEngine';
import type { SnakePlayerState } from '@/games/snake/types';

describe('Fase 22.3: Interpolação Visual e Fluidez da Cobrinha', () => {
  const p1 = 'player-1';
  const p2 = 'player-2';

  it('1. lerpPoint interpola com precisão entre duas coordenadas e respeita bounds [0, 1]', () => {
    const ptA = { x: 10, y: 20 };
    const ptB = { x: 20, y: 40 };

    const mid = lerpPoint(ptA, ptB, 0.5);
    assert.strictEqual(mid.x, 15);
    assert.strictEqual(mid.y, 30);

    const start = lerpPoint(ptA, ptB, -0.5); // Clamped a 0
    assert.strictEqual(start.x, 10);
    assert.strictEqual(start.y, 20);

    const end = lerpPoint(ptA, ptB, 1.5); // Clamped a 1
    assert.strictEqual(end.x, 20);
    assert.strictEqual(end.y, 40);
  });

  it('2. interpolateSnake suaviza o movimento da cabeça e corpo entre dois ticks lógicos', () => {
    const state0 = createInitialSnakeState(p1, p2);
    state0.status = 'in_game';
    const s0 = state0.snakes[p1];

    const state1 = simulateSnakeTick(state0);
    const s1 = state1.snakes[p1];

    // s0 cabeça em (3, 10). s1 cabeça em (4, 10).
    assert.strictEqual(s0.body[0].x, 3);
    assert.strictEqual(s1.body[0].x, 4);

    // No meio do intervalo (progress = 0.5), a cabeça interpolada deve estar em x = 3.5
    const interpolated = interpolateSnake(s0, s1, 0.5);
    assert.strictEqual(interpolated.head.x, 3.5);
    assert.strictEqual(interpolated.head.y, 10);

    // O primeiro segmento do corpo também deve estar suavizado
    assert.strictEqual(interpolated.body.length, s1.body.length);
  });

  it('3. interpolateSnake sem estado anterior usa a posição atual sem saltos ou erros', () => {
    const state0 = createInitialSnakeState(p1, p2);
    const s0 = state0.snakes[p1];

    const interpolated = interpolateSnake(null, s0, 0.5);
    assert.strictEqual(interpolated.head.x, s0.body[0].x);
    assert.strictEqual(interpolated.head.y, s0.body[0].y);
    assert.strictEqual(interpolated.body.length, s0.body.length);
  });

  it('4. Interpolação a 100% (progress = 1) coincide exatamente com o estado autoritativo do tick', () => {
    const state0 = createInitialSnakeState(p1, p2);
    state0.status = 'in_game';
    const s0 = state0.snakes[p1];
    const state1 = simulateSnakeTick(state0);
    const s1 = state1.snakes[p1];

    const interpolated = interpolateSnake(s0, s1, 1.0);
    assert.strictEqual(interpolated.head.x, s1.body[0].x);
    assert.strictEqual(interpolated.head.y, s1.body[0].y);
  });
});
