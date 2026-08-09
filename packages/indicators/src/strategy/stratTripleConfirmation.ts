/**
 * @axiom/indicators — strategy/stratTripleConfirmation.ts
 *
 * Triple confirmation (non validé) — NOUVELLE combinaison du Lot B v2.6
 * (spec §B2), composée uniquement de cœurs existants : Supertrend (régime,
 * défauts 10, ×3) + MACD vs signal (déclencheur, défauts 12/26/9) + RSI vs
 * seuil neutre (momentum, défauts 14 / 50). Long si les TROIS sont alignés
 * haussiers (direction Supertrend > 0 ET MACD > signal ET RSI > neutre),
 * short si les trois sont alignés baissiers, FLAT dès qu'un seul diverge —
 * y compris pour couper une position en cours. RSI et MACD sur les closes,
 * comme `positionMmRsi`/`positionMacdSupertrend` (candidatsChampion.ts).
 * Rendu par defStrategie.
 *
 * STATUT — NON VALIDÉ. Mesurée par le rejeu chart-fidèle du 2026-07-31
 * (docs/superpowers/research/2026-07-31-backtest-strategies-v26.md, fenêtre
 * FIGÉE 2024-07 → 2026-07-28, HORS frais) : expectancy quasi NULLE en 1h
 * (BTCUSDT −0.002 % sur 1035 trades, ETHUSDT +0.016 % sur 1032) et positive
 * seulement en 4h (BTCUSDT +0.150 % sur 254, ETHUSDT +0.403 % sur 251 —
 * PnL composé +106 %, UNE cellule sur quatre, pas une promesse). Aucun
 * critère de validation n'a été appliqué (mesure descriptive, pas une
 * campagne de sélection) et l'écart de coût d'exécution mesuré sur les
 * stratégies comparables (−0.05 à −0.38 point d'expectancy par trade)
 * engloutit les cellules 1h. Rien ne doit laisser croire qu'elle a fait
 * ses preuves.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { closeOf } from "../utils";
import { rsiOf } from "../momentum/rsi";
import { macdOf } from "../trend/macd";
import { supertrendOf } from "../trend/supertrend";

export const stratTripleConfirmation = defStrategie({
  id: "stratTripleConfirmation",
  name: "Triple confirmation",
  validation: "non-valide",
  inputsStrategie: [
    { key: "stPeriode", name: "Période Supertrend", type: "number", default: 10, min: 1 },
    { key: "stMult", name: "Multiplicateur Supertrend", type: "number", default: 3, min: 0.5 },
    { key: "macdRapide", name: "MACD rapide", type: "number", default: 12, min: 1 },
    { key: "macdLente", name: "MACD lente", type: "number", default: 26, min: 2 },
    { key: "macdSignal", name: "MACD signal", type: "number", default: 9, min: 1 },
    { key: "rsiLength", name: "Longueur RSI", type: "number", default: 14, min: 1 },
    { key: "rsiNeutre", name: "Seuil neutre RSI", type: "number", default: 50, min: 30, max: 70 },
  ],
  position: (candles, params) => {
    const closes = closeOf(candles);
    const st = supertrendOf(candles, Number(params.stPeriode ?? 10), Number(params.stMult ?? 3));
    const m = macdOf(
      closes,
      Number(params.macdRapide ?? 12),
      Number(params.macdLente ?? 26),
      Number(params.macdSignal ?? 9)
    );
    const r = rsiOf(closes, Number(params.rsiLength ?? 14));
    const neutre = Number(params.rsiNeutre ?? 50);
    return candles.map((_c, i): EtatStrategie | undefined => {
      const dir = st.direction[i];
      const macd = m.macd[i];
      const sig = m.signal[i];
      const rsi = r[i];
      if (dir === undefined || macd === undefined || sig === undefined || rsi === undefined) {
        return undefined;
      }
      if (dir > 0 && macd > sig && rsi > neutre) return 1;
      if (dir < 0 && macd < sig && rsi < neutre) return -1;
      return 0; // un seul désaccord suffit : flat
    });
  },
  // La réserve du statut est répétée dans CHAQUE libellé : entrée, sortie et
  // segment de trade sont trois cibles de survol DISTINCTES — un utilisateur
  // qui ne survole que les marqueurs d'entrée ne doit pas rater le statut.
  libelles: (params) => ({
    long: `direction Supertrend haussière, MACD ${params.macdRapide}/${params.macdLente} > signal ${params.macdSignal}, RSI ${params.rsiLength} > ${params.rsiNeutre} — stratégie non validée`,
    short: `direction Supertrend baissière, MACD ${params.macdRapide}/${params.macdLente} < signal ${params.macdSignal}, RSI ${params.rsiLength} < ${params.rsiNeutre} — stratégie non validée`,
    sortie: `une des trois confirmations perdue (Supertrend, MACD ou RSI) — stratégie non validée`,
  }),
});
