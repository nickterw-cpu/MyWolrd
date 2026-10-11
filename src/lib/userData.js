import { getSupabase } from "./supabase.js";

const tableName = "central_user_data";
let activeUserId = null;
let values = new Map();
const pendingWrites = new Map();

function reportStorageError(error) {
  console.error("Erro ao salvar dados no Supabase.", error);
  window.dispatchEvent(new CustomEvent("central:storage-error", {
    detail: { message: error instanceof Error ? error.message : "Não foi possível salvar uma alteração no Supabase." },
  }));
}

export async function reloadUserData() {
  const supabase = getSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error("Sua sessão expirou. Entre novamente com o Google.");

  const { data, error } = await supabase
    .from(tableName)
    .select("key, value")
    .eq("user_id", user.id);
  if (error) throw error;

  activeUserId = user.id;
  values = new Map(data.map((row) => [row.key, row.value]));
}

export async function storageGet(key, fallback) {
  if (!activeUserId) {
    throw new Error("Os dados ainda não foram carregados para esta conta.");
  }
  return values.has(key) ? values.get(key) : fallback;
}

export async function storageSet(key, value) {
  if (!activeUserId) {
    reportStorageError(new Error("Entre novamente para salvar seus dados."));
    return false;
  }

  const userId = activeUserId;
  const previousWrite = pendingWrites.get(key) || Promise.resolve(true);
  const write = previousWrite.then(async () => {
    if (activeUserId !== userId) {
      reportStorageError(new Error("A conta mudou antes de salvar. Entre novamente e tente de novo."));
      return false;
    }

    try {
      const { error } = await getSupabase()
        .from(tableName)
        .upsert({
          user_id: userId,
          key,
          value,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,key" });
      if (error) throw error;
      if (activeUserId === userId) values.set(key, value);
      return true;
    } catch (error) {
      reportStorageError(error);
      return false;
    }
  });
  pendingWrites.set(key, write);
  void write.then(() => {
    if (pendingWrites.get(key) === write) pendingWrites.delete(key);
  });
  return write;
}

export async function storageDelete(key) {
  if (!activeUserId) {
    throw new Error("Os dados ainda não foram carregados para esta conta.");
  }
  const { error } = await getSupabase()
    .from(tableName)
    .delete()
    .eq("user_id", activeUserId)
    .eq("key", key);
  if (error) throw error;
  values.delete(key);
}

export function clearUserDataCache() {
  activeUserId = null;
  values = new Map();
}
