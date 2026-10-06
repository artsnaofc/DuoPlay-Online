# Arquitetura da Plataforma Multiplayer

## 1. Visão Geral Executiva

A plataforma foi projetada como um ecossistema modular para jogos casuais e competitivos multiplayer em tempo real na web. O objetivo central é fornecer uma infraestrutura de rede, salas, presença, reconexão e persistência totalmente desacoplada dos jogos que rodam sobre ela.

O **Jogo da Velha** é o primeiro jogo suportado, funcionando como prova de conceito e validação do motor de rede. A arquitetura garante que novos jogos (como Pong, Cobrinha, Carta Duo, xadrez, etc.) sejam plugados futuramente sem tocar em nenhuma linha de código da camada de transporte, infraestrutura de salas ou gerenciamento de sessão.

---

## 2. Princípio Fundamental de Desacoplamento

A arquitetura adota o princípio de **Inversão de Dependência** e **Separação Rígida em Três Camadas**:

```
┌─────────────────────────────────────────────────────────────┐
│                       CAMADA DE JOGOS                       │
│                                                             │
│   Jogo da Velha (Tic-Tac-Toe)  │  [Futuros Jogos: Pong, ...]│
│   - Regras do Jogo e Validação Local                        │
│   - Estado Específico do Jogo (ex: Board 3x3)              │
│   - Componentes Visuais de Tabuleiro e HUD                  │
│   - Consumo do contrato genérico: NetworkAdapter<T, A>      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    NETWORK ENGINE (SDK)                     │
│                                                             │
│   - ConnectionManager      (Conexão, Latência, Heartbeat)   │
│   - PresenceEngine         (Estados de conexão efêmeros)    │
│   - ReconnectionManager    (Grace period, Snapshot Sync)    │
│   - RoomManager            (Lobby, Slots, Prontidão, Host)  │
│   - MatchManager           (Ciclo de partida, Despacho)     │
│   - SocialManager          (Convites, Amizades, Chat)       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  CAMADA DE INFRAESTRUTURA                   │
│                                                             │
│   Supabase                                                  │
│   - Supabase Auth          (Identidade e Tokens JWT)        │
│   - PostgreSQL + RLS       (Fonte de verdade persistente)   │
│   - PostgreSQL RPCs        (Transações atômicas seguras)    │
│   - Supabase Realtime      (Broker de Mensagens WebSocket)  │
│     * Presence             (Estado online de conexões)      │
│     * Broadcast            (Mensagens efêmeras sub-100ms)   │
│     * Postgres Changes     (Eventos de commit em tabelas)   │
└─────────────────────────────────────────────────────────────┘
```

### Regras Estritas de Fronteira:
1. **Nenhum jogo importa o Supabase Client**: O Jogo da Velha (e futuros jogos) interage exclusivamente com as interfaces TypeScript expostas pela Network Engine.
2. **Nenhum jogo define salas ou conexões**: O jogo só entra em ação quando uma partida (`Match`) é instanciada e fornecida com dois slots preenchidos.
3. **A Network Engine é agnóstica de regras**: A engine transporta envelopes de payload genérico `Action<T>` e `StateSnapshot<S>`, sem inspecionar ou inferir as regras internas de qualquer jogo.

---

## 3. Compatibilidade com o Modelo Serverless da Vercel

A aplicação hospeda seu frontend e eventuais rotas auxiliares na infraestrutura serverless da Vercel. 

### Restrições Operacionais:
- **Sem instâncias com estado em memória**: Funções serverless da Vercel têm ciclo de vida efêmero (cold start, execução e encerramento).
- **Sem servidor WebSocket próprio em Node.js**: Não é viável manter conexões persistentes WebSocket abertas contra contêineres na Vercel.
- **Sem processos em background**: Não há daemons permanentes para orquestrar ticks de relógio ou timeouts centrais.

### Solução Arquitetural:
- O **Supabase Realtime Cluster** (baseado em Elixir/Phoenix Channels distribuído) atua como o broker global e persistente de conexões WebSocket com os navegadores.
- O **PostgreSQL do Supabase** atua como a única fonte da verdade persistente através de transações ACID garantidas por **RPCs com `SECURITY DEFINER`**.
- A verificação de timeouts e grace period utiliza uma abordagem híbrida de **Timestamps Baseados no Servidor (`clock_timestamp()`)**:
  - Quando um jogador realiza uma ação, o banco registra o momento exato do servidor.
  - Se um jogador tentar jogar após o tempo limite, ou se o adversário solicitar encerramento por W.O., o banco valida o cálculo de tempo no Postgres, invulnerável a adulterações do relógio do cliente.

---

## 4. Ciclo de Vida Completo da Aplicação

O fluxo de dados e estados de um jogador segue a máquina de estados abaixo:

```
[Início]
   │
   ▼
[Autenticação (Supabase Auth - Anônima ou Conta)]
   │
   ▼
[Lobby Global] (Canal lobby:presence - Status: 'online')
   │
   ├─► [Criar Sala] ──► RPC: create_room
   │                      │
   └─► [Entrar na Sala] ─► RPC: join_room_by_code
                          │
                          ▼
              [Sala / Lobby da Partida] (Canal room:{room_id})
              - Presença na sala (Status: 'in_room')
              - Troca de mensagens de chat
              - Slot assignment (Jogador 1 vs Jogador 2, ou Espectador)
              - Botão "Pronto" (RPC: set_member_ready)
                          │
                          ▼
              [Início da Partida] (RPC: start_match)
              - Snapshot da composição de jogadores congelado
              - Geração de registro imutável em `matches`
                          │
                          ▼
              [Partida Ativa] (Canal match:{match_id})
              - Carregamento do componente do jogo (ex: TicTacToe)
              - Loop de jogadas via RPC atômica (`submit_game_action`)
              - Broadcast de feedback de baixa latência
              - Monitoramento contínuo de Presence (Status: 'playing')
                          │
            ┌─────────────┴─────────────┐
            │ Queda de Conexão?         │
            ▼                           ▼
      [Sim: Início Grace Period]    [Não: Fim da Partida]
      - Timer no cliente (45s)        - Vitória / Empate
      - Tentativa de reconexão        - RPC: finish_match
      - Se reconectou: State Sync     - Retorno à Sala ou Revanche
      - Se expirou: Derrota por W.O.
```

---

## 5. Modelo de Autoridade da Partida

Em jogos multiplayer, a autoridade define quem decide a validade de uma ação. Existem três abordagens comuns:
1. **Server-authoritative com servidor dedicado (Node/Go/C++)**: Impossível na Vercel serverless sem infraestrutura adicional de alto custo.
2. **Peer-to-Peer / Host-authoritative puro**: O jogador 1 valida as jogadas. Problema: Se o Host trapacear ou desconectar, a partida é corrompida.
3. **Database-authoritative via RPCs Transacionais (Abordagem Adotada)**:
   - Toda jogada que altera o estado oficial da partida passa por uma RPC atômica no PostgreSQL.
   - O banco valida se é o turno do jogador, se a posição é válida, se a partida não foi encerrada e se o tempo limite não expirou.
   - O banco calcula o novo estado ou o resultado final (vitória/empate) de forma determinística e emite o evento via Supabase Realtime para todos os inscritos.
   - **Benefício**: Trapaça impossível por manipulação do cliente, resistência total a quedas de qualquer nó, e compatibilidade nativa com Serverless.
