/**
 * @axiom/indicators — strategy/stratRsiRange.ts
 *
 * RSI réversion + filtre range ADX (non validé). Nouvelle
 * combinaison du programme v2.6 Lot B (spec
 * docs/superpowers/specs/2026-07-31-programme-v26-marches-croises-design.md,
 * §B2) : la mean-reversion n'a de sens qu'en RANGE — ce def est le miroir
 * conceptuel de `stratMmAdx`, qui n'autorise le suivi de tendance QU'EN
 * tendance (ADX ≥ seuil). Ici c'est l'inverse : les entrées de réversion ne
 * sont ARMÉES que si l'ADX est STRICTEMENT sous `seuilAdx` (défaut 20) ; dès
 * que l'ADX atteint ou dépasse le seuil, FLAT forcé — le range est fini, la
 * thèse est morte, y compris pour couper une position en cours. Les deux defs
 * partagent la même convention de borne : ADX ≥ seuil = tendance (là où
 * stratMmAdx trade, stratRsiRange se tait, et réciproquement).
 *
 * Mécanique de réversion : celle de `stratRsiReversion` (entrée quand le RSI
 * RECROISE son seuil depuis l'autre côté — le rebond confirmé, pas la chute),
 * rendue BIDIRECTIONNELLE :
 *  - long  quand RSI[i−1] < seuilBas ≤ RSI[i]   (sort de survente) ;
 *  - short quand RSI[i−1] > seuilHaut ≥ RSI[i]  (sort de surachat) ;
 *  - sortie quand le RSI atteint la zone neutre (50 — vers le haut pour un
 *    long, vers le bas pour un short), ou dès que ADX ≥ seuilAdx.
 *
 * NON VALIDÉ. Motivation : dimension inexplorée de la campagne 2026-07-28
 * (aucun candidat n'appliquait un filtre de RÉGIME à la réversion ; tous
 * filtraient le suivi de tendance). Mesurée par le rejeu chart-fidèle du
 * 2026-07-31 (docs/superpowers/research/2026-07-31-backtest-strategies-v26.md,
 * fenêtre FIGÉE, HORS frais) : TRÈS inactive aux défauts — 7 à 17 trades par
 * cellule sur deux ans (le double filtre ADX < 20 + recroisement RSI arme
 * rarement), expectancy médiane légèrement négative (BTC 1h −0.294 %,
 * BTC 4h +0.196 %, ETH 1h +0.102 %, ETH 4h −0.958 %). Des échantillons
 * aussi maigres n'autorisent AUCUNE conclusion — l'étiquette reste.
 *
 * Cas limite assumé (hérité de la structure de stratRsiReversion, sortie
 * évaluée AVANT l'entrée sur la même bougie) : un bond du RSI qui traverse à
 * la fois la zone neutre et le seuil de réversion sur une seule bougie peut
 * enchaîner sortie + ré-entrée du même côté sans transition d'état visible.
 *
 * Choix assumé : le RSI lit `ctx.source` (close par défaut) — patron v2.2 de
 * son parent stratRsiReversion — là où les promotions v2.6 figent
 * closeOf(candles). Un rejeu scripté qui passerait `source` ne déplacerait
 * donc QUE cette stratégie du lot ; l'UI ne déclare pas cet input.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { rsiOf } from "../momentum/rsi";
import { adxOf } from "../trend/adx";

/** Zone neutre du RSI : borne de sortie des deux jambes (50, non paramétrée). */
const RSI_NEUTRE = 50;

export const stratRsiRange = defStrategie({
  id: "stratRsiRange",
  name: "RSI réversion + filtre range ADX",
  validation: "non-valide",
  inputsStrategie: [
    { key: "rsiLength", name: "Longueur RSI", type: "number", default: 14, min: 1 },
    { key: "seuilBas", name: "Seuil bas (survente)", type: "number", default: 30, min: 1, max: 50 },
    { key: "seuilHaut", name: "Seuil haut (surachat)", type: "number", default: 70, min: 50, max: 99 },
    { key: "adxLength", name: "Longueur ADX", type: "number", default: 14, min: 1 },
    { key: "seuilAdx", name: "Seuil ADX", type: "number", default: 20, min: 5, max: 60 },
  ],
  position: (candles, params, ctx) => {
    const r = rsiOf(ctx.source, Number(params.rsiLength ?? 14));
    const a = adxOf(candles, Number(params.adxLength ?? 14));
    const seuilBas = Number(params.seuilBas ?? 30);
    const seuilHaut = Number(params.seuilHaut ?? 70);
    const seuilAdx = Number(params.seuilAdx ?? 20);
    const n = ctx.source.length;
    const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);
    let etat: EtatStrategie = 0;
    for (let i = 0; i < n; i++) {
      const cur = r[i];
      const adx = a.adx[i];
      if (cur === undefined || adx === undefined) continue; // warm-up : out[i] reste undefined
      if (adx >= seuilAdx) {
        // Le range est fini : thèse morte — flat forcé, entrées désarmées.
        etat = 0;
        out[i] = 0;
        continue;
      }
      const prev = r[i - 1];
      // Sortie : le RSI atteint la zone neutre (évaluée avant l'entrée,
      // comme stratRsiReversion évalue sa sortie avant son entrée).
      if (etat === 1 && cur >= RSI_NEUTRE) etat = 0;
      else if (etat === -1 && cur <= RSI_NEUTRE) etat = 0;
      // Entrées (ADX < seuilAdx garanti ici) : recroisement du seuil.
      if (etat === 0 && prev !== undefined) {
        if (prev < seuilBas && cur >= seuilBas) etat = 1;
        else if (prev > seuilHaut && cur <= seuilHaut) etat = -1;
      }
      out[i] = etat;
    }
    return out;
  },
  libelles: (params) => ({
    long: `RSI ${params.rsiLength} sort de survente (${params.seuilBas}) en range ADX < ${params.seuilAdx} — stratégie non validée`,
    short: `RSI ${params.rsiLength} sort de surachat (${params.seuilHaut}) en range ADX < ${params.seuilAdx} — stratégie non validée`,
    sortie: `RSI ${params.rsiLength} revient à la zone neutre (${RSI_NEUTRE}) ou ADX ≥ ${params.seuilAdx} — stratégie non validée`,
  }),
});
