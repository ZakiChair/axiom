/**
 * Deribit — API publique v2 (sans clé) : futures datés (structure par terme) et options
 * (smile IV, max pain, put/call ratio, DVOL). CORS ouvert normalement → appel DIRECT, avec
 * repli SAME-ORIGIN /extapi (hôte `www.deribit.com` whitelisté) via `fetchJsonExt`.
 *
 * Débit DOUX : ~5 requêtes/s max (créneau sérialisé à intervalle minimal). Les données sont
 * lentes (rafraîchies ~1 min côté fenêtre) → une poignée d'appels par cycle suffit.
 *
 * Endpoints agrégés (1 appel par devise, pas 1 par instrument) :
 *   - get_instruments (futures)              → noms + échéances des futures datés ;
 *   - get_book_summary_by_currency (future)  → mark_price par future ;
 *   - get_book_summary_by_currency (option)  → mark_iv + open_interest par option ;
 *   - get_index_price                        → spot de référence (btc_usd / eth_usd) ;
 *   - get_volatility_index_data              → DVOL (indice de volatilité implicite).
 *
 * Fonctions PURES testées (deribit.test.ts) : parseOptionInstrument, computeMaxPain,
 * putCallRatioOi. `annualiserBasis` est réutilisée depuis binanceDapi.ts (déjà testée).
 */
import { annualiserBasis, fetchJsonExt, type PointBasis } from "./binanceDapi";
import { healthStore } from "../store/health";

/** Identifiant de la source dans le registre santé. */
const HEALTH_SOURCE = "deribit";

/** Intervalle minimal entre deux requêtes Deribit (~5 req/s). */
const MIN_GAP_MS = 220;

// ─────────────────────────── Débit doux (créneaux sérialisés) ───────────────────────────

let chaineDebit: Promise<void> = Promise.resolve();
let dernierAppelTs = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Attend un créneau respectant l'intervalle minimal (acquisitions sérialisées). */
function creneau(): Promise<void> {
  const run = chaineDebit.then(async () => {
    const attente = MIN_GAP_MS - (Date.now() - dernierAppelTs);
    if (attente > 0) await sleep(attente);
    dernierAppelTs = Date.now();
  });
  chaineDebit = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ─────────────────────────── Appel JSON-RPC public ───────────────────────────

/** Enveloppe JSON-RPC de Deribit (result OU error). */
interface DeribitEnveloppe<T> {
  result?: T;
  error?: { message?: string; code?: number };
}

/** Appel public GET throttlé ; déballe `result`, lève sur `error`/résultat vide. */
async function appelDeribit<T>(methode: string, params: Record<string, string>): Promise<T> {
  await creneau();
  const chemin = `api/v2/public/${methode}?${new URLSearchParams(params).toString()}`;
  const corps = (await fetchJsonExt("www.deribit.com", chemin)) as DeribitEnveloppe<T>;
  if (corps.error) throw new Error(`Deribit ${methode}: ${corps.error.message ?? "erreur"}`);
  if (corps.result === undefined) throw new Error(`Deribit ${methode}: réponse vide`);
  return corps.result;
}

// ─────────────────────────── Fonction PURE : parsing d'instrument option ───────────────────────────

/** Mois Deribit (abréviation → index 0-11). */
const MOIS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/** Résultat du parsing d'un nom d'option Deribit. */
export interface OptionParse {
  currency: string;
  expiryMs: number;
  strike: number;
  type: "call" | "put";
}

/**
 * Parse un nom d'option Deribit « CUR-DMMMYY-STRIKE-(C|P) » (ex. « BTC-28AUG26-78000-P »).
 * L'échéance Deribit tombe à 08:00 UTC le jour indiqué. Renvoie null si le nom ne matche
 * pas (ex. un future). Fonction PURE.
 */
export function parseOptionInstrument(nom: string): OptionParse | null {
  const m = /^([A-Z]+)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:\.\d+)?)-([CP])$/.exec(nom.trim().toUpperCase());
  if (!m) return null;
  const cur = m[1];
  const jour = m[2];
  const moisTxt = m[3];
  const annee = m[4];
  const strikeTxt = m[5];
  const cp = m[6];
  if (!cur || !jour || !moisTxt || !annee || !strikeTxt || !cp) return null;
  const mois = MOIS[moisTxt];
  if (mois === undefined) return null;
  const strike = Number(strikeTxt);
  if (!Number.isFinite(strike) || strike <= 0) return null;
  const expiryMs = Date.UTC(2000 + Number(annee), mois, Number(jour), 8, 0, 0);
  return { currency: cur, expiryMs, strike, type: cp === "C" ? "call" : "put" };
}

// ─────────────────────────── Fonction PURE : max pain ───────────────────────────

/** Open interest agrégé par strike (calls et puts) pour une échéance. */
export interface StrikeOi {
  strike: number;
  callOi: number;
  putOi: number;
}

/**
 * « Max pain » : prix de règlement qui MINIMISE la valeur intrinsèque totale versée aux
 * détenteurs d'options (donc la perte des vendeurs). Pour chaque strike candidat S, la
 * « douleur » = Σ callOi·max(0, S−K) [calls ITM] + Σ putOi·max(0, K−S) [puts ITM]. Le max
 * pain est le strike de douleur minimale. Fonction PURE. Renvoie null si aucun strike valide.
 */
export function computeMaxPain(niveaux: StrikeOi[]): number | null {
  const valides = niveaux.filter((n) => Number.isFinite(n.strike) && n.strike > 0);
  if (valides.length === 0) return null;

  let meilleurStrike: number | null = null;
  let minDouleur = Infinity;
  for (const cand of valides) {
    const s = cand.strike;
    let douleur = 0;
    for (const n of valides) {
      if (s > n.strike && Number.isFinite(n.callOi)) douleur += n.callOi * (s - n.strike);
      if (s < n.strike && Number.isFinite(n.putOi)) douleur += n.putOi * (n.strike - s);
    }
    if (douleur < minDouleur) {
      minDouleur = douleur;
      meilleurStrike = s;
    }
  }
  return meilleurStrike;
}

/**
 * Ratio put/call sur l'OPEN INTEREST : Σ OI puts / Σ OI calls. Fonction PURE. Renvoie NaN
 * s'il n'y a aucun call (division impossible).
 */
export function putCallRatioOi(points: { type: "call" | "put"; openInterest: number }[]): number {
  let call = 0;
  let put = 0;
  for (const p of points) {
    if (!Number.isFinite(p.openInterest)) continue;
    if (p.type === "call") call += p.openInterest;
    else put += p.openInterest;
  }
  return call > 0 ? put / call : NaN;
}

// ─────────────────────────── Structure par terme (futures) ───────────────────────────

/** Instrument future renvoyé par get_instruments (champs utiles). */
interface DeribitInstrument {
  instrument_name: string;
  expiration_timestamp: number;
  settlement_period: string;
}
/** Résumé de carnet par instrument (get_book_summary_by_currency). */
interface DeribitBookSummary {
  instrument_name: string;
  mark_price: number | null;
}

/**
 * Structure par terme Deribit pour BTC ou ETH : basis annualisé (mark vs index spot) par
 * future daté (le perpétuel est écarté). Points triés par échéance. Signale la santé.
 */
export async function fetchDeribitTermStructure(currency: "BTC" | "ETH"): Promise<PointBasis[]> {
  try {
    const [instruments, resume, index] = await Promise.all([
      appelDeribit<DeribitInstrument[]>("get_instruments", {
        currency,
        kind: "future",
        expired: "false",
      }),
      appelDeribit<DeribitBookSummary[]>("get_book_summary_by_currency", {
        currency,
        kind: "future",
      }),
      appelDeribit<{ index_price: number }>("get_index_price", {
        index_name: `${currency.toLowerCase()}_usd`,
      }),
    ]);

    const spot = index.index_price;
    const markParNom = new Map(
      resume.map((r): [string, number | null] => [r.instrument_name, r.mark_price]),
    );
    const now = Date.now();
    const points: PointBasis[] = [];
    for (const inst of instruments) {
      if (inst.settlement_period === "perpetual") continue;
      const mark = markParNom.get(inst.instrument_name);
      if (mark === undefined || mark === null || !Number.isFinite(mark)) continue;
      const basis = annualiserBasis(mark, spot, now, inst.expiration_timestamp);
      if (!Number.isFinite(basis)) continue;
      points.push({
        instrument: inst.instrument_name,
        expiryMs: inst.expiration_timestamp,
        future: mark,
        spot,
        basisAnnualise: basis,
        jours: (inst.expiration_timestamp - now) / (24 * 60 * 60 * 1000),
        source: "deribit",
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

// ─────────────────────────── Chaîne d'options ───────────────────────────

/** Un point de la chaîne d'options (dérivé du résumé de carnet + du nom parsé). */
export interface OptionPoint {
  instrument: string;
  expiryMs: number;
  strike: number;
  type: "call" | "put";
  /** Volatilité implicite au mark, en POURCENTAGE (Deribit renvoie déjà en %). */
  markIv: number;
  /** Open interest, en unités de base (BTC/ETH). */
  openInterest: number;
  /** Prix du sous-jacent (index) au moment du résumé. */
  underlying: number;
  /** Taux sans risque en fraction (Deribit `interest_rate`, souvent 0). Input Black-Scholes. */
  interestRate: number;
}

/** Résumé de carnet d'une option (get_book_summary_by_currency, kind=option). */
interface DeribitOptionSummary {
  instrument_name: string;
  mark_iv: number | null;
  open_interest: number | null;
  underlying_price: number | null;
  interest_rate: number | null;
}

/**
 * Chaîne d'options complète (toutes échéances) d'une devise, en UN appel agrégé. Chaque
 * point porte échéance/strike/type (parsés du nom), IV au mark et open interest. Santé signalée.
 */
export async function fetchDeribitOptionChain(currency: "BTC" | "ETH"): Promise<OptionPoint[]> {
  try {
    const resume = await appelDeribit<DeribitOptionSummary[]>("get_book_summary_by_currency", {
      currency,
      kind: "option",
    });
    const out: OptionPoint[] = [];
    for (const r of resume) {
      const parsed = parseOptionInstrument(r.instrument_name);
      if (!parsed) continue;
      out.push({
        instrument: r.instrument_name,
        expiryMs: parsed.expiryMs,
        strike: parsed.strike,
        type: parsed.type,
        markIv: r.mark_iv ?? NaN,
        openInterest: r.open_interest ?? 0,
        underlying: r.underlying_price ?? NaN,
        interestRate: r.interest_rate ?? 0,
      });
    }
    healthStore.getState().setEtat(HEALTH_SOURCE, "connected", { dernierMessageTs: Date.now() });
    return out;
  } catch (err) {
    healthStore
      .getState()
      .marquerErreur(HEALTH_SOURCE, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// ─────────────────────────── DVOL (indice de volatilité implicite) ───────────────────────────

/**
 * Dernier point de DVOL (indice de volatilité implicite Deribit) pour une devise, ou null
 * si indisponible. Échec silencieux (ne bloque pas la fenêtre options). Les bougies sont
 * `[ts, open, high, low, close]` → on retient la clôture la plus récente.
 */
export async function fetchDvol(currency: "BTC" | "ETH"): Promise<number | null> {
  const fin = Date.now();
  const debut = fin - 6 * 60 * 60 * 1000;
  try {
    const res = await appelDeribit<{ data: number[][] }>("get_volatility_index_data", {
      currency,
      start_timestamp: String(debut),
      end_timestamp: String(fin),
      resolution: "3600",
    });
    const dernier = res.data[res.data.length - 1];
    const close = dernier?.[4];
    return typeof close === "number" && Number.isFinite(close) ? close : null;
  } catch {
    return null;
  }
}

/**
 * Historique DVOL (indice de volatilité implicite Deribit) en bougies QUOTIDIENNES
 * (résolution 86400 s) sur les `days` derniers jours — alimente le cône de volatilité
 * (lib/volCone.ts). Contrairement à `fetchDvol` (dernier point, échec silencieux), c'est
 * l'historique complet qui est servi ici et les erreurs remontent à l'appelant.
 */
export async function fetchDvolHistory(
  currency: "BTC" | "ETH",
  days: number,
): Promise<{ time: number; value: number }[]> {
  const fin = Date.now();
  const debut = fin - days * 24 * 60 * 60 * 1000;
  const res = await appelDeribit<{ data: number[][] }>("get_volatility_index_data", {
    currency,
    start_timestamp: String(debut),
    end_timestamp: String(fin),
    resolution: "86400",
  });
  const out: { time: number; value: number }[] = [];
  for (const bougie of res.data) {
    const ts = bougie[0];
    const close = bougie[4];
    if (typeof ts === "number" && typeof close === "number" && Number.isFinite(ts) && Number.isFinite(close)) {
      out.push({ time: ts, value: close });
    }
  }
  return out;
}
