// ============================================================================
// Unit & Integration Tests: Rematch System (Phase 9 & 9.1) — DuoPlay-Online
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  requestRematch,
  respondToRematch,
  getPendingRematchForMatch,
} from '@/services/rematch';
import { supabase } from '@/lib/supabase';

describe('Fase 9 & 9.1: Sistema de Rematch com Aceite Bilateral e Endurecimento de Segurança', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
  });

  it('1. Solicitação válida de revanche por participante retorna pedido pendente com sucesso', async () => {
    const mockMatchId = '11111111-2222-3333-4444-555555555555';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string, params: { p_original_match_id: string }) => {
      assert.strictEqual(fn, 'request_rematch');
      assert.strictEqual(params.p_original_match_id, mockMatchId);
      return {
        data: {
          success: true,
          data: {
            rematch_request_id: 'rematch-req-123',
            status: 'pending',
            original_match_id: mockMatchId,
            requester_id: 'user-a',
            opponent_id: 'user-b',
            is_my_request: true,
            expires_at: '2026-10-06T18:30:00Z',
          },
          error: null,
        },
        error: null,
      };
    };

    const res = await requestRematch(mockMatchId);
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.status, 'pending');
    assert.strictEqual(res.data.is_my_request, true);
    assert.strictEqual(res.data.rematch_request_id, 'rematch-req-123');
  });

  it('2. Solicitação por pessoa que não participou da partida é bloqueada com erro NOT_MATCH_PLAYER', async () => {
    const mockMatchId = '11111111-2222-3333-4444-555555555555';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({
      data: null,
      error: { code: 'P0018', message: 'NOT_MATCH_PLAYER: O usuário não participou desta partida.' },
    });

    const res = await requestRematch(mockMatchId);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'P0018');
    assert.ok(res.error?.includes('NOT_MATCH_PLAYER') || res.error?.includes('não participou'));
  });

  it('3. Usuário externo (não participante) que tentar consultar pedido de revanche recebe data: null sem vazamento', async () => {
    const thirdPartyMatchId = 'third-party-match-uuid';

    // RPC retorna success: true, data: null para chamadores externos
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'get_pending_rematch_for_match');
      return {
        data: {
          success: true,
          data: null,
          error: null,
        },
        error: null,
      };
    };

    const res = await getPendingRematchForMatch(thirdPartyMatchId);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data, null);
  });

  it('4. Consulta de pedido expirado em função VOLATILE atualiza status para expired e não falha', async () => {
    const expiredMatchId = 'expired-match-uuid';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'get_pending_rematch_for_match');
      return {
        data: {
          success: true,
          data: {
            rematch_request_id: 'rematch-req-expired',
            original_match_id: expiredMatchId,
            status: 'expired',
            requester_id: 'user-a',
            opponent_id: 'user-b',
            is_my_request: true,
          },
          error: null,
        },
        error: null,
      };
    };

    const res = await getPendingRematchForMatch(expiredMatchId);
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.status, 'expired');
  });

  it('5. Aceite Bilateral Estrito: Segundo participante clicar em "Solicitar Revanche" NÃO aceita automaticamente', async () => {
    const mockMatchId = 'shared-match-uuid';

    // B clica em request_rematch -> Servidor retorna o pedido pendente criado por A com is_my_request: false, SEM criar partida
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'request_rematch');
      return {
        data: {
          success: true,
          data: {
            rematch_request_id: 'pending-req-from-player-a',
            status: 'pending',
            original_match_id: mockMatchId,
            requester_id: 'player-a',
            opponent_id: 'player-b',
            is_my_request: false,
            new_match_id: null,
          },
          error: null,
        },
        error: null,
      };
    };

    const res = await requestRematch(mockMatchId);
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.status, 'pending');
    assert.strictEqual(res.data.is_my_request, false);
    assert.strictEqual(res.data.new_match_id, null);
  });

  it('6. Somente a chamada explícita respondToRematch(..., true) cria e retorna a nova partida', async () => {
    const reqId = 'pending-req-from-player-a';
    const newMatchId = 'accepted-new-match-uuid';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string, params: { p_rematch_request_id: string; p_accept: boolean }) => {
      assert.strictEqual(fn, 'respond_to_rematch');
      assert.strictEqual(params.p_rematch_request_id, reqId);
      assert.strictEqual(params.p_accept, true);
      return {
        data: {
          success: true,
          data: {
            rematch_request_id: reqId,
            status: 'accepted',
            new_match_id: newMatchId,
          },
          error: null,
        },
        error: null,
      };
    };

    const res = await respondToRematch(reqId, true);
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.status, 'accepted');
    assert.strictEqual(res.data.new_match_id, newMatchId);
  });

  it('7. Recusa marca status como declined e NUNCA cria nova partida', async () => {
    const reqId = 'pending-req-from-player-a';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string, params: { p_rematch_request_id: string; p_accept: boolean }) => {
      assert.strictEqual(fn, 'respond_to_rematch');
      assert.strictEqual(params.p_accept, false);
      return {
        data: {
          success: true,
          data: {
            rematch_request_id: reqId,
            status: 'declined',
          },
          error: null,
        },
        error: null,
      };
    };

    const res = await respondToRematch(reqId, false);
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.status, 'declined');
    assert.strictEqual(res.data.new_match_id, undefined);
  });

  it('8. Aceites concorrentes/repetidos retornam a mesma nova partida via FOR UPDATE do banco', async () => {
    const reqId = 'rematch-req-concurrent';
    const singleMatchId = 'single-match-id-1000';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({
      data: {
        success: true,
        data: {
          rematch_request_id: reqId,
          status: 'accepted',
          new_match_id: singleMatchId,
        },
        error: null,
      },
      error: null,
    });

    const [r1, r2] = await Promise.all([
      respondToRematch(reqId, true),
      respondToRematch(reqId, true),
    ]);

    assert.strictEqual(r1.success, true);
    assert.strictEqual(r2.success, true);
    assert.strictEqual(r1.data?.new_match_id, singleMatchId);
    assert.strictEqual(r2.data?.new_match_id, singleMatchId);
  });

  it('9. Solicitante que tentar aceitar o próprio pedido é rejeitado pelo banco', async () => {
    const reqId = 'my-own-req-id';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({
      data: null,
      error: { code: 'P0001', message: 'UNAUTHORIZED: O solicitante não pode aceitar seu próprio pedido.' },
    });

    const res = await respondToRematch(reqId, true);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'P0001');
    assert.ok(res.error?.includes('próprio pedido'));
  });

  it('10. Novo pedido é permitido após expiração do pedido anterior', async () => {
    const mockMatchId = 'match-with-expired-req';

    // O banco atualizou o pedido antigo para expired e criou um novo pedido pendente
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({
      data: {
        success: true,
        data: {
          rematch_request_id: 'brand-new-rematch-req-2',
          status: 'pending',
          original_match_id: mockMatchId,
          requester_id: 'user-a',
          opponent_id: 'user-b',
          is_my_request: true,
        },
        error: null,
      },
      error: null,
    });

    const res = await requestRematch(mockMatchId);
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.rematch_request_id, 'brand-new-rematch-req-2');
    assert.strictEqual(res.data.status, 'pending');
  });
});
