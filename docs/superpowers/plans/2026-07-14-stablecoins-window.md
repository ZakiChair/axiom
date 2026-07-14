# Fenêtre STBL (Stablecoins) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fenêtre Bloomberg « STBL » d'analyse des stablecoins : supply/impression (mint-burn net), dominance par émetteur, répartition par chaîne, écarts de peg, avec drill-down par émetteur.

**Architecture:** Couche données `data/macro/stablecoinsDetail.ts` (4 fetchers DefiLlama en fetch direct + cache mémoire 5 min), calculs purs `components/stablecoinsWindow.util.ts` (testables sans DOM), composant `StablecoinsWindow.tsx` clone du pattern FUND (store Zustand co-localisé + `mirrorOpenState`) avec 4 onglets + drill-down, charts Canvas 2D (`canvasTokens`, `squarify` de `lib/treemap.ts` réutilisé pour la dominance).

**Tech Stack:** TypeScript strict, React + Tailwind (tokens sémantiques), Zustand vanilla, vitest (env node), DefiLlama `stablecoins.llama.fi` (gratuit, sans clé, CORS OK).

## Global Constraints

- Spec : `docs/superpowers/specs/2026-07-14-stablecoins-window-design.md`.
- **Fetch direct** (pas de whitelist `/extapi`) — invariant BUILD-CONTRACT « UI 100 % fonctionnelle sans daemon ».
- **Aucun hex en dur** : tokens Tailwind (`bg-bg`, `text-text-dim`, `border-up`…) côté JSX, `lireTokenCanvas`/`lireTokensCanvas` côté canvas.
- Pas de KLineChart dans les fenêtres : Canvas 2D avec fonction `dessiner()` pure + gestion `devicePixelRatio` (pattern `TermStructureWindow.tsx:147`).
- Tests co-localisés (`foo.ts` + `foo.test.ts`), env node — logique pure uniquement, pas de rendu React.
- Commentaires et libellés en **français**.
- ⚠️ **Working tree sale** : `windowManager.ts`, `windowManager.test.ts` et `App.tsx` portent du WIP non commité étranger à cette feature. Les commits de ce plan n'ajoutent QUE les fichiers 100 % nouveaux ; les modifications dans les fichiers partagés restent en working tree (commit final groupé décidé avec Zaki).
- Seuils pegs : stable < 25 bps, tension < 100 bps, depeg ≥ 100 bps (écart absolu vs 1,00 $, pegs USD uniquement).
- Commandes de test : `pnpm --filter @axiom/web test` (ciblé : `pnpm --filter @axiom/web exec vitest run <fichier>`), final `pnpm check`.

---

### Task 1 : Couche données DefiLlama stablecoins

**Files:**
- Create: `apps/web/src/data/macro/stablecoinsDetail.ts`
- Test: `apps/web/src/data/macro/stablecoinsDetail.test.ts`

**Interfaces:**
- Consumes: rien (module feuille ; `fetch` global).
- Produces (utilisé par Tasks 2-8) :
  - `interface EmetteurStablecoin { id: string; nom: string; symbole: string; pegType: string; pegMechanism: string; prix: number | null; mcapUsd: number; mcapVeilleUsd: number | null; mcap7jUsd: number | null; mcap30jUsd: number | null; parChaineUsd: Record<string, number> }`
  - `interface PointSupply { time: number; totalUsd: number }` (time en ms)
  - `interface DetailEmetteur { id: string; nom: string; symbole: string; pegType: string; pegMechanism: string; prix: number | null; historiqueParChaine: Record<string, PointSupply[]> }`
  - `chargerEmetteurs(signal?: AbortSignal): Promise<EmetteurStablecoin[]>`
  - `chargerHistoriqueAgrege(signal?: AbortSignal): Promise<PointSupply[]>`
  - `chargerHistoriqueChaine(chaine: string, signal?: AbortSignal): Promise<PointSupply[]>`
  - `chargerDetailEmetteur(id: string, signal?: AbortSignal): Promise<DetailEmetteur>`
  - `_viderCacheStablecoins(): void` (tests uniquement)

- [ ] **Step 1 : Écrire les tests qui échouent**

`apps/web/src/data/macro/stablecoinsDetail.test.ts` :

```ts
/** Tests de la couche données stablecoins (DefiLlama) — fetch mocké, fixtures minimales. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chargerEmetteurs,
  chargerHistoriqueAgrege,
  chargerHistoriqueChaine,
  chargerDetailEmetteur,
  _viderCacheStablecoins,
} from "./stablecoinsDetail";

/** Fixture /stablecoins?includePrices=true (champs réels DefiLlama, tronqués). */
const FIXTURE_LISTE = {
  peggedAssets: [
    {
      id: "1",
      name: "Tether",
      symbol: "USDT",
      pegType: "peggedUSD",
      pegMechanism: "fiat-backed",
      price: 1.0004,
      circulating: { peggedUSD: 120_000_000_000 },
      circulatingPrevDay: { peggedUSD: 119_500_000_000 },
      circulatingPrevWeek: { peggedUSD: 118_000_000_000 },
      circulatingPrevMonth: { peggedUSD: 115_000_000_000 },
      chainCirculating: {
        Tron: { current: { peggedUSD: 60_000_000_000 } },
        Ethereum: { current: { peggedUSD: 50_000_000_000 } },
      },
    },
    {
      id: "2",
      name: "USD Coin",
      symbol: "USDC",
      pegType: "peggedUSD",
      pegMechanism: "fiat-backed",
      price: 0.9998,
      circulating: { peggedUSD: 34_000_000_000 },
      // Champs prev absents → null attendu (robustesse).
      chainCirculating: { Ethereum: { current: { peggedUSD: 30_000_000_000 } } },
    },
    // Malformé : sans id ni circulating → ignoré.
    { name: "Broken", symbol: "BRK" },
    // Supply nulle → ignoré (aucun intérêt analytique, éviterait /0 en dominance).
    {
      id: "99",
      name: "Dead",
      symbol: "DEAD",
      pegType: "peggedUSD",
      pegMechanism: "algorithmic",
      circulating: { peggedUSD: 0 },
    },
  ],
};

const FIXTURE_CHARTS = [
  { date: "1719792000", totalCirculatingUSD: { peggedUSD: 150e9, peggedEUR: 0.3e9 } },
  { date: "1719878400", totalCirculatingUSD: { peggedUSD: 151e9, peggedEUR: "junk" } },
  { date: "not-a-date", totalCirculatingUSD: { peggedUSD: 1e9 } }, // ignoré
];

const FIXTURE_DETAIL = {
  id: "1",
  name: "Tether",
  symbol: "USDT",
  pegType: "peggedUSD",
  pegMechanism: "fiat-backed",
  price: 1.0004,
  chainBalances: {
    Tron: {
      tokens: [
        { date: 1719792000, circulating: { peggedUSD: 59e9 } },
        { date: 1719878400, circulating: { peggedUSD: 60e9 } },
      ],
    },
    Ethereum: { tokens: [{ date: 1719792000, circulating: { peggedUSD: 50e9 } }] },
  },
};

function mockFetchJson(payload: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => payload })),
  );
}

beforeEach(() => _viderCacheStablecoins());
afterEach(() => vi.unstubAllGlobals());

describe("chargerEmetteurs", () => {
  it("parse la liste, convertit les champs prev et ignore les entrées malformées ou vides", async () => {
    mockFetchJson(FIXTURE_LISTE);
    const emetteurs = await chargerEmetteurs();
    expect(emetteurs.map((e) => e.symbole)).toEqual(["USDT", "USDC"]);
    const usdt = emetteurs[0]!;
    expect(usdt.mcapUsd).toBe(120_000_000_000);
    expect(usdt.mcapVeilleUsd).toBe(119_500_000_000);
    expect(usdt.mcap7jUsd).toBe(118_000_000_000);
    expect(usdt.mcap30jUsd).toBe(115_000_000_000);
    expect(usdt.prix).toBe(1.0004);
    expect(usdt.parChaineUsd).toEqual({ Tron: 60_000_000_000, Ethereum: 50_000_000_000 });
    const usdc = emetteurs[1]!;
    expect(usdc.mcapVeilleUsd).toBeNull();
    expect(usdc.mcap7jUsd).toBeNull();
  });

  it("met en cache la réponse (un seul fetch pour deux appels)", async () => {
    mockFetchJson(FIXTURE_LISTE);
    await chargerEmetteurs();
    await chargerEmetteurs();
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });

  it("propage une erreur HTTP explicite", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, statusText: "Server Error", json: async () => ({}) })),
    );
    await expect(chargerEmetteurs()).rejects.toThrow(/500/);
  });
});

describe("chargerHistoriqueAgrege", () => {
  it("somme les pegs convertis USD par point et ignore dates/valeurs non finies", async () => {
    mockFetchJson(FIXTURE_CHARTS);
    const serie = await chargerHistoriqueAgrege();
    expect(serie).toEqual([
      { time: 1719792000_000, totalUsd: 150.3e9 },
      { time: 1719878400_000, totalUsd: 151e9 }, // "junk" ignoré
    ]);
  });
});

describe("chargerHistoriqueChaine", () => {
  it("interroge l'endpoint de la chaîne demandée (URL encodée)", async () => {
    mockFetchJson(FIXTURE_CHARTS);
    await chargerHistoriqueChaine("Ethereum");
    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(url).toBe("https://stablecoins.llama.fi/stablecoincharts/Ethereum");
  });
});

describe("chargerDetailEmetteur", () => {
  it("parse l'historique par chaîne (dates secondes → ms, valeurs sommées par peg)", async () => {
    mockFetchJson(FIXTURE_DETAIL);
    const detail = await chargerDetailEmetteur("1");
    expect(detail.symbole).toBe("USDT");
    expect(detail.historiqueParChaine["Tron"]).toEqual([
      { time: 1719792000_000, totalUsd: 59e9 },
      { time: 1719878400_000, totalUsd: 60e9 },
    ]);
    expect(Object.keys(detail.historiqueParChaine)).toEqual(["Tron", "Ethereum"]);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @axiom/web exec vitest run src/data/macro/stablecoinsDetail.test.ts`
Expected: FAIL — « Failed to resolve import "./stablecoinsDetail" ».

- [ ] **Step 3 : Implémentation minimale**

`apps/web/src/data/macro/stablecoinsDetail.ts` :

```ts
/**
 * Couche données de la fenêtre STBL — DefiLlama stablecoins (gratuit, SANS clé).
 *
 * Endpoints (doc : https://api-docs.defillama.com/, section « stablecoins ») :
 *   GET https://stablecoins.llama.fi/stablecoins?includePrices=true  → liste émetteurs
 *   GET https://stablecoins.llama.fi/stablecoincharts/all            → historique agrégé
 *   GET https://stablecoins.llama.fi/stablecoincharts/{chain}        → historique d'une chaîne
 *   GET https://stablecoins.llama.fi/stablecoin/{id}                 → détail émetteur
 *
 * Fetch DIRECT (DefiLlama envoie les en-têtes CORS) — pas de proxy /extapi, la fenêtre
 * fonctionne sans daemon (invariant BUILD-CONTRACT). Cache mémoire TTL 5 min par URL :
 * les 4 onglets et le drill-down repassent par les mêmes URL sans marteler l'API.
 *
 * Toutes les valeurs `circulating*` DefiLlama sont des Record<pegType, montant> déjà
 * convertis en USD → on les SOMME (même convention que macro/stablecoins.ts).
 */

const BASE = "https://stablecoins.llama.fi";
const TTL_MS = 5 * 60_000;

export interface EmetteurStablecoin {
  id: string;
  nom: string;
  symbole: string;
  pegType: string; // "peggedUSD" | "peggedEUR" | …
  pegMechanism: string; // "fiat-backed" | "crypto-backed" | "algorithmic"
  prix: number | null; // USD (null si DefiLlama n'a pas de prix)
  mcapUsd: number; // supply circulante convertie USD
  mcapVeilleUsd: number | null;
  mcap7jUsd: number | null;
  mcap30jUsd: number | null;
  parChaineUsd: Record<string, number>; // supply courante par chaîne
}

/** Point journalier d'une série de supply (time en ms epoch). */
export interface PointSupply {
  time: number;
  totalUsd: number;
}

export interface DetailEmetteur {
  id: string;
  nom: string;
  symbole: string;
  pegType: string;
  pegMechanism: string;
  prix: number | null;
  historiqueParChaine: Record<string, PointSupply[]>;
}

// ─────────────────────────── Fetch + cache ───────────────────────────

const cache = new Map<string, { expire: number; data: unknown }>();

/** Vide le cache module — réservé aux tests. */
export function _viderCacheStablecoins(): void {
  cache.clear();
}

async function fetchJsonCache<T>(url: string, signal?: AbortSignal): Promise<T> {
  const hit = cache.get(url);
  if (hit && hit.expire > Date.now()) return hit.data as T;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`DefiLlama stablecoins ${res.status} ${res.statusText}`);
  const data = (await res.json()) as T;
  cache.set(url, { expire: Date.now() + TTL_MS, data });
  return data;
}

// ─────────────────────────── Parsing défensif ───────────────────────────

/** Somme des montants finis d'un Record<pegType, montant> ; null si rien d'exploitable. */
function sommePegs(x: unknown): number | null {
  if (typeof x !== "object" || x === null) return null;
  let somme = 0;
  let vu = false;
  for (const v of Object.values(x as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      somme += v;
      vu = true;
    }
  }
  return vu ? somme : null;
}

function chaineOuVide(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function prixOuNull(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

// ─────────────────────────── Liste des émetteurs ───────────────────────────

interface AssetBrut {
  id?: unknown;
  name?: unknown;
  symbol?: unknown;
  pegType?: unknown;
  pegMechanism?: unknown;
  price?: unknown;
  circulating?: unknown;
  circulatingPrevDay?: unknown;
  circulatingPrevWeek?: unknown;
  circulatingPrevMonth?: unknown;
  chainCirculating?: unknown;
}

function parseChainCirculating(x: unknown): Record<string, number> {
  const sortie: Record<string, number> = {};
  if (typeof x !== "object" || x === null) return sortie;
  for (const [chaine, v] of Object.entries(x as Record<string, unknown>)) {
    const current = (v as { current?: unknown } | null)?.current;
    const montant = sommePegs(current);
    if (montant !== null && montant > 0) sortie[chaine] = montant;
  }
  return sortie;
}

/** Liste des émetteurs (mcap, prix, mécanisme, répartition par chaîne courante). */
export async function chargerEmetteurs(signal?: AbortSignal): Promise<EmetteurStablecoin[]> {
  const raw = await fetchJsonCache<{ peggedAssets?: AssetBrut[] }>(
    `${BASE}/stablecoins?includePrices=true`,
    signal,
  );
  const sortie: EmetteurStablecoin[] = [];
  for (const a of raw.peggedAssets ?? []) {
    const id = chaineOuVide(a.id);
    const symbole = chaineOuVide(a.symbol);
    const mcapUsd = sommePegs(a.circulating);
    // Entrée inexploitable (pas d'id/symbole) ou supply nulle → ignorée.
    if (id === "" || symbole === "" || mcapUsd === null || mcapUsd <= 0) continue;
    sortie.push({
      id,
      nom: chaineOuVide(a.name) || symbole,
      symbole,
      pegType: chaineOuVide(a.pegType),
      pegMechanism: chaineOuVide(a.pegMechanism),
      prix: prixOuNull(a.price),
      mcapUsd,
      mcapVeilleUsd: sommePegs(a.circulatingPrevDay),
      mcap7jUsd: sommePegs(a.circulatingPrevWeek),
      mcap30jUsd: sommePegs(a.circulatingPrevMonth),
      parChaineUsd: parseChainCirculating(a.chainCirculating),
    });
  }
  return sortie;
}

// ─────────────────────────── Historiques (agrégé / par chaîne) ───────────────────────────

interface PointChartBrut {
  date?: unknown; // secondes epoch (chaîne)
  totalCirculatingUSD?: unknown;
}

function parseSerieCharts(raw: PointChartBrut[]): PointSupply[] {
  const serie: PointSupply[] = [];
  for (const p of raw) {
    const time = Number(p.date) * 1000;
    const totalUsd = sommePegs(p.totalCirculatingUSD);
    if (!Number.isFinite(time) || totalUsd === null) continue;
    serie.push({ time, totalUsd });
  }
  return serie;
}

/** Historique JOURNALIER de la supply totale (tous pegs convertis USD). */
export async function chargerHistoriqueAgrege(signal?: AbortSignal): Promise<PointSupply[]> {
  const raw = await fetchJsonCache<PointChartBrut[]>(`${BASE}/stablecoincharts/all`, signal);
  return parseSerieCharts(raw);
}

/** Historique JOURNALIER de la supply sur UNE chaîne (ex. "Ethereum", "Tron"). */
export async function chargerHistoriqueChaine(
  chaine: string,
  signal?: AbortSignal,
): Promise<PointSupply[]> {
  const raw = await fetchJsonCache<PointChartBrut[]>(
    `${BASE}/stablecoincharts/${encodeURIComponent(chaine)}`,
    signal,
  );
  return parseSerieCharts(raw);
}

// ─────────────────────────── Détail émetteur (drill-down) ───────────────────────────

interface DetailBrut {
  id?: unknown;
  name?: unknown;
  symbol?: unknown;
  pegType?: unknown;
  pegMechanism?: unknown;
  price?: unknown;
  chainBalances?: unknown;
}

interface TokenBrut {
  date?: unknown; // secondes epoch (nombre ou chaîne selon les entrées)
  circulating?: unknown;
}

/** Détail d'un émetteur : historique de supply par chaîne (drill-down). */
export async function chargerDetailEmetteur(
  id: string,
  signal?: AbortSignal,
): Promise<DetailEmetteur> {
  const raw = await fetchJsonCache<DetailBrut>(`${BASE}/stablecoin/${encodeURIComponent(id)}`, signal);
  const historiqueParChaine: Record<string, PointSupply[]> = {};
  const chainBalances = raw.chainBalances;
  if (typeof chainBalances === "object" && chainBalances !== null) {
    for (const [chaine, v] of Object.entries(chainBalances as Record<string, unknown>)) {
      const tokens = (v as { tokens?: unknown } | null)?.tokens;
      if (!Array.isArray(tokens)) continue;
      const serie: PointSupply[] = [];
      for (const t of tokens as TokenBrut[]) {
        const time = Number(t.date) * 1000;
        const totalUsd = sommePegs(t.circulating);
        if (!Number.isFinite(time) || totalUsd === null) continue;
        serie.push({ time, totalUsd });
      }
      if (serie.length > 0) historiqueParChaine[chaine] = serie;
    }
  }
  return {
    id: chaineOuVide(raw.id) || id,
    nom: chaineOuVide(raw.name),
    symbole: chaineOuVide(raw.symbol),
    pegType: chaineOuVide(raw.pegType),
    pegMechanism: chaineOuVide(raw.pegMechanism),
    prix: prixOuNull(raw.price),
    historiqueParChaine,
  };
}
```

- [ ] **Step 4 : Vérifier le passage**

Run: `pnpm --filter @axiom/web exec vitest run src/data/macro/stablecoinsDetail.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/data/macro/stablecoinsDetail.ts apps/web/src/data/macro/stablecoinsDetail.test.ts
git commit -m "feat(stbl): couche données DefiLlama stablecoins (liste, historiques, détail)"
```

---

### Task 2 : Calculs purs (dominance, impression, pegs, chaînes)

**Files:**
- Create: `apps/web/src/components/stablecoinsWindow.util.ts`
- Test: `apps/web/src/components/stablecoinsWindow.util.test.ts`

**Interfaces:**
- Consumes: `EmetteurStablecoin`, `PointSupply`, `DetailEmetteur` (Task 1).
- Produces (utilisé par Tasks 3-8) :
  - `interface PartDominance { id: string; symbole: string; mcapUsd: number; partPct: number }`
  - `calculerDominance(emetteurs: EmetteurStablecoin[], topN?: number): PartDominance[]` (agrégat « Autres » avec `id: ""`)
  - `deltaPct(actuel: number, precedent: number | null): number | null`
  - `ecartPegBps(e: EmetteurStablecoin): number | null` (pegs USD uniquement)
  - `type EtatPeg = "stable" | "tension" | "depeg"` et `etatPeg(bps: number): EtatPeg`
  - `impressionNette(serie: PointSupply[], jours: number): number | null`
  - `serieImpressionQuotidienne(serie: PointSupply[]): { time: number; delta: number }[]`
  - `tronquerSerie(serie: PointSupply[], jours: number | null): PointSupply[]`
  - `interface PartChaine { chaine: string; totalUsd: number; partPct: number }`
  - `repartitionChaines(emetteurs: EmetteurStablecoin[]): PartChaine[]` (tri décroissant)
  - `agregerHistoriqueEmetteur(detail: DetailEmetteur): PointSupply[]` (somme par date sur toutes les chaînes)
  - `bornes(valeurs: number[]): { min: number; max: number } | null`

- [ ] **Step 1 : Écrire les tests qui échouent**

`apps/web/src/components/stablecoinsWindow.util.test.ts` :

```ts
/** Tests des calculs purs de la fenêtre STBL (dominance, impression, pegs, chaînes). */
import { describe, expect, it } from "vitest";
import type { DetailEmetteur, EmetteurStablecoin } from "../data/macro/stablecoinsDetail";
import {
  agregerHistoriqueEmetteur,
  bornes,
  calculerDominance,
  deltaPct,
  ecartPegBps,
  etatPeg,
  impressionNette,
  repartitionChaines,
  serieImpressionQuotidienne,
  tronquerSerie,
} from "./stablecoinsWindow.util";

function emetteur(partiel: Partial<EmetteurStablecoin>): EmetteurStablecoin {
  return {
    id: "1",
    nom: "Tether",
    symbole: "USDT",
    pegType: "peggedUSD",
    pegMechanism: "fiat-backed",
    prix: 1,
    mcapUsd: 100,
    mcapVeilleUsd: null,
    mcap7jUsd: null,
    mcap30jUsd: null,
    parChaineUsd: {},
    ...partiel,
  };
}

const JOUR_MS = 86_400_000;

describe("calculerDominance", () => {
  it("calcule les parts en % et agrège la queue dans « Autres »", () => {
    const emetteurs = [
      emetteur({ id: "1", symbole: "USDT", mcapUsd: 600 }),
      emetteur({ id: "2", symbole: "USDC", mcapUsd: 300 }),
      emetteur({ id: "3", symbole: "DAI", mcapUsd: 60 }),
      emetteur({ id: "4", symbole: "FRAX", mcapUsd: 40 }),
    ];
    const parts = calculerDominance(emetteurs, 2);
    expect(parts.map((p) => p.symbole)).toEqual(["USDT", "USDC", "Autres"]);
    expect(parts[0]!.partPct).toBeCloseTo(60);
    expect(parts[2]!).toMatchObject({ id: "", mcapUsd: 100, partPct: 10 });
  });

  it("liste vide → tableau vide (pas de division par zéro)", () => {
    expect(calculerDominance([], 5)).toEqual([]);
  });
});

describe("deltaPct", () => {
  it("variation relative en %", () => {
    expect(deltaPct(110, 100)).toBeCloseTo(10);
    expect(deltaPct(90, 100)).toBeCloseTo(-10);
  });
  it("précédent null ou ≤ 0 → null", () => {
    expect(deltaPct(110, null)).toBeNull();
    expect(deltaPct(110, 0)).toBeNull();
  });
});

describe("ecartPegBps / etatPeg", () => {
  it("écart en bps vs 1,00 $ pour les pegs USD", () => {
    expect(ecartPegBps(emetteur({ prix: 1.001 }))).toBeCloseTo(10);
    expect(ecartPegBps(emetteur({ prix: 0.985 }))).toBeCloseTo(-150);
  });
  it("peg non-USD ou prix absent → null", () => {
    expect(ecartPegBps(emetteur({ pegType: "peggedEUR", prix: 1.08 }))).toBeNull();
    expect(ecartPegBps(emetteur({ prix: null }))).toBeNull();
  });
  it("seuils : <25 stable, <100 tension, ≥100 depeg (écart ABSOLU)", () => {
    expect(etatPeg(10)).toBe("stable");
    expect(etatPeg(-24.9)).toBe("stable");
    expect(etatPeg(25)).toBe("tension");
    expect(etatPeg(-99)).toBe("tension");
    expect(etatPeg(100)).toBe("depeg");
    expect(etatPeg(-150)).toBe("depeg");
  });
});

describe("impressionNette", () => {
  const serie = [
    { time: 0 * JOUR_MS, totalUsd: 100 },
    { time: 5 * JOUR_MS, totalUsd: 110 },
    { time: 10 * JOUR_MS, totalUsd: 130 },
  ];
  it("delta entre le dernier point et le point d'il y a N jours (plus proche ≤ borne)", () => {
    expect(impressionNette(serie, 5)).toBe(20); // 130 - 110
    expect(impressionNette(serie, 10)).toBe(30); // 130 - 100
  });
  it("série trop courte pour la fenêtre → null", () => {
    expect(impressionNette(serie, 30)).toBe(30); // borne avant le 1er point → 1er point
    expect(impressionNette([], 7)).toBeNull();
    expect(impressionNette([{ time: 0, totalUsd: 1 }], 7)).toBeNull();
  });
});

describe("serieImpressionQuotidienne", () => {
  it("delta point à point (mint > 0, burn < 0)", () => {
    const serie = [
      { time: 1 * JOUR_MS, totalUsd: 100 },
      { time: 2 * JOUR_MS, totalUsd: 104 },
      { time: 3 * JOUR_MS, totalUsd: 101 },
    ];
    expect(serieImpressionQuotidienne(serie)).toEqual([
      { time: 2 * JOUR_MS, delta: 4 },
      { time: 3 * JOUR_MS, delta: -3 },
    ]);
  });
});

describe("tronquerSerie", () => {
  const serie = [
    { time: 0 * JOUR_MS, totalUsd: 1 },
    { time: 50 * JOUR_MS, totalUsd: 2 },
    { time: 100 * JOUR_MS, totalUsd: 3 },
  ];
  it("garde les N derniers jours par rapport au dernier point", () => {
    expect(tronquerSerie(serie, 60)).toEqual(serie.slice(1));
  });
  it("null → série entière (mode « tout »)", () => {
    expect(tronquerSerie(serie, null)).toEqual(serie);
  });
});

describe("repartitionChaines", () => {
  it("agrège la supply par chaîne sur tous les émetteurs, tri décroissant", () => {
    const emetteurs = [
      emetteur({ parChaineUsd: { Tron: 60, Ethereum: 50 } }),
      emetteur({ id: "2", symbole: "USDC", parChaineUsd: { Ethereum: 30, Solana: 10 } }),
    ];
    const parts = repartitionChaines(emetteurs);
    expect(parts.map((p) => p.chaine)).toEqual(["Ethereum", "Tron", "Solana"]);
    expect(parts[0]!.totalUsd).toBe(80);
    expect(parts[0]!.partPct).toBeCloseTo((80 / 150) * 100);
  });
});

describe("agregerHistoriqueEmetteur", () => {
  it("somme les chaînes par date et trie chronologiquement", () => {
    const detail: DetailEmetteur = {
      id: "1",
      nom: "Tether",
      symbole: "USDT",
      pegType: "peggedUSD",
      pegMechanism: "fiat-backed",
      prix: 1,
      historiqueParChaine: {
        Tron: [
          { time: 1 * JOUR_MS, totalUsd: 10 },
          { time: 2 * JOUR_MS, totalUsd: 12 },
        ],
        Ethereum: [{ time: 2 * JOUR_MS, totalUsd: 5 }],
      },
    };
    expect(agregerHistoriqueEmetteur(detail)).toEqual([
      { time: 1 * JOUR_MS, totalUsd: 10 },
      { time: 2 * JOUR_MS, totalUsd: 17 },
    ]);
  });
});

describe("bornes", () => {
  it("min/max des valeurs finies", () => {
    expect(bornes([3, 1, 2])).toEqual({ min: 1, max: 3 });
    expect(bornes([Number.NaN, 5])).toEqual({ min: 5, max: 5 });
  });
  it("aucune valeur finie → null", () => {
    expect(bornes([])).toBeNull();
    expect(bornes([Number.NaN])).toBeNull();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @axiom/web exec vitest run src/components/stablecoinsWindow.util.test.ts`
Expected: FAIL — import non résolu.

- [ ] **Step 3 : Implémentation minimale**

`apps/web/src/components/stablecoinsWindow.util.ts` :

```ts
/**
 * Calculs PURS de la fenêtre STBL (stablecoins) — dominance, impression (Δ supply),
 * écarts de peg, répartition par chaîne. Séparés du composant pour rester testables
 * sans DOM (même convention que macroRatesWindow.util.ts).
 *
 * Seuils de peg (écart ABSOLU vs 1,00 $, pegs USD uniquement — DefiLlama fournit les
 * prix en USD, un peg EUR nécessiterait le cours EUR/USD) :
 *   stable < 25 bps ≤ tension < 100 bps ≤ depeg.
 */
import type { DetailEmetteur, EmetteurStablecoin, PointSupply } from "../data/macro/stablecoinsDetail";

const JOUR_MS = 86_400_000;

// ─────────────────────────── Dominance ───────────────────────────

export interface PartDominance {
  id: string; // "" pour l'agrégat « Autres »
  symbole: string;
  mcapUsd: number;
  partPct: number;
}

/** Parts de marché des `topN` premiers émetteurs + agrégat « Autres » (id vide). */
export function calculerDominance(emetteurs: EmetteurStablecoin[], topN = 12): PartDominance[] {
  const total = emetteurs.reduce((s, e) => s + e.mcapUsd, 0);
  if (total <= 0) return [];
  const tries = [...emetteurs].sort((a, b) => b.mcapUsd - a.mcapUsd);
  const tete = tries.slice(0, topN).map((e) => ({
    id: e.id,
    symbole: e.symbole,
    mcapUsd: e.mcapUsd,
    partPct: (e.mcapUsd / total) * 100,
  }));
  const resteUsd = tries.slice(topN).reduce((s, e) => s + e.mcapUsd, 0);
  if (resteUsd > 0) {
    tete.push({ id: "", symbole: "Autres", mcapUsd: resteUsd, partPct: (resteUsd / total) * 100 });
  }
  return tete;
}

// ─────────────────────────── Variations ───────────────────────────

/** Variation relative en % ; null si le point de comparaison manque ou est ≤ 0. */
export function deltaPct(actuel: number, precedent: number | null): number | null {
  if (precedent === null || !Number.isFinite(precedent) || precedent <= 0) return null;
  return ((actuel - precedent) / precedent) * 100;
}

// ─────────────────────────── Pegs ───────────────────────────

/** Écart au peg en points de base vs 1,00 $ — pegs USD uniquement, sinon null. */
export function ecartPegBps(e: EmetteurStablecoin): number | null {
  if (e.pegType !== "peggedUSD" || e.prix === null) return null;
  return (e.prix - 1) * 10_000;
}

export type EtatPeg = "stable" | "tension" | "depeg";

/** Classement d'un écart de peg (valeur ABSOLUE) selon les seuils du spec. */
export function etatPeg(bps: number): EtatPeg {
  const abs = Math.abs(bps);
  if (abs < 25) return "stable";
  if (abs < 100) return "tension";
  return "depeg";
}

// ─────────────────────────── Impression (Δ supply) ───────────────────────────

/**
 * Impression nette sur `jours` : dernier point − point le plus proche AVANT la borne
 * (dernier point dont time ≤ dernier.time − jours ; à défaut le premier point).
 */
export function impressionNette(serie: PointSupply[], jours: number): number | null {
  if (serie.length < 2) return null;
  const dernier = serie[serie.length - 1]!;
  const borne = dernier.time - jours * JOUR_MS;
  let reference = serie[0]!;
  for (const p of serie) {
    if (p.time <= borne) reference = p;
    else break;
  }
  return dernier.totalUsd - reference.totalUsd;
}

/** Δ point à point (mint net > 0, burn net < 0) — barres de l'onglet Impression. */
export function serieImpressionQuotidienne(serie: PointSupply[]): { time: number; delta: number }[] {
  const sortie: { time: number; delta: number }[] = [];
  for (let i = 1; i < serie.length; i++) {
    sortie.push({ time: serie[i]!.time, delta: serie[i]!.totalUsd - serie[i - 1]!.totalUsd });
  }
  return sortie;
}

/** Garde les `jours` derniers jours (relatifs au dernier point) ; null = tout. */
export function tronquerSerie(serie: PointSupply[], jours: number | null): PointSupply[] {
  if (jours === null || serie.length === 0) return serie;
  const borne = serie[serie.length - 1]!.time - jours * JOUR_MS;
  return serie.filter((p) => p.time >= borne);
}

// ─────────────────────────── Chaînes ───────────────────────────

export interface PartChaine {
  chaine: string;
  totalUsd: number;
  partPct: number;
}

/** Supply agrégée par chaîne sur TOUS les émetteurs (état courant), tri décroissant. */
export function repartitionChaines(emetteurs: EmetteurStablecoin[]): PartChaine[] {
  const totaux = new Map<string, number>();
  for (const e of emetteurs) {
    for (const [chaine, montant] of Object.entries(e.parChaineUsd)) {
      totaux.set(chaine, (totaux.get(chaine) ?? 0) + montant);
    }
  }
  const total = [...totaux.values()].reduce((s, v) => s + v, 0);
  if (total <= 0) return [];
  return [...totaux.entries()]
    .map(([chaine, totalUsd]) => ({ chaine, totalUsd, partPct: (totalUsd / total) * 100 }))
    .sort((a, b) => b.totalUsd - a.totalUsd);
}

// ─────────────────────────── Drill-down ───────────────────────────

/** Historique de supply TOTALE d'un émetteur = somme de ses chaînes par date. */
export function agregerHistoriqueEmetteur(detail: DetailEmetteur): PointSupply[] {
  const parDate = new Map<number, number>();
  for (const serie of Object.values(detail.historiqueParChaine)) {
    for (const p of serie) {
      parDate.set(p.time, (parDate.get(p.time) ?? 0) + p.totalUsd);
    }
  }
  return [...parDate.entries()]
    .map(([time, totalUsd]) => ({ time, totalUsd }))
    .sort((a, b) => a.time - b.time);
}

// ─────────────────────────── Échelles canvas ───────────────────────────

/** Min/max des valeurs finies — null si aucune (évite les échelles NaN au dessin). */
export function bornes(valeurs: number[]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of valeurs) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : null;
}
```

- [ ] **Step 4 : Vérifier le passage**

Run: `pnpm --filter @axiom/web exec vitest run src/components/stablecoinsWindow.util.test.ts`
Expected: PASS (~17 tests).

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/components/stablecoinsWindow.util.ts apps/web/src/components/stablecoinsWindow.util.test.ts
git commit -m "feat(stbl): calculs purs dominance/impression/pegs/chaînes"
```

---

### Task 3 : Squelette fenêtre + câblage + onglet Vue d'ensemble (metrics & table)

**Files:**
- Create: `apps/web/src/components/StablecoinsWindow.tsx`
- Modify: `apps/web/src/store/windowManager.ts` (ajout au `WINDOW_REGISTRY`, MàJ des mentions « 21 »)
- Modify: `apps/web/src/store/windowManager.test.ts:149-155` (21 → 22)
- Modify: `apps/web/src/App.tsx` (entrée lazy `stablecoins`)
- Modify: `apps/web/src/commands/windowPanels.ts` (commande STBL)
- Modify: `apps/web/src/components/Toolbar.tsx` (entrée `FONCTIONS`)

⚠️ `windowManager.ts`, `windowManager.test.ts` et `App.tsx` portent du WIP étranger : NE PAS les inclure dans le commit de cette task (voir Global Constraints).

**Interfaces:**
- Consumes: Task 1 (`chargerEmetteurs`, `chargerHistoriqueAgrege`, types), Task 2 (`calculerDominance`, `deltaPct`, `impressionNette`), `ui.tsx` (`EnTeteFenetre`, `Onglets`, `Metric`, `Chargement`, `ErreurBloc`, `NoteSource`), `lib/format.ts` (`formatUsd`, `formatPct`, `VALEUR_ABSENTE`), `windowManagerStore`/`mirrorOpenState`.
- Produces: `export function StablecoinsWindow()`, `export const stablecoinsUiStore` ; état interne partagé par les Tasks 4-8 : `emetteurs: EmetteurStablecoin[] | null`, `historique: PointSupply[] | null`, `statut: "idle" | "loading" | "ready" | "error"`, `onglet: "vue" | "impression" | "chaines" | "pegs"`, `emetteurSelId: string | null` (drill-down Task 8).

- [ ] **Step 1 : Câblage registre + test 22 fenêtres**

Dans `apps/web/src/store/windowManager.ts`, après la ligne `globe` du `WINDOW_REGISTRY` (ligne ~56) :

```ts
  { id: "stablecoins", title: "Stablecoins (supply, dominance, pegs)", mnemonic: "STBL", defaultWidth: 860, defaultHeight: 640 },
```

Mettre à jour les commentaires « 21 fenêtres » → « 22 fenêtres » (lignes 4 et 25 du fichier).

Dans `apps/web/src/store/windowManager.test.ts` (bloc `describe("WINDOW_REGISTRY")`), remplacer les trois `21` par `22` et adapter le libellé du `it` :

```ts
  it("contient exactement les 22 fenêtres attendues, sans doublon d'id ni de mnémonique", () => {
    expect(WINDOW_REGISTRY).toHaveLength(22);
    const ids = WINDOW_REGISTRY.map((w) => w.id);
    const mnemos = WINDOW_REGISTRY.map((w) => w.mnemonic);
    expect(new Set(ids).size).toBe(22);
    expect(new Set(mnemos).size).toBe(22);
```

- [ ] **Step 2 : Vérifier**

Run: `pnpm --filter @axiom/web exec vitest run src/store/windowManager.test.ts`
Expected: PASS.

- [ ] **Step 3 : Composant squelette + onglet Vue d'ensemble**

`apps/web/src/components/StablecoinsWindow.tsx` (créer — la treemap arrive en Task 4, les autres onglets en Tasks 5-7, le drill-down en Task 8 ; les onglets non implémentés affichent `Vide`) :

```tsx
/**
 * Fenêtre « STBL » — analyse des stablecoins (DefiLlama, gratuit, sans clé). NON MODALE.
 *
 * Quatre onglets :
 *   Vue d'ensemble — supply totale + Δ (impression nette), dominance (treemap + table).
 *   Impression    — historique de supply agrégée + barres de mint/burn net quotidien.
 *   Chaînes       — répartition de la supply par blockchain, historique par chaîne.
 *   Pegs          — écarts vs 1,00 $ en bps avec badges (pegs USD uniquement, cf. util).
 *
 * Drill-down : clic sur un émetteur (table Vue d'ensemble ou Pegs) → fiche émetteur
 * (historique de supply agrégé + répartition par chaîne), bouton retour.
 *
 * Données : data/macro/stablecoinsDetail.ts (fetch direct + cache 5 min). Les calculs
 * vivent dans stablecoinsWindow.util.ts (purs, testés sans DOM).
 */
import { useEffect, useState } from "react";
import { createStore } from "zustand/vanilla";
import { windowManagerStore, mirrorOpenState } from "../store/windowManager";
import {
  chargerEmetteurs,
  chargerHistoriqueAgrege,
  type EmetteurStablecoin,
  type PointSupply,
} from "../data/macro/stablecoinsDetail";
import {
  calculerDominance,
  deltaPct,
  ecartPegBps,
  impressionNette,
} from "./stablecoinsWindow.util";
import { formatUsd, formatPct, VALEUR_ABSENTE } from "../lib/format";
import { EnTeteFenetre, Onglets, Metric, Chargement, ErreurBloc, Vide, NoteSource, BTN_SECONDAIRE } from "./ui";

// ─────────────────────────── Store UI (vanilla, éphémère, non persisté) ───────────────────────────

export interface StablecoinsUiState {
  open: boolean;
  openStablecoins: () => void;
  closeStablecoins: () => void;
  toggleStablecoins: () => void;
}

export const stablecoinsUiStore = createStore<StablecoinsUiState>(() => ({
  open: false,
  openStablecoins: () => windowManagerStore.getState().openWindow("stablecoins"),
  closeStablecoins: () => windowManagerStore.getState().closeWindow("stablecoins"),
  toggleStablecoins: () => windowManagerStore.getState().toggleWindow("stablecoins"),
}));

mirrorOpenState("stablecoins", stablecoinsUiStore);

// ─────────────────────────── Formatage local (pur) ───────────────────────────

/** Δ USD signé compact ("+2,1 Md$" → formatUsd gère le compact ; on préfixe le signe). */
function fmtDeltaUsd(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return VALEUR_ABSENTE;
  return `${v >= 0 ? "+" : "−"}${formatUsd(Math.abs(v))}`;
}

/** Couleur token pour un delta (up/down/neutre). */
function couleurDelta(v: number | null): string | undefined {
  if (v === null || v === 0) return undefined;
  return v > 0 ? "var(--up)" : "var(--down)";
}

// ─────────────────────────── Onglets ───────────────────────────

type Onglet = "vue" | "impression" | "chaines" | "pegs";
type Statut = "loading" | "ready" | "error";

const ONGLETS: ReadonlyArray<{ id: Onglet; label: string }> = [
  { id: "vue", label: "Vue d'ensemble" },
  { id: "impression", label: "Impression" },
  { id: "chaines", label: "Chaînes" },
  { id: "pegs", label: "Pegs" },
];

// ─────────────────────────── Vue d'ensemble ───────────────────────────

function VueEnsemble({
  emetteurs,
  historique,
  onSelect,
}: {
  emetteurs: EmetteurStablecoin[];
  historique: PointSupply[];
  onSelect: (id: string) => void;
}) {
  const totalUsd = emetteurs.reduce((s, e) => s + e.mcapUsd, 0);
  const dominance = calculerDominance(emetteurs, 12);
  const d24h = impressionNette(historique, 1);
  const d7j = impressionNette(historique, 7);
  const d30j = impressionNette(historique, 30);
  const partUsdt = dominance.find((p) => p.symbole === "USDT")?.partPct ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Supply totale" value={formatUsd(totalUsd)} />
        <Metric
          label="Dominance USDT"
          value={partUsdt === null ? VALEUR_ABSENTE : formatPct(partUsdt)}
        />
        <Metric label="Δ 24 h" value={fmtDeltaUsd(d24h)} couleur={couleurDelta(d24h)} />
        <Metric label="Δ 7 j" value={fmtDeltaUsd(d7j)} couleur={couleurDelta(d7j)} />
        <Metric label="Δ 30 j" value={fmtDeltaUsd(d30j)} couleur={couleurDelta(d30j)} />
      </div>
      {/* Treemap de dominance — Task 4 */}
      <TableEmetteurs emetteurs={emetteurs} onSelect={onSelect} />
      <NoteSource>Données DefiLlama (stablecoins.llama.fi), rafraîchies ~5 min.</NoteSource>
    </div>
  );
}

/** Table des top émetteurs (mcap, part, Δ7 j, prix, mécanisme). Clic → drill-down. */
function TableEmetteurs({
  emetteurs,
  onSelect,
}: {
  emetteurs: EmetteurStablecoin[];
  onSelect: (id: string) => void;
}) {
  const total = emetteurs.reduce((s, e) => s + e.mcapUsd, 0);
  const tries = [...emetteurs].sort((a, b) => b.mcapUsd - a.mcapUsd).slice(0, 25);
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="border-b border-border text-left text-text-dim">
          <th className="py-1 pr-2 font-normal">Émetteur</th>
          <th className="py-1 pr-2 text-right font-normal">Supply</th>
          <th className="py-1 pr-2 text-right font-normal">Part</th>
          <th className="py-1 pr-2 text-right font-normal">Δ 7 j</th>
          <th className="py-1 pr-2 text-right font-normal">Prix</th>
          <th className="py-1 font-normal">Mécanisme</th>
        </tr>
      </thead>
      <tbody>
        {tries.map((e) => {
          const d7 = deltaPct(e.mcapUsd, e.mcap7jUsd);
          return (
            <tr
              key={e.id}
              onClick={() => onSelect(e.id)}
              className="cursor-pointer border-b border-border/50 hover:bg-bg"
            >
              <td className="py-1 pr-2 font-medium text-text">{e.symbole}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatUsd(e.mcapUsd)}</td>
              <td className="py-1 pr-2 text-right tabular-nums text-text-dim">
                {total > 0 ? formatPct((e.mcapUsd / total) * 100) : VALEUR_ABSENTE}
              </td>
              <td
                className="py-1 pr-2 text-right tabular-nums"
                style={{ color: couleurDelta(d7) }}
              >
                {d7 === null ? VALEUR_ABSENTE : formatPct(d7, { signe: true })}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">
                {e.prix === null ? VALEUR_ABSENTE : e.prix.toFixed(4)}
              </td>
              <td className="py-1 text-text-dim">{e.pegMechanism || VALEUR_ABSENTE}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─────────────────────────── Fenêtre ───────────────────────────

export function StablecoinsWindow() {
  const [onglet, setOnglet] = useState<Onglet>("vue");
  const [statut, setStatut] = useState<Statut>("loading");
  const [emetteurs, setEmetteurs] = useState<EmetteurStablecoin[] | null>(null);
  const [historique, setHistorique] = useState<PointSupply[] | null>(null);
  const [emetteurSelId, setEmetteurSelId] = useState<string | null>(null);
  const [essai, setEssai] = useState(0); // bouton « Réessayer »

  useEffect(() => {
    const ctrl = new AbortController();
    let ignore = false;
    setStatut("loading");
    void Promise.all([chargerEmetteurs(ctrl.signal), chargerHistoriqueAgrege(ctrl.signal)])
      .then(([liste, serie]) => {
        if (ignore) return;
        setEmetteurs(liste);
        setHistorique(serie);
        setStatut("ready");
      })
      .catch(() => {
        if (!ignore) setStatut("error");
      });
    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, [essai]);

  return (
    <>
      <EnTeteFenetre
        titre="Stablecoins"
        sousTitre="Supply, impression, dominance, pegs · DefiLlama"
      />
      <Onglets options={ONGLETS} actif={onglet} onChange={setOnglet} />
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {statut === "loading" && <Chargement />}
        {statut === "error" && (
          <ErreurBloc>
            Impossible de charger les données DefiLlama.{" "}
            <button type="button" className={BTN_SECONDAIRE} onClick={() => setEssai((n) => n + 1)}>
              Réessayer
            </button>
          </ErreurBloc>
        )}
        {statut === "ready" && emetteurs !== null && historique !== null && (
          <>
            {onglet === "vue" && (
              <VueEnsemble emetteurs={emetteurs} historique={historique} onSelect={setEmetteurSelId} />
            )}
            {onglet === "impression" && <Vide>Onglet Impression — Task 5.</Vide>}
            {onglet === "chaines" && <Vide>Onglet Chaînes — Task 6.</Vide>}
            {onglet === "pegs" && <Vide>Onglet Pegs — Task 7.</Vide>}
          </>
        )}
      </div>
    </>
  );
}
```

Note : `formatPct` — vérifier sa signature réelle dans `lib/format.ts:62` avant usage (l'option `{ signe: true }` est à adapter à l'API réelle ; si elle n'existe pas, préfixer manuellement `+`).
Note : `emetteurSelId` est posé dès cette task (l'état est consommé en Task 8 ; d'ici là le clic ne change encore rien à l'affichage). Si le lint `noUnusedLocals` bloque, préfixer l'usage par un rendu conditionnel minimal `{emetteurSelId !== null && null}` N'EST PAS acceptable — brancher plutôt directement Task 8 avant `pnpm check` final, ou retirer l'état et l'introduire en Task 8 (choix préféré : le retirer ici et l'ajouter en Task 8 ; `onSelect` reçoit alors `() => {}`).

- [ ] **Step 4 : Câblage App.tsx / windowPanels.ts / Toolbar.tsx**

`apps/web/src/App.tsx`, dans le map des fenêtres lazy (après `globe`, ligne ~163) :

```ts
  stablecoins: lazy(() =>
    import("./components/StablecoinsWindow").then((m) => ({ default: m.StablecoinsWindow })),
  ),
```

`apps/web/src/commands/windowPanels.ts`, à la fin du tableau `windowPanelCommands` :

```ts
  {
    id: "panneau:stablecoins",
    mnemonique: "STBL",
    libelle: "Stablecoins (supply, dominance, pegs)",
    categorie: "panneau",
    motsCles: [
      "stablecoins",
      "stable",
      "usdt",
      "usdc",
      "dai",
      "tether",
      "circle",
      "impression",
      "mint",
      "burn",
      "dominance",
      "peg",
      "depeg",
      "supply",
    ],
    apercu: "Ouvre / ferme l'analyse des stablecoins (DefiLlama)",
    action: basculer("stablecoins"),
  },
```

Mettre à jour le commentaire d'en-tête du fichier (liste des mnémoniques) pour y ajouter STBL.

`apps/web/src/components/Toolbar.tsx`, à la fin du tableau `FONCTIONS` (ligne ~149) :

```ts
  { mnemonique: "STBL", libelle: "Stablecoins (supply, dominance, pegs)", ouvrir: () => windowManagerStore.getState().openWindow("stablecoins") },
```

- [ ] **Step 5 : Vérifier (typecheck + tests + visuel)**

Run: `pnpm --filter @axiom/web exec tsc --noEmit -p .` (ou la cible typecheck du package) puis `pnpm --filter @axiom/web test`
Expected: PASS.
Visuel rapide : `pnpm --filter @axiom/web dev`, ⌘K → « STBL », vérifier metrics + table ; menu Fonctions → STBL.

- [ ] **Step 6 : Commit (fichiers nouveaux + fichiers propres uniquement)**

```bash
git add apps/web/src/components/StablecoinsWindow.tsx apps/web/src/commands/windowPanels.ts apps/web/src/components/Toolbar.tsx
git commit -m "feat(stbl): fenêtre Stablecoins — squelette, câblage, vue d'ensemble"
# windowManager.ts / windowManager.test.ts / App.tsx : WIP étranger, commit final groupé.
```

---

### Task 4 : Treemap de dominance (canvas)

**Files:**
- Modify: `apps/web/src/components/StablecoinsWindow.tsx` (remplacer le commentaire `{/* Treemap de dominance — Task 4 */}`)

**Interfaces:**
- Consumes: `squarify`, `type Rect`, `type Tuile` de `../lib/treemap` ; `lireTokenCanvas` de `../lib/canvasTokens` ; `PartDominance`/`calculerDominance` (Task 2). Layout et poids déjà testés (treemap.test.ts existant + util.test.ts) → pas de nouveau test, le dessin est impératif (convention MarketMapWindow).
- Produces: `function TreemapDominance({ parts, onSelect }: { parts: PartDominance[]; onSelect: (id: string) => void })` interne au fichier.

- [ ] **Step 1 : Implémentation**

Ajouter dans `StablecoinsWindow.tsx` (imports : `useRef` depuis react, `squarify, type Rect, type Tuile` depuis `../lib/treemap`, `lireTokenCanvas` depuis `../lib/canvasTokens`, `type PartDominance` depuis util) :

```tsx
// ─────────────────────────── Treemap dominance (canvas, impératif) ───────────────────────────

/** Dessine la treemap de dominance. PURE vis-à-vis de React (canvas + données seulement). */
function dessinerTreemap(canvas: HTMLCanvasElement, parts: PartDominance[]): Tuile<PartDominance>[] {
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const cssW = canvas.clientWidth || 400;
  const cssH = canvas.clientHeight || 180;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const cAccent = lireTokenCanvas("--accent", "#3b82f6");
  const cBorder = lireTokenCanvas("--border", "#374151");
  const cText = lireTokenCanvas("--text", "#e5e7eb");

  const conteneur: Rect = { x: 0, y: 0, w: cssW, h: cssH };
  const tuiles = squarify(parts, (p) => p.mcapUsd, conteneur);
  const partMax = parts[0]?.partPct ?? 100;

  for (const t of tuiles) {
    const { x, y, w, h } = t.rect;
    // Teinte accent dont l'ALPHA suit la part (dominant opaque, queue discrète) —
    // même famille de teinte sur les 5 thèmes, pas de palette en dur.
    ctx.globalAlpha = 0.25 + 0.65 * (t.item.partPct / partMax);
    ctx.fillStyle = cAccent;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cBorder;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (w > 46 && h > 26) {
      ctx.fillStyle = cText;
      ctx.font = "10px ui-sans-serif, system-ui";
      ctx.fillText(t.item.symbole, x + 5, y + 13, w - 10);
      ctx.fillText(`${t.item.partPct.toFixed(1)} %`, x + 5, y + 24, w - 10);
    }
  }
  return tuiles;
}

function TreemapDominance({
  parts,
  onSelect,
}: {
  parts: PartDominance[];
  onSelect: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tuilesRef = useRef<Tuile<PartDominance>[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) tuilesRef.current = dessinerTreemap(canvas, parts);
  }, [parts]);

  /** Hit-test au clic → drill-down (l'agrégat « Autres », id vide, est ignoré). */
  function surClic(ev: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const tuile = tuilesRef.current.find(
      (t) => px >= t.rect.x && px <= t.rect.x + t.rect.w && py >= t.rect.y && py <= t.rect.y + t.rect.h,
    );
    if (tuile && tuile.item.id !== "") onSelect(tuile.item.id);
  }

  return (
    <canvas
      ref={canvasRef}
      onClick={surClic}
      className="h-44 w-full cursor-pointer rounded-md border border-border"
    />
  );
}
```

Dans `VueEnsemble`, remplacer `{/* Treemap de dominance — Task 4 */}` par :

```tsx
      <TreemapDominance parts={dominance} onSelect={onSelect} />
```

- [ ] **Step 2 : Vérifier**

Run: `pnpm --filter @axiom/web test` (aucune régression) + contrôle visuel (treemap visible, labels lisibles, clic ne plante pas).
Expected: PASS.

- [ ] **Step 3 : Commit**

```bash
git add apps/web/src/components/StablecoinsWindow.tsx
git commit -m "feat(stbl): treemap de dominance canvas (squarify réutilisé)"
```

---

### Task 5 : Onglet Impression

**Files:**
- Modify: `apps/web/src/components/StablecoinsWindow.tsx` (remplacer le `Vide` de l'onglet impression)

**Interfaces:**
- Consumes: `serieImpressionQuotidienne`, `tronquerSerie`, `impressionNette`, `bornes`, `deltaPct` (Task 2) ; `PointSupply`, `EmetteurStablecoin` (Task 1) ; `lireTokenCanvas`.
- Produces: `function VueImpression({ emetteurs, historique }: { emetteurs: EmetteurStablecoin[]; historique: PointSupply[] })` interne.

- [ ] **Step 1 : Implémentation**

Ajouter dans `StablecoinsWindow.tsx` (imports supplémentaires : `serieImpressionQuotidienne`, `tronquerSerie`, `bornes` depuis util ; `formatDateCourte` depuis `../lib/format`) :

```tsx
// ─────────────────────────── Onglet Impression ───────────────────────────

type Periode = 30 | 90 | 365 | null; // null = tout

const PERIODES: ReadonlyArray<{ id: string; jours: Periode; label: string }> = [
  { id: "30j", jours: 30, label: "30 j" },
  { id: "90j", jours: 90, label: "90 j" },
  { id: "1a", jours: 365, label: "1 a" },
  { id: "tout", jours: null, label: "Tout" },
];

/**
 * Chart combiné : ligne de supply agrégée (échelle gauche) + barres de mint/burn net
 * quotidien (échelle propre, moitié basse). Impératif, tokens lus au dessin.
 */
function dessinerImpression(canvas: HTMLCanvasElement, serie: PointSupply[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const cssW = canvas.clientWidth || 400;
  const cssH = canvas.clientHeight || 220;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (serie.length < 2) return;

  const cUp = lireTokenCanvas("--up", "#22c55e");
  const cDown = lireTokenCanvas("--down", "#ef4444");
  const cAccent = lireTokenCanvas("--accent", "#3b82f6");
  const cGrid = lireTokenCanvas("--border", "#374151");

  const t0 = serie[0]!.time;
  const t1 = serie[serie.length - 1]!.time;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * cssW;

  // Moitié haute : ligne de supply.
  const hLigne = cssH * 0.55;
  const bSupply = bornes(serie.map((p) => p.totalUsd));
  if (bSupply) {
    const y = (v: number) =>
      hLigne - ((v - bSupply.min) / Math.max(1e-9, bSupply.max - bSupply.min)) * (hLigne - 8) - 4;
    ctx.strokeStyle = cGrid;
    ctx.strokeRect(0.5, 0.5, cssW - 1, hLigne - 1);
    ctx.beginPath();
    for (let i = 0; i < serie.length; i++) {
      const p = serie[i]!;
      if (i === 0) ctx.moveTo(x(p.time), y(p.totalUsd));
      else ctx.lineTo(x(p.time), y(p.totalUsd));
    }
    ctx.strokeStyle = cAccent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // Moitié basse : barres Δ quotidien (mint vert, burn rouge), zéro au centre.
  const deltas = serieImpressionQuotidienne(serie);
  const bDelta = bornes(deltas.map((d) => Math.abs(d.delta)));
  if (bDelta && bDelta.max > 0) {
    const y0 = hLigne + (cssH - hLigne) / 2;
    const demiH = (cssH - hLigne) / 2 - 4;
    ctx.strokeStyle = cGrid;
    ctx.beginPath();
    ctx.moveTo(0, y0 + 0.5);
    ctx.lineTo(cssW, y0 + 0.5);
    ctx.stroke();
    const larg = Math.max(1, (cssW / deltas.length) * 0.7);
    for (const d of deltas) {
      const h = (Math.abs(d.delta) / bDelta.max) * demiH;
      ctx.fillStyle = d.delta >= 0 ? cUp : cDown;
      ctx.fillRect(x(d.time) - larg / 2, d.delta >= 0 ? y0 - h : y0, larg, h);
    }
  }
}

function VueImpression({
  emetteurs,
  historique,
}: {
  emetteurs: EmetteurStablecoin[];
  historique: PointSupply[];
}) {
  const [periodeId, setPeriodeId] = useState("90j");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const periode = PERIODES.find((p) => p.id === periodeId) ?? PERIODES[1]!;
  const serie = tronquerSerie(historique, periode.jours);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) dessinerImpression(canvas, serie);
  }, [serie]);

  // Top mints / burns 7 j par émetteur (Δ absolu USD, pas %) — qui imprime, qui brûle.
  const avecDelta = emetteurs
    .filter((e) => e.mcap7jUsd !== null)
    .map((e) => ({ e, dUsd: e.mcapUsd - (e.mcap7jUsd ?? 0) }))
    .sort((a, b) => b.dUsd - a.dUsd);
  const mints = avecDelta.filter((x) => x.dUsd > 0).slice(0, 5);
  const burns = avecDelta.filter((x) => x.dUsd < 0).slice(-5).reverse();

  return (
    <div className="flex flex-col gap-3">
      <Onglets
        options={PERIODES.map((p) => ({ id: p.id, label: p.label }))}
        actif={periodeId}
        onChange={setPeriodeId}
      />
      <canvas ref={canvasRef} className="h-56 w-full rounded-md border border-border" />
      <div className="grid grid-cols-2 gap-3">
        <ListeDeltas titre="Top mints 7 j" lignes={mints} />
        <ListeDeltas titre="Top burns 7 j" lignes={burns} />
      </div>
      <NoteSource>
        Impression nette = Δ de supply circulante (mint − burn), points journaliers DefiLlama.
      </NoteSource>
    </div>
  );
}

function ListeDeltas({
  titre,
  lignes,
}: {
  titre: string;
  lignes: { e: EmetteurStablecoin; dUsd: number }[];
}) {
  return (
    <div className="rounded-md border border-border bg-bg px-3 py-2">
      <p className="mb-1 text-[11px] text-text-dim">{titre}</p>
      {lignes.length === 0 && <p className="text-[11px] text-text-dim">{VALEUR_ABSENTE}</p>}
      {lignes.map(({ e, dUsd }) => (
        <div key={e.id} className="flex justify-between text-[11px]">
          <span className="text-text">{e.symbole}</span>
          <span className="tabular-nums" style={{ color: couleurDelta(dUsd) }}>
            {fmtDeltaUsd(dUsd)}
          </span>
        </div>
      ))}
    </div>
  );
}
```

Remplacer `{onglet === "impression" && <Vide>Onglet Impression — Task 5.</Vide>}` par :

```tsx
            {onglet === "impression" && (
              <VueImpression emetteurs={emetteurs} historique={historique} />
            )}
```

Note : le sélecteur de période réutilise `<Onglets>` (id string) — pas de nouveau composant.

- [ ] **Step 2 : Vérifier**

Run: `pnpm --filter @axiom/web test` + visuel (ligne + barres, bascule 30 j/90 j/1 a/Tout).
Expected: PASS.

- [ ] **Step 3 : Commit**

```bash
git add apps/web/src/components/StablecoinsWindow.tsx
git commit -m "feat(stbl): onglet Impression (supply + mint/burn net, top mints/burns)"
```

---

### Task 6 : Onglet Chaînes

**Files:**
- Modify: `apps/web/src/components/StablecoinsWindow.tsx`

**Interfaces:**
- Consumes: `repartitionChaines`, `type PartChaine` (Task 2) ; `chargerHistoriqueChaine` (Task 1) ; `dessinerImpression` (Task 5, réutilisé tel quel pour l'historique de la chaîne).
- Produces: `function VueChaines({ emetteurs }: { emetteurs: EmetteurStablecoin[] })` interne.

- [ ] **Step 1 : Implémentation**

```tsx
// ─────────────────────────── Onglet Chaînes ───────────────────────────

function VueChaines({ emetteurs }: { emetteurs: EmetteurStablecoin[] }) {
  const parts = repartitionChaines(emetteurs);
  const [chaineSel, setChaineSel] = useState<string | null>(null);
  const [serie, setSerie] = useState<PointSupply[] | null>(null);
  const [statut, setStatut] = useState<"idle" | "loading" | "error">("idle");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (chaineSel === null) return;
    const ctrl = new AbortController();
    let ignore = false;
    setStatut("loading");
    setSerie(null);
    void chargerHistoriqueChaine(chaineSel, ctrl.signal)
      .then((s) => {
        if (ignore) return;
        setSerie(s);
        setStatut("idle");
      })
      .catch(() => {
        if (!ignore) setStatut("error");
      });
    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, [chaineSel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && serie !== null) dessinerImpression(canvas, tronquerSerie(serie, 365));
  }, [serie]);

  const partMax = parts[0]?.partPct ?? 100;

  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border text-left text-text-dim">
            <th className="py-1 pr-2 font-normal">Chaîne</th>
            <th className="py-1 pr-2 text-right font-normal">Supply</th>
            <th className="py-1 pr-2 text-right font-normal">Part</th>
            <th className="py-1 font-normal" />
          </tr>
        </thead>
        <tbody>
          {parts.slice(0, 15).map((p) => (
            <tr
              key={p.chaine}
              onClick={() => setChaineSel(p.chaine)}
              className={`cursor-pointer border-b border-border/50 hover:bg-bg ${
                chaineSel === p.chaine ? "bg-bg" : ""
              }`}
            >
              <td className="py-1 pr-2 font-medium text-text">{p.chaine}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatUsd(p.totalUsd)}</td>
              <td className="py-1 pr-2 text-right tabular-nums text-text-dim">
                {formatPct(p.partPct)}
              </td>
              <td className="py-1">
                {/* Barre de part relative — largeur en % de la part max (lisible même
                    quand Ethereum/Tron écrasent la queue). */}
                <div
                  className="h-1.5 rounded-sm bg-accent/60"
                  style={{ width: `${Math.max(2, (p.partPct / partMax) * 100)}%` }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {chaineSel !== null && (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-text-dim">Historique 1 a — {chaineSel}</p>
          {statut === "loading" && <Chargement />}
          {statut === "error" && <ErreurBloc>Historique indisponible pour {chaineSel}.</ErreurBloc>}
          <canvas
            ref={canvasRef}
            className={`h-48 w-full rounded-md border border-border ${serie === null ? "hidden" : ""}`}
          />
        </div>
      )}
      <NoteSource>Répartition courante par chaîne (tous émetteurs), DefiLlama.</NoteSource>
    </div>
  );
}
```

Remplacer le `Vide` de l'onglet chaines par `{onglet === "chaines" && <VueChaines emetteurs={emetteurs} />}`.

Note : `bg-accent/60` — si le token Tailwind `accent` n'accepte pas l'opacité par slash dans la config du projet, utiliser `style={{ background: "var(--accent)", opacity: 0.6 }}`. Vérifier au visuel.

- [ ] **Step 2 : Vérifier**

Run: `pnpm --filter @axiom/web test` + visuel (table triée, clic Ethereum → chart historique).
Expected: PASS.

- [ ] **Step 3 : Commit**

```bash
git add apps/web/src/components/StablecoinsWindow.tsx
git commit -m "feat(stbl): onglet Chaînes (répartition + historique par chaîne)"
```

---

### Task 7 : Onglet Pegs

**Files:**
- Modify: `apps/web/src/components/StablecoinsWindow.tsx`

**Interfaces:**
- Consumes: `ecartPegBps`, `etatPeg`, `type EtatPeg` (Task 2) ; `Badge`, `type TonBadge` de `./ui`.
- Produces: `function VuePegs({ emetteurs, onSelect }: { emetteurs: EmetteurStablecoin[]; onSelect: (id: string) => void })` interne.

- [ ] **Step 1 : Implémentation**

```tsx
// ─────────────────────────── Onglet Pegs ───────────────────────────

const TON_PEG: Record<EtatPeg, TonBadge> = { stable: "up", tension: "accent", depeg: "down" };
const LIBELLE_PEG: Record<EtatPeg, string> = { stable: "Stable", tension: "Tension", depeg: "DEPEG" };

function VuePegs({
  emetteurs,
  onSelect,
}: {
  emetteurs: EmetteurStablecoin[];
  onSelect: (id: string) => void;
}) {
  // Pegs USD avec prix, triés par écart absolu décroissant (les problèmes d'abord).
  const usd = emetteurs
    .map((e) => ({ e, bps: ecartPegBps(e) }))
    .filter((x): x is { e: EmetteurStablecoin; bps: number } => x.bps !== null)
    .sort((a, b) => Math.abs(b.bps) - Math.abs(a.bps));
  // Pegs non-USD : listés à part, prix brut sans bps (limite DefiLlama documentée au spec).
  const autres = emetteurs.filter((e) => e.pegType !== "peggedUSD").slice(0, 10);

  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border text-left text-text-dim">
            <th className="py-1 pr-2 font-normal">Émetteur</th>
            <th className="py-1 pr-2 text-right font-normal">Prix</th>
            <th className="py-1 pr-2 text-right font-normal">Écart</th>
            <th className="py-1 pr-2 text-right font-normal">Supply</th>
            <th className="py-1 font-normal">État</th>
          </tr>
        </thead>
        <tbody>
          {usd.slice(0, 30).map(({ e, bps }) => {
            const etat = etatPeg(bps);
            return (
              <tr
                key={e.id}
                onClick={() => onSelect(e.id)}
                className="cursor-pointer border-b border-border/50 hover:bg-bg"
              >
                <td className="py-1 pr-2 font-medium text-text">{e.symbole}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{e.prix!.toFixed(4)}</td>
                <td
                  className="py-1 pr-2 text-right tabular-nums"
                  style={{ color: couleurDelta(-Math.abs(bps) || null) }}
                >
                  {bps >= 0 ? "+" : "−"}
                  {Math.abs(bps).toFixed(1)} bps
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatUsd(e.mcapUsd)}</td>
                <td className="py-1">
                  <Badge ton={TON_PEG[etat]}>{LIBELLE_PEG[etat]}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {autres.length > 0 && (
        <div className="rounded-md border border-border bg-bg px-3 py-2">
          <p className="mb-1 text-[11px] text-text-dim">
            Pegs non-USD (prix USD brut — écart non calculé)
          </p>
          {autres.map((e) => (
            <div key={e.id} className="flex justify-between text-[11px]">
              <span className="text-text">
                {e.symbole} <span className="text-text-dim">({e.pegType.replace("pegged", "")})</span>
              </span>
              <span className="tabular-nums">
                {e.prix === null ? VALEUR_ABSENTE : e.prix.toFixed(4)}
              </span>
            </div>
          ))}
        </div>
      )}
      <NoteSource>
        Seuils : stable &lt; 25 bps · tension &lt; 100 bps · depeg ≥ 100 bps (écart absolu vs 1,00 $).
      </NoteSource>
    </div>
  );
}
```

Remplacer le `Vide` de l'onglet pegs par `{onglet === "pegs" && <VuePegs emetteurs={emetteurs} onSelect={setEmetteurSelId} />}` (ou `onSelect={() => {}}` si Task 8 pas encore branchée — voir note Task 3).

Note : vérifier la prop réelle de `Badge` dans `ui.tsx:136` (`ton` supposé — adapter si elle s'appelle autrement).
Note : `couleurDelta(-Math.abs(bps) || null)` colore tout écart non nul en rouge (un écart de peg n'est jamais « bon ») ; `-0 || null → null` garde le neutre à zéro.

- [ ] **Step 2 : Vérifier**

Run: `pnpm --filter @axiom/web test` + visuel (tri par écart, badges 3 états, section non-USD).
Expected: PASS.

- [ ] **Step 3 : Commit**

```bash
git add apps/web/src/components/StablecoinsWindow.tsx
git commit -m "feat(stbl): onglet Pegs (écarts bps, badges stable/tension/depeg)"
```

---

### Task 8 : Drill-down émetteur

**Files:**
- Modify: `apps/web/src/components/StablecoinsWindow.tsx`

**Interfaces:**
- Consumes: `chargerDetailEmetteur`, `type DetailEmetteur` (Task 1) ; `agregerHistoriqueEmetteur`, `impressionNette`, `tronquerSerie` (Task 2) ; `dessinerImpression` (Task 5) ; `BTN_SECONDAIRE` (ui).
- Produces: `function VueEmetteur({ id, onRetour }: { id: string; onRetour: () => void })` interne ; branche l'état `emetteurSelId` posé en Task 3.

- [ ] **Step 1 : Implémentation**

```tsx
// ─────────────────────────── Drill-down émetteur ───────────────────────────

function VueEmetteur({ id, onRetour }: { id: string; onRetour: () => void }) {
  const [detail, setDetail] = useState<DetailEmetteur | null>(null);
  const [statut, setStatut] = useState<"loading" | "ready" | "error">("loading");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    let ignore = false;
    setStatut("loading");
    void chargerDetailEmetteur(id, ctrl.signal)
      .then((d) => {
        if (ignore) return;
        setDetail(d);
        setStatut("ready");
      })
      .catch(() => {
        if (!ignore) setStatut("error");
      });
    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, [id]);

  const historique = detail !== null ? agregerHistoriqueEmetteur(detail) : [];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && historique.length > 0) dessinerImpression(canvas, tronquerSerie(historique, 365));
    // historique est dérivé de detail — detail suffit comme dépendance.
  }, [detail]); // eslint-disable-line react-hooks/exhaustive-deps

  // Répartition par chaîne au DERNIER point de chaque série.
  const chaines =
    detail === null
      ? []
      : Object.entries(detail.historiqueParChaine)
          .map(([chaine, serie]) => ({ chaine, usd: serie[serie.length - 1]?.totalUsd ?? 0 }))
          .sort((a, b) => b.usd - a.usd);
  const totalChaines = chaines.reduce((s, c) => s + c.usd, 0);
  const d7 = impressionNette(historique, 7);
  const d30 = impressionNette(historique, 30);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button type="button" className={BTN_SECONDAIRE} onClick={onRetour}>
          ← Retour
        </button>
        {detail !== null && (
          <span className="text-[11px] text-text-dim">
            {detail.nom} · {detail.pegMechanism || VALEUR_ABSENTE}
          </span>
        )}
      </div>
      {statut === "loading" && <Chargement />}
      {statut === "error" && <ErreurBloc>Détail indisponible pour cet émetteur.</ErreurBloc>}
      {statut === "ready" && detail !== null && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Metric
              label="Supply"
              value={formatUsd(historique[historique.length - 1]?.totalUsd ?? null)}
            />
            <Metric
              label="Prix"
              value={detail.prix === null ? VALEUR_ABSENTE : detail.prix.toFixed(4)}
            />
            <Metric label="Δ 7 j" value={fmtDeltaUsd(d7)} couleur={couleurDelta(d7)} />
            <Metric label="Δ 30 j" value={fmtDeltaUsd(d30)} couleur={couleurDelta(d30)} />
          </div>
          <p className="text-[11px] text-text-dim">Historique 1 a — {detail.symbole}</p>
          <canvas ref={canvasRef} className="h-48 w-full rounded-md border border-border" />
          <div className="rounded-md border border-border bg-bg px-3 py-2">
            <p className="mb-1 text-[11px] text-text-dim">Répartition par chaîne</p>
            {chaines.slice(0, 10).map((c) => (
              <div key={c.chaine} className="flex justify-between text-[11px]">
                <span className="text-text">{c.chaine}</span>
                <span className="tabular-nums">
                  {formatUsd(c.usd)}{" "}
                  <span className="text-text-dim">
                    ({totalChaines > 0 ? formatPct((c.usd / totalChaines) * 100) : VALEUR_ABSENTE})
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

Dans le corps de `StablecoinsWindow`, envelopper le contenu `ready` : si `emetteurSelId !== null`, rendre `<VueEmetteur id={emetteurSelId} onRetour={() => setEmetteurSelId(null)} />` À LA PLACE des onglets (les onglets et leur barre restent masqués pendant le drill-down) :

```tsx
        {statut === "ready" && emetteurs !== null && historique !== null && (
          emetteurSelId !== null ? (
            <VueEmetteur id={emetteurSelId} onRetour={() => setEmetteurSelId(null)} />
          ) : (
            <>
              {onglet === "vue" && (
                <VueEnsemble emetteurs={emetteurs} historique={historique} onSelect={setEmetteurSelId} />
              )}
              {onglet === "impression" && <VueImpression emetteurs={emetteurs} historique={historique} />}
              {onglet === "chaines" && <VueChaines emetteurs={emetteurs} />}
              {onglet === "pegs" && <VuePegs emetteurs={emetteurs} onSelect={setEmetteurSelId} />}
            </>
          )
        )}
```

(La barre `<Onglets>` du haut peut rester visible ; changer d'onglet pendant un drill-down referme la fiche via `setEmetteurSelId(null)` dans `onChange` — brancher : `onChange={(id) => { setEmetteurSelId(null); setOnglet(id); }}`.)

- [ ] **Step 2 : Vérifier**

Run: `pnpm --filter @axiom/web test` + visuel (clic USDT dans table/treemap/pegs → fiche, retour OK, changement d'onglet referme la fiche).
Expected: PASS.

- [ ] **Step 3 : Commit**

```bash
git add apps/web/src/components/StablecoinsWindow.tsx
git commit -m "feat(stbl): drill-down émetteur (historique, chaînes, deltas)"
```

---

### Task 9 : Vérification finale

**Files:**
- Aucun nouveau fichier — vérification + décision de commit des fichiers partagés.

- [ ] **Step 1 : Suite complète**

Run: `pnpm check` (typecheck + tests + build web).
Expected: PASS — 0 régression sur les ~1341 cas existants.

- [ ] **Step 2 : Gate visuel**

`pnpm --filter @axiom/web dev` → ⌘K « STBL » ET menu Fonctions → STBL. Vérifier : 4 onglets, treemap, drill-down, états loading/erreur (couper le réseau), et passer les 5 thèmes (les canvas relisent les tokens au dessin).

- [ ] **Step 3 : Bilan des fichiers partagés**

`git status` — il doit rester en non-commité : `windowManager.ts`, `windowManager.test.ts`, `App.tsx` (mes hunks STBL + WIP étranger mêlés). Présenter à Zaki : soit commit groupé « feat(stbl): câblage registre/App », soit il committe son WIP d'abord. NE PAS committer sans décision.
