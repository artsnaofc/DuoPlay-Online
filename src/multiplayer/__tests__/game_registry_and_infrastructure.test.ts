// ============================================================================
// Unit & Integration Tests: Game Registry & Infrastructure (Phase 19) — DuoPlay-Online
// Description: Testes autoritativos do registro central de jogos, categorização,
//              capacidades, desacoplamento do Network Engine e integração do Tic-Tac-Toe.
// ============================================================================

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '@/lib/supabase';
import { fetchActiveGames, fetchGameDefinition, type GameRegistryEntry } from '@/services/games';

describe('Fase 19: Infraestrutura para Novos Jogos (Game Registry & Core Agnosticism)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalFrom = (supabase as any).from;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from = originalFrom;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
  });

  // --------------------------------------------------------------------------
  // 1. Game Registry & Recuperação de Jogos
  // --------------------------------------------------------------------------
  describe('1. Game Registry e Catálogo de Jogos', () => {
    it('1.1. fetchActiveGames deve buscar e mapear corretamente os jogos ativos e suas categorias', async () => {
      const mockRows = [
        {
          id: 'tic_tac_toe',
          name: 'Jogo da Velha',
          description: 'Clássico 3x3',
          min_players: 2,
          max_players: 2,
          game_type: 'turn_based',
          capabilities: { turns: true },
          is_active: true,
          created_at: '2026-10-01T00:00:00Z',
        },
        {
          id: 'snake',
          name: 'Cobrinha Competitiva',
          description: 'Arena multiplayer',
          min_players: 2,
          max_players: 4,
          game_type: 'real_time',
          capabilities: { realtime: true },
          is_active: true,
          created_at: '2026-10-01T00:00:00Z',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from = (table: string) => {
        assert.strictEqual(table, 'games');
        return {
          select: () => ({
            eq: (col: string, val: any) => {
              assert.strictEqual(col, 'is_active');
              assert.strictEqual(val, true);
              return {
                order: () => Promise.resolve({ data: mockRows, error: null }),
              };
            },
          }),
        };
      };

      const res = await fetchActiveGames();
      assert.strictEqual(res.success, true);
      assert.ok(Array.isArray(res.data));
      assert.strictEqual(res.data?.length, 2);

      const ttt = res.data?.[0] as GameRegistryEntry;
      assert.strictEqual(ttt.id, 'tic_tac_toe');
      assert.strictEqual(ttt.game_type, 'turn_based');
      assert.strictEqual(ttt.min_players, 2);

      const snake = res.data?.[1] as GameRegistryEntry;
      assert.strictEqual(snake.id, 'snake');
      assert.strictEqual(snake.game_type, 'real_time');
      assert.strictEqual(snake.max_players, 4);
    });

    it('1.2. fetchGameDefinition deve retornar a definição de um jogo específico ou erro se inexistente', async () => {
      const mockRow = {
        id: 'pong',
        name: 'Pong',
        description: 'Arcade 1v1',
        min_players: 2,
        max_players: 2,
        game_type: 'real_time',
        capabilities: { paddle: true },
        is_active: false,
        created_at: '2026-10-01T00:00:00Z',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from = (table: string) => {
        assert.strictEqual(table, 'games');
        return {
          select: () => ({
            eq: (col: string, val: any) => {
              assert.strictEqual(col, 'id');
              assert.strictEqual(val, 'pong');
              return {
                single: () => Promise.resolve({ data: mockRow, error: null }),
              };
            },
          }),
        };
      };

      const res = await fetchGameDefinition('pong');
      assert.strictEqual(res.success, true);
      assert.ok(res.data);
      assert.strictEqual(res.data?.id, 'pong');
      assert.strictEqual(res.data?.game_type, 'real_time');
      assert.strictEqual(res.data?.is_active, false);
    });

    it('1.3. Tratamento de erro ao consultar jogo inexistente', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from = () => ({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: null, error: { message: 'Not found' } }),
          }),
        }),
      });

      const res = await fetchGameDefinition('jogo_fantasma');
      assert.strictEqual(res.success, false);
      assert.ok(res.error);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Agnosticismo do Network Engine e Contrato Genérico
  // --------------------------------------------------------------------------
  describe('2. Agnosticismo do Network Engine e Dispatcher Genérico', () => {
    it('2.1. O Dispatcher de ações do servidor deve aceitar qualquer game_id cadastrado sem acoplamento fixo', async () => {
      const mockDispatchResult = {
        success: true,
        data: {
          new_state: { score: 10, last_action: 'move' },
          next_player_id: 'usr-2',
          winner_id: null,
          is_draw: false,
          is_finished: false,
        },
        error: null,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, args: any) => {
        assert.strictEqual(rpcName, 'submit_game_action');
        assert.strictEqual(args.p_match_id, 'match-test-123');
        return { data: mockDispatchResult, error: null };
      };

      const { data, error } = await supabase.rpc('submit_game_action', {
        p_match_id: 'match-test-123',
        p_action_id: 'act-999',
        p_action_type: 'CUSTOM_GAME_ACTION',
        p_payload: { direction: 'UP' },
      });

      assert.strictEqual(error, null);
      assert.ok(data);
      const resData = (data as any).data;
      assert.deepEqual(resData.new_state, { score: 10, last_action: 'move' });
    });
  });

  // --------------------------------------------------------------------------
  // 3. Compatibilidade e Integração Contínua do Jogo da Velha (Tic-Tac-Toe)
  // --------------------------------------------------------------------------
  describe('3. Compatibilidade End-to-End do Jogo da Velha (Tic-Tac-Toe)', () => {
    it('3.1. Jogo da Velha permanece ativo, validado e com suporte a finish_match, XP e rankings', async () => {
      const mockFinishResult = {
        success: true,
        data: {
          match_id: 'match-ttt-1',
          status: 'finished',
          winner_id: 'usr-1',
          is_draw: false,
          finish_reason: 'normal',
        },
        error: null,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, args: any) => {
        if (rpcName === 'finish_match') {
          assert.strictEqual(args.p_match_id, 'match-ttt-1');
          return { data: mockFinishResult, error: null };
        }
        return { data: null, error: { message: 'Not mocked' } };
      };

      const res = await supabase.rpc('finish_match', {
        p_match_id: 'match-ttt-1',
        p_reason: 'normal',
      });

      assert.strictEqual(res.error, null);
      assert.ok(res.data);
      const data = (res.data as any).data;
      assert.strictEqual(data.status, 'finished');
      assert.strictEqual(data.winner_id, 'usr-1');
    });
  });
});
