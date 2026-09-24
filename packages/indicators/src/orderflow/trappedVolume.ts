/**
 * @axiom/indicators — orderflow/trappedVolume.ts
 *
 * Volume piégé au nord / au sud (« trapped longs / trapped shorts ») : delta
 * agresseur NET encore sous l'eau, libéré au retour du prix.
 *
 * Lots. Chaque bougie b à split taker valide crée UN lot de |δ_b|, avec
 * δ_b = buyVolume_b − sellVolume_b, réparti uniformément sur [low_b, high_b] :
 * LONG si δ_b > 0, SHORT si δ_b < 0, rien si δ_b = 0. Pourquoi le NET ? Les deux
 * jambes brutes (~50/50) faisaient de l'ancien calcul (Σ volume taker brut × part
 * au-dessus du close) un miroir du profil de volume : corrélation 0,996–1,000 avec
 * un split 50/50 ou permuté ; au plus bas 24 h, 98–100 % du volume acheteur déclaré
 * piégé, jusqu'à 1,3–2,2 fois l'OI Binance entier en 1h.
 *
 * Libération. À chaque barre k > b, un lot LONG perd les niveaux (close_{k−1}, high_k],
 * un lot SHORT perd [low_k, close_{k−1}) : seuls les niveaux sous l'eau à la clôture
 * précédente puis retouchés sont libérés (sortie « à l'équilibre »). Un long en profit
 * qui repasse sous son prix d'entrée DEVIENT piégé. Angle mort : un aller-retour sous
 * l'eau à l'intérieur d'une seule bougie n'est pas vu.
 *
 * Mesure à la barre i (close p_i), sur les lots nés dans (i−length, i] :
 *   trappedLong_i  =   Σ_long  w · |δ_b| · μ(vivant ∩ (p_i, +∞)) / (high_b − low_b)
 *   trappedShort_i = − Σ_short w · |δ_b| · μ(vivant ∩ (−∞, p_i)) / (high_b − low_b)
 *   w = 1 − (i − b)/length : le lot le plus ancien pèse 1/length, puis sort sans saut.
 * Bougie-point (high = low) : lot ponctuel au close, vivant tant que non libéré
 * (prevClose < e ≤ high_k pour un long, low_k ≤ e < prevClose pour un short).
 *
 * Lecture : nord = acheteurs nets au-dessus du prix dont le niveau n'a pas été retraité
 * depuis qu'ils sont sous l'eau → offre de sortie à l'équilibre (résistance) ; sud =
 * vendeurs nets sous le prix → carburant de squeeze (support), émis NÉGATIF
 * (histogramme deux faces). Unités de BASE (BTC, PEPE…), pas des USD. Sur le comptant,
 * ce sont des acheteurs/vendeurs agressifs NETS, pas des positions à levier. Valeurs
 * plus basses que l'ancien calcul d'un facteur qui croît avec le TF et varie selon le
 * marché (médianes de L+|S|, horizon 96 : ~30× en 5m, ~45× en 15m — BTCUSDT ≈ 180 BTC
 * contre 7 520 —, ~60 à 120× en 1h, ~200× en 4h et 1d) : les seuils d'alerte sont à
 * recalibrer au cas par cas, jamais par un facteur unique. Le chemin du prix compte
 * désormais : plus informatif, PAS plus lisse (les sauts visuels restent du même ordre,
 * voire plus).
 *
 * Bords : undefined tant que i < length−1, si close_i n'est pas fini, ou si la fenêtre
 * n'a AUCUNE bougie à split valide (fenêtre équilibrée → 0/0). Une bougie sans split
 * mais à prix finis ne crée pas de lot mais LIBÈRE. Une bougie à close non fini ne crée
 * pas de lot, même splittée (la première libération d'un lot part de sa clôture), et ne
 * compte pas comme split valide. Un trou (undefined) est sauté : la clôture de référence
 * reste le dernier close fini. Dépend du split taker (k[9] Binance).
 *
 * La sortie à i ne dépend QUE de (i−length, i] (invariance par préfixe) : recalcul
 * complet, aucun état entre deux appels. Passe avant unique ; les lots d'âge ≥ length
 * ou entièrement libérés sont élagués en place — coût ≈ n × (lots vivants + leurs morceaux,
 * chaque barre pouvant percer un trou dans chaque lot) : pire cas O(n·length²), jamais
 * observé sur des klines réelles (≤ 30 ms à 20 000 barres, horizon 1 000).
 */

import type { Candle, IndicatorDef } from "@axiom/types";
import { clampInt } from "../utils";

/** Split taker exploitable : les deux jambes présentes, finies et ≥ 0. */
function splitValide(c: Candle): c is Candle & { buyVolume: number; sellVolume: number } {
  return (
    c.buyVolume !== undefined &&
    c.sellVolume !== undefined &&
    Number.isFinite(c.buyVolume) &&
    Number.isFinite(c.sellVolume) &&
    c.buyVolume >= 0 &&
    c.sellVolume >= 0
  );
}

/** Lot de delta net né à la barre `b`. */
interface Lot {
  b: number;
  long: boolean;
  /** |δ_b|. */
  q: number;
  /** high_b − low_b ; 0 = lot ponctuel. */
  etendue: number;
  /** Niveaux encore vivants, [a0, z0, a1, z1…] triés et disjoints ([e, e] pour un lot ponctuel) ; vide = libéré. */
  vivant: number[];
}

/**
 * Retire ]a, z[ des niveaux vivants (le caractère ouvert/fermé des bornes est sans
 * effet sur la mesure). Renvoie le même tableau si rien n'est touché.
 */
function retirer(vivant: number[], a: number, z: number): number[] {
  const n = vivant.length;
  if (!(z > a) || n === 0 || z <= vivant[0]! || a >= vivant[n - 1]!) return vivant;
  const reste: number[] = [];
  for (let j = 0; j < n; j += 2) {
    const x = vivant[j]!;
    const y = vivant[j + 1]!;
    if (y <= a || x >= z) {
      reste.push(x, y);
      continue;
    }
    if (x < a) reste.push(x, a);
    if (y > z) reste.push(z, y);
  }
  return reste;
}

export const trappedVolume: IndicatorDef = {
  id: "trappedVolume",
  name: "Volume piégé (nord/sud)",
  category: "orderflow",
  pane: "separate",
  inputs: [
    { key: "length", name: "Horizon (barres)", type: "number", default: 96, min: 2, max: 1000 },
  ],
  outputs: [
    // Couleurs sémantiques : les longs piégés sont de l'offre latente au-dessus
    // du prix (pression baissière → --down), les shorts piégés de la demande
    // latente en-dessous (pression haussière → --up).
    { key: "trappedLong", name: "Longs piégés", style: "histogram", color: "--down" },
    { key: "trappedShort", name: "Shorts piégés", style: "histogram", color: "--up" },
  ],
  // 2 décimales : les valeurs nettes descendent sous l'unité en 1s ou sur les actifs
  // peu liquides, où la précision 0 affichait « 0 » (et « -0 ») sous une barre visible.
  precision: 2,
  calc(candles, params) {
    const length = clampInt(params.length, 96, 2, 1000);
    const n = candles.length;
    const longs: Array<number | undefined> = new Array(n).fill(undefined);
    const shorts: Array<number | undefined> = new Array(n).fill(undefined);

    const lots: Lot[] = [];
    let prevClose = Number.NaN; // dernier close fini (un trou ne le remplace pas)
    let dernierSplit = -Infinity; // dernière bougie à split valide et prix finis

    for (let i = 0; i < n; i++) {
      const k = candles[i];
      if (k === undefined) continue; // trou : ni libération, ni lot, ni mesure
      const { high, low, close } = k;
      const prixFinis = Number.isFinite(high) && Number.isFinite(low);

      // 1) Libérations par le chemin prevClose → high_i (longs) / low_i (shorts).
      if (prixFinis && Number.isFinite(prevClose)) {
        for (const lot of lots) {
          if (lot.etendue === 0) {
            const e = lot.vivant[0];
            if (e !== undefined && (lot.long ? prevClose < e && e <= high : low <= e && e < prevClose)) {
              lot.vivant = [];
            }
          } else {
            lot.vivant = lot.long ? retirer(lot.vivant, prevClose, high) : retirer(lot.vivant, low, prevClose);
          }
        }
      }

      // 2) Lot de la barre i (jamais libéré par sa propre barre).
      if (prixFinis && Number.isFinite(close) && splitValide(k)) {
        dernierSplit = i;
        const delta = k.buyVolume - k.sellVolume;
        if (delta !== 0) {
          const ponctuel = !(high > low);
          lots.push({
            b: i,
            long: delta > 0,
            q: Math.abs(delta),
            etendue: ponctuel ? 0 : high - low,
            vivant: ponctuel ? [close, close] : [low, high],
          });
        }
      }
      if (Number.isFinite(close)) prevClose = close;

      // 3) Élagage en place : lots sortis de la fenêtre (âge ≥ length) ou vidés.
      let garde = 0;
      for (const lot of lots) {
        if (i - lot.b < length && lot.vivant.length > 0) lots[garde++] = lot;
      }
      lots.length = garde;

      // 4) Mesure au close courant.
      if (i < length - 1 || !Number.isFinite(close) || dernierSplit <= i - length) continue;
      let nord = 0;
      let sud = 0;
      for (const lot of lots) {
        const v = lot.vivant;
        let part: number;
        if (lot.etendue === 0) {
          const e = v[0]!;
          part = (lot.long ? e > close : e < close) ? 1 : 0;
        } else {
          let mesure = 0;
          for (let j = 0; j < v.length; j += 2) {
            const x = v[j]!;
            const y = v[j + 1]!;
            mesure += lot.long ? Math.max(0, y - Math.max(x, close)) : Math.max(0, Math.min(y, close) - x);
          }
          part = mesure / lot.etendue;
        }
        const poids = (1 - (i - lot.b) / length) * lot.q * part;
        if (lot.long) nord += poids;
        else sud += poids;
      }
      longs[i] = nord;
      shorts[i] = sud === 0 ? 0 : -sud; // jamais « -0 »
    }

    return { series: { trappedLong: longs, trappedShort: shorts } };
  },
};
