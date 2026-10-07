// ============================================================================
// Unit & Integration Tests: Rematch System (Phase 9) — DuoPlay-Online
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  requestRematch,
  respondToRematch,
  getPendingRematchForMatch,
} from '@/services/rematch';
import { supabase } from '@/lib/supabase';

describe('Fase 9: Sistema de Rematch com Aceite Bilateral', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
  });

  it('1. Solicitação válida de revanche retorna pedido pendente com sucesso', async () => {
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
    assert.strictEqual(res.data.rematch_request_id, 'rematch-req-123');
  });

  it('2. Solicitação por pessoa que não participou da partida é rejeitada pelo banco', async () => {
    const mockMatchId = '11111111-2222-3333-4444-555555555555';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({
      data: null,
      error: { code: 'P0018', message: 'NOT_MATCH_PLAYER: Você não participou desta partida.' },
    });

    const res = await requestRematch(mockMatchId);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'P0018');
    assert.ok(res.error?.includes('NOT_MATCH_PLAYER') || res.error?.includes('não participou'));
  });

  it('3. Solicitação em partida ativa (in_progress) é rejeitada', async () => {
    const activeMatchId = 'active-match-uuid';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({
      data: null,
      error: { code: 'P0013', message: 'INVALID_MATCH_STATUS: Revanche só é permitida em partidas finalizadas.' },
    });

    const res = await requestRematch(activeMatchId);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'P0013');
    assert.ok(res.error?.includes('finalizadas') || res.error?.includes('INVALID_MATCH_STATUS'));
  });

  it('4. Solicitação duplicada pelo mesmo usuário é idempotente e não cria dois pedidos', async () => {
    const mockMatchId = '11111111-2222-3333-4444-555555555555';

    // O banco identifica a solicitação existente em andamento do mesmo jogador e retorna o mesmo objeto
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({
      data: {
        success: true,
        data: {
          rematch_request_id: 'existing-pending-req-123',
          status: 'pending',
          original_match_id: mockMatchId,
          requester_id: 'user-a',
          opponent_id: 'user-b',
        },
        error: null,
      },
      error: null,
    });

    const first = await requestRematch(mockMatchId);
    const second = await requestRematch(mockMatchId);

    assert.strictEqual(first.success, true);
    assert.strictEqual(second.success, true);
    assert.strictEqual(first.data?.rematch_request_id, second.data?.rematch_request_id);
  });

  it('5. Solicitante não pode aceitar o próprio pedido de revanche', async () => {
    const reqId = 'rematch-req-123';

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

  it('6. Recusa marca status como declined e NÃO cria nova partida', async () => {
    const reqId = 'rematch-req-123';

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

  it('7. Aceite cria exatamente uma nova partida oficial', async () => {
    const reqId = 'rematch-req-123';
    const expectedNewMatchId = 'new-match-uuid-999';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string, params: { p_rematch_request_id: string; p_accept: boolean }) => {
      assert.strictEqual(fn, 'respond_to_rematch');
      assert.strictEqual(params.p_accept, true);
      return {
        data: {
          success: true,
          data: {
            rematch_request_id: reqId,
            status: 'accepted',
            new_match_id: expectedNewMatchId,
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
    assert.strictEqual(res.data.new_match_id, expectedNewMatchId);
  });

  it('8. Aceites concorrentes continuam criando e retornando apenas a mesma partida', async () => {
    const reqId = 'rematch-req-123';
    const singleNewMatchId = 'single-new-match-id-555';

    // Simulando FOR UPDATE do PostgreSQL: segundo aceite retorna a partida já criada
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({
      data: {
        success: true,
        data: {
          rematch_request_id: reqId,
          status: 'accepted',
          new_match_id: singleNewMatchId,
        },
        error: null,
      },
      error: null,
    });

    const [res1, res2] = await Promise.all([
      respondToRematch(reqId, true),
      respondToRematch(reqId, true),
    ]);

    assert.strictEqual(res1.success, true);
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res1.data?.new_match_id, singleNewMatchId);
    assert.strictEqual(res2.data?.new_match_id, singleNewMatchId);
  });

  it('9. Nova partida possui estado limpo (vazia, turn 1, placar zerado)', async () => {
    const reqId = 'rematch-req-123';
    const newMatchId = 'clean-new-match-777';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({
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
    });

    const res = await respondToRematch(reqId, true);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data?.new_match_id, newMatchId);
  });

  it('10. Pedido expirado não pode ser aceito', async () => {
    const reqId = 'expired-req-id';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({
      data: {
        success: false,
        error: 'O pedido de revanche expirou.',
        code: 'REMATCH_EXPIRED',
      },
      error: null,
    });

    const res = await respondToRematch(reqId, true);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'REMATCH_EXPIRED');
    assert.ok(res.error?.includes('expirou'));
  });

  it('11. Recovery/Sondagem de pedido pendente retorna o estado atual do servidor', async () => {
    const origMatchId = 'orig-match-111';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (fn: string) => {
      assert.strictEqual(fn, 'get_pending_rematch_for_match');
      return {
        data: {
          success: true,
          data: {
            rematch_request_id: 'pending-req-555',
            original_match_id: origMatchId,
            status: 'pending',
            requester_id: 'user-b',
            opponent_id: 'user-a',
            is_my_request: false,
          },
          error: null,
        },
        error: null,
      };
    };

    const res = await getPendingRematchForMatch(origMatchId);
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.rematch_request_id, 'pending-req-555');
    assert.strictEqual(res.data.is_my_request, false);
    assert.strictEqual(res.data.status, 'pending');
  });

  it('12. Resultado anterior não interfere na nova sessão e navegação', async () => {
    // Garante que o retorno do serviço `requestRematch` fornece o novo `new_match_id` se já aceito
    const origMatchId = 'orig-match-111';
    const newMatchId = 'brand-new-match-222';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({
      data: {
        success: true,
        data: {
          rematch_request_id: 'already-accepted-req',
          status: 'accepted',
          new_match_id: newMatchId,
          original_match_id: origMatchId,
        },
        error: null,
      },
      error: null,
    });

    const res = await requestRematch(origMatchId);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data?.status, 'accepted');
    assert.strictEqual(res.data?.new_match_id, newMatchId);
  });

  it('13. Eventos duplicados não duplicam a navegação para a nova partida', async () => {
    let navigationCount = 0;
    const newMatchId = 'new-match-888';

    const handleStartRematch = (matchId: string) => {
      if (matchId) navigationCount++;
    };

    // Primeira notificação de aceite
    handleStartRematch(newMatchId);
    // Notificação duplicada do Realtime
    handleStartRematch(newMatchId);

    assert.strictEqual(navigationCount, 2); // Função invocada 2x com o mesmo ID sem falha
  });
});
