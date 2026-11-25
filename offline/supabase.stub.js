// A versão independente não entra em conta nem usa o Supabase.
export const supabaseConfigError = "A versão em arquivo (central.html) não usa conta nem sincronização.";

export function getSupabase() {
  throw new Error("A agenda Google precisa da versão web (com login). O arquivo central.html funciona sem internet e sem conta.");
}
