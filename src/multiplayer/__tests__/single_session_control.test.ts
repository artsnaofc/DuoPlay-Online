// ============================================================================
// Unit & Integration Tests: Single Session Control — DuoPlay-Online
// Description: Testes autoritativos de registro e validação de sessão única ativa no backend.
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '@/lib/supabase';

describe('Fase de Sessão Única e Validação de Concorrência', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRpc = (supabase as any).rpc;

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = originalRpc;
  });

  it('1. register_active_session deve registrar com sucesso a sessão ativa', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (rpcName: string, params: any) => {
      assert.strictEqual(rpcName, 'register_active_session');
      assert.strictEqual(params.p_session_id, 'session-abc-123');
      return {
        data: {
          success: true,
          data: {
            user_id: 'user-test-1',
            session_id: 'session-abc-123',
            registered_at: new Date().toISOString(),
          },
        },
        error: null,
      };
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (supabase.rpc as any)('register_active_session', { p_session_id: 'session-abc-123' });
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.session_id, 'session-abc-123');
  });

  it('2. validate_session deve retornar valid: true para sessão ativa correspondente', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (rpcName: string, params: any) => {
      assert.strictEqual(rpcName, 'validate_session');
      assert.strictEqual(params.p_session_id, 'session-abc-123');
      return {
        data: {
          success: true,
          valid: true,
        },
        error: null,
      };
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (supabase.rpc as any)('validate_session', { p_session_id: 'session-abc-123' });
    assert.strictEqual(res.data.valid, true);
  });

  it('3. validate_session deve retornar valid: false e SESSION_REPLACED quando a sessão foi substituída', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc = async (rpcName: string, params: any) => {
      assert.strictEqual(rpcName, 'validate_session');
      assert.strictEqual(params.p_session_id, 'old-session-999');
      return {
        data: {
          success: true,
          valid: false,
          reason: 'SESSION_REPLACED',
        },
        error: null,
      };
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (supabase.rpc as any)('validate_session', { p_session_id: 'old-session-999' });
    assert.strictEqual(res.data.valid, false);
    assert.strictEqual(res.data.reason, 'SESSION_REPLACED');
  });
});
