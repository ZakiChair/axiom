/** Économie comparée des chaînes, via les endpoints publics DefiLlama. */

export const CHAINES_ECONOMIE = [
  { id: "ethereum", libelle: "Ethereum", api: "Ethereum" },
  { id: "solana", libelle: "Solana", api: "Solana" },
  { id: "base", libelle: "Base", api: "Base" },
  { id: "arbitrum", libelle: "Arbitrum", api: "Arbitrum" },
] as const;

export type ChaineEconomieId = (typeof CHAINES_ECONOMIE)[number]["id"];
export interface PointEconomie { time: number; value: number }
export interface ResumeEconomie {
  niveau: number | null;
  observeLe: number | null;
  variation30jPct: number | null;
  variation90jPct: number | null;
  variation365jPct: number | null;
}
export interface SerieEconomie {
  disponible: boolean;
  perime: boolean;
  repli?: boolean;
  serie: PointEconomie[];
  resume: ResumeEconomie;
  source: string;
  recupereLe: number;
  raison?: string;
}
export interface EconomieChaine {
  id: ChaineEconomieId;
  libelle: string;
  tvl: SerieEconomie;
  dex: SerieEconomie;
  stablecoins: SerieEconomie;
  frais: SerieEconomie;
  revenus: SerieEconomie;
}
export interface EconomieChainesResultat { chaines: EconomieChaine[]; recupereLe: number }
export type MetriqueEconomie = "tvl" | "dex" | "stablecoins" | "frais" | "revenus";

const HEURE_MS = 3_600_000;
const JOUR_MS = 86_400_000;
const cache = new Map<string, { expire: number; valeur: SerieEconomie }>();
const enCours = new Map<string, { promesse: Promise<SerieEconomie>; signal?: AbortSignal }>();

export function _viderCacheEconomieChaines(): void {
  cache.clear();
  enCours.clear();
}

function nombreFini(v: unknown): number | null {
  if (typeof v !== "number" && (typeof v !== "string" || v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function tempsMs(v: unknown): number | null {
  const n = nombreFini(v);
  if (n === null || n <= 0) return null;
  const time = n < 10_000_000_000 ? n * 1000 : n;
  return Number.isFinite(time) ? time : null;
}

function normaliser(points: readonly PointEconomie[]): PointEconomie[] {
  const uniques = new Map<number, PointEconomie>();
  for (const point of points) {
    if (!Number.isFinite(point.time) || point.time <= 0 || !Number.isFinite(point.value)) continue;
    uniques.set(point.time, point);
  }
  return [...uniques.values()].sort((a, b) => a.time - b.time);
}

/** Parse les tableaux DefiLlama `[[epoch secondes, valeur], ...]`. */
export function parseSerieDefiLlama(raw: unknown): PointEconomie[] {
  if (!Array.isArray(raw)) return [];
  const points: PointEconomie[] = [];
  for (const ligne of raw) {
    if (!Array.isArray(ligne) || ligne.length < 2) continue;
    const time = tempsMs(ligne[0]);
    const value = nombreFini(ligne[1]);
    if (time !== null && value !== null) points.push({ time, value });
  }
  return normaliser(points);
}

/** Parse `/v2/historicalChainTvl/{chain}`. */
export function parseHistoriqueTvl(raw: unknown): PointEconomie[] {
  if (!Array.isArray(raw)) return [];
  const points: PointEconomie[] = [];
  for (const ligne of raw) {
    if (!ligne || typeof ligne !== "object") continue;
    const objet = ligne as Record<string, unknown>;
    const time = tempsMs(objet.date);
    const value = nombreFini(objet.tvl);
    if (time !== null && value !== null) points.push({ time, value });
  }
  return normaliser(points);
}

function sommeUsd(raw: unknown): number | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  let total = 0;
  let trouve = false;
  for (const value of Object.values(raw as Record<string, unknown>)) {
    const n = nombreFini(value);
    // Une composante présente mais inconnue n'est pas un zéro. Les stocks négatifs
    // sont également invalides ; un objet composé de vrais zéros reste valide.
    if (n === null || n < 0) return null;
    total += n;
    trouve = true;
  }
  return trouve ? total : null;
}

/**
 * Parse l'historique stablecoin d'une chaîne. Seul `totalCirculatingUSD` est
 * additionné : `totalCirculating` contient des quantités natives incompatibles.
 */
export function parseHistoriqueStablecoinChaine(raw: unknown): PointEconomie[] {
  if (!Array.isArray(raw)) return [];
  const points: PointEconomie[] = [];
  for (const ligne of raw) {
    if (!ligne || typeof ligne !== "object") continue;
    const objet = ligne as Record<string, unknown>;
    const time = tempsMs(objet.date);
    const value = sommeUsd(objet.totalCirculatingUSD);
    if (time !== null && value !== null) points.push({ time, value });
  }
  return normaliser(points);
}

function variation(serie: readonly PointEconomie[], dernier: PointEconomie, jours: number): number | null {
  const cible = dernier.time - jours * JOUR_MS;
  const precedent = serie.find((point) => point.time === cible);
  if (!precedent || precedent.value === 0) return null;
  return ((dernier.value - precedent.value) / precedent.value) * 100;
}

export function resumerSerie(serieBrute: readonly PointEconomie[], now: number): ResumeEconomie {
  const serie = normaliser(serieBrute).filter((p) => p.time <= now);
  const dernier = serie.at(-1);
  if (!dernier) return { niveau: null, observeLe: null, variation30jPct: null, variation90jPct: null, variation365jPct: null };
  return {
    niveau: dernier.value,
    observeLe: dernier.time,
    variation30jPct: variation(serie, dernier, 30),
    variation90jPct: variation(serie, dernier, 90),
    variation365jPct: variation(serie, dernier, 365),
  };
}

/** Parts calculées sur le dernier timestamp présent dans toutes les séries disponibles. */
export function partsADateCommune<T extends { id: string } & Record<M, SerieEconomie>, M extends MetriqueEconomie>(
  chaines: readonly T[],
  metrique: M,
): { date: number; couverture: { disponibles: number; attendus: number }; parts: Array<{ id: string; valeur: number; partPct: number }> } | null {
  const disponibles = chaines.filter((chaine) => chaine[metrique].disponible && !chaine[metrique].perime && chaine[metrique].serie.length > 0);
  if (disponibles.length === 0) return null;
  let commun = new Set(disponibles[0]![metrique].serie.map((point) => point.time));
  for (const chaine of disponibles.slice(1)) {
    const dates = new Set(chaine[metrique].serie.map((point) => point.time));
    commun = new Set([...commun].filter((date) => dates.has(date)));
  }
  const date = [...commun].sort((a, b) => b - a)[0];
  if (date === undefined) return null;
  const valeurs = disponibles.map((chaine) => ({ id: chaine.id, valeur: chaine[metrique].serie.find((p) => p.time === date)!.value }));
  const total = valeurs.reduce((somme, entree) => somme + entree.valeur, 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  return { date, couverture: { disponibles: disponibles.length, attendus: chaines.length }, parts: valeurs.map((entree) => ({ ...entree, partPct: entree.valeur / total * 100 })) };
}

interface Limiteur {
  executer: <T>(travail: () => Promise<T>) => Promise<T>;
}

function creerLimiteur(maximum: number): Limiteur {
  let actifs = 0;
  const attente: Array<() => void> = [];
  const prendre = async (): Promise<void> => {
    if (actifs < maximum) { actifs += 1; return; }
    await new Promise<void>((resolve) => attente.push(resolve));
    actifs += 1;
  };
  const rendre = (): void => {
    actifs -= 1;
    attente.shift()?.();
  };
  return {
    async executer<T>(travail: () => Promise<T>): Promise<T> {
      await prendre();
      try { return await travail(); } finally { rendre(); }
    },
  };
}

const limiteurDefiLlama = creerLimiteur(3);

export interface OptionsChargementEconomie {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

function serieIndisponible(source: string, recupereLe: number, raison: string): SerieEconomie {
  return { disponible: false, perime: false, serie: [], resume: resumerSerie([], recupereLe), source, recupereLe, raison };
}

async function chargerUrl(
  url: string,
  source: string,
  parser: (raw: unknown) => PointEconomie[],
  limiteur: Limiteur,
  options: Required<Pick<OptionsChargementEconomie, "fetcher" | "now" | "timeoutMs">> & Pick<OptionsChargementEconomie, "signal">,
): Promise<SerieEconomie> {
  const now = options.now();
  const hit = cache.get(url);
  if (hit && hit.expire > now) {
    const observeLe = hit.valeur.resume.observeLe;
    const tropAncienne = observeLe === null || observeLe > now || now - observeLe > 3 * JOUR_MS;
    return tropAncienne ? { ...hit.valeur, perime: true, raison: observeLe !== null && observeLe > now ? "Observation datée dans le futur" : "Dernière observation trop ancienne" } : hit.valeur;
  }
  const existant = enCours.get(url);
  if (existant && !existant.signal?.aborted) return existant.promesse;
  const promesse = limiteur.executer(async () => {
    try {
      const timeout = AbortSignal.timeout(options.timeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      // Un appel comme méthode d'options transmettrait cet objet comme `this` :
      // le fetch natif des navigateurs refuse ce receveur (« Illegal invocation »).
      const fetcher = options.fetcher;
      const response = await fetcher(url, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const serie = parser(await response.json()).filter((p) => p.time <= options.now());
      if (serie.length === 0) throw new Error("historique vide");
      const recupereLe = options.now();
      const resume = resumerSerie(serie, recupereLe);
      const observationPerimee = resume.observeLe === null || resume.observeLe > recupereLe || recupereLe - resume.observeLe > 3 * JOUR_MS;
      const valeur: SerieEconomie = { disponible: true, perime: observationPerimee, serie, resume, source, recupereLe,
        ...(observationPerimee ? { raison: "Dernière observation trop ancienne" } : {}) };
      cache.set(url, { expire: recupereLe + HEURE_MS, valeur });
      return valeur;
    } catch (erreur) {
      const delai = options.timeoutMs >= 1000 ? `${options.timeoutMs / 1000} s` : `${options.timeoutMs} ms`;
      const raison = options.signal?.aborted
        ? "chargement annulé"
        : erreur instanceof Error && erreur.name === "TimeoutError"
          ? `délai dépassé (${delai})`
          : erreur instanceof Error ? erreur.message : "source injoignable";
      return hit ? { ...hit.valeur, perime: true, repli: true, raison: `Cache périmé · ${raison}` } : serieIndisponible(source, options.now(), raison);
    } finally {
      if (enCours.get(url)?.promesse === promesse) enCours.delete(url);
    }
  });
  enCours.set(url, { promesse, ...(options.signal ? { signal: options.signal } : {}) });
  return promesse;
}

/** Charge les cinq séries de chaque chaîne avec un maximum global de trois appels. */
export async function chargerEconomieChaines(options: OptionsChargementEconomie = {}): Promise<EconomieChainesResultat> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const opts = { fetcher, now, timeoutMs, ...(options.signal ? { signal: options.signal } : {}) };
  const chaines = await Promise.all(CHAINES_ECONOMIE.map(async (chaine): Promise<EconomieChaine> => {
    const api = encodeURIComponent(chaine.api);
    const [tvl, dex, stablecoins, frais, revenus] = await Promise.all([
      chargerUrl(`https://api.llama.fi/v2/historicalChainTvl/${api}`, "DefiLlama TVL", parseHistoriqueTvl, limiteurDefiLlama, opts),
      chargerUrl(`https://api.llama.fi/overview/dexs/${api}`, "DefiLlama DEX", (raw) => parseSerieDefiLlama((raw as { totalDataChart?: unknown })?.totalDataChart), limiteurDefiLlama, opts),
      chargerUrl(`https://stablecoins.llama.fi/stablecoincharts/${api}`, "DefiLlama stablecoins", parseHistoriqueStablecoinChaine, limiteurDefiLlama, opts),
      chargerUrl(`https://api.llama.fi/overview/fees/${api}?dataType=dailyFees`, "DefiLlama frais", (raw) => parseSerieDefiLlama((raw as { totalDataChart?: unknown })?.totalDataChart), limiteurDefiLlama, opts),
      chargerUrl(`https://api.llama.fi/overview/fees/${api}?dataType=dailyRevenue`, "DefiLlama revenus", (raw) => parseSerieDefiLlama((raw as { totalDataChart?: unknown })?.totalDataChart), limiteurDefiLlama, opts),
    ]);
    return { id: chaine.id, libelle: chaine.libelle, tvl, dex, stablecoins, frais, revenus };
  }));
  return { chaines, recupereLe: now() };
}
