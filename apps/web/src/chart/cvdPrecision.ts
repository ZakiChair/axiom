/**
 * Précision d'affichage du CVD selon l'amplitude de la série (backlog lot A) :
 * `precision: 0` figé rendait le pane illisible sur les paires à très petit
 * volume (|CVD| < 1 affiché « 0 »). Grands cumuls → entier compact ; petits → décimales.
 */
export function precisionCvd(values: readonly number[]): number {
  let maxAbs = 0;
  for (const v of values) {
    const a = Math.abs(v);
    if (Number.isFinite(a) && a > maxAbs) maxAbs = a;
  }
  if (maxAbs >= 10) return 0;
  if (maxAbs >= 0.1) return 2;
  return 4;
}
