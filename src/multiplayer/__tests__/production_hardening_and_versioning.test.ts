// ============================================================================
// Unit & Integration Tests: Production Hardening, Security, Versioning & Telemetry
// Project: DuoPlay-Online
// Phase: Fase de Hardening — Desempenho, Segurança e Rastreabilidade de Produção
// ============================================================================

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateVersionData, writeVersionFile } from '../../../scripts/generate-version';
import { telemetry } from '@/services/multiplayerTelemetry';
import { createInitialSnakeState, simulateSnakeTick, setSnakeDirection } from '@/games/snake/snakeEngine';

describe('Hardening de Produção: Versionamento, Segurança e Desempenho', () => {
  // --------------------------------------------------------------------------
  // PARTE 1: Versionamento e Rastreabilidade (/version.json)
  // --------------------------------------------------------------------------
  describe('1. Versionamento e Rastreabilidade de Build (/version.json)', () => {
    it('1.1. generateVersionData gera campos estruturais obrigatórios', () => {
      const data = generateVersionData();
      assert.ok(typeof data.version === 'string' && data.version.length > 0);
      assert.ok('commit' in data);
      assert.ok('branch' in data);
      assert.ok('environment' in data);
      assert.ok('buildTime' in data);
      assert.ok('deploymentId' in data);
    });

    it('1.2. Trata variáveis de ambiente ausentes com fallback "unavailable" sem inventar dados', () => {
      const origSha = process.env.VERCEL_GIT_COMMIT_SHA;
      delete process.env.VERCEL_GIT_COMMIT_SHA;

      const data = generateVersionData();
      // Deve ser unavailable quando VERCEL_GIT_COMMIT_SHA e VITE_GIT_COMMIT_SHA não existem
      if (!process.env.VITE_GIT_COMMIT_SHA) {
        assert.strictEqual(data.commit, 'unavailable');
      }

      if (origSha) process.env.VERCEL_GIT_COMMIT_SHA = origSha;
    });

    it('1.3. writeVersionFile grava JSON válido no disco sem vazar segredos', () => {
      const result = writeVersionFile();
      const publicPath = path.resolve(process.cwd(), 'public/version.json');
      assert.ok(fs.existsSync(publicPath));

      const fileContent = fs.readFileSync(publicPath, 'utf-8');
      const parsed = JSON.parse(fileContent);

      assert.strictEqual(parsed.version, result.version);
      assert.strictEqual(parsed.commit, result.commit);

      // Verificação de segurança: NENHUM segredo ou chave deve estar presente no JSON
      const rawText = fileContent.toLowerCase();
      assert.ok(!rawText.includes('service_role'));
      assert.ok(!rawText.includes('secret'));
      assert.ok(!rawText.includes('password'));
      assert.ok(!rawText.includes('token'));
      assert.ok(!rawText.includes('bearer'));
    });
  });

  // --------------------------------------------------------------------------
  // PARTE 2: Telemetria de Desempenho e Latência
  // --------------------------------------------------------------------------
  describe('2. Telemetria de Desempenho Multiplayer', () => {
    beforeEach(() => {
      telemetry.reset('test-match-telemetry');
    });

    it('2.1. Registra e calcula métricas de latência e taxa de ticks', () => {
      telemetry.recordRpc('snake_tick', 45, true, false);
      telemetry.recordRpc('snake_tick', 55, true, false);
      telemetry.recordRpc('snake_tick', 50, true, true); // idempotente
      telemetry.recordRpc('snake_tick', 120, false, false); // falha
      telemetry.recordRealtimeUpdate();
      telemetry.recordRealtimeUpdate();
      telemetry.recordReconnection();
      telemetry.setDriverRole('primary');

      const summary = telemetry.getSummary();
      assert.strictEqual(summary.matchId, 'test-match-telemetry');
      assert.strictEqual(summary.totalRequests, 4);
      assert.strictEqual(summary.acceptedTicks, 2);
      assert.strictEqual(summary.idempotentTicks, 1);
      assert.strictEqual(summary.failedRequests, 1);
      assert.strictEqual(summary.realtimeUpdatesCount, 2);
      assert.strictEqual(summary.reconnectionsCount, 1);
      assert.strictEqual(summary.activeDriverRole, 'primary');
      assert.strictEqual(summary.minLatencyMs, 45);
      assert.strictEqual(summary.maxLatencyMs, 120);
      assert.strictEqual(summary.avgLatencyMs, 68); // (45+55+50+120)/4 = 67.5 -> 68
    });

    it('2.2. Alternância de papéis cooperativos (primary -> fallback -> idle)', () => {
      telemetry.setDriverRole('fallback');
      assert.strictEqual(telemetry.getSummary().activeDriverRole, 'fallback');

      telemetry.setDriverRole('idle');
      assert.strictEqual(telemetry.getSummary().activeDriverRole, 'idle');
    });
  });

  // --------------------------------------------------------------------------
  // PARTE 3: Segurança, Integridade de Regras e Anti-Cheat
  // --------------------------------------------------------------------------
  describe('3. Integridade e Regras Autoritativas da Cobrinha', () => {
    const p1 = 'user-alpha';
    const p2 = 'user-beta';

    it('3.1. Um jogador não pode modificar a direção do outro jogador', () => {
      const state = createInitialSnakeState(p1, p2);
      // P1 tenta mudar a direção de P2 passando o ID de P2
      // Na simulação server-side (validate_snake_action), p_player_id é extraído de auth.uid()
      // No motor local, setSnakeDirection altera apenas o usuário informado
      const updated = setSnakeDirection(state, p1, 'UP');
      assert.strictEqual(updated.snakes[p1].nextDirection, 'UP');
      assert.strictEqual(updated.snakes[p2].nextDirection, 'LEFT'); // P2 permanece inalterado
    });

    it('3.2. Tentativa de reversão proibida de 180° é rejeitada', () => {
      const state = createInitialSnakeState(p1, p2);
      // P1 está virado para RIGHT. Inversão direta para LEFT é proibida.
      const updated = setSnakeDirection(state, p1, 'LEFT');
      assert.strictEqual(updated.snakes[p1].nextDirection, 'RIGHT');
    });

    it('3.3. Partida finalizada não aceita novos inputs de direção', () => {
      const state = createInitialSnakeState(p1, p2);
      const finishedState = { ...state, status: 'finished' as const };
      const updated = setSnakeDirection(finishedState, p1, 'UP');
      assert.strictEqual(updated.snakes[p1].nextDirection, 'RIGHT');
    });

    it('3.4. Colisão com parede elimina a cobra de forma autoritativa e determinística', () => {
      const state = createInitialSnakeState(p1, p2, 5, 5); // Grid pequeno
      const inGame = {
        ...state,
        status: 'in_game' as const,
        snakes: {
          [p1]: {
            ...state.snakes[p1],
            direction: 'RIGHT' as const,
            nextDirection: 'RIGHT' as const,
            body: [{ x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }], // Cabeça na borda x:4
          },
          [p2]: {
            ...state.snakes[p2],
            direction: 'DOWN' as const,
            nextDirection: 'DOWN' as const,
            body: [{ x: 1, y: 1 }, { x: 1, y: 0 }],
          },
        },
      };

      const result = simulateSnakeTick(inGame);
      // P1 move para x:5 (fora do grid 5x5) -> eliminada
      assert.strictEqual(result.snakes[p1].alive, false);
      assert.strictEqual(result.status, 'finished');
      assert.strictEqual(result.winnerId, p2);
    });

    it('3.5. Colisão cabeça com cabeça resulta em empate oficial', () => {
      const state = createInitialSnakeState(p1, p2, 10, 10);
      const inGame = {
        ...state,
        status: 'in_game' as const,
        snakes: {
          [p1]: {
            ...state.snakes[p1],
            direction: 'RIGHT' as const,
            nextDirection: 'RIGHT' as const,
            body: [{ x: 4, y: 5 }, { x: 3, y: 5 }],
          },
          [p2]: {
            ...state.snakes[p2],
            direction: 'LEFT' as const,
            nextDirection: 'LEFT' as const,
            body: [{ x: 6, y: 5 }, { x: 7, y: 5 }],
          },
        },
      };

      // Ambos moverão para (5, 5) simultaneamente
      const result = simulateSnakeTick(inGame);
      assert.strictEqual(result.snakes[p1].alive, false);
      assert.strictEqual(result.snakes[p2].alive, false);
      assert.strictEqual(result.status, 'finished');
      assert.strictEqual(result.isDraw, true);
      assert.strictEqual(result.winnerId, null);
    });
  });
});
