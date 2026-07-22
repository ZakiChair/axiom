import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fous anti-dérive de la revue v2 : le lot d'uniformisation du 9 juillet
 * n'avait AUCUN verrou automatique — 3 semaines plus tard, hex et classes brutes
 * étaient réintroduits partout. Ces tests lisent les sources (vitest node).
 */

const SRC = fileURLToPath(new URL("..", import.meta.url)); // apps/web/src/

// Récursif : les sous-dossiers futurs de chart/ ou components/ restent couverts.
function fichiersTs(dossier: string): string[] {
  return (readdirSync(join(SRC, dossier), { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(".test."))
    .map((f) => join(dossier, f));
}

describe("garde-fous couleurs (revue v2)", () => {
  it("chart/ : aucun hex hors repli/rampe documentés", () => {
    // Allowlist SCOPÉE À L'EXPRESSION (pas à la ligne) : on retire de chaque ligne
    // les formes autorisées — commentaires, arguments de repli des lecteurs de tokens,
    // propriétés/constantes de repli explicites — puis tout hex RESTANT est une
    // infraction. Un hex de dérive co-localisé avec un lireTokenCanvas ne passe plus.
    const COMMENTAIRE = /\/\/.*$|\/\*.*?\*\/|^\s*\*.*$|\/\*.*$/;
    const APPEL_TOKEN = /\b(?:lireTokenCanvas|rgbaTokenCanvas|serieCanvas)\s*\([^)]*\)/g;
    const PROP_REPLI = /\brepli\s*:\s*"#[0-9a-fA-F]{3,8}"/g;
    const CONST_REPLI = /\b(?:const|let)\s+[A-Za-z0-9_]*(?:REPLI|repli)[A-Za-z0-9_]*\s*=\s*"#[0-9a-fA-F]{3,8}"/g;
    const HEX = /#[0-9a-fA-F]{3,8}\b/;
    const infractions: string[] = [];
    for (const f of fichiersTs("chart")) {
      const lignes = readFileSync(join(SRC, f), "utf-8").split("\n");
      lignes.forEach((l, i) => {
        const residuel = l
          .replace(COMMENTAIRE, "")
          .replace(APPEL_TOKEN, "")
          .replace(PROP_REPLI, "")
          .replace(CONST_REPLI, "");
        if (HEX.test(residuel)) infractions.push(`${f}:${i + 1} ${l.trim()}`);
      });
    }
    expect(infractions).toEqual([]);
  });

  it("components/ : aucune classe Tailwind de palette brute non thémée", () => {
    // Toute classe de la palette Tailwind par défaut est suspecte, y compris les
    // familles partiellement remappées : seules les NUANCES réellement déclarées
    // dans tailwind.config.js (var(--n-*)/var(--ui-*)) suivent les 5 thèmes.
    const CLASSE_PALETTE =
      /\b(?:bg|text|border|ring|accent|from|to|via)-((?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-[0-9]{2,3})\b/g;
    const NUANCES_THEMEES = new Set([
      "neutral-100", "neutral-200", "neutral-300", "neutral-400", "neutral-500",
      "neutral-600", "neutral-700", "neutral-800", "neutral-900", "neutral-950",
      "emerald-400", "emerald-500", "cyan-500", "amber-500",
    ]);
    const infractions: string[] = [];
    for (const f of fichiersTs("components")) {
      const lignes = readFileSync(join(SRC, f), "utf-8").split("\n");
      lignes.forEach((l, i) => {
        for (const m of l.matchAll(CLASSE_PALETTE)) {
          const nuance = m[1];
          if (nuance !== undefined && !NUANCES_THEMEES.has(nuance)) {
            infractions.push(`${f}:${i + 1} ${nuance}`);
          }
        }
      });
    }
    expect(infractions).toEqual([]);
  });
});
