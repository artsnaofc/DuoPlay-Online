# Contrato de Backend — DuoPlay-Online

> **Architecture Version:** 1.0  
> **Status:** Proposed / Pending Implementation

---

## 1. Princípios do Contrato

1. **PostgreSQL como Única Fonte da Verdade**: O estado oficial do sistema reside no banco de dados.
2. **Sem Mutações Arbitrárias via REST**: O Frontend não executa `INSERT`, `UPDATE` ou `DELETE` diretamente nas tabelas operacionais. Todas as modificações de estado passam por **RPCs com `SECURITY DEFINER`**.
3. **Idempotência Obrigatória**: Operações críticas devem ser resilientes a envios duplicados provocados por double-click, latência, reconexões ou retries de rede.
4. **Isolamento de Contratos**: O Frontend consome DTOs tipados expostos na pasta `src/types/` e serviços em `src/services/`, mapeados estritamente conforme este documento.
5. **Escopo Social Futuro**: Entidades e RPCs sociais (`friendships`, `invites`, `room_messages`) estão documentadas para garantir extensibilidade futura, mas **NÃO** fazem parte do escopo da implementação inicial.

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
- **Idempotência**: Se o usuário já for membro da sala com o mesmo código, a RPC retorna o registro existente sem duplicar ou gerar erro.
- **Concorrência**: Utiliza `SELECT ... FOR UPDATE` na linha da sala para garantir que o limite de membros não seja ultrapassado em requisições simultâneas.

---

### 4.3. `leave_room`
- **Finalidade**: Remove o usuário da sala.
- **Parâmetros**: `p_room_id: string`.
- **Retorno**: `ApiResponse<{ new_host_id: string | null, room_closed: boolean }>`
- **Regras**: Se o anfitrião sair, elege o membro mais antigo restante como novo Host. Se a sala ficar vazia, define status como `'closed'`.

---

### 4.4. `set_member_ready`
- **Finalidade**: Alterna o estado de prontidão (`is_ready`) do jogador.
- **Parâmetros**: `p_room_id: string`, `p_is_ready: boolean`.
- **Retorno**: `ApiResponse<{ is_ready: boolean }>`
- **Idempotência**: Enviar o mesmo valor consecutivamente resulta no mesmo estado sem efeitos colaterais.

---

### 4.5. `start_match`
- **Finalidade**: Anfitrião inicia a partida a partir da sala.
- **Parâmetros**: `p_room_id: string`.
- **Retorno**: `ApiResponse<{ match: MatchDTO, players: MatchPlayerDTO[] }>`
- **Atomicidade e Congelamento**:
  - Bloqueia a sala com `FOR UPDATE`.
  - Verifica se o chamador é o `host_id` e se ambos os competidores estão prontos.
  - Cria o registro em `matches` com status `'in_progress'`.
  - **Congela a composição dos participantes** inserindo os competidores em `match_players`.
  - Atualiza `rooms.status = 'in_game'` e vincula `rooms.current_match_id`.
  - Idempotência: Se invocada enquanto a partida já está sendo criada, rejeita chamadas concorrentes com base no bloqueio e status da sala.

---

### 4.6. `submit_game_action`
- **Finalidade**: Submete uma jogada de forma atômica e segura.
- **Arquitetura de Despacho**: A RPC atua como orquestrador genérico. Ela:
  1. Identifica a partida e bloqueia com `SELECT ... FOR UPDATE`.
  2. Identifica o `game_id` associado (ex: `'tic_tac_toe'`).
  3. Delega a validação e transição de estado para o validador específico do jogo (`validate_tic_tac_toe_action`).
  4. Persiste o novo `game_state`, avança o turno e redefine o `turn_deadline`.
- **Parâmetros**:
  ```typescript
  {
    p_match_id: string;
    p_action_id: string; // UUID de idempotência gerado pelo cliente
    p_action_type: string;
    p_payload: any;
    p_client_timestamp: number;
  }
  ```
- **Retorno**: `ApiResponse<{ match_id: string, turn_number: number, game_state: any, winner_id: string | null, is_draw: boolean, status: MatchStatus }>`
- **Idempotência**: Se `p_action_id` já constar no histórico da partida ou se o `turn_number` já avançou, a RPC retorna o estado corrente sem reaplicar a ação.

---

### 4.7. `finish_match` / `claim_timeout_victory`
- **Finalidade**: Encerra uma partida por desistência voluntária ou reivindicação de vitória por estouro de prazo do servidor (Grace Period ou Turn Deadline).
- **Parâmetros**: `p_match_id: string`, `p_reason: 'resignation' | 'timeout' | 'abandonment'`.
- **Autoridade de Tempo**:
  - Se `p_reason = 'timeout'`: o PostgreSQL compara a hora real do servidor (`clock_timestamp()`) com `match_players.grace_period_expires_at` ou `matches.turn_deadline`.
  - O relógio do cliente é completamente desconsiderado. Se o prazo oficial não tiver expirado, rejeita com `GRACE_PERIOD_NOT_EXPIRED`.
- **Estatísticas**: Atualiza `total_wins`, `total_losses` nos perfis dos competidores e encerra a partida.

---

### 4.8. RPCs Sociais (Arquitetura Futura — Fora do Escopo Inicial)
- `send_room_invite(p_room_id, p_receiver_id)`: Envia convite de sala para um amigo.
- `respond_room_invite(p_invite_id, p_accept)`: Aceita ou rejeita convite.
- Documentadas conceitualmente; não serão criadas na implementação inicial.
