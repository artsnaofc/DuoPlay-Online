# Diretrizes de Segurança e Proteção — DuoPlay-Online

> **Architecture Version:** 1.0  
> **Status:** Active / Hardening Applied (Phases 2 & 3)

Este documento estabelece as diretrizes de segurança, controle de acesso através de Row Level Security (RLS), requisitos estritos para funções `SECURITY DEFINER`, mitigação de concorrência e integridade contra manipulações indevidas.

---

## 1. Princípios de Proteção e Anti-Cheat

> **Declaração Técnica de Segurança**:  
> A manipulação do cliente não pode alterar diretamente o estado oficial da partida.

A integridade do jogo é garantida pelo modelo de validação no servidor:
```
Cliente no Navegador
       │
       ▼ (Solicita ação com parâmetros)
PostgreSQL RPC (SECURITY DEFINER)
       │
       ▼ (Valida identidade, turno, regras do jogo e concorrência)
Estado Oficial Atualizado no Banco de Dados
```

Essa arquitetura elimina a possibilidade de o jogador alterar o estado oficial diretamente por meio de manipulações no console JavaScript, ferramentas de desenvolvedor ou modificações de memória local.  
*(Nota técnica: Este modelo protege a integridade do estado e das regras da partida; não possui a pretensão de impedir automações externas, bots que leiam a tela ou conluio entre usuários fora da plataforma).*

---

## 2. Requisitos Mandatórios para Funções `SECURITY DEFINER`

Como as RPCs transacionais operam com privilégios elevados para atualizar tabelas protegidas, toda função com `SECURITY DEFINER` no PostgreSQL do Supabase deve seguir rigorosamente as seguintes diretrizes:

1. **Definição Explícita de `search_path`**:
   - Toda função deve incluir obrigatoriamente:
     ```sql
     SET search_path = public, pg_temp;
     ```
   - Isso impede ataques de sequestro de caminho de busca (*search path hijacking*).
2. **Identidade Estrita via `auth.uid()`**:
   - A função **NUNCA** deve confiar em parâmetros de `user_id` enviados pelo cliente quando a identidade puder ser obtida diretamente da sessão autenticada.
   - Qualquer operação verifica internamente se `auth.uid()` é válido e não nulo.
3. **Validação de Pertencimento e Autorização**:
   - Antes de modificar uma sala ou partida, a função valida se `auth.uid()` é membro legítimo daquela entidade (`room_members` ou `match_players`).
   - Operações privativas de anfitrião (como `start_match`) validam se `auth.uid() = rooms.host_id`.
4. **Restrição de Execução**:
   - O privilégio público padrão de execução deve ser revogado e concedido explicitamente apenas aos usuários autenticados:
     ```sql
     REVOKE ALL ON FUNCTION public.submit_game_action FROM PUBLIC;
     GRANT EXECUTE ON FUNCTION public.submit_game_action TO authenticated;
     ```
5. **Sanitização e Validação de Parâmetros**:
   - Todos os dados recebidos nos argumentos devem passar por validação de tipo, limites de tamanho e verificação de sanidade antes de qualquer processamento.

---

## 3. Segurança de Salas Privadas

A política de segurança para salas privadas elimina o risco de vazamento de informações:

- **Sem Consulta Direta por Código via RLS**:  
  O código alfanumérico da sala **NÃO** é utilizado como critério de permissão para fazer `SELECT` direto na tabela `rooms` via API REST.
- **Acesso Exclusivo via RPC**:  
  A descoberta e entrada em salas privadas ocorre exclusivamente pela RPC `join_room_by_code(p_code)`.
- **Visibilidade na Tabela**:  
  Um usuário só pode ler registros na tabela `rooms` se:
  1. A sala for pública (`is_private = false`); OU
  2. O usuário já for membro aceito daquela sala (`EXISTS (SELECT 1 FROM room_members WHERE room_id = rooms.id AND user_id = auth.uid())`).

---

## 4. Requisito de Idempotência em Operações Críticas

Operações de rede em conexões móveis frequentemente sofrem com retransmissões automáticas (*retries*), toques duplicados na tela ou reenvio de pacotes pós-reconexão. Para evitar estados inconsistentes ou ações duplicadas, as seguintes operações devem ser estritamente idempotentes:

- `join_room_by_code`: Se o usuário já for membro ativo da sala com aquele código, a RPC retorna os dados da sala sem criar novo registro nem gerar erro.
- `set_member_ready`: Invocações repetidas com o mesmo valor booleano não alteram o estado nem disparam efeitos colaterais.
- `start_match`: O bloqueio transacional (`FOR UPDATE`) garante que duas invocações simultâneas do Host resultem em apenas uma partida instanciada.
- `submit_game_action`: Cada ação carrega um `p_action_id` (UUID). Se o ID já constar no histórico da partida ou se o `turn_number` já tiver avançado, a RPC descarta a repetição e retorna o snapshot atual com sucesso.
- `finish_match`: Se a partida já estiver com status `'finished'`, chamadas subsequentes retornam o resultado consolidado sem alterar vencedores ou recalcular pontuações.

---

## 5. Proteção Contra Condições de Corrida (*Race Conditions*)

Concorrência de cliques e latência de rede são neutralizadas no nível do banco de dados:

1. **Bloqueio Pessimista (`SELECT ... FOR UPDATE`)**:
   - `join_room_by_code` bloqueia a linha da sala para garantir a contagem real de membros antes de alocar um slot.
   - `submit_game_action` bloqueia a linha da partida em `matches`. Caso dois pacotes cheguem em milissegundos próximos, o segundo é enfileirado e processado somente após o commit do primeiro, sendo devidamente rejeitado caso não seja mais o turno do jogador.
2. **Constraints Físicas de Unicidade**:
   - `UNIQUE (room_id, slot_number)` impede fisicamente que dois jogadores ocupem o mesmo slot na sala.
   - `UNIQUE (match_id, slot)` assegura exclusividade de assentos na partida.
   - `UNIQUE (match_id, user_id)` impede duplicidade de um mesmo usuário na mesma partida.

---

## 6. Políticas de RLS e Hardening da Tabela Profiles (Implementadas na Fase 2)

Na Fase 2, a tabela `public.profiles` foi submetida a hardening completo com as seguintes camadas de proteção:

- **Políticas de RLS**:
  - **`profiles_select_own`**: `FOR SELECT TO authenticated USING (auth.uid() = id);`  
    O usuário só pode consultar seu próprio perfil.
  - **`profiles_insert_own`**: `FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);`  
    O usuário só pode criar o perfil vinculado ao seu próprio `auth.uid()`.
  - **`profiles_update_own`**: `FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);`  
    O usuário só pode atualizar o próprio perfil e não pode alterar o ID para outro usuário.
- **Permissões Granulares e Column Grants**:
  - `REVOKE ALL ON public.profiles FROM PUBLIC, anon;`
  - `GRANT SELECT, INSERT ON public.profiles TO authenticated;`
  - `REVOKE UPDATE ON public.profiles FROM authenticated;`
  - `GRANT UPDATE (username, display_name, avatar_url) ON public.profiles TO authenticated;`  
    O cliente autenticado só possui permissão SQL de UPDATE nas 3 colunas editáveis. Tentativas de alterar estatísticas são rejeitadas de imediato pelo PostgreSQL.
- **Blindagem de Estatísticas Oficiais e Campos do Sistema**:
  - Função trigger `public.enforce_profile_update_integrity()`:
    - Impede modificação de `id` e `created_at`.
    - Bloqueia mutações manuais em `total_matches`, `total_wins`, `total_draws`, `total_losses`.
    - *Regra Estrita*: As estatísticas de partidas não podem ser alteradas diretamente pelo cliente. Futuramente serão modificadas somente por operações oficiais do backend/match.
    - Atualiza `updated_at` com o timestamp oficial do servidor (`now()`).
- **Restrição de Funções `SECURITY DEFINER`**:
  - Funções `public.handle_new_user()` e `public.enforce_profile_update_integrity()`:
    - `SET search_path = public, pg_temp;` obrigatório contra search path hijacking.
    - `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;`  
      Nenhum usuário pode executá-las diretamente via RPC ou consulta SQL. Seu acionamento ocorre estritamente pelos triggers do sistema.
- **Auto-Provisionamento Robusto**:
  - `handle_new_user()` trata metadados nulos ou inválidos (como `@@@`), aplicando sanitização com regex `[a-z0-9_]`, validação de comprimento (3 a 32 caracteres) e fallback determinístico `player_<uuid_8>` contra colisões concorrentes.
- **Suíte de Testes de Segurança**:
  - 14 casos de teste implementados em `supabase/tests/profiles_rls_test.sql`, validando isolamento entre usuários, bloqueio de anon, bloqueio de forja de estatísticas e restrição de EXECUTE.

---

## 7. Hardening da Infraestrutura Multiplayer (Fase 3)

A Fase 3 estabelece o PostgreSQL como autoridade absoluta sobre salas, membros e partidas através da migration `20261006010000_harden_multiplayer_core.sql`:

1. **Blindagem contra Declaração Arbitrária de Resultados pelo Cliente**:
   - `finish_match(normal)`: Rejeitado para chamadas diretas de clientes. Apenas o validador server-side das regras do jogo (Fase 6) poderá declarar vitória/empate normal.
   - `finish_match(abandonment)`: Rejeitado nesta fase, evitando simulação falsa de desconexões antes da infraestrutura oficial de Grace Period.
   - `finish_match(resignation)`: Determina o vencedor exclusivamente no servidor. Em 2 jogadores, consagra o oponente; em 3+ jogadores, rejeita resolução de vencedor único não configurada.
   - `finish_match(timeout)`: Valida `clock_timestamp() >= matches.turn_deadline` com o relógio autoritativo do PostgreSQL, desconsiderando timestamps do cliente.
   - Parâmetros `p_winner_id` e `p_is_draw` são desconsiderados de invocações do cliente.
2. **Rotação Determinística de Turnos (1, 2, 3+ Jogadores)**:
   - `dispatch_game_action` calcula o próximo jogador através do próximo `slot` em ordem ascendente, com wrap-around para o menor slot (`1 -> 2 -> ... -> N -> 1`), sem depender de consultas indeterminísticas.
3. **Desacoplamento de Símbolos de Jogo**:
   - `start_match` inicializa `game_symbol = NULL`, delegando a atribuição de símbolos (como X e O) à camada do jogo (Fase 6).
4. **Validação Estrita de Estados de Sala e Membros**:
   - `set_member_ready`: Rejeitado se a sala não estiver em `waiting` ou se o membro for `spectator`.
   - `join_room_by_code`: Rejeita novos jogadores em salas `starting` ou `in_game`. Espectadores podem ingressar em salas `in_game` sem alterar `match_players`.
5. **Imutabilidade Estrita de Perfis**:
   - O trigger `enforce_profile_update_integrity` impede alteração de `id` e `created_at` mesmo em transações internas do sistema (`duoplay.internal_system_operation`).

---

## 8. Gate de Ações e Validação Server-Side (Fase 3.2)

A Fase 3.2 conclui o isolamento da infraestrutura de ações através da migration `20261006030000_gate_game_actions_until_validator.sql`:

1. **Gate Obrigatório de Validador Server-Side**:
   - Nenhuma ação enviada pelo cliente é tratada como jogada oficial enquanto não for processada e aprovada (`accepted = true`) por um validador server-side do respectivo `game_id`.
   - Na ausência de um validador registrado para o jogo, `dispatch_game_action` lança a exceção `GAME_VALIDATOR_NOT_AVAILABLE` (`'P0030'`).
2. **Integridade e Rollback Integral**:
   - Sob ausência de validador ou em ações rejeitadas, a transação é revertida integralmente no PostgreSQL.
   - `game_state`, `action_history`, `turn_number`, `current_turn_player_id`, `turn_deadline`, `winner_id` e `is_draw` permanecem absolutamente inalterados.
3. **`action_history` Estritamente Oficial**:
   - Apenas ações validadas e aceitas pelo servidor são registradas no `action_history`. Tentativas inválidas ou payloads arbitrários não poluem o histórico de auditoria/replay.
4. **Neutralidade de Símbolos (`game_symbol`)**:
   - `start_match` define `game_symbol = NULL` para todos os competidores em `match_players`. A infraestrutura multiplayer é agnóstica a símbolos (`X`, `O`, etc.), delegando essa responsabilidade aos validadores dos jogos na Fase 6.



