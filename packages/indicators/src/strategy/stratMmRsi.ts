/**
 * @axiom/indicators — strategy/stratMmRsi.ts
 *
 * Croisement MM + confirmation RSI (non validé) — recopie PARAMÉTRÉE du
 * candidat `candMmRsi` de la campagne de sélection (Task 6,
 * `candidatsChampion.ts` — voir ce fichier pour la version à constantes
 * figées) : long si EMA rapide > EMA lente ET RSI > seuil neutre, short si
 * EMA rapide < EMA lente ET RSI < seuil neutre, flat dès que croisement et
 * momentum divergent. EMA et RSI sont calculés sur les CLOSES (closeOf),
 * comme le candidat — pas sur une source configurable. Rendu par defStrategie.
 *
 * VERDICT DE LA CAMPAGNE (Task 6) — NON VALIDÉ. Aucun des 6 candidats n'a
 * passé le critère pré-déclaré (expectancy > 0 sur les 4 cellules
 * symbole × timeframe ET leurs 2 moitiés temporelles, soit 12 blocs chacun).
 * `candMmRsi` : expectancy médiane +0.026 % — la PLUS FAIBLE des 6
 * candidats — pour 3578 trades cumulés, le candidat le PLUS actif de la
 * campagne (sur-trading notoire en 1h : 1421 trades sur BTCUSDT 1h pour
 * +0.012 % d'expectancy). 4 blocs en échec sur 12 (BTCUSDT 1h M2, BTCUSDT 4h
 * M2, ETHUSDT 4h global et M2). Ce n'est PAS une stratégie validée ni
 * recommandée : le nom du def ne doit pas laisser croire le contraire.
 *
 * Réserve nette-de-frais : cette combinaison n'a pas été contre-épreuvée
 * frais inclus. L'écart de coût d'exécution mesuré sur les stratégies
 * comparables va de −0.05 à −0.38 point d'expectancy par trade — une bande
 * qui contient ENTIÈREMENT la marge médiane de +0.026 %, et le volume de
 * trades (le plus élevé des 6) multiplie d'autant l'exposition aux frais.
 *
 * Résultats de backtest 2024-2026 BTC/ETH 1h/4h : voir
 * docs/superpowers/research/2026-07-28-backtest-strategies.md (campagne
 * §Task 6, section « Candidats champion ») — mesures PASSÉES, hors frais,
 * PAS une promesse (formule d'honnêteté du spec v2.3 §2).
 *
 * Paramètres ex-figés de `candMmRsi`, désormais des inputs (défauts
 * INCHANGÉS = ceux de la campagne) : `rapide` 9, `lente` 21, `rsiLength` 14,
 * `rsiNeutre` 50.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { closeOf, ema } from "../utils";
import { rsiOf } from "../momentum/rsi";

export const stratMmRsi = defStrategie({
  id: "stratMmRsi",
  name: "Croisement MM + confirmation RSI (non validé)",
  inputsStrategie: [
    { key: "rapide", name: "MM rapide", type: "number", default: 9, min: 1 },
    { key: "lente", name: "MM lente", type: "number", default: 21, min: 2 },
    { key: "rsiLength", name: "Longueur RSI", type: "number", default: 14, min: 1 },
    { key: "rsiNeutre", name: "Seuil neutre RSI", type: "number", default: 50, min: 1, max: 99 },
  ],
  position: (candles, params) => {
    const closes = closeOf(candles);
    const rapide = ema(closes, Number(params.rapide ?? 9));
    const lente = ema(closes, Number(params.lente ?? 21));
    const r = rsiOf(closes, Number(params.rsiLength ?? 14));
    const neutre = Number(params.rsiNeutre ?? 50);
    return candles.map((_c, i): EtatStrategie | undefined => {
      const f = rapide[i];
      const l = lente[i];
      const rsi = r[i];
      if (f === undefined || l === undefined || rsi === undefined) return undefined;
      if (f > l && rsi > neutre) return 1;
      if (f < l && rsi < neutre) return -1;
      return 0;
    });
  },
  // La réserve du verdict est répétée dans CHAQUE libellé : entrée, sortie et
  // segment de trade sont trois cibles de survol DISTINCTES — un utilisateur
  // qui ne survole que les marqueurs d'entrée ne doit pas rater le statut.
  libelles: (params) => ({
    long: `EMA ${params.rapide} > EMA ${params.lente}, RSI(${params.rsiLength}) > ${params.rsiNeutre} — stratégie non validée`,
    short: `EMA ${params.rapide} < EMA ${params.lente}, RSI(${params.rsiLength}) < ${params.rsiNeutre} — stratégie non validée`,
    sortie: `désaccord EMA/RSI (flat) ou bascule inverse — stratégie non validée`,
  }),
});
