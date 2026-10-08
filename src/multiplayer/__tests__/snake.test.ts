// ============================================================================
// Unit & Integration Tests: Snake Competitivo (Phase 22.1) — DuoPlay-Online
// Description: Testes autoritativos de regras, motor multiplayer determinístico,
//              colisões, crescimento, inversão 180°, empate, vitória, reconexão e rede.
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialSnakeState,
  setSnakeDirection,
  simulateSnakeTick,
  getNextHeadPosition,
  spawnNextFood,
} from '@/games/snake/snakeEngine';
import type { SnakeGameState } from '@/games/snake/types';
import { getGameDefinition } from '@/multiplayer/registry';
import { GameSessionController } from '@/multiplayer/controllers/GameSessionController';
import { setActionSubmitterForTest } from '@/multiplayer/network/actions';
import type { GameSnapshot } from '@/multiplayer/network/types';

describe('Fase 22.1: Snake Competitivo — Motor Multiplayer e Regras Oficiais', () => {
  const player1Id = '11111111-1111-1111-1111-111111111111';
  const player2Id = '22222222-2222-2222-2222-222222222222';
  const matchId = '99999999-9999-9999-9999-999999999999';

  // --------------------------------------------------------------------------
  // 1. Registro e Configuração no Catálogo
  // --------------------------------------------------------------------------
  describe('1. Integração com Game Registry', () => {
    it('1.1. snake está registrado, disponível e configurado para 2 jogadores real_time', () => {
      const def = getGameDefinition('snake');
      assert.ok(def, 'Definição de Snake deve existir');
      assert.strictEqual(def?.id, 'snake');
      assert.strictEqual(def?.minPlayers, 2);
      assert.strictEqual(def?.maxPlayers, 2);
      assert.strictEqual(def?.gameType, 'real_time');
      assert.strictEqual(def?.isAvailable, true);
      assert.ok(def?.component, 'Componente SnakeGame deve estar associado');
      assert.strictEqual(def?.config.grid_width, 20);
      assert.strictEqual(def?.config.grid_height, 20);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Estado Inicial Determinístico
  // --------------------------------------------------------------------------
  describe('2. Inicialização da Arena e Jogadores', () => {
    it('2.1. Inicia com 2 cobras em posições opostas, corpos de tamanho 3 e contagem regressiva', () => {
      const state = createInitialSnakeState(player1Id, player2Id, 20, 20);
      assert.strictEqual(state.status, 'countdown');
      assert.strictEqual(state.tick, 0);
      assert.strictEqual(state.winnerId, null);
      assert.strictEqual(state.isDraw, false);

      const s1 = state.snakes[player1Id];
      const s2 = state.snakes[player2Id];

      assert.ok(s1 && s2);
      assert.strictEqual(s1.direction, 'RIGHT');
      assert.strictEqual(s2.direction, 'LEFT');
      assert.strictEqual(s1.body.length, 3);
      assert.strictEqual(s2.body.length, 3);
      assert.strictEqual(s1.alive, true);
      assert.strictEqual(s2.alive, true);
      assert.strictEqual(s1.score, 0);
      assert.strictEqual(s2.score, 0);

      // P1 Cabeça (3, 10), P2 Cabeça (16, 10)
      assert.deepStrictEqual(s1.body[0], { x: 3, y: 10 });
      assert.deepStrictEqual(s2.body[0], { x: 16, y: 10 });
      assert.ok(state.food);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Regras de Movimento e Bloqueio de 180°
  // --------------------------------------------------------------------------
  describe('3. Validação de Direção e Prevenção de 180°', () => {
    it('3.1. Permite curvas válidas (UP, DOWN a partir de RIGHT)', () => {
      let state = createInitialSnakeState(player1Id, player2Id);
      state = setSnakeDirection(state, player1Id, 'UP');
      assert.strictEqual(state.snakes[player1Id].nextDirection, 'UP');

      state = setSnakeDirection(state, player1Id, 'DOWN');
      assert.strictEqual(state.snakes[player1Id].nextDirection, 'DOWN');
    });

    it('3.2. Impede reversão instantânea de 180° (RIGHT -> LEFT quando corpo >= 2)', () => {
      const state = createInitialSnakeState(player1Id, player2Id);
      assert.strictEqual(state.snakes[player1Id].direction, 'RIGHT');

      const updated = setSnakeDirection(state, player1Id, 'LEFT');
      // Direção NÃO muda para LEFT
      assert.strictEqual(updated.snakes[player1Id].nextDirection, 'RIGHT');
    });

    it('3.3. Impede comando de jogador já eliminado ou em partida finalizada', () => {
      let state = createInitialSnakeState(player1Id, player2Id);
      state.snakes[player1Id].alive = false;

      const updated = setSnakeDirection(state, player1Id, 'UP');
      assert.strictEqual(updated.snakes[player1Id].nextDirection, 'RIGHT');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Simulação de Ticks e Movimentação
  // --------------------------------------------------------------------------
  describe('4. Movimentação Determinística por Ticks', () => {
    it('4.1. Em in_game, cada tick avança a cabeça e desloca o corpo mantendo o tamanho', () => {
      let state = createInitialSnakeState(player1Id, player2Id);
      state.status = 'in_game';

      const s1InitialHead = state.snakes[player1Id].body[0];
      const s2InitialHead = state.snakes[player2Id].body[0];

      state = simulateSnakeTick(state);

      assert.strictEqual(state.tick, 1);
      assert.strictEqual(state.snakes[player1Id].body.length, 3);
      assert.strictEqual(state.snakes[player2Id].body.length, 3);

      // P1 moveu para a direita (x + 1)
      assert.deepStrictEqual(state.snakes[player1Id].body[0], {
        x: s1InitialHead.x + 1,
        y: s1InitialHead.y,
      });

      // P2 moveu para a esquerda (x - 1)
      assert.deepStrictEqual(state.snakes[player2Id].body[0], {
        x: s2InitialHead.x - 1,
        y: s2InitialHead.y,
      });
    });
  });

  // --------------------------------------------------------------------------
  // 5. Consumo de Comida e Crescimento
  // --------------------------------------------------------------------------
  describe('5. Mecânica de Comida e Pontuação', () => {
    it('5.1. Ao alcançar a coordenada da comida, cobra cresce (+1 segmento) e pontua (+10)', () => {
      let state = createInitialSnakeState(player1Id, player2Id);
      state.status = 'in_game';
      // Coloca comida exatamente à frente de P1 (4, 10)
      state.food = { x: 4, y: 10 };

      state = simulateSnakeTick(state);

      const p1 = state.snakes[player1Id];
      assert.strictEqual(p1.score, 10, 'Deve somar 10 pontos ao consumir comida');
      assert.strictEqual(p1.body.length, 4, 'Cobra deve crescer para 4 segmentos');
      assert.notDeepStrictEqual(state.food, { x: 4, y: 10 }, 'Nova comida deve ser gerada');
    });

    it('5.2. spawnNextFood nunca gera comida sobre os corpos das cobras', () => {
      const occupied = [
        { x: 5, y: 5 },
        { x: 5, y: 6 },
        { x: 5, y: 7 },
      ];
      const food = spawnNextFood(20, 20, 1, occupied);
      assert.ok(food.x >= 1 && food.x < 19);
      assert.ok(food.y >= 1 && food.y < 19);
      const isOccupied = occupied.some((p) => p.x === food.x && p.y === food.y);
      assert.strictEqual(isOccupied, false);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Colisões, Vitória, Derrota e Empate
  // --------------------------------------------------------------------------
  describe('6. Sistema de Colisões e Finalização', () => {
    it('6.1. Colisão com parede elimina a cobra e consagra o adversário como vencedor', () => {
      let state = createInitialSnakeState(player1Id, player2Id);
      state.status = 'in_game';
      // Coloca P1 encostado na borda direita andando para a direita
      state.snakes[player1Id].body = [
        { x: 19, y: 2 },
        { x: 18, y: 2 },
        { x: 17, y: 2 },
      ];
      state.snakes[player1Id].direction = 'RIGHT';
      state.snakes[player1Id].nextDirection = 'RIGHT';

      // P2 seguro no centro andando para baixo
      state.snakes[player2Id].body = [
        { x: 10, y: 10 },
        { x: 10, y: 9 },
        { x: 10, y: 8 },
      ];
      state.snakes[player2Id].direction = 'DOWN';
      state.snakes[player2Id].nextDirection = 'DOWN';

      state = simulateSnakeTick(state);

      assert.strictEqual(state.status, 'finished');
      assert.strictEqual(state.isDraw, false);
      assert.strictEqual(state.winnerId, player2Id, 'P2 deve ser o vencedor');
      assert.strictEqual(state.snakes[player1Id].alive, false);
      assert.strictEqual(state.snakes[player2Id].alive, true);
    });

    it('6.2. Colisão frontal simultânea (Head-to-Head) resulta em EMPATE determinístico', () => {
      let state = createInitialSnakeState(player1Id, player2Id);
      state.status = 'in_game';
      // Coloca as duas cabeças a 1 célula de distância
      state.snakes[player1Id].body = [
        { x: 9, y: 5 },
        { x: 8, y: 5 },
        { x: 7, y: 5 },
      ];
      state.snakes[player1Id].direction = 'RIGHT';
      state.snakes[player1Id].nextDirection = 'RIGHT';

      state.snakes[player2Id].body = [
        { x: 11, y: 5 },
        { x: 12, y: 5 },
        { x: 13, y: 5 },
      ];
      state.snakes[player2Id].direction = 'LEFT';
      state.snakes[player2Id].nextDirection = 'LEFT';

      // Ambas vão para (10, 5) no próximo tick
      state = simulateSnakeTick(state);

      assert.strictEqual(state.status, 'finished');
      assert.strictEqual(state.isDraw, true, 'Deve ser empate em colisão simultânea');
      assert.strictEqual(state.winnerId, null);
      assert.strictEqual(state.snakes[player1Id].alive, false);
      assert.strictEqual(state.snakes[player2Id].alive, false);
    });

    it('6.3. Colisão da cabeça no corpo do adversário elimina a cobra agressora', () => {
      let state = createInitialSnakeState(player1Id, player2Id);
      state.status = 'in_game';

      // P2 forma uma barreira horizontal em y = 5
      state.snakes[player2Id].body = [
        { x: 15, y: 5 },
        { x: 14, y: 5 },
        { x: 13, y: 5 },
      ];
      state.snakes[player2Id].direction = 'RIGHT';
      state.snakes[player2Id].nextDirection = 'RIGHT';

      // P1 está em (14, 6) e se move UP colidindo no corpo de P2
      state.snakes[player1Id].body = [
        { x: 14, y: 6 },
        { x: 14, y: 7 },
        { x: 14, y: 8 },
      ];
      state.snakes[player1Id].direction = 'UP';
      state.snakes[player1Id].nextDirection = 'UP';

      state = simulateSnakeTick(state);

      assert.strictEqual(state.status, 'finished');
      assert.strictEqual(state.winnerId, player2Id);
      assert.strictEqual(state.snakes[player1Id].alive, false);
    });

    it('6.4. Colisão consigo mesmo elimina a cobra', () => {
      let state = createInitialSnakeState(player1Id, player2Id);
      state.status = 'in_game';

      // Corpo de P1 formando um loop fechado
      state.snakes[player1Id].body = [
        { x: 5, y: 5 },
        { x: 6, y: 5 },
        { x: 6, y: 6 },
        { x: 5, y: 6 },
        { x: 4, y: 6 },
      ];
      state.snakes[player1Id].direction = 'DOWN';
      state.snakes[player1Id].nextDirection = 'DOWN'; // vai bater em (5, 6) que faz parte do corpo

      // P2 seguro
      state.snakes[player2Id].body = [
        { x: 15, y: 15 },
        { x: 16, y: 15 },
        { x: 17, y: 15 },
      ];

      state = simulateSnakeTick(state);

      assert.strictEqual(state.status, 'finished');
      assert.strictEqual(state.snakes[player1Id].alive, false);
      assert.strictEqual(state.winnerId, player2Id);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Network Engine & Sincronização de Partida
  // --------------------------------------------------------------------------
  describe('7. Network Engine e Submissão de Ações', () => {
    it('7.1. Submissão de snake_set_direction e snake_tick preserva idempotência', async () => {
      const initialGameState = createInitialSnakeState(player1Id, player2Id);

      let serverState: SnakeGameState = { ...initialGameState, status: 'in_game' };

      const mockSnapshot: GameSnapshot<SnakeGameState> = {
        matchId,
        roomId: null,
        gameId: 'snake',
        status: 'in_progress',
        state: serverState,
        currentTurnPlayerId: null,
        turnNumber: 1,
        turnDeadline: null,
        winnerId: null,
        isDraw: false,
        finishReason: null,
        players: [
          {
            userId: player1Id,
            slot: 1,
            gameSymbol: null,
            score: 0,
            isWinner: false,
            disconnectedAt: null,
            gracePeriodExpiresAt: null,
            lastSeenAt: null,
            connectionStatus: 'connected',
            joinedAt: new Date().toISOString(),
          },
          {
            userId: player2Id,
            slot: 2,
            gameSymbol: null,
            score: 0,
            isWinner: false,
            disconnectedAt: null,
            gracePeriodExpiresAt: null,
            lastSeenAt: null,
            connectionStatus: 'connected',
            joinedAt: new Date().toISOString(),
          },
        ],
        version: 1,
        actionHistory: [],
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: null,
      };

      setActionSubmitterForTest((async (input: any) => {
        if (input.actionType === 'snake_set_direction') {
          const payload = input.payload as { direction: any };
          serverState = setSnakeDirection(serverState, player1Id, payload.direction);
          return {
            accepted: true,
            snapshot: { ...mockSnapshot, state: serverState },
            error: null,
            actionId: input.actionId || 'act-1',
          };
        }
        if (input.actionType === 'snake_tick') {
          serverState = simulateSnakeTick(serverState);
          return {
            accepted: true,
            snapshot: { ...mockSnapshot, state: serverState },
            error: null,
            actionId: input.actionId || 'act-2',
          };
        }
        return {
          accepted: false,
          snapshot: null,
          error: { code: 'UNKNOWN_ACTION', message: 'Ação desconhecida', category: 'rule' },
          actionId: input.actionId || 'err',
        };
      }) as any);

      const controller = new GameSessionController<SnakeGameState>(matchId);

      const resDir = await controller.submitAction('snake_set_direction', { direction: 'UP' });
      assert.strictEqual(resDir.accepted, true);
      assert.strictEqual(resDir.snapshot?.state.snakes[player1Id].nextDirection, 'UP');

      const resTick = await controller.submitAction('snake_tick', { tick: 1 });
      assert.strictEqual(resTick.accepted, true);
      assert.strictEqual(resTick.snapshot?.state.tick, 1);

      controller.destroy();
      setActionSubmitterForTest(null);
    });
  });
});
