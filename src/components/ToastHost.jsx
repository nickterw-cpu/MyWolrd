import React, { useEffect, useState } from "react";

export function notify(message) {
  window.dispatchEvent(new CustomEvent("central:toast", { detail: { message } }));
}

export default function ToastHost() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    const show = (event) => {
      setMessage(event.detail?.message || "A ação foi concluída.");
    };
    window.addEventListener("central:toast", show);
    return () => window.removeEventListener("central:toast", show);
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) return null;
  return (
    <div className="central-toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" onClick={() => setMessage("")} aria-label="Fechar aviso">Fechar</button>
    </div>
  );
}
