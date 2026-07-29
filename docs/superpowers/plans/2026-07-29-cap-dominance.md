# CAP — capitalisation & dominances — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fenêtre CAP : trois graphiques (TOTAL, TOTAL3, dominances) sur 365 j reconstruits, plus une dominance libre dans le top 100 — spec `2026-07-29-lot-v25-cap-dominance-design.md`.

**Architecture:** T1 = module pur `data/mcap.ts` (normalisation grille UTC, alignement, reconstruction recalibrée, dominance) + fetchers réutilisant les parsers de `marketOverview.ts`. T2 = correction de `macroHistory` (compaction + seed) qui débloque l'historique long. T3 = store vanilla. T4 = géométrie pure. T5 = fenêtre + câblage. T6 = E2E + gate visuel.

**Tech Stack:** TypeScript strict, vitest, Zustand vanilla, canvas 2D impératif, Playwright.

## Global Constraints

- Commentaires **français**. Branche : `feat/cap-dominance` (déjà créée). `git -C ~/axiom` systématique. Gate : `pnpm test` racine + tsc verts + **gate visuel navigateur** obligatoire (T6).
- **Aucune dépendance nouvelle** (BUILD-CONTRACT). Aucune modification de `packages/types`.
- `noUncheckedIndexedAccess` actif : tout accès indexé est `T | undefined` — garder les gardes explicites.
- Aucune donnée haute fréquence dans le state React. Ici tout est journalier : store vanilla pour les séries, React uniquement pour le survol.
- Unité de `total`/`pieces` : **USD absolu**. Unité de `dominance` : **pourcent** (0–100), jamais une fraction.
- Le recalibrage divise TOUJOURS par le total **recalibré**, jamais par la somme brute (sinon BTC.D sort ~1,3 pt trop haut).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/data/macro/coingecko.ts` — `fetchGlobalMcapSnapshot` l.67, `resolveDemoKey` l.53, stockage `axiom.coingecko.demoApiKey` l.30. **Son docblock l.22-26 affirme à tort qu'aucun backfill n'est possible : à corriger en T2.**
- `apps/web/src/data/marketOverview.ts` — `parseGlobal` l.116, `parseMarkets` l.141, types `MarketGlobal` l.26 / `CoinTile` l.40 (`{id, symbol, name, mcapUsd, price, changePct24h}`), `CG_BASE` l.86. Réutiliser les PARSERS, ne pas réécrire les formes brutes.
- `apps/web/src/store/macroHistory.ts` — `MAX_POINTS` l.23 (1500), `MIN_GAP_MS` l.25, `POLL_MS` l.27 (5 min), `McapSnapshot` l.31, `record` l.75, `macroHistorySeries` l.88. **1500 / 288 par jour = 5,2 j d'historique max** : c'est le défaut que T2 corrige.
- `apps/web/src/store/netliq.ts` — patron de store : erreur non destructive, garde 200-vide, `currentRunId`, TTL, lecture tolérante d'une préférence persistée l.41.
- `apps/web/src/components/NetliqWindow.tsx` — patron de rendu : canvas CSS px sous `setTransform(dpr…)`, `ResizeObserver`, tokens lus AU DESSIN, **géométrie partagée dessin ⇄ hit-test** (mêmes littéraux), domaine calé sur les extrêmes (jamais forcé à 0).
- `apps/web/src/components/ui.tsx` — `EnTeteFenetre` l.168, `Chargement` l.200, `ErreurBloc` l.205, `Vide` l.214, `Badge` l.295, `NoteSource` l.418, `Fraicheur` l.477, `BarrePeriodes` l.503 + `PERIODES_STANDARD` l.492, `InfobulleGraphe` l.533.
- Câblage fenêtre : `WINDOW_REGISTRY` (windowManager.ts:44-80) + `WINDOW_COMPONENTS` (App.tsx:143) + `commands/windowPanels.ts` (`basculer`) — menu Fonctions, taskbar et persistance en découlent.
- Couleurs : `index.css` expose `--serie-1` … `--serie-6`. **Utiliser ces 6 tokens**, pas `COMPARE_PALETTE` (store/compare.ts:23) qui n'en contient que 4 — écart assumé vs spec §3.3, motivé par le plafond de 6 courbes.

---

### Task 1: Module pur `data/mcap.ts`

**Files:** Create `apps/web/src/data/mcap.ts` — Test: `apps/web/src/data/mcap.test.ts`

**Interfaces (Produces):**
```ts
export const JOUR_MS = 86_400_000;
export interface PointJour { t: number; v: number }   // t = minuit UTC (ms), v = USD
export type SerieJour = PointJour[];

export function minuitUtc(ms: number): number;
/** Normalise [[tMs, mcap], …] : minuit UTC + dédoublonnage en gardant le DERNIER point du jour, ordre croissant. */
export function grilleJournaliere(brut: ReadonlyArray<readonly [number, number]>): SerieJour;
/** Forward-fill dans la plage connue, 0 AVANT le premier point de la pièce. Longueur = grille.length. */
export function alignerSurGrille(serie: SerieJour, grille: readonly number[]): number[];

export interface TotalReconstruit { total: number[]; k: number; recalibre: boolean }
/** Somme colonne par colonne puis × k = totalGlobalCourant / somme[dernier]. k=1 et recalibre=false si somme[dernier] ≤ 0. */
export function reconstruireTotal(alignees: readonly number[][], totalGlobalCourant: number): TotalReconstruit;

/** 100 × piece/total, null si total ≤ 0 ou non fini. Divise par le total RECALIBRÉ. */
export function dominance(piece: readonly number[], total: readonly number[]): (number | null)[];
/** TOTAL2 = difference(total, btc) ; TOTAL3 = difference(total, btc, eth). Clampe à 0. */
export function serieDifference(base: readonly number[], ...retraits: readonly number[][]): number[];
/** 100 − BTC.D − ETH.D, null si l'une des deux manque. */
export function dominanceAlts(btcD: readonly (number | null)[], ethD: readonly (number | null)[]): (number | null)[];

/** Repli 429 : Retry-After prioritaire (secondes → ms), sinon min(2^essai × 1000, 60_000). */
export function attenteApres429(essai: number, retryAfterSec: number | null): number;

export async function fetchHistoriquePiece(id: string, signal?: AbortSignal): Promise<SerieJour>;
export async function fetchMarchesEtGlobal(signal?: AbortSignal): Promise<{ marches: CoinTile[]; global: MarketGlobal }>;
```

- [ ] **Étape 1 — tests d'abord** (`data/mcap.test.ts`), un cas par comportement :
  `grilleJournaliere` colle deux points du même jour et garde le dernier (cas réel : 365 minuits + 1 point « maintenant ») ; `alignerSurGrille` rend 0 avant le premier point, forward-fill un trou interne, ne dépasse pas la grille ; `reconstruireTotal` somme et applique k à TOUTE la série, et rend `recalibre: false` sur somme finale nulle ; `dominance` est invariante d'échelle (×10 numérateur ET dénominateur ⇒ même résultat) et rend `null` sur total 0/NaN ; `serieDifference` clampe à 0 ; `dominanceAlts` propage `null` ; `attenteApres429` respecte `Retry-After` puis plafonne à 60 s.
- [ ] **Étape 2** — `pnpm --filter @axiom/web test -- mcap` : ÉCHEC attendu (module absent).
- [ ] **Étape 3** — implémenter `data/mcap.ts`. Les fetchers réutilisent `parseGlobal` / `parseMarkets` de `marketOverview.ts` et la clé Demo de `macro/coingecko.ts` ; URL historique : `${CG_BASE}/coins/${id}/market_chart?vs_currency=usd&days=365&interval=daily`. Un 429 est propagé tel quel (`erreur.status = 429`, `retryAfter` lu sur l'en-tête) — c'est l'appelant (T3) qui cadence.
- [ ] **Étape 4** — tests verts.
- [ ] **Étape 5** — commit `feat(web): data/mcap — reconstruction recalibrée de la cap. totale et des dominances`.

---

### Task 2: Débloquer l'historique de `macroHistory` (compaction + seed)

**Files:** Modify `apps/web/src/store/macroHistory.ts`, `apps/web/src/data/macro/coingecko.ts` (docblock) — Test: `apps/web/src/store/macroHistory.test.ts` (créer)

**Interfaces (Produces):**
```ts
/** Au-delà de 48 h : un seul point par jour UTC (le DERNIER). En deçà : tous. Ordre croissant, plafond MAX_POINTS. */
export function compacter(snaps: readonly McapSnapshot[], maintenant: number): McapSnapshot[];
// ajouté à MacroHistoryState :
seed: (points: readonly McapSnapshot[]) => void;  // fusionne, dédoublonne par jour, n'écrase JAMAIS un échantillon existant
```

- [ ] **Étape 1** — tests : `compacter` garde tout sur les 48 dernières heures, réduit à 1/jour au-delà, préserve l'ordre, respecte `MAX_POINTS` ; `seed` insère 366 points journaliers devant une série de 3 échantillons temps réel sans les écraser ni créer de doublon de jour ; `record` appelle la compaction (2 000 échantillons simulés ⇒ la série garde encore les points anciens, ce qui échoue avec le code actuel).
- [ ] **Étape 2** — lancer : ÉCHEC attendu sur `compacter` (absente) et sur le test `record` (le `slice(-1500)` actuel évince).
- [ ] **Étape 3** — implémenter `compacter` (pure, exportée) et `seed` ; brancher la compaction dans `record`. Corriger les DEUX docblocks mensongers : celui de `macroHistory.ts` l.9-11 (« l'historique se construit VERS L'AVANT … aucun backfill possible ») et celui de `macro/coingecko.ts` l.22-26 — remplacer par le constat mesuré : l'historique **par pièce** est gratuit (`/coins/{id}/market_chart`, 365 j max, `error_code 10012` au-delà), seul l'agrégat `/global/market_cap_chart` est Pro.
- [ ] **Étape 4** — tests verts.
- [ ] **Étape 5** — commit `fix(web): macroHistory — compaction journalière et seed (le plafond de 5,2 j tombe)`.

---

### Task 3: Store `store/mcap.ts` (backfill, persistance, prolongement)

**Files:** Create `apps/web/src/store/mcap.ts` — Test: `apps/web/src/store/mcap.test.ts`

**Interfaces (Produces):**
```ts
export const PLAFOND_DOMINANCES = 6;
export const PALETTE_DOMINANCES = ["--serie-1","--serie-2","--serie-3","--serie-4","--serie-5","--serie-6"] as const;
export const ID_ALTS = "alts";  // pseudo-id de la dominance agrégée

export interface HistoriqueMcap { version: 1; majTs: number; k: number; grille: number[]; total: number[]; pieces: Record<string, number[]> }
export interface EtatBackfill { enCours: boolean; faites: number; total: number; erreur: string | null }

export interface McapState {
  open: boolean; periode: string; dominances: string[];       // ids CoinGecko + éventuellement ID_ALTS
  hist: HistoriqueMcap | null; marches: CoinTile[]; backfill: EtatBackfill; erreur: string | null; majTs: number | null;
  ouvrir: () => void; fermer: () => void; toggle: () => void;
  setPeriode: (id: string) => void;
  ajouterDominance: (id: string) => Promise<void>;            // fetch + cache si absente de hist.pieces
  retirerDominance: (id: string) => void;
  demarrerBackfill: (deps?: DepsBackfill) => Promise<void>;   // deps injectables pour les tests
  interrompre: () => void;
  prolonger: (force?: boolean) => Promise<void>;              // TTL 10 min
}
export interface DepsBackfill {
  fetchPiece?: (id: string, signal?: AbortSignal) => Promise<SerieJour>;
  fetchMarchesEtGlobal?: (signal?: AbortSignal) => Promise<{ marches: CoinTile[]; global: MarketGlobal }>;
  espacementMs?: number;   // 0 dans les tests
  maintenant?: () => number;
}
export const mcapStore: StoreApi<McapState>;
```

- [ ] **Étape 1** — tests avec `DepsBackfill` bouchonnées (aucun réseau, `espacementMs: 0`) : un backfill de 3 pièces produit un `hist` dont `total[dernier] === global.totalMcapUsd` (recalibrage) et dont `dominance(btc)[dernier]` retombe sur `global.btcDominance` à 0,1 pt ; **c'est le test qui attrape l'erreur « divisé par la somme non recalibrée »** ; une pièce en 429 est rejouée puis réussit sans perdre la progression ; `interrompre` laisse le curseur persisté et une reprise repart du reste ; `prolonger` remplace le point du jour au lieu d'en ajouter un second ; `ajouterDominance` au-delà de `PLAFOND_DOMINANCES` est refusée ; lecture tolérante (JSON corrompu, `version` inconnue ⇒ `hist: null`) ; `mirrorOpenState("mcap", mcapStore)` reflète `open`.
- [ ] **Étape 2** — lancer : ÉCHEC attendu.
- [ ] **Étape 3** — implémenter. Clés localStorage : `axiom:mcap:v1` (historique), `axiom:mcap:backfill:v1` (curseur = ids restants + somme partielle), `axiom:mcap:dominances` (sélection, défaut `["bitcoin","ethereum"]`), `axiom:mcap:periode`. Cadence : 2 100 ms avec clé Demo, 3 000 ms sans, AIMD (×1,5 sur 429, plafond 15 s ; −200 ms après 10 succès, plancher 3 s). À la fin du backfill : `macroHistoryStore.getState().seed(...)` avec `{t, total, total2, total3}` par jour. Erreur NON destructive et garde 200-vide (patron netliq).
- [ ] **Étape 4** — tests verts.
- [ ] **Étape 5** — commit `feat(web): store CAP — backfill cadencé, persistance et prolongement`.

---

### Task 4: Géométrie pure `components/mcapWindow.util.ts`

**Files:** Create `apps/web/src/components/mcapWindow.util.ts` — Test: `apps/web/src/components/mcapWindow.util.test.ts`

**Interfaces (Produces):**
```ts
export const MARGES = { g: 52, d: 8, h: 18, b: 18 } as const;
export function domaineValeurs(series: ReadonlyArray<ReadonlyArray<number | null>>): { min: number; max: number };
export function projX(i: number, n: number, largeur: number): number;
export function projY(v: number, min: number, max: number, hauteur: number): number;
export function indexDepuisX(xPix: number, n: number, largeur: number): number;   // clampé [0, n-1]
export function ticksValeurs(min: number, max: number, nb: number): number[];
export function ticksTemps(grille: readonly number[], largeur: number): { i: number; label: string }[];
export function formatMcap(v: number): string;   // « 2,28 T$ », « 845 G$ », « 12,4 M$ »
export function formatDom(v: number | null): string;  // « 56,6 % » / VALEUR_ABSENTE
export function fenetrer<T>(serie: readonly T[], jours: number | null): T[];  // null = tout
```

- [ ] **Étape 1** — tests : `domaineValeurs` ignore les `null` et n'inclut PAS 0 de force ; `projX(0)` = marge gauche et `projX(n-1)` = largeur − marge droite ; `indexDepuisX` est l'inverse de `projX` aux extrémités et clampe hors cadre (**c'est cette réciprocité qui garantit que le réticule coïncide avec le point**) ; `ticksValeurs` rend des bornes rondes ; `formatMcap` bascule T$/G$/M$ avec le groupement fr-FR ; `fenetrer(serie, null)` rend la série entière.
- [ ] **Étape 2** — lancer : ÉCHEC attendu.
- [ ] **Étape 3** — implémenter.
- [ ] **Étape 4** — tests verts.
- [ ] **Étape 5** — commit `feat(web): géométrie partagée de la fenêtre CAP`.

---

### Task 5: Fenêtre `McapWindow.tsx` + câblage

**Files:** Create `apps/web/src/components/McapWindow.tsx` — Modify `apps/web/src/store/windowManager.ts` (registre), `apps/web/src/App.tsx` (`WINDOW_COMPONENTS`), `apps/web/src/commands/windowPanels.ts`, `apps/web/src/components/SettingsPanel.tsx`

- [ ] **Étape 1** — entrée de registre `{ id: "mcap", title: "Capitalisation & dominance", mnemonic: "CAP", defaultWidth: 880, defaultHeight: 700, nouveau: true }` + `mcap: lazy(() => import("./components/McapWindow").then((m) => ({ default: m.McapWindow })))` + commande `panneau:cap` (mots-clés : `capitalisation, total, total2, total3, dominance, btc.d, altseason, market cap`). Vérifier : `pnpm --filter @axiom/web build` — un id sans composant est une erreur de type, c'est le filet.
- [ ] **Étape 2** — composant : trois canvas empilés de hauteurs égales, axe des temps commun, `BarrePeriodes` (30 j / 90 j / 1 a / Tout), `Fraicheur`, `NoteSource` « CoinGecko · reconstruction top 100 recalibrée, couverture 97,8 % · 365 j max en gratuit ». Un unique `indexSurvol` en state React partagé par les trois canvas : trait vertical sur les trois, `InfobulleGraphe` uniquement sur le graphique sous la souris. Domaines calés sur les extrêmes (jamais forcés à 0). Tokens lus AU DESSIN.
- [ ] **Étape 3** — sélecteur de dominances sous le 3ᵉ graphique : pastilles BTC / ETH / alts + bouton **+** ouvrant une liste filtrable des 100 premières pièces de `marches` (recherche symbole ou nom), croix de retrait, plafond 6.
- [ ] **Étape 4** — état de backfill : barre de progression `n/100` + bouton **Interrompre** tant que `backfill.enCours` ; si aucun historique et backfill jamais lancé, un bloc `Vide` avec un bouton **Construire l'historique (365 j)** qui annonce la durée (~3,5 min avec clé, 5–20 min sans).
- [ ] **Étape 5** — `SettingsPanel` : champ « Clé Demo CoinGecko (optionnelle) » dans la section Clés API existante, écrivant `axiom.coingecko.demoApiKey` (déjà lue par `macro/coingecko.ts` et `marketOverview.ts`, mais jusqu'ici non renseignable).
- [ ] **Étape 6** — `pnpm test` racine + `pnpm --filter @axiom/web build` verts, puis commit `feat(web): fenêtre CAP — TOTAL, TOTAL3 et dominances`.

---

### Task 6: E2E, vérification empirique et gate visuel

**Files:** Modify `apps/web/e2e/smoke.e2e.ts` (ou fichier e2e dédié selon la convention en place)

- [ ] **Étape 1** — E2E : la commande `CAP` ouvre la fenêtre ; les trois canvas sont présents ; l'ajout d'une dominance (SOL) fait apparaître une pastille. Réseau bouché comme les autres E2E du dépôt.
- [ ] **Étape 2** — vérification empirique en conditions réelles : lancer le backfill dans le navigateur, puis comparer le dernier point à `/global` — TOTAL identique et BTC.D à 0,1 pt près (≈ 56,6 % le 2026-07-29). Consigner le chiffre obtenu dans le message de commit.
- [ ] **Étape 3** — **gate visuel navigateur** : les 5 thèmes, fenêtre étroite ET large, réticule aligné sur les points, axes lisibles, aucune courbe écrasée contre le cadre.
- [ ] **Étape 4** — `pnpm test` racine vert, commit, puis fusion dans `main`.
