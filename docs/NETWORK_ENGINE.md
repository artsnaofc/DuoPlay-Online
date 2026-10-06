# Network Engine Universal (NETWORK_ENGINE.md)

Este documento especifica a **Network Engine**, a camada de software responsável por abstrair toda a complexidade de conexão, presença, canais, reconexão e sincronização, expondo uma interface limpa e reativa para o Jogo da Velha e futuros jogos.

---

## 1. Arquitetura Modular da Engine

A Network Engine é composta por 6 submódulos especializados e orquestrados por uma fachada unificada (`NetworkEngine`):

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
└─────────────┘                              └─────────────┘
```

---

## 2. Especificação dos Submódulos

### 2.1. `ConnectionManager`
- **Responsabilidade**: Gerenciar o ciclo de vida da conexão do cliente com o Supabase Realtime e monitorar a saúde da rede.
- **Funcionalidades**:
  - Inicialização do client Supabase único (Singleton).
  - Cálculo de latência periódica (Ping/Pong através de timestamp roundtrip no canal de Presence).
  - Detecção de online/offline nativo via eventos do navegador (`navigator.onLine`, `window.addEventListener('online')`).
  - Monitoramento de visibilidade da aba (`document.addEventListener('visibilitychange')`).
  - Disparo de eventos para a engine: `connection_state_changed`, `latency_updated`.

### 2.2. `PresenceEngine`
- **Responsabilidade**: Rastrear e publicar os estados momentâneos dos usuários no lobby, nas salas e nas partidas.
- **Funcionalidades**:
  - Gestão de heartbeat e presença (`track` e `untrack`).
  - Transição de status automática:
    - Se `visibilityState === 'hidden'`: muda status para `'background'`.
    - Se usuário inativo por mais de 2 minutos: status `'away'`.
    - Ao entrar numa sala: status `'in_room'`.
    - Ao iniciar partida: status `'playing'`.
  - Exposição de lista reativa de usuários online e presenças locais de cada sala.

### 2.3. `RoomManager`
- **Responsabilidade**: Gerenciar o ciclo de vida das salas sociais de espera (lobbies).
- **Funcionalidades**:
  - `createRoom(params)`: Invoca RPC `create_room`.
  - `joinRoomByCode(code)`: Invoca RPC `join_room_by_code`.
  - `leaveCurrentRoom()`: Invoca RPC `leave_room` e limpa inscrições nos canais.
  - `toggleReady(isReady)`: Invoca RPC `set_member_ready`.
  - `startMatch()`: Invoca RPC `start_match` (se for o Host).
  - Escuta ativa das alterações na sala (novos participantes, quem marcou pronto, mudança de host).
  - Envio e recebimento de mensagens de chat da sala.

### 2.4. `MatchManager`
- **Responsabilidade**: Gerenciar a partida ativa, o turno dos jogadores, a submissão de ações e o encerramento.
- **Funcionalidades**:
  - Inscrição no canal `match:{match_id}`.
  - Carregamento inicial do estado da partida (`game_state`).
  - Envio de jogadas (`submitAction(actionType, payload)`).
  - Recebimento de atualizações do banco de dados (novo tabuleiro, vitória, empate).
  - Disparo de eventos de feedback efêmero via Broadcast (`sendHover`, `sendEmoji`).
  - Finalização formal (`claimTimeout`, `resign`).

### 2.5. `ReconnectionManager`
- **Responsabilidade**: Orquestrar a tolerância a falhas e o Grace Period de 45 segundos durante oscilações de rede.
- **Funcionalidades**:
  - Ao detectar desconexão da rede ou do WebSocket:
    - Entra no estado interno `RECONNECTING`.
    - Inicia contagem regressiva visual do Grace Period.
    - Notifica os componentes via callback `onOpponentDisconnecting` ou `onSelfDisconnecting`.
    - Tenta reconectar o socket com *exponential backoff with jitter* (1s, 2s, 4s, 8s).
  - Ao recuperar conexão:
    - Restabelece inscrições de canais.
    - Solicita automaticamente o State Snapshot mais recente da partida no banco (`resyncMatchState()`).
    - Atualiza a UI e emite o evento `RECONNECTED`.
  - Se estourar os 45 segundos sem retorno:
    - Emite `GRACE_PERIOD_EXPIRED`.
    - Executa ação de vitória por abandono.

### 2.6. `SocialManager`
- **Responsabilidade**: Relações interpessoais de amizade e convites diretos.
- **Funcionalidades**:
  - Lista de amigos e monitoramento de presença de amigos em tempo real.
  - Envio de convites de sala (`sendRoomInvite(friendId)`).
  - Notificações de convites recebidos via canal privativo `user:{user_id}`.

---

## 3. Interfaces Públicas que os Jogos Consumirão

O Jogo da Velha (e qualquer jogo futuro) consumirá a Network Engine através de um contrato tipado e React Hooks limpos, sem jamais referenciar o Supabase diretamente.

### 3.1. Interface Genérica de Ação e Estado
```typescript
// Contrato genérico que qualquer jogo deve implementar
export interface GameDefinition<TState, TAction> {
  gameId: string;
  initialState: TState;
  validateActionLocal: (state: TState, action: TAction, playerSlot: number) => boolean;
  reduceStateLocal?: (state: TState, action: TAction) => TState;
}

// Objeto de contexto entregue ao componente do jogo
export interface GameMatchContext<TState, TAction> {
  matchId: string;
  gameId: string;
  
  // Informações do jogador local
  myPlayerId: string;
  mySlot: number;             // Ex: 1 ou 2
  mySymbol?: string;          // Ex: 'X' ou 'O'
  isMyTurn: boolean;
  
  // Informações do oponente
  opponent: {
    id: string;
    username: string;
    avatarUrl: string | null;
    slot: number;
    isOnline: boolean;
    isReconnecting: boolean;
  } | null;

  // Estado sincronizado do jogo
  gameState: TState;
  turnNumber: number;
  turnDeadline: string | null;
  
  // Ações de jogo
  submitAction: (actionType: string, payload: TAction) => Promise<boolean>;
  sendBroadcastReaction: (emoji: string) => void;
  resign: () => Promise<void>;
  
  // Estado de rede da partida
  networkStatus: 'connected' | 'reconnecting' | 'opponent_reconnecting';
  gracePeriodSecondsLeft: number | null;
}
```

### 3.2. Hook de Consumo do Jogo (`useGameMatch`)
```typescript
// Exemplo de como o componente visual do jogo utilizará o motor
export function useGameMatch<TState, TAction>(
  matchId: string,
  gameDefinition: GameDefinition<TState, TAction>
): GameMatchContext<TState, TAction>;
```
Com essa assinatura, o componente do Jogo da Velha precisa apenas invocar `useGameMatch(...)` para receber o tabuleiro, se é sua vez, as informações do adversário e a função para jogar.
