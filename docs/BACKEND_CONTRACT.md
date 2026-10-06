# Contrato de Backend (BACKEND_CONTRACT.md)

Este documento define o contrato estrito entre o Frontend e o Supabase. 

> **Regra Fundamental**: O Frontend NUNCA deve acessar diretamente as tabelas do Supabase com comandos de escrita (`insert`, `update`, `delete`) arbitrários. Todas as mutações de estado crítico (salas, jogadores, jogadas, resultados) DEVEM ser efetuadas via **PostgreSQL Remote Procedure Calls (RPCs)** atômicas e protegidas por validações de segurança.

---

## 1. Tipos de Domínio TypeScript (Espelho dos Dados)

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

// Partida
export interface MatchDTO<TGameState = unknown> {
  id: MatchId;
  room_id: RoomId | null;
  game_id: GameId;
  status: MatchStatus;
  current_turn_player_id: UserId | null;
  turn_deadline: string | null;
  turn_number: number;
  game_state: TGameState;
  action_history: GameActionEnvelope[];
  winner_id: UserId | null;
  is_draw: boolean;
  finish_reason: FinishReason | null;
  created_at: string;
  finished_at: string | null;
}

// Jogador da Partida
export interface MatchPlayerDTO {
  id: string;
  match_id: MatchId;
  user_id: UserId;
  slot: number; // 1 ou 2
  game_symbol: string | null; // 'X' ou 'O'
  score: number;
  is_winner: boolean;
  disconnected_at: string | null;
  grace_period_expires_at: string | null;
  profile?: UserProfileDTO;
}

// Envelope genérico de ação do jogo
export interface GameActionEnvelope<TPayload = unknown> {
  action_id: string;
  turn_number: number;
  player_id: UserId;
  action_type: string;
  payload: TPayload;
  client_timestamp: number;
  server_timestamp: string;
}
```

---

## 2. Códigos de Erro Padronizados

Todas as RPCs retornam uma resposta no formato:
```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```
Ou em caso de falha:
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Mensagem amigável legível",
    "details": {}
  }
}
```

### Lista Canônica de Códigos de Erro:
- `UNAUTHORIZED`: Usuário não está autenticado (`auth.uid() IS NULL`).
- `ROOM_NOT_FOUND`: A sala solicitada não existe ou foi fechada.
- `ROOM_FULL`: A sala atingiu a capacidade máxima de membros.
- `ALREADY_IN_ROOM`: O jogador já é membro desta sala.
- `NOT_IN_ROOM`: O jogador não faz parte da sala especificada.
- `NOT_ROOM_HOST`: Operação reservada exclusivamente ao anfitrião da sala.
- `PLAYERS_NOT_READY`: Nem todos os jogadores confirmaram prontidão.
- `INSUFFICIENT_PLAYERS`: Quantidade de jogadores inferior ao mínimo exigido pelo jogo.
- `MATCH_NOT_FOUND`: A partida solicitada não foi encontrada.
- `MATCH_ALREADY_FINISHED`: Ação enviada para uma partida já terminada.
- `NOT_YOUR_TURN`: Jogador tentou executar ação fora da sua vez.
- `INVALID_MOVE`: Jogada proibida pelas regras do jogo (ex: célula ocupada).
- `TURN_TIMEOUT_EXPIRED`: O limite de tempo da jogada foi ultrapassado.
- `GRACE_PERIOD_ACTIVE`: Jogador oponente está em período de tolerância de reconexão.
- `INVITE_NOT_FOUND`: Convite expirado ou inválido.

---

## 3. Especificação Completa das RPCs

### 3.1. `create_room`
- **Finalidade**: Cria uma nova sala/lobby e insere o criador como Host e ocupante do Slot 1.
- **Parâmetros**:
  ```typescript
  {
    p_game_id: string;
    p_name: string;
    p_is_private: boolean;
    p_max_members?: number; // default: 4
  }
  ```
- **Retorno**: `{ success: boolean, data: { room: RoomDTO, member: RoomMemberDTO } }`
- **Validações**:
  - `auth.uid()` obrigatório.
  - `p_game_id` deve existir e estar ativo em `games`.
  - Gera um código de sala aleatório de 6 caracteres alfanuméricos com verificação de colisão em loop transacional.
- **Atomicidade**: Insere em `rooms` e `room_members` na mesma transação.

---

### 3.2. `join_room_by_code`
- **Finalidade**: Permite a um jogador ingressar em uma sala através de seu código de 6 caracteres.
- **Parâmetros**:
  ```typescript
  {
    p_code: string;
    p_as_spectator?: boolean; // default: false
  }
  ```
- **Retorno**: `{ success: boolean, data: { room: RoomDTO, member: RoomMemberDTO } }`
- **Validações & Concorrência**:
  - Executa `SELECT * FROM rooms WHERE code = UPPER(p_code) FOR UPDATE;` para bloquear alterações concorrentes.
  - Verifica se a contagem atual de membros em `room_members` < `max_members`.
  - Se `p_as_spectator` for falso, tenta alocar o menor slot livre (Slot 2); caso contrário, aloca como espectador (`slot_number = null, role = 'spectator'`).
  - Se o usuário já estiver na sala, retorna os dados existentes de forma idempotente sem duplicar.

---

### 3.3. `leave_room`
- **Finalidade**: Remove o usuário da sala.
- **Parâmetros**:
  ```typescript
  {
    p_room_id: string;
  }
  ```
- **Retorno**: `{ success: boolean, data: { new_host_id: string | null, room_closed: boolean } }`
- **Regras Críticas**:
  - Se o jogador que saiu for o `host_id`:
    - Se houver outros membros, elege automaticamente o próximo membro mais antigo como novo Host.
    - Se a sala ficar vazia, atualiza `status = 'closed'` e remove a sala.

---

### 3.4. `set_member_ready`
- **Finalidade**: Alterna o estado de prontidão (`is_ready`) do jogador no lobby.
- **Parâmetros**:
  ```typescript
  {
    p_room_id: string;
    p_is_ready: boolean;
  }
  ```
- **Retorno**: `{ success: boolean, data: { is_ready: boolean } }`
- **Validações**:
  - Usuário deve possuir `role = 'player'` e `slot_number IS NOT NULL`. Espectadores não alteram status de ready.

---

### 3.5. `start_match`
- **Finalidade**: O anfitrião inicia a partida a partir da sala. Congela os competidores e instancia a partida.
- **Parâmetros**:
  ```typescript
  {
    p_room_id: string;
  }
  ```
- **Retorno**: `{ success: boolean, data: { match: MatchDTO, players: MatchPlayerDTO[] } }`
- **Validações & Atomicidade**:
  - Bloqueia a sala com `FOR UPDATE`.
  - Verifica se `auth.uid() = room.host_id`.
  - Verifica se há exatamente 2 jogadores prontos nos slots 1 e 2.
  - Inicializa o estado do jogo (para Jogo da Velha: tabuleiro vazio `[null, null, null, null, null, null, null, null, null]`).
  - Sorteia ou define o Jogador 1 como 'X' e Jogador 2 como 'O'.
  - Insere o registro em `matches` com status `'in_progress'`.
  - Insere 2 registros imutáveis em `match_players`.
  - Atualiza `rooms.status = 'in_game'` e `rooms.current_match_id = match.id`.
  - Dispara evento no canal da sala notificando todos os participantes.

---

### 3.6. `submit_game_action`
- **Finalidade**: Submete uma jogada de forma atômica no banco de dados.
- **Parâmetros**:
  ```typescript
  {
    p_match_id: string;
    p_action_type: string; // Ex: 'PLACE_MARK'
    p_payload: any;        // Ex: { cellIndex: 4 }
    p_client_timestamp: number;
  }
  ```
- **Retorno**:
  ```typescript
  {
    success: boolean,
    data: {
      match_id: string;
      turn_number: number;
      game_state: any;
      winner_id: string | null;
      is_draw: boolean;
      status: MatchStatus;
    }
  }
  ```
- **Validações Invioláveis**:
  - `SELECT * FROM matches WHERE id = p_match_id FOR UPDATE;`
  - Valida se `status = 'in_progress'`.
  - Valida se `auth.uid() = current_turn_player_id`.
  - Valida regras do Jogo da Velha:
    - Índice deve ser inteiro entre 0 e 8.
    - Célula no `game_state` deve estar vazia (`null`).
  - Atualiza a célula com o símbolo do jogador (`'X'` ou `'O'`).
  - Verifica condição de vitória (3 em linha, coluna ou diagonal) ou empate (9 jogadas preenchidas).
  - Se houver vencedor ou empate: atualiza `status = 'finished'`, define `winner_id` ou `is_draw = true`, incrementa estatísticas nos `profiles` dos jogadores e desliga o turno.
  - Se a partida continuar: alterna `current_turn_player_id` para o oponente, incrementa `turn_number` e redefine `turn_deadline = now() + interval '30 seconds'`.

---

### 3.7. `finish_match` / `claim_timeout_victory`
- **Finalidade**: Encerra formalmente uma partida por desistência (resign) ou por W.O. após estouro do grace period ou timer de jogada.
- **Parâmetros**:
  ```typescript
  {
    p_match_id: string;
    p_reason: 'resignation' | 'timeout' | 'abandonment';
  }
  ```
- **Validações**:
  - Se `p_reason = 'timeout'`: o banco verifica com `clock_timestamp() > matches.turn_deadline` ou `clock_timestamp() > match_players.grace_period_expires_at`. Caso positivo, declara o adversário vencedor por W.O.
  - Se `p_reason = 'resignation'`: o próprio jogador desiste voluntariamente, declarando vitória para o adversário.

---

### 3.8. `send_room_invite` e `respond_room_invite`
- **Finalidade**: Convidar amigos da lista social para a sala e aceitar/recusar convites.
- **Parâmetros**:
  - `send_room_invite`: `{ p_room_id: string, p_receiver_id: string }`
  - `respond_room_invite`: `{ p_invite_id: string, p_accept: boolean }`
- **Retorno**: `{ success: boolean, room_id?: string }`
