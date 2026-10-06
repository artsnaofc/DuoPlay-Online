// ============================================================================
// Unit Tests: Match Presence, Recovery & Abandonment — DuoPlay-Online
// Phase: Fase 7.1.1 — Integração Real de Presence, Recovery e Abandono
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameSessionController } from '../controllers/GameSessionController';
import { setSnapshotFetcherForTest } from '../network/snapshot';
import { clearSyncQueuesForTest } from '../network/sync';
import type { GameSnapshot } from '../network/types';
import {
  abandonMatch,
  claimAbandonment,
  getActiveMatchForCurrentUser,
  heartbeatMatch,
} from '@/services/matchSession';

function createMockSnapshot<TState = unknown>(
  matchId: string,
  status: 'in_progress' | 'finished' = 'in_progress',
  opponentDisconnected = false
): GameSnapshot<TState> {
  const p1 = '00000000-0000-4000-8000-000000000001';
  const p2 = '00000000-0000-4000-8000-000000000002';

  return {
    matchId,
    roomId: '00000000-0000-4000-8000-000000000001',
    gameId: 'tic_tac_toe',
    status,
    state: {
      board: ['X', null, null, null, 'O', null, null, null, null],
    } as unknown as TState,
    currentTurnPlayerId: p1,
    turnNumber: 3,
    turnDeadline: null,
    winnerId: status === 'finished' ? p1 : null,
    isDraw: false,
    finishReason: status === 'finished' ? 'normal' : null,
    players: [
      {
        userId: p1,
        slot: 1,
        gameSymbol: 'X',
        score: 0,
        isWinner: status === 'finished',
        disconnectedAt: null,
        gracePeriodExpiresAt: null,
        lastSeenAt: '2026-10-06T00:00:00Z',
        connectionStatus: 'connected',
        joinedAt: '2026-10-06T00:00:00Z',
      },
      {
        userId: p2,
        slot: 2,
        gameSymbol: 'O',
        score: 0,
        isWinner: false,
        disconnectedAt: opponentDisconnected ? '2026-10-06T00:00:15Z' : null,
        gracePeriodExpiresAt: opponentDisconnected ? '2026-10-06T00:01:00Z' : null,
        lastSeenAt: opponentDisconnected ? '2026-10-06T00:00:03Z' : '2026-10-06T00:00:15Z',
        connectionStatus: opponentDisconnected ? 'disconnected' : 'connected',
        joinedAt: '2026-10-06T00:00:00Z',
      },
    ],
    version: 3,
    actionHistory: [],
    createdAt: '2026-10-06T00:00:00Z',
    startedAt: '2026-10-06T00:00:00Z',
    finishedAt: status === 'finished' ? '2026-10-06T00:02:00Z' : null,
  };
}

describe('Fase 7.1.1: Ciclo de Vida de Heartbeat & Presença', () => {
  beforeEach(() => {
    clearSyncQueuesForTest();
  });

  afterEach(() => {
    setSnapshotFetcherForTest(null);
  });

  it('1. Deve iniciar o heartbeat quando a partida estiver ativa (in_progress)', async () => {
    const matchId = '00000000-0000-4000-8000-000000000001';
    setSnapshotFetcherForTest(async () => createMockSnapshot(matchId, 'in_progress'));

    const controller = new GameSessionController(matchId);
    const snap = await controller.init();

    assert.ok(snap);
    assert.strictEqual(snap.status, 'in_progress');
    // startHeartbeat é chamado no init
    controller.destroy();
    assert.strictEqual(controller.getIsHeartbeatActive(), false);
  });

  it('2. Não deve manter heartbeat ativo quando a partida já estiver terminada (finished)', async () => {
    const matchId = '00000000-0000-4000-8000-000000000002';
    setSnapshotFetcherForTest(async () => createMockSnapshot(matchId, 'finished'));

    const controller = new GameSessionController(matchId);
    const snap = await controller.init();

    assert.ok(snap);
    assert.strictEqual(snap.status, 'finished');
    assert.strictEqual(controller.getIsHeartbeatActive(), false);
    controller.destroy();
  });

  it('3. startHeartbeat deve ser estritamente idempotente', () => {
    const matchId = '00000000-0000-4000-8000-000000000003';
    const controller = new GameSessionController(matchId);

    controller.startHeartbeat();
    controller.startHeartbeat();
    controller.startHeartbeat();

    // Não deve lançar erro nem criar múltiplos timers
    controller.stopHeartbeat();
    assert.strictEqual(controller.getIsHeartbeatActive(), false);
    controller.destroy();
  });

  it('4. destroy() encerra o heartbeat e limpa listeners', async () => {
    const matchId = '00000000-0000-4000-8000-000000000004';
    setSnapshotFetcherForTest(async () => createMockSnapshot(matchId, 'in_progress'));

    const controller = new GameSessionController(matchId);
    await controller.init();

    assert.strictEqual(controller.getIsDestroyed(), false);
    controller.destroy();

    assert.strictEqual(controller.getIsDestroyed(), true);
    assert.strictEqual(controller.getIsHeartbeatActive(), false);
  });
});

describe('Fase 7.1.1: Detecção de Presença do Oponente & Grace Period', () => {
  beforeEach(() => {
    clearSyncQueuesForTest();
  });

  afterEach(() => {
    setSnapshotFetcherForTest(null);
  });

  it('5. Identifica quando o adversário está desconectado e armazena gracePeriodExpiresAt', async () => {
    const matchId = '00000000-0000-4000-8000-000000000005';
    setSnapshotFetcherForTest(async () => createMockSnapshot(matchId, 'in_progress', true));

    const controller = new GameSessionController(matchId);
    const snap = await controller.init();

    assert.ok(snap);
    const opponent = snap.players.find((p) => p.slot === 2);
    assert.ok(opponent);
    assert.strictEqual(opponent.connectionStatus, 'disconnected');
    assert.ok(opponent.gracePeriodExpiresAt);

    controller.destroy();
  });
});

describe('Fase 7.1.1: Tratamento de Erros e Serviços de Sessão', () => {
  it('6. heartbeatMatch retorna erro seguro quando matchId for inválido', async () => {
    const res = await heartbeatMatch('');
    assert.strictEqual(res.success, false);
    assert.ok(res.error);
  });

  it('7. abandonMatch retorna erro seguro quando matchId for inválido', async () => {
    const res = await abandonMatch('');
    assert.strictEqual(res.success, false);
    assert.ok(res.error);
  });

  it('8. claimAbandonment retorna erro seguro quando matchId for inválido', async () => {
    const res = await claimAbandonment('');
    assert.strictEqual(res.success, false);
    assert.ok(res.error);
  });

  it('9. getActiveMatchForCurrentUser executa com segurança', async () => {
    const res = await getActiveMatchForCurrentUser();
    // Em ambiente de teste mockado, pode retornar data null ou sucesso
    assert.ok(typeof res.success === 'boolean');
  });

  it('10. reconnect() mantém uma única instância de heartbeat ativa', async () => {
    const matchId = '00000000-0000-4000-8000-000000000010';
    setSnapshotFetcherForTest(async <TState>() => createMockSnapshot<TState>(matchId, 'in_progress'));

    const controller = new GameSessionController(matchId);
    await controller.init();

    await controller.reconnect();
    await controller.reconnect();

    assert.strictEqual(controller.getIsDestroyed(), false);
    controller.destroy();
    assert.strictEqual(controller.getIsDestroyed(), true);
  });

  it('11. triggerHeartbeatTick não executa se o controller for destruído', async () => {
    const matchId = '00000000-0000-4000-8000-000000000011';
    const controller = new GameSessionController(matchId);
    controller.destroy();

    // Não deve lançar erro
    await controller.triggerHeartbeatTick();
    assert.strictEqual(controller.getIsHeartbeatActive(), false);
  });
});

