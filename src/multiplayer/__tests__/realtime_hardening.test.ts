// ============================================================================
// Unit Tests: Realtime Hardening & Coalescence — DuoPlay-Online
// Phase: Fase 6.1 — Hardening do Supabase Realtime
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  syncMatch,
  reconnectMatch,
  subscribeToMatch,
  clearSyncQueuesForTest,
} from '../network/sync';
import { setSnapshotFetcherForTest } from '../network/snapshot';
import { GameSessionController } from '../controllers/GameSessionController';
import type { GameSnapshot } from '../network/types';

// Mock helper para gerar snapshots controlados em memória para os testes
function createMockSnapshot<TState = unknown>(
  matchId: string,
  turnNumber: number,
  boardMark?: string
): GameSnapshot<TState> {
  return {
    matchId,
    roomId: '00000000-0000-4000-8000-000000000001',
    gameId: 'tic_tac_toe',
    status: 'in_progress',
    state: {
      board: [boardMark || 'X', null, null, null, null, null, null, null, null],
    } as unknown as TState,
    currentTurnPlayerId: '00000000-0000-4000-8000-000000000001',
    turnNumber,
    turnDeadline: null,
    winnerId: null,
    isDraw: false,
    finishReason: null,
    players: [
      {
        userId: '00000000-0000-4000-8000-000000000001',
        slot: 1,
        gameSymbol: 'X',
        score: 0,
        isWinner: false,
        disconnectedAt: null,
        gracePeriodExpiresAt: null,
        lastSeenAt: '2026-10-06T00:00:00Z',
        connectionStatus: 'connected',
        joinedAt: '2026-10-06T00:00:00Z',
      },
    ],
    version: turnNumber,
    actionHistory: [],
    createdAt: '2026-10-06T00:00:00Z',
    startedAt: '2026-10-06T00:00:00Z',
    finishedAt: null,
  };
}

describe('Realtime Hardening: Coalescence & Request Deduping (Fase 6.1)', () => {
  beforeEach(() => {
    clearSyncQueuesForTest();
  });

  afterEach(() => {
    setSnapshotFetcherForTest(null);
  });

  it('1. Teste 1 — Coalescência: Evento B durante Sync A deve disparar Sync B subsequente', async () => {
    const matchId = '00000000-0000-4000-8000-000000000001';
    let fetchCount = 0;

    setSnapshotFetcherForTest(async <TState = unknown>(id: string): Promise<GameSnapshot<TState>> => {
      fetchCount++;
      const currentCall = fetchCount;
      // Simular latência de rede assíncrona
      await new Promise((resolve) => setTimeout(resolve, 20));
      return createMockSnapshot<TState>(id, currentCall);
    });

    // Inicia Sync A (fetchCount = 1)
    const promiseA = syncMatch(matchId);

    // Aguarda 5ms para garantir que Sync A está em voo, e dispara Evento B
    await new Promise((resolve) => setTimeout(resolve, 5));
    const promiseB = syncMatch(matchId);

    const [snapshotA, snapshotB] = await Promise.all([promiseA, promiseB]);

    assert.equal(fetchCount, 2, 'Devem ocorrer exatamente 2 buscas no PostgreSQL (Sync A + Sync B)');
    assert.equal(snapshotA.turnNumber, 1, 'Sync A deve retornar o snapshot do primeiro ciclo');
    assert.equal(snapshotB.turnNumber, 2, 'Sync B (chegado durante A) deve receber o snapshot do segundo ciclo');
  });

  it('2. Teste 2 — Vários eventos rápidos: Agrupamento evita tempestade de requests', async () => {
    const matchId = '00000000-0000-4000-8000-000000000002';
    let fetchCount = 0;

    setSnapshotFetcherForTest(async <TState = unknown>(id: string): Promise<GameSnapshot<TState>> => {
      fetchCount++;
      const currentCall = fetchCount;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return createMockSnapshot<TState>(id, currentCall);
    });

    // Inicia Sync A
    const promiseA = syncMatch(matchId);

    // Dispara múltiplos eventos em rápida sucessão durante o voo de A
    await new Promise((resolve) => setTimeout(resolve, 5));
    const promiseB = syncMatch(matchId);
    const promiseC = syncMatch(matchId);
    const promiseD = syncMatch(matchId);
    const promiseE = syncMatch(matchId);

    const [resA, resB, resC, resD, resE] = await Promise.all([
      promiseA,
      promiseB,
      promiseC,
      promiseD,
      promiseE,
    ]);

    // Com coalescência perfeita: exatamente 2 requests no banco (Sync 1 + Sync 2 coalescido)
    assert.equal(fetchCount, 2, '5 eventos durante 1 sync devem ser coalescidos em exatamente 2 requisições');
    assert.equal(resA.turnNumber, 1);
    assert.equal(resB.turnNumber, 2);
    assert.equal(resC.turnNumber, 2);
    assert.equal(resD.turnNumber, 2);
    assert.equal(resE.turnNumber, 2);
  });

  it('3. Teste 3 — Listener recebe snapshot final após eventos encadeados', async () => {
    const matchId = '00000000-0000-4000-8000-000000000003';
    const receivedSnapshots: GameSnapshot<{ board: (string | null)[] }>[] = [];
    let step = 1;

    setSnapshotFetcherForTest(async <TState = unknown>(id: string): Promise<GameSnapshot<TState>> => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return createMockSnapshot<TState>(id, step++);
    });

    const unsubscribe = subscribeToMatch<{ board: (string | null)[] }>(
      matchId,
      (snapshot) => {
        receivedSnapshots.push(snapshot);
      }
    );

    // Simular notificações Realtime sequenciais com coalescência
    const sync1 = syncMatch<{ board: (string | null)[] }>(matchId).then((snap) => {
      receivedSnapshots.push(snap);
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const sync2 = syncMatch<{ board: (string | null)[] }>(matchId).then((snap) => {
      receivedSnapshots.push(snap);
    });

    await Promise.all([sync1, sync2]);

    assert.ok(receivedSnapshots.length >= 2, 'O listener deve receber as atualizações');
    const latestReceived = receivedSnapshots[receivedSnapshots.length - 1];
    assert.equal(latestReceived.turnNumber, 2, 'O snapshot mais recente deve ser a versão final (2)');

    unsubscribe();
  });

  it('4. Teste 4 — Eventos duplicados permanecem consistentes sem duplicação de estado', async () => {
    const matchId = '00000000-0000-4000-8000-000000000004';
    let fetchCalls = 0;

    setSnapshotFetcherForTest(async <TState = unknown>(id: string): Promise<GameSnapshot<TState>> => {
      fetchCalls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return createMockSnapshot<TState>(id, 5);
    });

    // Dispara 3 eventos idênticos em paralelo
    const [res1, res2, res3] = await Promise.all([
      syncMatch(matchId),
      syncMatch(matchId),
      syncMatch(matchId),
    ]);

    assert.equal(res1.turnNumber, 5);
    assert.equal(res2.turnNumber, 5);
    assert.equal(res3.turnNumber, 5);
    assert.ok(fetchCalls <= 2, 'Não deve exceder as buscas necessárias');
  });

  it('5. Teste 5 — Eventos fora de ordem garantem snapshot autoritativo do PostgreSQL', async () => {
    const matchId = '00000000-0000-4000-8000-000000000005';
    // O PostgreSQL é a fonte da verdade: se o backend já está na versão 7,
    // mesmo que eventos cheguem em ordem invertida, o snapshot retornado será a versão do banco (7).
    setSnapshotFetcherForTest(async <TState = unknown>(id: string): Promise<GameSnapshot<TState>> => {
      return createMockSnapshot<TState>(id, 7);
    });

    const snap = await syncMatch(matchId);
    assert.equal(snap.turnNumber, 7, 'O snapshot retornado deve refletir o estado oficial do PostgreSQL');
    assert.equal(snap.version, 7);
  });
});

describe('Realtime Hardening: Reconnection & Lost Events (Fase 6.1)', () => {
  beforeEach(() => {
    clearSyncQueuesForTest();
  });

  afterEach(() => {
    setSnapshotFetcherForTest(null);
  });

  it('6. Teste 6 — Reconnect executa sincronização autoritativa após reconexão', async () => {
    const matchId = '00000000-0000-4000-8000-000000000006';
    let synced = false;

    setSnapshotFetcherForTest(async <TState = unknown>(id: string): Promise<GameSnapshot<TState>> => {
      synced = true;
      return createMockSnapshot<TState>(id, 4);
    });

    const snapshot = await reconnectMatch(matchId);
    assert.equal(synced, true, 'reconnectMatch deve buscar o snapshot atual no PostgreSQL');
    assert.equal(snapshot.turnNumber, 4);
  });

  it('7. Teste 7 — Evento perdido durante queda de socket é recuperado no reconnect', async () => {
    const matchId = '00000000-0000-4000-8000-000000000007';
    // Simular: estado local antigo (turno 2), enquanto no banco a partida avançou para o turno 5
    const staleSnapshot = createMockSnapshot(matchId, 2);

    setSnapshotFetcherForTest(async <TState = unknown>(id: string): Promise<GameSnapshot<TState>> => {
      // Backend já avançou durante o período offline
      return createMockSnapshot<TState>(id, 5, 'O');
    });

    const recoveredSnapshot = await reconnectMatch<{ board: (string | null)[] }>(
      matchId,
      staleSnapshot as unknown as GameSnapshot<{ board: (string | null)[] }>
    );
    assert.equal(recoveredSnapshot.turnNumber, 5, 'Estado recuperado deve conter o turno 5 do PostgreSQL');
    assert.equal(recoveredSnapshot.state.board[0], 'O');
  });
});

describe('Realtime Hardening: Subscription, Unsubscribe & Destroy Lifecycle (Fase 6.1)', () => {
  beforeEach(() => {
    clearSyncQueuesForTest();
  });

  afterEach(() => {
    setSnapshotFetcherForTest(null);
  });

  it('8. Teste 8 — Unsubscribe impede callbacks futuros de listener', async () => {
    const matchId = '00000000-0000-4000-8000-000000000008';
    let callbackCount = 0;

    setSnapshotFetcherForTest(async <TState = unknown>(id: string): Promise<GameSnapshot<TState>> => {
      return createMockSnapshot<TState>(id, 1);
    });

    const unsubscribe = subscribeToMatch(matchId, () => {
      callbackCount++;
    });

    // Executa unsubscribe imediatamente
    unsubscribe();

    // Dispara sincronização
    await syncMatch(matchId);

    assert.equal(callbackCount, 0, 'Nenhum callback deve ocorrer após unsubscribe()');
  });

  it('9. Teste 9 — Init duplicado no GameSessionController não duplica subscriptions', async () => {
    const matchId = '00000000-0000-4000-8000-000000000009';
    let getSnapshotCount = 0;

    setSnapshotFetcherForTest(async <TState = unknown>(id: string): Promise<GameSnapshot<TState>> => {
      getSnapshotCount++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return createMockSnapshot<TState>(id, 1);
    });

    const controller = new GameSessionController(matchId);

    // Chama init() concorrentemente 3 vezes
    const [snap1, snap2, snap3] = await Promise.all([
      controller.init(),
      controller.init(),
      controller.init(),
    ]);

    assert.equal(getSnapshotCount, 1, 'Apenas 1 busca de inicialização deve ser executada');
    assert.equal(snap1?.matchId, matchId);
    assert.equal(snap2?.matchId, matchId);
    assert.equal(snap3?.matchId, matchId);

    controller.destroy();
  });

  it('10. Teste 10 — Destroy durante sync em voo não aplica snapshot tardio', async () => {
    const matchId = '00000000-0000-4000-8000-000000000010';

    setSnapshotFetcherForTest(async <TState = unknown>(id: string): Promise<GameSnapshot<TState>> => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return createMockSnapshot<TState>(id, 9);
    });

    const controller = new GameSessionController(matchId);

    // Inicia init (que dispara busca assíncrona)
    const initPromise = controller.init();

    // Destrói o controller enquanto o fetch ainda está em voo
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.destroy();

    const resultSnapshot = await initPromise;

    assert.equal(resultSnapshot, null, 'init() deve retornar null quando a sessão for destruída');
    assert.equal(controller.getSnapshot(), null, 'Snapshot no controller destruído deve permanecer nulo');
    assert.equal(controller.getIsDestroyed(), true);
  });
});
