# Jogo da Forca (Hangman)

## Regras
- Duelo de dois jogadores, melhor de cinco rodadas (a partida termina antes se alguém alcançar três pontos).
- O jogador do slot 1 escolhe a palavra nas rodadas ímpares; o slot 2 nas pares.
- O outro jogador adivinha letras; há seis erros permitidos. Acertar a palavra concede um ponto ao adivinhador; esgotar as tentativas concede o ponto a quem escolheu a palavra.
- A categoria é selecionada pelo jogador que define a palavra em cada rodada.

## Segurança e estado
A palavra é armazenada em `private.hangman_round_secrets`, no schema `private`, com RLS habilitado e privilégios revogados para `PUBLIC`, `anon` e `authenticated`. O snapshot público contém somente máscara, categoria, letras tentadas, erros e placar. A palavra é incluída no estado público apenas depois de a rodada terminar. As ações `set_word` e `guess_letter` são processadas pelo RPC `submit_game_action` e despachadas para `validate_hangman_action`, com regras autoritativas no PostgreSQL.

## Ativação
1. Aplicar a migration `supabase/migrations/20261013000000_create_hangman_validator.sql` no projeto Supabase.
2. Publicar o frontend que inclui o registro de Hangman.
3. Testar em duas contas autenticadas: iniciar uma sala Hangman, definir palavras alternadamente, tentar repetir letras, forçar uma palavra inválida e concluir cinco rodadas.

## Limitações conhecidas da primeira versão
- A categoria é escolhida a cada rodada junto da palavra, não há ainda uma tela separada de configuração de categoria antes de iniciar a partida.
- A lista de categorias é uma lista fixa no cliente; o servidor valida o texto da categoria, mas não aplica uma enumeração fechada.
- Testes automatizados locais e execução da migration devem ser realizados antes de habilitar em produção.
