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

function fichiersTs(dossier: string): string[] {
  return readdirSync(join(SRC, dossier))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(".test."))
    .map((f) => join(dossier, f));
}

describe("garde-fous couleurs (revue v2)", () => {
  it("chart/ : aucun hex hors repli/rampe documentés", () => {
    // Lignes autorisées : replis explicites de lireTokenCanvas/serieCanvas, rampes
    // esthétiques theme-aware (RAMPE_*, VIRIDIS) et replis RVB (FALLBACK).
    const AUTORISEE = /repli|REPLI|lireTokenCanvas|serieCanvas|rgbaTokenCanvas|RAMPE|VIRIDIS|FALLBACK/;
    const HEX = /#[0-9a-fA-F]{3,8}\b/;
    const infractions: string[] = [];
    for (const f of fichiersTs("chart")) {
      const lignes = readFileSync(join(SRC, f), "utf-8").split("\n");
      lignes.forEach((l, i) => {
        if (HEX.test(l) && !AUTORISEE.test(l)) infractions.push(`${f}:${i + 1} ${l.trim()}`);
      });
    }
    expect(infractions).toEqual([]);
  });

  it("components/ : aucune classe Tailwind de palette brute non thémée", () => {
    // Seules neutral/emerald/cyan/amber sont remappées par thème (tailwind.config.js).
    // Toute autre teinte de la palette Tailwind ignore les 5 skins.
    const BRUTE =
      /\b(?:bg|text|border|ring|accent|from|to|via)-(?:red|orange|yellow|lime|green|teal|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|stone)-[0-9]{2,3}\b/;
    const infractions: string[] = [];
    for (const f of fichiersTs("components")) {
      const lignes = readFileSync(join(SRC, f), "utf-8").split("\n");
      lignes.forEach((l, i) => {
        if (BRUTE.test(l)) infractions.push(`${f}:${i + 1} ${l.trim()}`);
      });
    }
    expect(infractions).toEqual([]);
  });
});
