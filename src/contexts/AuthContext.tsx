import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { fetchUserProfile, signOutUser, safeRefreshSession } from '@/services/auth';
import type { ProfileRow } from '@/types/database';
import { ShieldAlert } from 'lucide-react';

export interface AuthContextValue {
  user: User | null;
  profile: ProfileRow | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  sessionReplacedMessage: string | null;
  dismissSessionReplaced: () => void;
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
  const [sessionReplacedMessage, setSessionReplacedMessage] = useState<string | null>(null);

  const userRef = useRef<User | null>(null);
  userRef.current = user;

  const loadProfile = useCallback(async (userId: string) => {
    try {
      const data = await fetchUserProfile(userId);
      setProfile(data);
    } catch {
      setProfile(null);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (userRef.current) {
      await loadProfile(userRef.current.id);
    }
  }, [loadProfile]);

  const dismissSessionReplaced = useCallback(() => {
    setSessionReplacedMessage(null);
  }, []);

  useEffect(() => {
    let isMounted = true;

    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    let lastLoadedUserId: string | null = null;
    let sessionToken = sessionStorage.getItem('duoplay_session_id');
    if (!sessionToken) {
      sessionToken = crypto.randomUUID();
      sessionStorage.setItem('duoplay_session_id', sessionToken);
    }

    // Registrar sessão ativa e verificar periodicamente
    const registerAndValidateSession = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.rpc as any)('register_active_session', { p_session_id: sessionToken });
      } catch {}
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!isMounted) return;

      setSession(newSession);
      const currentUser = newSession?.user ?? null;
      setUser(currentUser);

      if (currentUser) {
        if (currentUser.id !== lastLoadedUserId) {
          lastLoadedUserId = currentUser.id;
          await registerAndValidateSession();
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

    // Intervalo de verificação de sessão única (a cada 15 segundos)
    const intervalId = setInterval(async () => {
      if (!isMounted || !userRef.current) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.rpc as any)('validate_session', { p_session_id: sessionToken });
        if (!error && data && data.valid === false && data.reason === 'SESSION_REPLACED') {
          if (isMounted) {
            setSessionReplacedMessage('Sua conta foi acessada em outro dispositivo ou navegador. Esta sessão foi encerrada.');
            await supabase.auth.signOut({ scope: 'local' });
            setUser(null);
            setSession(null);
            setProfile(null);
          }
        }
      } catch {}
    }, 15000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
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
    sessionReplacedMessage,
    dismissSessionReplaced,
    refreshProfile,
    refreshSession,
    signOut,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      {sessionReplacedMessage && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-red-500/50 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-red-500/20 border border-red-500/40 text-red-400 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-black text-white">Sessão Encerrada</h3>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {sessionReplacedMessage}
              </p>
            </div>
            <button
              type="button"
              onClick={dismissSessionReplaced}
              className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg transition-all active:scale-95"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um <AuthProvider>');
  }
  return context;
}

