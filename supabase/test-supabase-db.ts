import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qblwqtcdpcgpfiarrjmw.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('Connecting to Supabase:', supabaseUrl);
  const { data, error } = await supabase.from('games').select('*');
  if (error) {
    console.error('Error querying games:', error);
  } else {
    console.log('Games in DB:', data);
  }
}

main();
