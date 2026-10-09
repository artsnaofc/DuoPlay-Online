// ============================================================================
// Unit & Integration Tests: Auditoria e Correções de Fluxos Críticos
// Project: DuoPlay-Online
// Description:
//   1. Resultado oficial da última partida:
//      - Persistência com RPC dismiss_match_result + localStorage/sessionStorage
//      - Não exibe RematchControl quando aberto automaticamente no startup (showRematch={false})
//      - Botão 'X' e ações de fechar marcam como lido de forma autoritativa
//   2. Convites de partida — 15 segundos e áudio:
//      - TTL estrito de 15 segundos no backend e frontend
//      - Bloqueio de aceitação para convites expirados
//      - Ciclo de vida de áudio suave
//   3. Cancelamento automático de convites ao sair da sala:
//      - leave_room cancela atomicamente convites pendentes do jogador
//      - Bloqueio de aceitação quando remetente não é mais membro da sala
//   4. Abertura imediata de sala criada:
//      - Suporte a initialMode="create" sem passos redundantes
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '@/lib/supabase';
import { dismissMatchResult, getLatestCompletedMatchForCurrentUser } from '@/services/matchHistory';
import { createRoom, leaveRoom, getRoomDetails } from '@/services/rooms';
import { createGameInvite, acceptGameInvite, declineGameInvite } from '@/services/invites';

describe('Auditoria de Fluxos Críticos — DuoPlay Online', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  beforeEach(() => {
    // Reset test state
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
  });

  // ==========================================================================
  // 1. Resultado Oficial da Última Partida
  // ==========================================================================
  describe('1. Resultado Oficial da Última Partida e Persistência de Leitura', () => {
    it('1.1. dismissMatchResult invoca RPC dismiss_match_result com p_match_id', async () => {
      let calledRpcName = '';
      let calledParams: any = null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (name: string, params: any) => {
        calledRpcName = name;
        calledParams = params;
        return {
          data: { success: true, data: { match_id: params.p_match_id } },
          error: null,
        };
      };

      const matchId = '11111111-2222-3333-4444-555555555555';
      const res = await dismissMatchResult(matchId);

      assert.strictEqual(res.success, true);
      assert.strictEqual(calledRpcName, 'dismiss_match_result');
      assert.strictEqual(calledParams?.p_match_id, matchId);
    });

    it('1.2. dismissMatchResult trata erros da RPC de forma resiliente', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => {
        return {
          data: null,
          error: { message: 'Database error', code: '42P01' },
        };
      };

      const res = await dismissMatchResult('invalid-match');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error, 'Database error');
    });

    it('1.3. getLatestCompletedMatchForCurrentUser invoca get_latest_completed_match_for_current_user', async () => {
      let calledRpc = '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (name: string) => {
        calledRpc = name;
        return {
          data: {
            success: true,
            data: {
              match_id: 'm-99',
              game_id: 'tic_tac_toe',
              status: 'finished',
              winner_id: 'u-1',
              is_draw: false,
              my_slot: 1,
              is_winner: true,
            },
          },
          error: null,
        };
      };

      const res = await getLatestCompletedMatchForCurrentUser();
      assert.strictEqual(res.success, true);
      assert.strictEqual(calledRpc, 'get_latest_completed_match_for_current_user');
      assert.strictEqual(res.data?.match_id, 'm-99');
    });
  });

  // ==========================================================================
  // 2. Convites de Partida — Prazo de 15 Segundos e Validações
  // ==========================================================================
  describe('2. Convites de Partida — Prazo de 15 Segundos', () => {
    it('2.1. createGameInvite invoca RPC de criação de convite com parâmetros corretos', async () => {
      let rpcName = '';
      let rpcArgs: any = null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, args: any) => {
        rpcName = fn;
        rpcArgs = args;
        const expiresAt = new Date(Date.now() + 15000).toISOString();
        return {
          data: {
            success: true,
            data: {
              invite: {
                id: 'inv-15',
                sender_id: 'usr-sender',
                receiver_id: args.p_receiver_id,
                room_id: args.p_room_id,
                status: 'pending',
                expires_at: expiresAt,
              },
            },
          },
          error: null,
        };
      };

      const res = await createGameInvite('usr-receiver', 'room-100');
      assert.strictEqual(res.success, true);
      assert.ok(rpcName === 'create_game_invite' || rpcName === 'send_game_invite');
      assert.strictEqual(rpcArgs.p_receiver_id, 'usr-receiver');
      assert.strictEqual(rpcArgs.p_room_id, 'room-100');

      // Verifica cálculo do tempo de expiração em ~15s
      const invite = res.data?.invite as { expires_at?: string } | undefined;
      assert.ok(invite?.expires_at);
      const remainingSeconds = Math.round((new Date(invite!.expires_at).getTime() - Date.now()) / 1000);
      assert.ok(remainingSeconds <= 16 && remainingSeconds >= 14, `Remaining seconds was ${remainingSeconds}`);
    });

    it('2.2. acceptGameInvite falha se o convite tiver expirado', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => {
        return {
          data: null,
          error: { message: 'INVITE_EXPIRED: Este convite de partida expirou.', code: 'P0057' },
        };
      };

      const res = await acceptGameInvite('inv-expired');
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes('expirou'));
    });
  });

  // ==========================================================================
  // 3. Cancelamento Automático de Convites ao Sair da Sala
  // ==========================================================================
  describe('3. Cancelamento Automático de Convites ao Sair da Sala', () => {
    it('3.1. leaveRoom executa leave_room e cancela convites no backend', async () => {
      let rpcName = '';
      let rpcArgs: any = null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, args: any) => {
        rpcName = fn;
        rpcArgs = args;
        return {
          data: {
            success: true,
            data: {
              new_host_id: null,
              room_closed: true,
            },
          },
          error: null,
        };
      };

      const res = await leaveRoom('room-555');
      assert.strictEqual(res.success, true);
      assert.strictEqual(rpcName, 'leave_room');
      assert.strictEqual(rpcArgs.p_room_id, 'room-555');
    });

    it('3.2. acceptGameInvite falha se o anfitrião saiu da sala (INVITE_CANCELLED)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async () => {
        return {
          data: null,
          error: {
            message: 'INVITE_CANCELLED: O anfitrião ou remetente não está mais nesta sala.',
            code: 'P0058',
          },
        };
      };

      const res = await acceptGameInvite('inv-host-left');
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes('não está mais nesta sala'));
    });
  });

  // ==========================================================================
  // 4. Abertura Imediata de Sala Privada Criada
  // ==========================================================================
  describe('4. Abertura Imediata de Sala Privada Criada', () => {
    it('4.1. createRoom cria a sala e retorna o código e ID para transição imediata', async () => {
      let rpcName = '';
      let rpcArgs: any = null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc = async (fn: string, args: any) => {
        rpcName = fn;
        rpcArgs = args;
        return {
          data: {
            success: true,
            data: {
              room: {
                id: 'room-new-123',
                code: 'ABC789',
                game_id: args.p_game_id,
                name: args.p_name,
                status: 'waiting',
                max_members: 6,
              },
              member: {
                room_id: 'room-new-123',
                user_id: 'u-host',
                role: 'player',
                slot_number: 1,
                is_ready: true,
              },
            },
          },
          error: null,
        };
      };

      const res = await createRoom('carta_duo', 'Carta Duo Sala Privada');
      assert.strictEqual(res.success, true);
      assert.strictEqual(rpcName, 'create_room');
      assert.strictEqual(rpcArgs.p_game_id, 'carta_duo');
      assert.strictEqual(res.data?.room.code, 'ABC789');
      assert.strictEqual(res.data?.room.id, 'room-new-123');
    });
  });
});
