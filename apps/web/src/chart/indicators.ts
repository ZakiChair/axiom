/**
 * Pont @axiom/indicators ↔ KLineChart.
 *
 * Principe (BUILD-CONTRACT) : @axiom/indicators est la SOURCE DE VÉRITÉ du calcul.
 * KLineChart ne refait AUCUNE math. Pour chaque `IndicatorDef`, on enregistre un
 * indicateur KLineChart générique dont le `calc` se borne à MAPPER la série déjà
 * calculée par `computeIndicator(def, candles, params)` — stockée dans
 * `extendData` — sur les points du graphe, alignée par index.
 *
 * Cycle de vie :
 *  - activation        -> `createIndicator` (overlay sur le pane prix
 *    « candle_pane », ou pane séparé `axiom_<id>` pour RSI/MACD/Volume) ;
 *  - backfill / clôture -> `computeIndicator` puis `overrideIndicator` avec un
 *    `extendData` NEUF (KLineChart compare extendData par référence => recalcul) ;
 *  - désactivation      -> `removeIndicator`.
 *
 * Détails d'API vérifiés sur le bundle v9.8.12 (index.d.ts + ESM compilé) :
 *  - `extendData` comparé par RÉFÉRENCE -> un objet neuf force le recalcul ;
 *  - `addInstance` exécute `calc` immédiatement ;
 *  - `updateData` (tick live) relance `calc` de tous les indicateurs : notre
 *    `calc` se contente de relire `extendData` (aucune math, aucun re-render).
 */
import { registerIndicator, IndicatorSeries } from "klinecharts";
import type { Chart, IndicatorFigure } from "klinecharts";
import type {
  Candle,
  IndicatorDef,
  IndicatorInstance,
  IndicatorResult,
} from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";

/** Point d'indicateur côté KLineChart : clé d'output -> valeur finie. */
type AxiomPoint = Record<string, number>;

/** Id du pane prix (constante interne KLineChart, vérifiée dans le bundle). */
const CANDLE_PANE_ID = "candle_pane";

/** Nom KLineChart d'un indicateur AXIOM (préfixe = aucune collision avec les natifs). */
function axiomName(defId: string): string {
  return `AXIOM_${defId.toUpperCase()}`;
}

/** Id de pane séparé déterministe pour un indicateur non-overlay. */
function axiomPaneId(defId: string): string {
  return `axiom_${defId}`;
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
 * Enregistre (une seule fois) un template KLineChart générique pour `def`.
 * Le `calc` est clos sur les clés d'output et lit la série pré-calculée d'extendData.
 */
function ensureRegistered(def: IndicatorDef): void {
  const name = axiomName(def.id);
  if (registered.has(name)) return;

  const outputKeys = def.outputs.map((o) => o.key);

  const figures: Array<IndicatorFigure<AxiomPoint>> = def.outputs.map((o) => {
    const isHistogram = o.style === "histogram";
    return {
      key: o.key,
      title: `${o.name}: `,
      // Histogramme -> barres (référence 0) ; tout le reste -> ligne.
      type: isHistogram ? "bar" : "line",
      ...(isHistogram ? { baseValue: 0 } : {}),
    };
  });

  registerIndicator<AxiomPoint>({
    name,
    shortName: def.name,
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

/**
 * Contrôleur d'indicateurs lié à UNE instance de Chart KLineChart.
 * Réconcilie la liste d'indicateurs actifs et pousse les recalculs.
 */
export class ChartIndicators {
  private readonly chart: Chart;
  /** defId -> { paneId renvoyé par createIndicator, name KLineChart }. */
  private readonly active = new Map<string, { paneId: string; name: string }>();

  constructor(chart: Chart) {
    this.chart = chart;
  }

  /**
   * Réconcilie le graphe avec la liste voulue : retire les disparus, ajoute les
   * nouveaux, et rafraîchit les présents (recalcul via @axiom/indicators).
   */
  sync(instances: IndicatorInstance[], candles: Candle[]): void {
    const wanted = new Set(instances.map((i) => i.defId));

    // Retrait des indicateurs désactivés.
    for (const [defId, info] of this.active) {
      if (!wanted.has(defId)) {
        this.chart.removeIndicator(info.paneId, info.name);
        this.active.delete(defId);
      }
    }

    // Ajout / mise à jour.
    for (const inst of instances) {
      const def = getIndicator(inst.defId);
      if (!def) continue; // defId inconnu (ex. persistance obsolète) : ignoré.
      ensureRegistered(def);

      const result = computeIndicator(def, candles, inst.params);
      const name = axiomName(def.id);
      const existing = this.active.get(inst.defId);

      if (existing) {
        // Déjà présent : on rafraîchit seulement la série (référence neuve => recalc).
        this.chart.overrideIndicator({ name, extendData: result }, existing.paneId);
        continue;
      }

      const paneId = def.pane === "overlay" ? CANDLE_PANE_ID : axiomPaneId(def.id);
      const created = this.chart.createIndicator(
        { name, extendData: result },
        true, // isStack : coexistence des overlays sur le pane prix.
        { id: paneId }
      );
      if (created) this.active.set(inst.defId, { paneId: created, name });
    }
  }

  /**
   * Recalcule (via @axiom/indicators) tous les indicateurs actifs et pousse le
   * résultat. Appelé au backfill et à CHAQUE bougie clôturée (cf. BUILD-CONTRACT).
   */
  recompute(instances: IndicatorInstance[], candles: Candle[]): void {
    for (const inst of instances) {
      const info = this.active.get(inst.defId);
      if (!info) continue;
      const def = getIndicator(inst.defId);
      if (!def) continue;
      const result = computeIndicator(def, candles, inst.params);
      this.chart.overrideIndicator({ name: info.name, extendData: result }, info.paneId);
    }
  }
}
