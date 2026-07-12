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
import type { Candle, ExchangeId, IndicatorDef, IndicatorResult, Timeframe } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import { auxProvider } from "./auxProvider";
import {
  computeKey,
  formatInstanceLabel,
  type ActiveIndicator,
} from "../store/indicators";

/** Point d'indicateur côté KLineChart : clé d'output -> valeur finie. */
type AxiomPoint = Record<string, number>;

/** Id du pane prix (constante interne KLineChart, vérifiée dans le bundle). */
const CANDLE_PANE_ID = "candle_pane";

/** Période du throttle leading+trailing de `recomputeThrottled` (recalcul intra-bougie). */
const RECOMPUTE_THROTTLE_MS = 500;

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
    // Précision d'axe/légende par def (undefined => défaut KLineChart = 4) : évite les
    // décimales absurdes des oscillateurs bornés comme le RSI « 66.0000 » (audit #9).
    precision: def.precision,
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

  /**
   * Throttle dédié de `recomputeThrottled` (leading+trailing, `RECOMPUTE_THROTTLE_MS`).
   * PAS `createRafThrottle` (rafThrottle.ts) : ce helper ne transmet aucun argument au
   * flush (adapté à `updateData`, qui relit le store) — ici `recompute` a besoin des
   * DERNIERS `instances/candles/exchange` reçus, d'où des champs privés dédiés.
   */
  private lastRun = 0;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private latestArgs: [ActiveIndicator[], Candle[], ExchangeId] | null = null;

  /**
   * Symbole/TF courants du slot (Task 14) — nécessaires à `auxProvider.getAligned`
   * pour les defs déclarant `aux`. Renseignés par `setMarket`, appelé par
   * `ChartInstance` à chaque run de l'effet DONNÉES ; indépendants du throttle
   * (Task 6, signatures de `sync`/`recompute`/`recomputeThrottled` inchangées).
   */
  private symbol = "";
  private timeframe: Timeframe | null = null;

  constructor(chart: Chart) {
    this.chart = chart;
  }

  /** Renseigne le symbole/TF courants (voir `symbol`/`timeframe` ci-dessus). */
  setMarket(symbol: string, timeframe: Timeframe): void {
    this.symbol = symbol;
    this.timeframe = timeframe;
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

  /**
   * Calcul d'UNE instance, aux-AWARE (Task 14) : si `def.aux` est vide, délègue au
   * calcul mémoïsé `compute` (inchangé, non aux-aware). Sinon, résout le statut via
   * `auxProvider.getAligned` (Task 12) — `onReady` re-déclenche UNIQUEMENT le
   * recalcul de CETTE instance (`onAuxReady`), jamais un re-sync/re-création de
   * pane. Pas de memoïsation ici (les 6 defs dérivés sont bon marché à recalculer ;
   * l'objet `aux` renvoyé par `getAligned` est réaligné à CHAQUE appel — le mettre
   * en clé de cache viderait le cache à chaque passage).
   *
   * Renvoie aussi le SUFFIXE de statut à ajouter au libellé du pane — même canal
   * que le nom normal (`shortName`, cf. `formatInstanceLabel`) : "" (ready/aux
   * absent), " …" (pending), " (indisponible)" (error).
   */
  private computeForInstance(
    def: IndicatorDef,
    inst: ActiveIndicator,
    candles: Candle[],
    exchange: ExchangeId
  ): { result: IndicatorResult; suffix: string } {
    if (!def.aux || def.aux.length === 0) {
      return { result: this.compute(def, inst.params, candles), suffix: "" };
    }
    if (this.timeframe === null) {
      // `setMarket` pas encore appelé : ne devrait pas arriver en pratique (l'effet
      // DONNÉES l'appelle avant tout sync/recompute) — dégradation gracieuse.
      return { result: computeIndicator(def, candles, inst.params), suffix: "" };
    }
    const candleTimes = candles.map((c) => c.time);
    const status = auxProvider.getAligned(
      { exchange, symbol: this.symbol, timeframe: this.timeframe, ids: def.aux, candleTimes },
      () => this.onAuxReady(inst.instanceId)
    );
    if (status.status === "ready") {
      return { result: computeIndicator(def, candles, inst.params, status.aux), suffix: "" };
    }
    // `pending`/`error` : aux absent -> le def dégrade en séries all-undefined (garde Task 13).
    const result = computeIndicator(def, candles, inst.params);
    return { result, suffix: status.status === "pending" ? " …" : " (indisponible)" };
  }

  /**
   * Rappel de `auxProvider.getAligned` une fois le fetch aux résolu (ou en échec) :
   * recalcule et pousse UNIQUEMENT cette instance via `overrideIndicator` — jamais
   * `createIndicator`/`removeIndicator` (pas de re-création de pane). No-op si
   * l'instance a été retirée entre-temps, ou si aucun sync/recompute n'a encore eu
   * lieu (pas d'arguments connus).
   */
  private onAuxReady(instanceId: string): void {
    const args = this.latestArgs;
    const info = this.active.get(instanceId);
    if (!info || !args) return;
    const [instances, candles, exchange] = args;
    const inst = instances.find((i) => i.instanceId === instanceId);
    if (!inst) return;
    const def = getIndicator(inst.defId);
    if (!def) return;
    const { result, suffix } = this.computeForInstance(def, inst, candles, exchange);
    this.chart.overrideIndicator(
      { name: info.name, shortName: `${formatInstanceLabel(def, inst.params)}${suffix}`, extendData: result },
      info.paneId
    );
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
  sync(instances: ActiveIndicator[], candles: Candle[], exchange: ExchangeId): void {
    // Dernier tuple connu (Task 14) : lu par `onAuxReady` pour retrouver l'instance,
    // les candles et l'exchange lors d'une résolution aux asynchrone.
    this.latestArgs = [instances, candles, exchange];
    const effectiveInstances = exchange === "synthetic"
      ? instances.filter((i) => i.defId !== "volume")
      : instances;
    const wanted = new Set(effectiveInstances.map((i) => i.instanceId));

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
    const ordreVoulu = effectiveInstances
      .filter((i) => {
        const def = getIndicator(i.defId);
        return def && def.pane !== "overlay";
      })
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

    for (const inst of effectiveInstances) {
      const def = getIndicator(inst.defId);
      if (!def) continue; // defId inconnu (persistance obsolète) : ignoré.

      const name = axiomName(inst.instanceId);
      const key = computeKey(inst.defId, inst.params);
      const existing = this.active.get(inst.instanceId);

      if (existing) {
        if (existing.key === key) continue; // params inchangés : rien à faire.
        // Édition des params (instanceId stable) : recalcul + override + libellé.
        const { result, suffix } = this.computeForInstance(def, inst, candles, exchange);
        this.chart.overrideIndicator(
          { name, shortName: `${formatInstanceLabel(def, inst.params)}${suffix}`, extendData: result },
          existing.paneId
        );
        existing.key = key;
        continue;
      }

      // Nouvelle instance.
      ensureRegistered(def, name);
      const { result, suffix } = this.computeForInstance(def, inst, candles, exchange);
      const paneId = def.pane === "overlay" ? CANDLE_PANE_ID : axiomPaneId(inst.instanceId);
      const created = this.chart.createIndicator(
        { name, shortName: `${formatInstanceLabel(def, inst.params)}${suffix}`, extendData: result },
        true, // isStack : coexistence des overlays sur le pane prix.
        { id: paneId, dragEnabled: true, minHeight: 60 }
      );
      if (created) this.active.set(inst.instanceId, { paneId: created, name, key });
    }

    this.pruneCache(new Set(effectiveInstances.map((i) => computeKey(i.defId, i.params))));
  }

  /**
   * Recalcule (via @axiom/indicators) toutes les instances actives et pousse le
   * résultat. Appelé au backfill et à CHAQUE bougie clôturée (cf. BUILD-CONTRACT).
   * Le cache mémoïse les configs identiques : une seule passe de calcul par
   * (defId, params), même si plusieurs instances les partagent.
   */
  recompute(instances: ActiveIndicator[], candles: Candle[], exchange: ExchangeId): void {
    // Dernier tuple connu (Task 14) : lu par `onAuxReady`, cf. `sync`.
    this.latestArgs = [instances, candles, exchange];
    const effectiveInstances = exchange === "synthetic"
      ? instances.filter((i) => i.defId !== "volume")
      : instances;
    for (const inst of effectiveInstances) {
      const info = this.active.get(inst.instanceId);
      if (!info) continue;
      const def = getIndicator(inst.defId);
      if (!def) continue;
      const { result, suffix } = this.computeForInstance(def, inst, candles, exchange);
      // Le libellé (shortName) n'est renvoyé que pour les defs aux-aware : leur suffixe
      // d'état peut changer sans édition de params (résolution async) ; les autres defs
      // gardent leur libellé déjà posé par `sync` (aucun changement de comportement).
      const override = def.aux && def.aux.length > 0
        ? { name: info.name, shortName: `${formatInstanceLabel(def, inst.params)}${suffix}`, extendData: result }
        : { name: info.name, extendData: result };
      this.chart.overrideIndicator(override, info.paneId);
    }
  }

  /**
   * Recalcule au FIL DE L'EAU (bougie en formation, ticks intra-bougie), throttlée
   * leading+trailing sur `RECOMPUTE_THROTTLE_MS` : si la garde est expirée, exécute
   * `recompute` tout de suite (leading) ; sinon programme un UNIQUE trailing à
   * `lastRun + RECOMPUTE_THROTTLE_MS`, avec les DERNIERS arguments reçus (la bougie
   * a pu bouger entre-temps). Complète `recompute`, appelé tel quel à la clôture
   * (flush exact, hors throttle).
   */
  recomputeThrottled(instances: ActiveIndicator[], candles: Candle[], exchange: ExchangeId): void {
    const now = Date.now();
    this.latestArgs = [instances, candles, exchange];
    if (now - this.lastRun >= RECOMPUTE_THROTTLE_MS) {
      this.lastRun = now;
      this.recompute(instances, candles, exchange);
      return;
    }
    if (this.pending !== null) return; // un trailing est déjà programmé, il lira `latestArgs`
    const delay = this.lastRun + RECOMPUTE_THROTTLE_MS - now;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.lastRun = Date.now();
      const args = this.latestArgs;
      if (args) this.recompute(args[0], args[1], args[2]);
    }, delay);
  }

  /** Annule un trailing en attente (cleanup de l'effet DONNÉES, cf. `disposeThrottle`). */
  disposeThrottle(): void {
    if (this.pending !== null) {
      clearTimeout(this.pending);
      this.pending = null;
    }
  }
}
