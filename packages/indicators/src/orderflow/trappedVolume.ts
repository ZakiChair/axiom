/**
 * @axiom/indicators — orderflow/trappedVolume.ts
 *
 * Volume piégé au nord / au sud (« trapped longs / trapped shorts »).
 *
 * Pour chaque barre i, référence P = close[i] ; fenêtre glissante des `length`
 * barres [i−length+1, i]. Seul le volume AGRESSIF (taker) de chaque bougie j
 * est distribué uniformément sur [low_j, high_j] :
 *   fracAbove_j = clamp((high_j − P) / (high_j − low_j), 0, 1)
 *   (bougie-point high = low : 1 si tout le niveau est au-dessus de P, 0 sinon)
 *
 *   trappedLong_i  =   Σ_j buyVolume_j  × fracAbove_j
 *   trappedShort_i = − Σ_j sellVolume_j × (1 − fracAbove_j)
 *
 * Pourquoi pas le volume total ? Chaque trade a un acheteur ET un vendeur :
 * attribuer tout le volume sous le prix aux « shorts piégés » comptait aussi
 * les acheteurs de ces trades — gagnants, pas piégés. Mesuré sur BTCUSDT 15m
 * (fenêtre 96) : au plus haut 24 h, 100 % du volume de la fenêtre était déclaré
 * « shorts piégés » (−24 365 BTC) et les valeurs sautaient de plus de 30 %
 * d'une barre à l'autre — l'indicateur mesurait le volume, pas le piège.
 *
 * Seul l'agresseur porte l'intention directionnelle : un taker acheteur
 * traité au-dessus de P est un long sous l'eau ; un taker vendeur traité
 * en-dessous de P est un short sous l'eau. Le côté passif (maker) est
 * symétrique et ne discrimine pas.
 *
 * Lecture :
 *  - trappedLong = volume ACHETEUR agressif traité au-dessus du prix courant
 *    → longs « bloqués au nord », réservoir de vendeurs au retour (résistance).
 *  - trappedShort = volume VENDEUR agressif traité en-dessous → shorts « bloqués
 *    au sud », carburant de squeeze au retour (support). Émis NÉGATIF :
 *    histogramme deux faces, nord au-dessus de zéro, sud en-dessous.
 *
 * Approximation : volume agressif, pas positions nettes — les sorties déjà
 * soldées entre le trade et la barre courante ne sont pas connues.
 *
 * Dépend du split taker (`buyVolume`/`sellVolume`, klines Binance k[9]) :
 * une bougie sans split exploitable (absent, non fini ou négatif) ne contribue
 * pas ; une fenêtre sans AUCUNE bougie splittée émet `undefined`. Positions
 * `undefined` tant que la fenêtre n'est pas pleine (i < length−1).
 * Complexité O(n × length) — `length` borné à 1000.
 */

import type { IndicatorDef } from "@axiom/types";
import { clampInt } from "../utils";

/** Volume agressif exploitable : les deux jambes présentes, finies et ≥ 0. */
function splitValide(c: { buyVolume?: number; sellVolume?: number }): c is { buyVolume: number; sellVolume: number } {
  return (
    c.buyVolume !== undefined &&
    c.sellVolume !== undefined &&
    Number.isFinite(c.buyVolume) &&
    Number.isFinite(c.sellVolume) &&
    c.buyVolume >= 0 &&
    c.sellVolume >= 0
  );
}

export const trappedVolume: IndicatorDef = {
  id: "trappedVolume",
  name: "Volume piégé (nord/sud)",
  category: "orderflow",
  pane: "separate",
  inputs: [
    { key: "length", name: "Fenêtre", type: "number", default: 96, min: 2, max: 1000 },
  ],
  outputs: [
    // Couleurs sémantiques : les longs piégés sont de l'offre latente au-dessus
    // du prix (pression baissière → --down), les shorts piégés de la demande
    // latente en-dessous (pression haussière → --up).
    { key: "trappedLong", name: "Longs piégés", style: "histogram", color: "--down" },
    { key: "trappedShort", name: "Shorts piégés", style: "histogram", color: "--up" },
  ],
  precision: 0,
  calc(candles, params) {
    const length = clampInt(params.length, 96, 2, 1000);
    const n = candles.length;
    const longs: Array<number | undefined> = new Array(n).fill(undefined);
    const shorts: Array<number | undefined> = new Array(n).fill(undefined);

    for (let i = length - 1; i < n; i++) {
      const cur = candles[i];
      if (cur === undefined) continue;
      const p = cur.close;
      if (!Number.isFinite(p)) continue;

      let auDessus = 0;
      let auDessous = 0;
      let vu = 0;
      for (let j = i - length + 1; j <= i; j++) {
        const c = candles[j];
        if (c === undefined) continue; // trou de données : contribution nulle
        if (!splitValide(c)) continue; // pas de split taker : contribution nulle
        if (!Number.isFinite(c.high) || !Number.isFinite(c.low)) continue;
        const range = c.high - c.low;
        const fracAbove =
          range > 0 ? Math.min(1, Math.max(0, (c.high - p) / range)) : c.low > p ? 1 : 0;
        auDessus += c.buyVolume * fracAbove;
        auDessous += c.sellVolume * (1 - fracAbove);
        vu++;
      }
      // Fenêtre sans aucun split exploitable : pas de mesure plutôt que 0 faux.
      if (vu === 0) continue;
      longs[i] = auDessus;
      shorts[i] = -auDessous;
    }

    return { series: { trappedLong: longs, trappedShort: shorts } };
  },
};
