# Especificação de Realtime e Comunicação (REALTIME.md)

Este documento estabelece as diretrizes de comunicação em tempo real, protocolo de canais, presença, tratamento de quedas de rede e sincronização de estado.

---

## 1. Três Camadas de Responsabilidade

A plataforma utiliza o Supabase Realtime distribuído em três primitivas com objetivos estritamente delimitados:

| Primitiva | Finalidade | Persistência | Garantia de Entrega | Exemplo de Uso |
| :--- | :--- | :--- | :--- | :--- |
| **Presence** | Estado de conexão efêmero | Nenhuma (em memória) | Best-effort | Saber se o adversário está online, away, in_room ou reconnecting. |
| **Broadcast** | Mensagens de baixíssima latência | Nenhuma (em memória) | Best-effort / Rápida | Digitação no chat, hover no tabuleiro, cursor do mouse, emotes. |
| **Postgres Changes** | Replicação de commits do banco | Persistente (WAL do Postgres) | Confiável | Notificação de jogada confirmada, início de partida, mudança de turno. |

### Regra de Ouro:
> **Presença não é verdade jurídica.** A participação de um jogador em uma sala ou partida é determinada única e exclusivamente pelos registros nas tabelas `room_members` e `match_players`. A Presença apenas indica se o socket TCP do navegador daquele jogador está ativo neste instante.

---

## 2. Convenção e Topologia de Canais

```
                          ┌──────────────────────────┐
                          │   Supabase Realtime      │
                          └─────────────┬────────────┘
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             ▼                          ▼                          ▼
   ┌────────────────────┐     ┌────────────────────┐     ┌────────────────────┐
   │   lobby:presence   │     │   user:{user_id}   │     │   room:{room_id}   │
   ├────────────────────┤     ├────────────────────┤     ├────────────────────┤
   │ - Presence Global  │     │ - Convites diretos │     │ - Membros na sala  │
   │ - Usuários online  │     │ - Notificações     │     │ - Chat da sala     │
   │ - Contador global  │     │ - Alertas de jogo  │     │ - Status de Ready  │
   └────────────────────┘     └────────────────────┘     └──────────┬─────────┘
                                                                    │
                                                                    ▼
                                                         ┌────────────────────┐
                                                         │  match:{match_id}  │
                                                         ├────────────────────┤
                                                         │ - Ações de jogo    │
                                                         │ - Emotes e reações │
                                                         │ - Presença partida │
                                                         │ - Sync de snapshot │
                                                         └────────────────────┘
```

### 2.1. Canal `lobby:presence`
- **Público / Autenticado**: Todos os clientes conectados.
- **Presence**:
  ```json
  {
    "user_id": "uuid",
    "username": "joao123",
    "status": "online", // 'online' | 'away'
    "client_version": "1.0.0"
  }
  ```
- **Broadcast**: Desativado (evitar sobrecarga no lobby geral).
- **Postgres Changes**: Desativado.

### 2.2. Canal `user:{user_id}`
- **Privado**: Apenas o próprio usuário autenticado pode se inscrever.
- **Presence**: Desativado.
- **Broadcast / Postgres Changes**:
  - Evento `invite_received`: Notifica chegada de novo convite.
  - Evento `friend_status_changed`: Notifica quando amigo fica online/offline.

### 2.3. Canal `room:{room_id}`
- **Escopo**: Restrito aos participantes da sala.
- **Presence**:
  ```json
  {
    "user_id": "uuid",
    "status": "in_room",
    "is_tab_active": true
  }
  ```
- **Eventos Broadcast**:
  - `user_typing`: Indicador de digitação no chat.
  - `chat_message_preview`: Opcional para feedback ágil.
- **Postgres Changes**:
  - Tabela `room_members`: INSERT/UPDATE/DELETE (quando jogadores entram, saem ou marcam "Pronto").
  - Tabela `rooms`: UPDATE (quando `status` muda para `'in_game'` ou `host_id` é transferido).
  - Tabela `room_messages`: INSERT (novas mensagens gravadas).

### 2.4. Canal `match:{match_id}`
- **Escopo**: Competidores e espectadores da partida ativa.
- **Presence**:
  ```json
  {
    "user_id": "uuid",
    "slot": 1,
    "status": "playing", // 'playing' | 'reconnecting'
    "last_seen_epoch": 1728148000
  }
  ```
- **Eventos Broadcast**:
  - `cell_hover`: Oponente passando o dedo/mouse sobre uma casa do tabuleiro.
  - `player_reaction`: Emojis rápidos (aplausos, choro, risada).
- **Postgres Changes**:
  - Tabela `matches`: UPDATE (quando uma jogada é aceita no banco, o tabuleiro avança, muda o turno ou encerra a partida).
  - Tabela `match_players`: UPDATE (quando um jogador entra em estado de desconexão/reconexão).

---

## 3. Protocolo de Reconexão e Grace Period

Dispositivos móveis frequentemente enfrentam interrupções temporárias de conexão devido a:
- Celular bloqueado no bolso;
- Troca de aplicativo ou recebimento de chamada telefônica;
- Alternância entre Wi-Fi e 4G/5G;
- Queda breve de pacote no metrô ou túnel.

### 3.1. O Fluxo de Grace Period (45 Segundos)

```
[CONECTADO / JOGANDO]
        │
        ▼
[Perda de Conexão Detectada]
  - WebSocket fecha OU visibilidade de página vai para 'hidden'
        │
        ▼
[Estado: 'reconnecting' + DISPARO DO GRACE PERIOD]
  - Cliente oponente detecta queda de Presence
  - Oponente exibe: "O adversário está reconectando... (Aguardando até 45s)"
  - O relógio do turno da jogada é pausado ou compensado pelo servidor
  - A vaga no jogo e na sala fica RESERVADA
        │
        ├─────────────────────────────────────────────────┐
        ▼ (Dentro dos 45s)                                ▼ (Após 45s de inatividade)
[RECONEXÃO BEM-SUCEDIDA]                           [TIMEOUT DO GRACE PERIOD]
  - WebSocket reconecta                               - Servidor ou oponente via RPC:
  - Presence volta para 'playing'                       claim_timeout_victory(match_id)
  - Disparo de evento `state_sync`                    - Partida finalizada com status 'abandoned'
  - Download do snapshot atualizado                   - Vitória creditada por W.O. ao jogador ativo
  - Jogo retoma exatamente de onde parou              - Notificação final emitida
```

### 3.2. Regras de Preservação:
1. **Duração Recomendada**: **45 segundos**. Suficiente para alternar redes ou reabrir o navegador sem frustrar o oponente ativo com esperas eternas.
2. **Impedimento de Jogada Durante Queda**: O jogador que está desconectado não pode ter seu turno queimado instantaneamente.
3. **Limite de Reconexões por Partida**: Máximo de 3 períodos de grace period por partida para o mesmo jogador (evita abuso deliberado de "stall").

---

## 4. Sincronização de Estado (State Snapshot vs Event Stream)

Quando um jogador se reconecta após uma oscilação de rede, ele pode ter perdido eventos broadcast ou notificações transitórias.

### Mecanismo de Recuperação:
1. **Reidratação por Snapshot Completo (Full State Recovery)**:
   - Ao reconectar, a Network Engine NÃO tenta adivinhar quais deltas perdeu.
   - Ela efetua uma chamada rápida de consulta ao registro da partida:
     ```typescript
     const { data: match } = await supabase
       .from('matches')
       .select('*, match_players(*)')
       .eq('id', matchId)
       .single();
     ```
   - O objeto `match.game_state` contém o tabuleiro com a verdade absoluta do PostgreSQL.
2. **Reconciliação Local**:
   - O `MatchManager` entrega o `game_state` fresco para a instância do jogo.
   - A interface do Jogo da Velha renderiza instantaneamente o tabuleiro correto, reseta timers locais e reabilita as interações caso seja a vez do jogador reconectado.
