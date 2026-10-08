// ============================================================================
// Unit & Integration Tests: Fase 23 — Matchmaking Simultâneo Multijogo
// ============================================================================

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  joinMatchmakingQueue,
  cancelMatchmakingQueue,
  getMyActiveMatchmakingQueues,
  getMyMatchmakingStatus,
} from '@/services/matchmaking';
import { supabase } from '@/lib/supabase';
import { listGames, getGameDefinition } from '@/multiplayer/registry/index';

describe('Fase 23: Matchmaking Simultâneo Multijogo e Seleção na Home', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
  });

  it('1. Game Registry expõe dinamicamente catálogo com múltiplos jogos disponíveis', () => {
    const allGames = listGames();
    assert.ok(allGames.length >= 3, 'Deve haver ao menos 3 jogos registrados');

    const availableGames = allGames.filter((g) => g.isAvailable);
    assert.ok(availableGames.length >= 3, 'Jogo da Velha, Carta Duo e Snake devem estar ativos');

    const ttt = getGameDefinition('tic_tac_toe');
    assert.ok(ttt);
    assert.strictEqual(ttt.title, 'Jogo da Velha');

    const snake = getGameDefinition('snake');
    assert.ok(snake);
    assert.strictEqual(snake.title, 'Cobrinha Competitiva');

    const cartaDuo = getGameDefinition('carta_duo');
    assert.ok(cartaDuo);
    assert.strictEqual(cartaDuo.title, 'Carta Duo');
  });

  it('2. Usuário pode entrar na fila de múltiplos jogos simultaneamente (Snake + Carta Duo)', async () => {
    const calls: { fn: string; args: any }[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string, args: any) => {
      calls.push({ fn, args });
      return {
        data: {
          success: true,
          data: {
            queue_id: `q-${args?.p_game_id}`,
            game_id: args?.p_game_id,
            status: 'waiting',
            match_id: null,
          },
          error: null,
        },
        error: null,
      };
    };

    const resSnake = await joinMatchmakingQueue('snake');
    assert.strictEqual(resSnake.success, true);
    assert.strictEqual(resSnake.data?.game_id, 'snake');
    assert.strictEqual(resSnake.data?.status, 'waiting');

    const resCD = await joinMatchmakingQueue('carta_duo');
    assert.strictEqual(resCD.success, true);
    assert.strictEqual(resCD.data?.game_id, 'carta_duo');
    assert.strictEqual(resCD.data?.status, 'waiting');

    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].args.p_game_id, 'snake');
    assert.strictEqual(calls[1].args.p_game_id, 'carta_duo');
  });

  it('3. getMyActiveMatchmakingQueues retorna lista de todas as filas simultâneas ativas', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'get_my_active_matchmaking_queues');
      return {
        data: {
          success: true,
          data: [
            { queue_id: 'q1', game_id: 'snake', status: 'waiting', match_id: null },
            { queue_id: 'q2', game_id: 'tic_tac_toe', status: 'waiting', match_id: null },
            { queue_id: 'q3', game_id: 'carta_duo', status: 'waiting', match_id: null },
          ],
          error: null,
        },
        error: null,
      };
    };

    const res = await getMyActiveMatchmakingQueues();
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data?.length, 3);
    assert.strictEqual(res.data?.[0].game_id, 'snake');
    assert.strictEqual(res.data?.[1].game_id, 'tic_tac_toe');
    assert.strictEqual(res.data?.[2].game_id, 'carta_duo');
  });

  it('4. Cancelamento individual cancela apenas a fila do jogo especificado via p_game_id', async () => {
    let capturedArgs: any = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string, args: any) => {
      assert.strictEqual(fn, 'cancel_matchmaking_queue');
      capturedArgs = args;
      return {
        data: {
          success: true,
          data: {
            status: 'cancelled',
            game_id: args?.p_game_id,
            cancelled_count: 1,
            match_id: null,
          },
          error: null,
        },
        error: null,
      };
    };

    const res = await cancelMatchmakingQueue('snake');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data?.status, 'cancelled');
    assert.strictEqual(capturedArgs?.p_game_id, 'snake');
  });

  it('5. Cancelamento global sem parâmetros cancela todas as filas', async () => {
    let capturedArgs: any = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string, args: any) => {
      assert.strictEqual(fn, 'cancel_matchmaking_queue');
      capturedArgs = args;
      return {
        data: {
          success: true,
          data: {
            status: 'cancelled',
            game_id: null,
            cancelled_count: 3,
            match_id: null,
          },
          error: null,
        },
        error: null,
      };
    };

    const res = await cancelMatchmakingQueue();
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data?.status, 'cancelled');
    assert.deepStrictEqual(capturedArgs, {});
  });

  it('6. Quando um match é encontrado, cancelamento concorrente preserva a partida', async () => {
    const targetMatchId = 'matched-winner-id-123';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'cancel_matchmaking_queue');
      return {
        data: {
          success: true,
          data: {
            status: 'matched',
            match_id: targetMatchId,
          },
          error: null,
        },
        error: null,
      };
    };

    const res = await cancelMatchmakingQueue('tic_tac_toe');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data?.status, 'matched');
    assert.strictEqual(res.data?.match_id, targetMatchId);
  });
});
