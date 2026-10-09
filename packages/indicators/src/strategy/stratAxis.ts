/**
 * @axiom/indicators — strategy/stratAxis.ts
 *
 * AXIS — signaux d'achat et de vente par confluence (demande du propriétaire
 * du 7 octobre 2026 ; v2 du même jour, après le backtest de la v1). À la
 * clôture de chaque bougie, six votes valent +1 (haussier), −1 (baissier) ou 0
 * (neutre, égalité stricte comprise), tous issus de cœurs existants :
 *   1. tendance : EMA rapide vs EMA lente (défauts 20/50, sur les closes) ;
 *   2. Supertrend : direction (défauts 10, ×3) ;
 *   3. DMI : +DI vs −DI, compté seulement si l'ADX 14 est ≥ au seuil (défaut
 *      20) — sans tendance confirmée, le vote est neutre ;
 *   4. MACD 12/26/9 : ligne vs signal ;
 *   5. RSI 14 : vs 50 ;
 *   6. CMF 20 : signe du flux monétaire, neutre tant qu'il est indéfini
 *      (volume nul : forex Twelve Data, série synthétique).
 * Score = somme des votes ∈ [−6, 6], indéfini tant qu'un des cinq premiers
 * cœurs n'est pas amorcé (le CMF seul ne bloque jamais le score).
 *
 * Lecture LONG/PLAT, flèches alternées (conventions de defStrategie) :
 *  - ▲ ACHAT : score ≥ +seuil (défaut 5) ET close au-dessus de l'EMA de
 *    tendance (défaut 200) : pas d'achat contre la tendance de fond ;
 *  - ▼ VENTE : score ≤ −seuilVente (défaut 4). La position est tenue tant que
 *    la confluence ne s'est pas franchement retournée : un score retombé à 0
 *    ne vend pas ;
 *  - un achat déjà vrai à la première bougie évaluable (score et EMA de
 *    tendance définis) reste silencieux : son début est inconnu, il doit
 *    redevenir faux une fois (armement) ;
 *  - anti-repaint : décisions sur i ≤ n−2, jamais la dernière bougie
 *    (potentiellement en formation), qui reporte la position précédente.
 * Sortie `prixSignal` à l'échelle prix (jamais le score : l'auto-scale du pane
 * prix inclut les figures) : close de la bougie d'achat, tenu pendant la
 * position. Le calcul est indépendant de l'unité de temps ; sur les grandes
 * unités, l'EMA de tendance (défaut 200) n'est définie qu'après autant de
 * bougies d'historique, sans quoi aucun achat ne peut être signalé.
 *
 * Couche FLUX (demande du propriétaire du 7 octobre 2026, le soir : volume
 * exécuté et intérêt ouvert pour repérer les gros mouvements). Trois lectures
 * par bougie, chacune absente quand sa donnée manque :
 *   - volume relatif : volume / SMA(volume, rvolPeriode) ;
 *   - delta taker : (volume acheteur − vendeur) / volume, champs taker des
 *     bougies (Binance ; absents ailleurs) ;
 *   - ΔOI : variation % de l'intérêt ouvert sur `oiBougies` bougies (série aux
 *     `oi`, FACULTATIVE : perp USDT, ~20-90 jours d'historique selon la source).
 * Par défaut, elle ne change PAS les ▲/▼ (cœur testé intact) ; elle les
 * QUALIFIE — « fort » quand les lectures disponibles confirment : volume ≥
 * seuilRvol × moyen, delta dans le sens du signal (≥ 10 % du volume), |ΔOI| ≥
 * seuilOi ; deux confirmations sur trois lectures, toutes sinon, jamais avec un
 * delta à contre-sens — et repère les FORTS ACHATS / FORTES VENTES (marqueurs
 * couleur --accent, étiquette « Fort achat ×n » sur les trois plus récents) :
 * bougies à volume ≥ seuilGros × moyen, dans le sens du delta taker (sinon du
 * corps de la bougie), hors bougies de signal et hors dernière bougie
 * (`grosMouvementsAxis`). Le filtre optionnel `filtreFlux` n'achète que sur flux fort : ce
 * réglage sort des tests ci-dessous, l'infobulle le dit.
 *
 * STATUT de la couche flux : test unique du 8 octobre 2026 sur données jamais
 * vues (BNB/ADA/LINK/DOGE 4h, 2017-2026 ; scripts/axis/rapport-flux-2026-10-08.md,
 * manifeste figé avant tout téléchargement) : les forts achats sont suivis de
 * +1,61 % en moyenne sur les 12 bougies suivantes (690 événements, p ≤ 0,0005
 * par décalage circulaire, 3 actifs sur 4 à moyenne positive, BNB négatif ;
 * 51 % de hausses seulement : l'avantage tient aux grandes amplitudes, pas à
 * la fréquence). Fortes ventes : aucune suite mesurable. Qualification
 * « fort » des signaux ▲/▼ : descriptive, sans avantage mesuré. Les infobulles
 * au statut mesuré ne s'affichent que sur une bougie dont le delta taker est
 * disponible (population mesurée : klines Binance) ; sans delta taker, le sens
 * vient du corps seul et la couche reste « non mesurée ». L'OI n'est jamais
 * mesuré (pas d'historique long). Mesures passées, jamais une promesse.
 *
 * Pourquoi cette lecture : la v1 (▲/▼ à la naissance d'épisodes ±4, sortie au
 * retour du score à 0, long et short) a été recalée par le backtest du
 * 7 octobre 2026 — flèches sans pouvoir prédictif, frais dominants en 1h,
 * jambe vendeuse perdante. L'exploration sur les seules données déjà vues
 * (BTC/ETH, 2024-07 → 2026-10, docs/axis-2026-10-07.md) situe l'avantage dans
 * la durée de détention dans le sens de la tendance de fond, à partir du 4h.
 *
 * STATUT : test réussi le 7 octobre 2026 sur des données jamais vues
 * (BTC/ETH/XRP/SOL, 4h, 2017-2024 ; scripts/axis/rapport-v2-2026-10-07.md) :
 * expectancy nette positive aux coûts x1 et x3 sur les quatre actifs et
 * timing au-delà de la simple exposition (p = 0,0005). Comparaison
 * pré-déclarée, sans effet sur le verdict : pas mieux qu'une EMA 200 seule
 * en PnL total sur 3 actifs sur 4 (meilleure expectancy par trade partout,
 * exposition moindre). D'abord réservée au 4h (seule unité testée), AXIS est
 * utilisable sur toute unité depuis la demande du propriétaire du 7 octobre
 * 2026.
 *
 * AUTRES UNITÉS : test unique du 8 octobre 2026 sur 42 alts jamais vues (1s à
 * 1w hors 4h ; scripts/axis/rapport-ut-2026-10-08.md, manifeste figé avant
 * tout téléchargement) : aucune unité ne passe. Signaux perdants après frais
 * de 1s à 30m et en 3d, quasi nuls en 1h ; gagnants de 2h à 1d, mais au timing
 * non démontré face à la même exposition placée au hasard ; trop peu de trades
 * en 1w (environ un an de décisions après l'amorce).
 * Forts achats : continuation démontrée dans aucune unité. L'infobulle dit
 * le statut de l'unité du chart (`ctx.timeframe`) ; en 4h ou sans unité
 * (alertes, screener), elle garde les formulations des tests 4h. Mesures
 * passées, jamais une promesse.
 *
 * STOP SUIVEUR (v3, 8 octobre 2026). La v2 tient une position jusqu'au
 * retournement franc de la confluence, sans stop (drawdowns de 10 % du capital
 * en médiane sur les 8 grandes cryptos vues, 46 % sur DOGE). La v3 ajoute une
 * sortie : à l'entrée, niveau = close − stopAtr × ATR 14 (rma du true range) ;
 * à chaque clôture tenue, niveau = max(niveau précédent, plus haut close depuis
 * l'entrée − stopAtr × ATR 14) — un cliquet, le niveau ne descend jamais ;
 * à la clôture de la bougie i, close < niveau en vigueur (fixé sur les bougies
 * ≤ i−1) → position 0, sortie « stop ». La sortie par score (≤ −seuilVente)
 * reste lue ; si les deux sont vraies à la même bougie, la raison est « score ».
 * Après une sortie par stop, la condition d'achat doit redevenir fausse une
 * fois avant un nouvel achat (même armement qu'au début de série : sans cela,
 * une confluence encore ≥ seuil rachèterait dès la bougie suivante le titre
 * que le stop vient de couper) ; après une sortie par score, réentrée possible
 * dès la bougie suivante, comme en v2. Les ▲ ne changent pas. Sortie « stop »
 * à l'échelle prix : niveau en vigueur après chaque clôture tenue, absente à
 * plat, à la bougie de sortie et sans stop. Une sortie par stop est un ▼
 * étiqueté « Stop ±x % » (au lieu de « Vente ») dont l'infobulle nomme le
 * niveau franchi. Réglage `stopAtr` (× ATR 14) ; 0 = sans stop, la v2 exacte
 * (positions identiques à `positionsAxis`). Le multiplicateur 3 vient d'une
 * exploration sur données déjà vues (scripts/explorer-axis-v3.ts) ; le test
 * sur données jamais vues (151 alts 4h, 2023-07 → 2026-10, protocole figé
 * scripts/axis/manifeste-v3-2026-10-08.json) a rendu un verdict DÉFAVORABLE :
 * drawdown plus faible sur 82 % des actifs, mais Sharpe meilleur que sans stop
 * sur 41 % seulement (37 % puis 51 % par moitié), PnL moyen +3,8 % contre
 * +6,4 % sans stop, 81 % des sorties par stop. Suites appliquées : le défaut
 * reste 0 (signaux et textes de la v2 inchangés) ; le réglage reste
 * disponible et l'infobulle d'un stop actif dit l'échec (3 × ATR 14) ou « hors
 * du test » (autre multiplicateur). Ces données sont consommées.
 *
 * AMORCE (fidélité d'affichage, 9 octobre 2026). Les tests ont lu des séries
 * longues (300 bougies d'amorce puis des années de décisions) ; le chart, lui,
 * calcule sur son backfill. Mesure sur les 8 grandes cryptos vues (4h,
 * 2017-2026, fenêtres glissantes, 300 dernières bougies décidées) : sur 500
 * bougies, 60 % des fenêtres montrent au moins un signal absent ou en trop
 * par rapport à la série longue (11,6 % des signaux affichés sont faux, 11,6 %
 * des signaux de référence manquent) ; sur 1 000, 0,4 % des fenêtres ; sur
 * 1 500, aucun écart. `amorceBougies` = 1500 : le chart remonte jusque-là
 * quand AXIS est actif ; en deçà (source à sec, historique court, alertes sur
 * un buffer plus court), l'infobulle des signaux le dit.
 *
 * FILTRE ADX À L'ENTRÉE (v4, 9 octobre 2026). Réglage `adxEntree` : quand il
 * est > 0, l'achat exige en plus ADX 14 ≥ adxEntree à la clôture de décision
 * (le même ADX que le vote DMI ; ADX indéfini = condition fausse) ; la
 * condition d'achat ainsi complétée est celle que l'armement observe, les
 * ventes ne changent pas. 0 = sans filtre, la v2 exacte. Le seuil 25 vient de
 * l'exploration des entrées sur données déjà vues (scripts/explorer-axis-v4.ts,
 * 13 variantes, 151 alts + 8 grandes cryptos 4h) : aucune variante n'y passe
 * la règle pré-écrite (adx-25 : Sharpe meilleur que la v2 sur 62 % des alts,
 * mais sur 2 grandes cryptos sur 8 au lieu des 5 exigées). Le propriétaire a
 * décidé de la tester quand même sur des données jamais vues, l'écart à la
 * règle déclaré dans le protocole (scripts/axis/manifeste-v4-2026-10-09.json,
 * figé avant tout téléchargement) ; en attendant le verdict, le défaut reste 0
 * et l'infobulle d'un filtre actif dit « test en cours ».
 */

import type { Candle, IndicatorDef, LabelAnnotation, MarqueurAnnotation, Timeframe } from "@axiom/types";
import { closeOf, ema, rma, sma, trueRange, volOf } from "../utils";
import { MAX_LABELS_SORTIE } from "../utils-fabrique-strategie";
import { rsiOf } from "../momentum/rsi";
import { adxOf } from "../trend/adx";
import { macdOf } from "../trend/macd";
import { supertrendOf } from "../trend/supertrend";
import { cmfOf } from "../volume/cmf";

/** Cap de signaux annotés (les plus récents) — borne le coût du rendu. */
export const MAX_SIGNAUX_AXIS = 120;
/** Cap de marqueurs « fort achat / forte vente » (les plus récents). */
export const MAX_GROS_AXIS = 60;
/** Étiquettes « Fort achat ×n / Forte vente ×n » : seuls les plus récents. */
export const MAX_LABELS_GROS = 3;
/** Part du volume que le delta taker doit atteindre pour donner un sens. */
export const SEUIL_DELTA_AXIS = 0.1;
/** Période de l'ATR du stop suiveur (Wilder, comme l'ADX et le RSI du score). */
export const ATR_STOP_PERIODE = 14;
/**
 * Bougies d'historique à partir desquelles les signaux affichés sont ceux d'une série
 * longue (aucun écart mesuré sur 8 séries 4h 2017-2026 ; 60 % de fenêtres en écart à 500).
 */
export const AMORCE_AXIS = 1500;
/** Période de l'ADX du filtre d'entrée : celui du vote DMI (adxOf(candles, 14)). */
export const ADX_ENTREE_PERIODE = 14;
/** Seuil d'ADX à l'entrée soumis au test du 9 octobre 2026 ; tout autre réglage > 0 est hors test. */
export const ADX_ENTREE_TESTE = 25;

const signe = (a: number, b: number): number => (a > b ? 1 : a < b ? -1 : 0);

/** Votes par bougie, ordre EMA, Supertrend, DMI, MACD, RSI, CMF. PURE. */
export function votesAxis(
  candles: Candle[],
  params: Record<string, number | boolean | string>
): Array<number[] | undefined> {
  const closes = closeOf(candles);
  const rapide = ema(closes, Number(params.emaRapide ?? 20));
  const lente = ema(closes, Number(params.emaLente ?? 50));
  const st = supertrendOf(candles, Number(params.stPeriode ?? 10), Number(params.stMult ?? 3));
  const dmi = adxOf(candles, 14);
  const m = macdOf(closes, 12, 26, 9);
  const rsi = rsiOf(closes, 14);
  const cmf = cmfOf(candles, 20);
  const seuilAdx = Number(params.seuilAdx ?? 20);
  return candles.map((_c, i) => {
    const r = rapide[i];
    const l = lente[i];
    const d = st.direction[i];
    const x = dmi.adx[i];
    const p = dmi.plusDI[i];
    const q = dmi.minusDI[i];
    const mc = m.macd[i];
    const sg = m.signal[i];
    const rs = rsi[i];
    if (
      r === undefined || l === undefined || d === undefined || x === undefined || p === undefined ||
      q === undefined || mc === undefined || sg === undefined || rs === undefined
    ) {
      return undefined;
    }
    const f = cmf[i];
    return [signe(r, l), d, x >= seuilAdx ? signe(p, q) : 0, signe(mc, sg), signe(rs, 50), f === undefined ? 0 : signe(f, 0)];
  });
}

/**
 * Lecture v1 (épisodes ±seuil, sortie au retour du score à 0), recalée par le
 * backtest du 7 octobre 2026 : plus lue par `stratAxis`, conservée pour la
 * campagne figée de scripts/valider-axis.ts. État par bougie (1 haussier
 * fort, −1 baissier fort, 0 aucun, `undefined` avant le premier score
 * défini) ; un score indéfini, ou situé après `fin`, reporte l'état. PURE.
 */
export function episodesAxis(
  score: Array<number | undefined>,
  seuil: number,
  fin: number
): Array<number | undefined> {
  let e: number | undefined;
  return score.map((s, i) => {
    if (s !== undefined && i <= fin) {
      e = (e === 1 && s > 0) || (e === -1 && s < 0) ? e : s >= seuil ? 1 : s <= -seuil ? -1 : 0;
    }
    return e;
  });
}

/**
 * Position long/plat par bougie (1 acheté, 0 à plat, `undefined` avant le
 * premier score défini). Achat : score ≥ seuil ET `auDessus` vrai (close au-
 * dessus de l'EMA de tendance), seulement une fois armé — l'achat doit avoir
 * été évaluable ET faux depuis le début ; vente : score ≤ −seuilVente. Une
 * bougie au score indéfini, ou située après `fin`, reporte la position. PURE.
 */
export function positionsAxis(
  score: Array<number | undefined>,
  auDessus: Array<boolean | undefined>,
  seuil: number,
  seuilVente: number,
  fin: number
): Array<number | undefined> {
  let pos: number | undefined;
  let arme = false;
  return score.map((s, i) => {
    if (s === undefined || i > fin) return pos;
    if (pos === 1) {
      if (s <= -seuilVente) [pos, arme] = [0, true];
      return pos;
    }
    pos = 0;
    const tendance = auDessus[i];
    if (tendance !== undefined) {
      const achat = s >= seuil && tendance;
      if (achat && arme) pos = 1;
      arme = !achat;
    }
    return pos;
  });
}

/** Raison d'une sortie : retournement du score (v2) ou close sous le stop suiveur (v3). */
export type RaisonSortieAxis = "score" | "stop";

/**
 * Positions de la v3 : entrées de `positionsAxis`, sorties par score OU par stop
 * suiveur à cliquet (plus haut close depuis l'entrée − stopAtr × ATR). `pos` comme
 * `positionsAxis` ; `stop` : niveau en vigueur après chaque clôture tenue (absent à
 * plat, à la bougie de sortie, sans stop) ; `raisons` : bougie de sortie → raison.
 * Avec stopAtr = 0, `pos` est strictement celle de `positionsAxis`. PURE.
 */
export function positionsStopAxis(
  score: Array<number | undefined>,
  auDessus: Array<boolean | undefined>,
  closes: number[],
  atr: Array<number | undefined>,
  seuil: number,
  seuilVente: number,
  fin: number,
  stopAtr: number
): { pos: Array<number | undefined>; stop: Array<number | undefined>; raisons: Map<number, RaisonSortieAxis> } {
  const n = score.length;
  const posSerie: Array<number | undefined> = new Array(n).fill(undefined);
  const stop: Array<number | undefined> = new Array(n).fill(undefined);
  const raisons = new Map<number, RaisonSortieAxis>();
  let pos: number | undefined;
  let arme = false;
  let plusHaut = -Infinity;
  let stopCourant: number | undefined;
  for (let i = 0; i < n; i++) {
    const s = score[i];
    const c = closes[i];
    if (s === undefined || i > fin) {
      posSerie[i] = pos;
      stop[i] = pos === 1 ? stopCourant : undefined;
      continue;
    }
    if (pos === 1) {
      const sortieScore = s <= -seuilVente;
      // Le niveau comparé a été fixé sur les bougies ≤ i−1 : la bougie i ne peut pas
      // relever le stop qui la coupe (décision à la clôture, sans regard sur elle-même).
      const sortieStop = stopAtr > 0 && stopCourant !== undefined && c !== undefined && c < stopCourant;
      if (sortieScore || sortieStop) {
        pos = 0;
        // Après un stop, la confluence peut encore valoir ≥ seuil : sans réarmement,
        // le titre coupé serait racheté dès la bougie suivante.
        arme = sortieScore;
        raisons.set(i, sortieScore ? "score" : "stop");
        stopCourant = undefined;
      } else {
        const a = atr[i];
        if (stopAtr > 0 && a !== undefined && c !== undefined) {
          plusHaut = Math.max(plusHaut, c);
          // Cliquet : un ATR qui grandit ne fait jamais redescendre le niveau acquis.
          stopCourant = Math.max(stopCourant ?? -Infinity, plusHaut - stopAtr * a);
        }
        stop[i] = stopCourant;
      }
      posSerie[i] = pos;
      continue;
    }
    pos = 0;
    const tendance = auDessus[i];
    if (tendance !== undefined) {
      const achat = s >= seuil && tendance;
      if (achat && arme) {
        pos = 1;
        plusHaut = c ?? -Infinity;
        const a = atr[i];
        stopCourant = stopAtr > 0 && a !== undefined && c !== undefined ? c - stopAtr * a : undefined;
        stop[i] = stopCourant;
      }
      arme = !achat;
    }
    posSerie[i] = pos;
  }
  return { pos: posSerie, stop, raisons };
}

/** Lectures de flux d'une bougie ; une lecture sans donnée reste absente. */
export interface FluxBougie {
  /** Volume / moyenne mobile du volume. */
  rvol?: number;
  /** (Volume acheteur − vendeur) / volume, ∈ [−1, 1]. */
  delta?: number;
  /** Variation % de l'intérêt ouvert sur `oiBougies` bougies. */
  dOi?: number;
}

/** Lectures de flux par bougie (volume relatif, delta taker, ΔOI). PURE. */
export function fluxAxis(
  candles: Candle[],
  oi: Array<number | undefined> | undefined,
  rvolPeriode: number,
  oiBougies: number
): FluxBougie[] {
  const moyen = sma(volOf(candles), rvolPeriode);
  const recul = Math.max(1, Math.round(oiBougies));
  return candles.map((c, i) => {
    const f: FluxBougie = {};
    const m = moyen[i];
    if (m !== undefined && m > 0 && Number.isFinite(c.volume)) f.rvol = c.volume / m;
    if (c.buyVolume !== undefined && c.sellVolume !== undefined && c.volume > 0) {
      const d = (c.buyVolume - c.sellVolume) / c.volume;
      if (Number.isFinite(d)) f.delta = d;
    }
    const o = oi?.[i];
    const o0 = oi?.[i - recul];
    if (o !== undefined && o0 !== undefined && o0 > 0 && Number.isFinite(o)) f.dOi = (o / o0 - 1) * 100;
    return f;
  });
}

/** Force du flux dans un sens (+1 achat, −1 vente) : lectures disponibles, confirmations, delta à contre-sens. PURE. */
export function forceFlux(
  f: FluxBougie,
  sens: number,
  seuilRvol: number,
  seuilOi: number
): { dispo: number; confirme: number; contre: boolean; fort: boolean } {
  const lectures = [
    f.rvol === undefined ? undefined : f.rvol >= seuilRvol,
    f.delta === undefined ? undefined : sens * f.delta >= SEUIL_DELTA_AXIS,
    f.dOi === undefined ? undefined : Math.abs(f.dOi) >= seuilOi,
  ];
  const dispo = lectures.filter((l) => l !== undefined).length;
  const confirme = lectures.filter((l) => l === true).length;
  const contre = f.delta !== undefined && sens * f.delta <= -SEUIL_DELTA_AXIS;
  return { dispo, confirme, contre, fort: dispo > 0 && !contre && confirme >= Math.min(2, dispo) };
}

/** Sens d'un fort mouvement : delta taker s'il est marqué, sinon corps de la bougie (0 = indécis). */
export const sensGros = (f: FluxBougie, c: Candle): number =>
  f.delta !== undefined && Math.abs(f.delta) >= SEUIL_DELTA_AXIS ? Math.sign(f.delta) : signe(c.close, c.open);

/**
 * Forts achats (+1) et fortes ventes (−1) : bougies à volume relatif ≥ `seuilGros`, de
 * sens défini, hors `exclues` (bougies de signal, déjà qualifiées) et hors dernière bougie
 * (volume en formation). Dans l'ordre des bougies, sans cap. PURE — c'est cette fonction
 * que la campagne de mesure rejoue, bougie par bougie, pour contrôler le chart.
 */
export function grosMouvementsAxis(
  candles: Candle[],
  flux: FluxBougie[],
  seuilGros: number,
  exclues: ReadonlySet<number>
): Array<{ idx: number; sens: number }> {
  const out: Array<{ idx: number; sens: number }> = [];
  for (let i = 0; i < candles.length - 1; i++) {
    const f = flux[i];
    const c = candles[i];
    if (f?.rvol === undefined || c === undefined || f.rvol < seuilGros || exclues.has(i)) continue;
    const sens = sensGros(f, c);
    if (sens !== 0) out.push({ idx: i, sens });
  }
  return out;
}

const pct = (v: number, decimales: number): string => `${v > 0 ? "+" : ""}${v.toFixed(decimales)} %`;

/** Texte des lectures de flux pour une infobulle. */
function texteFlux(f: FluxBougie, oiBougies: number): string {
  return [
    f.rvol === undefined ? "volume n.d." : `volume ×${f.rvol.toFixed(1)}`,
    f.delta === undefined ? "delta taker n.d." : `delta taker ${pct(f.delta * 100, 0)}`,
    f.dOi === undefined ? "OI n.d." : `OI ${pct(f.dOi, 1)} sur ${oiBougies} b.`,
  ].join(", ");
}

const fleche = (v: number): string => (v > 0 ? "▲" : v < 0 ? "▼" : "–");
// Formulation choisie par le runner de campagne (manifeste v2, suites.infobulleSiFavorable).
const RESERVE =
  "test réussi sur données jamais vues (crypto 4h, 2017-2024), pas mieux qu'une EMA 200 seule sur 3/4 actifs — mesure passée, pas une promesse";
const RESERVE_FILTRE = "filtre flux actif : signaux hors du test du 7 octobre 2026, non mesurés — jamais une promesse";
// Formulations fixées par le manifeste flux (suites), chiffres du résultat regroupé
// (scripts/axis/rapport-flux-2026-10-08.md) ; réservées aux bougies à delta taker.
const MESURE_FORT_ACHAT =
  "fort achat : sur données jamais vues (BNB/ADA/LINK/DOGE 4h, 2017-2026), +1.61 % en moyenne sur les 12 bougies suivantes (51 % de hausses, p ≤ 0.0005) — mesure passée, pas une promesse";
const MESURE_FORTE_VENTE = "forte vente : repérée ; aucune suite mesurable à 12 bougies sur données jamais vues (BNB/ADA/LINK/DOGE 4h, 2017-2026)";
const NON_MESURE = "couche flux non mesurée";
const QUALIFICATION = "qualification descriptive, sans avantage mesuré pour les signaux « forts » (données jamais vues, 8 octobre 2026)";

// Test du 8 octobre 2026 sur les autres unités (scripts/axis/rapport-ut-2026-10-08.md) :
// aucune n'a passé. Par unité : alts disponibles, période, échecs des forts achats, puis
// signaux [échecs, expectancy nette x1 %, p du timing] ou [raison du « non mesuré »].
// Formulations du manifeste, chiffres du résultat ; le test croisé
// apps/web/src/chart/indicators.axisUnites.test.ts les compare au résultat.
/** S1 à S4 en échec ; `actifs` : cellules à PnL net positif / cellules ayant un trade. */
const echecsSignaux = (actifs: string): string =>
  `expectancy nette ≤ 0 aux coûts x1 ou x3, timing non significatif, PnL positif sur ${actifs} actifs seulement, expectancy négative sur une moitié de la période`;
const SOUS_COUT = ", sans dépasser le coût aller-retour de 0.14 %";
const UNITES: Partial<Record<Timeframe, [number, string, string, [string] | [string, string, string]]>> = {
  "1s": [42, "12 h, 7 octobre 2026", `forts achats suivis de 0.00 % en moyenne (26 % de hausses, p bilatérale = 0.9612)${SOUS_COUT}`, [echecsSignaux("0/42"), "-0.17", "= 1.0000"]],
  "1m": [42, "30 jours, sept.-oct. 2026", `forts achats suivis de +0.01 % en moyenne (44 % de hausses, p bilatérale = 0.2386)${SOUS_COUT}`, [echecsSignaux("1/42"), "-0.17", "= 1.0000"]],
  "3m": [42, "90 jours, juil.-oct. 2026", `forts achats suivis de 0.00 % en moyenne (43 % de hausses, p bilatérale = 0.9124)${SOUS_COUT}`, [echecsSignaux("2/42"), "-0.18", "= 1.0000"]],
  "5m": [42, "150 jours, mai-oct. 2026", `forts achats suivis de -0.02 % en moyenne (43 % de hausses, p bilatérale = 0.0204)${SOUS_COUT}, suite positive sur 15/42 actifs seulement`, [echecsSignaux("4/42"), "-0.23", "= 1.0000"]],
  "15m": [42, "oct. 2025-oct. 2026", `forts achats suivis de -0.10 % en moyenne (44 % de hausses, p bilatérale ≤ 0.0002)${SOUS_COUT}, suite positive sur 7/42 actifs seulement`, [echecsSignaux("5/42"), "-0.28", "= 0.9948"]],
  "30m": [42, "oct. 2024-oct. 2026", `forts achats suivis de -0.14 % en moyenne (45 % de hausses, p bilatérale = 0.0004)${SOUS_COUT}, suite positive sur 15/42 actifs seulement`, [echecsSignaux("10/42"), "-0.18", "= 0.6856"]],
  "1h": [42, "oct. 2023-oct. 2026", `forts achats suivis de -0.19 % en moyenne (45 % de hausses, p bilatérale = 0.0012)${SOUS_COUT}, suite positive sur 17/42 actifs seulement`, [echecsSignaux("21/42"), "+0.06", "= 0.4804"]],
  "2h": [40, "2020-2026", `forts achats suivis de -0.24 % en moyenne (45 % de hausses, p bilatérale = 0.0044)${SOUS_COUT}, suite positive sur 14/40 actifs seulement`, ["timing non significatif", "+1.64", "= 0.1048"]],
  "6h": [40, "2020-2026", `forts achats suivis de -0.68 % en moyenne (44 % de hausses, p bilatérale = 0.0072)${SOUS_COUT}, suite positive sur 14/40 actifs seulement`, ["timing non significatif", "+7.38", "= 0.0742"]],
  "12h": [40, "2020-2026", `forts achats suivis de -0.84 % en moyenne (44 % de hausses, p bilatérale = 0.0758)${SOUS_COUT}, suite positive sur 15/40 actifs seulement`, ["timing non significatif", "+20.24", "= 0.0552"]],
  "1d": [40, "2020-2026", "forts achats suivis de +0.46 % en moyenne (44 % de hausses, p bilatérale = 0.6006), suite positive sur 20/40 actifs seulement", ["timing non significatif", "+35.76", "= 0.1208"]],
  "3d": [40, "2020-2026", "forts achats suivis de +1.24 % en moyenne (44 % de hausses, p bilatérale = 0.6792)", [echecsSignaux("9/39"), "-7.50", "= 0.8381"]],
  "1w": [40, "2020-2026", "suite positive sur 16/40 actifs seulement", ["trop peu de signaux sur données jamais vues : 2 trades clos"]],
};

// Test du stop suiveur du 8 octobre 2026 sur données jamais vues (151 alts 4h, 2023-2026,
// scripts/axis/rapport-v3-2026-10-08.md) : verdict DÉFAVORABLE. Formulations des suites du
// manifeste v3 (suites.DEFAVORABLE.infobulleStopActif, communes.reglageHorsTest), chiffres du
// résultat ; le test croisé apps/web/src/chart/indicators.axisStop.test.ts les compare au résultat.
// Sans stop (0, le défaut), les textes d'avant le test restent inchangés.
/** Multiplicateur mesuré par le test ; tout autre réglage > 0 est hors test. */
export const STOP_ATR_TESTE = 3;
const suffixeStop = (stopAtr: number): string =>
  stopAtr <= 0
    ? ""
    : stopAtr === STOP_ATR_TESTE
      ? ` ; stop suiveur ${STOP_ATR_TESTE} × ATR ${ATR_STOP_PERIODE} actif : test du 8 octobre 2026 échoué sur données jamais vues (151 alts 4h, 2023-2026 : Sharpe meilleur que sans stop sur 41 % des actifs seulement ; amélioration absente dans une moitié de la période (37 % puis 51 %)) — pas une amélioration validée`
      : ` ; stop suiveur ${stopAtr} × ATR ${ATR_STOP_PERIODE} : réglage hors du test du 8 octobre 2026 (${STOP_ATR_TESTE} × ATR ${ATR_STOP_PERIODE} mesuré) — non mesuré`;

// Filtre ADX à l'entrée (v4) : test du 9 octobre 2026 en cours sur données jamais vues
// (scripts/axis/manifeste-v4-2026-10-09.json). Tant qu'il n'a pas rendu son verdict, tout
// filtre actif est « non mesuré » ; les suites du manifeste remplaceront cette mention.
const suffixeAdx = (adxEntree: number): string =>
  adxEntree > 0 ? ` ; filtre ADX ${ADX_ENTREE_PERIODE} ≥ ${adxEntree} à l'entrée : non mesuré (test du 9 octobre 2026 en cours)` : "";

/**
 * Textes des infobulles selon l'unité du chart (4h ou unité absente : ceux des tests 4h)
 * et les réglages hors des textes de base : filtre ADX à l'entrée (`adxEntree` > 0) puis
 * stop (`stopAtr` > 0), chacun ajoutant sa mention aux signaux ; à 0, textes inchangés.
 */
export function textesAxis(
  u: Timeframe | undefined,
  stopAtr = 0,
  adxEntree = 0
): { signaux: string; fortAchat: string; forteVente: string; qualification: string } {
  const t = textesUnite(u);
  return stopAtr > 0 || adxEntree > 0 ? { ...t, signaux: t.signaux + suffixeAdx(adxEntree) + suffixeStop(stopAtr) } : t;
}

function textesUnite(u: Timeframe | undefined): { signaux: string; fortAchat: string; forteVente: string; qualification: string } {
  if (u === undefined || u === "4h") return { signaux: RESERVE, fortAchat: MESURE_FORT_ACHAT, forteVente: MESURE_FORTE_VENTE, qualification: QUALIFICATION };
  const qualification = `qualification descriptive, non mesurée en ${u}`;
  const m = UNITES[u];
  if (m === undefined) {
    // 1M, 3M, 6M, 12M : historique trop court ; 5s, 15s : aucune source câblée.
    const court = u.endsWith("M");
    const flux = `couche flux non mesurée en ${u}${court ? " (historique trop court)" : ""}`;
    return {
      signaux: `en ${u} : non mesuré${court ? " (historique trop court pour l'EMA 200 et l'amorce)" : ""} — lecture indicative, jamais une promesse`,
      fortAchat: flux,
      forteVente: flux,
      qualification,
    };
  }
  const [n, periode, echecsFlux, [s, expectancy, p]] = m;
  const jv = `sur données jamais vues (${n} alts, ${periode})`;
  const flux = `fort achat / forte vente : test échoué à 12 bougies en ${u} ${jv} — ${echecsFlux} — pas un signal validé`;
  return {
    signaux:
      expectancy === undefined
        ? `en ${u} : non mesuré (${s}) — lecture indicative, jamais une promesse`
        : `en ${u} : test échoué ${jv} — ${s} ; expectancy nette ${expectancy} % par trade (coûts x1), timing p ${p} — lecture indicative, pas un signal validé`,
    fortAchat: flux,
    forteVente: flux,
    qualification,
  };
}

/** Niveau de prix d'une infobulle : deux décimales dès 1, quatre chiffres significatifs en dessous. */
const prix = (v: number): string => (v >= 1 ? v.toFixed(2) : v.toPrecision(4));

/**
 * Mention d'une amorce plus courte que `AMORCE_AXIS` dans l'infobulle d'un signal :
 * l'EMA 200, les lissages de Wilder et la position tenue dépendent du début de la
 * série, donc le signal peut différer de celui qu'une série longue aurait donné.
 * Vide dès que l'historique suffit. PURE.
 */
export const texteAmorce = (n: number): string =>
  n < AMORCE_AXIS
    ? ` ; amorce courte (${n} bougies, ${AMORCE_AXIS} attendues) : signaux pouvant différer de ceux d'une série longue`
    : "";

export const stratAxis: IndicatorDef = {
  id: "stratAxis",
  name: "AXIS",
  category: "strategy",
  pane: "overlay",
  // Facultative : sans OI (symbole hors perp USDT, fetch en échec), la couche flux lit
  // volume et delta seuls ; les signaux du cœur ne dépendent de rien d'auxiliaire.
  auxFacultatives: ["oi"],
  amorceBougies: AMORCE_AXIS,
  inputs: [
    { key: "seuil", name: "Achat si score ≥", type: "number", default: 5, min: 1, max: 6 },
    { key: "seuilVente", name: "Vente si score ≤ −", type: "number", default: 4, min: 1, max: 6 },
    { key: "emaTendance", name: "EMA de tendance", type: "number", default: 200, min: 2 },
    { key: "emaRapide", name: "EMA rapide", type: "number", default: 20, min: 1 },
    { key: "emaLente", name: "EMA lente", type: "number", default: 50, min: 2 },
    { key: "stPeriode", name: "Période Supertrend", type: "number", default: 10, min: 1 },
    { key: "stMult", name: "Multiplicateur Supertrend", type: "number", default: 3, min: 0.5 },
    { key: "seuilAdx", name: "Seuil ADX", type: "number", default: 20, min: 5, max: 60 },
    { key: "rvolPeriode", name: "Volume moyen sur (bougies)", type: "number", default: 20, min: 2, max: 500 },
    { key: "seuilRvol", name: "Flux fort si volume ≥ × moyen", type: "number", default: 1.5, min: 1, max: 20 },
    { key: "seuilGros", name: "Gros mouvement si volume ≥ × moyen", type: "number", default: 3, min: 1, max: 50 },
    { key: "oiBougies", name: "Variation d'OI sur (bougies)", type: "number", default: 6, min: 1, max: 200 },
    { key: "seuilOi", name: "OI significatif si |Δ| ≥ (%)", type: "number", default: 2, min: 0.1, max: 100 },
    { key: "filtreFlux", name: "N'acheter que sur flux fort", type: "boolean", default: false },
    { key: "stopAtr", name: "Stop suiveur (× ATR 14, 0 = sans)", type: "number", default: 0, min: 0, max: 20 },
    { key: "adxEntree", name: "Achat si ADX 14 ≥ (0 = sans)", type: "number", default: 0, min: 0, max: 100 },
  ],
  outputs: [
    { key: "prixSignal", name: "Prix d'achat", style: "line" },
    { key: "stop", name: "Stop suiveur", style: "line" },
  ],
  calc(candles, params, ctx) {
    const n = candles.length;
    const votes = votesAxis(candles, params);
    const score = votes.map((v) => v?.reduce((a, b) => a + b, 0));
    const closes = closeOf(candles);
    const tendance = ema(closes, Number(params.emaTendance ?? 200));
    const seuilRvol = Number(params.seuilRvol ?? 1.5);
    const seuilOi = Number(params.seuilOi ?? 2);
    const oiBougies = Number(params.oiBougies ?? 6);
    const flux = fluxAxis(candles, ctx.aux?.oi, Number(params.rvolPeriode ?? 20), oiBougies);
    const force = (i: number, sens: number) => forceFlux(flux[i] ?? {}, sens, seuilRvol, seuilOi);
    const filtre = params.filtreFlux === true;
    const stopAtr = Number(params.stopAtr ?? 0);
    const adxEntree = Number(params.adxEntree ?? 0);
    // Même ADX que le vote DMI ; calculé seulement si le filtre est actif (défaut intact).
    const adx = adxEntree > 0 ? adxOf(candles, ADX_ENTREE_PERIODE).adx : undefined;
    const adxSuffisant = (i: number): boolean => adx === undefined || (adx[i] ?? -Infinity) >= adxEntree;
    const { pos, stop, raisons } = positionsStopAxis(
      score,
      tendance.map((t, i) => (t === undefined ? undefined : (closes[i] ?? t) > t && (!filtre || force(i, 1).fort) && adxSuffisant(i))),
      closes,
      rma(trueRange(candles), ATR_STOP_PERIODE),
      Number(params.seuil ?? 5),
      Number(params.seuilVente ?? 4),
      n - 2,
      stopAtr
    );

    // Signal = changement de position entre deux bougies définies (jamais la première).
    const prixSignal: Array<number | undefined> = new Array(n).fill(undefined);
    const signaux: number[] = [];
    for (let i = 1; i < n; i++) {
      const p = pos[i - 1];
      if (p !== undefined && pos[i] !== p) signaux.push(i);
      if (pos[i] === 1) prixSignal[i] = p === 1 ? prixSignal[i - 1] : candles[i]?.close;
    }

    const noms = [`EMA ${params.emaRapide}/${params.emaLente}`, "Supertrend", "DMI", "MACD", "RSI", "CMF"];
    const textes = textesAxis(ctx.timeframe, stopAtr, adxEntree);
    const reserve = filtre ? RESERVE_FILTRE + suffixeAdx(adxEntree) + suffixeStop(stopAtr) : textes.signaux;
    // Placée avant la couche flux : la fin de l'infobulle (« ; qualification) — statut »)
    // reste celle que les tests croisés comparent aux formulations figées des campagnes.
    const amorce = texteAmorce(n);
    const marqueurs: MarqueurAnnotation[] = [];
    const labels: LabelAnnotation[] = [];
    // Seuls les signaux les plus récents portent une étiquette (même règle que defStrategie).
    signaux.slice(-MAX_SIGNAUX_AXIS).forEach((idx, k, recents) => {
      const b = candles[idx];
      const v = votes[idx];
      const s = score[idx];
      const prixAchat = prixSignal[idx - 1];
      if (b === undefined || v === undefined || s === undefined) return;
      const achat = pos[idx] === 1;
      const couleur = achat ? "--up" : "--down";
      const valeur = achat ? b.low : b.high;
      const pctSignal = prixAchat === undefined ? 0 : (b.close / prixAchat - 1) * 100;
      const resultat = pct(pctSignal, 2);
      const fo = force(idx, achat ? 1 : -1);
      const qualite = fo.dispo === 0 ? "indisponible" : fo.fort ? "fort" : fo.contre ? "à contre-sens" : "ordinaire";
      const parStop = !achat && raisons.get(idx) === "stop";
      const fort = fo.fort ? (achat || parStop ? " fort" : " forte") : "";
      // Niveau franchi : le stop en vigueur à la décision, fixé à la bougie précédente.
      const niveau = stop[idx - 1];
      const sortie = parStop
        ? `close sous le stop suiveur (${niveau === undefined ? "n.d." : prix(niveau)}) ; ${resultat} depuis l'achat (hors frais)`
        : `${resultat} depuis l'achat (hors frais)`;
      // Filtre actif : la valeur d'ADX qui a laissé passer l'achat (toujours définie à un achat).
      const entree = `close au-dessus de l'EMA ${params.emaTendance}${adx === undefined ? "" : `, ADX ${ADX_ENTREE_PERIODE} ${(adx[idx] ?? 0).toFixed(1)} ≥ ${adxEntree}`}`;
      marqueurs.push({
        idx,
        valeur,
        forme: achat ? "triangleHaut" : "triangleBas",
        couleur,
        cible: "prix",
        info:
          `AXIS ${achat ? "achat" : parStop ? "stop" : "vente"}${fort} — score ${s > 0 ? "+" : ""}${s}/6 : ` +
          `${noms.map((nom, w) => `${nom} ${fleche(v[w] ?? 0)}`).join(", ")} ; ` +
          `${achat ? entree : sortie}${amorce} ; ` +
          `flux ${qualite} (${texteFlux(flux[idx] ?? {}, oiBougies)} ; ${textes.qualification}) — ${reserve}`,
      });
      if (k >= recents.length - MAX_LABELS_SORTIE) {
        labels.push({
          idx,
          valeur,
          texte: achat ? `Achat${fort}` : `${parStop ? "Stop" : "Vente"}${fort} ${resultat}`,
          couleur,
          cible: "prix",
          position: achat ? "dessous" : "dessus",
        });
      }
    });

    // Forts achats / fortes ventes : volume ≥ seuilGros × moyen, hors bougies de signal
    // (déjà qualifiées) et hors dernière bougie (volume en formation).
    const gros = grosMouvementsAxis(candles, flux, Number(params.seuilGros ?? 3), new Set(signaux));
    gros.slice(-MAX_GROS_AXIS).forEach(({ idx, sens }, k, recents) => {
      const f = flux[idx] ?? {};
      const c = candles[idx] as Candle;
      const achat = sens > 0;
      const valeur = achat ? c.low : c.high;
      // Sans delta taker, le sens vient du corps seul : population hors de la mesure.
      const mesure = f.delta === undefined ? NON_MESURE : achat ? textes.fortAchat : textes.forteVente;
      marqueurs.push({
        idx,
        valeur,
        forme: achat ? "triangleHaut" : "triangleBas",
        couleur: "--accent",
        cible: "prix",
        info:
          `AXIS ${achat ? "fort achat" : "forte vente"} — ${texteFlux(f, oiBougies)} ; sens du ` +
          `${f.delta !== undefined && Math.abs(f.delta) >= SEUIL_DELTA_AXIS ? "delta taker" : "corps de la bougie"} — ${mesure}`,
      });
      if (k >= recents.length - MAX_LABELS_GROS) {
        labels.push({
          idx,
          valeur,
          texte: `${achat ? "Fort achat" : "Forte vente"} ×${(f.rvol ?? 0).toFixed(1)}`,
          couleur: "--accent",
          cible: "prix",
          position: achat ? "dessous" : "dessus",
        });
      }
    });

    return marqueurs.length > 0
      ? { series: { prixSignal, stop }, annotations: { marqueurs, labels } }
      : { series: { prixSignal, stop } };
  },
};
