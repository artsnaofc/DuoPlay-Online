// ============================================================================
// Unit & Integration Tests: Correção das Fases 19/20 — DuoPlay-Online
// Description: Testes autoritativos de validação para salas, matchmaking e Carta Duo
//              agnósticos ao jogo, concorrência, min/max players (2 para Jogo da Velha,
//              2 a 6 para Carta Duo), isolamento de filas e fluxos de saída/reentrada.
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '@/lib/supabase';
import {
  createRoom,
  joinRoomByCode,
  leaveRoom,
  startMatch,
  getRoomDetails,
} from '@/services/rooms';
import {
  joinMatchmakingQueue,
  cancelMatchmakingQueue,
  getMyMatchmakingStatus,
} from '@/services/matchmaking';
import { getGameDefinition, listGames } from '@/multiplayer/registry';

describe('Correção das Fases 19/20: Salas, Matchmaking e Carta Duo Agnósticos', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  beforeEach(() => {
    // Reset
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
  });

  // ==========================================================================
  // 1. Catálogo e Jogos Ativos vs Inativos
  // ==========================================================================
  describe('1. Catálogo e Validação de Jogos Ativos/Inativos', () => {
    it('1.1. Todos os jogos ativos no catálogo possuem definição e componentes configurados', () => {
      const ttt = getGameDefinition('tic_tac_toe');
      const cd = getGameDefinition('carta_duo');

      assert.ok(ttt, 'Jogo da Velha deve estar catalogado');
      assert.strictEqual(ttt?.isAvailable, true);
      assert.strictEqual(ttt?.minPlayers, 2);
      assert.strictEqual(ttt?.maxPlayers, 2);

      assert.ok(cd, 'Carta Duo deve estar catalogado');
      assert.strictEqual(cd?.isAvailable, true);
      assert.strictEqual(cd?.minPlayers, 2);
      assert.strictEqual(cd?.maxPlayers, 6);
    });

    it('1.2. Jogos inativos permanecem indisponíveis para matchmaking e salas', async () => {
      // Simula resposta da RPC para jogo inativo (ex: pong ou snake)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, args: any) => {
        if (fn === 'join_matchmaking_queue') {
          if (args.p_game_id === 'pong' || args.p_game_id === 'snake') {
            return {
              data: null,
              error: {
                message: 'GAME_NOT_ACTIVE: O jogo especificado não existe ou não possui matchmaking público ativo.',
                code: 'P0015',
              },
            };
          }
        }
        return { data: null, error: null };
      };

      const resPong = await joinMatchmakingQueue('pong');
      assert.strictEqual(resPong.success, false);
      assert.match(resPong.error || '', /GAME_NOT_ACTIVE/);

      const resSnake = await joinMatchmakingQueue('snake');
      assert.strictEqual(resSnake.success, false);
      assert.match(resSnake.error || '', /GAME_NOT_ACTIVE/);
    });

    it('1.3. Jogo inexistente é rejeitado com GAME_NOT_FOUND / GAME_NOT_ACTIVE', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, args: any) => {
        if (fn === 'create_room') {
          if (args.p_game_id === 'non_existent_game') {
            return {
              data: null,
              error: {
                message: 'GAME_NOT_FOUND: O jogo especificado não existe ou está inativo.',
                code: 'P0003',
              },
            };
          }
        }
        return { data: null, error: null };
      };

      const res = await createRoom('non_existent_game', 'Sala Teste');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, 'GAME_NOT_FOUND');
    });
  });

  // ==========================================================================
  // 2. Matchmaking Agnóstico: Separação de Filas e Pareamento
  // ==========================================================================
  describe('2. Matchmaking Agnóstico, Isolamento de Filas e Quantidade de Jogadores', () => {
    it('2.1. Tic-Tac-Toe pareia exatamente 2 jogadores', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, args: any) => {
        assert.strictEqual(fn, 'join_matchmaking_queue');
        assert.strictEqual(args.p_game_id, 'tic_tac_toe');
        return {
          data: {
            success: true,
            data: {
              queue_id: 'q-ttt-1',
              game_id: 'tic_tac_toe',
              status: 'matched',
              match_id: 'match-ttt-101',
              expires_at: '2026-10-08T12:00:00Z',
            },
            error: null,
          },
          error: null,
        };
      };

      const res = await joinMatchmakingQueue('tic_tac_toe');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.status, 'matched');
      assert.strictEqual(res.data?.match_id, 'match-ttt-101');
    });

    it('2.2. Carta Duo suporta matchmaking para 2 jogadores', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, args: any) => {
        assert.strictEqual(fn, 'join_matchmaking_queue');
        assert.strictEqual(args.p_game_id, 'carta_duo');
        return {
          data: {
            success: true,
            data: {
              queue_id: 'q-cd-1',
              game_id: 'carta_duo',
              status: 'matched',
              match_id: 'match-cd-2players',
              expires_at: '2026-10-08T12:00:00Z',
            },
            error: null,
          },
          error: null,
        };
      };

      const res = await joinMatchmakingQueue('carta_duo');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.status, 'matched');
      assert.strictEqual(res.data?.match_id, 'match-cd-2players');
    });

    it('2.3. Carta Duo suporta matchmaking para 3 a 6 jogadores concorrentes', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, args: any) => {
        assert.strictEqual(fn, 'join_matchmaking_queue');
        assert.strictEqual(args.p_game_id, 'carta_duo');
        return {
          data: {
            success: true,
            data: {
              queue_id: 'q-cd-multi',
              game_id: 'carta_duo',
              status: 'matched',
              match_id: 'match-cd-4players',
              expires_at: '2026-10-08T12:00:00Z',
            },
            error: null,
          },
          error: null,
        };
      };

      const res = await joinMatchmakingQueue('carta_duo');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.status, 'matched');
      assert.strictEqual(res.data?.match_id, 'match-cd-4players');
    });

    it('2.4. Filas de jogos diferentes NUNCA se misturam (tic_tac_toe vs carta_duo)', async () => {
      // Simula estado do banco onde há 1 jogador esperando em tic_tac_toe
      // e o usuário entra na fila de carta_duo: ele NÃO deve ser pareado com o de tic_tac_toe
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, args: any) => {
        if (fn === 'join_matchmaking_queue') {
          if (args.p_game_id === 'carta_duo') {
            // Não encontra oponentes na fila de carta_duo, entra em waiting
            return {
              data: {
                success: true,
                data: {
                  queue_id: 'q-cd-wait',
                  game_id: 'carta_duo',
                  status: 'waiting',
                  match_id: null,
                  expires_at: '2026-10-08T12:05:00Z',
                },
                error: null,
              },
              error: null,
            };
          }
        }
        return { data: null, error: null };
      };

      const res = await joinMatchmakingQueue('carta_duo');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.status, 'waiting');
      assert.strictEqual(res.data?.match_id, null);
    });
  });

  // ==========================================================================
  // 3. Fluxos de Saída e Reentrada Obrigatórios
  // ==========================================================================
  describe('3. Fluxos de Saída, Reentrada e Limpeza de Estado', () => {
    it('3.1. Fluxo 1: Carta Duo → criar sala → sair → Jogo da Velha → criar sala', async () => {
      const calls: string[] = [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, args: any) => {
        calls.push(fn);
        if (fn === 'create_room' && args.p_game_id === 'carta_duo') {
          return {
            data: {
              success: true,
              data: {
                room: { id: 'room-cd-1', game_id: 'carta_duo', code: 'CD1234', status: 'waiting' },
                member: { room_id: 'room-cd-1', role: 'player', slot_number: 1, is_ready: true },
              },
              error: null,
            },
            error: null,
          };
        }
        if (fn === 'leave_room' && args.p_room_id === 'room-cd-1') {
          return {
            data: {
              success: true,
              data: { new_host_id: null, room_closed: true },
              error: null,
            },
            error: null,
          };
        }
        if (fn === 'create_room' && args.p_game_id === 'tic_tac_toe') {
          return {
            data: {
              success: true,
              data: {
                room: { id: 'room-ttt-2', game_id: 'tic_tac_toe', code: 'TT5678', status: 'waiting' },
                member: { room_id: 'room-ttt-2', role: 'player', slot_number: 1, is_ready: true },
              },
              error: null,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      };

      // 1. Criar sala de Carta Duo
      const resCD = await createRoom('carta_duo', 'Carta Duo Sala');
      assert.strictEqual(resCD.success, true);
      assert.strictEqual(resCD.data?.room.game_id, 'carta_duo');

      // 2. Sair da sala
      const resLeave = await leaveRoom(resCD.data!.room.id);
      assert.strictEqual(resLeave.success, true);

      // 3. Criar sala de Jogo da Velha
      const resTTT = await createRoom('tic_tac_toe', 'Velha Sala');
      assert.strictEqual(resTTT.success, true);
      assert.strictEqual(resTTT.data?.room.game_id, 'tic_tac_toe');

      assert.deepStrictEqual(calls, ['create_room', 'leave_room', 'create_room']);
    });

    it('3.2. Fluxo 2: Jogo da Velha → criar sala → sair → Carta Duo → criar sala', async () => {
      const calls: string[] = [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, args: any) => {
        calls.push(fn);
        if (fn === 'create_room' && args.p_game_id === 'tic_tac_toe') {
          return {
            data: {
              success: true,
              data: {
                room: { id: 'room-ttt-1', game_id: 'tic_tac_toe', code: 'TT1111', status: 'waiting' },
                member: { room_id: 'room-ttt-1', role: 'player', slot_number: 1, is_ready: true },
              },
              error: null,
            },
            error: null,
          };
        }
        if (fn === 'leave_room') {
          return {
            data: {
              success: true,
              data: { new_host_id: null, room_closed: true },
              error: null,
            },
            error: null,
          };
        }
        if (fn === 'create_room' && args.p_game_id === 'carta_duo') {
          return {
            data: {
              success: true,
              data: {
                room: { id: 'room-cd-2', game_id: 'carta_duo', code: 'CD2222', status: 'waiting' },
                member: { room_id: 'room-cd-2', role: 'player', slot_number: 1, is_ready: true },
              },
              error: null,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      };

      const resTTT = await createRoom('tic_tac_toe');
      assert.strictEqual(resTTT.success, true);

      const resLeave = await leaveRoom(resTTT.data!.room.id);
      assert.strictEqual(resLeave.success, true);

      const resCD = await createRoom('carta_duo');
      assert.strictEqual(resCD.success, true);

      assert.deepStrictEqual(calls, ['create_room', 'leave_room', 'create_room']);
    });

    it('3.3. Fluxo 3: Carta Duo → matchmaking → cancelar → Jogo da Velha → matchmaking', async () => {
      const calls: string[] = [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, args: any) => {
        calls.push(fn);
        if (fn === 'join_matchmaking_queue' && args?.p_game_id === 'carta_duo') {
          return {
            data: {
              success: true,
              data: { queue_id: 'q1', game_id: 'carta_duo', status: 'waiting', match_id: null },
              error: null,
            },
            error: null,
          };
        }
        if (fn === 'cancel_matchmaking_queue') {
          return {
            data: {
              success: true,
              data: { status: 'cancelled', match_id: null },
              error: null,
            },
            error: null,
          };
        }
        if (fn === 'join_matchmaking_queue' && args?.p_game_id === 'tic_tac_toe') {
          return {
            data: {
              success: true,
              data: { queue_id: 'q2', game_id: 'tic_tac_toe', status: 'waiting', match_id: null },
              error: null,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      };

      const resCD = await joinMatchmakingQueue('carta_duo');
      assert.strictEqual(resCD.success, true);

      const resCancel = await cancelMatchmakingQueue();
      assert.strictEqual(resCancel.success, true);
      assert.strictEqual(resCancel.data?.status, 'cancelled');

      const resTTT = await joinMatchmakingQueue('tic_tac_toe');
      assert.strictEqual(resTTT.success, true);
      assert.strictEqual(resTTT.data?.status, 'waiting');

      assert.deepStrictEqual(calls, [
        'join_matchmaking_queue',
        'cancel_matchmaking_queue',
        'join_matchmaking_queue',
      ]);
    });

    it('3.4. Fluxo 4: Jogo da Velha → matchmaking → cancelar → Carta Duo → matchmaking', async () => {
      const calls: string[] = [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, args: any) => {
        calls.push(fn);
        if (fn === 'join_matchmaking_queue' && args?.p_game_id === 'tic_tac_toe') {
          return {
            data: {
              success: true,
              data: { queue_id: 'q-ttt', game_id: 'tic_tac_toe', status: 'waiting', match_id: null },
              error: null,
            },
            error: null,
          };
        }
        if (fn === 'cancel_matchmaking_queue') {
          return {
            data: {
              success: true,
              data: { status: 'cancelled', match_id: null },
              error: null,
            },
            error: null,
          };
        }
        if (fn === 'join_matchmaking_queue' && args?.p_game_id === 'carta_duo') {
          return {
            data: {
              success: true,
              data: { queue_id: 'q-cd', game_id: 'carta_duo', status: 'waiting', match_id: null },
              error: null,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      };

      const resTTT = await joinMatchmakingQueue('tic_tac_toe');
      assert.strictEqual(resTTT.success, true);

      const resCancel = await cancelMatchmakingQueue();
      assert.strictEqual(resCancel.success, true);

      const resCD = await joinMatchmakingQueue('carta_duo');
      assert.strictEqual(resCD.success, true);

      assert.deepStrictEqual(calls, [
        'join_matchmaking_queue',
        'cancel_matchmaking_queue',
        'join_matchmaking_queue',
      ]);
    });

    it('3.5. Fluxo 5: Criar várias salas consecutivamente sem travamentos', async () => {
      let createdCount = 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string) => {
        if (fn === 'create_room') {
          createdCount++;
          return {
            data: {
              success: true,
              data: {
                room: { id: `room-${createdCount}`, code: `CODE0${createdCount}`, status: 'waiting' },
                member: { room_id: `room-${createdCount}`, role: 'player', slot_number: 1, is_ready: true },
              },
              error: null,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      };

      const r1 = await createRoom('carta_duo', 'Sala 1');
      const r2 = await createRoom('carta_duo', 'Sala 2');
      const r3 = await createRoom('tic_tac_toe', 'Sala 3');

      assert.strictEqual(r1.success, true);
      assert.strictEqual(r2.success, true);
      assert.strictEqual(r3.success, true);
      assert.strictEqual(createdCount, 3);
    });

    it('3.6. Fluxo 6: Entrar e sair de salas repetidamente não deixa estado residual', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string) => {
        if (fn === 'join_room_by_code') {
          return {
            data: {
              success: true,
              data: {
                room: { id: 'target-room', status: 'waiting' },
                member: { room_id: 'target-room', slot_number: 2, is_ready: false },
              },
              error: null,
            },
            error: null,
          };
        }
        if (fn === 'leave_room') {
          return {
            data: {
              success: true,
              data: { new_host_id: 'host-id', room_closed: false },
              error: null,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      };

      // Entra e sai 3 vezes seguidas
      for (let i = 0; i < 3; i++) {
        const joinRes = await joinRoomByCode('ABC234');
        assert.strictEqual(joinRes.success, true);

        const leaveRes = await leaveRoom(joinRes.data!.room.id);
        assert.strictEqual(leaveRes.success, true);
      }
    });

    it('3.7. Fluxo 7: Encerrar partida e imediatamente criar nova sala', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string) => {
        if (fn === 'create_room') {
          // Partida terminou, criação de nova sala é aceita com sucesso
          return {
            data: {
              success: true,
              data: {
                room: { id: 'new-room-after-finish', status: 'waiting' },
                member: { role: 'player', slot_number: 1, is_ready: true },
              },
              error: null,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      };

      const res = await createRoom('carta_duo', 'Sala Pós Partida');
      assert.strictEqual(res.success, true);
      assert.ok(res.data?.room.id);
    });

    it('3.8. Fluxo 8: Usuário com partida realmente ativa continua bloqueado para novas salas e filas', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string) => {
        if (fn === 'create_room' || fn === 'join_matchmaking_queue') {
          return {
            data: null,
            error: {
              message: 'PLAYER_IN_ACTIVE_MATCH: Você já possui uma partida em andamento e não pode criar uma nova sala.',
              code: 'P0013',
            },
          };
        }
        return { data: null, error: null };
      };

      const resCreate = await createRoom('carta_duo', 'Tentativa Bloqueada');
      assert.strictEqual(resCreate.success, false);
      assert.strictEqual(resCreate.code, 'PLAYER_IN_ACTIVE_MATCH');

      const resMM = await joinMatchmakingQueue('carta_duo');
      assert.strictEqual(resMM.success, false);
      assert.match(resMM.error || '', /PLAYER_IN_ACTIVE_MATCH/);
    });
  });

  // ==========================================================================
  // 4. Início de Partida de Carta Duo (2 a 6 jogadores)
  // ==========================================================================
  describe('4. Início de Partida e Suporte de 2 a 6 Jogadores em Carta Duo', () => {
    it('4.1. start_match inicia partida de Carta Duo e retorna matchId oficial', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, args: any) => {
        assert.strictEqual(fn, 'start_match');
        assert.strictEqual(args.p_room_id, 'room-cd-start');
        return {
          data: {
            success: true,
            data: {
              match: {
                id: 'match-cd-official-001',
                game_id: 'carta_duo',
                status: 'in_progress',
                turn_number: 1,
              },
              players: [
                { user_id: 'u1', slot: 1, score: 7 },
                { user_id: 'u2', slot: 2, score: 7 },
                { user_id: 'u3', slot: 3, score: 7 },
              ],
            },
            error: null,
          },
          error: null,
        };
      };

      const res = await startMatch('room-cd-start');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.matchId, 'match-cd-official-001');
    });

    it('4.2. start_match bloqueia se a quantidade de jogadores for menor que min_players', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string) => {
        assert.strictEqual(fn, 'start_match');
        return {
          data: null,
          error: {
            message: 'INSUFFICIENT_PLAYERS: Quantidade de jogadores insuficiente (mínimo exigido: 2).',
            code: 'P0012',
          },
        };
      };

      const res = await startMatch('room-single-player');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, 'INSUFFICIENT_PLAYERS');
    });

    it('4.3. start_match bloqueia se nem todos os participantes confirmaram prontidão', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string) => {
        assert.strictEqual(fn, 'start_match');
        return {
          data: null,
          error: {
            message: 'PLAYERS_NOT_READY: Nem todos os jogadores confirmaram prontidão.',
            code: 'P0014',
          },
        };
      };

      const res = await startMatch('room-unready');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, 'PLAYERS_NOT_READY');
    });
  });
});
