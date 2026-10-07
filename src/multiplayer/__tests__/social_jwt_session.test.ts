// ============================================================================
// Unit & Integration Tests: Social JWT & Session Resilience (Phase 14.1) — DuoPlay-Online
// Description: Testes do ciclo de sessão, recuperação de JWT expirado, single in-flight
//              refresh promise, proteção contra loops de retry e normalização de mensagens.
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getMyFriends,
  getReceivedFriendRequests,
  getSentFriendRequests,
  searchPlayers,
  sendFriendRequest,
  acceptFriendRequest,
  translateSocialError,
  clearSocialCache,
} from '@/services/social';
import {
  safeRefreshSession,
  isAuthOrTokenExpiredError,
} from '@/services/auth';
import { supabase } from '@/lib/supabase';
import type { Friend } from '@/types/social';

describe('Fase 14.1: Tratamento de JWT e Resiliência de Sessão no Sistema Social', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRefreshSession = (supabase.auth as any).refreshSession;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalSignOut = (supabase.auth as any).signOut;

  beforeEach(() => {
    clearSocialCache();
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.auth as any).refreshSession = originalRefreshSession;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.auth as any).signOut = originalSignOut;
    clearSocialCache();
  });

  // --------------------------------------------------------------------------
  // 1. Identificação de Erros de JWT e Token Expirado
  // --------------------------------------------------------------------------
  describe('Identificação e Tradução Estrita de Erros de JWT', () => {
    it('1. isAuthOrTokenExpiredError identifica "JWT expired" e códigos PGRST301', () => {
      assert.strictEqual(isAuthOrTokenExpiredError({ message: 'JWT expired', code: 'PGRST301' }), true);
      assert.strictEqual(isAuthOrTokenExpiredError({ message: 'invalid JWT: token is expired' }), true);
      assert.strictEqual(isAuthOrTokenExpiredError({ message: 'Token has expired', code: '401' }), true);
      assert.strictEqual(isAuthOrTokenExpiredError({ message: 'P0001: UNAUTHORIZED' }), true);
      assert.strictEqual(isAuthOrTokenExpiredError({ details: 'jwt claim is expired' }), true);
    });

    it('2. isAuthOrTokenExpiredError não confunde erros de regras de negócio', () => {
      assert.strictEqual(isAuthOrTokenExpiredError({ message: 'P0040: CANNOT_FRIEND_SELF' }), false);
      assert.strictEqual(isAuthOrTokenExpiredError({ message: 'P0041: USER_NOT_FOUND' }), false);
      assert.strictEqual(isAuthOrTokenExpiredError({ message: 'P0042: REQUEST_NOT_FOUND' }), false);
      assert.strictEqual(isAuthOrTokenExpiredError({ message: 'FRIENDSHIP_EXISTS' }), false);
    });

    it('3. translateSocialError nunca vaza "JWT expired" para a interface', () => {
      const err1 = translateSocialError({ message: 'JWT expired', code: 'PGRST301' });
      assert.strictEqual(err1.code, 'SESSION_EXPIRED');
      assert.strictEqual(err1.message, 'Sua sessão expirou. Entre novamente.');
      assert.ok(!err1.message.includes('JWT'));

      const err2 = translateSocialError({ message: 'invalid JWT: token is expired' });
      assert.strictEqual(err2.code, 'SESSION_EXPIRED');
      assert.strictEqual(err2.message, 'Sua sessão expirou. Entre novamente.');

      const err3 = translateSocialError({ code: 'PGRST301', message: 'Unauthorized' });
      assert.strictEqual(err3.code, 'SESSION_EXPIRED');
      assert.strictEqual(err3.message, 'Sua sessão expirou. Entre novamente.');
    });
  });

  // --------------------------------------------------------------------------
  // 2. Refresh Seguro e Compartilhado de Sessão (Mutex / In-Flight Promise)
  // --------------------------------------------------------------------------
  describe('Mecanismo Compartilhado de safeRefreshSession', () => {
    it('4. safeRefreshSession renova com sucesso e retorna a sessão ativa', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.auth as any).refreshSession = async () => ({
        data: {
          session: {
            access_token: 'fresh_jwt_token',
            refresh_token: 'fresh_refresh_token',
            user: { id: 'usr-123', email: 'test@example.com' },
          },
          user: { id: 'usr-123' },
        },
        error: null,
      });

      const res = await safeRefreshSession();
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.access_token, 'fresh_jwt_token');
    });

    it('5. Múltiplas chamadas concorrentes de refresh compartilham a mesma Promise em voo', async () => {
      let refreshCallCount = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.auth as any).refreshSession = async () => {
        refreshCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          data: {
            session: {
              access_token: `token_${refreshCallCount}`,
              user: { id: 'usr-123' },
            },
            user: { id: 'usr-123' },
          },
          error: null,
        };
      };

      // Dispara 5 chamadas simultâneas
      const [res1, res2, res3, res4, res5] = await Promise.all([
        safeRefreshSession(),
        safeRefreshSession(),
        safeRefreshSession(),
        safeRefreshSession(),
        safeRefreshSession(),
      ]);

      assert.strictEqual(refreshCallCount, 1, 'refreshSession deve ter sido chamado exatamente uma única vez');
      assert.strictEqual(res1.success, true);
      assert.strictEqual(res2.success, true);
      assert.strictEqual(res3.success, true);
      assert.strictEqual(res4.success, true);
      assert.strictEqual(res5.success, true);
      assert.strictEqual(res1.data?.access_token, 'token_1');
      assert.strictEqual(res5.data?.access_token, 'token_1');
    });

    it('6. Se o refresh falhar por token inválido, limpa sessão local e retorna mensagem amigável', async () => {
      let signOutCalled = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.auth as any).refreshSession = async () => ({
        data: { session: null, user: null },
        error: { message: 'Invalid Refresh Token: Refresh Token Not Found', status: 400 },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.auth as any).signOut = async () => {
        signOutCalled = true;
        return { error: null };
      };

      const res = await safeRefreshSession();
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error, 'Sua sessão expirou. Entre novamente.');
      assert.strictEqual(signOutCalled, true, 'Deve ter chamado signOut({ scope: "local" }) para limpar token corrompido');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Recuperação Transparente de Operações Sociais em Caso de JWT Expirado
  // --------------------------------------------------------------------------
  describe('Recuperação Transparente de Chamadas RPC com Token Expirado', () => {
    it('7. getMyFriends detecta JWT expired, renova token e repete chamada com sucesso', async () => {
      let rpcAttempts = 0;
      const mockFriends: Friend[] = [
        {
          friend_id: 'usr-2',
          username: 'competitor',
          display_name: 'Competidor',
          avatar_url: null,
          is_online: true,
          last_seen_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          total_matches: 10,
          total_wins: 6,
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (name: string) => {
        if (name === 'get_my_friends') {
          rpcAttempts++;
          if (rpcAttempts === 1) {
            // Primeira tentativa: JWT expirado retornado pelo PostgREST
            return {
              data: null,
              error: { code: 'PGRST301', message: 'JWT expired' },
            };
          }
          // Segunda tentativa pós-refresh: sucesso
          return {
            data: { success: true, data: mockFriends },
            error: null,
          };
        }
        return { data: null, error: null };
      };

      // Mock de refresh bem-sucedido
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.auth as any).refreshSession = async () => ({
        data: {
          session: { access_token: 'new_token', user: { id: 'usr-1' } },
          user: { id: 'usr-1' },
        },
        error: null,
      });

      const res = await getMyFriends(true);
      assert.strictEqual(res.success, true);
      assert.strictEqual(rpcAttempts, 2, 'Deve ter executado exatamente 1 retry após o refresh');
      assert.strictEqual(res.data?.length, 1);
      assert.strictEqual(res.data?.[0].username, 'competitor');
    });

    it('8. getReceivedFriendRequests e getSentFriendRequests recuperam transparentemente', async () => {
      let recAttempts = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (name: string) => {
        if (name === 'get_received_friend_requests') {
          recAttempts++;
          if (recAttempts === 1) {
            return { data: null, error: { message: 'invalid JWT: token is expired' } };
          }
          return {
            data: {
              success: true,
              data: [
                {
                  id: 'req-1',
                  requester_id: 'usr-9',
                  username: 'challenger',
                  display_name: 'Challenger',
                  avatar_url: null,
                  created_at: new Date().toISOString(),
                },
              ],
            },
            error: null,
          };
        }
        return { data: null, error: null };
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.auth as any).refreshSession = async () => ({
        data: { session: { access_token: 'token_ok' }, user: { id: 'usr-1' } },
        error: null,
      });

      const res = await getReceivedFriendRequests(true);
      assert.strictEqual(res.success, true);
      assert.strictEqual(recAttempts, 2);
      assert.strictEqual(res.data?.[0].username, 'challenger');
    });

    it('9. searchPlayers com JWT expirado faz refresh e retorna resultados', async () => {
      let searchAttempts = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (name: string) => {
        if (name === 'search_players') {
          searchAttempts++;
          if (searchAttempts === 1) {
            return { data: null, error: { message: 'JWT expired', code: 'PGRST301' } };
          }
          return {
            data: {
              success: true,
              data: [
                {
                  user_id: 'usr-42',
                  username: 'player42',
                  display_name: 'Player 42',
                  avatar_url: null,
                  relationship_status: 'none',
                  is_online: false,
                  last_seen_at: null,
                },
              ],
            },
            error: null,
          };
        }
        return { data: null, error: null };
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.auth as any).refreshSession = async () => ({
        data: { session: { access_token: 'renewed' }, user: { id: 'usr-1' } },
        error: null,
      });

      const res = await searchPlayers('player42');
      assert.strictEqual(res.success, true);
      assert.strictEqual(searchAttempts, 2);
      assert.strictEqual(res.data?.[0].username, 'player42');
    });

    it('10. Operações de mutação (sendFriendRequest/acceptFriendRequest) também suportam refresh transparente', async () => {
      let sendAttempts = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (name: string) => {
        if (name === 'send_friend_request') {
          sendAttempts++;
          if (sendAttempts === 1) {
            return { data: null, error: { message: 'JWT expired' } };
          }
          return {
            data: { success: true, data: { request_id: 'req-new', status: 'pending', action: 'created' } },
            error: null,
          };
        }
        return { data: null, error: null };
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.auth as any).refreshSession = async () => ({
        data: { session: { access_token: 'fresh' }, user: { id: 'usr-1' } },
        error: null,
      });

      const res = await sendFriendRequest('target-uuid');
      assert.strictEqual(res.success, true);
      assert.strictEqual(sendAttempts, 2);
      assert.strictEqual(res.data?.request_id, 'req-new');
    });

    it('11. Limite estrito de 1 retry: se a chamada falhar após o refresh, não cria loop infinito', async () => {
      let rpcCallCount = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => {
        rpcCallCount++;
        return {
          data: null,
          error: { code: 'PGRST301', message: 'JWT expired' },
        };
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.auth as any).refreshSession = async () => ({
        data: { session: { access_token: 'token' }, user: { id: 'usr-1' } },
        error: null,
      });

      const res = await getMyFriends(true);
      assert.strictEqual(res.success, false);
      assert.strictEqual(rpcCallCount, 2, 'Não pode tentar mais do que 1 retry (total máximo de 2 chamadas)');
      assert.strictEqual(res.code, 'SESSION_EXPIRED');
      assert.strictEqual(res.error, 'Sua sessão expirou. Entre novamente.');
    });

    it('12. Se o refresh falhar completamente, a operação retorna erro amigável sem tentar retry', async () => {
      let rpcCallCount = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => {
        rpcCallCount++;
        return {
          data: null,
          error: { code: 'PGRST301', message: 'JWT expired' },
        };
      };

      // Refresh falha
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.auth as any).refreshSession = async () => ({
        data: { session: null, user: null },
        error: { message: 'Refresh token expired' },
      });

      const res = await acceptFriendRequest('req-123');
      assert.strictEqual(res.success, false);
      assert.strictEqual(rpcCallCount, 1, 'Não deve tentar retry se o refresh falhou');
      assert.strictEqual(res.code, 'SESSION_EXPIRED');
      assert.strictEqual(res.error, 'Sua sessão expirou. Entre novamente.');
    });
  });
});
