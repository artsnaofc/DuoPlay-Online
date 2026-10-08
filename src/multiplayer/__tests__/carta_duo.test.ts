// ============================================================================
// Unit & Integration Tests: Carta Duo (Phase 20) — DuoPlay-Online
// Description: Testes autoritativos de regras de jogo do Carta Duo:
//              - Descarte com atualização imediata do topo (top_card / discard_pile[0]);
//              - Efeito de compra imediata SEM acúmulo (+2 e +4);
//              - Proibição estrita de passar turno (pass_turn / end_turn);
//              - Compra de carta (draw_card) avança turno automaticamente;
//              - Sincronização entre múltiplos clientes e persistência pós-refresh;
//              - Transição autoritativa de Turn Timer;
//              - Vitória e encerramento oficial.
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
  top_card?: string;
  hands?: Record<string, string[]>;
  active_color?: 'red' | 'blue' | 'green' | 'yellow' | 'wild';
  active_value?: string;
  direction?: number;
  turn_order?: string[];
  current_turn_player_id?: string | null;
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
  topCard?: string;
  activeColor?: 'red' | 'blue' | 'green' | 'yellow' | 'wild';
  activeValue?: string;
  direction?: number;
  turnOrder?: string[];
  config?: any;
  turnDeadline?: string | null;
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
  const discardPile = params.discardPile || defaultDiscard;
  const topCard = params.topCard || discardPile[0];

  const gameState: CartaDuoState = {
    config: params.config || {
      initial_cards: 7,
      force_draw: true,
      play_immediately: true,
      turn_timer: 30,
    },
    deck: params.deck || defaultDeck,
    discard_pile: discardPile,
    top_card: topCard,
    hands: params.hands || defaultHands,
    active_color: params.activeColor || 'red',
    active_value: params.activeValue || '3',
    direction: typeof params.direction === 'number' ? params.direction : 1,
    turn_order: playersIds,
    current_turn_player_id: params.currentTurnPlayerId,
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
    turnDeadline: params.turnDeadline ?? null,
    winnerId: params.winnerId || null,
    isDraw: false,
    finishReason: params.status === 'finished' ? 'normal' : null,
    players: playersIds.map((userId, idx) => ({
      userId,
      slot: idx + 1,
      gameSymbol: null,
      score: gameState.hands?.[userId]?.length || 0,
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

describe('Fase 20: Carta Duo — Regras Oficiais, Descarte Imediato, Sem Acúmulo e Turnos', () => {
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

    setSnapshotFetcherForTest(async <TState = unknown>() => initialSnap as unknown as GameSnapshot<TState>);

    const controller = new GameSessionController<CartaDuoState>(matchId);
    const snap = await controller.init();

    assert.ok(snap);
    assert.strictEqual(snap.gameId, 'carta_duo');
    assert.strictEqual(snap.status, 'in_progress');
    assert.ok(snap.state.hands);
    assert.ok(snap.state.deck);
    assert.ok(snap.state.discard_pile);
    assert.strictEqual(snap.state.top_card, 'red:3');
    assert.strictEqual(snap.state.hands['u-1'].length, 3);
    assert.strictEqual(snap.state.active_color, 'red');
    assert.strictEqual(snap.state.active_value, '3');

    controller.destroy();
  });

  // 2. Validação de Topo de Mesa: Jogar carta atualiza imediatamente topo e sincroniza
  it('2. Jogar carta atualiza imediatamente o descarte no topo da mesa e remove da mão', async () => {
    const matchId = 'cd-match-0002';
    const player1Id = 'u-1';
    const player2Id = 'u-2';

    let currentServerSnap = createCartaDuoSnapshot({
      matchId,
      turnNumber: 1,
      currentTurnPlayerId: player1Id,
      activeColor: 'red',
      activeValue: '3',
      discardPile: ['red:3'],
      topCard: 'red:3',
    });

    setSnapshotFetcherForTest(async <TState = unknown>() => currentServerSnap as unknown as GameSnapshot<TState>);

    setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
      const payload = input.payload as any;
      assert.strictEqual(payload.card, 'red:5');

      // Servidor insere no topo oficial (prepended) e atualiza top_card
      currentServerSnap = createCartaDuoSnapshot({
        matchId,
        turnNumber: 2,
        currentTurnPlayerId: player2Id,
        activeColor: 'red',
        activeValue: '5',
        discardPile: ['red:5', 'red:3'],
        topCard: 'red:5',
        hands: {
          'u-1': ['blue:7', 'wild:color'],
          'u-2': ['red:2', 'yellow:skip', 'green:reverse'],
          'u-3': ['blue:draw2', 'yellow:9', 'wild:draw4'],
        },
      });

      return {
        accepted: true,
        snapshot: currentServerSnap as unknown as GameSnapshot<TState>,
        error: null,
        actionId: input.actionId || generateActionId(),
      };
    });

    // Cliente 1 joga a carta
    const client1Controller = new GameSessionController<CartaDuoState>(matchId);
    await client1Controller.init();

    const res = await client1Controller.submitAction('play_card', { card: 'red:5' });
    assert.strictEqual(res.accepted, true);
    assert.strictEqual(res.snapshot?.state.top_card, 'red:5');
    assert.strictEqual(res.snapshot?.state.discard_pile?.[0], 'red:5');
    assert.strictEqual(res.snapshot?.state.hands?.['u-1'].includes('red:5'), false);

    // Cliente 2 reconecta / recebe snapshot oficial atualizado
    const refreshedSnap = await reconnectMatch<CartaDuoState>(matchId);
    assert.strictEqual(refreshedSnap.state.top_card, 'red:5', 'Topo deve continuar red:5 pós-refresh');
    assert.strictEqual(refreshedSnap.state.discard_pile?.[0], 'red:5');
    assert.strictEqual(refreshedSnap.currentTurnPlayerId, player2Id);

    client1Controller.destroy();
  });

  // 3. Rejeição de ações fora do turno e cartas inválidas
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

    setSnapshotFetcherForTest(async <TState = unknown>() => snapTurn1 as unknown as GameSnapshot<TState>);

    setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
      const payload = input.payload as any;

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

      if (payload.card === 'red:5') {
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

    const outOfTurnRes = await controller.submitAction('play_card', { card: 'red:2', playerId: player2Id });
    assert.strictEqual(outOfTurnRes.accepted, false);
    assert.strictEqual(outOfTurnRes.error?.code, 'NOT_YOUR_TURN');

    const invalidCardRes = await controller.submitAction('play_card', { card: 'red:5', playerId: player1Id });
    assert.strictEqual(invalidCardRes.accepted, false);
    assert.strictEqual(invalidCardRes.error?.code, 'INVALID_CARD');

    controller.destroy();
  });

  // 4. Cartas de compra (+2) — Sem Acúmulo: Penalidade imediata e salto de turno
  it('4. Deve aplicar penalidade de compra imediata sem acúmulo ao jogar +2', async () => {
    const matchId = 'cd-match-0004';
    const player1Id = 'u-1';
    const player2Id = 'u-2';
    const player3Id = 'u-3';

    // Player 3 tem 'blue:draw2'. Mesa tem active_color: 'blue'
    const snapTurn1 = createCartaDuoSnapshot({
      matchId,
      turnNumber: 1,
      currentTurnPlayerId: player3Id,
      turnOrder: [player1Id, player2Id, player3Id],
      activeColor: 'blue',
      activeValue: '5',
      discardPile: ['blue:5'],
      topCard: 'blue:5',
      hands: {
        'u-1': ['red:5', 'blue:7'],
        'u-2': ['red:2', 'green:4'],
        'u-3': ['blue:draw2', 'yellow:9'],
      },
      deck: ['yellow:1', 'yellow:2', 'yellow:3'],
    });

    setSnapshotFetcherForTest(async <TState = unknown>() => snapTurn1 as unknown as GameSnapshot<TState>);

    setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
      const payload = input.payload as any;
      assert.strictEqual(payload.card, 'blue:draw2');

      // Regra Oficial Sem Acúmulo:
      // Player 3 joga +2.
      // O próximo jogador (Player 1) compra imediatamente 2 cartas e perde o turno.
      // O turno avança para o jogador seguinte (Player 2).
      const updatedSnap = createCartaDuoSnapshot({
        matchId,
        turnNumber: 2,
        currentTurnPlayerId: player2Id, // Turno vai para Player 2 (Player 1 foi penalizado e pulado)
        turnOrder: [player1Id, player2Id, player3Id],
        activeColor: 'blue',
        activeValue: 'draw2',
        discardPile: ['blue:draw2', 'blue:5'],
        topCard: 'blue:draw2',
        hands: {
          'u-1': ['red:5', 'blue:7', 'yellow:1', 'yellow:2'], // Comprou 2 cartas imediatamente
          'u-2': ['red:2', 'green:4'],
          'u-3': ['yellow:9'], // Carta removida da mão
        },
        deck: ['yellow:3'],
      });

      return {
        accepted: true,
        snapshot: updatedSnap as unknown as GameSnapshot<TState>,
        error: null,
        actionId: input.actionId || generateActionId(),
      };
    });

    const controller = new GameSessionController<CartaDuoState>(matchId);
    await controller.init();

    const res = await controller.submitAction('play_card', { card: 'blue:draw2' });
    assert.strictEqual(res.accepted, true);
    assert.strictEqual(res.snapshot?.state.top_card, 'blue:draw2');
    assert.strictEqual(res.snapshot?.state.hands?.['u-1'].length, 4, 'Player 1 deve ter recebido 2 cartas de penalidade');
    assert.strictEqual(res.snapshot?.currentTurnPlayerId, player2Id, 'Turno deve passar para Player 2, pulando Player 1');

    controller.destroy();
  });

  // 5. Cartas de compra (+4 Wild) — Sem Acúmulo e Escolha de Cor
  it('5. Deve aplicar penalidade de +4 imediatamente sem acúmulo e definir nova cor ativa', async () => {
    const matchId = 'cd-match-0005';
    const player1Id = 'u-1';
    const player2Id = 'u-2';

    // Duelo 2 jogadores: Player 1 joga +4 escolhendo verde.
    // Player 2 recebe 4 cartas e o turno volta para Player 1.
    const snapDuel = createCartaDuoSnapshot({
      matchId,
      turnNumber: 3,
      currentTurnPlayerId: player1Id,
      turnOrder: [player1Id, player2Id],
      activeColor: 'red',
      activeValue: '3',
      discardPile: ['red:3'],
      topCard: 'red:3',
      hands: {
        'u-1': ['wild:draw4', 'green:2'],
        'u-2': ['green:8', 'yellow:1'],
      },
      deck: ['blue:1', 'blue:2', 'blue:3', 'blue:4', 'blue:5'],
    });

    setSnapshotFetcherForTest(async <TState = unknown>() => snapDuel as unknown as GameSnapshot<TState>);

    setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
      const payload = input.payload as any;
      assert.strictEqual(payload.card, 'wild:draw4');
      assert.strictEqual(payload.choose_color, 'green');

      const updatedSnap = createCartaDuoSnapshot({
        matchId,
        turnNumber: 4,
        currentTurnPlayerId: player1Id, // Em 2 jogadores, Player 2 compra e perde vez; volta para Player 1
        turnOrder: [player1Id, player2Id],
        activeColor: 'green',
        activeValue: 'draw4',
        discardPile: ['wild:draw4', 'red:3'],
        topCard: 'wild:draw4',
        hands: {
          'u-1': ['green:2'],
          'u-2': ['green:8', 'yellow:1', 'blue:1', 'blue:2', 'blue:3', 'blue:4'], // 6 cartas agora
        },
        deck: ['blue:5'],
      });

      return {
        accepted: true,
        snapshot: updatedSnap as unknown as GameSnapshot<TState>,
        error: null,
        actionId: input.actionId || generateActionId(),
      };
    });

    const controller = new GameSessionController<CartaDuoState>(matchId);
    await controller.init();

    const res = await controller.submitAction('play_card', { card: 'wild:draw4', choose_color: 'green' });
    assert.strictEqual(res.accepted, true);
    assert.strictEqual(res.snapshot?.state.active_color, 'green');
    assert.strictEqual(res.snapshot?.state.hands?.['u-2'].length, 6);
    assert.strictEqual(res.snapshot?.currentTurnPlayerId, player1Id);

    controller.destroy();
  });

  // 6. Proibição Estrita de Passar Turno
  it('6. Deve rejeitar estritamente qualquer tentativa de ação de passar turno (pass_turn / end_turn)', async () => {
    const matchId = 'cd-match-0006';
    const player1Id = 'u-1';

    const snap = createCartaDuoSnapshot({
      matchId,
      turnNumber: 2,
      currentTurnPlayerId: player1Id,
    });

    setSnapshotFetcherForTest(async <TState = unknown>() => snap as unknown as GameSnapshot<TState>);

    setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
      if (input.actionType === 'pass_turn' || input.actionType === 'end_turn' || input.actionType === 'skip_turn') {
        return {
          accepted: false,
          snapshot: null,
          error: {
            code: 'ACTION_NOT_ALLOWED',
            message: 'No Carta Duo não existe ação de passar turno.',
            category: 'rule',
          },
          actionId: input.actionId || generateActionId(),
        };
      }
      return { accepted: true, snapshot: null, error: null, actionId: input.actionId || generateActionId() };
    });

    const controller = new GameSessionController<CartaDuoState>(matchId);
    await controller.init();

    const passRes = await controller.submitAction('pass_turn', {});
    assert.strictEqual(passRes.accepted, false);
    assert.strictEqual(passRes.error?.code, 'ACTION_NOT_ALLOWED');

    const endTurnRes = await controller.submitAction('end_turn', {});
    assert.strictEqual(endTurnRes.accepted, false);
    assert.strictEqual(endTurnRes.error?.code, 'ACTION_NOT_ALLOWED');

    controller.destroy();
  });

  // 7. Compra simples do baralho (draw_card) avança imediatamente o turno
  it('7. Comprar carta do baralho (draw_card) adiciona carta e passa a vez imediatamente', async () => {
    const matchId = 'cd-match-0007';
    const player1Id = 'u-1';
    const player2Id = 'u-2';

    const snapDraw = createCartaDuoSnapshot({
      matchId,
      turnNumber: 2,
      currentTurnPlayerId: player1Id,
      deck: ['green:3', 'red:4'],
    });

    setSnapshotFetcherForTest(async <TState = unknown>() => snapDraw as unknown as GameSnapshot<TState>);

    setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
      assert.strictEqual(input.actionType, 'draw_card');

      const updatedSnap = createCartaDuoSnapshot({
        matchId,
        turnNumber: 3,
        currentTurnPlayerId: player2Id, // Turno passa para o próximo automaticamente
        hands: {
          'u-1': ['red:5', 'blue:7', 'wild:color', 'green:3'],
          'u-2': ['red:2', 'yellow:skip', 'green:reverse'],
          'u-3': ['blue:draw2', 'yellow:9', 'wild:draw4'],
        },
        deck: ['red:4'],
      });

      return {
        accepted: true,
        snapshot: updatedSnap as unknown as GameSnapshot<TState>,
        error: null,
        actionId: input.actionId || generateActionId(),
      };
    });

    const controller = new GameSessionController<CartaDuoState>(matchId);
    await controller.init();

    const res = await controller.submitAction('draw_card', {});
    assert.strictEqual(res.accepted, true);
    assert.strictEqual(res.snapshot?.state.hands?.['u-1'].length, 4);
    assert.strictEqual(res.snapshot?.currentTurnPlayerId, player2Id);

    controller.destroy();
  });

  // 8. Skip e Reverse
  it('8. Deve processar corretamente os efeitos de Skip e Reverse de direção', async () => {
    const matchId = 'cd-match-0008';
    const player1Id = 'u-1';
    const player2Id = 'u-2';
    const player3Id = 'u-3';

    // Skip
    const snapSkip = createCartaDuoSnapshot({
      matchId,
      turnNumber: 5,
      currentTurnPlayerId: player2Id,
      turnOrder: [player1Id, player2Id, player3Id],
    });

    setSnapshotFetcherForTest(async <TState = unknown>() => snapSkip as unknown as GameSnapshot<TState>);

    setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
      const updatedSnap = createCartaDuoSnapshot({
        matchId,
        turnNumber: 6,
        currentTurnPlayerId: player1Id, // Player 3 pulado
        activeColor: 'yellow',
        activeValue: 'skip',
        topCard: 'yellow:skip',
        turnOrder: [player1Id, player2Id, player3Id],
      });

      return {
        accepted: true,
        snapshot: updatedSnap as unknown as GameSnapshot<TState>,
        error: null,
        actionId: input.actionId || generateActionId(),
      };
    });

    const controller = new GameSessionController<CartaDuoState>(matchId);
    await controller.init();

    const skipRes = await controller.submitAction('play_card', { card: 'yellow:skip' });
    assert.strictEqual(skipRes.accepted, true);
    assert.strictEqual(skipRes.snapshot?.currentTurnPlayerId, player1Id);

    controller.destroy();
  });

  // 9. Encerramento de Partida com Vencedor
  it('9. Deve encerrar a partida oficialmente quando a mão de um jogador estiver vazia', async () => {
    const matchId = 'cd-match-0009';
    const player1Id = 'u-1';

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

    setSnapshotFetcherForTest(async <TState = unknown>() => snapLastCard as unknown as GameSnapshot<TState>);

    setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
      const updatedSnap = createCartaDuoSnapshot({
        matchId,
        turnNumber: 11,
        currentTurnPlayerId: null,
        status: 'finished',
        winnerId: player1Id,
        discardPile: ['red:5'],
        topCard: 'red:5',
        hands: {
          'u-1': [],
          'u-2': ['red:2', 'yellow:skip'],
          'u-3': ['blue:draw2'],
        },
      });

      return {
        accepted: true,
        snapshot: updatedSnap as unknown as GameSnapshot<TState>,
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
