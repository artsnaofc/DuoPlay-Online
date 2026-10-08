// ============================================================================
// Component: SnakeArenaView — DuoPlay-Online
// Phase: Fase 22.1 — Motor Multiplayer + Regras
// Description: Renderizador SVG responsivo da arena e grid do Snake.
//              Mantém proporção 1:1 exata sem distorção e sem overflow horizontal.
// ============================================================================

import React from 'react';
import type { SnakeGameState } from './types';

interface SnakeArenaViewProps {
  state: SnakeGameState;
  myUserId: string | null;
}

export const SnakeArenaView: React.FC<SnakeArenaViewProps> = ({ state, myUserId }) => {
  const { gridWidth, gridHeight } = state.config;
  const cellSize = 20; // Unidade lógica SVG
  const width = gridWidth * cellSize;
  const height = gridHeight * cellSize;

  return (
    <div className="w-full flex items-center justify-center p-2">
      <div className="relative w-full max-w-[420px] aspect-square rounded-2xl overflow-hidden border border-slate-700/80 bg-slate-950 shadow-2xl shadow-emerald-950/20">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full block"
          style={{ shapeRendering: 'geometricPrecision' }}
          role="img"
          aria-label="Arena de Snake Competitivo"
        >
          {/* Fundo sutil em grade */}
          <defs>
            <pattern
              id="snakeGridPattern"
              width={cellSize}
              height={cellSize}
              patternUnits="userSpaceOnUse"
            >
              <rect width={cellSize} height={cellSize} fill="none" />
              <path
                d={`M ${cellSize} 0 L 0 0 0 ${cellSize}`}
                fill="none"
                stroke="#1e293b"
                strokeWidth="0.5"
                strokeOpacity="0.4"
              />
            </pattern>
          </defs>

          <rect width={width} height={height} fill="#090d16" />
          <rect width={width} height={height} fill="url(#snakeGridPattern)" />

          {/* Comida (Orbe brilhante) */}
          {state.food && (
            <g transform={`translate(${state.food.x * cellSize}, ${state.food.y * cellSize})`}>
              <circle
                cx={cellSize / 2}
                cy={cellSize / 2}
                r={cellSize * 0.42}
                fill="#ef4444"
                className="animate-pulse"
              />
              <circle
                cx={cellSize / 2}
                cy={cellSize / 2}
                r={cellSize * 0.22}
                fill="#fca5a5"
              />
            </g>
          )}

          {/* Renderização das Cobras */}
          {Object.entries(state.snakes).map(([userId, snake]) => {
            const isMe = userId === myUserId;
            const isAlive = snake.alive;
            const primaryColor = isMe ? '#10b981' : '#f59e0b';
            const headColor = isMe ? '#34d399' : '#fbbf24';

            return (
              <g key={userId} opacity={isAlive ? 1 : 0.45}>
                {/* Segmentos do corpo (de trás para frente) */}
                {snake.body.slice(1).map((seg, idx) => (
                  <rect
                    key={`seg-${idx}-${seg.x}-${seg.y}`}
                    x={seg.x * cellSize + 1.5}
                    y={seg.y * cellSize + 1.5}
                    width={cellSize - 3}
                    height={cellSize - 3}
                    rx={3.5}
                    fill={primaryColor}
                    stroke="#020617"
                    strokeWidth="0.8"
                  />
                ))}

                {/* Cabeça da cobra */}
                {snake.body[0] && (
                  <rect
                    x={snake.body[0].x * cellSize + 1}
                    y={snake.body[0].y * cellSize + 1}
                    width={cellSize - 2}
                    height={cellSize - 2}
                    rx={5}
                    fill={headColor}
                    stroke="#ffffff"
                    strokeWidth="1.2"
                  />
                )}
              </g>
            );
          })}
        </svg>

        {/* Overlay de Countdown inicial */}
        {state.status === 'countdown' && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none animate-fadeIn">
            <span className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-1">
              Arena Pronta
            </span>
            <div className="text-4xl font-extrabold text-white tracking-wider animate-bounce">
              PREPARE-SE
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Use o D-pad ou setas para controlar</p>
          </div>
        )}

        {/* Overlay de Finalizado */}
        {state.status === 'finished' && (
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm flex flex-col items-center justify-center p-4 text-center animate-fadeIn">
            <span className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-1">
              Fim de Jogo
            </span>
            <h3 className="text-2xl font-black text-white">
              {state.isDraw
                ? 'Empate Épico!'
                : state.winnerId === myUserId
                ? 'Vitória!'
                : 'Derrota!'}
            </h3>
            <p className="text-xs text-slate-300 mt-2 max-w-[240px]">
              {state.isDraw
                ? 'Ambas as cobras colidiram simultaneamente.'
                : state.winnerId === myUserId
                ? 'Você sobreviveu e dominou a arena!'
                : 'Sua cobra foi eliminada nesta disputa.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
