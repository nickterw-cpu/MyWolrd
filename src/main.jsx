import React from "react";
import { createRoot } from "react-dom/client";
import AppShell from "./AppShell.jsx";
import PwaPrompts from "./components/PwaPrompts.jsx";
import ToastHost from "./components/ToastHost.jsx";
import "./styles.css";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/manrope";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <>
      <AppShell />
      <PwaPrompts />
      <ToastHost />
    </>
  </React.StrictMode>
);
