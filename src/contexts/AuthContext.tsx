import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { fetchUserProfile, signOutUser, safeRefreshSession } from '@/services/auth';
import type { ProfileRow } from '@/types/database';

export interface AuthContextValue {
  user: User | null;
  profile: ProfileRow | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  refreshProfile: () => Promise<void>;
  refreshSession: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadProfile = useCallback(async (userId: string) => {
    try {
      const data = await fetchUserProfile(userId);
      setProfile(data);
    } catch {
      setProfile(null);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) {
      await loadProfile(user.id);
    }
  }, [user, loadProfile]);

  useEffect(() => {
    let isMounted = true;

    // Se Supabase não estiver configurado com credenciais válidas, encerra o loading graciosamente
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    let lastLoadedUserId: string | null = null;

    // Escutar mudanças de autenticação (no Supabase v2, dispara automaticamente o evento INITIAL_SESSION)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!isMounted) return;

      setSession(newSession);
      const currentUser = newSession?.user ?? null;
      setUser(currentUser);

      if (currentUser) {
        // Evita chamadas redundantes se o mesmo usuário já teve seu perfil carregado
        if (currentUser.id !== lastLoadedUserId) {
          lastLoadedUserId = currentUser.id;
          await loadProfile(currentUser.id);
        }
      } else {
        lastLoadedUserId = null;
        setProfile(null);
      }

      if (isMounted) {
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refreshSession = useCallback(async () => {
    await safeRefreshSession();
  }, []);

  const signOut = useCallback(async () => {
    await signOutUser();
    setUser(null);
    setSession(null);
    setProfile(null);
  }, []);

  const value: AuthContextValue = {
    user,
    profile,
    session,
    isLoading,
    isAuthenticated: Boolean(user),
    refreshProfile,
    refreshSession,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um <AuthProvider>');
  }
  return context;
}
