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
 *   2. le tracé des zones classées par force (`forceZoneForte`, défaut 6 :
 *      touches + rejets sur volume fort), support en `--up`, résistance en
 *      `--down` : toutes les zones fortes actives en bande pleine, d'autant plus
 *      opaque qu'elle est forte, bords en trait plein, étiquette « S fort · n » /
 *      « R forte · n » au bord droit ; les `maxZonesSr` (défaut 4) zones faibles
 *      les plus proches du cours, sans remplissage, bords en pointillé,
 *      étiquette « faible » ; les 12 zones fortes désactivées les plus récentes,
 *      estompées. Une bande part de la confirmation de sa zone et suit ses bornes
 *      connues à chaque clôture ; `maxZonesSr` = 0 ne trace aucune zone ;
 *   3. quatre sorties masquées supplémentaires : `support` et `resistance` à
 *      l'échelle prix (support actif le plus proche ≤ close et résistance active
 *      la plus proche > close à chaque bougie), utilisables dans les alertes,
 *      la fenêtre BT et le screener ; `reactionSupport` et `reactionResistance`
 *      (1 si la bougie close réagit sur une zone forte de ce sens, 0 sinon,
 *      indéfinies sur la bougie en formation), pour les alertes de seuil ;
 *   4. un filtre d'entrée optionnel `margeResistanceAtr` (défaut 0 = mêmes
 *      positions et signaux ▲/▼ qu'AXIS) exigeant que la borne basse de la
 *      résistance active la plus proche laisse au moins
 *      `margeResistanceAtr × ATR 14` d'espace libre au-dessus du close d'achat ;
 *   5. les signaux précoces (`signauxPrecoces`, défaut vrai) : un triangle creux
 *      sur la bougie qui, à sa clôture, entre dans une zone forte connue à la
 *      bougie précédente et clôture au-delà (réarmement par zone après 4
 *      bougies) ; aucun sur une bougie de signal confirmé ; signal non mesuré,
 *      lecture indicative, jamais une promesse.
 *
 * Une zone compte ses touches depuis la première bougie chargée : AXIS S/R
 * déclare une amorce de 3 000 bougies (`AMORCE_AXIS_SR`) ; AXIS garde la sienne
 * (`AMORCE_AXIS`, 1 500), seuil aussi de la mention « amorce courte » des signaux.
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
  TraitAnnotation,
} from "@axiom/types";
import { closeOf, ema, rma, trueRange } from "../utils";
import { MAX_LABELS_SORTIE, enregistrerSpecStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { adxOf } from "../trend/adx";
import {
  ADX_ENTREE_PERIODE,
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
/** Force à partir de laquelle une zone S/R est forte (seuil par défaut). */
export const FORCE_ZONE_FORTE_DEFAUT = 6;
/** Bougies minimales entre deux réactions d'une même zone. */
export const REARMEMENT_REACTION_AXIS = 4;
/** Zones fortes désactivées gardées pour le tracé (les plus récentes). */
export const MAX_ZONES_CASSEES_AXIS = 12;
/** Amorce d'AXIS S/R : les zones comptent leurs touches depuis la première bougie chargée (AXIS reste à `AMORCE_AXIS`). */
export const AMORCE_AXIS_SR = 3000;
/** Opacité de la bande d'une zone forte désactivée, estompée. */
export const ALPHA_ZONE_CASSEE = 0.09;

/** Rôle d'une zone de structure par rapport au cours (« support » ≤ cours, « resistance » > cours). */
export type NatureZoneSrAxis = "support" | "resistance";

/** Zone future de support ou de résistance détectée causalement par `zonesSrAxis`. */
export interface ZoneSrAxis {
  /** Rang de création (0, 1, 2…), unique : la même zone porte le même id quel que soit `fin`. */
  id: number;
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

/** Réaction sur une zone forte, décidée à la clôture de `idx` avec les zones connues après `idx − 1`. */
export interface ReactionZoneSrAxis {
  /** Bougie de décision, ≤ fin. */
  idx: number;
  /** +1 réaction sur support, −1 sur résistance. */
  sens: 1 | -1;
  /** État de la zone après la bougie idx − 1 ; `nature` = rôle par position face à close[idx − 1]. */
  zone: ZoneSrAxis;
}

/** Vie d'une zone pour son tracé : zone active à `fin`, ou zone forte désactivée. */
export interface PisteZoneSrAxis {
  /** Dernier état : à `fin` si active ; au moment de la désactivation sinon (après une éventuelle
   *  fusion de la même bougie). `nature` = rôle par position face à close[`finIdx`]. */
  zone: ZoneSrAxis;
  active: boolean;
  /** Dernière bougie où la zone était active (`fin` si elle l'est encore). */
  finIdx: number;
  /** Bornes connues à la clôture : 1re entrée à `confirmationIdx`, puis une entrée par bougie où elles changent. */
  evolution: Array<{ idx: number; bas: number; haut: number }>;
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
  /** Réactions sur zone forte (conception AXIS S/R, §4.5), par idx croissant. */
  reactions: ReactionZoneSrAxis[];
  /** Zones actives à `fin` (confirmationIdx croissant), puis au plus MAX_ZONES_CASSEES_AXIS zones
   *  fortes au moment de leur désactivation (finIdx décroissant). */
  pistes: PisteZoneSrAxis[];
}

/**
 * Détection strictement causale des futures zones de support et de résistance :
 * un pivot de swing en p = i − g n'est enregistré qu'à la clôture i (une fois les
 * g bougies de droite closes), fusionné avec toute zone active distante de moins de
 * la somme de leurs demi-largeurs (`zoneSrAtr × ATR 14`), pondéré par les rejets sur
 * volume fort (`rvol ≥ seuilRvol`), et inversé une fois de polarité (R↔S) en cas de
 * cassure franche d'une zone renforcée (≥ 2 touches ou rejet sur volume fort ;
 * invalidée sinon). Les bougies > `fin` reportent le dernier support/résistance
 * décidé (anti-repaint).
 *
 * Dans la même passe, sans relancer le moteur : les réactions sur zone forte
 * (`force ≥ forceZoneForte`), décidées à la clôture de i avec les zones telles
 * qu'après la bougie i − 1 et réarmées par zone après `REARMEMENT_REACTION_AXIS`
 * bougies ; les pistes des zones (actives à `fin`, puis les fortes désactivées les
 * plus récentes) avec leurs bornes connues à chaque clôture. PURE.
 */
export function zonesSrAxis(
  candles: Candle[],
  flux: FluxBougie[],
  atr: Array<number | undefined>,
  pivotSr = PIVOT_SR_DEFAUT,
  zoneSrAtr = ZONE_SR_ATR_DEFAUT,
  seuilRvol = 1.5,
  maxZonesSr = MAX_ZONES_SR_DEFAUT,
  fin = candles.length - 2,
  forceZoneForte = FORCE_ZONE_FORTE_DEFAUT
): ResultatSrAxis {
  const n = candles.length;
  const g = Math.max(2, Math.round(pivotSr));
  const kAtr = Math.max(0.1, zoneSrAtr);
  const capZones = Math.max(0, Math.round(maxZonesSr));
  const support: Array<number | undefined> = new Array(n).fill(undefined);
  const resistance: Array<number | undefined> = new Array(n).fill(undefined);
  const supportHaut: Array<number | undefined> = new Array(n).fill(undefined);
  const resistanceBas: Array<number | undefined> = new Array(n).fill(undefined);
  interface ZoneInterne extends ZoneSrAxis {
    active: boolean;
    /** Bornes connues à la clôture : une entrée à la confirmation, puis une par bougie où elles changent. */
    evolution: Array<{ idx: number; bas: number; haut: number }>;
    /** Bougie de la dernière réaction de la zone (réarmement). */
    derniereReaction: number;
  }
  const vivier: ZoneInterne[] = [];
  const reactions: ReactionZoneSrAxis[] = [];
  /** Zones fortes au moment de leur désactivation, dans l'ordre où elles sont désactivées. */
  const cassees: Array<{ z: ZoneInterne; finIdx: number }> = [];

  /** Copie publique d'une zone, sans l'état interne du suivi. */
  const zonePublique = (z: ZoneInterne, nature: NatureZoneSrAxis): ZoneSrAxis => ({
    id: z.id,
    nature,
    niveau: z.niveau,
    bas: z.bas,
    haut: z.haut,
    demiLargeur: z.demiLargeur,
    deIdx: z.deIdx,
    confirmationIdx: z.confirmationIdx,
    dernierIdx: z.dernierIdx,
    touches: z.touches,
    rejetsVolume: z.rejetsVolume,
    inversions: z.inversions,
    force: z.force,
  });
  /** Sortie du vivier pendant la bougie i (cassure ou plafond) : la zone est figée, active jusqu'à i − 1. */
  const desactiver = (z: ZoneInterne, i: number): void => {
    z.active = false;
    if (z.force >= forceZoneForte) cassees.push({ z, finIdx: i - 1 });
  };
  /** Bornes connues à la clôture de i : au plus une entrée par bougie (la dernière fusion remplace). */
  const noterBornes = (z: ZoneInterne, i: number): void => {
    const derniere = z.evolution[z.evolution.length - 1];
    if (derniere?.idx === i) {
      derniere.bas = z.bas;
      derniere.haut = z.haut;
    } else if (derniere?.bas !== z.bas || derniere?.haut !== z.haut) {
      z.evolution.push({ idx: i, bas: z.bas, haut: z.haut });
    }
  };
  // Base de la demi-largeur à chaque bougie : l'ATR 14, à défaut l'amplitude de la bougie (au moins
  // 0,2 % du close). Calculée avant la boucle, dans un tableau de nombres, pour que celle-ci ne lise
  // jamais `atr[p]`, tantôt indéfini, tantôt nombre : JavaScriptCore (Bun, Safari) recompilait alors
  // la passe sans fin, jusqu'à 7 ms au lieu de 0,9 ms.
  const basesAtr = Float64Array.from(candles, (cb: Candle | undefined, k) =>
    atr[k] ?? (cb === undefined ? 0 : Math.max(cb.high - cb.low, cb.close * 0.002))
  );

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

    // Réactions sur zone forte, décidées avec le vivier tel qu'après la bougie i − 1 : avant
    // l'enregistrement du pivot p = i − g et avant les cassures de la bougie i. Rôle par position
    // face à close[i − 1] ; une bougie plate (amplitude nulle) ne réagit jamais.
    const closePrec = i > 0 ? candles[i - 1]?.close : undefined;
    const amplitude = c.high - c.low;
    if (closePrec !== undefined && amplitude > 0) {
      const position = (c.close - c.low) / amplitude;
      for (const z of vivier) {
        if (!z.active || z.force < forceZoneForte || i - z.derniereReaction < REARMEMENT_REACTION_AXIS) continue;
        const surSupport = z.niveau <= closePrec;
        const reagit = surSupport
          ? c.low <= z.haut && c.close > z.haut && position >= 0.5
          : c.high >= z.bas && c.close < z.bas && position <= 0.5;
        if (!reagit) continue;
        z.derniereReaction = i;
        reactions.push({ idx: i, sens: surSupport ? 1 : -1, zone: zonePublique(z, surSupport ? "support" : "resistance") });
      }
    }

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
        const demi = Math.max(cp.close * 0.0005, kAtr * basesAtr[p]!);
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
            noterBornes(proche, i);
          } else {
            vivier.push({
              id: vivier.length,
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
              evolution: [{ idx: i, bas: prixPivot - demi, haut: prixPivot + demi }],
              derniereReaction: -Infinity,
            });
            const actives = vivier.filter((z) => z.active);
            if (actives.length > MAX_POOL_ZONES_AXIS && actives[0] !== undefined) desactiver(actives[0], i);
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
          desactiver(z, i);
        }
      } else if (z.nature === "support" && c.close < z.bas - z.demiLargeur) {
        if (z.inversions === 0 && (z.touches >= 2 || z.rejetsVolume >= 1)) {
          z.nature = "resistance";
          z.inversions = 1;
          z.dernierIdx = i;
          z.force = z.touches + z.rejetsVolume + 0.5;
        } else {
          desactiver(z, i);
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

  // Pistes : zones actives à la dernière bougie décidée, puis les zones fortes désactivées les plus
  // récentes. Une zone désactivée n'évolue plus : son état final est celui de sa désactivation.
  const pistes: PisteZoneSrAxis[] = [];
  const ajouterPiste = (z: ZoneInterne, active: boolean, finIdx: number): void => {
    const ref = candles[finIdx]?.close;
    if (ref === undefined) return;
    pistes.push({ zone: zonePublique(z, z.niveau <= ref ? "support" : "resistance"), active, finIdx, evolution: z.evolution });
  };
  const derniereDecidee = Math.min(fin, n - 1);
  for (const z of vivier) if (z.active) ajouterPiste(z, true, derniereDecidee);
  for (const { z, finIdx } of cassees.slice(-MAX_ZONES_CASSEES_AXIS).reverse()) ajouterPiste(z, false, finIdx);

  const prixRef = candles[fin]?.close;
  if (capZones <= 0 || fin < 2 * g || prixRef === undefined) {
    return { zones: [], support, resistance, supportHaut, resistanceBas, reactions, pistes };
  }
  const actives: ZoneSrAxis[] = vivier
    .filter((z) => z.active)
    .map((z) => zonePublique(z, z.niveau <= prixRef ? "support" : "resistance"));
  const zones = plusProchesParRole(actives, (z) => z, prixRef, capZones);
  return { zones, support, resistance, supportHaut, resistanceBas, reactions, pistes };
}

/**
 * Partage des zones retenues autour du cours : les ⌈cap / 2⌉ supports et les ⌈cap / 2⌉ résistances
 * les plus proches de `prixRef`, complétés par les plus proches restants, puis au plus `cap`
 * éléments rendus par proximité. PURE.
 */
function plusProchesParRole<T>(elements: T[], zoneDe: (e: T) => ZoneSrAxis, prixRef: number, cap: number): T[] {
  const parProximite = (a: T, b: T): number => Math.abs(zoneDe(a).niveau - prixRef) - Math.abs(zoneDe(b).niveau - prixRef);
  const supports = elements.filter((e) => zoneDe(e).nature === "support").sort(parProximite);
  const resistances = elements.filter((e) => zoneDe(e).nature === "resistance").sort(parProximite);
  const demiCap = Math.ceil(cap / 2);
  const retenues = [...supports.slice(0, demiCap), ...resistances.slice(0, demiCap)];
  if (retenues.length < cap) {
    const restants = [...supports.slice(demiCap), ...resistances.slice(demiCap)].sort(parProximite);
    retenues.push(...restants.slice(0, cap - retenues.length));
  }
  return retenues.sort(parProximite).slice(0, cap);
}

const pct = (v: number, decimales: number): string => `${v > 0 ? "+" : ""}${v.toFixed(decimales)} %`;
const prix = (v: number): string => (v >= 1 ? v.toFixed(2) : v.toPrecision(4));
const fleche = (v: number): string => (v > 0 ? "▲" : v < 0 ? "▼" : "–");

const RESERVE_FILTRE = "filtre flux actif : signaux hors du test du 7 octobre 2026, non mesurés — jamais une promesse";
const SANS_REGIME = " ; sans garde-fou de régime (réglage) : signaux de la v2 testée";
const NON_MESURE = "couche flux non mesurée";
const RESERVE_PRECOCE = "signal précoce non mesuré — lecture indicative, jamais une promesse";

/** Opacité de la bande d'une zone forte active (conception §4.4) : croît avec la force, plafonnée. PURE. */
export function alphaZoneForte(force: number): number {
  return Math.min(0.34, 0.14 + 0.012 * Math.min(16, force));
}

/**
 * Zones tracées à la dernière bougie décidée (conception §4.3), à partir des pistes de `zonesSrAxis` :
 * toutes les zones fortes actives (`force ≥ forceZoneForte`) ; les `maxZonesSr` zones faibles
 * actives les plus proches de `prixRef`, avec le partage moitié supports, moitié résistances ; les
 * zones fortes désactivées reçues. Fortes et faibles par proximité au prix, cassées dans l'ordre
 * reçu (les plus récentes d'abord). `maxZonesSr` ≤ 0 : aucune zone. PURE.
 */
export function zonesTraceesAxis(
  pistes: PisteZoneSrAxis[],
  prixRef: number,
  maxZonesSr: number,
  forceZoneForte: number
): { fortes: PisteZoneSrAxis[]; faibles: PisteZoneSrAxis[]; cassees: PisteZoneSrAxis[] } {
  if (!(maxZonesSr > 0)) return { fortes: [], faibles: [], cassees: [] };
  const actives = pistes.filter((p) => p.active);
  const fortes = actives
    .filter((p) => p.zone.force >= forceZoneForte)
    .sort((a, b) => Math.abs(a.zone.niveau - prixRef) - Math.abs(b.zone.niveau - prixRef));
  const faibles = plusProchesParRole(
    actives.filter((p) => p.zone.force < forceZoneForte),
    (p) => p.zone,
    prixRef,
    Math.round(maxZonesSr)
  );
  return { fortes, faibles, cassees: pistes.filter((p) => !p.active) };
}

/**
 * Bornes d'une zone à chaque bougie de `de` à `a` : celles de la dernière entrée d'`evolution`
 * d'idx ≤ cette bougie, c'est-à-dire connues à sa clôture. Une entrée au-delà de `a` (fusion à la
 * bougie qui désactive la zone) n'est jamais lue. PURE.
 */
function bandeZone(evolution: PisteZoneSrAxis["evolution"], de: number, a: number): { hauts: number[]; bas: number[] } {
  const hauts: number[] = [];
  const bas: number[] = [];
  let e = 0;
  for (let k = de; k <= a; k++) {
    while (e + 1 < evolution.length && evolution[e + 1]!.idx <= k) e++;
    const bornes = evolution[e];
    if (bornes === undefined) break;
    hauts.push(bornes.haut);
    bas.push(bornes.bas);
  }
  return { hauts, bas };
}

/** Bords d'une zone active : un segment haut et un segment bas par palier d'`evolution`, le dernier jusqu'à `a`. PURE. */
function bordsZone(evolution: PisteZoneSrAxis["evolution"], a: number, couleur: string, trait: TraitAnnotation): SegmentAnnotation[] {
  return evolution.flatMap((palier, k) => {
    const finPalier = (evolution[k + 1]?.idx ?? a + 1) - 1;
    return [palier.haut, palier.bas].map(
      (v): SegmentAnnotation => ({ deIdx: palier.idx, deValeur: v, aIdx: finPalier, aValeur: v, trait, couleur, cible: "prix" })
    );
  });
}

/** Touches, rejets sur volume fort et inversion d'une zone, avec les accords du texte. */
const decompteZone = (z: ZoneSrAxis): string =>
  `${z.touches} ${z.touches > 1 ? "touches" : "touche"}, ` +
  `${z.rejetsVolume} ${z.rejetsVolume > 1 ? "rejets" : "rejet"} sur volume fort` +
  (z.inversions > 0 ? ", polarité inversée" : "");

/** Infobulle d'une zone tracée (conception §4.7) : force, rôle, bornes, niveau, écart au cours, décompte, profondeur. */
const texteZone = (z: ZoneSrAxis, forte: boolean, prixRef: number, bougies: number): string =>
  `AXIS zone ${forte ? "forte" : "faible"} de ${z.nature === "support" ? "support" : "résistance"} ` +
  `[${prix(z.bas)} – ${prix(z.haut)}] (niveau ${prix(z.niveau)}, ${pct((z.niveau / prixRef - 1) * 100, 2)} du cours) — ` +
  `${decompteZone(z)} — touches comptées sur ${bougies} bougies`;

/**
 * Triangles creux des réactions sur zone forte (conception §4.5, §4.7) : un par bougie et par sens,
 * citant la zone la plus forte, puis la plus proche du close ; aucun sur une bougie de signal
 * confirmé ; les `MAX_SIGNAUX_AXIS` plus récents. PURE.
 */
function trianglesCreuxAxis(candles: Candle[], reactions: ReactionZoneSrAxis[], signaux: Set<number>): MarqueurAnnotation[] {
  const parBougie = new Map<string, ReactionZoneSrAxis>();
  for (const r of reactions) {
    if (signaux.has(r.idx)) continue;
    const cle = `${r.idx}:${r.sens}`;
    const retenue = parBougie.get(cle);
    const close = candles[r.idx]?.close ?? 0;
    const plusPertinente =
      retenue === undefined ||
      r.zone.force > retenue.zone.force ||
      (r.zone.force === retenue.zone.force && Math.abs(r.zone.niveau - close) < Math.abs(retenue.zone.niveau - close));
    if (plusPertinente) parBougie.set(cle, r);
  }
  const marqueurs: MarqueurAnnotation[] = [];
  for (const { idx, sens, zone } of [...parBougie.values()].slice(-MAX_SIGNAUX_AXIS)) {
    const c = candles[idx];
    if (c === undefined) continue;
    const surSupport = sens > 0;
    marqueurs.push({
      idx,
      valeur: surSupport ? c.low : c.high,
      forme: surSupport ? "triangleHaut" : "triangleBas",
      couleur: surSupport ? "--up" : "--down",
      cible: "prix",
      info:
        `AXIS S/R réaction sur ${surSupport ? "support fort" : "résistance forte"} [${prix(zone.bas)} – ${prix(zone.haut)}] — ` +
        `${decompteZone(zone)} ; la bougie est entrée dans la zone et a clôturé ${surSupport ? "au-dessus" : "au-dessous"} ; ` +
        RESERVE_PRECOCE,
      creux: true,
    });
  }
  return marqueurs;
}

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
  forceZoneForte: number;
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
  const forceZoneForte = Number(params.forceZoneForte ?? FORCE_ZONE_FORTE_DEFAUT);
  const sr = zonesSrAxis(
    candles,
    flux,
    atr,
    Number(params.pivotSr ?? PIVOT_SR_DEFAUT),
    Number(params.zoneSrAtr ?? ZONE_SR_ATR_DEFAUT),
    seuilRvol,
    Number(params.maxZonesSr ?? MAX_ZONES_SR_DEFAUT),
    fin,
    forceZoneForte
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
  return { votes, score, flux, atr, sr, margeSr, adx, ref, emaRef, regime, pos, stop, raisons, fin, forceZoneForte };
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
  amorceBougies: AMORCE_AXIS_SR,
  inputs: [
    ...stratAxis.inputs,
    { key: "pivotSr", name: "Pivots S/R (bougies gauche/droite)", type: "number", default: PIVOT_SR_DEFAUT, min: 2, max: 50 },
    { key: "zoneSrAtr", name: "Largeur de zone S/R (× ATR 14)", type: "number", default: ZONE_SR_ATR_DEFAUT, min: 0.1, max: 5 },
    { key: "maxZonesSr", name: "Zones faibles tracées (0 = aucune zone)", type: "number", default: MAX_ZONES_SR_DEFAUT, min: 0, max: 12 },
    { key: "margeResistanceAtr", name: "Marge sous résistance à l'entrée (× ATR 14, 0 = sans)", type: "number", default: 0, min: 0, max: 10 },
    { key: "forceZoneForte", name: "Force d'une zone forte (touches + rejets sur volume fort)", type: "number", default: FORCE_ZONE_FORTE_DEFAUT, min: 2, max: 50 },
    { key: "signauxPrecoces", name: "Signaux précoces sur zone forte (non mesurés)", type: "boolean", default: true },
  ],
  outputs: [
    ...stratAxis.outputs,
    { key: "support", name: "Support actif proche", style: "line", masquee: true },
    { key: "resistance", name: "Résistance active proche", style: "line", masquee: true },
    { key: "reactionSupport", name: "Réaction sur support fort", style: "line", masquee: true },
    { key: "reactionResistance", name: "Réaction sur résistance forte", style: "line", masquee: true },
  ],
  calc(candles, params, ctx) {
    const n = candles.length;
    const { votes, score, flux, atr, sr, margeSr, adx, ref, emaRef, regime, pos, stop, raisons, fin, forceZoneForte } = coeurAxisSr(
      candles,
      params,
      ctx
    );
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

    // Signaux précoces, rangés avant les forts mouvements : l'infobulle du graphe prend les marqueurs
    // proches du réticule dans l'ordre du tableau, sur 3 lignes.
    if (Boolean(params.signauxPrecoces ?? true)) marqueurs.push(...trianglesCreuxAxis(candles, sr.reactions, new Set(signaux)));

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

    // Zones tracées par force (conception §4.3, §4.4) : rubans des fortes, des faibles puis des fortes
    // désactivées ; bords et étiquettes au bord droit pour les actives seulement.
    const rubans: RubanAnnotation[] = [];
    const segments: SegmentAnnotation[] = [];
    const prixRef = candles[fin]?.close;
    if (prixRef !== undefined && prixRef > 0 && score.some((s) => s !== undefined)) {
      const { fortes, faibles, cassees } = zonesTraceesAxis(sr.pistes, prixRef, Number(params.maxZonesSr ?? MAX_ZONES_SR_DEFAUT), forceZoneForte);
      for (const [pistes, forte] of [[fortes, true], [faibles, false]] as const) {
        for (const { zone: z, evolution } of pistes) {
          const surSupport = z.nature === "support";
          const couleur = surSupport ? "--up" : "--down";
          rubans.push({
            deIdx: z.confirmationIdx,
            ...bandeZone(evolution, z.confirmationIdx, n - 1),
            couleur,
            alpha: forte ? alphaZoneForte(z.force) : 0,
            info: texteZone(z, forte, prixRef, n),
          });
          segments.push(...bordsZone(evolution, n - 1, couleur, forte ? "plein" : "pointille"));
          labels.push({
            idx: n - 1,
            valeur: z.niveau,
            texte: forte ? `${surSupport ? "S fort" : "R forte"} · ${z.touches}` : "faible",
            couleur,
            cible: "prix",
            ancrageX: "droite",
          });
        }
      }
      for (const { zone: z, evolution, finIdx } of cassees) {
        rubans.push({
          deIdx: z.confirmationIdx,
          ...bandeZone(evolution, z.confirmationIdx, finIdx),
          couleur: z.nature === "support" ? "--up" : "--down",
          alpha: ALPHA_ZONE_CASSEE,
        });
      }
    }

    // Sorties des alertes (conception §4.6) : 1 si la bougie close porte une réaction de ce sens, 0
    // sinon ; indéfinies sur la bougie en formation. Ni `signauxPrecoces` ni `maxZonesSr` n'y touchent.
    const reactionSupport = Array.from({ length: n }, (_v, i): number | undefined => (i <= fin ? 0 : undefined));
    const reactionResistance = [...reactionSupport];
    for (const r of sr.reactions) (r.sens > 0 ? reactionSupport : reactionResistance)[r.idx] = 1;

    const annotations: AnnotationsIndicateur = {};
    if (marqueurs.length > 0) annotations.marqueurs = marqueurs;
    if (labels.length > 0) annotations.labels = labels;
    if (rubans.length > 0) annotations.rubans = rubans;
    if (segments.length > 0) annotations.segments = segments;
    const series = {
      prixSignal,
      stop,
      etat: pos,
      score,
      support: sr.support,
      resistance: sr.resistance,
      reactionSupport,
      reactionResistance,
    };
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
