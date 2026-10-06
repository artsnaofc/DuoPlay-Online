# Fases de Desenvolvimento (DEVELOPMENT_PHASES.md)

Este documento define a ordem cronológica de implementação, marcos de entrega e critérios de aceite (*Definition of Done*) para a plataforma multiplayer.

---

## Cronograma e Sequência de Fases

| Fase | Título | Foco Principal | Pré-requisito |
| :--- | :--- | :--- | :--- |
| **FASE 0** | **Arquitetura e Documentação** | Especificação técnica completa (Este ciclo). | N/A |
| **FASE 1** | **Estrutura do Projeto e Tooling** | Configuração do Next.js / Vite SPA, Tailwind, PWA e estrutura de pastas. | FASE 0 aprovada |
| **FASE 2** | **Supabase Auth & Sessão** | Autenticação anônima e persistente, perfis e sincronização de token. | FASE 1 |
| **FASE 3** | **Banco de Dados & Migrations** | Criação das tabelas no PostgreSQL com constraints, índices e seeds. | FASE 2 |
| **FASE 4** | **Políticas de Segurança (RLS)** | Aplicação das regras RLS de menor privilégio em todas as tabelas. | FASE 3 |
| **FASE 5** | **PostgreSQL RPCs Transacionais** | Implementação das RPCs (`create_room`, `start_match`, `submit_game_action`...). | FASE 4 |
| **FASE 6** | **Network Engine Base (Connection)**| Singleton do Supabase, ConnectionManager, monitor de latência e ping. | FASE 5 |
| **FASE 7** | **Presence Engine** | Rastreamento global de presença e status no lobby e salas. | FASE 6 |
| **FASE 8** | **Reconnection & Grace Period** | Protocolo de 45 segundos, detecção de queda e State Snapshot resync. | FASE 7 |
| **FASE 9** | **Realtime Channels & Broadcast** | Canais `room:{id}`, `match:{id}` e multiplexação de eventos. | FASE 8 |
| **FASE 10**| **Salas & Lobby Social** | Interface e gerenciador de salas (criar, entrar com código, ready, chat). | FASE 9 |
| **FASE 11**| **Orquestração de Partidas** | Transição de sala para partida, congelamento de slots e controle de turno. | FASE 10 |
| **FASE 12**| **Testes da Infraestrutura de Rede**| Testes de concorrência, simulação de queda de rede, latência artificial. | FASE 11 |
| **FASE 13**| **Implementação do Jogo da Velha** | UI do tabuleiro, consumo da engine via `useGameMatch`, animações e sons. | FASE 12 |
| **FASE 14**| **Testes Integrados & Refinamento** | Testes cruzados entre celular e PC, PWA offline banner, edge cases. | FASE 13 |
| **FASE 15**| **Preparação para Futuros Jogos** | Validação da interface plugável para próximos títulos (Pong, Cobrinha). | FASE 14 |

---

## Critérios de Aceite Detalhados por Fase Crítica

### FASE 5: PostgreSQL RPCs
- [ ] Transações com `FOR UPDATE` impedem concorrência e conflitos de slot.
- [ ] Validações de turno retornam códigos de erro padronizados (`NOT_YOUR_TURN`, etc.).
- [ ] Cálculo determinístico de vitória e empate 100% no servidor.

### FASE 8: Reconnection & Grace Period
- [ ] Bloqueio de tela de celular ou fechamento temporário da aba não remove o jogador da partida imediatamente.
- [ ] Oponente vê notificação com contador decrescente de 45 segundos.
- [ ] Ao reabrir a aba dentro do prazo, o estado da partida é recuperado via snapshot sem perda de dados.
- [ ] Se o prazo estourar, oponente consegue reivindicar vitória por W.O. sem travamentos.

### FASE 13: Jogo da Velha
- [ ] O componente do jogo não importa `@supabase/supabase-js`.
- [ ] Renderização responsiva em telas pequenas (mobile-first) e desktop.
- [ ] Tabuleiro atualiza instantaneamente com animações suaves e indicação clara de vez.
- [ ] Telas de vitória, derrota e empate com opção de solicitar revanche mantendo a mesma sala.
