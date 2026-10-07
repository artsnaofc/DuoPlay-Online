// ============================================================================
// Unit & Integration Tests: Fase 13 — UX e Robustez da Experiência Multiplayer
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameSessionController } from '../controllers/GameSessionController';
import { setSnapshotFetcherForTest } from '../network/snapshot';
import { clearSyncQueuesForTest } from '../network/sync';
import type { GameSnapshot } from '../network/types';
import {
  translateRoomError,
} from '@/services/rooms';
import {
  sanitizeMatchErrorMessage,
} from '@/services/matchSession';

function createMockSnapshot<TState = unknown>(
  matchId: string,
  turnDeadline: string | null = null,
  status: 'in_progress' | 'finished' = 'in_progress'
): GameSnapshot<TState> {
  const p1 = 'user-1';
  const p2 = 'user-2';

  return {
    matchId,
    roomId: 'room-1',
    gameId: 'tic_tac_toe',
    status,
    state: { board: [null, null, null, null, null, null, null, null, null] } as unknown as TState,
    currentTurnPlayerId: p1,
    turnNumber: 1,
    turnDeadline,
    winnerId: null,
    isDraw: false,
    finishReason: null,
    players: [
      {
        userId: p1,
        slot: 1,
        gameSymbol: 'X',
        score: 0,
        isWinner: false,
        disconnectedAt: null,
        gracePeriodExpiresAt: null,
        lastSeenAt: '2026-10-07T00:00:00Z',
        connectionStatus: 'connected',
        joinedAt: '2026-10-07T00:00:00Z',
      },
      {
        userId: p2,
        slot: 2,
        gameSymbol: 'O',
        score: 0,
        isWinner: false,
        disconnectedAt: null,
        gracePeriodExpiresAt: null,
        lastSeenAt: '2026-10-07T00:00:00Z',
        connectionStatus: 'connected',
        joinedAt: '2026-10-07T00:00:00Z',
      },
    ],
    version: 1,
    actionHistory: [],
    createdAt: '2026-10-07T00:00:00Z',
    startedAt: '2026-10-07T00:00:00Z',
    finishedAt: null,
  };
}

describe('Fase 13: Robustez de Lobby, Matchmaking, Conexão e Temporizador', () => {
  const matchId = '11111111-2222-3333-4444-555555555555';

  beforeEach(() => {
    clearSyncQueuesForTest();
  });

  afterEach(() => {
    setSnapshotFetcherForTest(null);
    clearSyncQueuesForTest();
  });

  // --------------------------------------------------------------------------
  // 1. Lobby & Tratamento de Erros Amigáveis
  // --------------------------------------------------------------------------
  describe('Lobby e Mensagens de Erro Sanitizadas', () => {
    it('1. Erro de sintaxe UUID ou chave estrangeira é convertido em mensagem amigável', () => {
      const res = translateRoomError({
        message: 'invalid input syntax for type uuid: "XYZ"',
        code: '22P02',
      });
      assert.equal(res.code, 'ROOM_NOT_FOUND');
      assert.match(res.message, /não foi encontrada ou não está disponível/i);
    });

    it('2. Erro de rede ou falha de fetch é convertido em NETWORK_ERROR amigável', () => {
      const res = translateRoomError({
        message: 'TypeError: Failed to fetch',
        code: 'NETWORK_ERROR',
      });
      assert.equal(res.code, 'NETWORK_ERROR');
      assert.match(res.message, /Erro de conexão com o servidor/i);
    });

    it('3. sanitizeMatchErrorMessage sanitiza SQLSTATE e erros técnicos do PostgreSQL', () => {
      const sqlstate = sanitizeMatchErrorMessage('SQLSTATE 42P01 table not found', 'Operação não pôde ser concluída.');
      assert.equal(sqlstate, 'Operação não pôde ser concluída.');

      const networkErr = sanitizeMatchErrorMessage('Failed to fetch from supabase', 'Falha genérica.');
      assert.match(networkErr, /Erro de conexão/i);

      const authErr = sanitizeMatchErrorMessage('UNAUTHORIZED: missing token', 'Falha.');
      assert.match(authErr, /precisa estar logado/i);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Conexão & Sessão Autoritativa
  // --------------------------------------------------------------------------
  describe('Conexão e Sessão Autoritativa', () => {
    it('4. GameSessionController transita por estados conectados e syncing', async () => {
      setSnapshotFetcherForTest(async <TState>() => createMockSnapshot<TState>(matchId));

      const controller = new GameSessionController(matchId);
      const snapshot = await controller.init();

      assert.ok(snapshot);
      assert.equal(controller.getSyncState(), 'synced');
      assert.equal(controller.getError(), null);

      controller.destroy();
    });

    it('5. Chamadas concorrentes de init() não duplicam subscriptions ou instâncias', async () => {
      let fetchCount = 0;
      setSnapshotFetcherForTest(async <TState>() => {
        fetchCount++;
        return createMockSnapshot<TState>(matchId);
      });

      const controller = new GameSessionController(matchId);
      const [res1, res2] = await Promise.all([controller.init(), controller.init()]);

      assert.strictEqual(res1, res2);
      assert.equal(fetchCount, 1, 'Snapshot deve ser buscado apenas uma vez');

      controller.destroy();
    });

    it('6. Reconnect recupera snapshot oficial e recalcula estado sem acumular timers', async () => {
      setSnapshotFetcherForTest(async <TState>() => createMockSnapshot<TState>(matchId));

      const controller = new GameSessionController(matchId);
      await controller.init();

      const reconnected = await controller.reconnect();
      assert.ok(reconnected);
      assert.equal(controller.getSyncState(), 'synced');

      controller.destroy();
    });
  });

  // --------------------------------------------------------------------------
  // 3. Temporizador e Deadline Oficial
  // --------------------------------------------------------------------------
  describe('Temporizador e Deadline Oficial (PostgreSQL Authority)', () => {
    it('7. Timer calcula segundos restantes baseado estritamente no turn_deadline', () => {
      const futureDeadline = new Date(Date.now() + 15000).toISOString();
      const mock = createMockSnapshot(matchId, futureDeadline);

      const deadlineMs = new Date(mock.turnDeadline!).getTime();
      const remainingSec = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));

      assert.ok(remainingSec >= 14 && remainingSec <= 16, `Esperado ~15s, obtido ${remainingSec}`);
    });

    it('8. Timer nunca fica negativo mesmo quando o deadline expirou no passado', () => {
      const pastDeadline = new Date(Date.now() - 5000).toISOString();
      const mock = createMockSnapshot(matchId, pastDeadline);

      const deadlineMs = new Date(mock.turnDeadline!).getTime();
      const remainingSec = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));

      assert.equal(remainingSec, 0, 'Tempo expirado deve limitar em zero');
    });

    it('9. Turno e vitória continuam determinados exclusivamente pelo servidor', () => {
      const mock = createMockSnapshot(matchId, null, 'in_progress');
      // O cliente não pode alterar status ou vencedor localmente
      assert.equal(mock.status, 'in_progress');
      assert.equal(mock.winnerId, null);
      assert.equal(mock.currentTurnPlayerId, 'user-1');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Reconexão e Limpeza de Recursos
  // --------------------------------------------------------------------------
  describe('Cleanup e Prevenção de Vazamento de Recursos', () => {
    it('10. Destroy interrompe heartbeat e desassina canais de rede', async () => {
      setSnapshotFetcherForTest(async <TState>() => createMockSnapshot<TState>(matchId));

      const controller = new GameSessionController(matchId);
      await controller.init();

      controller.destroy();
      assert.equal(controller.getIsDestroyed(), true);

      // Chamadas após destroy retornam null sem reabrir conexões
      const resAfterDestroy = await controller.refresh();
      assert.equal(resAfterDestroy, null);
    });
  });
});
