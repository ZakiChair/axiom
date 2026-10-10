/**
 * Tests du pont aux-aware (Task 14, ChartIndicators.computeForInstance/onAuxReady) :
 * les trois branches d'`AuxStatus` (ready/pending/error) et le ciblage mono-instance
 * du callback `onAuxReady`. `computeForInstance` et `onAuxReady` sont PRIVÉES —
 * on les exerce via la surface publique (`setMarket`/`sync`/`recompute`) en spyant
 * la frontière `auxProvider.getAligned` (Task 12, déjà approuvée — pas la logique
 * sous test), comme suggéré par la revue. Le stub `Chart` reprend le style de
 * `indicators.throttle.test.ts`, mais avec de VRAIS spies : `sync()` appelle
 * réellement `createIndicator`/`overrideIndicator`/`removeIndicator`.
 *
 * Def réelle utilisée : `openInterest` (packages/indicators/src/derivatives),
 * `aux: ["oi"]`, `pane: "separate"`, aucun input (donc `shortName` de base =
 * "Open Interest", sans paramètres affichés). Pour les séries FACULTATIVES
 * (`auxFacultatives`, jamais requises) : `stratAxis`, `auxFacultatives: ["oi", "refClose"]`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Chart } from "klinecharts";
import { ChartIndicators, statutIndicateur } from "./indicators";
import { auxProvider, type AuxStatus } from "./auxProvider";
import type { ActiveIndicator } from "../store/indicators";
import type { CalcContext, Candle, IndicatorResult } from "@axiom/types";
import { getIndicator } from "@axiom/indicators";

// `sync()` appelle `ensureRegistered` -> `registerIndicator`/`IndicatorSeries` au premier
// montage d'une instance ; le build UMD de klinecharts ne s'évalue pas correctement hors
// navigateur (pas de `window`) — même contrainte que fibonacci.test.ts/drawing.test.ts/
// volumeRangeOverlay.test.ts : on stub les deux exports runtime utilisés par indicators.ts.
// (vi.mock est hissé par Vitest avant les imports statiques ci-dessus.)
vi.mock("klinecharts", () => ({
  registerIndicator: () => {},
  registerOverlay: () => {},
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
}));

/** Forme minimale de l'objet passé à `createIndicator`/`overrideIndicator` par `sync()`/
 * `recompute()`/`onAuxReady` (cf. indicators.ts) — juste les champs inspectés ici. */
interface IndicatorConfigStub {
  name: string;
  shortName?: string;
  extendData?: IndicatorResult;
}

/** Stub Chart : `createIndicator` renvoie le paneId demandé (comportement réel
 * KLineChart pour un pane à `id` explicite), les deux autres méthodes sont de purs
 * espions — aucune n'est jamais réellement appelée par `computeForInstance`. */
function makeIndicators() {
  const chart = {
    createIndicator: vi.fn((_config: IndicatorConfigStub, _isStack: boolean, opts?: { id: string }) => opts?.id ?? null),
    overrideIndicator: vi.fn((_override: IndicatorConfigStub, _paneId?: string) => {}),
    removeIndicator: vi.fn(),

    // Géométrie : lue par l'équilibrage de hauteur des panes (chart/paneBudget.ts).

    getSize: vi.fn(() => ({ top: 0, left: 0, width: 800, height: 100, right: 800, bottom: 100 })),

    setPaneOptions: vi.fn(),
  };
  const indicators = new ChartIndicators(chart as unknown as Chart);
  return { indicators, chart };
}

const candles: Candle[] = [
  { time: 1_000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
  { time: 2_000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
];

const oiInstance: ActiveIndicator = { instanceId: "oi-1", defId: "openInterest", params: {} , couleurIdx: 0 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChartIndicators — pont aux-aware (Task 14)", () => {
  it("statut ready : shortName SANS suffixe, aux réel injecté dans le calcul", () => {
    const readyStatus: AuxStatus = { status: "ready", aux: { oi: [111, 222] } };
    vi.spyOn(auxProvider, "getAligned").mockReturnValue(readyStatus);
    const { indicators, chart } = makeIndicators();

    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([oiInstance], candles, "binance");

    expect(chart.createIndicator).toHaveBeenCalledTimes(1);
    const [config] = chart.createIndicator.mock.calls[0]!;
    expect(config.shortName).toBe("Open Interest"); // aucun suffixe d'état
    expect(config.extendData?.series.openInterest).toEqual([111, 222]); // aux mocké threadé jusqu'au calc
  });

  it("statut pending : shortName suffixé ' …', résultat all-undefined (garde Task 13, pas de crash)", () => {
    const pendingStatus: AuxStatus = { status: "pending" };
    vi.spyOn(auxProvider, "getAligned").mockReturnValue(pendingStatus);
    const { indicators, chart } = makeIndicators();

    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([oiInstance], candles, "binance");

    const [config] = chart.createIndicator.mock.calls[0]!;
    expect(config.shortName).toBe("Open Interest …");
    expect(config.extendData?.series.openInterest).toEqual([undefined, undefined]); // pas de données réelles
  });

  it("statut error : shortName suffixé ' (UNUSABLE)'", () => {
    const errorStatus: AuxStatus = { status: "error", message: "source injoignable" };
    vi.spyOn(auxProvider, "getAligned").mockReturnValue(errorStatus);
    const { indicators, chart } = makeIndicators();

    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([oiInstance], candles, "binance");

    const [config] = chart.createIndicator.mock.calls[0]!;
    expect(config.shortName).toBe("Open Interest (UNUSABLE)");
  });

  it("statut ready sans aucune sortie finie : shortName suffixé ' (UNUSABLE)'", () => {
    const readyStatus: AuxStatus = { status: "ready", aux: { oi: [] } };
    vi.spyOn(auxProvider, "getAligned").mockReturnValue(readyStatus);
    const { indicators, chart } = makeIndicators();

    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([oiInstance], candles, "binance");

    const [config] = chart.createIndicator.mock.calls[0]!;
    expect(config.shortName).toBe("Open Interest (UNUSABLE)");
    expect(config.extendData?.series.openInterest).toEqual([undefined, undefined]);
  });

  it("contexte incompatible : court-circuite le fetch aux et affiche UNUSABLE", () => {
    const getAlignedSpy = vi.spyOn(auxProvider, "getAligned").mockReturnValue({ status: "pending" });
    const { indicators, chart } = makeIndicators();

    indicators.setMarket("SPY", "1h");
    indicators.sync([oiInstance], candles, "twelvedata");

    expect(getAlignedSpy).not.toHaveBeenCalled();
    const [config] = chart.createIndicator.mock.calls[0]!;
    expect(config.shortName).toBe("Open Interest (UNUSABLE)");
  });

  it("recompute renvoie le shortName d'un indicateur sans aux contextuellement UNUSABLE", () => {
    const cvdInstance: ActiveIndicator = { instanceId: "cvd-1", defId: "cvd", params: { smooth: 1 }, couleurIdx: 0 };
    const { indicators, chart } = makeIndicators();

    indicators.setMarket("BTCUSD", "1h");
    indicators.sync([cvdInstance], candles, "kraken");
    expect(chart.createIndicator.mock.calls[0]![0].shortName).toBe("CVD (Volume Delta cumulé) (1) (UNUSABLE)");

    chart.overrideIndicator.mockClear();
    indicators.recompute([cvdInstance], candles, "kraken");

    expect(chart.overrideIndicator.mock.calls[0]![0].shortName).toBe("CVD (Volume Delta cumulé) (1) (UNUSABLE)");
  });

  it("ne classe pas UNUSABLE une stratégie sans aux qui n'a temporairement aucun trade", () => {
    const strategy: ActiveIndicator = {
      instanceId: "strategy-1",
      defId: "stratRsiReversion",
      params: { length: 14, survente: 30, surachat: 70, lignesTrades: true },
      couleurIdx: 0,
    };
    const { indicators, chart } = makeIndicators();

    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([strategy], candles, "binance");

    const [config] = chart.createIndicator.mock.calls[0]!;
    expect(config.extendData?.series.prixEntree).toEqual([undefined, undefined]);
    expect(config.shortName).toBe("Stratégie RSI réversion (14, 30, 70)");
    // Ni UNUSABLE ni « indisponible » : une stratégie à plat n'a rien à signaler.
    expect(statutIndicateur(chart as unknown as Chart, "strategy-1")).toBeNull();
  });

  it("le suffixe n'est PAS collant : un recompute() en ready après un pending revient à un shortName sans suffixe", () => {
    const pendingStatus: AuxStatus = { status: "pending" };
    const readyStatus: AuxStatus = { status: "ready", aux: { oi: [1, 2] } };
    const getAlignedSpy = vi.spyOn(auxProvider, "getAligned").mockReturnValueOnce(pendingStatus);
    const { indicators, chart } = makeIndicators();

    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([oiInstance], candles, "binance"); // 1er passage : pending
    expect(chart.createIndicator.mock.calls[0]![0].shortName).toBe("Open Interest …");

    getAlignedSpy.mockReturnValue(readyStatus); // le fetch aboutit
    indicators.recompute([oiInstance], candles, "binance"); // params inchangés -> sync() no-opérerait, recompute() repasse toujours

    const overrideCall = chart.overrideIndicator.mock.calls.at(-1)!;
    expect(overrideCall[0].shortName).toBe("Open Interest"); // suffixe retombé, pas resté collé à " …"
  });

  it("onAuxReady cible UNIQUEMENT l'instance concernée : pas de recréation de pane, pas d'override de l'autre instance", () => {
    const readyCallbacks: Array<() => void> = [];
    const getAlignedSpy = vi.spyOn(auxProvider, "getAligned").mockImplementation((_req, onReady) => {
      readyCallbacks.push(onReady);
      return { status: "pending" };
    });
    const { indicators, chart } = makeIndicators();
    const inst1: ActiveIndicator = { instanceId: "oi-1", defId: "openInterest", params: {} , couleurIdx: 0 };
    const inst2: ActiveIndicator = { instanceId: "oi-2", defId: "openInterest", params: {} , couleurIdx: 0 };

    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([inst1, inst2], candles, "binance");

    expect(chart.createIndicator).toHaveBeenCalledTimes(2); // 2 panes créés
    expect(readyCallbacks).toHaveLength(2); // 1 onReady capturé par instance

    chart.createIndicator.mockClear();
    chart.overrideIndicator.mockClear();
    chart.removeIndicator.mockClear();
    getAlignedSpy.mockImplementation(() => ({ status: "ready", aux: { oi: [9, 9] } }));

    readyCallbacks[0]!(); // simule la résolution du fetch aux pour oi-1 SEULEMENT

    expect(chart.overrideIndicator).toHaveBeenCalledTimes(1); // pas d'override pour oi-2
    const [config, paneId] = chart.overrideIndicator.mock.calls[0]!;
    expect(config.name).toBe("AXIOM_oi-1");
    expect(paneId).toBe("axiom_oi-1"); // deuxième arg de overrideIndicator (cf. IndicatorConfigStub)
    expect(chart.createIndicator).not.toHaveBeenCalled(); // jamais de re-création de pane
    expect(chart.removeIndicator).not.toHaveBeenCalled();
  });
});

describe("ChartIndicators — séries auxiliaires facultatives (auxFacultatives)", () => {
  const axis: ActiveIndicator = { instanceId: "axis-1", defId: "stratAxis", params: { emaTendance: 50 }, couleurIdx: 0 };
  // Sinusoïde de période 60 : AXIS (EMA de tendance 50) y alterne achats et ventes.
  const sinus: Candle[] = Array.from({ length: 400 }, (_v, i) => {
    const c = 100 + 10 * Math.sin((2 * Math.PI * i) / 60) + (i % 7) * 0.05;
    return { time: i * 3_600_000, open: c - 0.2, high: c + 1, low: c - 1, close: c, volume: 10 + (i % 5) };
  });
  const infos = (config: IndicatorConfigStub) => (config.extendData?.annotations?.marqueurs ?? []).map((m) => m.info ?? "");

  it("pending ou error : ni suffixe ni statut, le def calcule sans la série (lecture « OI n.d. »)", () => {
    for (const status of [{ status: "pending" }, { status: "error", message: "source injoignable" }] as AuxStatus[]) {
      const spy = vi.spyOn(auxProvider, "getAligned").mockReturnValue(status);
      const { indicators, chart } = makeIndicators();
      indicators.setMarket("BTCUSDT", "1h");
      indicators.sync([axis], sinus, "binance");
      expect(spy.mock.calls[0]![0].ids).toEqual(["oi", "refClose"]);
      const [config] = chart.createIndicator.mock.calls[0]!;
      expect(config.shortName).toBe("AXIS (50)");
      expect(statutIndicateur(chart as unknown as Chart, "axis-1")).toBeNull();
      const lus = infos(config);
      expect(lus.length).toBeGreaterThan(0);
      expect(lus.every((info) => info.includes("OI n.d."))).toBe(true);
      vi.restoreAllMocks();
    }
  });

  it("ready : la série facultative atteint le calcul (lecture « OI +x % »), toujours sans suffixe", () => {
    const oi = sinus.map((_c, i) => 100 + i);
    vi.spyOn(auxProvider, "getAligned").mockReturnValue({ status: "ready", aux: { oi } });
    const { indicators, chart } = makeIndicators();
    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([axis], sinus, "binance");
    const [config] = chart.createIndicator.mock.calls[0]!;
    expect(config.shortName).toBe("AXIS (50)");
    const lus = infos(config);
    expect(lus.length).toBeGreaterThan(0);
    expect(lus.every((info) => /OI \+\d+\.\d % sur 6 b\./.test(info))).toBe(true);
  });

  it("contexte qui ne peut pas servir l'OI (symbole hors perp USDT) : oi non demandée, refClose oui, def complet et utilisable", () => {
    const spy = vi.spyOn(auxProvider, "getAligned");
    const { indicators, chart } = makeIndicators();
    indicators.setMarket("BTC/USD", "1h");
    indicators.sync([axis], sinus, "kraken");
    // oi est hors contexte ; refClose (garde-fou de régime, référence du chart) reste servie.
    expect(spy.mock.calls[0]![0].ids).toEqual(["refClose"]);
    const [config] = chart.createIndicator.mock.calls[0]!;
    expect(config.shortName).toBe("AXIS (50)");
    expect(statutIndicateur(chart as unknown as Chart, "axis-1")).toBeNull();
    expect(infos(config).every((info) => info.includes("OI n.d."))).toBe(true);
  });
});

describe("ChartIndicators — unité de temps transmise au calcul (ctx.timeframe)", () => {
  /** Unités lues par le `calc` espionné, dans l'ordre des appels. */
  const unitesLues = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((args) => (args[2] as CalcContext).timeframe);

  it("def sans aux : l'unité courante atteint le calc", () => {
    const calc = vi.spyOn(getIndicator("ema")!, "calc");
    const { indicators } = makeIndicators();
    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([{ instanceId: "ema-1", defId: "ema", params: {}, couleurIdx: 0 }], candles, "binance");
    expect(unitesLues(calc)).toEqual(["1h"]);
  });

  it("def avec auxFacultatives (servies ou non) et def avec aux requis : l'unité courante atteint le calc", () => {
    const axis: ActiveIndicator = { instanceId: "axis-1", defId: "stratAxis", params: {}, couleurIdx: 0 };
    for (const status of [{ status: "ready", aux: { oi: [1, 2] } }, { status: "pending" }] as AuxStatus[]) {
      vi.spyOn(auxProvider, "getAligned").mockReturnValue(status);
      const calcAxis = vi.spyOn(getIndicator("stratAxis")!, "calc");
      const calcOi = vi.spyOn(getIndicator("openInterest")!, "calc");
      const { indicators } = makeIndicators();
      indicators.setMarket("BTCUSDT", "4h");
      indicators.sync([axis, oiInstance], candles, "binance");
      expect(unitesLues(calcAxis)).toEqual(["4h"]);
      expect(unitesLues(calcOi)).toEqual(["4h"]);
      vi.restoreAllMocks();
    }
  });

  it("changement d'unité avec la MÊME référence de bougies : le résultat mémoïsé de l'ancienne unité n'est pas resservi", () => {
    const calc = vi.spyOn(getIndicator("ema")!, "calc");
    const ema: ActiveIndicator = { instanceId: "ema-1", defId: "ema", params: {}, couleurIdx: 0 };
    const { indicators } = makeIndicators();
    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([ema], candles, "binance");
    indicators.recompute([ema], candles, "binance");
    expect(unitesLues(calc)).toEqual(["1h"]); // même unité, mêmes bougies : cache servi
    indicators.setMarket("BTCUSDT", "1d");
    indicators.recompute([ema], candles, "binance");
    expect(unitesLues(calc)).toEqual(["1h", "1d"]);
  });
});
