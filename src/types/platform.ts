export interface GameItem {
  id: string;
  title: string;
  tagline: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  category: string;
  iconName: 'grid' | 'activity' | 'worm';
  highlights: string[];
  isAvailable: boolean;
}

export interface PlatformFeature {
  title: string;
  subtitle: string;
  description: string;
  iconName: 'zap' | 'shield' | 'smartphone' | 'users';
}

export interface HowItWorksStep {
  number: string;
  title: string;
  description: string;
}
