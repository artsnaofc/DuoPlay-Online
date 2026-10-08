-- ============================================================================
-- Migration: 20261009020000_create_game_registry.sql
-- Project: DuoPlay-Online
-- Phase: Fase 19 — Infraestrutura para Novos Jogos (Game Registry & Categorização)
-- Description: Adiciona colunas game_type e capabilities à tabela public.games,
--              e cadastra o catálogo completo de futuros jogos da plataforma.
-- ============================================================================

-- 1. Adicionar colunas de categorização e metadados na tabela public.games
ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS game_type VARCHAR(50) DEFAULT 'turn_based' NOT NULL,
    ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '{}'::jsonb NOT NULL;

COMMENT ON COLUMN public.games.game_type IS 'Categoria do jogo (ex: real_time, turn_based, word_game, physics_game).';
COMMENT ON COLUMN public.games.capabilities IS 'Metadados e capacidades customizadas suportadas pelo jogo.';

-- 2. Inserir/Atualizar o Catálogo Completo de Jogos da Plataforma DuoPlay Online
INSERT INTO public.games (id, name, description, min_players, max_players, game_type, capabilities, is_active)
VALUES 
    (
        'tic_tac_toe',
        'Jogo da Velha',
        'Clássico jogo de estratégia 3x3 competitivo para 2 jogadores.',
        2,
        2,
        'turn_based',
        '{"realtime": false, "turns": true, "grid": "3x3", "rematch": true}'::jsonb,
        true
    ),
    (
        'snake',
        'Cobrinha Competitiva',
        'Arena multiplayer em tempo real onde cobras disputam espaço e comida.',
        2,
        4,
        'real_time',
        '{"realtime": true, "loop": "60fps", "collision": true}'::jsonb,
        false
    ),
    (
        'pong',
        'Pong',
        'Clássico arcade de rebatida de bola em tempo real 1v1.',
        2,
        2,
        'real_time',
        '{"realtime": true, "paddle": true, "physics": "arcade"}'::jsonb,
        false
    ),
    (
        'card_duo',
        'Carta Duo',
        'Jogo de cartas estratégico com cores, números e ações especiais.',
        2,
        4,
        'turn_based',
        '{"cards": true, "turns": true, "hand": true}'::jsonb,
        false
    ),
    (
        'pool',
        'Sinuca',
        'Simulador de sinuca realista com física de mesa e tacadas.',
        2,
        2,
        'physics_game',
        '{"physics": true, "aim": true, "cue": true}'::jsonb,
        false
    ),
    (
        'domino',
        'Dominó',
        'Jogo de peças encadeadas por números para raciocínio e estratégia.',
        2,
        4,
        'turn_based',
        '{"tiles": true, "turns": true, "matching": true}'::jsonb,
        false
    ),
    (
        'hangman',
        'Jogo da Forca',
        'Adivinhe a palavra secreta letra por letra antes que a forca se complete.',
        1,
        4,
        'word_game',
        '{"words": true, "coop": true, "letters": true}'::jsonb,
        false
    ),
    (
        'adedonha',
        'Adedonha',
        'Famoso jogo de palavras com categorias sob pressão de tempo.',
        2,
        8,
        'word_game',
        '{"words": true, "categories": true, "timer": true}'::jsonb,
        false
    )
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    min_players = EXCLUDED.min_players,
    max_players = EXCLUDED.max_players,
    game_type = EXCLUDED.game_type,
    capabilities = EXCLUDED.capabilities,
    is_active = EXCLUDED.is_active;
