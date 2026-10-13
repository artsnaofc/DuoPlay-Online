import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getGameDefinition } from '@/multiplayer/registry';

describe('Jogo da Forca — integração e configuração', () => {
  it('registra Hangman como jogo disponível para exatamente dois jogadores', () => {
    const game = getGameDefinition('hangman');
    assert.ok(game);
    assert.equal(game.id, 'hangman');
    assert.equal(game.isAvailable, true);
    assert.equal(game.minPlayers, 2);
    assert.equal(game.maxPlayers, 2);
    assert.ok(game.component);
    assert.equal(game.config.mode, 'alternating');
    assert.equal(game.config.rounds, 5);
  });
});
