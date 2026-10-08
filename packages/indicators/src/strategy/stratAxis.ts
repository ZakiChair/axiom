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
 * 2026 : le test ne couvre que le 4h, ni la couche flux, l'infobulle le
 * rappelle. Mesure passée, jamais une promesse.
 */

import type { Candle, IndicatorDef, LabelAnnotation, MarqueurAnnotation } from "@axiom/types";
import { closeOf, ema, sma, volOf } from "../utils";
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

export const stratAxis: IndicatorDef = {
  id: "stratAxis",
  name: "AXIS",
  category: "strategy",
  pane: "overlay",
  // Facultative : sans OI (symbole hors perp USDT, fetch en échec), la couche flux lit
  // volume et delta seuls ; les signaux du cœur ne dépendent de rien d'auxiliaire.
  auxFacultatives: ["oi"],
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
  ],
  outputs: [{ key: "prixSignal", name: "Prix d'achat", style: "line" }],
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
    const pos = positionsAxis(
      score,
      tendance.map((t, i) => (t === undefined ? undefined : (closes[i] ?? t) > t && (!filtre || force(i, 1).fort))),
      Number(params.seuil ?? 5),
      Number(params.seuilVente ?? 4),
      n - 2
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
    const reserve = filtre ? RESERVE_FILTRE : RESERVE;
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
      const fort = fo.fort ? (achat ? " fort" : " forte") : "";
      marqueurs.push({
        idx,
        valeur,
        forme: achat ? "triangleHaut" : "triangleBas",
        couleur,
        cible: "prix",
        info:
          `AXIS ${achat ? "achat" : "vente"}${fort} — score ${achat ? "+" : ""}${s}/6 : ` +
          `${noms.map((nom, w) => `${nom} ${fleche(v[w] ?? 0)}`).join(", ")} ; ` +
          `${achat ? `close au-dessus de l'EMA ${params.emaTendance}` : `${resultat} depuis l'achat (hors frais)`} ; ` +
          `flux ${qualite} (${texteFlux(flux[idx] ?? {}, oiBougies)} ; ${QUALIFICATION}) — ${reserve}`,
      });
      if (k >= recents.length - MAX_LABELS_SORTIE) {
        labels.push({
          idx,
          valeur,
          texte: achat ? `Achat${fort}` : `Vente${fort} ${resultat}`,
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
      const mesure = f.delta === undefined ? NON_MESURE : achat ? MESURE_FORT_ACHAT : MESURE_FORTE_VENTE;
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
      ? { series: { prixSignal }, annotations: { marqueurs, labels } }
      : { series: { prixSignal } };
  },
};
