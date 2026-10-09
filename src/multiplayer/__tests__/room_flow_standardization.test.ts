// ============================================================================
// Unit & Integration Tests: Padronização do Fluxo de Salas & Entrada por Código
// Project: DuoPlay-Online
// Description:
//   1. Correção da criação de sala no Jogo da Velha (normalização tic-tac-toe / tic_tac_toe)
//   2. Padronização da criação instantânea para todos os jogos do catálogo
//   3. Centralização da entrada por código (validação, agnóstico ao jogo, tratamento de erros)
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '@/lib/supabase';
import { createRoom, joinRoomByCode, getRoomDetails, translateRoomError } from '@/services/rooms';
import { normalizeGameId, isSameGame, getGameDefinition, listGames } from '@/multiplayer/registry/index';

describe('Padronização do Fluxo de Salas — DuoPlay Online', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  beforeEach(() => {
    // Reset rpc
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
  });

  // ==========================================================================
  // 1. Normalização e Identificação de Jogos
  // ==========================================================================
  describe('1. Normalização de Game IDs e Tolerância a Hífens/Underscores', () => {
    it('1.1. normalizeGameId padroniza hífens para underscores e minúsculas', () => {
      assert.strictEqual(normalizeGameId('tic-tac-toe'), 'tic_tac_toe');
      assert.strictEqual(normalizeGameId('TIC-TAC-TOE'), 'tic_tac_toe');
      assert.strictEqual(normalizeGameId('carta-duo'), 'carta_duo');
      assert.strictEqual(normalizeGameId('snake'), 'snake');
      assert.strictEqual(normalizeGameId('  pong  '), 'pong');
      assert.strictEqual(normalizeGameId(null), '');
      assert.strictEqual(normalizeGameId(undefined), '');
    });

    it('1.2. isSameGame identifica corretamente igualdade entre representações com hífen e underscore', () => {
      // Jogo da Velha
      assert.strictEqual(isSameGame('tic-tac-toe', 'tic_tac_toe'), true);
      assert.strictEqual(isSameGame('tic_tac_toe', 'tic-tac-toe'), true);
      assert.strictEqual(isSameGame('tic-tac-toe', 'tic-tac-toe'), true);
      assert.strictEqual(isSameGame('tic_tac_toe', 'tic_tac_toe'), true);

      // Carta Duo
      assert.strictEqual(isSameGame('carta-duo', 'carta_duo'), true);
      assert.strictEqual(isSameGame('carta_duo', 'carta_duo'), true);

      // Jogos sem hífens
      assert.strictEqual(isSameGame('snake', 'snake'), true);
      assert.strictEqual(isSameGame('pong', 'pong'), true);

      // Jogos diferentes
      assert.strictEqual(isSameGame('tic-tac-toe', 'snake'), false);
      assert.strictEqual(isSameGame('carta_duo', 'tic_tac_toe'), false);
      assert.strictEqual(isSameGame(null, 'tic_tac_toe'), false);
      assert.strictEqual(isSameGame(undefined, undefined), false);
    });

    it('1.3. getGameDefinition recupera com sucesso o jogo tanto por hífen quanto por underscore', () => {
      const defHyphen = getGameDefinition('tic-tac-toe');
      const defUnderscore = getGameDefinition('tic_tac_toe');

      assert.ok(defHyphen, 'Definição com hífen deve existir');
      assert.ok(defUnderscore, 'Definição com underscore deve existir');
      assert.strictEqual(defHyphen?.title, 'Jogo da Velha');
      assert.strictEqual(defUnderscore?.title, 'Jogo da Velha');
      assert.strictEqual(defHyphen?.minPlayers, 2);
      assert.strictEqual(defHyphen?.maxPlayers, 2);
    });
  });

  // ==========================================================================
  // 2. Criação Instantânea Padronizada para Todos os Jogos
  // ==========================================================================
  describe('2. Criação Instantânea de Sala para Todos os Jogos do Catálogo', () => {
    it('2.1. Criar sala para Jogo da Velha invoca create_room e preserva o jogo criado', async () => {
      let passedGameId = '';
      let passedName = '';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (name: string, params: any) => {
        if (name === 'create_room') {
          passedGameId = params.p_game_id;
          passedName = params.p_name;
          return {
            data: {
              success: true,
              data: {
                room: {
                  id: 'room-ttt-01',
                  game_id: 'tic_tac_toe',
                  code: 'TT9988',
                  status: 'waiting',
                  host_id: 'host-1',
                  max_members: 2,
                },
                member: {
                  id: 'member-01',
                  room_id: 'room-ttt-01',
                  user_id: 'host-1',
                  role: 'host',
                  is_ready: true,
                },
              },
            },
            error: null,
          };
        }
        return { data: null, error: { message: 'Unexpected RPC' } };
      };

      const result = await createRoom('tic-tac-toe');
      assert.strictEqual(result.success, true);
      assert.ok(result.data?.room);
      assert.strictEqual(result.data?.room.code, 'TT9988');
      assert.strictEqual(passedGameId, 'tic-tac-toe');
      assert.match(passedName, /Jogo da Velha/i);

      // Valida que o game_id retornado é compatível com o solicitado
      assert.strictEqual(isSameGame(result.data?.room.game_id, 'tic-tac-toe'), true);
    });

    it('2.2. Criação para Cobrinha (snake) cria sala com 2 jogadores', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (name: string, params: any) => {
        if (name === 'create_room') {
          return {
            data: {
              success: true,
              data: {
                room: {
                  id: 'room-snake-01',
                  game_id: 'snake',
                  code: 'SN1234',
                  status: 'waiting',
                  max_members: params.p_max_members || 2,
                },
                member: {
                  id: 'm-1',
                  room_id: 'room-snake-01',
                  user_id: 'host-1',
                  role: 'host',
                },
              },
            },
            error: null,
          };
        }
        return { data: null, error: { message: 'Unexpected RPC' } };
      };

      const result = await createRoom('snake');
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.room.game_id, 'snake');
      assert.strictEqual(result.data?.room.code, 'SN1234');
      assert.strictEqual(isSameGame(result.data?.room.game_id, 'snake'), true);
    });

    it('2.3. Criação para Carta Duo (carta_duo) cria sala configurada para até 6 jogadores', async () => {
      let maxMembersReceived = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (name: string, params: any) => {
        if (name === 'create_room') {
          maxMembersReceived = params.p_max_members;
          return {
            data: {
              success: true,
              data: {
                room: {
                  id: 'room-cd-01',
                  game_id: 'carta_duo',
                  code: 'CD5566',
                  status: 'waiting',
                  max_members: params.p_max_members,
                },
                member: {
                  id: 'm-cd-1',
                  room_id: 'room-cd-01',
                  user_id: 'host-1',
                  role: 'host',
                },
              },
            },
            error: null,
          };
        }
        return { data: null, error: { message: 'Unexpected RPC' } };
      };

      const result = await createRoom('carta_duo');
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.room.game_id, 'carta_duo');
      assert.strictEqual(maxMembersReceived, 6);
      assert.strictEqual(isSameGame(result.data?.room.game_id, 'carta-duo'), true);
    });

    it('2.4. Todos os jogos disponíveis no catálogo possuem suporte à criação de sala', () => {
      const available = listGames().filter((g) => g.isAvailable);
      assert.ok(available.length >= 3, 'Deve haver ao menos 3 jogos disponíveis no catálogo');

      for (const game of available) {
        assert.ok(game.id, `Jogo ${game.title} deve possuir id`);
        assert.ok(game.title, `Jogo ${game.id} deve possuir título`);
        assert.ok(game.minPlayers >= 2, `Jogo ${game.id} deve ter minPlayers >= 2`);
        assert.ok(game.maxPlayers >= game.minPlayers, `Jogo ${game.id} deve ter maxPlayers >= minPlayers`);
      }
    });

    it('2.5. Em caso de falha na criação, encerra o carregamento e retorna mensagem clara', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => {
        return {
          data: null,
          error: {
            message: 'PLAYER_IN_ACTIVE_MATCH: Você já possui uma partida em andamento e não pode criar uma nova sala.',
            code: 'P0013',
          },
        };
      };

      const res = await createRoom('tic_tac_toe');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, 'PLAYER_IN_ACTIVE_MATCH');
      assert.match(res.error || '', /Você já possui uma partida em andamento/i);
    });
  });

  // ==========================================================================
  // 3. Centralização da Entrada por Código
  // ==========================================================================
  describe('3. Entrada por Código de Sala Centralizada e Agnóstica ao Jogo', () => {
    it('3.1. Validador do código no cliente rejeita códigos com tamanho menor ou maior que 6', async () => {
      const resShort = await joinRoomByCode('ABC');
      assert.strictEqual(resShort.success, false);
      assert.strictEqual(resShort.code, 'INVALID_CODE');

      const resEmpty = await joinRoomByCode('');
      assert.strictEqual(resEmpty.success, false);
      assert.strictEqual(resEmpty.code, 'INVALID_CODE');
    });

    it('3.2. joinRoomByCode identifica o jogo automaticamente a partir da sala retornada', async () => {
      // Simula uma sala de Carta Duo entrada com código
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (name: string, params: any) => {
        if (name === 'join_room_by_code') {
          assert.strictEqual(params.p_code, 'CD7788');
          return {
            data: {
              success: true,
              data: {
                room: {
                  id: 'room-cd-joined',
                  game_id: 'carta_duo',
                  code: 'CD7788',
                  status: 'waiting',
                  max_members: 6,
                },
                member: {
                  id: 'm-2',
                  room_id: 'room-cd-joined',
                  user_id: 'player-2',
                  role: 'player',
                  is_ready: false,
                },
              },
            },
            error: null,
          };
        }
        return { data: null, error: { message: 'Unexpected' } };
      };

      const result = await joinRoomByCode('cd7788');
      assert.strictEqual(result.success, true);
      assert.ok(result.data?.room);
      // O jogo é identificado diretamente pela sala
      assert.strictEqual(result.data?.room.game_id, 'carta_duo');
      assert.strictEqual(result.data?.room.code, 'CD7788');

      // Verifica definição correspondente
      const gameDef = getGameDefinition(result.data?.room.game_id);
      assert.strictEqual(gameDef?.title, 'Carta Duo');
    });

    it('3.3. Retorna mensagem clara de erro caso a sala não exista ou esteja encerrada', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => {
        return {
          data: null,
          error: {
            message: 'ROOM_NOT_FOUND: Sala não encontrada ou encerrada.',
            code: 'P0005',
          },
        };
      };

      const result = await joinRoomByCode('INVAL9');
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.code, 'ROOM_NOT_FOUND');
      assert.match(result.error || '', /Sala não encontrada/i);
    });

    it('3.4. Retorna mensagem clara quando a sala atingiu o limite de jogadores', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => {
        return {
          data: null,
          error: {
            message: 'ROOM_FULL: A sala já atingiu o limite de participantes.',
            code: 'P0007',
          },
        };
      };

      const result = await joinRoomByCode('FULL01');
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.code, 'ROOM_FULL');
      assert.match(result.error || '', /limite máximo/i);
    });

    it('3.5. Retorna mensagem clara quando a partida da sala já foi iniciada', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => {
        return {
          data: null,
          error: {
            message: 'MATCH_ALREADY_IN_PROGRESS: A partida desta sala já foi iniciada.',
            code: 'P0006',
          },
        };
      };

      const result = await joinRoomByCode('INGAME');
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.code, 'MATCH_ALREADY_IN_PROGRESS');
      assert.match(result.error || '', /já foi iniciada/i);
    });
  });
});
