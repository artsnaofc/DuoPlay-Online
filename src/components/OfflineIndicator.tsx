import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 sm:right-auto sm:max-w-md z-50 flex items-center gap-3 rounded-lg bg-amber-600/95 backdrop-blur-xs border border-amber-500 px-4 py-2.5 text-xs font-medium text-white shadow-xl animate-fade-in"
    >
      <WifiOff className="w-4 h-4 shrink-0 text-amber-200" aria-hidden="true" />
      <div>
        <p className="font-semibold text-white">Modo Offline Detectado</p>
        <p className="text-amber-100 text-[11px]">Você está sem conexão com a internet. O aplicativo continuará em modo de leitura local.</p>
      </div>
    </div>
  );
};
