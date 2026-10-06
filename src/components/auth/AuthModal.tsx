import React, { useState } from 'react';
import { X, LogIn, UserPlus, KeyRound, Mail, Lock, User, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { signInWithEmail, signUpWithEmail, sendPasswordResetEmail } from '@/services/auth';
import { isSupabaseConfigured } from '@/lib/supabase';

export type AuthMode = 'login' | 'register' | 'forgot-password';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: AuthMode;
  onClose: () => void;
  onSuccess?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  initialMode = 'login',
  onClose,
  onSuccess,
}) => {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setUsername('');
    setDisplayName('');
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleSwitchMode = (newMode: AuthMode) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setMode(newMode);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!email || (mode !== 'forgot-password' && !password)) {
      setErrorMsg('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    setLoading(true);

    try {
      if (mode === 'login') {
        const result = await signInWithEmail(email, password);
        if (!result.success) {
          setErrorMsg(result.error || 'Erro ao entrar.');
        } else {
          resetForm();
          onSuccess?.();
          onClose();
        }
      } else if (mode === 'register') {
        if (!username.trim() || username.trim().length < 3) {
          setErrorMsg('O nome de usuário deve conter pelo menos 3 caracteres.');
          setLoading(false);
          return;
        }

        const result = await signUpWithEmail(
          email,
          password,
          username,
          displayName || username
        );

        if (!result.success) {
          setErrorMsg(result.error || 'Erro ao cadastrar.');
        } else {
          setSuccessMsg('Conta criada com sucesso! Verifique seu e-mail se a confirmação estiver ativada ou faça login agora.');
          setTimeout(() => {
            setMode('login');
          }, 2000);
        }
      } else if (mode === 'forgot-password') {
        const result = await sendPasswordResetEmail(email);
        if (!result.success) {
          setErrorMsg(result.error || 'Erro ao solicitar recuperação.');
        } else {
          setSuccessMsg('Enviamos instruções de recuperação para o seu e-mail.');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 sm:p-8 shadow-2xl text-slate-100 animate-fade-in">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="mb-6">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 mb-3">
            {mode === 'login' && <LogIn className="w-5 h-5" />}
            {mode === 'register' && <UserPlus className="w-5 h-5" />}
            {mode === 'forgot-password' && <KeyRound className="w-5 h-5" />}
          </div>

          <h2 id="auth-modal-title" className="text-xl font-bold text-white tracking-tight">
            {mode === 'login' && 'Entrar na sua Conta'}
            {mode === 'register' && 'Criar Conta no DuoPlay'}
            {mode === 'forgot-password' && 'Recuperar Senha'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {mode === 'login' && 'Acesse seu perfil de jogador para competir e salvar seu histórico.'}
            {mode === 'register' && 'Junte-se à plataforma e desafie seus amigos em tempo real.'}
            {mode === 'forgot-password' && 'Informe seu e-mail cadastrado para receber o link de redefinição.'}
          </p>
        </div>

        {/* Configuration Notice if env vars are missing */}
        {!isSupabaseConfigured && (
          <div className="mb-4 p-3 rounded-lg bg-amber-950/40 border border-amber-800/60 text-amber-200 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Credenciais Supabase Pendentes</p>
              <p className="text-amber-300/90 text-[11px] mt-0.5">
                Configure <code className="font-mono bg-amber-900/40 px-1 py-0.5 rounded">VITE_SUPABASE_URL</code> e <code className="font-mono bg-amber-900/40 px-1 py-0.5 rounded">VITE_SUPABASE_PUBLISHABLE_KEY</code> no arquivo de ambiente para conectar o backend ativo.
              </p>
            </div>
          </div>
        )}

        {/* Feedback Messages */}
        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-red-950/40 border border-red-800/80 text-red-200 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/80 text-emerald-200 text-xs flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5" htmlFor="auth-username">
                  Nome de Usuário (Username) *
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-username"
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="ex: marujo_gamer"
                    maxLength={30}
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Letras, números e underscores (mín. 3 caracteres).</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5" htmlFor="auth-display-name">
                  Nome de Exibição
                </label>
                <input
                  id="auth-display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Nome público no lobby"
                  maxLength={50}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5" htmlFor="auth-email">
              E-mail *
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu.email@exemplo.com"
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {mode !== 'forgot-password' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-300" htmlFor="auth-password">
                  Senha *
                </label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => handleSwitchMode('forgot-password')}
                    className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    Esqueceu a senha?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-md shadow-blue-900/30 transition-colors flex items-center justify-center gap-2 mt-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processando...</span>
              </>
            ) : (
              <span>
                {mode === 'login' && 'Entrar na Plataforma'}
                {mode === 'register' && 'Concluir Cadastro'}
                {mode === 'forgot-password' && 'Enviar E-mail de Recuperação'}
              </span>
            )}
          </button>
        </form>

        {/* Footer Switchers */}
        <div className="mt-6 pt-4 border-t border-slate-800 text-center text-xs text-slate-400">
          {mode === 'login' && (
            <p>
              Não tem uma conta?{' '}
              <button
                type="button"
                onClick={() => handleSwitchMode('register')}
                className="font-semibold text-blue-400 hover:text-blue-300 transition-colors"
              >
                Cadastre-se grátis
              </button>
            </p>
          )}

          {mode === 'register' && (
            <p>
              Já tem uma conta?{' '}
              <button
                type="button"
                onClick={() => handleSwitchMode('login')}
                className="font-semibold text-blue-400 hover:text-blue-300 transition-colors"
              >
                Fazer login
              </button>
            </p>
          )}

          {mode === 'forgot-password' && (
            <p>
              Lembrou sua senha?{' '}
              <button
                type="button"
                onClick={() => handleSwitchMode('login')}
                className="font-semibold text-blue-400 hover:text-blue-300 transition-colors"
              >
                Voltar para o login
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
