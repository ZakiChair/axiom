/**
 * CBOE delayed quotes — chaîne d'options sur indices actions (SPX / NDX / VIX) avec greeks
 * PRÉ-calculés, pour le GEX/DEX « Actions » de la fenêtre OMON.
 *
 * Endpoint (non documenté officiellement par CBOE, trouvé via recherche communautaire puis
 * confirmé en direct, cf. docs/research/04-…) :
 *   GET https://cdn.cboe.com/api/global/delayed_quotes/options/_{TICKER}.json
 * Renvoie `data.current_price` (spot) + `data.options[]` avec `option` (symbole OCC),
 * `open_interest`, `delta` (signé, put négatif), `gamma` (≥ 0), `iv`.
 *
 * Données DIFFÉRÉES (~15 min, non garanti) → à étiqueter « données différées » côté UI.
 * Endpoint non contractuel → dégradation gracieuse TOTALE : tout échec/format inattendu
 * renvoie null (la section Actions disparaît, la fenêtre crypto n'est jamais cassée).
 *
 * Fonctions PURES testées (cboe.test.ts) : parseCboeOptionSymbol, cboeExpiries, cboeOptionsToLegs.
 */
import { fetchJsonExt } from "./binanceDapi";
import { healthStore } from "../store/health";
import type { OptionGreekLeg } from "./gexDex";

/** Identifiant de la source dans le registre santé. */
const HEALTH_SOURCE = "cboe";

/** Millisecondes dans un jour. */
const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

/** Tickers d'indices supportés (mêmes symboles que le path CBOE `_{TICKER}.json`). */
export const CBOE_TICKERS = ["SPX", "NDX", "VIX"] as const;
export type CboeTicker = (typeof CBOE_TICKERS)[number];

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

/** Chaîne d'options CBOE normalisée. */
export interface CboeChain {
  ticker: CboeTicker;
  /** Spot (data.current_price). */
  spot: number;
  options: CboeOption[];
}

/**
 * Échéances distinctes présentes dans la chaîne, futures (avec tolérance d'un jour pour les
 * expirations du jour même — les options actions expirent en séance, pas à 00:00 UTC), triées
 * croissant, avec le nombre d'options. `nowMs` injecté (fonction PURE).
 */
export function cboeExpiries(
  options: CboeOption[],
  nowMs: number,
): { expiryMs: number; count: number }[] {
  const parExp = new Map<number, number>();
  for (const o of options) {
    const parsed = parseCboeOptionSymbol(o.option);
    if (!parsed) continue;
    if (parsed.expiryMs < nowMs - MS_PAR_JOUR) continue; // ignore le passé (grâce 1 j)
    parExp.set(parsed.expiryMs, (parExp.get(parsed.expiryMs) ?? 0) + 1);
  }
  return [...parExp.entries()]
    .map(([expiryMs, count]) => ({ expiryMs, count }))
    .sort((a, b) => a.expiryMs - b.expiryMs);
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
    options?: unknown[];
  };
}

/**
 * Récupère et normalise la chaîne d'options CBOE d'un ticker, ou `null` en cas d'échec /
 * format inattendu (jamais d'exception propagée — la section Actions se masque simplement).
 * Signale la santé de la source `cboe`.
 */
export async function fetchCboeChain(ticker: CboeTicker): Promise<CboeChain | null> {
  try {
    const brut = (await fetchJsonExt(
      "cdn.cboe.com",
      `api/global/delayed_quotes/options/_${ticker}.json`,
    )) as CboeReponse;
    const spot = Number(brut?.data?.current_price);
    const brutOpts = Array.isArray(brut?.data?.options) ? brut.data.options : [];
    if (!Number.isFinite(spot) || spot <= 0 || brutOpts.length === 0) {
      throw new Error(`CBOE ${ticker}: réponse vide ou spot invalide`);
    }
    const options: CboeOption[] = [];
    for (const raw of brutOpts) {
      const o = raw as Partial<CboeOption>;
      if (typeof o.option !== "string") continue;
      options.push({
        option: o.option,
        open_interest: Number(o.open_interest),
        delta: Number(o.delta),
        gamma: Number(o.gamma),
        iv: Number(o.iv),
      });
    }
    healthStore.getState().setEtat(HEALTH_SOURCE, "connected", { dernierMessageTs: Date.now() });
    return { ticker, spot, options };
  } catch (err) {
    healthStore
      .getState()
      .marquerErreur(HEALTH_SOURCE, err instanceof Error ? err.message : String(err));
    return null;
  }
}
