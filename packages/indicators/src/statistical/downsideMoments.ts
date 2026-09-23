/** Moments centrés sur les seules baisses du benchmark, dans une fenêtre complète. */
import { rendementsLog } from "../utils";

export interface MomentsBaissiers {
  /** Nombre de rendements de référence négatifs dans la fenêtre complète. */
  count: number;
  correlation: number | undefined;
  beta: number | undefined;
}

export function calculerMomentsBaissiers(
  actif: Array<number | undefined>,
  reference: Array<number | undefined>,
  longueur: number,
  minimumBaisses: number,
): Array<MomentsBaissiers | undefined> {
  const n = actif.length;
  const out: Array<MomentsBaissiers | undefined> = Array(n).fill(undefined);
  if (!Number.isInteger(longueur) || longueur < 1 || !Number.isInteger(minimumBaisses)) return out;
  const min = Math.max(1, Math.min(longueur, minimumBaisses));
  const rx = rendementsLog(actif, n);
  const ry = rendementsLog(reference, n);
  for (let i = longueur; i < n; i++) {
    const selection: Array<[number, number]> = [];
    let complete = true;
    for (let j = i - longueur + 1; j <= i; j++) {
      const x = rx[j];
      const y = ry[j];
      if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) { complete = false; break; }
      if (y < 0) selection.push([x, y]);
    }
    if (!complete) continue;
    const count = selection.length;
    if (count < min) { out[i] = { count, correlation: undefined, beta: undefined }; continue; }
    let sumX = 0;
    let sumY = 0;
    for (const [x, y] of selection) { sumX += x; sumY += y; }
    const meanX = sumX / count;
    const meanY = sumY / count;
    let xx = 0;
    let yy = 0;
    let xy = 0;
    let scaleX = 0;
    let scaleY = 0;
    for (const [x, y] of selection) {
      const dx = x - meanX;
      const dy = y - meanY;
      xx += dx * dx;
      yy += dy * dy;
      xy += dx * dy;
      scaleX = Math.max(scaleX, Math.abs(x));
      scaleY = Math.max(scaleY, Math.abs(y));
    }
    const yVariable = yy > 16 * Number.EPSILON * count * scaleY * scaleY;
    const xVariable = xx > 16 * Number.EPSILON * count * scaleX * scaleX;
    const beta = yVariable ? xy / yy : undefined;
    const correlation = yVariable && xVariable
      ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy)))
      : undefined;
    out[i] = { count, correlation, beta };
  }
  return out;
}
