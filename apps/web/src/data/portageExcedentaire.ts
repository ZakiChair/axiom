/**
 * Portage excédentaire — basis annualisé des futures datés MOINS le T-bill US de même durée.
 *
 * POURQUOI : TERM affiche le basis brut et RATE la courbe US, mais la différence n'était
 * calculée nulle part. Un basis trade (spot long, future short) ne rémunère le risque que
 * pour sa part AU-DESSUS du taux sans risque : c'est cette part que l'on lit ici.
 *
 * CONVENTIONS (mêmes des deux côtés : taux simple act/365) :
 *   - basis : `annualiserBasis` (binanceDapi.ts), (F − S)/S × 365 j / T, déjà simple act/365 ;
 *   - T-bill : la courbe du Trésor est publiée en BEY (rendement équivalent obligataire).
 *     Jusqu'à 182,5 j, le BEY d'un bill vaut (100 − P)/P × 365/t : c'est déjà un taux simple
 *     act/365 (identité). Au-delà, le Trésor résout P·(1 + i/2)·(1 + (t − 182,5)·i/365) = 100 ;
 *     on en tire le taux simple ((1 + i/2)·(1 + (t − 182,5)·i/365) − 1)·365/t (365 j : i + i²/4).
 *   - interpolation linéaire en jours du BEY entre les maturités PRÉSENTES dans la ligne
 *     (une colonne vide, ex. « 1.5 Month » en 2025, n'est pas un nœud), puis conversion au
 *     terme visé ; plat sous la première maturité et au-delà de la dernière (1 an).
 *   - échéances à moins de 7 j exclues : l'annualisation y explose (15SEP26 à −7,84 %/an
 *     à 0,5 j, sonde du 2026-09-14).
 *
 * MODÈLE : fonctions PURES, `nowMs` injecté (convention de termIv.ts) ; seul
 * `chargerCourbeTbill` a un effet de bord (fetch via `chargerRendementsUS`, mémo 1 h).
 * Module importé UNIQUEMENT par TermStructureWindow.tsx (chunk paresseux).
 */
import type { PointBasis } from "./binanceDapi";
import { chargerRendementsUS, type CourbeRendements } from "./macro/treasuryYields";
import type { Domaine } from "../lib/domaineAxe";

/** Maturités « bill » de la courbe du Trésor (libellé CSV → durée en jours). */
export const JOURS_PAR_MATURITE_TBILL: ReadonlyArray<readonly [string, number]> = [
  ["1 Mo", 30.4],
  ["1.5 Month", 45.6],
  ["2 Mo", 60.8],
  ["3 Mo", 91.3],
  ["4 Mo", 121.7],
  ["6 Mo", 182.5],
  ["1 Yr", 365],
];
/** Durée minimale (jours) d'une échéance pour calculer un portage. */
export const JOURS_MIN_PORTAGE = 7;
/** Maturité constante de la tuile (jours). */
export const JOURS_MATURITE_CONSTANTE = 90;

const MS_PAR_JOUR = 86_400_000;
/** Courbe publiée une fois par jour ouvré US : une relecture par heure suffit. */
const TTL_COURBE_MS = 60 * 60 * 1000;
/** Pas d'échantillonnage de la courbe tracée (la conversion au-delà de 182,5 j est convexe). */
const PAS_ECHANTILLON_MS = 7 * MS_PAR_JOUR;

/** Portage d'une échéance datée. */
export interface PointPortage {
  instrument: string;
  expiryMs: number;
  jours: number;
  source: "binance" | "deribit";
  /** Basis annualisé simple act/365, en %. */
  basisPct: number;
  /** T-bill interpolé à la même durée, converti en taux simple act/365, en %. */
  tbillPct: number;
  /** basisPct − tbillPct, en points de %. */
  excesPt: number;
}

/** Portage à maturité constante, interpolé entre deux échéances d'une même source. */
export interface PortageConstant {
  jours: number;
  source: "binance" | "deribit";
  /** Échéance encadrante courte (jours ≤ cible) et longue (jours ≥ cible) ; identiques si pile. */
  avant: PointPortage;
  apres: PointPortage;
  basisPct: number;
  tbillPct: number;
  excesPt: number;
}

/** BEY du Trésor (%) → taux simple act/365 (%) pour une durée en jours. Fonction PURE. */
export function tauxSimpleDepuisBey(beyPct: number, jours: number): number {
  if (jours <= 182.5) return beyPct;
  const i = beyPct / 100;
  return ((1 + i / 2) * (1 + ((jours - 182.5) * i) / 365) - 1) * (365 / jours) * 100;
}

/**
 * T-bill US (%) interpolé à `jours`, en taux simple act/365. `null` sous 7 jours, pour une
 * durée non finie, ou si la ligne ne contient aucune maturité bill. Fonction PURE.
 */
export function tbillInterpole(courbe: CourbeRendements, jours: number): number | null {
  if (!Number.isFinite(jours) || jours < JOURS_MIN_PORTAGE) return null;
  const noeuds = JOURS_PAR_MATURITE_TBILL.flatMap(([label, j]) => {
    const y = courbe.rendements[label];
    return y !== undefined && Number.isFinite(y) ? [[j, y] as const] : [];
  });
  const premier = noeuds[0];
  const dernier = noeuds.at(-1);
  if (premier === undefined || dernier === undefined) return null;

  let bey = jours <= premier[0] ? premier[1] : dernier[1];
  for (let k = 1; k < noeuds.length; k++) {
    const [ja, ya] = noeuds[k - 1]!;
    const [jb, yb] = noeuds[k]!;
    if (jours > ja && jours <= jb) {
      bey = ya + ((jours - ja) / (jb - ja)) * (yb - ya);
      break;
    }
  }
  return tauxSimpleDepuisBey(bey, jours);
}

/**
 * Portage par échéance (basis − T-bill de même durée). Écarte les échéances à moins de 7 j
 * et les basis non finis ; [] si la courbe est absente. Fonction PURE.
 */
export function calculerPortage(points: readonly PointBasis[], courbe: CourbeRendements | null): PointPortage[] {
  if (courbe === null) return [];
  const out: PointPortage[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.basisAnnualise)) continue;
    const tbillPct = tbillInterpole(courbe, p.jours);
    if (tbillPct === null) continue;
    const basisPct = p.basisAnnualise * 100;
    out.push({
      instrument: p.instrument,
      expiryMs: p.expiryMs,
      jours: p.jours,
      source: p.source,
      basisPct,
      tbillPct,
      excesPt: basisPct - tbillPct,
    });
  }
  return out;
}

/**
 * Portage à maturité constante `jours` : basis interpolé linéairement (en jours) entre les
 * deux échéances d'une même source qui encadrent la cible, moins le T-bill à la cible.
 * Deribit d'abord ; Binance COIN-M en repli quand Deribit n'encadre pas la cible (source
 * absente ou courbe trop courte). Aucune extrapolation : `null` sans paire encadrante ou
 * sans courbe. Fonction PURE.
 */
export function portageMaturiteConstante(
  points: readonly PointPortage[],
  courbe: CourbeRendements | null,
  jours = JOURS_MATURITE_CONSTANTE,
): PortageConstant | null {
  if (courbe === null) return null;
  const tbillPct = tbillInterpole(courbe, jours);
  if (tbillPct === null) return null;
  for (const source of ["deribit", "binance"] as const) {
    let avant: PointPortage | null = null;
    let apres: PointPortage | null = null;
    for (const p of points) {
      if (p.source !== source) continue;
      if (p.jours <= jours && (avant === null || p.jours > avant.jours)) avant = p;
      if (p.jours >= jours && (apres === null || p.jours < apres.jours)) apres = p;
    }
    if (avant === null || apres === null) continue;
    const poids = apres.jours === avant.jours ? 0 : (jours - avant.jours) / (apres.jours - avant.jours);
    const basisPct = avant.basisPct + poids * (apres.basisPct - avant.basisPct);
    return { jours, source, avant, apres, basisPct, tbillPct, excesPt: basisPct - tbillPct };
  }
  return null;
}

/**
 * Points de la courbe T-bill à tracer sur l'axe des échéances : de max(domaine.min,
 * maintenant + 7 j) à domaine.max, avec les nœuds de maturité présents et un pas de 7 j.
 * [] si la courbe est absente ou si le domaine finit avant 7 j. Fonction PURE.
 */
export function echantillonsTbill(
  courbe: CourbeRendements | null,
  nowMs: number,
  domaine: Domaine,
): { ms: number; pct: number }[] {
  if (courbe === null) return [];
  const debut = Math.max(domaine.min, nowMs + JOURS_MIN_PORTAGE * MS_PAR_JOUR);
  const fin = domaine.max;
  if (!(fin > debut)) return [];
  const abscisses = new Set<number>([debut, fin]);
  for (let ms = debut + PAS_ECHANTILLON_MS; ms < fin; ms += PAS_ECHANTILLON_MS) abscisses.add(ms);
  for (const [label, j] of JOURS_PAR_MATURITE_TBILL) {
    const ms = nowMs + j * MS_PAR_JOUR;
    if (courbe.rendements[label] !== undefined && ms > debut && ms < fin) abscisses.add(ms);
  }
  return [...abscisses]
    .sort((a, b) => a - b)
    .flatMap((ms) => {
      const pct = tbillInterpole(courbe, (ms - nowMs) / MS_PAR_JOUR);
      return pct === null ? [] : [{ ms, pct }];
    });
}

/** Date « MM/DD/YYYY » du CSV du Trésor → minuit local (ms), NaN si le format diffère. */
export function dateCourbeUsVersMs(date: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  if (m === null) return Number.NaN;
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])).getTime();
}

let memoCourbe: { at: number; courbe: CourbeRendements } | null = null;

/**
 * Dernière courbe US publiée (effet de bord). Mémo d'une heure ; en cas de panne, renvoie
 * la dernière courbe connue (sa date reste affichée), sinon `null`. Ne rejette jamais.
 */
export async function chargerCourbeTbill(nowMs: number): Promise<CourbeRendements | null> {
  if (memoCourbe !== null && nowMs - memoCourbe.at < TTL_COURBE_MS) return memoCourbe.courbe;
  const [derniere] = await chargerRendementsUS();
  if (derniere === undefined) return memoCourbe?.courbe ?? null;
  memoCourbe = { at: nowMs, courbe: derniere };
  return derniere;
}
