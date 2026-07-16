# Lot A — Fondations durcies + conformité — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Réparer les défauts systémiques de la revue UI v2 (opacités Tailwind no-op, chart hors tokens, formats fragmentés, pièges palette/fenêtres) et installer des garde-fous automatiques anti-dérive — sans aucune feature nouvelle.

**Architecture :** (A) Chaque token couleur des 5 thèmes gagne un triplet jumeau `--x-rgb` et `tailwind.config.js` passe en `rgb(var(--x-rgb) / <alpha-value>)` : toutes les classes `/NN` cassées se remettent à fonctionner sans toucher aux composants. (B) Le chart converge sur `lib/canvasTokens` (nouveau `serieCanvas`) via le pattern prouvé `styles: () => lireTokenCanvas(...)` (rappelé au rendu, thème-aware). (C) `lib/format`/`ui.tsx` absorbent les derniers doublons (funding, USD signé, fraîcheur, groupes segmentés). (D) Palette/fenêtres : navigation de paire explicite + annulable, mnémoniques uniques, aide dérivée du registre, état ouvert/minimisé restauré. (E) Des tests-fichiers (pattern `themeTokens.test.ts`, environnement node) verrouillent le tout.

**Tech Stack :** TypeScript strict, React 18, Tailwind 3 (tokens CSS), KLineChart 9, stores vanilla, vitest **node sans DOM** (tests = fonctions pures + lecture de fichiers ; jamais de montage React ni de `getComputedStyle` en test).

## Global Constraints (BUILD-CONTRACT + CLAUDE.md)

- Commentaires, docs et UI en **français** ; Conventional Commits en français.
- TypeScript strict, `noUncheckedIndexedAccess` — tout accès indexé gère `undefined`.
- **AUCUNE dépendance nouvelle** ; ne pas modifier les `package.json`.
- Vitest tourne en environnement **node** (pas de jsdom) : on teste des fonctions pures exportées et des invariants par lecture de fichiers (`readFileSync`), jamais le DOM. Les callbacks `styles` klinecharts ne sont pas exécutés par les tests — le gate visuel les couvre.
- Aucune donnée haute fréquence dans le state React.
- Vérifications : `pnpm --filter @axiom/web test`, `pnpm --filter @axiom/web typecheck`, `pnpm --filter @axiom/web build` verts après CHAQUE tâche ; commit par tâche.
- Corrections factuelles vs la spec (vérifiées sur le code) : la rampe `neutral-*` et `emerald/cyan/amber-500` sont DÉJÀ thémées via `--n-*`/`--ui-*` (tailwind.config.js:40-68) — le token `--warn` devient un **alias Tailwind** de `--ui-amber` (pas de nouvelle variable CSS) ; le toggle Liq `bg-violet-500` passe en `bg-accent text-accent-ink` (pattern boutons actifs existant) ; le pattern « suppression armée » de référence est `SettingsPanel.restaurer` (confirmId), PAS AlertsPanel ; `BTN_BASCULE` n'existe pas (seul `BTN_SECONDAIRE`). Item REPORTÉ (documenté) : la substitution serie-5/serie-4 de GlobeWindow (l.76-90) reste locale — la remonter dans les tokens exigerait de redéfinir `--serie-4` du thème dark pour TOUS ses consommateurs (risque > gain ; à revoir au Lot B).

---

## Phase A — Fondations tokens (P1)

### Task 1 : Triplets `--*-rgb` + Tailwind alpha (répare palette ⌘K, SymbolBanner, ErreurBloc)

**Files:**
- Modify: `apps/web/src/index.css` (5 blocs de thème : `:root`, bloomberg:108, matrix:165, cute:223, aurora:284)
- Modify: `apps/web/tailwind.config.js:12-69`
- Modify: `apps/web/src/lib/themeTokens.test.ts:76-95`
- Create: `apps/web/scripts/gen-rgb-tokens.mjs` (outil one-shot, committé pour rejouabilité)

**Interfaces:**
- Produces: variables CSS `--<token>-rgb: R G B` pour chaque token couleur consommé par Tailwind, dans les 5 thèmes ; classes Tailwind `bg-accent/15`, `border-down/40`… fonctionnelles ; couleur Tailwind `warn` (alias `--ui-amber`).
- Les `var(--x)` directs (canvas, styles inline) restent inchangés.

- [ ] **Step 1 : étendre le test garde-fou (rouge)**

Dans `themeTokens.test.ts`, après `TOKENS_REQUIS`, ajouter :

```ts
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
```

Et dans le `describe` final, un second `it.each` :

```ts
  it.each(SELECTEURS_THEMES)("le thème %s définit tous les triplets --*-rgb", (selecteur) => {
    const definis = extraireTokensDefinis(cssIndex, selecteur);
    const manquants = TOKENS_RGB_REQUIS.filter((t) => !definis.has(t));
    expect(manquants).toEqual([]);
  });
```

- [ ] **Step 2 : vérifier l'échec**

Run: `pnpm --filter @axiom/web test themeTokens`
Expected: FAIL — les 5 thèmes listent 32 triplets manquants.

- [ ] **Step 3 : générer les triplets (script one-shot)**

Créer `apps/web/scripts/gen-rgb-tokens.mjs` :

```js
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
```

Run: `node apps/web/scripts/gen-rgb-tokens.mjs`
Expected: 5 blocs de 31 lignes `--x-rgb: R G B;` (aucun `MANQUANT` — si un token est en `rgba()` ou absent, le convertir à la main). Coller chaque bloc à la FIN du bloc de thème correspondant dans `index.css` (juste avant `color-scheme`).

- [ ] **Step 4 : basculer tailwind.config.js sur la forme alpha**

Remplacer intégralement `theme.extend.colors` (lignes 12-69) par la même structure en `rgb(var(--x-rgb) / <alpha-value>)`, en conservant les commentaires existants :

```js
      colors: {
        bg: "rgb(var(--bg-rgb) / <alpha-value>)",
        surface: "rgb(var(--surface-rgb) / <alpha-value>)",
        border: "rgb(var(--border-rgb) / <alpha-value>)",
        text: {
          DEFAULT: "rgb(var(--text-rgb) / <alpha-value>)",
          dim: "rgb(var(--text-dim-rgb) / <alpha-value>)",
        },
        up: "rgb(var(--up-rgb) / <alpha-value>)",
        down: "rgb(var(--down-rgb) / <alpha-value>)",
        accent: "rgb(var(--accent-rgb) / <alpha-value>)",
        "accent-ink": "rgb(var(--accent-ink-rgb) / <alpha-value>)",
        grid: "rgb(var(--grid-rgb) / <alpha-value>)",
        crosshair: "rgb(var(--crosshair-rgb) / <alpha-value>)",
        serie: {
          1: "rgb(var(--serie-1-rgb) / <alpha-value>)",
          2: "rgb(var(--serie-2-rgb) / <alpha-value>)",
          3: "rgb(var(--serie-3-rgb) / <alpha-value>)",
          4: "rgb(var(--serie-4-rgb) / <alpha-value>)",
          5: "rgb(var(--serie-5-rgb) / <alpha-value>)",
          6: "rgb(var(--serie-6-rgb) / <alpha-value>)",
        },
        neutral: {
          100: "rgb(var(--n-100-rgb) / <alpha-value>)",
          200: "rgb(var(--n-200-rgb) / <alpha-value>)",
          300: "rgb(var(--n-300-rgb) / <alpha-value>)",
          400: "rgb(var(--n-400-rgb) / <alpha-value>)",
          500: "rgb(var(--n-500-rgb) / <alpha-value>)",
          600: "rgb(var(--n-600-rgb) / <alpha-value>)",
          700: "rgb(var(--n-700-rgb) / <alpha-value>)",
          800: "rgb(var(--n-800-rgb) / <alpha-value>)",
          900: "rgb(var(--n-900-rgb) / <alpha-value>)",
          950: "rgb(var(--n-950-rgb) / <alpha-value>)",
        },
        emerald: {
          400: "rgb(var(--ui-emerald-hover-rgb) / <alpha-value>)",
          500: "rgb(var(--ui-emerald-rgb) / <alpha-value>)",
        },
        cyan: { 500: "rgb(var(--ui-cyan-rgb) / <alpha-value>)" },
        amber: { 500: "rgb(var(--ui-amber-rgb) / <alpha-value>)" },
        // Rôle sémantique « avertissement » (daemon dégradé, cache, partiel) :
        // alias de l'accent ambre thémé — voir Task 2.
        warn: "rgb(var(--ui-amber-rgb) / <alpha-value>)",
      },
```

- [ ] **Step 5 : tests + build + contrôle visuel**

Run: `pnpm --filter @axiom/web test themeTokens` → PASS.
Run: `pnpm --filter @axiom/web build` → PASS.
Contrôle visuel (`pnpm dev`) : ⌘K puis ↓ — la ligne sélectionnée doit maintenant être surlignée (`bg-accent/15` fonctionne) ; le bandeau SymbolBanner sur le chart a un fond semi-opaque ; un bloc d'erreur (couper le réseau sur une fenêtre) a une bordure rouge adoucie.

- [ ] **Step 6 : commit**

```bash
git add apps/web/src/index.css apps/web/tailwind.config.js apps/web/src/lib/themeTokens.test.ts apps/web/scripts/gen-rgb-tokens.mjs
git commit -m "fix(theme): triplets --*-rgb + Tailwind <alpha-value> — les classes /NN sur tokens fonctionnent (sélection ⌘K, SymbolBanner, ErreurBloc)"
```

---

### Task 2 : Rôle `warn` + dernières couleurs brutes du chrome

**Files:**
- Modify: `apps/web/src/components/HealthPanel.tsx:29-36,133-142` + `HealthPanel.test.ts:17-25`
- Modify: `apps/web/src/components/SessionStrip.tsx:107-112`
- Modify: `apps/web/src/components/ReplayWindow.tsx:68-73`
- Modify: `apps/web/src/components/ui.tsx:320` (TONS_FIABILITE.partiel)
- Modify: `apps/web/src/components/MarketMapWindow.tsx:411` (`text-amber-500` stale)
- Modify: `apps/web/src/components/MacroPanel.tsx:128,298`
- Modify: `apps/web/src/components/Toolbar.tsx` (`bg-violet-500`, `text-sky-400`)

**Interfaces:**
- Consumes: couleur Tailwind `warn` (Task 1).
- Produces: plus aucune classe `amber-500` à rôle sémantique « avertissement » ; plus de `violet-500`/`sky-400` (non thémés).

- [ ] **Step 1 : mettre le test HealthPanel au rouge**

Dans `HealthPanel.test.ts:17-25`, remplacer les attentes :

```ts
describe("dotClass", () => {
  it("mappe chaque état sur un token de thème (jamais de hex en dur)", () => {
    expect(dotClass("connected")).toBe("bg-up"); // vert
    expect(dotClass("stale")).toBe("bg-warn"); // avertissement (thémé --ui-amber)
    expect(dotClass("reconnecting")).toBe("bg-warn");
    expect(dotClass("error")).toBe("bg-down"); // rouge
    expect(dotClass("polling")).toBe("bg-text-dim"); // bleu-gris
    expect(dotClass("closed")).toBe("bg-neutral-600"); // gris éteint (rampe --n-*)
  });
});
```

Run: `pnpm --filter @axiom/web test HealthPanel` → FAIL (2 assertions).

- [ ] **Step 2 : migrations mécaniques**

- `HealthPanel.tsx` : `DOT_BY_ETAT.stale` et `.reconnecting` → `"bg-warn"` ; `BadgeDot` → `level === "error" ? "bg-down" : "bg-warn"`.
- `SessionStrip.tsx:111` : `"bg-amber-500"` → `"bg-warn"`.
- `ui.tsx` TONS_FIABILITE : `partiel: "border-warn/50 text-warn"` (la variante `/50` fonctionne depuis Task 1).
- `MarketMapWindow.tsx:411` : `"text-amber-500"` → `"text-warn"`.
- `MacroPanel.tsx:128,298` : `accent-emerald-500` → `accent-accent` (pattern du curseur ReplayWindow:221).
- `ReplayWindow.tsx:68-73` : remplacer la boîte ambre custom par la primitive standard (importer `Vide` de `./ui`) :

```tsx
{s.daemonAbsent && (
  <div className="m-3">
    <Vide>
      Le replay nécessite le daemon <span className="font-mono">axiomd</span> (port 8787).
      Démarrez-le puis rouvrez ce panneau.
    </Vide>
  </div>
)}
```

- `Toolbar.tsx` : `grep -n "violet-500\|sky-400" apps/web/src/components/Toolbar.tsx` ; sur le bouton Liq actif, remplacer les classes `bg-violet-500` (et son éventuel `text-white`) par `bg-accent text-accent-ink` (pattern des boutons actifs à encre) ; remplacer `text-sky-400` (mnémoniques Playbooks) par `text-accent` (même rôle que les mnémoniques de la palette).

- [ ] **Step 3 : tests + contrôle**

Run: `pnpm --filter @axiom/web test` → PASS. `pnpm --filter @axiom/web typecheck` → PASS.
Visuel : thème cute (clair) — pastilles santé, bouton Liq actif et menu Playbooks suivent le thème.

- [ ] **Step 4 : commit**

```bash
git add -A apps/web/src
git commit -m "refactor(ui): rôle warn thémé + fin des classes violet/sky non thémées (santé, session, replay, toolbar, macro)"
```

---

### Task 3 : `MenuDeroulant` en tokens sémantiques + menu ⚙ Watchlist

**Files:**
- Modify: `apps/web/src/components/ui.tsx:48-146` (MenuDeroulant)
- Modify: `apps/web/src/components/Watchlist.tsx:294-376`

**Interfaces:**
- Produces: `MenuDeroulant` accepte `declencheurClasse?: string` (classes du bouton, défaut = bouton bordé standard tokenisé) et `chevron?: boolean` (défaut `true`). Comportements (Échap, clic extérieur, roving ↑/↓) inchangés.

- [ ] **Step 1 : tokeniser la primitive**

Dans `MenuDeroulant`, ajouter les deux props et remplacer les classes `neutral-*` (la rampe est thémée mais la doctrine du module — « tokens sémantiques uniquement » — est violée, et le déclencheur doit devenir paramétrable) :

```tsx
export function MenuDeroulant({
  declencheur,
  titre,
  align = "left",
  classePanneau = "w-60",
  declencheurClasse = "flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text hover:border-text-dim",
  chevron = true,
  children,
}: {
  declencheur: ReactNode;
  titre?: string;
  align?: "left" | "right";
  classePanneau?: string;
  /** Classes du bouton déclencheur (défaut : bouton bordé standard). */
  declencheurClasse?: string;
  /** Affiche le chevron ▾ (désactivable pour un déclencheur-icône). */
  chevron?: boolean;
  children: (fermer: () => void) => ReactNode;
}) {
```

Bouton : `className={declencheurClasse}` et chevron conditionnel :

```tsx
        {declencheur}
        {chevron && <span aria-hidden className="text-[9px] text-text-dim">▾</span>}
```

Panneau : `rounded border border-border bg-surface p-1 shadow-xl` (le reste de la classe inchangé).

- [ ] **Step 2 : migrer le menu ⚙ de la Watchlist**

Supprimer `menuOpen`/`menuRef` et l'effet de fermeture (l.294-302) ; remplacer `columnsMenu` (l.305-376) par :

```tsx
  // Menu ⚙ des colonnes — primitive MenuDeroulant (Échap, clic extérieur, ↑/↓).
  const columnsMenu = (
    <MenuDeroulant
      declencheur="⚙"
      titre="Colonnes"
      align="right"
      classePanneau="w-36"
      chevron={false}
      declencheurClasse="text-text-dim transition hover:text-text"
    >
      {() =>
        (
          [
            { key: "change24h" as const, label: "Δ% 24h" },
            { key: "change1h" as const, label: "Δ% 1h" },
            { key: "change7d" as const, label: "Δ% 7j" },
            { key: "volume" as const, label: "Volume 24h" },
            { key: "spark" as const, label: "Sparkline" },
          ] as const
        ).map((c) => (
          <label
            key={c.key}
            role="menuitem"
            tabIndex={-1}
            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] text-text hover:bg-bg"
          >
            <input
              type="checkbox"
              checked={visibleCols[c.key]}
              onChange={() => setVisibleCols((v) => ({ ...v, [c.key]: !v[c.key] }))}
              className="accent-accent"
            />
            {c.label}
          </label>
        ))
      }
    </MenuDeroulant>
  );
```

(Importer `MenuDeroulant` depuis `./ui` ; retirer les imports devenus inutiles.)

- [ ] **Step 3 : vérifier les consommateurs existants**

`grep -rn "MenuDeroulant" apps/web/src --include="*.tsx"` — les menus Toolbar (Fonctions/Playbooks/Workspaces) ne passent pas `declencheurClasse` : ils héritent du défaut tokenisé (visuel quasi identique, `--n-900`≈`--surface`). Vérifier visuellement sur dark + cute.

Run: `pnpm --filter @axiom/web test && pnpm --filter @axiom/web typecheck` → PASS.

- [ ] **Step 4 : commit**

```bash
git add apps/web/src/components/ui.tsx apps/web/src/components/Watchlist.tsx
git commit -m "refactor(ui): MenuDeroulant en tokens sémantiques + déclencheur paramétrable ; menu colonnes Watchlist migré (Échap + clavier)"
```

---

## Phase B — Le chart repasse sous les tokens (P1)

### Task 4 : `serieCanvas` + consolidation des lecteurs de tokens de `chart/`

**Files:**
- Modify: `apps/web/src/lib/canvasTokens.ts`
- Create: `apps/web/src/lib/canvasTokens.test.ts`
- Modify: `apps/web/src/chart/orderflow.ts:86-89`, `apps/web/src/chart/liquidationHeat.ts:503-506`, `apps/web/src/chart/volumeProfile.ts:160-162`, `apps/web/src/chart/ChartInstance.tsx:168-170`, `apps/web/src/chart/fibonacci.ts:145-150`, `apps/web/src/chart/volumeRangeOverlay.ts:74-78`, `apps/web/src/chart/drawing.ts:437`

**Interfaces:**
- Produces: `serieCanvas(i: number, repli?: string): string` (lit `--serie-((i%6)+1)`), `indexSerie(i: number): number` (pur, testé), `parseHexRgb(c: string): [number,number,number] | null` (pur, testé), `rgbaTokenCanvas(nom: string, alpha: number, repli: string): string`. Tous exportés de `lib/canvasTokens.ts`.
- Consumes: `lireTokenCanvas` existant.

- [ ] **Step 1 : tests des fonctions pures (rouge)**

Créer `apps/web/src/lib/canvasTokens.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { indexSerie, parseHexRgb } from "./canvasTokens";

// serieCanvas/lireTokenCanvas exigent le DOM (vitest node) : on teste leurs
// briques pures — le cycle modulo des séries et le parseur hex.
describe("indexSerie — cycle sur les 6 tokens --serie-N", () => {
  it("cycle 0..5 puis reboucle", () => {
    expect(indexSerie(0)).toBe(0);
    expect(indexSerie(5)).toBe(5);
    expect(indexSerie(6)).toBe(0);
    expect(indexSerie(13)).toBe(1);
  });
  it("reste positif pour un index négatif", () => {
    expect(indexSerie(-1)).toBe(5);
  });
});

describe("parseHexRgb", () => {
  it("parse #rrggbb et #rgb", () => {
    expect(parseHexRgb("#f59e0b")).toEqual([245, 158, 11]);
    expect(parseHexRgb("#fff")).toEqual([255, 255, 255]);
  });
  it("rejette les non-hex", () => {
    expect(parseHexRgb("rgb(1,2,3)")).toBeNull();
    expect(parseHexRgb("")).toBeNull();
  });
});
```

Run: `pnpm --filter @axiom/web test canvasTokens` → FAIL (exports absents).

- [ ] **Step 2 : implémenter dans canvasTokens.ts**

Ajouter à la fin du fichier :

```ts
/** Replis RVB des tokens de série (valeurs du thème dark) — contexte sans DOM ou token absent. */
const REPLIS_SERIE = ["#38bdf8", "#a78bfa", "#f59e0b", "#f472b6", "#22d3ee", "#60a5fa"] as const;

/** Index 0-based → index de token 0..5 (modulo positif) — pur, testé. */
export function indexSerie(i: number): number {
  return ((i % 6) + 6) % 6;
}

/** Couleur de la série i (0-based, cycle sur --serie-1…6), lue au moment du dessin. */
export function serieCanvas(i: number, repli?: string): string {
  const n = indexSerie(i);
  return lireTokenCanvas(`--serie-${n + 1}`, repli ?? REPLIS_SERIE[n] ?? "#38bdf8");
}

/** #rgb / #rrggbb → triplet RVB, sinon null — pur, testé. */
export function parseHexRgb(c: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(c.trim());
  if (!m || m[1] === undefined) return null;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Token couleur résolu en `rgba(r,g,b,alpha)` — remplissages canvas semi-transparents. */
export function rgbaTokenCanvas(nom: string, alpha: number, repli: string): string {
  const brut = lireTokenCanvas(nom, repli);
  const rgb = parseHexRgb(brut) ?? parseHexRgb(repli);
  return rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})` : brut;
}
```

Run: `pnpm --filter @axiom/web test canvasTokens` → PASS.

- [ ] **Step 3 : consolider les 7 lecteurs dupliqués**

Dans chaque fichier, supprimer le helper local et importer depuis `../lib/canvasTokens` :

- `orderflow.ts:86-89` : supprimer `readToken` ; `readToken("--up") || "#10b981"` → `lireTokenCanvas("--up", "#10b981")` (idem `--accent`/`#f5c518`).
- `liquidationHeat.ts:503-506` : supprimer `readToken` local ; les appels `readToken("--x") || "repli"` (l.794-808) → `lireTokenCanvas("--x", "repli")`.
- `volumeProfile.ts:160-162` : idem.
- `ChartInstance.tsx:168-170` : idem (appels dans `applyChartTheme`).
- `fibonacci.ts:145-150` : supprimer `cssVar` ; `cssVar("--up", "#…")` → `lireTokenCanvas("--up", "#…")`.
- `volumeRangeOverlay.ts:74-78` : idem.
- `drawing.ts:437` : l'inline `getComputedStyle(...).getPropertyValue("--bg")` → `lireTokenCanvas("--bg", "#0a0a0a")`.

Run: `pnpm --filter @axiom/web test && pnpm --filter @axiom/web typecheck` → PASS.

- [ ] **Step 4 : commit**

```bash
git add apps/web/src/lib/canvasTokens.ts apps/web/src/lib/canvasTokens.test.ts apps/web/src/chart
git commit -m "refactor(chart): serieCanvas + parseHexRgb dans lib/canvasTokens ; 7 lecteurs de tokens dupliqués consolidés"
```

---

### Task 5 : Les ~98 indicateurs du catalogue suivent les tokens `--serie-*`

**Files:**
- Modify: `apps/web/src/chart/indicators.ts:81-129` (`ensureRegistered`)

**Interfaces:**
- Consumes: `serieCanvas` (Task 4).

- [ ] **Step 1 : attribuer un callback styles par output**

Dans `ensureRegistered`, remplacer la construction des figures (l.85-98) :

```ts
  const figures: Array<IndicatorFigure<AxiomPoint>> = def.outputs.map((o, i) => {
    // Couleur de série lue AU RENDU (callback rappelé par KLineChart) : les ~98
    // indicateurs suivent les tokens --serie-1…6 du thème actif, sans re-registration
    // (pattern prouvé par orderflow.ts CVD S/P).
    const styles = () => ({ color: serieCanvas(i) });
    if (o.style === "histogram") {
      return { key: o.key, title: `${o.name}: `, type: "bar", baseValue: 0, styles };
    }
    if (o.style === "points") {
      return { key: o.key, title: `${o.name}: `, type: "circle", styles };
    }
    return { key: o.key, title: `${o.name}: `, type: "line", styles };
  });
```

Import : `import { serieCanvas } from "../lib/canvasTokens";`.
Si le type `IndicatorFigure` de klinecharts exige une signature précise pour `styles` (callback `(data, indicator, defaultStyles) => …`), adopter la même signature que `orderflow.ts:154` (ignorer les arguments).

- [ ] **Step 2 : vérifier**

Run: `pnpm --filter @axiom/web test indicators && pnpm --filter @axiom/web typecheck` → PASS (les tests mockent `registerIndicator`, seuls le typage et le build sont sensibles).
Visuel : ajouter EMA + RSI + MACD sur dark puis basculer matrix/bloomberg (touche T) — les courbes changent de palette avec le thème.

- [ ] **Step 3 : commit**

```bash
git add apps/web/src/chart/indicators.ts
git commit -m "feat(chart): les indicateurs du catalogue lisent --serie-1…6 au rendu (thème-aware, fini la palette klinecharts figée)"
```

---

### Task 6 : Panes OI/funding/macro/revenus/CVD — tokens + formats big-number

**Files:**
- Modify: `apps/web/src/chart/derivatives.ts:28-162`
- Modify: `apps/web/src/chart/macro.ts:43-119`
- Modify: `apps/web/src/chart/revenue.ts:30-82`
- Modify: `apps/web/src/chart/orderflow.ts:104-125` (CVD)
- Modify: `apps/web/src/components/DerivativesWindow.tsx:60,538,542,627`

**Interfaces:**
- Produces: `derivatives.ts` n'exporte PLUS `OI_COLOR`/`FUNDING_COLOR` ; le lien visuel bouton↔courbe passe par `var(--serie-5)` (OI) et `var(--serie-3)` (funding) côté React, `lireTokenCanvas` côté chart — mêmes tokens des deux côtés.

- [ ] **Step 1 : derivatives.ts**

Remplacer les constantes exportées (l.28-40) :

```ts
// Tokens de série des panes — lus AU RENDU (callback styles) : suivent le thème.
// Côté DerivativesWindow, le lien visuel bouton↔courbe utilise les MÊMES tokens
// via `var(--serie-5)` / `var(--serie-3)` en style inline.
const OI_TOKEN = "--serie-5"; // cyan sur dark (ex-#22d3ee)
const OI_REPLI = "#22d3ee";
const FUNDING_TOKEN = "--serie-3"; // ambre sur dark (ex-#f59e0b)
const FUNDING_REPLI = "#f59e0b";
```

Dans `ensureRegistered` : `makeFigures` prend `(title, token, repli)` et produit
`styles: () => ({ color: lireTokenCanvas(token, repli), size: 1.5 })` ; l'indicateur OI gagne le correctif big-number (motif `revenue.ts`) :

```ts
  registerIndicator<DerivPointOut>({
    name: OI_NAME,
    shortName: "OI ($)",
    series: IndicatorSeries.Normal,
    // OI en notionnel USD (milliards) : 0 décimale + notation compacte sur l'axe
    // et la légende, au lieu de « 1,100,000,000.0000 » (revue v2, H8).
    precision: 0,
    shouldFormatBigNumber: true,
    figures: makeFigures("OI $: ", OI_TOKEN, OI_REPLI),
    calc,
  });
  registerIndicator<DerivPointOut>({
    name: FUNDING_NAME,
    shortName: "Funding (%)",
    series: IndicatorSeries.Normal,
    precision: 4, // convention funding du standard
    figures: makeFigures("Funding %: ", FUNDING_TOKEN, FUNDING_REPLI),
    calc,
  });
```

Import `lireTokenCanvas` depuis `../lib/canvasTokens`.

- [ ] **Step 2 : DerivativesWindow.tsx**

- l.60 : supprimer l'import `OI_COLOR, FUNDING_COLOR`.
- l.538 : `color={OI_COLOR}` → `color="var(--serie-5)"` ; l.542 : `color={FUNDING_COLOR}` → `color="var(--serie-3)"`.
- l.627 (Metric « Open Interest » Binance) : `color={OI_COLOR}` → `color="var(--serie-1)"` (même couleur que sa jumelle Coinalyze l.483 — revue v2, finding DERIV).

- [ ] **Step 3 : macro.ts**

`MACRO_DEFS` passe des hex aux tokens (la série « Stablecoins » quitte #10b981 qui est la teinte de `--up` sur dark — une courbe non directionnelle ne doit pas se lire comme un signal) :

```ts
const MACRO_DEFS: MacroDef[] = [
  { id: "crypto-total", key: "cryptoTotal", title: "Cap crypto: ", token: "--serie-1", repli: "#38bdf8", scale: 1 },
  { id: "stablecoins", key: "stablecoins", title: "Stablecoins: ", token: "--serie-2", repli: "#a78bfa", scale: 1 },
  { id: "m2", key: "m2", title: "M2: ", token: "--serie-3", repli: "#eab308", scale: 1e9 },
];
```

(Adapter le type `MacroDef` : `color: string` → `token: string; repli: string`.)
Figures : `styles: () => ({ color: lireTokenCanvas(def.token, def.repli), size: 1.5 })`.
`registerIndicator` AXIOM_MACRO gagne `precision: 0, shouldFormatBigNumber: true` (fini « Cap crypto: 2,293,577,001,928.3072 » et l'axe à 16 chiffres — constaté à l'écran).
Vérifier les consommateurs : `grep -rn "MACRO_DEFS\|#38bdf8\|#10b981" apps/web/src/components/MacroPanel.tsx` — si la légende du panneau duplique ces couleurs, aligner sur `var(--serie-1/2/3)` en style inline.

- [ ] **Step 4 : revenue.ts et CVD**

- `revenue.ts:30-31` : supprimer `REVENUE_COLOR` ; figure → `styles: () => ({ color: lireTokenCanvas("--serie-3", "#eab308"), size: 1.5 })`.
- `orderflow.ts` (`ensureCvdRegistered`, l.104-125) : la figure CVD gagne `styles: () => ({ color: lireTokenCanvas("--serie-1", "#38bdf8") })` et l'indicateur `precision: 0, shouldFormatBigNumber: true` (fini « CVD: -20,795.1812 » à 4 décimales).

- [ ] **Step 5 : vérifier + commit**

Run: `pnpm --filter @axiom/web test && pnpm --filter @axiom/web typecheck && pnpm --filter @axiom/web build` → PASS.
Visuel : panes OI/Funding/Macro/CVD sur dark → axes compacts (K/M/B/T) ; bascule bloomberg → les courbes suivent la palette du thème ; boutons OI/Funding de DES assortis aux courbes.

```bash
git add apps/web/src/chart apps/web/src/components/DerivativesWindow.tsx
git commit -m "fix(chart): panes OI/funding/macro/revenus/CVD — tokens de série au rendu + axes compacts (precision/shouldFormatBigNumber)"
```

---

### Task 7 : Marqueurs éco/navigation — couleur lue au dessin

**Files:**
- Modify: `apps/web/src/chart/ecoMarkers.ts:30-31,60-80,110-114`
- Modify: `apps/web/src/lib/navigation.ts:120-135`

- [ ] **Step 1 : ecoMarkers.ts**

- Supprimer l'injection de couleur à la création (l.110-114) : `const extend: EcoMarkerExtend = { label: tronquer(...) };` (retirer `color` du type `EcoMarkerExtend` s'il n'a plus de producteur).
- Dans `createPointFigures` (rappelé à chaque frame — donc thème-aware sans re-création) :

```ts
      const color = lireTokenCanvas("--serie-3", "#f59e0b");
```

(en remplacement de `const color = ext?.color ?? ECO_COLOR;` ; supprimer `ECO_COLOR`).

- [ ] **Step 2 : navigation.ts**

Même motif : `grep -n "NAV_COLOR" apps/web/src/lib/navigation.ts` ; supprimer la constante et l'injection dans `extendData` ; dans le `createPointFigures` de l'overlay `navMarker`, lire `lireTokenCanvas("--accent", "#38bdf8")`.

- [ ] **Step 3 : vérifier + commit**

Run: `pnpm --filter @axiom/web test && pnpm --filter @axiom/web typecheck` → PASS.
Visuel : marqueurs ECO (ambre→token) et flash de navigation (accent du thème) sur bloomberg/matrix.

```bash
git add apps/web/src/chart/ecoMarkers.ts apps/web/src/lib/navigation.ts
git commit -m "fix(chart): marqueurs éco et navigation lisent leurs tokens au dessin (thème-aware sans re-création)"
```

---

### Task 8 : Palette de comparaison (et groupes de fenêtres) en tokens

**Files:**
- Modify: `apps/web/src/store/compare.ts:18-51`
- Modify: `apps/web/src/chart/compare.ts` (résolution couleur des slots)
- Modify: `apps/web/src/components/CompareControl.tsx:54`
- Modify: consommateurs de `groupColor` (`grep -rn "groupColor" apps/web/src/components`)
- Test: `apps/web/src/store/compare.test.ts` (ou créer)

**Interfaces:**
- Produces: `COMPARE_PALETTE = ["--serie-3", "--serie-6", "--serie-2", "--serie-4"]`, `MAIN_COLOR = "--text-dim"` (noms de tokens) ; helper pur `couleurAffichable(c: string): string` (token → `var(--x)`, hex hérité → tel quel) exporté de `store/compare.ts`.

- [ ] **Step 1 : test du helper pur (rouge)**

```ts
import { couleurAffichable } from "./compare";

describe("couleurAffichable — tokens et hex hérités", () => {
  it("enveloppe un token CSS dans var()", () => {
    expect(couleurAffichable("--serie-3")).toBe("var(--serie-3)");
  });
  it("laisse passer un hex hérité (persistance ancienne)", () => {
    expect(couleurAffichable("#f59e0b")).toBe("#f59e0b");
  });
});
```

Run: `pnpm --filter @axiom/web test compare` → FAIL.

- [ ] **Step 2 : store/compare.ts**

```ts
/**
 * Palette des courbes comparées : TOKENS de série du thème (jamais de vert/rouge
 * pur — pas de confusion avec up/down). Les couleurs hex héritées d'anciennes
 * persistances restent acceptées (cf. couleurAffichable).
 */
export const COMPARE_PALETTE = ["--serie-3", "--serie-6", "--serie-2", "--serie-4"] as const;

/** Couleur du symbole PRINCIPAL (référence base 100) : gris neutre du thème. */
export const MAIN_COLOR = "--text-dim";

/** Token CSS (--x) → `var(--x)` pour les styles inline ; hex hérité inchangé. */
export function couleurAffichable(c: string): string {
  return c.startsWith("--") ? `var(${c})` : c;
}
```

- [ ] **Step 3 : résolution côté chart et côté React**

- `apps/web/src/chart/compare.ts` : `grep -n "color" apps/web/src/chart/compare.ts` — partout où la couleur d'un slot alimente un `styles` klinecharts ou un tracé canvas, résoudre : `const c = slot.color.startsWith("--") ? lireTokenCanvas(slot.color, "#94a3b8") : slot.color;` (dans le callback de rendu, pas à l'enregistrement).
- `CompareControl.tsx:54` : `style={{ backgroundColor: MAIN_COLOR }}` → `style={{ backgroundColor: couleurAffichable(MAIN_COLOR) }}` ; idem pour les pastilles des symboles comparés (`couleurAffichable(c.color)`).
- `groupColor` (windowManager `GROUP_PALETTE = COMPARE_PALETTE`) : `grep -rn "groupColor" apps/web/src/components` — chaque style inline (`borderColor`, `backgroundColor`, pastilles Taskbar/FloatingWindow) passe par `couleurAffichable(...)`. Les `groupColor` hex persistés restent valides.

- [ ] **Step 4 : vérifier + commit**

Run: `pnpm --filter @axiom/web test && pnpm --filter @axiom/web typecheck` → PASS.
Visuel : comparer 2 symboles (COMPARER dans le panneau), grouper 2 fenêtres — pastilles et courbes suivent le thème après bascule T.

```bash
git add apps/web/src/store/compare.ts apps/web/src/store/compare.test.ts apps/web/src/chart/compare.ts apps/web/src/components
git commit -m "refactor(compare): palette de comparaison et groupes de fenêtres en tokens --serie-* (hex hérités tolérés)"
```

---

### Task 9 : Heatmap liq — teinte des niveaux ESTIMÉS par thème

**Files:**
- Modify: `apps/web/src/chart/liquidationHeat.ts:464-465,481-495,794-808,1329-1429`
- Test: `apps/web/src/chart/liquidationHeat.test.ts`

**Interfaces:**
- Produces: `teinteEstPourTheme(theme: string): readonly [number, number, number]` exportée (pure, testée).

- [ ] **Step 1 : test (rouge)**

Ajouter dans `liquidationHeat.test.ts` :

```ts
import { teinteEstPourTheme } from "./liquidationHeat";

describe("teinteEstPourTheme — la teinte EST contraste avec la rampe du thème", () => {
  it("bloomberg (rampe ambre) : teinte froide, PAS l'orange", () => {
    expect(teinteEstPourTheme("bloomberg")).toEqual([96, 165, 250]);
  });
  it("matrix (rampe verte) et défaut (viridis) : orange", () => {
    expect(teinteEstPourTheme("matrix")).toEqual([245, 158, 11]);
    expect(teinteEstPourTheme("dark")).toEqual([245, 158, 11]);
    expect(teinteEstPourTheme("aurora")).toEqual([245, 158, 11]);
  });
});
```

Run: `pnpm --filter @axiom/web test liquidationHeat` → FAIL.

- [ ] **Step 2 : implémenter**

Remplacer `ORANGE_EST` (l.464-465) par :

```ts
/**
 * Teinte RVB des niveaux ESTIMÉS, choisie PAR THÈME pour contraster avec la rampe
 * réelle (garde-fou « estimation ≠ donnée » — sur bloomberg la rampe est ambre,
 * l'orange y était indiscernable ; revue v2, H7).
 */
export function teinteEstPourTheme(theme: string): readonly [number, number, number] {
  if (theme === "bloomberg") return [96, 165, 250]; // bleu clair vs rampe ambre
  return [245, 158, 11]; // orange vs viridis / rampe verte matrix
}
```

- `Tokens` (l.481-495) gagne `estRgb: readonly [number, number, number];` avec doc « teinte EST du thème, résolue 1×/frame ».
- Résolution frame (l.794-808) : `estRgb: teinteEstPourTheme(themeStore.getState().theme),`.
- `dessinerNiveauxEstimes` (l.1329+) : `const orange = (a) => …` devient `const est = (a: number): string => \`rgba(${tokens.estRgb.join(",")},${a.toFixed(3)})\`;` — remplacer tous les appels `orange(...)` par `est(...)`. `grep -n "ORANGE_EST" apps/web/src/chart/liquidationHeat.ts` : migrer TOUTES les occurrences (légende, hint, trace grisée éventuelle) puis supprimer la constante.

- [ ] **Step 3 : vérifier + commit**

Run: `pnpm --filter @axiom/web test liquidationHeat` → PASS.
Visuel : thème bloomberg + LIQEST actif → niveaux EST bleus, distincts des cellules ambre.

```bash
git add apps/web/src/chart/liquidationHeat.ts apps/web/src/chart/liquidationHeat.test.ts
git commit -m "fix(chart): niveaux liq ESTIMÉS — teinte par thème (bleu sur bloomberg), garde-fou estimation≠donnée rétabli"
```

---

### Task 10 : Canvas divers — opacité VPFR, alpha Backtest, police CourbeTaux

**Files:**
- Modify: `apps/web/src/chart/volumeRangeOverlay.ts:222-248`
- Modify: `apps/web/src/components/BacktestWindow.tsx:334-336`
- Modify: `apps/web/src/components/CourbeTaux.tsx:63`

- [ ] **Step 1 : VPFR — barres semi-transparentes (alignées sur le VPVR 0.55)**

Dans `volumeRangeOverlay.ts`, les deux polygones buy/sell (l.222-248) passent de `color: down` / `color: up` opaques à :

```ts
      styles: { style: "fill", color: rgbaTokenCanvas("--down", 0.55, "#f92855") },
```

```ts
      styles: { style: "fill", color: rgbaTokenCanvas("--up", 0.55, "#2dc08e") },
```

(import `rgbaTokenCanvas` de `../lib/canvasTokens` ; les lectures `up`/`down` opaques restantes — bordures, POC — inchangées.)

- [ ] **Step 2 : Backtest — `colDown + "33"` → globalAlpha**

`BacktestWindow.tsx:334-336` : la concaténation d'alpha hex casse si un thème déclare `--down` en `rgb()`. Encadrer le remplissage de l'aire de drawdown :

```ts
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = colDown;
  // … (le fill() de l'aire existant) …
  ctx.restore();
  ctx.strokeStyle = colDown;
```

(Déplacer uniquement le REMPLISSAGE dans le save/restore ; le trait reste opaque.)

- [ ] **Step 3 : CourbeTaux — police résolue**

`CourbeTaux.tsx:63` — le contexte canvas ne résout pas `var()` (l'affectation actuelle est silencieusement ignorée) :

```ts
  const police = lireTokenCanvas("--font-display", "monospace");
  ctx.font = `10px ${police}`;
```

(`lireTokenCanvas` est déjà importé dans ce fichier — sinon l'ajouter.)

- [ ] **Step 4 : vérifier + commit**

Run: `pnpm --filter @axiom/web test && pnpm --filter @axiom/web typecheck` → PASS.
Visuel : VPFR sur une plage — les bougies restent lisibles sous les barres ; Backtest — aire de drawdown translucide ; RATE (courbe des taux) — libellés dans la police du thème.

```bash
git add apps/web/src/chart/volumeRangeOverlay.ts apps/web/src/components/BacktestWindow.tsx apps/web/src/components/CourbeTaux.tsx
git commit -m "fix(chart): VPFR semi-transparent (0.55 comme le VPVR), alpha drawdown robuste, police canvas résolue"
```

---

## Phase C — Formats numériques (P1)

### Task 11 : `formatFunding` / `formatUsdSigne` promus dans lib/format

**Files:**
- Modify: `apps/web/src/lib/format.ts` + `apps/web/src/lib/format.test.ts`
- Modify: `apps/web/src/data/brief.ts:291-300`, `apps/web/src/components/BriefWindow.tsx:111-120`, `apps/web/src/components/DerivativesWindow.tsx:77-81`
- Modify: `apps/web/src/chart/priceAlertMenu.ts:65-72` + son test

- [ ] **Step 1 : tests (rouge)**

Dans `format.test.ts` :

```ts
describe("formatFunding", () => {
  it("fraction → % signé 4 décimales (convention funding)", () => {
    expect(formatFunding(0.0001)).toBe("+0.0100%");
    expect(formatFunding(-0.0025)).toBe("-0.2500%");
  });
  it("absent → —", () => {
    expect(formatFunding(null)).toBe("—");
    expect(formatFunding(undefined)).toBe("—");
  });
});

describe("formatUsdSigne", () => {
  it("« + » explicite sur les gains", () => {
    expect(formatUsdSigne(12_340_000)).toBe("+$12.34M");
  });
  it("négatif et zéro passent par formatUsd tel quel", () => {
    expect(formatUsdSigne(-1_300_000_000)).toBe(formatUsd(-1_300_000_000));
    expect(formatUsdSigne(0)).toBe(formatUsd(0));
  });
});
```

Run: `pnpm --filter @axiom/web test format` → FAIL.

- [ ] **Step 2 : implémenter dans format.ts**

```ts
/** Funding (fraction, ex. 0.0001) → pourcentage signé 4 décimales : « +0.0100% ». */
export function formatFunding(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return VALEUR_ABSENTE;
  return formatPct(rate * 100, 4);
}

/** Montant USD avec « + » explicite si positif (PnL, deltas) : « +$12.34M ». */
export function formatUsdSigne(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return VALEUR_ABSENTE;
  const base = formatUsd(v);
  return v > 0 ? `+${base}` : base;
}
```

Run: `pnpm --filter @axiom/web test format` → PASS.

- [ ] **Step 3 : supprimer les 4 copies**

- `data/brief.ts:291-300` : supprimer `fmtFunding`/`fmtUsdSigne` ; importer `formatFunding, formatUsdSigne` de `../lib/format` ; renommer les appels (`fmtFunding(` → `formatFunding(`, `fmtUsdSigne(` → `formatUsdSigne(`).
- `BriefWindow.tsx:111-120` : idem.
- `DerivativesWindow.tsx:77-81` : supprimer le `formatFunding` local (même nom : il suffit de supprimer la fonction et d'ajouter l'import).
- `chart/priceAlertMenu.ts:65-72` : `formaterNiveauCourt` délègue au formateur canonique :

```ts
/** PURE — niveau de prix au format standard du terminal (délègue à lib/format). */
export function formaterNiveauCourt(niveau: number): string {
  if (!Number.isFinite(niveau)) return String(niveau);
  return formatPrice(niveau);
}
```

Mettre à jour `priceAlertMenu.test.ts` : les attentes suivent `formatPrice` (2/4/6 décimales avec padding — ex. `formaterNiveauCourt(0.0013)` → `"0.001300"`).

- [ ] **Step 4 : vérifier + commit**

Run: `pnpm --filter @axiom/web test && pnpm --filter @axiom/web typecheck` → PASS.

```bash
git add apps/web/src/lib apps/web/src/data/brief.ts apps/web/src/components/BriefWindow.tsx apps/web/src/components/DerivativesWindow.tsx apps/web/src/chart/priceAlertMenu.ts apps/web/src/chart/priceAlertMenu.test.ts
git commit -m "refactor(format): formatFunding/formatUsdSigne promus (4 copies supprimées) ; menu alerte prix sur formatPrice"
```

---

### Task 12 : Primitive `Fraicheur` + conventions % (FUNDX, TERM, OMON, BT)

**Files:**
- Modify: `apps/web/src/components/ui.tsx` (+ `Fraicheur`/`texteFraicheur`)
- Create: `apps/web/src/components/ui.fraicheur.test.ts`
- Modify: `apps/web/src/components/OptionsWindow.tsx:650,676-681`, `TermStructureWindow.tsx:125-132,345-348`, `CorrWindow.tsx:465-471`, `MarketMapWindow.tsx:411-415`, `DerivativesWindow.tsx:471-474`, `FundingMatrixWindow.tsx:57-87`, `BacktestWindow.tsx:490-503`

**Interfaces:**
- Produces: `texteFraicheur(loading: boolean, majTs: number | null, now: number, cadence?: string): string` (pur) et `<Fraicheur loading majTs? cadence? />` exportés de `ui.tsx`. Forme canonique : « maj… » (chargement) / « maj il y a X » (timestamp connu) / « maj ~cadence » (cadence seule) / « — ».

- [ ] **Step 1 : test (rouge)**

Créer `ui.fraicheur.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { texteFraicheur } from "./ui";

const NOW = 1_700_000_000_000;

describe("texteFraicheur — la ligne de fraîcheur standard", () => {
  it("chargement → « maj… »", () => {
    expect(texteFraicheur(true, NOW - 5_000, NOW)).toBe("maj…");
  });
  it("timestamp connu → « maj il y a X »", () => {
    expect(texteFraicheur(false, NOW - 12_000, NOW)).toBe("maj il y a 12 s");
  });
  it("sans timestamp mais cadence connue → « maj ~cadence »", () => {
    expect(texteFraicheur(false, null, NOW, "1 min")).toBe("maj ~1 min");
  });
  it("ni timestamp ni cadence → « — »", () => {
    expect(texteFraicheur(false, null, NOW)).toBe("—");
  });
});
```

(Si `formatAge` produit « il y a 12 s » avec une autre espacement, aligner l'attente sur `formatAge` réel — vérité dans `format.test.ts`.)
Run: `pnpm --filter @axiom/web test fraicheur` → FAIL.

- [ ] **Step 2 : implémenter dans ui.tsx**

```tsx
/** Texte de fraîcheur standard (pur, testé) — forme canonique de la revue v2 (H11). */
export function texteFraicheur(
  loading: boolean,
  majTs: number | null,
  now: number,
  cadence?: string,
): string {
  if (loading) return "maj…";
  if (majTs !== null && Number.isFinite(majTs)) return `maj ${formatAge(majTs, now)}`;
  return cadence !== undefined ? `maj ~${cadence}` : VALEUR_ABSENTE;
}

/** Ligne de fraîcheur standard — remplace les 4 variantes divergentes des fenêtres. */
export function Fraicheur({
  loading,
  majTs,
  cadence,
}: {
  loading: boolean;
  majTs?: number | null;
  cadence?: string;
}) {
  return <span>{texteFraicheur(loading, majTs ?? null, Date.now(), cadence)}</span>;
}
```

(Imports à ajouter en tête de ui.tsx : `formatAge`, `VALEUR_ABSENTE` depuis `../lib/format`.)
Run: `pnpm --filter @axiom/web test fraicheur` → PASS.

- [ ] **Step 3 : adopter dans les 6 fenêtres**

- `OptionsWindow.tsx:650` : `{loading ? "maj…" : majTs ? `maj ${formatAge(majTs, Date.now())}` : "—"}` → `<Fraicheur loading={loading} majTs={majTs} />`.
- `TermStructureWindow.tsx:347` : idem.
- `CorrWindow.tsx:465-471` : le span devient `<Fraicheur loading={loading} majTs={majTs} />` (la variante « maj 14:32 » disparaît).
- `MarketMapWindow.tsx:413-415` : `{loading ? "maj…" : `maj ${formatAge(...)}${overview.stale ? " · cache" : ""}`}` → `<><Fraicheur loading={loading} majTs={overview.fetchedAt} />{overview.stale ? " · cache" : ""}</>`.
- `DerivativesWindow.tsx:473` : `{loading ? "maj…" : majTs ? "maj ~1 min" : "—"}` → `<Fraicheur loading={loading} majTs={majTs} cadence="1 min" />`.
- `FundingMatrixWindow.tsx` : la fenêtre n'a AUCUNE fraîcheur. `grep -n "useState\|setDonnees\|fetch" apps/web/src/components/FundingMatrixWindow.tsx` pour localiser le succès du fetch ; ajouter `const [majTs, setMajTs] = useState<number | null>(null);`, `setMajTs(Date.now());` au succès, et dans le sous-titre de l'en-tête (l.57-63, à côté de l'écart) : `{" · "}<Fraicheur loading={chargement} majTs={majTs} />` (adapter le nom du flag de chargement à celui du fichier).

- [ ] **Step 4 : conventions % au passage**

- `FundingMatrixWindow.tsx:83` : `{formatDec(v.ratePct, 4)} %` → `{formatPct(v.ratePct, 4)}` ; l.86 : `{formatDec(v.apr, 2)} %` → `{formatPct(v.apr, 2)}` ; l.60 : `{formatDec(spread, 2)} %` → `{formatPct(spread, 2, { signe: false })}` (imports `formatPct` en remplacement de `formatDec` si plus utilisé).
- `TermStructureWindow.tsx:128` : `const pct = \`${moy >= 0 ? "+" : ""}${formatPourcentage(moy * 100, 1)}/an\`;` → `const pct = \`${formatPct(moy * 100, 1)}/an\`;`.
- `OptionsWindow.tsx:678` : `pcRatio.toFixed(2)` → `formatDec(pcRatio, 2)` ; l.681 : `` `${dvol.toFixed(1)}%` `` → `formatPourcentage(dvol, 1)` (convention « niveau », alignée sur VolWindow).
- `BacktestWindow.tsx:491,501,502` : `` `${s.winRatePct.toFixed(1)}%` `` → `formatPourcentage(s.winRatePct, 1)` ; `` `${s.maxDrawdownPct.toFixed(1)}%` `` → `formatPourcentage(s.maxDrawdownPct, 1)` ; `` `${s.expositionPct.toFixed(0)}%` `` → `formatPourcentage(s.expositionPct, 0)`.

- [ ] **Step 5 : vérifier + commit**

Run: `pnpm --filter @axiom/web test && pnpm --filter @axiom/web typecheck` → PASS.
Visuel : OMON/TERM/CORR/MAP/DES affichent la même forme « maj il y a X » ; FUNDX a désormais une fraîcheur et un funding signé collé (« +0.0100% »).

```bash
git add apps/web/src/components apps/web/src/lib
git commit -m "feat(ui): primitive Fraicheur (forme canonique unique) + conventions % unifiées (FUNDX, TERM, OMON, BT)"
```

---

## Phase D — Primitives & conformité fenêtres

### Task 13 : Primitive `Segmente` + états actifs `bg-bg` + onglets DOM + Taskbar

**Files:**
- Modify: `apps/web/src/components/ui.tsx` (+ `Segmente`)
- Modify: `apps/web/src/components/CorrWindow.tsx:427-451`, `OptionsWindow.tsx:520-533` (+ les 4 autres groupes du fichier), `MacroRatesWindow.tsx:290-336`, `OnchainWindow.tsx:513-525`, `NewsWindow.tsx:275-285`, `DomWindow.tsx:517-535`, `Taskbar.tsx:52-100`

**Interfaces:**
- Produces: `Segmente<T extends string>({ options, actif, onChange })` exporté de `ui.tsx` — groupe segmenté standard (conteneur bordé, actif `bg-bg text-text`, `aria-pressed`).

- [ ] **Step 1 : ajouter `Segmente` à ui.tsx**

```tsx
/**
 * Groupe segmenté standard (bascule exclusive) : conteneur bordé arrondi,
 * segment actif `bg-bg text-text` (standard §2 — jamais bg-surface, invisible
 * sur le corps bg-surface des fenêtres). Consacre le pattern d'OptionsWindow.
 */
export function Segmente<T extends string>({
  options,
  actif,
  onChange,
}: {
  options: ReadonlyArray<{ id: T; label: string }>;
  actif: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-border text-[11px]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={actif === o.id}
          className={`flex-1 px-3 py-1.5 transition ${
            actif === o.id ? "bg-bg text-text" : "text-text-dim hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2 : migrer CORR et OMON sur `Segmente`**

- `CorrWindow.tsx:427-439` (méthode) :

```tsx
<Segmente
  options={[
    { id: "pearson", label: "Pearson" },
    { id: "spearman", label: "Spearman" },
  ] as const}
  actif={methode}
  onChange={setMethode}
/>
```

- `CorrWindow.tsx:443-451` (fenêtre 30/90/180 j) : même migration (`options={FENETRES_JOURS.map((f) => ({ id: f, label: `${f} j` }))}` — adapter au type existant ; si les ids sont des `number`, garder les boutons mais corriger `bg-surface` → `bg-bg`).
- `OptionsWindow.tsx` : `grep -n '"bg-bg text-text"' apps/web/src/components/OptionsWindow.tsx` — remplacer chacun des 5 groupes segmentés inline par `Segmente` (même structure que l'exemple l.520-533 : options littérales, `actif`, `onChange`).

- [ ] **Step 3 : états actifs `bg-surface` → `bg-bg`**

- `MacroRatesWindow.tsx:297` : `vue === v.id ? "bg-surface text-text"` → `"bg-bg text-text"` ; l.330 : `actif ? "bg-surface text-text"` → `"bg-bg text-text"`.
- `OnchainWindow.tsx:520` : `actifEtf === a ? "bg-surface text-text"` → `"bg-bg text-text"`.
- `NewsWindow.tsx:281` : `filtreSymbole ? "bg-surface text-text"` → `"bg-bg text-text"`.

- [ ] **Step 4 : DomWindow → primitive `Onglets`**

`DomWindow.tsx:517-535` : remplacer la rangée manuscrite par :

```tsx
<Onglets
  options={[
    { id: "ladder", label: "Ladder" },
    { id: "depth", label: "Depth" },
    { id: "tape", label: "Tape" },
  ] as const}
  actif={tab}
  onChange={setTab}
/>
```

(import `Onglets` de `./ui` ; l'`uppercase tracking-wide` local disparaît — uniformité avec MAP/STBL/LIQ.)

- [ ] **Step 5 : Taskbar — BTN_SECONDAIRE, wrap, ✕ focalisable**

- l.53 : `className="flex shrink-0 gap-1 …"` → `className="flex shrink-0 flex-wrap gap-1 …"` (plus de débordement à ~8 fenêtres).
- l.54-69 : les deux boutons prennent `className={BTN_SECONDAIRE}` (import de `./ui`) — l'ajout local `font-medium` disparaît.
- l.92-100 : le ✕ `hidden group-hover:flex` (jamais focalisable) devient :

```tsx
className="absolute right-0.5 top-1/2 z-10 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-sm bg-surface text-[10px] leading-none text-text-dim opacity-0 transition hover:text-down focus-visible:opacity-100 group-hover:opacity-100"
```

- [ ] **Step 6 : vérifier + commit**

Run: `pnpm --filter @axiom/web test && pnpm --filter @axiom/web typecheck` → PASS.
Visuel : bascules RATE/CHAIN/NEWS visibles à l'état actif ; onglets DOM alignés sur les autres fenêtres ; Tab atteint le ✕ des pastilles Taskbar.

```bash
git add apps/web/src/components
git commit -m "refactor(ui): primitive Segmente (CORR/OMON), actifs bg-bg (RATE/CHAIN/NEWS), onglets DOM, Taskbar wrap + ✕ focalisable"
```

---

### Task 14 : `Metric.labelExtra` (fin du Metric local DERIV), en-tête MAP, erreur STBL, META_SOURCE partagé

**Files:**
- Modify: `apps/web/src/components/ui.tsx:217-247` (Metric)
- Modify: `apps/web/src/components/DerivativesWindow.tsx:89-140` (Metric local + call sites)
- Modify: `apps/web/src/components/MarketMapWindow.tsx:386-418`
- Modify: `apps/web/src/components/StablecoinsWindow.tsx:736-743`
- Create: `apps/web/src/data/newsMeta.ts` ; Modify: `NewsWindow.tsx:75-81`, `TickerBand.tsx:104-110`

- [ ] **Step 1 : slot `labelExtra` sur ui.Metric**

```tsx
export function Metric({
  label,
  value,
  couleur,
  extra,
  labelExtra,
}: {
  label: string;
  value: string;
  couleur?: string;
  extra?: ReactNode;
  /** Élément accolé au libellé (ex. BadgeFiabilite de DERIV). */
  labelExtra?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2">
      <span className="flex items-center gap-1.5 text-[11px] text-text-dim">
        {label}
        {labelExtra}
      </span>
      …reste inchangé…
```

- [ ] **Step 2 : supprimer le Metric local de DERIV**

Lire le corps du `Metric` local (`DerivativesWindow.tsx:94-140` environ) pour identifier comment il rend la sparkline et le badge (`BadgeFiabilite`/`metaSource`). Supprimer la fonction locale, importer `Metric` de `./ui`, et adapter CHAQUE call site (`grep -n "<Metric" apps/web/src/components/DerivativesWindow.tsx`) :

```tsx
<Metric
  label="Open Interest"
  value={formatUsd(oi?.oiUsd)}
  couleur="var(--serie-1)"
  extra={oiSpark && <Sparkline values={oiSpark} />}
  labelExtra={<BadgeFiabilite meta={metaSource("coinalyze:oi")} />}
/>
```

(props : `color` → `couleur` ; `sparkValues={xs}` → `extra={xs && <Sparkline values={xs} />}` ; `sourceId="id"` → `labelExtra={<BadgeFiabilite meta={metaSource("id")} />}` — reprendre la construction exacte du badge depuis le corps local supprimé ; `Sparkline` reste local au fichier.)

- [ ] **Step 3 : MarketMapWindow → EnTeteFenetre**

Remplacer le `<header>` manuscrit (l.386-418) par la primitive, le contenu de la ligne d'infos passant en `sousTitre` :

```tsx
<EnTeteFenetre
  titre="Vue marché"
  sousTitre={
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      …les <span> existants (Cap., BTC/ETH, Vol 24h, F&G, fraîcheur) inchangés…
    </span>
  }
  actions={…les actions existantes du header s'il y en a à droite…}
/>
```

Au passage : `g.btcDominance.toFixed(1)}%` → `formatPourcentage(g.btcDominance, 1)` (idem ethDominance).

- [ ] **Step 4 : STBL — erreur sans retry**

`StablecoinsWindow.tsx:736-743` : supprimer le bouton « Réessayer » (standard §2 : erreur textuelle) :

```tsx
{statut === "error" && <ErreurBloc>Impossible de charger les données DefiLlama.</ErreurBloc>}
```

(`grep -n "essai" apps/web/src/components/StablecoinsWindow.tsx` — si `setEssai` n'a plus d'appelant, supprimer l'état `essai` et sa participation aux deps du fetch.)

- [ ] **Step 5 : META_SOURCE consolidé**

Créer `apps/web/src/data/newsMeta.ts` (vérifier le chemin d'import de `NEWS_FEEDS`/`NewsSourceId` via `grep -n "NEWS_FEEDS" apps/web/src/components/NewsWindow.tsx`) :

```ts
import { NEWS_FEEDS, type NewsSourceId } from "./news";

/**
 * Libellé + couleur par source de news — partagé NewsWindow / TickerBand
 * (les deux copies verbatim de la revue v2). GDELT n'est pas un feed déclaré :
 * couleur de série thémée (var résolue par le style inline).
 */
export const META_SOURCE: Record<NewsSourceId, { label: string; color: string }> = {
  ...(Object.fromEntries(NEWS_FEEDS.map((f) => [f.id, { label: f.label, color: f.color }])) as Record<
    NewsSourceId,
    { label: string; color: string }
  >),
  gdelt: { label: "GDELT", color: "var(--serie-4)" },
};
```

`NewsWindow.tsx:75-81` et `TickerBand.tsx:104-110` : supprimer les définitions locales, importer `META_SOURCE` de `../data/newsMeta`.

- [ ] **Step 6 : vérifier + commit**

Run: `pnpm --filter @axiom/web test && pnpm --filter @axiom/web typecheck` → PASS.
Visuel : DES intact (badges + sparklines) ; MAP avec l'en-tête standard ; pastille GDELT thémée dans NEWS et le bandeau.

```bash
git add apps/web/src/components apps/web/src/data/newsMeta.ts
git commit -m "refactor(ui): Metric.labelExtra (fin du Metric local DERIV), en-tête MAP standard, erreur STBL sans retry, META_SOURCE partagé"
```

---

### Task 15 : Convention de titre « MNEMO · Libellé » (prop `mnemo` d'EnTeteFenetre)

**Files:**
- Modify: `apps/web/src/components/ui.tsx:148-171` (EnTeteFenetre)
- Modify: toutes les fenêtres utilisant `EnTeteFenetre` (liste au Step 2)

- [ ] **Step 1 : prop `mnemo`**

```tsx
export function EnTeteFenetre({
  titre,
  sousTitre,
  actions,
  mnemo,
}: {
  titre: string;
  sousTitre?: ReactNode;
  actions?: ReactNode;
  /** Mnémonique ⌘K de la fenêtre — affiché « MNEMO · Titre » (convention terminal, revue v2). */
  mnemo?: string;
}) {
  return (
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text">
          {mnemo !== undefined && (
            <>
              <span className="text-accent">{mnemo}</span>
              <span className="text-text-dim"> · </span>
            </>
          )}
          {titre}
        </h2>
        …reste inchangé…
```

- [ ] **Step 2 : rollout sur les fenêtres**

Pour chaque fichier, ajouter `mnemo="…"` à l'appel `<EnTeteFenetre` (mnémoniques = ceux de `commands/windowPanels.ts` — vérifier avec `grep -n "mnemonique" apps/web/src/commands/windowPanels.ts`) et RETIRER tout préfixe manuel du titre :

| Fichier | mnemo | titre (après) |
|---|---|---|
| DerivativesWindow | DES | Produits dérivés |
| OptionsWindow | OMON | Options |
| TermStructureWindow | TERM | Structure par terme |
| VolWindow | VOL | Volatilité |
| CorrWindow | CORR | Corrélations *(retirer « CORR · » du titre actuel)* |
| MarketMapWindow | MAP | Vue marché |
| ScreenerWindow | EQS | Screener *(retirer « EQS · »)* |
| DomWindow | DOM | Carnet d'ordres |
| FundingMatrixWindow | FUNDX | *(titre actuel)* |
| EcoWindow | ECO | *(titre actuel)* |
| MacroRatesWindow | RATE | *(titre actuel)* |
| OnchainWindow | CHAIN | On-chain |
| FundWindow | FUND | *(titre actuel)* |
| StablecoinsWindow | STBL | Stablecoins |
| CotWindow | COT | *(titre actuel)* |
| SeasonalityWindow | SEAG | *(titre actuel)* |
| NewsWindow | NEWS | *(titre actuel)* |
| GlobeWindow | GLOBE | Globe |
| PortfolioWindow | PORT | *(titre actuel)* |
| NotesWindow | NOTE | *(titre actuel)* |
| BacktestWindow | BT | *(titre actuel)* |
| ReplayWindow | REPLAY | *(titre actuel)* |
| LiquidationsWindow | LIQ | Liquidations *(voir Task 16)* |

(Les titres « *(titre actuel)* » restent tels quels. Les fenêtres sans `EnTeteFenetre` — BriefWindow a son en-tête custom « BRIEF · POINT MARCHÉ » déjà conforme — ne bougent pas. Si un mnémonique du tableau diverge de windowPanels.ts, windowPanels fait foi.)

- [ ] **Step 3 : vérifier + commit**

Run: `pnpm --filter @axiom/web test && pnpm --filter @axiom/web typecheck` → PASS.
Visuel : 4-5 fenêtres ouvertes — tous les titres portent leur mnémonique en accent.

```bash
git add apps/web/src/components
git commit -m "feat(ui): convention de titre « MNEMO · Libellé » via EnTeteFenetre.mnemo, uniforme sur les fenêtres"
```

---

### Task 16 : LiquidationsWindow — en-tête unique au-dessus des onglets + libellé du feed

**Files:**
- Modify: `apps/web/src/components/LiquidationsWindow.tsx:311-324,516-547,830-960`

- [ ] **Step 1 : remonter l'en-tête**

Dans le composant racine (l.946-958) : lever l'état `fenetre` de `ContenuHistorique` (le `useState<FenetreHisto>` et son éventuelle persistance montent dans `LiquidationsWindow`, passés en props `fenetre`/`onChange`), lire `symbol` comme le fait `ContenuLive` (même sélecteur marketStore), puis :

```tsx
  return (
    <div className="flex h-full flex-col">
      <EnTeteFenetre
        mnemo="LIQ"
        titre="Liquidations"
        sousTitre={
          onglet === "live"
            ? `${symbol} · ${okxCouvre(symbol) ? "perp Bybit + OKX (live)" : "perp Bybit (live)"}`
            : `${symbol} · historique daemon (rétention 30 j)`
        }
        actions={
          onglet === "historique" ? (
            <SelecteurFenetreHisto fenetre={fenetre} onChange={setFenetre} />
          ) : undefined
        }
      />
      <Onglets options={ONGLETS} actif={onglet} onChange={setOnglet} />
      {onglet === "live" ? <ContenuLive /> : <ContenuHistorique fenetre={fenetre} />}
    </div>
  );
```

Supprimer les deux `EnTeteFenetre` internes (l.544-547 et l.834-838) et les duplications de titre qu'ils portaient.

- [ ] **Step 2 : libellé explicite du feed**

Au-dessus du feed de l'onglet Live (rendu de `feed`, l.516-518), ajouter la portée réelle (le sélecteur 5m/1h/24h ne filtre PAS le feed — revue v2) :

```tsx
<div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">
  Dernières liquidations ({MAX_FEED} max · indépendant de la fenêtre 5m/1h/24h)
</div>
```

- [ ] **Step 3 : vérifier + commit**

Run: `pnpm --filter @axiom/web test && pnpm --filter @axiom/web typecheck` → PASS.
Visuel : LIQ — en-tête unique, onglets dessous (même structure que STBL) ; bascule Live↔Historique conserve le sélecteur d'historique dans l'en-tête.

```bash
git add apps/web/src/components/LiquidationsWindow.tsx
git commit -m "fix(liq): en-tête unique au-dessus des onglets (convention STBL) + portée du feed explicitée"
```

---

## Phase E — Palette & mnémoniques

### Task 17 : Mnémoniques uniques (FRATE, mois en xMO) + test d'unicité

**Files:**
- Modify: `apps/web/src/store/derivatives-chart.ts:47-55`
- Modify: `apps/web/src/commands/registry.ts:338-349`
- Modify: `apps/web/src/commands/registry.test.ts`
- Modify: `apps/web/src/commands/hotkeys.ts:47-67` (mention FUND → FRATE dans l'aide statique si présente)

- [ ] **Step 1 : test d'unicité (rouge)**

Dans `registry.test.ts`, ajouter (en important pour effets de bord les modules qui greffent des commandes externes — suivre les `vi.mock` existants du fichier ; si un import tire du DOM, le mocker comme les précédents) :

```ts
import "../store/derivatives-chart";
import "./windowPanels";

it("aucun mnémonique dupliqué dans le registre complet (insensible à la casse)", () => {
  const vus = new Map<string, string>();
  for (const c of construireRegistre()) {
    if (c.mnemonique === undefined) continue;
    const cle = c.mnemonique.toLowerCase();
    expect(vus.get(cle), `« ${c.mnemonique} » dupliqué entre ${vus.get(cle)} et ${c.id}`).toBeUndefined();
    vus.set(cle, c.id);
  }
});
```

Run: `pnpm --filter @axiom/web test registry` → FAIL (FUND ×2, et « 1M » minute vs mois).

- [ ] **Step 2 : résoudre les collisions**

- `derivatives-chart.ts:49` : `mnemonique: "FUND"` → `mnemonique: "FRATE"` ; `motsCles` gagne `"fund"` (la recherche libre continue de le trouver).
- `registry.ts:338-349` — mois en `xMO`, minutes inchangées :

```ts
  for (const tf of TF_COMMANDES) {
    // « 1M » (mois) entrait en collision insensible à la casse avec « 1m » (minute) :
    // les timeframes mensuels prennent le suffixe MO (1MO, 3MO, 6MO, 12MO).
    const mois = tf.endsWith("M");
    commandes.push({
      id: `tf:${tf}`,
      mnemonique: mois ? `${tf.slice(0, -1)}MO` : tf.toUpperCase(),
      libelle: `Timeframe ${tf}${mois ? " (mois)" : ""}`,
      categorie: "timeframe",
      motsCles: ["timeframe", "tf", "intervalle", tf],
      apercu: `Bascule le graphe en ${tf}`,
      action: () => marketStore.getState().setTimeframe(tf),
    });
  }
```

- `hotkeys.ts:47-67` : dans la chaîne d'aide statique, remplacer la mention du sous-pane « FUND » par « FRATE » si elle y figure (la ligne est réécrite en Task 19 de toute façon).

- [ ] **Step 3 : vérifier + commit**

Run: `pnpm --filter @axiom/web test registry` → PASS (unicité + « expose les 11 timeframes » inchangé).

```bash
git add apps/web/src/store/derivatives-chart.ts apps/web/src/commands
git commit -m "fix(palette): mnémoniques uniques — sous-pane funding FRATE, mois en 1MO/3MO/6MO/12MO + test d'unicité"
```

---

### Task 18 : Navigation de paire explicite + toast « Annuler »

**Files:**
- Modify: `apps/web/src/store/toasts.ts:11-56` + `apps/web/src/components/Toasts.tsx`
- Modify: `apps/web/src/commands/registry.ts:179-201` (`appliquerNavigation`, `commandeNavigation`)
- Modify: `apps/web/src/components/CommandPalette.tsx:255-274` (rendu nav distinct + aria)
- Test: `apps/web/src/commands/registry.test.ts`, `apps/web/src/store/toasts.test.ts` (s'il existe, sinon créer)

**Interfaces:**
- Produces: `pousserToast(texte: string, action?: { libelle: string; executer: () => void }): void` — un toast avec action reste 6 s au lieu de 2,5 s ; `commandeNavigation` libelle « Changer la paire → X » quand un symbole est visé.

- [ ] **Step 1 : tests (rouge)**

`registry.test.ts` :

```ts
it("un changement de paire s'annonce explicitement dans la palette", () => {
  const cmd = commandeNavigation({ symbol: "DERIVUSDT" });
  expect(cmd.libelle).toBe("Changer la paire → DERIVUSDT");
  const tf = commandeNavigation({ timeframe: "4h" });
  expect(tf.libelle).toBe("Aller à 4h");
});
```

`toasts.test.ts` (les fonctions store sont testables en node) :

```ts
import { pousserToast, retirerToast, toastsStore } from "./toasts";

it("un toast peut porter une action (Annuler)", () => {
  let annule = false;
  pousserToast("Paire changée → DERIVUSDT", { libelle: "Annuler", executer: () => { annule = true; } });
  const t = toastsStore.getState().toasts.at(-1);
  expect(t?.action?.libelle).toBe("Annuler");
  t?.action?.executer();
  expect(annule).toBe(true);
  if (t) retirerToast(t.id);
});
```

Run: `pnpm --filter @axiom/web test "toasts|registry"` → FAIL.

- [ ] **Step 2 : toasts avec action**

`toasts.ts` :

```ts
export interface Toast {
  id: number;
  texte: string;
  /** Action optionnelle (ex. « Annuler ») — le toast reste affiché plus longtemps. */
  action?: { libelle: string; executer: () => void };
}

const DUREE_ACTION_MS = 6000; // un toast actionnable laisse le temps de cliquer

export function pousserToast(texte: string, action?: Toast["action"]): void {
  const id = prochainId;
  prochainId += 1;
  toastsStore.setState((s) => ({ toasts: empilerToast(s.toasts, { id, texte, action }, MAX_TOASTS) }));
  setTimeout(() => retirerToast(id), action !== undefined ? DUREE_ACTION_MS : DUREE_MS);
}
```

`Toasts.tsx` : dans le rendu d'un toast, après le texte :

```tsx
{t.action !== undefined && (
  <button
    type="button"
    onClick={() => {
      t.action?.executer();
      retirerToast(t.id);
    }}
    className="ml-2 rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-accent transition hover:text-text"
  >
    {t.action.libelle}
  </button>
)}
```

- [ ] **Step 3 : navigation explicite + annulable**

`registry.ts` — `commandeNavigation` (l.187-201) :

```ts
  const libelle = nav.symbol !== undefined ? `Changer la paire → ${cible}` : `Aller à ${cible}`;
```

(et utiliser `libelle` dans l'objet retourné). `appliquerNavigation` (l.179-184) :

```ts
export function appliquerNavigation(nav: NavCommande): void {
  const m = marketStore.getState();
  const avant = { exchange: m.exchange, symbol: m.symbol, timeframe: m.timeframe };
  if (nav.source !== undefined) m.setExchange(nav.source);
  if (nav.symbol !== undefined) m.setSymbol(nav.symbol);
  if (nav.timeframe !== undefined) m.setTimeframe(nav.timeframe);
  // Un changement de PAIRE bascule tout le terminal : toast annulable (revue v2 —
  // « DERIV » tapé dans ⌘K avait changé la paire globale silencieusement).
  if (nav.symbol !== undefined && nav.symbol !== avant.symbol) {
    pousserToast(`Paire changée → ${nav.symbol}`, {
      libelle: "Annuler",
      executer: () => {
        const s = marketStore.getState();
        s.setExchange(avant.exchange);
        s.setSymbol(avant.symbol);
        s.setTimeframe(avant.timeframe);
      },
    });
  }
}
```

(import `pousserToast` — vérifier l'absence de cycle d'import ; si `toasts.ts` importe déjà du registre, passer par un import dynamique local `void import("../store/toasts").then(...)` — improbable, toasts est autonome.)

- [ ] **Step 4 : rendu palette — la navigation se distingue + aria**

`CommandPalette.tsx` (l.255-274) :

```tsx
className={`flex w-full items-center gap-3 px-4 py-1.5 text-left ${
  it.cmd.id === "nav" ? "border-l-2 border-accent " : ""
}${i === indexSel ? "bg-accent/15" : "hover:bg-bg"}`}
```

et la colonne mnémonique affiche `→` pour la navigation : `{it.cmd.id === "nav" ? "→" : (it.cmd.mnemonique ?? "")}`.
Aria : sur le conteneur de liste `role="listbox"` + `aria-activedescendant={`palette-item-${indexSel}`}` ; sur chaque bouton `role="option"`, `id={`palette-item-${i}`}`, `aria-selected={i === indexSel}`.

- [ ] **Step 5 : vérifier + commit**

Run: `pnpm --filter @axiom/web test && pnpm --filter @axiom/web typecheck` → PASS.
Visuel : taper `DERIV` dans ⌘K → la ligne « Changer la paire → DERIVUSDT » est bordée d'accent ; ⏎ → toast « Paire changée → DERIVUSDT [Annuler] » ; Annuler restaure BTCUSDT.

```bash
git add apps/web/src/store/toasts.ts apps/web/src/store/toasts.test.ts apps/web/src/components/Toasts.tsx apps/web/src/commands apps/web/src/components/CommandPalette.tsx
git commit -m "feat(palette): changement de paire explicite (« Changer la paire → X ») + toast Annuler ; aria listbox"
```

---

### Task 19 : Aide « ? » dérivée du registre réel

**Files:**
- Modify: `apps/web/src/commands/registry.ts` (export `CATEGORIE_LABEL`)
- Modify: `apps/web/src/commands/hotkeys.ts:47-67` (+ `lignesMnemoniques`)
- Modify: `apps/web/src/components/CommandPalette.tsx:210-222` (mode aide)
- Test: `apps/web/src/commands/hotkeys.test.ts`

**Interfaces:**
- Produces: `lignesMnemoniques(registre: readonly Commande[]): { touche: string; description: string }[]` exportée de `hotkeys.ts` — une ligne par catégorie, dérivée du registre. `RACCOURCIS_AIDE` perd sa ligne « ⌘K puis mnémo » maintenue à la main.

- [ ] **Step 1 : test (rouge)**

`hotkeys.test.ts` :

```ts
import { construireRegistre } from "./registry";
import { lignesMnemoniques } from "./hotkeys";
import "../store/derivatives-chart";
import "./windowPanels";

it("chaque mnémonique du registre apparaît dans l'aide dérivée (l'aide ne peut plus se périmer)", () => {
  const registre = construireRegistre();
  const texte = lignesMnemoniques(registre).map((l) => l.description).join(" ");
  for (const c of registre) {
    if (c.mnemonique !== undefined) expect(texte).toContain(c.mnemonique);
  }
});
```

Run: `pnpm --filter @axiom/web test hotkeys` → FAIL (export absent).

- [ ] **Step 2 : implémenter**

- `registry.ts` : déplacer/exporter le mapping des catégories (actuellement `CATEGORIE_LABEL` local à CommandPalette — `grep -n "CATEGORIE_LABEL" apps/web/src/components/CommandPalette.tsx`) :

```ts
/** Libellés FR des catégories (palette + aide). */
export const CATEGORIE_LABEL: Record<CategorieCommande, string> = { …valeurs existantes de CommandPalette… };
```

(CommandPalette l'importe désormais d'ici.)
- `hotkeys.ts` :

```ts
/**
 * Lignes d'aide des mnémoniques, DÉRIVÉES du registre réel — remplace la chaîne
 * maintenue à la main (périmée dès le lot suivant : LIQ, STBL, WTILE… manquaient).
 */
export function lignesMnemoniques(
  registre: readonly Commande[],
): { touche: string; description: string }[] {
  const parCategorie = new Map<string, string[]>();
  for (const c of registre) {
    if (c.mnemonique === undefined) continue;
    const liste = parCategorie.get(c.categorie) ?? [];
    liste.push(c.mnemonique);
    parCategorie.set(c.categorie, liste);
  }
  return [...parCategorie.entries()].map(([categorie, mnemos]) => ({
    touche: "⌘K",
    description: `${CATEGORIE_LABEL[categorie as CategorieCommande] ?? categorie} : ${mnemos.join(" ")}`,
  }));
}
```

- `RACCOURCIS_AIDE` : SUPPRIMER la ligne « ⌘K puis mnémo » (l.51-56) et la ligne « ⌘K → PLAY* » (couvertes par la dérivation) ; garder toutes les autres (1-9, /, O, V, R, L, F, T, Échap, ⌘K, ?) — `raccourciPour` continue de fonctionner (ses fragments « Orderflow », « Profil Vol »… vivent dans les lignes conservées).
- `CommandPalette.tsx` mode aide (l.210-222) : rendre `[...RACCOURCIS_AIDE, ...lignesMnemoniques(registre)]` (le registre est déjà construit dans le composant) — chaque ligne dérivée sur sa propre rangée, fini la chaîne de 340 caractères.

- [ ] **Step 3 : vérifier + commit**

Run: `pnpm --filter @axiom/web test hotkeys` → PASS (et le test `raccourciPour` existant reste vert).
Visuel : « ? » — l'aide liste les mnémoniques par catégorie sur plusieurs lignes, LIQ/STBL/FUNDX/WTILE inclus.

```bash
git add apps/web/src/commands apps/web/src/components/CommandPalette.tsx
git commit -m "fix(aide): l'aide ? dérive du registre réel (groupée par catégorie) — elle ne peut plus se périmer (test)"
```

---

## Phase F — Fenêtres & workspaces

### Task 20 : L'état ouvert/minimisé survit au reload et aux workspaces

**Files:**
- Modify: `apps/web/src/store/persist.ts:218-259` (`validateEtatFenetre`, `hydrateWindowManager`)
- Modify: `apps/web/src/store/workspaces.ts:64-68,141-170` (`WorkspaceContent` doc, `validateWindowGeometry`)
- Test: `apps/web/src/store/workspaces.test.ts`

**Interfaces:**
- Décision de la spec (§7) : sémantique UNIQUE — un workspace restaure aussi `open`/`minimized`, et la session restaure son plan de fenêtres au reload. Les deux valideurs acceptent `open`/`minimized` persistés (défaut `false` si absents — compatibilité avec les sauvegardes existantes).

- [ ] **Step 1 : test (rouge)**

Dans `workspaces.test.ts`, à côté du bloc « validation au chargement » existant (l.217-256), ajouter (mêmes helpers/mocks que le bloc existant) :

```ts
it("un workspace relu depuis localStorage conserve l'état ouvert des fenêtres", () => {
  windowManagerStore.getState().openWindow("des");
  workspacesStore.getState().saveAs("plan");
  // Simule un reload : ré-exécute la lecture initiale sur le JSON réellement persisté
  // (même chemin que le test de corruption existant).
  const relu = lireInitialDepuisLocalStorageCommeLeTestExistant();
  const plan = relu.workspaces.find((w) => w.name === "plan");
  expect(plan?.content.windowGeometry["des"]?.open).toBe(true);
});
```

(Adapter la mécanique de relecture à celle du bloc « validation au chargement » : il écrit `axiom:workspaces:v1` puis relit — reprendre EXACTEMENT son échafaudage ; si `lireInitial` n'est pas exporté, exporter `validateContent` pour le test, comme le fait déjà le fichier pour ses fixtures, sinon tester via le même roundtrip localStorage.)
Run: `pnpm --filter @axiom/web test workspaces` → FAIL (`open` forcé à false).

- [ ] **Step 2 : accepter open/minimized dans les deux valideurs**

`workspaces.ts` — `validateWindowGeometry` (l.156-168) :

```ts
    windows[id] = {
      id,
      // Sémantique unique (revue v2, H15) : l'état ouvert/minimisé fait partie du
      // workspace — un preset restaure son plan de fenêtres, en session COMME après reload.
      open: r.open === true,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      z: r.z,
      minimized: r.minimized === true,
      groupColor: typeof r.groupColor === "string" ? r.groupColor : null,
      preSnapGeometry: null,
    };
```

Mettre à jour la JSDoc de `WorkspaceContent.windowGeometry` (l.64-67) : « Géométrie ET état ouvert/minimisé des fenêtres flottantes — restaurés à l'application, y compris après reload. »

`persist.ts` — `validateEtatFenetre` (l.233-245) : même changement (`open: r.open === true`, `minimized: r.minimized === true`), et mettre à jour les deux commentaires « toujours restauré FERMÉ » / « toujours restaurées FERMÉES » (l.233, l.249-250) : « l'état ouvert/minimisé est restauré — le plan de travail survit au reload (revue v2). »
Vérifier le chemin d'écriture : `grep -n "WINDOW_MANAGER_KEY" apps/web/src/store/persist.ts` — la sauvegarde sérialise déjà `windows` tel quel (open/minimized inclus), rien à changer côté écriture.

- [ ] **Step 3 : vérifier + commit**

Run: `pnpm --filter @axiom/web test workspaces && pnpm --filter @axiom/web test windowManager` → PASS (mettre à jour toute assertion existante qui figeait `open:false` après relecture).
Visuel : ouvrir DES + LIQ, reload → les deux reviennent ouvertes à leur place ; appliquer un preset → son plan de fenêtres s'ouvre.

```bash
git add apps/web/src/store
git commit -m "feat(fenetres): l'état ouvert/minimisé survit au reload et aux workspaces (sémantique unique, revue v2 H15)"
```

---

### Task 21 : toggleWindow restaure, tailles plafonnées, AZERTY, O/L/R avec feedback

**Files:**
- Modify: `apps/web/src/store/windowManager.ts:521-544,553-557` + `windowManager.test.ts`
- Modify: `apps/web/src/commands/hotkeys.ts:72,170-207` + `hotkeys.test.ts`

**Interfaces:**
- Produces: `timeframePourCode(code: string): Timeframe | null` (pur, exporté de hotkeys.ts, testé).

- [ ] **Step 1 : tests (rouge)**

`windowManager.test.ts` :

```ts
it("toggleWindow restaure une fenêtre minimisée au lieu de la fermer", () => {
  const s = windowManagerStore.getState();
  s.openWindow("des");
  s.minimizeWindow("des");
  s.toggleWindow("des");
  const w = windowManagerStore.getState().windows["des"];
  expect(w?.open).toBe(true);
  expect(w?.minimized).toBe(false);
});

it("la taille par défaut est plafonnée au workspace courant", () => {
  windowManagerStore.getState().setWorkspace({ …petit workspace, ex. 800×600 — reprendre le setter/shape réels du store (grep "workspace" dans windowManager.ts)… });
  windowManagerStore.getState().openWindow("map"); // defaultWidth 1100 > 800
  const w = windowManagerStore.getState().windows["map"];
  expect(w !== undefined && w.width <= 800).toBe(true);
});
```

`hotkeys.test.ts` :

```ts
import { timeframePourCode } from "./hotkeys";

it("mappe les codes physiques Digit/Numpad vers les timeframes (AZERTY inclus)", () => {
  expect(timeframePourCode("Digit1")).toBe("1m");
  expect(timeframePourCode("Numpad4")).toBe("1h");
  expect(timeframePourCode("Digit9")).toBe("3M");
  expect(timeframePourCode("KeyA")).toBeNull();
});
```

Run: `pnpm --filter @axiom/web test "windowManager|hotkeys"` → FAIL.

- [ ] **Step 2 : implémenter**

`windowManager.ts` — `toggleWindow` (l.553-557) :

```ts
  toggleWindow: (id) => {
    const w = get().windows[id];
    // Une fenêtre minimisée se RESTAURE (⌘K la faisait disparaître — revue v2).
    if (w?.open && w.minimized) {
      get().restoreWindow(id);
      return;
    }
    if (w?.open) get().closeWindow(id);
    else get().openWindow(id);
  },
```

`openWindow` (l.521-524) — plafonner au workspace (adapter au shape réel de `state.workspace`, celui que consomme déjà `cascadePosition`) :

```ts
    const entry = WINDOW_REGISTRY.find((w) => w.id === id);
    // Taille par défaut plafonnée au workspace : MAP (1100) ou STBL (860) débordaient
    // sur laptop (revue v2). Marge 24 px pour garder la poignée accessible.
    const width = Math.min(entry?.defaultWidth ?? 480, Math.max(320, state.workspace.width - 24));
    const height = Math.min(entry?.defaultHeight ?? 640, Math.max(240, state.workspace.height - 24));
```

`hotkeys.ts` — extraire le mapping pur et brancher `e.code` (l.170-179) :

```ts
/** Code physique (Digit1/Numpad1…) → timeframe rapide — indépendant de la disposition
 * clavier : sur AZERTY, e.key des chiffres non shiftés vaut « & é " … » (revue v2). */
export function timeframePourCode(code: string): Timeframe | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  if (m === null || m[1] === undefined) return null;
  return TF_CHIFFRES[Number(m[1]) - 1] ?? null;
}
```

```ts
      // Timeframes rapides par code PHYSIQUE (AZERTY : e.key vaudrait & é " …).
      const tfCode = timeframePourCode(e.code);
      if (tfCode !== null) {
        const exchange = marketStore.getState().exchange;
        const supportes = SUPPORTED_TIMEFRAMES[exchange] ?? [];
        if (supportes.includes(tfCode)) marketStore.getState().setTimeframe(tfCode);
        return;
      }
```

O/L/R — remplacer les no-op silencieux par un feedback (import `pousserToast`) :

```ts
        case "o": {
          if (SOURCES_FLUX_TRADES.has(marketStore.getState().exchange)) {
            orderflowStore.getState().toggle();
          } else {
            pousserToast("Orderflow indisponible sur cette source (flux de trades requis)");
          }
          break;
        }
```

(même motif pour `l` — « Heatmap liquidations indisponible sur cette source (perp Bybit/OKX requis) » — et `r` — « Revenus on-chain indisponibles en marchés traditionnels ».)

- [ ] **Step 3 : vérifier + commit**

Run: `pnpm --filter @axiom/web test "windowManager|hotkeys"` → PASS.
Visuel : minimiser LIQ puis ⌘K LIQ → elle se restaure ; touche « & » (AZERTY 1) → timeframe 1m ; touche L sur une source tradfi → toast explicatif.

```bash
git add apps/web/src/store/windowManager.ts apps/web/src/store/windowManager.test.ts apps/web/src/commands
git commit -m "fix(ergonomie): toggle restaure les fenêtres minimisées, tailles plafonnées au workspace, timeframes par e.code (AZERTY), O/L/R avec feedback"
```

---

### Task 22 : Suppressions armées + feedback de saisie invalide (PORT, ALRT)

**Files:**
- Modify: `apps/web/src/components/PortfolioWindow.tsx:166-183,451-458,498-564`
- Modify: `apps/web/src/components/AlertsPanel.tsx:109-137,221-228`

- [ ] **Step 1 : suppression armée (pattern confirmId de SettingsPanel.restaurer)**

`PortfolioWindow.tsx` — ajouter `const [confirmSuppr, setConfirmSuppr] = useState<string | null>(null);` puis remplacer le ✕ (l.451-458) :

```tsx
<button
  type="button"
  onClick={() => {
    // 1er clic : arme la confirmation ; 2e clic : supprime (pattern SettingsPanel.restaurer).
    if (confirmSuppr !== p.id) {
      setConfirmSuppr(p.id);
      return;
    }
    setConfirmSuppr(null);
    portfolioStore.getState().supprimer(p.id);
  }}
  onBlur={() => setConfirmSuppr((c) => (c === p.id ? null : c))}
  aria-label={`Supprimer ${p.symbole}`}
  className={
    confirmSuppr === p.id
      ? "text-[10px] font-semibold uppercase text-down"
      : "text-text-dim transition hover:text-down"
  }
>
  {confirmSuppr === p.id ? "confirmer ?" : "✕"}
</button>
```

`AlertsPanel.tsx` (l.221-228) : même pattern (`confirmSuppr` sur l'id d'alerte, libellé « confirmer ? », `alertsStore.getState().supprimer(d.id)`) — en conservant le `opacity-0 group-hover:opacity-100` existant, complété de `focus-visible:opacity-100`.

- [ ] **Step 2 : feedback de saisie invalide**

`PortfolioWindow.tsx` — `const [erreurForm, setErreurForm] = useState<string | null>(null);` ; dans `submitAdd` (l.166-183) :

```tsx
    if (!form.symbole.trim() || !Number.isFinite(taille) || taille <= 0 || !Number.isFinite(prixEntree) || prixEntree <= 0) {
      setErreurForm("Symbole, taille et prix d'entrée (> 0) requis.");
      return;
    }
    setErreurForm(null);
```

et sous le formulaire (après la rangée du bouton « Ajouter », l.564) :

```tsx
{erreurForm !== null && <p className="mt-1.5 text-[10px] text-down">{erreurForm}</p>}
```

`AlertsPanel.tsx` — même mécanique dans `soumettre` (l.109-137) : un état `erreurForm` unique, chaque `return` de garde le renseigne (« Niveau requis. », « Seuil non nul requis. », « Indicateur, sortie et valeur requis. », « Au moins un critère (seuil absolu ou z-score) requis. »), remise à `null` en cas de succès, rendu `text-[10px] text-down` sous le formulaire.

- [ ] **Step 3 : vérifier + commit**

Run: `pnpm --filter @axiom/web test && pnpm --filter @axiom/web typecheck` → PASS.
Visuel : ✕ sur une position ouverte → « confirmer ? » avant suppression ; « Ajouter » à vide → message rouge au lieu du silence.

```bash
git add apps/web/src/components/PortfolioWindow.tsx apps/web/src/components/AlertsPanel.tsx
git commit -m "fix(saisie): suppressions armées (PORT/ALRT, pattern confirmId) + feedback des saisies invalides"
```

---

## Phase G — Garde-fous anti-dérive & clôture

### Task 23 : Tests garde-fous (anti-hex chart, anti-classes brutes, — les 3e et 4e vivent déjà dans registry/hotkeys/themeTokens)

**Files:**
- Create: `apps/web/src/lib/gardeFous.test.ts`

- [ ] **Step 1 : écrire les deux tests-fichiers (pattern themeTokens.test.ts : readFileSync, node)**

```ts
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
```

- [ ] **Step 2 : passer au vert**

Run: `pnpm --filter @axiom/web test gardeFous`
Expected: si les Tasks 2-16 sont complètes → PASS. Sinon, la sortie liste PRÉCISÉMENT les résidus : migrer chacun (token sémantique, `var(--serie-N)`, ou annotation `/* repli */` si c'est un vrai repli canvas). Ne PAS élargir la regex d'autorisation sans justification en commentaire.

- [ ] **Step 3 : commit**

```bash
git add apps/web/src/lib/gardeFous.test.ts
git commit -m "test(garde-fous): anti-hex dans chart/ et anti-classes brutes dans components/ — la dérive post-lot devient un échec de gate"
```

---

### Task 24 : Amendements de la spec du 9 juillet + gate complète + contrôle visuel

**Files:**
- Modify: `docs/superpowers/specs/2026-07-09-uniformisation-ui-features-design.md` (§2)

- [ ] **Step 1 : amender le standard §2**

Ajouter à la fin de la section §2 « Standard consacré » :

```md
Amendements (Lot A, 2026-07-16) :
- Les variantes d'opacité sur tokens (`border-down/40`, `bg-accent/15`…) sont légitimes et
  FONCTIONNELLES : chaque token couleur a un triplet jumeau `--x-rgb` consommé par
  tailwind.config.js en `rgb(var(--x-rgb) / <alpha-value>)`. Tout nouveau token couleur doit
  définir son `-rgb` dans les 5 thèmes (test themeTokens).
- Fraîcheur : primitive `<Fraicheur>` de ui.tsx — « maj… » (chargement), « maj il y a X »
  (timestamp connu), « maj ~cadence » (cadence seule), « — ». La forme « maj HH:MM » est abandonnée.
- Titres de fenêtres : « MNEMO · Libellé » via le prop `mnemo` d'EnTeteFenetre (mnémonique en accent).
- Rôle « avertissement » : classes `warn` (bg-warn, text-warn, border-warn/50) — alias thémé de --ui-amber.
- Couleurs de série côté chart : `serieCanvas(i)` / `lireTokenCanvas` au RENDU (callback styles),
  jamais d'hex figé à l'enregistrement (tests gardeFous).
- Groupes segmentés : primitive `Segmente` (actif bg-bg) ; onglets : primitive `Onglets`.
```

- [ ] **Step 2 : gate complète**

Run (racine du repo) :
`pnpm --filter @axiom/web test` → PASS (tous, y compris gardeFous/themeTokens/registry/hotkeys/workspaces/windowManager mis à jour).
`pnpm --filter @axiom/web typecheck` → PASS.
`pnpm --filter @axiom/web build` → PASS.
`pnpm --filter @axiom/daemon test` → PASS (aucun changement daemon attendu — vérification de non-régression).

- [ ] **Step 3 : contrôle visuel multi-thèmes (l'app : `pnpm run up`)**

Checklist par thème (dark, bloomberg, matrix, cute, aurora — touche T) :
1. ⌘K : sélection ↓ visible ; `DERIV` → ligne « Changer la paire → DERIVUSDT » bordée ; ⏎ → toast Annuler fonctionnel.
2. Chart : EMA+RSI+MACD suivent la palette du thème ; pane OI/Macro/CVD → axes compacts (K/M/B/T).
3. Bloomberg + LIQEST : niveaux EST bleus, distincts de la heatmap ambre.
4. Cute : MenuDeroulant clair, pastilles santé/badges lisibles.
5. Fenêtres : titres « MNEMO · Libellé » ; DES/OMON/TERM/CORR/MAP même ligne de fraîcheur ; LIQ en-tête unique ; bascules RATE/CHAIN/NEWS visibles à l'état actif.
6. Reload avec DES+LIQ ouvertes → elles reviennent ouvertes.
7. AZERTY : touche « & » → 1m ; touche L sur EUR/USD → toast explicatif.

- [ ] **Step 4 : commit final**

```bash
git add docs/superpowers/specs/2026-07-09-uniformisation-ui-features-design.md
git commit -m "docs(spec): standard §2 amendé — alpha-tokens, Fraicheur, titres MNEMO, warn, serieCanvas, Segmente (Lot A)"
```
