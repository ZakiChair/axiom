import type { IndicatorDef } from "@axiom/types";

/** ACF NIST lag 1 : même moyenne des N log-rendements au numérateur et au
 * dénominateur, sans Pearson de fenêtres tronquées ni correction N/(N−1).
 * N+1 clôtures confirmées, espacées régulièrement ; première valeur à N.
 * Référence : itl.nist.gov/div898/handbook/eda/section3/eda35c.htm.
 */
export const returnAutocorrelation: IndicatorDef = {
  id: "returnAutocorrelation", name: "Autocorrélation des rendements (lag 1)", category: "statistical", pane: "separate", precision: 3,
  inputs: [{ key: "length", name: "Fenêtre (rendements)", type: "number", default: 50, min: 3, max: 500 }],
  outputs: [{ key: "acf", name: "ACF 1", style: "line" }],
  calc(candles, params) {
    const length = typeof params.length === "number" && Number.isFinite(params.length)
      ? Math.max(3, Math.min(500, Math.floor(params.length))) : 50;
    const n = candles.length;
    const acf: Array<number | undefined> = new Array(n).fill(undefined);
    let motifPrecedent: string | undefined;
    let motif = "Historique insuffisant";
    for (let i = length; i < n; i++) {
      if (i === n - 1 && i > length) motifPrecedent = motif;
      motif = "Historique invalide";
      const rendements: number[] = [];
      let somme = 0;
      let amplitude = 0;
      let pas: number | undefined;
      let complete = true;
      for (let j = i - length; j <= i; j++) {
        const c = candles[j]!;
        if (c.closed === false || !Number.isFinite(c.time) || !Number.isFinite(c.close) || c.close <= 0) { complete = false; break; }
        if (j === i - length) continue;
        const precedent = candles[j - 1]!;
        const intervalle = c.time - precedent.time;
        if (!Number.isFinite(intervalle) || intervalle <= 0) { complete = false; break; }
        if (pas !== undefined && intervalle !== pas) { complete = false; motif = "Pas temporel irrégulier"; break; }
        pas = intervalle;
        const ratio = c.close / precedent.close;
        const r = Number.isFinite(ratio) && ratio > 0 ? Math.log(ratio) : Math.log(c.close) - Math.log(precedent.close);
        rendements.push(r);
        somme += r;
        amplitude = Math.max(amplitude, Math.abs(r));
      }
      if (!complete) continue;
      const moyenne = somme / length;
      let denominateur = 0;
      let numerateur = 0;
      let ecartMax = 0;
      let precedent: number | undefined;
      for (const r of rendements) {
        const ecart = r - moyenne;
        denominateur += ecart * ecart;
        if (precedent !== undefined) numerateur += ecart * precedent;
        ecartMax = Math.max(ecartMax, Math.abs(ecart));
        precedent = ecart;
      }
      motif = "Variance indéterminable";
      if (ecartMax <= 16 * Number.EPSILON * Math.max(1, amplitude) || denominateur === 0) continue;
      const valeur = numerateur / denominateur;
      if (Number.isFinite(valeur)) {
        acf[i] = Math.max(-1, Math.min(1, valeur));
        motif = `${length} rendements · lag 1 · pas régulier observé`;
      }
    }
    return {
      series: { acf },
      ...(n === 0 ? {} : { annotations: { labels: [{
        idx: n - 1, valeur: 0, cible: "pane" as const, ancrageY: "haut-pane" as const, couleur: "--text-dim",
        texte: candles[n - 1]!.closed === false
          ? `Attente de clôture${motifPrecedent === undefined ? "" : ` · fenêtre précédente : ${motifPrecedent}`}` : motif,
        info: `ACF sur ${length} log-rendements, donc ${length + 1} clôtures. Positif : liaison adjacente ; négatif : alternance observée. Descriptif, sans prévision du sens du prix. Les fermetures de marché peuvent rendre la fenêtre irrégulière ; un sous-échantillonnage uniforme reste indétectable.`,
      }] } }),
    };
  },
};
