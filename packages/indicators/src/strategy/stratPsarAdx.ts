/**
 * @axiom/indicators — strategy/stratPsarAdx.ts
 *
 * PSAR + filtre ADX (non validé) — recopie PARAMÉTRÉE du candidat
 * `candPsarAdx` de la campagne de sélection (Task 6, `candidatsChampion.ts` —
 * voir ce fichier pour la version à constantes figées) : la position suit le
 * côté du Parabolic SAR (défauts 0,02/0,2 — close au-dessus → long, en
 * dessous → short) uniquement si l'ADX (défaut 14) atteint le seuil (défaut
 * 25) ; sous le seuil, position FLAT forcée — y compris pour couper une
 * position en cours. Le PSAR nu n'est jamais flat, ce filtre est donc le seul
 * frein aux bascules de range. Rendu par defStrategie.
 *
 * VERDICT DE LA CAMPAGNE (Task 6) — NON VALIDÉ. Les critères pré-déclarés
 * (expectancy > 0 sur les 4 cellules symbole × timeframe ET leurs 2 moitiés
 * temporelles, soit 12 blocs) sont ❌ : expectancy médiane +0.101 %, 2537
 * trades cumulés, 4 blocs en échec sur 12 (BTCUSDT 1h global, BTCUSDT 1h M1,
 * BTCUSDT 1h M2, BTCUSDT 4h M2). Meilleure cellule : ETHUSDT 1h (+0.155 %
 * d'expectancy, PnL composé +240 %) — c'est UNE cellule sur quatre, pas une
 * promesse : la même règle perd −51 % en composé sur BTCUSDT 1h. Ce n'est PAS
 * une stratégie validée ni recommandée : le nom du def ne doit pas laisser
 * croire le contraire.
 *
 * Réserve nette-de-frais : les chiffres ci-dessus sont HORS FRAIS. L'écart de
 * coût d'exécution mesuré sur les stratégies comparables passées à la
 * contre-épreuve BT va de −0.05 à −0.38 point d'expectancy par trade — une
 * bande qui contient entièrement la marge de +0.101 %, sur une règle qui
 * trade BEAUCOUP (2537 trades cumulés). Rien ne garantit que cette règle
 * survivrait à ses propres frais + slippage.
 *
 * Résultats de backtest 2024-2026 BTC/ETH 1h/4h : voir
 * docs/superpowers/research/2026-07-28-backtest-strategies.md (campagne
 * §Task 6, section « Candidats champion ») — mesures PASSÉES, hors frais,
 * PAS une promesse (formule d'honnêteté du spec v2.3 §2).
 *
 * Paramètres ex-figés de `candPsarAdx`, désormais des inputs (défauts
 * INCHANGÉS = ceux de la campagne) : `psarStep` 0.02, `psarMax` 0.2,
 * `adxLength` 14, `seuilAdx` 25.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { closeOf } from "../utils";
import { adxOf } from "../trend/adx";
import { psarOf } from "../trend/psar";

export const stratPsarAdx = defStrategie({
  id: "stratPsarAdx",
  name: "PSAR + filtre ADX",
  validation: "non-valide",
  inputsStrategie: [
    { key: "psarStep", name: "Pas AF", type: "number", default: 0.02, min: 0 },
    { key: "psarMax", name: "AF max", type: "number", default: 0.2, min: 0 },
    { key: "adxLength", name: "Longueur ADX", type: "number", default: 14, min: 1 },
    { key: "seuilAdx", name: "Seuil ADX", type: "number", default: 25, min: 5, max: 60 },
  ],
  position: (candles, params) => {
    const p = psarOf(candles, Number(params.psarStep ?? 0.02), Number(params.psarMax ?? 0.2));
    const a = adxOf(candles, Number(params.adxLength ?? 14));
    const closes = closeOf(candles);
    const seuil = Number(params.seuilAdx ?? 25);
    return candles.map((_c, i): EtatStrategie | undefined => {
      const sar = p.psar[i];
      const adx = a.adx[i];
      const c = closes[i];
      if (sar === undefined || adx === undefined || c === undefined) return undefined;
      if (adx < seuil) return 0; // filtre anti-range : flat forcé
      return c > sar ? 1 : -1;
    });
  },
  // La réserve du verdict est répétée dans CHAQUE libellé : entrée, sortie et
  // segment de trade sont trois cibles de survol DISTINCTES — un utilisateur
  // qui ne survole que les marqueurs d'entrée ne doit pas rater le statut.
  libelles: (params) => ({
    long: `close au-dessus du PSAR (${params.psarStep}/${params.psarMax}), ADX ≥ ${params.seuilAdx} — stratégie non validée`,
    short: `close en dessous du PSAR (${params.psarStep}/${params.psarMax}), ADX ≥ ${params.seuilAdx} — stratégie non validée`,
    sortie: `bascule PSAR inverse ou ADX < ${params.seuilAdx} — stratégie non validée`,
  }),
});
