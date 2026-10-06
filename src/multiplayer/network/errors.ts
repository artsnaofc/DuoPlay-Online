// ============================================================================
// Network Engine Error Taxonomy — DuoPlay-Online
// Phase: Fase 5 — Game Snapshot + Network/Sync Engine
// ============================================================================

export type ErrorCategory =
  | 'transport'
  | 'auth'
  | 'authorization'
  | 'rule'
  | 'infrastructure'
  | 'unknown';

export interface NetworkError {
  code: string;
  message: string;
  category: ErrorCategory;
  details?: Record<string, unknown>;
  rawError?: unknown;
}

const SQL_STATE_MAP: Record<string, { code: string; category: ErrorCategory }> = {
  P0001: { code: 'AUTH_REQUIRED', category: 'auth' },
  P0005: { code: 'ROOM_NOT_FOUND', category: 'infrastructure' },
  P0006: { code: 'MATCH_ALREADY_IN_PROGRESS', category: 'rule' },
  P0007: { code: 'ROOM_FULL', category: 'infrastructure' },
  P0008: { code: 'PLAYER_SLOTS_FULL', category: 'infrastructure' },
  P0009: { code: 'NOT_IN_ROOM', category: 'authorization' },
  P0010: { code: 'NOT_ROOM_HOST', category: 'authorization' },
  P0011: { code: 'INVALID_ROOM_STATUS', category: 'infrastructure' },
  P0012: { code: 'INSUFFICIENT_PLAYERS', category: 'rule' },
  P0013: { code: 'TOO_MANY_PLAYERS', category: 'rule' },
  P0014: { code: 'PLAYERS_NOT_READY', category: 'rule' },
  P0015: { code: 'INVALID_ACTION_ID', category: 'rule' },
  P0016: { code: 'MATCH_NOT_FOUND', category: 'infrastructure' },
  P0017: { code: 'MATCH_NOT_IN_PROGRESS', category: 'rule' },
  P0018: { code: 'NOT_MATCH_PLAYER', category: 'authorization' },
  P0019: { code: 'NOT_YOUR_TURN', category: 'authorization' },
  P0020: { code: 'INVALID_FINISH_REASON', category: 'rule' },
  P0021: { code: 'TURN_TIMEOUT_NOT_EXPIRED', category: 'rule' },
  P0022: { code: 'ROOM_STARTING', category: 'infrastructure' },
  P0023: { code: 'INVALID_ROOM_STATUS', category: 'infrastructure' },
  P0024: { code: 'SPECTATOR_CANNOT_READY', category: 'authorization' },
  P0025: { code: 'NORMAL_FINISH_NOT_AVAILABLE', category: 'infrastructure' },
  P0026: { code: 'ABANDONMENT_NOT_AVAILABLE', category: 'infrastructure' },
  P0027: { code: 'MULTI_PLAYER_RESIGNATION_POLICY_PENDING', category: 'infrastructure' },
  P0028: { code: 'MULTI_PLAYER_TIMEOUT_POLICY_PENDING', category: 'infrastructure' },
  P0030: { code: 'GAME_VALIDATOR_NOT_AVAILABLE', category: 'infrastructure' },
  P0031: { code: 'INVALID_GAME_ACTION', category: 'rule' },
  P0032: { code: 'CELL_ALREADY_OCCUPIED', category: 'rule' },
  P0033: { code: 'INVALID_POSITION', category: 'rule' },
  P0034: { code: 'INVALID_ACTION_TYPE', category: 'rule' },
  P0035: { code: 'INVALID_PAYLOAD', category: 'rule' },
  P0036: { code: 'INVALID_MATCH_PLAYERS', category: 'rule' },
};

/**
 * Normaliza qualquer erro (PostgREST, Fetch, Auth, TypeError) em uma estrutura padronizada NetworkError.
 */
export function normalizeNetworkError(error: unknown): NetworkError {
  if (!error) {
    return {
      code: 'UNKNOWN_ERROR',
      message: 'Ocorreu um erro desconhecido.',
      category: 'unknown',
    };
  }

  // Se já for NetworkError
  if (
    typeof error === 'object' &&
    'code' in error &&
    'category' in error &&
    'message' in error
  ) {
    return error as NetworkError;
  }

  // Tratamento de erros do Supabase / PostgREST
  if (typeof error === 'object') {
    const errObj = error as Record<string, unknown>;
    const rawMessage = typeof errObj.message === 'string' ? errObj.message : '';
    const rawCode = typeof errObj.code === 'string' ? errObj.code : '';
    const rawDetails = typeof errObj.details === 'string' ? errObj.details : undefined;

    // Verificar se o código SQLSTATE mapeado existe
    if (rawCode && SQL_STATE_MAP[rawCode]) {
      const mapped = SQL_STATE_MAP[rawCode];
      return {
        code: mapped.code,
        message: cleanMessage(rawMessage, mapped.code),
        category: mapped.category,
        details: { sqlState: rawCode, rawDetails },
        rawError: error,
      };
    }

    // Tentar extrair o código de erro a partir do texto (ex: "CELL_ALREADY_OCCUPIED: ...")
    const codeMatch = rawMessage.match(/^([A-Z_]+):\s*(.+)$/);
    if (codeMatch) {
      const extractedCode = codeMatch[1];
      const extractedMsg = codeMatch[2];
      const category = inferCategoryFromCode(extractedCode);
      return {
        code: extractedCode,
        message: extractedMsg,
        category,
        rawError: error,
      };
    }

    // Erros de autenticação do Supabase
    if (rawMessage.toLowerCase().includes('jwt') || rawMessage.toLowerCase().includes('token') || rawMessage.toLowerCase().includes('not logged in')) {
      return {
        code: 'AUTH_REQUIRED',
        message: 'Autenticação necessária para esta operação.',
        category: 'auth',
        rawError: error,
      };
    }

    // Erros de rede ou offline
    if (
      rawMessage.toLowerCase().includes('failed to fetch') ||
      rawMessage.toLowerCase().includes('network') ||
      rawMessage.toLowerCase().includes('timeout') ||
      rawMessage.toLowerCase().includes('aborterror')
    ) {
      return {
        code: 'NETWORK_ERROR',
        message: 'Falha de comunicação com o servidor. Verifique sua conexão com a internet.',
        category: 'transport',
        rawError: error,
      };
    }

    return {
      code: rawCode || 'SUPABASE_ERROR',
      message: rawMessage || 'Erro retornado pelo banco de dados.',
      category: 'infrastructure',
      rawError: error,
    };
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.message.includes('fetch')) {
      return {
        code: 'NETWORK_ERROR',
        message: 'Falha de conexão com a rede.',
        category: 'transport',
        rawError: error,
      };
    }

    return {
      code: 'CLIENT_ERROR',
      message: error.message,
      category: 'unknown',
      rawError: error,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: String(error),
    category: 'unknown',
    rawError: error,
  };
}

function cleanMessage(rawMsg: string, fallbackCode: string): string {
  if (!rawMsg) return fallbackCode;
  const match = rawMsg.match(/^[A-Z_]+:\s*(.+)$/);
  return match ? match[1] : rawMsg;
}

function inferCategoryFromCode(code: string): ErrorCategory {
  if (code.startsWith('AUTH_')) return 'auth';
  if (code.startsWith('NOT_YOUR_') || code.startsWith('NOT_MATCH_') || code.startsWith('NOT_ROOM_') || code.startsWith('NOT_IN_')) return 'authorization';
  if (code.includes('NETWORK') || code.includes('TIMEOUT') || code.includes('FETCH')) return 'transport';
  if (
    code.includes('POSITION') ||
    code.includes('CELL_') ||
    code.includes('ACTION_TYPE') ||
    code.includes('PAYLOAD') ||
    code.includes('FINISHED') ||
    code.includes('NOT_IN_PROGRESS') ||
    code.includes('MOVE')
  ) {
    return 'rule';
  }
  return 'infrastructure';
}
