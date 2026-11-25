import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "../App.jsx";
import ToastHost, { notify } from "../src/components/ToastHost.jsx";
import "../src/styles.css";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/manrope";

function OfflineApp() {
  useEffect(() => {
    const onError = (event) => notify(event.detail?.message || "Não foi possível salvar uma alteração neste navegador.");
    window.addEventListener("central:storage-error", onError);
    return () => window.removeEventListener("central:storage-error", onError);
  }, []);
  // sem onSignOut: a versão em arquivo não tem conta Google
  return <><App /><ToastHost /></>;
}

createRoot(document.getElementById("root")).render(<OfflineApp />);
