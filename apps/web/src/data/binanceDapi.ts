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
