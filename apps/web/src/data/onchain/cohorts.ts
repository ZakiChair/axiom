import type { PointMetrique } from "./coinmetrics";
export function nombreOnchain(v: unknown): number | null {
  if (typeof v !== "number" && (typeof v !== "string" || !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
export function dateOnchain(v: unknown): number | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const time = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === v ? time : null;
}
export function ecartPrixRealise(spot: number | null | undefined, realise: number | null | undefined): number | null {
  return typeof spot === "number" && typeof realise === "number" && spot > 0 && realise > 0
    && Number.isFinite(spot) && Number.isFinite(realise) ? (spot - realise) / realise * 100 : null;
}
export function variationCalendaire(points: readonly PointMetrique[], jours: number) {
  const dernier = points.at(-1);
  if (!dernier || !Number.isInteger(jours) || jours <= 0) return null;
  const avant = points.find((p) => p.time === dernier.time - jours * 86_400_000);
  if (!avant || !Number.isFinite(avant.value) || !Number.isFinite(dernier.value)) return null;
  return { absolue: dernier.value - avant.value, pct: avant.value === 0 ? null : (dernier.value - avant.value) / avant.value * 100,
    debut: avant.time, fin: dernier.time };
}
export function offreEnProfit(profit: readonly PointMetrique[], perte: readonly PointMetrique[]) {
  const pertes = new Map(perte.map((p) => [p.time, p.value]));
  for (let i = profit.length - 1; i >= 0; i--) {
    const p = profit[i]!; const l = pertes.get(p.time);
    if (l === undefined || !Number.isFinite(p.value) || !Number.isFinite(l) || p.value < 0 || l < 0 || p.value + l === 0) continue;
    return { time: p.time, profitBtc: p.value, perteBtc: l, pct: p.value / (p.value + l) * 100 };
  }
  return null;
}
