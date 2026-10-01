import type { IndicatorDef } from "@axiom/types";

/** Repli courant sous le maximum des N CLOSES et hausse arithmétique requise.
 * Ce sommet glissant n'est ni un ATH ni le maximum drawdown d'un compte.
 * Repli relatif : Hsieh/Barmish, arxiv.org/html/1710.01503#S2 ; ici signé
 * négativement et limité à N observations, sans modèle de contrôle du papier.
 */
export const rollingDrawdown: IndicatorDef = {
  id: "rollingDrawdown", name: "Repli au sommet glissant / récupération (%)", category: "volatility", pane: "separate", precision: 2,
  inputs: [{ key: "length", name: "Fenêtre (clôtures)", type: "number", default: 100, min: 2, max: 1000 }],
  outputs: [{ key: "drawdown", name: "Repli %", style: "line" }, { key: "recovery", name: "Hausse requise %", style: "line" }],
  calc(candles, params) {
    const length = typeof params.length === "number" && Number.isFinite(params.length)
      ? Math.max(2, Math.min(1000, Math.floor(params.length))) : 100;
    const n = candles.length;
    const drawdown: Array<number | undefined> = new Array(n).fill(undefined);
    const recovery: Array<number | undefined> = new Array(n).fill(undefined);
    let motifPrecedent: string | undefined;
    let motif = "Historique insuffisant";
    for (let i = length - 1; i < n; i++) {
      if (i === n - 1 && i > length - 1) motifPrecedent = motif;
      motif = "Historique invalide";
      let sommet = 0;
      let complete = true;
      for (let j = i - length + 1; j <= i; j++) {
        const c = candles[j]!;
        if (c.closed === false || !Number.isFinite(c.time) || !Number.isFinite(c.close) || c.close <= 0
          || (j > i - length + 1 && c.time <= candles[j - 1]!.time)) { complete = false; break; }
        sommet = Math.max(sommet, c.close);
      }
      if (!complete) continue;
      const close = candles[i]!.close;
      const ecart = sommet - close;
      drawdown[i] = ecart === 0 ? 0 : -100 * (ecart / sommet);
      const hausse = 100 * (ecart / close);
      if (Number.isFinite(hausse)) recovery[i] = hausse === 0 ? 0 : hausse;
      motif = recovery[i] === undefined ? "Hausse requise non représentable" : `Sommet des ${length} clôtures`;
    }
    return {
      series: { drawdown, recovery },
      ...(n === 0 ? {} : { annotations: { labels: [{
        idx: n - 1, valeur: 0, cible: "pane" as const, ancrageY: "haut-pane" as const, couleur: "--text-dim",
        texte: candles[n - 1]!.closed === false
          ? `Attente de clôture${motifPrecedent === undefined ? "" : ` · fenêtre précédente : ${motifPrecedent}`}` : motif,
        info: `Sommet des ${length} clôtures confirmées disponibles, pas des mèches. Repli courant et hausse requise en %. Le sommet peut sortir de la fenêtre sans hausse du prix : aucune récupération réalisée ni objectif promis.`,
      }] } }),
    };
  },
};
