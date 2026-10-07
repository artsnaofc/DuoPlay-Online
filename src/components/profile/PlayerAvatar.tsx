// ============================================================================
// Component: PlayerAvatar — DuoPlay-Online
// Phase: Fase 12 — Perfil do Jogador + Identidade da Plataforma
// Description: Componente de avatar resiliente com fallback por iniciais,
//              gradientes determinísticos para jogadores sem imagem e indicador de status.
// ============================================================================

import React, { useState } from 'react';

export interface PlayerAvatarProps {
  avatarUrl?: string | null;
  displayName?: string | null;
  username?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  statusIndicator?: 'connected' | 'disconnected' | 'none';
  onClick?: () => void;
}

const SIZE_MAP = {
  xs: { container: 'w-6 h-6 text-[10px]', indicator: 'w-2 h-2 -bottom-0.5 -right-0.5' },
  sm: { container: 'w-8 h-8 text-xs', indicator: 'w-2.5 h-2.5 bottom-0 right-0' },
  md: { container: 'w-10 h-10 text-sm', indicator: 'w-3 h-3 bottom-0 right-0' },
  lg: { container: 'w-14 h-14 text-lg', indicator: 'w-3.5 h-3.5 bottom-0.5 right-0.5' },
  xl: { container: 'w-20 h-20 text-2xl', indicator: 'w-4 h-4 bottom-1 right-1' },
};

// Paleta de gradientes elegantes do DuoPlay para avatares sem imagem
const GRADIENT_PALETTES = [
  'from-blue-600 to-indigo-700 text-white',
  'from-purple-600 to-indigo-800 text-white',
  'from-cyan-600 to-blue-700 text-white',
  'from-emerald-600 to-teal-800 text-white',
  'from-violet-600 to-fuchsia-800 text-white',
  'from-amber-600 to-orange-700 text-white',
  'from-rose-600 to-pink-800 text-white',
  'from-slate-700 to-slate-900 text-white',
];

function getDeterministicGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % GRADIENT_PALETTES.length;
  return GRADIENT_PALETTES[index];
}

export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({
  avatarUrl,
  displayName,
  username,
  size = 'md',
  className = '',
  statusIndicator = 'none',
  onClick,
}) => {
  const [imageFailed, setImageFailed] = useState(false);

  const name = displayName || username || 'Jogador';
  const initials = name
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'DP';

  const gradientClass = getDeterministicGradient(name);
  const sizeClasses = SIZE_MAP[size];

  const content = (
    <div
      className={`relative rounded-xl flex items-center justify-center font-extrabold select-none shrink-0 overflow-hidden shadow-sm transition-transform ${
        sizeClasses.container
      } ${className} ${onClick ? 'cursor-pointer hover:scale-105 active:scale-95' : ''}`}
      onClick={onClick}
    >
      {avatarUrl && !imageFailed ? (
        <img
          src={avatarUrl}
          alt={`Avatar de ${name}`}
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          className="w-full h-full object-cover rounded-xl"
        />
      ) : (
        <div
          className={`w-full h-full bg-gradient-to-br ${gradientClass} flex items-center justify-center font-black tracking-tight rounded-xl`}
        >
          {initials}
        </div>
      )}

      {/* Indicador de Conexão Opcional */}
      {statusIndicator === 'connected' && (
        <span
          className={`absolute ${sizeClasses.indicator} rounded-full bg-emerald-500 border-2 border-slate-950 shadow-sm`}
          title="Jogador Conectado"
        />
      )}
      {statusIndicator === 'disconnected' && (
        <span
          className={`absolute ${sizeClasses.indicator} rounded-full bg-red-500 border-2 border-slate-950 animate-pulse shadow-sm`}
          title="Jogador Desconectado"
        />
      )}
    </div>
  );

  return content;
};
