/**
 * @axiom/indicators — strategy/stratSupertrendAdx.ts
 *
 * Supertrend + filtre ADX (non validé) — recopie PARAMÉTRÉE du candidat
 * `candSupertrendAdx` de la campagne de sélection (Task 6,
 * `candidatsChampion.ts` — voir ce fichier pour la version à constantes
 * figées) : la direction du Supertrend (défauts 10, ×3) n'est suivie que si
 * l'ADX (défaut 14) atteint le seuil (défaut 25) ; sous le seuil, position
 * FLAT forcée — y compris pour couper une position en cours. Le filtre coupe
 * les allers-retours de range, qui sont le péché du Supertrend nu. Rendu par
 * defStrategie.
 *
 * VERDICT DE LA CAMPAGNE (Task 6) — NON VALIDÉ. Les critères pré-déclarés
 * (expectancy > 0 sur les 4 cellules symbole × timeframe ET leurs 2 moitiés
 * temporelles, soit 12 blocs) sont ❌ : expectancy médiane +0.071 %, 1152
 * trades cumulés, 4 blocs en échec sur 12 (BTCUSDT 1h global, BTCUSDT 1h M1,
 * BTCUSDT 1h M2, BTCUSDT 4h M1). Meilleure cellule : ETHUSDT 4h (+0.677 %
 * d'expectancy, 106 trades) — UNE cellule sur quatre, pas une promesse. Ce
 * n'est PAS une stratégie validée ni recommandée : le nom du def ne doit pas
 * laisser croire le contraire.
 *
 * Réserve nette-de-frais : les chiffres ci-dessus sont HORS FRAIS. L'écart de
 * coût d'exécution mesuré sur les stratégies comparables passées à la
 * contre-épreuve BT va de −0.05 à −0.38 point d'expectancy par trade — une
 * bande qui contient entièrement la marge de +0.071 %. Rien ne garantit que
 * cette règle survivrait à ses propres frais + slippage.
 *
 * Résultats de backtest 2024-2026 BTC/ETH 1h/4h : voir
 * docs/superpowers/research/2026-07-28-backtest-strategies.md (campagne
 * §Task 6, section « Candidats champion ») — mesures PASSÉES, hors frais,
 * PAS une promesse (formule d'honnêteté du spec v2.3 §2).
 *
 * Paramètres ex-figés de `candSupertrendAdx`, désormais des inputs (défauts
 * INCHANGÉS = ceux de la campagne) : `stPeriode` 10, `stMult` 3,
 * `adxLength` 14, `seuilAdx` 25.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { adxOf } from "../trend/adx";
import { supertrendOf } from "../trend/supertrend";

export const stratSupertrendAdx = defStrategie({
  id: "stratSupertrendAdx",
  name: "Supertrend + filtre ADX",
  validation: "non-valide",
  inputsStrategie: [
    { key: "stPeriode", name: "Période Supertrend", type: "number", default: 10, min: 1 },
    { key: "stMult", name: "Multiplicateur Supertrend", type: "number", default: 3, min: 0.5 },
    { key: "adxLength", name: "Longueur ADX", type: "number", default: 14, min: 1 },
    { key: "seuilAdx", name: "Seuil ADX", type: "number", default: 25, min: 5, max: 60 },
  ],
  position: (candles, params) => {
    const st = supertrendOf(candles, Number(params.stPeriode ?? 10), Number(params.stMult ?? 3));
    const a = adxOf(candles, Number(params.adxLength ?? 14));
    const seuil = Number(params.seuilAdx ?? 25);
    return candles.map((_c, i): EtatStrategie | undefined => {
      const dir = st.direction[i];
      const adx = a.adx[i];
      if (dir === undefined || adx === undefined) return undefined;
      if (adx < seuil) return 0; // filtre anti-range : flat forcé
      return dir > 0 ? 1 : -1;
    });
  },
  // La réserve du verdict est répétée dans CHAQUE libellé : entrée, sortie et
  // segment de trade sont trois cibles de survol DISTINCTES — un utilisateur
  // qui ne survole que les marqueurs d'entrée ne doit pas rater le statut.
  libelles: (params) => ({
    long: `direction Supertrend haussière (ATR ${params.stPeriode} × ${params.stMult}), ADX ≥ ${params.seuilAdx} — stratégie non validée`,
    short: `direction Supertrend baissière (ATR ${params.stPeriode} × ${params.stMult}), ADX ≥ ${params.seuilAdx} — stratégie non validée`,
    sortie: `bascule Supertrend inverse ou ADX < ${params.seuilAdx} — stratégie non validée`,
  }),
});
