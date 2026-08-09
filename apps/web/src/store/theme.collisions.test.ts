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

/**
 * Liste des thèmes faisant AUTORITÉ, lue dans la SOURCE de store/theme.ts — importer le
 * module est impossible ici (il pose [data-theme] sur <html> au chargement, et cet
 * environnement de test n'a pas de DOM). Si la déclaration change de forme, le test
 * échoue en clair plutôt que de retomber sur une liste codée en dur qui dériverait.
 */
function themesProduit(): string[] {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "theme.ts"), "utf8");
  const m = /export const THEMES = \[([^\]]+)\] as const;/.exec(src);
  if (!m || m[1] === undefined) throw new Error("Déclaration THEMES introuvable dans store/theme.ts");
  return [...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1] as string);
}

const THEMES_PRODUIT = themesProduit();

/** Tokens de série (non sémantiques) — leur valeur ne doit rien signifier d'autre. */
const SERIES = Array.from({ length: 6 }, (_, i) => `--serie-${i + 1}`);

/** Tokens à SENS : les confondre avec une série fait mentir la couleur. */
const SEMANTIQUES = ["--accent", "--crosshair", "--up", "--down", "--ui-amber"];

/** Écart perceptuel minimal (OKLab ×100) entre une série et une couleur de signe. */
const ECART_SEMANTIQUE_MIN = 20;

const versLineaire = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

/** Coordonnées OKLab d'un hex #rrggbb. PURE. */
export function oklab(hex: string): [number, number, number] {
  const canal = (i: number): number =>
    versLineaire(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255);
  const r = canal(0);
  const g = canal(1);
  const b = canal(2);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Distance perceptuelle entre deux couleurs (OKLab ×100). PURE. */
export function deltaEOklab(a: string, b: string): number {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return 100 * Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

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
  it("voit EXACTEMENT les thèmes du produit — pas un de moins, pas un fantôme", () => {
    // Recoupement avec la liste faisant AUTORITÉ (store/theme.ts), pas une borne
    // inférieure : un parseur maison qui rate un bloc (nom hyphéné, sélecteur groupé,
    // `:root` indenté) fusionnerait ses tokens dans le bloc PRÉCÉDENT — le thème neuf
    // ne serait pas testé ET le précédent serait testé sur des valeurs qui ne sont pas
    // les siennes, sans un seul rouge. Reproduit par la revue adversariale BCD.
    expect(new Set(Object.keys(THEMES))).toEqual(new Set(THEMES_PRODUIT));
  });

  it.each([...THEMES_PRODUIT])("%s : tous les tokens attendus sont lus, en hex", (theme) => {
    // La garde `!valeur.startsWith("#")` des tests ci-dessous SAUTE silencieusement un
    // token illisible : un thème dont --serie-3 serait écrit en `rgb()` passerait tout.
    // On exige donc ici que chaque token surveillé soit présent ET en hex 6 chiffres.
    const t = THEMES[theme] ?? {};
    const attendus = [...SERIES, "--up", "--down", "--accent", "--surface"];
    const illisibles = attendus.filter((k) => !/^#[0-9a-f]{6}$/.test(t[k] ?? ""));
    expect(
      illisibles,
      `${theme} : tokens absents ou non-hex (le parseur ou le CSS a changé de forme) : ${illisibles.join(", ")}`
    ).toEqual([]);
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

  it.each(Object.keys(THEMES))(
    "%s : aucune série n'est PERCEPTUELLEMENT proche d'une couleur de signe",
    (theme) => {
      // L'égalité exacte ne suffit pas : une série verte à deux pas du vert haussier se
      // LIT comme un signal. Mesuré en OKLab, avec le même seuil que celui qui a servi à
      // générer les palettes. Sans ce test, la première version passait alors qu'en
      // « cute » une série cyan était à ΔE 5,3 de la bougie haussière.
      const t = THEMES[theme] ?? {};
      const signe = ["--up", "--down", "--candle-up", "--candle-down"]
        .map((k) => t[k])
        .filter((v): v is string => v !== undefined && v.startsWith("#"));
      const trop: string[] = [];
      for (const s of SERIES) {
        const v = t[s];
        if (v === undefined || !v.startsWith("#")) continue;
        for (const sem of signe) {
          const d = deltaEOklab(v, sem);
          if (d < ECART_SEMANTIQUE_MIN) trop.push(`${s} (${v}) ↔ ${sem} : ΔE ${d.toFixed(1)}`);
        }
      }
      expect(
        trop,
        `${theme} : ${trop.join(" · ")} — une série non sémantique doit rester à distance ` +
          `du haussier et du baissier, sinon la courbe se lit comme un signe.`
      ).toEqual([]);
    }
  );
});
