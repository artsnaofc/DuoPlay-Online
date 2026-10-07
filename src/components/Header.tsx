// ============================================================================
// Component: Header — DuoPlay-Online
// Phase: Fase 10.4 — Redesign de Navegação de Plataforma de Jogos
// Description: Top Bar Contract de 3 zonas com suporte a navegação por jogos,
//              atalho para partidas, histórico e perfil de usuário.
// ============================================================================

import React, { useState } from 'react';
import { Menu, X, Gamepad2, LogIn, Swords, History, Users, MessageSquare, Trophy } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';
import { UserMenu } from './auth/UserMenu';
import { AuthModal } from './auth/AuthModal';
import { NotificationCenter } from './notifications/NotificationCenter';
import { useAuth } from '@/hooks/useAuth';
import { useSocial } from '@/hooks/useSocial';
import type { NotificationItem } from '@/types/notifications';

export interface HeaderProps {
  onNavigate?: (sectionId: string) => void;
  onOpenMatchmaking?: () => void;
  onOpenHistory?: () => void;
  onOpenProfile?: () => void;
  onOpenFriends?: () => void;
  onOpenChat?: () => void;
  onOpenLeaderboard?: () => void;
  unreadChatCount?: number;
  hasActiveMatch?: boolean;
  onResumeActiveMatch?: () => void;
  activeWaitingRoomCode?: string | null;
  onOpenActiveWaitingRoom?: () => void;
  notifications?: NotificationItem[];
  unreadNotificationCount?: number;
  isNotificationsLoading?: boolean;
  hasMoreNotifications?: boolean;
  notificationsError?: string | null;
  onRefreshNotifications?: () => void;
  onFetchNextNotificationsPage?: () => void;
  onMarkNotificationAsRead?: (id: string) => void;
  onMarkAllNotificationsAsRead?: () => void;
  onSelectNotification?: (notification: NotificationItem) => void;
}

export const Header: React.FC<HeaderProps> = ({
  onNavigate,
  onOpenMatchmaking,
  onOpenHistory,
  onOpenProfile,
  onOpenFriends,
  onOpenChat,
  onOpenLeaderboard,
  unreadChatCount = 0,
  hasActiveMatch,
  onResumeActiveMatch,
  activeWaitingRoomCode,
  onOpenActiveWaitingRoom,
  notifications = [],
  unreadNotificationCount = 0,
  isNotificationsLoading = false,
  hasMoreNotifications = false,
  notificationsError = null,
  onRefreshNotifications = () => {},
  onFetchNextNotificationsPage = () => {},
  onMarkNotificationAsRead = () => {},
  onMarkAllNotificationsAsRead = () => {},
  onSelectNotification,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const { isAuthenticated, isLoading } = useAuth();
  const { pendingCount } = useSocial();

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
            {/* Zone 1: Brand Wordmark */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => scrollTo('hero')}
                className="flex items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-blue-400 rounded-lg p-1 group"
                aria-label="DuoPlay-Online Página Inicial"
              >
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 shadow-md shadow-blue-900/40 text-white group-hover:scale-105 transition-transform">
                  <Gamepad2 className="w-5 h-5" aria-hidden="true" />
                </div>
                <span className="text-base font-extrabold tracking-tight text-white flex items-center gap-0.5">
                  DuoPlay<span className="text-blue-400">-Online</span>
                </span>
              </button>
            </div>

            {/* Zone 2: Navigation Links */}
            <nav className="hidden md:flex items-center gap-1" aria-label="Navegação Principal">
              <button
                type="button"
                onClick={() => scrollTo('games')}
                className="px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-900 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 whitespace-nowrap"
              >
                Jogos
              </button>

              {hasActiveMatch && onResumeActiveMatch ? (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onResumeActiveMatch();
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-amber-300 hover:text-amber-200 bg-amber-950/40 border border-amber-800/60 rounded-lg transition-colors flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-amber-400 whitespace-nowrap animate-pulse"
                >
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span>Partida Ativa</span>
                </button>
              ) : activeWaitingRoomCode && onOpenActiveWaitingRoom ? (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenActiveWaitingRoom();
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-emerald-300 hover:text-emerald-200 bg-emerald-950/50 border border-emerald-700/60 rounded-lg transition-colors flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-emerald-400 whitespace-nowrap shadow-sm shadow-emerald-900/30"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span>Sala de Espera (#{activeWaitingRoomCode})</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenMatchmaking?.();
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-900 rounded-lg transition-colors flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-blue-400 whitespace-nowrap"
                >
                  <Swords className="w-3.5 h-3.5 text-blue-400" />
                  <span>Encontrar Partida</span>
                </button>
              )}

              {isAuthenticated && onOpenFriends && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenFriends();
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-900 rounded-lg transition-colors flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-blue-400 whitespace-nowrap relative"
                >
                  <Users className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Amigos</span>
                  {pendingCount > 0 && (
                    <span className="w-2 h-2 rounded-full bg-red-500 ring-2 ring-slate-950 animate-pulse" />
                  )}
                </button>
              )}

              {isAuthenticated && onOpenChat && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenChat();
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-900 rounded-lg transition-colors flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-blue-400 whitespace-nowrap relative"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-violet-400" />
                  <span>Mensagens</span>
                  {unreadChatCount > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-violet-600 text-[10px] font-bold text-white animate-pulse">
                      {unreadChatCount}
                    </span>
                  )}
                </button>
              )}

              {onOpenLeaderboard && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenLeaderboard();
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-amber-300 hover:text-amber-200 hover:bg-amber-950/30 rounded-lg transition-colors flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-amber-400 whitespace-nowrap"
                >
                  <Trophy className="w-3.5 h-3.5 text-amber-400" />
                  <span>Ranking</span>
                </button>
              )}

              {isAuthenticated && onOpenHistory && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenHistory();
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-900 rounded-lg transition-colors flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-blue-400 whitespace-nowrap"
                >
                  <History className="w-3.5 h-3.5 text-slate-400" />
                  <span>Histórico</span>
                </button>
              )}
            </nav>

            {/* Zone 3: Header Right Actions (PWA Install + Auth + Notifications) */}
            <div className="hidden sm:flex items-center gap-3">
              <PWAInstallButton />

              {!isLoading && (
                <>
                  {isAuthenticated && (
                    <NotificationCenter
                      notifications={notifications}
                      unreadCount={unreadNotificationCount}
                      isLoading={isNotificationsLoading}
                      hasMore={hasMoreNotifications}
                      error={notificationsError}
                      onRefresh={onRefreshNotifications}
                      onFetchNextPage={onFetchNextNotificationsPage}
                      onMarkAsRead={onMarkNotificationAsRead}
                      onMarkAllAsRead={onMarkAllNotificationsAsRead}
                      onSelectNotification={onSelectNotification}
                    />
                  )}

                  {isAuthenticated ? (
                    <UserMenu
                      onOpenHistory={onOpenHistory}
                      onOpenProfile={onOpenProfile}
                      onOpenFriends={onOpenFriends}
                      pendingRequestsCount={pendingCount}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleOpenLogin}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-300 hover:text-white hover:bg-slate-900 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
                      >
                        Entrar
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenRegister}
                        className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-900/30 transition-all focus-visible:outline-2 focus-visible:outline-blue-400 active:scale-95"
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

              {isAuthenticated && (
                <NotificationCenter
                  notifications={notifications}
                  unreadCount={unreadNotificationCount}
                  isLoading={isNotificationsLoading}
                  hasMore={hasMoreNotifications}
                  error={notificationsError}
                  onRefresh={onRefreshNotifications}
                  onFetchNextPage={onFetchNextNotificationsPage}
                  onMarkAsRead={onMarkNotificationAsRead}
                  onMarkAllAsRead={onMarkAllNotificationsAsRead}
                  onSelectNotification={onSelectNotification}
                />
              )}

              {isAuthenticated ? (
                <UserMenu
                  onOpenHistory={onOpenHistory}
                  onOpenProfile={onOpenProfile}
                  onOpenFriends={onOpenFriends}
                  pendingRequestsCount={pendingCount}
                />
              ) : (
                <button
                  type="button"
                  onClick={handleOpenLogin}
                  className="p-2 text-slate-300 hover:text-white rounded-lg hover:bg-slate-900"
                  aria-label="Entrar na conta"
                >
                  <LogIn className="w-5 h-5 text-blue-400" />
                </button>
              )}

              <button
                type="button"
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
              type="button"
              onClick={() => scrollTo('games')}
              className="w-full text-left py-2 px-3 text-xs font-medium text-slate-300 hover:text-white rounded-lg hover:bg-slate-900"
            >
              Jogos
            </button>

            {hasActiveMatch && onResumeActiveMatch ? (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onResumeActiveMatch();
                }}
                className="w-full text-left py-2 px-3 text-xs font-bold text-amber-300 bg-amber-950/40 rounded-lg flex items-center gap-2"
              >
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span>Continuar Partida Ativa</span>
              </button>
            ) : activeWaitingRoomCode && onOpenActiveWaitingRoom ? (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenActiveWaitingRoom();
                }}
                className="w-full text-left py-2 px-3 text-xs font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-700/50 rounded-lg flex items-center gap-2"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span>Sala de Espera Ativa (#{activeWaitingRoomCode})</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenMatchmaking?.();
                }}
                className="w-full text-left py-2 px-3 text-xs font-semibold text-slate-200 rounded-lg flex items-center gap-2 hover:bg-slate-900"
              >
                <Swords className="w-4 h-4 text-blue-400" />
                <span>Encontrar Partida</span>
              </button>
            )}

            {isAuthenticated && onOpenFriends && (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenFriends();
                }}
                className="w-full text-left py-2 px-3 text-xs font-medium text-slate-300 hover:text-white rounded-lg hover:bg-slate-900 flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-indigo-400" />
                  <span>Amigos & Jogadores</span>
                </div>
                {pendingCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-red-600 text-[10px] font-bold text-white">
                    {pendingCount}
                  </span>
                )}
              </button>
            )}

            {isAuthenticated && onOpenChat && (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenChat();
                }}
                className="w-full text-left py-2 px-3 text-xs font-medium text-slate-300 hover:text-white rounded-lg hover:bg-slate-900 flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-violet-400" />
                  <span>Mensagens</span>
                </div>
                {unreadChatCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-violet-600 text-[10px] font-bold text-white">
                    {unreadChatCount}
                  </span>
                )}
              </button>
            )}

            {onOpenLeaderboard && (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenLeaderboard();
                }}
                className="w-full text-left py-2 px-3 text-xs font-semibold text-amber-300 rounded-lg flex items-center gap-2 hover:bg-slate-900"
              >
                <Trophy className="w-4 h-4 text-amber-400" />
                <span>Classificação & Ranking</span>
              </button>
            )}

            {isAuthenticated && onOpenHistory && (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenHistory();
                }}
                className="w-full text-left py-2 px-3 text-xs font-medium text-slate-300 hover:text-white rounded-lg hover:bg-slate-900 flex items-center gap-2"
              >
                <History className="w-4 h-4 text-slate-400" />
                <span>Histórico de Partidas</span>
              </button>
            )}

            {!isAuthenticated && (
              <div className="pt-2 border-t border-slate-800 flex gap-2">
                <button
                  type="button"
                  onClick={handleOpenLogin}
                  className="flex-1 py-2 text-center text-xs font-semibold text-slate-200 bg-slate-900 rounded-lg border border-slate-800"
                >
                  Entrar
                </button>
                <button
                  type="button"
                  onClick={handleOpenRegister}
                  className="flex-1 py-2 text-center text-xs font-bold text-white bg-blue-600 rounded-lg"
                >
                  Criar Conta
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        initialMode={authMode}
        onClose={() => setAuthModalOpen(false)}
      />
    </>
  );
};
