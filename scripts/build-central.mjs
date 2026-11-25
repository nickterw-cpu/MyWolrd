// Gera o central.html (versão independente, sem instalação) a partir do App.jsx atual.
// Uso: npm run build:central
import { build } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist-offline");

await build({ configFile: path.join(root, "offline/vite.config.js"), logLevel: "warn" });

let html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
const assetsDir = path.join(outDir, "assets");
const read = (href) => fs.readFileSync(path.join(outDir, href.replace(/^\.\//, "")), "utf8");

// estilos e script embutidos no próprio HTML (funciona aberto direto do aparelho, sem servidor)
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>${read(href)}</style>`);
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  const code = read(src).replace(/<\/script/gi, "<\\/script");
  return `<script type="module">${code}</script>`;
});
if (/src="\.\/assets\//.test(html) || /href="\.\/assets\//.test(html)) {
  throw new Error("Sobrou arquivo externo no central.html; confira o build.");
}
fs.writeFileSync(path.join(root, "central.html"), html);
fs.rmSync(outDir, { recursive: true, force: true });
console.log(`central.html gerado (${Math.round(html.length / 1024)} KB).`);
if (fs.existsSync(assetsDir)) console.warn("Aviso: a pasta de assets ainda existe.");
