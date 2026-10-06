# Arquitetura da Plataforma Multiplayer — DuoPlay-Online

> **Architecture Version:** 1.0  
> **Status:** Proposed / Pending Implementation

---

## 1. Visão Geral Executiva

O **DuoPlay-Online** é uma plataforma web multiplayer para jogos casuais e competitivos em tempo real. O foco central desta primeira etapa arquitetural é conceber uma infraestrutura resiliente, modular e desacoplada, na qual a lógica de rede, salas, presença, reconexão e persistência não dependa das regras de qualquer jogo específico.

O **Jogo da Velha (Tic-Tac-Toe)** é o primeiro e único jogo em escopo para a implementação inicial, servindo como validação prática da **Network Engine**. Futuros títulos (como Pong, Cobrinha, Carta Duo) são tratados nesta documentação estritamente como exemplos de extensibilidade futura e **não serão implementados agora**.

---

## 2. Stack Tecnológica Oficial

A stack oficial do projeto é padronizada e unificada:

- **Frontend / Client**: React + Vite + TypeScript
- **Estilização**: Tailwind CSS
- **Suporte Mobile & Desktop**: PWA (Progressive Web App), Mobile-First e Desktop responsivo
- **Plataforma de Deploy / Hospedagem**: Vercel (servindo assets estáticos e SPA)
- **Backend & Dados**: Supabase (PostgreSQL, Supabase Auth, Row Level Security, RPCs, Supabase Realtime)

> **Nota sobre Next.js**: O Next.js **NÃO** faz parte da stack. A arquitetura é 100% baseada em React + Vite.  
> **Nota sobre Express**: O runtime da aplicação não depende de servidor Node.js/Express. O Express presente em dependências iniciais provém de scaffolds de desenvolvimento e **não será utilizado como servidor multiplayer**, devendo ser removido durante a implementação caso não haja necessidade utilitária.

---

## 3. O Vercel NÃO é Servidor Multiplayer

O modelo de execução da Vercel é estritamente serverless e baseado em distribuição de borda (Edge/CDN). Portanto, a arquitetura estabelece as seguintes proibições técnicas:

- **Sem servidor WebSocket próprio mantido pelo Vercel**;
- **Sem processo Node.js ou Express persistente**;
- **Sem estado de multiplayer ou salas mantido em memória da instância**;
- **Sem dependência de sessões fixadas (sticky sessions) ou afinidade de processo**.

### Como o Multiplayer Funciona sem Servidor Persistente:
1. **Conexões WebSocket e Mensageria**: Gerenciadas pelo **Supabase Realtime Cluster**, que provê conexão persistente e distribuída diretamente com os navegadores dos usuários.
2. **Fonte da Verdade e Consistência**: O **PostgreSQL do Supabase** centraliza o estado oficial de salas, partidas e perfis.
3. **Mutações Críticas de Estado**: Executadas exclusivamente através de **PostgreSQL RPCs com transações atômicas**, impedindo fraudes e race conditions sem necessidade de um backend intermediário com estado.

---

## 4. Separação de Camadas e Desacoplamento da Network Engine

A plataforma é estruturada em três camadas independentes:

```
┌─────────────────────────────────────────────────────────────┐
│                       CAMADA DE JOGOS                       │
│                                                             │
│   Jogo da Velha (Único no escopo) │ [Exemplos Futuros: ...] │
│   - Interface visual e componentes de tabuleiro             │
│   - Definição do jogo (GameDefinition)                      │
│   - Validação local e predição otimista de UI               │
│   - Comunica-se APENAS via Network Engine                   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    NETWORK ENGINE (SDK)                     │
│                                                             │
│   - Agnóstica de regras de jogos específicos                │
│   - ConnectionManager      (Conexão, Latência, Ping)        │
│   - PresenceEngine         (Estados de conexão efêmeros)    │
│   - ReconnectionManager    (Grace period, Snapshot Sync)    │
│   - RoomManager            (Lobby, Slots, Prontidão, Host)  │
│   - MatchManager           (Ciclo de partida, Despacho)     │
│   - SocialManager          (Convites, Amigos - Futuro)      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  CAMADA DE INFRAESTRUTURA                   │
│                                                             │
│   Supabase                                                  │
│   - Supabase Auth          (Identidade: Anônima ou Conta)   │
│   - PostgreSQL + RLS       (Fonte da verdade persistente)   │
│   - PostgreSQL RPCs        (Transações atômicas seguras)    │
│   - Validadores de Jogo    (Módulos server-side por game_id)│
│   - Supabase Realtime      (Broker de Mensagens WebSocket)  │
│     * Presence             (Estado online momentâneo)       │
│     * Broadcast            (Eventos efêmeros sub-100ms)     │
│     * Postgres Changes     (Notificação de mutações salvas) │
└─────────────────────────────────────────────────────────────┘
```

### Regras Estritas de Isolamento:
1. **Network Engine Totalmente Agnóstica**: Ela gerencia apenas abstrações genéricas: `GameState`, `GameAction`, `GameEvent`, `Match`, `Room`, `Player`, `Connection`, `Presence`. Ela **não conhece** regras de 3x3, símbolos 'X'/'O', linhas vencedoras ou física de jogo.
2. **Nenhum Jogo Acessa o Supabase Diretamente**: O código do Jogo da Velha nunca importa o cliente Supabase nem faz chamadas diretas a tabelas, canais ou RPCs.

---

## 5. Separação Conceitual entre Room e Match

```
USER
 ↓
ROOM (Lobby de Espera)
 ↓
ROOM MEMBER (Participantes com papéis e prontidão)
 ↓ [start_match]
MATCH (Partida Ativa)
 ↓
MATCH PLAYER (Composição Congelada)
```

- **Room (Sala/Lobby)**:
  - Espaço de agrupamento social dinâmico.
  - Participantes podem entrar, sair, alternar prontidão (`is_ready`) e conversar.
  - Gerenciada pelo anfitrião (`host_id`).
- **Match (Partida)**:
  - Instanciada pela RPC `start_match()`.
  - **Composição de Jogadores Congelada**: No momento da criação, os competidores são registrados de forma fixa na tabela `match_players`.
  - **Estado Mutável via Operações Autorizadas**: O registro da partida em `matches` é mutável durante a disputa (atualizando `status`, `game_state`, `current_turn_player_id`, `turn_number`, `score`, `winner_id`), mas **a lista de competidores é imutável**.
  - Eventuais entradas, saídas ou alterações posteriores na sala não afetam retroativamente os participantes da partida.

---

## 6. Validação Server-Side das Regras dos Jogos

Para preservar a integridade sem acoplar a infraestrutura:
- A RPC de ação do jogo (`submit_game_action`) atua como despachante (*dispatcher*): recebe o `match_id`, identifica o `game_id` associado e invoca a rotina de validação específica daquele jogo (ex: rotina de validação do Jogo da Velha).
- A infraestrutura genérica não possui lógica condicional embutida com regras de tabuleiro no fluxo principal de rede.

---

## 7. Ciclo de Vida da Aplicação

1. **Autenticação**: Supabase Auth (anônima ou autenticada) gera o JWT com `auth.uid()`.
2. **Lobby Global**: Conexão com canal `lobby:presence`.
3. **Criação / Entrada em Sala**: Via RPC `create_room` ou `join_room_by_code`.
4. **Preparação**: Participantes marcam prontidão via `set_member_ready`.
5. **Início da Partida**: Host invoca `start_match`. Jogadores são congelados em `match_players`.
6. **Disputa**: Ações enviadas via RPC transacional, atualizando o `game_state` no banco e notificando os inscritos pelo Supabase Realtime.
7. **Oscilação / Queda**: Queda do socket ativa o **Grace Period de 45s**, suspenso o Turn Deadline até reconexão ou expiração (W.O.).
8. **Encerramento**: Resultado persistido no banco, estatísticas calculadas pelo servidor e retorno opcional à sala para revanche.
