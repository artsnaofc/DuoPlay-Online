// ============================================================================
// Unit Tests: Network Engine & GameSessionController — DuoPlay-Online
// Phase: Fase 5 — Game Snapshot + Network/Sync Engine
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateActionId,
  normalizeNetworkError,
  calculateMonotonicVersion,
  mapDatabaseToGameSnapshot,
  mapMatchPlayerRow,
  subscribeToMatch,
  submitAction,
} from '../network';
import { GameSessionController } from '../controllers/GameSessionController';
import type { MatchRow, MatchPlayerRow } from '@/types/database';

describe('Network Engine: Action ID & Idempotency', () => {
  it('1. Deve gerar actionId no formato UUID v4 válido e único', () => {
    const id1 = generateActionId();
    const id2 = generateActionId();

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    assert.equal(typeof id1, 'string');
    assert.match(id1, uuidRegex);
    assert.match(id2, uuidRegex);
    assert.notEqual(id1, id2, 'Dois actionIds gerados não devem ser iguais');
  });
});

describe('Network Engine: Error Taxonomy & Normalization', () => {
  it('2. Deve normalizar erros SQLSTATE mapeados do Supabase', () => {
    // P0032 -> CELL_ALREADY_OCCUPIED (rule)
    const errOccupied = normalizeNetworkError({
      code: 'P0032',
      message: 'CELL_ALREADY_OCCUPIED: A posição 4 já está ocupada.',
    });
    assert.equal(errOccupied.code, 'CELL_ALREADY_OCCUPIED');
    assert.equal(errOccupied.category, 'rule');
    assert.equal(errOccupied.message, 'A posição 4 já está ocupada.');

    // P0019 -> NOT_YOUR_TURN (authorization)
    const errTurn = normalizeNetworkError({
      code: 'P0019',
      message: 'NOT_YOUR_TURN: Não é o seu turno.',
    });
    assert.equal(errTurn.code, 'NOT_YOUR_TURN');
    assert.equal(errTurn.category, 'authorization');

    // P0030 -> GAME_VALIDATOR_NOT_AVAILABLE (infrastructure)
    const errValidator = normalizeNetworkError({
      code: 'P0030',
      message: 'GAME_VALIDATOR_NOT_AVAILABLE: As regras deste jogo ainda não estão disponíveis.',
    });
    assert.equal(errValidator.code, 'GAME_VALIDATOR_NOT_AVAILABLE');
    assert.equal(errValidator.category, 'infrastructure');

    // P0001 -> AUTH_REQUIRED (auth)
    const errAuth = normalizeNetworkError({
      code: 'P0001',
      message: 'UNAUTHORIZED: Usuário não autenticado.',
    });
    assert.equal(errAuth.code, 'AUTH_REQUIRED');
    assert.equal(errAuth.category, 'auth');
  });

  it('3. Deve normalizar erros de transporte / rede e mensagens genéricas', () => {
    const netErr = normalizeNetworkError(new Error('Failed to fetch'));
    assert.equal(netErr.code, 'NETWORK_ERROR');
    assert.equal(netErr.category, 'transport');

    const prefixErr = normalizeNetworkError({
      message: 'INVALID_POSITION: Posição deve estar entre 0 e 8.',
    });
    assert.equal(prefixErr.code, 'INVALID_POSITION');
    assert.equal(prefixErr.category, 'rule');
  });
});

describe('Network Engine: Snapshot Mapping & Monotonic Versioning', () => {
  it('4. Deve mapear linhas relacionais do PostgreSQL para GameSnapshot imutável e ordenar jogadores por slot', () => {
    const mockMatch: MatchRow & { match_players: MatchPlayerRow[] } = {
      id: 'm0000000-0000-0000-0000-000000000001',
      room_id: 'r0000000-0000-0000-0000-000000000001',
      game_id: 'tic_tac_toe',
      status: 'in_progress',
      current_turn_player_id: 'u0000000-0000-0000-0000-000000000001',
      turn_deadline: '2026-10-06T12:00:00Z',
      turn_number: 3,
      game_state: {
        board: ['X', null, null, null, 'O', null, null, null, 'X'],
        symbols: {
          'u0000000-0000-0000-0000-000000000001': 'X',
          'u0000000-0000-0000-0000-000000000002': 'O',
        },
      },
      action_history: [
        { action_id: 'a1', turn_number: 1, action_type: 'place_mark', payload: { position: 0 } },
        { action_id: 'a2', turn_number: 2, action_type: 'place_mark', payload: { position: 4 } },
      ],
      winner_id: null,
      is_draw: false,
      finish_reason: null,
      created_at: '2026-10-06T11:55:00Z',
      started_at: '2026-10-06T11:55:00Z',
      finished_at: null,
      match_players: [
        {
          id: 'mp2',
          match_id: 'm0000000-0000-0000-0000-000000000001',
          user_id: 'u0000000-0000-0000-0000-000000000002',
          slot: 2,
          game_symbol: 'O',
          score: 0,
          is_winner: false,
          disconnected_at: null,
          grace_period_expires_at: null,
          joined_at: '2026-10-06T11:55:00Z',
        },
        {
          id: 'mp1',
          match_id: 'm0000000-0000-0000-0000-000000000001',
          user_id: 'u0000000-0000-0000-0000-000000000001',
          slot: 1,
          game_symbol: 'X',
          score: 0,
          is_winner: false,
          disconnected_at: null,
          grace_period_expires_at: null,
          joined_at: '2026-10-06T11:55:00Z',
        },
      ],
    };

    interface TicTacToeStateMock {
      board: (string | null)[];
      symbols: Record<string, string>;
    }

    const snapshot = mapDatabaseToGameSnapshot<TicTacToeStateMock>(mockMatch);

    assert.equal(snapshot.matchId, 'm0000000-0000-0000-0000-000000000001');
    assert.equal(snapshot.gameId, 'tic_tac_toe');
    assert.equal(snapshot.turnNumber, 3);
    assert.equal(snapshot.version, 3);
    assert.equal(snapshot.players.length, 2);
    assert.equal(snapshot.players[0].slot, 1, 'Jogador no Slot 1 deve vir primeiro');
    assert.equal(snapshot.players[1].slot, 2, 'Jogador no Slot 2 deve vir em segundo');
    assert.equal(snapshot.state.board[0], 'X');
    assert.equal(snapshot.state.board[4], 'O');
  });

  it('5. Deve calcular versão monotônica estritamente baseada no servidor', () => {
    // Turno em andamento
    assert.equal(calculateMonotonicVersion(1, 0, false), 1);
    assert.equal(calculateMonotonicVersion(5, 4, false), 5);
    // Partida concluída incrementa versão monotônica
    assert.equal(calculateMonotonicVersion(5, 5, true), 6);
  });

  it('6. Deve tratar jogadores sem gameSymbol de forma segura (nulo para jogos agnósticos)', () => {
    const playerSnapshot = mapMatchPlayerRow({
      user_id: 'u-123',
      slot: 1,
      game_symbol: null,
    });
    assert.equal(playerSnapshot.gameSymbol, null);
    assert.equal(playerSnapshot.userId, 'u-123');
  });
});

describe('Network Engine: Action Submission Local Validation', () => {
  it('7. Deve rejeitar matchId vazio ou actionType inválido antes da rede', async () => {
    const res1 = await submitAction({
      matchId: '',
      actionType: 'place_mark',
      payload: { position: 0 },
    });
    assert.equal(res1.accepted, false);
    assert.equal(res1.error?.code, 'INVALID_MATCH_ID');

    const res2 = await submitAction({
      matchId: 'm1',
      actionType: '',
      payload: { position: 0 },
    });
    assert.equal(res2.accepted, false);
    assert.equal(res2.error?.code, 'INVALID_ACTION_TYPE');
  });
});

describe('GameSessionController: State Management & Lifecycle', () => {
  it('8. Deve gerenciar listeners e transições de estado de sincronização', () => {
    const controller = new GameSessionController('match-mock-123');
    let emittedSyncState = '';

    const unsubscribe = controller.subscribe((_snapshot, syncState) => {
      emittedSyncState = syncState;
    });

    assert.equal(emittedSyncState, 'syncing');
    assert.equal(controller.getSyncState(), 'syncing');

    unsubscribe();
    controller.destroy();
  });
});

describe('Network Engine: Realtime Subscription Contract', () => {
  it('9. Deve fornecer contrato de unsubscribe seguro sem falhas', () => {
    const unsubscribe = subscribeToMatch('m1', () => {});
    assert.equal(typeof unsubscribe, 'function');
    assert.doesNotThrow(() => unsubscribe());
  });
});
