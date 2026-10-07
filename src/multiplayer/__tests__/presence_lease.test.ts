// ============================================================================
// Unit & Integration Tests: User Presence Lease & Heartbeat (Phase 14.2)
// Project: DuoPlay-Online
// Description: Testes da sincronização de status online através de lease de presença,
//              heartbeat global, resiliência de autenticação e deduplicação.
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  sendPresenceHeartbeat,
  getLastPresenceHeartbeatTime,
} from '@/services/presence';
import { supabase } from '@/lib/supabase';

describe('Fase 14.2: Sincronização de Status Online com Lease de Presença', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRefreshSession = (supabase.auth as any).refreshSession;

  beforeEach(() => {
    // Reset state before tests
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.auth as any).refreshSession = originalRefreshSession;
  });

  it('1. sendPresenceHeartbeat executa RPC heartbeat_presence com sucesso', async () => {
    let rpcCalled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (rpcName: string) => {
      assert.strictEqual(rpcName, 'heartbeat_presence');
      rpcCalled = true;
      return {
        data: {
          success: true,
          data: {
            user_id: 'user-test-123',
            last_seen_at: new Date().toISOString(),
            ttl_seconds: 25,
          },
        },
        error: null,
      };
    };

    const res = await sendPresenceHeartbeat();
    assert.strictEqual(res.success, true);
    assert.strictEqual(rpcCalled, true);
    assert.ok(getLastPresenceHeartbeatTime() > 0);
  });

  it('2. sendPresenceHeartbeat recupera de erro de JWT expirado renovando a sessão', async () => {
    let refreshAttempted = false;
    let rpcCallCount = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.auth as any).refreshSession = async () => {
      refreshAttempted = true;
      return {
        data: { session: { access_token: 'valid-new-token' } },
        error: null,
      };
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => {
      rpcCallCount++;
      if (rpcCallCount === 1) {
        return {
          data: null,
          error: { message: 'JWT expired: token de autenticação expirou' },
        };
      }
      return {
        data: { success: true },
        error: null,
      };
    };

    const res = await sendPresenceHeartbeat();
    assert.strictEqual(res.success, true);
    assert.strictEqual(refreshAttempted, true);
    assert.strictEqual(rpcCallCount, 2);
  });

  it('3. In-flight promise mutex deduplica chamadas simultâneas de heartbeat', async () => {
    let rpcCallCount = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => {
      rpcCallCount++;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        data: { success: true },
        error: null,
      };
    };

    const [res1, res2, res3] = await Promise.all([
      sendPresenceHeartbeat(),
      sendPresenceHeartbeat(),
      sendPresenceHeartbeat(),
    ]);

    assert.strictEqual(res1.success, true);
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res3.success, true);
    assert.strictEqual(rpcCallCount, 1, 'Deve executar apenas uma única chamada RPC simultânea');
  });

  it('4. Retorna erro estruturado quando o backend reporta falha', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async () => ({
      data: null,
      error: { message: 'UNAUTHORIZED: Usuário não autenticado.' },
    });

    const res = await sendPresenceHeartbeat();
    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes('UNAUTHORIZED'));
  });
});
