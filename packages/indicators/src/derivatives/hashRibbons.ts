/**
 * @axiom/indicators — derivatives/hashRibbons.ts
 *
 * Hash Ribbons — croisement des moyennes mobiles du HASHRATE réseau Bitcoin
 * (mempool.space, journalier, ~1 an). Capitulation des mineurs quand la SMA courte
 * passe sous la longue ; reprise quand elle repasse au-dessus.
 *
 * Sorties SANS DIMENSION (les deux partagent l'échelle [−1, ~1,2]) :
 *   ratio  : SMA courte / SMA longue (≈ 1 ; le croisement se lit au passage de
 *            `ratio` par 1,0 ; undefined si l'une des SMA l'est ou si longue ≤ 0)
 *   regime : −1 tant que SMA courte < SMA longue (capitulation), +1 pendant les
 *            10 barres suivant un croisement HAUSSIER (reprise), 0 sinon.
 *
 * Les VALEURS ABSOLUES du hashrate (H/s) restent consultables dans CHAIN (Mineurs).
 * Série aux `hashrate` — BTC uniquement, `minTimeframe: "1d"`.
 * La SMA ignore les `undefined` : une fenêtre INCOMPLÈTE → `undefined` (jamais
 * de moyenne faussée par des trous comptés pour zéro).
 */
import type { IndicatorDef } from "@axiom/types";

/** Nombre de barres du signal « reprise » (+1) après le croisement haussier. */
const BARRES_REPRISE = 10;

/**
 * SMA sur une série aux à TROUS : la fenêtre glissante ne retient que les valeurs
 * définies ; moins de `length` valeurs définies dans la fenêtre → `undefined`. PURE.
 */
export function smaAux(
  values: ReadonlyArray<number | undefined>,
  length: number,
): Array<number | undefined> {
  length = Math.round(length);
  const n = values.length;
  const out: Array<number | undefined> = new Array(n).fill(undefined);
  if (length <= 0) return out;
  let somme = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v !== undefined && Number.isFinite(v)) {
      somme += v;
      nb += 1;
    }
    if (i >= length) {
      const vieux = values[i - length];
      if (vieux !== undefined && Number.isFinite(vieux)) {
        somme -= vieux;
        nb -= 1;
      }
    }
    if (i >= length - 1 && nb === length) out[i] = somme / length;
  }
  return out;
}

export const hashRibbons: IndicatorDef = {
  id: "hashRibbons",
  name: "Hash Ribbons (SMA courte / SMA longue)",
  category: "derivatives",
  pane: "separate",
  aux: ["hashrate"],
  minTimeframe: "1d",
  precision: 3,
  inputs: [
    { key: "courte", name: "SMA courte (barres)", type: "number", default: 30, min: 5, max: 120 },
    { key: "longue", name: "SMA longue (barres)", type: "number", default: 60, min: 10, max: 365 },
  ],
  outputs: [
    { key: "ratio", name: "SMA courte / SMA longue", style: "line" },
    { key: "regime", name: "Régime (−1 capitulation / +1 reprise)", style: "line" },
  ],
  calc(candles, params, ctx) {
    const n = candles.length;
    const courte = Math.max(5, Math.round(Number(params.courte ?? 30)));
    const longue = Math.max(10, Math.round(Number(params.longue ?? 60)));
    const ratio: Array<number | undefined> = new Array(n).fill(undefined);
    const regime: Array<number | undefined> = new Array(n).fill(undefined);
    const serie = ctx.aux?.hashrate;
    if (!serie) return { series: { ratio, regime } };
    const smaC = smaAux(serie, courte);
    const smaL = smaAux(serie, longue);
    let repriseRestante = 0;
    for (let i = 0; i < n; i++) {
      const c = smaC[i];
      const l = smaL[i];
      if (c === undefined || l === undefined || !(l > 0)) continue;
      ratio[i] = c / l;
      const cPrev = smaC[i - 1];
      const lPrev = smaL[i - 1];
      if (cPrev !== undefined && lPrev !== undefined && cPrev <= lPrev && c > l) {
        repriseRestante = BARRES_REPRISE; // croisement haussier → reprise pendant 10 barres
      }
      if (c < l) {
        regime[i] = -1; // capitulation : courte sous la longue
        repriseRestante = 0;
      } else if (repriseRestante > 0) {
        regime[i] = 1;
        repriseRestante -= 1;
      } else {
        regime[i] = 0;
      }
    }
    return { series: { ratio, regime } };
  },
};
