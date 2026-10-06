# Especificação do Jogo da Velha na Network Engine — DuoPlay Online

> **Architecture Version:** 1.0  
> **Status:** Proposed / Pending Implementation

Este documento demonstra como o **Jogo da Velha** — o único jogo em escopo na fase inicial — se integrará à **Network Engine**, evidenciando o isolamento de camadas e o desacoplamento de infraestrutura.

---

## 1. Princípio de Isolamento

O código do Jogo da Velha (que residirá futuramente na pasta `src/games/tic-tac-toe/`):
- **NÃO** importa `@supabase/supabase-js`;
- **NÃO** faz chamadas diretas a tabelas SQL, RPCs ou canais Realtime;
- **NÃO** possui conhecimento sobre reconexão, sockets TCP ou Vercel;
- **CONHECE APENAS**: A interface padronizada da Network Engine (`GameDefinition` e `useGameMatch`).

---

## 2. Modelagem dos Tipos Específicos do Jogo

Estes tipos pertencem exclusivamente ao domínio do Jogo da Velha:

```typescript
export type BoardCell = 'X' | 'O' | null;

export type BoardArray = [
  BoardCell, BoardCell, BoardCell,
  BoardCell, BoardCell, BoardCell,
  BoardCell, BoardCell, BoardCell
];

export interface TicTacToeState {
  board: BoardArray;
  winningLine: [number, number, number] | null;
  lastMoveIndex: number | null;
}

export interface PlaceMarkAction {
  cellIndex: number; // Intervalo de 0 a 8
}
```

---

## 3. Definição do Jogo (`GameDefinition`)

O Jogo da Velha fornece à Network Engine suas regras puramente determinísticas:

```typescript
export const TicTacToeDefinition: GameDefinition<TicTacToeState, PlaceMarkAction> = {
  gameId: 'tic_tac_toe',
  
  initialState: {
    board: [null, null, null, null, null, null, null, null, null],
    winningLine: null,
    lastMoveIndex: null,
  },

  // Validação puramente local para feedback visual imediato antes da submissão
  validateActionLocal: (state, action, playerSlot) => {
    if (action.cellIndex < 0 || action.cellIndex > 8) return false;
    if (state.board[action.cellIndex] !== null) return false;
    return true;
  },

  // Reducer local para predição otimista de UI (opcional)
  reduceStateLocal: (state, action, playerSlot) => {
    const symbol = playerSlot === 1 ? 'X' : 'O';
    const newBoard = [...state.board] as BoardArray;
    newBoard[action.cellIndex] = symbol;
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

## 4. Consumo Visual via React Hook (`useGameMatch`)

O componente de tabuleiro interage unicamente com o hook agnóstico:

```typescript
export function TicTacToeGameBoard({ matchId }: { matchId: string }) {
  const {
    gameState,              // Tabuleiro 3x3 sincronizado
    mySlot,                 // 1 ou 2
    isMyTurn,               // Se é a vez do jogador atual
    opponent,               // Informações do oponente (nome, avatar, status)
    submitAction,           // Função genérica de despacho de ação
    networkStatus,          // 'connected' | 'reconnecting' | 'opponent_reconnecting'
    gracePeriodSecondsLeft  // Contador regressivo visual durante o Grace Period
  } = useGameMatch<TicTacToeState, PlaceMarkAction>(matchId, TicTacToeDefinition);

  const handleCellClick = async (index: number) => {
    if (!isMyTurn || gameState.board[index] !== null) return;
    
    // O jogo apenas emite a ação genérica para a engine
    await submitAction('PLACE_MARK', { cellIndex: index });
  };

  return (
    <div className="game-container">
      {/* HUD do Oponente com indicador de conectividade */}
      <OpponentHeader opponent={opponent} networkStatus={networkStatus} />

      {/* Alerta caso o oponente esteja em período de tolerância */}
      {networkStatus === 'opponent_reconnecting' && (
        <GracePeriodWarning secondsRemaining={gracePeriodSecondsLeft} />
      )}

      {/* Tabuleiro 3x3 */}
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

## 5. Extensibilidade Futura

Quando novos títulos (como Pong, Cobrinha ou Carta Duo) forem adicionados em versões futuras da plataforma:
1. Criar-se-á a pasta do jogo em `src/games/<novo-jogo>/`;
2. Definir-se-á a sua respectiva `GameDefinition`;
3. Desenvolver-se-á a interface de renderização consumindo `useGameMatch`;
4. A Network Engine, os gerenciadores de salas, as tabelas de infraestrutura e o protocolo de reconexão permanecerão **100% inalterados**.
