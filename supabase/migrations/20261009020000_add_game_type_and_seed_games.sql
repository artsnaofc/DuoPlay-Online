-- ============================================================================
-- Migration: 20261009020000_add_game_type_and_seed_games.sql
-- Project: DuoPlay-Online
-- Phase: Fase 19 — Infraestrutura para Novos Jogos
-- Description: Adiciona colunas de game_type e config na tabela de games,
--              e sementa os novos jogos planejados para a plataforma.
-- ============================================================================

-- 1. Adicionar colunas adicionais para categorização e configurações na tabela games
ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS game_type VARCHAR(50) DEFAULT 'turn_based' NOT NULL,
    ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb NOT NULL;

COMMENT ON COLUMN public.games.game_type IS 'Categoria ou estilo técnico do jogo (ex: real_time, turn_based, words, physics).';
COMMENT ON COLUMN public.games.config IS 'Configurações técnicas estruturais e metadados específicos de cada jogo.';

-- 2. Atualizar o Jogo da Velha (tic_tac_toe) com seu game_type correspondente
UPDATE public.games
SET game_type = 'turn_based',
    config = '{"category_label": "Turnos", "requires_timer": true}'::jsonb
WHERE id = 'tic_tac_toe';

-- 3. Cadastrar os novos jogos planejados (inativos no momento)
INSERT INTO public.games (id, name, description, min_players, max_players, is_active, game_type, config)
VALUES
    (
        'snake',
        'Cobrinha Competitiva',
        'Dispute espaço e coma frutas para crescer e cercar seu oponente em tempo real.',
        2,
        2,
        false,
        'real_time',
        '{"category_label": "Tempo Real", "requires_timer": false, "speed": 100}'::jsonb
    ),
    (
        'pong',
        'Pong Arcade',
        'Clássico Pong arcade com física de rebater a bolinha em tempo real.',
        2,
        2,
        false,
        'real_time',
        '{"category_label": "Tempo Real", "requires_timer": false, "ball_speed": 5}'::jsonb
    ),
    (
        'carta_duo',
        'Carta Duo',
        'Jogo de cartas de estratégia e turnos onde o melhor deck vence.',
        2,
        6,
        true,
        'turn_based',
        '{"category_label": "Turnos", "requires_timer": true, "initial_cards": 7}'::jsonb
    ),
    (
        'billiards',
        'Sinuca 8-Ball',
        'Jogo de bilhar clássico com física precisa e tacadas alternadas.',
        2,
        2,
        false,
        'physics',
        '{"category_label": "Física", "requires_timer": true, "table_theme": "classic_green"}'::jsonb
    ),
    (
        'domino',
        'Dominó Duo',
        'Clássico dominó competitivo de turnos rápidos e tática.',
        2,
        2,
        false,
        'turn_based',
        '{"category_label": "Turnos", "requires_timer": true, "max_tile_value": 6}'::jsonb
    ),
    (
        'hangman',
        'Jogo da Forca',
        'Adivinhe a palavra secreta letra por letra antes que o boneco seja desenhado.',
        2,
        2,
        false,
        'words',
        '{"category_label": "Palavras", "requires_timer": true, "max_mistakes": 6}'::jsonb
    ),
    (
        'adedonha',
        'Adedonha (Stop!)',
        'Escreva palavras com a letra sorteada o mais rápido possível nas categorias.',
        2,
        4,
        false,
        'words',
        '{"category_label": "Palavras", "requires_timer": true, "categories": ["Nome", "Animal", "Cor", "Fruta"]}'::jsonb
    )
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    min_players = EXCLUDED.min_players,
    max_players = EXCLUDED.max_players,
    game_type = EXCLUDED.game_type,
    config = EXCLUDED.config;
