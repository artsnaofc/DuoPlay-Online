// ============================================================================
// Unit & Integration Tests: Match History & Results — DuoPlay-Online
// Phase: Fase 8.1 — Implementação do Resultado da Partida + Histórico
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getMyMatchHistory,
  type MatchHistoryItem,
  type MatchHistoryResponse,
} from '@/services/matchHistory';
import { GameSessionController } from '../controllers/GameSessionController';
import { setSnapshotFetcherForTest } from '../network/snapshot';
import { clearSyncQueuesForTest } from '../network/sync';
import type { GameSnapshot } from '../network/types';
import type { FinishReason } from '@/types/multiplayer';
import { supabase } from '@/lib/supabase';

describe('Fase 8.1: Serviço de Histórico de Partidas (RPC get_my_match_history)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
  });

  it('1. Deve consultar histórico com sucesso e normalizar os campos', async () => {
    const mockRpcData = {
      success: true,
      data: {
        matches: [
          {
            match_id: '11111111-1111-4000-8000-000000000001',
            game_id: 'tic_tac_toe',
            game_name: 'Jogo da Velha',
            status: 'finished',
            winner_id: '00000000-0000-4000-8000-000000000001',
            is_draw: false,
            finish_reason: 'normal',
            turn_number: 5,
            started_at: '2026-10-06T12:00:00Z',
            finished_at: '2026-10-06T12:04:32Z',
            duration_seconds: 272,
            my_slot: 1,
            my_symbol: 'X',
            my_score: 1,
            is_winner: true,
            outcome: 'win',
            opponents: [
              {
                user_id: '00000000-0000-4000-8000-000000000002',
                display_name: 'João Silva',
                username: 'joaosilva',
                slot: 2,
                game_symbol: 'O',
                is_winner: false,
                score: 0,
              },
            ],
          },
        ],
        total_count: 1,
        limit: 20,
        offset: 0,
        has_more: false,
      },
      error: null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string, params: { p_limit: number; p_offset: number }) => {
      assert.strictEqual(fn, 'get_my_match_history');
      assert.strictEqual(params.p_limit, 20);
      assert.strictEqual(params.p_offset, 0);
      return { data: mockRpcData, error: null };
    };

    const res = await getMyMatchHistory(20, 0);
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.matches.length, 1);
    assert.strictEqual(res.data.total_count, 1);
    assert.strictEqual(res.data.has_more, false);

    const firstMatch = res.data.matches[0];
    assert.strictEqual(firstMatch.match_id, '11111111-1111-4000-8000-000000000001');
    assert.strictEqual(firstMatch.game_name, 'Jogo da Velha');
    assert.strictEqual(firstMatch.outcome, 'win');
    assert.strictEqual(firstMatch.is_winner, true);
    assert.strictEqual(firstMatch.duration_seconds, 272);
    assert.strictEqual(firstMatch.opponents[0].display_name, 'João Silva');
  });

  it('2. Deve tratar estado vazio quando o usuário não tiver partidas registradas', async () => {
    const emptyRpcData = {
      success: true,
      data: {
        matches: [],
        total_count: 0,
        limit: 20,
        offset: 0,
        has_more: false,
      },
      error: null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({ data: emptyRpcData, error: null });

    const res = await getMyMatchHistory(20, 0);
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.matches.length, 0);
    assert.strictEqual(res.data.total_count, 0);
    assert.strictEqual(res.data.has_more, false);
  });

  it('3. Deve lidar com paginação e offset (has_more = true)', async () => {
    const paginatedRpcData = {
      success: true,
      data: {
        matches: new Array(20).fill(null).map((_, i) => ({
          match_id: `match-id-${i}`,
          game_id: 'tic_tac_toe',
          game_name: 'Jogo da Velha',
          status: 'finished',
          winner_id: '00000000-0000-4000-8000-000000000001',
          is_draw: false,
          finish_reason: 'normal',
          turn_number: 7,
          started_at: '2026-10-06T12:00:00Z',
          finished_at: '2026-10-06T12:02:00Z',
          duration_seconds: 120,
          my_slot: 1,
          my_symbol: 'X',
          my_score: 1,
          is_winner: true,
          outcome: 'win',
          opponents: [],
        })),
        total_count: 45,
        limit: 20,
        offset: 0,
        has_more: true,
      },
      error: null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({ data: paginatedRpcData, error: null });

    const res = await getMyMatchHistory(20, 0);
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.matches.length, 20);
    assert.strictEqual(res.data.total_count, 45);
    assert.strictEqual(res.data.has_more, true);
  });

  it('4. Deve capturar e mapear erro do Supabase de forma segura', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({
      data: null,
      error: { code: 'P0001', message: 'UNAUTHORIZED: Usuário não autenticado.' },
    });

    const res = await getMyMatchHistory(20, 0);
    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes('UNAUTHORIZED') || res.error?.includes('não autenticado'));
    assert.strictEqual(res.code, 'P0001');
  });
});

describe('Fase 8.1: Bloqueio de Ciclo de Vida em Partidas Finalizadas', () => {
  const matchId = '11111111-2222-3333-4444-555555555555';
  const p1 = '00000000-0000-4000-8000-000000000001';
  const p2 = '00000000-0000-4000-8000-000000000002';

  function createFinishedMockSnapshot<TState = unknown>(
    finishReason: FinishReason = 'normal'
  ): GameSnapshot<TState> {
    return {
      matchId,
      roomId: 'room-1',
      gameId: 'tic_tac_toe',
      status: 'finished',
      state: { board: ['X', 'X', 'X', 'O', 'O', null, null, null, null] } as unknown as TState,
      currentTurnPlayerId: p1,
      turnNumber: 5,
      turnDeadline: null,
      winnerId: p1,
      isDraw: false,
      finishReason,
      version: 5,
      actionHistory: [],
      createdAt: '2026-10-06T12:00:00Z',
      startedAt: '2026-10-06T12:00:00Z',
      finishedAt: '2026-10-06T12:04:30Z',
      players: [
        {
          userId: p1,
          slot: 1,
          gameSymbol: 'X',
          score: 1,
          isWinner: true,
          disconnectedAt: null,
          gracePeriodExpiresAt: null,
          lastSeenAt: '2026-10-06T12:00:00Z',
          connectionStatus: 'connected',
          joinedAt: '2026-10-06T12:00:00Z',
        },
        {
          userId: p2,
          slot: 2,
          gameSymbol: 'O',
          score: 0,
          isWinner: false,
          disconnectedAt: null,
          gracePeriodExpiresAt: null,
          lastSeenAt: '2026-10-06T12:00:00Z',
          connectionStatus: 'connected',
          joinedAt: '2026-10-06T12:00:00Z',
        },
      ],
    };
  }

  beforeEach(() => {
    clearSyncQueuesForTest();
  });

  afterEach(() => {
    setSnapshotFetcherForTest(null);
  });

  it('5. Partida com status finished não deve ativar heartbeat no init()', async () => {
    setSnapshotFetcherForTest(async () => createFinishedMockSnapshot('normal'));

    const controller = new GameSessionController(matchId);
    const snapshot = await controller.init();

    assert.ok(snapshot);
    assert.strictEqual(snapshot.status, 'finished');
    assert.strictEqual(snapshot.winnerId, p1);
    assert.strictEqual(controller.getIsHeartbeatActive(), false);

    controller.destroy();
  });

  it('6. startHeartbeat() em partida finished é uma no-op imediata', async () => {
    setSnapshotFetcherForTest(async () => createFinishedMockSnapshot('abandonment'));

    const controller = new GameSessionController(matchId);
    await controller.init();

    controller.startHeartbeat(1000);
    assert.strictEqual(controller.getIsHeartbeatActive(), false);

    controller.destroy();
  });
});
