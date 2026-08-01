/**
 * @axiom/indicators — strategy/stratChampion.ts
 *
 * Champion relatif (non validé) — recopie PARAMÉTRÉE du candidat classé no 1
 * de la campagne de sélection (Task 6, `candDonchianTrailing` dans
 * `candidatsChampion.ts` — voir ce fichier pour la version à constantes
 * figées) : cassure du canal Donchian (défaut `canal` 20 bougies
 * PRÉCÉDENTES, courante exclue) pour l'entrée, sortie par stop trailing type
 * Chandelier à `multAtr` × ATR(`atrLength`) (défauts 3 / 14, Wilder RMA)
 * depuis l'extrême (plus-haut en long, plus-bas en short) atteint depuis
 * l'entrée. Contrairement à `stratDonchian`, la position n'attend PAS la
 * cassure du canal opposé pour sortir : le trailing coupe seul, et l'ordre
 * d'évaluation ci-dessous permet un retournement direct sans repasser par
 * flat (voir quirks reproduits, plus bas).
 *
 * VERDICT DE LA CAMPAGNE (Task 6) — CHAMPION RELATIF, NON ROBUSTE. Aucun des
 * 6 candidats n'a passé le critère pré-déclaré (expectancy > 0 sur les 4
 * cellules symbole × timeframe ET leurs 2 moitiés temporelles, soit 12 blocs
 * chacun). `candDonchianTrailing` est le MIEUX classé au départage par
 * expectancy médiane (+0.181 %, 1311 trades cumulés sur les 4 cellules) mais
 * échoue 4 blocs sur 12 — concentrés sur BTCUSDT 1h (sa cellule la PLUS
 * dense : 546 trades, échec sur les 3 blocs global + M1 + M2) et BTCUSDT 4h
 * M2. Ce n'est PAS une stratégie validée ni recommandée : le nom du def ne
 * doit pas laisser croire le contraire.
 *
 * Réserve nette-de-frais : cette règle n'a PAS été contre-épreuvée au moteur
 * de backtest (elle n'est pas exprimable dans le modèle déclaratif des 6
 * stratégies passées à la contre-épreuve BT §2 du rapport). L'écart de coût
 * d'exécution mesuré sur les stratégies comparables va de −0.05 à −0.38 point
 * d'expectancy par trade (extrême −0.787) — une bande qui contient
 * ENTIÈREMENT la marge de +0.181 % du champion relatif. Rien ne garantit que
 * cette règle survivrait à ses propres frais + slippage.
 *
 * Résultats de backtest 2024-2026 BTC/ETH 1h/4h : voir
 * docs/superpowers/research/2026-07-28-backtest-strategies.md (campagne
 * §Task 6, section « Candidats champion ») — mesures PASSÉES, hors frais,
 * PAS une promesse (formule d'honnêteté du spec v2.3 §2).
 *
 * Quirks reproduits FIDÈLEMENT depuis `positionDonchianTrailing` (documentés
 * en Task 6, PAS des bugs à corriger — ils font partie de ce qui a été
 * mesuré) :
 *  - Ordre d'évaluation FIGÉ à chaque bougie : (1) mise à jour du ratchet
 *    `extreme` + test du trailing D'ABORD, (2) cassure du canal ENSUITE —
 *    un retournement direct (ou une cassure du canal opposé alors que le
 *    trailing n'a pas déclenché) peut donc faire passer la position de long
 *    à short (ou l'inverse) sur la MÊME bougie, sans flat intermédiaire.
 *  - `extreme` ne recule JAMAIS tant que la position est ouverte (ratchet
 *    strict), mais le NIVEAU du stop (`extreme ∓ multAtr × ATR`) N'EST PAS
 *    monotone : il peut reculer si l'ATR s'élargit, même quand l'extrême a
 *    tenu ou progressé.
 *  - Une ré-entrée sur la même bougie après une sortie trailing réinitialise
 *    le ratchet (`extreme` reparti de la bougie courante) — invisible dans
 *    la liste des trades mais présent dans la boucle ci-dessous.
 *
 * Paramètres ex-figés de `candDonchianTrailing`, désormais des inputs
 * (défauts INCHANGÉS = ceux de la campagne) : `canal` 20, `atrLength` 14,
 * `multAtr` 3.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { closeOf, highOf, lowOf, rma, rollingHighest, rollingLowest, trueRange } from "../utils";

export const stratChampion = defStrategie({
  id: "stratChampion",
  name: "Champion relatif",
  validation: "non-valide",
  inputsStrategie: [
    { key: "canal", name: "Canal Donchian (bougies)", type: "number", default: 20, min: 2 },
    { key: "atrLength", name: "Période ATR", type: "number", default: 14, min: 1 },
    { key: "multAtr", name: "Multiplicateur trailing ATR", type: "number", default: 3, min: 0.5 },
  ],
  position: (candles, params) => {
    const canal = Number(params.canal ?? 20);
    const atrLength = Number(params.atrLength ?? 14);
    const multAtr = Number(params.multAtr ?? 3);

    const highs = highOf(candles);
    const lows = lowOf(candles);
    const closes = closeOf(candles);
    const hh = rollingHighest(highs, canal);
    const ll = rollingLowest(lows, canal);
    const atr = rma(trueRange(candles), atrLength);

    const n = candles.length;
    const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);
    let etat: EtatStrategie = 0;
    let extreme = 0; // plus-haut (long) / plus-bas (short) atteint depuis l'entrée

    for (let i = 1; i < n; i++) {
      const h = hh[i - 1]; // canal des `canal` bougies PRÉCÉDENTES
      const l = ll[i - 1];
      const c = closes[i];
      const a = atr[i];
      const hi = highs[i];
      const lo = lows[i];
      if (h === undefined || l === undefined || c === undefined || a === undefined) continue;
      if (hi === undefined || lo === undefined) continue;

      if (etat === 1) {
        if (hi > extreme) extreme = hi;
        if (c < extreme - multAtr * a) etat = 0;
      } else if (etat === -1) {
        if (lo < extreme) extreme = lo;
        if (c > extreme + multAtr * a) etat = 0;
      }

      if (c > h && etat !== 1) {
        etat = 1;
        extreme = hi;
      } else if (c < l && etat !== -1) {
        etat = -1;
        extreme = lo;
      }

      out[i] = etat;
    }
    return out;
  },
  // La réserve du verdict est répétée dans CHAQUE libellé : entrée, sortie et
  // segment de trade sont trois cibles de survol DISTINCTES — un utilisateur qui
  // ne survole que les marqueurs d'entrée ne doit pas rater le statut, surtout
  // avec les « +0.76 % » peints à côté. Suffixe court pour ne pas noyer la règle.
  libelles: (params) => ({
    long: `cassure du plus-haut Donchian ${params.canal} (canal des bougies précédentes) — stratégie non validée`,
    short: `cassure du plus-bas Donchian ${params.canal} (canal des bougies précédentes) — stratégie non validée`,
    sortie: `stop trailing ${params.multAtr} × ATR(${params.atrLength}) depuis l'extrême, ou cassure directe du canal opposé — stratégie non validée`,
  }),
});
