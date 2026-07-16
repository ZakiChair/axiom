// Génère les triplets --x-rgb depuis les hex existants d'index.css (one-shot Lot A).
// Usage : node apps/web/scripts/gen-rgb-tokens.mjs
import { readFileSync } from "node:fs";

const TOKENS = [
  "--bg", "--surface", "--border", "--text", "--text-dim", "--up", "--down",
  "--accent", "--accent-ink", "--grid", "--crosshair",
  "--serie-1", "--serie-2", "--serie-3", "--serie-4", "--serie-5", "--serie-6",
  "--n-100", "--n-200", "--n-300", "--n-400", "--n-500", "--n-600", "--n-700",
  "--n-800", "--n-900", "--n-950",
  "--ui-emerald", "--ui-emerald-hover", "--ui-cyan", "--ui-amber",
];

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf-8");
const sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, "");
const themes = [":root", ':root[data-theme="bloomberg"]', ':root[data-theme="matrix"]',
  ':root[data-theme="cute"]', ':root[data-theme="aurora"]'];

const hexVersRgb = (hex) => {
  const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join("") : hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" ");
};

for (const sel of themes) {
  // Bloc du sélecteur : du sélecteur à la première '}' (les blocs de thème sont plats).
  const debut = sansCommentaires.indexOf(sel);
  const bloc = sansCommentaires.slice(debut, sansCommentaires.indexOf("}", debut));
  console.log(`\n/* ${sel} — triplets RVB (jumeaux Tailwind <alpha-value>) */`);
  for (const t of TOKENS) {
    const m = bloc.match(new RegExp(`${t}:\\s*(#[0-9a-fA-F]{3,8})`));
    if (!m) { console.log(`  /* MANQUANT: ${t} */`); continue; }
    console.log(`  ${t}-rgb: ${hexVersRgb(m[1])};`);
  }
}
