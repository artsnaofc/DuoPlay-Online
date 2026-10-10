// ============================================================================
// Component: SnakeArenaView — DuoPlay-Online
// Phase: Fase 22.3 — Otimização de Fluidez, Interpolação Visual e Suavização
// Description: Renderizador de alto desempenho da arena e grid do Snake com
//              interpolação visual suave via requestAnimationFrame (60-120fps),
//              respeitando reduced-motion e sem alterar a autoridade das regras.
// ============================================================================

import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { SnakeGameState, SnakeDirection, SnakePlayerState } from './types';
import { interpolateSnake, type InterpolatedSnake } from './snakeInterpolation';

interface SnakeArenaViewProps {
  state: SnakeGameState;
  myUserId: string | null;
  predictedDirection?: SnakeDirection | null;
  displayCount?: number;
}

export const SnakeArenaView: React.FC<SnakeArenaViewProps> = ({
  state,
  myUserId,
  predictedDirection,
  displayCount = 3,
}) => {
  const { gridWidth, gridHeight, tickRateMs = 150 } = state.config;
  const cellSize = 20; // Unidade lógica SVG
  const width = gridWidth * cellSize;
  const height = gridHeight * cellSize;

  // Detecção de preferência por movimento reduzido (acessibilidade)
  const prefersReducedMotion = useMemo(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  }, []);

  // Referências para histórico de estado entre ticks lógicos
  const prevStateRef = useRef<SnakeGameState | null>(null);
  const currentStateRef = useRef<SnakeGameState>(state);
  const lastTickTimeRef = useRef<number>(performance.now());
  const rafIdRef = useRef<number | null>(null);

  // Armazenamento das posições interpoladas para renderização visual contínua
  const [interpolatedSnakes, setInterpolatedSnakes] = useState<Record<string, InterpolatedSnake>>(() => {
    const initial: Record<string, InterpolatedSnake> = {};
    for (const [uid, snake] of Object.entries(state.snakes)) {
      initial[uid] = {
        head: { x: snake.body[0]?.x ?? 0, y: snake.body[0]?.y ?? 0 },
        body: snake.body.map((p) => ({ x: p.x, y: p.y })),
        direction: snake.direction,
      };
    }
    return initial;
  });

  // Atualizar referências quando um novo tick ou estado oficial chega
  useEffect(() => {
    // Se o tick mudou, salva o estado anterior e reseta o tempo base do tick
    if (state.tick !== currentStateRef.current.tick) {
      prevStateRef.current = currentStateRef.current;
      currentStateRef.current = state;
      lastTickTimeRef.current = performance.now();
    } else {
      currentStateRef.current = state;
    }
  }, [state]);

  // Loop contínuo de interpolação visual (60Hz / 120Hz via requestAnimationFrame)
  useEffect(() => {
    if (prefersReducedMotion || state.status !== 'in_game') {
      // Se reduzido ou fora de partida, usa a posição exata da célula lógica diretamente
      const direct: Record<string, InterpolatedSnake> = {};
      for (const [uid, s] of Object.entries(state.snakes)) {
        direct[uid] = {
          head: { x: s.body[0]?.x ?? 0, y: s.body[0]?.y ?? 0 },
          body: s.body.map((p) => ({ x: p.x, y: p.y })),
          direction: s.direction,
        };
      }
      setInterpolatedSnakes(direct);
      return;
    }

    let isRunning = true;

    const renderLoop = (now: number) => {
      if (!isRunning) return;

      const elapsed = now - lastTickTimeRef.current;
      // Progresso suave entre o tick anterior e o atual (0 a 1)
      const progress = Math.min(1, Math.max(0, elapsed / tickRateMs));

      const updatedMap: Record<string, InterpolatedSnake> = {};
      const currentSnakes = currentStateRef.current.snakes;
      const prevSnakes = prevStateRef.current?.snakes ?? null;

      for (const [uid, currentSnake] of Object.entries(currentSnakes)) {
        const prevSnake: SnakePlayerState | null = prevSnakes ? prevSnakes[uid] ?? null : null;
        updatedMap[uid] = interpolateSnake(prevSnake, currentSnake, progress);
      }

      setInterpolatedSnakes(updatedMap);

      rafIdRef.current = requestAnimationFrame(renderLoop);
    };

    rafIdRef.current = requestAnimationFrame(renderLoop);

    return () => {
      isRunning = false;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [state.status, state.snakes, tickRateMs, prefersReducedMotion]);

  return (
    <div className="w-full flex items-center justify-center p-1 sm:p-2 select-none">
      <div className="relative w-full max-w-[540px] aspect-square rounded-2xl overflow-hidden border border-slate-700/80 bg-slate-950 shadow-2xl shadow-emerald-950/20">
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

          {/* Comida (Orbe brilhante pulsante) */}
          {state.food && (
            <g
              transform={`translate(${state.food.x * cellSize}, ${state.food.y * cellSize})`}
            >
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

          {/* Renderização das Cobras com Interpolação Suave */}
          {Object.entries(state.snakes).map(([userId, snake]) => {
            const isMe = userId === myUserId;
            const isAlive = snake.alive;
            const primaryColor = isMe ? '#10b981' : '#f59e0b';
            const headColor = isMe ? '#34d399' : '#fbbf24';
            const effectiveDir = (isMe && predictedDirection) ? predictedDirection : (snake.nextDirection || snake.direction);

            // Obter posições interpoladas ou posições estáticas de fallback
            const interp = interpolatedSnakes[userId];
            const headX = interp?.head ? interp.head.x : (snake.body[0]?.x ?? 0);
            const headY = interp?.head ? interp.head.y : (snake.body[0]?.y ?? 0);
            const bodySegments = interp?.body ? interp.body.slice(1) : snake.body.slice(1);

            return (
              <g key={userId} opacity={isAlive ? 1 : 0.45}>
                {/* Segmentos do corpo interpolados com cantos arredondados contínuos */}
                {bodySegments.map((seg, idx) => (
                  <rect
                    key={`seg-${idx}`}
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

                {/* Cabeça da cobra com posição visual interpolada suave e olhos/indicador */}
                {snake.body[0] && (
                  <g>
                    <rect
                      x={headX * cellSize + 1}
                      y={headY * cellSize + 1}
                      width={cellSize - 2}
                      height={cellSize - 2}
                      rx={5}
                      fill={headColor}
                      stroke="#ffffff"
                      strokeWidth="1.2"
                    />
                    {/* Indicador direcional na cabeça da cobra */}
                    {effectiveDir === 'UP' && (
                      <circle
                        cx={headX * cellSize + cellSize / 2}
                        cy={headY * cellSize + 4}
                        r={2}
                        fill="#0f172a"
                      />
                    )}
                    {effectiveDir === 'DOWN' && (
                      <circle
                        cx={headX * cellSize + cellSize / 2}
                        cy={headY * cellSize + cellSize - 4}
                        r={2}
                        fill="#0f172a"
                      />
                    )}
                    {effectiveDir === 'LEFT' && (
                      <circle
                        cx={headX * cellSize + 4}
                        cy={headY * cellSize + cellSize / 2}
                        r={2}
                        fill="#0f172a"
                      />
                    )}
                    {effectiveDir === 'RIGHT' && (
                      <circle
                        cx={headX * cellSize + cellSize - 4}
                        cy={headY * cellSize + cellSize / 2}
                        r={2}
                        fill="#0f172a"
                      />
                    )}
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Overlay de Countdown inicial com contagem visual */}
        {state.status === 'countdown' && (
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center pointer-events-none animate-fadeIn z-20">
            <span className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-1">
              Arena Pronta
            </span>
            <div className="text-6xl sm:text-7xl font-black text-white tracking-wider animate-bounce my-2">
              {displayCount > 0 ? displayCount : 'JÁ!'}
            </div>
            <div className="text-sm font-extrabold text-amber-300 tracking-wide">
              PREPARE-SE
            </div>
            <p className="text-[11px] text-slate-400 mt-3">Use o D-pad ou setas para controlar</p>
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
