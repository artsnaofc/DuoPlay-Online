export type GameStatus = 'development' | 'planned' | 'concept';

export interface PlannedGame {
  id: string;
  title: string;
  tagline: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  status: GameStatus;
  statusLabel: string;
  phaseTarget: string;
  category: string;
  accentColor: string;
  iconName: 'grid' | 'activity' | 'worm';
  features: string[];
}

export interface PlatformPillar {
  title: string;
  subtitle: string;
  description: string;
  iconName: 'layers' | 'zap' | 'shield' | 'smartphone';
}

export interface RoadmapStep {
  phase: string;
  title: string;
  description: string;
  isCurrent?: boolean;
  isCompleted?: boolean;
}
