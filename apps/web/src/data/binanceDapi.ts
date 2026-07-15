/**
 * Binance COIN-M (dapi) — structure par terme (basis) des contrats trimestriels.
 *
 * Les contrats COIN-M « BTCUSD_YYMMDD » / « ETHUSD_YYMMDD » sont livrés à date fixe.
 * On calcule pour chaque échéance le BASIS ANNUALISÉ = (future − spot) / spot ramené
 * à l'année, où :
 *   - future = markPrice du contrat daté (endpoint /premiumIndex) ;
 *   - spot   = indexPrice de la paire (même endpoint) — l'INDEX SPOT propre de Binance,
 *     identique pour tous les contrats d'une paire. On l'utilise comme référence de spot
 *     (le store marché ne porte qu'UN symbole courant, alors que la fenêtre couvre BTC ET
 *     ETH) : c'est aussi plus juste (source de spot cohérente avec le future).
 *
 * Accès : dapi.binance.com est public et renvoie CORS `*` → appel DIRECT en priorité ;
 * en cas d'échec (CORS/réseau/blocage régional), repli SAME-ORIGIN via le proxy /extapi
 * (hôte `dapi.binance.com` whitelisté). Données lentes (~1 min) : l'exchangeInfo (liste
 * des contrats, quasi statique) est mis en cache mémoire + localStorage (TTL 6 h).
 *
 * La fonction d'annualisation `annualiserBasis` est PURE et testée (binanceDapi.test.ts).
 */
import { extUrl } from "./extapi";
import { healthStore } from "../store/health";

/** Identifiant de la source dans le registre santé. */
const HEALTH_SOURCE = "binance:coinm";

/** Millisecondes dans une année (base 365 j — convention basis crypto). */
const MS_PAR_AN = 365 * 24 * 60 * 60 * 1000;

/** TTL du cache des contrats COIN-M (liste quasi statique, renouvelée au trimestre). */
const TTL_CONTRATS_MS = 6 * 60 * 60 * 1000;
/** Clé localStorage du cache des contrats. */
const CLE_CACHE_CONTRATS = "axiom:coinm:contrats:v1";

// ─────────────────────────── Types partagés ───────────────────────────

/** Un point de la courbe de structure par terme (partagé avec deribit.ts). */
export interface PointBasis {
  /** Identifiant du contrat (ex. « BTCUSD_260925 » ou « BTC-25SEP26 »). */
  instrument: string;
  /** Échéance (ms epoch). */
  expiryMs: number;
  /** Prix du future (mark). */
  future: number;
  /** Spot de référence (index de l'exchange). */
  spot: number;
  /** Basis annualisé, en FRACTION p.a. (ex. 0.08 = +8 %/an). */
  basisAnnualise: number;
  /** Jours jusqu'à l'échéance (indicatif, affichage). */
  jours: number;
  /** Source d'où provient le point. */
  source: "binance" | "deribit";
}

// ─────────────────────────── Fonction PURE : annualisation ───────────────────────────

/**
 * Basis annualisé (fraction p.a.) d'un future daté : (future − spot) / spot, ramené à
 * l'année par le temps restant. Positif = contango, négatif = backwardation. Fonction PURE.
 * Renvoie NaN si les prix sont invalides, si le spot est nul/négatif, ou si l'échéance
 * est passée (temps restant ≤ 0).
 */
export function annualiserBasis(
  future: number,
  spot: number,
  nowMs: number,
  expiryMs: number,
): number {
  if (!Number.isFinite(future) || !Number.isFinite(spot) || spot <= 0) return NaN;
  const tempsRestant = expiryMs - nowMs;
  if (!Number.isFinite(tempsRestant) || tempsRestant <= 0) return NaN;
  return ((future - spot) / spot) * (MS_PAR_AN / tempsRestant);
}

// ─────────────────────────── Fonction PURE : parsing exchangeInfo ───────────────────────────

/** Symbole tel que renvoyé par /dapi/v1/exchangeInfo (champs utiles). */
interface ExchangeInfoSymbol {
  symbol: string;
  pair: string;
  contractType: string;
  deliveryDate: number;
  contractStatus: string;
}
interface ExchangeInfoResp {
  symbols?: ExchangeInfoSymbol[];
}

/** Contrat daté COIN-M retenu : symbole + date de livraison. */
export interface ContratCoinM {
  symbol: string;
  deliveryDate: number;
}

/**
 * Extrait les contrats DATÉS (trimestriels : CURRENT_QUARTER / NEXT_QUARTER) d'une paire
 * (« BTCUSD », « ETHUSD ») en statut TRADING, avec date de livraison valide. Écarte le
 * perpétuel et tout contrat en cours de livraison/expiré. Fonction PURE.
 */
export function parseCoinMContrats(info: ExchangeInfoResp, pair: string): ContratCoinM[] {
  const cible = pair.toUpperCase();
  return (info.symbols ?? [])
    .filter(
      (s) =>
        s.pair === cible &&
        s.contractStatus === "TRADING" &&
        (s.contractType === "CURRENT_QUARTER" || s.contractType === "NEXT_QUARTER") &&
        Number.isFinite(s.deliveryDate) &&
        s.deliveryDate > 0,
    )
    .map((s) => ({ symbol: s.symbol, deliveryDate: s.deliveryDate }));
}

// ─────────────────────────── Accès réseau (direct puis repli /extapi) ───────────────────────────

/**
 * GET JSON avec REPLI : tente l'appel direct `https://<hote>/<chemin>` (CORS ouvert sur
 * dapi.binance.com) ; en cas d'échec (CORS/réseau/HTTP non-OK), bascule sur le proxy
 * SAME-ORIGIN `/extapi/<hote>/<chemin>`. Dégradation gracieuse — jamais de boucle d'erreur.
 */
export async function fetchJsonExt(hote: string, chemin: string): Promise<unknown> {
  try {
    const res = await fetch(`https://${hote}/${chemin}`);
    if (res.ok) return await res.json();
    throw new Error(`HTTP ${res.status}`);
  } catch {
    const res = await fetch(extUrl(hote, chemin));
    if (!res.ok) throw new Error(`${hote} ${res.status} (proxy)`);
    return await res.json();
  }
}

// ─────────────────────────── Cache des contrats (mémoire + localStorage) ───────────────────────────

interface CacheContrats {
  at: number;
  parPaire: Record<string, ContratCoinM[]>;
}

let memoContrats: CacheContrats | null = null;

/** Lit le cache localStorage des contrats (ou null si absent/illisible). */
function lireCacheContrats(): CacheContrats | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const brut = localStorage.getItem(CLE_CACHE_CONTRATS);
    if (!brut) return null;
    const val = JSON.parse(brut) as CacheContrats;
    if (typeof val.at !== "number" || typeof val.parPaire !== "object") return null;
    return val;
  } catch {
    return null;
  }
}

/** Écrit le cache localStorage des contrats (échec silencieux). */
function ecrireCacheContrats(cache: CacheContrats): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CLE_CACHE_CONTRATS, JSON.stringify(cache));
  } catch {
    /* quota / mode privé : on ignore, le cache mémoire suffit */
  }
}

/**
 * Charge (et met en cache) la liste des contrats datés BTCUSD/ETHUSD depuis exchangeInfo.
 * Cache mémoire d'abord, puis localStorage, puis réseau. TTL 6 h (contrats trimestriels).
 */
async function chargerContrats(): Promise<Record<string, ContratCoinM[]>> {
  const now = Date.now();
  if (memoContrats && now - memoContrats.at < TTL_CONTRATS_MS) return memoContrats.parPaire;

  const local = lireCacheContrats();
  if (local && now - local.at < TTL_CONTRATS_MS) {
    memoContrats = local;
    return local.parPaire;
  }

  const info = (await fetchJsonExt("dapi.binance.com", "dapi/v1/exchangeInfo")) as ExchangeInfoResp;
  const parPaire: Record<string, ContratCoinM[]> = {
    BTCUSD: parseCoinMContrats(info, "BTCUSD"),
    ETHUSD: parseCoinMContrats(info, "ETHUSD"),
  };
  memoContrats = { at: now, parPaire };
  ecrireCacheContrats(memoContrats);
  return parPaire;
}

// ─────────────────────────── premiumIndex ───────────────────────────

/** Item de /dapi/v1/premiumIndex (markPrice + indexPrice en chaînes). */
interface PremiumIndexItem {
  symbol: string;
  markPrice: string;
  indexPrice: string;
}

/**
 * Structure par terme Binance COIN-M pour BTC ou ETH : pour chaque contrat daté trouvé,
 * basis annualisé (markPrice vs indexPrice). Renvoie les points triés par échéance.
 * Signale l'état au registre santé (connected/erreur). Lève en cas d'échec réseau (le
 * composant appelant l'attrape via Promise.allSettled).
 */
export async function fetchBinanceCoinMTermStructure(base: "BTC" | "ETH"): Promise<PointBasis[]> {
  const pair = `${base}USD`;
  try {
    const contrats = (await chargerContrats())[pair] ?? [];
    if (contrats.length === 0) {
      healthStore.getState().setEtat(HEALTH_SOURCE, "connected", { dernierMessageTs: Date.now() });
      return [];
    }
    const premium = (await fetchJsonExt(
      "dapi.binance.com",
      `dapi/v1/premiumIndex?pair=${pair}`,
    )) as PremiumIndexItem[];
    const parSymbole = new Map(premium.map((p): [string, PremiumIndexItem] => [p.symbol, p]));

    const now = Date.now();
    const points: PointBasis[] = [];
    for (const c of contrats) {
      const p = parSymbole.get(c.symbol);
      if (!p) continue;
      const future = Number(p.markPrice);
      const spot = Number(p.indexPrice);
      const basis = annualiserBasis(future, spot, now, c.deliveryDate);
      if (!Number.isFinite(basis)) continue;
      points.push({
        instrument: c.symbol,
        expiryMs: c.deliveryDate,
        future,
        spot,
        basisAnnualise: basis,
        jours: (c.deliveryDate - now) / (24 * 60 * 60 * 1000),
        source: "binance",
      });
    }
    points.sort((a, b) => a.expiryMs - b.expiryMs);
    healthStore.getState().setEtat(HEALTH_SOURCE, "connected", { dernierMessageTs: Date.now() });
    return points;
  } catch (err) {
    healthStore
      .getState()
      .marquerErreur(HEALTH_SOURCE, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// ─────────────────────────── Historique de basis (série temporelle) ───────────────────────────

/** Point d'une série temporelle de basis annualisé (% p.a.). */
export interface BasisTimePoint {
  time: number; // ms epoch (open time de la bougie 1h)
  value: number; // basis annualisé en POURCENTAGE p.a. (+ = contango, − = backwardation)
}

/**
 * Joint deux séries de clôtures horaires (future daté × index spot) sur leurs open times
 * communs et calcule le basis annualisé % p.a. de chaque point via `annualiserBasis`.
 * PURE et testée : écarte les timestamps sans contrepartie et les basis non finis
 * (échéance passée, spot ≤ 0). Trié par temps croissant.
 */
export function computeQuarterlyBasisPoints(
  future: Map<number, number>,
  index: Map<number, number>,
  deliveryDate: number,
): BasisTimePoint[] {
  const out: BasisTimePoint[] = [];
  for (const [t, f] of future) {
    const s = index.get(t);
    if (s === undefined) continue;
    const basis = annualiserBasis(f, s, t, deliveryDate);
    if (!Number.isFinite(basis)) continue;
    out.push({ time: t, value: basis * 100 });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** Récupère des klines dapi (1h) en map openTime → clôture, paginé depuis `since`. */
async function fetchDapiCloses(chemin: string, since: number): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  let startTime = since;
  const now = Date.now();
  // 90 j × 1h ≈ 2160 barres > 1500/req → jusqu'à 3 pages.
  for (let page = 0; page < 3 && startTime < now; page++) {
    const rows = (await fetchJsonExt(
      "dapi.binance.com",
      `${chemin}&startTime=${startTime}&limit=1500`,
    )) as unknown[];
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      if (!Array.isArray(r)) continue;
      const t = Number(r[0]);
      const c = Number(r[4]);
      if (Number.isFinite(t) && Number.isFinite(c)) out.set(t, c);
    }
    const last = rows[rows.length - 1];
    const lastT = Array.isArray(last) ? Number(last[0]) : NaN;
    if (!Number.isFinite(lastT) || lastT <= startTime) break;
    startTime = lastT + 1;
  }
  return out;
}

/**
 * Série temporelle du basis annualisé (% p.a.) du contrat COIN-M TRIMESTRIEL LE PLUS
 * PROCHE (front quarter) pour BTC/ETH, sur ~90 j. Joint les klines 1h du contrat daté et
 * l'index spot Binance, puis annualise contre l'échéance fixe du contrat. Ne couvre que
 * la vie du contrat courant (undefined avant sa cotation) : c'est volontaire et honnête.
 */
export async function fetchQuarterlyBasisHistory(
  base: "BTC" | "ETH",
  since: number,
): Promise<BasisTimePoint[]> {
  const pair = `${base}USD`;
  const contrats = (await chargerContrats())[pair] ?? [];
  // Front quarter = échéance la plus proche.
  const front = contrats.slice().sort((a, b) => a.deliveryDate - b.deliveryDate)[0];
  if (!front) return [];
  const [future, index] = await Promise.all([
    fetchDapiCloses(`dapi/v1/klines?symbol=${front.symbol}&interval=1h`, since),
    fetchDapiCloses(`dapi/v1/indexPriceKlines?pair=${pair}&interval=1h`, since),
  ]);
  return computeQuarterlyBasisPoints(future, index, front.deliveryDate);
}
