// ============================================================================
// Service: Achievements & Badges — DuoPlay-Online
// Phase: Fase 18 — Conquistas e Badges
// Description: Serviços para consulta de conquistas de jogadores, carregamento de
//              progresso e mapeamento de badges.
// ============================================================================

import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface Achievement {
  achievementId: string;
  code: string;
  name: string;
  description: string;
  iconBadge: string;
  category: string;
  conditionType: string;
  conditionValue: number;
  unlocked: boolean;
  unlockedAt: string | null;
  progress: number;
}

export interface AchievementOperationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

/**
 * Busca a lista completa de conquistas ativas de um jogador com progresso e estado de desbloqueio.
 */
export async function fetchUserAchievements(
  userId: string
): Promise<AchievementOperationResult<Achievement[]>> {
  if (!isSupabaseConfigured || !userId) {
    return { success: false, error: 'Identificador do jogador inválido.' };
  }

  try {
    const { data, error } = await supabase.rpc('get_user_achievements', {
      p_user_id: userId,
    });

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    const achievements: Achievement[] = (data as any[] || []).map((row) => ({
      achievementId: row.achievement_id,
      code: row.code,
      name: row.name,
      description: row.description,
      iconBadge: row.icon_badge,
      category: row.category,
      conditionType: row.condition_type,
      conditionValue: Number(row.condition_value),
      unlocked: Boolean(row.unlocked),
      unlockedAt: row.unlocked_at || null,
      progress: Math.min(Number(row.condition_value), Number(row.progress || 0)),
    }));

    return { success: true, data: achievements };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro inesperado ao buscar conquistas do jogador.',
    };
  }
}
