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
