# Registro de Decisões Arquiteturais e Trade-offs (DECISIONS_AND_TRADEOFFS.md)

Este documento registra formalmente as decisões arquiteturais críticas do projeto, avaliando as alternativas consideradas, os motivos da escolha e os impactos futuros no sistema, em cumprimento estrito à **Regra Contra Decisões Ocultas**.

---

## Decisão 1: Modelo de Autoridade de Partida sem Servidor Persistente

### Problema
Como garantir a autoridade da partida, validação de regras e prevenção de trapaça em um ambiente serverless (Vercel) sem um servidor Node.js ou Go mantendo estado persistente em memória?

### Opções
- **Opção A (Host-Authoritative / P2P)**: O jogador que criou a sala (Host) atua como árbitro e valida as jogadas do adversário via WebRTC ou Supabase Broadcast.
- **Opção B (Serverless Edge Function com State Machine)**: Cada jogada invoca uma Edge Function que carrega o estado, executa o reducer e salva no banco.
- **Opção C (Database-Authoritative via PostgreSQL RPCs Transacionais - Recomendada)**: A lógica do árbitro e a validação do tabuleiro residem em uma Stored Procedure (`submit_game_action`) com transação atômica (`FOR UPDATE`) no PostgreSQL do Supabase.

### Opção Recomendada: **Opção C**

### Motivo
- Na Opção A, se o Host fechar a aba ou trapacear deliberadamente no código JS cliente, a partida é corrompida.
- Na Opção B, a Edge Function adiciona um salto de rede adicional (Cliente -> Vercel Edge -> Supabase -> Realtime), aumentando a latência em jogos por turnos.
- Na Opção C, o PostgreSQL garante atomicidade ACID instantânea em menos de 30ms, valida a integridade com `auth.uid()` sem risco de spoofing e notifica via Supabase Realtime diretamente.

### Impacto Futuro
Jogos por turnos (Jogo da Velha, Xadrez, Cartas) utilizam a autoridade transacional no banco com segurança militar. Para futuros jogos contínuos de física de alta taxa de frames (ex: Pong), a engine poderá alternar para um modelo de lockstep determinístico ou host eleito para interpolação de física, sem mudar a camada de dados.

---

## Decisão 2: Formato de Persistência do Tabuleiro e Estado do Jogo

### Problema
Como armazenar o estado interno dos jogos na tabela `matches` permitindo que novos títulos com estruturas completamente diferentes (matriz 3x3 no Jogo da Velha, coordenadas X/Y em Pong, arrays de cartas em Carta Duo) sejam integrados sem necessidade de novas migrações DDL a cada jogo?

### Opções
- **Opção A (Colunas Rígidas)**: Criar tabelas filhas específicas para cada jogo (ex: `tictactoe_boards` com colunas `c0, c1, ... c8`).
- **Opção B (JSONB Serializado com Schema no Código - Recomendada)**: Usar uma coluna `game_state JSONB` e `action_history JSONB` na tabela genérica `matches`.
- **Opção C (Array de Inteiros Simples)**: Usar `INTEGER[]` genérico.

### Opção Recomendada: **Opção B**

### Motivo
JSONB no PostgreSQL é indexável via GIN, oferece operadores nativos para consulta (`->>`, `@>`) e permite extrema flexibilidade estrutural para qualquer tipo de jogo, preservando histórico de jogadas em um único documento imutável.

### Impacto Futuro
Adicionar o jogo Pong ou Cobrinha no futuro exigirá zero alterações no schema SQL de tabelas de partidas.

---

## Decisão 3: Mecânica de Grace Period e Verificação de Timeout

### Problema
Em um ambiente serverless, não existe um loop `setInterval` central do servidor rodando para contar o tempo de abandono de um jogador desconectado. Como declarar a vitória por W.O. com precisão cronológica?

### Opções
- **Opção A (Cron Job periódico a cada minuto)**: Um worker checa partidas abandonadas.
- **Opção B (Confiabilidade no Relógio do Cliente)**: O cliente oponente envia "o tempo dele acabou".
- **Opção C (Verificação Passiva com Timestamp do Servidor na Ação de Reivindicação - Recomendada)**: O banco armazena `turn_deadline` e `grace_period_expires_at` usando `clock_timestamp()` do servidor. Se o tempo estourar, o jogador ativo ou a própria interface aciona a RPC `finish_match(reason: 'timeout')`, onde o PostgreSQL compara a hora real do servidor com o prazo gravado.

### Opção Recomendada: **Opção C**

### Motivo
Elimina a necessidade de servidores ou daemons caros de background. O cálculo é 100% à prova de adulteração do relógio do sistema operacional do jogador.

### Impacto Futuro
A mecânica de relógio suporta partidas rápidas (blitz) e controle de tempo tipo xadrez sem infraestrutura adicional.

---

## Decisão 4: Presença vs Tabela de Membros (Fonte da Verdade)

### Problema
O Supabase Presence é baseado em memória volátil de nós Phoenix/Elixir e pode sofrer quedas temporárias de heartbeat. Como evitar que uma oscilação de presença remova um jogador da sala ou da partida?

### Opções
- **Opção A (Presence como fonte de verdade)**: Se o evento `leave` do Presence for emitido, remove o jogador do banco.
- **Opção B (PostgreSQL como fonte de verdade, Presence como indicador de estado - Recomendada)**: A permanência oficial na sala é governada por `room_members`. A Presença apenas altera uma etiqueta visual na interface (Online, Ausente, Reconectando).

### Opção Recomendada: **Opção B**

### Motivo
Impede desconexões fantasmas e garante que oscilações transitórias de pacotes móveis não expulsem jogadores de suas partidas.

### Impacto Futuro
Resiliência operacional máxima para redes móveis 3G/4G/5G instáveis.
