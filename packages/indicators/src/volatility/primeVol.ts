/**
 * @axiom/indicators — volatility/primeVol.ts
 *
 * Prime de volatilité EX ANTE (BTC et ETH) : DVOL Deribit (IV 30 j, prospective, aux `dvol`)
 * face à la volatilité RÉALISÉE des clôtures quotidiennes UTC (rétrospective).
 *   RV  = écart-type population des L log-rendements quotidiens × √365 × 100 (définition de la
 *         fenêtre VOL, lib/volCone.ts, et de l'indicateur `rv`) ;
 *   VRP = DVOL − RV (points de vol) : proxy ex ante, PAS la prime réalisée ex post ;
 *   percentile = rang mi-distance du DVOL parmi les N derniers DVOL quotidiens (convention de
 *         `rangPercentile`, lib/referentiel.ts ; 90 j par défaut comme le régime).
 *
 * Séries QUOTIDIENNES quel que soit l'intervalle : une clôture quotidienne n'est lue qu'à la
 * bougie CLÔTURÉE qui finit exactement à minuit UTC (fin = ouverture suivante, ou dernier pas
 * extrapolé : convention d'`alignAux`). Une bougie intrajournalière porte l'état du dernier jour
 * clos, la bougie en cours n'ajoute aucune clôture : rien ne se repeint. L'aux `dvol` (points
 * datés à la fin de leur jour, aligné en mode clôture) est lu sur la même borne. Bougies de plus
 * d'un jour ou non alignées sur minuit UTC : RV et percentile non mesurés (libellé), DVOL seul.
 */
import type { IndicatorDef } from "@axiom/types";
import { clampInt } from "../utils";

const JOUR = 86_400_000;

/** RV annualisée (%) des clôtures consécutives fournies. */
function volRealisee(clotures: readonly number[]): number {
  let s = 0;
  let s2 = 0;
  const k = clotures.length - 1;
  for (let j = 1; j <= k; j++) {
    const r = Math.log(clotures[j]! / clotures[j - 1]!);
    s += r;
    s2 += r * r;
  }
  return Math.sqrt(Math.max(0, s2 / k - (s / k) ** 2) * 365) * 100;
}

export const primeVol: IndicatorDef = {
  id: "primeVol",
  name: "Prime de vol (DVOL − RV)",
  category: "volatility",
  pane: "separate",
  precision: 1,
  aux: ["dvol"],
  minTimeframe: "1h",
  // Libellés courts : ce def entre dans le chunk initial (budget de chargement).
  inputs: [
    { key: "longueurRv", name: "RV (jours)", type: "number", default: 30, min: 5, max: 365 },
    { key: "fenetre", name: "Percentile (jours)", type: "number", default: 90, min: 20, max: 365 },
  ],
  outputs: [
    { key: "dvol", name: "DVOL", style: "line" },
    { key: "vrp", name: "VRP ex ante", style: "histogram" },
    { key: "percentile", name: "Percentile DVOL", style: "line" },
  ],
  calc(candles, params, ctx) {
    const L = clampInt(params.longueurRv, 30, 5, 365);
    const N = clampInt(params.fenetre, 90, 20, 365);
    const n = candles.length;
    const dvol: Array<number | undefined> = new Array(n).fill(undefined);
    const vrp: Array<number | undefined> = new Array(n).fill(undefined);
    const percentile: Array<number | undefined> = new Array(n).fill(undefined);
    const clotures: number[] = []; // clôtures quotidiennes de jours consécutifs (≤ L + 1)
    const ivs: number[] = []; // DVOL quotidiens de jours consécutifs (≤ N)
    let jour = Number.NaN; // dernier jour UTC clos lu
    let rv: number | undefined;
    for (let i = 0; i < n; i++) {
      const c = candles[i]!;
      const v = ctx.aux?.dvol?.[i];
      const iv = v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined;
      dvol[i] = iv;
      const fin = candles[i + 1]?.time ?? (i > 0 ? 2 * c.time - candles[i - 1]!.time : Number.NaN);
      if (c.closed !== false && fin % JOUR === 0 && fin > c.time && fin - c.time <= JOUR) {
        if (fin / JOUR - 1 !== jour + 1) clotures.length = ivs.length = 0;
        jour = fin / JOUR - 1;
        if (c.close > 0 && Number.isFinite(c.close)) clotures.push(c.close);
        else clotures.length = 0;
        if (clotures.length > L + 1) clotures.shift();
        if (iv === undefined) ivs.length = 0;
        else ivs.push(iv);
        if (ivs.length > N) ivs.shift();
        rv = clotures.length === L + 1 ? volRealisee(clotures) : undefined;
      }
      // L'état d'un jour clos ne vaut que ce jour-là et le suivant (trou de données : rien).
      const d = Math.floor(c.time / JOUR);
      if (iv === undefined || (d !== jour && d !== jour + 1)) continue;
      if (rv !== undefined) vrp[i] = iv - rv;
      if (ivs.length === N) {
        let sous = 0;
        for (const x of ivs) sous += x < iv ? 1 : x === iv ? 0.5 : 0;
        percentile[i] = (sous / N) * 100;
      }
    }
    const texte =
      dvol[n - 1] === undefined
        ? "DVOL indisponible (BTC/ETH seulement)"
        : vrp[n - 1] === undefined
          ? `RV : ${L + 1} clôtures UTC consécutives requises`
          : percentile[n - 1] === undefined
            ? `Percentile : ${N} j de DVOL requis`
            : `VRP ex ante, percentile ${N} j`;
    return {
      series: { dvol, vrp, percentile },
      ...(n === 0 ? {} : { annotations: { labels: [{
        idx: n - 1, valeur: 0, cible: "pane" as const, ancrageY: "haut-pane" as const, couleur: "--text-dim", texte,
        info: "VRP = DVOL (IV 30 j, prospective) − RV des clôtures UTC passées : proxy ex ante, pas la prime réalisée. Valeurs du dernier jour clos.",
      }] } }),
    };
  },
};
