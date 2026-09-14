/**
 * CBOE delayed quotes — chaîne d'options sur indices actions (SPX / NDX / VIX) et sur ETF spot
 * crypto (IBIT → BTC, ETHA → ETH) avec greeks PRÉ-calculés, pour le GEX/DEX « Actions » d'OMON.
 *
 * Endpoint (non documenté officiellement par CBOE, trouvé via recherche communautaire puis
 * confirmé en direct, cf. docs/research/04-…) :
 *   GET https://cdn.cboe.com/api/global/delayed_quotes/options/_{INDICE}.json (SPX, NDX, VIX)
 *   GET https://cdn.cboe.com/api/global/delayed_quotes/options/{ETF}.json (IBIT, ETHA : le
 *   préfixe « _ » répond 403 pour les ETF, sondé le 2026-09-14)
 * Renvoie `data.current_price` (spot), `data.iv30` (%), `data.last_trade_time` (heure de New
 * York, sans offset) + `data.options[]` avec `option` (symbole OCC), `open_interest`, `volume`,
 * `delta` (signé, put négatif), `gamma` (≥ 0), `iv`.
 *
 * Données DIFFÉRÉES (~15 min, non garanti) → à étiqueter « données différées » côté UI.
 * Endpoint non contractuel → dégradation gracieuse TOTALE : tout échec/format inattendu
 * renvoie null (la section Actions disparaît, la fenêtre crypto n'est jamais cassée).
 *
 * Fonctions PURES testées (cboe.test.ts) : parseCboeOptionSymbol, cboeExpiries, echeanceCboeRetenue,
 * cboeOptionsToLegs, cheminOptionsCboe, normaliserChaineCboe, heureNewYorkVersUtcMs, niveauCrypto.
 */
import { binanceAdapter } from "./binance";
import { fetchJsonExt } from "./binanceDapi";
import { healthStore } from "../store/health";
import type { OptionGreekLeg } from "./gexDex";

/** Identifiant de la source dans le registre santé. */
const HEALTH_SOURCE = "cboe";

/** Millisecondes dans un jour. */
const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

/** Tickers supportés : indices (`_{TICKER}.json`) puis ETF spot crypto (`{TICKER}.json`). */
export const CBOE_TICKERS = ["SPX", "NDX", "VIX", "IBIT", "ETHA"] as const;
export type CboeTicker = (typeof CBOE_TICKERS)[number];

/** ETF spot crypto → sous-jacent (conversion des strikes en niveaux crypto). */
export const SOUS_JACENT_ETF = { IBIT: "BTC", ETHA: "ETH" } as const;
export type CboeTickerEtf = keyof typeof SOUS_JACENT_ETF;

export function estEtfCrypto(t: CboeTicker): t is CboeTickerEtf {
  return t in SOUS_JACENT_ETF;
}

/** Chemin CBOE : `_SPX.json` pour les indices, `IBIT.json` pour les ETF (« _IBIT » répond 403). */
export function cheminOptionsCboe(t: CboeTicker): string {
  return `api/global/delayed_quotes/options/${estEtfCrypto(t) ? "" : "_"}${t}.json`;
}

/** Demi-largeur de la bande de strikes conservée autour du prix de l'ETF (indices intacts). */
export const FILTRE_STRIKES_ETF = 0.25;

/** Résultat du parsing d'un symbole d'option OCC (format CBOE). */
export interface CboeOptionParse {
  root: string;
  /** Échéance au niveau JOUR (00:00 UTC de la date d'expiration). */
  expiryMs: number;
  type: "call" | "put";
  strike: number;
}

/**
 * Parse un symbole d'option OCC compact « ROOT + YYMMDD + (C|P) + STRIKE×1000 sur 8 chiffres »,
 * ex. « SPX260717C06530000 » → SPX, 2026-07-17, call, strike 6530,00.
 *
 * Découpage ANCRÉ À DROITE (déterministe quelle que soit la racine) : 8 derniers = strike,
 * caractère précédent = C/P, 6 précédents = date. Renvoie null si le format ne matche pas.
 * Fonction PURE. Format DIFFÉRENT de Deribit → parser dédié (pas de réutilisation).
 */
export function parseCboeOptionSymbol(sym: string): CboeOptionParse | null {
  const s = sym.trim().toUpperCase();
  if (s.length < 16) return null; // 1 (racine) + 6 (date) + 1 (C/P) + 8 (strike) au minimum
  const strikePart = s.slice(-8);
  const cp = s.slice(-9, -8);
  const datePart = s.slice(-15, -9);
  const root = s.slice(0, -15);
  if (!/^\d{8}$/.test(strikePart)) return null;
  if (cp !== "C" && cp !== "P") return null;
  if (!/^\d{6}$/.test(datePart)) return null;
  if (!/^[A-Z0-9]+$/.test(root)) return null;
  const yy = Number(datePart.slice(0, 2));
  const mm = Number(datePart.slice(2, 4));
  const dd = Number(datePart.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const strike = Number(strikePart) / 1000;
  if (!(strike > 0)) return null;
  return {
    root,
    expiryMs: Date.UTC(2000 + yy, mm - 1, dd),
    type: cp === "C" ? "call" : "put",
    strike,
  };
}

/** Une option de la réponse CBOE (champs utiles seulement). */
export interface CboeOption {
  option: string;
  open_interest: number;
  delta: number;
  gamma: number;
  iv: number;
}

/** Open interest et volume par côté, en contrats. */
export interface ResumeCboe {
  oiCalls: number;
  oiPuts: number;
  volCalls: number;
  volPuts: number;
}

/** Chaîne d'options CBOE normalisée. */
export interface CboeChain {
  ticker: CboeTicker;
  /** Spot (data.current_price). */
  spot: number;
  options: CboeOption[];
  /** IV30 CBOE en % (NaN si absente). */
  iv30: number;
  /** data.last_trade_time brut (heure de New York, sans offset), null si absent. */
  dernierEchangeNy: string | null;
  /** Agrégats de la chaîne COMPLÈTE, calculés avant le filtre ±25 % des ETF. */
  resume: ResumeCboe;
}

/** Échéance listée : nombre d'options et séance d'expiration close (16:00 à New York passée). */
export interface EcheanceCboe {
  expiryMs: number;
  count: number;
  expiree: boolean;
}

/**
 * Échéances distinctes présentes dans la chaîne, futures (avec tolérance d'un jour pour les
 * expirations du jour même — les options actions expirent en séance, pas à 00:00 UTC), triées
 * croissant, avec le nombre d'options. `expiree` dès 16:00 à New York le jour d'échéance : les
 * séries qui expirent cessent d'échanger à 16:00, indices compris (SPXW 16:00:00, NDXP 15:59:59
 * relevés le 2026-09-14), puis CBOE publie des greeks résiduels. `nowMs` injecté (fonction PURE).
 */
export function cboeExpiries(options: CboeOption[], nowMs: number): EcheanceCboe[] {
  const parExp = new Map<number, EcheanceCboe>();
  for (const o of options) {
    const parsed = parseCboeOptionSymbol(o.option);
    if (!parsed) continue;
    if (parsed.expiryMs < nowMs - MS_PAR_JOUR) continue; // ignore le passé (grâce 1 j)
    let e = parExp.get(parsed.expiryMs);
    if (!e) {
      const cloture = heureNewYorkVersUtcMs(`${new Date(parsed.expiryMs).toISOString().slice(0, 10)}T16:00:00`);
      e = { expiryMs: parsed.expiryMs, count: 0, expiree: cloture !== null && nowMs >= cloture };
      parExp.set(parsed.expiryMs, e);
    }
    e.count += 1;
  }
  return [...parExp.values()].sort((a, b) => a.expiryMs - b.expiryMs);
}

/**
 * Échéance retenue : le choix manuel tant qu'il est listé (même expiré), sinon la première
 * échéance non expirée — après la clôture de New York, la grâce d'un jour garde l'échéance du
 * jour, dont les gammas résiduels donneraient des murs et un flip factices —, à défaut la
 * première. Fonction PURE.
 */
export function echeanceCboeRetenue(echeances: EcheanceCboe[], choix: number | null): number | null {
  if (echeances.some((e) => e.expiryMs === choix)) return choix;
  return (echeances.find((e) => !e.expiree) ?? echeances[0])?.expiryMs ?? null;
}

/**
 * Convertit les options CBOE d'UNE échéance en jambes porteuses de greeks (greeks déjà
 * fournis par CBOE : delta signé, gamma ≥ 0). Fonction PURE.
 */
export function cboeOptionsToLegs(options: CboeOption[], expiryMs: number): OptionGreekLeg[] {
  const legs: OptionGreekLeg[] = [];
  for (const o of options) {
    const parsed = parseCboeOptionSymbol(o.option);
    if (!parsed || parsed.expiryMs !== expiryMs) continue;
    legs.push({
      strike: parsed.strike,
      type: parsed.type,
      openInterest: Number.isFinite(o.open_interest) ? o.open_interest : 0,
      delta: Number.isFinite(o.delta) ? o.delta : 0,
      gamma: Number.isFinite(o.gamma) ? o.gamma : 0,
    });
  }
  return legs;
}

// ─────────────────────────── Accès réseau (dégradation gracieuse totale) ───────────────────────────

/** Réponse CBOE (structure minimale attendue). */
interface CboeReponse {
  data?: {
    current_price?: number;
    iv30?: number;
    last_trade_time?: string;
    options?: unknown[];
  };
}

/** Somme des valeurs finies (les absences ne comptent pas comme zéro dans un ratio). */
function ajoutFini(total: number, v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? total + n : total;
}

/**
 * Normalise la réponse brute CBOE, ou null si spot invalide / aucune option. Fonction PURE.
 * ETF : `resume` porte sur la chaîne complète, puis seuls les strikes à ±25 % du prix de l'ETF
 * sont conservés (≈ moitié des 2 662 options d'IBIT). Indices : aucune option retirée.
 */
export function normaliserChaineCboe(brut: unknown, ticker: CboeTicker): CboeChain | null {
  const data = (brut as CboeReponse | null)?.data;
  const spot = Number(data?.current_price);
  const brutOpts = Array.isArray(data?.options) ? data.options : [];
  if (!Number.isFinite(spot) || spot <= 0 || brutOpts.length === 0) return null;
  const etf = estEtfCrypto(ticker);
  const resume: ResumeCboe = { oiCalls: 0, oiPuts: 0, volCalls: 0, volPuts: 0 };
  const options: CboeOption[] = [];
  for (const raw of brutOpts) {
    const o = raw as Partial<CboeOption> & { volume?: unknown };
    if (typeof o.option !== "string") continue;
    const parse = parseCboeOptionSymbol(o.option);
    if (parse?.type === "call") {
      resume.oiCalls = ajoutFini(resume.oiCalls, o.open_interest);
      resume.volCalls = ajoutFini(resume.volCalls, o.volume);
    } else if (parse?.type === "put") {
      resume.oiPuts = ajoutFini(resume.oiPuts, o.open_interest);
      resume.volPuts = ajoutFini(resume.volPuts, o.volume);
    }
    if (etf && (!parse || Math.abs(parse.strike / spot - 1) > FILTRE_STRIKES_ETF)) continue;
    options.push({
      option: o.option,
      open_interest: Number(o.open_interest),
      delta: Number(o.delta),
      gamma: Number(o.gamma),
      iv: Number(o.iv),
    });
  }
  const iv30 = Number(data?.iv30 ?? Number.NaN);
  return {
    ticker,
    spot,
    options,
    iv30: Number.isFinite(iv30) ? iv30 : Number.NaN,
    dernierEchangeNy: typeof data?.last_trade_time === "string" ? data.last_trade_time : null,
    resume,
  };
}

/** Heure murale de New York d'un instant, relue comme si elle était UTC. */
const FORMAT_NEW_YORK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
function murNewYork(ms: number): number {
  const p: Record<string, number> = {};
  for (const x of FORMAT_NEW_YORK.formatToParts(new Date(ms))) p[x.type] = Number(x.value);
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
}

/**
 * « 2026-09-14T15:13:15 » (heure de New York, sans offset) → ms UTC, heure d'été gérée par
 * Intl (deux passes pour les jours de changement d'heure). Null si le format est invalide.
 */
export function heureNewYorkVersUtcMs(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(iso)) return null;
  const mur = Date.parse(`${iso}Z`);
  if (!Number.isFinite(mur) || new Date(mur).toISOString().slice(0, 19) !== iso) return null;
  const estimation = mur - (murNewYork(mur) - mur);
  return mur - (murNewYork(estimation) - estimation);
}

/**
 * Niveau crypto équivalent d'un strike ETF par ratio de prix : strike × prixCrypto / prixEtf.
 * Approximation (≠ NAV : frais, prime/décote). Null si une entrée est absente, non finie ou ≤ 0.
 */
export function niveauCrypto(
  strikeEtf: number | null,
  prixEtf: number,
  prixCrypto: number | null,
): number | null {
  if (strikeEtf === null || prixCrypto === null) return null;
  if (!(strikeEtf > 0) || !(prixEtf > 0) || !(prixCrypto > 0)) return null;
  if (!Number.isFinite(strikeEtf) || !Number.isFinite(prixEtf) || !Number.isFinite(prixCrypto)) return null;
  return (strikeEtf * prixCrypto) / prixEtf;
}

/** Dernier prix de référence réussi par ETF (le week-end, le dernier échange ne change pas). */
const memoPrixCrypto = new Map<CboeTickerEtf, { dernierEchangeNy: string; prix: number }>();

/**
 * Clôture de la bougie Binance 1m (BTCUSDT / ETHUSDT) qui contient le dernier échange de l'ETF :
 * les deux prix du ratio sont ainsi pris au même instant (jamais le spot courant, qui bouge
 * quand le marché US est fermé). Mémorisé par dernier échange ; les échecs ne sont pas
 * mémorisés (nouvel essai au rafraîchissement suivant). Null en cas d'échec, jamais d'exception.
 */
export async function prixCryptoAuDernierEchange(
  ticker: CboeTickerEtf,
  dernierEchangeNy: string,
): Promise<number | null> {
  const memo = memoPrixCrypto.get(ticker);
  if (memo?.dernierEchangeNy === dernierEchangeNy) return memo.prix;
  const instant = heureNewYorkVersUtcMs(dernierEchangeNy);
  if (instant === null) return null;
  try {
    const bougies = await binanceAdapter.fetchKlines(`${SOUS_JACENT_ETF[ticker]}USDT`, "1m", {
      limit: 1,
      endTime: instant,
    });
    const bougie = bougies.at(-1);
    // La bougie doit contenir l'instant : une bougie antérieure (trou de données) serait un autre prix.
    if (!bougie || bougie.time > instant || instant - bougie.time >= 60_000) return null;
    if (!Number.isFinite(bougie.close) || bougie.close <= 0) return null;
    memoPrixCrypto.set(ticker, { dernierEchangeNy, prix: bougie.close });
    return bougie.close;
  } catch {
    return null;
  }
}

/**
 * Récupère et normalise la chaîne d'options CBOE d'un ticker, ou `null` en cas d'échec /
 * format inattendu (jamais d'exception propagée — la section Actions se masque simplement).
 * Signale la santé de la source `cboe`.
 */
export async function fetchCboeChain(ticker: CboeTicker): Promise<CboeChain | null> {
  try {
    const chaine = normaliserChaineCboe(
      await fetchJsonExt("cdn.cboe.com", cheminOptionsCboe(ticker)),
      ticker,
    );
    if (!chaine) throw new Error(`CBOE ${ticker}: réponse vide ou spot invalide`);
    healthStore.getState().setEtat(HEALTH_SOURCE, "connected", { dernierMessageTs: Date.now() });
    return chaine;
  } catch (err) {
    healthStore
      .getState()
      .marquerErreur(HEALTH_SOURCE, err instanceof Error ? err.message : String(err));
    return null;
  }
}
