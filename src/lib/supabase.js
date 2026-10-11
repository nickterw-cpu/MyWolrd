import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabaseConfigError = !supabaseUrl || !supabaseAnonKey
  ? "As variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não foram configuradas."
  : "";

const supabase = supabaseConfigError
  ? null
  : createClient(supabaseUrl, supabaseAnonKey);

export function getSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError || "Cliente Supabase indisponível.");
  }
  return supabase;
}
