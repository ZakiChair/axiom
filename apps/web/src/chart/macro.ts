import { registerIndicator, IndicatorSeries } from "klinecharts";
import type { Chart, IndicatorFigure } from "klinecharts";
import type { MacroSeries } from "../data/macro";
import { fredM2WeeklyProvider, stablecoinsSupplyProvider } from "../data/macro";
import { getFredKey } from "../store/macro";
import { macroHistorySeries, recordGlobalSnapshotNow } from "../store/macroHistory";
import type { MacroOverlayId } from "../store/macro-overlays";
import { marketStore } from "../store/market";
import { lireTokenCanvas } from "../lib/canvasTokens";

const MACRO_NAME = "AXIOM_MACRO";
const MACRO_PANE_ID = "axiom_macro";

/**
 * Recul minimal de récupération des séries macro (~220 j). Garantit au moins un point
 * récent même pour le M2 (hebdo + délai de publication FRED ~1 mois), indépendamment
 * de la longueur de la fenêtre de bougies. Sans ça, les TF intraday n'affichent pas le M2.
 */
const MACRO_MIN_LOOKBACK_MS = 220 * 24 * 60 * 60 * 1000;

interface CandleTime {
  time: number;
}

type MacroPointOut = Record<string, number>;

interface MacroSlot {
  key: string;
  valueByTime: Record<number, number>;
}

interface MacroExtend {
  slots: MacroSlot[];
}

interface MacroDef {
  id: MacroOverlayId;
  key: string;
  title: string;
  token: string;
  repli: string;
  scale: number;
}

const MACRO_DEFS: MacroDef[] = [
  { id: "crypto-total", key: "cryptoTotal", title: "Cap crypto: ", token: "--serie-1", repli: "#38bdf8", scale: 1 },
  { id: "stablecoins", key: "stablecoins", title: "Stablecoins: ", token: "--serie-2", repli: "#a78bfa", scale: 1 },
  { id: "m2", key: "m2", title: "M2: ", token: "--serie-3", repli: "#eab308", scale: 1e9 },
];

function macroDef(id: MacroOverlayId): MacroDef {
  const def = MACRO_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`Macro inconnue: ${id}`);
  return def;
}

export function scaleMacroSeries(series: MacroSeries, scale: number): MacroSeries {
  if (scale === 1) return series;
  return series.map((p) => ({ time: p.time, value: p.value * scale }));
}

export function buildMacroValueByTime(candles: CandleTime[], series: MacroSeries): Record<number, number> {
  const out: Record<number, number> = {};
  if (candles.length === 0 || series.length === 0) return out;

  if (series.length === 1) {
    const value = series[0]?.value;
    if (typeof value !== "number" || !Number.isFinite(value)) return out;
    for (const c of candles) out[c.time] = value;
    return out;
  }

  let i = 0;
  let last: number | undefined;
  for (const c of candles) {
    while (i < series.length) {
      const point = series[i];
      if (!point || point.time > c.time) break;
      if (Number.isFinite(point.value)) last = point.value;
      i++;
    }
    if (last !== undefined) out[c.time] = last;
  }
  return out;
}

let registered = false;

function ensureRegistered(): void {
  if (registered) return;

  const figures: Array<IndicatorFigure<MacroPointOut>> = MACRO_DEFS.map((def) => ({
    key: def.key,
    title: def.title,
    type: "line",
    styles: () => ({ color: lireTokenCanvas(def.token, def.repli), size: 1.5 }),
  }));

  registerIndicator<MacroPointOut>({
    name: MACRO_NAME,
    shortName: "Macro",
    series: IndicatorSeries.Normal,
    // Cap crypto / M2 en milliards : 0 décimale + notation compacte sur l'axe et
    // la légende, au lieu de « Cap crypto: 2,293,577,001,928.3072 » (constaté à l'écran).
    precision: 0,
    shouldFormatBigNumber: true,
    figures,
    calc: (dataList, indicator) => {
      const ext = indicator.extendData as MacroExtend | undefined;
      const slots = ext?.slots;
      return dataList.map((kd) => {
        const point: MacroPointOut = {};
        if (slots) {
          for (const slot of slots) {
            const value = slot.valueByTime[kd.timestamp];
            if (typeof value === "number" && Number.isFinite(value)) point[slot.key] = value;
          }
        }
        return point;
      });
    },
  });

  registered = true;
}

export class MacroController {
  private readonly chart: Chart;
  private readonly abort = new AbortController();
  private readonly cache = new Map<MacroOverlayId, MacroSeries | null>();
  private readonly loading = new Set<MacroOverlayId>();
  private enabled: MacroOverlayId[] = [];
  private disposed = false;
  private paneId: string | null = null;

  constructor(chart: Chart) {
    this.chart = chart;
    ensureRegistered();
  }

  sync(ids: MacroOverlayId[]): void {
    if (this.disposed) return;
    this.enabled = ids.slice();
    if (this.enabled.length === 0) {
      this.removePane();
      return;
    }

    for (const id of this.enabled) {
      // crypto-total : série persistée (store macroHistory), lue en direct au rebuild —
      // pas de cache async ici. On amorce un échantillon si la série est encore vide.
      if (id === "crypto-total") {
        if (macroHistorySeries("total").length === 0) void recordGlobalSnapshotNow(this.abort.signal);
        continue;
      }
      if (!this.cache.has(id) && !this.loading.has(id)) void this.load(id);
    }
    this.rebuild();
  }

  onCandles(): void {
    this.rebuild();
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    this.removePane();
  }

  private async load(id: MacroOverlayId): Promise<void> {
    this.loading.add(id);
    try {
      const series = await this.fetch(id);
      if (!this.disposed) this.cache.set(id, series.length > 0 ? series : null);
    } catch (err) {
      if (!this.disposed) {
        console.error(`[AXIOM] Échec du fetch macro ${id}`, err);
        this.cache.set(id, null);
      }
    } finally {
      this.loading.delete(id);
    }
    if (!this.disposed) this.rebuild();
  }

  private async fetch(id: MacroOverlayId): Promise<MacroSeries> {
    const candles = marketStore.getState().candles;
    // Fenêtre de récupération = min(début des bougies, now − recul minimal). On ÉLARGIT
    // vers le passé si besoin : sinon une fenêtre intraday courte (ex. 1h ≈ 21 j) ne
    // contient AUCUN point M2 publié (hebdo + délai de publication FRED ~1 mois) → série
    // vide → pas de pane. Avec un recul garanti, le dernier point connu est récupéré, puis
    // buildMacroValueByTime (forward-fill) l'étend sur les bougies (ligne plate en intraday,
    // vraie courbe sur les TF longs où candles[0].time remonte plus loin).
    const start = Math.min(candles[0]?.time ?? Infinity, Date.now() - MACRO_MIN_LOOKBACK_MS);

    // crypto-total ne passe pas par ici (servi en direct depuis le store, cf. sync/rebuild).
    if (id === "stablecoins") {
      return stablecoinsSupplyProvider.fetchSeries({ start, signal: this.abort.signal });
    }

    // Clé personnelle si l'utilisateur en a saisi une ; sinon undefined → le proxy
    // /fredapi injecte la clé de repli (.env). Voir data/macro/fred.ts.
    const key = getFredKey() ?? undefined;
    return fredM2WeeklyProvider.fetchSeries({ start, apiKey: key, signal: this.abort.signal });
  }

  private rebuild(): void {
    if (this.disposed) return;
    const candles = marketStore.getState().candles;
    if (this.enabled.length === 0 || candles.length === 0) {
      this.removePane();
      return;
    }

    const slots: MacroSlot[] = [];
    for (const id of this.enabled) {
      // crypto-total : lu en direct depuis le store persistant (évolue à chaque échantillon) ;
      // les autres mesures viennent du cache async (load/fetch).
      const raw = id === "crypto-total" ? macroHistorySeries("total") : this.cache.get(id);
      if (!raw || raw.length === 0) continue;
      const def = macroDef(id);
      const scaled = scaleMacroSeries(raw, def.scale);
      const valueByTime = buildMacroValueByTime(candles, scaled);
      if (Object.keys(valueByTime).length > 0) slots.push({ key: def.key, valueByTime });
    }

    if (slots.length === 0) {
      this.removePane();
      return;
    }

    const extendData: MacroExtend = { slots };
    if (this.paneId) {
      this.chart.overrideIndicator({ name: MACRO_NAME, extendData }, this.paneId);
    } else {
      const id = this.chart.createIndicator(
        { name: MACRO_NAME, extendData },
        false,
        { id: MACRO_PANE_ID }
      );
      this.paneId = id ?? null;
    }
  }

  private removePane(): void {
    if (!this.paneId) return;
    this.chart.removeIndicator(this.paneId, MACRO_NAME);
    this.paneId = null;
  }
}
