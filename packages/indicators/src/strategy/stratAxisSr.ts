/**
 * @axiom/indicators — strategy/stratAxisSr.ts
 *
 * AXIS S/R — variante de la stratégie AXIS (confluence de six votes + couche
 * flux + garde-fou de régime BTC) enrichie de la détection causale et de la
 * projection des FUTURES ZONES DE SUPPORT ET DE RÉSISTANCE (`zonesSrAxis`),
 * ainsi que d'un filtre d'entrée optionnel de marge sous résistance
 * (`margeResistanceAtr`).
 *
 * `stratAxis` (« AXIS ») reste la stratégie originale sans zones S/R, figée sur
 * les campagnes de validation ; `stratAxisSr` (« AXIS S/R ») en partage tous
 * les cœurs purs (`votesAxis`, `fluxAxis`, `forceFlux`, `grosMouvementsAxis`,
 * `positionsStopAxis`, `emaDepuisPremiereDefinie`, `textesAxis`) et y ajoute :
 *   1. la confirmation causale de pivots de swing (`pivotSr` bougies de chaque
 *      côté, défaut 5 : un pivot en p = i − g n'est connu qu'à la clôture i,
 *      zéro repaint), agrégés en zones d'épaisseur adaptative
 *      `± zoneSrAtr × ATR 14` (défaut 0,5), pondérées par le nombre de touches
 *      et de rejets sur volume fort (`rvol ≥ seuilRvol`), avec inversion de
 *      polarité S↔R après cassure franche d'une zone renforcée (≥ 2 touches ou
 *      rejet sur volume fort ; invalidée en cas de seconde cassure) ;
 *   2. la projection sur le chart des `maxZonesSr` (défaut 4) futures zones de
 *      support (`--up`) et de résistance (`--down`) les plus proches du cours
 *      jusqu'au bord droit (`annotations.rubans` + ligne médiane pointillée
 *      `annotations.segments`) ;
 *   3. deux sorties masquées supplémentaires à l'échelle prix, `support` et
 *      `resistance` (support actif le plus proche ≤ close et résistance active
 *      la plus proche > close à chaque bougie), utilisables dans les alertes,
 *      la fenêtre BT et le screener ;
 *   4. un filtre d'entrée optionnel `margeResistanceAtr` (défaut 0 = mêmes
 *      positions et signaux ▲/▼ qu'AXIS) exigeant que la borne basse de la
 *      résistance active la plus proche laisse au moins
 *      `margeResistanceAtr × ATR 14` d'espace libre au-dessus du close d'achat.
 */

import type {
  AnnotationsIndicateur,
  CalcContext,
  Candle,
  IndicatorDef,
  LabelAnnotation,
  MarqueurAnnotation,
  RubanAnnotation,
  SegmentAnnotation,
  Timeframe,
} from "@axiom/types";
import { closeOf, ema, rma, trueRange } from "../utils";
import { MAX_LABELS_SORTIE, enregistrerSpecStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { adxOf } from "../trend/adx";
import {
  ADX_ENTREE_PERIODE,
  AMORCE_AXIS,
  ATR_STOP_PERIODE,
  MAX_GROS_AXIS,
  MAX_LABELS_GROS,
  MAX_RETOURNEMENTS_AXIS,
  MAX_SIGNAUX_AXIS,
  REGIME_TESTE,
  SEUIL_DELTA_AXIS,
  detecterRetournementsAxis,
  emaDepuisPremiereDefinie,
  fluxAxis,
  forceFlux,
  grosMouvementsAxis,
  positionsStopAxis,
  stratAxis,
  texteAmorce,
  textesAxis,
  votesAxis,
  type FluxBougie,
  type RaisonSortieAxis,
} from "./stratAxis";

/** Bougies à gauche et à droite confirmant un pivot de swing pour les zones S/R. */
export const PIVOT_SR_DEFAUT = 5;
/** Demi-épaisseur par défaut d'une zone S/R en multiple de l'ATR 14. */
export const ZONE_SR_ATR_DEFAUT = 0.5;
/** Nombre maximal par défaut de futures zones S/R projetées sur le chart. */
export const MAX_ZONES_SR_DEFAUT = 4;
/** Plafond du vivier interne de zones S/R actives suivies au fil des bougies. */
export const MAX_POOL_ZONES_AXIS = 24;

/** Rôle d'une zone de structure par rapport au cours (« support » ≤ cours, « resistance » > cours). */
export type NatureZoneSrAxis = "support" | "resistance";

/** Zone future de support ou de résistance détectée causalement par `zonesSrAxis`. */
export interface ZoneSrAxis {
  /** Rôle courant face au prix. */
  nature: NatureZoneSrAxis;
  /** Niveau central de la zone (moyenne des pivots fusionnés). */
  niveau: number;
  /** Borne basse de la zone (niveau − demiLargeur). */
  bas: number;
  /** Borne haute de la zone (niveau + demiLargeur). */
  haut: number;
  /** Demi-épaisseur courante de la zone. */
  demiLargeur: number;
  /** Indice de la bougie du premier pivot ayant créé la zone. */
  deIdx: number;
  /** Indice de la bougie où la zone a été confirmée causalement (deIdx + pivotSr). */
  confirmationIdx: number;
  /** Indice de la dernière bougie ayant touché, renforcé ou inversé la zone. */
  dernierIdx: number;
  /** Nombre de pivots confirmés fusionnés dans cette zone (≥ 1). */
  touches: number;
  /** Nombre de pivots de cette zone accompagnés d'un volume fort (rvol ≥ seuilRvol). */
  rejetsVolume: number;
  /** Inversions de polarité S↔R après cassure franche (0 = origine, 1 = inversée). */
  inversions: number;
  /** Score de force structurelle : touches + rejetsVolume + (inversions > 0 ? 0.5 : 0). */
  force: number;
}

/** Sortie du moteur causal de zones de support et de résistance d'AXIS S/R. */
export interface ResultatSrAxis {
  /** Futures zones actives retenues à la borne `fin`, triées par proximité au close[fin]. */
  zones: ZoneSrAxis[];
  /** Niveau du support actif le plus proche (≤ close[i]) à chaque bougie i. */
  support: Array<number | undefined>;
  /** Niveau de la résistance active la plus proche (> close[i]) à chaque bougie i. */
  resistance: Array<number | undefined>;
  /** Borne haute du support actif le plus proche à chaque bougie i. */
  supportHaut: Array<number | undefined>;
  /** Borne basse de la résistance active la plus proche à chaque bougie i. */
  resistanceBas: Array<number | undefined>;
}

/**
 * Détection strictement causale des futures zones de support et de résistance :
 * un pivot de swing en p = i − g n'est enregistré qu'à la clôture i (une fois les
 * g bougies de droite closes), fusionné avec toute zone active distante de moins de
 * la somme de leurs demi-largeurs (`zoneSrAtr × ATR 14`), pondéré par les rejets sur
 * volume fort (`rvol ≥ seuilRvol`), et inversé une fois de polarité (R↔S) en cas de
 * cassure franche d'une zone renforcée (≥ 2 touches ou rejet sur volume fort ;
 * invalidée sinon). Les bougies > `fin` reportent le dernier support/résistance
 * décidé (anti-repaint). PURE.
 */
export function zonesSrAxis(
  candles: Candle[],
  flux: FluxBougie[],
  atr: Array<number | undefined>,
  pivotSr = PIVOT_SR_DEFAUT,
  zoneSrAtr = ZONE_SR_ATR_DEFAUT,
  seuilRvol = 1.5,
  maxZonesSr = MAX_ZONES_SR_DEFAUT,
  fin = candles.length - 2
): ResultatSrAxis {
  const n = candles.length;
  const g = Math.max(2, Math.round(pivotSr));
  const kAtr = Math.max(0.1, zoneSrAtr);
  const capZones = Math.max(0, Math.round(maxZonesSr));
  const support: Array<number | undefined> = new Array(n).fill(undefined);
  const resistance: Array<number | undefined> = new Array(n).fill(undefined);
  const supportHaut: Array<number | undefined> = new Array(n).fill(undefined);
  const resistanceBas: Array<number | undefined> = new Array(n).fill(undefined);
  interface ZoneInterne extends ZoneSrAxis { active: boolean }
  const vivier: ZoneInterne[] = [];

  for (let i = 0; i < n; i++) {
    if (i > fin) {
      if (i > 0) {
        support[i] = support[i - 1];
        resistance[i] = resistance[i - 1];
        supportHaut[i] = supportHaut[i - 1];
        resistanceBas[i] = resistanceBas[i - 1];
      }
      continue;
    }
    const c = candles[i];
    if (c === undefined) continue;
    if (i >= 2 * g) {
      const p = i - g;
      const cp = candles[p];
      if (cp !== undefined) {
        let pHaut = true;
        let pBas = true;
        for (let k = 1; k <= g; k++) {
          const cg = candles[p - k];
          const cd = candles[p + k];
          if (cg === undefined || cd === undefined) {
            pHaut = false;
            pBas = false;
            break;
          }
          if (cg.high >= cp.high || cd.high > cp.high) pHaut = false;
          if (cg.low <= cp.low || cd.low < cp.low) pBas = false;
        }
        const baseAtr = atr[p] ?? Math.max(cp.high - cp.low, cp.close * 0.002);
        const demi = Math.max(cp.close * 0.0005, kAtr * baseAtr);
        const volFort = (flux[p]?.rvol ?? 0) >= seuilRvol ? 1 : 0;
        const enregistrer = (prixPivot: number, nature: NatureZoneSrAxis): void => {
          let proche: ZoneInterne | undefined;
          let distMin = Infinity;
          for (const z of vivier) {
            if (!z.active) continue;
            const d = Math.abs(z.niveau - prixPivot);
            if (d <= z.demiLargeur + demi && d < distMin) {
              proche = z;
              distMin = d;
            }
          }
          if (proche !== undefined) {
            proche.touches += 1;
            proche.rejetsVolume += volFort;
            proche.niveau = (proche.niveau * (proche.touches - 1) + prixPivot) / proche.touches;
            proche.demiLargeur = (proche.demiLargeur * (proche.touches - 1) + demi) / proche.touches;
            proche.bas = proche.niveau - proche.demiLargeur;
            proche.haut = proche.niveau + proche.demiLargeur;
            proche.dernierIdx = i;
            proche.force = proche.touches + proche.rejetsVolume + (proche.inversions > 0 ? 0.5 : 0);
          } else {
            vivier.push({
              nature,
              niveau: prixPivot,
              bas: prixPivot - demi,
              haut: prixPivot + demi,
              demiLargeur: demi,
              deIdx: p,
              confirmationIdx: i,
              dernierIdx: i,
              touches: 1,
              rejetsVolume: volFort,
              inversions: 0,
              force: 1 + volFort,
              active: true,
            });
            const actives = vivier.filter((z) => z.active);
            if (actives.length > MAX_POOL_ZONES_AXIS && actives[0] !== undefined) actives[0].active = false;
          }
        };
        if (pHaut) enregistrer(cp.high, "resistance");
        if (pBas) enregistrer(cp.low, "support");
      }
    }

    for (const z of vivier) {
      if (!z.active || z.confirmationIdx >= i) continue;
      if (z.nature === "resistance" && c.close > z.haut + z.demiLargeur) {
        if (z.inversions === 0 && (z.touches >= 2 || z.rejetsVolume >= 1)) {
          z.nature = "support";
          z.inversions = 1;
          z.dernierIdx = i;
          z.force = z.touches + z.rejetsVolume + 0.5;
        } else {
          z.active = false;
        }
      } else if (z.nature === "support" && c.close < z.bas - z.demiLargeur) {
        if (z.inversions === 0 && (z.touches >= 2 || z.rejetsVolume >= 1)) {
          z.nature = "resistance";
          z.inversions = 1;
          z.dernierIdx = i;
          z.force = z.touches + z.rejetsVolume + 0.5;
        } else {
          z.active = false;
        }
      }
    }

    let supProche: ZoneInterne | undefined;
    let resProche: ZoneInterne | undefined;
    for (const z of vivier) {
      if (!z.active) continue;
      if (z.niveau <= c.close) {
        if (supProche === undefined || c.close - z.niveau < c.close - supProche.niveau) supProche = z;
      } else if (resProche === undefined || z.niveau - c.close < resProche.niveau - c.close) {
        resProche = z;
      }
    }
    if (supProche !== undefined) {
      support[i] = supProche.niveau;
      supportHaut[i] = supProche.haut;
    }
    if (resProche !== undefined) {
      resistance[i] = resProche.niveau;
      resistanceBas[i] = resProche.bas;
    }
  }

  const prixRef = candles[fin]?.close;
  if (capZones <= 0 || fin < 2 * g || prixRef === undefined) {
    return { zones: [], support, resistance, supportHaut, resistanceBas };
  }
  const actives: ZoneSrAxis[] = vivier
    .filter((z) => z.active)
    .map(({ active: _a, ...z }) => ({ ...z, nature: z.niveau <= prixRef ? "support" : "resistance" }));
  const supports = actives.filter((z) => z.nature === "support").sort((a, b) => prixRef - a.niveau - (prixRef - b.niveau));
  const resistances = actives.filter((z) => z.nature === "resistance").sort((a, b) => a.niveau - prixRef - (b.niveau - prixRef));
  const demiCap = Math.ceil(capZones / 2);
  const retenues = [...supports.slice(0, demiCap), ...resistances.slice(0, demiCap)];
  if (retenues.length < capZones) {
    const restants = [...supports.slice(demiCap), ...resistances.slice(demiCap)].sort(
      (a, b) => Math.abs(a.niveau - prixRef) - Math.abs(b.niveau - prixRef)
    );
    retenues.push(...restants.slice(0, capZones - retenues.length));
  }
  const zones = retenues
    .sort((a, b) => Math.abs(a.niveau - prixRef) - Math.abs(b.niveau - prixRef))
    .slice(0, capZones);
  return { zones, support, resistance, supportHaut, resistanceBas };
}

const pct = (v: number, decimales: number): string => `${v > 0 ? "+" : ""}${v.toFixed(decimales)} %`;
const prix = (v: number): string => (v >= 1 ? v.toFixed(2) : v.toPrecision(4));
const fleche = (v: number): string => (v > 0 ? "▲" : v < 0 ? "▼" : "–");

const RESERVE_FILTRE = "filtre flux actif : signaux hors du test du 7 octobre 2026, non mesurés — jamais une promesse";
const SANS_REGIME = " ; sans garde-fou de régime (réglage) : signaux de la v2 testée";
const NON_MESURE = "couche flux non mesurée";

function texteFlux(f: FluxBougie, oiBougies: number): string {
  return [
    f.rvol === undefined ? "volume n.d." : `volume ×${f.rvol.toFixed(1)}`,
    f.delta === undefined ? "delta taker n.d." : `delta taker ${pct(f.delta * 100, 0)}`,
    f.dOi === undefined ? "OI n.d." : `OI ${pct(f.dOi, 1)} sur ${oiBougies} b.`,
  ].join(", ");
}

export const suffixeSr = (margeResistanceAtr: number): string =>
  margeResistanceAtr <= 0
    ? ""
    : ` ; filtre S/R (marge sous résistance ≥ ${margeResistanceAtr} × ATR ${ATR_STOP_PERIODE}) : réglage hors des tests figés — non mesuré`;

export function textesAxisSr(
  u: Timeframe | undefined,
  stopAtr = 0,
  adxEntree = 0,
  regimeBtc = REGIME_TESTE,
  margeResistanceAtr = 0
): { signaux: string; fortAchat: string; forteVente: string; qualification: string } {
  const t = textesAxis(u, stopAtr, adxEntree, regimeBtc);
  return { ...t, signaux: t.signaux + suffixeSr(margeResistanceAtr) };
}

function coeurAxisSr(
  candles: Candle[],
  params: Record<string, number | boolean | string>,
  ctx: CalcContext
): {
  votes: Array<number[] | undefined>;
  score: Array<number | undefined>;
  flux: FluxBougie[];
  atr: Array<number | undefined>;
  sr: ResultatSrAxis;
  margeSr: number;
  adx: Array<number | undefined> | undefined;
  ref: Array<number | undefined> | undefined;
  emaRef: Array<number | undefined> | undefined;
  regime: number;
  pos: Array<number | undefined>;
  stop: Array<number | undefined>;
  raisons: Map<number, RaisonSortieAxis>;
  fin: number;
} {
  const n = candles.length;
  const fin = candles[n - 1]?.closed === true ? n - 1 : n - 2;
  const votes = votesAxis(candles, params);
  const score = votes.map((v) => v?.reduce((a, b) => a + b, 0));
  const closes = closeOf(candles);
  const tendance = ema(closes, Number(params.emaTendance ?? 200));
  const seuilRvol = Number(params.seuilRvol ?? 1.5);
  const seuilOi = Number(params.seuilOi ?? 2);
  const flux = fluxAxis(candles, ctx.aux?.oi, Number(params.rvolPeriode ?? 20), Number(params.oiBougies ?? 6));
  const atr = rma(trueRange(candles), ATR_STOP_PERIODE);
  const sr = zonesSrAxis(
    candles,
    flux,
    atr,
    Number(params.pivotSr ?? PIVOT_SR_DEFAUT),
    Number(params.zoneSrAtr ?? ZONE_SR_ATR_DEFAUT),
    seuilRvol,
    Number(params.maxZonesSr ?? MAX_ZONES_SR_DEFAUT),
    fin
  );
  const force = (i: number, sens: number) => forceFlux(flux[i] ?? {}, sens, seuilRvol, seuilOi);
  const filtre = params.filtreFlux === true;
  const stopAtr = Number(params.stopAtr ?? 0);
  const adxEntree = Number(params.adxEntree ?? 0);
  const margeSr = Number(params.margeResistanceAtr ?? 0);
  const adx = adxEntree > 0 ? adxOf(candles, ADX_ENTREE_PERIODE).adx : undefined;
  const adxSuffisant = (i: number): boolean => adx === undefined || (adx[i] ?? -Infinity) >= adxEntree;
  const regime = Number(params.regimeBtc ?? 0);
  const ref = regime > 0 ? ctx.aux?.refClose : undefined;
  const emaRef = ref === undefined ? undefined : emaDepuisPremiereDefinie(ref, regime);
  const regimeVrai = (i: number): boolean =>
    regime <= 0 || ref?.[i] === undefined || emaRef?.[i] === undefined || ref[i]! > emaRef[i]!;
  const srSuffisant = (i: number): boolean => {
    if (margeSr <= 0) return true;
    const a = atr[i];
    const c = closes[i];
    if (a === undefined || !(a > 0) || c === undefined) return false;
    const rBas = sr.resistanceBas[i];
    return rBas === undefined || rBas - c >= margeSr * a;
  };
  const { pos, stop, raisons } = positionsStopAxis(
    score,
    tendance.map((t, i) => (t === undefined ? undefined : (closes[i] ?? t) > t && (!filtre || force(i, 1).fort) && adxSuffisant(i) && regimeVrai(i) && srSuffisant(i))),
    closes,
    atr,
    Number(params.seuil ?? 5),
    Number(params.seuilVente ?? 4),
    fin,
    stopAtr
  );
  return { votes, score, flux, atr, sr, margeSr, adx, ref, emaRef, regime, pos, stop, raisons, fin };
}

/** Série d'états d'AXIS S/R pour le rejeu commun (`etatsStrategie("stratAxisSr")`). PURE. */
export function positionAxisSr(
  candles: Candle[],
  params: Record<string, number | boolean | string>,
  ctx: CalcContext
): Array<EtatStrategie | undefined> {
  return coeurAxisSr(candles, params, ctx).pos as Array<EtatStrategie | undefined>;
}

export const stratAxisSr: IndicatorDef = {
  id: "stratAxisSr",
  name: "AXIS S/R",
  category: "strategy",
  pane: "overlay",
  auxFacultatives: ["oi", "refClose"],
  amorceBougies: AMORCE_AXIS,
  inputs: [
    ...stratAxis.inputs,
    { key: "pivotSr", name: "Pivots S/R (bougies gauche/droite)", type: "number", default: PIVOT_SR_DEFAUT, min: 2, max: 50 },
    { key: "zoneSrAtr", name: "Largeur de zone S/R (× ATR 14)", type: "number", default: ZONE_SR_ATR_DEFAUT, min: 0.1, max: 5 },
    { key: "maxZonesSr", name: "Zones S/R futures tracées (0 = sans)", type: "number", default: MAX_ZONES_SR_DEFAUT, min: 0, max: 12 },
    { key: "margeResistanceAtr", name: "Marge sous résistance à l'entrée (× ATR 14, 0 = sans)", type: "number", default: 0, min: 0, max: 10 },
  ],
  outputs: [
    ...stratAxis.outputs,
    { key: "support", name: "Support actif proche", style: "line", masquee: true },
    { key: "resistance", name: "Résistance active proche", style: "line", masquee: true },
  ],
  calc(candles, params, ctx) {
    const n = candles.length;
    const { votes, score, flux, atr, sr, margeSr, adx, ref, emaRef, regime, pos, stop, raisons, fin } = coeurAxisSr(candles, params, ctx);
    const seuilRvol = Number(params.seuilRvol ?? 1.5);
    const seuilOi = Number(params.seuilOi ?? 2);
    const oiBougies = Number(params.oiBougies ?? 6);
    const force = (i: number, sens: number) => forceFlux(flux[i] ?? {}, sens, seuilRvol, seuilOi);
    const filtre = params.filtreFlux === true;
    const stopAtr = Number(params.stopAtr ?? 0);
    const adxEntree = Number(params.adxEntree ?? 0);

    const prixSignal: Array<number | undefined> = new Array(n).fill(undefined);
    const signaux: number[] = [];
    for (let i = 1; i < n; i++) {
      const p = pos[i - 1];
      if (p !== undefined && pos[i] !== p) signaux.push(i);
      if (pos[i] === 1) prixSignal[i] = p === 1 ? prixSignal[i - 1] : candles[i]?.close;
    }

    const noms = [`EMA ${params.emaRapide}/${params.emaLente}`, "Supertrend", "DMI", "MACD", "RSI", "CMF"];
    const textes = textesAxisSr(ctx.timeframe, stopAtr, adxEntree, regime, margeSr);
    const baseLen = textesAxis(ctx.timeframe, 0, 0, 0).signaux.length - SANS_REGIME.length;
    const reserve = filtre ? RESERVE_FILTRE + textes.signaux.slice(baseLen) : textes.signaux;
    const amorce = texteAmorce(n);
    const marqueurs: MarqueurAnnotation[] = [];
    const labels: LabelAnnotation[] = [];

    signaux.slice(-MAX_SIGNAUX_AXIS).forEach((idx, k, recents) => {
      const b = candles[idx];
      const v = votes[idx];
      const s = score[idx];
      const prixAchat = prixSignal[idx - 1];
      if (b === undefined || v === undefined || s === undefined) return;
      const achat = pos[idx] === 1;
      const couleur = achat ? "--up" : "--down";
      const valeur = achat ? b.low : b.high;
      const resultat = pct(prixAchat === undefined ? 0 : (b.close / prixAchat - 1) * 100, 2);
      const fo = force(idx, achat ? 1 : -1);
      const qualite = fo.dispo === 0 ? "indisponible" : fo.fort ? "fort" : fo.contre ? "à contre-sens" : "ordinaire";
      const parStop = !achat && raisons.get(idx) === "stop";
      const fort = fo.fort ? (achat || parStop ? " fort" : " forte") : "";
      const niveau = stop[idx - 1];
      const sortie = parStop
        ? `close sous le stop suiveur (${niveau === undefined ? "n.d." : prix(niveau)}) ; ${resultat} depuis l'achat (hors frais)`
        : `${resultat} depuis l'achat (hors frais)`;
      const mentionSr =
        margeSr > 0
          ? sr.resistance[idx] !== undefined && sr.resistanceBas[idx] !== undefined && atr[idx] !== undefined && atr[idx]! > 0
            ? `, résistance ${prix(sr.resistance[idx]!)} à ${((sr.resistanceBas[idx]! - b.close) / atr[idx]!).toFixed(1)} × ATR ≥ ${margeSr}`
            : `, aucune résistance active au-dessus (marge ≥ ${margeSr} × ATR)`
          : "";
      const entree =
        `close au-dessus de l'EMA ${params.emaTendance}` +
        (adx === undefined ? "" : `, ADX ${ADX_ENTREE_PERIODE} ${(adx[idx] ?? 0).toFixed(1)} ≥ ${adxEntree}`) +
        (regime > 0
          ? ref?.[idx] !== undefined && emaRef?.[idx] !== undefined
            ? `, référence ${prix(ref[idx]!)} > EMA ${regime} ${prix(emaRef[idx]!)}`
            : ", garde-fou de régime non appliqué (référence indisponible)"
          : "") +
        mentionSr;
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

    const gros = grosMouvementsAxis(candles, flux, Number(params.seuilGros ?? 3), new Set(signaux), fin);
    gros.slice(-MAX_GROS_AXIS).forEach(({ idx, sens }, k, recents) => {
      const f = flux[idx] ?? {};
      const c = candles[idx] as Candle;
      const achat = sens > 0;
      const valeur = achat ? c.low : c.high;
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

    if (Boolean(params.detecterRetournements)) {
      const exclus = new Set(signaux);
      detecterRetournementsAxis(candles, params, ctx)
        .filter((r) => !exclus.has(r.idx))
        .slice(-MAX_RETOURNEMENTS_AXIS)
        .forEach((r, k, recents) => {
          const c = candles[r.idx] as Candle;
          const achat = r.sens === "achat";
          const valeur = achat ? c.low : c.high;
          const couleur = achat ? "--up" : "--down";
          marqueurs.push({
            idx: r.idx,
            valeur,
            forme: achat ? "triangleHaut" : "triangleBas",
            couleur,
            cible: "prix",
            info:
              `AXIS ${r.resume} · entrée ${r.prixEntree.toFixed(2)} · invalidation ${r.stopInvalidation.toFixed(2)} · ` +
              `cible 1R ${r.cible1R.toFixed(2)} / 2R ${r.cible2R.toFixed(2)}`,
          });
          if (k >= recents.length - MAX_LABELS_SORTIE) {
            labels.push({
              idx: r.idx,
              valeur,
              texte: `${achat ? "↺ Achat" : "↺ Vente"} ${r.scoreConfiance}%`,
              couleur,
              cible: "prix",
              position: achat ? "dessous" : "dessus",
            });
          }
        });
    }

    const rubans: RubanAnnotation[] = [];
    const segments: SegmentAnnotation[] = [];
    const prixRef = candles[fin]?.close;
    if (prixRef !== undefined && prixRef > 0 && score.some((s) => s !== undefined)) {
      for (const z of sr.zones) {
        const longueur = n - z.deIdx;
        if (longueur < 2) continue;
        const estSup = z.nature === "support";
        const couleur = estSup ? "--up" : "--down";
        const ecart = (z.niveau / prixRef - 1) * 100;
        const info =
          `AXIS zone de ${estSup ? "support" : "résistance"} future [${prix(z.bas)} – ${prix(z.haut)}] ` +
          `(niveau ${prix(z.niveau)}, ${pct(ecart, 2)} du cours) — ` +
          `${z.touches} ${z.touches > 1 ? "touches" : "touche"}, ` +
          `${z.rejetsVolume} ${z.rejetsVolume > 1 ? "rejets" : "rejet"} sur volume fort` +
          (z.inversions > 0 ? ", polarité inversée" : "");
        rubans.push({
          deIdx: z.deIdx,
          hauts: new Array<number>(longueur).fill(z.haut),
          bas: new Array<number>(longueur).fill(z.bas),
          couleur,
          alpha: Math.min(0.22, 0.1 + 0.03 * Math.min(4, z.touches + z.rejetsVolume)),
          info,
        });
        segments.push({
          deIdx: z.deIdx,
          deValeur: z.niveau,
          aIdx: n - 1,
          aValeur: z.niveau,
          trait: "pointille",
          couleur,
          cible: "prix",
        });
      }
    }

    const annotations: AnnotationsIndicateur = {};
    if (marqueurs.length > 0) annotations.marqueurs = marqueurs;
    if (labels.length > 0) annotations.labels = labels;
    if (rubans.length > 0) annotations.rubans = rubans;
    if (segments.length > 0) annotations.segments = segments;
    const series = { prixSignal, stop, etat: pos, score, support: sr.support, resistance: sr.resistance };
    return Object.keys(annotations).length > 0 ? { series, annotations } : { series };
  },
};

enregistrerSpecStrategie({
  id: "stratAxisSr",
  name: "AXIS S/R",
  inputsStrategie: stratAxisSr.inputs,
  position: positionAxisSr,
  libelles: () => ({
    long: "AXIS S/R : confluence ≥ seuil, close > EMA de tendance et marge sous résistance suffisante",
    short: "AXIS S/R ne vend jamais à découvert",
    sortie: "AXIS S/R : score ≤ −seuil de vente (ou stop suiveur si réglé)",
  }),
});
