/**
 * @axiom/indicators — statistical/betaRef.ts
 *
 * Bêta roulant des RENDEMENTS LOG du symbole courant vs ceux du symbole de RÉFÉRENCE
 * (série auxiliaire `refClose`, close du symbole de référence aligné LOCF sur les bougies
 * du chart). Deuxième indicateur cross-asset `statistical` : mesure la SENSIBILITÉ du
 * marché courant aux mouvements de la référence (β > 1 amplifie, β < 1 amortit, β < 0
 * inverse) — le β d'une régression sans constante de r sur rRef.
 *
 * Rendements LOG (mêmes conventions que rollingCorrelation) :
 *   r[i]    = ln(close[i] / close[i-1])
 *   rRef[i] = ln(ref[i]   / ref[i-1])
 * Un rendement (par jambe) n'existe que si SES DEUX bornes sont finies et > 0 ; une PAIRE
 * de rendements n'est exploitable que si les DEUX jambes y sont définies. Un trou de
 * refClose invalide donc le rendement du trou (borne haute) ET du point suivant (borne
 * basse) — même discipline positionnelle que rollingCorrelation.
 *
 * Bêta sur la fenêtre POSITIONNELLE des `length` derniers slots de rendement :
 *   beta = cov(r, rRef) / var(rRef)
 * Covariance/variance de convention POPULATION (les facteurs N² se simplifient dans le
 * ratio, cohérent en interne avec la Pearson de T3) :
 *   beta = (L·Σxy − Σx·Σy) / (L·Σyy − Σy·Σy)      [x = r, y = rRef]
 * `undefined` si la fenêtre est incomplète, si un slot y manque (pas de fenêtre à trous),
 * ou si var(rRef) = 0 (référence plate) — évite le 0/0. Le dénominateur est TOUJOURS la
 * jambe de RÉFÉRENCE (y).
 *
 * ALPHA RÉSIDUEL CUMULÉ (sortie `alpha`, chantier du 2026-11-07, SUG-6 volet 1) : la part
 * du rendement qui n'est PAS expliquée par le bêta, cumulée — « quelle part de la hausse
 * n'est que du bêta de la référence ? ». Aucune nouvelle définition de β : c'est le β
 * roulant ci-dessus, pris EX ANTE (celui du slot précédent, estimé sur [j-length .. j-1]) :
 *   résidu[j] = r[j] − beta[j-1] · rRef[j]
 *   alpha[j]  = Σ résidu (depuis l'ouverture du segment courant)
 * POURQUOI le β du slot précédent : estimer β sur une fenêtre qui contient r[j] rendrait le
 * résidu orthogonal par construction (biais d'estimation dans l'échantillon) et ferait
 * dépendre le point j de lui-même ; le β ex ante est connu AVANT le rendement qu'il sert à
 * décomposer — aucune anticipation, et la valeur d'un point passé ne change jamais quand
 * des bougies s'ajoutent (causalité par préfixe, testée).
 * Résidu absent (β précédent indéfini, ou l'une des deux jambes manquante) ⇒ alpha
 * undefined sur ce slot ET le cumul est FERMÉ : le segment suivant repart de son premier
 * résidu. Jamais un 0 inventé pour combler le trou (un niveau cumulé « à travers » un
 * résidu inconnu serait faux). Unité : log-rendement (0,10 ≈ +10,5 % au-delà du bêta).
 * Comme le bêta lui-même, la valeur de la bougie EN COURS bouge avec son close.
 *
 * AFFICHAGE DE L'ALPHA (paramètre `afficherAlpha`, revue du 2026-11-07) : coupé par défaut.
 * L'alpha cumulé (log-rendement, couramment −2 à −3 sur un long historique 1d) partage
 * l'échelle du pane avec β (≈ 0,5 à 2) et le repère 1 : affiché d'office, il écraserait la
 * lecture du β de tous les graphes existants. Coupé, la série `alpha` est entièrement
 * undefined (rien n'est tracé, l'échelle reste celle du β) ; activé, β, repère et alpha
 * partagent la même échelle (limite assumée : un seul pane par indicateur).
 *
 * Moteur PUR : aucun fetch. Lecture défensive de `ctx.aux.refClose` — référence absente
 * ⇒ `beta` et `alpha` undefined partout, le repère constant β = 1 reste tracé (ligne de
 * niveau).
 */

import type { IndicatorDef } from "@axiom/types";
import { clampInt, rendementsLog } from "../utils";

export const betaRef: IndicatorDef = {
  id: "betaRef",
  name: "Bêta référence",
  category: "statistical",
  pane: "separate",
  aux: ["refClose"],
  precision: 2,
  inputs: [
    { key: "length", name: "Longueur", type: "number", default: 50, min: 10, max: 500 },
    {
      key: "source",
      name: "Source",
      type: "source",
      default: "close",
      options: ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"],
    },
    // Coupé par défaut : l'alpha cumulé écraserait l'échelle du β (cf. en-tête).
    { key: "afficherAlpha", name: "Alpha résiduel cumulé", type: "boolean", default: false },
  ],
  outputs: [
    { key: "beta", name: "Bêta", style: "line" },
    { key: "one", name: "1", style: "line" },
    { key: "alpha", name: "Alpha résiduel cumulé", style: "line" },
  ],

  calc(candles, params, ctx) {
    const n = candles.length;
    const length = clampInt(params.length, 50, 10, 500);
    const afficherAlpha = params.afficherAlpha === true;

    const beta: Array<number | undefined> = new Array(n).fill(undefined);
    const alpha: Array<number | undefined> = new Array(n).fill(undefined);
    const ref = ctx.aux?.refClose;

    if (ref) {
      const rx = rendementsLog(ctx.source, n);
      const rRef = rendementsLog(ref, n);

      for (let i = length; i < n; i++) {
        // Fenêtre POSITIONNELLE : les slots [i-length+1 .. i]. Un seul slot dont
        // l'une des deux jambes manque invalide tout le point (pas de trou toléré).
        let sumX = 0;
        let sumY = 0;
        let sumYY = 0;
        let sumXY = 0;
        let complete = true;
        for (let j = i - length + 1; j <= i; j++) {
          const x = rx[j];
          const y = rRef[j];
          if (x === undefined || y === undefined) {
            complete = false;
            break;
          }
          sumX += x;
          sumY += y;
          sumYY += y * y;
          sumXY += x * y;
        }
        if (!complete) continue;

        // beta = cov(r, rRef) / var(rRef). Le dénominateur est la jambe de RÉFÉRENCE (y) :
        // denY = L·Σyy − Σy·Σy = N²·var(rRef) ≥ 0. Variance nulle (référence plate) ⇒
        // beta non défini (évite 0/0).
        const denY = length * sumYY - sumY * sumY;
        if (denY <= 0) continue;

        beta[i] = (length * sumXY - sumX * sumY) / denY;
      }

      // Alpha résiduel cumulé : β EX ANTE (slot précédent). `cumul === null` = aucun
      // segment ouvert (début, ou trou qui vient de fermer le précédent). Option coupée :
      // la série reste entièrement undefined.
      let cumul: number | null = null;
      for (let j = 1; afficherAlpha && j < n; j++) {
        const betaAvant = beta[j - 1];
        const x = rx[j];
        const y = rRef[j];
        if (betaAvant === undefined || x === undefined || y === undefined) {
          cumul = null;
          continue;
        }
        cumul = (cumul ?? 0) + (x - betaAvant * y);
        alpha[j] = cumul;
      }
    }

    return {
      series: {
        beta,
        one: new Array<number>(n).fill(1),
        alpha,
      },
    };
  },
};
