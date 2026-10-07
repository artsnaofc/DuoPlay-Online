// ============================================================================
// Unit & Integration Tests: Player Profile & Identity (Phase 12) — DuoPlay-Online
// Description: Testes autoritativos de validação, mapeamento de estatísticas,
//              consulta com cache em memória, isolamento de RLS e atualização de perfil.
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUsername,
  validateDisplayName,
  mapRowToPlayerProfile,
  fetchMyProfile,
  fetchPublicProfile,
  updateMyProfile,
  PRESET_AVATARS,
  type PlayerProfile,
} from '@/services/profile';
import { supabase } from '@/lib/supabase';
import type { ProfileRow } from '@/types/database';

describe('Fase 12: Identidade da Plataforma e Perfil do Jogador', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalFrom = (supabase as any).from;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from = originalFrom;
  });

  // --------------------------------------------------------------------------
  // 1. Validações de Entrada (Username e DisplayName)
  // --------------------------------------------------------------------------
  describe('Validações de Regras de Negócio e Sanitização', () => {
    it('1. validateUsername aceita nomes válidos com letras, números e sublinhados', () => {
      const validNames = ['player1', 'cyber_warrior', 'neo99', 'pro_player_brazil'];
      for (const name of validNames) {
        const res = validateUsername(name);
        assert.strictEqual(res.isValid, true, `Esperava válido para: ${name}`);
        assert.strictEqual(res.error, undefined);
      }
    });

    it('2. validateUsername rejeita nomes curtos (< 3 caracteres)', () => {
      const res = validateUsername('ab');
      assert.strictEqual(res.isValid, false);
      assert.ok(res.error?.includes('mínimo 3 caracteres'));
    });

    it('3. validateUsername rejeita nomes longos (> 32 caracteres)', () => {
      const longName = 'a'.repeat(33);
      const res = validateUsername(longName);
      assert.strictEqual(res.isValid, false);
      assert.ok(res.error?.includes('máximo 32 caracteres'));
    });

    it('4. validateUsername rejeita caracteres especiais, espaços, hífens ou pontos', () => {
      const invalidNames = ['user name', 'pro-player', 'user@domain', 'gamer.tag', 'user!'];
      for (const name of invalidNames) {
        const res = validateUsername(name);
        assert.strictEqual(res.isValid, false, `Esperava inválido para: ${name}`);
        assert.ok(res.error?.includes('apenas letras minúsculas'));
      }
    });

    it('5. validateDisplayName valida comprimento mínimo (2) e máximo (50)', () => {
      assert.strictEqual(validateDisplayName('A').isValid, false);
      assert.strictEqual(validateDisplayName('Ana').isValid, true);
      assert.strictEqual(validateDisplayName('Lucas Master').isValid, true);
      assert.strictEqual(validateDisplayName('x'.repeat(51)).isValid, false);
    });

    it('6. PRESET_AVATARS contém avatares oficiais válidos e bem estruturados', () => {
      assert.ok(PRESET_AVATARS.length >= 6);
      for (const avatar of PRESET_AVATARS) {
        assert.ok(avatar.id.length > 0);
        assert.ok(avatar.label.length > 0);
        assert.ok(avatar.url.startsWith('https://'));
      }
    });
  });

  // --------------------------------------------------------------------------
  // 2. Mapeamento e Cálculo Autoritativo de Estatísticas
  // --------------------------------------------------------------------------
  describe('Cálculo Autoritativo de Estatísticas (PostgreSQL Source of Truth)', () => {
    it('7. mapRowToPlayerProfile calcula winRate 0% quando não há partidas', () => {
      const mockRow: ProfileRow = {
        id: 'usr-1',
        username: 'novato',
        display_name: 'Novato',
        avatar_url: null,
        total_matches: 0,
        total_wins: 0,
        total_draws: 0,
        total_losses: 0,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      };

      const mapped = mapRowToPlayerProfile(mockRow);
      assert.strictEqual(mapped.winRate, 0);
      assert.strictEqual(mapped.totalMatches, 0);
    });

    it('8. mapRowToPlayerProfile calcula winRate percentual arredondado corretamente', () => {
      const mockRow: ProfileRow = {
        id: 'usr-2',
        username: 'pro_gamer',
        display_name: 'Pro Gamer',
        avatar_url: 'https://avatar.url/img.png',
        total_matches: 10,
        total_wins: 7,
        total_draws: 2,
        total_losses: 1,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      };

      const mapped = mapRowToPlayerProfile(mockRow);
      assert.strictEqual(mapped.winRate, 70);
      assert.strictEqual(mapped.totalWins, 7);
      assert.strictEqual(mapped.totalLosses, 1);
      assert.strictEqual(mapped.totalDraws, 2);
    });

    it('9. mapRowToPlayerProfile usa username como fallback caso display_name seja nulo', () => {
      const mockRow: ProfileRow = {
        id: 'usr-3',
        username: 'solitary_wolf',
        display_name: '',
        avatar_url: null,
        total_matches: 2,
        total_wins: 1,
        total_draws: 0,
        total_losses: 1,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      };

      const mapped = mapRowToPlayerProfile(mockRow);
      assert.strictEqual(mapped.displayName, 'solitary_wolf');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Consulta de Perfil Próprio e Perfil Público com Cache
  // --------------------------------------------------------------------------
  describe('Consulta de Perfil e Cache Inteligente', () => {
    it('10. fetchMyProfile consulta o banco e retorna dados completos do usuário autenticado', async () => {
      const mockUserId = '11111111-1111-1111-1111-111111111111';
      const mockRow: ProfileRow = {
        id: mockUserId,
        username: 'marujo',
        display_name: 'Capitão Marujo',
        avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=cyber_warrior',
        total_matches: 5,
        total_wins: 4,
        total_draws: 0,
        total_losses: 1,
        created_at: '2026-10-05T12:00:00Z',
        updated_at: '2026-10-05T12:00:00Z',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from = (table: string) => {
        assert.strictEqual(table, 'profiles');
        return {
          select: (fields: string) => {
            assert.strictEqual(fields, '*');
            return {
              eq: (col: string, val: string) => {
                assert.strictEqual(col, 'id');
                assert.strictEqual(val, mockUserId);
                return {
                  maybeSingle: async () => ({ data: mockRow, error: null }),
                };
              },
            };
          },
        };
      };

      const res = await fetchMyProfile(mockUserId);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.id, mockUserId);
      assert.strictEqual(res.data?.displayName, 'Capitão Marujo');
      assert.strictEqual(res.data?.winRate, 80);
    });

    it('11. fetchPublicProfile limita os campos requisitados a dados públicos seguros', async () => {
      const targetUserId = '22222222-2222-2222-2222-222222222222';
      let selectedFields = '';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from = (table: string) => {
        assert.strictEqual(table, 'profiles');
        return {
          select: (fields: string) => {
            selectedFields = fields;
            return {
              eq: (col: string, val: string) => {
                assert.strictEqual(col, 'id');
                assert.strictEqual(val, targetUserId);
                return {
                  maybeSingle: async () => ({
                    data: {
                      id: targetUserId,
                      username: 'rival',
                      display_name: 'Rival Master',
                      avatar_url: null,
                      total_matches: 20,
                      total_wins: 15,
                      total_draws: 1,
                      total_losses: 4,
                      created_at: '2026-10-01T00:00:00Z',
                    },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      };

      const res = await fetchPublicProfile(targetUserId);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.username, 'rival');
      // Garante que não foi feito select '*'
      assert.ok(!selectedFields.includes('*'));
      assert.ok(selectedFields.includes('username'));
      assert.ok(selectedFields.includes('total_wins'));
    });

    it('12. fetchPublicProfile reutiliza cache em memória para evitar queries redundantes', async () => {
      const targetUserId = '33333333-3333-3333-3333-333333333333';
      let dbCallsCount = 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from = () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              dbCallsCount++;
              return {
                data: {
                  id: targetUserId,
                  username: 'cached_player',
                  display_name: 'Cached Player',
                  avatar_url: null,
                  total_matches: 10,
                  total_wins: 5,
                  total_draws: 2,
                  total_losses: 3,
                  created_at: '2026-10-01T00:00:00Z',
                },
                error: null,
              };
            },
          }),
        }),
      });

      // Primeira chamada: consulta o banco
      const res1 = await fetchPublicProfile(targetUserId);
      assert.strictEqual(res1.success, true);
      assert.strictEqual(dbCallsCount, 1);

      // Segunda chamada consecutiva: deve vir do cache
      const res2 = await fetchPublicProfile(targetUserId);
      assert.strictEqual(res2.success, true);
      assert.strictEqual(dbCallsCount, 1, 'Não deve fazer nova query ao banco dentro da janela de TTL do cache');
      assert.strictEqual(res2.data?.username, 'cached_player');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Atualização de Perfil, Validação Estrita e RLS/Unique Constraint
  // --------------------------------------------------------------------------
  describe('Atualização Segura de Perfil (updateMyProfile)', () => {
    it('13. updateMyProfile bloqueia no cliente username com formato inválido antes de chamar o banco', async () => {
      let dbCalled = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from = () => {
        dbCalled = true;
        return {};
      };

      const res = await updateMyProfile('user-id', { username: 'invalid name with spaces' });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, 'INVALID_USERNAME');
      assert.strictEqual(dbCalled, false, 'O banco nunca deve ser acionado com payload inválido');
    });

    it('14. updateMyProfile envia apenas campos autorizados (username, display_name, avatar_url)', async () => {
      const userId = '44444444-4444-4444-4444-444444444444';
      let payloadSent: Record<string, unknown> = {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from = (table: string) => {
        assert.strictEqual(table, 'profiles');
        return {
          update: (updates: Record<string, unknown>) => {
            payloadSent = updates;
            return {
              eq: (col: string, val: string) => {
                assert.strictEqual(col, 'id');
                assert.strictEqual(val, userId);
                return {
                  select: () => ({
                    single: async () => ({
                      data: {
                        id: userId,
                        username: 'valid_name',
                        display_name: 'Novo Nome',
                        avatar_url: 'https://example.com/avatar.png',
                        total_matches: 0,
                        total_wins: 0,
                        total_draws: 0,
                        total_losses: 0,
                        created_at: '2026-10-01T00:00:00Z',
                        updated_at: '2026-10-07T00:00:00Z',
                      },
                      error: null,
                    }),
                  }),
                };
              },
            };
          },
        };
      };

      const res = await updateMyProfile(userId, {
        username: 'valid_name',
        displayName: 'Novo Nome',
        avatarUrl: 'https://example.com/avatar.png',
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(payloadSent.username, 'valid_name');
      assert.strictEqual(payloadSent.display_name, 'Novo Nome');
      assert.strictEqual(payloadSent.avatar_url, 'https://example.com/avatar.png');
      // Proibido enviar campos protegidos como total_wins
      assert.strictEqual(payloadSent.total_wins, undefined);
      assert.strictEqual(payloadSent.total_matches, undefined);
    });

    it('15. updateMyProfile traduz código Postgres 23505 para USERNAME_TAKEN com mensagem amigável', async () => {
      const userId = '55555555-5555-5555-5555-555555555555';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from = () => ({
        update: () => ({
          eq: () => ({
            select: () => ({
              single: async () => ({
                data: null,
                error: {
                  code: '23505',
                  message: 'duplicate key value violates unique constraint "profiles_username_key"',
                },
              }),
            }),
          }),
        }),
      });

      const res = await updateMyProfile(userId, { username: 'already_taken' });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, 'USERNAME_TAKEN');
      assert.ok(res.error?.includes('já está em uso'));
    });
  });
});
