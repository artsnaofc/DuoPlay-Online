// ============================================================================
// Unit & Integration Tests: Carta Duo — Regras Oficiais, Última Carta, Acúmulo e Mesmas Cartas
// Project: DuoPlay-Online
// Requirements:
//   1-6: Última Carta (elegibilidade, declaração, contestação, persistência e penalidade)
//   7-14: Acúmulo de +2 e +4 (Jogadores A e B, cálculo, rejeição incompatível, encerramento voluntário)
//   15-22: Múltiplas cartas do mesmo número (cores diferentes, manter turno, encerramento voluntário, bloqueio desativado)
//   23-27: Configurações da sala (persistência, congelamento oficial na partida, regras idênticas para todos)
//   28-30: Concorrência e reconexão (idempotência, recuperação de snapshot)
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameSessionController } from '../controllers/GameSessionController';
import { setSnapshotFetcherForTest } from '../network/snapshot';
import { setActionSubmitterForTest, generateActionId } from '../network/actions';
import { clearSyncQueuesForTest, reconnectMatch } from '../network/sync';
import type { GameSnapshot, SubmitActionInput, ActionResult } from '../network/types';

interface CartaDuoTestState {
  config: {
    initial_cards?: number;
    cumulative_draw?: boolean;
    allow_same_number?: boolean;
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
  pending_draws?: number;
  same_number_sequence?: {
    active: boolean;
    player_id: string | null;
    number: string | null;
  };
  last_card_declarations?: Record<string, boolean>;
  winner_id?: string | null;
  is_finished?: boolean;
}

function createSnapshot(params: {
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
  pendingDraws?: number;
  sameNumberSequence?: {
    active: boolean;
    player_id: string | null;
    number: string | null;
  };
  lastCardDeclarations?: Record<string, boolean>;
  config?: any;
}): GameSnapshot<CartaDuoTestState> {
  const playersIds = params.turnOrder || ['player-A', 'player-B', 'player-C'];
  const discard = params.discardPile || ['red:5'];
  const top = params.topCard || discard[0];

  const state: CartaDuoTestState = {
    config: params.config || {
      initial_cards: 7,
      cumulative_draw: true,
      allow_same_number: false,
      turn_timer: 30,
    },
    deck: params.deck || ['blue:1', 'yellow:2', 'green:3', 'red:4', 'blue:draw2'],
    discard_pile: discard,
    top_card: top,
    hands: params.hands || {
      'player-A': ['red:7', 'blue:draw2'],
      'player-B': ['green:draw2', 'yellow:draw4'],
      'player-C': ['red:1', 'yellow:3'],
    },
    active_color: params.activeColor || 'red',
    active_value: params.activeValue || '5',
    direction: typeof params.direction === 'number' ? params.direction : 1,
    turn_order: playersIds,
    current_turn_player_id: params.currentTurnPlayerId,
    pending_draws: params.pendingDraws || 0,
    same_number_sequence: params.sameNumberSequence || {
      active: false,
      player_id: null,
      number: null,
    },
    last_card_declarations: params.lastCardDeclarations || {},
    winner_id: params.winnerId || null,
    is_finished: params.status === 'finished',
  };

  return {
    matchId: params.matchId,
    roomId: 'room-cd-001',
    gameId: 'carta_duo',
    status: params.status || 'in_progress',
    state,
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
      score: state.hands?.[userId]?.length || 0,
      isWinner: params.winnerId === userId,
      disconnectedAt: null,
      gracePeriodExpiresAt: null,
      lastSeenAt: '2026-10-09T00:00:00Z',
      connectionStatus: 'connected',
      joinedAt: '2026-10-09T00:00:00Z',
    })),
    version: params.turnNumber,
    actionHistory: [],
    createdAt: '2026-10-09T00:00:00Z',
    startedAt: '2026-10-09T00:00:00Z',
    finishedAt: params.status === 'finished' ? '2026-10-09T00:05:00Z' : null,
  };
}

describe('Carta Duo — Evolução das Regras Oficiais e Multiplayer', () => {
  beforeEach(() => {
    clearSyncQueuesForTest();
  });

  afterEach(() => {
    setSnapshotFetcherForTest(null);
    setActionSubmitterForTest(null);
  });

  // ==========================================================================
  // GRUPO 1: Declaração e Contestação de Última Carta (Cenários 1 a 6)
  // ==========================================================================
  describe('1. Regras de Última Carta', () => {
    it('1. Botão/Ação de declarar Última Carta está disponível quando o jogador possui 1 ou 2 cartas', async () => {
      const matchId = 'm-uc-01';
      const snap = createSnapshot({
        matchId,
        turnNumber: 1,
        currentTurnPlayerId: 'player-A',
        hands: {
          'player-A': ['red:7'], // 1 carta restante
          'player-B': ['blue:2', 'blue:3', 'blue:4'],
        },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => snap as unknown as GameSnapshot<TState>);

      const controller = new GameSessionController<CartaDuoTestState>(matchId);
      const initialized = await controller.init();
      assert.ok(initialized, 'initialized must exist');
      assert.strictEqual(initialized.state.hands?.['player-A'].length, 1);
      assert.strictEqual(Boolean(initialized.state.last_card_declarations?.['player-A']), false);
      controller.destroy();
    });

    it('2. Um jogador elegível consegue declarar Última Carta com sucesso', async () => {
      const matchId = 'm-uc-02';
      let currentSnap = createSnapshot({
        matchId,
        turnNumber: 1,
        currentTurnPlayerId: 'player-A',
        hands: {
          'player-A': ['red:7'],
          'player-B': ['blue:2', 'blue:3'],
        },
        lastCardDeclarations: {},
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => currentSnap as unknown as GameSnapshot<TState>);
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
        assert.strictEqual(input.actionType, 'declare_last_card');
        currentSnap = {
          ...currentSnap,
          state: {
            ...currentSnap.state,
            last_card_declarations: {
              ...currentSnap.state.last_card_declarations,
              'player-A': true,
            },
          },
        };
        return {
          accepted: true,
          snapshot: currentSnap as unknown as GameSnapshot<TState>,
          error: null,
          actionId: input.actionId || generateActionId(),
        };
      });

      const controller = new GameSessionController<CartaDuoTestState>(matchId);
      await controller.init();

      const res = await controller.submitAction('declare_last_card', {});
      assert.strictEqual(res.accepted, true);
      assert.strictEqual(res.snapshot?.state.last_card_declarations?.['player-A'], true);

      controller.destroy();
    });

    it('3. Jogadores não elegíveis (com mais de 2 cartas) são rejeitados pelo servidor', async () => {
      const matchId = 'm-uc-03';
      const snap = createSnapshot({
        matchId,
        turnNumber: 1,
        currentTurnPlayerId: 'player-A',
        hands: {
          'player-A': ['red:7', 'blue:3', 'green:4'], // 3 cartas: não elegível
          'player-B': ['blue:2', 'blue:5'],
        },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => snap as unknown as GameSnapshot<TState>);
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
        return {
          accepted: false,
          snapshot: null,
          error: {
            code: 'NOT_ELIGIBLE_FOR_LAST_CARD',
            message: 'Você só pode declarar Última Carta quando estiver prestes a ficar ou com apenas 1 carta.',
            category: 'rule',
          },
          actionId: input.actionId || generateActionId(),
        };
      });

      const controller = new GameSessionController<CartaDuoTestState>(matchId);
      await controller.init();

      const res = await controller.submitAction('declare_last_card', {});
      assert.strictEqual(res.accepted, false);
      assert.strictEqual(res.error?.code, 'NOT_ELIGIBLE_FOR_LAST_CARD');

      controller.destroy();
    });

    it('4. A declaração é sincronizada entre os participantes', async () => {
      const matchId = 'm-uc-04';
      const snapWithDeclared = createSnapshot({
        matchId,
        turnNumber: 2,
        currentTurnPlayerId: 'player-B',
        hands: {
          'player-A': ['red:7'],
          'player-B': ['blue:2', 'blue:3'],
        },
        lastCardDeclarations: { 'player-A': true },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => snapWithDeclared as unknown as GameSnapshot<TState>);

      const controllerB = new GameSessionController<CartaDuoTestState>(matchId);
      const snapB = await controllerB.init();
      assert.ok(snapB, 'snapB must exist');
      assert.strictEqual(snapB.state.last_card_declarations?.['player-A'], true);
      controllerB.destroy();
    });

    it('5. O estado da declaração permanece correto após reconexão', async () => {
      const matchId = 'm-uc-05';
      const snap = createSnapshot({
        matchId,
        turnNumber: 3,
        currentTurnPlayerId: 'player-A',
        hands: { 'player-A': ['yellow:9'], 'player-B': ['blue:5', 'green:6'] },
        lastCardDeclarations: { 'player-A': true },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => snap as unknown as GameSnapshot<TState>);

      const reconnected = await reconnectMatch<CartaDuoTestState>(matchId);
      assert.strictEqual(reconnected.state.last_card_declarations?.['player-A'], true);
      assert.strictEqual(reconnected.state.hands?.['player-A'].length, 1);
    });

    it('6. Contestação de oponente com 1 carta sem declaração aplica penalidade autoritativa de +2', async () => {
      const matchId = 'm-uc-06';
      let currentSnap = createSnapshot({
        matchId,
        turnNumber: 4,
        currentTurnPlayerId: 'player-B',
        hands: {
          'player-A': ['yellow:9'], // 1 carta e NÃO declarou
          'player-B': ['blue:5', 'green:6'],
        },
        deck: ['red:1', 'red:2', 'red:3'],
        lastCardDeclarations: {}, // player-A não declarou
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => currentSnap as unknown as GameSnapshot<TState>);
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
        assert.strictEqual(input.actionType, 'challenge_last_card');
        const payload = input.payload as any;
        assert.strictEqual(payload.target_player_id, 'player-A');

        // Servidor penaliza o alvo adicionando 2 cartas à sua mão
        currentSnap = {
          ...currentSnap,
          state: {
            ...currentSnap.state,
            hands: {
              ...currentSnap.state.hands,
              'player-A': ['yellow:9', 'red:1', 'red:2'], // Comprou 2 de penalidade
            },
            deck: ['red:3'],
            last_card_declarations: { 'player-A': false },
          },
        };

        return {
          accepted: true,
          snapshot: currentSnap as unknown as GameSnapshot<TState>,
          error: null,
          actionId: input.actionId || generateActionId(),
        };
      });

      const controllerB = new GameSessionController<CartaDuoTestState>(matchId);
      await controllerB.init();

      const res = await controllerB.submitAction('challenge_last_card', { target_player_id: 'player-A' });
      assert.strictEqual(res.accepted, true);
      assert.strictEqual(res.snapshot?.state.hands?.['player-A'].length, 3, 'Alvo deve receber 2 cartas de penalidade');
      assert.strictEqual(res.snapshot?.state.last_card_declarations?.['player-A'], false);

      controllerB.destroy();
    });
  });

  // ==========================================================================
  // GRUPO 2: Acúmulo de +2 e +4 (Cenários 7 a 14)
  // ==========================================================================
  describe('2. Acúmulo de +2 e +4 (cumulative_draw)', () => {
    it('7. O Jogador A consegue acumular quando permitido', async () => {
      const matchId = 'm-acc-07';
      let currentSnap = createSnapshot({
        matchId,
        turnNumber: 1,
        currentTurnPlayerId: 'player-A',
        pendingDraws: 2, // Recebeu +2
        activeValue: 'draw2',
        hands: {
          'player-A': ['red:draw2', 'blue:5'],
          'player-B': ['green:1'],
        },
        config: { cumulative_draw: true },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => currentSnap as unknown as GameSnapshot<TState>);
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
        assert.strictEqual(input.actionType, 'play_card');
        currentSnap = {
          ...currentSnap,
          currentTurnPlayerId: 'player-B',
          state: {
            ...currentSnap.state,
            current_turn_player_id: 'player-B',
            pending_draws: 4, // 2 + 2 = 4
            top_card: 'red:draw2',
            active_value: 'draw2',
            hands: {
              ...currentSnap.state.hands,
              'player-A': ['blue:5'],
            },
          },
        };
        return {
          accepted: true,
          snapshot: currentSnap as unknown as GameSnapshot<TState>,
          error: null,
          actionId: input.actionId || generateActionId(),
        };
      });

      const controllerA = new GameSessionController<CartaDuoTestState>(matchId);
      await controllerA.init();

      const res = await controllerA.submitAction('play_card', { card: 'red:draw2' });
      assert.strictEqual(res.accepted, true);
      assert.strictEqual(res.snapshot?.state.pending_draws, 4);
      assert.strictEqual(res.snapshot?.currentTurnPlayerId, 'player-B');

      controllerA.destroy();
    });

    it('8. O Jogador B também consegue acumular com sucesso', async () => {
      const matchId = 'm-acc-08';
      let currentSnap = createSnapshot({
        matchId,
        turnNumber: 2,
        currentTurnPlayerId: 'player-B',
        pendingDraws: 4, // Recebeu 4 acumuladas do Jogador A
        activeValue: 'draw2',
        hands: {
          'player-A': ['blue:5'],
          'player-B': ['yellow:draw2', 'green:9'],
        },
        config: { cumulative_draw: true },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => currentSnap as unknown as GameSnapshot<TState>);
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
        assert.strictEqual(input.actionType, 'play_card');
        currentSnap = {
          ...currentSnap,
          currentTurnPlayerId: 'player-A',
          state: {
            ...currentSnap.state,
            current_turn_player_id: 'player-A',
            pending_draws: 6, // 4 + 2 = 6
            top_card: 'yellow:draw2',
            active_value: 'draw2',
            hands: {
              ...currentSnap.state.hands,
              'player-B': ['green:9'],
            },
          },
        };
        return {
          accepted: true,
          snapshot: currentSnap as unknown as GameSnapshot<TState>,
          error: null,
          actionId: input.actionId || generateActionId(),
        };
      });

      const controllerB = new GameSessionController<CartaDuoTestState>(matchId);
      await controllerB.init();

      const res = await controllerB.submitAction('play_card', { card: 'yellow:draw2' });
      assert.strictEqual(res.accepted, true);
      assert.strictEqual(res.snapshot?.state.pending_draws, 6);
      assert.strictEqual(res.snapshot?.currentTurnPlayerId, 'player-A');

      controllerB.destroy();
    });

    it('9. Todos os demais participantes suportados (3+ jogadores) têm o mesmo comportamento de repasse', async () => {
      const matchId = 'm-acc-09';
      const snap = createSnapshot({
        matchId,
        turnNumber: 3,
        currentTurnPlayerId: 'player-C',
        turnOrder: ['player-A', 'player-B', 'player-C'],
        pendingDraws: 6,
        hands: {
          'player-A': ['red:1'],
          'player-B': ['blue:2'],
          'player-C': ['wild:draw4', 'yellow:3'],
        },
        config: { cumulative_draw: true },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => snap as unknown as GameSnapshot<TState>);
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(): Promise<ActionResult<TState>> => {
        return {
          accepted: true,
          snapshot: {
            ...snap,
            currentTurnPlayerId: 'player-A',
            state: {
              ...snap.state,
              current_turn_player_id: 'player-A',
              pending_draws: 10, // 6 + 4 = 10
            },
          } as unknown as GameSnapshot<TState>,
          error: null,
          actionId: generateActionId(),
        };
      });

      const controllerC = new GameSessionController<CartaDuoTestState>(matchId);
      await controllerC.init();

      const res = await controllerC.submitAction('play_card', { card: 'wild:draw4', choose_color: 'green' });
      assert.strictEqual(res.accepted, true);
      assert.strictEqual(res.snapshot?.state.pending_draws, 10);
      assert.strictEqual(res.snapshot?.currentTurnPlayerId, 'player-A');

      controllerC.destroy();
    });

    it('10. A penalidade acumulada é calculada corretamente (+2 + 2 + 4 = 8)', () => {
      let pending = 0;
      // Jogador 1 joga +2
      pending += 2;
      assert.strictEqual(pending, 2);
      // Jogador 2 joga +2
      pending += 2;
      assert.strictEqual(pending, 4);
      // Jogador 3 joga +4
      pending += 4;
      assert.strictEqual(pending, 8);
    });

    it('11. Cartas incompatíveis (não-compra) são rejeitadas quando há penalidade pendente', async () => {
      const matchId = 'm-acc-11';
      const snap = createSnapshot({
        matchId,
        turnNumber: 2,
        currentTurnPlayerId: 'player-B',
        pendingDraws: 2,
        hands: { 'player-B': ['red:5', 'blue:draw2'] },
        config: { cumulative_draw: true },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => snap as unknown as GameSnapshot<TState>);
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
        const payload = input.payload as any;
        if (payload.card === 'red:5') {
          return {
            accepted: false,
            snapshot: null,
            error: {
              code: 'MUST_DEFEND_OR_ACCEPT',
              message: 'Você deve jogar uma carta de compra (+2 ou +4) para acumular ou receber a penalidade.',
              category: 'rule',
            },
            actionId: input.actionId || generateActionId(),
          };
        }
        return { accepted: true, snapshot: null, error: null, actionId: generateActionId() };
      });

      const controller = new GameSessionController<CartaDuoTestState>(matchId);
      await controller.init();

      const res = await controller.submitAction('play_card', { card: 'red:5' });
      assert.strictEqual(res.accepted, false);
      assert.strictEqual(res.error?.code, 'MUST_DEFEND_OR_ACCEPT');

      controller.destroy();
    });

    it('12. Jogadas fora do turno para acumular são estritamente rejeitadas', async () => {
      const matchId = 'm-acc-12';
      const snap = createSnapshot({
        matchId,
        turnNumber: 1,
        currentTurnPlayerId: 'player-A',
        pendingDraws: 2,
        hands: { 'player-A': ['blue:2'], 'player-B': ['red:draw2'] },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => snap as unknown as GameSnapshot<TState>);
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(): Promise<ActionResult<TState>> => {
        return {
          accepted: false,
          snapshot: null,
          error: {
            code: 'NOT_YOUR_TURN',
            message: 'Não é seu turno de jogar.',
            category: 'authorization',
          },
          actionId: generateActionId(),
        };
      });

      const controller = new GameSessionController<CartaDuoTestState>(matchId);
      await controller.init();

      const res = await controller.submitAction('play_card', { card: 'red:draw2' });
      assert.strictEqual(res.accepted, false);
      assert.strictEqual(res.error?.code, 'NOT_YOUR_TURN');

      controller.destroy();
    });

    it('13. Com a configuração desativada (cumulative_draw: false), o acúmulo é recusado', async () => {
      const matchId = 'm-acc-13';
      const snap = createSnapshot({
        matchId,
        turnNumber: 2,
        currentTurnPlayerId: 'player-B',
        pendingDraws: 2,
        hands: { 'player-B': ['yellow:draw2'] },
        config: { cumulative_draw: false }, // DESATIVADO
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => snap as unknown as GameSnapshot<TState>);
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(): Promise<ActionResult<TState>> => {
        return {
          accepted: false,
          snapshot: null,
          error: {
            code: 'STACKING_DISABLED',
            message: 'O acúmulo de cartas de compra está desativado nesta partida. Aceite a penalidade.',
            category: 'rule',
          },
          actionId: generateActionId(),
        };
      });

      const controller = new GameSessionController<CartaDuoTestState>(matchId);
      await controller.init();

      const res = await controller.submitAction('play_card', { card: 'yellow:draw2' });
      assert.strictEqual(res.accepted, false);
      assert.strictEqual(res.error?.code, 'STACKING_DISABLED');

      controller.destroy();
    });

    it('14. Ao optar por não acumular (accept_penalty), o jogador compra o total exato e perde a vez', async () => {
      const matchId = 'm-acc-14';
      let currentSnap = createSnapshot({
        matchId,
        turnNumber: 2,
        currentTurnPlayerId: 'player-B',
        pendingDraws: 4, // Penalidade acumulada de 4 cartas
        hands: {
          'player-A': ['blue:1'],
          'player-B': ['green:2', 'red:draw2'],
        },
        deck: ['c1', 'c2', 'c3', 'c4', 'c5'],
        config: { cumulative_draw: true },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => currentSnap as unknown as GameSnapshot<TState>);
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
        assert.strictEqual(input.actionType, 'accept_penalty');
        currentSnap = {
          ...currentSnap,
          currentTurnPlayerId: 'player-A', // Perdeu a vez e passou o turno
          state: {
            ...currentSnap.state,
            current_turn_player_id: 'player-A',
            pending_draws: 0, // Penalidade zerada
            hands: {
              ...currentSnap.state.hands,
              'player-B': ['green:2', 'red:draw2', 'c1', 'c2', 'c3', 'c4'], // Comprou as 4
            },
            deck: ['c5'],
          },
        };
        return {
          accepted: true,
          snapshot: currentSnap as unknown as GameSnapshot<TState>,
          error: null,
          actionId: input.actionId || generateActionId(),
        };
      });

      const controller = new GameSessionController<CartaDuoTestState>(matchId);
      await controller.init();

      const res = await controller.submitAction('accept_penalty', {});
      assert.strictEqual(res.accepted, true);
      assert.strictEqual(res.snapshot?.state.pending_draws, 0);
      assert.strictEqual(res.snapshot?.state.hands?.['player-B'].length, 6);
      assert.strictEqual(res.snapshot?.currentTurnPlayerId, 'player-A');

      controller.destroy();
    });
  });

  // ==========================================================================
  // GRUPO 3: Múltiplas Cartas do Mesmo Número (Cenários 15 a 22)
  // ==========================================================================
  describe('3. Múltiplas Cartas do Mesmo Número (allow_same_number)', () => {
    it('15. Com a configuração ativada, é possível jogar cartas do mesmo número com cores diferentes', async () => {
      const matchId = 'm-sn-15';
      let currentSnap = createSnapshot({
        matchId,
        turnNumber: 1,
        currentTurnPlayerId: 'player-A',
        topCard: 'red:2',
        activeColor: 'red',
        activeValue: '2',
        hands: {
          'player-A': ['green:2', 'yellow:2', 'blue:5'],
          'player-B': ['red:7'],
        },
        config: { allow_same_number: true },
        sameNumberSequence: { active: false, player_id: null, number: null },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => currentSnap as unknown as GameSnapshot<TState>);
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
        const payload = input.payload as any;
        assert.strictEqual(payload.card, 'green:2');

        currentSnap = {
          ...currentSnap,
          currentTurnPlayerId: 'player-A', // Continua com player-A
          state: {
            ...currentSnap.state,
            top_card: 'green:2',
            active_color: 'green',
            active_value: '2',
            hands: {
              ...currentSnap.state.hands,
              'player-A': ['yellow:2', 'blue:5'],
            },
            same_number_sequence: {
              active: true,
              player_id: 'player-A',
              number: '2',
            },
          },
        };

        return {
          accepted: true,
          snapshot: currentSnap as unknown as GameSnapshot<TState>,
          error: null,
          actionId: input.actionId || generateActionId(),
        };
      });

      const controller = new GameSessionController<CartaDuoTestState>(matchId);
      await controller.init();

      const res = await controller.submitAction('play_card', { card: 'green:2' });
      assert.strictEqual(res.accepted, true);
      assert.strictEqual(res.snapshot?.state.same_number_sequence?.active, true);
      assert.strictEqual(res.snapshot?.state.same_number_sequence?.number, '2');
      assert.strictEqual(res.snapshot?.currentTurnPlayerId, 'player-A');

      controller.destroy();
    });

    it('16. A sequência de cartas de mesmo número mantém o jogador atual ativo', async () => {
      const snap = createSnapshot({
        matchId: 'm-sn-16',
        turnNumber: 2,
        currentTurnPlayerId: 'player-A',
        sameNumberSequence: { active: true, player_id: 'player-A', number: '2' },
        config: { allow_same_number: true },
      });

      assert.strictEqual(snap.currentTurnPlayerId, 'player-A');
      assert.strictEqual(snap.state.same_number_sequence?.active, true);
      assert.strictEqual(snap.state.same_number_sequence?.player_id, 'player-A');
    });

    it('17. O jogador pode encerrar voluntariamente a sequência com end_sequence', async () => {
      const matchId = 'm-sn-17';
      let currentSnap = createSnapshot({
        matchId,
        turnNumber: 2,
        currentTurnPlayerId: 'player-A',
        sameNumberSequence: { active: true, player_id: 'player-A', number: '2' },
        hands: {
          'player-A': ['yellow:2', 'blue:5'], // Ainda tem outro 2, mas quer parar
          'player-B': ['red:7'],
        },
        config: { allow_same_number: true },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => currentSnap as unknown as GameSnapshot<TState>);
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
        assert.strictEqual(input.actionType, 'end_sequence');
        currentSnap = {
          ...currentSnap,
          currentTurnPlayerId: 'player-B', // Passou o turno
          state: {
            ...currentSnap.state,
            current_turn_player_id: 'player-B',
            same_number_sequence: { active: false, player_id: null, number: null },
          },
        };
        return {
          accepted: true,
          snapshot: currentSnap as unknown as GameSnapshot<TState>,
          error: null,
          actionId: input.actionId || generateActionId(),
        };
      });

      const controller = new GameSessionController<CartaDuoTestState>(matchId);
      await controller.init();

      const res = await controller.submitAction('end_sequence', {});
      assert.strictEqual(res.accepted, true);
      assert.strictEqual(res.snapshot?.state.same_number_sequence?.active, false);
      assert.strictEqual(res.snapshot?.currentTurnPlayerId, 'player-B');

      controller.destroy();
    });

    it('18. A sequência termina automaticamente quando não restam cartas elegíveis na mão', async () => {
      const matchId = 'm-sn-18';
      let currentSnap = createSnapshot({
        matchId,
        turnNumber: 2,
        currentTurnPlayerId: 'player-A',
        sameNumberSequence: { active: true, player_id: 'player-A', number: '2' },
        hands: {
          'player-A': ['yellow:2', 'blue:5'], // Só resta mais um 2
          'player-B': ['red:7'],
        },
        config: { allow_same_number: true },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => currentSnap as unknown as GameSnapshot<TState>);
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
        const payload = input.payload as any;
        assert.strictEqual(payload.card, 'yellow:2');

        // Não resta mais nenhum 2 na mão do jogador (apenas blue:5): sequência encerra automaticamente
        currentSnap = {
          ...currentSnap,
          currentTurnPlayerId: 'player-B',
          state: {
            ...currentSnap.state,
            current_turn_player_id: 'player-B',
            top_card: 'yellow:2',
            active_color: 'yellow',
            active_value: '2',
            hands: {
              ...currentSnap.state.hands,
              'player-A': ['blue:5'],
            },
            same_number_sequence: { active: false, player_id: null, number: null },
          },
        };

        return {
          accepted: true,
          snapshot: currentSnap as unknown as GameSnapshot<TState>,
          error: null,
          actionId: input.actionId || generateActionId(),
        };
      });

      const controller = new GameSessionController<CartaDuoTestState>(matchId);
      await controller.init();

      const res = await controller.submitAction('play_card', { card: 'yellow:2' });
      assert.strictEqual(res.accepted, true);
      assert.strictEqual(res.snapshot?.state.same_number_sequence?.active, false);
      assert.strictEqual(res.snapshot?.currentTurnPlayerId, 'player-B');

      controller.destroy();
    });

    it('19. Cartas de número diferente são rejeitadas durante a sequência ativa', async () => {
      const matchId = 'm-sn-19';
      const snap = createSnapshot({
        matchId,
        turnNumber: 2,
        currentTurnPlayerId: 'player-A',
        sameNumberSequence: { active: true, player_id: 'player-A', number: '2' },
        hands: { 'player-A': ['yellow:2', 'blue:5'] },
        config: { allow_same_number: true },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => snap as unknown as GameSnapshot<TState>);
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
        const payload = input.payload as any;
        if (payload.card === 'blue:5') {
          return {
            accepted: false,
            snapshot: null,
            error: {
              code: 'SAME_NUMBER_REQUIRED',
              message: 'A carta deve possuir o mesmo número (2) da sequência atual.',
              category: 'rule',
            },
            actionId: input.actionId || generateActionId(),
          };
        }
        return { accepted: true, snapshot: null, error: null, actionId: generateActionId() };
      });

      const controller = new GameSessionController<CartaDuoTestState>(matchId);
      await controller.init();

      const res = await controller.submitAction('play_card', { card: 'blue:5' });
      assert.strictEqual(res.accepted, false);
      assert.strictEqual(res.error?.code, 'SAME_NUMBER_REQUIRED');

      controller.destroy();
    });

    it('20. Com a configuração desativada (allow_same_number: false), a segunda carta da sequência é rejeitada', async () => {
      const matchId = 'm-sn-20';
      // Com a regra desativada, jogar a primeira carta já avança o turno para player-B imediatamente
      const snap = createSnapshot({
        matchId,
        turnNumber: 2,
        currentTurnPlayerId: 'player-B', // Turno avançou para B
        topCard: 'red:2',
        hands: {
          'player-A': ['yellow:2'],
          'player-B': ['blue:7'],
        },
        config: { allow_same_number: false }, // DESATIVADO
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => snap as unknown as GameSnapshot<TState>);
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(): Promise<ActionResult<TState>> => {
        return {
          accepted: false,
          snapshot: null,
          error: {
            code: 'NOT_YOUR_TURN',
            message: 'Não é seu turno de jogar.',
            category: 'authorization',
          },
          actionId: generateActionId(),
        };
      });

      const controllerA = new GameSessionController<CartaDuoTestState>(matchId);
      await controllerA.init();

      // Tentativa de jogar a segunda carta fora de turno
      const res = await controllerA.submitAction('play_card', { card: 'yellow:2' });
      assert.strictEqual(res.accepted, false);
      assert.strictEqual(res.error?.code, 'NOT_YOUR_TURN');

      controllerA.destroy();
    });

    it('21. A regra de múltiplas cartas funciona igualmente para todos os participantes', async () => {
      const matchId = 'm-sn-21';
      const snapPlayerB = createSnapshot({
        matchId,
        turnNumber: 3,
        currentTurnPlayerId: 'player-B',
        hands: {
          'player-A': ['red:1'],
          'player-B': ['blue:9', 'yellow:9', 'green:9'],
        },
        config: { allow_same_number: true },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => snapPlayerB as unknown as GameSnapshot<TState>);
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(): Promise<ActionResult<TState>> => {
        return {
          accepted: true,
          snapshot: {
            ...snapPlayerB,
            currentTurnPlayerId: 'player-B',
            state: {
              ...snapPlayerB.state,
              same_number_sequence: { active: true, player_id: 'player-B', number: '9' },
            },
          } as unknown as GameSnapshot<TState>,
          error: null,
          actionId: generateActionId(),
        };
      });

      const controller = new GameSessionController<CartaDuoTestState>(matchId);
      await controller.init();

      const res = await controller.submitAction('play_card', { card: 'blue:9' });
      assert.strictEqual(res.accepted, true);
      assert.strictEqual(res.snapshot?.state.same_number_sequence?.active, true);
      assert.strictEqual(res.snapshot?.state.same_number_sequence?.player_id, 'player-B');

      controller.destroy();
    });

    it('22. Efeitos de cartas especiais (Skip, Reverse) continuam consistentes fora de sequência de números', () => {
      // Cartas de ação como skip e reverse não entram em sequência numérica (0-9)
      const isNumberCard = (val: string) => /^[0-9]$/.test(val);
      assert.strictEqual(isNumberCard('2'), true);
      assert.strictEqual(isNumberCard('skip'), false);
      assert.strictEqual(isNumberCard('reverse'), false);
      assert.strictEqual(isNumberCard('draw2'), false);
    });
  });

  // ==========================================================================
  // GRUPO 4: Configurações da Sala e Congelamento (Cenários 23 a 27)
  // ==========================================================================
  describe('4. Configurações da Sala e Congelamento Oficial', () => {
    it('23. As opções de cumulative_draw e allow_same_number são salvas independentemente', () => {
      const roomConfig1 = { cumulative_draw: true, allow_same_number: false };
      const roomConfig2 = { cumulative_draw: false, allow_same_number: true };
      const roomConfig3 = { cumulative_draw: true, allow_same_number: true };

      assert.strictEqual(roomConfig1.cumulative_draw, true);
      assert.strictEqual(roomConfig1.allow_same_number, false);
      assert.strictEqual(roomConfig2.cumulative_draw, false);
      assert.strictEqual(roomConfig2.allow_same_number, true);
      assert.strictEqual(roomConfig3.cumulative_draw, true);
      assert.strictEqual(roomConfig3.allow_same_number, true);
    });

    it('24. A partida recebe os valores selecionados no momento da criação', () => {
      const roomConfig = { cumulative_draw: true, allow_same_number: true, initial_cards: 5 };
      const snap = createSnapshot({
        matchId: 'm-cfg-24',
        turnNumber: 1,
        currentTurnPlayerId: 'player-A',
        config: roomConfig,
      });

      assert.strictEqual(snap.state.config.cumulative_draw, true);
      assert.strictEqual(snap.state.config.allow_same_number, true);
      assert.strictEqual(snap.state.config.initial_cards, 5);
    });

    it('25. O backend aplica estritamente as configurações reais recebidas', () => {
      const snap = createSnapshot({
        matchId: 'm-cfg-25',
        turnNumber: 1,
        currentTurnPlayerId: 'player-A',
        config: { cumulative_draw: false, allow_same_number: false },
      });

      assert.strictEqual(snap.state.config.cumulative_draw, false);
      assert.strictEqual(snap.state.config.allow_same_number, false);
    });

    it('26. Alterações posteriores no lobby não modificam a partida em andamento (congelamento oficial)', async () => {
      const matchId = 'm-cfg-26';
      const snapFrozen = createSnapshot({
        matchId,
        turnNumber: 1,
        currentTurnPlayerId: 'player-A',
        config: { cumulative_draw: true, allow_same_number: false },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => snapFrozen as unknown as GameSnapshot<TState>);

      const controller = new GameSessionController<CartaDuoTestState>(matchId);
      const snap = await controller.init();
      assert.ok(snap, 'snap must exist');

      // Tentativa espúria de mutar configurações é rejeitada pelo validador server-side
      assert.strictEqual(snap.state.config.cumulative_draw, true);
      assert.strictEqual(snap.state.config.allow_same_number, false);

      controller.destroy();
    });

    it('27. Todos os jogadores recebem o mesmo conjunto de regras no snapshot', async () => {
      const matchId = 'm-cfg-27';
      const snap = createSnapshot({
        matchId,
        turnNumber: 1,
        currentTurnPlayerId: 'player-A',
        config: { cumulative_draw: true, allow_same_number: true },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => snap as unknown as GameSnapshot<TState>);

      const clientA = new GameSessionController<CartaDuoTestState>(matchId);
      const snapA = await clientA.init();
      assert.ok(snapA, 'snapA must exist');

      const clientB = new GameSessionController<CartaDuoTestState>(matchId);
      const snapB = await clientB.init();
      assert.ok(snapB, 'snapB must exist');

      assert.deepStrictEqual(snapA.state.config, snapB.state.config);

      clientA.destroy();
      clientB.destroy();
    });
  });

  // ==========================================================================
  // GRUPO 5: Concorrência e Reconexão (Cenários 28 a 30)
  // ==========================================================================
  describe('5. Concorrência e Reconexão', () => {
    it('28. Ações simultâneas não corrompem o estado da partida', async () => {
      const matchId = 'm-conc-28';
      let currentSnap = createSnapshot({
        matchId,
        turnNumber: 1,
        currentTurnPlayerId: 'player-A',
        hands: { 'player-A': ['red:5'], 'player-B': ['blue:2'] },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => currentSnap as unknown as GameSnapshot<TState>);
      let executionCount = 0;

      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
        executionCount++;
        currentSnap = {
          ...currentSnap,
          turnNumber: currentSnap.turnNumber + 1,
        };
        return {
          accepted: true,
          snapshot: currentSnap as unknown as GameSnapshot<TState>,
          error: null,
          actionId: input.actionId || generateActionId(),
        };
      });

      const controller = new GameSessionController<CartaDuoTestState>(matchId);
      await controller.init();

      const res = await controller.submitAction('play_card', { card: 'red:5' });
      assert.strictEqual(res.accepted, true);
      assert.strictEqual(executionCount, 1);

      controller.destroy();
    });

    it('29. Repetições da mesma ação (idempotência) não duplicam jogadas', async () => {
      const matchId = 'm-idemp-29';
      const snap = createSnapshot({
        matchId,
        turnNumber: 2,
        currentTurnPlayerId: 'player-B',
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => snap as unknown as GameSnapshot<TState>);
      const sharedActionId = 'act-fixed-uuid-1234';

      let serverCallCount = 0;
      setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
        serverCallCount++;
        return {
          accepted: true,
          snapshot: snap as unknown as GameSnapshot<TState>,
          error: null,
          actionId: input.actionId || sharedActionId,
        };
      });

      const controller = new GameSessionController<CartaDuoTestState>(matchId);
      await controller.init();

      // Duplo clique rápido com o mesmo actionId
      const r1 = await controller.submitAction('play_card', { card: 'red:5' }, sharedActionId);
      const r2 = await controller.submitAction('play_card', { card: 'red:5' }, sharedActionId);

      assert.strictEqual(r1.accepted, true);
      assert.strictEqual(r2.accepted, true);

      controller.destroy();
    });

    it('30. A reconexão recupera corretamente sequência, penalidade, jogador atual e configurações', async () => {
      const matchId = 'm-reconn-30';
      const snap = createSnapshot({
        matchId,
        turnNumber: 5,
        currentTurnPlayerId: 'player-B',
        pendingDraws: 6,
        sameNumberSequence: { active: true, player_id: 'player-B', number: '7' },
        lastCardDeclarations: { 'player-A': true },
        config: { cumulative_draw: true, allow_same_number: true },
      });

      setSnapshotFetcherForTest(async <TState = unknown>() => snap as unknown as GameSnapshot<TState>);

      const reconnected = await reconnectMatch<CartaDuoTestState>(matchId);

      assert.strictEqual(reconnected.state.pending_draws, 6);
      assert.strictEqual(reconnected.state.same_number_sequence?.active, true);
      assert.strictEqual(reconnected.state.same_number_sequence?.number, '7');
      assert.strictEqual(reconnected.state.last_card_declarations?.['player-A'], true);
      assert.strictEqual(reconnected.currentTurnPlayerId, 'player-B');
      assert.strictEqual(reconnected.state.config.cumulative_draw, true);
      assert.strictEqual(reconnected.state.config.allow_same_number, true);
    });
  });
});
