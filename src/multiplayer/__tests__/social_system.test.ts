// ============================================================================
// Unit & Integration Tests: Social System & Friendships (Phase 14) — DuoPlay-Online
// Description: Testes autoritativos de busca de jogadores, solicitações de amizade,
//              aceite/recusa/cancelamento, remoção, listagem e status de presença.
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchPlayers,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  removeFriend,
  getMyFriends,
  getReceivedFriendRequests,
  getSentFriendRequests,
  getFriendshipStatus,
  translateSocialError,
  clearSocialCache,
} from '@/services/social';
import { supabase } from '@/lib/supabase';
import type { Friend, FriendRequest, FriendSearchResult, FriendshipStatusData } from '@/types/social';

describe('Fase 14: Sistema Social — Amigos e Jogadores', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  beforeEach(() => {
    clearSocialCache();
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
    clearSocialCache();
  });

  // --------------------------------------------------------------------------
  // 1. Tradução e Mapeamento de Erros
  // --------------------------------------------------------------------------
  describe('Tradução e Mapeamento de Erros do Backend', () => {
    it('1. Deve traduzir erro de autorização P0001 / UNAUTHORIZED', () => {
      const err = translateSocialError({ message: 'P0001: UNAUTHORIZED' });
      assert.strictEqual(err.code, 'UNAUTHORIZED');
      assert.ok(err.message.includes('estar logado'));
    });

    it('2. Deve traduzir erro de autofavoritismo P0040 / CANNOT_FRIEND_SELF', () => {
      const err = translateSocialError({ message: 'P0040: CANNOT_FRIEND_SELF' });
      assert.strictEqual(err.code, 'CANNOT_FRIEND_SELF');
      assert.ok(err.message.includes('para si mesmo'));
    });

    it('3. Deve traduzir erro de jogador não encontrado P0041 / USER_NOT_FOUND', () => {
      const err = translateSocialError({ message: 'P0041: USER_NOT_FOUND' });
      assert.strictEqual(err.code, 'USER_NOT_FOUND');
      assert.ok(err.message.includes('não encontrado'));
    });

    it('4. Deve traduzir erro de solicitação inexistente P0042 / REQUEST_NOT_FOUND', () => {
      const err = translateSocialError({ message: 'P0042: REQUEST_NOT_FOUND' });
      assert.strictEqual(err.code, 'REQUEST_NOT_FOUND');
      assert.ok(err.message.includes('não encontrada'));
    });

    it('5. Deve traduzir erro de solicitação não pendente P0044 / INVALID_REQUEST_STATUS', () => {
      const err = translateSocialError({ message: 'P0044: INVALID_REQUEST_STATUS' });
      assert.strictEqual(err.code, 'INVALID_REQUEST_STATUS');
      assert.ok(err.message.includes('não está mais pendente'));
    });

    it('6. Deve tratar erros genéricos de rede e objetos nulos', () => {
      const nullErr = translateSocialError(null);
      assert.strictEqual(nullErr.code, 'UNKNOWN_ERROR');
      assert.ok(nullErr.message.length > 0);

      const netErr = translateSocialError({ message: 'Failed to fetch' });
      assert.strictEqual(netErr.code, 'NETWORK_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // 2. Busca de Jogadores (Search Players)
  // --------------------------------------------------------------------------
  describe('Busca de Jogadores na Plataforma', () => {
    it('7. Query com menos de 2 caracteres retorna lista vazia sem chamar RPC', async () => {
      let rpcCalled = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => {
        rpcCalled = true;
        return { data: null, error: null };
      };

      const res1 = await searchPlayers('');
      const res2 = await searchPlayers('a');
      const res3 = await searchPlayers('@');

      assert.strictEqual(res1.success, true);
      assert.deepStrictEqual(res1.data, []);
      assert.strictEqual(res2.success, true);
      assert.deepStrictEqual(res2.data, []);
      assert.strictEqual(res3.success, true);
      assert.strictEqual(rpcCalled, false);
    });

    it('8. Query válida remove prefixo @ e retorna resultados com status de relacionamento', async () => {
      const mockPlayers: FriendSearchResult[] = [
        {
          user_id: 'usr-2',
          username: 'rival_master',
          display_name: 'Rival Master',
          avatar_url: 'https://example.com/avatar.png',
          total_matches: 12,
          total_wins: 8,
          win_rate: 67,
          is_friend: false,
          relationship_status: 'none',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, params: any) => {
        assert.strictEqual(fn, 'search_players');
        assert.strictEqual(params.p_query, 'rival');
        return {
          data: {
            success: true,
            data: mockPlayers,
          },
          error: null,
        };
      };

      const res = await searchPlayers('@rival');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.length, 1);
      assert.strictEqual(res.data?.[0].username, 'rival_master');
      assert.strictEqual(res.data?.[0].relationship_status, 'none');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Ciclo de Vida de Solicitações de Amizade
  // --------------------------------------------------------------------------
  describe('Envio, Aceite, Recusa e Cancelamento de Solicitações', () => {
    it('9. sendFriendRequest envia solicitação com sucesso', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, params: any) => {
        assert.strictEqual(fn, 'send_friend_request');
        assert.strictEqual(params.p_recipient_id, 'usr-3');
        return {
          data: {
            success: true,
            data: { request_id: 'req-1', status: 'pending', action: 'created' },
          },
          error: null,
        };
      };

      const res = await sendFriendRequest('usr-3');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.request_id, 'req-1');
      assert.strictEqual(res.data?.status, 'pending');
    });

    it('10. acceptFriendRequest transiciona pedido para aceito e estabelece amizade', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, params: any) => {
        assert.strictEqual(fn, 'accept_friend_request');
        assert.strictEqual(params.p_request_id, 'req-1');
        return {
          data: {
            success: true,
            data: { request_id: 'req-1', status: 'accepted' },
          },
          error: null,
        };
      };

      const res = await acceptFriendRequest('req-1');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.status, 'accepted');
    });

    it('11. declineFriendRequest recusa pedido pendente', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, params: any) => {
        assert.strictEqual(fn, 'decline_friend_request');
        assert.strictEqual(params.p_request_id, 'req-2');
        return {
          data: {
            success: true,
            data: { request_id: 'req-2', status: 'declined' },
          },
          error: null,
        };
      };

      const res = await declineFriendRequest('req-2');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.status, 'declined');
    });

    it('12. cancelFriendRequest cancela pedido enviado pelo próprio usuário', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, params: any) => {
        assert.strictEqual(fn, 'cancel_friend_request');
        assert.strictEqual(params.p_request_id, 'req-3');
        return {
          data: {
            success: true,
            data: { request_id: 'req-3', status: 'cancelled' },
          },
          error: null,
        };
      };

      const res = await cancelFriendRequest('req-3');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.status, 'cancelled');
    });

    it('13. removeFriend desfaz amizade canônica entre dois jogadores', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, params: any) => {
        assert.strictEqual(fn, 'remove_friend');
        assert.strictEqual(params.p_friend_id, 'usr-friend-1');
        return {
          data: {
            success: true,
            data: { friend_id: 'usr-friend-1', removed: true },
          },
          error: null,
        };
      };

      const res = await removeFriend('usr-friend-1');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.removed, true);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Listagens de Amigos e Status de Presença
  // --------------------------------------------------------------------------
  describe('Listagens Sociais e Presença Online', () => {
    it('14. getMyFriends retorna lista de amigos com indicador de presença', async () => {
      const mockFriends: Friend[] = [
        {
          friend_id: 'usr-f1',
          username: 'amigo_pro',
          display_name: 'Amigo Pro',
          avatar_url: null,
          created_at: '2026-10-05T00:00:00Z',
          total_matches: 20,
          total_wins: 15,
          is_online: true,
          last_seen_at: '2026-10-07T06:00:00Z',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string) => {
        assert.strictEqual(fn, 'get_my_friends');
        return {
          data: {
            success: true,
            data: mockFriends,
          },
          error: null,
        };
      };

      const res = await getMyFriends(true);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.length, 1);
      assert.strictEqual(res.data?.[0].is_online, true);
      assert.strictEqual(res.data?.[0].username, 'amigo_pro');
    });

    it('15. getReceivedFriendRequests e getSentFriendRequests retornam solicitações pendentes', async () => {
      const mockRequests: FriendRequest[] = [
        {
          request_id: 'req-rec-1',
          requester_id: 'usr-9',
          username: 'desafiante',
          display_name: 'Desafiante 9',
          avatar_url: null,
          created_at: '2026-10-07T06:30:00Z',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string) => {
        if (fn === 'get_received_friend_requests') {
          return { data: { success: true, data: mockRequests }, error: null };
        }
        if (fn === 'get_sent_friend_requests') {
          return { data: { success: true, data: [] }, error: null };
        }
        return { data: null, error: null };
      };

      const recRes = await getReceivedFriendRequests(true);
      const sentRes = await getSentFriendRequests(true);

      assert.strictEqual(recRes.success, true);
      assert.strictEqual(recRes.data?.length, 1);
      assert.strictEqual(sentRes.success, true);
      assert.strictEqual(sentRes.data?.length, 0);
    });

    it('16. getFriendshipStatus retorna status social e de presença de outro jogador', async () => {
      const mockStatus: FriendshipStatusData = {
        status: 'friends',
        request_id: null,
        is_online: true,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, params: any) => {
        assert.strictEqual(fn, 'get_friendship_status');
        assert.strictEqual(params.p_other_user_id, 'usr-other');
        return {
          data: {
            success: true,
            data: mockStatus,
          },
          error: null,
        };
      };

      const res = await getFriendshipStatus('usr-other', true);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.status, 'friends');
      assert.strictEqual(res.data?.is_online, true);
    });
  });
});
