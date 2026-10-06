import React, { useState } from 'react';
import { Menu, X, Gamepad2, Sparkles, HelpCircle, Dices, LogIn, User } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';
import { UserMenu } from './auth/UserMenu';
import { AuthModal } from './auth/AuthModal';
import { useAuth } from '@/hooks/useAuth';

interface HeaderProps {
  onNavigate?: (sectionId: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ onNavigate }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const { isAuthenticated, isLoading } = useAuth();

  const scrollTo = (id: string) => {
    setMobileMenuOpen(false);
    if (onNavigate) {
      onNavigate(id);
    } else {
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  const handleOpenLogin = () => {
    setAuthMode('login');
    setAuthModalOpen(true);
    setMobileMenuOpen(false);
  };

  const handleOpenRegister = () => {
    setAuthMode('register');
    setAuthModalOpen(true);
    setMobileMenuOpen(false);
  };

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Brand Logo */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => scrollTo('hero')}
                className="flex items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-blue-400 rounded-lg p-1"
                aria-label="DuoPlay-Online Página Inicial"
              >
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 shadow-md shadow-blue-900/30 text-white">
                  <Gamepad2 className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <span className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
                    DuoPlay<span className="text-blue-400">-Online</span>
                  </span>
                  <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Jogos Multiplayer Web
                  </span>
                </div>
              </button>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-6" aria-label="Navegação Principal">
              <button
                onClick={() => scrollTo('games')}
                className="text-xs font-medium text-slate-300 hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 rounded-md py-1 px-2"
              >
                Jogos
              </button>
              <button
                onClick={() => scrollTo('features')}
                className="text-xs font-medium text-slate-300 hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 rounded-md py-1 px-2"
              >
                Diferenciais
              </button>
              <button
                onClick={() => scrollTo('how-it-works')}
                className="text-xs font-medium text-slate-300 hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 rounded-md py-1 px-2"
              >
                Como Funciona
              </button>
            </nav>

            {/* Header Right Actions: PWA Install + Auth */}
            <div className="hidden sm:flex items-center gap-3">
              <PWAInstallButton />

              {!isLoading && (
                <>
                  {isAuthenticated ? (
                    <UserMenu />
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleOpenLogin}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-300 hover:text-white hover:bg-slate-900 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
                      >
                        Entrar
                      </button>
                      <button
                        onClick={handleOpenRegister}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-sm shadow-blue-900/30 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
                      >
                        Criar Conta
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Mobile Header Actions */}
            <div className="flex sm:hidden items-center gap-2">
              <PWAInstallButton />

              {isAuthenticated ? (
                <UserMenu />
              ) : (
                <button
                  onClick={handleOpenLogin}
                  className="p-2 text-slate-300 hover:text-white rounded-lg hover:bg-slate-900"
                  aria-label="Entrar na conta"
                >
                  <LogIn className="w-5 h-5 text-blue-400" />
                </button>
              )}

              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-blue-400"
                aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu de navegação'}
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="sm:hidden border-b border-slate-800 bg-slate-950 px-4 pt-2 pb-4 space-y-2">
            <button
              onClick={() => scrollTo('games')}
              className="flex items-center gap-3 w-full text-left px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900 rounded-lg"
            >
              <Dices className="w-4 h-4 text-blue-400" />
              Jogos
            </button>
            <button
              onClick={() => scrollTo('features')}
              className="flex items-center gap-3 w-full text-left px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900 rounded-lg"
            >
              <Sparkles className="w-4 h-4 text-purple-400" />
              Diferenciais
            </button>
            <button
              onClick={() => scrollTo('how-it-works')}
              className="flex items-center gap-3 w-full text-left px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900 rounded-lg"
            >
              <HelpCircle className="w-4 h-4 text-emerald-400" />
              Como Funciona
            </button>

            {!isAuthenticated && (
              <div className="pt-3 border-t border-slate-800/80 flex flex-col gap-2">
                <button
                  onClick={handleOpenLogin}
                  className="w-full py-2 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 text-slate-200 hover:bg-slate-800"
                >
                  Entrar na Conta
                </button>
                <button
                  onClick={handleOpenRegister}
                  className="w-full py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white"
                >
                  Criar Conta Grátis
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Global Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        initialMode={authMode}
        onClose={() => setAuthModalOpen(false)}
      />
    </>
  );
};
