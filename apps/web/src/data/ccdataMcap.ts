import type { McapSnapshot } from "../store/macroHistory";
import { getCcDataApiKey } from "../store/ccdata";
import { minuitUtc } from "./mcap";

const API_URL = "/ccdataapi/data/overview/v1/historical/marketcap/all-assets/days";
const PAGE_LIMIT = 2_000;
const MAX_PAGES = 10;
const CACHE_TTL_MS = 12 * 60 * 60_000;
export const CLE_CACHE_CCDATA = "axiom:mcap:ccdata:v1";

export interface CcDataMcapPoint {
  t: number;
  total: number;
  dominanceBtc: number | null;
  dominanceEth: number | null;
}

interface CacheCcData {
  version: 1;
  majTs: number;
  points: CcDataMcapPoint[];
}

export interface FetchCcDataDeps {
  fetcher?: typeof fetch;
  pageLimit?: number;
  maxPages?: number;
  signal?: AbortSignal;
}

export interface ChargerCcDataDeps extends FetchCcDataDeps {
  apiKey?: string | null;
  maintenant?: () => number;
}

export class ErreurCcData extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = "ErreurCcData";
  }
}

function verifierAnnulation(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Chargement CCData annulé", "AbortError");
}

function dominance(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

function timestampMs(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number >= 1e12 ? number : number * 1000;
}

export function normaliserPointsCcData(raw: unknown): CcDataMcapPoint[] {
  if (!Array.isArray(raw)) return [];
  const parJour = new Map<number, CcDataMcapPoint>();
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const timestamp = timestampMs(record.TIMESTAMP);
    const total = Number(record.MKT_CAP_USD);
    if (timestamp === null || !Number.isFinite(total) || total <= 0) continue;
    const t = minuitUtc(timestamp);
    parJour.set(t, {
      t,
      total,
      dominanceBtc: dominance(record.DOMINANCE_BTC),
      dominanceEth: dominance(record.DOMINANCE_ETH),
    });
  }
  return [...parJour.values()].sort((a, b) => a.t - b.t);
}

export function snapshotsCcData(points: readonly CcDataMcapPoint[]): McapSnapshot[] {
  return points.map((point) => {
    const total2 = point.dominanceBtc === null
      ? Number.NaN
      : Math.max(0, point.total * (1 - point.dominanceBtc / 100));
    const total3 = point.dominanceBtc === null || point.dominanceEth === null
      ? Number.NaN
      : Math.max(0, point.total * (1 - (point.dominanceBtc + point.dominanceEth) / 100));
    return { t: point.t, total: point.total, total2, total3 };
  });
}

function messageErreur(json: unknown): string | null {
  if (json === null || typeof json !== "object") return null;
  const record = json as Record<string, unknown>;
  const err = record.Err;
  if (err !== null && typeof err === "object") {
    const message = (err as Record<string, unknown>).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  const message = record.Message ?? record.message;
  return typeof message === "string" && message.length > 0 ? message : null;
}

function dataDepuisReponse(json: unknown): unknown[] | null {
  if (json === null || typeof json !== "object") return null;
  const data = (json as Record<string, unknown>).Data;
  if (Array.isArray(data)) return data;
  if (data !== null && typeof data === "object") {
    const nested = (data as Record<string, unknown>).Data;
    if (Array.isArray(nested)) return nested;
  }
  return null;
}

async function fetchPage(
  apiKey: string,
  toTs: number | undefined,
  deps: FetchCcDataDeps,
): Promise<{ brut: unknown[]; points: CcDataMcapPoint[] }> {
  const limit = Math.min(PAGE_LIMIT, Math.max(1, Math.floor(deps.pageLimit ?? PAGE_LIMIT)));
  const params = new URLSearchParams({ quote_asset: "USD", limit: String(limit) });
  if (toTs !== undefined) params.set("to_ts", String(toTs));

  verifierAnnulation(deps.signal);
  let response: Response;
  try {
    response = await (deps.fetcher ?? fetch)(`${API_URL}?${params}`, {
      headers: { Accept: "application/json", Authorization: `Apikey ${apiKey}` },
      signal: deps.signal,
    });
  } catch {
    verifierAnnulation(deps.signal);
    throw new ErreurCcData("CCData est injoignable ou bloqué par le navigateur.");
  }
  verifierAnnulation(deps.signal);
  const json = (await response.json().catch(() => null)) as unknown;
  verifierAnnulation(deps.signal);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ErreurCcData(
        "CCData refuse la clé ou l’accès à l’historique. Vérifie la clé gratuite dans Réglages.",
        response.status,
      );
    }
    throw new ErreurCcData(
      `CCData indisponible (HTTP ${response.status}${messageErreur(json) ? ` · ${messageErreur(json)}` : ""}).`,
      response.status,
    );
  }
  const brut = dataDepuisReponse(json);
  if (brut === null) {
    throw new ErreurCcData(messageErreur(json) ?? "Réponse historique CCData invalide.");
  }
  return { brut, points: normaliserPointsCcData(brut) };
}

function fusionnerPoints(
  anciens: readonly CcDataMcapPoint[],
  nouveaux: readonly CcDataMcapPoint[],
): CcDataMcapPoint[] {
  const parJour = new Map<number, CcDataMcapPoint>();
  for (const point of anciens) parJour.set(point.t, point);
  for (const point of nouveaux) parJour.set(point.t, point);
  return [...parJour.values()].sort((a, b) => a.t - b.t);
}

export async function fetchHistoriqueCcData(
  apiKey: string,
  deps: FetchCcDataDeps = {},
): Promise<CcDataMcapPoint[]> {
  const key = apiKey.trim();
  if (key.length === 0) throw new ErreurCcData("Clé CCData absente.");
  const limit = Math.min(PAGE_LIMIT, Math.max(1, Math.floor(deps.pageLimit ?? PAGE_LIMIT)));
  const maxPages = Math.max(1, Math.floor(deps.maxPages ?? MAX_PAGES));
  let points: CcDataMcapPoint[] = [];
  let toTs: number | undefined;
  let termine = false;

  for (let page = 0; page < maxPages; page += 1) {
    verifierAnnulation(deps.signal);
    const result = await fetchPage(key, toTs, deps);
    if (result.brut.length === 0) {
      termine = true;
      break;
    }
    if (result.points.length === 0) throw new ErreurCcData("Page historique CCData sans point valide.");
    points = fusionnerPoints(points, result.points);
    if (result.brut.length < limit) {
      termine = true;
      break;
    }
    const earliest = result.points[0]?.t;
    if (earliest === undefined) throw new ErreurCcData("Pagination historique CCData invalide.");
    const suivant = Math.floor(earliest / 1000) - 1;
    if (toTs !== undefined && suivant >= toTs) {
      throw new ErreurCcData("Pagination historique CCData bloquée.");
    }
    toTs = suivant;
  }

  if (!termine) throw new ErreurCcData("Historique CCData tronqué avant sa première date disponible.");
  verifierAnnulation(deps.signal);
  return points;
}

function lireCache(): CacheCcData | null {
  try {
    const raw = localStorage.getItem(CLE_CACHE_CCDATA);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<CacheCcData>;
    if (parsed.version !== 1 || !Number.isFinite(parsed.majTs) || !Array.isArray(parsed.points)) {
      return null;
    }
    const points: CcDataMcapPoint[] = [];
    for (const item of parsed.points as unknown[]) {
      if (item === null || typeof item !== "object") continue;
      const point = item as Record<string, unknown>;
      const t = Number(point.t);
      const total = Number(point.total);
      if (!Number.isFinite(t) || !Number.isFinite(total) || total <= 0) continue;
      points.push({
        t,
        total,
        dominanceBtc: dominance(point.dominanceBtc),
        dominanceEth: dominance(point.dominanceEth),
      });
    }
    if (points.length === 0) return null;
    return { version: 1, majTs: parsed.majTs as number, points: fusionnerPoints([], points) };
  } catch {
    return null;
  }
}

function ecrireCache(points: CcDataMcapPoint[], majTs: number): void {
  try {
    localStorage.setItem(CLE_CACHE_CCDATA, JSON.stringify({ version: 1, majTs, points }));
  } catch {
    return;
  }
}

export function historiqueCcDataDisponible(): boolean {
  return lireCache() !== null || getCcDataApiKey() !== null;
}

async function chargerInterne(deps: ChargerCcDataDeps): Promise<McapSnapshot[] | null> {
  verifierAnnulation(deps.signal);
  const cache = lireCache();
  const apiKey = Object.prototype.hasOwnProperty.call(deps, "apiKey")
    ? (deps.apiKey?.trim() || null)
    : getCcDataApiKey();
  const maintenant = deps.maintenant ?? Date.now;
  const now = maintenant();

  if (cache !== null && (apiKey === null || now - cache.majTs < CACHE_TTL_MS)) {
    return snapshotsCcData(cache.points);
  }
  if (apiKey === null) return cache === null ? null : snapshotsCcData(cache.points);

  if (cache !== null) {
    try {
      const recent = await fetchPage(apiKey, undefined, deps);
      verifierAnnulation(deps.signal);
      const points = fusionnerPoints(cache.points, recent.points);
      ecrireCache(points, now);
      return snapshotsCcData(points);
    } catch {
      verifierAnnulation(deps.signal);
      return snapshotsCcData(cache.points);
    }
  }

  const points = await fetchHistoriqueCcData(apiKey, deps);
  verifierAnnulation(deps.signal);
  ecrireCache(points, now);
  return snapshotsCcData(points);
}

let chargementEnCours: {
  apiKey: string | null;
  controleur: AbortController;
  promise: Promise<McapSnapshot[] | null>;
} | null = null;

export function chargerHistoriqueCcData(
  deps: ChargerCcDataDeps = {},
): Promise<McapSnapshot[] | null> {
  const injecte =
    deps.fetcher !== undefined ||
    deps.pageLimit !== undefined ||
    deps.maxPages !== undefined ||
    deps.signal !== undefined ||
    deps.apiKey !== undefined ||
    deps.maintenant !== undefined;
  if (injecte) return chargerInterne(deps);

  const apiKey = getCcDataApiKey();
  if (chargementEnCours?.apiKey === apiKey) return chargementEnCours.promise;
  chargementEnCours?.controleur.abort();
  const controleur = new AbortController();
  const promise = chargerInterne({ apiKey, signal: controleur.signal }).finally(() => {
    if (chargementEnCours?.promise === promise) chargementEnCours = null;
  });
  chargementEnCours = { apiKey, controleur, promise };
  return promise;
}
