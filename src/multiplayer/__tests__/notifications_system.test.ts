// ============================================================================
// Unit & Integration Tests: Notification System (Phase 16 & 16.2) — DuoPlay-Online
// Description: Testes autoritativos de traducao de erros, RPCs de notificacoes,
//              deduplicacao por ID e event_key, ordenacao deterministica,
//              contagem de unread e marcacao de leitura.
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  translateNotificationError,
  getMyNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/services/notifications';
import { supabase } from '@/lib/supabase';
import type { NotificationItem } from '@/types/notifications';

describe('Fase 16.2: Hardening e Validacao do Sistema de Notificacoes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
  });

  // --------------------------------------------------------------------------
  // 1. Tradução e Mapeamento de Erros
  // --------------------------------------------------------------------------
  describe('1. Tradução e Mapeamento de Erros do Notification Service', () => {
    it('1.1. Deve traduzir erro de JWT expirado', () => {
      const err = translateNotificationError({ message: 'JWT expired', code: 'PGRST301' });
      assert.strictEqual(err.code, 'SESSION_EXPIRED');
      assert.ok(err.message.includes('Sua sessão expirou'));
    });

    it('1.2. Deve traduzir erro de autorização P0001 / Unauthorized', () => {
      const err = translateNotificationError({ message: 'P0001: UNAUTHORIZED', code: '401' });
      assert.strictEqual(err.code, 'UNAUTHORIZED');
      assert.ok(err.message.includes('autenticado'));
    });

    it('1.3. Deve traduzir erro de conexão de rede', () => {
      const err = translateNotificationError({ message: 'Failed to fetch' });
      assert.strictEqual(err.code, 'NETWORK_ERROR');
      assert.ok(err.message.includes('conexão'));
    });

    it('1.4. Deve tratar erro com mensagem genérica', () => {
      const err = translateNotificationError({ message: 'Internal Database Error', code: '500' });
      assert.strictEqual(err.code, '500');
      assert.strictEqual(err.message, 'Internal Database Error');
    });
  });

  // --------------------------------------------------------------------------
  // 2. RPCs de Notificações
  // --------------------------------------------------------------------------
  describe('2. RPCs Autoritativas de Notificações', () => {
    it('2.1. getMyNotifications retorna lista ordenada de notificações do usuário', async () => {
      const mockNotifications: NotificationItem[] = [
        {
          id: 'notif-1',
          user_id: 'user-100',
          type: 'friend_request_received',
          actor_id: 'actor-1',
          title: 'Novo pedido de amizade',
          body: 'Jogador A quer ser seu amigo',
          data: { request_id: 'req-1' },
          event_key: 'friend_request_received:req-1',
          read_at: null,
          created_at: '2026-10-08T18:00:00.000Z',
        },
        {
          id: 'notif-2',
          user_id: 'user-100',
          type: 'game_invite_received',
          actor_id: 'actor-2',
          title: 'Convite para partida',
          body: 'Jogador B convidou voce',
          data: { room_code: 'ABCDEF' },
          event_key: 'game_invite_received:inv-1',
          read_at: '2026-10-08T18:05:00.000Z',
          created_at: '2026-10-08T17:50:00.000Z',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string) => {
        assert.strictEqual(rpcName, 'get_my_notifications');
        return {
          data: {
            success: true,
            data: mockNotifications,
            error: null,
          },
          error: null,
        };
      };

      const res = await getMyNotifications(30);
      assert.strictEqual(res.success, true);
      assert.ok(Array.isArray(res.data));
      assert.strictEqual(res.data?.length, 2);
      assert.strictEqual(res.data?.[0].id, 'notif-1');
      assert.strictEqual(res.data?.[0].event_key, 'friend_request_received:req-1');
    });

    it('2.2. getUnreadNotificationCount retorna número exato de não lidas', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string) => {
        assert.strictEqual(rpcName, 'get_unread_notification_count');
        return {
          data: {
            success: true,
            data: { unread_count: 5 },
            error: null,
          },
          error: null,
        };
      };

      const res = await getUnreadNotificationCount();
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.unread_count, 5);
    });

    it('2.3. markNotificationRead executa RPC e atualiza notificação', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, params: { p_notification_id: string }) => {
        assert.strictEqual(rpcName, 'mark_notification_read');
        assert.strictEqual(params.p_notification_id, 'notif-123');
        return {
          data: {
            success: true,
            data: { notification_id: 'notif-123', read: true },
            error: null,
          },
          error: null,
        };
      };

      const res = await markNotificationRead('notif-123');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.notification_id, 'notif-123');
      assert.strictEqual(res.data?.read, true);
    });

    it('2.4. markAllNotificationsRead marca todas as notificações como lidas', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string) => {
        assert.strictEqual(rpcName, 'mark_all_notifications_read');
        return {
          data: {
            success: true,
            data: { updated_count: 3 },
            error: null,
          },
          error: null,
        };
      };

      const res = await markAllNotificationsRead();
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.updated_count, 3);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Lógica de Deduplicação e Reconciliação
  // --------------------------------------------------------------------------
  describe('3. Deduplicação e Ordenação de Notificações', () => {
    it('3.1. Deduplicação por ID e event_key em lista de notificações', () => {
      const existing: NotificationItem[] = [
        {
          id: 'n-1',
          user_id: 'u-1',
          type: 'friend_request_received',
          actor_id: 'a-1',
          title: 'Pedido 1',
          body: 'Corpo 1',
          data: {},
          event_key: 'key-1',
          read_at: null,
          created_at: '2026-10-08T18:00:00.000Z',
        },
      ];

      const newItemKeyDuplicate: NotificationItem = {
        id: 'n-2',
        user_id: 'u-1',
        type: 'friend_request_received',
        actor_id: 'a-1',
        title: 'Pedido 1 Duplicado',
        body: 'Corpo 1',
        data: {},
        event_key: 'key-1', // Mesma event_key
        read_at: null,
        created_at: '2026-10-08T18:01:00.000Z',
      };

      const existingKeys = new Set(existing.map((n) => n.event_key).filter(Boolean));
      const existingIds = new Set(existing.map((n) => n.id));

      const isDuplicate =
        existingIds.has(newItemKeyDuplicate.id) ||
        Boolean(newItemKeyDuplicate.event_key && existingKeys.has(newItemKeyDuplicate.event_key));

      assert.strictEqual(isDuplicate, true);
    });

    it('3.2. Ordenação determinística por created_at DESC e id DESC', () => {
      const items: NotificationItem[] = [
        {
          id: 'a',
          user_id: 'u-1',
          type: 'new_message',
          actor_id: null,
          title: 'A',
          body: 'A',
          data: {},
          event_key: 'key-a',
          read_at: null,
          created_at: '2026-10-08T18:00:00.000Z',
        },
        {
          id: 'c',
          user_id: 'u-1',
          type: 'new_message',
          actor_id: null,
          title: 'C',
          body: 'C',
          data: {},
          event_key: 'key-c',
          read_at: null,
          created_at: '2026-10-08T19:00:00.000Z',
        },
        {
          id: 'b',
          user_id: 'u-1',
          type: 'new_message',
          actor_id: null,
          title: 'B',
          body: 'B',
          data: {},
          event_key: 'key-b',
          read_at: null,
          created_at: '2026-10-08T19:00:00.000Z', // Mesmo timestamp que C, mas id 'b' < 'c'
        },
      ];

      const sorted = [...items].sort((a, b) => {
        const timeA = new Date(a.created_at).getTime();
        const timeB = new Date(b.created_at).getTime();
        if (timeA !== timeB) return timeB - timeA;
        return b.id.localeCompare(a.id);
      });

      assert.strictEqual(sorted[0].id, 'c');
      assert.strictEqual(sorted[1].id, 'b');
      assert.strictEqual(sorted[2].id, 'a');
    });

    it('3.3. Transição de estado de leitura preserva integridade do unread count', () => {
      let unreadCount = 2;
      const notifications: NotificationItem[] = [
        {
          id: 'n-1',
          user_id: 'u-1',
          type: 'friend_request_received',
          actor_id: null,
          title: 'Req 1',
          body: 'Body',
          data: {},
          event_key: 'k-1',
          read_at: null,
          created_at: '2026-10-08T18:00:00.000Z',
        },
        {
          id: 'n-2',
          user_id: 'u-1',
          type: 'game_invite_received',
          actor_id: null,
          title: 'Req 2',
          body: 'Body',
          data: {},
          event_key: 'k-2',
          read_at: '2026-10-08T18:05:00.000Z', // Já lida
          created_at: '2026-10-08T18:01:00.000Z',
        },
      ];

      // Tentar marcar n-2 (já lida) como lida novamente
      const target2 = notifications.find((n) => n.id === 'n-2');
      let wasUnread2 = false;
      if (target2 && !target2.read_at) {
        wasUnread2 = true;
      }
      if (wasUnread2) {
        unreadCount = Math.max(0, unreadCount - 1);
      }
      assert.strictEqual(unreadCount, 2); // Não deve decrementar!

      // Tentar marcar n-1 (não lida) como lida
      const target1 = notifications.find((n) => n.id === 'n-1');
      let wasUnread1 = false;
      if (target1 && !target1.read_at) {
        wasUnread1 = true;
      }
      if (wasUnread1) {
        unreadCount = Math.max(0, unreadCount - 1);
      }
      assert.strictEqual(unreadCount, 1); // Decrementou corretamente!
    });
  });
});
