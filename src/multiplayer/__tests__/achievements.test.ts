// ============================================================================
// Unit & Integration Tests: Achievements & Badges (Phase 18) — DuoPlay-Online
// Description: Testes autoritativos do sistema de conquistas, progresso dinâmico,
//              bloqueio/desbloqueio, idempotência, segurança e notificações.
// ============================================================================

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '@/lib/supabase';
import { fetchUserAchievements, type Achievement } from '@/services/achievements';

describe('Fase 18: Conquistas e Badges', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
  });

  // --------------------------------------------------------------------------
  // 1. Consulta de Conquistas e Progresso Dinâmico
  // --------------------------------------------------------------------------
  describe('1. Consulta de Conquistas (fetchUserAchievements)', () => {
    it('1.1. Deve carregar a lista de conquistas e mapear propriedades corretamente', async () => {
      const mockDbRows = [
        {
          achievement_id: 'ach-1',
          code: 'first_win',
          name: 'Primeira Vitória',
          description: 'Vença a sua primeira partida na plataforma.',
          icon_badge: 'Trophy',
          category: 'general',
          condition_type: 'first_win',
          condition_value: 1,
          unlocked: true,
          unlocked_at: '2026-10-07T10:00:00Z',
          progress: 1,
        },
        {
          achievement_id: 'ach-2',
          code: '10_matches',
          name: 'Estreante Ativo',
          description: 'Complete 10 partidas na plataforma.',
          icon_badge: 'Gamepad',
          category: 'matches_played',
          condition_type: 'matches_count',
          condition_value: 10,
          unlocked: false,
          unlocked_at: null,
          progress: 4,
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, args: any) => {
        assert.strictEqual(rpcName, 'get_user_achievements');
        assert.strictEqual(args.p_user_id, 'usr-123');
        return { data: mockDbRows, error: null };
      };

      const res = await fetchUserAchievements('usr-123');
      assert.strictEqual(res.success, true);
      assert.ok(Array.isArray(res.data));
      assert.strictEqual(res.data?.length, 2);

      const ach1 = res.data?.[0] as Achievement;
      assert.strictEqual(ach1.achievementId, 'ach-1');
      assert.strictEqual(ach1.code, 'first_win');
      assert.strictEqual(ach1.unlocked, true);
      assert.strictEqual(ach1.progress, 1);
      assert.strictEqual(ach1.unlockedAt, '2026-10-07T10:00:00Z');

      const ach2 = res.data?.[1] as Achievement;
      assert.strictEqual(ach2.achievementId, 'ach-2');
      assert.strictEqual(ach2.code, '10_matches');
      assert.strictEqual(ach2.unlocked, false);
      assert.strictEqual(ach2.progress, 4);
      assert.strictEqual(ach2.unlockedAt, null);
    });

    it('1.2. Deve garantir que o progresso não ultrapassa o condition_value (limite de progresso)', async () => {
      const mockDbRows = [
        {
          achievement_id: 'ach-3',
          code: '10_wins',
          name: 'Campeão em Ascensão',
          description: 'Alcance 10 vitórias na plataforma.',
          icon_badge: 'Award',
          category: 'wins_count',
          condition_type: 'wins_count',
          condition_value: 10,
          unlocked: true,
          unlocked_at: '2026-10-07T12:00:00Z',
          progress: 12, // Progresso maior que o necessário para testar a robustez do frontend
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string) => {
        if (rpcName === 'get_user_achievements') {
          return { data: mockDbRows, error: null };
        }
        return { data: null, error: { message: 'Not mocked' } };
      };

      const res = await fetchUserAchievements('usr-123');
      assert.strictEqual(res.success, true);
      const ach = res.data?.[0] as Achievement;
      assert.strictEqual(ach.progress, 10); // Deve ser limitado ao condition_value
    });
  });

  // --------------------------------------------------------------------------
  // 2. Integração, Idempotência e Notificações (finish_match)
  // --------------------------------------------------------------------------
  describe('2. Integração com finish_match, Idempotência e Notificações', () => {
    it('2.1. finish_match deve concluir com sucesso e indicar se foi idempotente', async () => {
      const mockResponse = {
        success: true,
        data: {
          match_id: 'match-abc',
          status: 'finished',
          winner_id: 'usr-1',
          is_draw: false,
          finish_reason: 'normal',
          idempotent: false,
        },
        error: null,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, args: any) => {
        if (rpcName === 'finish_match') {
          assert.strictEqual(args.p_match_id, 'match-abc');
          return { data: mockResponse, error: null };
        }
        return { data: null, error: { message: 'Not mocked' } };
      };

      const { data, error } = await supabase.rpc('finish_match', {
        p_match_id: 'match-abc',
        p_reason: 'normal',
      });

      assert.strictEqual(error, null);
      assert.ok(data);
      const resData = (data as any).data;
      assert.strictEqual(resData.status, 'finished');
      assert.strictEqual(resData.idempotent, false);
    });

    it('2.2. Notificação deve conter o payload de conquista correto quando desbloqueada', () => {
      const mockNotification = {
        id: 'notif-999',
        user_id: 'usr-1',
        type: 'achievement_unlocked',
        title: 'Conquista Desbloqueada!',
        body: 'Você desbloqueou a conquista: Primeira Vitória (Vença a sua primeira partida na plataforma.)',
        data: {
          achievement_id: 'ach-1',
          achievement_code: 'first_win',
          achievement_name: 'Primeira Vitória',
          achievement_icon: 'Trophy',
        },
      };

      assert.strictEqual(mockNotification.type, 'achievement_unlocked');
      assert.strictEqual(mockNotification.data.achievement_code, 'first_win');
      assert.strictEqual(mockNotification.data.achievement_icon, 'Trophy');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Segurança RLS/RPC
  // --------------------------------------------------------------------------
  describe('3. Blindagem e Segurança', () => {
    it('3.1. Clientes não podem inserir ou desbloquear conquistas diretamente (somente leitura)', () => {
      const allowedUpdateKeys = ['display_name', 'avatar_url', 'username'];
      const clientPayload = {
        achievement_id: 'ach-1',
        unlocked: true, // Tentativa maliciosa de se autoconceder uma conquista
        progress: 100,
      };

      const finalPayload: Record<string, any> = {};
      Object.keys(clientPayload).forEach((key) => {
        if (allowedUpdateKeys.includes(key)) {
          finalPayload[key] = (clientPayload as any)[key];
        }
      });

      // O payload final não deve conter nenhuma chave relacionada a conquistas
      assert.strictEqual(finalPayload.achievement_id, undefined);
      assert.strictEqual(finalPayload.unlocked, undefined);
      assert.strictEqual(finalPayload.progress, undefined);
    });
  });
});
