# Modelo de Banco de Dados (DATABASE.md)

Este documento descreve detalhadamente o modelo relacional de dados da plataforma, projetado para o PostgreSQL no Supabase. O esquema foi estruturado para garantir integridade referencial estrita, performance com índices direcionados e separação total entre o conceito de **Sala (Room)** e **Partida (Match)**.

---

## 1. Diagrama Entidade-Relacionamento (Conceitual)

```
       ┌────────────────────────┐
       │        profiles        │
       └───────────┬────────────┘
                   │ 1
                   │
                   ├────────────────────────────┐
                   │                            │
                 N │                          N │
       ┌───────────▼────────────┐   ┌───────────▼────────────┐
       │      friendships       │   │        invites         │
       └────────────────────────┘   └────────────────────────┘
                   │                            │
                   │ 1                          │ N
                   │                            │
                   ▼ N                          ▼ 1
       ┌────────────────────────┐         ┌───────────┐
       │         rooms          │◄────────┤   games   │
       └───────────┬────────────┘         └─────┬─────┘
                   │ 1                          │ 1
       ┌───────────┴────────────┐               │
       │ N                    N │               │ N
┌──────▼───────┐        ┌───────▼──────┐        │
│ room_members │        │room_messages │        │
└──────────────┘        └──────────────┘        │
       │                                        │
       │ (histórico)                            │
       ▼                                        ▼
       ┌────────────────────────────────────────┐
       │                matches                 │
       └───────────────────┬────────────────────┘
                           │ 1
                           │ N
               ┌───────────▼────────────┐
               │     match_players      │
               └────────────────────────┘
```

---

## 2. Entidades e Especificações Detalhadas

### 2.1. `profiles`
Armazena informações públicas do usuário autenticado no Supabase Auth.
- **Finalidade**: Perfil de jogador, estatísticas acumuladas, avatar e data de cadastro.
- **Campos**:
  - `id`: `UUID` (PK, referenciando `auth.users(id)` ON DELETE CASCADE).
  - `username`: `VARCHAR(32)` (NOT NULL, UNIQUE) - Nome visível no lobby e partidas.
  - `display_name`: `VARCHAR(50)` (NOT NULL) - Nome formatado para exibição.
  - `avatar_url`: `TEXT` (NULLABLE) - Link para foto ou avatar gerado.
  - `total_matches`: `INTEGER` (DEFAULT 0, NOT NULL, CHECK >= 0).
  - `total_wins`: `INTEGER` (DEFAULT 0, NOT NULL, CHECK >= 0).
  - `total_draws`: `INTEGER` (DEFAULT 0, NOT NULL, CHECK >= 0).
  - `total_losses`: `INTEGER` (DEFAULT 0, NOT NULL, CHECK >= 0).
  - `created_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
  - `updated_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
- **Índices**:
  - `idx_profiles_username_lower`: `CREATE INDEX ON profiles(LOWER(username));`

---

### 2.2. `games`
Catálogo de jogos suportados pela plataforma.
- **Finalidade**: Registro mestre dos jogos suportados, configurações de jogadores mín/máx e identificador do módulo.
- **Campos**:
  - `id`: `VARCHAR(50)` (PK) - Ex: `'tic_tac_toe'`.
  - `name`: `VARCHAR(100)` (NOT NULL) - Ex: `'Jogo da Velha'`.
  - `description`: `TEXT` (NOT NULL).
  - `min_players`: `INTEGER` (NOT NULL, DEFAULT 2, CHECK >= 2).
  - `max_players`: `INTEGER` (NOT NULL, DEFAULT 2, CHECK >= 2).
  - `is_active`: `BOOLEAN` (NOT NULL, DEFAULT true).
  - `created_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
- **Dados Iniciais (Seed Conceitual)**:
  - `('tic_tac_toe', 'Jogo da Velha', 'Clássico jogo de estratégia rápida para 2 jogadores.', 2, 2, true)`

---

### 2.3. `rooms`
Representa uma sala/lobby de espera compartilhada entre amigos ou pública.
- **Finalidade**: Agrupamento social de jogadores antes de iniciar uma partida.
- **Campos**:
  - `id`: `UUID` (PK, DEFAULT gen_random_uuid()).
  - `code`: `VARCHAR(6)` (NOT NULL, UNIQUE) - Código curto legível para entrada (ex: `'ABCD12'`).
  - `game_id`: `VARCHAR(50)` (NOT NULL, FK `games(id)` ON DELETE RESTRICT).
  - `host_id`: `UUID` (NOT NULL, FK `profiles(id)` ON DELETE RESTRICT) - Líder da sala com poder de iniciar.
  - `name`: `VARCHAR(60)` (NOT NULL) - Nome da sala.
  - `status`: `VARCHAR(20)` (NOT NULL, DEFAULT 'waiting') - Valores permitidos: `'waiting'`, `'in_game'`, `'closed'`.
  - `is_private`: `BOOLEAN` (NOT NULL, DEFAULT true) - Se aparece na listagem pública ou apenas por código.
  - `max_members`: `INTEGER` (NOT NULL, DEFAULT 4, CHECK >= 2) - Inclui jogadores e espectadores.
  - `current_match_id`: `UUID` (NULLABLE) - Aponta para a partida ativa atual (se houver).
  - `created_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
  - `updated_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
- **Índices**:
  - `idx_rooms_code`: `CREATE INDEX ON rooms(code);`
  - `idx_rooms_status_public`: `CREATE INDEX ON rooms(status, is_private) WHERE is_private = false;`

---

### 2.4. `room_members`
Representa os participantes atualmente presentes em uma sala.
- **Finalidade**: Gerenciar quem está na sala, permissões de jogador vs espectador e status de "Pronto".
- **Campos**:
  - `id`: `UUID` (PK, DEFAULT gen_random_uuid()).
  - `room_id`: `UUID` (NOT NULL, FK `rooms(id)` ON DELETE CASCADE).
  - `user_id`: `UUID` (NOT NULL, FK `profiles(id)` ON DELETE CASCADE).
  - `role`: `VARCHAR(20)` (NOT NULL, DEFAULT 'player') - `'player'` ou `'spectator'`.
  - `slot_number`: `INTEGER` (NULLABLE) - Slot 1 ou 2 para jogadores ativos; NULL para espectadores.
  - `is_ready`: `BOOLEAN` (NOT NULL, DEFAULT false) - Indica se o jogador confirmou que está pronto.
  - `joined_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
- **Constraints**:
  - `UNIQUE (room_id, user_id)`: Um usuário não pode estar duplicado na mesma sala.
  - `UNIQUE (room_id, slot_number)`: Dois jogadores não podem ocupar o mesmo slot ativo na sala.
- **Índices**:
  - `idx_room_members_user`: `CREATE INDEX ON room_members(user_id);`
  - `idx_room_members_room`: `CREATE INDEX ON room_members(room_id);`

---

### 2.5. `matches`
Representa a instância de uma partida efetivamente executada.
- **Finalidade**: Registrar de forma isolada e imutável o estado, regras, participantes e desfecho de uma disputa.
- **Campos**:
  - `id`: `UUID` (PK, DEFAULT gen_random_uuid()).
  - `room_id`: `UUID` (NULLABLE, FK `rooms(id)` ON DELETE SET NULL) - Sala de origem.
  - `game_id`: `VARCHAR(50)` (NOT NULL, FK `games(id)` ON DELETE RESTRICT).
  - `status`: `VARCHAR(20)` (NOT NULL, DEFAULT 'in_progress') - Valores: `'in_progress'`, `'finished'`, `'abandoned'`, `'cancelled'`.
  - `current_turn_player_id`: `UUID` (NULLABLE, FK `profiles(id)`).
  - `turn_deadline`: `TIMESTAMPTZ` (NULLABLE) - Timestamp limite para o jogador da vez realizar seu movimento.
  - `turn_number`: `INTEGER` (NOT NULL, DEFAULT 1).
  - `game_state`: `JSONB` (NOT NULL, DEFAULT '{}'::jsonb) - Estado serializado do jogo (ex: array do tabuleiro 3x3).
  - `action_history`: `JSONB` (NOT NULL, DEFAULT '[]'::jsonb) - Log sequencial de jogadas realizadas.
  - `winner_id`: `UUID` (NULLABLE, FK `profiles(id)`) - ID do vencedor ou NULL se empate/cancelado.
  - `is_draw`: `BOOLEAN` (NOT NULL, DEFAULT false).
  - `finish_reason`: `VARCHAR(30)` (NULLABLE) - `'normal'`, `'timeout'`, `'abandonment'`, `'resignation'`.
  - `created_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
  - `finished_at`: `TIMESTAMPTZ` (NULLABLE).
- **Índices**:
  - `idx_matches_room`: `CREATE INDEX ON matches(room_id);`
  - `idx_matches_status`: `CREATE INDEX ON matches(status);`

---

### 2.6. `match_players`
A composição congelada dos jogadores participantes da partida.
- **Finalidade**: Garantir que a lista de jogadores de uma partida seja independente de alterações na sala.
- **Campos**:
  - `id`: `UUID` (PK, DEFAULT gen_random_uuid()).
  - `match_id`: `UUID` (NOT NULL, FK `matches(id)` ON DELETE CASCADE).
  - `user_id`: `UUID` (NOT NULL, FK `profiles(id)` ON DELETE CASCADE).
  - `slot`: `INTEGER` (NOT NULL, CHECK (slot >= 1)) - Ex: 1 para Jogador X, 2 para Jogador O.
  - `game_symbol`: `VARCHAR(10)` (NULLABLE) - Ex: `'X'` ou `'O'`.
  - `score`: `INTEGER` (NOT NULL, DEFAULT 0).
  - `is_winner`: `BOOLEAN` (NOT NULL, DEFAULT false).
  - `disconnected_at`: `TIMESTAMPTZ` (NULLABLE) - Timestamp se o jogador cair durante a partida.
  - `grace_period_expires_at`: `TIMESTAMPTZ` (NULLABLE) - Limite tolerado para reconexão.
- **Constraints**:
  - `UNIQUE (match_id, user_id)`: Cada jogador só tem 1 entrada na mesma partida.
  - `UNIQUE (match_id, slot)`: Cada slot de jogo é exclusivo.
- **Índices**:
  - `idx_match_players_match`: `CREATE INDEX ON match_players(match_id);`
  - `idx_match_players_user`: `CREATE INDEX ON match_players(user_id);`

---

### 2.7. `room_messages`
Histórico de mensagens de chat da sala.
- **Finalidade**: Comunicação textual entre os participantes presentes no lobby ou durante o jogo.
- **Campos**:
  - `id`: `UUID` (PK, DEFAULT gen_random_uuid()).
  - `room_id`: `UUID` (NOT NULL, FK `rooms(id)` ON DELETE CASCADE).
  - `sender_id`: `UUID` (NOT NULL, FK `profiles(id)` ON DELETE CASCADE).
  - `content`: `VARCHAR(500)` (NOT NULL) - Texto da mensagem limitado e sanitizado.
  - `type`: `VARCHAR(20)` (NOT NULL, DEFAULT 'user') - `'user'` ou `'system'`.
  - `created_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
- **Índices**:
  - `idx_room_messages_room_time`: `CREATE INDEX ON room_messages(room_id, created_at DESC);`

---

### 2.8. `friendships`
Relações de amizade entre jogadores para futuros recursos sociais.
- **Finalidade**: Lista de amigos, ver quem está online e facilitar convites rápidos.
- **Campos**:
  - `id`: `UUID` (PK, DEFAULT gen_random_uuid()).
  - `user_id`: `UUID` (NOT NULL, FK `profiles(id)` ON DELETE CASCADE).
  - `friend_id`: `UUID` (NOT NULL, FK `profiles(id)` ON DELETE CASCADE).
  - `status`: `VARCHAR(20)` (NOT NULL, DEFAULT 'pending') - `'pending'`, `'accepted'`, `'declined'`, `'blocked'`.
  - `created_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
  - `updated_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
- **Constraints**:
  - `CHECK (user_id <> friend_id)`: Usuário não pode ser amigo de si mesmo.
  - `UNIQUE (user_id, friend_id)`: Relação única de solicitação.

---

### 2.9. `invites`
Convites diretos de um jogador para outro ingressar em uma sala específica.
- **Finalidade**: Notificação direta ao jogador alvo convidando para uma partida.
- **Campos**:
  - `id`: `UUID` (PK, DEFAULT gen_random_uuid()).
  - `room_id`: `UUID` (NOT NULL, FK `rooms(id)` ON DELETE CASCADE).
  - `sender_id`: `UUID` (NOT NULL, FK `profiles(id)` ON DELETE CASCADE).
  - `receiver_id`: `UUID` (NOT NULL, FK `profiles(id)` ON DELETE CASCADE).
  - `status`: `VARCHAR(20)` (NOT NULL, DEFAULT 'pending') - `'pending'`, `'accepted'`, `'declined'`, `'expired'`.
  - `expires_at`: `TIMESTAMPTZ` (NOT NULL) - Expira em 5 a 10 minutos após emissão.
  - `created_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
- **Índices**:
  - `idx_invites_receiver_pending`: `CREATE INDEX ON invites(receiver_id) WHERE status = 'pending';`

---

## 3. Justificativa de Modificações e Entidades Adicionadas

1. **Separação Rígida entre `room_members` e `match_players`**:
   - *Motivo*: Em plataformas multiplayer, é comum um jogador sair da sala enquanto uma partida está terminando, ou espectadores entrarem e saírem. Se a partida dependesse diretamente da tabela `room_members`, qualquer alteração no lobby corromperia o histórico e o estado da partida em andamento. `match_players` imortaliza os 2 competidores daquela partida específica.
2. **`game_state` e `action_history` em JSONB em `matches`**:
   - *Motivo*: Permite que o motor de banco de dados persista o estado serializado de qualquer jogo (o tabuleiro 3x3 do Jogo da Velha agora, matrizes de Pong ou Cobrinha no futuro) sem exigir migrations DDL para cada novo título adicionado.
