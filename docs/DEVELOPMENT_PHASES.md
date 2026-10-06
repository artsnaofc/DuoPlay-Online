# Roteiro de Fases de Desenvolvimento — DuoPlay Online

> **Architecture Version:** 1.0  
> **Status:** Proposed / Pending Implementation

Este documento estabelece o cronograma oficial de implementação sequencial para o DuoPlay Online. Nenhuma fase subsequente deve ser iniciada sem que os critérios de aceite (*Definition of Done*) da fase anterior tenham sido integralmente validados e aprovados.

---

## 1. Cronograma Oficial de Fases

```
[FASE 0] Arquitetura e Documentação v1.0 (Etapa Atual)
   │
   ▼
[FASE 1] Estrutura Base (React + Vite + TS + Tailwind + PWA)
   │
   ▼
[FASE 2] Supabase Auth (Sessão Anônima e Persistente)
   │
   ▼
[FASE 3] Database (PostgreSQL Schemas, Constraints, Índices)
   │
   ▼
[FASE 4] RLS (Políticas de Row Level Security de Menor Privilégio)
   │
   ▼
[FASE 5] RPCs (Stored Procedures Transacionais e Idempotentes)
   │
   ▼
[FASE 6] Network Engine (Fachada e Estruturas Agnósticas de Dados)
   │
   ▼
[FASE 7] Connection Manager (Lifecycle do Socket, Ping e Latência)
   │
   ▼
[FASE 8] Presence (Rastreamento de Estados: Online, Background, Away)
   │
   ▼
[FASE 9] Reconnect + Grace Period (45s no Servidor, Suspensão do Turno)
   │
   ▼
[FASE 10] Realtime (Multiplexação de Canais, Broadcast e Postgres Changes)
   │
   ▼
[FASE 11] Room (Lobby, Código de Entrada, Ready e Gestão de Host)
   │
   ▼
[FASE 12] Match (Congelamento de Participantes, Turnos e State Snapshot)
   │
   ▼
[FASE 13] Testes da Infraestrutura de Rede (Simulação de Queda e Concorrência)
   │
   ▼
[FASE 14] Jogo da Velha (Implementação da UI, Consumo da Engine via Hook)
   │
   ▼
[FASE 15] Integração Completa e Testes Multiplayer (Mobile + Desktop E2E)
   │
   ▼
[FUTURO] Expansão: Recursos Sociais (Amigos, Chat) e Novos Jogos (Pong, etc.)
```

---

## 2. Detalhamento e Critérios de Aceite por Fase

### FASE 0: Arquitetura e Documentação (Este Ciclo)
- [x] Especificação completa consolidada na versão 1.0 sem contradições entre documentos.
- [x] Stack padronizada em React + Vite + TypeScript + Tailwind + PWA + Vercel + Supabase.
- [x] Network Engine formalmente agnóstica de regras de jogo.
- [x] Separação estrita entre Room (lobby) e Match (composição congelada de jogadores).
- [x] Princípio de autoridade cronológica do servidor no Grace Period.
- [x] **Aprovação formal antes de qualquer código.**

### FASE 1: Estrutura Base do Projeto
- Configuração do ambiente React 19 + Vite com TypeScript.
- Configuração do Tailwind CSS e manifesto PWA.
- Estruturação estrita das pastas: `src/types/`, `src/services/`, `src/network/`, `src/games/`.
- Limpeza de dependências desnecessárias (como referências a servidores Node/Express legados).

### FASE 2: Supabase Auth
- Implementação do client Supabase único (Singleton).
- Fluxo de login de convidado (Anonymous Auth) transparente para acesso imediato.
- Estrutura para posterior vinculação de conta permanente (Email/Google).

### FASE 3: Database
- Criação das tabelas centrais: `profiles`, `games`, `rooms`, `room_members`, `matches`, `match_players`.
- Criação de constraints de unicidade (`UNIQUE (room_id, slot_number)` e `UNIQUE (match_id, slot)`).
- Índices otimizados para busca rápida de salas e partidas.

### FASE 4: Row Level Security (RLS)
- Ativação de RLS em 100% das tabelas.
- Políticas de leitura seguras: salas privadas não expostas via REST.
- Escrita direta proibida via REST nas tabelas operacionais.

### FASE 5: PostgreSQL RPCs
- Criação das funções transacionais com `SECURITY DEFINER` e `SET search_path = public, pg_temp;`.
- Implementação de `create_room`, `join_room_by_code`, `leave_room`, `set_member_ready`, `start_match`, `submit_game_action` (com despachante para validador do jogo), e `finish_match`.
- Validação de idempotência através de IDs de ação e bloqueios `FOR UPDATE`.

### FASE 6: Network Engine Base
- Criação das interfaces de dados genéricas (`GameState`, `GameAction`, `GameEvent`).
- Estrutura da fachada `NetworkEngine`.

### FASE 7: Connection Manager
- Monitoramento de estado físico da rede e do WebSocket.
- Diferenciação entre visibilidade de tela (`visibilitychange`) e perda real de socket.
- Cálculo de ping e latência RTT em tempo real.

### FASE 8: Presence Engine
- Rastreamento dos estados efêmeros (`online`, `in_room`, `playing`, `background`, `reconnecting`, `offline`).
- Garantia de que a presença nunca seja considerada fonte de verdade sobre filiação em salas ou partidas.

### FASE 9: Reconnect & Grace Period
- Protocolo determinístico de 45 segundos governado pelo timestamp do servidor (`clock_timestamp()`).
- Suspensão imediata do `turn_deadline` enquanto durar o Grace Period.
- Recuperação atômica do estado via State Snapshot ao reconectar.

### FASE 10: Realtime Channels
- Configuração e multiplexação dos canais `lobby:presence`, `user:{id}`, `room:{id}` e `match:{id}`.
- Tratamento de eventos de Broadcast efêmeros e escuta de notificações via Postgres Changes.

### FASE 11: Gestão de Salas (Room)
- Interface de lobby social e gerenciador de estado da sala.
- Criação de salas, entrada por código alfanumérico, marcação de pronto e alternância de anfitrião.

### FASE 12: Orquestração de Partidas (Match)
- Transição da sala para a partida através do congelamento da composição em `match_players`.
- Alternância autoritativa de turnos no servidor.

### FASE 13: Testes de Infraestrutura
- Simulação de latência artificial, concorrência simultânea de cliques e corte forçado de rede.
- Validação do comportamento de reconexão em dispositivos móveis.

### FASE 14: Implementação do Jogo da Velha
- Criação do `TicTacToeDefinition` e componentes de tabuleiro em `src/games/tic-tac-toe/`.
- Consumo transparente da infraestrutura através do hook `useGameMatch`.
- Efeitos sonoros, animações e feedback tátil/visual de jogada.

### FASE 15: Integração Completa e Testes E2E
- Testes entre celular e computador com diferentes condições de rede.
- Validação de UX do PWA, instalação em tela inicial e estabilização de release.

*(Fases de Recursos Sociais Avançados e novos jogos como Pong ou Cobrinha serão programadas após a conclusão da Fase 15).*
