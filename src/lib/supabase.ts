import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

// Klient Supabase z uprawnieniami serwisowymi
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

// Klient publiczny (dla frontendu)
export const supabasePublic = createClient(
    supabaseUrl,
    process.env.SUPABASE_ANON_KEY!
);

export default supabase;
