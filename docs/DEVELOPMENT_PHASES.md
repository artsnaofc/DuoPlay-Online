# Roteiro de Fases de Desenvolvimento — DuoPlay-Online

> **Architecture Version:** 1.0  
> **Status:** Active / Phases 1, 2 and 3 Implemented

Este documento estabelece o cronograma oficial de implementação sequencial para o DuoPlay-Online. Nenhuma fase subsequente deve ser iniciada sem que os critérios de aceite (*Definition of Done*) da fase anterior tenham sido integralmente validados e aprovados.

---

## 1. Cronograma Oficial de 8 Fases

```
[FASE 1] Fundação Frontend (React + Vite + TypeScript + Tailwind + PWA) [CONCLUÍDA]
   │
   ▼
[FASE 2] Supabase + Segurança (Auth, Profiles, RLS, Column Grants, Triggers) [CONCLUÍDA]
   │
   ▼
[FASE 3] Backend Multiplayer (PostgreSQL, RPCs e Autoridade Server-Side) [CONCLUÍDA]
   │
   ▼
[FASE 4] Realtime & Presença (Supabase Realtime, Broadcast, Postgres Changes, Presence) [PENDENTE]
   │
   ▼
[FASE 5] Network Engine (Camada Agnóstica de Rede, Despacho, Sincronização) [PENDENTE]
   │
   ▼
[FASE 6] Jogo da Velha (Validador de Regras Server-Side, Turnos e Engine) [PENDENTE]
   │
   ▼
[FASE 7] Experiência Completa do Usuário (UI, Fluxos de Lobby e Partida, Reconexão) [PENDENTE]
   │
   ▼
[FASE 8] Hardening, Polimento e Deploy Oficial [PENDENTE]
```

---

## 2. Detalhamento e Critérios de Aceite por Fase

### FASE 1: Fundação Frontend [CONCLUÍDA]
- [x] Configuração do ambiente React 19 + Vite com TypeScript.
- [x] Configuração do Tailwind CSS e manifesto PWA.
- [x] Estrutura modular de pastas e componentes.
- [x] Interface limpa, responsiva, com visual de produto final e sem resquícios de debug.

### FASE 2: Supabase + Segurança [CONCLUÍDA]
- [x] Migration `20261005000000_create_profiles.sql` aplicada no banco remoto.
- [x] Tabela `profiles` com RLS e restrições de unicidade/tamanho.
- [x] Blindagem estrita de estatísticas oficiais via Column Grants e trigger `enforce_profile_update_integrity`.
- [x] Trigger automático `handle_new_user` vinculado a `auth.users`.
- [x] Funções com `SECURITY DEFINER`, `search_path = public, pg_temp` e EXECUTE revogado de anon/public.

### FASE 3: Backend Multiplayer [CONCLUÍDA]
- [x] Migration `20261006000000_create_multiplayer_core.sql` criada.
- [x] Catálogo mestre `games` com seed inicial de `tic_tac_toe`.
- [x] Separação estrita entre `rooms` (lobby pré-jogo) e `matches` (partida concreta).
- [x] Suporte arquitetural a qualquer número de competidores através de `match_players` (sem colunas fixas `player1_id`/`player2_id`).
- [x] Código de sala seguro gerado no servidor via `gen_random_bytes(6)` em Base32 (`generate_room_code()`).
- [x] Tabela `room_members` com verificação de papéis (`player`/`spectator`), slots únicos e flag `is_ready`.
- [x] Tabela `matches` com estado mutável serializado (`game_state`), histórico sequencial (`action_history`) e prazos do servidor (`turn_deadline`).
- [x] Composição de jogadores congelada em `match_players` com restrição de unicidade por partida.
- [x] RLS habilitado e ativo em 100% das tabelas multiplayer.
- [x] Mutações diretas (INSERT, UPDATE, DELETE) revogadas para clientes; alterações operacionais exclusivamente via RPCs.
- [x] 7 RPCs atômicas e idempotentes implementadas com `SECURITY DEFINER`:
  1. `create_room`
  2. `join_room_by_code`
  3. `leave_room`
  4. `set_member_ready`
  5. `start_match`
  6. `submit_game_action`
  7. `finish_match`
- [x] Idempotência comprovada contra double-clicks e retries em todas as operações críticas.
- [x] Atualização de estatísticas oficiais no perfil restrita a transações oficiais de sistema (`finish_match`).
- [x] Suíte de testes SQL `supabase/tests/multiplayer_rls_and_rpc_test.sql` com 20 cenários de segurança e regras.

### FASE 4: Realtime & Presença [PENDENTE]
- Multiplexação de canais no Supabase Realtime (Broadcast efêmero e Postgres Changes).
- Rastreamento de presença volátil (`online`, `in_room`, `playing`, `background`, `offline`).
- Princípio de que Realtime não é fonte da verdade (PostgreSQL como autoridade absoluta).

### FASE 5: Network Engine [PENDENTE]
- Fachada universal de rede agnóstica a regras de jogos.
- Gerenciamento de conexão, reconexão transparente e recuperação de snapshot.

### FASE 6: Jogo da Velha [PENDENTE]
- Validador específico de regras do Jogo da Velha (`validate_tic_tac_toe_action`).
- Detecção de vitória e empate em linha, coluna e diagonal.

### FASE 7: Experiência Completa do Usuário [PENDENTE]
- Interfaces de lobby, seleção de jogo, tela de partida e feedback visual em tempo real.

### FASE 8: Hardening, Polimento e Deploy Oficial [PENDENTE]
- Auditoria final de segurança, testes E2E e publicação oficial.
