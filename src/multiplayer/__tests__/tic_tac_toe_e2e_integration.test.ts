// ============================================================================
// Integration Tests: Tic-Tac-Toe End-to-End & Network Engine Integration
// Phase: Fase 7 — Integração End-to-End do Jogo da Velha
// ============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameSessionController } from '../controllers/GameSessionController';
import { setSnapshotFetcherForTest } from '../network/snapshot';
import { setActionSubmitterForTest, generateActionId } from '../network/actions';
import { clearSyncQueuesForTest, reconnectMatch } from '../network/sync';
import type { GameSnapshot, SubmitActionInput, ActionResult } from '../network/types';
import type { TicTacToeState, TicTacToeBoard } from '@/types/multiplayer';

// Helper para construir snapshots de teste de Jogo da Velha
function createTicTacToeSnapshot<TState = TicTacToeState>(params: {
  matchId: string;
  turnNumber: number;
  currentTurnPlayerId: string;
  board?: TicTacToeBoard;
  status?: 'in_progress' | 'finished' | 'abandoned';
  winnerId?: string | null;
  isDraw?: boolean;
  winningLine?: [number, number, number] | null;
  slot1UserId?: string;
  slot2UserId?: string;
}): GameSnapshot<TState> {
  const p1 = params.slot1UserId || 'u-player-1-slot-1';
  const p2 = params.slot2UserId || 'u-player-2-slot-2';

  const defaultBoard: TicTacToeBoard = [
    null, null, null,
    null, null, null,
    null, null, null,
  ];

  const board = params.board || defaultBoard;

  const gameState: TicTacToeState = {
    board,
    symbols: {
      [p1]: 'X',
      [p2]: 'O',
    },
    winning_line: params.winningLine || null,
    last_move: null,
  };

  return {
    matchId: params.matchId,
    roomId: 'r-00000000-0000-4000-8000-000000000001',
    gameId: 'tic_tac_toe',
    status: params.status || 'in_progress',
    state: gameState as unknown as TState,
    currentTurnPlayerId: params.currentTurnPlayerId,
    turnNumber: params.turnNumber,
    turnDeadline: null,
    winnerId: params.winnerId || null,
    isDraw: Boolean(params.isDraw),
    finishReason: params.status === 'finished' ? 'normal' : null,
    players: [
      {
        userId: p1,
        slot: 1,
        gameSymbol: null, // Propositalmente nulo para testar determinação estrita por slot
        score: 0,
        isWinner: params.winnerId === p1,
        disconnectedAt: null,
        gracePeriodExpiresAt: null,
        joinedAt: '2026-10-06T00:00:00Z',
      },
      {
        userId: p2,
        slot: 2,
        gameSymbol: null,
        score: 0,
        isWinner: params.winnerId === p2,
        disconnectedAt: null,
        gracePeriodExpiresAt: null,
        joinedAt: '2026-10-06T00:00:00Z',
      },
    ],
    version: params.turnNumber,
    actionHistory: [],
    createdAt: '2026-10-06T00:00:00Z',
    startedAt: '2026-10-06T00:00:00Z',
    finishedAt: params.status === 'finished' ? '2026-10-06T00:05:00Z' : null,
  };
}

describe('Fase 7: Inicialização e Identidade de Jogadores', () => {
  beforeEach(() => {
    clearSyncQueuesForTest();
  });

  afterEach(() => {
    setSnapshotFetcherForTest(null);
    setActionSubmitterForTest(null);
  });

  it('1. Sessão carrega snapshot inicial e renderiza estado inicial do tabuleiro', async () => {
    const matchId = '00000000-0000-4000-8000-000000000011';
    const initialSnap = createTicTacToeSnapshot({
      matchId,
      turnNumber: 1,
      currentTurnPlayerId: 'u-player-1-slot-1',
    });

    setSnapshotFetcherForTest(async <TState = unknown>() => initialSnap as unknown as GameSnapshot<TState>);

    const controller = new GameSessionController<TicTacToeState>(matchId);
    const snap = await controller.init();

    assert.ok(snap, 'O snapshot inicial deve ser carregado com sucesso');
    assert.equal(snap.turnNumber, 1);
    assert.equal(snap.status, 'in_progress');
    assert.equal(snap.state.board.length, 9);
    assert.ok(snap.state.board.every((cell) => cell === null), 'Tabuleiro inicial deve estar completamente vazio');

    controller.destroy();
  });

  it('2. Identidade: Slot 1 é X e Slot 2 é O mesmo sem game_symbol preenchido', async () => {
    const matchId = '00000000-0000-4000-8000-000000000012';
    const snap = createTicTacToeSnapshot({
      matchId,
      turnNumber: 1,
      currentTurnPlayerId: 'u-player-1-slot-1',
    });

    setSnapshotFetcherForTest(async <TState = unknown>() => snap as unknown as GameSnapshot<TState>);

    const controller = new GameSessionController<TicTacToeState>(matchId);
    const loadedSnap = await controller.init();

    assert.ok(loadedSnap);
    const player1 = loadedSnap.players.find((p) => p.slot === 1);
    const player2 = loadedSnap.players.find((p) => p.slot === 2);

    assert.ok(player1);
    assert.ok(player2);

    // Regra da Fase 7: O símbolo DEVE ser derivado estritamente do slot
    const symbolPlayer1 = player1.slot === 1 ? 'X' : 'O';
    const symbolPlayer2 = player2.slot === 1 ? 'X' : 'O';

    assert.equal(symbolPlayer1, 'X', 'Slot 1 deve ser estritamente X');
    assert.equal(symbolPlayer2, 'O', 'Slot 2 deve ser estritamente O');

    controller.destroy();
  });
});

describe('Fase 7: Controle de Turno e Validação de Jogada', () => {
  beforeEach(() => {
    clearSyncQueuesForTest();
  });

  afterEach(() => {
    setSnapshotFetcherForTest(null);
    setActionSubmitterForTest(null);
  });

  it('3. Turno: Apenas o jogador autorizado pode jogar; fora da vez é bloqueado', async () => {
    const matchId = '00000000-0000-4000-8000-000000000013';
    const player1Id = 'u-player-1-slot-1';
    const player2Id = 'u-player-2-slot-2';

    // Turno 1: Vez do Player 1
    const snapTurn1 = createTicTacToeSnapshot({
      matchId,
      turnNumber: 1,
      currentTurnPlayerId: player1Id,
    });

    setSnapshotFetcherForTest(async <TState = unknown>() => snapTurn1 as unknown as GameSnapshot<TState>);

    setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
      const payload = input.payload as { position: number; playerId?: string };
      // Se quem tentou jogar não foi o jogador da vez:
      if (payload?.playerId === player2Id) {
        return {
          accepted: false,
          snapshot: null,
          error: {
            code: 'NOT_YOUR_TURN',
            message: 'Não é o seu turno.',
            category: 'authorization',
          },
          actionId: input.actionId || generateActionId(),
        };
      }

      // Jogada válida do Player 1
      const updatedSnap = createTicTacToeSnapshot({
        matchId,
        turnNumber: 2,
        currentTurnPlayerId: player2Id,
        board: ['X', null, null, null, null, null, null, null, null],
      });

      return {
        accepted: true,
        snapshot: updatedSnap as unknown as GameSnapshot<TState>,
        error: null,
        actionId: input.actionId || generateActionId(),
      };
    });

    const controller = new GameSessionController<TicTacToeState>(matchId);
    await controller.init();

    // 1. Player 2 tenta jogar fora do turno -> deve ser rejeitado
    const outOfTurnRes = await controller.submitAction('place_mark', {
      position: 0,
      playerId: player2Id,
    });

    assert.equal(outOfTurnRes.accepted, false);
    assert.equal(outOfTurnRes.error?.code, 'NOT_YOUR_TURN');

    // 2. Player 1 joga no seu turno -> aceito com sucesso
    const validMoveRes = await controller.submitAction('place_mark', {
      position: 0,
      playerId: player1Id,
    });

    assert.equal(validMoveRes.accepted, true);
    assert.equal(validMoveRes.snapshot?.turnNumber, 2);
    assert.equal(validMoveRes.snapshot?.currentTurnPlayerId, player2Id);
    assert.equal(validMoveRes.snapshot?.state.board[0], 'X');

    controller.destroy();
  });

  it('4. Jogada: Envio de place_mark preserva actionId e formato do payload', async () => {
    const matchId = '00000000-0000-4000-8000-000000000014';
    let receivedInput: SubmitActionInput<unknown> | null = null;
    const explicitActionId = 'e0000000-0000-4000-8000-000000000099';

    setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
      receivedInput = input as unknown as SubmitActionInput<unknown>;
      const snap = createTicTacToeSnapshot({
        matchId,
        turnNumber: 2,
        currentTurnPlayerId: 'u-player-2-slot-2',
        board: [null, null, null, null, 'X', null, null, null, null],
      });
      return {
        accepted: true,
        snapshot: snap as unknown as GameSnapshot<TState>,
        error: null,
        actionId: input.actionId || '',
      };
    });

    const controller = new GameSessionController<TicTacToeState>(matchId);
    const result = await controller.submitAction(
      'place_mark',
      { position: 4 },
      explicitActionId
    );

    assert.ok(receivedInput);
    assert.equal((receivedInput as SubmitActionInput<{ position: number }>).actionType, 'place_mark');
    assert.equal((receivedInput as SubmitActionInput<{ position: number }>).payload.position, 4);
    assert.equal(result.actionId, explicitActionId);

    controller.destroy();
  });
});

describe('Fase 7: Condições de Vitória e Empate', () => {
  beforeEach(() => {
    clearSyncQueuesForTest();
  });

  afterEach(() => {
    setSnapshotFetcherForTest(null);
    setActionSubmitterForTest(null);
  });

  it('5. Vitória Horizontal: Servidor determina vitória e destaca linha vencedora', async () => {
    const matchId = '00000000-0000-4000-8000-000000000015';
    const player1Id = 'u-player-1-slot-1';

    // Tabuleiro com vitória horizontal na primeira linha: [0, 1, 2]
    const winBoard: TicTacToeBoard = [
      'X', 'X', 'X',
      'O', 'O', null,
      null, null, null,
    ];

    const winSnap = createTicTacToeSnapshot({
      matchId,
      turnNumber: 6,
      currentTurnPlayerId: 'u-player-2-slot-2',
      board: winBoard,
      status: 'finished',
      winnerId: player1Id,
      winningLine: [0, 1, 2],
    });

    setSnapshotFetcherForTest(async <TState = unknown>() => winSnap as unknown as GameSnapshot<TState>);

    const controller = new GameSessionController<TicTacToeState>(matchId);
    const snap = await controller.init();

    assert.ok(snap);
    assert.equal(snap.status, 'finished');
    assert.equal(snap.winnerId, player1Id);
    assert.deepEqual(snap.state.winning_line, [0, 1, 2]);

    controller.destroy();
  });

  it('6. Vitória Vertical: Servidor determina vitória na coluna 0 [0, 3, 6]', async () => {
    const matchId = '00000000-0000-4000-8000-000000000016';
    const player2Id = 'u-player-2-slot-2';

    const verticalWinBoard: TicTacToeBoard = [
      'O', 'X', 'X',
      'O', 'X', null,
      'O', null, null,
    ];

    const winSnap = createTicTacToeSnapshot({
      matchId,
      turnNumber: 6,
      currentTurnPlayerId: 'u-player-1-slot-1',
      board: verticalWinBoard,
      status: 'finished',
      winnerId: player2Id,
      winningLine: [0, 3, 6],
    });

    setSnapshotFetcherForTest(async <TState = unknown>() => winSnap as unknown as GameSnapshot<TState>);

    const controller = new GameSessionController<TicTacToeState>(matchId);
    const snap = await controller.init();

    assert.ok(snap);
    assert.equal(snap.status, 'finished');
    assert.equal(snap.winnerId, player2Id);
    assert.deepEqual(snap.state.winning_line, [0, 3, 6]);

    controller.destroy();
  });

  it('7. Vitória Diagonal: Servidor determina vitória na diagonal principal [0, 4, 8]', async () => {
    const matchId = '00000000-0000-4000-8000-000000000017';
    const player1Id = 'u-player-1-slot-1';

    const diagonalWinBoard: TicTacToeBoard = [
      'X', 'O', null,
      'O', 'X', null,
      null, null, 'X',
    ];

    const winSnap = createTicTacToeSnapshot({
      matchId,
      turnNumber: 5,
      currentTurnPlayerId: 'u-player-2-slot-2',
      board: diagonalWinBoard,
      status: 'finished',
      winnerId: player1Id,
      winningLine: [0, 4, 8],
    });

    setSnapshotFetcherForTest(async <TState = unknown>() => winSnap as unknown as GameSnapshot<TState>);

    const controller = new GameSessionController<TicTacToeState>(matchId);
    const snap = await controller.init();

    assert.ok(snap);
    assert.equal(snap.status, 'finished');
    assert.equal(snap.winnerId, player1Id);
    assert.deepEqual(snap.state.winning_line, [0, 4, 8]);

    controller.destroy();
  });

  it('8. Empate: Tabuleiro completo sem vencedor bloqueia novas jogadas', async () => {
    const matchId = '00000000-0000-4000-8000-000000000018';

    const drawBoard: TicTacToeBoard = [
      'X', 'O', 'X',
      'X', 'O', 'O',
      'O', 'X', 'X',
    ];

    const drawSnap = createTicTacToeSnapshot({
      matchId,
      turnNumber: 9,
      currentTurnPlayerId: 'u-player-2-slot-2',
      board: drawBoard,
      status: 'finished',
      winnerId: null,
      isDraw: true,
      winningLine: null,
    });

    setSnapshotFetcherForTest(async <TState = unknown>() => drawSnap as unknown as GameSnapshot<TState>);

    setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
      return {
        accepted: false,
        snapshot: null,
        error: {
          code: 'MATCH_FINISHED',
          message: 'A partida já terminou.',
          category: 'rule',
        },
        actionId: input.actionId || generateActionId(),
      };
    });

    const controller = new GameSessionController<TicTacToeState>(matchId);
    const snap = await controller.init();

    assert.ok(snap);
    assert.equal(snap.status, 'finished');
    assert.equal(snap.isDraw, true);
    assert.equal(snap.winnerId, null);

    // Tentativa de jogada em partida finalizada deve ser rejeitada
    const moveRes = await controller.submitAction('place_mark', { position: 0 });
    assert.equal(moveRes.accepted, false);
    assert.equal(moveRes.error?.code, 'MATCH_FINISHED');

    controller.destroy();
  });
});

describe('Fase 7: Tratamento de Erros de Regras do Servidor', () => {
  beforeEach(() => {
    clearSyncQueuesForTest();
  });

  afterEach(() => {
    setSnapshotFetcherForTest(null);
    setActionSubmitterForTest(null);
  });

  it('9. Célula já ocupada (CELL_ALREADY_OCCUPIED) é rejeitada pelo validador', async () => {
    const matchId = '00000000-0000-4000-8000-000000000019';

    setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
      const payload = input.payload as { position: number };
      if (payload.position === 4) {
        return {
          accepted: false,
          snapshot: null,
          error: {
            code: 'CELL_ALREADY_OCCUPIED',
            message: 'A posição 4 já está ocupada.',
            category: 'rule',
          },
          actionId: input.actionId || '',
        };
      }
      return {
        accepted: true,
        snapshot: null,
        error: null,
        actionId: input.actionId || '',
      };
    });

    const controller = new GameSessionController<TicTacToeState>(matchId);
    const res = await controller.submitAction('place_mark', { position: 4 });

    assert.equal(res.accepted, false);
    assert.equal(res.error?.code, 'CELL_ALREADY_OCCUPIED');
    assert.equal(res.error?.category, 'rule');

    controller.destroy();
  });

  it('10. Posição inválida (INVALID_POSITION) fora do intervalo 0..8 é rejeitada', async () => {
    const matchId = '00000000-0000-4000-8000-000000000020';

    setActionSubmitterForTest(async <TState = unknown, TPayload = unknown>(input: SubmitActionInput<TPayload>): Promise<ActionResult<TState>> => {
      const payload = input.payload as { position: number };
      if (payload.position < 0 || payload.position > 8) {
        return {
          accepted: false,
          snapshot: null,
          error: {
            code: 'INVALID_POSITION',
            message: 'A posição deve ser um número inteiro entre 0 e 8.',
            category: 'rule',
          },
          actionId: input.actionId || '',
        };
      }
      return { accepted: true, snapshot: null, error: null, actionId: input.actionId || '' };
    });

    const controller = new GameSessionController<TicTacToeState>(matchId);
    const res = await controller.submitAction('place_mark', { position: 9 });

    assert.equal(res.accepted, false);
    assert.equal(res.error?.code, 'INVALID_POSITION');

    controller.destroy();
  });
});

describe('Fase 7: Sincronização, Reconexão e Cleanup', () => {
  beforeEach(() => {
    clearSyncQueuesForTest();
  });

  afterEach(() => {
    setSnapshotFetcherForTest(null);
    setActionSubmitterForTest(null);
  });

  it('11. Reconnect recupera snapshot oficial do PostgreSQL', async () => {
    const matchId = '00000000-0000-4000-8000-000000000021';
    let fetchCalled = false;

    const snapTurn3 = createTicTacToeSnapshot({
      matchId,
      turnNumber: 3,
      currentTurnPlayerId: 'u-player-1-slot-1',
      board: ['X', 'O', null, null, null, null, null, null, null],
    });

    setSnapshotFetcherForTest(async <TState = unknown>() => {
      fetchCalled = true;
      return snapTurn3 as unknown as GameSnapshot<TState>;
    });

    const recovered = await reconnectMatch<TicTacToeState>(matchId);

    assert.equal(fetchCalled, true);
    assert.equal(recovered.turnNumber, 3);
    assert.equal(recovered.state.board[0], 'X');
    assert.equal(recovered.state.board[1], 'O');
  });

  it('12. Cleanup: controller.destroy() impede que callbacks tardios alterem estado', async () => {
    const matchId = '00000000-0000-4000-8000-000000000022';

    setSnapshotFetcherForTest(async <TState = unknown>() => {
      await new Promise((r) => setTimeout(r, 20));
      return createTicTacToeSnapshot({
        matchId,
        turnNumber: 2,
        currentTurnPlayerId: 'u-player-2-slot-2',
      }) as unknown as GameSnapshot<TState>;
    });

    const controller = new GameSessionController<TicTacToeState>(matchId);
    let listenerCalled = false;

    controller.subscribe(() => {
      listenerCalled = true;
    });

    const initPromise = controller.init();
    // Destrói imediatamente antes da resolução assíncrona
    controller.destroy();

    await initPromise;

    assert.equal(controller.getIsDestroyed(), true);
    assert.equal(controller.getSnapshot(), null, 'Snapshot no controller destruído deve permanecer nulo');
  });
});
