# Modelo de Banco de Dados — DuoPlay-Online

> **Architecture Version:** 1.0  
> **Status:** Proposed / Pending Implementation

Este documento especifica o modelo relacional da plataforma DuoPlay-Online no PostgreSQL (Supabase). Ele estabelece a integridade referencial, constraints de concorrência e a separação estrita entre a gestão social de **Salas (Rooms)** e o ciclo operacional de **Partidas (Matches)**.

---

## 1. Diagrama Entidade-Relacionamento (Conceitual)

```
       ┌────────────────────────┐
       │        profiles        │
       └───────────┬────────────┘
                   │ 1
                   ├────────────────────────────┐
                   │                            │
                 N │ (Arquitetura Futura)     N │ (Arquitetura Futura)
       ┌───────────▼────────────┐   ┌───────────▼────────────┐
       │      friendships       │   │        invites         │
       └────────────────────────┘   └────────────────────────┘
                   │                            │
                   │ 1                          │ N
                   ▼ N                          ▼ 1
       ┌────────────────────────┐         ┌───────────┐
       │         rooms          │◄────────┤   games   │
       └───────────┬────────────┘         └─────┬─────┘
                   │ 1                          │ 1
       ┌───────────┴────────────┐               │
       │ N                    N │ (Futuro)      │ N
┌──────▼───────┐        ┌───────▼──────┐        │
│ room_members │        │room_messages │        │
└──────────────┘        └──────────────┘        │
       │                                        │
       │ [start_match]                          │
       ▼                                        ▼
       ┌────────────────────────────────────────┐
       │                matches                 │
       │      (Estado Mutável de Jogo)          │
       └───────────────────┬────────────────────┘
                           │ 1
                           │ N
               ┌───────────▼────────────┐
               │     match_players      │
               │ (Composição Congelada) │
               └────────────────────────┘
```

---

## 2. Entidades Principais (Escopo Inicial)

### 2.1. `profiles`
- **Finalidade**: Perfil público do jogador, sincronizado com o Supabase Auth (`auth.users`), com estatísticas oficiais calculadas pelo servidor.
- **Campos**:
  - `id`: `UUID` (PK, referenciando `auth.users(id)` ON DELETE CASCADE).
  - `username`: `VARCHAR(32)` (NOT NULL, UNIQUE) - Identificador legível.
  - `display_name`: `VARCHAR(50)` (NOT NULL) - Nome formatado para exibição.
  - `avatar_url`: `TEXT` (NULLABLE) - URL de avatar ou placeholder gerado.
  - `total_matches`: `INTEGER` (DEFAULT 0, NOT NULL, CHECK >= 0).
  - `total_wins`: `INTEGER` (DEFAULT 0, NOT NULL, CHECK >= 0).
  - `total_draws`: `INTEGER` (DEFAULT 0, NOT NULL, CHECK >= 0).
  - `total_losses`: `INTEGER` (DEFAULT 0, NOT NULL, CHECK >= 0).
  - `created_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
  - `updated_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
- **Índices**: `CREATE INDEX ON profiles(LOWER(username));`

---

### 2.2. `games`
- **Finalidade**: Catálogo mestre dos jogos suportados. Na v1.0, contém apenas o Jogo da Velha.
- **Campos**:
  - `id`: `VARCHAR(50)` (PK) - Ex: `'tic_tac_toe'`.
  - `name`: `VARCHAR(100)` (NOT NULL) - Ex: `'Jogo da Velha'`.
  - `description`: `TEXT` (NOT NULL).
  - `min_players`: `INTEGER` (NOT NULL, DEFAULT 2, CHECK >= 2).
  - `max_players`: `INTEGER` (NOT NULL, DEFAULT 2, CHECK >= 2).
  - `is_active`: `BOOLEAN` (NOT NULL, DEFAULT true).
  - `created_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
- **Registro Inicial (Seed Conceitual)**:
  - `('tic_tac_toe', 'Jogo da Velha', 'Clássico jogo de estratégia 3x3 para 2 jogadores.', 2, 2, true)`

---

### 2.3. `rooms`
- **Finalidade**: Representa o lobby de espera pré-jogo.
- **Campos**:
  - `id`: `UUID` (PK, DEFAULT gen_random_uuid()).
  - `code`: `VARCHAR(6)` (NOT NULL, UNIQUE) - Código alfanumérico curto para entrada.
  - `game_id`: `VARCHAR(50)` (NOT NULL, FK `games(id)` ON DELETE RESTRICT).
  - `host_id`: `UUID` (NOT NULL, FK `profiles(id)` ON DELETE RESTRICT).
  - `name`: `VARCHAR(60)` (NOT NULL).
  - `status`: `VARCHAR(20)` (NOT NULL, DEFAULT 'waiting') - `'waiting'`, `'in_game'`, `'closed'`.
  - `is_private`: `BOOLEAN` (NOT NULL, DEFAULT true).
  - `max_members`: `INTEGER` (NOT NULL, DEFAULT 4, CHECK >= 2).
  - `current_match_id`: `UUID` (NULLABLE) - Aponta para a partida ativa atual.
  - `created_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
  - `updated_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
- **Índices**:
  - `CREATE INDEX ON rooms(code);`
  - `CREATE INDEX ON rooms(status, is_private) WHERE is_private = false;`

---

### 2.4. `room_members`
- **Finalidade**: Participantes atualmente no lobby da sala.
- **Campos**:
  - `id`: `UUID` (PK, DEFAULT gen_random_uuid()).
  - `room_id`: `UUID` (NOT NULL, FK `rooms(id)` ON DELETE CASCADE).
  - `user_id`: `UUID` (NOT NULL, FK `profiles(id)` ON DELETE CASCADE).
  - `role`: `VARCHAR(20)` (NOT NULL, DEFAULT 'player') - `'player'` ou `'spectator'`.
  - `slot_number`: `INTEGER` (NULLABLE) - Slot 1 ou 2 para jogadores; NULL para espectadores.
  - `is_ready`: `BOOLEAN` (NOT NULL, DEFAULT false).
  - `joined_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
- **Constraints de Integridade**:
  - `UNIQUE (room_id, user_id)`: Um usuário não pode estar duplicado na mesma sala.
  - `UNIQUE (room_id, slot_number)`: Garante fisicamente no banco que dois membros jamais ocupem o mesmo slot ativo.

---

### 2.5. `matches` (Estado Dinâmico da Partida)
- **Finalidade**: Registra o ciclo de vida, turnos, deadlines e estado interno serializado do jogo.
- **Natureza Mutável**: Ao contrário da composição de jogadores (que é congelada), os campos `game_state`, `turn_number`, `current_turn_player_id`, `turn_deadline` e `status` são atualizados a cada jogada validada via RPC.
- **Campos**:
  - `id`: `UUID` (PK, DEFAULT gen_random_uuid()).
  - `room_id`: `UUID` (NULLABLE, FK `rooms(id)` ON DELETE SET NULL).
  - `game_id`: `VARCHAR(50)` (NOT NULL, FK `games(id)` ON DELETE RESTRICT).
  - `status`: `VARCHAR(20)` (NOT NULL, DEFAULT 'in_progress') - `'in_progress'`, `'finished'`, `'abandoned'`, `'cancelled'`.
  - `current_turn_player_id`: `UUID` (NULLABLE, FK `profiles(id)`).
  - `turn_deadline`: `TIMESTAMPTZ` (NULLABLE) - Prazo regular de tempo para a jogada corrente.
  - `turn_number`: `INTEGER` (NOT NULL, DEFAULT 1).
  - `game_state`: `JSONB` (NOT NULL, DEFAULT '{}'::jsonb) - Estado serializado do jogo (ex: array do tabuleiro).
  - `action_history`: `JSONB` (NOT NULL, DEFAULT '[]'::jsonb) - Histórico sequencial de ações para auditoria e replay.
  - `winner_id`: `UUID` (NULLABLE, FK `profiles(id)`).
  - `is_draw`: `BOOLEAN` (NOT NULL, DEFAULT false).
  - `finish_reason`: `VARCHAR(30)` (NULLABLE) - `'normal'`, `'timeout'`, `'abandonment'`, `'resignation'`.
  - `created_at`: `TIMESTAMPTZ` (DEFAULT now(), NOT NULL).
  - `finished_at`: `TIMESTAMPTZ` (NULLABLE).

---

### 2.6. `match_players` (Composição Congelada da Partida)
- **Finalidade**: Armazena os competidores fixados para aquela partida.
- **Natureza Imutável**: Criada na RPC `start_match()` e **nunca alterada** por entradas ou saídas na sala de origem.
- **Campos**:
  - `id`: `UUID` (PK, DEFAULT gen_random_uuid()).
  - `match_id`: `UUID` (NOT NULL, FK `matches(id)` ON DELETE CASCADE).
  - `user_id`: `UUID` (NOT NULL, FK `profiles(id)` ON DELETE CASCADE).
  - `slot`: `INTEGER` (NOT NULL, CHECK (slot >= 1)) - Ex: 1 ou 2.
  - `game_symbol`: `VARCHAR(10)` (NULLABLE) - Ex: `'X'` ou `'O'`.
  - `score`: `INTEGER` (NOT NULL, DEFAULT 0).
  - `is_winner`: `BOOLEAN` (NOT NULL, DEFAULT false).
  - `disconnected_at`: `TIMESTAMPTZ` (NULLABLE) - Momento da perda de conexão registrada pelo servidor.
  - `grace_period_expires_at`: `TIMESTAMPTZ` (NULLABLE) - Limite exato do servidor para retorno antes de W.O.
- **Constraints**:
  - `UNIQUE (match_id, user_id)`: Cada competidor possui registro único na partida.
  - `UNIQUE (match_id, slot)`: Exclusividade física de cada slot.

---

## 3. Entidades Sociais (Arquitetura Futura — Fora do Escopo Inicial)

As entidades abaixo estão documentadas conceitualmente para assegurar a compatibilidade das chaves e índices no futuro, mas **não serão criadas na implementação inicial**:

- **`room_messages`**: Chat da sala (`id`, `room_id`, `sender_id`, `content`, `type`, `created_at`).
- **`friendships`**: Vínculos de amizade (`id`, `user_id`, `friend_id`, `status`, `created_at`).
- **`invites`**: Convites diretos de partida (`id`, `room_id`, `sender_id`, `receiver_id`, `status`, `expires_at`).
