-- ============================================================================
-- Migration: 20261009040000_activate_carta_duo.sql
-- Project: DuoPlay-Online
-- Phase: Fase 20 — Carta Duo 🃏
-- Description: Ativa o jogo Carta Duo no banco de dados e configura o limite de
--              jogadores para suportar partidas de 2 a 6 competidores.
-- ============================================================================

-- 1. Ativa o jogo 'carta_duo' e atualiza os limites de jogadores para 2-6
UPDATE public.games
SET is_active = true,
    max_players = 6,
    min_players = 2,
    description = 'Clássico jogo por turnos de descarte de cartas baseado em correspondência de cor, número ou símbolo com efeitos especiais surpreendentes.',
    config = '{"category_label": "Turnos", "requires_timer": true, "initial_cards": 7}'::jsonb
WHERE id = 'carta_duo';

-- 2. Garante a desativação de 'card_duo' (ID alternativo/legado) para evitar confusão de registros
UPDATE public.games
SET is_active = false
WHERE id = 'card_duo';
