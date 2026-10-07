// ============================================================================
// Service: Player Profile — DuoPlay-Online
// Phase: Fase 12 — Perfil do Jogador + Identidade da Plataforma
// Description: Gerenciamento autoritativo de perfis de jogadores, consulta pública
//              com cache inteligente, validação estrita de username e estatísticas.
// ============================================================================

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { ProfileRow, ProfileUpdate } from '@/types/database';

export interface PlayerProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  totalMatches: number;
  totalWins: number;
  totalDraws: number;
  totalLosses: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
  rating: number;
  xp: number;
  level: number;
  createdAt: string;
}

export interface PublicPlayerProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  totalMatches: number;
  totalWins: number;
  totalDraws: number;
  totalLosses: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
  rating: number;
  xp: number;
  level: number;
  createdAt: string;
}

export interface ProfileUpdateInput {
  username?: string;
  displayName?: string;
  avatarUrl?: string | null;
}

export interface ProfileOperationResult<T = PlayerProfile> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

// Avatares temáticos predefinidos do DuoPlay
export const PRESET_AVATARS: { id: string; label: string; url: string }[] = [
  {
    id: 'cyber_warrior',
    label: 'Cyber Warrior',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=cyber_warrior&backgroundColor=1e1b4b',
  },
  {
    id: 'neon_pilot',
    label: 'Neon Pilot',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=neon_pilot&backgroundColor=0f172a',
  },
  {
    id: 'retro_hero',
    label: 'Pixel Hero',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=retro_hero&backgroundColor=312e81',
  },
  {
    id: 'shadow_ninja',
    label: 'Shadow Rogue',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=shadow_ninja&backgroundColor=18181b',
  },
  {
    id: 'mystic_mage',
    label: 'Mystic Mage',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=mystic_mage&backgroundColor=2e1065',
  },
  {
    id: 'cosmic_vanguard',
    label: 'Cosmic Guard',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=cosmic_vanguard&backgroundColor=022c22',
  },
  {
    id: 'arcade_bot',
    label: 'Arcade Bot',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=arcade_bot&backgroundColor=3b0764',
  },
  {
    id: 'legend_phoenix',
    label: 'Phoenix Flame',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=legend_phoenix&backgroundColor=450a0a',
  },
];

// Cache em memória para perfis públicos com TTL de 60 segundos
const publicProfileCache = new Map<string, { profile: PublicPlayerProfile; timestamp: number }>();
const CACHE_TTL_MS = 60_000;

export function mapRowToPlayerProfile(row: ProfileRow): PlayerProfile {
  const matches = row.total_matches || 0;
  const wins = row.total_wins || 0;
  const winRate = matches > 0 ? Math.round((wins / matches) * 100) : 0;
  const xp = row.xp || 0;
  const level = row.level || Math.max(1, 1 + Math.floor(xp / 200));

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    avatarUrl: row.avatar_url || null,
    totalMatches: matches,
    totalWins: wins,
    totalDraws: row.total_draws || 0,
    totalLosses: row.total_losses || 0,
    winRate,
    currentStreak: row.current_streak || 0,
    bestStreak: row.best_streak || 0,
    rating: row.rating !== undefined ? row.rating : 1000,
    xp,
    level,
    createdAt: row.created_at,
  };
}

export function validateUsername(username: string): { isValid: boolean; error?: string } {
  const trimmed = username.trim().toLowerCase();
  if (trimmed.length < 3) {
    return { isValid: false, error: 'O nome de usuário deve conter no mínimo 3 caracteres.' };
  }
  if (trimmed.length > 32) {
    return { isValid: false, error: 'O nome de usuário deve conter no máximo 32 caracteres.' };
  }
  if (!/^[a-z0-9_]{3,32}$/.test(trimmed)) {
    return {
      isValid: false,
      error: 'O nome de usuário pode conter apenas letras minúsculas (a-z), números (0-9) e sublinhado (_).',
    };
  }
  return { isValid: true };
}

export function validateDisplayName(name: string): { isValid: boolean; error?: string } {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { isValid: false, error: 'O nome de exibição deve conter no mínimo 2 caracteres.' };
  }
  if (trimmed.length > 50) {
    return { isValid: false, error: 'O nome de exibição deve conter no máximo 50 caracteres.' };
  }
  return { isValid: true };
}

/**
 * Consulta o perfil completo do próprio usuário autenticado.
 */
export async function fetchMyProfile(userId: string): Promise<ProfileOperationResult<PlayerProfile>> {
  if (!isSupabaseConfigured || !userId) {
    return { success: false, error: 'Identificador de usuário ou serviço indisponível.' };
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    if (!data) {
      return { success: false, error: 'Perfil não encontrado.' };
    }

    const mapped = mapRowToPlayerProfile(data as ProfileRow);
    return { success: true, data: mapped };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro inesperado ao consultar perfil.',
    };
  }
}

/**
 * Consulta o perfil público de outro jogador por userId.
 * Utiliza cache local para evitar queries redundantes.
 */
export async function fetchPublicProfile(userId: string): Promise<ProfileOperationResult<PublicPlayerProfile>> {
  if (!isSupabaseConfigured || !userId) {
    return { success: false, error: 'Identificador de jogador inválido.' };
  }

  // Verifica cache ativo
  const cached = publicProfileCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { success: true, data: cached.profile };
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    if (!data) {
      return { success: false, error: 'Perfil do jogador não encontrado.' };
    }

    const profile = mapRowToPlayerProfile(data as ProfileRow);
    publicProfileCache.set(userId, { profile, timestamp: Date.now() });

    return { success: true, data: profile };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao buscar perfil público.',
    };
  }
}

/**
 * Atualiza os campos editáveis do perfil do usuário autenticado.
 * Apenas username, display_name e avatar_url são aceitos.
 */
export async function updateMyProfile(
  userId: string,
  input: ProfileUpdateInput
): Promise<ProfileOperationResult<PlayerProfile>> {
  if (!isSupabaseConfigured || !userId) {
    return { success: false, error: 'Serviço indisponível ou usuário não autenticado.' };
  }

  const updates: ProfileUpdate = {};

  if (input.username !== undefined) {
    const cleanUsername = input.username.trim().toLowerCase();
    const validation = validateUsername(cleanUsername);
    if (!validation.isValid) {
      return { success: false, error: validation.error, code: 'INVALID_USERNAME' };
    }
    updates.username = cleanUsername;
  }

  if (input.displayName !== undefined) {
    const cleanDisplayName = input.displayName.trim();
    const validation = validateDisplayName(cleanDisplayName);
    if (!validation.isValid) {
      return { success: false, error: validation.error, code: 'INVALID_DISPLAY_NAME' };
    }
    updates.display_name = cleanDisplayName;
  }

  if (input.avatarUrl !== undefined) {
    updates.avatar_url = input.avatarUrl ? input.avatarUrl.trim() : null;
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      // Violação de chave única no username (Postgres 23505)
      if (error.code === '23505') {
        return {
          success: false,
          error: 'Este nome de usuário já está em uso por outro jogador. Escolha outro.',
          code: 'USERNAME_TAKEN',
        };
      }
      // Violação de constraint de formato/tamanho (Postgres 23514)
      if (error.code === '23514') {
        return {
          success: false,
          error: 'O formato do nome de usuário não atende às regras do sistema.',
          code: 'INVALID_FORMAT',
        };
      }

      return {
        success: false,
        error: error.message || 'Falha ao atualizar perfil.',
        code: error.code,
      };
    }

    if (!data) {
      return { success: false, error: 'Não foi possível confirmar a atualização do perfil.' };
    }

    const mapped = mapRowToPlayerProfile(data as ProfileRow);
    // Invalida do cache
    publicProfileCache.set(userId, { profile: mapped, timestamp: Date.now() });

    return { success: true, data: mapped };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao atualizar perfil.',
      code: 'UNEXPECTED_ERROR',
    };
  }
}
