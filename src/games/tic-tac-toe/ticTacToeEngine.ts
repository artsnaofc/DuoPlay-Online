// ============================================================================
// Logic & Winning Lines Engine: Tic-Tac-Toe Multi-Grid — DuoPlay-Online
// Description: Utilitários determinísticos para grids configuráveis do Jogo da Velha (3x3, 4x4, 5x5),
//              geração de linhas vencedoras e validação de regras.
// ============================================================================

export type TicTacToeGridSize = 3 | 4 | 5;

export interface TicTacToeCustomRules {
  grid_size: TicTacToeGridSize;
  win_streak: number; // 3, 4 ou 5 em linha
  turn_timer: number; // 15, 30, 45, 60 segundos
}

/**
 * Gera dinamicamente todas as combinações vencedoras para qualquer grid (3x3, 4x4, 5x5)
 * com sequência exigida de N peças (win_streak).
 */
export function generateWinningLines(gridSize: number, winStreak: number): number[][] {
  const lines: number[][] = [];
  const streak = Math.min(gridSize, Math.max(3, winStreak));

  // 1. Linhas horizontais
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c <= gridSize - streak; c++) {
      const line: number[] = [];
      for (let i = 0; i < streak; i++) {
        line.push(r * gridSize + (c + i));
      }
      lines.push(line);
    }
  }

  // 2. Linhas verticais
  for (let c = 0; c < gridSize; c++) {
    for (let r = 0; r <= gridSize - streak; r++) {
      const line: number[] = [];
      for (let i = 0; i < streak; i++) {
        line.push((r + i) * gridSize + c);
      }
      lines.push(line);
    }
  }

  // 3. Diagonais principais (top-left para bottom-right \)
  for (let r = 0; r <= gridSize - streak; r++) {
    for (let c = 0; c <= gridSize - streak; c++) {
      const line: number[] = [];
      for (let i = 0; i < streak; i++) {
        line.push((r + i) * gridSize + (c + i));
      }
      lines.push(line);
    }
  }

  // 4. Diagonais secundárias (top-right para bottom-left /)
  for (let r = 0; r <= gridSize - streak; r++) {
    for (let c = streak - 1; c < gridSize; c++) {
      const line: number[] = [];
      for (let i = 0; i < streak; i++) {
        line.push((r + i) * gridSize + (c - i));
      }
      lines.push(line);
    }
  }

  return lines;
}

/**
 * Verifica se há uma linha vencedora no tabuleiro dado o tamanho do grid e streak.
 */
export function checkWinner(
  board: (string | null)[],
  gridSize: number = 3,
  winStreak: number = 3
): { winner: string | null; winningLine: number[] | null } {
  const lines = generateWinningLines(gridSize, winStreak);

  for (const line of lines) {
    const first = board[line[0]];
    if (first && line.every((idx) => board[idx] === first)) {
      return { winner: first, winningLine: line };
    }
  }

  return { winner: null, winningLine: null };
}
