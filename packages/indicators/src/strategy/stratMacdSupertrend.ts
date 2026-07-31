/**
 * @axiom/indicators — strategy/stratMacdSupertrend.ts
 *
 * MACD + direction Supertrend (non validé) — recopie PARAMÉTRÉE du candidat
 * `candMacdSupertrend` de la campagne de sélection (Task 6,
 * `candidatsChampion.ts` — voir ce fichier pour la version à constantes
 * figées) : long si MACD > signal ET Supertrend haussier, short si
 * MACD < signal ET Supertrend baissier, flat dès que les deux se
 * contredisent — le Supertrend sert de régime, le MACD de déclencheur. Le
 * MACD est calculé sur les CLOSES (closeOf), comme le candidat — pas sur une
 * source configurable. Rendu par defStrategie.
 *
 * VERDICT DE LA CAMPAGNE (Task 6) — NON VALIDÉ. Aucun des 6 candidats n'a
 * passé le critère pré-déclaré (expectancy > 0 sur les 4 cellules
 * symbole × timeframe ET leurs 2 moitiés temporelles, soit 12 blocs chacun).
 * `candMacdSupertrend` : expectancy médiane +0.065 %, 2250 trades cumulés sur
 * les 4 cellules, 4 blocs en échec sur 12 (BTCUSDT 1h global et M2, ETHUSDT
 * 1h global et M2). Sa meilleure cellule est ETHUSDT 4h (+0.537 %
 * d'expectancy, PnL composé +133 %) — une cellule sur quatre, PAS une
 * promesse : le nom du def ne doit pas laisser croire le contraire.
 *
 * Réserve nette-de-frais : cette combinaison n'a pas été contre-épreuvée
 * frais inclus. L'écart de coût d'exécution mesuré sur les stratégies
 * comparables va de −0.05 à −0.38 point d'expectancy par trade — une bande
 * qui contient ENTIÈREMENT la marge médiane de +0.065 %. Rien ne garantit
 * que cette règle survivrait à ses propres frais + slippage.
 *
 * Résultats de backtest 2024-2026 BTC/ETH 1h/4h : voir
 * docs/superpowers/research/2026-07-28-backtest-strategies.md (campagne
 * §Task 6, section « Candidats champion ») — mesures PASSÉES, hors frais,
 * PAS une promesse (formule d'honnêteté du spec v2.3 §2).
 *
 * Paramètres ex-figés de `candMacdSupertrend`, désormais des inputs (défauts
 * INCHANGÉS = ceux de la campagne) : `macdRapide` 12, `macdLente` 26,
 * `macdSignal` 9, `stPeriode` 10, `stMult` 3.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { closeOf } from "../utils";
import { macdOf } from "../trend/macd";
import { supertrendOf } from "../trend/supertrend";

export const stratMacdSupertrend = defStrategie({
  id: "stratMacdSupertrend",
  name: "MACD + direction Supertrend (non validé)",
  inputsStrategie: [
    { key: "macdRapide", name: "MACD rapide", type: "number", default: 12, min: 1 },
    { key: "macdLente", name: "MACD lente", type: "number", default: 26, min: 1 },
    { key: "macdSignal", name: "MACD signal", type: "number", default: 9, min: 1 },
    { key: "stPeriode", name: "Période Supertrend", type: "number", default: 10, min: 1 },
    { key: "stMult", name: "Multiplicateur Supertrend", type: "number", default: 3, min: 0.5 },
  ],
  position: (candles, params) => {
    const closes = closeOf(candles);
    const m = macdOf(
      closes,
      Number(params.macdRapide ?? 12),
      Number(params.macdLente ?? 26),
      Number(params.macdSignal ?? 9)
    );
    const st = supertrendOf(candles, Number(params.stPeriode ?? 10), Number(params.stMult ?? 3));
    return candles.map((_c, i): EtatStrategie | undefined => {
      const macd = m.macd[i];
      const sig = m.signal[i];
      const dir = st.direction[i];
      if (macd === undefined || sig === undefined || dir === undefined) return undefined;
      if (macd > sig && dir > 0) return 1;
      if (macd < sig && dir < 0) return -1;
      return 0;
    });
  },
  // La réserve du verdict est répétée dans CHAQUE libellé : entrée, sortie et
  // segment de trade sont trois cibles de survol DISTINCTES — un utilisateur
  // qui ne survole que les marqueurs d'entrée ne doit pas rater le statut.
  libelles: (params) => ({
    long: `MACD(${params.macdRapide}/${params.macdLente}/${params.macdSignal}) > signal, Supertrend(${params.stPeriode}, ×${params.stMult}) haussier — stratégie non validée`,
    short: `MACD(${params.macdRapide}/${params.macdLente}/${params.macdSignal}) < signal, Supertrend(${params.stPeriode}, ×${params.stMult}) baissier — stratégie non validée`,
    sortie: `désaccord MACD/Supertrend (flat) ou bascule inverse — stratégie non validée`,
  }),
});
