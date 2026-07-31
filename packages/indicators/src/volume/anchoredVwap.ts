/**
 * @axiom/indicators — volume/anchoredVwap.ts
 *
 * Anchored VWAP — VWAP cumulée à partir d'un point d'ancrage choisi.
 *
 * Contrairement à la VWAP de session (qui cumule depuis la première bougie),
 * l'Anchored VWAP démarre son cumul à un point d'ancrage exprimé par TIMESTAMP
 * (`anchorTime`, ms). L'ancrage effectif est la PREMIÈRE bougie dont `time >=
 * anchorTime` ; avant elle, la valeur n'a pas de sens et reste `undefined`.
 *
 * Pourquoi un timestamp plutôt qu'un index : l'ancrage par temps SURVIT à un
 * backfill (ajout de bougies plus anciennes en tête) — l'index d'une bougie se
 * décale alors, pas son timestamp. `anchorTime = 0` (défaut) = depuis le début
 * (comportement legacy, équivalent de l'ancien index 0).
 *
 * Compat : un ancien paramètre persisté `anchorIndex` n'est plus lu — le calc ne
 * consulte que `anchorTime` (absent → défaut 0), donc un état obsolète retombe
 * proprement sur le cumul complet sans planter.
 *
 * Le prix typique de chaque bougie est `hlc3 = (high + low + close) / 3`, déjà
 * fourni par le moteur via `ctx.hlc3`.
 *
 * Formule cumulative, de l'index d'ancrage jusqu'à i :
 *   cumTPV[i] = Σ (tp[k] * volume[k])   pour k de anchorIndex à i
 *   cumVol[i] = Σ volume[k]             pour k de anchorIndex à i
 *   vwap[i]   = cumTPV[i] / cumVol[i]
 *
 * Garde vol cumulé = 0 : tant qu'aucun volume n'a été cumulé depuis l'ancrage
 * (bougies sans volume), la moyenne pondérée n'est pas définie -> `undefined`.
 */

import type { Candle, IndicatorDef } from "@axiom/types";

/**
 * Premier index dont la bougie atteint l'ancrage (`time >= anchorTime`). Renvoie
 * `candles.length` si aucune bougie n'atteint l'ancrage (rien à cumuler). Isolé du
 * cumul pour garder la recherche temporelle lisible.
 */
function anchorIndexFromTime(candles: ReadonlyArray<Candle>, anchorTime: number): number {
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c !== undefined && c.time >= anchorTime) return i;
  }
  return candles.length;
}

export const anchoredVwap: IndicatorDef = {
  id: "anchoredVwap",
  name: "VWAP ancré",
  category: "volume",
  pane: "overlay",
  inputs: [
    {
      key: "anchorTime",
      name: "Timestamp d'ancrage (ms)",
      type: "number",
      default: 0,
      min: 0,
    },
  ],
  outputs: [{ key: "anchoredVwap", name: "VWAP ancré", style: "line" }],

  calc(candles, params, ctx) {
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    // Ancrage par timestamp : 0 (défaut) = depuis le début. Un éventuel paramètre
    // `anchorIndex` hérité est ignoré (on ne lit que `anchorTime`).
    const anchorTime = Number(params.anchorTime);
    const anchorIndex = anchorIndexFromTime(candles, Number.isFinite(anchorTime) ? anchorTime : 0);

    let cumTPV = 0; // Σ (prix typique * volume) depuis l'ancrage
    let cumVol = 0; // Σ volume depuis l'ancrage

    for (let i = anchorIndex; i < n; i++) {
      const c = candles[i];
      const tp = ctx.hlc3[i];
      if (c === undefined || tp === undefined) continue;

      cumTPV += tp * c.volume;
      cumVol += c.volume;

      // Garde vol=0 : sans volume cumulé, la moyenne pondérée n'est pas définie.
      if (cumVol > 0) out[i] = cumTPV / cumVol;
    }

    return { series: { anchoredVwap: out } };
  },
};
