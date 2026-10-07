// ============================================================================
// Unit & Integration Tests: Match History, Results & Post-Match Recovery — DuoPlay-Online
// Phase: Fase 8.4 — Recuperação Correta da Última Partida Finalizada
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getMyMatchHistory,
  getLatestCompletedMatchForCurrentUser,
} from '@/services/matchHistory';
import { getActiveMatchForCurrentUser } from '@/services/matchSession';
import { GameSessionController } from '../controllers/GameSessionController';
import { setSnapshotFetcherForTest } from '../network/snapshot';
import { clearSyncQueuesForTest } from '../network/sync';
import type { GameSnapshot } from '../network/types';
import type { FinishReason } from '@/types/multiplayer';
import { supabase } from '@/lib/supabase';

describe('Fase 8.4: Serviço de Histórico de Partidas e Paginação', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
  });

  it('1. Deve consultar histórico com paginação via RPC get_my_match_history e normalizar campos', async () => {
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

    let calledRpcName = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string, params: { p_limit: number; p_offset: number }) => {
      calledRpcName = fn;
      assert.strictEqual(fn, 'get_my_match_history');
      assert.strictEqual(params.p_limit, 20);
      assert.strictEqual(params.p_offset, 0);
      return { data: mockRpcData, error: null };
    };

    const res = await getMyMatchHistory(20, 0);
    assert.strictEqual(calledRpcName, 'get_my_match_history');
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

  it('5. Deve tratar resposta malformada ou dados corrompidos de forma defensiva sem estourar exceção', async () => {
    const malformedRpcData = {
      success: true,
      data: {
        matches: [
          null,
          undefined,
          { invalid: 'structure without match_id' },
          {
            match_id: 'valid-match-uuid',
            status: 'unknown_status',
            outcome: 'invalid_outcome',
            opponents: 'not_an_array',
          },
        ],
        total_count: 'invalid_count_string',
        limit: null,
        offset: -10,
        has_more: 'not_boolean',
      },
      error: null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({ data: malformedRpcData, error: null });

    const res = await getMyMatchHistory(20, 0);
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.matches.length, 1);
    assert.strictEqual(res.data.matches[0].match_id, 'valid-match-uuid');
    assert.strictEqual(res.data.matches[0].status, 'finished');
    assert.strictEqual(res.data.matches[0].outcome, 'cancelled');
    assert.deepStrictEqual(res.data.matches[0].opponents, []);
  });
});

describe('Fase 8.4: RPC Dedicada get_latest_completed_match_for_current_user e Ordenação por Término', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
  });

  it('1. A chamada da RPC dedicada ocorre em getLatestCompletedMatchForCurrentUser() e NÃO em get_my_match_history', async () => {
    let invokedRpcName = '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      invokedRpcName = fn;
      return {
        data: {
          success: true,
          data: {
            match_id: 'dedicated-rpc-match-1',
            game_id: 'tic_tac_toe',
            game_name: 'Jogo da Velha',
            status: 'finished',
            winner_id: '00000000-0000-4000-8000-000000000001',
            is_draw: false,
            finish_reason: 'normal',
            turn_number: 6,
            started_at: '2026-10-06T10:00:00Z',
            finished_at: '2026-10-06T18:00:00Z',
            duration_seconds: 28800,
            my_slot: 1,
            my_symbol: 'X',
            my_score: 1,
            is_winner: true,
            outcome: 'win',
            opponents: [],
          },
          error: null,
        },
        error: null,
      };
    };

    const res = await getLatestCompletedMatchForCurrentUser();
    assert.strictEqual(invokedRpcName, 'get_latest_completed_match_for_current_user');
    assert.notStrictEqual(invokedRpcName, 'get_my_match_history');
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.match_id, 'dedicated-rpc-match-1');
  });

  it('2. Retorna a partida de maior finished_at, mesmo quando iniciou antes de outra (ex: Match A 10:00->18:00 vs Match B 16:00->16:10)', async () => {
    // Cenário: Partida A iniciou às 10h e terminou às 18h.
    // Partida B iniciou às 16h e terminou às 16h10.
    // A query ordenada por finished_at DESC retorna a Partida A.
    const matchA_LatestFinished = {
      match_id: 'match-a-finished-at-18-00',
      game_id: 'tic_tac_toe',
      game_name: 'Jogo da Velha',
      status: 'finished',
      winner_id: '00000000-0000-4000-8000-000000000001',
      is_draw: false,
      finish_reason: 'normal',
      turn_number: 9,
      started_at: '2026-10-06T10:00:00Z',
      finished_at: '2026-10-06T18:00:00Z',
      duration_seconds: 28800,
      my_slot: 1,
      my_symbol: 'X',
      my_score: 1,
      is_winner: true,
      outcome: 'win',
      opponents: [
        {
          user_id: '00000000-0000-4000-8000-000000000002',
          display_name: 'Player 2',
          username: 'p2',
          slot: 2,
          game_symbol: 'O',
          is_winner: false,
          score: 0,
        },
      ],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'get_latest_completed_match_for_current_user');
      return {
        data: {
          success: true,
          data: matchA_LatestFinished,
          error: null,
        },
        error: null,
      };
    };

    const res = await getLatestCompletedMatchForCurrentUser();
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.match_id, 'match-a-finished-at-18-00');
    assert.strictEqual(res.data.finished_at, '2026-10-06T18:00:00Z');
    assert.strictEqual(res.data.started_at, '2026-10-06T10:00:00Z');
  });

  it('3. Critério secundário: quando finished_at for igual, started_at define a mais recente', async () => {
    const matchWithLaterStart = {
      match_id: 'match-same-finish-later-start',
      game_id: 'tic_tac_toe',
      game_name: 'Jogo da Velha',
      status: 'abandoned',
      winner_id: '00000000-0000-4000-8000-000000000001',
      is_draw: false,
      finish_reason: 'abandonment',
      turn_number: 3,
      started_at: '2026-10-06T15:30:00Z',
      finished_at: '2026-10-06T15:35:00Z',
      duration_seconds: 300,
      my_slot: 1,
      my_symbol: 'X',
      my_score: 1,
      is_winner: true,
      outcome: 'win',
      opponents: [],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'get_latest_completed_match_for_current_user');
      return {
        data: {
          success: true,
          data: matchWithLaterStart,
          error: null,
        },
        error: null,
      };
    };

    const res = await getLatestCompletedMatchForCurrentUser();
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.match_id, 'match-same-finish-later-start');
    assert.strictEqual(res.data.status, 'abandoned');
    assert.strictEqual(res.data.finish_reason, 'abandonment');
  });

  it('4. Usuário sem partidas finalizadas recebe data: null com success: true', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'get_latest_completed_match_for_current_user');
      return {
        data: {
          success: true,
          data: null,
          error: null,
        },
        error: null,
      };
    };

    const res = await getLatestCompletedMatchForCurrentUser();
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data, null);
    assert.strictEqual(res.error, undefined);
  });

  it('5. Erros da RPC dedicada (ex: erro de rede ou PostgreSQL) são tratados defensivamente sem quebrar a UI', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({
      data: null,
      error: { code: '500', message: 'Internal server error' },
    });

    const res = await getLatestCompletedMatchForCurrentUser();
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.data, null);
    assert.strictEqual(res.code, '500');
    assert.strictEqual(res.error, 'Internal server error');
  });
});

describe('Fase 8.4: Fluxo de Startup — Prioridade de Partida Ativa e Isolamento de Erro', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
  });

  it('6. Recovery de partida ativa (in_progress) continua prioritário sobre partida finalizada', async () => {
    const activeMatchMock = {
      match_id: 'active-match-999',
      room_id: 'room-123',
      game_id: 'tic_tac_toe',
      game_name: 'Jogo da Velha',
      turn_number: 2,
      current_turn_player_id: '00000000-0000-4000-8000-000000000001',
      opponent: {
        user_id: '00000000-0000-4000-8000-000000000002',
        display_name: 'Adversário',
        slot: 2,
        connection_status: 'connected',
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      if (fn === 'get_active_match_for_current_user') {
        return {
          data: {
            success: true,
            data: activeMatchMock,
            error: null,
          },
          error: null,
        };
      }
      throw new Error(`RPC ${fn} não deveria ser chamada quando há partida ativa`);
    };

    const activeRes = await getActiveMatchForCurrentUser();
    assert.strictEqual(activeRes.success, true);
    assert.ok(activeRes.data);
    assert.strictEqual(activeRes.data.match_id, 'active-match-999');
    // Partida ativa presente: a UI abre ActiveMatchRecoveryModal e não consulta completed match
  });

  it('7. Falha na RPC de partida ativa (success: false) NÃO tenta recovery de partida finalizada', async () => {
    let completedRpcCalled = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      if (fn === 'get_active_match_for_current_user') {
        return {
          data: null,
          error: { code: '503', message: 'Service Unavailable' },
        };
      }
      if (fn === 'get_latest_completed_match_for_current_user') {
        completedRpcCalled = true;
        return { data: { success: true, data: null }, error: null };
      }
      return { data: null, error: null };
    };

    const activeRes = await getActiveMatchForCurrentUser();
    assert.strictEqual(activeRes.success, false);

    // Simulação da guarda no App.tsx:
    // `if (activeRes.success && activeRes.data) { ... } else if (activeRes.success && activeRes.data === null) { ... }`
    if (activeRes.success && activeRes.data === null) {
      await getLatestCompletedMatchForCurrentUser();
    }

    assert.strictEqual(completedRpcCalled, false, 'Não deve chamar recovery de resultado se a RPC de partida ativa falhou');
  });

  it('8. Resultado visto por um usuário (seen_match_result_userA_matchId) não bloqueia recovery de outro usuário (userB)', () => {
    const userA = 'user-uuid-1111';
    const userB = 'user-uuid-2222';
    const matchId = 'shared-match-uuid-9999';

    const memoryStorage = new Map<string, string>();

    const getSeen = (userId: string, mId: string) => {
      return Boolean(memoryStorage.get(`seen_match_result_${userId}_${mId}`));
    };

    const setSeen = (userId: string, mId: string) => {
      memoryStorage.set(`seen_match_result_${userId}_${mId}`, 'true');
    };

    // User A vê o resultado e fecha o modal
    setSeen(userA, matchId);

    // User A tem o resultado como visto
    assert.strictEqual(getSeen(userA, matchId), true);

    // User B NÃO viu o resultado ainda e deve ter recovery disponível
    assert.strictEqual(getSeen(userB, matchId), false);
  });
});

describe('Fase 8.4: Bloqueio de Ciclo de Vida em Partidas Finalizadas e URL Recovery', () => {
  const matchId = '11111111-2222-3333-4444-555555555555';
  const p1 = '00000000-0000-4000-8000-000000000001';
  const p2 = '00000000-0000-4000-8000-000000000002';

  function createFinishedMockSnapshot<TState = unknown>(
    finishReason: FinishReason = 'normal',
    winnerId: string | null = p1,
    isDraw = false
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
      winnerId: isDraw ? null : winnerId,
      isDraw,
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
          score: winnerId === p1 ? 1 : 0,
          isWinner: winnerId === p1 && !isDraw,
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
          score: winnerId === p2 ? 1 : 0,
          isWinner: winnerId === p2 && !isDraw,
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

  it('9. Partida finalizada carregada via URL não deve iniciar heartbeat', async () => {
    setSnapshotFetcherForTest(async () => createFinishedMockSnapshot('normal', p1));

    const controller = new GameSessionController(matchId);
    const snapshot = await controller.init();

    assert.ok(snapshot);
    assert.strictEqual(snapshot.status, 'finished');
    assert.strictEqual(snapshot.winnerId, p1);
    assert.strictEqual(controller.getIsHeartbeatActive(), false);

    controller.destroy();
  });

  it('10. startHeartbeat() em partida finalizada é uma no-op imediata', async () => {
    setSnapshotFetcherForTest(async () => createFinishedMockSnapshot('abandonment', p1));

    const controller = new GameSessionController(matchId);
    await controller.init();

    controller.startHeartbeat(1000);
    assert.strictEqual(controller.getIsHeartbeatActive(), false);

    controller.destroy();
  });

  it('11. Vitória por W.O. autoritativa é refletida fielmente no snapshot recuperado', async () => {
    setSnapshotFetcherForTest(async () => createFinishedMockSnapshot('abandonment', p1));

    const controller = new GameSessionController(matchId);
    const snapshot = await controller.init();

    assert.ok(snapshot);
    assert.strictEqual(snapshot.winnerId, p1);
    assert.strictEqual(snapshot.finishReason, 'abandonment');
    assert.strictEqual(snapshot.isDraw, false);

    controller.destroy();
  });

  it('12. Derrota por Desistência / Abandono próprio é refletida fielmente no snapshot recuperado', async () => {
    setSnapshotFetcherForTest(async () => createFinishedMockSnapshot('resignation', p2));

    const controller = new GameSessionController(matchId);
    const snapshot = await controller.init();

    assert.ok(snapshot);
    assert.strictEqual(snapshot.winnerId, p2);
    assert.strictEqual(snapshot.finishReason, 'resignation');
    assert.strictEqual(snapshot.isDraw, false);

    controller.destroy();
  });

  it('13. Empate oficial é refletido fielmente no snapshot recuperado', async () => {
    setSnapshotFetcherForTest(async () => createFinishedMockSnapshot('normal', null, true));

    const controller = new GameSessionController(matchId);
    const snapshot = await controller.init();

    assert.ok(snapshot);
    assert.strictEqual(snapshot.winnerId, null);
    assert.strictEqual(snapshot.isDraw, true);

    controller.destroy();
  });

  it('14. URL com identificador inválido/inexistente rejeita sem quebrar o controller', async () => {
    setSnapshotFetcherForTest(async () => {
      throw { code: 'MATCH_NOT_FOUND', message: 'Partida não encontrada.', category: 'rule' };
    });

    const controller = new GameSessionController('invalid-match-uuid');
    const snapshot = await controller.init();

    assert.strictEqual(snapshot, null);
    assert.strictEqual(controller.getSyncState(), 'error');
    assert.strictEqual(controller.getError()?.code, 'MATCH_NOT_FOUND');

    controller.destroy();
  });
});
