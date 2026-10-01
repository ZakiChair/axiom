import type { IndicatorDef } from "@axiom/types";

/** NR inclut N amplitudes et leurs égalités ; Inside compare strictement deux
 * bougies. États descriptifs confirmés, sans direction ni projection de cassure.
 * Références : Sierra Chart StudiesReference.php ID=166 (n=N−1) et ID=92.
 */
export const narrowRange: IndicatorDef = {
  id: "narrowRange", name: "Compression NR / Inside Bar", category: "volatility", pane: "separate", precision: 0,
  inputs: [{ key: "length", name: "Fenêtre (bougies)", type: "number", default: 7, min: 2, max: 100 }],
  outputs: [{ key: "nr", name: "NR confirmé", style: "histogram" }, { key: "inside", name: "Inside confirmé", style: "line" }],
  calc(candles, params) {
    const length = typeof params.length === "number" && Number.isFinite(params.length)
      ? Math.max(2, Math.min(100, Math.floor(params.length))) : 7;
    const n = candles.length;
    const nr: Array<number | undefined> = new Array(n).fill(undefined);
    const inside: Array<number | undefined> = new Array(n).fill(undefined);
    const valides = candles.map((c) => c.closed !== false && Number.isFinite(c.time)
      && [c.open, c.high, c.low, c.close].every(Number.isFinite)
      && c.low <= Math.min(c.open, c.close) && Math.max(c.open, c.close) <= c.high);
    let motifPrecedent: string | undefined;
    let motif = "Historique insuffisant ou invalide pour NR";
    for (let i = 1; i < n; i++) {
      const c = candles[i]!;
      const precedent = candles[i - 1]!;
      if (valides[i] && valides[i - 1] && c.time > precedent.time) {
        inside[i] = c.high < precedent.high && c.low > precedent.low ? 1 : 0;
      }
      if (i < length - 1) continue;
      if (i === n - 1 && i > length - 1) motifPrecedent = motif;
      motif = "Historique invalide pour NR";
      let minimum = Infinity;
      let complete = true;
      for (let j = i - length + 1; j <= i; j++) {
        const b = candles[j]!;
        if (!valides[j] || (j > i - length + 1 && b.time <= candles[j - 1]!.time)) { complete = false; break; }
        const amplitude = b.high - b.low;
        if (!Number.isFinite(amplitude)) { complete = false; motif = "Amplitude non représentable"; break; }
        if (j < i) minimum = Math.min(minimum, amplitude);
      }
      if (complete) {
        nr[i] = c.high - c.low <= minimum ? 1 : 0;
        motif = `NR ${length} observations · Inside strict`;
      }
    }
    return {
      series: { nr, inside },
      ...(n === 0 ? {} : { annotations: { labels: [{
        idx: n - 1, valeur: 0, cible: "pane" as const, ancrageY: "haut-pane" as const, couleur: "--text-dim",
        texte: candles[n - 1]!.closed === false
          ? `Attente de clôture${motifPrecedent === undefined ? "" : ` · fenêtre précédente : ${motifPrecedent}`}` : motif,
        info: `NR compare ${length} amplitudes high−low, égalités incluses ; Inside exige des bords strictement intérieurs à la bougie précédente. Observations disponibles, pas une durée continue. États 0/1 sans direction prédictive.`,
      }] } }),
    };
  },
};
