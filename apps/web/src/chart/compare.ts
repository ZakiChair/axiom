/**
 * Multi-courbes (comparaison) — superpose le symbole PRINCIPAL + 1..N symboles
 * comparés (cap 4) en BASE 100 dans un sous-pane DÉDIÉ « Comparaison (base 100) »,
 * pour comparer les variations RELATIVES (ex. BTC vs ETH vs SOL) sans écraser
 * l'échelle de prix des bougies (axe distinct, son propre y).
 *
 * Principe (aligné sur OrderflowController / ChartIndicators) :
 *  - UN indicateur KLineChart `AXIOM_COMPARE` (enregistré UNE fois, module-scope)
 *    dessine jusqu'à 5 LIGNES : le principal (référence) + jusqu'à 4 comparés.
 *    Chaque ligne lit SA couleur dans `extendData` via le callback `figure.styles`
 *    — vérifié dans le bundle v9.8.12 (`eachFigures`) : la valeur retournée par
 *    `figure.styles` est fusionnée PAR-DESSUS la couleur par défaut de la ligne.
 *  - Normalisation INDEXED-TO-100 : pour chaque série, base = close à la 1re bougie
 *    du backfill alignée par timestamp ; valeur = close/base*100. La série est
 *    indexée PAR TIMESTAMP (`normByTime`) et le `calc` la relit par
 *    `kLineData.timestamp` — robuste à la croissance de la dataList, aucune math
 *    refaite, aucun re-render React.
 *  - Données des comparés : récupérées via getAdapter(exchange).fetchKlines —
 *    FETCH-ON-CHANGE (ajout/retrait ; ou changement symbole/TF/source qui RECRÉE
 *    le contrôleur). Pas de WS par comparé (volontaire : simplicité, pas de
 *    multiplication des flux live). Le principal, lui, est déjà dans marketStore :
 *    sa ligne est rafraîchie à CHAQUE bougie clôturée (impératif, hors render-loop).
 *  - Cycle de vie : pane créé dès qu'il y a ≥1 comparé, retiré quand la liste se
 *    vide ; dispose() nettoie tout AVANT dispose(chart).
 */
import { registerIndicator, IndicatorSeries } from "klinecharts";
import type {
  Chart,
  IndicatorFigure,
  IndicatorTooltipData,
  TooltipLegend,
} from "klinecharts";
import type { Candle, ExchangeId, Timeframe } from "@axiom/types";
import { getAdapter } from "../data/adapters";
import { marketStore } from "../store/market";
import { lireTokenCanvas } from "../lib/canvasTokens";
import {
  MAIN_COLOR,
  MAX_COMPARE,
  type CompareSymbol,
} from "../store/compare";

/** Repli hex si le token n'est pas encore résolvable (thème pas encore appliqué). */
const REPLI_COULEUR = "#94a3b8";

/** Profondeur du backfill des comparés (aligné sur le backfill principal). */
const BACKFILL_LIMIT = 500;
/** Nom KLineChart de l'indicateur de comparaison (préfixe = aucune collision). */
const COMPARE_NAME = "AXIOM_COMPARE";
/** Id du sous-pane dédié (déterministe). */
const COMPARE_PANE_ID = "axiom_compare";
/** Nombre max de lignes : symbole principal (référence) + comparés. */
const MAX_LINES = MAX_COMPARE + 1;

/** Point de l'indicateur côté KLineChart : clé de ligne -> valeur base 100. */
type ComparePoint = Record<string, number>;

/** Une ligne du pane : couleur + série normalisée base 100 indexée par open time. */
interface CompareSlot {
  color: string;
  normByTime: Record<number, number>;
  /** Symbole de la ligne — porté dans la légende du pane (cf. createTooltipDataSource). */
  label: string;
}

/** Contenu d'`extendData` lu par `calc` et par les callbacks `figure.styles`. */
interface CompareExtend {
  slots: CompareSlot[];
}

/**
 * Série normalisée base 100, alignée par open time sur `candles` :
 *  base  = close au 1er open time de `candles` présent dans `closeByTime` ;
 *  point = close/base*100, indexé par open time de bougie principale.
 * (clé = open time de la bougie principale ; sert au lookup par `kd.timestamp`.)
 */
function normalize(
  candles: Candle[],
  closeByTime: Map<number, number>
): Record<number, number> {
  const out: Record<number, number> = {};
  // Base = 1re bougie du backfill alignée (1er timestamp commun aux deux séries).
  let base = 0;
  for (const c of candles) {
    const v = closeByTime.get(c.time);
    if (v !== undefined && v > 0) {
      base = v;
      break;
    }
  }
  if (base <= 0) return out; // aucune donnée alignée : ligne vide (pas de tracé)
  for (const c of candles) {
    const v = closeByTime.get(c.time);
    if (v !== undefined && Number.isFinite(v)) out[c.time] = (v / base) * 100;
  }
  return out;
}

/** Enregistrement idempotent (module-scope) : survit aux remounts StrictMode. */
let registered = false;

function ensureRegistered(): void {
  if (registered) return;

  const figures: Array<IndicatorFigure<ComparePoint>> = [];
  for (let i = 0; i < MAX_LINES; i++) {
    figures.push({
      key: `line${i}`,
      title: "", // pas de libellé tooltip : la légende latérale fait foi
      type: "line",
      // Couleur dynamique lue dans extendData (slot i) ; fusionnée par-dessus la
      // couleur par défaut de la ligne (cf. eachFigures du bundle v9.8.12).
      // Résolution du token AU DESSIN (thème-aware) ; hex hérité passe tel quel.
      styles: (_data, indicator) => {
        const ext = indicator.extendData as CompareExtend | undefined;
        const slot = ext?.slots[i];
        if (!slot) return {};
        const color = slot.color.startsWith("--")
          ? lireTokenCanvas(slot.color, REPLI_COULEUR)
          : slot.color;
        return { color, size: 1.5 };
      },
    });
  }

  registerIndicator<ComparePoint>({
    name: COMPARE_NAME,
    shortName: "Comp (base 100)",
    series: IndicatorSeries.Normal, // sous-pane à part : n'écrase pas l'axe prix
    figures,
    // Légende du pane construite à la main : les `title` des figures sont vides (une
    // ligne = un symbole, connu seulement au runtime) et le nom d'indicateur n'est plus
    // imprimé par klinecharts depuis que les légendes DOM le portent — sans ceci le pane
    // n'afficherait que des nombres nus.
    createTooltipDataSource: ({ indicator, crosshair }) => {
      const slots = (indicator.extendData as CompareExtend | undefined)?.slots;
      const idx = crosshair.dataIndex ?? -1;
      if (!slots || idx < 0) return {} as IndicatorTooltipData;
      const point = indicator.result[idx] as ComparePoint | undefined;
      const values: TooltipLegend[] = slots.map((slot, i) => {
        const v = point?.[`line${i}`];
        return {
          title: `${slot.label}: `,
          value: typeof v === "number" && Number.isFinite(v) ? v.toFixed(1) : "—",
        };
      });
      return { name: "Comp (base 100)", values } as IndicatorTooltipData;
    },
    // calc PUR de mapping : relit la série normalisée (extendData) par timestamp.
    // Aucune math refaite ici, aucun re-render.
    calc: (dataList, indicator) => {
      const ext = indicator.extendData as CompareExtend | undefined;
      const slots = ext?.slots;
      return dataList.map((kd) => {
        const point: ComparePoint = {};
        if (slots) {
          for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (!slot) continue;
            const v = slot.normByTime[kd.timestamp];
            if (typeof v === "number" && Number.isFinite(v)) point[`line${i}`] = v;
          }
        }
        return point;
      });
    },
  });

  registered = true;
}

/**
 * Contrôleur de comparaison lié à UNE instance Chart + une source/TF (capturés à la
 * construction : le contrôleur est recréé à chaque changement symbole/TF/source).
 */
export class CompareController {
  private readonly chart: Chart;
  private readonly exchange: ExchangeId;
  private readonly timeframe: Timeframe;

  /** symbole comparé -> { couleur courante, close brut par open time (REST). */
  private readonly fetched = new Map<
    string,
    { color: string; closeByTime: Map<number, number> }
  >();
  /** Ordre + couleur des comparés voulus (dernier `sync`). */
  private order: CompareSymbol[] = [];
  private paneId: string | null = null;
  private disposed = false;
  /** Jeton de sync : invalide les fetch obsolètes (retrait/dispose pendant un fetch). */
  private syncToken = 0;

  constructor(chart: Chart, exchange: ExchangeId, timeframe: Timeframe) {
    this.chart = chart;
    this.exchange = exchange;
    this.timeframe = timeframe;
    ensureRegistered();
  }

  /**
   * Réconcilie la liste voulue : retire les comparés disparus, récupère (REST) les
   * nouveaux, puis reconstruit et applique. Fetch-on-change.
   */
  sync(list: CompareSymbol[]): void {
    if (this.disposed) return;
    this.order = list.slice();
    const wanted = new Set(list.map((c) => c.symbol));

    // Retrait des comparés qui ne sont plus voulus (libère leur cache).
    for (const sym of [...this.fetched.keys()]) {
      if (!wanted.has(sym)) this.fetched.delete(sym);
    }
    // MAJ de la couleur des présents (réattribution possible après un retrait).
    for (const c of list) {
      const entry = this.fetched.get(c.symbol);
      if (entry) entry.color = c.color;
    }

    // Symboles à récupérer (nouveaux uniquement).
    const toFetch = list.filter((c) => !this.fetched.has(c.symbol));
    if (toFetch.length === 0) {
      this.rebuild();
      return;
    }

    const token = ++this.syncToken;
    const adapter = getAdapter(this.exchange);
    void Promise.all(
      toFetch.map((c) =>
        adapter
          .fetchKlines(c.symbol, this.timeframe, { limit: BACKFILL_LIMIT })
          .then((candles) => {
            if (this.disposed || token !== this.syncToken) return; // obsolète
            const closeByTime = new Map<number, number>();
            for (const k of candles) closeByTime.set(k.time, k.close);
            this.fetched.set(c.symbol, { color: c.color, closeByTime });
          })
          .catch((err) => {
            console.error(`[AXIOM] Échec du backfill comparaison ${c.symbol}`, err);
          })
      )
    ).then(() => {
      if (this.disposed || token !== this.syncToken) return;
      this.rebuild();
    });
  }

  /**
   * Recompute des séries normalisées (backfill principal prêt OU bougie clôturée) :
   * réaligne notamment la ligne du PRINCIPAL sur le buffer marché courant.
   */
  onCandles(): void {
    this.rebuild();
  }

  /** Démontage complet (appelé AVANT dispose(chart)). */
  dispose(): void {
    this.disposed = true;
    this.fetched.clear();
    this.removePane();
  }

  // --- interne -------------------------------------------------------------

  private rebuild(): void {
    if (this.disposed) return;
    // Pas de comparé -> pas de pane (le base 100 n'a de sens qu'en comparaison).
    if (this.order.length === 0) {
      this.removePane();
      return;
    }
    const candles = marketStore.getState().candles;
    if (candles.length === 0) return; // backfill principal pas encore là : onCandles() relancera

    const slots: CompareSlot[] = [];

    // Slot 0 : symbole PRINCIPAL (référence) — depuis le buffer marché, AUCUN fetch.
    const mainClose = new Map<number, number>();
    for (const c of candles) mainClose.set(c.time, c.close);
    slots.push({
      color: MAIN_COLOR,
      normByTime: normalize(candles, mainClose),
      label: marketStore.getState().symbol,
    });

    // Slots suivants : comparés, dans l'ordre voulu, s'ils sont déjà récupérés.
    for (const c of this.order) {
      const entry = this.fetched.get(c.symbol);
      if (!entry) continue; // fetch en cours : apparaîtra au prochain rebuild
      slots.push({
        color: entry.color,
        normByTime: normalize(candles, entry.closeByTime),
        label: c.symbol,
      });
    }

    // extendData NEUF à chaque fois (KLineChart compare par RÉFÉRENCE pour recalc).
    const extendData: CompareExtend = { slots };
    if (this.paneId) {
      this.chart.overrideIndicator({ name: COMPARE_NAME, extendData }, this.paneId);
    } else {
      const id = this.chart.createIndicator(
        { name: COMPARE_NAME, extendData },
        false, // sous-pane dédié et isolé (pas d'empilement sur le pane prix)
        { id: COMPARE_PANE_ID }
      );
      this.paneId = id ?? null;
    }
  }

  private removePane(): void {
    if (!this.paneId) return;
    this.chart.removeIndicator(this.paneId, COMPARE_NAME);
    this.paneId = null;
  }
}
