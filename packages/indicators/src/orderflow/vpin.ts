/**
 * @axiom/indicators — orderflow/vpin.ts
 *
 * VPIN — Volume-Synchronized Probability of Informed Trading (Easley, López de
 * Prado, O'Hara) : déséquilibre moyen du flux agresseur, mesuré par BUCKETS DE
 * VOLUME et non par unité de temps.
 *
 *   q_j = buyVolume_j − sellVolume_j                  (flux net signé, en base)
 *   un bucket = un volume fixe B = V_fenêtre / buckets
 *   VPIN = (1/nb) · Σ_buckets |Σq| / V_bucket          ∈ [0, 1]
 *
 * Pourquoi des buckets de volume : sur des buckets TEMPORELS, une heure calme et
 * une heure de liquidation reçoivent le même poids ; en volume, chaque bucket
 * contient le même « effort de marché ». Un VPIN élevé = flux de plus en plus
 * déséquilibré, lecture classique de toxicité / d'anticipation de volatilité.
 *
 * Répartition intra-barre : la barre agrège plusieurs trades et l'ordre exact des
 * achats/ventes n'est pas connu ; le split taker de la barre est réparti
 * PROPORTIONNELLEMENT au recouvrement de chaque bucket. Deux limites assumées :
 *  - une barre plus grosse qu'un bucket « étale » son déséquilibre sur ce bucket ;
 *  - le VPIN par bougies est donc plus lisse que le VPIN tick (qui exige un flux
 *    aggTrade) — il lit des RÉGIMES de déséquilibre, pas un instant.
 *
 * Dépend du split taker (buyVolume/sellVolume) : l'app marque cet indicateur
 * UNUSABLE hors Binance, comme le CVD. Une barre sans volume positif ou sans split
 * invalide la fenêtre (pas de zéro fabriqué).
 *
 * Fenêtre glissante des `length` dernières barres ; `buckets` buckets de volume
 * égal. Premier point à l'index `length − 1`. Complexité O(length + buckets) par
 * point (parcours à pointeur unique, pas de recalcul par bucket).
 */

import type { IndicatorDef } from "@axiom/types";
import { clampInt } from "../utils";

export const vpin: IndicatorDef = {
  id: "vpin",
  name: "VPIN (toxicité du flux)",
  category: "orderflow",
  pane: "separate",
  inputs: [
    { key: "length", name: "Fenêtre (barres)", type: "number", default: 100, min: 10, max: 500 },
    { key: "buckets", name: "Buckets de volume", type: "number", default: 50, min: 5, max: 200 },
  ],
  outputs: [
    { key: "vpin", name: "VPIN", style: "line" },
    { key: "seuil", name: "0,5", style: "line" },
  ],
  precision: 3,
  calc(candles, params) {
    const length = clampInt(params.length, 100, 10, 500);
    const buckets = clampInt(params.buckets, 50, 5, 200);
    const n = candles.length;
    const out: Array<number | undefined> = new Array(n).fill(undefined);

    // Tampons réutilisés d'un point à l'autre (aucune allocation dans la boucle).
    const vols = new Float64Array(length);
    const buys = new Float64Array(length);
    const sells = new Float64Array(length);
    const cumul = new Float64Array(length);

    for (let i = length - 1; i < n; i++) {
      let total = 0;
      let ok = true;
      for (let k = 0; k < length; k++) {
        const c = candles[i - length + 1 + k];
        const b = c?.buyVolume;
        const s = c?.sellVolume;
        if (c === undefined || b === undefined || s === undefined) {
          ok = false;
          break;
        }
        if (!Number.isFinite(b) || !Number.isFinite(s) || b < 0 || s < 0) {
          ok = false;
          break;
        }
        const v = b + s;
        if (!(v > 0)) {
          ok = false;
          break;
        }
        vols[k] = v;
        buys[k] = b;
        sells[k] = s;
        total += v;
        cumul[k] = total;
      }
      if (!ok || !(total > 0)) continue;

      const taille = total / buckets;
      if (!(taille > 0)) continue;

      let somme = 0;
      let compte = 0;
      let k = 0;
      let lo = 0; // volume cumulé au début de la barre k
      for (let m = 0; m < buckets; m++) {
        const debut = m * taille;
        const fin = (m + 1) * taille;
        let bB = 0;
        let sB = 0;
        while (k < length) {
          const hi = cumul[k]!;
          if (hi <= debut) {
            k += 1;
            lo = hi;
            continue;
          }
          const recouvrement = Math.min(hi, fin) - Math.max(lo, debut);
          if (recouvrement <= 0) break;
          const frac = recouvrement / vols[k]!;
          bB += buys[k]! * frac;
          sB += sells[k]! * frac;
          if (hi <= fin) {
            k += 1;
            lo = hi;
          } else {
            break;
          }
        }
        const tot = bB + sB;
        if (tot > 0) {
          somme += Math.abs(bB - sB) / tot;
          compte += 1;
        }
      }
      if (compte > 0) out[i] = somme / compte;
    }

    return {
      series: {
        vpin: out,
        seuil: new Array<number>(n).fill(0.5),
      },
    };
  },
};
