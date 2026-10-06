# Diretrizes de Segurança e Proteção (SECURITY.md)

Este documento descreve a estratégia de segurança, controle de acesso (RLS), mitigação de trapaça (anti-cheat) e proteção contra condições de corrida (*race conditions*).

---

## 1. Autenticação (Supabase Auth)

A plataforma suporta dois modelos de autenticação através do Supabase Auth:
1. **Autenticação Anônima (Guest / Convidado)**:
   - Permite que qualquer usuário no celular ou PC comece a jogar imediatamente sem barreira de cadastro.
   - O Supabase Auth emite um JWT válido com um `sub` (UUID) estável armazenado no `localStorage`.
   - Se o usuário decidir registrar email ou vincular conta Google futuramente, o Supabase Auth promove o usuário anônimo preservando seu `id` e histórico.
2. **Autenticação Permanente (Email / Magic Link / OAuth)**:
   - Preserva estatísticas, histórico de vitórias e lista de amigos entre dispositivos.

Todas as requisições autenticadas enviam o token JWT no cabeçalho `Authorization: Bearer <token>`, permitindo ao PostgreSQL inspecionar `auth.uid()`.

---

## 2. Princípio de Menor Privilégio e Row Level Security (RLS)

O Row Level Security do PostgreSQL é ativado em 100% das tabelas. Como regra geral de segurança:
- **Tabelas são estritamente READ-ONLY via API REST padrão**: O cliente só pode fazer consultas (`SELECT`) com base nas regras de RLS.
- **Toda modificação (`INSERT`, `UPDATE`, `DELETE`) é proibida via REST**: Os clientes não têm permissão de escrita direta nas tabelas `rooms`, `room_members`, `matches` ou `match_players`. Toda alteração de estado passa exclusivamente pelas **RPCs com `SECURITY DEFINER`**.

### Matriz Conceitual de Políticas RLS:

| Tabela | Permissão de SELECT | Permissão de INSERT / UPDATE / DELETE |
| :--- | :--- | :--- |
| `profiles` | Qualquer usuário autenticado pode ver perfis públicos. | Usuário só pode atualizar seu próprio `display_name` e `avatar_url`. Estatísticas (`wins`, `losses`) só são atualizadas por RPCs internas do banco. |
| `games` | Público para leitura (`is_active = true`). | Somente administradores (ou migrations). |
| `rooms` | Qualquer usuário pode ver salas públicas (`is_private = false`). Salas privadas só são visíveis se o usuário for membro ou tiver o código exato. | Somente via RPCs (`create_room`, `leave_room`). |
| `room_members`| Membros da mesma sala podem ver os demais membros. | Somente via RPCs (`join_room_by_code`, `leave_room`, `set_member_ready`). |
| `matches` | Participantes da partida (`match_players`) e espectadores da sala vinculada. | Somente via RPCs (`start_match`, `submit_game_action`, `finish_match`). |
| `match_players`| Visível para participantes e espectadores autorizados da sala. | Somente via RPC (`start_match`). |
| `room_messages`| Apenas membros da sala vinculada (`EXISTS (SELECT 1 FROM room_members WHERE room_id = room_messages.room_id AND user_id = auth.uid())`). | Usuário autenticado membro da sala pode inserir mensagem com `sender_id = auth.uid()`. |
| `friendships` | Usuário pode ver suas próprias relações (`user_id = auth.uid() OR friend_id = auth.uid()`). | Somente via RPCs ou inserção controlada com validação de remetente. |
| `invites` | Destinatário (`receiver_id = auth.uid()`) e remetente (`sender_id = auth.uid()`). | Somente via RPCs (`send_room_invite`, `respond_room_invite`). |

---

## 3. Prevenção Contra Manipulação de Cliente (Anti-Cheat)

Em jogos cliente-servidor web, o cliente JavaScript no navegador nunca é confiável:
1. **Forjamento de Jogada Fora da Vez**:
   - O banco de dados valida se `matches.current_turn_player_id == auth.uid()`. Se não for a vez do remetente, a transação aborta imediatamente com erro `NOT_YOUR_TURN`.
2. **Sobreposição de Jogadas**:
   - No Jogo da Velha, a RPC valida se a posição do array do tabuleiro (`game_state->'board'->p_index`) está estritamente nula. Jogar sobre célula ocupada aborta com `INVALID_MOVE`.
3. **Forjamento de Vitória**:
   - O cliente NÃO envia "eu ganhei". O cliente envia apenas as coordenadas da jogada (`{ cellIndex: 4 }`).
   - É a função interna do PostgreSQL que avalia as 8 combinações de vitória do Jogo da Velha após aplicar a jogada. O cliente não tem nenhum poder de decisão sobre quem venceu.
4. **Adulteração de Estatísticas**:
   - Os campos `total_wins`, `total_draws` e `total_losses` da tabela `profiles` são atualizados internamente pela RPC `submit_game_action` ou `finish_match`. Não existe endpoint que permita a um cliente alterar seus pontos manualmente.

---

## 4. Prevenção Contra Condições de Corrida (*Race Conditions*)

Concorrência e cliques simultâneos podem causar anomalias críticas (ex: dois jogadores ocupando o mesmo slot da sala, ou duas jogadas na mesma casa no mesmo milissegundo).

### Mecanismos de Proteção Implementados:
1. **Bloqueio Pessimista (`SELECT ... FOR UPDATE`)**:
   - Dentro da RPC `join_room_by_code`, a sala é bloqueada com `FOR UPDATE` enquanto a contagem de membros é checada e o novo membro é inserido.
   - Dentro da RPC `submit_game_action`, o registro da partida em `matches` é bloqueado com `FOR UPDATE`. Se ambos os clientes enviarem pacotes no mesmo milissegundo, a segunda transação espera o commit da primeira e é rejeitada por não ser mais o seu turno.
2. **Restrições de Unicidade no Banco (`UNIQUE Constraints`)**:
   - `UNIQUE (room_id, slot_number)`: Garante fisicamente no motor do banco que dois jogadores jamais ocupem o Slot 1 ao mesmo tempo, mesmo que houvesse falha lógica.
   - `UNIQUE (match_id, slot)`: Garante exclusividade de vagas na partida.
3. **Códigos de Sala de Alta Entropia**:
   - O código de 6 caracteres é gerado com alfabeto sem ambiguidades visuais (evitando `0`, `O`, `1`, `I`), fornecendo mais de 1 bilhão de combinações possíveis (`32^6 = 1.073.741.824`), impossibilitando ataques de adivinhação em força bruta.
