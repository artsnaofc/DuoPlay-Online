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
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
};

export type GameRow = {
  id: string;
  name: string;
  description: string;
  min_players: number;
  max_players: number;
  is_active: boolean;
  created_at: string;
};

export type RoomStatus = 'waiting' | 'starting' | 'in_game' | 'closed';

export type RoomRow = {
  id: string;
  code: string;
  game_id: string;
  host_id: string;
  name: string;
  status: RoomStatus;
  is_private: boolean;
  max_members: number;
  current_match_id: string | null;
  created_at: string;
  updated_at: string;
};

export type MemberRole = 'player' | 'spectator';

export type RoomMemberRow = {
  id: string;
  room_id: string;
  user_id: string;
  role: MemberRole;
  slot_number: number | null;
  is_ready: boolean;
  joined_at: string;
  updated_at: string;
};

export type MatchStatus = 'in_progress' | 'finished' | 'abandoned' | 'cancelled';
export type FinishReason = 'normal' | 'timeout' | 'abandonment' | 'resignation';

export type MatchRow = {
  id: string;
  room_id: string | null;
  game_id: string;
  status: MatchStatus;
  current_turn_player_id: string | null;
  turn_deadline: string | null;
  turn_number: number;
  game_state: Json;
  action_history: Json;
  winner_id: string | null;
  is_draw: boolean;
  finish_reason: FinishReason | null;
  created_at: string;
  started_at: string;
  finished_at: string | null;
};

export type MatchPlayerRow = {
  id: string;
  match_id: string;
  user_id: string;
  slot: number;
  game_symbol: string | null;
  score: number;
  is_winner: boolean;
  disconnected_at: string | null;
  grace_period_expires_at: string | null;
  last_seen_at?: string | null;
  connection_status?: 'connected' | 'disconnected';
  joined_at: string;
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
      games: {
        Row: GameRow;
        Insert: {
          id: string;
          name: string;
          description: string;
          min_players?: number;
          max_players?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          name?: string;
          description?: string;
          min_players?: number;
          max_players?: number;
          is_active?: boolean;
        };
        Relationships: [];
      };
      rooms: {
        Row: RoomRow;
        Insert: {
          id?: string;
          code: string;
          game_id: string;
          host_id: string;
          name: string;
          status?: RoomStatus;
          is_private?: boolean;
          max_members?: number;
          current_match_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: RoomStatus;
          host_id?: string;
          current_match_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rooms_game_id_fkey';
            columns: ['game_id'];
            isOneToOne: false;
            referencedRelation: 'games';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rooms_host_id_fkey';
            columns: ['host_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      room_members: {
        Row: RoomMemberRow;
        Insert: {
          id?: string;
          room_id: string;
          user_id: string;
          role?: MemberRole;
          slot_number?: number | null;
          is_ready?: boolean;
          joined_at?: string;
          updated_at?: string;
        };
        Update: {
          is_ready?: boolean;
          role?: MemberRole;
          slot_number?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'room_members_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'room_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      matches: {
        Row: MatchRow;
        Insert: {
          id?: string;
          room_id?: string | null;
          game_id: string;
          status?: MatchStatus;
          current_turn_player_id?: string | null;
          turn_deadline?: string | null;
          turn_number?: number;
          game_state?: Json;
          action_history?: Json;
          winner_id?: string | null;
          is_draw?: boolean;
          finish_reason?: FinishReason | null;
          created_at?: string;
          started_at?: string;
          finished_at?: string | null;
        };
        Update: {
          status?: MatchStatus;
          current_turn_player_id?: string | null;
          turn_deadline?: string | null;
          turn_number?: number;
          game_state?: Json;
          action_history?: Json;
          winner_id?: string | null;
          is_draw?: boolean;
          finish_reason?: FinishReason | null;
          finished_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'matches_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'matches_game_id_fkey';
            columns: ['game_id'];
            isOneToOne: false;
            referencedRelation: 'games';
            referencedColumns: ['id'];
          }
        ];
      };
      match_players: {
        Row: MatchPlayerRow;
        Insert: {
          id?: string;
          match_id: string;
          user_id: string;
          slot: number;
          game_symbol?: string | null;
          score?: number;
          is_winner?: boolean;
          disconnected_at?: string | null;
          grace_period_expires_at?: string | null;
          joined_at?: string;
        };
        Update: {
          score?: number;
          is_winner?: boolean;
          disconnected_at?: string | null;
          grace_period_expires_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'match_players_match_id_fkey';
            columns: ['match_id'];
            isOneToOne: false;
            referencedRelation: 'matches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_players_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_room: {
        Args: {
          p_game_id: string;
          p_name: string;
          p_is_private?: boolean;
          p_max_members?: number;
        };
        Returns: Json;
      };
      join_room_by_code: {
        Args: {
          p_code: string;
          p_as_spectator?: boolean;
        };
        Returns: Json;
      };
      leave_room: {
        Args: {
          p_room_id: string;
        };
        Returns: Json;
      };
      set_member_ready: {
        Args: {
          p_room_id: string;
          p_is_ready: boolean;
        };
        Returns: Json;
      };
      start_match: {
        Args: {
          p_room_id: string;
        };
        Returns: Json;
      };
      submit_game_action: {
        Args: {
          p_match_id: string;
          p_action_id: string;
          p_action_type: string;
          p_payload: Json;
          p_client_timestamp?: number | null;
        };
        Returns: Json;
      };
      finish_match: {
        Args: {
          p_match_id: string;
          p_reason: string;
          p_winner_id?: string | null;
          p_is_draw?: boolean;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
