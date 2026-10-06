# Especificação do Jogo da Velha na Network Engine (GAME_TIC_TAC_TOE_SPEC.md)

Este documento demonstra como o **Jogo da Velha** será futuramente implementado sobre a infraestrutura da Network Engine, comprovando na prática a separação de responsabilidades e o desacoplamento arquitetural.

---

## 1. Isolamento Conceitual

O Jogo da Velha:
- **NÃO** importa `@supabase/supabase-js`;
- **NÃO** conhece URLs de banco ou chaves de API;
- **NÃO** sabe o que é WebSocket, canal Phoenix ou RPC SQL;
- **CONHECE APENAS**: o hook/adapter fornecido pela Network Engine (`useGameMatch`).

---

## 2. Modelagem dos Tipos Específicos do Jogo

```typescript
// Tipos específicos que pertencerão a `src/games/tic-tac-toe/types.ts`
export type BoardCell = 'X' | 'O' | null;
export type BoardArray = [
  BoardCell, BoardCell, BoardCell,
  BoardCell, BoardCell, BoardCell,
  BoardCell, BoardCell, BoardCell
];

export interface TicTacToeState {
  board: BoardArray;
  winningLine: [number, number, number] | null; // índices da linha vencedora para destaque visual
  lastMoveIndex: number | null;
}

export interface PlaceMarkAction {
  cellIndex: number; // 0 a 8
}
```

---

## 3. Definição do Jogo (`GameDefinition`)

O jogo registra sua lógica puramente matemática e idempotente:

```typescript
export const TicTacToeDefinition: GameDefinition<TicTacToeState, PlaceMarkAction> = {
  gameId: 'tic_tac_toe',
  
  initialState: {
    board: [null, null, null, null, null, null, null, null, null],
    winningLine: null,
    lastMoveIndex: null,
  },

  // Validação puramente local para feedback visual imediato antes do envio
  validateActionLocal: (state, action, playerSlot) => {
    if (action.cellIndex < 0 || action.cellIndex > 8) return false;
    if (state.board[action.cellIndex] !== null) return false;
    return true;
  },

  // Reducer determinístico local para predição otimista de UI
  reduceStateLocal: (state, action, playerSymbol) => {
    const newBoard = [...state.board] as BoardArray;
    newBoard[action.cellIndex] = playerSymbol as 'X' | 'O';
    return {
      ...state,
      board: newBoard,
      lastMoveIndex: action.cellIndex,
      winningLine: checkWinningLine(newBoard),
    };
  }
};
```

---

## 4. Consumo Futuro na Camada Visual (Preview de Componente)

Quando a implementação for aprovada, o componente React do jogo consumirá a engine com uma simplicidade extrema:

```typescript
// Exemplo conceitual da arquitetura do componente em fases futuras:
export function TicTacToeView({ matchId }: { matchId: string }) {
  const {
    gameState,
    mySymbol,
    isMyTurn,
    opponent,
    submitAction,
    networkStatus,
    gracePeriodSecondsLeft
  } = useGameMatch<TicTacToeState, PlaceMarkAction>(matchId, TicTacToeDefinition);

  const handleCellClick = (index: number) => {
    if (!isMyTurn || gameState.board[index] !== null) return;
    submitAction('PLACE_MARK', { cellIndex: index });
  };

  return (
    <div className="tic-tac-toe-container">
      {/* HUD com avatar do oponente, indicador de vez e status de rede */}
      <PlayerHUD opponent={opponent} networkStatus={networkStatus} />
      
      {/* Alerta caso o oponente esteja em Grace Period de reconexão */}
      {networkStatus === 'opponent_reconnecting' && (
        <ReconnectionBanner secondsLeft={gracePeriodSecondsLeft} />
      )}

      {/* Grid 3x3 do Tabuleiro */}
      <div className="grid grid-cols-3 gap-2">
        {gameState.board.map((cell, idx) => (
          <BoardCell
            key={idx}
            value={cell}
            onClick={() => handleCellClick(idx)}
            disabled={!isMyTurn || cell !== null}
            isWinningCell={gameState.winningLine?.includes(idx)}
          />
        ))}
      </div>
    </div>
  );
}
```

---

## 5. Por que este Design é à Prova de Futuro?

Para adicionar um segundo jogo (ex: **Pong**):
1. Cria-se `src/games/pong/types.ts` e `PongDefinition`.
2. Cria-se o componente visual `PongView`.
3. Invoca-se `useGameMatch<PongState, PongAction>(matchId, PongDefinition)`.
4. **Zero** alterações no `ConnectionManager`, `RoomManager`, `ReconnectionManager` ou tabelas de infraestrutura.
