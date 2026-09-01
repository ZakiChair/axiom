import type { McapSnapshot } from "../store/macroHistory";
import { extUrl } from "./extapi";
import { JOUR_MS } from "./mcap";

const HOST = "api.coinmarketcap.com";
const GLOBAL_PATH = "data-api/v3/global-metrics/quotes/historical";
const ETH_PATH = "data-api/v3.3/cryptocurrency/detail/chart";
export const DEBUT_HISTORIQUE_CMC = Date.UTC(2013, 11, 31);
const LANCEMENT_ETH = Date.UTC(2015, 7, 7);
const HEURE_MS = 3_600_000;
const TAILLE_LOT_POINTS = 2_200;
const TAILLE_LOT_ETH_POINTS = 10_000;
const CACHE_TTL_MS = 12 * 60 * 60_000;
export const CLE_CACHE_CMC = "axiom:mcap:cmc-public:v1";
let cmcDisponible = false;
const pagesEnCours = new Map<string, Promise<McapSnapshot[]>>();

export interface GlobalCmcPoint {
  t: number;
  total: number;
  total2: number;
  dominanceEth: number | null;
}

interface CacheCmcPoint {
  t: number;
  total: number;
  total2: number;
  total3: number | null;
}

interface CacheCmc {
  version: 1;
  majTs: number;
  points: CacheCmcPoint[];
}

export type IntervalleCmc = "1h" | "4h" | "1d";

export interface FetchCmcDeps {
  fetcher?: typeof fetch;
  debut?: number;
  fin?: number;
  intervalle?: IntervalleCmc;
  tailleLotPoints?: number;
  tailleLotEthPoints?: number;
  signal?: AbortSignal;
}

export interface ChargerCmcDeps extends FetchCmcDeps {
  maintenant?: () => number;
}

function erreurCode(json: unknown): string | null {
  if (json === null || typeof json !== "object") return null;
  const status = (json as Record<string, unknown>).status;
  if (status === null || typeof status !== "object") return null;
  const code = (status as Record<string, unknown>).error_code;
  return code === undefined || String(code) === "0" ? null : String(code);
}

function timestamp(value: unknown): number | null {
  const parsed = typeof value === "string" && !/^\d+$/.test(value)
    ? Date.parse(value)
    : Number(value) * 1000;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function dominance(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

export function normaliserGlobalCmc(json: unknown): GlobalCmcPoint[] {
  if (erreurCode(json) !== null || json === null || typeof json !== "object") return [];
  const data = (json as Record<string, unknown>).data;
  if (data === null || typeof data !== "object") return [];
  const quotes = (data as Record<string, unknown>).quotes;
  if (!Array.isArray(quotes)) return [];

  const parJour = new Map<number, GlobalCmcPoint>();
  for (const item of quotes) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const t = timestamp(record.timestamp);
    const rawQuotes = record.quote;
    if (t === null || !Array.isArray(rawQuotes)) continue;
    const quote = rawQuotes.find(
      (candidate) => candidate !== null && typeof candidate === "object" &&
        String((candidate as Record<string, unknown>).name) === "2781",
    ) ?? rawQuotes[0];
    if (quote === null || typeof quote !== "object") continue;
    const values = quote as Record<string, unknown>;
    const total = Number(values.totalMarketCap);
    if (!Number.isFinite(total) || total <= 0) continue;
    const btc = dominance(record.btcDominance);
    const rawAltcoin = values.altcoinMarketCap;
    const altcoin = rawAltcoin === null || rawAltcoin === undefined
      ? Number.NaN
      : Number(rawAltcoin);
    const total2 = Number.isFinite(altcoin) && altcoin >= 0
      ? altcoin
      : btc === null ? Number.NaN : total * (1 - btc / 100);
    if (!Number.isFinite(total2) || total2 < 0) continue;
    parJour.set(t, { t, total, total2, dominanceEth: dominance(record.ethDominance) });
  }
  return [...parJour.values()].sort((a, b) => a.t - b.t);
}

export function normaliserEthCmc(json: unknown): Map<number, number> {
  const result = new Map<number, number>();
  if (erreurCode(json) !== null || json === null || typeof json !== "object") return result;
  const data = (json as Record<string, unknown>).data;
  if (data === null || typeof data !== "object") return result;
  const points = (data as Record<string, unknown>).points;
  if (!Array.isArray(points)) return result;
  for (const item of points) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const t = timestamp(record.s);
    const values = record.v;
    const rawMarketCap = Array.isArray(values) ? values[2] : null;
    const marketCap = rawMarketCap === null || rawMarketCap === undefined
      ? Number.NaN
      : Number(rawMarketCap);
    if (t !== null && Number.isFinite(marketCap) && marketCap >= 0) result.set(t, marketCap);
  }
  return result;
}

export function construireSnapshotsCmc(
  globaux: readonly GlobalCmcPoint[],
  ethParJour: ReadonlyMap<number, number>,
): McapSnapshot[] {
  return globaux.map((point) => {
    const eth = ethParJour.get(point.t) ??
      (point.t < LANCEMENT_ETH
        ? 0
        : point.dominanceEth !== null && point.dominanceEth > 0
          ? point.total * point.dominanceEth / 100
          : Number.NaN);
    const total3 = Number.isFinite(eth) ? Math.max(0, point.total2 - eth) : Number.NaN;
    return { t: point.t, total: point.total, total2: point.total2, total3 };
  });
}

async function fetchJson(
  path: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetcher(extUrl(HOST, path), { signal: signal ?? AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`CoinMarketCap public HTTP ${response.status}`);
  const json = (await response.json()) as unknown;
  const code = erreurCode(json);
  if (code !== null) throw new Error(`CoinMarketCap public erreur ${code}`);
  return json;
}

function pasIntervalle(intervalle: IntervalleCmc): number {
  return intervalle === "1h" ? HEURE_MS : intervalle === "4h" ? 4 * HEURE_MS : JOUR_MS;
}

function alignerTemps(value: number, intervalle: IntervalleCmc): number {
  const pas = pasIntervalle(intervalle);
  return Math.floor(value / pas) * pas;
}

function plages(
  debut: number,
  fin: number,
  tailleLotPoints: number,
  intervalle: IntervalleCmc,
): Array<{ debut: number; fin: number }> {
  const result: Array<{ debut: number; fin: number }> = [];
  const pas = pasIntervalle(intervalle);
  let curseur = alignerTemps(debut, intervalle);
  const dernier = alignerTemps(fin, intervalle);
  const largeur = Math.max(1, Math.floor(tailleLotPoints)) * pas;
  while (curseur <= dernier) {
    const finLot = Math.min(dernier, curseur + largeur - pas);
    result.push({ debut: curseur, fin: finLot });
    curseur = finLot + pas;
  }
  return result;
}

export async function fetchHistoriqueCmc(deps: FetchCmcDeps = {}): Promise<McapSnapshot[]> {
  const fetcher = deps.fetcher ?? fetch;
  const intervalle = deps.intervalle ?? "1d";
  const debut = Math.max(
    DEBUT_HISTORIQUE_CMC,
    alignerTemps(deps.debut ?? DEBUT_HISTORIQUE_CMC, intervalle),
  );
  const fin = alignerTemps(deps.fin ?? Date.now(), intervalle);
  if (fin < debut) return [];

  const chargerGlobaux = async () => {
    const globaux: GlobalCmcPoint[] = [];
    for (const plage of plages(debut, fin, deps.tailleLotPoints ?? TAILLE_LOT_POINTS, intervalle)) {
      const json = await fetchJson(
        `${GLOBAL_PATH}?${new URLSearchParams({
          convertId: "2781",
          timeStart: String(Math.floor(plage.debut / 1000)),
          timeEnd: String(Math.floor(plage.fin / 1000)),
          interval: intervalle,
        })}`,
        fetcher,
        deps.signal,
      );
      const points = normaliserGlobalCmc(json).filter(
        (point) => point.t >= plage.debut && point.t <= plage.fin,
      );
      if (points.length === 0) throw new Error("CoinMarketCap public ne renvoie aucun historique global");
      globaux.push(...points);
    }
    return globaux;
  };

  const chargerEth = async () => {
    const ethDebut = Math.max(debut, LANCEMENT_ETH);
    const intervalleEth: IntervalleCmc = intervalle === "1d" ? "1d" : "1h";
    const ethParJour = new Map<number, number>();
    if (ethDebut > fin) return ethParJour;
    for (const plage of plages(
      ethDebut,
      fin,
      deps.tailleLotEthPoints ?? TAILLE_LOT_ETH_POINTS,
      intervalleEth,
    )) {
      const json = await fetchJson(
        `${ETH_PATH}?${new URLSearchParams({
          id: "1027",
          timeStart: String(Math.floor(plage.debut / 1000)),
          timeEnd: String(Math.floor(plage.fin / 1000)),
          interval: intervalleEth,
        })}`,
        fetcher,
        deps.signal,
      );
      for (const [t, marketCap] of normaliserEthCmc(json)) ethParJour.set(t, marketCap);
    }
    return ethParJour;
  };

  const [globaux, ethParJour] = await Promise.all([chargerGlobaux(), chargerEth()]);
  return construireSnapshotsCmc(globaux, ethParJour);
}

export interface PageHistoriqueCmcOptions {
  endTime?: number;
  limit?: number;
  fetcher?: typeof fetch;
  tailleLotPoints?: number;
  tailleLotEthPoints?: number;
  signal?: AbortSignal;
}

export function fetchPageHistoriqueCmc(
  intervalle: IntervalleCmc,
  options: PageHistoriqueCmcOptions = {},
): Promise<McapSnapshot[]> {
  const fin = alignerTemps(options.endTime ?? Date.now(), intervalle);
  const limit = Math.max(1, Math.floor(options.limit ?? 500));
  const debut = Math.max(DEBUT_HISTORIQUE_CMC, fin - (limit - 1) * pasIntervalle(intervalle));
  const charger = () => fetchHistoriqueCmc({
    fetcher: options.fetcher,
    debut,
    fin,
    intervalle,
    tailleLotPoints: options.tailleLotPoints,
    tailleLotEthPoints: options.tailleLotEthPoints,
    signal: options.signal,
  }).then((points) => {
    if (points.length > 0) cmcDisponible = true;
    return points;
  });
  const injecte = options.fetcher !== undefined || options.tailleLotPoints !== undefined ||
    options.tailleLotEthPoints !== undefined || options.signal !== undefined;
  if (injecte) return charger();
  const key = `${intervalle}:${debut}:${fin}`;
  const existante = pagesEnCours.get(key);
  if (existante !== undefined) return existante;
  const promise = charger().finally(() => {
    if (pagesEnCours.get(key) === promise) pagesEnCours.delete(key);
  });
  pagesEnCours.set(key, promise);
  return promise;
}

function cachePoints(points: readonly McapSnapshot[]): CacheCmcPoint[] {
  return points
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.total) && Number.isFinite(point.total2))
    .map((point) => ({
      t: point.t,
      total: point.total,
      total2: point.total2,
      total3: Number.isFinite(point.total3) ? point.total3 : null,
    }));
}

function snapshotsCache(points: readonly CacheCmcPoint[]): McapSnapshot[] {
  return points.map((point) => ({
    t: point.t,
    total: point.total,
    total2: point.total2,
    total3: point.total3 ?? Number.NaN,
  }));
}

function lireCache(): CacheCmc | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CLE_CACHE_CMC) ?? "null") as Partial<CacheCmc> | null;
    if (parsed?.version !== 1 || !Number.isFinite(parsed.majTs) || !Array.isArray(parsed.points)) return null;
    const points = parsed.points.filter((point): point is CacheCmcPoint =>
      point !== null && typeof point === "object" &&
      Number.isFinite(point.t) && Number.isFinite(point.total) && point.total > 0 &&
      Number.isFinite(point.total2) && point.total2 >= 0 &&
      (point.total3 === null || Number.isFinite(point.total3)),
    );
    return points.length > 0 ? { version: 1, majTs: parsed.majTs as number, points } : null;
  } catch {
    return null;
  }
}

function ecrireCache(points: readonly McapSnapshot[], majTs: number): void {
  try {
    localStorage.setItem(CLE_CACHE_CMC, JSON.stringify({ version: 1, majTs, points: cachePoints(points) }));
  } catch {
    return;
  }
}

function fusionner(anciens: readonly McapSnapshot[], nouveaux: readonly McapSnapshot[]): McapSnapshot[] {
  const parJour = new Map<number, McapSnapshot>();
  for (const point of anciens) parJour.set(point.t, point);
  for (const point of nouveaux) parJour.set(point.t, point);
  return [...parJour.values()].sort((a, b) => a.t - b.t);
}

export function historiqueCmcDisponible(): boolean {
  return cmcDisponible || lireCache() !== null;
}

async function chargerInterne(deps: ChargerCmcDeps): Promise<McapSnapshot[] | null> {
  const cache = lireCache();
  const maintenant = deps.maintenant ?? Date.now;
  const now = maintenant();
  if (cache !== null && now - cache.majTs < CACHE_TTL_MS) {
    cmcDisponible = true;
    return snapshotsCache(cache.points);
  }
  try {
    // La fenêtre incrémentale doit TOUJOURS rejoindre la fin du cache : un terminal
    // rouvert après plus de 45 jours partirait sinon de now−45 j, et le trou entre la
    // fin du cache et now−45 j deviendrait définitif (majTs=now rend le cache « frais »,
    // les rafraîchissements suivants ne couvrent jamais plus de 45 j en arrière).
    // On recouvre d'un jour la fin du cache — `fusionner` déduplique par timestamp.
    const dernier = cache?.points.at(-1);
    const debut = cache === null || dernier === undefined
      ? deps.debut
      : Math.max(DEBUT_HISTORIQUE_CMC, Math.min(now - 45 * JOUR_MS, dernier.t - JOUR_MS));
    const recent = await fetchHistoriqueCmc({ ...deps, debut, fin: deps.fin ?? now, intervalle: "1d" });
    const points = cache === null ? recent : fusionner(snapshotsCache(cache.points), recent);
    if (points.length === 0) {
      if (cache === null) return null;
      cmcDisponible = true;
      return snapshotsCache(cache.points);
    }
    ecrireCache(points, now);
    cmcDisponible = true;
    return points;
  } catch {
    if (cache === null) return null;
    cmcDisponible = true;
    return snapshotsCache(cache.points);
  }
}

let chargementEnCours: Promise<McapSnapshot[] | null> | null = null;

export function chargerHistoriqueCmc(deps: ChargerCmcDeps = {}): Promise<McapSnapshot[] | null> {
  const injecte = Object.keys(deps).length > 0;
  if (injecte) return chargerInterne(deps);
  if (chargementEnCours === null) {
    chargementEnCours = chargerInterne(deps).finally(() => {
      chargementEnCours = null;
    });
  }
  return chargementEnCours;
}
