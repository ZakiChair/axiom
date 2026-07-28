/**
 * @axiom/indicators — strategy/candidatsChampion.ts
 *
 * Les SIX candidats « champion » FIGÉS du spec v2.3 §3, composés uniquement de
 * cœurs existants. Ce module n'est PAS un registre d'indicateurs : il n'appelle
 * jamais `defStrategie` (aucune inscription dans la map des specs, aucune
 * entrée dans `registry.ts`) et n'est consommé que par la campagne scriptée
 * `scripts/valider-strategies.ts`. Le gagnant de la campagne sera, LUI, encodé
 * en def `stratChampion` (Task 7) — pas avant, et sans réglage par marché.
 *
 * Règle du protocole : les paramètres ci-dessous sont FIGÉS avant de voir le
 * moindre chiffre, un seul jeu de défauts pour les quatre cellules
 * symbole × timeframe (pas de grid-search, pas d'optimisation par cellule).
 * Toute modification d'un défaut invalide la campagne : la re-lancer en entier.
 *
 * Conventions communes (identiques à la fabrique `defStrategie`) : décision à
 * la CLÔTURE de chaque bougie ; `undefined` pendant le warm-up (jamais 0, qui
 * signifierait « flat décidé ») ; 1 = long, 0 = flat, −1 = short.
 */

import type { Candle } from "@axiom/types";
import { buildCalcContext } from "../engine";
import type { EtatStrategie } from "../utils-fabrique-strategie";
import { closeOf, ema, highOf, lowOf, rma, rollingHighest, rollingLowest, trueRange } from "../utils";
import { rsiOf } from "../momentum/rsi";
import { adxOf } from "../trend/adx";
import { ichimokuOf } from "../trend/ichimoku";
import { macdOf } from "../trend/macd";
import { psarOf } from "../trend/psar";
import { supertrendOf } from "../trend/supertrend";
import { ttmSqueezeOf } from "../volatility/ttmSqueeze";

/** Un candidat champion : fonction d'état PURE, sans paramètre exposé. */
export interface CandidatChampion {
  id: string;
  nom: string;
  /** Règle en une phrase, reprise telle quelle dans le rapport de campagne. */
  regle: string;
  position: (candles: Candle[]) => Array<EtatStrategie | undefined>;
}

// ─────────────────────────── Paramètres FIGÉS ───────────────────────────

const ST_PERIODE = 10;
const ST_MULT = 3;
const ADX_LENGTH = 14;
const ADX_SEUIL = 25;
const MM_RAPIDE = 9;
const MM_LENTE = 21;
const RSI_LENGTH = 14;
const RSI_NEUTRE = 50;
const DONCHIAN_CANAL = 20;
const ATR_LENGTH = 14;
const ATR_MULT_TRAIL = 3;
const SQZ_LENGTH = 20;
const SQZ_MULT_BB = 2;
const SQZ_MULT_KC = 1.5;
const SQZ_DUREE_MIN = 3;
const ICHI_TENKAN = 9;
const ICHI_KIJUN = 26;
const ICHI_SENKOU_B = 52;
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;
const PSAR_STEP = 0.02;
const PSAR_MAX = 0.2;

// ─────────────────────────── (1) Supertrend + ADX ───────────────────────────

/**
 * Supertrend (10, ×3) filtré par la force de tendance : la direction du
 * Supertrend n'est suivie que si l'ADX(14) atteint 25 ; sous le seuil, position
 * FLAT forcée (y compris pour couper une position en cours) — le filtre coupe
 * les allers-retours de range, qui sont le péché du Supertrend nu.
 */
function positionSupertrendAdx(candles: Candle[]): Array<EtatStrategie | undefined> {
  const st = supertrendOf(candles, ST_PERIODE, ST_MULT);
  const a = adxOf(candles, ADX_LENGTH);
  return candles.map((_c, i): EtatStrategie | undefined => {
    const dir = st.direction[i];
    const adx = a.adx[i];
    if (dir === undefined || adx === undefined) return undefined;
    if (adx < ADX_SEUIL) return 0;
    return dir > 0 ? 1 : -1;
  });
}

// ─────────────────────────── (2) MM 9/21 + RSI ───────────────────────────

/**
 * Croisement EMA 9/21 CONFIRMÉ par le momentum : long seulement si EMA 9 > EMA
 * 21 ET RSI(14) > 50, short seulement si EMA 9 < EMA 21 ET RSI(14) < 50 ; toute
 * divergence entre les deux (croisement sans momentum, ou l'inverse) = flat.
 */
function positionMmRsi(candles: Candle[]): Array<EtatStrategie | undefined> {
  const closes = closeOf(candles);
  const rapide = ema(closes, MM_RAPIDE);
  const lente = ema(closes, MM_LENTE);
  const r = rsiOf(closes, RSI_LENGTH);
  return candles.map((_c, i): EtatStrategie | undefined => {
    const f = rapide[i];
    const l = lente[i];
    const rsi = r[i];
    if (f === undefined || l === undefined || rsi === undefined) return undefined;
    if (f > l && rsi > RSI_NEUTRE) return 1;
    if (f < l && rsi < RSI_NEUTRE) return -1;
    return 0;
  });
}

// ─────────────────────────── (3) Donchian 20 + trailing ATR ───────────────────────────

/**
 * Breakout Donchian 20 (cassure du plus-haut / plus-bas des 20 bougies
 * PRÉCÉDENTES, courante exclue — même canal que `stratDonchian`) avec sortie
 * TRAILING de type Chandelier : en long, le stop suit `plus-haut atteint depuis
 * l'entrée − 3 × ATR(14)` et la position est coupée dès qu'une clôture passe
 * dessous (miroir en short avec le plus-bas + 3 × ATR). C'est LA différence
 * avec `stratDonchian`, qui reste en position jusqu'à la cassure opposée : ici
 * un retournement rend la main au flat sans attendre le canal inverse.
 *
 * Ordre d'évaluation FIGÉ à chaque bougie : (1) mise à jour de l'extrême et
 * test du trailing ; (2) cassure du canal (entrée, ou renversement direct).
 */
function positionDonchianTrailing(candles: Candle[]): Array<EtatStrategie | undefined> {
  const highs = highOf(candles);
  const lows = lowOf(candles);
  const closes = closeOf(candles);
  const hh = rollingHighest(highs, DONCHIAN_CANAL);
  const ll = rollingLowest(lows, DONCHIAN_CANAL);
  const atr = rma(trueRange(candles), ATR_LENGTH);

  const n = candles.length;
  const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);
  let etat: EtatStrategie = 0;
  let extreme = 0; // plus-haut (long) / plus-bas (short) atteint depuis l'entrée

  for (let i = 1; i < n; i++) {
    const h = hh[i - 1]; // canal des DONCHIAN_CANAL bougies précédentes
    const l = ll[i - 1];
    const c = closes[i];
    const a = atr[i];
    const hi = highs[i];
    const lo = lows[i];
    if (h === undefined || l === undefined || c === undefined || a === undefined) continue;
    if (hi === undefined || lo === undefined) continue;

    if (etat === 1) {
      if (hi > extreme) extreme = hi;
      if (c < extreme - ATR_MULT_TRAIL * a) etat = 0;
    } else if (etat === -1) {
      if (lo < extreme) extreme = lo;
      if (c > extreme + ATR_MULT_TRAIL * a) etat = 0;
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
}

// ─────────────────────────── (4) Squeeze breakout + kumo ───────────────────────────

/**
 * Squeeze breakout (mêmes armement/libération que `stratSqueezeBreakout` :
 * ≥ 3 barres de squeeze ON, entrée à la libération dans le sens du momentum
 * TTM, sortie au retournement du momentum) mais l'entrée n'est prise que si la
 * TENDANCE Ichimoku la confirme : long uniquement au-dessus du nuage, short
 * uniquement en dessous ; à l'intérieur du nuage, la libération est ignorée.
 */
function positionSqueezeKumo(candles: Candle[]): Array<EtatStrategie | undefined> {
  const ctx = buildCalcContext(candles, "close");
  const sqz = ttmSqueezeOf(candles, ctx.hlc3, SQZ_LENGTH, SQZ_MULT_BB, SQZ_MULT_KC);
  const ichi = ichimokuOf(candles, ICHI_TENKAN, ICHI_KIJUN, ICHI_SENKOU_B, ICHI_KIJUN);
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
      if (dureeOn >= SQZ_DUREE_MIN) arme = true;
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
}

// ─────────────────────────── (5) MACD + Supertrend ───────────────────────────

/**
 * Croisement MACD (12/26/9) filtré par la DIRECTION du Supertrend (10, ×3) :
 * long si MACD > signal ET Supertrend haussier, short si MACD < signal ET
 * Supertrend baissier, flat dès que les deux se contredisent — le Supertrend
 * sert de régime, le MACD de déclencheur.
 */
function positionMacdSupertrend(candles: Candle[]): Array<EtatStrategie | undefined> {
  const closes = closeOf(candles);
  const m = macdOf(closes, MACD_FAST, MACD_SLOW, MACD_SIGNAL);
  const st = supertrendOf(candles, ST_PERIODE, ST_MULT);
  return candles.map((_c, i): EtatStrategie | undefined => {
    const macd = m.macd[i];
    const sig = m.signal[i];
    const dir = st.direction[i];
    if (macd === undefined || sig === undefined || dir === undefined) return undefined;
    if (macd > sig && dir > 0) return 1;
    if (macd < sig && dir < 0) return -1;
    return 0;
  });
}

// ─────────────────────────── (6) PSAR + ADX ───────────────────────────

/**
 * Parabolic SAR (0,02 / 0,2) filtré par l'ADX(14) ≥ 25 : la position suit le
 * côté du SAR (close au-dessus → long, en dessous → short) uniquement en
 * tendance confirmée ; sous le seuil d'ADX, flat forcé. Le PSAR nu n'est jamais
 * flat, ce filtre est donc le seul frein aux bascules de range.
 */
function positionPsarAdx(candles: Candle[]): Array<EtatStrategie | undefined> {
  const p = psarOf(candles, PSAR_STEP, PSAR_MAX);
  const a = adxOf(candles, ADX_LENGTH);
  const closes = closeOf(candles);
  return candles.map((_c, i): EtatStrategie | undefined => {
    const sar = p.psar[i];
    const adx = a.adx[i];
    const c = closes[i];
    if (sar === undefined || adx === undefined || c === undefined) return undefined;
    if (adx < ADX_SEUIL) return 0;
    return c > sar ? 1 : -1;
  });
}

/**
 * Les six candidats, dans l'ordre du spec §3. Cet ordre est l'ordre du rapport
 * de campagne : ne pas le réarranger.
 */
export const CANDIDATS_CHAMPION: CandidatChampion[] = [
  {
    id: "candSupertrendAdx",
    nom: "Supertrend + filtre ADX",
    regle: `Supertrend(${ST_PERIODE}, ×${ST_MULT}) suivi seulement si ADX(${ADX_LENGTH}) ≥ ${ADX_SEUIL}, sinon flat`,
    position: positionSupertrendAdx,
  },
  {
    id: "candMmRsi",
    nom: "Croisement MM + confirmation RSI",
    regle: `EMA ${MM_RAPIDE}/${MM_LENTE} confirmé par RSI(${RSI_LENGTH}) du même côté de ${RSI_NEUTRE}, sinon flat`,
    position: positionMmRsi,
  },
  {
    id: "candDonchianTrailing",
    nom: "Donchian + trailing ATR",
    regle: `cassure du canal Donchian ${DONCHIAN_CANAL}, sortie trailing à ${ATR_MULT_TRAIL} × ATR(${ATR_LENGTH}) de l'extrême atteint`,
    position: positionDonchianTrailing,
  },
  {
    id: "candSqueezeKumo",
    nom: "Squeeze breakout + tendance kumo",
    regle: `libération d'un squeeze TTM(${SQZ_LENGTH}) de ≥ ${SQZ_DUREE_MIN} barres, prise seulement du côté du nuage Ichimoku`,
    position: positionSqueezeKumo,
  },
  {
    id: "candMacdSupertrend",
    nom: "MACD + direction Supertrend",
    regle: `MACD(${MACD_FAST}/${MACD_SLOW}/${MACD_SIGNAL}) vs signal, filtré par la direction du Supertrend(${ST_PERIODE}, ×${ST_MULT})`,
    position: positionMacdSupertrend,
  },
  {
    id: "candPsarAdx",
    nom: "PSAR + filtre ADX",
    regle: `côté du PSAR(${PSAR_STEP}/${PSAR_MAX}) suivi seulement si ADX(${ADX_LENGTH}) ≥ ${ADX_SEUIL}, sinon flat`,
    position: positionPsarAdx,
  },
];
