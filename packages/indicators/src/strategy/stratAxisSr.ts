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
 * `positionsStopAxis`, `emaDepuisPremiereDefinie`, `textesAxis`) et, depuis le
 * 11 novembre 2026, le rendu des signaux confirmés et des retournements ↺
 * (`signauxAxis`, `retournementsAxis` : une seule copie), et y ajoute :
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
 *      « R forte · n » au bord droit, suivie, pour le support fort et la résistance
 *      forte les plus proches (par leur bord), d'une seconde ligne : l'écart en % de
 *      la dernière clôture décidée à ce bord, ou « dans la zone » (demande du
 *      11 novembre 2026) ; les `maxZonesSr` (défaut 4) zones faibles
 *      les plus proches du cours, sans remplissage, bords en pointillé,
 *      étiquette « faible » ; les 12 zones désactivées les plus récentes qui
 *      étaient fortes à leur dernière bougie active, estompées. Une bande part de
 *      la confirmation de sa zone et suit ses bornes connues à chaque clôture ;
 *      `maxZonesSr` = 0 ne trace aucune zone ;
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
 *      lecture indicative, jamais une promesse. Sous le même réglage, depuis le
 *      11 novembre 2026, le pré-signal (`preSignalAxisSr`) : quand, à plat à la
 *      dernière bougie décidée, tout est réuni pour acheter sauf la clôture
 *      au-dessus de l'EMA de tendance, un court segment pointillé gris au niveau
 *      de cette EMA et une étiquette « pré-signal » au bord droit ; non mesuré,
 *      conditionnel (la bougie suivante n'achète que si elle clôture au-dessus et
 *      si le score et les filtres tiennent), sans effet sur aucune série.
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
import { enregistrerSpecStrategie, type EtatStrategie } from "../utils-fabrique-strategie";
import { adxOf } from "../trend/adx";
import {
  ADX_ENTREE_PERIODE,
  ATR_STOP_PERIODE,
  MAX_GROS_AXIS,
  MAX_LABELS_GROS,
  MAX_SIGNAUX_AXIS,
  REGIME_TESTE,
  RESERVE_PRECOCE,
  SEUIL_DELTA_AXIS,
  emaDepuisPremiereDefinie,
  fluxAxis,
  forceFlux,
  grosMouvementsAxis,
  positionsStopAxis,
  retournementsAxis,
  signauxAxis,
  stratAxis,
  textesAxis,
  votesAxis,
  type FluxBougie,
  type RaisonSortieAxis,
} from "./stratAxis";

/** Bougies à gauche et à droite confirmant un pivot de swing pour les zones S/R. */
export const PIVOT_SR_DEFAUT = 5;
/** Demi-épaisseur par défaut d'une zone S/R en multiple de l'ATR 14. */
export const ZONE_SR_ATR_DEFAUT = 0.5;
/** Nombre par défaut de zones faibles tracées (les plus proches du cours, partage moitié supports / moitié résistances). */
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
/** Longueur du segment du pré-signal, en bougies avant la dernière : court, pour ne pas se lire comme un bord de zone. */
export const BOUGIES_PRE_SIGNAL_AXIS = 6;

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
  /**
   * Indice de la bougie de confirmation du dernier pivot fusionné dans la zone, ou de son inversion si elle est
   * plus récente. Une réaction ou une simple mèche dans la bande ne le met pas à jour.
   */
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

/**
 * Vie d'une zone pour son tracé : zone active à `fin`, ou zone forte cassée, c'est-à-dire désactivée et forte à la
 * clôture de sa dernière bougie active (`finIdx`), avant les fusions de la bougie qui la casse : une zone faible
 * pendant toute sa vie visible n'en est pas une, même si une fusion de cette bougie l'a renforcée.
 */
export interface PisteZoneSrAxis {
  /** Dernier état : à `fin` si active ; au moment de la désactivation sinon (après une éventuelle
   *  fusion de la même bougie). `nature` = rôle par position face à close[`finIdx`]. */
  zone: ZoneSrAxis;
  active: boolean;
  /** Dernière bougie où la zone était active (`fin` si elle l'est encore). */
  finIdx: number;
  /** Bornes connues à la clôture : 1re entrée à `confirmationIdx`, puis une entrée par bougie où elles changent. Une
   *  piste désactivée peut finir par une entrée à `finIdx + 1` (fusion pendant la bougie qui la casse), que le tracé
   *  ignore : sa bande s'arrête à `finIdx`. */
  evolution: Array<{ idx: number; bas: number; haut: number }>;
}

/** Sortie du moteur causal de zones de support et de résistance d'AXIS S/R. */
export interface ResultatSrAxis {
  /** Sélection historique : les `maxZonesSr` zones actives à `fin` les plus proches de close[fin] (partage moitié
   *  supports, moitié résistances), triées par proximité. Gardée pour la compatibilité et les tests ; le tracé ne
   *  l'utilise pas (il lit `pistes`). */
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
  /** Zones actives à `fin` (confirmationIdx croissant), puis au plus MAX_ZONES_CASSEES_AXIS zones fortes cassées, fortes
   *  à la clôture de leur `finIdx`, avant les fusions de la bougie qui les casse (finIdx décroissant). */
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
 * bougies ; les pistes des zones (actives à `fin`, puis les plus récentes des
 * zones désactivées qui étaient fortes à la clôture de leur dernière bougie active)
 * avec leurs bornes connues à chaque clôture. PURE.
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
    /** Force connue à la clôture de la dernière bougie traitée : pendant la bougie i, celle de i − 1 (cassées). */
    forceCloture: number;
  }
  const vivier: ZoneInterne[] = [];
  const reactions: ReactionZoneSrAxis[] = [];
  /** Zones désactivées qui étaient fortes à leur dernière bougie active, dans l'ordre où elles sont désactivées. */
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
  /**
   * Sortie du vivier pendant la bougie i (cassure ou plafond) : la zone est figée, active jusqu'à i − 1. Elle entre
   * dans les cassées si elle était forte à la clôture de i − 1, même si une fusion de la bougie i l'a renforcée depuis.
   */
  const desactiver = (z: ZoneInterne, i: number): void => {
    z.active = false;
    if (z.forceCloture >= forceZoneForte) cassees.push({ z, finIdx: i - 1 });
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
              forceCloture: -Infinity, // inexistante à la clôture de i − 1 : jamais cassée à sa bougie de confirmation
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

    // État connu à la clôture de i : support et résistance actifs les plus proches, et force de chaque zone active
    // (lue si la zone est désactivée pendant la bougie i + 1), relevée ici pour ne pas parcourir le vivier une fois de plus.
    let supProche: ZoneInterne | undefined;
    let resProche: ZoneInterne | undefined;
    for (const z of vivier) {
      if (!z.active) continue;
      z.forceCloture = z.force;
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
/** Écart du cours au bord d'une zone : une décimale, deux sous 0,1 %, pour ne pas écrire « +0.0 % » hors de la zone. */
const pctBord = (e: number): string => pct(e, Math.abs(e) < 0.1 ? 2 : 1);
const prix = (v: number): string => (v >= 1 ? v.toFixed(2) : v.toPrecision(4));

const NON_MESURE = "couche flux non mesurée";

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

/** Compte accordé : « 1 touche », « 2 touches ». */
const compte = (k: number, nom: string): string => `${k} ${nom}${k > 1 ? "s" : ""}`;
/** Rejets sur volume fort et inversion d'une zone. */
const rejetsZone = (z: ZoneSrAxis): string =>
  `${compte(z.rejetsVolume, "rejet")} sur volume fort` + (z.inversions > 0 ? ", polarité inversée" : "");
/** Touches, rejets sur volume fort et inversion d'une zone, avec les accords du texte. */
const decompteZone = (z: ZoneSrAxis): string => `${compte(z.touches, "touche")}, ${rejetsZone(z)}`;

/**
 * Écart signé, en % de `prixRef`, du bord d'une zone tourné vers le cours : borne haute d'un support
 * (négatif), borne basse d'une résistance (positif). `undefined` quand le cours est dans la zone. PURE.
 */
export function ecartBordZone(z: ZoneSrAxis, prixRef: number): number | undefined {
  const support = z.nature === "support";
  const e = ((support ? z.haut : z.bas) / prixRef - 1) * 100;
  return (support ? e < 0 : e > 0) ? e : undefined;
}

/**
 * Support fort et résistance forte les plus proches du cours, la proximité mesurée au BORD de la zone
 * (`ecartBordZone`, nulle quand le cours est dedans) et non à son niveau : une zone large peut être la
 * première touchée. Au plus une piste par rôle, la première de `fortes` à égalité. PURE.
 */
export function fortesProchesAxis(fortes: PisteZoneSrAxis[], prixRef: number): PisteZoneSrAxis[] {
  const distance = (p: PisteZoneSrAxis): number => Math.abs(ecartBordZone(p.zone, prixRef) ?? 0);
  const proches: Partial<Record<NatureZoneSrAxis, PisteZoneSrAxis>> = {};
  for (const p of fortes) {
    const retenue = proches[p.zone.nature];
    if (retenue === undefined || distance(p) < distance(retenue)) proches[p.zone.nature] = p;
  }
  return Object.values(proches);
}

/**
 * Infobulle d'une zone tracée. L'essentiel tient en tête, dans les 55 caractères qu'un téléphone affiche :
 * rôle, forte ou faible, touches, écart du cours au bord de la zone. Suit le détail (bornes, niveau et son
 * écart, rejets, inversion, profondeur), puis l'âge, compté jusqu'à la dernière bougie décidée `fin`, de
 * `dernierIdx` : la confirmation du dernier pivot fusionné, ou l'inversion si elle est plus récente, jamais une
 * « touche ». Une zone forte dit aussi l'âge de sa dernière réaction (`reaction`), que `dernierIdx` ne suit pas ;
 * le moteur n'en relève pas pour une zone faible. Des décomptes, aucun taux de réussite.
 */
const texteZone = (z: ZoneSrAxis, forte: boolean, prixRef: number, bougies: number, fin: number, reaction: number | undefined): string => {
  const support = z.nature === "support";
  const ecart = ecartBordZone(z, prixRef);
  return (
    `AXIS ${support ? "support" : "résistance"} ${forte ? (support ? "fort" : "forte") : "faible"} · ${compte(z.touches, "touche")} · ` +
    `${ecart === undefined ? "dans la zone" : `bord à ${pctBord(ecart)}`} — ` +
    `[${prix(z.bas)} – ${prix(z.haut)}] (niveau ${prix(z.niveau)}, ${pct((z.niveau / prixRef - 1) * 100, 2)} du cours) — ` +
    `${rejetsZone(z)} — touches comptées sur ${bougies} bougies — ` +
    `dernier pivot confirmé${z.inversions > 0 ? " ou inversion" : ""} il y a ${compte(fin - z.dernierIdx, "bougie")}` +
    (forte ? ` ; ${reaction === undefined ? "aucune réaction" : `dernière réaction il y a ${compte(fin - reaction, "bougie")}`}` : "")
  );
};

/**
 * Triangles creux des réactions sur zone forte (conception §4.5, §4.7) : un par bougie et par sens,
 * citant la zone la plus forte, puis la plus proche du close ; aucun sur une bougie de signal
 * confirmé ; les `MAX_SIGNAUX_AXIS` plus récents. La réserve ouvre le texte : l'infobulle du graphe
 * coupe une ligne trop longue au bord du pane (au téléphone vers le 55e caractère), jamais son début. PURE.
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
        `AXIS S/R ${RESERVE_PRECOCE} — réaction sur ${surSupport ? "support fort" : "résistance forte"} ` +
        `[${prix(zone.bas)} – ${prix(zone.haut)}] — ${decompteZone(zone)} ; ` +
        `la bougie est entrée dans la zone et a clôturé ${surSupport ? "au-dessus" : "au-dessous"}`,
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
  /** Niveau du pré-signal à la bougie i (voir `preSignalAxisSr`), `undefined` hors du cas. */
  preSignal: (i: number) => number | undefined;
  /** Vrai si l'achat lit une autre condition que le score et l'EMA de tendance (flux, ADX, régime servi, marge S/R). */
  filtres: boolean;
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
  // Seuil lu par le moteur et par le tracé : seul un nombre fini est gardé, comme dans `resolveParams` ; tout autre
  // réglage (NaN, ±Infinity, texte, booléen) se replie sur le défaut. `Number("")`, `Number(" ")` et `Number(false)`
  // valent 0, `Number(true)` 1 : convertis, ils rendraient toutes les zones fortes.
  const forceLue = params.forceZoneForte;
  const forceZoneForte = typeof forceLue === "number" && Number.isFinite(forceLue) ? forceLue : FORCE_ZONE_FORTE_DEFAUT;
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
  // Conditions d'achat autres que le score et la clôture au-dessus de l'EMA de tendance.
  const autres = (i: number): boolean => (!filtre || force(i, 1).fort) && adxSuffisant(i) && regimeVrai(i) && srSuffisant(i);
  const seuil = Number(params.seuil ?? 5);
  const { pos, stop, raisons } = positionsStopAxis(
    score,
    tendance.map((t, i) => (t === undefined ? undefined : (closes[i] ?? t) > t && autres(i))),
    closes,
    atr,
    seuil,
    Number(params.seuilVente ?? 4),
    fin,
    stopAtr
  );
  // Pré-signal : à plat à la clôture décidée de i, tout est réuni pour acheter sauf le close, resté sous (ou sur)
  // l'EMA de tendance. La condition d'achat y étant fausse, l'armement est acquis pour i + 1 — sauf à la bougie d'une
  // sortie par stop, qui ne l'évalue pas et exige qu'elle redevienne fausse : elle est écartée.
  const preSignal = (i: number): number | undefined => {
    const t = tendance[i];
    const c = closes[i];
    return i <= fin && pos[i] === 0 && raisons.get(i) !== "stop" && (score[i] ?? -Infinity) >= seuil && t !== undefined && c !== undefined && c <= t && autres(i)
      ? t
      : undefined;
  };
  const filtres = filtre || adx !== undefined || ref !== undefined || margeSr > 0;
  return { votes, score, flux, atr, sr, margeSr, adx, ref, emaRef, regime, pos, stop, raisons, fin, forceZoneForte, preSignal, filtres };
}

/**
 * Pré-signal d'achat d'AXIS S/R (demande du 11 novembre 2026), par bougie : le niveau à franchir quand, à plat à
 * la clôture de la bougie i, toutes les conditions d'achat sont réunies SAUF « clôture au-dessus de l'EMA de
 * tendance » ; `undefined` sinon, et toujours sur la bougie en formation. Le niveau est la valeur de cette EMA à
 * la bougie i : l'EMA étant récursive, la bougie i + 1 clôture au-dessus de son EMA si et seulement si elle
 * clôture au-dessus de ce niveau ; elle achète alors, pourvu que le score et les autres conditions tiennent encore
 * à sa clôture. Un seul cas, exact ; non mesuré. Causal : la valeur à i ne lit aucune bougie plus récente. PURE.
 */
export function preSignalAxisSr(
  candles: Candle[],
  params: Record<string, number | boolean | string>,
  ctx: CalcContext
): Array<number | undefined> {
  const { preSignal } = coeurAxisSr(candles, params, ctx);
  return candles.map((_c, i) => preSignal(i));
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
    const coeur = coeurAxisSr(candles, params, ctx);
    const { score, flux, atr, sr, margeSr, pos, stop, fin, forceZoneForte, preSignal, filtres } = coeur;
    const oiBougies = Number(params.oiBougies ?? 6);
    // Signaux confirmés : le rendu d'AXIS, complété de la mention de résistance à l'entrée et du suffixe du filtre S/R.
    const { prixSignal, signaux, marqueurs, labels, textes } = signauxAxis(
      candles,
      params,
      ctx,
      coeur,
      (idx, close) =>
        margeSr > 0
          ? sr.resistance[idx] !== undefined && sr.resistanceBas[idx] !== undefined && atr[idx] !== undefined && atr[idx]! > 0
            ? `, résistance ${prix(sr.resistance[idx]!)} à ${((sr.resistanceBas[idx]! - close) / atr[idx]!).toFixed(1)} × ATR ≥ ${margeSr}`
            : `, aucune résistance active au-dessus (marge ≥ ${margeSr} × ATR)`
          : "",
      suffixeSr(margeSr)
    );

    // Signaux précoces (seul le booléen faux les masque), rangés avant les forts mouvements : l'infobulle du
    // graphe prend les marqueurs proches du réticule dans l'ordre du tableau, sur 3 lignes.
    if (params.signauxPrecoces !== false) marqueurs.push(...trianglesCreuxAxis(candles, sr.reactions, new Set(signaux)));

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

    // Retournements ↺ : le rendu d'AXIS.
    retournementsAxis(candles, params, ctx, signaux, marqueurs, labels);

    // Zones tracées par force (conception §4.3, §4.4) : rubans des fortes, des faibles puis des fortes
    // désactivées ; bords et étiquettes au bord droit pour les actives seulement.
    const rubans: RubanAnnotation[] = [];
    const segments: SegmentAnnotation[] = [];
    const prixRef = candles[fin]?.close;
    if (prixRef !== undefined && prixRef > 0 && score.some((s) => s !== undefined)) {
      const { fortes, faibles, cassees } = zonesTraceesAxis(sr.pistes, prixRef, Number(params.maxZonesSr ?? MAX_ZONES_SR_DEFAUT), forceZoneForte);
      // Dernière réaction de chaque zone : les réactions du moteur sont rangées par idx croissant.
      const derniereReaction = new Map<number, number>();
      for (const r of sr.reactions) derniereReaction.set(r.zone.id, r.idx);
      const proches = fortesProchesAxis(fortes, prixRef);
      for (const [pistes, forte] of [[fortes, true], [faibles, false]] as const) {
        for (const piste of pistes) {
          const { zone: z, evolution } = piste;
          const surSupport = z.nature === "support";
          const couleur = surSupport ? "--up" : "--down";
          const etiquette = (texte: string): LabelAnnotation => ({ idx: n - 1, valeur: z.niveau, texte, couleur, cible: "prix", ancrageX: "droite" });
          rubans.push({
            deIdx: z.confirmationIdx,
            ...bandeZone(evolution, z.confirmationIdx, n - 1),
            couleur,
            alpha: forte ? alphaZoneForte(z.force) : 0,
            info: texteZone(z, forte, prixRef, n, fin, derniereReaction.get(z.id)),
          });
          segments.push(...bordsZone(evolution, n - 1, couleur, forte ? "plein" : "pointille"));
          labels.push(etiquette(forte ? `${surSupport ? "S fort" : "R forte"} · ${z.touches}` : "faible"));
          // Seconde ligne, sous l'étiquette du support fort et de la résistance forte les plus proches : l'écart du
          // cours au bord de la zone, lisible au téléphone sans infobulle. Même valeur que l'étiquette : le rendu la
          // pose 11 px dessous. L'écart est celui de la dernière clôture décidée (`prixRef` = close[fin]) : la bougie
          // en formation n'est pas lue, il peut donc dater d'une bougie entière pendant l'approche. Douze caractères
          // au plus, la marge droite du graphe fait 80 px.
          if (proches.includes(piste)) {
            const ecart = ecartBordZone(z, prixRef);
            labels.push(etiquette(ecart === undefined ? "dans la zone" : pctBord(ecart)));
          }
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

    // Pré-signal (demande du 11 novembre 2026), sous le réglage des signaux précoces : à la dernière bougie décidée,
    // à plat, tout est réuni pour acheter sauf la clôture au-dessus de l'EMA de tendance. Un court segment pointillé
    // gris au niveau de cette EMA, terminé sur la dernière bougie pour que l'infobulle le lise aussi au repos, et une
    // étiquette au bord droit. Non mesuré ; conditionnel, jamais un signal. Le niveau est celui de la dernière clôture
    // décidée : la bougie en formation n'est pas lue. Aucune série, aucun marqueur n'en dépend.
    const niveau = params.signauxPrecoces !== false ? preSignal(fin) : undefined;
    if (niveau !== undefined) {
      const couleur = "--text-dim";
      segments.push({
        deIdx: Math.max(0, n - 1 - BOUGIES_PRE_SIGNAL_AXIS),
        deValeur: niveau,
        aIdx: n - 1,
        aValeur: niveau,
        trait: "pointille",
        couleur,
        cible: "prix",
        // Le niveau avant « à la clôture » : au téléphone la ligne est coupée vers le 55e caractère, il doit y tenir.
        info: `AXIS S/R · pré-signal non mesuré — achat si > ${prix(niveau)} à la clôture et si le score ${filtres ? "et les filtres tiennent" : "tient"}`,
      });
      labels.push({ idx: n - 1, valeur: niveau, texte: "pré-signal", couleur, cible: "prix", ancrageX: "droite" });
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
