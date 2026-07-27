/**
 * @axiom/indicators — derivatives/premiumSpotPerp.ts
 *
 * Prime spot/perp EN VISUEL sur le chart maître (lot v2.1) : trace la ligne mark
 * price du perp (aux `mark`, chemin basisPct — 1 h LOCF Binance USDT-M, d'où le
 * rendu en marches d'escalier sous H1, assumé) et remplit un RUBAN entre le close
 * spot et le mark sur chaque run contigu où |prime| ≥ seuil, avec
 * prime% = 100 × (mark − close) / close. Ruban --up quand le perp est AU-DESSUS
 * (contango), --down en dessous (discount). Un run se coupe sur : trou de donnée,
 * |prime| < seuil, ou bascule de signe ; longueur minimale 2 (un polygone d'une
 * bougie est invisible). Cap 40 runs, les plus récents. Le seuil par défaut
 * (0,05 %) est une hypothèse à CALIBRER au gate visuel (règle SQZ : consigner).
 * Tooltip (info) : prime moyenne + extrême du run, via le crosshair du pont.
 */

import type { IndicatorDef, RubanAnnotation } from "@axiom/types";
import { closeOf } from "../utils";

/** Cap de rubans par calc (les plus récents priment). */
const MAX_RUBANS = 40;

function fmtSigne(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

export const premiumSpotPerp: IndicatorDef = {
  id: "premiumSpotPerp",
  name: "Prime spot-perp",
  category: "derivatives",
  pane: "overlay",
  aux: ["mark"],
  minTimeframe: "15m",
  inputs: [
    { key: "seuilPct", name: "Seuil prime (%)", type: "number", default: 0.05, min: 0, max: 5 },
  ],
  outputs: [{ key: "mark", name: "Mark perp", style: "line" }],
  calc(candles, params, ctx) {
    const n = candles.length;
    const mark: Array<number | undefined> = new Array(n).fill(undefined);
    const markAux = ctx.aux?.mark;
    if (!markAux) return { series: { mark } };

    const close = closeOf(candles);
    const seuil = Number(params.seuilPct ?? 0.05);
    const primes: Array<number | undefined> = new Array(n).fill(undefined);
    for (let i = 0; i < n; i++) {
      const m = markAux[i];
      const c = close[i];
      if (m === undefined || c === undefined || !Number.isFinite(m) || !Number.isFinite(c) || c === 0) continue;
      mark[i] = m;
      primes[i] = (100 * (m - c)) / c;
    }

    // Runs contigus : même signe, |prime| ≥ seuil, longueur ≥ 2.
    const rubans: RubanAnnotation[] = [];
    let debut = -1;
    let signe = 0;
    const cloreRun = (fin: number) => {
      if (debut < 0) return;
      const longueur = fin - debut + 1;
      if (longueur >= 2) {
        const hauts: number[] = [];
        const bas: number[] = [];
        let somme = 0;
        let extreme = 0;
        for (let j = debut; j <= fin; j++) {
          const m = mark[j] ?? 0;
          const c = close[j] ?? 0;
          hauts.push(Math.max(m, c));
          bas.push(Math.min(m, c));
          const p = primes[j] ?? 0;
          somme += p;
          if (Math.abs(p) > Math.abs(extreme)) extreme = p;
        }
        rubans.push({
          deIdx: debut,
          hauts,
          bas,
          couleur: signe > 0 ? "--up" : "--down",
          alpha: 0.15,
          info:
            `Prime perp moyenne ${fmtSigne(somme / longueur)} % sur ${longueur} bougies ` +
            `(extrême ${fmtSigne(extreme)} %)`,
        });
      }
      debut = -1;
      signe = 0;
    };

    for (let i = 0; i < n; i++) {
      const p = primes[i];
      const s = p === undefined ? 0 : Math.sign(p);
      const dansRun = p !== undefined && Math.abs(p) >= seuil && s !== 0;
      if (!dansRun || (debut >= 0 && s !== signe)) cloreRun(i - 1);
      if (dansRun && debut < 0) {
        debut = i;
        signe = s;
      }
    }
    cloreRun(n - 1);

    const recents = rubans.slice(-MAX_RUBANS);
    return recents.length > 0
      ? { series: { mark }, annotations: { rubans: recents } }
      : { series: { mark } };
  },
};
