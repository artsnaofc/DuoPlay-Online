import React, { useState } from 'react';
import { Menu, X, Gamepad2, Layers, Compass } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

interface HeaderProps {
  onNavigate?: (sectionId: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ onNavigate }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo / Platform Brand */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => scrollTo('hero')}
              className="flex items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-blue-400 rounded-lg p-1"
              aria-label="DuoPlay-Online Página Inicial"
            >
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-linear-to-br from-blue-600 to-indigo-700 shadow-md shadow-blue-900/30 text-white">
                <Gamepad2 className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <span className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
                  DuoPlay<span className="text-blue-400">-Online</span>
                </span>
                <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                  Multiplayer Web Platform
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
              Jogos Planejados
            </button>
            <button
              onClick={() => scrollTo('architecture')}
              className="text-xs font-medium text-slate-300 hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 rounded-md py-1 px-2"
            >
              Arquitetura
            </button>
            <button
              onClick={() => scrollTo('roadmap')}
              className="text-xs font-medium text-slate-300 hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 rounded-md py-1 px-2"
            >
              Roteiro de Fases
            </button>
          </nav>

          {/* Header Action: PWA Install Button & Phase Indicator */}
          <div className="hidden sm:flex items-center gap-3">
            <span className="text-xs font-mono text-slate-400 border border-slate-800 bg-slate-900/60 px-2.5 py-1 rounded-md">
              Fase 1 · Fundação
            </span>
            <PWAInstallButton />
          </div>

          {/* Mobile Menu Button */}
          <div className="flex sm:hidden items-center gap-2">
            <PWAInstallButton />
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
            <Gamepad2 className="w-4 h-4 text-blue-400" />
            Jogos Planejados
          </button>
          <button
            onClick={() => scrollTo('architecture')}
            className="flex items-center gap-3 w-full text-left px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900 rounded-lg"
          >
            <Layers className="w-4 h-4 text-purple-400" />
            Arquitetura
          </button>
          <button
            onClick={() => scrollTo('roadmap')}
            className="flex items-center gap-3 w-full text-left px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900 rounded-lg"
          >
            <Compass className="w-4 h-4 text-emerald-400" />
            Roteiro de Fases
          </button>
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400 px-3">
            <span>DuoPlay-Online v1.0</span>
            <span className="font-mono text-blue-400">FASE 1</span>
          </div>
        </div>
      )}
    </header>
  );
};
