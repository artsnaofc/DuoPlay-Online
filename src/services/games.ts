// ============================================================================
// Service: Game Registry — DuoPlay-Online
// Phase: Fase 19 — Infraestrutura para Novos Jogos
// Description: Registro central de jogos, categorias, metadates e capacidades
//              de forma agnóstica ao core multiplayer.
// ============================================================================

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { GameDTO } from '@/types/multiplayer';

export type GameRegistryEntry = GameDTO;

export interface GamesOperationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

/**
 * Busca todos os jogos ativos registrados no catálogo da plataforma.
 */
export async function fetchActiveGames(): Promise<GamesOperationResult<GameRegistryEntry[]>> {
  if (!isSupabaseConfigured) {
    return { success: false, error: 'Serviço de dados indisponível.' };
  }

  try {
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    const games: GameRegistryEntry[] = (data || []).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      min_players: Number(row.min_players || 2),
      max_players: Number(row.max_players || 2),
      game_type: row.game_type || 'turn_based',
      capabilities: (row.capabilities as Record<string, unknown>) || {},
      is_active: Boolean(row.is_active),
      created_at: row.created_at,
    }));

    return { success: true, data: games };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro inesperado ao buscar jogos ativos.',
    };
  }
}

/**
 * Busca a definição de um jogo específico no registro pelo game_id.
 */
export async function fetchGameDefinition(
  gameId: string
): Promise<GamesOperationResult<GameRegistryEntry>> {
  if (!isSupabaseConfigured || !gameId) {
    return { success: false, error: 'Identificador do jogo inválido.' };
  }

  try {
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single();

    if (error || !data) {
      return { success: false, error: error?.message || 'Jogo não encontrado no registro.' };
    }

    const game: GameRegistryEntry = {
      id: data.id,
      name: data.name,
      description: data.description,
      min_players: Number(data.min_players || 2),
      max_players: Number(data.max_players || 2),
      game_type: data.game_type || 'turn_based',
      capabilities: (data.capabilities as Record<string, unknown>) || {},
      is_active: Boolean(data.is_active),
      created_at: data.created_at,
    };

    return { success: true, data: game };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao buscar definição do jogo.',
    };
  }
}
