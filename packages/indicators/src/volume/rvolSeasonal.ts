/** RVOL H1 : volume / moyenne des mêmes créneaux UTC STRICTEMENT antérieurs.
 * La bougie courante est provisoire ; elle n'entre jamais dans sa propre référence.
 * Les références sont bornées en jours calendaires, jamais complétées par des zéros.
 */
import type { IndicatorDef } from "@axiom/types";

const DAY = 86_400_000;

export const rvolSeasonal: IndicatorDef = {
  id: "rvolSeasonal",
  name: "RVOL saisonnier H1 (heure / jour UTC)",
  category: "volume",
  pane: "separate",
  precision: 2,
  inputs: [
    { key: "mode", name: "Référence UTC", type: "select", default: "heure UTC", options: ["heure UTC", "jour + heure UTC"] },
    { key: "jours", name: "Historique (jours)", type: "number", default: 84, min: 7, max: 365 },
    { key: "minimum", name: "Références minimum", type: "number", default: 8, min: 3, max: 100 },
  ],
  outputs: [{ key: "rvol", name: "RVOL ×", style: "histogram" }],
  calc(candles, params) {
    const jours = Math.max(7, Math.min(365, Math.floor(Number(params.jours) || 84)));
    const minimum = Math.max(3, Math.min(100, Math.floor(Number(params.minimum) || 8)));
    const parJour = params.mode === "jour + heure UTC";
    const rvol: Array<number | undefined> = new Array(candles.length).fill(undefined);
    // Série auxiliaire de diagnostic, non tracée sur l'axe de ratios.
    const references: Array<number | undefined> = new Array(candles.length).fill(undefined);
    const slots = new Map<number, Array<{ time: number; volume: number }>>();
    let previousTime = -Infinity;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;
      if (!Number.isFinite(c.time) || c.time <= previousTime) continue;
      previousTime = c.time;
      const date = new Date(c.time);
      const key = date.getUTCHours() + (parJour ? 24 * date.getUTCDay() : 0);
      const history = (slots.get(key) ?? []).filter((p) => p.time >= c.time - jours * DAY);
      references[i] = history.length;
      const valid = Number.isFinite(c.volume) && c.volume >= 0;
      if (valid && history.length >= minimum) {
        const mean = history.reduce((sum, p) => sum + p.volume, 0) / history.length;
        if (mean > 0 && Number.isFinite(mean)) rvol[i] = c.volume / mean;
      }
      // Insertion APRÈS calcul : même la dernière barre ne divise pas par elle-même.
      if (valid) history.push({ time: c.time, volume: c.volume });
      slots.set(key, history);
    }
    const last = candles.length - 1;
    const count = references[last] ?? 0;
    return {
      series: { rvol, references },
      ...(last < 0 ? {} : { annotations: { labels: [{
        idx: last, valeur: rvol[last] ?? 0, cible: "pane" as const, couleur: "--text-dim",
        texte: `n=${count}/${minimum}${rvol[last] === undefined ? " · indisponible" : ""}`,
        info: `${count} références antérieures, minimum ${minimum}, ${parJour ? "même jour et heure UTC" : "même heure UTC"}, ${jours} jours. H1 uniquement. Bougie courante provisoire ; référence vide/nulle : aucun ratio. Charger plus d'historique si nécessaire.`,
      }] } }),
    };
  },
};
