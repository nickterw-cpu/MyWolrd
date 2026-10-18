import React, { useCallback, useEffect, useState } from "react";
import App from "../App.jsx";
import { clearUserDataCache } from "./lib/userData.js";
import { getSupabase, supabaseConfigError } from "./lib/supabase.js";

export default function AppShell() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [storageError, setStorageError] = useState("");

  const supabase = supabaseConfigError ? null : getSupabase();

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setLoading(false);
      if (!nextSession) clearUserDataCache();
    });

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) throw error;
      setSession(data.session);
      setLoading(false);
    }).catch((error) => {
      if (!active) return;
      setAuthError(error instanceof Error ? error.message : "Não foi possível verificar sua sessão.");
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    const showStorageError = (event) => {
      setStorageError(event.detail?.message || "Não foi possível salvar uma alteração no Supabase.");
    };
    window.addEventListener("central:storage-error", showStorageError);
    return () => window.removeEventListener("central:storage-error", showStorageError);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setAuthError("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Não foi possível iniciar o acesso com Google.");
    }
  }, [supabase]);

  const signOut = useCallback(async () => {
    setAuthError("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      clearUserDataCache();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Não foi possível sair da conta.");
    }
  }, [supabase]);

  if (supabaseConfigError) {
    return (
      <main className="auth-screen">
        <section className="auth-card" role="alert">
          <h1>Configuração necessária</h1>
          <p>{supabaseConfigError}</p>
          <p>Copie <code>.env.example</code> para <code>.env.local</code>, preencha as credenciais do projeto e reinicie o servidor.</p>
        </section>
      </main>
    );
  }

  if (loading) {
    return <main className="auth-screen"><p>Verificando sua sessão…</p></main>;
  }

  if (!session) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <h1>✦ Central</h1>
          <p>Entre com sua conta Google para acessar e sincronizar seus dados.</p>
          {authError && <div className="auth-error" role="alert">{authError}</div>}
          <button className="auth-button" onClick={signInWithGoogle}>Continuar com Google</button>
        </section>
      </main>
    );
  }

  return (
    <>
      <App key={session.user.id} onSignOut={signOut} />
      {storageError && (
        <div className="storage-error" role="alert">
          {storageError}
          <button onClick={() => setStorageError("")} aria-label="Fechar aviso">Fechar</button>
        </div>
      )}
      {authError && (
        <div className="storage-error" role="alert">
          {authError}
          <button onClick={() => setAuthError("")} aria-label="Fechar aviso">Fechar</button>
        </div>
      )}
    </>
  );
}
