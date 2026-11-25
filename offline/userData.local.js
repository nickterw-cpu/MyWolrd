// Versão independente (central.html): os dados ficam no armazenamento deste navegador,
// nas mesmas chaves da versão anterior do arquivo ("central:tasks", "central:finance"…).
function reportStorageError(error) {
  console.error("Erro ao salvar dados neste navegador.", error);
  window.dispatchEvent(new CustomEvent("central:storage-error", {
    detail: {
      message: error && error.name === "QuotaExceededError"
        ? "O espaço do navegador acabou. Apague imagens ou vídeos grandes, ou exporte um backup."
        : "Não foi possível salvar uma alteração neste navegador.",
    },
  }));
}

export async function reloadUserData() {}

export async function storageGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    reportStorageError(error);
    return false;
  }
}

export async function storageDelete(key) {
  try { localStorage.removeItem(key); } catch { /* nada a remover */ }
}

export function clearUserDataCache() {}
