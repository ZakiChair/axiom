/**
 * Utilitaires PURS de la fenêtre « Produits dérivés » (DES) : construction du modèle
 * d'affichage de l'Open Interest futures BTC ventilé par exchange. Séparés du composant
 * pour rester testables hors navigateur.
 *
 * Deux pièges amont (flaggés par la couche data) traités ici :
 *  1. `openInterestFutures` est un TOTAL de synthèse dans `parExchange`, PAS un exchange :
 *     EXCLU des barres ET du dénominateur des parts.
 *  2. Les jours récents peuvent être vides (aucun exchange exploitable) : on remonte au
 *     DERNIER jour non vide et on affiche sa date.
 */
import type { JourOiFutures } from "../data/onchain/bgeometrics";
import { formatDelai, formatHeure, formatPct } from "../lib/format";
import { annualiserFunding } from "../data/fundingCrossExchange";
import { prochainReglementFunding } from "../data/coinalyze";
import { LIBELLE_PLACE_PERP, type MarchePerp } from "../data/marchesPerp";

/** Champ de synthèse à exclure : total agrégé, pas une plateforme. */
const CHAMP_SYNTHESE = "openInterestFutures";

/** Une ligne du classement : exchange, notionnel USD, part (0..1), Δ vs J-7 (ou null). */
export interface RangExchange {
  exchange: string;
  usd: number;
  part: number;
  deltaJ7: number | null;
}

/** Modèle d'affichage complet de la section OI par exchange. */
export interface ModeleOiExchange {
  date: string;
  total: number;
  rangs: RangExchange[];
}

/** Ventilation d'un jour SANS le champ de synthèse (les seuls vrais exchanges). */
function exchangesReels(jour: JourOiFutures): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [ex, v] of Object.entries(jour.parExchange)) {
    if (ex === CHAMP_SYNTHESE) continue;
    out[ex] = v;
  }
  return out;
}

/**
 * Construit le modèle d'affichage : sélectionne le DERNIER jour non vide (après exclusion
 * de la synthèse), classe les exchanges par notionnel décroissant, calcule la part de
 * chacun (dénominateur = total SANS synthèse) et le Δ vs le jour situé 7 séances plus tôt
 * (même position −7 dans `jours` ; exchange absent ce jour-là → null). Renvoie `null` si
 * aucun jour n'a de données exploitables. PURE.
 */
export function construireModeleOiExchange(jours: JourOiFutures[]): ModeleOiExchange | null {
  // Dernier jour non vide (post-exclusion) : on remonte depuis la fin.
  let idx = -1;
  let reels: Record<string, number> = {};
  for (let i = jours.length - 1; i >= 0; i--) {
    const r = exchangesReels(jours[i]!);
    if (Object.keys(r).length > 0) {
      idx = i;
      reels = r;
      break;
    }
  }
  if (idx === -1) return null;

  const total = Object.values(reels).reduce((s, v) => s + v, 0);
  // Référence J-7 : 7 positions plus tôt dans la liste (séances, week-ends inclus si
  // présents en amont). Absente si l'historique ne remonte pas assez loin.
  const ref = idx - 7 >= 0 ? exchangesReels(jours[idx - 7]!) : null;

  const rangs: RangExchange[] = Object.entries(reels)
    .sort((a, b) => b[1] - a[1])
    .map(([exchange, usd]) => ({
      exchange,
      usd,
      part: total > 0 ? usd / total : 0,
      deltaJ7: ref !== null && ref[exchange] !== undefined ? usd - ref[exchange]! : null,
    }));

  return { date: jours[idx]!.d, total, rangs };
}

/** Point L/S (foule ou top traders) joint par timestamp. */
export interface PointRatioSpread {
  time: number;
  longAccount: number;
  shortAccount: number;
}

export interface PointSpreadJoint {
  time: number;
  spread: number;
}

function netLongPct(p: PointRatioSpread): number {
  return (p.longAccount - p.shortAccount) * 100;
}

/**
 * Jointure Smart vs Retail SUR TIMESTAMP (jamais par index).
 * Un bucket manquant au début ou au milieu est simplement omis.
 */
export function joindreSpreadParTimestamp(
  foule: readonly PointRatioSpread[],
  top: readonly PointRatioSpread[],
): PointSpreadJoint[] {
  const parTemps = new Map<number, PointRatioSpread>();
  for (const p of foule) parTemps.set(p.time, p);
  const out: PointSpreadJoint[] = [];
  for (const t of top) {
    const g = parTemps.get(t.time);
    if (g === undefined) continue;
    out.push({ time: t.time, spread: netLongPct(t) - netLongPct(g) });
  }
  return out;
}

// ─────────────────────────── Perp multi-places (demande du 5 octobre 2026) ───────────────────────────

/**
 * Libellé d'un marché perp : « Binance · PUMPUSDT », « Bybit · PUMPFUNUSDT »,
 * suffixé du multiplicateur pour les contrats fractionnés
 * (« Binance · 1000PEPEUSDT · contrat ×1000 »). PURE.
 */
export function libelleMarchePerp(m: MarchePerp): string {
  const base = `${LIBELLE_PLACE_PERP[m.place]} · ${m.symboleSurPlace}`;
  return m.multiplicateur === 1 ? base : `${base} · contrat ×${m.multiplicateur}`;
}

/**
 * Sous-ligne d'APR du funding annualisé à la cadence réelle du marché :
 *  - nombre → « APR (règlement 4 h) +10,95 % » ;
 *  - `undefined` (lecture en cours) → « APR : lecture de la cadence… » ;
 *  - `null` (requête en échec / champ absent) → « APR : cadence de règlement inconnue ».
 * PURE.
 */
export function texteAprFunding(rate: number, intervalleH: number | null | undefined): string {
  if (typeof intervalleH === "number") {
    return `APR (règlement ${intervalleH} h) ${formatPct(annualiserFunding(rate, intervalleH), 2)}`;
  }
  return intervalleH === undefined
    ? "APR : lecture de la cadence…"
    : "APR : cadence de règlement inconnue";
}

/**
 * Sous-ligne « prochain règlement » du funding prédit, alignée sur l'APR :
 *  - `undefined` (lecture en cours) → « prochain règlement : lecture de la cadence… » ;
 *  - entier positif divisant 24 → « prochain règlement (~4 h) dans 2 h 10 · 16:32 » ;
 *  - autre (`null`, non entier, ne divisant pas 24) → « prochain règlement : cadence
 *    inconnue » (la frontière ne tomberait pas sur des multiples d'heure UTC stables).
 * PURE.
 */
export function texteProchainReglement(
  nowMs: number,
  intervalleH: number | null | undefined,
): string {
  if (intervalleH === undefined) return "prochain règlement : lecture de la cadence…";
  if (intervalleH === null || !Number.isInteger(intervalleH) || intervalleH <= 0 || 24 % intervalleH !== 0) {
    return "prochain règlement : cadence inconnue";
  }
  const next = prochainReglementFunding(nowMs, intervalleH);
  return `prochain règlement (~${intervalleH} h) ${formatDelai(next, nowMs)} · ${formatHeure(next)}`;
}
