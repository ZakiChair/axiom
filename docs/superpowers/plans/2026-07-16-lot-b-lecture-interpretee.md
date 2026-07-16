# Lot B — Lecture interprétée — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Donner un référentiel à chaque chiffre du terminal (percentiles historiques, zones on-chain, extrêmes cross-sectionnels), un score de régime composite permanent (pastille SessionStrip), et un chapeau interprété au BRIEF — plus les 2 reliquats chart du Lot A.

**Architecture :** (B1) `lib/referentiel.ts` (percentiles purs) + `data/referentiels.ts` (5 historiques publics sous cache TTL 1 h) + primitive `RefBadge` dans ui.tsx. (B2) `data/regime.ts` (score composite pur −2..+2) + `store/regime.ts` (poller 15 min, pattern `startMacroHistoryPolling`) + pastille SessionStrip cliquable → BRIEF. (B3) chapeau BRIEF = 4 Metric + phrases générées par `data/lecturesBrief.ts` (pur), intégré à l'export markdown. (B4) 7 fenêtres consomment les caches (badges/zones/extrêmes — AUCUNE nouvelle boucle). (B5) navigation clavier IndicatorMenu + atténuation heatmap sous footprint.

**Tech Stack :** TypeScript strict, React 18, Tailwind 3 (tokens), stores zustand vanilla, vitest **node sans DOM** (fonctions pures uniquement ; le JSX est couvert par typecheck + gate visuel).

## Global Constraints (BUILD-CONTRACT + CLAUDE.md)

- Commentaires, docs et UI en **français** ; Conventional Commits en français.
- TypeScript strict, `noUncheckedIndexedAccess` — tout accès indexé gère `undefined`.
- **AUCUNE dépendance nouvelle** ; ne pas modifier les `package.json`.
- Vitest en environnement **node** : on ne teste QUE des fonctions pures exportées ; jamais de montage React.
- Budget requêtes : caches TTL 1 h dans `data/referentiels.ts` ; store regime tick 15 min ; les fenêtres consomment les caches (aucun `setInterval` nouveau par fenêtre).
- Convention funding : **fraction** en interne, `formatFunding`/`formatPct` à l'affichage ; APR via `annualiserFunding` (exportée, `data/fundingCrossExchange.ts:34`).
- Ton des textes générés : factuel-conditionnel, JAMAIS prescriptif (pas de « acheter/vendre »).
- Dégradation : toute source en échec → badge/tuile absents ou « — », jamais d'erreur bloquante ; daemon absent → baseline LIQ absente, le reste fonctionne.
- Vérifications par tâche : `pnpm --filter @axiom/web test`, `typecheck`, `build` verts ; commit par tâche.

### Corrections factuelles vs la spec (vérifiées sur le code le 2026-07-16)

1. **`basculer("brief")` n'existe pas** — le pattern réel est `windowManagerStore.getState().openWindow("brief")` (`store/windowManager.ts:380`, id `"brief"` valide au registre l.68). Le « pattern P&L jour » de SessionStrip utilise en réalité `portfolioUiStore.getState().openPortfolio()`.
2. **`ref` est un prop React RÉSERVÉ** — la primitive s'écrit `<RefBadge referentiel={...} />`, pas `ref={...}`.
3. **`TonBadge` n'a pas de ton `warn`** (`ui.tsx:272` : neutre/up/down/accent) — Task 3 l'ajoute (`border-warn text-warn`, classes Tailwind créées au Lot A). Couleur inline/canvas warn = `var(--ui-amber)` (le Lot A a fait de `warn` un alias Tailwind de `--ui-amber`, PAS une variable CSS).
4. **Pas de « daemonPret »** — le séquencement boot est `main.tsx` (hydrateStores → enablePersistence → startMacroHistoryPolling) ; le pattern poller à copier est `startMacroHistoryPolling` (`store/macroHistory.ts:106`).
5. **`futuresSymbol` est privé** (`data/binanceFutures.ts:212`) — Task 2 l'exporte (changement d'une ligne).
6. **Flux ETF** : passer par `fetchEtfBrief()` (`data/brief.ts:526`, gère la clé SoSoValue et les 3 actifs) — pas par `fetchEtfFlows` directement.
7. **Δ supply stablecoins 7 j** : `chargerEmetteurs()` (`data/macro/stablecoinsDetail.ts:122`) porte déjà `mcapUsd`/`mcap7jUsd` par émetteur — pas besoin de l'historique agrégé.
8. **Pas de fonction « total 1 h » liquidations** — c'est `statsLiquidations(filtrerFenetre(events, now − 3_600_000)).total` (`components/liquidationsWindow.util.ts:14,34`).
9. **OnchainWindow n'a PAS de `NoteSource`** (note = `<p>` conditionnel l.487) — Task 10 ajoute une `NoteSource` permanente documentant les seuils de zone.
10. **`IndicatorMenu.tsx` vit dans `components/`** (pas `chart/`) et n'a AUCUNE gestion clavier aujourd'hui.
11. **FUNDX affiche déjà l'écart en sous-titre** (l.60-67) — Task 14 le promeut en `Metric` et le RETIRE du sous-titre (pas de doublon).
12. **STBL : l'onglet actif est un `useState` local** (`StablecoinsWindow.tsx:696`) — le bandeau pegs reçoit un prop `onVoirPegs` ; le seuil de matérialité existant est `SUPPLY_MIN_USD = 10_000_000` (l.515, local à `VuePegs`) — le déplacer dans `stablecoinsWindow.util.ts` et le réutiliser.
13. **`api.alternative.me`, `fapi.binance.com`, `www.deribit.com` sont DÉJÀ whitelistés** (`shared/extapi-hosts.ts`) — aucune modification de whitelist.
14. **`liquidationHeat.ts` n'importe pas `orderflowStore`** — Task 17 ajoute l'import + une souscription dirty.
15. **Champs réels** : `LigneWatchlist = { symbole, prix, variation24h }` (`data/brief.ts:49`) ; `fetchOpenInterestHist` renvoie `{ time, oi, oiUsd }[]` ; `fetchDvolHistory` renvoie `{ time, value }[]` et **throw** en échec (à envelopper) ; `liquidationsGet(symbole, { depuis, jusqua, limite })` renvoie `LiqDaemon[] | null` avec `t/side/price/qty/usd/venue`.

---

## Phase B1 — Fondations : référentiels purs + historiques à la demande

### Task 1 : `lib/referentiel.ts` — percentiles purs

**Files:**
- Create: `apps/web/src/lib/referentiel.ts`
- Test: `apps/web/src/lib/referentiel.test.ts`

**Interfaces:**
- Produces: `PointSerie { t; v }`, `Referentiel { percentile; profondeurJours; n }`, `PROFONDEUR_MIN_JOURS = 5`, `rangPercentile(valeurs, valeur): number`, `referentiel(serie, valeur, now): Referentiel | null`, `texteRef(ref): string`, `estExtreme(ref): boolean`. Consommés par Tasks 2, 5, 9, 11.

- [ ] **Step 1 : écrire les tests (rouges)**

`apps/web/src/lib/referentiel.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import {
  estExtreme,
  rangPercentile,
  referentiel,
  texteRef,
  type PointSerie,
} from "./referentiel";

const JOUR_MS = 86_400_000;

/** Série linéaire : n points espacés d'une heure, v = 1..n, se terminant à `fin`. */
function serieLineaire(n: number, fin: number): PointSerie[] {
  return Array.from({ length: n }, (_, i) => ({
    t: fin - (n - 1 - i) * 3_600_000,
    v: i + 1,
  }));
}

describe("rangPercentile", () => {
  it("compte la part des valeurs ≤ valeur (ties inclus)", () => {
    expect(rangPercentile([1, 2, 3, 4], 4)).toBe(100);
    expect(rangPercentile([1, 2, 3, 4], 1)).toBe(25);
    expect(rangPercentile([1, 2, 3, 4], 0)).toBe(0);
    expect(rangPercentile([1, 2, 2, 4], 2)).toBe(75);
  });
  it("renvoie NaN sous 2 valeurs", () => {
    expect(rangPercentile([], 1)).toBeNaN();
    expect(rangPercentile([1], 1)).toBeNaN();
  });
});

describe("referentiel", () => {
  const now = 1_700_000_000_000;
  it("null si série trop courte ou trop peu profonde", () => {
    expect(referentiel([], 1, now)).toBeNull();
    expect(referentiel(serieLineaire(2, now), 1, now)).toBeNull(); // 1 h de profondeur
  });
  it("calcule percentile, profondeur en jours et n", () => {
    const serie = serieLineaire(241, now); // 240 h = 10 j
    const ref = referentiel(serie, 241, now);
    expect(ref).not.toBeNull();
    expect(ref?.percentile).toBe(100);
    expect(ref?.profondeurJours).toBe(10);
    expect(ref?.n).toBe(241);
  });
  it("ignore les v non finis", () => {
    const serie: PointSerie[] = [
      { t: now - 6 * JOUR_MS, v: 1 },
      { t: now - 3 * JOUR_MS, v: Number.NaN },
      { t: now, v: 3 },
    ];
    const ref = referentiel(serie, 2, now);
    expect(ref?.n).toBe(2);
    expect(ref?.percentile).toBe(50);
  });
});

describe("texteRef / estExtreme", () => {
  it("formate « pNN · NN j »", () => {
    expect(texteRef({ percentile: 96.6, profondeurJours: 12.4, n: 270 })).toBe("p97 · 12 j");
  });
  it("extrême au-delà de p90 / en-deçà de p10", () => {
    expect(estExtreme({ percentile: 90, profondeurJours: 30, n: 90 })).toBe(true);
    expect(estExtreme({ percentile: 10, profondeurJours: 30, n: 90 })).toBe(true);
    expect(estExtreme({ percentile: 50, profondeurJours: 30, n: 90 })).toBe(false);
  });
});
```

- [ ] **Step 2 : vérifier l'échec**

Run: `pnpm --filter @axiom/web test -- referentiel`
Expected: FAIL (module inexistant).

- [ ] **Step 3 : implémenter `lib/referentiel.ts`**

```ts
/**
 * Référentiels historiques : situer une valeur courante dans sa distribution
 * (percentile) avec la PROFONDEUR RÉELLE des données — jamais un percentile nu.
 * Tout est pur ; les historiques viennent de data/referentiels.ts.
 */

/** Point d'une série temporelle (t = ms epoch). */
export interface PointSerie {
  t: number;
  v: number;
}

/** Position d'une valeur dans son historique, avec la profondeur réelle. */
export interface Referentiel {
  /** Rang percentile 0..100 de la valeur courante. */
  percentile: number;
  /** Profondeur couverte par la série, en jours (réelle, pas nominale). */
  profondeurJours: number;
  /** Nombre de points utilisés. */
  n: number;
}

/** Sous ce seuil de profondeur, le percentile serait trompeur → « réf. en construction ». */
export const PROFONDEUR_MIN_JOURS = 5;

const JOUR_MS = 86_400_000;

/** Rang percentile : part des valeurs ≤ valeur (ties inclus), 0..100. NaN sous 2 valeurs. */
export function rangPercentile(valeurs: readonly number[], valeur: number): number {
  if (valeurs.length < 2) return Number.NaN;
  let sous = 0;
  for (const v of valeurs) if (v <= valeur) sous += 1;
  return (sous / valeurs.length) * 100;
}

/**
 * Situe `valeur` dans `serie`. Null si moins de 2 points finis ou si la série
 * couvre moins de PROFONDEUR_MIN_JOURS (référentiel en construction).
 */
export function referentiel(
  serie: readonly PointSerie[],
  valeur: number,
  now: number,
): Referentiel | null {
  const finis = serie.filter((p) => Number.isFinite(p.v));
  if (finis.length < 2 || !Number.isFinite(valeur)) return null;
  let plusAncien = Number.POSITIVE_INFINITY;
  for (const p of finis) if (p.t < plusAncien) plusAncien = p.t;
  const profondeurJours = (now - plusAncien) / JOUR_MS;
  if (!(profondeurJours >= PROFONDEUR_MIN_JOURS)) return null;
  return {
    percentile: rangPercentile(finis.map((p) => p.v), valeur),
    profondeurJours,
    n: finis.length,
  };
}

/** « p97 · 12 j » — percentile arrondi, profondeur arrondie au jour. */
export function texteRef(ref: Referentiel): string {
  return `p${Math.round(ref.percentile)} · ${Math.round(ref.profondeurJours)} j`;
}

/** Extrême = queue de distribution (≥ p90 ou ≤ p10). */
export function estExtreme(ref: Referentiel): boolean {
  return ref.percentile >= 90 || ref.percentile <= 10;
}
```

- [ ] **Step 4 : vérifier le vert**

Run: `pnpm --filter @axiom/web test -- referentiel` → PASS. Puis `pnpm --filter @axiom/web typecheck`.

- [ ] **Step 5 : commit**

```bash
git add apps/web/src/lib/referentiel.ts apps/web/src/lib/referentiel.test.ts
git commit -m "feat(referentiel): percentiles purs avec profondeur réelle (Lot B1)"
```

### Task 2 : `data/referentiels.ts` — 5 historiques publics sous cache TTL 1 h

**Files:**
- Create: `apps/web/src/data/referentiels.ts`
- Test: `apps/web/src/data/referentiels.test.ts`
- Modify: `apps/web/src/data/binanceFutures.ts:212` (exporter `futuresSymbol` — préfixer `export`, rien d'autre)

**Interfaces:**
- Consumes: `PointSerie` (Task 1) ; `extUrl(hote, chemin)` (`data/extapi.ts:35`) ; `fetchOpenInterestHist(symbol, "1h", 500)` → `{ time, oi, oiUsd }[]` ; `fetchDvolHistory(currency, days)` → `{ time, value }[]` (THROW en échec) ; `fetchFearGreedHistory(limit)` → `FearGreedPoint[]` (`data/marketOverview.ts:360`, `[]` en échec) ; `liquidationsGet(symbole, { depuis, limite })` → `LiqDaemon[] | null` (`data/daemon.ts:488`).
- Produces (pures, testées) : `deltasFenetre(points: readonly PointSerie[], fenetreMs: number): PointSerie[]` ; `bucketsHoraires(events: readonly { t: number; usd: number }[], now: number): PointSerie[]`.
- Produces (fetchers, `Promise<PointSerie[] | null>`, échec → null) : `histFunding(symbol)`, `histOiUsd(symbol)`, `histDeltaOi(symbol, fenetreMs = 3_600_000)`, `histDvol(devise: "BTC" | "ETH")`, `histFearGreed()`, `histLiqParHeure(symbol)`. Consommés par Tasks 5, 9, 11.

- [ ] **Step 1 : écrire les tests des pures (rouges)**

`apps/web/src/data/referentiels.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { bucketsHoraires, deltasFenetre } from "./referentiels";
import type { PointSerie } from "../lib/referentiel";

const H = 3_600_000;

describe("deltasFenetre", () => {
  const base = 1_700_000_000_000;
  const points: PointSerie[] = [
    { t: base, v: 100 },
    { t: base + H, v: 110 },
    { t: base + 2 * H, v: 99 },
  ];
  it("variation % vs le dernier point ≤ t − fenêtre", () => {
    const d = deltasFenetre(points, H);
    expect(d).toHaveLength(2);
    expect(d[0]).toEqual({ t: base + H, v: 10 });
    expect(d[1]?.v).toBeCloseTo(-10, 6);
  });
  it("fenêtre plus large que la série → vide ; référence à 0 ignorée", () => {
    expect(deltasFenetre(points, 3 * H)).toEqual([]);
    expect(deltasFenetre([{ t: base, v: 0 }, { t: base + H, v: 5 }], H)).toEqual([]);
  });
});

describe("bucketsHoraires", () => {
  it("agrège l'USD par heure pleine et remplit les heures vides à 0", () => {
    const t0 = Math.floor(1_700_000_000_000 / H) * H; // heure pleine
    const events = [
      { t: t0 + 60_000, usd: 100 },
      { t: t0 + 120_000, usd: 50 },
      { t: t0 + 2 * H + 1, usd: 7 },
    ];
    const buckets = bucketsHoraires(events, t0 + 3 * H);
    expect(buckets).toHaveLength(3);
    expect(buckets[0]).toEqual({ t: t0, v: 150 });
    expect(buckets[1]).toEqual({ t: t0 + H, v: 0 });
    expect(buckets[2]).toEqual({ t: t0 + 2 * H, v: 7 });
  });
  it("vide → vide", () => {
    expect(bucketsHoraires([], 1_700_000_000_000)).toEqual([]);
  });
});
```

- [ ] **Step 2 : vérifier l'échec**

Run: `pnpm --filter @axiom/web test -- referentiels` → FAIL.

- [ ] **Step 3 : implémenter `data/referentiels.ts` + export `futuresSymbol`**

Dans `binanceFutures.ts:212` : `function futuresSymbol` → `export function futuresSymbol` (le commentaire existant reste).

```ts
/**
 * Historiques publics « à la demande » pour les référentiels (percentiles).
 * Chaque fetcher renvoie PointSerie[] | null (échec → null, jamais bloquant)
 * sous cache module TTL 1 h — les fenêtres consomment, AUCUNE boucle ici.
 */
import type { PointSerie } from "../lib/referentiel";
import { extUrl } from "./extapi";
import { fetchOpenInterestHist, futuresSymbol } from "./binanceFutures";
import { fetchDvolHistory } from "./deribit";
import { fetchFearGreedHistory } from "./marketOverview";
import { liquidationsGet } from "./daemon";

const TTL_MS = 3_600_000;
const H_MS = 3_600_000;
const JOUR_MS = 86_400_000;

const cache = new Map<string, { t: number; data: PointSerie[] }>();

/** Mémoïse les SUCCÈS 1 h ; un échec (null) n'est pas caché (retenté au tick suivant). */
async function memo(
  cle: string,
  loader: () => Promise<PointSerie[] | null>,
): Promise<PointSerie[] | null> {
  const hit = cache.get(cle);
  const now = Date.now();
  if (hit !== undefined && now - hit.t < TTL_MS) return hit.data;
  try {
    const data = await loader();
    if (data === null || data.length === 0) return null;
    cache.set(cle, { t: now, data });
    return data;
  } catch {
    return null;
  }
}

/** Vide le cache (tests). */
export function _viderCacheReferentiels(): void {
  cache.clear();
}

/**
 * Série des variations % sur `fenetreMs` glissants : pour chaque point, variation
 * vs le DERNIER point dont t ≤ t − fenetreMs (référence à 0 ou absente → point omis).
 */
export function deltasFenetre(
  points: readonly PointSerie[],
  fenetreMs: number,
): PointSerie[] {
  const tries = [...points].sort((a, b) => a.t - b.t);
  const out: PointSerie[] = [];
  let j = 0;
  for (let i = 0; i < tries.length; i += 1) {
    const p = tries[i];
    if (p === undefined) continue;
    // Avance la référence : dernier point ≤ p.t − fenetreMs.
    let ref: PointSerie | undefined;
    while (j < tries.length) {
      const cand = tries[j];
      if (cand === undefined || cand.t > p.t - fenetreMs) break;
      ref = cand;
      j += 1;
    }
    // j a pu dépasser : la référence reste valable pour les points suivants.
    if (ref !== undefined) j -= 1;
    if (ref === undefined || ref.v === 0 || !Number.isFinite(ref.v)) continue;
    out.push({ t: p.t, v: (p.v / ref.v - 1) * 100 });
  }
  return out;
}

/** Agrège des événements {t, usd} en buckets d'une heure pleine, heures vides = 0. */
export function bucketsHoraires(
  events: readonly { t: number; usd: number }[],
  now: number,
): PointSerie[] {
  if (events.length === 0) return [];
  let tMin = Number.POSITIVE_INFINITY;
  for (const e of events) if (e.t < tMin) tMin = e.t;
  const debut = Math.floor(tMin / H_MS) * H_MS;
  const fin = Math.floor((now - 1) / H_MS) * H_MS;
  const somme = new Map<number, number>();
  for (const e of events) {
    const b = Math.floor(e.t / H_MS) * H_MS;
    somme.set(b, (somme.get(b) ?? 0) + e.usd);
  }
  const out: PointSerie[] = [];
  for (let b = debut; b <= fin; b += H_MS) out.push({ t: b, v: somme.get(b) ?? 0 });
  return out;
}

/** Funding réglé Binance USDⓈ-M (~90 j à 8 h/règlement), v = fraction. */
export async function histFunding(symbol: string): Promise<PointSerie[] | null> {
  return memo(`funding:${symbol}`, async () => {
    const url = extUrl(
      "fapi.binance.com",
      `fapi/v1/fundingRate?symbol=${encodeURIComponent(futuresSymbol(symbol))}&limit=270`,
    );
    const res = await fetch(url);
    if (!res.ok) return null;
    const brut: unknown = await res.json();
    if (!Array.isArray(brut)) return null;
    const points: PointSerie[] = [];
    for (const item of brut) {
      const o = item as { fundingTime?: unknown; fundingRate?: unknown };
      const t = Number(o.fundingTime);
      const v = Number(o.fundingRate);
      if (Number.isFinite(t) && Number.isFinite(v)) points.push({ t, v });
    }
    points.sort((a, b) => a.t - b.t);
    return points;
  });
}

/** Open Interest notionnel USD 1 h (~20 j), série brute. */
export async function histOiUsd(symbol: string): Promise<PointSerie[] | null> {
  return memo(`oiUsd:${symbol}`, async () => {
    const pts = await fetchOpenInterestHist(symbol, "1h", 500);
    return pts.map((p) => ({ t: p.time, v: p.oiUsd }));
  });
}

/** Variations % d'OI sur `fenetreMs` glissants (défaut 1 h). */
export async function histDeltaOi(
  symbol: string,
  fenetreMs = H_MS,
): Promise<PointSerie[] | null> {
  const brut = await histOiUsd(symbol);
  if (brut === null) return null;
  const deltas = deltasFenetre(brut, fenetreMs);
  return deltas.length > 0 ? deltas : null;
}

/** DVOL Deribit quotidien 90 j (BTC/ETH seulement). */
export async function histDvol(devise: "BTC" | "ETH"): Promise<PointSerie[] | null> {
  return memo(`dvol:${devise}`, async () => {
    const pts = await fetchDvolHistory(devise, 90);
    return pts.map((p) => ({ t: p.time, v: p.value }));
  });
}

/** Fear & Greed Alternative.me, 90 j, v = 0..100. */
export async function histFearGreed(): Promise<PointSerie[] | null> {
  return memo("fearGreed", async () => {
    const pts = await fetchFearGreedHistory(90);
    return pts.map((p) => ({ t: p.time, v: p.value }));
  });
}

/** USD liquidé par heure (daemon 30 j). Null si daemon absent/sans capability. */
export async function histLiqParHeure(symbol: string): Promise<PointSerie[] | null> {
  return memo(`liqHeure:${symbol}`, async () => {
    const now = Date.now();
    const rows = await liquidationsGet(symbol, { depuis: now - 30 * JOUR_MS, limite: 100_000 });
    if (rows === null) return null;
    return bucketsHoraires(rows.map((r) => ({ t: r.t, usd: r.usd })), now);
  });
}
```

⚠️ `deltasFenetre` : l'algorithme deux-pointeurs ci-dessus doit passer EXACTEMENT les tests du Step 1 — si le rattrapage `j -= 1` te semble fragile, une version O(n²) simple (recherche linéaire de la référence par point, n ≤ 500) est acceptable et préférable à un bug.

- [ ] **Step 4 : vérifier le vert**

Run: `pnpm --filter @axiom/web test -- referentiels` → PASS ; `pnpm --filter @axiom/web typecheck` ; `pnpm --filter @axiom/web test` (rien de cassé par l'export `futuresSymbol`).

- [ ] **Step 5 : commit**

```bash
git add apps/web/src/data/referentiels.ts apps/web/src/data/referentiels.test.ts apps/web/src/data/binanceFutures.ts
git commit -m "feat(referentiels): 5 historiques publics sous cache TTL 1 h + pures deltasFenetre/bucketsHoraires (Lot B1)"
```

### Task 3 : `RefBadge` + ton `warn` de Badge (ui.tsx)

**Files:**
- Modify: `apps/web/src/components/ui.tsx` (TONS_BADGE l.274-279 ; nouvelle primitive après `Badge` ~l.300)
- Test: `apps/web/src/components/ui.tonRef.test.ts` (nouveau — la logique de ton est extraite pure)

**Interfaces:**
- Consumes: `Referentiel`, `texteRef`, `estExtreme` (Task 1).
- Produces: `TonBadge` étendu avec `"warn"` ; `tonRef(ref: Referentiel, sens?: SensRef): TonBadge` (pure exportée) ; `<RefBadge referentiel={Referentiel | null} sens?: "hausse-chaud" | "hausse-froid" />`. Consommés par Tasks 9, 10, 11.

- [ ] **Step 1 : test de la pure `tonRef` (rouge)**

`apps/web/src/components/ui.tonRef.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { tonRef } from "./ui";

const ref = (percentile: number) => ({ percentile, profondeurJours: 30, n: 90 });

describe("tonRef", () => {
  it("extrême → warn, sinon neutre", () => {
    expect(tonRef(ref(95))).toBe("warn");
    expect(tonRef(ref(5))).toBe("warn");
    expect(tonRef(ref(50))).toBe("neutre");
  });
  it("sens hausse-chaud : seule la queue HAUTE est chaude", () => {
    expect(tonRef(ref(95), "hausse-chaud")).toBe("warn");
    expect(tonRef(ref(5), "hausse-chaud")).toBe("neutre");
  });
  it("sens hausse-froid : seule la queue BASSE est chaude", () => {
    expect(tonRef(ref(5), "hausse-froid")).toBe("warn");
    expect(tonRef(ref(95), "hausse-froid")).toBe("neutre");
  });
});
```

- [ ] **Step 2 : vérifier l'échec** — `pnpm --filter @axiom/web test -- tonRef` → FAIL.

- [ ] **Step 3 : implémenter**

Dans `ui.tsx`, étendre le ton (l.272-279) :

```ts
export type TonBadge = "neutre" | "up" | "down" | "accent" | "warn";

const TONS_BADGE: Record<TonBadge, string> = {
  neutre: "border-border text-text-dim",
  up: "border-up text-up",
  down: "border-down text-down",
  accent: "border-accent text-accent",
  warn: "border-warn text-warn",
};
```

Après `Badge`, ajouter (import `type Referentiel`, `texteRef`, `estExtreme` depuis `../lib/referentiel`) :

```tsx
/** Orientation d'un référentiel : quelle queue de distribution est « chaude » (warn). */
export type SensRef = "hausse-chaud" | "hausse-froid";

/** Ton du RefBadge — pur, testé (défaut : les deux extrêmes sont chauds). */
export function tonRef(refe: Referentiel, sens?: SensRef): TonBadge {
  if (!estExtreme(refe)) return "neutre";
  if (sens === "hausse-chaud") return refe.percentile >= 90 ? "warn" : "neutre";
  if (sens === "hausse-froid") return refe.percentile <= 10 ? "warn" : "neutre";
  return "warn";
}

/**
 * Badge de référentiel : « p97 · 90 j » (warn si extrême), ou « réf. en construction »
 * quand l'historique est trop court/absent. `referentiel` (PAS `ref` : prop React réservé).
 */
export function RefBadge({
  referentiel: refe,
  sens,
}: {
  referentiel: Referentiel | null;
  sens?: SensRef;
}) {
  if (refe === null) {
    return (
      <Badge ton="neutre" title="Historique insuffisant (moins de 5 jours de données) : le percentile serait trompeur.">
        réf. en construction
      </Badge>
    );
  }
  const titre = `${Math.round(refe.percentile)}e percentile sur ${Math.round(refe.profondeurJours)} j de données (${refe.n} points)`;
  return (
    <Badge ton={tonRef(refe, sens)} title={titre}>
      {texteRef(refe)}
    </Badge>
  );
}
```

- [ ] **Step 4 : vérifier le vert** — `pnpm --filter @axiom/web test -- tonRef` → PASS ; `typecheck` ; suite complète (le garde-fou anti-classes brutes du Lot A doit rester vert : `border-warn`/`text-warn` sont des classes thémées légitimes).

- [ ] **Step 5 : commit**

```bash
git add apps/web/src/components/ui.tsx apps/web/src/components/ui.tonRef.test.ts
git commit -m "feat(ui): RefBadge (percentile + profondeur) et ton warn de Badge (Lot B1)"
```

---

## Phase B2 — REGIME : score composite + pastille

### Task 4 : `data/regime.ts` — score composite pur

**Files:**
- Create: `apps/web/src/data/regime.ts`
- Test: `apps/web/src/data/regime.test.ts`

**Interfaces:**
- Produces: `EntreesRegime` (6 champs `number | null`), `ComposantRegime { id; libelle; note; detail }`, `LibelleRegime`, `Regime { score; libelle; composants }`, `calculerRegime(entrees): Regime`, `tonRegime(libelle): "up" | "down" | "neutre"`. Consommés par Tasks 5, 6, 8.

- [ ] **Step 1 : tests (rouges)**

`apps/web/src/data/regime.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { calculerRegime, tonRegime, type EntreesRegime } from "./regime";

const VIDE: EntreesRegime = {
  directionBtc24hPct: null,
  fearGreed: null,
  fundingBtcPercentile: null,
  dvolBtcPercentile: null,
  fluxEtfJourUsd: null,
  impressionStablecoins7jPct: null,
};

describe("calculerRegime — notes par composant", () => {
  it("direction BTC : bornes des 5 paliers", () => {
    const note = (pct: number) =>
      calculerRegime({ ...VIDE, directionBtc24hPct: pct }).composants.find((c) => c.id === "btc24h")?.note;
    expect(note(3)).toBe(2);
    expect(note(1.5)).toBe(1);
    expect(note(0)).toBe(0);
    expect(note(-1.5)).toBe(-1);
    expect(note(-3)).toBe(-2);
  });
  it("fear & greed : 75→+2, 60→+1, 50→0, 30→−1, 24→−2", () => {
    const note = (v: number) =>
      calculerRegime({ ...VIDE, fearGreed: v }).composants.find((c) => c.id === "fearGreed")?.note;
    expect(note(75)).toBe(2);
    expect(note(60)).toBe(1);
    expect(note(50)).toBe(0);
    expect(note(30)).toBe(-1);
    expect(note(24)).toBe(-2);
  });
  it("funding : contrarien léger aux extrêmes", () => {
    const note = (p: number) =>
      calculerRegime({ ...VIDE, fundingBtcPercentile: p }).composants.find((c) => c.id === "funding")?.note;
    expect(note(95)).toBe(-1);
    expect(note(50)).toBe(0);
    expect(note(5)).toBe(1);
  });
  it("dvol : calme +1, stress −2", () => {
    const note = (p: number) =>
      calculerRegime({ ...VIDE, dvolBtcPercentile: p }).composants.find((c) => c.id === "dvol")?.note;
    expect(note(30)).toBe(1);
    expect(note(70)).toBe(0);
    expect(note(90)).toBe(-2);
  });
  it("etf et stablecoins : paliers à ±50 M$ / ±0.5 %", () => {
    expect(calculerRegime({ ...VIDE, fluxEtfJourUsd: 60_000_000 }).composants.find((c) => c.id === "etf")?.note).toBe(1);
    expect(calculerRegime({ ...VIDE, fluxEtfJourUsd: -60_000_000 }).composants.find((c) => c.id === "etf")?.note).toBe(-1);
    expect(calculerRegime({ ...VIDE, impressionStablecoins7jPct: 0.6 }).composants.find((c) => c.id === "stables")?.note).toBe(1);
    expect(calculerRegime({ ...VIDE, impressionStablecoins7jPct: -0.6 }).composants.find((c) => c.id === "stables")?.note).toBe(-1);
  });
});

describe("calculerRegime — score et libellé", () => {
  it("moins de 3 composants disponibles → indéterminé", () => {
    const r = calculerRegime({ ...VIDE, directionBtc24hPct: 5, fearGreed: 80 });
    expect(r.libelle).toBe("indéterminé");
  });
  it("score = moyenne des notes non-null, libellés par paliers", () => {
    const r = calculerRegime({ ...VIDE, directionBtc24hPct: 5, fearGreed: 80, dvolBtcPercentile: 30 });
    // notes : +2, +2, +1 → score 5/3 ≈ 1.67 → risk-on tendu
    expect(r.score).toBeCloseTo(5 / 3, 6);
    expect(r.libelle).toBe("risk-on tendu");
    const r2 = calculerRegime({ ...VIDE, directionBtc24hPct: -5, fearGreed: 10, dvolBtcPercentile: 90 });
    expect(r2.libelle).toBe("risk-off marqué");
    const r3 = calculerRegime({ ...VIDE, directionBtc24hPct: 0, fearGreed: 50, dvolBtcPercentile: 70 });
    expect(r3.libelle).toBe("neutre");
  });
  it("les 6 composants sont toujours listés (note null si indisponible)", () => {
    const r = calculerRegime(VIDE);
    expect(r.composants).toHaveLength(6);
    expect(r.composants.every((c) => c.note === null)).toBe(true);
    expect(r.libelle).toBe("indéterminé");
  });
});

describe("tonRegime", () => {
  it("risk-on* → up, risk-off* → down, neutre/indéterminé → neutre", () => {
    expect(tonRegime("risk-on tendu")).toBe("up");
    expect(tonRegime("risk-on")).toBe("up");
    expect(tonRegime("neutre")).toBe("neutre");
    expect(tonRegime("indéterminé")).toBe("neutre");
    expect(tonRegime("risk-off")).toBe("down");
    expect(tonRegime("risk-off marqué")).toBe("down");
  });
});
```

- [ ] **Step 2 : vérifier l'échec** — `pnpm --filter @axiom/web test -- regime` → FAIL.

- [ ] **Step 3 : implémenter `data/regime.ts`**

```ts
/**
 * Régime de marché : score composite −2..+2 sur 6 composants publics.
 * PUR — l'assemblage des entrées vit dans store/regime.ts. Ton factuel,
 * jamais prescriptif : le score DÉCRIT l'environnement, il ne conseille pas.
 */

export interface EntreesRegime {
  /** Variation BTC 24 h en % (ticker Binance), ou null. */
  directionBtc24hPct: number | null;
  /** Fear & Greed 0..100, ou null. */
  fearGreed: number | null;
  /** Percentile 0..100 du funding BTC courant vs ~90 j, ou null. */
  fundingBtcPercentile: number | null;
  /** Percentile 0..100 du DVOL BTC courant vs 90 j, ou null. */
  dvolBtcPercentile: number | null;
  /** Flux ETF spot BTC+ETH+SOL de la veille, en USD, ou null. */
  fluxEtfJourUsd: number | null;
  /** Δ supply stablecoins 7 j en % de la supply, ou null. */
  impressionStablecoins7jPct: number | null;
}

export interface ComposantRegime {
  id: string;
  libelle: string;
  /** Note −2..+2, null = indisponible. */
  note: number | null;
  /** « F&G 72 (+1) » — affiché dans le title de la pastille et le détail BRIEF. */
  detail: string;
}

export type LibelleRegime =
  | "risk-on tendu"
  | "risk-on"
  | "neutre"
  | "risk-off"
  | "risk-off marqué"
  | "indéterminé";

export interface Regime {
  /** Moyenne des notes disponibles (0 si aucune). */
  score: number;
  libelle: LibelleRegime;
  composants: ComposantRegime[];
}

/** Sous ce nombre de composants disponibles, le score serait du bruit. */
const MIN_COMPOSANTS = 3;

function fmtNote(note: number): string {
  return note >= 0 ? `+${note}` : `${note}`;
}

export function calculerRegime(entrees: EntreesRegime): Regime {
  const composants: ComposantRegime[] = [];

  {
    const v = entrees.directionBtc24hPct;
    let note: number | null = null;
    if (v !== null && Number.isFinite(v)) {
      note = v >= 3 ? 2 : v >= 1 ? 1 : v > -1 ? 0 : v > -3 ? -1 : -2;
    }
    composants.push({
      id: "btc24h",
      libelle: "BTC 24 h",
      note,
      detail: note === null ? "BTC 24 h —" : `BTC 24 h ${v !== null && v >= 0 ? "+" : ""}${v?.toFixed(1)}% (${fmtNote(note)})`,
    });
  }
  {
    const v = entrees.fearGreed;
    let note: number | null = null;
    if (v !== null && Number.isFinite(v)) {
      note = v >= 75 ? 2 : v >= 60 ? 1 : v >= 40 ? 0 : v >= 25 ? -1 : -2;
    }
    composants.push({
      id: "fearGreed",
      libelle: "Fear & Greed",
      note,
      detail: note === null ? "F&G —" : `F&G ${Math.round(v ?? 0)} (${fmtNote(note)})`,
    });
  }
  {
    const p = entrees.fundingBtcPercentile;
    let note: number | null = null;
    if (p !== null && Number.isFinite(p)) {
      // Contrarien léger : funding tendu = positionnement long chargé (risque de purge).
      note = p > 90 ? -1 : p < 10 ? 1 : 0;
    }
    composants.push({
      id: "funding",
      libelle: "Funding BTC",
      note,
      detail: note === null ? "funding —" : `funding p${Math.round(p ?? 0)} (${fmtNote(note)})`,
    });
  }
  {
    const p = entrees.dvolBtcPercentile;
    let note: number | null = null;
    if (p !== null && Number.isFinite(p)) {
      note = p < 50 ? 1 : p <= 85 ? 0 : -2;
    }
    composants.push({
      id: "dvol",
      libelle: "DVOL BTC",
      note,
      detail: note === null ? "vol —" : `vol p${Math.round(p ?? 0)} (${fmtNote(note)})`,
    });
  }
  {
    const v = entrees.fluxEtfJourUsd;
    let note: number | null = null;
    if (v !== null && Number.isFinite(v)) {
      note = v > 50_000_000 ? 1 : v < -50_000_000 ? -1 : 0;
    }
    composants.push({
      id: "etf",
      libelle: "Flux ETF veille",
      note,
      detail: note === null ? "ETF —" : `ETF ${(v ?? 0) >= 0 ? "+" : "−"}$${Math.abs((v ?? 0) / 1e6).toFixed(0)}M (${fmtNote(note)})`,
    });
  }
  {
    const v = entrees.impressionStablecoins7jPct;
    let note: number | null = null;
    if (v !== null && Number.isFinite(v)) {
      note = v > 0.5 ? 1 : v < -0.5 ? -1 : 0;
    }
    composants.push({
      id: "stables",
      libelle: "Impression stablecoins 7 j",
      note,
      detail: note === null ? "stables —" : `stables ${v !== null && v >= 0 ? "+" : ""}${v?.toFixed(2)}% 7j (${fmtNote(note)})`,
    });
  }

  const notes = composants.map((c) => c.note).filter((n): n is number => n !== null);
  const score = notes.length > 0 ? notes.reduce((s, n) => s + n, 0) / notes.length : 0;
  let libelle: LibelleRegime;
  if (notes.length < MIN_COMPOSANTS) libelle = "indéterminé";
  else if (score >= 1.2) libelle = "risk-on tendu";
  else if (score >= 0.4) libelle = "risk-on";
  else if (score > -0.4) libelle = "neutre";
  else if (score > -1.2) libelle = "risk-off";
  else libelle = "risk-off marqué";

  return { score, libelle, composants };
}

/** Ton d'affichage de la pastille (le composant funding en warn vit dans le détail). */
export function tonRegime(libelle: LibelleRegime): "up" | "down" | "neutre" {
  if (libelle === "risk-on" || libelle === "risk-on tendu") return "up";
  if (libelle === "risk-off" || libelle === "risk-off marqué") return "down";
  return "neutre";
}
```

- [ ] **Step 4 : vérifier le vert** — `pnpm --filter @axiom/web test -- regime` → PASS ; `typecheck`.

- [ ] **Step 5 : commit**

```bash
git add apps/web/src/data/regime.ts apps/web/src/data/regime.test.ts
git commit -m "feat(regime): score composite pur 6 composants avec libellés par paliers (Lot B2)"
```

### Task 5 : `store/regime.ts` — assemblage + poller 15 min

**Files:**
- Create: `apps/web/src/store/regime.ts`
- Modify: `apps/web/src/main.tsx` (après `startMacroHistoryPolling();` l.22 : `startRegimePolling();` + import)

**Interfaces:**
- Consumes: `calculerRegime`, `Regime` (Task 4) ; `referentiel`, `rangPercentile`, `type Referentiel`, `type PointSerie` (Task 1) ; `histFunding`, `histDvol`, `histFearGreed`, `histOiUsd`, `deltasFenetre` (Task 2) ; `fetchWatchlistOvernight` (`data/brief.ts:444`, `LigneWatchlist = { symbole, prix, variation24h }`) ; `fetchEtfBrief` (`data/brief.ts:526`, `EtfBrief = { actif, disponible, total, jour }`) ; `chargerEmetteurs` (`data/macro/stablecoinsDetail.ts:122`, champs `mcapUsd`/`mcap7jUsd`).
- Produces: `regimeStore: StoreApi<RegimeState>` avec `RegimeState = { regime: Regime | null; chapeau: Chapeau | null; majTs: number | null }` ; `Chapeau = { nuitBtcPct, nuitEthPct, fundingBtcRate, fundingRef, dvolCourant, dvolDeltaPts, dvolRef, deltaOi24hPct, deltaOiRef }` (tous `| null`) ; `rafraichirRegime(): Promise<void>` ; `startRegimePolling(): () => void`. Consommés par Tasks 6 et 8.

- [ ] **Step 1 : implémenter `store/regime.ts`** (pas de pure nouvelle → pas de test dédié ; l'assemblage est de l'IO, couvert par le gate visuel)

```ts
/**
 * Régime de marché : assemble les entrées du score composite (data/regime.ts)
 * depuis les caches TTL 1 h de data/referentiels.ts + fetchers existants,
 * toutes en Promise.allSettled (une source en échec → composant null).
 * Poller 15 min (pattern startMacroHistoryPolling), démarré dans main.tsx.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { calculerRegime, type Regime } from "../data/regime";
import { rangPercentile, referentiel, type Referentiel, type PointSerie } from "../lib/referentiel";
import { deltasFenetre, histDvol, histFearGreed, histFunding, histOiUsd } from "../data/referentiels";
import { fetchEtfBrief, fetchWatchlistOvernight } from "../data/brief";
import { chargerEmetteurs } from "../data/macro/stablecoinsDetail";

/** Données « courantes » du chapeau BRIEF (dérivées du même rafraîchissement). */
export interface Chapeau {
  nuitBtcPct: number | null;
  nuitEthPct: number | null;
  /** Fear & Greed courant 0..100 (dernier point de l'historique). */
  fearGreed: number | null;
  /** Dernier funding réglé BTC, en fraction. */
  fundingBtcRate: number | null;
  fundingRef: Referentiel | null;
  dvolCourant: number | null;
  /** Δ DVOL vs veille, en points. */
  dvolDeltaPts: number | null;
  dvolRef: Referentiel | null;
  /** ΔOI BTC ~24 h en %. */
  deltaOi24hPct: number | null;
  deltaOiRef: Referentiel | null;
}

export interface RegimeState {
  regime: Regime | null;
  chapeau: Chapeau | null;
  majTs: number | null;
}

export const regimeStore: StoreApi<RegimeState> = createStore<RegimeState>(() => ({
  regime: null,
  chapeau: null,
  majTs: null,
}));

const JOUR_MS = 86_400_000;
const POLL_MS = 15 * 60_000;

function dernier(serie: PointSerie[] | null): number | null {
  const p = serie?.[serie.length - 1];
  return p !== undefined && Number.isFinite(p.v) ? p.v : null;
}

/** Percentile de la dernière valeur dans sa propre série (null si réf. en construction). */
function percentileCourant(serie: PointSerie[] | null, now: number): number | null {
  const v = dernier(serie);
  if (serie === null || v === null) return null;
  const ref = referentiel(serie, v, now);
  return ref === null ? null : ref.percentile;
}

export async function rafraichirRegime(): Promise<void> {
  const now = Date.now();
  const [tickers, fg, funding, dvol, oi, etf, emetteurs] = await Promise.allSettled([
    fetchWatchlistOvernight(["BTCUSDT", "ETHUSDT"]),
    histFearGreed(),
    histFunding("BTCUSDT"),
    histDvol("BTC"),
    histOiUsd("BTCUSDT"),
    fetchEtfBrief(),
    chargerEmetteurs(),
  ]);

  const lignes = tickers.status === "fulfilled" ? tickers.value : [];
  const nuitBtcPct = lignes.find((l) => l.symbole === "BTCUSDT")?.variation24h ?? null;
  const nuitEthPct = lignes.find((l) => l.symbole === "ETHUSDT")?.variation24h ?? null;

  const serieFg = fg.status === "fulfilled" ? fg.value : null;
  const serieFunding = funding.status === "fulfilled" ? funding.value : null;
  const serieDvol = dvol.status === "fulfilled" ? dvol.value : null;
  const serieOi = oi.status === "fulfilled" ? oi.value : null;

  const fundingBtcRate = dernier(serieFunding);
  const fundingRef =
    serieFunding !== null && fundingBtcRate !== null
      ? referentiel(serieFunding, fundingBtcRate, now)
      : null;

  const dvolCourant = dernier(serieDvol);
  const avantDernierDvol = serieDvol?.[serieDvol.length - 2]?.v ?? null;
  const dvolDeltaPts =
    dvolCourant !== null && avantDernierDvol !== null ? dvolCourant - avantDernierDvol : null;
  const dvolRef =
    serieDvol !== null && dvolCourant !== null ? referentiel(serieDvol, dvolCourant, now) : null;

  const deltas24h = serieOi !== null ? deltasFenetre(serieOi, JOUR_MS) : [];
  const deltaOi24hPct = dernier(deltas24h.length > 0 ? deltas24h : null);
  const deltaOiRef =
    deltas24h.length > 0 && deltaOi24hPct !== null
      ? referentiel(deltas24h, deltaOi24hPct, now)
      : null;

  let fluxEtfJourUsd: number | null = null;
  if (etf.status === "fulfilled") {
    const dispo = etf.value.filter((e) => e.disponible && e.total !== null);
    if (dispo.length > 0) fluxEtfJourUsd = dispo.reduce((s, e) => s + (e.total ?? 0), 0);
  }

  let impressionStablecoins7jPct: number | null = null;
  if (emetteurs.status === "fulfilled") {
    let tot = 0;
    let tot7 = 0;
    for (const e of emetteurs.value) {
      if (e.mcap7jUsd !== null && Number.isFinite(e.mcap7jUsd) && e.mcap7jUsd > 0) {
        tot += e.mcapUsd;
        tot7 += e.mcap7jUsd;
      }
    }
    if (tot7 > 0) impressionStablecoins7jPct = (tot / tot7 - 1) * 100;
  }

  const regime = calculerRegime({
    directionBtc24hPct: nuitBtcPct,
    fearGreed: dernier(serieFg),
    fundingBtcPercentile: percentileCourant(serieFunding, now),
    dvolBtcPercentile: percentileCourant(serieDvol, now),
    fluxEtfJourUsd,
    impressionStablecoins7jPct,
  });

  regimeStore.setState({
    regime,
    chapeau: {
      nuitBtcPct,
      nuitEthPct,
      fearGreed: dernier(serieFg),
      fundingBtcRate,
      fundingRef,
      dvolCourant,
      dvolDeltaPts,
      dvolRef,
      deltaOi24hPct,
      deltaOiRef,
    },
    majTs: now,
  });
}

/**
 * Démarre le rafraîchissement (immédiat puis toutes les 15 min — léger : les
 * historiques sont sous cache TTL 1 h, seules les valeurs courantes se re-fetchent).
 * Appelé une fois au boot (main.tsx). Renvoie une fonction d'arrêt.
 */
export function startRegimePolling(): () => void {
  void rafraichirRegime().catch(() => undefined);
  const timer = setInterval(() => void rafraichirRegime().catch(() => undefined), POLL_MS);
  return () => clearInterval(timer);
}
```

Dans `main.tsx`, après la ligne `startMacroHistoryPolling();` :

```ts
import { startRegimePolling } from "./store/regime";
// Score de régime composite (pastille SessionStrip + chapeau BRIEF) : tick 15 min,
// les historiques sous-jacents sont cachés 1 h (data/referentiels.ts).
startRegimePolling();
```

(l'import remonte en tête de fichier avec les autres imports ; le commentaire reste au point d'appel.)

- [ ] **Step 2 : vérifier** — `pnpm --filter @axiom/web typecheck` puis `pnpm --filter @axiom/web test` (rien de cassé) et `pnpm --filter @axiom/web build`.

- [ ] **Step 3 : commit**

```bash
git add apps/web/src/store/regime.ts apps/web/src/main.tsx
git commit -m "feat(regime): store + poller 15 min branché au boot (Lot B2)"
```

### Task 6 : pastille REGIME dans SessionStrip

**Files:**
- Modify: `apps/web/src/components/SessionStrip.tsx` (imports l.13-26 ; 4ᵉ groupe après le groupe Santé l.158-165)

**Interfaces:**
- Consumes: `regimeStore` (Task 5), `tonRegime` (Task 4), `windowManagerStore` (`store/windowManager.ts`), `useStore` (déjà importé), `formatDec` (`lib/format.ts`).
- Produces: pastille permanente `◆ RISK-ON +0.8` cliquable → fenêtre BRIEF.

- [ ] **Step 1 : implémenter**

Imports à ajouter :

```tsx
import { regimeStore } from "../store/regime";
import { tonRegime } from "../data/regime";
import { windowManagerStore } from "../store/windowManager";
import { formatDec } from "../lib/format";
```

(vérifier : `formatUsd` est déjà importé de `../lib/format` — fusionner en `import { formatDec, formatUsd } from "../lib/format";`.)

Dans le corps du composant (avec les autres hooks) :

```tsx
const regime = useStore(regimeStore, (s) => s.regime);
```

Après le groupe Santé (l.165, juste avant le `</div>` de fermeture du bandeau), ajouter :

```tsx
      <span aria-hidden className="text-border">
        |
      </span>

      {/* Régime de marché composite (data/regime.ts) — clic : détail dans le BRIEF. */}
      <button
        type="button"
        onClick={() => windowManagerStore.getState().openWindow("brief")}
        title={
          regime === null
            ? "Régime de marché : en cours de calcul…"
            : regime.composants.map((c) => c.detail).join(" · ")
        }
        className="flex items-center gap-1.5 transition hover:text-text"
      >
        <span
          aria-hidden
          className={
            regime === null || tonRegime(regime.libelle) === "neutre"
              ? "text-text-dim"
              : tonRegime(regime.libelle) === "up"
                ? "text-up"
                : "text-down"
          }
        >
          ◆
        </span>
        <span className="uppercase tracking-[0.08em]">
          {regime === null || regime.libelle === "indéterminé" ? "Régime —" : regime.libelle}
        </span>
        {regime !== null && regime.libelle !== "indéterminé" && (
          <span className="tabular-nums">
            {regime.score >= 0 ? "+" : ""}
            {formatDec(regime.score, 1)}
          </span>
        )}
      </button>
```

- [ ] **Step 2 : vérifier** — `typecheck` + `test` + `build` verts. Gate visuel différé à la Task 18 (3 états : indéterminé au boot, risk-on/off une fois calculé, title = détail composants).

- [ ] **Step 3 : commit**

```bash
git add apps/web/src/components/SessionStrip.tsx
git commit -m "feat(regime): pastille permanente SessionStrip, clic vers le BRIEF (Lot B2)"
```

---

## Phase B3 — BRIEF : chapeau interprété (H16)

### Task 7 : `data/lecturesBrief.ts` — phrases factuelles générées

**Files:**
- Create: `apps/web/src/data/lecturesBrief.ts`
- Test: `apps/web/src/data/lecturesBrief.test.ts`

**Interfaces:**
- Consumes: rien (pur).
- Produces: `EntreesLecture` (champs `number | null`), `lectures(entrees: EntreesLecture): string[]` (1 à 3 phrases max, `[]` si tout absent). Consommé par Task 8.

- [ ] **Step 1 : tests (rouges)**

`apps/web/src/data/lecturesBrief.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { lectures, type EntreesLecture } from "./lecturesBrief";

const VIDE: EntreesLecture = {
  nuitBtcPct: null,
  fundingPercentile: null,
  dvolPercentile: null,
  deltaOi24hPct: null,
  fearGreed: null,
};

describe("lectures", () => {
  it("tout absent → aucune phrase", () => {
    expect(lectures(VIDE)).toEqual([]);
  });
  it("phrase de contexte : nuit + funding + vol", () => {
    const l = lectures({
      ...VIDE,
      nuitBtcPct: -2.1,
      fundingPercentile: 48,
      dvolPercentile: 81,
    });
    expect(l[0]).toBe("Nuit baissière (BTC −2.1%), funding neutre (p48), vol élevée (p81).");
  });
  it("nuit seule, haussière puis calme", () => {
    expect(lectures({ ...VIDE, nuitBtcPct: 1.4 })[0]).toBe("Nuit haussière (BTC +1.4%).");
    expect(lectures({ ...VIDE, nuitBtcPct: 0.2 })[0]).toBe("Nuit calme (BTC +0.2%).");
  });
  it("positionnement long tendu : funding ≥ p90 ET ΔOI ≥ +3 %", () => {
    const l = lectures({ ...VIDE, fundingPercentile: 95, deltaOi24hPct: 6 });
    expect(l).toContain("Funding p95 avec ΔOI +6.0% sur 24 h : positionnement long tendu.");
    // Sous le seuil, pas de phrase de positionnement.
    expect(lectures({ ...VIDE, fundingPercentile: 95, deltaOi24hPct: 1 })).toHaveLength(1);
  });
  it("sentiment aux extrêmes seulement", () => {
    expect(lectures({ ...VIDE, fearGreed: 80 })).toEqual(["Sentiment en zone avidité (F&G 80)."]);
    expect(lectures({ ...VIDE, fearGreed: 20 })).toEqual(["Sentiment en zone peur (F&G 20)."]);
    expect(lectures({ ...VIDE, fearGreed: 50 })).toEqual([]);
  });
  it("plafond : 3 phrases max, jamais de vocabulaire prescriptif", () => {
    const l = lectures({
      nuitBtcPct: -4,
      fundingPercentile: 95,
      dvolPercentile: 90,
      deltaOi24hPct: 8,
      fearGreed: 12,
    });
    expect(l.length).toBeLessThanOrEqual(3);
    for (const phrase of l) {
      expect(phrase.toLowerCase()).not.toMatch(/acheter|vendre|long |short |conseil/);
    }
  });
});
```

- [ ] **Step 2 : vérifier l'échec** — `pnpm --filter @axiom/web test -- lecturesBrief` → FAIL.

- [ ] **Step 3 : implémenter `data/lecturesBrief.ts`**

```ts
/**
 * Lecture générée du BRIEF : 1 à 3 phrases FACTUELLES à seuils, à partir des
 * mêmes entrées que le régime (+ ΔOI). Jamais prescriptif — on décrit
 * l'environnement, on ne recommande rien (BUILD-CONTRACT).
 */
import { formatPct } from "../lib/format";

export interface EntreesLecture {
  nuitBtcPct: number | null;
  /** Percentile 0..100 du funding BTC vs ~90 j. */
  fundingPercentile: number | null;
  /** Percentile 0..100 du DVOL BTC vs 90 j. */
  dvolPercentile: number | null;
  deltaOi24hPct: number | null;
  fearGreed: number | null;
}

const MAX_PHRASES = 3;

function clauseNuit(pct: number): string {
  const dir = pct >= 1 ? "haussière" : pct <= -1 ? "baissière" : "calme";
  return `Nuit ${dir} (BTC ${formatPct(pct, 1)})`;
}

function clauseFunding(p: number): string {
  const etat = p >= 90 ? "tendu" : p <= 10 ? "déprimé" : "neutre";
  return `funding ${etat} (p${Math.round(p)})`;
}

function clauseVol(p: number): string {
  const etat = p >= 75 ? "élevée" : p <= 25 ? "basse" : "moyenne";
  return `vol ${etat} (p${Math.round(p)})`;
}

export function lectures(entrees: EntreesLecture): string[] {
  const out: string[] = [];

  // 1. Contexte : nuit (+ funding + vol si disponibles), ancrée sur la nuit.
  if (entrees.nuitBtcPct !== null && Number.isFinite(entrees.nuitBtcPct)) {
    const clauses = [clauseNuit(entrees.nuitBtcPct)];
    if (entrees.fundingPercentile !== null) clauses.push(clauseFunding(entrees.fundingPercentile));
    if (entrees.dvolPercentile !== null) clauses.push(clauseVol(entrees.dvolPercentile));
    out.push(`${clauses.join(", ")}.`);
  }

  // 2. Positionnement : funding extrême haut + OI en expansion.
  if (
    entrees.fundingPercentile !== null &&
    entrees.fundingPercentile >= 90 &&
    entrees.deltaOi24hPct !== null &&
    entrees.deltaOi24hPct >= 3
  ) {
    out.push(
      `Funding p${Math.round(entrees.fundingPercentile)} avec ΔOI ${formatPct(entrees.deltaOi24hPct, 1)} sur 24 h : positionnement long tendu.`,
    );
  }

  // 3. Sentiment : extrêmes Fear & Greed seulement.
  if (entrees.fearGreed !== null && Number.isFinite(entrees.fearGreed)) {
    if (entrees.fearGreed >= 75) out.push(`Sentiment en zone avidité (F&G ${Math.round(entrees.fearGreed)}).`);
    else if (entrees.fearGreed <= 25) out.push(`Sentiment en zone peur (F&G ${Math.round(entrees.fearGreed)}).`);
  }

  return out.slice(0, MAX_PHRASES);
}
```

⚠️ `formatPct` rend « −2.1% » avec le MOINS TYPOGRAPHIQUE U+2212 (`−`, standard `lib/format`) — les chaînes attendues des tests du Step 1 utilisent bien U+2212, pas le tiret ASCII. Vérifier l'implémentation réelle de `formatPct` avant d'ajuster les attendus.

- [ ] **Step 4 : vérifier le vert** — `pnpm --filter @axiom/web test -- lecturesBrief` → PASS ; `typecheck`.

- [ ] **Step 5 : commit**

```bash
git add apps/web/src/data/lecturesBrief.ts apps/web/src/data/lecturesBrief.test.ts
git commit -m "feat(brief): lecture générée factuelle à seuils (Lot B3)"
```

### Task 8 : chapeau du BRIEF + export markdown

**Files:**
- Modify: `apps/web/src/components/BriefWindow.tsx` (imports l.28-46 ; chapeau inséré au début du corps scrollable l.305, AVANT la section « 0) Review de session » ; `exporterVersNotes` l.255-280)
- Modify: `apps/web/src/data/brief.ts` (`briefEnMarkdown` l.297 : paramètre optionnel `lecture`)
- Test: `apps/web/src/data/brief.test.ts` (étendre le test existant de `briefEnMarkdown` — s'il n'existe pas, créer le cas minimal ci-dessous)

**Interfaces:**
- Consumes: `regimeStore`, `type Chapeau` (Task 5) ; `tonRegime` (Task 4) ; `lectures` (Task 7) ; `RefBadge` (Task 3) ; `Metric` (ui.tsx) ; `formatPct`, `formatFunding`, `formatDec`, `formatPourcentage` (lib/format).
- Produces: `briefEnMarkdown(d, now, lecture?: readonly string[])` — section `## Lecture` en tête quand `lecture` non vide.

- [ ] **Step 1 : test markdown (rouge)**

Dans `apps/web/src/data/brief.test.ts`, ajouter :

```ts
describe("briefEnMarkdown — section Lecture", () => {
  it("insère ## Lecture en tête quand des phrases sont fournies", () => {
    const md = briefEnMarkdown(donneesMinimales(), 1_700_000_000_000, [
      "Nuit calme (BTC +0.2%).",
    ]);
    const iLecture = md.indexOf("## Lecture");
    const iSession = md.indexOf("## Session");
    expect(iLecture).toBeGreaterThan(-1);
    expect(iLecture).toBeLessThan(iSession);
    expect(md).toContain("Nuit calme (BTC +0.2%).");
  });
  it("aucune section quand lecture absente ou vide", () => {
    expect(briefEnMarkdown(donneesMinimales(), 1_700_000_000_000)).not.toContain("## Lecture");
    expect(briefEnMarkdown(donneesMinimales(), 1_700_000_000_000, [])).not.toContain("## Lecture");
  });
});
```

(`donneesMinimales()` : réutiliser la fabrique du test existant de `briefEnMarkdown` s'il y en a une ; sinon construire un `DonneesBrief` minimal avec toutes les sections `null`/vides conformes au type.)

- [ ] **Step 2 : vérifier l'échec** — `pnpm --filter @axiom/web test -- brief` → FAIL (3ᵉ argument inconnu).

- [ ] **Step 3 : implémenter**

Dans `data/brief.ts`, `briefEnMarkdown` :

```ts
export function briefEnMarkdown(
  d: DonneesBrief,
  now: number,
  lecture?: readonly string[],
): string {
```

et juste après le `push` du titre `# BRIEF — …` :

```ts
  // Lecture générée (chapeau) — en tête, avant les sections factuelles.
  if (lecture !== undefined && lecture.length > 0) {
    l.push("");
    l.push("## Lecture");
    l.push("");
    for (const phrase of lecture) l.push(`- ${phrase}`);
  }
```

Dans `BriefWindow.tsx` :

Imports à ajouter :

```tsx
import { regimeStore } from "../store/regime";
import { tonRegime } from "../data/regime";
import { lectures } from "../data/lecturesBrief";
import { RefBadge } from "./ui";
```

(fusionner avec les imports ui.tsx/format existants ; `formatFunding`, `formatPct`, `formatDec` — vérifier lesquels sont déjà importés et compléter.)

Dans le corps du composant :

```tsx
  const regime = useStore(regimeStore, (s) => s.regime);
  const chapeau = useStore(regimeStore, (s) => s.chapeau);

  const phrasesLecture = useMemo(() => {
    if (chapeau === null) return [];
    return lectures({
      nuitBtcPct: chapeau.nuitBtcPct,
      fundingPercentile: chapeau.fundingRef?.percentile ?? null,
      dvolPercentile: chapeau.dvolRef?.percentile ?? null,
      deltaOi24hPct: chapeau.deltaOi24hPct,
      fearGreed: chapeau.fearGreed,
    });
  }, [chapeau]);
```

(le chapeau est AUTONOME : toutes ses entrées viennent du store regime — aucune dépendance aux states des sections de la fenêtre, qui peuvent être en erreur indépendamment.)

Chapeau JSX, inséré en tête du corps scrollable (l.305), AVANT le commentaire `{/* 0) Review de session … */}` :

```tsx
        {/* Chapeau interprété (H16) : régime + nuit + funding + vol, puis lecture générée. */}
        <section className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric
              label="Régime"
              value={
                regime === null || regime.libelle === "indéterminé"
                  ? "—"
                  : `${regime.libelle} ${regime.score >= 0 ? "+" : ""}${formatDec(regime.score, 1)}`
              }
              couleur={
                regime === null
                  ? undefined
                  : tonRegime(regime.libelle) === "up"
                    ? "var(--up)"
                    : tonRegime(regime.libelle) === "down"
                      ? "var(--down)"
                      : undefined
              }
            />
            <Metric
              label="Nuit"
              value={chapeau?.nuitBtcPct !== null && chapeau !== null ? formatPct(chapeau.nuitBtcPct, 1) : "—"}
              couleur={
                chapeau?.nuitBtcPct != null
                  ? chapeau.nuitBtcPct >= 0
                    ? "var(--up)"
                    : "var(--down)"
                  : undefined
              }
              extra={
                chapeau?.nuitEthPct != null ? (
                  <span className="text-[10px] tabular-nums text-text-dim">ETH {formatPct(chapeau.nuitEthPct, 1)}</span>
                ) : undefined
              }
            />
            <Metric
              label="Funding BTC"
              value={formatFunding(chapeau?.fundingBtcRate)}
              labelExtra={<RefBadge referentiel={chapeau?.fundingRef ?? null} sens="hausse-chaud" />}
            />
            <Metric
              label="Vol (DVOL)"
              value={chapeau?.dvolCourant != null ? formatPourcentage(chapeau.dvolCourant, 1) : "—"}
              couleur={
                chapeau?.dvolDeltaPts != null
                  ? chapeau.dvolDeltaPts >= 0
                    ? "var(--down)"
                    : "var(--up)"
                  : undefined
              }
              extra={
                chapeau?.dvolDeltaPts != null ? (
                  <span className="text-[10px] tabular-nums text-text-dim">
                    {chapeau.dvolDeltaPts >= 0 ? "+" : ""}
                    {formatDec(chapeau.dvolDeltaPts, 1)} pts vs veille
                  </span>
                ) : undefined
              }
            />
          </div>
          {phrasesLecture.length > 0 && (
            <p className="text-[12px] leading-snug text-text">{phrasesLecture.join(" ")}</p>
          )}
        </section>
```

(Convention couleur Vol : DVOL en HAUSSE = stress → `--down` ; en baisse → `--up`. La documenter en commentaire au-dessus de la Metric.)

Dans `exporterVersNotes` (l.255-280), passer les phrases : `briefEnMarkdown(donnees, now, phrasesLecture)`.

- [ ] **Step 4 : vérifier le vert** — `pnpm --filter @axiom/web test -- brief` → PASS ; `typecheck` ; `build`.

- [ ] **Step 5 : commit**

```bash
git add apps/web/src/components/BriefWindow.tsx apps/web/src/data/brief.ts apps/web/src/data/brief.test.ts
git commit -m "feat(brief): chapeau interprété (régime/nuit/funding/vol + lecture) et export markdown (Lot B3)"
```

---

## Phase B4 — Fenêtres : le chiffre devient lecture

### Task 9 : DerivativesWindow — APR + référentiel funding (H18)

**Files:**
- Modify: `apps/web/src/components/DerivativesWindow.tsx` (imports ; sous la `Metric` Funding l.442-452)

**Interfaces:**
- Consumes: `annualiserFunding` (`data/fundingCrossExchange.ts:34`) ; `histFunding` (Task 2) ; `referentiel`, `type Referentiel` (Task 1) ; `RefBadge` (Task 3) ; `formatPct`. Le taux `funding?.rate` est une FRACTION.

- [ ] **Step 1 : implémenter**

Imports à ajouter :

```tsx
import { annualiserFunding } from "../data/fundingCrossExchange";
import { histFunding } from "../data/referentiels";
import { referentiel, type Referentiel } from "../lib/referentiel";
import { RefBadge } from "./ui";
```

State + effet (près des autres states, l.210) :

```tsx
  // Référentiel du funding : historique ~90 j (cache 1 h), situe le taux courant.
  const [refFunding, setRefFunding] = useState<Referentiel | null>(null);
  useEffect(() => {
    let vivant = true;
    setRefFunding(null);
    const rate = funding?.rate;
    if (rate === undefined || !Number.isFinite(rate)) return undefined;
    void histFunding(symbol).then((serie) => {
      if (!vivant || serie === null) return;
      setRefFunding(referentiel(serie, rate, Date.now()));
    });
    return () => {
      vivant = false;
    };
  }, [symbol, funding?.rate]);
```

Sous la `Metric` Funding (après l.452, avant le bloc « Funding prédit ») :

```tsx
                {funding !== undefined && Number.isFinite(funding.rate) && (
                  <div className="flex items-center gap-2 px-3 text-[11px] tabular-nums text-text-dim">
                    <span>APR {formatPct(annualiserFunding(funding.rate, 8), 2)}</span>
                    <RefBadge referentiel={refFunding} sens="hausse-chaud" />
                  </div>
                )}
```

(la couleur par signe RESTE sur le taux de la Metric ; l'extrême vit dans le badge — pas de double signal.)

- [ ] **Step 2 : vérifier** — `typecheck` + `test` + `build` verts.

- [ ] **Step 3 : commit**

```bash
git add apps/web/src/components/DerivativesWindow.tsx
git commit -m "feat(deriv): ligne APR + badge de référentiel sous le funding (Lot B4, H18)"
```

### Task 10 : `lib/zonesOnchain.ts` + badges de zone OnchainWindow (H17)

**Files:**
- Create: `apps/web/src/lib/zonesOnchain.ts`
- Test: `apps/web/src/lib/zonesOnchain.test.ts`
- Modify: `apps/web/src/components/OnchainWindow.tsx` (`Widget` l.189-236 : slot `badge` ; boucle `BG_METRIQUES` l.452-467 ; note du bloc l.487)

**Interfaces:**
- Consumes: `TonBadge` (étendu Task 3), `Badge`, `NoteSource` (ui.tsx) ; ids `BG_METRIQUES` : `"mvrv"` (= MVRV **Z-Score**), `"sopr"`, `"nupl"`.
- Produces: `ZoneOnchain { libelle: string; ton: TonBadge }`, `zoneMvrvZ(v)`, `zoneSopr(v)`, `zoneNupl(v)` (chacune `ZoneOnchain | null`, null si `v` non fini), `zonePourMetrique(id: string, v: number | null | undefined): ZoneOnchain | null` (routeur, ids inconnus → null).

- [ ] **Step 1 : tests (rouges)**

`apps/web/src/lib/zonesOnchain.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { zoneMvrvZ, zoneNupl, zonePourMetrique, zoneSopr } from "./zonesOnchain";

describe("zoneMvrvZ", () => {
  it("froid / neutre / chaud / surchauffe", () => {
    expect(zoneMvrvZ(-0.5)).toEqual({ libelle: "froid", ton: "up" });
    expect(zoneMvrvZ(1.5)).toEqual({ libelle: "neutre", ton: "neutre" });
    expect(zoneMvrvZ(3)).toEqual({ libelle: "chaud", ton: "warn" });
    expect(zoneMvrvZ(7)).toEqual({ libelle: "surchauffe", ton: "down" });
  });
});

describe("zoneSopr", () => {
  it("pivot à 1", () => {
    expect(zoneSopr(0.98)).toEqual({ libelle: "capitulation", ton: "down" });
    expect(zoneSopr(1.01)).toEqual({ libelle: "profit", ton: "neutre" });
  });
});

describe("zoneNupl", () => {
  it("5 zones canoniques", () => {
    expect(zoneNupl(-0.1)).toEqual({ libelle: "capitulation", ton: "down" });
    expect(zoneNupl(0.1)).toEqual({ libelle: "espoir", ton: "neutre" });
    expect(zoneNupl(0.3)).toEqual({ libelle: "optimisme", ton: "neutre" });
    expect(zoneNupl(0.6)).toEqual({ libelle: "croyance", ton: "warn" });
    expect(zoneNupl(0.8)).toEqual({ libelle: "euphorie", ton: "down" });
  });
});

describe("zonePourMetrique", () => {
  it("route par id BG et rejette l'inconnu / non fini", () => {
    expect(zonePourMetrique("mvrv", 3.5)?.libelle).toBe("chaud");
    expect(zonePourMetrique("sopr", 0.9)?.libelle).toBe("capitulation");
    expect(zonePourMetrique("nupl", 0.8)?.libelle).toBe("euphorie");
    expect(zonePourMetrique("puell", 1)).toBeNull();
    expect(zonePourMetrique("mvrv", Number.NaN)).toBeNull();
    expect(zonePourMetrique("mvrv", null)).toBeNull();
  });
});
```

- [ ] **Step 2 : vérifier l'échec** — `pnpm --filter @axiom/web test -- zonesOnchain` → FAIL.

- [ ] **Step 3 : implémenter `lib/zonesOnchain.ts`**

```ts
/**
 * Zones interprétées des métriques de cycle on-chain (seuils canoniques
 * Glassnode/bitcoin-data, documentés dans la NoteSource de CHAIN).
 * Pur — les valeurs viennent des aux bitcoin-data déjà câblés.
 */
import type { TonBadge } from "../components/ui";

export interface ZoneOnchain {
  libelle: string;
  ton: TonBadge;
}

/** MVRV Z-Score : < 0 froid · 0..3 neutre · 3..7 chaud · ≥ 7 surchauffe. */
export function zoneMvrvZ(v: number): ZoneOnchain | null {
  if (!Number.isFinite(v)) return null;
  if (v < 0) return { libelle: "froid", ton: "up" };
  if (v < 3) return { libelle: "neutre", ton: "neutre" };
  if (v < 7) return { libelle: "chaud", ton: "warn" };
  return { libelle: "surchauffe", ton: "down" };
}

/** SOPR : pivot 1 — < 1 ventes à perte (capitulation), ≥ 1 ventes en profit. */
export function zoneSopr(v: number): ZoneOnchain | null {
  if (!Number.isFinite(v)) return null;
  return v < 1 ? { libelle: "capitulation", ton: "down" } : { libelle: "profit", ton: "neutre" };
}

/** NUPL : < 0 capitulation · 0..0.25 espoir · 0.25..0.5 optimisme · 0.5..0.75 croyance · ≥ 0.75 euphorie. */
export function zoneNupl(v: number): ZoneOnchain | null {
  if (!Number.isFinite(v)) return null;
  if (v < 0) return { libelle: "capitulation", ton: "down" };
  if (v < 0.25) return { libelle: "espoir", ton: "neutre" };
  if (v < 0.5) return { libelle: "optimisme", ton: "neutre" };
  if (v < 0.75) return { libelle: "croyance", ton: "warn" };
  return { libelle: "euphorie", ton: "down" };
}

/** Routeur par id BG_METRIQUES (« mvrv » = MVRV Z-Score) ; ids sans zone → null. */
export function zonePourMetrique(id: string, v: number | null | undefined): ZoneOnchain | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  if (id === "mvrv") return zoneMvrvZ(v);
  if (id === "sopr") return zoneSopr(v);
  if (id === "nupl") return zoneNupl(v);
  return null;
}
```

- [ ] **Step 4 : câbler OnchainWindow**

`Widget` (l.189-236) gagne un prop optionnel `badge?: ReactNode`, rendu entre le libellé et `BadgeFiabilite` :

```tsx
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-text-dim">{libelle}</span>
        <span className="flex shrink-0 items-center gap-1">
          {badge}
          <BadgeFiabilite meta={meta} />
        </span>
      </div>
```

Dans la boucle `BG_METRIQUES` (l.452-467) :

```tsx
              const zone = zonePourMetrique(def.id, r?.serie.dernier?.value);
              return (
                <Widget
                  key={def.id}
                  badge={zone !== null ? <Badge ton={zone.ton}>{zone.libelle}</Badge> : undefined}
                  ...
```

(imports : `zonePourMetrique` de `../lib/zonesOnchain`, `Badge` de `./ui` — vérifier s'il est déjà importé.)

Sous le bloc valorisation (près du `<p>` conditionnel l.487), ajouter une `NoteSource` PERMANENTE :

```tsx
          <NoteSource>
            Zones : MVRV-Z &lt; 0 froid · ≥ 3 chaud · ≥ 7 surchauffe ; SOPR &lt; 1 capitulation ;
            NUPL ≥ 0.5 croyance · ≥ 0.75 euphorie. Seuils canoniques, source bitcoin-data.com.
          </NoteSource>
```

- [ ] **Step 5 : vérifier le vert** — `pnpm --filter @axiom/web test -- zonesOnchain` → PASS ; `typecheck` ; `build` ; suite complète.

- [ ] **Step 6 : commit**

```bash
git add apps/web/src/lib/zonesOnchain.ts apps/web/src/lib/zonesOnchain.test.ts apps/web/src/components/OnchainWindow.tsx
git commit -m "feat(chain): badges de zone MVRV-Z/SOPR/NUPL avec seuils documentés (Lot B4, H17)"
```

### Task 11 : LiquidationsWindow — baseline USD/heure

**Files:**
- Modify: `apps/web/src/components/LiquidationsWindow.tsx` (`ContenuLive` : state + ligne sous le bloc totaux l.557-562)

**Interfaces:**
- Consumes: `histLiqParHeure` (Task 2) ; `referentiel`, `type PointSerie` (Task 1) ; `RefBadge` (Task 3) ; `statsLiquidations`, `filtrerFenetre` (util existant) ; `formatUsd`.

- [ ] **Step 1 : implémenter**

Dans `ContenuLive`, state + effet (le symbole vient de `marketStore`, l.478) :

```tsx
  // Baseline : USD liquidé/heure sur 30 j (daemon). Null si daemon absent → pas de badge.
  const [serieHeure, setSerieHeure] = useState<PointSerie[] | null>(null);
  useEffect(() => {
    let vivant = true;
    setSerieHeure(null);
    void histLiqParHeure(symbol).then((s) => {
      if (vivant) setSerieHeure(s);
    });
    return () => {
      vivant = false;
    };
  }, [symbol]);
```

Total 1 h + référentiel, dans le `useMemo` existant (l.508-527) ou un `useMemo` dédié :

```tsx
  const baseline = useMemo(() => {
    if (serieHeure === null) return null;
    const nowMs = Date.now();
    const reels = liqEventsStore.getState().events.filter((ev) => ev.approx !== true);
    const total1h = statsLiquidations(filtrerFenetre(reels, nowMs - 3_600_000)).total;
    return { total1h, ref: referentiel(serieHeure, total1h, nowMs) };
  }, [serieHeure, rev, horloge, symbol]);
```

Sous le bloc totaux (après la grille `Metric` l.559-562, dans le même `div` fixe) :

```tsx
        {baseline !== null && (
          <div className="mt-2 flex items-center gap-2 text-[11px] tabular-nums text-text-dim">
            <span>1 h : {formatUsd(baseline.total1h)}</span>
            <RefBadge referentiel={baseline.ref} sens="hausse-chaud" />
          </div>
        )}
```

(daemon absent → `serieHeure === null` → RIEN ne s'affiche, conforme spec. Imports : `histLiqParHeure`, `referentiel`, `type PointSerie`, `RefBadge` — `statsLiquidations`/`filtrerFenetre`/`formatUsd` sont déjà importés.)

- [ ] **Step 2 : vérifier** — `typecheck` + `test` + `build` verts.

- [ ] **Step 3 : commit**

```bash
git add apps/web/src/components/LiquidationsWindow.tsx
git commit -m "feat(liq): baseline USD/heure vs 30 j daemon sous les totaux Live (Lot B4)"
```

### Task 12 : `lib/extremesColonne.ts` + extrêmes cross-sectionnels du Screener

**Files:**
- Create: `apps/web/src/lib/extremesColonne.ts`
- Test: `apps/web/src/lib/extremesColonne.test.ts`
- Modify: `apps/web/src/components/ScreenerWindow.tsx` (cellules funding/ΔOI l.493-515 ; légende après la liste des lignes ~l.531)

**Interfaces:**
- Consumes: `ScreenerRow` (`data/screener.ts:62` — `fundingPct?: number`, `oiChangePct?: number`) ; `NoteSource` (ui.tsx).
- Produces: `seuilDecile(valeurs: readonly number[], quantile: number): number | null` (null sous 10 valeurs finies) ; `estExtremeColonne(v: number | undefined, seuil: number | null): boolean`.

- [ ] **Step 1 : tests (rouges)**

`apps/web/src/lib/extremesColonne.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { estExtremeColonne, seuilDecile } from "./extremesColonne";

describe("seuilDecile", () => {
  it("valeur au rang ⌈q·n⌉−1 de la colonne triée (ABSOLUS gérés par l'appelant)", () => {
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(seuilDecile(vals, 0.9)).toBe(9);
  });
  it("null sous 10 valeurs finies", () => {
    expect(seuilDecile([1, 2, 3], 0.9)).toBeNull();
    expect(seuilDecile([1, 2, 3, 4, 5, 6, 7, 8, 9, Number.NaN], 0.9)).toBeNull();
  });
});

describe("estExtremeColonne", () => {
  it("|v| ≥ seuil, tolère undefined et seuil null", () => {
    expect(estExtremeColonne(9.5, 9)).toBe(true);
    expect(estExtremeColonne(-9.5, 9)).toBe(true);
    expect(estExtremeColonne(5, 9)).toBe(false);
    expect(estExtremeColonne(undefined, 9)).toBe(false);
    expect(estExtremeColonne(9.5, null)).toBe(false);
  });
});
```

- [ ] **Step 2 : vérifier l'échec** — `pnpm --filter @axiom/web test -- extremesColonne` → FAIL.

- [ ] **Step 3 : implémenter `lib/extremesColonne.ts`**

```ts
/**
 * Extrêmes cross-sectionnels d'une colonne du screener : seuil du 9e décile
 * de l'univers AFFICHÉ (pas d'historique — la comparaison est entre pairs).
 */

/** Seuil au quantile q (ex. 0.9) de la colonne. Null sous 10 valeurs finies. */
export function seuilDecile(valeurs: readonly number[], quantile: number): number | null {
  const finies = valeurs.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finies.length < 10) return null;
  const idx = Math.min(finies.length - 1, Math.max(0, Math.ceil(quantile * finies.length) - 1));
  return finies[idx] ?? null;
}

/** Une cellule est extrême si |v| atteint le seuil (calculé sur les |valeurs|). */
export function estExtremeColonne(v: number | undefined, seuil: number | null): boolean {
  if (v === undefined || seuil === null || !Number.isFinite(v)) return false;
  return Math.abs(v) >= seuil;
}
```

- [ ] **Step 4 : câbler ScreenerWindow**

Seuils dans un `useMemo` (près de `showPositionCols` l.261) — calculés sur les VALEURS ABSOLUES des lignes affichées (`sortedRows` — vérifier le nom exact de la liste effectivement rendue) :

```tsx
  // Extrêmes cross-sectionnels : 9e décile des |valeurs| de l'univers affiché.
  const seuils = useMemo(
    () => ({
      funding: seuilDecile(sortedRows.map((r) => Math.abs(r.fundingPct ?? Number.NaN)), 0.9),
      deltaOi: seuilDecile(sortedRows.map((r) => Math.abs(r.oiChangePct ?? Number.NaN)), 0.9),
    }),
    [sortedRows],
  );
```

Cellule funding (l.493-499) — l'extrême PREND LE PAS sur la couleur de signe :

```tsx
                  <span
                    className={`text-right tabular-nums ${
                      estExtremeColonne(r.fundingPct, seuils.funding)
                        ? "font-semibold text-warn"
                        : r.fundingPct === undefined
                          ? "text-text-dim"
                          : r.fundingPct >= 0
                            ? "text-up"
                            : "text-down"
                    }`}
                  >
```

Cellule ΔOI (l.502-511) : même transformation avec `r.oiChangePct` / `seuils.deltaOi`.

Légende après la liste des lignes (avant `</section>` l.531), seulement si un seuil existe :

```tsx
          {(seuils.funding !== null || seuils.deltaOi !== null) && (
            <NoteSource>
              En orange : 10 % les plus extrêmes de l'univers affiché (|funding|, |Δ OI|).
            </NoteSource>
          )}
```

- [ ] **Step 5 : vérifier le vert** — tests + `typecheck` + `build` ; le garde-fou anti-classes brutes reste vert (`text-warn` = classe thémée).

- [ ] **Step 6 : commit**

```bash
git add apps/web/src/lib/extremesColonne.ts apps/web/src/lib/extremesColonne.test.ts apps/web/src/components/ScreenerWindow.tsx
git commit -m "feat(eqs): surbrillance des extrêmes cross-sectionnels funding/ΔOI (Lot B4)"
```

### Task 13 : VolWindow — la synthèse 11px devient une rangée de Metric

**Files:**
- Modify: `apps/web/src/components/VolWindow.tsx` (synthèse l.343-362 ; en-tête l.364-373 ; corps l.375+)

**Interfaces:**
- Consumes: `Metric` (ui.tsx) ; `formatPourcentage`, `formatDec` (déjà importés) ; les valeurs `rvCourante`/`dvolCourant`/`z` déjà calculées localement.

- [ ] **Step 1 : implémenter**

Remplacer la construction de la CHAÎNE `synthese` (l.343-362) par un objet :

```tsx
  // Synthèse : RV30 · DVOL · VRP (IV − RV) · z-score RV30 — en tête du corps (H19 hiérarchie).
  let synthese: { rv: number | null; dvol: number | null; vrp: number | null; z: number | null } | null = null;
  if (statut === "ready" && data !== null) {
    // ... reprendre le calcul existant de rvCourante / dvolCourant / z tel quel ...
    synthese = {
      rv: rvCourante,
      dvol: dvolCourant,
      vrp: rvCourante !== null && dvolCourant !== null ? dvolCourant - rvCourante : null,
      z,
    };
  }
```

En-tête : SUPPRIMER le prop `actions` (l.370-372) — il garde `mnemo`/`titre`/`sousTitre` seulement.

En tête du corps (l.375, avant le canvas), quand `statut === "ready"` et `synthese !== null` :

```tsx
        {statut === "ready" && synthese !== null && (
          <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label={`RV${RV_WINDOW}`} value={synthese.rv !== null ? formatPourcentage(synthese.rv, 1) : "—"} />
            <Metric label="DVOL" value={synthese.dvol !== null ? formatPourcentage(synthese.dvol, 1) : "—"} />
            <Metric
              label="VRP"
              value={synthese.vrp !== null ? `${formatDec(synthese.vrp, 1)} pts` : "—"}
              couleur={synthese.vrp !== null ? (synthese.vrp >= 0 ? "var(--up)" : "var(--down)") : undefined}
            />
            <Metric label="z-score RV" value={synthese.z !== null ? formatDec(synthese.z, 2) : "—"} />
          </div>
        )}
```

⚠️ Le corps est `p-3` avec un canvas `h-full` : vérifier que la rangée ne casse pas la hauteur du canvas — passer le conteneur en `flex flex-col` et le canvas en `min-h-0 flex-1` si nécessaire (le canvas se redessine via son propre resize handling ; contrôle au gate visuel).

- [ ] **Step 2 : vérifier** — `typecheck` + `test` + `build` verts.

- [ ] **Step 3 : commit**

```bash
git add apps/web/src/components/VolWindow.tsx
git commit -m "feat(vol): synthèse promue en rangée de Metric en tête du corps (Lot B4, H19)"
```

### Task 14 : FundingMatrixWindow — écart en Metric + repères max/min

**Files:**
- Modify: `apps/web/src/components/FundingMatrixWindow.tsx` (sous-titre l.60-67 ; au-dessus de la table l.77 ; lignes venues l.86-98)

**Interfaces:**
- Consumes: `fundingSpreadApr` (déjà importé, l.13) ; `Metric`, `NoteSource` (ui.tsx) ; `formatPct` ; venues déjà triées par APR DÉCROISSANT (max = `venues[0]`, min = dernière).

- [ ] **Step 1 : implémenter**

1. RETIRER l'affichage de l'écart du sous-titre (l.60-67) — plus de doublon.
2. Au-dessus de la table (l.77) :

```tsx
        {spread !== null && (
          <Metric
            label="Écart CEX/DEX (APR)"
            value={formatPct(spread, 2, { signe: false })}
            couleur={spread >= 10 ? "var(--ui-amber)" : undefined}
          />
        )}
```

3. Repères max/min dans les lignes (l.86-98) — point `●` devant le label quand ≥ 2 venues :

```tsx
              {venues.map((v, i) => (
                <tr key={v.exchange} className="border-b border-border/50">
                  <td className="py-2 text-text">
                    {venues.length >= 2 && i === 0 && (
                      <span aria-hidden className="mr-1 text-up" title="APR le plus élevé">●</span>
                    )}
                    {venues.length >= 2 && i === venues.length - 1 && (
                      <span aria-hidden className="mr-1 text-down" title="APR le plus bas">●</span>
                    )}
                    {v.label}
                  </td>
```

4. Sous la table, `NoteSource` documentant le seuil :

```tsx
        <NoteSource>
          Écart = APR max − APR min entre venues ; ≥ 10 points d'APR = tension de financement
          inter-venues (arbitrage/positionnement asymétrique). ● vert = APR max, ● rouge = APR min.
        </NoteSource>
```

(s'il existe déjà une `NoteSource` en pied de fenêtre, fusionner le texte dedans plutôt qu'en créer une seconde.)

- [ ] **Step 2 : vérifier** — `typecheck` + `test` + `build` verts.

- [ ] **Step 3 : commit**

```bash
git add apps/web/src/components/FundingMatrixWindow.tsx
git commit -m "feat(fundx): écart d'APR promu en Metric (warn ≥ 10 pts) + repères max/min (Lot B4)"
```

### Task 15 : StablecoinsWindow — bandeau d'état des pegs

**Files:**
- Modify: `apps/web/src/components/stablecoinsWindow.util.ts` (nouvelle pure `resumePegs` + déplacer `SUPPLY_MIN_USD`)
- Modify: `apps/web/src/components/StablecoinsWindow.tsx` (`VueEnsemble` l.182-211 : bandeau + prop `onVoirPegs` ; `VuePegs` l.515 : consommer la constante déplacée ; parent l.741 : passer `onVoirPegs`)
- Test: `apps/web/src/components/stablecoinsWindow.util.test.ts` (étendre)

**Interfaces:**
- Consumes: `ecartPegBps`, `etatPeg`, `type EtatPeg`, `type EmetteurStablecoin` (existants) ; `Badge` (ui.tsx).
- Produces: `SUPPLY_MIN_USD = 10_000_000` (exporté de l'util — déplacé depuis `StablecoinsWindow.tsx:515`) ; `resumePegs(emetteurs): ResumePegs` avec `ResumePegs = { stables: number; alertes: { symbole: string; bps: number; etat: EtatPeg }[] }` (alertes = tension|depeg, triées par |bps| décroissant, matérialité ≥ SUPPLY_MIN_USD).

- [ ] **Step 1 : tests (rouges)**

Dans `stablecoinsWindow.util.test.ts`, ajouter (adapter la fabrique d'émetteur existante du fichier si elle existe, sinon) :

```ts
import { resumePegs, SUPPLY_MIN_USD } from "./stablecoinsWindow.util";
import type { EmetteurStablecoin } from "../data/macro/stablecoinsDetail";

function emetteur(partiel: Partial<EmetteurStablecoin>): EmetteurStablecoin {
  return {
    id: "x", nom: "X", symbole: "X", pegType: "peggedUSD", pegMechanism: "fiat-backed",
    prix: 1, mcapUsd: 1_000_000_000, mcapVeilleUsd: null, mcap7jUsd: null,
    mcap30jUsd: null, parChaineUsd: {},
    ...partiel,
  };
}

describe("resumePegs", () => {
  it("compte les stables, remonte tension/depeg triés par |bps| décroissant", () => {
    const r = resumePegs([
      emetteur({ symbole: "USDT", prix: 1.0005 }),
      emetteur({ symbole: "USDX", prix: 0.9962 }),
      emetteur({ symbole: "USDY", prix: 0.9788 }),
    ]);
    expect(r.stables).toBe(1);
    expect(r.alertes.map((a) => a.symbole)).toEqual(["USDY", "USDX"]);
    expect(r.alertes[0]?.etat).toBe("depeg");
    expect(r.alertes[1]?.etat).toBe("tension");
  });
  it("ignore les non-USD, prix null et sous le seuil de matérialité", () => {
    const r = resumePegs([
      emetteur({ pegType: "peggedEUR", prix: 0.9 }),
      emetteur({ prix: null }),
      emetteur({ prix: 0.97, mcapUsd: SUPPLY_MIN_USD - 1 }),
    ]);
    expect(r.stables).toBe(0);
    expect(r.alertes).toEqual([]);
  });
});
```

(compléter les champs obligatoires de `EmetteurStablecoin` selon le type réel — la fabrique ci-dessus est indicative, l'important est : `pegType`, `prix`, `mcapUsd`, `symbole`.)

- [ ] **Step 2 : vérifier l'échec** — `pnpm --filter @axiom/web test -- stablecoinsWindow` → FAIL.

- [ ] **Step 3 : implémenter**

Dans `stablecoinsWindow.util.ts` :

```ts
/** Seuil de matérialité : sous ~10 M$ de supply, les tokens morts noient la lecture des pegs. */
export const SUPPLY_MIN_USD = 10_000_000;

export interface ResumePegs {
  /** Nombre d'émetteurs USD matériels au peg stable (< 25 bps). */
  stables: number;
  /** Écarts significatifs (tension/depeg), triés par |bps| décroissant. */
  alertes: { symbole: string; bps: number; etat: EtatPeg }[];
}

/** État global des pegs USD matériels — alimente le bandeau de la Vue d'ensemble. */
export function resumePegs(emetteurs: readonly EmetteurStablecoin[]): ResumePegs {
  let stables = 0;
  const alertes: ResumePegs["alertes"] = [];
  for (const e of emetteurs) {
    if (e.mcapUsd < SUPPLY_MIN_USD) continue;
    const bps = ecartPegBps(e);
    if (bps === null) continue;
    const etat = etatPeg(bps);
    if (etat === "stable") stables += 1;
    else alertes.push({ symbole: e.symbole, bps, etat });
  }
  alertes.sort((a, b) => Math.abs(b.bps) - Math.abs(a.bps));
  return { stables, alertes };
}
```

Dans `StablecoinsWindow.tsx` :
- `VuePegs` (l.515) : supprimer la constante locale `SUPPLY_MIN_USD`, importer celle de l'util.
- `VueEnsemble` gagne un prop `onVoirPegs: () => void`, et rend EN TÊTE (avant la grille de Metric l.200) :

```tsx
      {(() => {
        const pegs = resumePegs(emetteurs);
        if (pegs.alertes.length === 0) {
          return (
            <p className="text-[11px] text-text-dim">Pegs : {pegs.stables} stables</p>
          );
        }
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {pegs.alertes.map((a) => (
              <button key={a.symbole} type="button" onClick={onVoirPegs} title="Voir l'onglet Pegs">
                <Badge ton={a.etat === "depeg" ? "down" : "warn"}>
                  {a.etat} {a.symbole} {a.bps >= 0 ? "+" : "−"}{Math.abs(Math.round(a.bps))} bps
                </Badge>
              </button>
            ))}
          </div>
        );
      })()}
```

- Au site d'appel (l.741) : `<VueEnsemble emetteurs={emetteurs} historique={historique} onSelect={setEmetteurSelId} onVoirPegs={() => { setEmetteurSelId(null); setOnglet("pegs"); }} />`.

- [ ] **Step 4 : vérifier le vert** — tests + `typecheck` + `build`.

- [ ] **Step 5 : commit**

```bash
git add apps/web/src/components/stablecoinsWindow.util.ts apps/web/src/components/stablecoinsWindow.util.test.ts apps/web/src/components/StablecoinsWindow.tsx
git commit -m "feat(stbl): bandeau d'état des pegs en tête de la Vue d'ensemble, clic vers Pegs (Lot B4)"
```

---

## Phase B5 — Reliquats chart (Lot A §10)

### Task 16 : IndicatorMenu — autoFocus + navigation clavier

**Files:**
- Modify: `apps/web/src/components/IndicatorMenu.tsx` (champ recherche l.296-308 ; boutons d'ajout l.335-369 ; conteneur du panneau)

**Interfaces:**
- Consumes: `indexRoving` (`ui.tsx:31`, pure déjà testée).
- Produces: focus automatique du champ recherche à l'ouverture ; ↑/↓/Home/End = focus roving sur les boutons d'ajout ; ⏎ = ajout de l'indicateur focalisé (comportement natif du bouton focalisé) ; Échap = fermeture.

- [ ] **Step 1 : implémenter**

1. **autoFocus** — ref sur l'input + effet à l'ouverture :

```tsx
  const rechercheRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) rechercheRef.current?.focus();
  }, [open]);
```

(`<input ref={rechercheRef} …>` ; NE PAS utiliser l'attribut `autoFocus` seul — le panneau reste monté, seul `open` change ; vérifier ce point sur le code réel : si le panneau est monté conditionnellement, `autoFocus` suffit.)

2. **Navigation clavier** — `onKeyDown` sur le CONTENEUR du panneau (délégation, pas de handler par bouton) ; les boutons d'ajout sont marqués `data-item-indicateur` :

```tsx
  const panneauRef = useRef<HTMLDivElement | null>(null);

  function itemsAjout(): HTMLButtonElement[] {
    return Array.from(
      panneauRef.current?.querySelectorAll<HTMLButtonElement>("button[data-item-indicateur]:not(:disabled)") ?? [],
    );
  }

  function onKeyDownPanneau(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const items = itemsAjout();
    if (items.length === 0) return;
    e.preventDefault();
    const courant = items.findIndex((b) => b === document.activeElement);
    // Home/End réservés au champ de recherche : n'intercepter que hors input.
    if ((e.key === "Home" || e.key === "End") && document.activeElement === rechercheRef.current) return;
    const cible = items[indexRoving(items.length, courant, e.key)];
    cible?.focus();
  }
```

Sur le bouton d'ajout (l.351) : ajouter `data-item-indicateur=""`. Sur le conteneur du panneau : `ref={panneauRef}` + `onKeyDown={onKeyDownPanneau}`. ⏎ n'a besoin d'AUCUN code : le bouton focalisé s'active nativement.

⚠️ `indexRoving` accepte `"ArrowDown" | "ArrowUp" | "Home" | "End"` — le narrowing TypeScript du `e.key` ci-dessus suffit. Import : `indexRoving` depuis `./ui`.

- [ ] **Step 2 : vérifier** — `typecheck` + `test` + `build` verts (pas de test DOM possible en env node — gate visuel Task 18 : ouvrir le menu, taper, ↓↓⏎ ajoute, Échap ferme).

- [ ] **Step 3 : commit**

```bash
git add apps/web/src/components/IndicatorMenu.tsx
git commit -m "feat(indicateurs): autoFocus recherche + navigation clavier du menu (Lot B5)"
```

### Task 17 : atténuation heatmap liq sous footprint

**Files:**
- Modify: `apps/web/src/chart/liquidationHeat.ts` (alpha nominal l.1015-1030 et l.1119 ; souscriptions l.673-690 ; nouvelle pure près de `alphaFadeIn` l.369)
- Modify: `apps/web/src/components/LiquidationsWindow.tsx` (hint une ligne près du toggle « Sur le graphe »)
- Test: `apps/web/src/chart/liquidationHeat.test.ts` (étendre — le fichier de tests des pures du module existe ; sinon le créer sur le même pattern que les tests existants du module)

**Interfaces:**
- Consumes: `orderflowStore` (`store/orderflow.ts`, champ `enabled`) ; `liqMarksStore` (déjà importé).
- Produces: `attenuationFootprint(alpha: number, footprintActif: boolean): number` (pure exportée, ×0.5 si actif).

- [ ] **Step 1 : test (rouge)**

```ts
import { attenuationFootprint } from "./liquidationHeat";

describe("attenuationFootprint", () => {
  it("divise l'alpha par 2 quand le footprint est actif", () => {
    expect(attenuationFootprint(0.4, true)).toBeCloseTo(0.2, 6);
    expect(attenuationFootprint(0.4, false)).toBe(0.4);
  });
});
```

Run: `pnpm --filter @axiom/web test -- liquidationHeat` → FAIL.

- [ ] **Step 2 : implémenter**

Près de `alphaFadeIn` (l.369) :

```ts
/**
 * Sous footprint actif, la heatmap s'efface à moitié : les deux couches se
 * superposent sur les mêmes bougies, l'orderflow garde la priorité de lecture.
 */
export function attenuationFootprint(alpha: number, footprintActif: boolean): number {
  return footprintActif ? alpha * 0.5 : alpha;
}
```

Aux DEUX sites de calcul d'alpha nominal (l.1015-1030 cellules précises, l.1119 chemin lissé offscreen), envelopper AVANT `alphaFadeIn` :

```ts
      alpha = attenuationFootprint(alpha, orderflowStore.getState().enabled);
      alpha = alphaFadeIn(alpha, cell.dernierTime, this.tsDemarrage, this.dernierBumpTs, now);
```

(import `orderflowStore` depuis `../store/orderflow` ; sur le chemin lissé l.1119, appliquer la même atténuation à l'alpha par pixel ou au `globalAlpha` du blit — suivre la structure réelle du code.)

Souscription dirty (près de `this.unsubMode` l.687) pour re-render au toggle footprint :

```ts
    this.unsubOrderflow = orderflowStore.subscribe((s, prev) => {
      if (s.enabled !== prev.enabled) this.marquerDirty();
    });
```

(déclarer le champ, l'initialiser avec les autres souscriptions, le désabonner dans le teardown existant — suivre EXACTEMENT le cycle de vie de `unsubMode` ; le nom réel de la méthode dirty est à vérifier dans le module.)

Hint dans `LiquidationsWindow.tsx`, sous le toggle « Sur le graphe » (les deux stores sont accessibles) :

```tsx
        {marksActif && footprintActif && (
          <p className="text-[10px] text-text-dim">Heatmap atténuée : footprint actif.</p>
        )}
```

(`const footprintActif = useStore(orderflowStore, (s) => s.enabled);` + le state existant du toggle.)

- [ ] **Step 3 : vérifier le vert** — tests + `typecheck` + `build` verts.

- [ ] **Step 4 : commit**

```bash
git add apps/web/src/chart/liquidationHeat.ts apps/web/src/chart/liquidationHeat.test.ts apps/web/src/components/LiquidationsWindow.tsx
git commit -m "feat(liq): heatmap atténuée ×0.5 sous footprint actif + hint (Lot B5)"
```

---

## Task 18 : Gate final — suites complètes + contrôle visuel

**Files:** aucun nouveau (corrections éventuelles seulement).

- [ ] **Step 1 : gates automatiques**

```bash
pnpm -r test && pnpm -r typecheck && pnpm --filter @axiom/web build
```

Expected: toutes les suites vertes (web ≥ 1373 + nouveaux, daemon 231, indicators 404+, alerts 30, backtest), typecheck 6 workspaces 0 erreur, build OK.

- [ ] **Step 2 : gate visuel réel** (dev server + chrome-devtools MCP, technique documentée : ⌘K par MNÉMONIQUES, captures dans le workspace)

1. **Pastille REGIME** (SessionStrip) : visible au boot (« Régime — » gris puis libellé coloré après calcul) ; title = détail des 6 composants ; clic ouvre le BRIEF.
2. **Chapeau BRIEF** : rangée Régime/Nuit/Funding(+RefBadge)/Vol, ligne de lecture sous le bandeau ; export → Notes contient `## Lecture`.
3. **DERIV** : ligne `APR +x.xx% · p97 · 90 j` sous le funding (ou « réf. en construction »).
4. **CHAIN** : badges de zone sur MVRV-Z/SOPR/NUPL + NoteSource des seuils.
5. **LIQ** : ligne « 1 h : $X · pNN · NN j » si daemon actif ; hint « heatmap atténuée » quand footprint + heatmap actifs, et cellules visiblement plus pâles.
6. **EQS** : cellules extrêmes en orange gras + légende pied de table.
7. **VOL** : rangée de 4 Metric en tête du corps, canvas intact en dessous.
8. **FUNDX** : Metric écart (warn si ≥ 10 pts) + points ● max/min, sous-titre sans doublon.
9. **STBL** : bandeau pegs (« Pegs : N stables » ou badges cliquables → onglet Pegs).
10. **Menu Indicateurs** : focus auto, ↓↓⏎ ajoute un indicateur, Échap ferme.
11. Thèmes : vérifier 2-3 fenêtres en Cute (fond clair) ET Dark — badges warn lisibles.

- [ ] **Step 3 : commit final éventuel** (fixes de gate) puis mise à jour du plan (cases cochées).

---

## Ordre d'exécution et dépendances

- Tasks 1 → 2 → 3 séquentielles (fondations).
- Tasks 4 → 5 → 6 séquentielles (REGIME) ; dépendent de 1-3.
- Tasks 7 → 8 séquentielles (BRIEF) ; 8 dépend de 5 et 7.
- Tasks 9, 10, 11, 12, 13, 14, 15 : indépendantes entre elles (fichiers disjoints), dépendent des fondations (1-3) — parallélisables.
- Tasks 16, 17 : indépendantes de tout le reste (16 ne dépend que d'`indexRoving` existant).
- Task 18 : dernière.




