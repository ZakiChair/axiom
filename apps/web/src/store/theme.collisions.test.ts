/**
 * Aucune couleur de SÉRIE ne doit valoir un token SÉMANTIQUE (D4).
 *
 * Mesuré sur les cinq thèmes avant correctif : `--ui-amber` — que Tailwind déclare comme
 * l'alias `warn`, « avertissement » — était identique à une couleur de série dans les
 * CINQ ; `--crosshair` dans quatre ; `--accent` dans trois ; et en `aurora`, `--serie-1`
 * valait `--up` et `--serie-6` valait `--down`, si bien qu'une série non sémantique se
 * lisait comme un signal haussier ou baissier. Effet visible : la courbe « Revenus
 * protocole » était peinte exactement dans la couleur d'alerte du produit
 * (revue du 2026-08-01 § 6.4).
 *
 * Le test lit le CSS réel : c'est la seule source de vérité, et un thème ajouté plus tard
 * (la spec en prévoit quatre de plus) est couvert sans rien écrire.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CSS = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), "index.css"), "utf8");

/** Tokens de série (non sémantiques) — leur valeur ne doit rien signifier d'autre. */
const SERIES = Array.from({ length: 6 }, (_, i) => `--serie-${i + 1}`);

/** Tokens à SENS : les confondre avec une série fait mentir la couleur. */
const SEMANTIQUES = ["--accent", "--crosshair", "--up", "--down", "--ui-amber"];

/** Découpe le CSS en blocs de thème → table token → valeur. PURE. */
export function tokensParTheme(css: string): Record<string, Record<string, string>> {
  const blocs = css.split(/\n:root(?:\[data-theme="([a-z]+)"\])?\s*\{/);
  const out: Record<string, Record<string, string>> = {};
  for (let i = 1; i < blocs.length; i += 2) {
    const nom = blocs[i] ?? "dark";
    const corps = blocs[i + 1] ?? "";
    const table = out[nom] ?? {};
    for (const m of corps.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
      const cle = m[1];
      const valeur = m[2];
      if (cle !== undefined && valeur !== undefined) table[cle] = valeur.trim().toLowerCase();
    }
    out[nom] = table;
  }
  return out;
}

const THEMES = tokensParTheme(CSS);

describe("tokensParTheme", () => {
  it("trouve les thèmes du produit", () => {
    expect(Object.keys(THEMES).length).toBeGreaterThanOrEqual(5);
    expect(THEMES.dark?.["--serie-1"]).toBeDefined();
  });
});

describe("collisions série / sémantique", () => {
  it.each(Object.keys(THEMES))("%s : aucune couleur de série n'est un token sémantique", (theme) => {
    const t = THEMES[theme] ?? {};
    const collisions: string[] = [];
    for (const s of SERIES) {
      const valeur = t[s];
      if (valeur === undefined || !valeur.startsWith("#")) continue;
      for (const sem of SEMANTIQUES) {
        if (sem !== undefined && t[sem] === valeur) collisions.push(`${s} = ${sem} (${valeur})`);
      }
    }
    expect(
      collisions,
      `${theme} : ${collisions.join(" · ")} — une série non sémantique ne doit pas porter ` +
        `la couleur de l'accent, du réticule, du haussier, du baissier ni de l'alerte.`
    ).toEqual([]);
  });

  it.each(Object.keys(THEMES))("%s : les six séries sont distinctes entre elles", (theme) => {
    const t = THEMES[theme] ?? {};
    const valeurs = SERIES.map((s) => t[s]).filter((v): v is string => v !== undefined);
    expect(new Set(valeurs).size, `${theme} : deux séries partagent une couleur`).toBe(valeurs.length);
  });
});
