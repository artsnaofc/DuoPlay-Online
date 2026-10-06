# Network Engine Universal — DuoPlay-Online

> **Architecture Version:** 1.0  
> **Status:** Proposed / Pending Implementation

Este documento especifica a **Network Engine**, a camada de infraestrutura que gerencia conexões, presença, sincronização, salas e partidas de forma completamente **agnóstica às regras de qualquer jogo**.

---

## 1. Princípio Fundamental de Neutralidade

A Network Engine opera estritamente com estruturas genéricas de transporte e coordenação:

- `GameState`: Objeto serializável contendo o estado do jogo;
- `GameAction`: Envelope genérico de ação com payload dinâmico;
- `GameEvent`: Eventos de ciclo de vida (início, turno, fim, reconexão);
- `Match`, `Room`, `Player`, `Connection`, `Presence`.

> **Regra de Ouro**: A Network Engine **NÃO** sabe o que é 'X' ou 'O', não conhece tabuleiro 3x3, não conhece regras de vitória, não sabe o que é uma célula e não possui lógicas condicionais para jogos específicos. Ela transporta e sincroniza estados sem inspecionar suas regras internas.

---

## 2. Estrutura Modular da Engine

```
┌─────────────────────────────────────────────────────────────┐
│                    NETWORK ENGINE FAÇADE                    │
└──────┬─────────────┬─────────────┬─────────────┬────────────┘
       │             │             │             │
       ▼             ▼             ▼             ▼
┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────┐
│ Connection  ││  Presence   ││    Room     ││    Match    │
│   Manager   ││   Engine    ││   Manager   ││   Manager   │
└──────┬──────┘└─────────────┘└─────────────┘└──────┬──────┘
       │                                            │
       ▼                                            ▼
┌─────────────┐                              ┌─────────────┐
│Reconnection │                              │   Social    │
│   Manager   │                              │   Manager   │
│             │                              │  (Futuro)   │
└─────────────┘                              └─────────────┘
```

---

## 3. Especificação dos Submódulos

### 3.1. `ConnectionManager`
- **Responsabilidade**: Gerenciamento do ciclo de vida da conexão do cliente com o Supabase Realtime e monitoramento de conectividade física.
- **Diferenciação Estrita**:
  - `visibilitychange`: Apenas sinaliza se a aplicação está em primeiro ou segundo plano (`foreground` vs `background`). Não aciona estado de desconexão.
  - Conexão do Socket: Monitora o estado real da conexão TCP/WebSocket (`SUBSCRIBED`, `CLOSED`, `CHANNEL_ERROR`).
- **Métricas**: Cálculo contínuo de latência (RTT) e publicação de eventos de saúde de rede.

### 3.2. `PresenceEngine`
- **Responsabilidade**: Rastrear estados momentâneos dos usuários sem jamais considerá-los fonte jurídica de participação.
- **Estados Canônicos Gerenciados**:
  - `online`: Conectado no lobby global.
  - `away`: Inativo há mais de 2 minutos.
  - `background`: Aba minimizada ou app em segundo plano, mas socket ainda ativo.
  - `in_room`: Presente no lobby de uma sala de espera.
  - `playing`: Participando ativamente de uma partida.
  - `reconnecting`: Socket perdido; tentando restabelecer conexão.
  - `offline`: Desconectado permanentemente.

### 3.3. `RoomManager`
- **Responsabilidade**: Gerenciar o ciclo de vida do lobby da sala.
- **Funcionalidades**:
  - Invocação de RPCs: `create_room`, `join_room_by_code`, `leave_room`, `set_member_ready`.
  - Inscrição no canal `room:{room_id}` para receber atualizações de membros e prontidão.
  - Invocação da transição para partida via `start_match` pelo anfitrião.

### 3.4. `MatchManager`
- **Responsabilidade**: Orquestrar a partida ativa de forma totalmente agnóstica.
- **Funcionalidades**:
  - Inscrição no canal `match:{match_id}`.
  - Recepção do `game_state` agnóstico e despacho para os componentes visuais.
  - Envio de ações genéricas (`submitAction(actionType, payload)`) via RPC com ID de idempotência (`action_id`).
  - Controle determinístico da alternância de turnos.
  - Despacho de mensagens transitórias de baixa latência via Realtime Broadcast.

### 3.5. `ReconnectionManager`
- **Responsabilidade**: Coordenação do protocolo de tolerância a falhas e recuperação por State Snapshot.
- **Comportamento**:
  - Ao detectar perda de conexão do socket: entra no modo `RECONNECTING` e inicia visualmente a contagem do Grace Period (45 segundos).
  - Tenta reconectar o socket com *exponential backoff*.
  - Ao restabelecer a conexão: solicita o State Snapshot atualizado no PostgreSQL, cancela o Grace Period e reidrata a interface.
  - Caso o adversário permaneça desconectado após o término do prazo oficial do servidor: habilita a opção de reivindicar vitória por W.O. via RPC `claim_timeout_victory`.

### 3.6. `SocialManager` (Arquitetura Futura — Não Implementado no Escopo Inicial)
- **Responsabilidade**: Gerenciamento futuro de lista de amigos, convites de partida e notificações em tempo real. Não integra a fase inicial de desenvolvimento.

---

## 4. Interface Pública Exposta aos Jogos

Os jogos consomem a Network Engine através de um contrato tipado e React Hooks padronizados.

### 4.1. Definição do Jogo (`GameDefinition<TState, TAction>`)
```typescript
export interface GameDefinition<TState, TAction> {
  gameId: string;
  initialState: TState;
  validateActionLocal: (state: TState, action: TAction, playerSlot: number) => boolean;
  reduceStateLocal?: (state: TState, action: TAction, playerSlot: number) => TState;
}
```

### 4.2. Contexto Fornecido ao Jogo (`GameMatchContext<TState, TAction>`)
```typescript
export interface GameMatchContext<TState, TAction> {
  matchId: string;
  gameId: string;
  
  // Dados do jogador local
  myPlayerId: string;
  mySlot: number;
  isMyTurn: boolean;
  
  // Dados do adversário
  opponent: {
    id: string;
    username: string;
    avatarUrl: string | null;
    slot: number;
    isOnline: boolean;
    isReconnecting: boolean;
  } | null;

  // Estado agnóstico sincronizado
  gameState: TState;
  turnNumber: number;
  turnDeadline: string | null;
  
  // Operações de jogo
  submitAction: (actionType: string, payload: TAction) => Promise<boolean>;
  sendBroadcastReaction: (emoji: string) => void;
  resign: () => Promise<void>;
  
  // Status de rede e Grace Period
  networkStatus: 'connected' | 'reconnecting' | 'opponent_reconnecting';
  gracePeriodSecondsLeft: number | null;
}
```

### 4.3. Hook de Consumo do Jogo
```typescript
export function useGameMatch<TState, TAction>(
  matchId: string,
  gameDefinition: GameDefinition<TState, TAction>
): GameMatchContext<TState, TAction>;
```
Com esse contrato, o Jogo da Velha (ou qualquer jogo futuro) recebe seu estado, sabe de quem é a vez, submete jogadas e exibe avisos de reconexão sem ter a menor noção de como o Supabase, os WebSockets ou as RPCs funcionam.
