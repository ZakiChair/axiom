import type { PointMetrique } from "./onchain/coinmetrics";
import { rangPercentile } from "../lib/referentiel";
import { percentile } from "../lib/volCone";

export const BTC_GENESIS_MS = Date.UTC(2009, 0, 3);
export const JOUR_MS = 86_400_000;

export const QUANTILES_BTC_POWER_LAW = [5, 10, 25, 50, 75, 90, 95] as const;
export type QuantileBtcPowerLaw = (typeof QUANTILES_BTC_POWER_LAW)[number];
export type CouvertureBtcPowerLaw = 50 | 80 | 90;

export interface ModeleBtcPowerLaw {
  intercept: number;
  pente: number;
  r2: number;
  n: number;
  debutMs: number;
  finMs: number;
  quantiles: Record<QuantileBtcPowerLaw, number>;
  residusTries: number[];
}

export interface IntervalleBtcPowerLaw {
  couverture: CouvertureBtcPowerLaw;
  quantileBas: QuantileBtcPowerLaw;
  quantileHaut: QuantileBtcPowerLaw;
  bas: number;
  haut: number;
}

interface PointLog {
  time: number;
  x: number;
  y: number;
}

function pointsLog(points: readonly PointMetrique[]): PointLog[] {
  const valides: PointLog[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.time) || !Number.isFinite(point.value) || point.value <= 0) continue;
    const jours = (point.time - BTC_GENESIS_MS) / JOUR_MS;
    if (!(jours > 0)) continue;
    const x = Math.log10(jours);
    const y = Math.log10(point.value);
    if (Number.isFinite(x) && Number.isFinite(y)) valides.push({ time: point.time, x, y });
  }
  return valides;
}

export function ajusterBtcPowerLaw(points: readonly PointMetrique[]): ModeleBtcPowerLaw | null {
  const valides = pointsLog(points);
  const n = valides.length;
  if (n < 3) return null;

  let sommeX = 0;
  let sommeY = 0;
  let debutMs = Infinity;
  let finMs = -Infinity;
  for (const point of valides) {
    sommeX += point.x;
    sommeY += point.y;
    if (point.time < debutMs) debutMs = point.time;
    if (point.time > finMs) finMs = point.time;
  }
  const moyenneX = sommeX / n;
  const moyenneY = sommeY / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const point of valides) {
    const dx = point.x - moyenneX;
    const dy = point.y - moyenneY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (!(sxx > 0) || !Number.isFinite(sxx) || !Number.isFinite(sxy)) return null;

  const pente = sxy / sxx;
  const intercept = moyenneY - pente * moyenneX;
  if (!Number.isFinite(pente) || !Number.isFinite(intercept)) return null;

  const residus = valides.map((point) => point.y - (intercept + pente * point.x));
  let sse = 0;
  for (const residu of residus) sse += residu * residu;
  const r2Brut = syy === 0 ? (sse <= Number.EPSILON ? 1 : 0) : 1 - sse / syy;
  if (!Number.isFinite(r2Brut)) return null;

  const residusTries = [...residus].sort((a, b) => a - b);
  const quantiles = Object.fromEntries(
    QUANTILES_BTC_POWER_LAW.map((quantile) => [quantile, percentile(residusTries, quantile)]),
  ) as Record<QuantileBtcPowerLaw, number>;
  if (QUANTILES_BTC_POWER_LAW.some((quantile) => !Number.isFinite(quantiles[quantile]))) return null;

  return {
    intercept,
    pente,
    r2: Math.max(0, Math.min(1, r2Brut)),
    n,
    debutMs,
    finMs,
    quantiles,
    residusTries,
  };
}

function logTendance(modele: ModeleBtcPowerLaw, time: number): number {
  if (!Number.isFinite(time)) return Number.NaN;
  const jours = (time - BTC_GENESIS_MS) / JOUR_MS;
  if (!(jours > 0)) return Number.NaN;
  return modele.intercept + modele.pente * Math.log10(jours);
}

export function prixTendanceBtcPowerLaw(modele: ModeleBtcPowerLaw, time: number): number {
  const logPrix = logTendance(modele, time);
  const prix = 10 ** logPrix;
  return Number.isFinite(prix) && prix > 0 ? prix : Number.NaN;
}

export function prixQuantileBtcPowerLaw(
  modele: ModeleBtcPowerLaw,
  time: number,
  quantile: QuantileBtcPowerLaw,
): number {
  const logPrix = logTendance(modele, time) + modele.quantiles[quantile];
  const prix = 10 ** logPrix;
  return Number.isFinite(prix) && prix > 0 ? prix : Number.NaN;
}

export function intervallesBtcPowerLaw(
  modele: ModeleBtcPowerLaw,
  time: number,
): IntervalleBtcPowerLaw[] {
  const defs = [
    [50, 25, 75],
    [80, 10, 90],
    [90, 5, 95],
  ] as const;
  return defs.map(([couverture, quantileBas, quantileHaut]) => ({
    couverture,
    quantileBas,
    quantileHaut,
    bas: prixQuantileBtcPowerLaw(modele, time, quantileBas),
    haut: prixQuantileBtcPowerLaw(modele, time, quantileHaut),
  }));
}

export function percentileBtcPowerLaw(
  modele: ModeleBtcPowerLaw,
  time: number,
  prix: number,
): number {
  const tendance = logTendance(modele, time);
  if (!Number.isFinite(tendance) || !Number.isFinite(prix) || prix <= 0) return Number.NaN;
  return rangPercentile(modele.residusTries, Math.log10(prix) - tendance);
}

// ─────────────────────────── Axe log10(jours) et échantillonnage ───────────────────────────

/**
 * Abscisse du graphe : log10 du nombre de jours depuis la genèse. NaN avant la genèse
 * (le modèle n'y est pas défini). Réciproque de `timeDepuisLogJours`.
 */
export function logJoursBtc(time: number): number {
  if (!Number.isFinite(time)) return Number.NaN;
  const jours = (time - BTC_GENESIS_MS) / JOUR_MS;
  return jours > 0 ? Math.log10(jours) : Number.NaN;
}

/** Horodatage correspondant à une abscisse log10(jours). */
export function timeDepuisLogJours(x: number): number {
  return BTC_GENESIS_MS + 10 ** x * JOUR_MS;
}

export interface PointCourbeBtcPowerLaw {
  time: number;
  tendance: number;
  q5: number;
  q10: number;
  q25: number;
  q75: number;
  q90: number;
  q95: number;
}

/** Bornes de l'échantillonnage : au moins un segment, jamais plus que le plafond. */
const POINTS_COURBE_MIN = 2;
const POINTS_COURBE_MAX = 2_000;

/**
 * Échantillonne la tendance et les quantiles sur [xMin, xMax] (abscisses log10(jours)),
 * à pas CONSTANT EN LOG et non en jours : la résolution reste homogène à l'écran quel que
 * soit le zoom, alors qu'un pas en jours produirait des marches sur les premières années
 * (fortement étirées en log) et des points inutiles sur la projection lointaine.
 */
export function courbeBtcPowerLaw(
  modele: ModeleBtcPowerLaw,
  xMin: number,
  xMax: number,
  nbPoints: number,
): PointCourbeBtcPowerLaw[] {
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !(xMax > xMin)) return [];
  const n = Math.min(POINTS_COURBE_MAX, Math.max(POINTS_COURBE_MIN, Math.floor(nbPoints) || 0));
  const points: PointCourbeBtcPowerLaw[] = [];
  for (let index = 0; index < n; index += 1) {
    const time = timeDepuisLogJours(xMin + ((xMax - xMin) * index) / (n - 1));
    points.push({
      time,
      tendance: prixTendanceBtcPowerLaw(modele, time),
      q5: prixQuantileBtcPowerLaw(modele, time, 5),
      q10: prixQuantileBtcPowerLaw(modele, time, 10),
      q25: prixQuantileBtcPowerLaw(modele, time, 25),
      q75: prixQuantileBtcPowerLaw(modele, time, 75),
      q90: prixQuantileBtcPowerLaw(modele, time, 90),
      q95: prixQuantileBtcPowerLaw(modele, time, 95),
    });
  }
  return points;
}

/** Marge verticale ajoutée de part et d'autre du contenu visible (5 % de sa hauteur). */
const MARGE_LOG_PRIX = 0.05;

/**
 * Bornes de l'axe des prix (en log10) englobant les prix visibles et l'enveloppe q5–q95
 * de la courbe visible, marge comprise. `null` si rien n'est traçable.
 */
export function bornesLogPrixBtcPowerLaw(
  prix: readonly PointMetrique[],
  courbe: readonly PointCourbeBtcPowerLaw[],
): { yMin: number; yMax: number } | null {
  let yMin = Infinity;
  let yMax = -Infinity;
  const retenir = (valeur: number): void => {
    if (!(valeur > 0)) return;
    const y = Math.log10(valeur);
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  };
  for (const point of prix) retenir(point.value);
  for (const point of courbe) {
    retenir(point.q5);
    retenir(point.q95);
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return null;
  const marge = (yMax - yMin) * MARGE_LOG_PRIX || 0.1;
  return { yMin: yMin - marge, yMax: yMax + marge };
}

export type GranulariteAxeBtc = "annee" | "mois" | "jour";

/** Seuils de bascule de granularité, en jours de fenêtre visible. */
const FENETRE_ANNEES_JOURS = 1_096;
const FENETRE_MOIS_JOURS = 92;

/**
 * Repères temporels couvrant la fenêtre [xMin, xMax] (log10 jours) : 1ers janvier,
 * 1ers du mois ou jours selon son étendue. Indispensable en abscisse logarithmique — une
 * fenêtre zoomée peut ne contenir aucun 1er janvier et laisserait l'axe sans graduation.
 */
export function reperesAxeBtcPowerLaw(
  xMin: number,
  xMax: number,
): { granularite: GranulariteAxeBtc; times: number[] } {
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !(xMax > xMin)) {
    return { granularite: "annee", times: [] };
  }
  const debut = timeDepuisLogJours(xMin);
  const fin = timeDepuisLogJours(xMax);
  const etendueJours = (fin - debut) / JOUR_MS;
  const dateDebut = new Date(debut);
  const times: number[] = [];

  if (etendueJours >= FENETRE_ANNEES_JOURS) {
    const anneeFin = new Date(fin).getUTCFullYear();
    for (let annee = dateDebut.getUTCFullYear(); annee <= anneeFin; annee += 1) {
      times.push(Date.UTC(annee, 0, 1));
    }
    return { granularite: "annee", times };
  }

  if (etendueJours >= FENETRE_MOIS_JOURS) {
    let annee = dateDebut.getUTCFullYear();
    let mois = dateDebut.getUTCMonth();
    for (let time = Date.UTC(annee, mois, 1); time <= fin; time = Date.UTC(annee, mois, 1)) {
      times.push(time);
      mois += 1;
      if (mois > 11) {
        mois = 0;
        annee += 1;
      }
    }
    return { granularite: "mois", times };
  }

  const premierJour = Date.UTC(dateDebut.getUTCFullYear(), dateDebut.getUTCMonth(), dateDebut.getUTCDate());
  for (let time = premierJour; time <= fin; time += JOUR_MS) times.push(time);
  return { granularite: "jour", times };
}


/**
 * Prix « ronds » couvrant [yMin, yMax] (log10) : décennies seules sur une grande plage,
 * mantisses de plus en plus fines à mesure que le zoom resserre l'axe — sans quoi un zoom
 * sous la décennie n'afficherait plus aucune graduation.
 * Le pas est ancré sur un multiple de lui-même (et non sur `Math.floor(yMin)`) : sinon un
 * déplacement infime de la vue changerait la parité de l'exposant de départ et remplacerait
 * d'un coup toutes les graduations par le jeu décalé d'une décennie.
 */
export function ticksPrixBtcPowerLaw(yMin: number, yMax: number): number[] {
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || !(yMax > yMin)) return [];
  const etendue = yMax - yMin;
  const mantisses = etendue <= 0.7 ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : etendue <= 2.2 ? [1, 2, 5] : [1];
  const pas = etendue > 6 ? 2 : 1;
  const ticks: number[] = [];
  for (let exposant = Math.floor(yMin / pas) * pas; exposant <= Math.ceil(yMax); exposant += pas) {
    for (const mantisse of mantisses) {
      const y = exposant + Math.log10(mantisse);
      if (y >= yMin && y <= yMax) ticks.push(mantisse * 10 ** exposant);
    }
  }
  return ticks;
}
