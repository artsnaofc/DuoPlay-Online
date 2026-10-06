# Especificação de Realtime e Comunicação — DuoPlay-Online

> **Architecture Version:** 1.0  
> **Status:** Proposed / Pending Implementation

---

## 1. Princípio Fundamental: Realtime NÃO é Fonte da Verdade

Na arquitetura do DuoPlay-Online, a autoridade e consistência dos dados pertencem exclusivamente ao **PostgreSQL**. O subsistema de Realtime atua como um canal de transporte, notificação e sincronização de eventos entre os clientes conectados.

```
┌─────────────────────────────────────────────────────────────┐
│                 POSTGRESQL (FONTE DA VERDADE)               │
│   - Estado oficial da partida (`game_state`)                │
│   - Turno atual e timestamps oficiais do servidor           │
│   - Validação autoritativa e integridade relacional         │
└──────────────────────────────┬──────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│    REALTIME BROADCAST       │ │     POSTGRES CHANGES        │
│ - Comunicação efêmera       │ │ - Notificação de commits    │
│ - Baixa latência (sub-100ms)│ │ - Dispara atualização de UI │
│ - Best-effort (sem garantia)│ │ - Não substitui snapshot    │
└─────────────────────────────┘ └─────────────────────────────┘
```

---

## 2. As Três Primitivas de Comunicação

| Primitiva | Garantia / Persistência | Papel no Sistema | Exemplo de Uso |
| :--- | :--- | :--- | :--- |
| **Presence** | Volátil / Em memória dos nós Elixir | Rastreamento do estado momentâneo de conexão do socket. | Identificar se o jogador está online, ausente ou reconectando. |
| **Broadcast** | Efêmero / Best-effort (pode haver perda) | Eventos transitórios que não necessitam de persistência. | Emojis, reações, pré-visualização de digitação. |
| **Postgres Changes** | Confiável (derivado do WAL) | Notificar clientes de que uma mutação foi persistida no banco. | Notificar que uma jogada foi confirmada e o turno avançou. |

---

## 3. Topologia e Convenção de Canais

- **`lobby:presence`**: Presença geral do lobby. Monitora usuários online na plataforma.
- **`user:{user_id}`**: Canal privativo do usuário. Utilizado para notificações direcionadas e futuros convites sociais.
- **`room:{room_id}`**: Canal da sala de espera. Transmite alterações de membros (`room_members`), prontidão (`is_ready`) e transição para partida.
- **`match:{match_id}`**: Canal da partida ativa. Transmite notificações de jogadas confirmadas, reações via Broadcast e presença específica dos competidores.

---

## 4. Diferenciação Estrita: `visibilitychange` vs Queda de Conexão

Uma inconsistência comum em web games móveis é tratar a troca de aba ou minimização de tela como desconexão imediata. No DuoPlay Online, esses conceitos são claramente separados:

1. **`visibilitychange` (Foreground vs Background)**:
   - Se o usuário bloqueia a tela brevemente ou alterna para outro app no smartphone, o evento `visibilitychange` emite `state = 'hidden'`.
   - **Isso NÃO significa desconexão.** O socket WebSocket pode continuar ativo e recebendo pacotes em background por vários segundos.
   - O status de presença do usuário transita apenas para `'background'`. O jogo NÃO é interrompido nem entra em Grace Period prematuramente.
2. **Queda de Conexão Real (`reconnecting` / `disconnected`)**:
   - A desconexão só é caracterizada quando o socket do Supabase Realtime entra em estado `CLOSED`, `CHANNEL_ERROR` ou quando o heartbeat TCP do socket falha.
   - Somente neste momento o jogador entra no estado `'reconnecting'` e o protocolo de **Grace Period** é ativado.

---

## 5. Grace Period e Turn Deadline: Conceitos Distintos e Determinísticos

A arquitetura estabelece uma separação determinística entre o tempo regular de uma jogada e o tempo de tolerância a quedas de rede:

### 5.1. Definições
- **Turn Deadline**: O tempo normal concedido a um jogador conectado para realizar sua jogada (ex: 30 segundos).
- **Grace Period**: O tempo limite concedido a um jogador que sofreu queda real de conexão para que consiga restabelecer seu link (fixado em 45 segundos).

### 5.2. Regra Determinística de Transição de Tempo
```
[JOGADOR CONECTADO — JOGANDO]
  Turn Deadline ativo (ex: 20s restantes)
         │
         ▼ (Queda de conexão real detectada)
[QUEDA DETECTADA]
  1. Turn Deadline é imediatamente SUSPENSO.
  2. O servidor grava no banco:
     - match_players.disconnected_at = clock_timestamp()
     - match_players.grace_period_expires_at = clock_timestamp() + interval '45 seconds'
  3. Grace Period é iniciado.
         │
         ├────────────────────────────────────────┐
         ▼ (Jogador reconecta dentro dos 45s)    ▼ (Jogador NÃO retorna após 45s)
[RECONEXÃO BEM-SUCEDIDA]                  [EXPIRAÇÃO DO GRACE PERIOD]
  1. Grace Period é cancelado.              1. Oponente ativo aciona RPC claim_timeout_victory.
  2. Turn Deadline é RETOMADO com           2. Servidor valida: clock_timestamp() > grace_period_expires_at.
     o tempo restante preservado.           3. Partida encerrada por W.O. (status = 'abandoned').
  3. Partida continua normalmente.          4. Vitória creditada ao jogador ativo.
```

### 5.3. O Servidor é a Única Autoridade Cronológica
- O cliente nunca decide se o Grace Period acabou.
- O cliente renderiza apenas um contador regressivo visual para experiência do usuário (*"Adversário reconectando... 42s restantes"*).
- Se o usuário tentar manipular o relógio do sistema operacional (celular ou PC), a validação no servidor compara o `clock_timestamp()` interno do PostgreSQL, tornando qualquer adulteração local inócua.

---

## 6. Sincronização por State Snapshot

Como o Realtime Broadcast e oscilações de rede podem causar perda de pacotes intermediários, o cliente **nunca depende do histórico de eventos recebidos pelo WebSocket para reconstruir o estado**.

### Protocolo de Reidratação:
1. Ao reconectar o WebSocket, o cliente não solicita um "replay de eventos perdidos".
2. O `ReconnectionManager` consulta imediatamente o **State Snapshot** completo do PostgreSQL via REST/RPC:
   ```typescript
   const { data: match } = await supabase
     .from('matches')
     .select('id, status, turn_number, current_turn_player_id, turn_deadline, game_state')
     .eq('id', matchId)
     .single();
   ```
3. O estado retornado pelo banco sobrescreve a memória local e reidrata a interface de forma atômica e consistente.
