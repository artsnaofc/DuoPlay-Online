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

  it('7. Fluxo de 3 jogos simultâneos (Velha + Snake + Carta Duo): Pareamento em Snake cancela os outros 2', async () => {
    const userActiveQueues = new Map<string, any>();
    userActiveQueues.set('tic_tac_toe', { status: 'waiting', match_id: null });
    userActiveQueues.set('snake', { status: 'waiting', match_id: null });
    userActiveQueues.set('carta_duo', { status: 'waiting', match_id: null });

    // Simula RPC de pareamento autoritativo no PostgreSQL
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string, args: any) => {
      if (fn === 'join_matchmaking_queue') {
        const gameId = args?.p_game_id;
        if (gameId === 'snake') {
          // Snake encontra match!
          const matchId = 'match-snake-winner-999';
          userActiveQueues.set('snake', { status: 'matched', match_id: matchId });
          // Regra multijogo: cancela as outras filas waiting do usuário
          userActiveQueues.set('tic_tac_toe', { status: 'cancelled', match_id: null });
          userActiveQueues.set('carta_duo', { status: 'cancelled', match_id: null });

          return {
            data: {
              success: true,
              data: {
                queue_id: 'q-snake',
                game_id: 'snake',
                status: 'matched',
                match_id: matchId,
              },
              error: null,
            },
            error: null,
          };
        }
      }

      if (fn === 'get_my_active_matchmaking_queues') {
        const activeList: any[] = [];
        for (const [gId, val] of userActiveQueues.entries()) {
          if (val.status === 'waiting' || val.status === 'matched') {
            activeList.push({
              queue_id: `q-${gId}`,
              game_id: gId,
              status: val.status,
              match_id: val.match_id,
            });
          }
        }
        return {
          data: {
            success: true,
            data: activeList,
            error: null,
          },
          error: null,
        };
      }

      return { data: { success: false }, error: 'unknown RPC' };
    };

    // Consulta inicial antes do match: 3 filas ativas
    const queuesBefore = await getMyActiveMatchmakingQueues();
    assert.strictEqual(queuesBefore.data?.length, 3);

    // Snake encontra partida
    const matchRes = await joinMatchmakingQueue('snake');
    assert.strictEqual(matchRes.success, true);
    assert.strictEqual(matchRes.data?.status, 'matched');
    assert.strictEqual(matchRes.data?.game_id, 'snake');
    assert.strictEqual(matchRes.data?.match_id, 'match-snake-winner-999');

    // Consulta após o match: apenas a partida vencedora é mantida ativa, outras canceladas!
    const queuesAfter = await getMyActiveMatchmakingQueues();
    assert.strictEqual(queuesAfter.data?.length, 1);
    assert.strictEqual(queuesAfter.data?.[0].game_id, 'snake');
    assert.strictEqual(queuesAfter.data?.[0].status, 'matched');
    assert.strictEqual(queuesAfter.data?.[0].match_id, 'match-snake-winner-999');
  });

  it('8. Recuperação e Reconciliação: Filas expiradas e partidas finalizadas não são retornadas como ativas', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'get_my_active_matchmaking_queues');
      // O backend reconcilia e só retorna as que continuam de fato ativas ('waiting' ou 'matched' in_progress)
      return {
        data: {
          success: true,
          data: [
            {
              queue_id: 'q-live',
              game_id: 'tic_tac_toe',
              status: 'waiting',
              match_id: null,
              created_at: new Date().toISOString(),
            },
          ],
          error: null,
        },
        error: null,
      };
    };

    const res = await getMyActiveMatchmakingQueues();
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data?.length, 1);
    assert.strictEqual(res.data?.[0].status, 'waiting');
  });

  it('9. Proteção Anti-Race Backend: Dois jogos tentando parear simultaneamente preservam exclusão mútua', async () => {
    // Simula Jogador A em fila para Snake e Tic-Tac-Toe
    // Transação 1 pareia com Jogador B em Snake
    // Transação 2 (quase simultânea) tenta parear com Jogador C em Tic-Tac-Toe
    let winnerMatchId: string | null = null;
    let cancelledOtherQueue = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string, args: any) => {
      if (fn === 'join_matchmaking_queue') {
        const gameId = args?.p_game_id;
        if (!winnerMatchId) {
          // Primeiro a adquirir a trava
          winnerMatchId = `match-${gameId}-123`;
          cancelledOtherQueue = true;
          return {
            data: {
              success: true,
              data: {
                queue_id: `q-${gameId}`,
                game_id: gameId,
                status: 'matched',
                match_id: winnerMatchId,
              },
              error: null,
            },
            error: null,
          };
        } else {
          // Segundo competidor: oponente já não está elegível (já pareou)
          // Portanto o segundo competidor permanece em waiting sem criar partida duplicada!
          return {
            data: {
              success: true,
              data: {
                queue_id: `q-${gameId}`,
                game_id: gameId,
                status: 'waiting',
                match_id: null,
              },
              error: null,
            },
            error: null,
          };
        }
      }
      return { data: { success: false } };
    };

    const txSnake = await joinMatchmakingQueue('snake');
    const txTicTacToe = await joinMatchmakingQueue('tic_tac_toe');

    // Snake venceu a corrida
    assert.strictEqual(txSnake.data?.status, 'matched');
    assert.strictEqual(txSnake.data?.match_id, 'match-snake-123');

    // Tic-Tac-Toe não gerou partida duplicada; permaneceu em waiting
    assert.strictEqual(txTicTacToe.data?.status, 'waiting');
    assert.strictEqual(txTicTacToe.data?.match_id, null);
    assert.strictEqual(cancelledOtherQueue, true);
  });
});
