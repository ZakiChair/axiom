/**
 * @axiom/indicators — strategy/stratSqueezeKumo.ts
 *
 * Squeeze + tendance kumo (non validé) — recopie PARAMÉTRÉE du candidat
 * `candSqueezeKumo` de la campagne de sélection (`candidatsChampion.ts`,
 * fichier INTOUCHABLE — voir ce fichier pour la version à constantes figées) :
 * mêmes armement/libération que `stratSqueezeBreakout` (squeeze TTM actif
 * ≥ `dureeMin` bougies = armé ; à la libération ON → OFF, entrée dans le sens
 * du momentum TTM), MAIS l'entrée n'est prise que si la TENDANCE Ichimoku la
 * confirme : long uniquement au-dessus du nuage, short uniquement en dessous ;
 * à l'intérieur du nuage, la libération est IGNORÉE. Sortie au retournement
 * du momentum. Rendu par defStrategie.
 *
 * VERDICT DE LA CAMPAGNE (Task 6) — CANDIDAT NON VALIDÉ. Critère pré-déclaré
 * (expectancy > 0 sur les 12 blocs symbole × timeframe × moitié) : ÉCHEC, 5
 * blocs sur 12 en échec (BTCUSDT 1h M2, BTCUSDT 4h global + M2, ETHUSDT 1h
 * M1, ETHUSDT 4h M2). Expectancy médiane +0.071 %, 534 trades cumulés sur les
 * 4 cellules — le candidat le MOINS actif des six. Sa meilleure cellule,
 * ETHUSDT 4h (+0.604 %), est aussi la plus trompeuse : sa moitié M2 est
 * catastrophique (−0.578 %) — la performance ne tient pas dans le temps. Ce
 * n'est PAS une stratégie validée ni recommandée : le nom du def ne doit pas
 * laisser croire le contraire.
 *
 * Réserve nette-de-frais : cette règle n'a PAS été contre-épreuvée au moteur
 * de backtest (à état, inexprimable dans le modèle déclaratif de la
 * contre-épreuve BT §2 du rapport). L'écart de coût d'exécution mesuré sur
 * les stratégies comparables va de −0.05 à −0.38 point d'expectancy par trade
 * (extrême −0.787) — une bande qui contient ENTIÈREMENT la marge de +0.071 %.
 * Rien ne garantit que cette règle survivrait à ses propres frais + slippage.
 *
 * Résultats de backtest 2024-2026 BTC/ETH 1h/4h : voir
 * docs/superpowers/research/2026-07-28-backtest-strategies.md (campagne
 * §Task 6, section « Candidats champion ») — mesures PASSÉES, hors frais,
 * PAS une promesse (formule d'honnêteté du spec v2.3 §2).
 *
 * Détails reproduits FIDÈLEMENT depuis `positionSqueezeKumo` (ils font partie
 * de ce qui a été mesuré — PAS des bugs à corriger) :
 *  - Ordre des blocs FIGÉ à chaque bougie : (1) armement/libération D'ABORD
 *    (entrée seulement si flat), (2) sortie au retournement du momentum
 *    ENSUITE — une entrée à la libération n'est jamais coupée sur sa propre
 *    bougie (le momentum qui la déclenche a par construction le bon signe).
 *  - `continue` sur tout cœur undefined : out[i] reste undefined au MILIEU de
 *    la série → la fabrique maintient l'état précédent (fill-forward) ; les
 *    compteurs internes (etat, dureeOn, arme) ne sont PAS réinitialisés par
 *    un trou. Avant la définition d'Ichimoku (~senkouB + kijun bougies avec
 *    les défauts), les bougies de squeeze ne comptent PAS vers l'armement.
 *  - Une libération pendant une position ouverte CONSOMME l'armement sans
 *    rien déclencher (pas de renversement à la libération).
 *  - `mom === 0` à la libération → aucun sens, entrée ignorée.
 *  - hlc3 : contexte reconstruit via `buildCalcContext(candles, "close")`
 *    comme le candidat (mêmes valeurs que le ctx de la fabrique — hlc3 ne
 *    dépend pas de la source) ; déplacement d'Ichimoku = `kijun` (le candidat
 *    passe ICHI_KIJUN en 4e paramètre d'`ichimokuOf`).
 *
 * Paramètres ex-figés de `candSqueezeKumo`, désormais des inputs (défauts
 * INCHANGÉS = ceux de la campagne) : `sqzLength` 20, `multBb` 2, `multKc`
 * 1.5, `dureeMin` 3, `tenkan` 9, `kijun` 26, `senkouB` 52.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { buildCalcContext } from "../engine";
import { closeOf } from "../utils";
import { ichimokuOf } from "../trend/ichimoku";
import { ttmSqueezeOf } from "../volatility/ttmSqueeze";

export const stratSqueezeKumo = defStrategie({
  id: "stratSqueezeKumo",
  name: "Squeeze + tendance kumo",
  validation: "non-valide",
  inputsStrategie: [
    { key: "sqzLength", name: "Longueur squeeze", type: "number", default: 20, min: 2, max: 200 },
    { key: "multBb", name: "Multiplicateur BB", type: "number", default: 2, min: 0.5, max: 5 },
    { key: "multKc", name: "Multiplicateur KC", type: "number", default: 1.5, min: 0.5, max: 5 },
    { key: "dureeMin", name: "Durée min du squeeze", type: "number", default: 3, min: 1 },
    { key: "tenkan", name: "Tenkan", type: "number", default: 9, min: 1 },
    { key: "kijun", name: "Kijun", type: "number", default: 26, min: 1 },
    { key: "senkouB", name: "Senkou B", type: "number", default: 52, min: 1 },
  ],
  position: (candles, params) => {
    const sqzLength = Number(params.sqzLength ?? 20);
    const multBb = Number(params.multBb ?? 2);
    const multKc = Number(params.multKc ?? 1.5);
    const dureeMin = Number(params.dureeMin ?? 3);
    const tenkan = Number(params.tenkan ?? 9);
    const kijun = Number(params.kijun ?? 26);
    const senkouB = Number(params.senkouB ?? 52);

    const ctx = buildCalcContext(candles, "close");
    const sqz = ttmSqueezeOf(candles, ctx.hlc3, sqzLength, multBb, multKc);
    const ichi = ichimokuOf(candles, tenkan, kijun, senkouB, kijun);
    const closes = closeOf(candles);

    const n = candles.length;
    const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);
    let etat: EtatStrategie = 0;
    let dureeOn = 0;
    let arme = false;

    for (let i = 0; i < n; i++) {
      const on = sqz.on[i];
      const mom = sqz.mom[i];
      const spanA = ichi.spanA[i];
      const spanB = ichi.spanB[i];
      const c = closes[i];
      if (on === undefined || mom === undefined || spanA === undefined || spanB === undefined) continue;
      if (c === undefined) continue;

      const dessusNuage = c > Math.max(spanA, spanB);
      const sousNuage = c < Math.min(spanA, spanB);

      if (on > 0) {
        dureeOn++;
        if (dureeOn >= dureeMin) arme = true;
      } else {
        if (arme && etat === 0) {
          // libération armée : le sens du momentum doit être confirmé par le kumo
          if (mom > 0 && dessusNuage) etat = 1;
          else if (mom < 0 && sousNuage) etat = -1;
        }
        arme = false;
        dureeOn = 0;
      }

      if (etat === 1 && mom < 0) etat = 0;
      else if (etat === -1 && mom > 0) etat = 0;

      out[i] = etat;
    }
    return out;
  },
  // La réserve du verdict est répétée dans CHAQUE libellé (entrée, sortie,
  // segment = trois cibles de survol distinctes) — même convention que
  // stratChampion : un utilisateur qui ne survole que les entrées ne doit pas
  // rater le statut.
  libelles: (params) => ({
    long: `libération du squeeze (≥ ${params.dureeMin} barres) momentum haussier, close au-dessus du nuage — stratégie non validée`,
    short: `libération du squeeze (≥ ${params.dureeMin} barres) momentum baissier, close sous le nuage — stratégie non validée`,
    sortie: `retournement du momentum — stratégie non validée`,
  }),
});
