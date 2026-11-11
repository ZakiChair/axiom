/**
 * Saison des alts — part des alts du top 50 BREADTH qui battent BTC sur 90 jours (variante
 * 30 jours), jour après jour, sur clôtures 1d FERMÉES (SUG-41, phase 1).
 *
 * POURQUOI : dire si l'on est en phase « BTC d'abord » ou si la hausse s'élargit aux alts,
 * avec les clôtures DÉJÀ chargées par BREADTH (aucune requête de plus).
 *
 * DÉFINITION (descriptive, pas un signal) : au jour D, une alt « bat BTC » sur H jours si
 * clôture(D) / clôture(D − H) > BTC(D) / BTC(D − H), strictement. Le dénominateur est le
 * nombre d'alts qui ont une clôture à D ET à D − H : il varie dans le temps (une alt récente
 * n'entre qu'après H jours de cotation) et il est TOUJOURS affiché. BTC absent à D ou à D − H
 * → jour non mesuré (n = 0), jamais 0 %.
 *
 * UNIVERS : le top 50 BREADTH (volume 24 h Binance du JOUR, paires USDT, levier exclu), moins
 * BTC, les stablecoins et les jetons emballés/staked — listes curées de CORR (`corr.ts`, tickers
 * de base) appliquées à la base de la paire (`SOLUSDT` → `SOL`) — et un complément propre aux
 * paires Binance : l'euro (forex réel), ses stables (EURI, AEUR), des stables récents (XUSD,
 * BFUSD, RLUSD) et l'or tokenisé (PAXG, XAUT, adossés à un actif comme les emballés).
 *
 * ⚠️ LIMITES ASSUMÉES (à afficher) :
 *   - biais du survivant : l'univers est le top 50 d'AUJOURD'HUI, appliqué au passé — les
 *     jetons radiés manquent, ceux qui viennent de monter gonflent la fin de la série ;
 *   - plateforme unique : une alt absente du spot Binance est absente ;
 *   - seuils 75 / 25 : convention (Altcoin Season Index de Blockchaincenter, définition non
 *     revérifiée en ligne), présentés comme tels.
 *
 * Toutes les fonctions sont PURES (aucun réseau) ; les clôtures viennent de `data/breadth.ts`.
 */
import type { CloturesDatees, SerieDenombree } from "./breadth";
import { EMBALLES_EXCLUS, STABLECOINS_EXCLUS } from "./corr";

/** Une journée en millisecondes (grille des clôtures 1d, minuit UTC). */
const JOUR_MS = 86_400_000;

/** Paire de référence. */
export const SYMBOLE_BTC = "BTCUSDT";
/** Horizon principal (convention) et variante courte, en jours calendaires. */
export const HORIZON_SAISON_JOURS = 90;
export const HORIZON_SAISON_COURT_JOURS = 30;
/** Seuils de la convention « saison des alts » (≥ 75 %) et « saison BTC » (≤ 25 %). */
export const SEUIL_SAISON_ALTS = 75;
export const SEUIL_SAISON_BTC = 25;

/**
 * Bases Binance exclues en plus des listes CORR : forex et stables propres au spot Binance,
 * or tokenisé (adossé à un actif, pas une alt au sens de la convention).
 */
const EXCLUS_BINANCE: ReadonlySet<string> = new Set(["EUR", "EURI", "AEUR", "XUSD", "BFUSD", "RLUSD", "PAXG", "XAUT"]);

/** Base d'une paire USDT (`SOLUSDT` → `SOL`) ; `null` pour une autre cotation. PURE. */
export function baseUsdt(symbol: string): string | null {
  const s = symbol.trim().toUpperCase();
  return s.endsWith("USDT") && s.length > 4 ? s.slice(0, -4) : null;
}

/** true si la paire entre dans l'univers « alts » : USDT, ni BTC, ni stable, ni emballé/adossé. PURE. */
export function estAltEligible(symbol: string): boolean {
  const base = baseUsdt(symbol);
  if (base === null || base === "BTC") return false;
  return !STABLECOINS_EXCLUS.has(base) && !EMBALLES_EXCLUS.has(base) && !EXCLUS_BINANCE.has(base);
}

/** Index jour (minuit UTC) → clôture d'une série. */
function indexer(serie: CloturesDatees): Map<number, number> {
  const parJour = new Map<number, number>();
  serie.t.forEach((t, i) => {
    const close = serie.closes[i];
    if (close !== undefined && Number.isFinite(close) && close > 0) parJour.set(t, close);
  });
  return parJour;
}

/**
 * Part des alts qui battent BTC sur `horizonJours`, pour chaque jour de la grille contiguë
 * `[debut, debut + (n − 1) jours]` : `k` alts battantes sur `n` éligibles. Ne lit que les
 * clôtures de D et de D − H : le point de D ne change pas quand on ajoute des jours après D
 * (causalité par préfixe). BTC absent → `{ k: 0, n: 0 }` (non mesuré). PURE.
 */
export function calculerSaisonAlts(
  series: readonly CloturesDatees[],
  debut: number,
  n: number,
  horizonJours: number,
): SerieDenombree {
  const serieBtc = series.find((s) => s.symbol === SYMBOLE_BTC);
  const btc = serieBtc === undefined ? new Map<number, number>() : indexer(serieBtc);
  const alts = series.filter((s) => estAltEligible(s.symbol)).map(indexer);
  const k: number[] = [];
  const denominateurs: number[] = [];
  for (let g = 0; g < n; g++) {
    const jour = debut + g * JOUR_MS;
    const jourDepart = jour - horizonJours * JOUR_MS;
    const btcFin = btc.get(jour);
    const btcDepart = btc.get(jourDepart);
    let battent = 0;
    let eligibles = 0;
    if (btcFin !== undefined && btcDepart !== undefined) {
      const perfBtc = btcFin / btcDepart;
      for (const alt of alts) {
        const fin = alt.get(jour);
        const depart = alt.get(jourDepart);
        if (fin === undefined || depart === undefined) continue;
        eligibles++;
        if (fin / depart > perfBtc) battent++;
      }
    }
    k.push(battent);
    denominateurs.push(eligibles);
  }
  return { k, n: denominateurs };
}

/** Zone de la convention pour une part en % : `null` si non mesurée. PURE. */
export function zoneSaison(pct: number | null): "alts" | "btc" | "intermediaire" | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  if (pct >= SEUIL_SAISON_ALTS) return "alts";
  if (pct <= SEUIL_SAISON_BTC) return "btc";
  return "intermediaire";
}
