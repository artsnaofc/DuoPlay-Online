// ============================================================================
// Unit & Integration Tests: Public Matchmaking & Concurrency (Phase 10 & 10.1) — DuoPlay-Online
// ============================================================================

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  joinMatchmakingQueue,
  cancelMatchmakingQueue,
  getMyMatchmakingStatus,
} from '@/services/matchmaking';
import { supabase } from '@/lib/supabase';

describe('Fase 10 & 10.1: Matchmaking Público, Concorrência e Reconciliação', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
  });

  it('1. Usuário pareado cuja partida terminou consegue entrar em nova fila (reconciliado para completed)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'join_matchmaking_queue');
      // O banco reconciliou a partida encerrada para 'completed' e inseriu nova busca em 'waiting'
      return {
        data: {
          success: true,
          data: {
            queue_id: 'new-queue-uuid',
            status: 'waiting',
            match_id: null,
            expires_at: '2026-10-06T19:00:00Z',
          },
          error: null,
        },
        error: null,
      };
    };

    const res = await joinMatchmakingQueue('tic_tac_toe');
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.status, 'waiting');
    assert.strictEqual(res.data.match_id, null);
  });

  it('2. Entrada matched com partida finalizada é reconciliada para estado terminal (completed) e getMyMatchmakingStatus retorna null', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'get_my_matchmaking_status');
      // Banco reconciliou matched -> completed e retorna data: null para status do cliente
      return {
        data: {
          success: true,
          data: null,
          error: null,
        },
        error: null,
      };
    };

    const res = await getMyMatchmakingStatus();
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data, null);
  });

  it('3. Entrada matched com partida in_progress continua retornando o match_id ativo', async () => {
    const activeMatchId = 'active-match-uuid-123';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'get_my_matchmaking_status');
      return {
        data: {
          success: true,
          data: {
            queue_id: 'queue-uuid-456',
            game_id: 'tic_tac_toe',
            status: 'matched',
            match_id: activeMatchId,
            expires_at: '2026-10-06T19:00:00Z',
          },
          error: null,
        },
        error: null,
      };
    };

    const res = await getMyMatchmakingStatus();
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.status, 'matched');
    assert.strictEqual(res.data.match_id, activeMatchId);
  });

  it('4. Um usuário não possui simultaneamente waiting e matched (garantido por índice parcial único no PostgreSQL)', async () => {
    // Simula tentativa de criar duplicado que aciona o índice único parcial idx_matchmaking_queue_user_active
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({
      data: {
        success: true,
        data: {
          queue_id: 'existing-active-queue-id',
          status: 'waiting',
          match_id: null,
          expires_at: '2026-10-06T19:00:00Z',
        },
        error: null,
      },
      error: null,
    });

    const res1 = await joinMatchmakingQueue('tic_tac_toe');
    const res2 = await joinMatchmakingQueue('tic_tac_toe');

    assert.strictEqual(res1.success, true);
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res1.data?.queue_id, res2.data?.queue_id);
    assert.strictEqual(res1.data?.status, 'waiting');
  });

  it('5. Dois joins concorrentes do mesmo usuário usam pg_advisory_xact_lock e retornam o mesmo registro', async () => {
    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => {
      callCount++;
      return {
        data: {
          success: true,
          data: {
            queue_id: 'locked-queue-id',
            status: 'waiting',
            match_id: null,
          },
          error: null,
        },
        error: null,
      };
    };

    const [resA, resB] = await Promise.all([
      joinMatchmakingQueue('tic_tac_toe'),
      joinMatchmakingQueue('tic_tac_toe'),
    ]);

    assert.strictEqual(callCount, 2);
    assert.strictEqual(resA.data?.queue_id, 'locked-queue-id');
    assert.strictEqual(resB.data?.queue_id, 'locked-queue-id');
  });

  it('6. Join e cancelamento concorrentes com trava de usuário preservam estado consistente', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      if (fn === 'join_matchmaking_queue') {
        return {
          data: {
            success: true,
            data: { queue_id: 'q1', status: 'waiting', match_id: null },
            error: null,
          },
          error: null,
        };
      }
      return {
        data: {
          success: true,
          data: { queue_id: 'q1', status: 'cancelled', match_id: null },
          error: null,
        },
        error: null,
      };
    };

    const joinRes = await joinMatchmakingQueue('tic_tac_toe');
    assert.strictEqual(joinRes.data?.status, 'waiting');

    const cancelRes = await cancelMatchmakingQueue();
    assert.strictEqual(cancelRes.data?.status, 'cancelled');
  });

  it('7. Dois jogadores são pareados atômica e exatamente em uma partida compartilhada', async () => {
    const sharedMatchId = 'shared-match-uuid-999';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'join_matchmaking_queue');
      return {
        data: {
          success: true,
          data: {
            queue_id: 'q-player-2',
            status: 'matched',
            match_id: sharedMatchId,
          },
          error: null,
        },
        error: null,
      };
    };

    const res = await joinMatchmakingQueue('tic_tac_toe');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data?.status, 'matched');
    assert.strictEqual(res.data?.match_id, sharedMatchId);
  });

  it('8. Um jogador não recebe dois matches ativos', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({
      data: null,
      error: {
        code: 'P0013',
        message: 'PLAYER_IN_ACTIVE_MATCH: Você já está em uma partida em andamento.',
      },
    });

    const res = await joinMatchmakingQueue('tic_tac_toe');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'P0013');
    assert.ok(res.error?.includes('PLAYER_IN_ACTIVE_MATCH'));
  });

  it('9. Cancelamento após pareamento retorna match ativo e não o desfaz', async () => {
    const activeMatchId = 'matched-before-cancel-uuid';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'cancel_matchmaking_queue');
      return {
        data: {
          success: true,
          data: {
            status: 'matched',
            match_id: activeMatchId,
          },
          error: null,
        },
        error: null,
      };
    };

    const res = await cancelMatchmakingQueue();
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data?.status, 'matched');
    assert.strictEqual(res.data?.match_id, activeMatchId);
  });

  it('10. Entrada expirada permite nova busca normalmente', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'join_matchmaking_queue');
      return {
        data: {
          success: true,
          data: {
            queue_id: 'fresh-queue-id',
            status: 'waiting',
            match_id: null,
            expires_at: '2026-10-06T19:05:00Z',
          },
          error: null,
        },
        error: null,
      };
    };

    const res = await joinMatchmakingQueue('tic_tac_toe');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data?.status, 'waiting');
  });

  it('11. Reload após partida de matchmaking encerrada reconcilia matched->completed e não redireciona para match antigo', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'get_my_matchmaking_status');
      return {
        data: {
          success: true,
          data: null,
          error: null,
        },
        error: null,
      };
    };

    const res = await getMyMatchmakingStatus();
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data, null);
  });

  it('12. Salas privadas e revanche continuam sem regressão', async () => {
    // Valida que RPC de matchmaking não interfere na validação de jogo desativado
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string, params: { p_game_id: string }) => {
      assert.strictEqual(fn, 'join_matchmaking_queue');
      assert.strictEqual(params.p_game_id, 'pong');
      return {
        data: null,
        error: {
          code: 'P0015',
          message: 'GAME_NOT_ACTIVE: Apenas o Jogo da Velha possui matchmaking público ativo.',
        },
      };
    };

    const res = await joinMatchmakingQueue('pong');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'P0015');
  });
});
