/**
 * Pont @axiom/indicators ↔ KLineChart.
 *
 * Principe (BUILD-CONTRACT) : @axiom/indicators est la SOURCE DE VÉRITÉ du calcul.
 * KLineChart ne refait AUCUNE math. Pour chaque instance active, on enregistre un
 * indicateur KLineChart générique dont le `calc` se borne à MAPPER la série déjà
 * calculée par `computeIndicator(def, candles, params)` — stockée dans
 * `extendData` — sur les points du graphe, alignée par index.
 *
 * MULTI-INSTANCES : l'identité d'un indicateur KLineChart est son `name` (par pane).
 * Pour afficher EMA(20) ET EMA(50) simultanément (mêmes `def`/outputs, params
 * différents), chaque INSTANCE reçoit donc un `name` KLineChart unique dérivé de
 * son `instanceId`. Les indicateurs à pane séparé reçoivent en plus un `paneId`
 * suffixé par l'instanceId. Le `shortName` du pane porte le libellé « EMA (20) ».
 *
 * Cycle de vie :
 *  - activation        -> `createIndicator` (overlay sur `candle_pane`, ou pane
 *    séparé `axiom_<instanceId>` pour RSI/MACD/Volume…) ;
 *  - backfill / clôture -> `computeIndicator` puis `overrideIndicator` avec un
 *    `extendData` NEUF (KLineChart compare extendData par référence => recalcul) ;
 *  - édition des params -> `overrideIndicator` en place (instanceId stable) ;
 *  - désactivation      -> `removeIndicator`.
 *
 * API vérifiée sur le bundle v9.8.12 (index.d.ts) :
 *  - `createIndicator(value, isStack?, paneOptions?) => string | null` ;
 *  - `overrideIndicator(override, paneId?) => void` (cible par `override.name` + paneId) ;
 *  - `removeIndicator(paneId, name?) => void` ;
 *  - `extendData` comparé par RÉFÉRENCE -> un objet neuf force le recalcul.
 */
import { registerIndicator, IndicatorSeries } from "klinecharts";
import type { Chart, IndicatorFigure } from "klinecharts";
import type { Candle, IndicatorDef, IndicatorResult } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import {
  computeKey,
  formatInstanceLabel,
  type ActiveIndicator,
} from "../store/indicators";

/** Point d'indicateur côté KLineChart : clé d'output -> valeur finie. */
type AxiomPoint = Record<string, number>;

/** Id du pane prix (constante interne KLineChart, vérifiée dans le bundle). */
const CANDLE_PANE_ID = "candle_pane";

/**
 * Nom KLineChart d'une INSTANCE (identité par pane). Préfixe `AXIOM_` = aucune
 * collision avec les indicateurs natifs (MA/BOLL/RSI…) ; `instanceId` (unique)
 * garantit qu'EMA(20) et EMA(50) coexistent sur le même pane.
 */
function axiomName(instanceId: string): string {
  return `AXIOM_${instanceId}`;
}

/** Id de pane séparé déterministe pour une instance non-overlay. Exportée : réutilisée
 * par `chart/paneHeaders.tsx` pour positionner l'en-tête de fermeture/réordonnancement. */
export function axiomPaneId(instanceId: string): string {
  return `axiom_${instanceId}`;
}

/** Enregistrement idempotent (module-scope) : survit aux remounts StrictMode. */
const registered = new Set<string>();

/** Série KLineChart : prix pour les overlays, volume pour le Volume, normal sinon. */
function seriesFor(def: IndicatorDef): IndicatorSeries {
  if (def.pane === "overlay") return IndicatorSeries.Price;
  if (def.category === "volume") return IndicatorSeries.Volume;
  return IndicatorSeries.Normal;
}

/**
 * Enregistre (une seule fois par `name`) un template KLineChart générique pour `def`.
 * Le `calc` est clos sur les clés d'output et lit la série pré-calculée d'extendData.
 * Chaque instance a son `name` propre : le template est donc réenregistré par
 * instanceId, mais son contenu (figures + calc générique) ne dépend que de `def`.
 */
function ensureRegistered(def: IndicatorDef, name: string): void {
  if (registered.has(name)) return;

  const outputKeys = def.outputs.map((o) => o.key);

  const figures: Array<IndicatorFigure<AxiomPoint>> = def.outputs.map((o) => {
    // Mapping déclaratif PlotStyle (@axiom/types) -> figure KLineChart :
    //  - histogram -> barres (référence 0) ;
    //  - points    -> marqueurs circulaires (SAR, fractals, pivotHighLow…) ;
    //  - line/area/band et tout style inconnu -> ligne (dégradation propre, jamais cassante).
    if (o.style === "histogram") {
      return { key: o.key, title: `${o.name}: `, type: "bar", baseValue: 0 };
    }
    if (o.style === "points") {
      return { key: o.key, title: `${o.name}: `, type: "circle" };
    }
    return { key: o.key, title: `${o.name}: `, type: "line" };
  });

  registerIndicator<AxiomPoint>({
    name,
    shortName: def.name, // repli ; le libellé « EMA (20) » est passé par instance à create/override.
    series: seriesFor(def),
    figures,
    // calc PUR de mapping : lit la série calculée par @axiom/indicators (extendData),
    // alignée index-par-index sur dataList. Aucune math n'est refaite ici.
    calc: (dataList, indicator) => {
      const result = indicator.extendData as IndicatorResult | undefined;
      const series = result?.series;
      return dataList.map((_candle, i) => {
        const point: AxiomPoint = {};
        if (series) {
          for (const key of outputKeys) {
            const arr = series[key];
            const v = arr?.[i];
            // On n'émet que des valeurs finies ; undefined/NaN => trou (pas de tracé).
            if (typeof v === "number" && Number.isFinite(v)) point[key] = v;
          }
        }
        return point;
      });
    },
  });

  registered.add(name);
}

/** Métadonnées d'une instance montée sur le graphe. */
interface MountedIndicator {
  /** Id du pane hôte (renvoyé par createIndicator). */
  paneId: string;
  /** Nom KLineChart unique de l'instance. */
  name: string;
  /** Dernière clé de calcul appliquée (defId::hashParams) — détecte une édition de params. */
  key: string;
}

/**
 * Contrôleur d'indicateurs lié à UNE instance de Chart KLineChart.
 * Réconcilie la liste d'instances actives et pousse les recalculs.
 */
export class ChartIndicators {
  private readonly chart: Chart;
  /** instanceId -> métadonnées de l'indicateur monté. */
  private readonly active = new Map<string, MountedIndicator>();
  /**
   * Cache de calcul par config (defId::hashParams). Mémorise la RÉFÉRENCE des
   * candles ayant produit le résultat : tant que les candles n'ont pas changé
   * (même référence), on NE recalcule PAS — deux instances de config identique
   * partagent le calcul, et un recompute redondant est un no-op.
   */
  private readonly computeCache = new Map<string, { candles: Candle[]; result: IndicatorResult }>();

  constructor(chart: Chart) {
    this.chart = chart;
  }

  /** Calcul mémoïsé : recalcule seulement si la référence des candles a changé. */
  private compute(def: IndicatorDef, params: ActiveIndicator["params"], candles: Candle[]): IndicatorResult {
    const key = computeKey(def.id, params);
    const cached = this.computeCache.get(key);
    if (cached && cached.candles === candles) return cached.result;
    const result = computeIndicator(def, candles, params);
    this.computeCache.set(key, { candles, result });
    return result;
  }

  /** Restreint le cache aux clés de calcul encore référencées (borne mémoire). */
  private pruneCache(keep: Set<string>): void {
    for (const key of this.computeCache.keys()) {
      if (!keep.has(key)) this.computeCache.delete(key);
    }
  }

  /**
   * Réconcilie le graphe avec la liste voulue : retire les instances disparues,
   * ajoute les nouvelles, ré-override celles dont les PARAMS ont changé (édition),
   * et laisse intactes celles inchangées (aucun recalcul superflu).
   */
  sync(instances: ActiveIndicator[], candles: Candle[]): void {
    const wanted = new Set(instances.map((i) => i.instanceId));

    // Retrait des instances désactivées.
    for (const [instanceId, info] of this.active) {
      if (!wanted.has(instanceId)) {
        this.chart.removeIndicator(info.paneId, info.name);
        this.active.delete(instanceId);
      }
    }

    // Détection d'un changement d'ORDRE des panes séparés (même jeu d'instanceId,
    // position différente) : KLineChart n'a pas de setter d'ordre natif (PaneOptions
    // n'a pas de champ `order` en v9.8.12) — seul l'ordre de CRÉATION détermine
    // l'empilement visuel. On retire les panes concernés pour les laisser être
    // recréés dans le bon ordre par la boucle ci-dessous (coût : recréation de pane,
    // PAS recalcul — `computeCache` est conservé).
    const ordreVoulu = instances
      .filter((i) => getIndicator(i.defId)?.pane !== "overlay")
      .map((i) => i.instanceId);
    const ordreMonte = [...this.active.entries()]
      .filter(([, info]) => info.paneId !== CANDLE_PANE_ID)
      .map(([instanceId]) => instanceId);
    if (ordreVoulu.length === ordreMonte.length && ordreVoulu.join(",") !== ordreMonte.join(",")) {
      for (const instanceId of ordreVoulu) {
        const info = this.active.get(instanceId);
        if (info) {
          this.chart.removeIndicator(info.paneId, info.name);
          this.active.delete(instanceId);
        }
      }
    }

    for (const inst of instances) {
      const def = getIndicator(inst.defId);
      if (!def) continue; // defId inconnu (persistance obsolète) : ignoré.

      const name = axiomName(inst.instanceId);
      const key = computeKey(inst.defId, inst.params);
      const existing = this.active.get(inst.instanceId);

      if (existing) {
        if (existing.key === key) continue; // params inchangés : rien à faire.
        // Édition des params (instanceId stable) : recalcul + override + libellé.
        const result = this.compute(def, inst.params, candles);
        this.chart.overrideIndicator(
          { name, shortName: formatInstanceLabel(def, inst.params), extendData: result },
          existing.paneId
        );
        existing.key = key;
        continue;
      }

      // Nouvelle instance.
      ensureRegistered(def, name);
      const result = this.compute(def, inst.params, candles);
      const paneId = def.pane === "overlay" ? CANDLE_PANE_ID : axiomPaneId(inst.instanceId);
      const created = this.chart.createIndicator(
        { name, shortName: formatInstanceLabel(def, inst.params), extendData: result },
        true, // isStack : coexistence des overlays sur le pane prix.
        { id: paneId, dragEnabled: true, minHeight: 60 }
      );
      if (created) this.active.set(inst.instanceId, { paneId: created, name, key });
    }

    this.pruneCache(new Set(instances.map((i) => computeKey(i.defId, i.params))));
  }

  /**
   * Recalcule (via @axiom/indicators) toutes les instances actives et pousse le
   * résultat. Appelé au backfill et à CHAQUE bougie clôturée (cf. BUILD-CONTRACT).
   * Le cache mémoïse les configs identiques : une seule passe de calcul par
   * (defId, params), même si plusieurs instances les partagent.
   */
  recompute(instances: ActiveIndicator[], candles: Candle[]): void {
    for (const inst of instances) {
      const info = this.active.get(inst.instanceId);
      if (!info) continue;
      const def = getIndicator(inst.defId);
      if (!def) continue;
      const result = this.compute(def, inst.params, candles);
      this.chart.overrideIndicator({ name: info.name, extendData: result }, info.paneId);
    }
  }
}
