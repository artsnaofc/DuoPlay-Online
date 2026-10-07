// ============================================================================
// Service: Central Notification System — DuoPlay-Online
// Phase: Fase 16 — Sistema Central de Notificações e Atividade
// Description: Gerenciamento autoritativo de notificações persistentes via RPCs PostgreSQL,
//              com suporte a retry transparente de JWT expirado, cache local e paginação.
// ============================================================================

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { safeRefreshSession, isAuthOrTokenExpiredError } from '@/services/auth';
import type {
  NotificationItem,
  NotificationOperationResult,
} from '@/types/notifications';

export function translateNotificationError(error: unknown): { message: string; code: string } {
  if (!error || typeof error !== 'object') {
    return { message: 'Ocorreu um erro inesperado nas notificações.', code: 'UNKNOWN_ERROR' };
  }

  const errObj = error as { code?: string; message?: string; details?: string };
  const rawMsg = errObj.message || errObj.details || '';
  const lowerMsg = rawMsg.toLowerCase();
  const code = (errObj.code || 'UNKNOWN_ERROR').toUpperCase();

  if (
    lowerMsg.includes('jwt expired') ||
    lowerMsg.includes('token is expired') ||
    lowerMsg.includes('invalid jwt') ||
    lowerMsg.includes('pgrst301') ||
    code === 'PGRST301'
  ) {
    return { message: 'Sua sessão expirou. Entre novamente.', code: 'SESSION_EXPIRED' };
  }

  if (rawMsg.includes('P0001') || lowerMsg.includes('unauthorized') || code === '401') {
    return { message: 'Você precisa estar autenticado para acessar as notificações.', code: 'UNAUTHORIZED' };
  }

  if (lowerMsg.includes('failed to fetch') || lowerMsg.includes('networkerror') || lowerMsg.includes('fetch')) {
    return { message: 'Erro de conexão com o servidor. Verifique sua internet.', code: 'NETWORK_ERROR' };
  }

  return { message: rawMsg || 'Erro ao processar notificações.', code };
}

async function executeNotificationRpc<T>(
  rpcName: string,
  params?: Record<string, unknown>
): Promise<NotificationOperationResult<T>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Supabase não configurado.', code: 'NOT_CONFIGURED' };
  }

  const runCall = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return params ? (supabase.rpc as any)(rpcName, params) : (supabase.rpc as any)(rpcName);
  };

  try {
    const { data, error } = await runCall();

    if (error) {
      if (isAuthOrTokenExpiredError(error)) {
        const refreshResult = await safeRefreshSession();
        if (refreshResult.success) {
          const retryRes = await runCall();
          if (!retryRes.error) {
            const rawData = retryRes.data;
            if (rawData && typeof rawData === 'object' && 'success' in rawData) {
              if (rawData.success) {
                return { success: true, data: rawData.data as T };
              }
              const errParsed = translateNotificationError(rawData.error || rawData);
              return { success: false, error: errParsed.message, code: errParsed.code };
            }
            return { success: true, data: rawData as T };
          }
        }
        return {
          success: false,
          error: 'Sua sessão expirou. Entre novamente.',
          code: 'SESSION_EXPIRED',
        };
      }

      const errParsed = translateNotificationError(error);
      return { success: false, error: errParsed.message, code: errParsed.code };
    }

    const rawData = data;
    if (rawData && typeof rawData === 'object' && 'success' in rawData) {
      if (!rawData.success) {
        const errParsed = translateNotificationError(rawData.error || rawData);
        return { success: false, error: errParsed.message, code: errParsed.code };
      }
      return { success: true, data: rawData.data as T };
    }

    return { success: true, data: rawData as T };
  } catch (err) {
    if (isAuthOrTokenExpiredError(err)) {
      return {
        success: false,
        error: 'Sua sessão expirou. Entre novamente.',
        code: 'SESSION_EXPIRED',
      };
    }
    const errParsed = translateNotificationError(err);
    return { success: false, error: errParsed.message, code: errParsed.code };
  }
}

/**
 * Retorna as notificações do usuário com paginação determinística (created_at DESC, id DESC).
 */
export async function getMyNotifications(
  limit: number = 30,
  beforeCreatedAt?: string | null,
  beforeId?: string | null
): Promise<NotificationOperationResult<NotificationItem[]>> {
  const result = await executeNotificationRpc<NotificationItem[]>('get_my_notifications', {
    p_limit: limit,
    p_before_created_at: beforeCreatedAt || null,
    p_before_id: beforeId || null,
  });

  if (result.success && result.data) {
    const list = Array.isArray(result.data) ? result.data : [];
    return { success: true, data: list };
  }

  return result;
}

/**
 * Retorna a quantidade de notificações não lidas para o usuário atual.
 */
export async function getUnreadNotificationCount(): Promise<NotificationOperationResult<{ unread_count: number }>> {
  return await executeNotificationRpc<{ unread_count: number }>('get_unread_notification_count');
}

/**
 * Marca uma notificação específica como lida.
 */
export async function markNotificationRead(
  notificationId: string
): Promise<NotificationOperationResult<{ notification_id: string; read: boolean }>> {
  return await executeNotificationRpc<{ notification_id: string; read: boolean }>('mark_notification_read', {
    p_notification_id: notificationId,
  });
}

/**
 * Marca todas as notificações pendentes do usuário como lidas.
 */
export async function markAllNotificationsRead(): Promise<NotificationOperationResult<{ updated_count: number }>> {
  return await executeNotificationRpc<{ updated_count: number }>('mark_all_notifications_read');
}
