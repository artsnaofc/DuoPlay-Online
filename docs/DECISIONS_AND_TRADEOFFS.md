# Registro de Decisões Arquiteturais e Trade-offs — DuoPlay Online

> **Architecture Version:** 1.0  
> **Status:** Proposed / Pending Implementation

Este documento registra formalmente as decisões arquiteturais definitivas do DuoPlay Online v1.0, documentando o problema avaliado, as opções consideradas, a recomendação adotada, as justificativas técnicas e os impactos futuros.

---

## Decisão 1: Modelo de Execução Multiplayer sem Servidor Persistente (Vercel)

### Problema
A hospedagem no Vercel opera sob o paradigma serverless, sem possibilidade de manter servidores Node.js permanentes, daemons em segundo plano ou websockets persistentes proprietários. Como viabilizar um multiplayer resiliente com baixa latência e total segurança?

### Opções
- **Opção A (Servidor Node/Express Dedicado fora da Vercel)**: Hospedar um servidor intermediário (Render, Railway, Fly.io).
- **Opção B (P2P via WebRTC / Host-Authoritative)**: Navegadores comunicam-se entre si com o anfitrião validando jogadas.
- **Opção C (Vercel SPA + Supabase Realtime + PostgreSQL RPCs - Adotada)**: O Vercel serve o frontend estático React + Vite. O cluster Supabase Realtime gerencia os WebSockets globais. O PostgreSQL atua como fonte da verdade e validador de regras via RPCs transacionais.

### Decisão Definitiva: **Opção C**

### Motivo
- A Opção A adiciona custo operacional e complexidade desnecessária para uma plataforma de jogos por turnos.
- A Opção B permite manipulação direta pelo anfitrião e quebra se o host fechar o navegador.
- A Opção C entrega consistência ACID garantida pelo banco, escalabilidade global imediata e custo zero de infraestrutura ociosa. O Express existente no projeto atual é herança de template e não fará parte da infraestrutura de execução.

### Impacto Futuro
Arquitetura 100% serverless, sem risco de gargalo de memória de servidor ou servidores caídos.

---

## Decisão 2: Desacoplamento da Network Engine e Regras de Jogos no Backend

### Problema
Como manter a Network Engine completamente agnóstica a regras de jogos específicos (Jogo da Velha hoje, Pong/Cobrinha no futuro) e ao mesmo tempo garantir validação estrita no servidor sem colocar lógicas de tabuleiro dentro da RPC genérica da infraestrutura?

### Opções
- **Opção A (Regras Hardcoded na RPC Genérica)**: Colocar condicionais `IF game == 'tic_tac_toe' THEN ...` dentro de uma RPC central.
- **Opção B (Ações Não Validadas no Servidor)**: Confiar nas jogadas do cliente.
- **Opção C (Despachante Server-Side por `game_id` com Validadores Específicos - Adotada)**: A RPC de ação recebe parâmetros genéricos, consulta o `game_id` da partida e despacha a execução para a rotina de validação específica do jogo correspondente (ex: validador do Jogo da Velha).

### Decisão Definitiva: **Opção C**

### Motivo
Mantém a infraestrutura de rede, salas e partidas intocada quando novos jogos forem introduzidos, enquanto preserva a garantia de que manipulações no cliente não conseguem forjar jogadas ilegais ou vitórias falsas.

---

## Decisão 3: Autoridade Cronológica do Grace Period e Suspensão do Turn Deadline

### Problema
Em redes móveis, o usuário pode perder conexão temporariamente ao bloquear a tela ou trocar de antena. Como gerenciar o retorno do jogador sem depender do relógio do cliente e sem puni-lo injustamente com o estouro do cronômetro da jogada?

### Opções
- **Opção A (Relógio do Cliente)**: O cliente envia mensagens de contagem regressiva.
- **Opção B (Turno Continua Correndo Normal)**: Ignorar a desconexão e deixar o cronômetro do turno zerar.
- **Opção C (Suspensão do Turn Deadline + Grace Period no Servidor - Adotada)**: Ao detectar a queda do socket, o Turn Deadline é suspenso e o servidor registra `grace_period_expires_at = clock_timestamp() + interval '45 seconds'`. Se o jogador retornar antes, o Grace Period é cancelado e o Turn Deadline é retomado com o saldo restante. Se estourar os 45 segundos do servidor, o oponente pode solicitar vitória por W.O.

### Decisão Definitiva: **Opção C**

### Motivo
Regra determinística, livre de ambiguidades ("pausar ou compensar") e imune a fraudes em que o usuário altere a hora local do celular.

---

## Decisão 4: Separação entre Sala (Lobby) e Partida (Match)

### Problema
Como evitar que a entrada ou saída de espectadores ou alterações no lobby durante a partida interfiram nos competidores ativos?

### Opções
- **Opção A (Partida Compartilhando a Tabela de Membros da Sala)**: A partida lê diretamente quem está na sala.
- **Opção B (Composição Congelada em `match_players` - Adotada)**: A criação da partida via `start_match()` gera registros definitivos em `match_players` fixando os participantes. O registro em `matches` é mutável quanto ao estado do jogo (`game_state`, `turn_number`, `status`), mas a composição dos competidores é congelada.

### Decisão Definitiva: **Opção B**

### Motivo
Isola completamente o ciclo de jogo do ciclo social de lobby, garantindo integridade das estatísticas e impossibilidade de substituição indevida de jogadores no meio de uma partida.
