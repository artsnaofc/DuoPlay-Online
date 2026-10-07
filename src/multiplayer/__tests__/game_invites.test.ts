// ============================================================================
// Unit & Integration Tests: Game Invites (Phase 14.2) — DuoPlay-Online
// Description: Testes unitários e de integração do sistema de convites diretos entre amigos,
//              convites pela sala de espera, expiração, atomicidade, concorrência e sessão.
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGameInvite,
  acceptGameInvite,
  declineGameInvite,
  cancelGameInvite,
  getPendingReceivedInvites,
  getRoomInvites,
  translateInviteError,
  clearInvitesCache,
} from '@/services/invites';
import { supabase } from '@/lib/supabase';
import type { GameInvite, RoomInviteInfo } from '@/types/invites';

describe('Fase 14.2: Convites de Partida entre Amigos + Sala de Espera', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRefreshSession = (supabase.auth as any).refreshSession;

  beforeEach(() => {
    clearInvitesCache();
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.auth as any).refreshSession = originalRefreshSession;
    clearInvitesCache();
  });

  // --------------------------------------------------------------------------
  // 1. Criação e Validação de Convites
  // --------------------------------------------------------------------------
  describe('Criação de Convites de Partida', () => {
    it('1. createGameInvite envia convite direto com sucesso', async () => {
      const mockInvite = {
        id: 'inv-123',
        sender_id: 'usr-a',
        receiver_id: 'usr-b',
        room_id: 'room-1',
        game_id: 'tic_tac_toe',
        status: 'pending',
        expires_at: new Date(Date.now() + 120000).toISOString(),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, params: any) => {
        assert.strictEqual(rpcName, 'create_game_invite');
        assert.strictEqual(params.p_receiver_id, 'usr-b');
        assert.strictEqual(params.p_room_id, 'room-1');
        return {
          data: {
            success: true,
            data: { invite: mockInvite },
            error: null,
          },
          error: null,
        };
      };

      const result = await createGameInvite('usr-b', 'room-1');
      assert.strictEqual(result.success, true);
      assert.ok(result.data?.invite);
    });

    it('2. createGameInvite impede auto-convite (CANNOT_INVITE_SELF)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => ({
        data: null,
        error: { message: 'P0050: CANNOT_INVITE_SELF: Não é permitido convidar a si mesmo.' },
      });

      const result = await createGameInvite('usr-a', 'room-1');
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.code, 'CANNOT_INVITE_SELF');
      assert.strictEqual(result.error, 'Você não pode convidar a si mesmo para uma partida.');
    });

    it('3. createGameInvite exige amizade ativa (USER_NOT_FRIEND)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => ({
        data: null,
        error: { message: 'P0051: USER_NOT_FRIEND: Você só pode convidar jogadores da sua lista de amigos.' },
      });

      const result = await createGameInvite('usr-stranger', 'room-1');
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.code, 'USER_NOT_FRIEND');
      assert.strictEqual(result.error, 'Você só pode convidar jogadores da sua lista de amigos.');
    });

    it('4. createGameInvite impede convites duplicados para a mesma sala (INVITE_ALREADY_SENT)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => ({
        data: null,
        error: { message: 'P0055: INVITE_ALREADY_SENT: Já existe um convite pendente.' },
      });

      const result = await createGameInvite('usr-b', 'room-1');
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.code, 'INVITE_ALREADY_SENT');
      assert.strictEqual(result.error, 'Já existe um convite pendente para este amigo nesta sala.');
    });

    it('5. createGameInvite valida se chamador é membro da sala (NOT_ROOM_HOST)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => ({
        data: null,
        error: { message: 'P0053: NOT_ROOM_HOST: Apenas membros da sala podem enviar convites.' },
      });

      const result = await createGameInvite('usr-b', 'room-1');
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.code, 'NOT_ROOM_HOST');
      assert.strictEqual(result.error, 'Apenas membros da sala podem enviar convites.');
    });
  });

  // --------------------------------------------------------------------------
  // 2. Aceite, Recusa e Cancelamento de Convites
  // --------------------------------------------------------------------------
  describe('Aceite, Recusa e Cancelamento Atômico', () => {
    it('6. acceptGameInvite aloca o convidado na sala e atualiza status para accepted', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, params: any) => {
        assert.strictEqual(rpcName, 'accept_game_invite');
        assert.strictEqual(params.p_invite_id, 'inv-123');
        return {
          data: {
            success: true,
            data: {
              invite: { id: 'inv-123', status: 'accepted' },
              room: { id: 'room-1', code: 'DUO123', status: 'waiting' },
              member: { id: 'mem-2', role: 'player', slot_number: 2 },
            },
            error: null,
          },
          error: null,
        };
      };

      const result = await acceptGameInvite('inv-123');
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.room.code, 'DUO123');
    });

    it('7. acceptGameInvite rejeita convite expirado (INVITE_EXPIRED)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => ({
        data: null,
        error: { message: 'P0057: INVITE_EXPIRED: Este convite de partida expirou.' },
      });

      const result = await acceptGameInvite('inv-old');
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.code, 'INVITE_EXPIRED');
      assert.strictEqual(result.error, 'Este convite de partida expirou.');
    });

    it('8. acceptGameInvite rejeita quando sala está cheia (ROOM_FULL)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => ({
        data: null,
        error: { message: 'P0054: ROOM_FULL: A sala atingiu a capacidade máxima de jogadores.' },
      });

      const result = await acceptGameInvite('inv-full');
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.code, 'ROOM_FULL');
      assert.strictEqual(result.error, 'Esta sala já atingiu a capacidade máxima de jogadores.');
    });

    it('8a. acceptGameInvite rejeita quando não é o destinatário (UNAUTHORIZED)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => ({
        data: null,
        error: { message: 'P0001: UNAUTHORIZED: Você não é o destinatário deste convite.' },
      });

      const result = await acceptGameInvite('inv-other-user');
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.code, 'SESSION_EXPIRED');
      assert.strictEqual(result.error, 'Sua sessão expirou. Entre novamente.');
    });

    it('8b. acceptGameInvite trata idempotência e usuário já membro sem campo is_connected', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => ({
        data: {
          success: true,
          data: {
            invite: { id: 'inv-123', status: 'accepted' },
            room: { id: 'room-1', code: 'DUO123', status: 'waiting' },
            member: { id: 'mem-2', role: 'player', slot_number: 2, is_ready: false },
            idempotent: true,
          },
          error: null,
        },
        error: null,
      });

      const result = await acceptGameInvite('inv-123');
      assert.strictEqual(result.success, true);
      assert.ok(result.data?.member);
      // Garantir que a estrutura do membro segue a especificação sem is_connected
      assert.strictEqual('is_connected' in (result.data?.member as Record<string, unknown>), false);
    });

    it('9. declineGameInvite recusa convite com sucesso', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, params: any) => {
        assert.strictEqual(rpcName, 'decline_game_invite');
        assert.strictEqual(params.p_invite_id, 'inv-123');
        return {
          data: {
            success: true,
            data: { invite_id: 'inv-123', status: 'declined' },
            error: null,
          },
          error: null,
        };
      };

      const result = await declineGameInvite('inv-123');
      assert.strictEqual(result.success, true);
    });

    it('10. cancelGameInvite cancela convite pelo remetente', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, params: any) => {
        assert.strictEqual(rpcName, 'cancel_game_invite');
        assert.strictEqual(params.p_invite_id, 'inv-123');
        return {
          data: {
            success: true,
            data: { invite_id: 'inv-123', status: 'cancelled' },
            error: null,
          },
          error: null,
        };
      };

      const result = await cancelGameInvite('inv-123');
      assert.strictEqual(result.success, true);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Listagens de Convites Recebidos e da Sala (Waiting Room)
  // --------------------------------------------------------------------------
  describe('Listagem e Consulta de Convites', () => {
    it('11. getPendingReceivedInvites retorna convites recebidos com dados do remetente e sala', async () => {
      const mockInvites: GameInvite[] = [
        {
          invite_id: 'inv-1',
          sender_id: 'usr-a',
          receiver_id: 'usr-b',
          room_id: 'room-1',
          game_id: 'tic_tac_toe',
          status: 'pending',
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 100000).toISOString(),
          sender_username: 'amigo_a',
          sender_display_name: 'Amigo A',
          sender_avatar_url: null,
          room_code: 'XYZ123',
          game_title: 'Jogo da Velha',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string) => {
        assert.strictEqual(rpcName, 'get_pending_received_invites');
        return {
          data: {
            success: true,
            data: mockInvites,
            error: null,
          },
          error: null,
        };
      };

      const result = await getPendingReceivedInvites(true);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.length, 1);
      assert.strictEqual(result.data?.[0].sender_username, 'amigo_a');
      assert.strictEqual(result.data?.[0].room_code, 'XYZ123');
    });

    it('12. getRoomInvites retorna histórico de convites emitidos para a sala de espera', async () => {
      const mockRoomInvites: RoomInviteInfo[] = [
        {
          invite_id: 'inv-1',
          receiver_id: 'usr-b',
          status: 'pending',
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 100000).toISOString(),
          receiver_username: 'amigo_b',
          receiver_display_name: 'Amigo B',
          receiver_avatar_url: null,
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (rpcName: string, params: any) => {
        assert.strictEqual(rpcName, 'get_room_invites');
        assert.strictEqual(params.p_room_id, 'room-1');
        return {
          data: {
            success: true,
            data: mockRoomInvites,
            error: null,
          },
          error: null,
        };
      };

      const result = await getRoomInvites('room-1', true);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.length, 1);
      assert.strictEqual(result.data?.[0].receiver_display_name, 'Amigo B');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Resiliência de Sessão, JWT e Tradução Estrita de Erros
  // --------------------------------------------------------------------------
  describe('Tratamento Seguro de Sessão / JWT no Fluxo de Convites', () => {
    it('13. translateInviteError nunca expõe "JWT expired" ou termos internos de PostgreSQL', () => {
      const err1 = translateInviteError({ message: 'JWT expired', code: 'PGRST301' });
      assert.strictEqual(err1.code, 'SESSION_EXPIRED');
      assert.strictEqual(err1.message, 'Sua sessão expirou. Entre novamente.');
      assert.ok(!err1.message.includes('JWT'));

      const err2 = translateInviteError({ message: 'P0057: INVITE_EXPIRED: Este convite de partida expirou.' });
      assert.strictEqual(err2.code, 'INVITE_EXPIRED');
      assert.strictEqual(err2.message, 'Este convite de partida expirou.');
    });

    it('14. executeInviteRpc executa refresh transparente e retry em caso de JWT expirado', async () => {
      let rpcAttempt = 0;
      let refreshCalled = false;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.auth as any).refreshSession = async () => {
        refreshCalled = true;
        return {
          data: {
            session: { access_token: 'fresh_jwt_token', user: { id: 'usr-123' } },
            user: { id: 'usr-123' },
          },
          error: null,
        };
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => {
        rpcAttempt++;
        if (rpcAttempt === 1) {
          return {
            data: null,
            error: { message: 'JWT expired', code: 'PGRST301' },
          };
        }
        return {
          data: {
            success: true,
            data: { invite: { id: 'inv-retried', status: 'pending' } },
            error: null,
          },
          error: null,
        };
      };

      const result = await createGameInvite('usr-b', 'room-1');
      assert.strictEqual(rpcAttempt, 2);
      assert.strictEqual(refreshCalled, true);
      assert.strictEqual(result.success, true);
    });

    it('15. executeInviteRpc falha graciosamente se o refresh do token falhar', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.auth as any).refreshSession = async () => ({
        data: { session: null, user: null },
        error: { message: 'Invalid Refresh Token' },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => ({
        data: null,
        error: { message: 'JWT expired', code: 'PGRST301' },
      });

      const result = await acceptGameInvite('inv-123');
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.code, 'SESSION_EXPIRED');
      assert.strictEqual(result.error, 'Sua sessão expirou. Entre novamente.');
    });
  });
});
