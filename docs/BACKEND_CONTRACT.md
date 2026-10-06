# Contrato de Backend — DuoPlay-Online

> **Architecture Version:** 1.1  
> **Status:** Active / Phase 4 Implemented (Tic Tac Toe Server-Side Validator Registered)

---

## 1. Princípios do Contrato

1. **PostgreSQL como Única Fonte da Verdade**: O estado oficial do sistema e das regras de jogo reside no banco de dados.
2. **Sem Mutações Arbitrárias via REST**: O Frontend não executa `INSERT`, `UPDATE` ou `DELETE` diretamente nas tabelas operacionais. Todas as modificações de estado passam por **RPCs com `SECURITY DEFINER`**.
3. **Idempotência Obrigatória**: Operações críticas devem ser resilientes a envios duplicados provocados por double-click, latência, reconexões ou retries de rede.
4. **Isolamento de Contratos**: O Frontend consome DTOs tipados expostos na pasta `src/types/` e serviços em `src/services/`, mapeados estritamente conforme este documento.
5. **Validação Server-Side das Regras de Jogo**: O cliente envia exclusivamente uma *intenção de jogada* (ex: `place_mark` com `position`). O cálculo do estado resultante, alternância de turnos, vitória e empate é executado deterministicamente pelo validador server-side do respectivo jogo.
6. **Escopo Social Futuro**: Entidades e RPCs sociais (`friendships`, `invites`, `room_messages`) estão documentadas para garantir extensibilidade futura, mas **NÃO** fazem parte do escopo da implementação inicial.

---

## 2. Tipos de Domínio TypeScript (DTOs)

```typescript
// Identificadores fortificados
export type UserId = string;
export type RoomId = string;
export type MatchId = string;
export type GameId = 'tic_tac_toe' | string;

// Status de Presença e Sessão
export type PresenceStatus =
  | 'online'
  | 'away'
  | 'background'
  | 'in_room'
  | 'playing'
  | 'reconnecting'
  | 'offline';

// Estados de Sala e Partida
export type RoomStatus = 'waiting' | 'in_game' | 'closed';
export type MatchStatus = 'in_progress' | 'finished' | 'abandoned' | 'cancelled';
export type MemberRole = 'player' | 'spectator';
export type FinishReason = 'normal' | 'timeout' | 'abandonment' | 'resignation';

// Perfil do Jogador
export interface UserProfileDTO {
  id: UserId;
  username: string;
  display_name: string;
  avatar_url: string | null;
  total_matches: number;
  total_wins: number;
  total_draws: number;
  total_losses: number;
  created_at: string;
  updated_at: string;
}

// Sala (Lobby)
export interface RoomDTO {
  id: RoomId;
  code: string;
  game_id: GameId;
  host_id: UserId;
  name: string;
  status: RoomStatus;
  is_private: boolean;
  max_members: number;
  current_match_id: MatchId | null;
  created_at: string;
  updated_at: string;
}

// Membro da Sala
export interface RoomMemberDTO {
  id: string;
  room_id: RoomId;
  user_id: UserId;
  role: MemberRole;
  slot_number: number | null; // 1 ou 2 para competidores, null para espectadores
  is_ready: boolean;
  joined_at: string;
  profile?: UserProfileDTO;
}

// Partida (Estado mutável por operações autorizadas, composição de jogadores congelada)
export interface MatchDTO<TGameState = unknown> {
  id: MatchId;
  room_id: RoomId | null;
  game_id: GameId;
  status: MatchStatus;
  current_turn_player_id: UserId | null;
  turn_deadline: string | null;           // Prazo normal da jogada
  turn_number: number;
  game_state: TGameState;                 // Estado dinâmico serializado
  action_history: GameActionEnvelope[];
  winner_id: UserId | null;
  is_draw: boolean;
  finish_reason: FinishReason | null;
  created_at: string;
  finished_at: string | null;
}

// Jogador da Partida (Composição Congelada)
export interface MatchPlayerDTO {
  id: string;
  match_id: MatchId;
  user_id: UserId;
  slot: number; // 1 ou 2
  game_symbol: string | null; // Ex: 'X' ou 'O' para Jogo da Velha
  score: number;
  is_winner: boolean;
  disconnected_at: string | null;
  grace_period_expires_at: string | null; // Prazo máximo de retorno do jogador
  profile?: UserProfileDTO;
}

// Envelope genérico de ação do jogo (Agnóstico à regra)
export interface GameActionEnvelope<TPayload = unknown> {
  action_id: string;                      // UUID idempotente gerado pelo cliente
  turn_number: number;
  player_id: UserId;
  action_type: string;
  payload: TPayload;
  client_timestamp: number;
  server_timestamp: string;
}

// Resposta Padrão de RPC
export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T | null;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } | null;
}
```

---

## 3. Códigos de Erro Padronizados

- `UNAUTHORIZED`: Usuário não está autenticado (`auth.uid() IS NULL`).
- `ROOM_NOT_FOUND`: A sala solicitada não existe ou foi fechada.
- `ROOM_FULL`: A sala atingiu a capacidade máxima de membros.
- `ALREADY_IN_ROOM`: O jogador já é membro desta sala.
- `NOT_IN_ROOM`: O jogador não faz parte da sala especificada.
- `NOT_ROOM_HOST`: Operação reservada exclusivamente ao anfitrião da sala.
- `PLAYERS_NOT_READY`: Nem todos os jogadores confirmaram prontidão.
- `INSUFFICIENT_PLAYERS`: Quantidade de jogadores inferior ao mínimo exigido.
- `MATCH_NOT_FOUND`: A partida solicitada não foi encontrada.
- `MATCH_ALREADY_FINISHED`: Ação enviada para uma partida já terminada.
- `NOT_YOUR_TURN`: Jogador tentou executar ação fora da sua vez.
- `INVALID_MOVE`: Jogada proibida pelas regras do jogo (rejeitada pelo validador server-side).
- `TURN_TIMEOUT_EXPIRED`: O limite de tempo regular da jogada foi ultrapassado.
- `GRACE_PERIOD_ACTIVE`: Partida suspensa aguardando retorno do jogador desconectado.
- `GRACE_PERIOD_NOT_EXPIRED`: Tentativa de vitória por W.O. antes de expirar o prazo oficial do servidor.
- `DUPLICATE_ACTION`: Ação já processada anteriormente (idempotência garantida).

---

## 4. Especificação das RPCs

### 4.1. `create_room`
- **Finalidade**: Cria uma sala e aloca o criador como Host e ocupante do Slot 1.
- **Parâmetros**: `p_game_id: string`, `p_name: string`, `p_is_private: boolean`, `p_max_members?: number`.
- **Retorno**: `ApiResponse<{ room: RoomDTO, member: RoomMemberDTO }>`
- **Idempotência & Atomicidade**: Insere `rooms` e `room_members` na mesma transação. Gera código alfanumérico único com verificação de colisão.

---

### 4.2. `join_room_by_code`
- **Finalidade**: Permite a entrada em salas (públicas ou privadas) através do código.
- **Segurança Crítica**: O código **NÃO** é uma chave para fazer `SELECT` direto no banco via REST. Ele deve ser passado exclusivamente como parâmetro desta RPC.
- **Parâmetros**: `p_code: string`, `p_as_spectator?: boolean`.
- **Retorno**: `ApiResponse<{ room: RoomDTO, member: RoomMemberDTO }>`
- **Validação de Estados da Sala**:
  - `'closed'`: Rejeitada (`ROOM_NOT_FOUND`).
  - `'starting'`: Rejeitada para novos participantes (`ROOM_STARTING`).
  - `'in_game'`: Entrada como jogador rejeitada (`MATCH_ALREADY_IN_PROGRESS`). Espectadores podem entrar se houver capacidade.
  - `'waiting'`: Jogadores e espectadores aceitos conforme vagas e slots.
- **Idempotência**: Se o usuário já for membro da sala com o mesmo código, a RPC retorna o registro existente sem duplicar ou gerar erro.
- **Concorrência**: Utiliza `SELECT ... FOR UPDATE` na linha da sala para garantir que o limite de membros não seja ultrapassado em requisições simultâneas.

---

### 4.3. `leave_room`
- **Finalidade**: Remove o usuário da sala.
- **Parâmetros**: `p_room_id: string`.
- **Retorno**: `ApiResponse<{ new_host_id: string | null, room_closed: boolean }>`
- **Regra Room ≠ Match**: A saída de um membro da sala de espera NÃO altera nem remove retroativamente sua participação na composição congelada de `match_players`.
- **Regras de Sucessão**: Se o anfitrião sair, elege o membro mais antigo restante como novo Host. Se a sala ficar vazia, define status como `'closed'`.

---

### 4.4. `set_member_ready`
- **Finalidade**: Alterna o estado de prontidão (`is_ready`) do jogador.
- **Parâmetros**: `p_room_id: string`, `p_is_ready: boolean`.
- **Retorno**: `ApiResponse<{ is_ready: boolean }>`
- **Restrições Server-Side**:
  - Permitido **exclusivamente** quando a sala estiver em status `'waiting'` (`INVALID_ROOM_STATUS`).
  - Permitido **exclusivamente** para membros com papel de jogador (`role = 'player'`). Espectadores não participam do ciclo de ready (`SPECTATOR_CANNOT_READY`).
- **Idempotência**: Enviar o mesmo valor consecutivamente resulta no mesmo estado sem efeitos colaterais.

---

### 4.5. `start_match`
- **Finalidade**: Anfitrião inicia a partida a partir da sala.
- **Parâmetros**: `p_room_id: string`.
- **Retorno**: `ApiResponse<{ match: MatchDTO, players: MatchPlayerDTO[] }>`
- **Atomicidade, Desacoplamento e Congelamento**:
  - Bloqueia a sala com `FOR UPDATE`.
  - Verifica se o chamador é o `host_id`, se a sala está em `'waiting'` e se todos os competidores (`role = 'player'`) estão prontos (`is_ready = true`).
  - Cria o registro em `matches` com status `'in_progress'`.
  - **Congela a composição dos participantes**: insere apenas competidores em `match_players` com `game_symbol = NULL`. A infraestrutura é 100% agnóstica a símbolos (X/O) e regras de jogos específicos.
  - Atualiza `rooms.status = 'in_game'` e vincula `rooms.current_match_id`.
  - Idempotência: Se invocada enquanto a partida já está em andamento, retorna o estado existente sem criar uma segunda Match.

---

### 4.6. `submit_game_action`
- **Finalidade**: Submete uma jogada de forma atômica e estritamente subordinada ao validador de regras do jogo.
- **Fluxo de Execução**:
  ```
  Cliente (Intenção de Ação)
         │
         ▼
  submit_game_action (RPC Transacional com FOR UPDATE)
         │
         ▼
  dispatch_game_action (Roteador de Regras por game_id)
         │
         ├── 'tic_tac_toe' ──► validate_tic_tac_toe_action (Validador Server-Side Oficial)
         │                           │
         │                           ▼
         │                     { accepted: true, new_state, next_player_id, winner_id, is_draw, is_finished }
         │
         └── outros jogos  ──► Exceção P0030: GAME_VALIDATOR_NOT_AVAILABLE
         │
         ▼
  Persistência Atômica no PostgreSQL (matches, match_players, rooms, profiles)
  ```
- **Contrato de Ação do Jogo da Velha (`tic_tac_toe`)**:
  - **`action_type` Obrigatório**: `'place_mark'`.
  - **`payload` Obrigatório**:
    ```json
    {
      "position": 4
    }
    ```
    - `position`: Número inteiro estrito entre `0` e `8` (0-indexed).
    - Qualquer outro campo (como `symbol`, `winner_id`, `game_state`) é rigorosamente ignorado/desconsiderado pelo servidor.
- **Formato Oficial do Estado Server-Side (`game_state`)**:
  ```json
  {
    "board": ["X", null, null, null, "O", null, null, null, null],
    "symbols": {
      "uuid-player-slot-1": "X",
      "uuid-player-slot-2": "O"
    },
    "winning_line": null,
    "last_move": {
      "position": 4,
      "player_id": "uuid-player-slot-2",
      "symbol": "O"
    }
  }
  ```
- **Regras de Validação Server-Side**:
  1. `UNAUTHORIZED`: `auth.uid()` deve ser não nulo.
  2. `NOT_MATCH_PLAYER`: Chamador deve pertencer à composição congelada de `match_players`.
  3. `NOT_YOUR_TURN`: `matches.current_turn_player_id` deve coincidir com `auth.uid()`.
  4. `INVALID_ACTION_TYPE`: `action_type` deve ser `'place_mark'`.
  5. `INVALID_POSITION`: `position` deve ser inteiro em `[0..8]`.
  6. `CELL_ALREADY_OCCUPIED`: `board[position]` deve ser `null`.
  7. **Atribuição Oficial de Símbolo**: Slot 1 = `'X'`, Slot 2 = `'O'`.
  8. **Detecção de Vitória**: Verifica as 8 combinações (3 horizontais, 3 verticais, 2 diagonais). Em caso de vitória, define `winner_id = auth.uid()`, `is_finished = true`, `is_draw = false`.
  9. **Detecção de Empate**: Se as 9 posições estiverem preenchidas sem vencedor, define `winner_id = null`, `is_finished = true`, `is_draw = true`.
  10. **Alternância de Turno**: Se a partida continuar, `current_turn_player_id` é alternado para o oponente e `turn_deadline` é estendido para `now() + 30 seconds`.
- **Comportamento para Jogos Sem Validador**:
  - Para `game_id` diferente de `'tic_tac_toe'` (ex: `snake`, `pong`, `trio_arena`), o despachador lança exceção com código `GAME_VALIDATOR_NOT_AVAILABLE` (`'P0030'`). A transação é abortada e o estado permanece intacto.
- **Idempotência por `action_id`**:
  - Se `p_action_id` já constar no histórico da partida, a RPC retorna o estado corrente com `idempotent: true` sem reaplicar a ação nem avançar o turno.

---

### 4.7. `finish_match`
- **Finalidade**: Encerra uma partida por desistência voluntária ou estouro de prazo do servidor.
- **Parâmetros**: `p_match_id: string`, `p_reason: 'resignation' | 'timeout' | 'abandonment' | 'normal'`, `p_winner_id?: string`, `p_is_draw?: boolean`.
- **Autorização Antes da Idempotência (Privacidade Estrita)**:
  - O PostgreSQL valida a identidade do usuário (`auth.uid()`) e seu pertencimento obrigatório em `match_players` **ANTES** de verificar se a partida já está finalizada ou expor qualquer dado.
  - Usuários que não participam da partida não conseguem obter informações privadas (vencedor, empates, motivos, timestamps) via chamadas repetidas à RPC.
- **Blindagem contra Manipulação de Resultados pelo Cliente**:
  - `normal`: **Rejeitado** para chamadas diretas de clientes na Fase 3.1 (`NORMAL_FINISH_NOT_AVAILABLE`). A conclusão normal é prerrogativa do validador server-side das regras do jogo (Fase 6).
  - `abandonment`: **Rejeitado** para chamadas de clientes na Fase 3.1 (`ABANDONMENT_NOT_AVAILABLE`). Será habilitado na fase correspondente à implementação do Grace Period.
  - `resignation`: O chamador desiste. Em partidas de 2 jogadores, o servidor consagra automaticamente o oponente como vencedor (`winner_id`). Em partidas de 3+ jogadores, rejeita resolução de vencedor único não definida (`MULTI_PLAYER_RESIGNATION_POLICY_PENDING`).
  - `timeout`: O PostgreSQL valida obrigatoriamente `clock_timestamp() >= matches.turn_deadline`. O relógio do cliente é completamente desconsiderado. Em 2 jogadores, o oponente de quem estourou o turno pontua.
  - `p_winner_id` e `p_is_draw` enviados pelo cliente são rigorosamente desconsiderados/não confiados.
- **Estatísticas Oficiais**: Atualiza atomicamente `total_matches`, `total_wins`, `total_draws` e `total_losses` nos perfis dos participantes via contexto oficial do servidor (`duoplay.internal_system_operation`). Imutabilidade de `id` e `created_at` permanece garantida.

---

### 4.8. RPCs Sociais (Arquitetura Futura — Fora do Escopo Inicial)
- `send_room_invite(p_room_id, p_receiver_id)`: Envia convite de sala para um amigo.
- `respond_room_invite(p_invite_id, p_accept)`: Aceita ou rejeita convite.
- Documentadas conceitualmente; não serão criadas na implementação inicial.
