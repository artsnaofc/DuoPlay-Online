-- ============================================================================
-- Migration: 20261009060000_fix_room_members_slot_column.sql
-- Project: DuoPlay-Online
-- Description: Correção para usar slot_number em room_members no create_room,
--              respeitando o padrão imutável de migrations executadas.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_room(
    p_game_id VARCHAR(50),
    p_name VARCHAR(60),
    p_is_private BOOLEAN DEFAULT true,
    p_max_members INTEGER DEFAULT 4
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_clean_name VARCHAR(60);
    v_code VARCHAR(6);
    v_attempts INTEGER := 0;
    v_norm_game_id VARCHAR(50);
    v_game RECORD;
    v_room RECORD;
    v_max_members INTEGER;
BEGIN
    -- 1. Identificar usuário chamador
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Usuário não autenticado.' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Validar nome da sala
    v_clean_name := trim(p_name);
    IF char_length(v_clean_name) < 2 OR char_length(v_clean_name) > 60 THEN
        RAISE EXCEPTION 'INVALID_NAME: O nome da sala deve ter entre 2 e 60 caracteres.' USING ERRCODE = 'P0002';
    END IF;

    -- 3. Normalizar e validar jogo no catálogo
    v_norm_game_id := replace(p_game_id, '-', '_');
    SELECT * INTO v_game FROM public.games WHERE id = v_norm_game_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'GAME_NOT_FOUND: O jogo especificado não existe ou está inativo.' USING ERRCODE = 'P0003';
    END IF;

    -- 4. Validar e ajustar capacidade respeitando min/max do jogo
    v_max_members := greatest(v_game.min_players, least(coalesce(p_max_members, v_game.max_players), v_game.max_players));

    -- 5. Gerar código único e seguro
    LOOP
        v_code := public.generate_room_code();
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.rooms WHERE code = v_code);
        v_attempts := v_attempts + 1;
        IF v_attempts > 15 THEN
            RAISE EXCEPTION 'INTERNAL_ERROR: Falha ao gerar código único de sala.' USING ERRCODE = 'P0004';
        END IF;
    END LOOP;

    -- 6. Criar sala
    INSERT INTO public.rooms (
        code,
        game_id,
        host_id,
        name,
        status,
        is_private,
        max_members,
        created_at,
        updated_at
    ) VALUES (
        v_code,
        v_game.id,
        v_caller_id,
        v_clean_name,
        'waiting',
        coalesce(p_is_private, true),
        v_max_members,
        now(),
        now()
    ) RETURNING * INTO v_room;

    -- 7. Criar membership do Host (Slot 1, role player) usando slot_number
    INSERT INTO public.room_members (
        room_id,
        user_id,
        role,
        slot_number,
        game_symbol,
        is_ready,
        joined_at
    ) VALUES (
        v_room.id,
        v_caller_id,
        'player',
        1,
        CASE WHEN v_game.id = 'tic_tac_toe' THEN 'X' ELSE '1' END,
        true,
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'room', row_to_json(v_room),
            'member', jsonb_build_object(
                'room_id', v_room.id,
                'user_id', v_caller_id,
                'role', 'player',
                'slot_number', 1,
                'game_symbol', CASE WHEN v_game.id = 'tic_tac_toe' THEN 'X' ELSE '1' END,
                'is_ready', true
            )
        ),
        'error', null
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_room(VARCHAR, VARCHAR, BOOLEAN, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_room(VARCHAR, VARCHAR, BOOLEAN, INTEGER) TO authenticated;
