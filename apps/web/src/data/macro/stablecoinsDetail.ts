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
