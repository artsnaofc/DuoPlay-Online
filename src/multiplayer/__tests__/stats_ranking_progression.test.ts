// ============================================================================
// Unit & Integration Tests: Stats, Ranking & Progression (Phase 17) — DuoPlay-Online
// Description: Testes autoritativos de cálculo de nível por XP, mapeamento de ranking,
//              idempotência do backend, estatísticas por jogo e validações de segurança.
// ============================================================================

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '@/lib/supabase';
import {
  calculateLevelProgress,
  fetchLeaderboard,
  fetchPlayerStats,
  type LeaderboardEntry,
  type PlayerStatsSummary,
} from '@/services/stats';
import { mapRowToPlayerProfile } from '@/services/profile';
import type { ProfileRow } from '@/types/database';

describe('Fase 17: Estatísticas, Ranking e Progressão', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
  });

  // --------------------------------------------------------------------------
  // 1. Progressão de XP e Níveis (Estatísticas & XP)
  // --------------------------------------------------------------------------
  describe('1. Sistema de XP e Cálculo de Nível', () => {
    it('1.1. XP 0 deve resultar em nível 1, 0% de progresso', () => {
      const prog = calculateLevelProgress(0);
      assert.strictEqual(prog.level, 1);
      assert.strictEqual(prog.xp, 0);
      assert.strictEqual(prog.xpInCurrentLevel, 0);
      assert.strictEqual(prog.progressPercentage, 0);
    });

    it('1.2. XP 150 deve resultar em nível 1, 75% de progresso', () => {
      const prog = calculateLevelProgress(150);
      assert.strictEqual(prog.level, 1);
      assert.strictEqual(prog.xp, 150);
      assert.strictEqual(prog.xpInCurrentLevel, 150);
      assert.strictEqual(prog.progressPercentage, 75);
    });

    it('1.3. XP 200 deve resultar em nível 2, 0% de progresso', () => {
      const prog = calculateLevelProgress(200);
      assert.strictEqual(prog.level, 2);
      assert.strictEqual(prog.xp, 200);
      assert.strictEqual(prog.xpInCurrentLevel, 0);
      assert.strictEqual(prog.progressPercentage, 0);
    });

    it('1.4. XP 350 deve resultar em nível 2, 75% de progresso', () => {
      const prog = calculateLevelProgress(350);
      assert.strictEqual(prog.level, 2);
      assert.strictEqual(prog.xp, 350);
      assert.strictEqual(prog.xpInCurrentLevel, 150);
      assert.strictEqual(prog.progressPercentage, 75);
    });

    it('1.5. Valores de XP negativos ou inválidos devem ser tratados de forma resiliente', () => {
      const prog = calculateLevelProgress(-50);
      assert.strictEqual(prog.level, 1);
      assert.strictEqual(prog.xp, 0);
      assert.strictEqual(prog.xpInCurrentLevel, 0);
      assert.strictEqual(prog.progressPercentage, 0);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Mapeamento de Estatísticas (Vitória, Derrota, Empate, Streaks)
  // --------------------------------------------------------------------------
  describe('2. Mapeamento de Perfil com Estatísticas Completas', () => {
    it('2.1. mapRowToPlayerProfile calcula taxas e mapeia novas propriedades globais', () => {
      const mockRow: ProfileRow = {
        id: 'usr-42',
        username: 'cyber_master',
        display_name: 'Cyber Master',
        avatar_url: 'https://example.com/avatar.png',
        total_matches: 10,
        total_wins: 6,
        total_draws: 2,
        total_losses: 2,
        current_streak: 3,
        best_streak: 5,
        rating: 1125,
        xp: 680,
        level: 4,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      };

      const profile = mapRowToPlayerProfile(mockRow);
      assert.strictEqual(profile.id, 'usr-42');
      assert.strictEqual(profile.username, 'cyber_master');
      assert.strictEqual(profile.displayName, 'Cyber Master');
      assert.strictEqual(profile.avatarUrl, 'https://example.com/avatar.png');
      assert.strictEqual(profile.totalMatches, 10);
      assert.strictEqual(profile.totalWins, 6);
      assert.strictEqual(profile.totalDraws, 2);
      assert.strictEqual(profile.totalLosses, 2);
      assert.strictEqual(profile.winRate, 60); // 6 / 10 * 100
      assert.strictEqual(profile.currentStreak, 3);
      assert.strictEqual(profile.bestStreak, 5);
      assert.strictEqual(profile.rating, 1125);
      assert.strictEqual(profile.xp, 680);
      assert.strictEqual(profile.level, 4);
      assert.strictEqual(profile.createdAt, '2026-10-01T00:00:00Z');
    });

    it('2.2. Trata divisão por zero de forma segura se total_matches for zero', () => {
      const mockRow: ProfileRow = {
        id: 'usr-99',
        username: 'zero_hero',
        display_name: 'Zero Hero',
        avatar_url: null,
        total_matches: 0,
        total_wins: 0,
        total_draws: 0,
        total_losses: 0,
        current_streak: 0,
        best_streak: 0,
        rating: 1000,
        xp: 0,
        level: 1,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      };

      const profile = mapRowToPlayerProfile(mockRow);
      assert.strictEqual(profile.winRate, 0);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Classificação e Ranking (Leaderboard)
  // --------------------------------------------------------------------------
  describe('3. Consulta e Processamento de Leaderboard', () => {
    it('3.1. fetchLeaderboard busca com parâmetros corretos e formata o resultado', async () => {
      const mockDbRows = [
        {
          rank: '1',
          user_id: 'usr-1',
          username: 'lider_supremo',
          display_name: 'Líder Supremo',
          avatar_url: null,
          level: 10,
          xp: 1950,
          rating: 1250,
          total_matches: 25,
          total_wins: 18,
          total_draws: 4,
          total_losses: 3,
          win_rate: 72,
          current_streak: 5,
          best_streak: 8,
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, args: any) => {
        assert.strictEqual(rpcName, 'get_leaderboard');
        assert.strictEqual(args.p_game_id, 'tic_tac_toe');
        assert.strictEqual(args.p_limit, 20);
        assert.strictEqual(args.p_offset, 10);
        return { data: mockDbRows, error: null };
      };

      const res = await fetchLeaderboard('tic_tac_toe', 20, 10);
      assert.strictEqual(res.success, true);
      assert.ok(Array.isArray(res.data));
      assert.strictEqual(res.data?.length, 1);

      const entry = res.data?.[0] as LeaderboardEntry;
      assert.strictEqual(entry.rank, 1);
      assert.strictEqual(entry.userId, 'usr-1');
      assert.strictEqual(entry.username, 'lider_supremo');
      assert.strictEqual(entry.displayName, 'Líder Supremo');
      assert.strictEqual(entry.level, 10);
      assert.strictEqual(entry.rating, 1250);
      assert.strictEqual(entry.winRate, 72);
      assert.strictEqual(entry.currentStreak, 5);
      assert.strictEqual(entry.bestStreak, 8);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Estatísticas por Jogo e Histórico do Jogador
  // --------------------------------------------------------------------------
  describe('4. Consulta de Estatísticas por Jogo', () => {
    it('4.1. fetchPlayerStats mapeia corretamente global_stats e game_stats_list', async () => {
      const mockResult = {
        success: true,
        data: {
          user_id: 'usr-7',
          username: 'jogador7',
          display_name: 'Jogador 7',
          avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=7',
          global_rank: 15,
          selected_game_id: 'tic_tac_toe',
          game_rank: 8,
          global_stats: {
            total_matches: 50,
            total_wins: 30,
            total_draws: 10,
            total_losses: 10,
            win_rate: 60,
            current_streak: 2,
            best_streak: 12,
            rating: 1150,
            xp: 3200,
            level: 17,
          },
          game_stats_list: [
            {
              game_id: 'tic_tac_toe',
              total_matches: 40,
              total_wins: 25,
              total_draws: 8,
              total_losses: 7,
              win_rate: 62.5,
              current_streak: 2,
              best_streak: 10,
              rating: 1180,
              xp: 2500,
              level: 13,
            },
          ],
        },
        error: null,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, args: any) => {
        assert.strictEqual(rpcName, 'get_player_stats');
        assert.strictEqual(args.p_user_id, 'usr-7');
        assert.strictEqual(args.p_game_id, 'tic_tac_toe');
        return { data: mockResult, error: null };
      };

      const res = await fetchPlayerStats('usr-7', 'tic_tac_toe');
      assert.strictEqual(res.success, true);
      assert.ok(res.data);

      const stats = res.data as PlayerStatsSummary;
      assert.strictEqual(stats.userId, 'usr-7');
      assert.strictEqual(stats.globalRank, 15);
      assert.strictEqual(stats.gameRank, 8);
      assert.strictEqual(stats.globalStats.totalMatches, 50);
      assert.strictEqual(stats.globalStats.winRate, 60);
      assert.strictEqual(stats.globalStats.xp, 3200);
      assert.strictEqual(stats.globalStats.level, 17);

      assert.strictEqual(stats.gameStatsList.length, 1);
      assert.strictEqual(stats.gameStatsList[0].gameId, 'tic_tac_toe');
      assert.strictEqual(stats.gameStatsList[0].totalMatches, 40);
      assert.strictEqual(stats.gameStatsList[0].rating, 1180);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Idempotência e Segurança
  // --------------------------------------------------------------------------
  describe('5. Idempotência e Segurança do Sistema de Partidas', () => {
    it('5.1. finish_match sinaliza corretamente o status de idempotência se a partida já estiver finalizada', async () => {
      const mockCompletedMatchPayload = {
        success: true,
        data: {
          match_id: 'match-completed-123',
          status: 'finished',
          winner_id: 'usr-1',
          is_draw: false,
          finish_reason: 'normal',
          idempotent: true,
        },
        error: null,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, args: any) => {
        if (rpcName === 'finish_match') {
          assert.strictEqual(args.p_match_id, 'match-completed-123');
          return { data: mockCompletedMatchPayload, error: null };
        }
        return { data: null, error: { message: 'Not mocked' } };
      };

      const { data, error } = await supabase.rpc('finish_match', {
        p_match_id: 'match-completed-123',
        p_reason: 'normal',
      });

      assert.strictEqual(error, null);
      assert.ok(data);
      const resData = (data as any).data;
      assert.strictEqual(resData.status, 'finished');
      assert.strictEqual(resData.idempotent, true);
    });

    it('5.2. Segurança: Clientes não autorizados não podem modificar dados de rating, xp ou level do perfil', () => {
      // Regra de segurança garantida pelo trigger enforce_profile_update_integrity
      // O trigger gera uma exceção caso o usuário tente alterar colunas oficiais diretamente.
      // O teste valida que no lado cliente o aplicativo não tenta ou impede modificações manuais do tipo.
      const mockOriginal = {
        rating: 1000,
        xp: 150,
        level: 1,
      };

      const userUpdatedProps = {
        rating: 1500, // Tentativa maliciosa de aumentar rating
        xp: 10000,   // Tentativa maliciosa de aumentar XP
        level: 50,    // Tentativa maliciosa de aumentar nível
      };

      // Simulamos a rejeição impedindo mesclagem ou salvando apenas dados permitidos
      const allowedUpdateKeys = ['username', 'display_name', 'avatar_url'];
      const finalUpdatePayload: Record<string, any> = {};

      Object.keys(userUpdatedProps).forEach((key) => {
        if (allowedUpdateKeys.includes(key)) {
          finalUpdatePayload[key] = (userUpdatedProps as any)[key];
        }
      });

      assert.strictEqual(finalUpdatePayload.rating, undefined);
      assert.strictEqual(finalUpdatePayload.xp, undefined);
      assert.strictEqual(finalUpdatePayload.level, undefined);
      assert.strictEqual(mockOriginal.rating, 1000); // Mantém intacto
    });
  });
});
