import React, { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

export default function PwaPrompts() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisterError(error) {
      console.error("Não foi possível registrar o service worker da Central.", error);
    },
  });
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installHint, setInstallHint] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || window.navigator.standalone === true;
    setIsStandalone(standalone);
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const showInstall = !isStandalone && (installPrompt || isIos);

  const install = async () => {
    if (!installPrompt) {
      setInstallHint((value) => !value);
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  return (
    <div className="pwa-prompts" aria-live="polite">
      {needRefresh && (
        <div className="pwa-prompt">
          <span>Nova versão disponível, atualizar</span>
          <button type="button" onClick={() => updateServiceWorker(true)}>Atualizar</button>
        </div>
      )}
      {showInstall && (
        <div className="pwa-prompt">
          <span>{installHint ? "No Safari, toque em Compartilhar e depois em Adicionar à Tela de Início." : "Instale a Central no seu celular."}</span>
          <button type="button" onClick={install}>{installHint ? "Entendi" : "Instalar app"}</button>
        </div>
      )}
    </div>
  );
}
