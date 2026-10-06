import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const getEnvVar = (key: string): string | undefined => {
  if (typeof import.meta !== 'undefined' && import.meta.env && typeof import.meta.env[key] === 'string') {
    return import.meta.env[key];
  }
  if (typeof process !== 'undefined' && process.env && typeof process.env[key] === 'string') {
    return process.env[key];
  }
  return undefined;
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL') || 'https://placeholder-duoplay.supabase.co';
const supabasePublishableKey = getEnvVar('VITE_SUPABASE_PUBLISHABLE_KEY') || 'placeholder-publishable-key';

export const isSupabaseConfigured = Boolean(
  getEnvVar('VITE_SUPABASE_URL') && getEnvVar('VITE_SUPABASE_PUBLISHABLE_KEY')
);

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'duoplay-online-session',
  },
});
