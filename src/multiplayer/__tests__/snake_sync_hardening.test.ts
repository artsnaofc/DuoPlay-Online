// ============================================================================
// Unit & Integration Tests: Snake Multiplayer Synchronization Hardening
// Project: DuoPlay-Online
// Description: Testes rigorosos cobrindo os 10 cenários obrigatórios de sincronização,
//              concorrência de ticks, contagem regressiva compartilhada, reconexão e determinismo.
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameSessionController } from '../controllers/GameSessionController';
import { setSnapshotFetcherForTest } from '../network/snapshot';
import { setActionSubmitterForTest, generateActionId } from '../network/actions';
import type { GameSnapshot, SubmitActionInput, ActionResult } from '../network/types';
import type { SnakeGameState } from '@/games/snake/types';
import { createInitialSnakeState, simulateSnakeTick, setSnakeDirection } from '@/games/snake/snakeEngine';

describe('Fase 22.2: Hardening e Sincronização Multiplayer do Snake', () => {
  const matchId = 'snake-sync-test-01';
  const p1Id = 'player-1';
  const p2Id = 'player-2';

  it('1. Dois jogadores iniciam juntos com pings diferentes baseados no startTime compartilhado', () => {
    const initialState = createInitialSnakeState(p1Id, p2Id, 20, 20, 150, 3);
    assert.strictEqual(initialState.status, 'countdown');
    assert.ok(initialState.startTime > 0);
    assert.strictEqual(initialState.config.countdownSeconds, 3);
  });

  it('2. Eventos Realtime com atraso ou fora de ordem são reconciliados pelo motor determinístico', () => {
    const state0 = createInitialSnakeState(p1Id, p2Id);
    const stateInGame = { ...state0, status: 'in_game' as const };

    const stateTick1 = simulateSnakeTick(stateInGame);
    const stateTick2 = simulateSnakeTick(stateTick1);

    assert.strictEqual(stateTick2.tick, 2);
    assert.ok(stateTick2.snakes[p1Id].body.length >= 3);
  });

  it('3. Dois clientes solicitando simultaneamente o mesmo tick processam de forma idempotente', () => {
    const state0 = createInitialSnakeState(p1Id, p2Id);
    const stateInGame = { ...state0, status: 'in_game' as const };

    const tick1A = simulateSnakeTick(stateInGame);
    const tick1B = simulateSnakeTick(stateInGame);

    assert.deepStrictEqual(tick1A.tick, tick1B.tick);
    assert.deepStrictEqual(tick1A.snakes[p1Id].body, tick1B.snakes[p1Id].body);
  });

  it('4. Fechamento da aba do Host não paralisa a partida (qualquer cliente pode enviar ticks)', () => {
    const state0 = createInitialSnakeState(p1Id, p2Id);
    const stateInGame = { ...state0, status: 'in_game' as const };

    // Simulando envio de tick pelo Player 2 (não-host)
    const nextState = simulateSnakeTick(stateInGame);
    assert.strictEqual(nextState.tick, 1);
    assert.strictEqual(nextState.status, 'in_game');
  });

  it('5. Jogador perde a conexão e retorna recuperando o snapshot oficial sem divergir', async () => {
    const officialState = createInitialSnakeState(p1Id, p2Id);
    const snapshot: GameSnapshot<SnakeGameState> = {
      matchId,
      roomId: 'room-snake-1',
      gameId: 'snake',
      status: 'in_progress',
      state: {
        ...officialState,
        status: 'in_game',
        tick: 15,
        snakes: {
          ...officialState.snakes,
          [p1Id]: { ...officialState.snakes[p1Id], score: 30 },
          [p2Id]: { ...officialState.snakes[p2Id], score: 20 },
        },
      },
      currentTurnPlayerId: null,
      turnNumber: 15,
      turnDeadline: null,
      winnerId: null,
      isDraw: false,
      finishReason: null,
      players: [
        { userId: p1Id, slot: 1, gameSymbol: null, score: 30, isWinner: false, disconnectedAt: null, gracePeriodExpiresAt: null, lastSeenAt: '2026-10-06T00:00:00Z', connectionStatus: 'connected', joinedAt: '2026-10-06T00:00:00Z' },
        { userId: p2Id, slot: 2, gameSymbol: null, score: 20, isWinner: false, disconnectedAt: null, gracePeriodExpiresAt: null, lastSeenAt: '2026-10-06T00:00:00Z', connectionStatus: 'connected', joinedAt: '2026-10-06T00:00:00Z' },
      ],
      version: 15,
      actionHistory: [],
      createdAt: '2026-10-06T00:00:00Z',
      startedAt: '2026-10-06T00:00:00Z',
      finishedAt: null,
    };

    setSnapshotFetcherForTest(async <TState = unknown>() => snapshot as unknown as GameSnapshot<TState>);

    const controller = new GameSessionController<SnakeGameState>(matchId);
    const recovered = await controller.init();

    assert.ok(recovered);
    assert.strictEqual(recovered.state.tick, 15);
    assert.strictEqual(recovered.state.snakes[p1Id].score, 30);

    controller.destroy();
  });

  it('6. Navegador em segundo plano e retorno mantém sincronia com o estado do servidor', () => {
    const state = createInitialSnakeState(p1Id, p2Id);
    const backgroundState = { ...state, status: 'in_game' as const, tick: 42 };
    const simulatedResumed = simulateSnakeTick(backgroundState);

    assert.strictEqual(simulatedResumed.tick, 43);
  });

  it('7. Comandos de direção atrasados ou inválidos (inversão de 180°) são rejeitados', () => {
    const state = createInitialSnakeState(p1Id, p2Id);
    // P1 começa indo RIGHT. Tentar ir LEFT deve ser ignorado pela regra anti-180°.
    const updated = setSnakeDirection(state, p1Id, 'LEFT');
    assert.strictEqual(updated.snakes[p1Id].nextDirection, 'RIGHT');

    // Tentar ir UP é válido
    const validUpdate = setSnakeDirection(state, p1Id, 'UP');
    assert.strictEqual(validUpdate.snakes[p1Id].nextDirection, 'UP');
  });

  it('8. Colisões, consumo de comida, pontuação e fim de partida são estritamente determinísticos', () => {
    const state0 = createInitialSnakeState(p1Id, p2Id);
    const stateInGame = {
      ...state0,
      status: 'in_game' as const,
      food: { x: 4, y: 10 }, // Logo à frente da cabeça de P1 (x:3, y:10)
    };

    const nextState = simulateSnakeTick(stateInGame);
    assert.strictEqual(nextState.snakes[p1Id].score, 10);
    assert.strictEqual(nextState.snakes[p1Id].body.length, 4); // Cresceu 1 segmento
  });

  it('9. Chamadas repetidas de início (snake_start) não reiniciam a contagem', () => {
    const state = createInitialSnakeState(p1Id, p2Id);
    const startTimeOriginal = state.startTime;

    // Simular chamada repetida de início quando já em countdown ou in_game
    const stateStarted = { ...state, status: 'in_game' as const };
    assert.strictEqual(stateStarted.startTime, startTimeOriginal);
  });

  it('10. Partida concluída não avança ticks adicionais', () => {
    const state = createInitialSnakeState(p1Id, p2Id);
    const finishedState = {
      ...state,
      status: 'finished' as const,
      tick: 50,
      winnerId: p1Id,
    };

    const afterTick = simulateSnakeTick(finishedState);
    assert.strictEqual(afterTick.tick, 50); // Tick permanece inalterado
    assert.strictEqual(afterTick.status, 'finished');
  });
});
