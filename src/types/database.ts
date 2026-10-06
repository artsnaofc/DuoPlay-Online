export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ProfileRow = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  total_matches: number;
  total_wins: number;
  total_draws: number;
  total_losses: number;
  created_at: string;
  updated_at: string;
};

export type ProfileInsert = {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  total_matches?: number;
  total_wins?: number;
  total_draws?: number;
  total_losses?: number;
  created_at?: string;
  updated_at?: string;
};

export type ProfileUpdate = {
  id?: string;
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
  total_matches?: number;
  total_wins?: number;
  total_draws?: number;
  total_losses?: number;
  created_at?: string;
  updated_at?: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey';
            columns: ['id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
