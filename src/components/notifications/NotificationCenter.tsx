// ============================================================================
// Component: NotificationCenter — DuoPlay-Online
// Phase: Fase 16 — Sistema Central de Notificações e Atividade
// Description: Central de notificações com ícone no Header, badge com unread count (99+),
//              popover responsivo (mobile e desktop), e ações contextuais por tipo.
// ============================================================================

import React, { useState, useRef, useEffect } from 'react';
import {
  Bell,
  CheckCheck,
  UserPlus,
  UserCheck,
  Gamepad2,
  MessageSquare,
  RotateCcw,
  Trophy,
  Swords,
  X,
  RotateCw,
  AlertCircle,
  Inbox,
} from 'lucide-react';
import type { NotificationItem, NotificationType } from '@/types/notifications';

export interface NotificationCenterProps {
  notifications: NotificationItem[];
  unreadCount: number;
  isLoading: boolean;
  hasMore: boolean;
  error: string | null;
  onRefresh: () => void;
  onFetchNextPage: () => void;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onSelectNotification?: (notification: NotificationItem) => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  notifications,
  unreadCount,
  isLoading,
  hasMore,
  error,
  onRefresh,
  onFetchNextPage,
  onMarkAsRead,
  onMarkAllAsRead,
  onSelectNotification,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Formatação amigável de tempo relativo
  const formatRelativeTime = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffSecs = Math.floor(diffMs / 1000);
      const diffMins = Math.floor(diffSecs / 60);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffSecs < 60) return 'agora';
      if (diffMins < 60) return `${diffMins}m`;
      if (diffHours < 24) return `${diffHours}h`;
      if (diffDays === 1) return 'ontem';
      return `${diffDays}d`;
    } catch {
      return '';
    }
  };

  // Ícone por tipo de notificação
  const renderNotificationIcon = (type: NotificationType) => {
    switch (type) {
      case 'friend_request_received':
        return <UserPlus className="w-4 h-4 text-indigo-400" />;
      case 'friend_request_accepted':
        return <UserCheck className="w-4 h-4 text-emerald-400" />;
      case 'game_invite_received':
      case 'game_invite_accepted':
      case 'game_invite_declined':
      case 'game_invite_expired':
        return <Gamepad2 className="w-4 h-4 text-blue-400" />;
      case 'new_message':
        return <MessageSquare className="w-4 h-4 text-violet-400" />;
      case 'rematch_received':
      case 'rematch_accepted':
      case 'rematch_declined':
      case 'rematch_expired':
        return <RotateCcw className="w-4 h-4 text-amber-400" />;
      case 'match_started':
        return <Swords className="w-4 h-4 text-cyan-400" />;
      case 'match_finished':
        return <Trophy className="w-4 h-4 text-amber-300" />;
      default:
        return <Bell className="w-4 h-4 text-slate-400" />;
    }
  };

  // Fechar ao clicar fora no desktop
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleNotificationClick = (item: NotificationItem) => {
    if (!item.read_at) {
      onMarkAsRead(item.id);
    }
    setIsOpen(false);
    if (onSelectNotification) {
      onSelectNotification(item);
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      {/* Botão do Sino com Badge */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        aria-label="Central de Notificações"
        aria-expanded={isOpen}
      >
        <Bell className="w-5 h-5 text-slate-300" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 px-1.5 py-0.5 min-w-[18px] text-[10px] font-black leading-none text-white bg-red-600 rounded-full ring-2 ring-slate-950 flex items-center justify-center animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Popover / Panel Dropdown */}
      {isOpen && (
        <div className="fixed sm:absolute right-2 sm:right-0 top-16 sm:top-12 z-50 w-[calc(100vw-1rem)] sm:w-96 max-h-[80vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden animate-in fade-in duration-150">
          {/* Header da Central */}
          <div className="flex items-center justify-between p-3.5 sm:p-4 border-b border-slate-800 bg-slate-950/60">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-bold text-white">Notificações</h3>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-600/30 text-blue-300 border border-blue-500/30">
                  {unreadCount} não lida{unreadCount > 1 ? 's' : ''}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllAsRead}
                  className="px-2 py-1 text-[11px] font-semibold text-blue-400 hover:text-blue-300 hover:bg-slate-800/80 rounded-lg transition-colors flex items-center gap-1"
                  title="Marcar todas como lidas"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Lidas</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                aria-label="Fechar Notificações"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Lista de Notificações */}
          <div className="grow overflow-y-auto divide-y divide-slate-800/60 max-h-[60vh]">
            {error && (
              <div className="p-6 text-center space-y-3">
                <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
                <p className="text-xs text-slate-300">{error}</p>
                <button
                  type="button"
                  onClick={onRefresh}
                  className="px-3 py-1.5 text-xs font-bold bg-slate-800 hover:bg-slate-750 text-white rounded-lg transition-colors inline-flex items-center gap-1.5"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Tentar Novamente</span>
                </button>
              </div>
            )}

            {!error && notifications.length === 0 && !isLoading && (
              <div className="p-8 text-center space-y-2">
                <Inbox className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="text-xs font-semibold text-slate-300">Você não tem notificações.</p>
                <p className="text-[11px] text-slate-500">Convites, solicitações e partidas aparecerão aqui.</p>
              </div>
            )}

            {notifications.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNotificationClick(item)}
                className={`w-full text-left p-3.5 sm:p-4 flex items-start gap-3 transition-colors hover:bg-slate-800/60 ${
                  !item.read_at ? 'bg-blue-950/20' : 'bg-transparent'
                }`}
              >
                {/* Ícone ou Avatar */}
                <div className="shrink-0 pt-0.5">
                  {item.actor_avatar_url ? (
                    <img
                      src={item.actor_avatar_url}
                      alt=""
                      className="w-8 h-8 rounded-lg object-cover border border-slate-700"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
                      {renderNotificationIcon(item.type)}
                    </div>
                  )}
                </div>

                {/* Conteúdo */}
                <div className="grow min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-xs font-bold text-white truncate">{item.title}</span>
                    <span className="text-[10px] text-slate-500 shrink-0">
                      {formatRelativeTime(item.created_at)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">{item.body}</p>
                </div>

                {/* Indicador não lida */}
                {!item.read_at && (
                  <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5 shadow-sm shadow-blue-500/50" />
                )}
              </button>
            ))}

            {isLoading && (
              <div className="p-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                <RotateCw className="w-4 h-4 animate-spin text-blue-400" />
                <span>Carregando notificações...</span>
              </div>
            )}

            {hasMore && !isLoading && notifications.length > 0 && (
              <div className="p-3 text-center border-t border-slate-800/80 bg-slate-950/30">
                <button
                  type="button"
                  onClick={onFetchNextPage}
                  className="px-3 py-1.5 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Carregar mais notificações
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
