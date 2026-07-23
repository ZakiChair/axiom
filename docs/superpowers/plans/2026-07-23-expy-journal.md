# EXPY — journal de trades & expectancy — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fenêtre EXPY — journal de trades manuel (entrée/stop/taille/sortie/tags), expectancy et stats en R, équity cumulée et histogramme des R, export/import JSON — spec `2026-07-23-lot-v16-onchain-expy-dist-data-design.md` §3.

**Architecture:** T1 = modèle + stats pures (TDD) ; T2 = store persisté ; T3 = fenêtre (tableau + formulaire + 2 canvas) + enregistrement. Zéro réseau.

**Tech Stack:** TypeScript, canvas 2D, Zustand vanilla, vitest.

## Global Constraints

- Commentaires **français**. Tokens couleur, DPR/ResizeObserver, paddings partagés. `git -C` systématique.
- Tout en R (risque initial = |entree − stopInitial| × taille ; R = (sortie − entree) × taille × signe(direction) / risque) — R null si trade ouvert ou risque 0 (jamais NaN/Infinity).
- Persistance `axiom:expy:v1` tolérante (patron userPresets). Import JSON : validation défensive (lignes invalides écartées + compte signalé), fusion par id (import n'écrase pas silencieusement — les ids existants sont conservés, décision consignée).
- Fenêtre : id `expy`, mnémonique `EXPY`, `nouveau: true`, comptes windowManager.test à jour (patron NETLIQ exact — vérifier le compte courant, 27 → 28 attendu, AJUSTER selon la réalité de la base qui reçoit aussi DIST/DATA : le compte exact est celui constaté).
- Branche : `feat/expy-journal`. TDD. Gate : `pnpm test` racine + tsc verts + gate visuel (contrôleur).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/store/notes.ts` + `NotesWindow.tsx` (fenêtre à saisie locale persistée la plus proche) ; `store/watchlist.ts` (persistance tolérante)
- `apps/web/src/store/market.ts` (symbole + dernier prix du chart pour préremplir) ; `lib/navigation.ts` (clic symbole → chart)
- `apps/web/src/components/CbpremWindow.tsx` (canvas patron) ; `windowManager.ts`/`App.tsx`/`commands/windowPanels.ts` (greffes)

---

### Task 1: Modèle + stats pures

**Files:**
- Create: `apps/web/src/data/expy.ts` — Test: `apps/web/src/data/expy.test.ts`

**Interfaces (Produces — consommé par T2/T3):**
```ts
export interface TradeJournal { id: string; symbol: string; direction: "long" | "short"; entree: number; stopInitial: number; taille: number; sortie: number | null; ouvertTs: number; fermeTs: number | null; note?: string; tags: string[]; }
export function rMultiple(t: TradeJournal): number | null; // null si sortie/fermeTs null ou risque ≤ 0 ; signe : long = (sortie−entree), short = (entree−sortie)
export interface StatsExpy { n: number; expectancy: number | null; winRate: number | null; profitFactor: number | null; moyGain: number | null; moyPerte: number | null; meilleurR: number | null; pireR: number | null; }
export function statsExpy(trades: readonly TradeJournal[]): StatsExpy;         // sur les FERMÉS à R non null ; profitFactor null si ΣR− = 0
export function equityR(trades: readonly TradeJournal[]): { ts: number; cumR: number }[]; // fermés, tri fermeTs asc, cumul
export const BUCKETS_R: readonly number[]; // [-3,-2,-1,-0.5,0,0.5,1,2,3,5]
export function histogrammeR(trades: readonly TradeJournal[]): { label: string; n: number }[]; // buckets bornés, extrêmes ouverts (« < −3 », « > 5 »)
export function repartition(trades: readonly TradeJournal[], par: "symbol" | "tag"): { cle: string; n: number; sommeR: number }[]; // tri sommeR desc ; un trade multi-tags compte dans chaque tag
```

- [ ] **Step 1: Tests rouges** — rMultiple (long gagnant exact, short gagnant exact — le signe est LE piège —, risque 0 → null, ouvert → null) ; statsExpy sur fixture main-calculée (expectancy/winRate/PF exacts, PF null si aucun perdant) ; equityR (tri, cumul) ; histogramme (bornes, extrêmes ouverts) ; repartition (multi-tags).
- [ ] **Step 2-4: Rouge → implémentation → vert** — `pnpm --filter @axiom/web test -- expy`
- [ ] **Step 5: Commit** — `feat(expy): modèle de trade et statistiques d'expectancy (purs)`

### Task 2: Store persisté

**Files:**
- Create: `apps/web/src/store/expy.ts` — Test: `apps/web/src/store/expy.test.ts`

**Interfaces (Produces):**
```ts
export const expyStore: StoreApi<{ trades: TradeJournal[];
  ajouter(t: Omit<TradeJournal, "id">): void; cloturer(id: string, sortie: number, fermeTs: number): void;
  supprimer(id: string): void; importer(json: string): { ajoutes: number; ignores: number }; exporter(): string; }>;
// persistance localStorage axiom:expy:v1 à chaque mutation (tolérante) ; importer : validation
// par ligne (champs requis + types), fusion par id (existant conservé), retour des comptes.
```

- [ ] **Step 1: Tests rouges puis verts** — ajouter/cloturer/supprimer + persistance round-trip ; importer (valide, corrompu global → {0, 0} sans casse, ligne invalide écartée comptée, id existant conservé) ; exporter → JSON re-importable.
- [ ] **Step 2:** Suite web verte. **Step 3: Commit** — `feat(expy): store du journal (persistance, import/export JSON)`

### Task 3: Fenêtre EXPY + enregistrement + gate

**Files:**
- Create: `apps/web/src/components/ExpyWindow.tsx`
- Modify: `windowManager.ts`, `App.tsx`, `commands/windowPanels.ts`, `windowManager.test.ts`

- [ ] **Step 1:** En-tête : badges Expectancy (R, up ≥ 0/down < 0), Win rate, Profit factor, N ; bouton « + Trade » (déplie le formulaire) ; boutons Export (télécharge le JSON) / Import (input file).
- [ ] **Step 2:** Formulaire repliable : symbole (prérempli du chart via marketStore), direction (Segmente L/S), entrée, stop, taille, sortie (optionnelle), tags (texte, séparés par virgules), note ; validation minimale (nombres finis > 0, stop ≠ entrée) avec messages discrets ; « Ajouter » → store.
- [ ] **Step 3:** Tableau : fermés + ouverts (badge « ouvert »), tri fermeTs desc puis ouvertTs ; R teinté ; clic symbole → navigateTo ; « Clôturer » sur trade ouvert (sortie préremplie au dernier prix du chart si même symbole, sinon champ vide) ; ✕ avec confirmation discrète (double-clic ou confirm inline, patron existant du repo si présent).
- [ ] **Step 4:** Canvas : équity cumulée en R (ligne, zéro pointillé) + histogramme des R (barres teintées par signe) — patron canvas du repo, tooltips non requis en v1.
- [ ] **Step 5:** Greffes fenêtre (id `expy`, EXPY, nouveau) + comptes tests. `pnpm test` racine + tsc verts. **Step 6: Commit** — `feat(expy): fenêtre journal de trades (stats R, équity, histogramme, import/export)`

Gate visuel (contrôleur) : saisir 3 trades (2 fermés 1 ouvert) → stats exactes recalculées à la main, équity/histogramme cohérents, clôture au prix du chart, export→import round-trip, reload → persistés, clic symbole → chart.
