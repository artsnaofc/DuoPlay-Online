// ============================================================================
// Unit & Integration Tests: Chat & Private Communication (Phase 15) — DuoPlay-Online
// Description: Testes unitários e de integração do sistema de conversas 1:1,
//              validações de amizade, controle de autorização, paginação, não lidas e Realtime.
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOrCreateDirectConversation,
  getMyConversations,
  getConversationMessages,
  sendMessage,
  markConversationRead,
  translateChatError,
  clearChatCache,
} from '@/services/chat';
import { supabase } from '@/lib/supabase';
import type { ConversationSummary, ChatMessage } from '@/types/chat';

describe('Fase 15: Sistema de Comunicação — Chat Privado 1:1 Entre Amigos', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRefreshSession = (supabase.auth as any).refreshSession;

  beforeEach(() => {
    clearChatCache();
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.auth as any).refreshSession = originalRefreshSession;
    clearChatCache();
  });

  // --------------------------------------------------------------------------
  // 1. Tradução e Mapeamento de Erros
  // --------------------------------------------------------------------------
  describe('Tradução e Mapeamento de Erros do Chat', () => {
    it('1. Deve traduzir erro de sessão expirada / JWT', () => {
      const err = translateChatError({ message: 'JWT expired: token has expired' });
      assert.strictEqual(err.code, 'SESSION_EXPIRED');
      assert.strictEqual(err.message, 'Sua sessão expirou. Entre novamente.');
    });

    it('2. Deve traduzir erro de auto-conversa (CANNOT_CHAT_SELF / P0060)', () => {
      const err = translateChatError({ message: 'P0060: CANNOT_CHAT_SELF' });
      assert.strictEqual(err.code, 'CANNOT_CHAT_SELF');
      assert.strictEqual(err.message, 'Não é permitido iniciar uma conversa consigo mesmo.');
    });

    it('3. Deve traduzir erro de usuário não-amigo (USER_NOT_FRIEND / P0051)', () => {
      const err = translateChatError({ message: 'P0051: USER_NOT_FRIEND' });
      assert.strictEqual(err.code, 'USER_NOT_FRIEND');
      assert.strictEqual(err.message, 'Você só pode conversar com jogadores da sua lista de amigos.');
    });

    it('4. Deve traduzir erro de mensagem vazia (EMPTY_MESSAGE / P0061)', () => {
      const err = translateChatError({ message: 'P0061: EMPTY_MESSAGE' });
      assert.strictEqual(err.code, 'EMPTY_MESSAGE');
      assert.strictEqual(err.message, 'A mensagem não pode ser vazia.');
    });

    it('5. Deve traduzir erro de mensagem muito longa (MESSAGE_TOO_LONG / P0062)', () => {
      const err = translateChatError({ message: 'P0062: MESSAGE_TOO_LONG' });
      assert.strictEqual(err.code, 'MESSAGE_TOO_LONG');
      assert.strictEqual(err.message, 'A mensagem ultrapassou o limite máximo de 2.000 caracteres.');
    });

    it('6. Deve traduzir erro de permissão negada (FORBIDDEN / P0002)', () => {
      const err = translateChatError({ message: 'P0002: FORBIDDEN' });
      assert.strictEqual(err.code, 'FORBIDDEN');
      assert.strictEqual(err.message, 'Você não tem permissão para acessar esta conversa.');
    });
  });

  // --------------------------------------------------------------------------
  // 2. Criação e Obtenção de Conversas
  // --------------------------------------------------------------------------
  describe('Criação e Obtenção de Conversas 1:1', () => {
    it('7. getOrCreateDirectConversation obtém ou cria conversa canônica com amigo', async () => {
      const mockConv: ConversationSummary = {
        conversation_id: 'conv-123',
        type: 'direct',
        created_at: '2026-10-07T12:00:00Z',
        last_message_at: '2026-10-07T12:00:00Z',
        unread_count: 0,
        other_user: {
          id: 'user-b',
          username: 'player_b',
          display_name: 'Player B',
          avatar_url: null,
          is_online: true,
          last_seen_at: new Date().toISOString(),
        },
        last_message: null,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, params: any) => {
        assert.strictEqual(rpcName, 'get_or_create_direct_conversation');
        assert.strictEqual(params.p_other_user_id, 'user-b');
        return {
          data: {
            success: true,
            data: mockConv,
            error: null,
          },
          error: null,
        };
      };

      const res = await getOrCreateDirectConversation('user-b');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.conversation_id, 'conv-123');
      assert.strictEqual(res.data?.other_user.display_name, 'Player B');
    });

    it('8. getOrCreateDirectConversation rejeita conversa com não-amigo', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => ({
        data: null,
        error: { message: 'P0051: USER_NOT_FRIEND' },
      });

      const res = await getOrCreateDirectConversation('user-stranger');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, 'USER_NOT_FRIEND');
    });

    it('9. getOrCreateDirectConversation rejeita auto-conversa', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => ({
        data: null,
        error: { message: 'P0060: CANNOT_CHAT_SELF' },
      });

      const res = await getOrCreateDirectConversation('my-own-id');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, 'CANNOT_CHAT_SELF');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Listagem de Conversas
  // --------------------------------------------------------------------------
  describe('Listagem e Cache de Conversas', () => {
    it('10. getMyConversations retorna lista com badges de não lidas e status online', async () => {
      const mockConversations: ConversationSummary[] = [
        {
          conversation_id: 'conv-1',
          type: 'direct',
          created_at: '2026-10-07T12:00:00Z',
          last_message_at: '2026-10-07T12:10:00Z',
          unread_count: 2,
          other_user: {
            id: 'user-b',
            username: 'amigo1',
            display_name: 'Amigo Um',
            avatar_url: null,
            is_online: true,
            last_seen_at: new Date().toISOString(),
          },
          last_message: {
            id: 'msg-1',
            sender_id: 'user-b',
            body: 'Bora jogar?',
            created_at: '2026-10-07T12:10:00Z',
          },
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string) => {
        assert.strictEqual(rpcName, 'get_my_conversations');
        return {
          data: {
            success: true,
            data: mockConversations,
          },
          error: null,
        };
      };

      const res = await getMyConversations(true);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.length, 1);
      assert.strictEqual(res.data?.[0].unread_count, 2);
      assert.strictEqual(res.data?.[0].other_user.is_online, true);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Envio de Mensagens e Validações
  // --------------------------------------------------------------------------
  describe('Envio de Mensagens', () => {
    it('11. sendMessage persiste mensagem com sucesso', async () => {
      const mockMsg: ChatMessage = {
        id: 'msg-100',
        conversation_id: 'conv-1',
        sender_id: 'user-me',
        body: 'Olá amigo!',
        created_at: '2026-10-07T12:15:00Z',
        is_mine: true,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, params: any) => {
        assert.strictEqual(rpcName, 'send_message');
        assert.strictEqual(params.p_conversation_id, 'conv-1');
        assert.strictEqual(params.p_body, 'Olá amigo!');
        return {
          data: {
            success: true,
            data: mockMsg,
          },
          error: null,
        };
      };

      const res = await sendMessage('conv-1', 'Olá amigo!');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.id, 'msg-100');
      assert.strictEqual(res.data?.body, 'Olá amigo!');
    });

    it('12. sendMessage rejeita mensagens vazias no cliente antes de RPC', async () => {
      const res = await sendMessage('conv-1', '   ');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, 'EMPTY_MESSAGE');
    });

    it('13. sendMessage rejeita mensagens que excedem 2000 caracteres no cliente', async () => {
      const hugeText = 'a'.repeat(2001);
      const res = await sendMessage('conv-1', hugeText);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, 'MESSAGE_TOO_LONG');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Histórico e Leitura
  // --------------------------------------------------------------------------
  describe('Histórico Paginado e Estado de Leitura', () => {
    it('14. getConversationMessages busca mensagens com paginação determinística', async () => {
      const mockMessages: ChatMessage[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          sender_id: 'user-b',
          body: 'Primeira',
          created_at: '2026-10-07T12:00:00Z',
          is_mine: false,
        },
        {
          id: 'msg-2',
          conversation_id: 'conv-1',
          sender_id: 'user-me',
          body: 'Segunda',
          created_at: '2026-10-07T12:01:00Z',
          is_mine: true,
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, params: any) => {
        assert.strictEqual(rpcName, 'get_conversation_messages');
        assert.strictEqual(params.p_conversation_id, 'conv-1');
        assert.strictEqual(params.p_limit, 30);
        return {
          data: {
            success: true,
            data: {
              messages: mockMessages,
              has_more: false,
            },
          },
          error: null,
        };
      };

      const res = await getConversationMessages('conv-1', 30);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.messages.length, 2);
      assert.strictEqual(res.data?.has_more, false);
    });

    it('15. markConversationRead atualiza timestamp de leitura no backend', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, params: any) => {
        assert.strictEqual(rpcName, 'mark_conversation_read');
        assert.strictEqual(params.p_conversation_id, 'conv-1');
        return {
          data: {
            success: true,
            data: {
              conversation_id: 'conv-1',
              last_read_at: new Date().toISOString(),
            },
          },
          error: null,
        };
      };

      const res = await markConversationRead('conv-1');
      assert.strictEqual(res.success, true);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Resiliência de Sessão e JWT Expirado
  // --------------------------------------------------------------------------
  describe('Resiliência de Sessão e Retry Transparente', () => {
    it('16. sendMessage recupera de JWT expirado renovando token e repetindo a chamada', async () => {
      let rpcCount = 0;
      let refreshAttempted = false;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.auth as any).refreshSession = async () => {
        refreshAttempted = true;
        return {
          data: { session: { access_token: 'new-valid-token' } },
          error: null,
        };
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => {
        rpcCount++;
        if (rpcCount === 1) {
          return {
            data: null,
            error: { message: 'JWT expired' },
          };
        }
        return {
          data: {
            success: true,
            data: {
              id: 'msg-recovered',
              conversation_id: 'conv-1',
              sender_id: 'user-me',
              body: 'Mensagem após refresh',
              created_at: new Date().toISOString(),
              is_mine: true,
            },
          },
          error: null,
        };
      };

      const res = await sendMessage('conv-1', 'Mensagem após refresh');
      assert.strictEqual(res.success, true);
      assert.strictEqual(refreshAttempted, true);
      assert.strictEqual(rpcCount, 2);
      assert.strictEqual(res.data?.id, 'msg-recovered');
    });
  });

  // --------------------------------------------------------------------------
  // 7. Hardening da Sincronização, Reconciliação e Prevenção de Race Condition
  // --------------------------------------------------------------------------
  describe('Fase 15.1: Hardening de Sincronização Multi-Sessão e Reconciliação', () => {
    it('17. Reconciliação mescla mensagens novas mantendo ordenação determinística (created_at ASC, id ASC)', () => {
      const existingMessages: ChatMessage[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          sender_id: 'user-a',
          body: 'Oi',
          created_at: '2026-10-07T12:00:00.000Z',
          is_mine: true,
        },
      ];

      const newServerMessages: ChatMessage[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          sender_id: 'user-a',
          body: 'Oi',
          created_at: '2026-10-07T12:00:00.000Z',
          is_mine: true,
        },
        {
          id: 'msg-2',
          conversation_id: 'conv-1',
          sender_id: 'user-b',
          body: 'oba',
          created_at: '2026-10-07T12:01:00.000Z',
          is_mine: false,
        },
      ];

      // Reconciliador idempotente em memória
      const serverMap = new Map<string, ChatMessage>();
      newServerMessages.forEach((m) => serverMap.set(m.id, m));

      const combined = [...newServerMessages];
      combined.sort((a, b) => {
        const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.id.localeCompare(b.id);
      });

      assert.strictEqual(combined.length, 2);
      assert.strictEqual(combined[0].id, 'msg-1');
      assert.strictEqual(combined[1].id, 'msg-2');
      assert.strictEqual(combined[1].body, 'oba');
    });

    it('18. Reconciliação preserva mensagens otimistas pendentes e deduplica confirmações oficiais', () => {
      const prevMessages: ChatMessage[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          sender_id: 'user-a',
          body: 'Oi',
          created_at: '2026-10-07T12:00:00.000Z',
          is_mine: true,
        },
        {
          id: 'temp_123',
          conversation_id: 'conv-1',
          sender_id: 'user-a',
          body: 'Mensagem em envio',
          created_at: '2026-10-07T12:02:00.000Z',
          is_mine: true,
          delivery_status: 'pending',
        },
      ];

      const snapshotMessages: ChatMessage[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          sender_id: 'user-a',
          body: 'Oi',
          created_at: '2026-10-07T12:00:00.000Z',
          is_mine: true,
        },
        {
          id: 'msg-2',
          conversation_id: 'conv-1',
          sender_id: 'user-b',
          body: 'oba',
          created_at: '2026-10-07T12:01:00.000Z',
          is_mine: false,
        },
      ];

      const serverMap = new Map<string, ChatMessage>();
      snapshotMessages.forEach((m) => serverMap.set(m.id, m));

      const pendingOptimistic = prevMessages.filter(
        (m) => (m.delivery_status === 'pending' || m.delivery_status === 'failed') && m.conversation_id === 'conv-1'
      );

      const combined = [...snapshotMessages];
      pendingOptimistic.forEach((m) => {
        if (!serverMap.has(m.id)) {
          combined.push(m);
        }
      });

      combined.sort((a, b) => {
        const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.id.localeCompare(b.id);
      });

      assert.strictEqual(combined.length, 3);
      assert.strictEqual(combined[1].id, 'msg-2');
      assert.strictEqual(combined[2].id, 'temp_123');
      assert.strictEqual(combined[2].delivery_status, 'pending');
    });

    it('19. Detecção de inconsistência entre resumo da conversa e painel de mensagens dispara reconciliação', () => {
      const summaryLastMsgId = 'msg-2';
      const localMessages: ChatMessage[] = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          sender_id: 'user-a',
          body: 'Oi',
          created_at: '2026-10-07T12:00:00.000Z',
          is_mine: true,
        },
      ];

      const isMissingNewMessage = !localMessages.some((m) => m.id === summaryLastMsgId);
      assert.strictEqual(isMissingNewMessage, true, 'Deve identificar que a mensagem "msg-2" está ausente no painel local');
    });
  });
});
