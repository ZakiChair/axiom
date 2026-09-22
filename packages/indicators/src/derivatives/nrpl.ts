/**
 * @axiom/indicators — derivatives/nrpl.ts
 *
 * NRPL (Net Realized Profit/Loss, USD) — profits et pertes RÉALISÉS nets par jour
 * on-chain BTC (BGeometrics `nrpl-usd`, journalier — embargo J-7 de l'offre gratuite).
 * Les pics de profit réalisé marquent les prises de bénéfices de fin de phase
 * haussière ; les pertes réalisées massives, les capitulations.
 *
 * Sorties : `profit` (histogramme, valeurs ≥ 0, --up), `perte` (histogramme,
 * valeurs < 0, --down), `sma7` (SMA du net, param `lissage`, défaut 7 j).
 */
import type { IndicatorDef } from "@axiom/types";
import { smaAux } from "./hashRibbons";

export const nrpl: IndicatorDef = {
  id: "nrpl",
  name: "Profits / pertes réalisés nets (USD)",
  category: "derivatives",
  pane: "separate",
  aux: ["nrplUsd"],
  minTimeframe: "1d",
  precision: 0,
  inputs: [
    { key: "lissage", name: "Lissage SMA (j)", type: "number", default: 7, min: 2, max: 90 },
  ],
  outputs: [
    { key: "profit", name: "Profit réalisé", style: "histogram", color: "--up" },
    { key: "perte", name: "Perte réalisée", style: "histogram", color: "--down" },
    { key: "sma7", name: "SMA net", style: "line" },
  ],
  calc(candles, params, ctx) {
    const n = candles.length;
    const lissage = Math.max(2, Math.round(Number(params.lissage ?? 7)));
    const profit: Array<number | undefined> = new Array(n).fill(undefined);
    const perte: Array<number | undefined> = new Array(n).fill(undefined);
    const net: Array<number | undefined> = new Array(n).fill(undefined);
    const serie = ctx.aux?.nrplUsd;
    if (serie) {
      for (let i = 0; i < n; i++) {
        const v = serie[i];
        if (v === undefined || !Number.isFinite(v)) continue;
        net[i] = v;
        if (v >= 0) profit[i] = v;
        else perte[i] = v;
      }
    }
    return { series: { profit, perte, sma7: smaAux(net, lissage) } };
  },
};
