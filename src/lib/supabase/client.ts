import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase singleton para operaciones directas en la herramienta satélite.
 * Utiliza las variables NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.
 */
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yonkcvfzbezflejwwdtg.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_G8v_l57i3Lt5is20BjDiDw_t0BN8ECb";

export function getSupabaseClient() {
  return createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}
