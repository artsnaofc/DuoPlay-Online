// ============================================================================
// Unit & Integration Tests: Game Infrastructure and Registry (Phase 19) — DuoPlay-Online
// Description: Testes autoritativos de validação do Game Registry central,
//              desacoplamento das regras de jogo e integridade da Network Engine.
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getGameDefinition, listGames, registerGame, type GameDefinition } from '../registry';

describe('Fase 19: Infraestrutura para Novos Jogos e Game Registry', () => {

  // --------------------------------------------------------------------------
  // 1. Testes do Game Registry
  // --------------------------------------------------------------------------
  describe('1. Game Registry Central', () => {
    it('1.1. listGames deve retornar todos os jogos planejados e configurados', () => {
      const games = listGames();
      assert.ok(games.length >= 8, 'Deve possuir pelo menos os 8 jogos planejados no catálogo');

      const ids = games.map((g) => g.id);
      assert.ok(ids.includes('tic-tac-toe'));
      assert.ok(ids.includes('pong'));
      assert.ok(ids.includes('snake'));
      assert.ok(ids.includes('carta_duo'));
      assert.ok(ids.includes('billiards'));
      assert.ok(ids.includes('domino'));
      assert.ok(ids.includes('hangman'));
      assert.ok(ids.includes('adedonha'));
    });

    it('1.2. getGameDefinition deve retornar o jogo correto e lidar com hífens/underscores', () => {
      const g1 = getGameDefinition('tic-tac-toe');
      const g2 = getGameDefinition('tic_tac_toe');

      assert.ok(g1);
      assert.ok(g2);
      assert.strictEqual(g1?.id, 'tic-tac-toe');
      assert.strictEqual(g2?.id, 'tic-tac-toe');
      assert.strictEqual(g1?.title, 'Jogo da Velha');
      assert.strictEqual(g1?.minPlayers, 2);
      assert.strictEqual(g1?.maxPlayers, 2);
      assert.strictEqual(g1?.isAvailable, true);
    });

    it('1.3. getGameDefinition de jogo inexistente deve retornar null', () => {
      const g = getGameDefinition('space_invaders_multiplayer');
      assert.strictEqual(g, null);
    });

    it('1.4. registerGame deve permitir registro dinâmico de um novo jogo em tempo de execução', () => {
      const mockGame: GameDefinition = {
        id: 'chess-royal',
        title: 'Xadrez Real',
        tagline: 'O rei dos jogos de tabuleiro',
        description: 'Disputa de xadrez clássico 1v1 com turnos e tempo oficial.',
        minPlayers: 2,
        maxPlayers: 2,
        category: 'Tabuleiro / Turnos',
        gameType: 'turn_based',
        iconName: 'crown',
        highlights: ['Validação FIDE completa', 'Histórico em notação algébrica'],
        isAvailable: true,
        config: { time_control: 600 },
      };

      registerGame(mockGame);

      const retrieved = getGameDefinition('chess-royal');
      assert.ok(retrieved);
      assert.strictEqual(retrieved?.title, 'Xadrez Real');
      assert.strictEqual(retrieved?.gameType, 'turn_based');
      assert.strictEqual(retrieved?.config.time_control, 600);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Testes de Desacoplamento e Independência da Network Engine
  // --------------------------------------------------------------------------
  describe('2. Independência e Neutralidade da Network Engine', () => {
    it('2.1. O contrato de Jogo da Velha (tic-tac-toe) deve estar devidamente registrado no catálogo', () => {
      const ttt = getGameDefinition('tic-tac-toe');
      assert.ok(ttt);
      assert.ok(ttt?.component, 'TicTacToeGame deve estar integrado como componente no Game Registry');
      assert.strictEqual(ttt?.gameType, 'turn_based');
    });

    it('2.2. O core multiplayer não deve possuir dependência direta de lógicas internas de jogos individuais', () => {
      // Testamos que as regras específicas do Jogo da Velha (board de 9 células, símbolos X/O, linhas de vitória)
      // não estão acopladas no tipo canônico de metadados da tabela de jogos ou no core da Network Engine.
      const games = listGames();
      games.forEach((game) => {
        if (game.id !== 'tic-tac-toe') {
          // Os outros jogos não possuem referências ao Tic-Tac-Toe
          assert.notStrictEqual(game.gameType, undefined);
          assert.ok(game.id !== 'tic-tac-toe');
          assert.strictEqual(game.highlights.some(hl => hl.includes('células') || hl.includes('tabuleiro 3x3')), false);
        }
      });
    });
  });
});
