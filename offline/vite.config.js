import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Build da versão independente: um único arquivo HTML com tudo embutido (scripts, estilos e fontes).
export default defineConfig({
  root: here,
  base: "./",
  resolve: {
    alias: [
      { find: /^.*\/lib\/userData\.js$/, replacement: path.join(here, "userData.local.js") },
      { find: /^.*\/lib\/supabase\.js$/, replacement: path.join(here, "supabase.stub.js") },
    ],
  },
  build: {
    outDir: path.join(here, "../dist-offline"),
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
