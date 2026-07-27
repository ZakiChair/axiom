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
 * "Open Interest", sans paramètres affichés).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Chart } from "klinecharts";
import { ChartIndicators } from "./indicators";
import { auxProvider, type AuxStatus } from "./auxProvider";
import type { ActiveIndicator } from "../store/indicators";
import type { Candle, IndicatorResult } from "@axiom/types";

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
  };
  const indicators = new ChartIndicators(chart as unknown as Chart);
  return { indicators, chart };
}

const candles: Candle[] = [
  { time: 1_000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
  { time: 2_000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
];

const oiInstance: ActiveIndicator = { instanceId: "oi-1", defId: "openInterest", params: {} };

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

  it("statut error : shortName suffixé ' (indisponible)'", () => {
    const errorStatus: AuxStatus = { status: "error", message: "source injoignable" };
    vi.spyOn(auxProvider, "getAligned").mockReturnValue(errorStatus);
    const { indicators, chart } = makeIndicators();

    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([oiInstance], candles, "binance");

    const [config] = chart.createIndicator.mock.calls[0]!;
    expect(config.shortName).toBe("Open Interest (indisponible)");
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
    const inst1: ActiveIndicator = { instanceId: "oi-1", defId: "openInterest", params: {} };
    const inst2: ActiveIndicator = { instanceId: "oi-2", defId: "openInterest", params: {} };

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
