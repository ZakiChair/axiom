# Liquidation Heatmap v2 — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Transformer la heatmap de liquidations (bandes pleine largeur, live-only, Bybit seul, sans interaction) en vraie heatmap 2D temps×prix avec historique serveur persistant, échelle log, split long/short, tooltip, agrégation multi-exchange (Bybit+OKX) et couche « niveaux estimés » optionnelle.

**Architecture :** (A) Le daemon Bun+SQLite ingère en continu les flux WS de liquidations (pattern `marketFeed.ts`/boucle GDELT) dans une table `liquidations` (pattern `candles.ts`) et les ressert en REST — enrichissement optionnel feature-detecté (capability `liquidations`), le front reste 100 % fonctionnel sans daemon. (B) Côté front, le modèle passe de « buckets de prix agrégés » à « événements bruts bornés » ; le rendu passe des overlays KLineChart à un canvas 2D dédié (pattern `VolumeProfileController`) qui agrège les événements en cellules (bougie × bucket de prix) à chaque frame dirty. (C) OKX rejoint Bybit comme source live (champ `venue`), et une couche séparée de niveaux ESTIMÉS depuis l'OI (clairement étiquetée, garde-fou BUILD-CONTRACT) est ajoutée avec sa propre bascule.

**Tech Stack :** TypeScript strict, React 18/Zustand vanilla, KLineChart 9.8 (canvas superposé, PAS de re-render React), Bun+SQLite (bun:sqlite), vitest, WS publics Bybit/OKX, Coinalyze REST (repli seed + OI).

## Global Constraints (BUILD-CONTRACT + CLAUDE.md)

- Commentaires et docs en **français**.
- TypeScript strict, `noUncheckedIndexedAccess` actif — tout accès indexé doit gérer `undefined`.
- **AUCUNE dépendance nouvelle** ; ne PAS modifier les `package.json`.
- Le daemon ne touche JAMAIS au chemin chaud du renderer ; les WS de marché du front restent DIRECTS. Le front reste 100 % fonctionnel SANS daemon (feature-detect `/health` + capability).
- Interdiction d'import cross-package apps/web ↔ apps/daemon : les parseurs partagés sont des **copies annotées** (précédent : `marketFeed.ts`).
- Garde-fou liquidations : toute donnée **estimée** doit être étiquetée « ESTIMATION » à l'écran (anti-recommandation #CoinGlass). Les liquidations exécutées restent la couche par défaut.
- Fonctions PURES exportées et testées ; couplage KLineChart/WS non testé unitairement.
- Aucune donnée haute fréquence dans le state React (stores vanilla + canvas).
- Vérifications globales : `pnpm --filter @axiom/web test`, `pnpm --filter @axiom/daemon test`, `pnpm --filter @axiom/web build` verts ; gate visuel final = zoom navigateur sur le chart.

---

## Phase A — Historique serveur (P1)

### Task 1 : Module daemon `liquidations` (table + routes REST)

**Files:**
- Create: `apps/daemon/src/liquidations.ts`
- Create: `apps/daemon/src/liquidations.test.ts`
- Modify: `shared/daemon-capabilities.ts` (ajouter `"liquidations"`)
- Modify: `apps/daemon/src/index.ts` (enregistrer la route)

**Interfaces:**
- Consumes: `getDb()` de `./db`, `entetesCors` de `./cors`, `Routeur` de `./router` (mêmes imports que `candles.ts`).
- Produces: `LiqFil { t: number; venue: string; side: "long"|"short"; price: number; qty: number; usd: number }` ; routes `POST /liquidations/:symbole` (corps = `LiqFil[]`, insert idempotent) et `GET /liquidations/:symbole?depuis&jusqua&limite` (tri `t` croissant) ; `enregistrerLiquidations(routeur)` ; `insererLiquidations(symbole: string, lot: LiqFil[]): number` (réutilisée par la boucle d'ingestion, Task 2) ; `purgerLiquidations(avantMs: number): void` ; fonctions pures `normaliserLiqs(corps: unknown): LiqFil[]` et `parseRequeteLiqs(params: URLSearchParams): { depuis: number|null; jusqua: number|null; limite: number }`.

Schéma SQL (idempotence par index unique — deux liq peuvent partager le même ms) :

```sql
CREATE TABLE IF NOT EXISTS liquidations (
  symbole TEXT NOT NULL,
  venue   TEXT NOT NULL,
  t       INTEGER NOT NULL,
  side    TEXT NOT NULL,      -- 'long' | 'short' (côté de la POSITION liquidée)
  price   REAL NOT NULL,
  qty     REAL NOT NULL,
  usd     REAL NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS liq_unique
  ON liquidations (symbole, venue, t, side, price, qty);
CREATE INDEX IF NOT EXISTS liq_lookup ON liquidations (symbole, t);
```

Insertion : `INSERT OR IGNORE`, dans une transaction (pattern exact de `traiterCandles` POST). `LIMITE_DEFAUT = 20_000`, `LIMITE_MAX = 100_000`.

- [ ] **Step 1 : tests des fonctions pures** — `liquidations.test.ts` :

```ts
import { describe, expect, it } from "bun:test";
import { normaliserLiqs, parseRequeteLiqs } from "./liquidations";

describe("normaliserLiqs", () => {
  it("garde les entrées valides et écarte les invalides", () => {
    const ok = { t: 1, venue: "bybit", side: "long", price: 100, qty: 2, usd: 200 };
    expect(normaliserLiqs([ok, { t: "x" }, null, { ...ok, side: "haut" }])).toEqual([ok]);
  });
  it("renvoie [] pour un corps non-tableau", () => {
    expect(normaliserLiqs({})).toEqual([]);
  });
});

describe("parseRequeteLiqs", () => {
  it("borne la limite et parse depuis/jusqua", () => {
    const p = new URLSearchParams("depuis=5&jusqua=9&limite=999999999");
    expect(parseRequeteLiqs(p)).toEqual({ depuis: 5, jusqua: 9, limite: 100_000 });
  });
});
```

- [ ] **Step 2 : lancer les tests → FAIL** — `cd apps/daemon && bun test src/liquidations.test.ts` → « Cannot find module ».
- [ ] **Step 3 : implémenter `liquidations.ts`** (structure = copie adaptée de `candles.ts` : `tableAssuree`, `db()`, JSON+CORS, `enregistrerPrefixe("/liquidations", ...)`). `normaliserLiqs` valide : `t/price/qty/usd` nombres finis, `price > 0`, `usd > 0`, `side ∈ {long, short}`, `venue` chaîne non vide.
- [ ] **Step 4 : tests verts** — `bun test src/liquidations.test.ts` → PASS.
- [ ] **Step 5 : câblage** — `shared/daemon-capabilities.ts` : ajouter `"liquidations"` au tableau. `index.ts` : `enregistrerLiquidations(routeur);` après `enregistrerCandles(routeur);`.
- [ ] **Step 6 : suite daemon verte** — `bun test` (dossier apps/daemon) → PASS.
- [ ] **Step 7 : commit** — `git add -A && git commit -m "feat(daemon): table + routes REST /liquidations (historique persistant)"`.

### Task 2 : Boucle d'ingestion daemon (WS Bybit, symboles configurables, purge)

**Files:**
- Create: `apps/daemon/src/liqFeed.ts`
- Create: `apps/daemon/src/liqFeed.test.ts`
- Modify: `apps/daemon/src/index.ts` (démarrer la boucle)

**Interfaces:**
- Consumes: `insererLiquidations`, `purgerLiquidations` (Task 1) ; `lireKv(ns, cle)` — vérifier le helper exact dans `apps/daemon/src/kv.ts` et l'utiliser tel quel.
- Produces: `demarrerBoucleLiquidations(): void` ; pures : `parseBybitLiqDaemon(entry: unknown): LiqFil | null` (copie annotée de `parseBybitLiquidation` du front, avec `venue: "bybit"`), `symbolesSurveilles(kvBrut: unknown): string[]` (parse la valeur KV `liq/symboles`, repli `["BTCUSDT","ETHUSDT","SOLUSDT"]`).

Comportement (pattern `marketFeed.ts` : WS indépendant, backoff 1s→30s plafonné, watchdog staleness 10 min, logs seulement) :
- Une WS `wss://stream.bybit.com/v5/public/linear`, souscription `allLiquidation.<SYM>` pour chaque symbole surveillé ; re-souscription au changement de liste (poll KV toutes les 60 s).
- Chaque message → `parseBybitLiqDaemon` → `insererLiquidations(symbole, lot)`.
- Purge quotidienne : `purgerLiquidations(Date.now() - 30 j)` (rétention 30 jours, borne la taille du .db).
- Ingestion à froid UNIQUEMENT — commentaire d'en-tête rappelant l'invariant BUILD-CONTRACT (comme `marketFeed.ts:5-8`).

- [ ] **Step 1 : tests des pures** — parse d'une entrée réelle Bybit (`{T:1700000000000,s:"BTCUSDT",S:"Sell",v:"0.007",p:"65513.30"}` → `side:"long"`, `usd≈458.6`), rejet entrée illisible ; `symbolesSurveilles` : KV absent → défaut, KV `["dogeusdt"]` → `["DOGEUSDT"]`.
- [ ] **Step 2 : FAIL** puis **Step 3 : implémenter** puis **Step 4 : PASS** — `bun test src/liqFeed.test.ts`.
- [ ] **Step 5 : câblage index.ts** — `demarrerBoucleLiquidations();` après `demarrerBoucleGlobe();`, commentaire « Boucle d'ingestion liquidations (WS Bybit à froid) — jamais sur le chemin chaud du renderer ».
- [ ] **Step 6 : test manuel réel** — lancer le daemon (`bun run src/index.ts`), attendre ~2 min, vérifier `curl 'http://127.0.0.1:8787/liquidations/BTCUSDT?limite=5'` → JSON avec ≥0 événements (BTC liquide presque toujours en 2 min ; sinon vérifier les logs de souscription).
- [ ] **Step 7 : commit** — `feat(daemon): ingestion continue des liquidations Bybit (liste KV, purge 30 j)`.

### Task 3 : Client front du daemon (`liquidationsGet` / `liquidationsPush`)

**Files:**
- Modify: `apps/web/src/data/daemon.ts` (section « Liquidations » après la section Candles)
- Modify: `apps/web/src/data/daemon.test.ts` (mock fetch, mêmes patterns que les tests candles/kv existants)

**Interfaces:**
- Consumes: `baseDaemon()`, `detectDaemon("liquidations")` (la capability existe côté shared depuis Task 1).
- Produces:

```ts
export interface LiqDaemon { t: number; venue: string; side: "long"|"short"; price: number; qty: number; usd: number }
export async function liquidationsGet(symbole: string, opts?: { depuis?: number; jusqua?: number; limite?: number }): Promise<LiqDaemon[] | null>; // null = daemon absent/sans capability
export async function liquidationsPush(symbole: string, lot: LiqDaemon[]): Promise<boolean>; // dual-write best-effort, échec silencieux
```

`liquidationsGet` appelle `detectDaemon("liquidations")` d'abord (comme `listerSnapshots`) ; `liquidationsPush` échoue en silence sans sonde (comme `candlesPush`).

- [ ] **Step 1 : tests** (fetch mocké : GET renvoie `{liqs:[...]}` → tableau traduit ; daemon absent → `null` ; push non-ok → `false`). **Step 2 : FAIL. Step 3 : implémenter. Step 4 : PASS** — `pnpm --filter @axiom/web test -- daemon`.
- [ ] **Step 5 : commit** — `feat(web): client daemon /liquidations (get + push dual-write)`.

---

## Phase B — Refonte du rendu (P2 heatmap 2D, P3 échelle log + long/short, P4 tooltip)

### Task 4 : Modèle de données front → événements bruts + seed daemon

**Files:**
- Modify: `apps/web/src/chart/liquidationMarkers.ts` (remplacement du modèle buckets)
- Modify: `apps/web/src/chart/liquidationMarkers.test.ts`

**Interfaces:**
- Consumes: `subscribeLiquidations` (inchangé pour l'instant), `liquidationsGet`/`liquidationsPush` (Task 3), `fetchLiquidationHistory` (repli seed), `marketStore`, `liqMarksStore` (conservé tel quel).
- Produces (consommées par les Tasks 5-7) :

```ts
/** Événement de liquidation normalisé côté chart. */
export interface LiqEvent { time: number; side: "long"|"short"; price: number; qty: number; usd: number; venue: string;
  /** true si issu du seed Coinalyze (prix approximé low/high de bougie) — exclu du tooltip de détail. */
  approx?: boolean }
/** Store vanilla : buffer borné d'événements du symbole abonné + compteur de révision. */
export const liqEventsStore: StoreApi<{ events: LiqEvent[]; rev: number; enAttente: boolean }>;
export const MAX_EVENTS = 20_000;           // FIFO : on écarte les plus anciens
export const PERSIST_EVENTS = 3_000;        // localStorage v2 : N derniers événements
export function serialiserEvenements(events: LiqEvent[]): string;   // {v:2, e:[[t,side01,price,qty,usd,venue],...]}
export function deserialiserEvenements(raw: string | null): LiqEvent[]; // tolérant ; ancien format v1 {t,b} → [] (jeté)
```

Logique du contrôleur singleton (remplace `accumulateur`/`taille`/`accumuler`) :
1. À l'abonnement d'un symbole : `deserialiserEvenements(localStorage)` → buffer ; puis **seed daemon** `liquidationsGet(symbol, {depuis: now-7j})` (asynchrone, fusion+dédoublonnage par clé `t|venue|price|qty`, tri par `t`) ; si daemon absent (`null`) ET buffer vide → **repli Coinalyze** : `fetchLiquidationHistory` + `construireSeed`-like mais produisant des `LiqEvent` `approx:true` placés au low/high de la bougie contenante (réutiliser `candleContenant`, conservée).
2. Chaque liq live : push dans le buffer (FIFO à `MAX_EVENTS`), `sauverProfil` v2 (throttlé : au plus 1 écriture localStorage / 5 s — les liq peuvent rafaler en cascade), et `liquidationsPush(symbol, [ev])` best-effort (dual-write → le daemon garde l'historique des symboles regardés même hors liste KV).
3. `enAttente` = buffer vide (remplace l'overlay hint, consommé par le contrôleur canvas Task 6).

Conserver EXPORTÉES et intactes : `tailleBucket`, `bucketIndex`, `couleurViridis`, `candleContenant`, `liqMarksStore`, commande `LIQMARK`. Supprimer : `serialiserProfil`/`deserialiserProfil` v1, `construireSeed` (remplacée par la variante événements `seedDepuisCoinalyze(history, candles): LiqEvent[]` exportée et testée), tout le bloc `registerOverlay`/`redraw` (déplacé au canvas en Task 6 — pendant CETTE task, laisser un rendu overlay minimal compiler ou basculer directement si Task 6 suit dans la même session ; les deux tasks peuvent être fusionnées en un seul commit si plus simple).

- [ ] **Step 1 : tests** — sérialisation v2 aller-retour ; v1 → `[]` ; borne FIFO ; dédoublonnage de fusion seed ; `seedDepuisCoinalyze` place long→low / short→high avec `approx:true`.
- [ ] **Step 2 : FAIL → Step 3 : implémenter → Step 4 : PASS** — `pnpm --filter @axiom/web test -- liquidationMarkers`.
- [ ] **Step 5 : commit** — `refactor(web): heatmap liq — modèle événements bruts + seed daemon (repli Coinalyze)`.

### Task 5 : Grille 2D pure (temps × prix, échelle log, long/short)

**Files:**
- Create: `apps/web/src/chart/liquidationHeat.ts`
- Create: `apps/web/src/chart/liquidationHeat.test.ts`

**Interfaces:**
- Consumes: `LiqEvent` (Task 4), `tailleBucket`/`bucketIndex`/`couleurViridis`/`candleContenant` (liquidationMarkers), `Candle` (@axiom/types).
- Produces :

```ts
/** Cellule agrégée (une bougie × un bucket de prix). */
export interface LiqCell { candleTime: number; bucketIdx: number; longUsd: number; shortUsd: number; count: number }
export interface LiqGrid { cells: Map<string, LiqCell>; taille: number; maxUsd: number } // clé = `${candleTime}:${bucketIdx}`
/** Agrège les événements ∈ [candles[from].time, ∞) en cellules. PURE. */
export function construireGrille(events: LiqEvent[], candles: Candle[], from: number, to: number): LiqGrid | null;
/** Intensité log-normalisée ∈ [0,1] : log1p(usd)/log1p(max). PURE. */
export function intensiteLog(usd: number, maxUsd: number): number;
/** Profil latéral par bucket de prix (somme toutes bougies) pour les bandes du bord droit. PURE. */
export function profilParPrix(grid: LiqGrid): Map<number, { longUsd: number; shortUsd: number }>;
```

Détails : `taille = tailleBucket(close de la dernière bougie visible)` (recalculée à chaque construction — plus de taille « figée », le re-bucketing est gratuit car les événements sont bruts) ; événement → bougie contenante via `candleContenant` (les événements hors plage sont écartés) ; `maxUsd = max(longUsd+shortUsd)` des cellules.

- [ ] **Step 1 : tests** :

```ts
it("agrège deux liqs de la même bougie/bucket en une cellule", () => { /* 2 events t=1000/1500, candles [{time:0},{time:60000}], même prix → 1 cellule, count 2, longUsd sommé */ });
it("sépare long et short dans la cellule", () => { /* ... */ });
it("intensiteLog : 0→0, max→1, croissante", () => {
  expect(intensiteLog(0, 100)).toBe(0);
  expect(intensiteLog(100, 100)).toBe(1);
  expect(intensiteLog(10, 100)).toBeGreaterThan(10 / 100); // la log RELÈVE les petits niveaux
});
it("profilParPrix somme les cellules d'un même bucket sur toutes les bougies", () => { /* ... */ });
it("renvoie null si aucune bougie visible ou aucune cellule", () => { /* ... */ });
```

- [ ] **Step 2 : FAIL → Step 3 : implémenter → Step 4 : PASS** — `pnpm --filter @axiom/web test -- liquidationHeat`.
- [ ] **Step 5 : commit** — `feat(web): grille 2D liquidations (bougie × prix, log, long/short) — fonctions pures`.

### Task 6 : `LiquidationHeatController` (canvas) + câblage ChartInstance

**Files:**
- Modify: `apps/web/src/chart/liquidationHeat.ts` (ajouter la classe contrôleur sous les pures)
- Modify: `apps/web/src/chart/ChartInstance.tsx` (canvas + instanciation, bloc `isMaster`)
- Modify: `apps/web/src/chart/liquidationMarkers.ts` (retirer overlays/redraw ; le singleton ne gère plus que données+abonnement)

**Interfaces:**
- Consumes: `construireGrille`, `intensiteLog`, `couleurViridis`, `liqEventsStore`, `liqMarksStore`, `marketStore` ; pattern intégral de `VolumeProfileController` (rAF + dirty + `subscribeAction` OnScroll/OnZoom/OnVisibleRangeChange + `convertToPixel` + ResizeObserver + clip du pane).
- Produces: `class LiquidationHeatController { constructor(chart: Chart, container: HTMLElement, canvas: HTMLCanvasElement); setEnabled(b: boolean): void; dispose(): void }`.

Rendu par frame dirty :
1. `construireGrille(events, candles, range.from, range.to)` sur la plage visible.
2. Pour chaque cellule : x = `convertToPixel({timestamp: candleTime})`, largeur = largeur de bougie (`convertToPixel` du timestamp suivant − x, min 1px) ; y haut/bas = `convertToPixel({value: (idx+1)*taille / idx*taille})` ; couleur = `couleurViridis(intensiteLog(total, maxUsd))`, alpha `0.25 + 0.55·t`.
3. Bord droit : bandes du `profilParPrix` (largeur ∝ intensité log, max 12 % du pane) **split** : moitié gauche teinte `--up` (shorts liquidés = rachats) / moitié droite `--down` (longs liquidés) — lisibilité long/short sans surcharger les cellules.
4. Si `enAttente` : texte discret « ⋯ Heatmap liquidations active — en attente du flux live » en haut à droite du pane (remplace l'overlay `liqHint`).
5. Légende : « Liq heatmap (exécutées) · log » en haut à droite, police 10px mono (pattern légende volumeProfile).

Câblage ChartInstance (calqué ligne à ligne sur vpCanvas) : `liqCanvasRef` (`ChartInstance.tsx:285` voisinage), `<canvas ref={liqCanvasRef} className="pointer-events-none absolute inset-0" style={{display:"none"}} />` à côté de la ligne 827, instanciation dans le bloc `isMaster` (l.534) : `liqHeat = new LiquidationHeatController(chart, container, liqCanvas); liqHeat.setEnabled(liqMarksStore.getState().actif);` + `liqMarksStore.subscribe(...)` + `dispose()` au teardown (l.764 voisinage).

Dans `liquidationMarkers.ts` : supprimer `ensureOverlayRegistered`, `redraw`, `retirerOverlays`, `overlaysSuivis`, les imports klinecharts devenus inutiles ; le subscribe `marketStore`/`themeStore` du singleton disparaît (le contrôleur canvas suit déjà le viewport et le store d'événements).

- [ ] **Step 1 : implémenter** (pas de test unitaire du couplage canvas — convention du repo).
- [ ] **Step 2 : suite + build verts** — `pnpm --filter @axiom/web test && pnpm --filter @axiom/web build`.
- [ ] **Step 3 : gate visuel RÉEL** — lancer le dev server, activer `LIQMARK` sur BTCUSDT, vérifier au zoom navigateur : cellules alignées sur les bougies, bandes latérales split, hint quand vide, pan/zoom fluides.
- [ ] **Step 4 : commit** — `feat(web): heatmap liquidations 2D temps×prix sur canvas (échelle log, profil long/short)`.

### Task 7 : Tooltip au survol (P4)

**Files:**
- Modify: `apps/web/src/chart/liquidationHeat.ts` (hit-test pur + rendu tooltip dans le contrôleur)
- Modify: `apps/web/src/chart/liquidationHeat.test.ts`

**Interfaces:**
- Consumes: `ActionType.OnCrosshairChange` de klinecharts (le crosshair livre x/y + timestamp/valeur SANS capturer les événements souris — le canvas reste `pointer-events-none`).
- Produces: `export function cellSousCurseur(grid: LiqGrid, timestamp: number | undefined, value: number | undefined): LiqCell | null` (PURE : bougie du timestamp + bucket de la valeur → lookup Map).

Rendu tooltip (dans le canvas, près du curseur, fond `rgba(10,12,20,0.92)`, décalé pour ne pas sortir du pane) :

```
Liquidations 14:05 · 65 450–65 500
Total   1,24 M$   (7 événements)
Longs   980 k$  ▮▮▮▮▮▮▮▯▯▯
Shorts  260 k$  ▮▮▯▯▯▯▯▯▯▯
```

Formatage USD compact : réutiliser l'utilitaire de formatage existant du repo (chercher `formatUsd`/équivalent dans `apps/web/src/lib` ou `components/ui` ; en créer un local SEULEMENT s'il n'existe pas).

- [ ] **Step 1 : tests de `cellSousCurseur`** (timestamp dans la bougie + valeur dans le bucket → cellule ; hors grille → null ; undefined → null). **Step 2 : FAIL → Step 3 : implémenter (pure + câblage crosshair) → Step 4 : PASS.**
- [ ] **Step 5 : gate visuel** — survol d'une cellule dense → tooltip avec split long/short cohérent avec la fenêtre LIQ.
- [ ] **Step 6 : commit** — `feat(web): tooltip heatmap liquidations (total, split long/short, nb d'événements)`.

---

## Phase C — Sources & estimation (P5, P6)

### Task 8 : Multi-exchange — OKX en live (front) et en ingestion (daemon)

**Files:**
- Modify: `apps/web/src/data/liquidations.ts` (+ `subscribeLiquidationsOkx`, agrégateur)
- Modify: `apps/web/src/data/liquidations.test.ts`
- Modify: `apps/daemon/src/liqFeed.ts` (+ WS OKX)
- Modify: `apps/daemon/src/liqFeed.test.ts`
- Modify: `apps/web/src/components/LiquidationsWindow.tsx` (badge venue par ligne du feed ; corriger au passage le commentaire périmé « ~1 msg/s côté Binance » l.5)

**Interfaces:**
- Produces: `Liquidation` gagne `venue: "bybit" | "okx"` ; `subscribeLiquidations(symbol, cb)` devient l'AGRÉGATEUR (ouvre Bybit + OKX, fusionne dans `cb`) — signature inchangée pour tous les appelants ; pures exportées : `parseOkxLiquidation(instId: string, detail: unknown, ctVal: number): Liquidation | null`, `okxInstFamily(symbol: string): string` (BTCUSDT → BTC-USDT).

Spécificités OKX (⚠️ à VÉRIFIER via context7/doc officielle AVANT de coder — l'API v5 a changé en 2023) :
- Canal public `liquidation-orders` (`instType: "SWAP"`) sur `wss://ws.okx.com:8443/ws/v5/public` : pousse TOUTES les liquidations SWAP → filtrer par `instId === "BTC-USDT-SWAP"` côté client.
- `details[]` : `posSide` (`long`/`short` = position liquidée — PRIORITAIRE sur `side`), `bkPx` (prix de faillite), `sz` (en CONTRATS), `ts`.
- **Conversion contrats → base** : `qty = sz × ctVal` où `ctVal` vient de `GET /api/v5/public/instruments?instType=SWAP&instFamily=BTC-USDT` (CORS `*`, cf. adaptateur okx.ts). Mémoïser `ctVal` par instId (Map module-level). `usd = qty × bkPx`.
- Hyperliquid : PAS de flux public de liquidations documenté à ce jour → NE PAS l'implémenter ; laisser un commentaire d'en-tête le documentant (décision explicite, pas un oubli).

Daemon : même canal, mêmes parseurs en copie annotée dans `liqFeed.ts`, `venue: "okx"`, `ctVal` mémoïsé pareil (fetch REST au démarrage de la boucle, refresh 24 h).

- [ ] **Step 1 : tests front** — `parseOkxLiquidation("BTC-USDT-SWAP", {posSide:"long", bkPx:"65000", sz:"20", ts:"1700000000000"}, 0.01)` → `{side:"long", qty:0.2, usd:13000, venue:"okx"}` ; posSide manquant → repli side ; sz/bkPx illisibles → null. Adapter les tests existants au champ `venue` (Bybit → `"bybit"`).
- [ ] **Step 2 : FAIL → Step 3 : implémenter front → Step 4 : PASS** — `pnpm --filter @axiom/web test -- liquidations`.
- [ ] **Step 5 : daemon** — mêmes cycles test/impl (`bun test src/liqFeed.test.ts`), puis vérif réelle : redémarrer le daemon, `curl .../liquidations/BTCUSDT?limite=20` doit finir par contenir `venue:"okx"` (quelques minutes).
- [ ] **Step 6 : fenêtre LIQ** — badge 2-3 lettres par venue dans le feed (`BYB`/`OKX`), pas de refonte.
- [ ] **Step 7 : commit** — `feat: liquidations multi-exchange Bybit+OKX (live front + ingestion daemon, champ venue)`.

### Task 9 : Couche « niveaux estimés » depuis l'OI (P6 — étiquetée ESTIMATION)

**Files:**
- Create: `apps/web/src/chart/liquidationEstimates.ts`
- Create: `apps/web/src/chart/liquidationEstimates.test.ts`
- Modify: `apps/web/src/chart/liquidationHeat.ts` (le contrôleur dessine aussi cette couche si active)
- Modify: `apps/web/src/App.tsx` (import commande) — repérer l'import des commandes `liquidationMarkers` (l.39) et faire pareil
- Modify: `apps/web/src/components/LiquidationsWindow.tsx` (2e toggle « Niveaux estimés (modèle levier) »)

**Interfaces:**
- Consumes: `fetchOpenInterestHistoryBatch` (`coinalyze.ts:559`, période "1hour", fenêtre 72 h), `marketStore` (candles), `candleContenant`.
- Produces :

```ts
export interface NiveauEstime { price: number; side: "long"|"short"; levier: number; poidsUsd: number }
/** Modèle : chaque hausse d'OI ouvre des positions au close de la bougie ; niveaux de
 *  liquidation ≈ entry×(1−1/L) pour les longs, entry×(1+1/L) pour les shorts,
 *  L ∈ LEVIERS, ΔOI réparti 50/50 long/short et uniformément entre leviers.
 *  Un niveau TRAVERSÉ par le prix depuis son ouverture est CONSOMMÉ (retiré).
 *  APPROXIMATION ASSUMÉE (pas de marge de maintenance, pas de répartition réelle) —
 *  toujours étiquetée « EST. » à l'écran (garde-fou BUILD-CONTRACT). PURE. */
export const LEVIERS = [10, 25, 50, 100] as const;
export function calculerNiveauxEstimes(oiHist: {time:number; oiUsd:number}[], candles: Candle[]): NiveauEstime[];
export const liqEstStore: StoreApi<{ actif: boolean; basculer: () => void }>;
export const commandes: Commande[]; // mnémonique "LIQEST", libellé « Niveaux de liquidation ESTIMÉS (modèle levier) — activer/désactiver »
```

Rendu (dans `LiquidationHeatController`, couche indépendante de la heatmap — chacune peut être active seule) : lignes horizontales pointillées, teinte orange (`#f59e0b`, alpha ∝ log du poids, épaisseur 1px), regroupées par bucket de prix (réutiliser `tailleBucket`) pour éviter 300 lignes ; libellé « EST. ×25 » sur les 5 plus gros niveaux. Légende de couche : « Niveaux ESTIMÉS (modèle levier — approximation) ». Rafraîchissement : fetch OI au toggle ON + toutes les 15 min (les niveaux se recalculent des candles à chaque construction — la consommation des niveaux traversés est donc automatique).

- [ ] **Step 1 : tests de `calculerNiveauxEstimes`** — OI plat → aucun niveau ; hausse d'OI sur bougie close=100 → niveaux long {90, 96, 98, 99} et short {110, 104, 102, 101} ; niveau long 96 traversé par une bougie ultérieure (low<96) → absent ; poids réparti = ΔOI/8 par niveau.
- [ ] **Step 2 : FAIL → Step 3 : implémenter → Step 4 : PASS** — `pnpm --filter @axiom/web test -- liquidationEstimates`.
- [ ] **Step 5 : câblage rendu + commande + toggle fenêtre, gate visuel** (étiquette « EST. » visible, couche distincte de la heatmap).
- [ ] **Step 6 : commit** — `feat(web): couche niveaux de liquidation ESTIMÉS depuis l'OI (étiquetée, toggle LIQEST)`.

### Task 10 : Vérification finale de bout en bout

- [ ] `pnpm --filter @axiom/web test` ET `cd apps/daemon && bun test` ET `pnpm --filter @axiom/web build` verts.
- [ ] Parcours réel : daemon lancé → ouvrir l'app → `LIQMARK` ON sur BTCUSDT → la heatmap est PRÉ-REMPLIE par l'historique daemon (plus d'attente à froid) ; tooltip OK ; `LIQEST` ON → niveaux estimés étiquetés ; fenêtre LIQ affiche les badges venue ; couper le daemon → recharger → tout fonctionne encore (repli localStorage/Coinalyze).
- [ ] Commit final éventuel de câblage + mise à jour de `docs/superpowers/specs/2026-07-15-liquidation-heatmap-design.md` (note « v2 : voir plan 2026-07-15-liquidation-heatmap-v2 »).
