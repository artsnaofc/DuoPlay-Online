import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { ProfileRow, ProfileUpdate } from '@/types/database';

export interface AuthResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
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
