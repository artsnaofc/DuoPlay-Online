// ============================================================================
// Types: Carta Duo Game State & Interfaces — DuoPlay-Online
// Phase: Fase 20 — Carta Duo 🃏
// Description: Tipos e interfaces estritas para o jogo Carta Duo.
// ============================================================================

import { UserId } from '@/types/multiplayer';

export type CardColor = 'red' | 'blue' | 'yellow' | 'green' | 'wild';

export type CardValue =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'skip'
  | 'reverse'
  | 'draw_two'
  | 'wild'
  | 'wild_draw_four';

export interface CartaDuoCard {
  id: string;
  color: CardColor;
  value: CardValue;
}

export interface CartaDuoState {
  deck: CartaDuoCard[];
  discard_pile: CartaDuoCard[];
  hands: Record<UserId, CartaDuoCard[]>;
  current_color: 'red' | 'blue' | 'yellow' | 'green' | '';
  current_value: string;
  has_drawn: boolean;
  turn_player_id: UserId | null;
  winner_id: UserId | null;
  is_finished: boolean;
  last_move?: {
    action_type: 'play_card' | 'draw_card' | 'pass_turn';
    player_id: UserId;
    card?: CartaDuoCard | null;
  } | null;
}

export interface PlayCardPayload {
  card_id: string;
  chosen_color?: 'red' | 'blue' | 'yellow' | 'green';
}
