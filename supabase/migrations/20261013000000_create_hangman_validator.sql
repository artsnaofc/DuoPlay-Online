-- Hangman authoritative multiplayer rules. The secret answer lives only in a
-- non-exposed schema and is never returned in snapshots until the round ends.
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.hangman_round_secrets (
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number BETWEEN 1 AND 5),
  setter_id uuid NOT NULL REFERENCES public.profiles(id),
  word text NOT NULL,
  category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, round_number)
);

ALTER TABLE private.hangman_round_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON private.hangman_round_secrets FROM PUBLIC, anon, authenticated;

INSERT INTO public.games (id, name, description, min_players, max_players, is_active)
VALUES ('hangman', 'Jogo da Forca', 'Duelo alternado de palavras em melhor de cinco rodadas.', 2, 2, true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  min_players = 2,
  max_players = 2,
  is_active = true;

CREATE OR REPLACE FUNCTION public.validate_hangman_action(
  p_match_id uuid,
  p_player_id uuid,
  p_action_type varchar(50),
  p_payload jsonb,
  p_current_state jsonb,
  p_turn_number integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_p1 uuid;
  v_p2 uuid;
  v_round integer := COALESCE((p_current_state->>'round')::integer, 1);
  v_phase text := COALESCE(p_current_state->>'phase', 'choose_word');
  v_setter uuid;
  v_guesser uuid;
  v_word text;
  v_category text;
  v_letter text;
  v_guesses text[] := ARRAY[]::text[];
  v_mask text;
  v_mistakes integer := 0;
  v_scores jsonb := COALESCE(p_current_state->'scores', '{}'::jsonb);
  v_p1_score integer;
  v_p2_score integer;
  v_round_winner uuid;
  v_next_setter uuid;
  v_next_guesser uuid;
  v_finished boolean := false;
  v_new_state jsonb;
  v_i integer;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD' USING ERRCODE = 'P0035';
  END IF;

  SELECT mp.user_id INTO v_p1 FROM public.match_players mp
    WHERE mp.match_id = p_match_id AND mp.slot = 1;
  SELECT mp.user_id INTO v_p2 FROM public.match_players mp
    WHERE mp.match_id = p_match_id AND mp.slot = 2;
  IF v_p1 IS NULL OR v_p2 IS NULL THEN
    RAISE EXCEPTION 'INVALID_MATCH_PLAYERS' USING ERRCODE = 'P0036';
  END IF;
  IF p_player_id IS DISTINCT FROM v_p1 AND p_player_id IS DISTINCT FROM v_p2 THEN
    RAISE EXCEPTION 'NOT_MATCH_PLAYER' USING ERRCODE = 'P0018';
  END IF;
  IF v_round < 1 OR v_round > 5 THEN
    RAISE EXCEPTION 'INVALID_ROUND' USING ERRCODE = 'P0035';
  END IF;

  -- Setter alternates each round: slot 1 sets odd rounds, slot 2 sets even rounds.
  v_setter := CASE WHEN v_round % 2 = 1 THEN v_p1 ELSE v_p2 END;
  v_guesser := CASE WHEN v_setter = v_p1 THEN v_p2 ELSE v_p1 END;

  IF p_action_type = 'set_word' THEN
    IF v_phase <> 'choose_word' OR p_player_id <> v_setter THEN
      RAISE EXCEPTION 'NOT_WORD_SETTER_OR_WRONG_PHASE' USING ERRCODE = 'P0019';
    END IF;
    IF jsonb_typeof(p_payload->'word') <> 'string'
       OR jsonb_typeof(p_payload->'category') <> 'string' THEN
      RAISE EXCEPTION 'INVALID_WORD_PAYLOAD' USING ERRCODE = 'P0035';
    END IF;

    v_word := lower(regexp_replace(trim(p_payload->>'word'), '[^[:alpha:]]', '', 'g'));
    v_category := trim(p_payload->>'category');
    IF char_length(v_word) < 3 OR char_length(v_word) > 16
       OR v_word !~ '^[[:alpha:]]+$' OR char_length(v_category) < 2
       OR char_length(v_category) > 32 THEN
      RAISE EXCEPTION 'INVALID_WORD_OR_CATEGORY' USING ERRCODE = 'P0035';
    END IF;
    IF EXISTS (SELECT 1 FROM private.hangman_round_secrets
               WHERE match_id = p_match_id AND round_number = v_round) THEN
      RAISE EXCEPTION 'WORD_ALREADY_SET' USING ERRCODE = 'P0032';
    END IF;

    INSERT INTO private.hangman_round_secrets(match_id, round_number, setter_id, word, category)
    VALUES (p_match_id, v_round, p_player_id, v_word, v_category);

    v_mask := (SELECT string_agg('_', ' ' ORDER BY n)
               FROM generate_series(1, char_length(v_word)) n);
    v_new_state := jsonb_build_object(
      'round', v_round, 'phase', 'guessing', 'category', v_category,
      'setter_id', v_setter, 'guesser_id', v_guesser,
      'masked_word', v_mask, 'word_length', char_length(v_word),
      'guessed_letters', '[]'::jsonb, 'mistakes', 0, 'max_mistakes', 6,
      'scores', jsonb_build_object(v_p1::text, COALESCE((v_scores->>v_p1::text)::integer,0),
                                   v_p2::text, COALESCE((v_scores->>v_p2::text)::integer,0)),
      'last_round_winner_id', null, 'revealed_word', null
    );
    RETURN jsonb_build_object('accepted', true, 'new_state', v_new_state,
      'next_player_id', v_guesser, 'winner_id', null, 'is_draw', false, 'is_finished', false);
  ELSIF p_action_type = 'guess_letter' THEN
    IF v_phase <> 'guessing' OR p_player_id <> v_guesser THEN
      RAISE EXCEPTION 'NOT_WORD_GUESSER_OR_WRONG_PHASE' USING ERRCODE = 'P0019';
    END IF;
    IF jsonb_typeof(p_payload->'letter') <> 'string' THEN
      RAISE EXCEPTION 'INVALID_LETTER' USING ERRCODE = 'P0035';
    END IF;
    v_letter := lower(p_payload->>'letter');
    IF char_length(v_letter) <> 1 OR v_letter !~ '^[[:alpha:]]$' THEN
      RAISE EXCEPTION 'INVALID_LETTER' USING ERRCODE = 'P0035';
    END IF;

    SELECT s.word, s.category INTO v_word, v_category
      FROM private.hangman_round_secrets s
      WHERE s.match_id = p_match_id AND s.round_number = v_round AND s.setter_id = v_setter;
    IF v_word IS NULL THEN RAISE EXCEPTION 'SECRET_NOT_FOUND' USING ERRCODE = 'P0036'; END IF;

    SELECT COALESCE(array_agg(value), ARRAY[]::text[]) INTO v_guesses
      FROM jsonb_array_elements_text(COALESCE(p_current_state->'guessed_letters','[]'::jsonb));
    IF v_letter = ANY(v_guesses) THEN RAISE EXCEPTION 'LETTER_ALREADY_GUESSED' USING ERRCODE = 'P0032'; END IF;
    v_guesses := array_append(v_guesses, v_letter);
    v_mistakes := COALESCE((p_current_state->>'mistakes')::integer, 0)
      + CASE WHEN position(v_letter in v_word) = 0 THEN 1 ELSE 0 END;

    SELECT string_agg(CASE WHEN substring(v_word FROM n FOR 1) = ANY(v_guesses)
                           THEN substring(v_word FROM n FOR 1) ELSE '_' END, ' ' ORDER BY n)
      INTO v_mask FROM generate_series(1, char_length(v_word)) n;
    IF replace(v_mask, ' ', '') = v_word THEN
      v_round_winner := v_guesser;
    ELSIF v_mistakes >= 6 THEN
      v_round_winner := v_setter;
    ELSE
      v_round_winner := NULL;
    END IF;

    IF v_round_winner IS NULL THEN
      v_new_state := jsonb_build_object(
        'round', v_round, 'phase', 'guessing', 'category', v_category,
        'setter_id', v_setter, 'guesser_id', v_guesser,
        'masked_word', v_mask, 'word_length', char_length(v_word),
        'guessed_letters', to_jsonb(v_guesses), 'mistakes', v_mistakes,
        'max_mistakes', 6, 'scores', v_scores,
        'last_round_winner_id', null, 'revealed_word', null
      );
      RETURN jsonb_build_object('accepted', true, 'new_state', v_new_state,
        'next_player_id', v_guesser, 'winner_id', null, 'is_draw', false, 'is_finished', false);
    END IF;

    v_p1_score := COALESCE((v_scores->>v_p1::text)::integer, 0) + CASE WHEN v_round_winner = v_p1 THEN 1 ELSE 0 END;
    v_p2_score := COALESCE((v_scores->>v_p2::text)::integer, 0) + CASE WHEN v_round_winner = v_p2 THEN 1 ELSE 0 END;
    v_scores := jsonb_build_object(v_p1::text, v_p1_score, v_p2::text, v_p2_score);
    v_finished := v_round >= 5 OR v_p1_score >= 3 OR v_p2_score >= 3;
    v_next_setter := CASE WHEN (v_round + 1) % 2 = 1 THEN v_p1 ELSE v_p2 END;
    v_next_guesser := CASE WHEN v_next_setter = v_p1 THEN v_p2 ELSE v_p1 END;

    v_new_state := jsonb_build_object(
      'round', CASE WHEN v_finished THEN v_round ELSE v_round + 1 END,
      'phase', CASE WHEN v_finished THEN 'finished' ELSE 'choose_word' END,
      'category', v_category, 'setter_id', v_setter, 'guesser_id', v_guesser,
      'masked_word', v_mask, 'word_length', char_length(v_word),
      'guessed_letters', to_jsonb(v_guesses), 'mistakes', v_mistakes,
      'max_mistakes', 6, 'scores', v_scores,
      'last_round_winner_id', v_round_winner, 'revealed_word', v_word
    );
    RETURN jsonb_build_object('accepted', true, 'new_state', v_new_state,
      'next_player_id', CASE WHEN v_finished THEN null ELSE v_next_setter END,
      'winner_id', CASE WHEN v_finished AND v_p1_score <> v_p2_score THEN
        CASE WHEN v_p1_score > v_p2_score THEN v_p1 ELSE v_p2 END ELSE null END,
      'is_draw', v_finished AND v_p1_score = v_p2_score,
      'is_finished', v_finished);
  ELSE
    RAISE EXCEPTION 'INVALID_ACTION_TYPE' USING ERRCODE = 'P0034';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_hangman_action(uuid, uuid, varchar, jsonb, jsonb, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dispatch_game_action(
    p_game_id varchar(50), p_match_id uuid, p_player_id uuid, p_action_type varchar(50),
    p_payload jsonb, p_current_state jsonb, p_turn_number integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_game_id = 'tic_tac_toe' THEN
    RETURN public.validate_tic_tac_toe_action(p_match_id,p_player_id,p_action_type,p_payload,p_current_state,p_turn_number);
  ELSIF p_game_id = 'hangman' THEN
    RETURN public.validate_hangman_action(p_match_id,p_player_id,p_action_type,p_payload,p_current_state,p_turn_number);
  END IF;
  RAISE EXCEPTION 'GAME_VALIDATOR_NOT_AVAILABLE: As regras deste jogo ainda não estão disponíveis no servidor.' USING ERRCODE = 'P0030';
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_game_action(varchar, uuid, uuid, varchar, jsonb, jsonb, integer) FROM PUBLIC, anon, authenticated;
