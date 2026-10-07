import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import type { ProfileRow, ProfileUpdate } from '@/types/database';

export interface AuthResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// Mutex compartilhado para evitar múltiplas renovações de token concorrentes
let inFlightRefreshPromise: Promise<AuthResult<Session>> | null = null;

/**
 * Identifica se um erro retornado pelo Supabase/PostgREST decorre de token JWT expirado ou falta de autenticação válida.
 */
export function isAuthOrTokenExpiredError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as { message?: string; code?: string; details?: string; hint?: string };
  const msg = (err.message || '').toLowerCase();
  const details = (err.details || '').toLowerCase();
  const code = (err.code || '').toUpperCase();

  // Erros de negócio não são erros de token expirado
  if (
    msg.includes('cannot_friend_self') ||
    msg.includes('user_not_found') ||
    msg.includes('request_not_found') ||
    msg.includes('invalid_request_status') ||
    msg.includes('friendship_exists') ||
    msg.includes('p0040') ||
    msg.includes('p0041') ||
    msg.includes('p0042') ||
    msg.includes('p0044')
  ) {
    return false;
  }

  return (
    msg.includes('jwt expired') ||
    msg.includes('token is expired') ||
    msg.includes('invalid jwt') ||
    msg.includes('pgrst301') ||
    msg.includes('unauthorized') ||
    msg.includes('session_not_found') ||
    msg.includes('p0001') ||
    code === 'PGRST301' ||
    code === '401' ||
    details.includes('jwt') ||
    details.includes('expired')
  );
}

/**
 * Realiza refresh seguro e controlado da sessão do Supabase, compartilhando a promise em voo
 * entre chamadas concorrentes para evitar múltiplos requests de refresh simultâneos.
 */
export async function safeRefreshSession(): Promise<AuthResult<Session>> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: 'Serviço de autenticação temporariamente indisponível.',
    };
  }

  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  inFlightRefreshPromise = (async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();

      if (error) {
        // Se a sessão expirou completamente e não pode ser renovada, limpa o estado local
        const errMsg = error.message || '';
        if (
          errMsg.includes('Invalid Refresh Token') ||
          errMsg.includes('refresh_token_not_found') ||
          errMsg.includes('JWT expired') ||
          errMsg.includes('session_not_found')
        ) {
          try {
            await supabase.auth.signOut({ scope: 'local' });
          } catch {
            // Silencia erro no signOut local
          }
        }

        return {
          success: false,
          error: 'Sua sessão expirou. Entre novamente.',
        };
      }

      if (!data.session) {
        return {
          success: false,
          error: 'Sua sessão expirou. Entre novamente.',
        };
      }

      return {
        success: true,
        data: data.session,
      };
    } catch {
      return {
        success: false,
        error: 'Sua sessão expirou. Entre novamente.',
      };
    } finally {
      inFlightRefreshPromise = null;
    }
  })();

  return inFlightRefreshPromise;
}

export function translateAuthError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'Ocorreu um erro inesperado. Tente novamente.';
  }

  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';

  if (message.includes('Invalid login credentials')) {
    return 'E-mail ou senha incorretos. Verifique suas credenciais.';
  }
  if (message.includes('User already registered') || message.includes('already exists')) {
    return 'Este e-mail já possui uma conta cadastrada. Tente fazer login.';
  }
  if (message.includes('Password should be at least')) {
    return 'A senha deve conter no mínimo 6 caracteres.';
  }
  if (message.includes('Email not confirmed')) {
    return 'Por favor, confirme seu e-mail antes de entrar.';
  }
  if (message.includes('Unable to validate email address') || message.includes('valid email')) {
    return 'Por favor, insira um endereço de e-mail válido.';
  }
  if (message.includes('Rate limit exceeded') || message.includes('too many requests')) {
    return 'Muitas tentativas em sequência. Aguarde alguns instantes e tente novamente.';
  }

  return 'Não foi possível completar a operação. Tente novamente em alguns instantes.';
}

export async function signUpWithEmail(
  email: string,
  password: string,
  username: string,
  displayName: string
): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: 'Serviço de autenticação temporariamente indisponível.',
    };
  }

  try {
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-zA-Z0-9_]/g, '');
    const cleanDisplayName = displayName.trim() || cleanUsername;

    if (cleanUsername.length < 3) {
      return {
        success: false,
        error: 'O nome de usuário deve conter no mínimo 3 caracteres (letras, números ou _).',
      };
    }

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          username: cleanUsername,
          display_name: cleanDisplayName,
        },
      },
    });

    if (error) {
      return { success: false, error: translateAuthError(error) };
    }

    if (!data.user) {
      return { success: false, error: 'Não foi possível concluir o cadastro.' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: translateAuthError(err) };
  }
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: 'Serviço de autenticação temporariamente indisponível.',
    };
  }

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      return { success: false, error: translateAuthError(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: translateAuthError(err) };
  }
}

export async function signOutUser(): Promise<AuthResult> {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      return { success: false, error: translateAuthError(error) };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: translateAuthError(err) };
  }
}

export async function sendPasswordResetEmail(email: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      error: 'Serviço de recuperação temporariamente indisponível.',
    };
  }

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/#reset-password` : undefined,
    });

    if (error) {
      return { success: false, error: translateAuthError(error) };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: translateAuthError(err) };
  }
}

export async function fetchUserProfile(userId: string): Promise<ProfileRow | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

export async function updateUserProfile(
  userId: string,
  updates: ProfileUpdate
): Promise<AuthResult<ProfileRow>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Serviço indisponível.' };
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error || !data) {
      return { success: false, error: 'Não foi possível atualizar o perfil.' };
    }

    return { success: true, data };
  } catch (err) {
    return { success: false, error: translateAuthError(err) };
  }
}
