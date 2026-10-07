import React, { useState, useRef, useEffect } from 'react';
import { LogOut, User, Trophy, ChevronDown, History } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export interface UserMenuProps {
  onOpenHistory?: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({ onOpenHistory }) => {
  const { user, profile, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) return null;

  const displayName = profile?.display_name || user.email?.split('@')[0] || 'Jogador';
  const username = profile?.username || user.email?.split('@')[0] || 'player';
  const initials = displayName.substring(0, 2).toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center gap-2.5 p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors text-left focus-visible:outline-2 focus-visible:outline-blue-400"
        aria-expanded={menuOpen}
        aria-haspopup="true"
        aria-label="Menu do Usuário"
      >
        <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
          {initials}
        </div>
        <div className="hidden sm:block text-left">
          <p className="text-xs font-semibold text-white leading-none truncate max-w-[120px]">
            {displayName}
          </p>
          <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate max-w-[120px]">
            @{username}
          </p>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>

      {menuOpen && (
        <div className="absolute right-0 mt-2 w-56 rounded-xl bg-slate-900 border border-slate-800 p-2 shadow-2xl z-50 text-slate-200 animate-fade-in">
          {/* User Info Header */}
          <div className="px-3 py-2 border-b border-slate-800/80 mb-1">
            <p className="text-xs font-bold text-white truncate">{displayName}</p>
            <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
          </div>

          {/* Quick Stats Summary */}
          {profile && (
            <div className="px-3 py-2 bg-slate-950/60 rounded-lg my-1.5 border border-slate-800/60 text-[11px] space-y-1">
              <div className="flex items-center justify-between text-slate-400">
                <span className="flex items-center gap-1">
                  <Trophy className="w-3 h-3 text-amber-400" /> Vitórias
                </span>
                <span className="font-semibold text-white font-mono">{profile.total_wins}</span>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Partidas Disputadas</span>
                <span className="font-semibold text-slate-300 font-mono">{profile.total_matches}</span>
              </div>
            </div>
          )}

          {/* History Action */}
          {onOpenHistory && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOpenHistory();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg transition-colors text-left my-1"
            >
              <History className="w-3.5 h-3.5 text-blue-400" />
              <span>Histórico de Partidas</span>
            </button>
          )}

          {/* Logout Action */}
          <button
            onClick={async () => {
              setMenuOpen(false);
              await signOut();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-950/30 hover:text-red-300 rounded-lg transition-colors text-left mt-1"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sair da Conta</span>
          </button>
        </div>
      )}
    </div>
  );
};
