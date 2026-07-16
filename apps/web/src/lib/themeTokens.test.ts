/**
 * Garde-fou : chaque thème CSS (`:root[data-theme="…"]`) doit définir
 * l'INTÉGRALITÉ des tokens consommés par le canvas (lireTokensCanvas /
 * lireTokenCanvas dans ./canvasTokens.ts) et par le CSS/JSX inline. Un token
 * manquant dans UN thème échoue SILENCIEUSEMENT à l'exécution (chaîne vide
 * résolue par getComputedStyle, couleur invalide) — rien ne le détecte côté
 * build/TS puisque les tokens sont de simples chaînes CSS, jamais typées.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Lecture du CSS réel via fs (et non un import `?raw` de Vite) : Vitest
// STUBBE par défaut les imports `*.css` (même suffixés `?raw`) en module vide
// (option `test.css`, false par défaut) — un import `?raw` renverrait donc
// une chaîne vide ici, pas le contenu du fichier. `readFileSync` s'exécute
// en Node (contexte du test), lit le fichier tel qu'il est sur disque et
// type-check sans ajustement de tsconfig (résolution de `node:fs`/`node:url`
// déjà disponible en mode "Bundler", vérifié via `tsc --noEmit`).
const CHEMIN_CSS = fileURLToPath(new URL("../index.css", import.meta.url));
const cssIndex = readFileSync(CHEMIN_CSS, "utf-8");

/**
 * Extrait l'ensemble des noms de tokens CSS (`--xxx`) déclarés dans le(s)
 * bloc(s) dont la liste de sélecteurs (séparés par virgule) contient
 * EXACTEMENT `selecteur`. Ne gère pas les virgules à l'intérieur de
 * pseudo-classes fonctionnelles (`:is(...)`, `:where(...)`) — inutile ici,
 * les blocs de thème d'index.css sont de simples listes plates de
 * sélecteurs `:root[data-theme="…"]` (vérifié par lecture directe du fichier).
 */
export function extraireTokensDefinis(css: string, selecteur: string): Set<string> {
  const tokens = new Set<string>();
  // On retire les commentaires /* ... */ AVANT de parser : sinon un bloc de
  // thème précédé d'un commentaire décoratif (bandeau "────── */\n:root, …")
  // capture ce commentaire dans sa liste de sélecteurs et l'égalité stricte
  // avec `selecteur` échoue silencieusement (piège rencontré en écrivant ce
  // test contre le vrai index.css, qui ouvre chaque thème par un tel bandeau).
  const cssSansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // Bloc "plat" : liste de sélecteurs (sans accolade) suivie de déclarations
  // sans accolade imbriquée — vrai pour tous les blocs :root de ce fichier
  // (aucune règle imbriquée à l'intérieur). Les blocs @media/@keyframes,
  // eux, contiennent des accolades internes et ne seront donc PAS capturés
  // tels quels par cette regex ; ça n'affecte pas ce garde-fou puisqu'aucun
  // sélecteur de thème ne s'y trouve.
  const blocRegex = /([^{}]+)\{([^{}]*)\}/g;
  let bloc: RegExpExecArray | null;
  while ((bloc = blocRegex.exec(cssSansCommentaires)) !== null) {
    const listeSelecteurs = bloc[1];
    const declarations = bloc[2];
    if (listeSelecteurs === undefined || declarations === undefined) continue;
    // Le texte capturé va du "}" (ou début de fichier) précédent jusqu'au "{"
    // courant : s'il contient une règle SANS accolade terminée par ";" (ex.
    // `@tailwind base;` en tête de fichier), cette règle atterrit dans la
    // même capture que le sélecteur suivant. On ne garde donc que le texte
    // APRÈS le dernier ";" — les sélecteurs CSS n'en contiennent jamais.
    const dernierPointVirgule = listeSelecteurs.lastIndexOf(";");
    const texteSelecteurs =
      dernierPointVirgule === -1 ? listeSelecteurs : listeSelecteurs.slice(dernierPointVirgule + 1);
    const selecteurs = texteSelecteurs.split(",").map((s) => s.trim());
    if (!selecteurs.includes(selecteur)) continue;
    const tokenRegex = /(--[a-zA-Z0-9-]+)\s*:/g;
    let jeton: RegExpExecArray | null;
    while ((jeton = tokenRegex.exec(declarations)) !== null) {
      const nom = jeton[1];
      if (nom !== undefined) tokens.add(nom);
    }
  }
  return tokens;
}

/**
 * Tokens consommés par le canvas (lireTokensCanvas/lireTokenCanvas) et par le
 * CSS/JSX inline — cf. en-tête de commentaire d'index.css (familles 1 et 4 :
 * sémantiques + couleurs de série). Chaque thème DOIT tous les définir.
 */
const TOKENS_REQUIS: readonly string[] = [
  "--bg",
  "--surface",
  "--border",
  "--text",
  "--text-dim",
  "--up",
  "--down",
  "--candle-up",
  "--candle-down",
  "--accent",
  "--accent-ink",
  "--grid",
  "--serie-1",
  "--serie-2",
  "--serie-3",
  "--serie-4",
  "--serie-5",
  "--serie-6",
];

describe("extraireTokensDefinis — fonction pure (fixtures)", () => {
  it("extrait les tokens d'un bloc à sélecteur unique", () => {
    const css = `:root[data-theme="x"] { --a: red; --b: blue; }`;
    expect(extraireTokensDefinis(css, ':root[data-theme="x"]')).toEqual(new Set(["--a", "--b"]));
  });

  it('gère une liste de sélecteurs séparés par virgule (cas réel `:root, :root[data-theme="dark"]`)', () => {
    const css = `:root,\n:root[data-theme="dark"] {\n  --a: red;\n}`;
    expect(extraireTokensDefinis(css, ":root")).toEqual(new Set(["--a"]));
    expect(extraireTokensDefinis(css, ':root[data-theme="dark"]')).toEqual(new Set(["--a"]));
  });

  it("renvoie un ensemble vide si le sélecteur est absent du CSS", () => {
    const css = `:root[data-theme="x"] { --a: red; }`;
    expect(extraireTokensDefinis(css, ':root[data-theme="y"]').size).toBe(0);
  });

  it("isole les blocs : un token d'un AUTRE sélecteur ne fuite pas dans le résultat", () => {
    const css = `
      :root[data-theme="x"] { --a: red; }
      :root[data-theme="y"] { --b: blue; }
    `;
    expect(extraireTokensDefinis(css, ':root[data-theme="x"]')).toEqual(new Set(["--a"]));
  });

  it("un bandeau de commentaire juste avant le sélecteur ne casse pas l'égalité stricte (cas réel d'index.css)", () => {
    const css = `/* ─────── bandeau décoratif ─────── */\n:root[data-theme="x"] {\n  --a: red;\n}`;
    expect(extraireTokensDefinis(css, ':root[data-theme="x"]')).toEqual(new Set(["--a"]));
  });

  it("une règle sans accolade terminée par ';' avant le bloc (cas réel `@tailwind base;`) ne pollue pas le sélecteur", () => {
    const css = `@tailwind base;\n@tailwind components;\n:root {\n  --a: red;\n}`;
    expect(extraireTokensDefinis(css, ":root")).toEqual(new Set(["--a"]));
  });

  it("un deux-points dans une VALEUR ne perturbe pas la détection du nom de token", () => {
    const css = `:root[data-theme="x"] { --a: "ratio 16:9"; --b: green; }`;
    expect(extraireTokensDefinis(css, ':root[data-theme="x"]')).toEqual(new Set(["--a", "--b"]));
  });
});

/**
 * Tokens consommés par tailwind.config.js en `rgb(var(--x-rgb) / <alpha-value>)` :
 * chaque thème doit définir le triplet jumeau, sinon les classes /NN retombent
 * silencieusement sur du CSS invalide (l'audit v2 a montré 15+ fichiers touchés).
 */
const TOKENS_RGB_REQUIS: readonly string[] = [
  "--bg-rgb",
  "--surface-rgb",
  "--border-rgb",
  "--text-rgb",
  "--text-dim-rgb",
  "--up-rgb",
  "--down-rgb",
  "--accent-rgb",
  "--accent-ink-rgb",
  "--grid-rgb",
  "--crosshair-rgb",
  "--serie-1-rgb",
  "--serie-2-rgb",
  "--serie-3-rgb",
  "--serie-4-rgb",
  "--serie-5-rgb",
  "--serie-6-rgb",
  "--n-100-rgb",
  "--n-200-rgb",
  "--n-300-rgb",
  "--n-400-rgb",
  "--n-500-rgb",
  "--n-600-rgb",
  "--n-700-rgb",
  "--n-800-rgb",
  "--n-900-rgb",
  "--n-950-rgb",
  "--ui-emerald-rgb",
  "--ui-emerald-hover-rgb",
  "--ui-cyan-rgb",
  "--ui-amber-rgb",
];

describe("index.css — chaque thème définit l'intégralité des tokens consommés par le canvas", () => {
  // Sélecteurs RÉELS du fichier (vérifiés par lecture directe d'index.css,
  // cf. son commentaire d'en-tête : ":root sans attribut == thème dark").
  const SELECTEURS_THEMES: readonly string[] = [
    ":root",
    ':root[data-theme="bloomberg"]',
    ':root[data-theme="matrix"]',
    ':root[data-theme="cute"]',
    ':root[data-theme="aurora"]',
  ];

  it.each(SELECTEURS_THEMES)("le thème %s définit tous les tokens requis", (selecteur) => {
    const definis = extraireTokensDefinis(cssIndex, selecteur);
    const manquants = TOKENS_REQUIS.filter((t) => !definis.has(t));
    expect(manquants).toEqual([]);
  });

  it.each(SELECTEURS_THEMES)("le thème %s définit tous les triplets --*-rgb", (selecteur) => {
    const definis = extraireTokensDefinis(cssIndex, selecteur);
    const manquants = TOKENS_RGB_REQUIS.filter((t) => !definis.has(t));
    expect(manquants).toEqual([]);
  });
});
