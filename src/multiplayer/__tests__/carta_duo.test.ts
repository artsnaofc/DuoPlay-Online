// ============================================================================
// Unit & Integration Tests: Carta Duo (Phase 20) — DuoPlay-Online
// Description: Testes autoritativos de validação das regras de jogo do Carta Duo,
//              distribuição, turnos, acúmulo de cartas de compra, efeitos de cartas,
//              sentido de turno, encerramento com vencedor e segurança de validações.
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameSessionController } from '../controllers/GameSessionController';
import { setSnapshotFetcherForTest } from '../network/snapshot';
import { setActionSubmitterForTest, generateActionId } from '../network/actions';
import { clearSyncQueuesForTest, reconnectMatch } from '../network/sync';
import type { GameSnapshot, SubmitActionInput, ActionResult } from '../network/types';

interface CartaDuoState {
  config: {
    initial_cards?: number;
    cumulative_draw?: boolean;
    force_draw?: boolean;
    play_immediately?: boolean;
    turn_timer?: number;
  };
  deck?: string[];
  discard_pile?: string[];
  hands?: Record<string, string[]>;
  active_color?: 'red' | 'blue' | 'green' | 'yellow' | 'wild';
  active_value?: string;
  direction?: number;
  turn_order?: string[];
  current_turn_player_id?: string | null;
  pending_draws?: number;
  winner_id?: string | null;
  is_finished?: boolean;
}

// Helper para construir snapshots de teste de Carta Duo
function createCartaDuoSnapshot(params: {
  matchId: string;
  turnNumber: number;
  currentTurnPlayerId: string | null;
  status?: 'in_progress' | 'finished' | 'abandoned';
  winnerId?: string | null;
  hands?: Record<string, string[]>;
  deck?: string[];
  discardPile?: string[];
  activeColor?: 'red' | 'blue' | 'green' | 'yellow' | 'wild';
  activeValue?: string;
  direction?: number;
  turnOrder?: string[];
  pendingDraws?: number;
  config?: any;
}): GameSnapshot<CartaDuoState> {
  const playersIds = params.turnOrder || ['u-1', 'u-2', 'u-3'];
  const p1 = playersIds[0];
  const p2 = playersIds[1];
  const p3 = playersIds[2];

  const defaultHands: Record<string, string[]> = {
    [p1]: ['red:5', 'blue:7', 'wild:color'],
    [p2]: ['red:2', 'yellow:skip', 'green:reverse'],
    [p3]: ['blue:draw2', 'yellow:9', 'wild:draw4'],
  };

  const defaultDeck = ['red:1', 'blue:3', 'green:4', 'yellow:8', 'red:draw2'];
  const defaultDiscard = ['red:3'];

  const gameState: CartaDuoState = {
    config: params.config || {
      initial_cards: 7,
      cumulative_draw: true,
      force_draw: true,
      play_immediately: true,
      turn_timer: 30,
    },
    deck: params.deck || defaultDeck,
    discard_pile: params.discardPile || defaultDiscard,
    hands: params.hands || defaultHands,
    active_color: params.activeColor || 'red',
    active_value: params.activeValue || '3',
    direction: typeof params.direction === 'number' ? params.direction : 1,
    turn_order: playersIds,
    current_turn_player_id: params.currentTurnPlayerId,
    pending_draws: params.pendingDraws || 0,
    winner_id: params.winnerId || null,
    is_finished: params.status === 'finished',
  };

  return {
    matchId: params.matchId,
    roomId: 'r-00000000-0000-4000-8000-000000000100',
    gameId: 'carta_duo',
    status: params.status || 'in_progress',
    state: gameState,
    currentTurnPlayerId: params.currentTurnPlayerId,
    turnNumber: params.turnNumber,
    turnDeadline: null,
    winnerId: params.winnerId || null,
    isDraw: false,
    finishReason: params.status === 'finished' ? 'normal' : null,
    players: playersIds.map((userId, idx) => ({
      userId,
      slot: idx + 1,
      gameSymbol: null,
      score: 0,
      isWinner: params.winnerId === userId,
      disconnectedAt: null,
      gracePeriodExpiresAt: null,
      lastSeenAt: '2026-10-06T00:00:00Z',
      connectionStatus: 'connected',
      joinedAt: '2026-10-06T00:00:00Z',
    })),
    version: params.turnNumber,
    actionHistory: [],
    createdAt: '2026-10-06T00:00:00Z',
    startedAt: '2026-10-06T00:00:00Z',
    finishedAt: params.status === 'finished' ? '2026-10-06T00:05:00Z' : null,
  };
}

describe('Fase 20: Carta Duo — Regras de Jogo e Sincronização de Turnos', () => {
  beforeEach(() => {
    clearSyncQueuesForTest();
  });

  afterEach(() => {
    setSnapshotFetcherForTest(null);
    setActionSubmitterForTest(null);
  });

  // 1. Inicialização de Partida e Distribuição de Cartas
  it('1. Deve carregar corretamente o estado inicial da partida com mãos e baralho distribuídos', async () => {
    const matchId = 'cd-match-0001';
    const initialSnap = createCartaDuoSnapshot({
      matchId,
      turnNumber: 1,
      currentTurnPlayerId: 'u-1',
    });

    setSnapshotFetcherForTest(async () => initialSnap);

    const controller = new GameSessionController<CartaDuoState>(matchId);
    const snap = await controller.init();

    assert.ok(snap);
    assert.strictEqual(snap.gameId, 'carta_duo');
    assert.strictEqual(snap.status, 'in_progress');
    assert.ok(snap.state.hands);
    assert.ok(snap.state.deck);
    assert.ok(snap.state.discard_pile);
    assert.strictEqual(snap.state.hands['u-1'].length, 3);
    assert.strictEqual(snap.state.active_color, 'red');
    assert.strictEqual(snap.state.active_value, '3');

    controller.destroy();
  });

  // 2. Validação de Turno: Jogar carta válida
  it('2. Deve permitir que o jogador da vez jogue uma carta compatível por cor', async () => {
    const matchId = 'cd-match-0002';
    const player1Id = 'u-1';
    const player2Id = 'u-2';

    const snapTurn1 = createCartaDuoSnapshot({
      matchId,
      turnNumber: 1,
      currentTurnPlayerId: player1Id,
      activeColor: 'red',
      activeValue: '3',
    });

    setSnapshotFetcherForTest(async () => snapTurn1);

    setActionSubmitterForTest(async (input: SubmitActionInput<any>): Promise<ActionResult<CartaDuoState>> => {
      const payload = input.payload;
      assert.strictEqual(payload.card, 'red:5');

      // Avança estado após o descarte bem-sucedido
      const updatedSnap = createCartaDuoSnapshot({
        matchId,
        turnNumber: 2,
        currentTurnPlayerId: player2Id,
        activeColor: 'red',
        activeValue: '5',
        discardPile: ['red:5', 'red:3'],
        hands: {
          'u-1': ['blue:7', 'wild:color'],
          'u-2': ['red:2', 'yellow:skip', 'green:reverse'],
          'u-3': ['blue:draw2', 'yellow:9', 'wild:draw4'],
        },
      });

      return {
        accepted: true,
        snapshot: updatedSnap,
        error: null,
        actionId: input.actionId || generateActionId(),
      };
    });

    const controller = new GameSessionController<CartaDuoState>(matchId);
    await controller.init();

    const res = await controller.submitAction('play_card', { card: 'red:5' });
    assert.strictEqual(res.accepted, true);
    assert.strictEqual(res.snapshot?.turnNumber, 2);
    assert.strictEqual(res.snapshot?.state.active_value, '5');
    assert.strictEqual(res.snapshot?.state.hands?.['u-1'].length, 2);

    controller.destroy();
  });

  // 3. Validação de Turno: Jogar carta inválida (fora do turno e incompatível)
  it('3. Deve rejeitar jogadas fora do turno ou com cartas incompatíveis', async () => {
    const matchId = 'cd-match-0003';
    const player1Id = 'u-1';
    const player2Id = 'u-2';

    const snapTurn1 = createCartaDuoSnapshot({
      matchId,
      turnNumber: 1,
      currentTurnPlayerId: player1Id,
      activeColor: 'blue',
      activeValue: '7',
    });

    setSnapshotFetcherForTest(async () => snapTurn1);

    setActionSubmitterForTest(async (input: SubmitActionInput<any>): Promise<ActionResult<CartaDuoState>> => {
      const payload = input.payload;
      
      if (input.actionType === 'play_card' && payload.playerId === player2Id) {
        return {
          accepted: false,
          snapshot: null,
          error: {
            code: 'NOT_YOUR_TURN',
            message: 'Não é seu turno.',
            category: 'authorization',
          },
          actionId: input.actionId || generateActionId(),
        };
      }

      if (payload.card === 'red:5') { // Tentativa de jogar vermelho sobre azul:7
        return {
          accepted: false,
          snapshot: null,
          error: {
            code: 'INVALID_CARD',
            message: 'A carta não corresponde à cor ou valor do topo.',
            category: 'rule',
          },
          actionId: input.actionId || generateActionId(),
        };
      }

      return { accepted: true, snapshot: null, error: null, actionId: input.actionId || generateActionId() };
    });

    const controller = new GameSessionController<CartaDuoState>(matchId);
    await controller.init();

    // 1. Fora do turno (Player 2 tenta jogar)
    const outOfTurnRes = await controller.submitAction('play_card', { card: 'red:2', playerId: player2Id });
    assert.strictEqual(outOfTurnRes.accepted, false);
    assert.strictEqual(outOfTurnRes.error?.code, 'NOT_YOUR_TURN');

    // 2. Carta incompatível (Player 1 tenta jogar Vermelho:5 sobre Azul:7)
    const invalidCardRes = await controller.submitAction('play_card', { card: 'red:5', playerId: player1Id });
    assert.strictEqual(invalidCardRes.accepted, false);
    assert.strictEqual(invalidCardRes.error?.code, 'INVALID_CARD');

    controller.destroy();
  });

  // 4. Compra e acúmulo de cartas de compra (+2/+4)
  it('4. Deve processar corretamente o acúmulo de efeitos de compra de cartas', async () => {
    const matchId = 'cd-match-0004';
    const player1Id = 'u-1';

    // Player 1 inicia o turno com 2 compras pendentes (+2 jogado anteriormente)
    const snapTurnWithDraws = createCartaDuoSnapshot({
      matchId,
      turnNumber: 3,
      currentTurnPlayerId: player1Id,
      activeColor: 'blue',
      activeValue: 'draw2',
      pendingDraws: 2,
    });

    setSnapshotFetcherForTest(async () => snapTurnWithDraws);

    setActionSubmitterForTest(async (input: SubmitActionInput<any>): Promise<ActionResult<CartaDuoState>> => {
      // Jogador escolhe comprar para cumprir o acúmulo
      const updatedSnap = createCartaDuoSnapshot({
        matchId,
        turnNumber: 4,
        currentTurnPlayerId: 'u-2', // Passa vez ao Player 2
        activeColor: 'blue',
        activeValue: 'draw2',
        pendingDraws: 0, // Zera pendências
        hands: {
          'u-1': ['red:5', 'blue:7', 'wild:color', 'red:1', 'blue:3'], // Recebeu 2 cartas
          'u-2': ['red:2', 'yellow:skip', 'green:reverse'],
          'u-3': ['blue:draw2', 'yellow:9', 'wild:draw4'],
        },
      });

      return {
        accepted: true,
        snapshot: updatedSnap,
        error: null,
        actionId: input.actionId || generateActionId(),
      };
    });

    const controller = new GameSessionController<CartaDuoState>(matchId);
    await controller.init();

    const res = await controller.submitAction('draw_card', {});
    assert.strictEqual(res.accepted, true);
    assert.strictEqual(res.snapshot?.state.pending_draws, 0);
    assert.strictEqual(res.snapshot?.state.hands?.['u-1'].length, 5); // 3 iniciais + 2 compradas
    assert.strictEqual(res.snapshot?.currentTurnPlayerId, 'u-2');

    controller.destroy();
  });

  // 5. Passar turno após compra (se configurado)
  it('5. Deve permitir passar o turno após comprar uma carta se nenhuma jogada for feita', async () => {
    const matchId = 'cd-match-0005';
    const player1Id = 'u-1';

    const snapDraw = createCartaDuoSnapshot({
      matchId,
      turnNumber: 2,
      currentTurnPlayerId: player1Id,
      activeColor: 'yellow',
      activeValue: '9',
    });

    setSnapshotFetcherForTest(async () => snapDraw);

    setActionSubmitterForTest(async (input: SubmitActionInput<any>): Promise<ActionResult<CartaDuoState>> => {
      assert.strictEqual(input.actionType, 'end_turn');

      const updatedSnap = createCartaDuoSnapshot({
        matchId,
        turnNumber: 3,
        currentTurnPlayerId: 'u-2',
        activeColor: 'yellow',
        activeValue: '9',
      });

      return {
        accepted: true,
        snapshot: updatedSnap,
        error: null,
        actionId: input.actionId || generateActionId(),
      };
    });

    const controller = new GameSessionController<CartaDuoState>(matchId);
    await controller.init();

    const res = await controller.submitAction('end_turn', {});
    assert.strictEqual(res.accepted, true);
    assert.strictEqual(res.snapshot?.currentTurnPlayerId, 'u-2');

    controller.destroy();
  });

  // 6. Efeitos Especiais: Skip e Reverse (Sentido de turno)
  it('6. Deve processar corretamente os efeitos de Skip e Reverse', async () => {
    const matchId = 'cd-match-0006';
    const player1Id = 'u-1';
    const player2Id = 'u-2';
    const player3Id = 'u-3';

    // 1. Skip: Pula o próximo jogador
    const snapSkip = createCartaDuoSnapshot({
      matchId,
      turnNumber: 5,
      currentTurnPlayerId: player2Id, // Vez do Player 2
      turnOrder: [player1Id, player2Id, player3Id],
    });

    setSnapshotFetcherForTest(async () => snapSkip);

    setActionSubmitterForTest(async (input: SubmitActionInput<any>): Promise<ActionResult<CartaDuoState>> => {
      // Player 2 descarta 'yellow:skip'. Próximo seria Player 3, mas é pulado, indo para Player 1
      const updatedSnap = createCartaDuoSnapshot({
        matchId,
        turnNumber: 6,
        currentTurnPlayerId: player1Id,
        activeColor: 'yellow',
        activeValue: 'skip',
        turnOrder: [player1Id, player2Id, player3Id],
      });

      return {
        accepted: true,
        snapshot: updatedSnap,
        error: null,
        actionId: input.actionId || generateActionId(),
      };
    });

    const controller = new GameSessionController<CartaDuoState>(matchId);
    await controller.init();

    const skipRes = await controller.submitAction('play_card', { card: 'yellow:skip' });
    assert.strictEqual(skipRes.accepted, true);
    assert.strictEqual(skipRes.snapshot?.currentTurnPlayerId, player1Id, 'O Player 3 deve ser pulado e a vez ir direto para o Player 1');

    controller.destroy();
  });

  // 7. Reversão de Sentido de Turno
  it('7. Deve inverter o sentido de turnos do jogo de forma apropriada', async () => {
    const matchId = 'cd-match-0007';
    const player1Id = 'u-1';
    const player2Id = 'u-2';
    const player3Id = 'u-3';

    const snapReverse = createCartaDuoSnapshot({
      matchId,
      turnNumber: 4,
      currentTurnPlayerId: player2Id,
      direction: 1, // Sentido horário (1 -> 2 -> 3)
      turnOrder: [player1Id, player2Id, player3Id],
    });

    setSnapshotFetcherForTest(async () => snapReverse);

    setActionSubmitterForTest(async (input: SubmitActionInput<any>): Promise<ActionResult<CartaDuoState>> => {
      // Player 2 descarta 'green:reverse'. Como o sentido era horário, agora vai para anti-horário e o próximo é o Player 1
      const updatedSnap = createCartaDuoSnapshot({
        matchId,
        turnNumber: 5,
        currentTurnPlayerId: player1Id,
        activeColor: 'green',
        activeValue: 'reverse',
        direction: -1, // Sentido anti-horário agora
        turnOrder: [player1Id, player2Id, player3Id],
      });

      return {
        accepted: true,
        snapshot: updatedSnap,
        error: null,
        actionId: input.actionId || generateActionId(),
      };
    });

    const controller = new GameSessionController<CartaDuoState>(matchId);
    await controller.init();

    const revRes = await controller.submitAction('play_card', { card: 'green:reverse' });
    assert.strictEqual(revRes.accepted, true);
    assert.strictEqual(revRes.snapshot?.state.direction, -1);
    assert.strictEqual(revRes.snapshot?.currentTurnPlayerId, player1Id);

    controller.destroy();
  });

  // 8. Fim do jogo com Vencedor Oficial
  it('8. Deve encerrar a partida quando a mão de um jogador estiver vazia', async () => {
    const matchId = 'cd-match-0008';
    const player1Id = 'u-1';

    // Player 1 tem apenas uma carta na mão ('red:5')
    const snapLastCard = createCartaDuoSnapshot({
      matchId,
      turnNumber: 10,
      currentTurnPlayerId: player1Id,
      hands: {
        'u-1': ['red:5'],
        'u-2': ['red:2', 'yellow:skip'],
        'u-3': ['blue:draw2'],
      },
    });

    setSnapshotFetcherForTest(async () => snapLastCard);

    setActionSubmitterForTest(async (input: SubmitActionInput<any>): Promise<ActionResult<CartaDuoState>> => {
      // Descarte da última carta finaliza a partida com Player 1 como vencedor
      const updatedSnap = createCartaDuoSnapshot({
        matchId,
        turnNumber: 11,
        currentTurnPlayerId: null,
        status: 'finished',
        winnerId: player1Id,
        discardPile: ['red:5'],
        hands: {
          'u-1': [], // Vazia!
          'u-2': ['red:2', 'yellow:skip'],
          'u-3': ['blue:draw2'],
        },
      });

      return {
        accepted: true,
        snapshot: updatedSnap,
        error: null,
        actionId: input.actionId || generateActionId(),
      };
    });

    const controller = new GameSessionController<CartaDuoState>(matchId);
    await controller.init();

    const finishRes = await controller.submitAction('play_card', { card: 'red:5' });
    assert.strictEqual(finishRes.accepted, true);
    assert.strictEqual(finishRes.snapshot?.status, 'finished');
    assert.strictEqual(finishRes.snapshot?.winnerId, player1Id);
    assert.strictEqual(finishRes.snapshot?.state.hands?.['u-1'].length, 0);

    controller.destroy();
  });
});
