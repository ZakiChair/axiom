import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McapSnapshot } from "../store/macroHistory";
import { macroHistoryStore } from "../store/macroHistory";

const {
  chargerHistoriqueCcDataMock,
  historiqueCcDataDisponibleMock,
  chargerHistoriqueCmcMock,
  fetchPageHistoriqueCmcMock,
  historiqueCmcDisponibleMock,
} = vi.hoisted(() => ({
  chargerHistoriqueCcDataMock: vi.fn<() => Promise<McapSnapshot[] | null>>(),
  historiqueCcDataDisponibleMock: vi.fn<() => boolean>(),
  chargerHistoriqueCmcMock: vi.fn<() => Promise<McapSnapshot[] | null>>(),
  fetchPageHistoriqueCmcMock: vi.fn<
    (intervalle: "1h" | "4h" | "1d", options?: { endTime?: number; limit?: number }) => Promise<McapSnapshot[]>
  >(),
  historiqueCmcDisponibleMock: vi.fn<() => boolean>(),
}));

vi.mock("./ccdataMcap", () => ({
  chargerHistoriqueCcData: chargerHistoriqueCcDataMock,
  historiqueCcDataDisponible: historiqueCcDataDisponibleMock,
}));

vi.mock("./cmcMcap", () => ({
  chargerHistoriqueCmc: chargerHistoriqueCmcMock,
  fetchPageHistoriqueCmc: fetchPageHistoriqueCmcMock,
  historiqueCmcDisponible: historiqueCmcDisponibleMock,
}));

import {
  capitalisationAdapter,
  construireBougiesCapitalisation,
  sourcesCapitalisationStore,
} from "./mcapCandles";

const JOUR = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

function snapshot(t: number, total: number, total2 = total / 2, total3 = total / 4): McapSnapshot {
  return { t, total, total2, total3 };
}

beforeEach(() => {
  chargerHistoriqueCmcMock.mockReset().mockResolvedValue(null);
  fetchPageHistoriqueCmcMock.mockReset().mockResolvedValue([]);
  historiqueCmcDisponibleMock.mockReset().mockReturnValue(false);
  chargerHistoriqueCcDataMock.mockReset().mockResolvedValue(null);
  historiqueCcDataDisponibleMock.mockReset().mockReturnValue(false);
  sourcesCapitalisationStore.setState({ sources: {} });
});

afterEach(() => {
  vi.useRealTimers();
  macroHistoryStore.setState({ snapshots: [] });
});

describe("construireBougiesCapitalisation", () => {
  it("agrège les échantillons en OHLC journaliers triés et continus", () => {
    const candles = construireBougiesCapitalisation(
      [
        snapshot(T0 + JOUR + 23 * 3_600_000, 120),
        snapshot(T0, 100),
        snapshot(T0 + 2 * JOUR, 115),
        snapshot(T0 + JOUR + 12 * 3_600_000, 90),
        snapshot(T0 + JOUR + 3_600_000, 110),
      ],
      "TOTAL",
      "1d",
      T0 + 3 * JOUR,
    );

    expect(candles).toEqual([
      { time: T0, open: 100, high: 100, low: 100, close: 100, volume: 0, closed: true },
      { time: T0 + JOUR, open: 100, high: 120, low: 90, close: 120, volume: 0, closed: true },
      { time: T0 + 2 * JOUR, open: 120, high: 120, low: 115, close: 115, volume: 0, closed: true },
    ]);
  });

  it("sélectionne TOTAL2 et TOTAL3 sans mélanger les mesures", () => {
    const snapshots = [
      snapshot(T0, 1_000, 600, 400),
      snapshot(T0 + JOUR, 1_100, 650, 420),
    ];

    expect(construireBougiesCapitalisation(snapshots, "TOTAL2", "1d", T0 + 2 * JOUR).map((c) => c.close)).toEqual([600, 650]);
    expect(construireBougiesCapitalisation(snapshots, "TOTAL3", "1d", T0 + 2 * JOUR).map((c) => c.close)).toEqual([400, 420]);
  });

  it("écarte les valeurs non finies ou non positives", () => {
    const snapshots = [
      snapshot(T0, 100),
      snapshot(T0 + JOUR, Number.NaN),
      snapshot(T0 + 2 * JOUR, 0),
      snapshot(T0 + 3 * JOUR, 130),
    ];

    expect(construireBougiesCapitalisation(snapshots, "TOTAL", "1d", T0 + 4 * JOUR).map((c) => c.close)).toEqual([100, 130]);
  });

  it("agrège les points horaires en vraies bougies 4h", () => {
    const valeurs = [100, 120, 90, 110, 130];
    const candles = construireBougiesCapitalisation(
      valeurs.map((valeur, i) => snapshot(T0 + i * 3_600_000, valeur)),
      "TOTAL",
      "4h",
      T0 + 8 * 3_600_000,
    );

    expect(candles).toEqual([
      { time: T0, open: 100, high: 120, low: 90, close: 110, volume: 0, closed: true },
      { time: T0 + 4 * 3_600_000, open: 110, high: 130, low: 110, close: 130, volume: 0, closed: true },
    ]);
  });

  it("utilise des buckets semaine UTC et mois calendaires", () => {
    const dates = [Date.UTC(2026, 0, 31), Date.UTC(2026, 1, 2), Date.UTC(2026, 3, 1)];
    const snapshots = dates.map((t, i) => snapshot(t, 100 + i * 10));

    expect(construireBougiesCapitalisation(snapshots, "TOTAL", "1w").map((c) => c.time)).toEqual([
      Date.UTC(2026, 0, 26),
      Date.UTC(2026, 1, 2),
      Date.UTC(2026, 2, 30),
    ]);
    expect(construireBougiesCapitalisation(snapshots, "TOTAL", "1M").map((c) => c.time)).toEqual([
      Date.UTC(2026, 0, 1),
      Date.UTC(2026, 1, 1),
      Date.UTC(2026, 3, 1),
    ]);
    expect(construireBougiesCapitalisation(snapshots, "TOTAL", "3M").map((c) => c.time)).toEqual([
      Date.UTC(2026, 0, 1),
      Date.UTC(2026, 3, 1),
    ]);
    expect(construireBougiesCapitalisation(snapshots, "TOTAL", "6M").map((c) => c.time)).toEqual([
      Date.UTC(2026, 0, 1),
    ]);
    expect(construireBougiesCapitalisation(snapshots, "TOTAL", "12M").map((c) => c.time)).toEqual([
      Date.UTC(2026, 0, 1),
    ]);
  });
});

describe("capitalisationAdapter", () => {
  it("publie la provenance réellement servie, pas la source disponible", async () => {
    chargerHistoriqueCmcMock.mockResolvedValue([snapshot(T0, 100)]);
    await capitalisationAdapter.fetchKlines("TOTAL", "1d", { limit: 10 });
    expect(sourcesCapitalisationStore.getState().sources["TOTAL:1d"]).toBe("cmc");

    chargerHistoriqueCmcMock.mockResolvedValue(null);
    chargerHistoriqueCcDataMock.mockResolvedValue([snapshot(T0, 100)]);
    await capitalisationAdapter.fetchKlines("TOTAL", "1d", { limit: 10 });
    expect(sourcesCapitalisationStore.getState().sources["TOTAL:1d"]).toBe("ccdata");
  });

  it("étiquette CoinGecko le repli intraday même quand le cache CMC daily existe", async () => {
    // Scénario du constat : endpoint intraday CMC en panne + cache daily présent →
    // les bougies servies viennent de macroHistory (CoinGecko), le bandeau doit le dire.
    historiqueCmcDisponibleMock.mockReturnValue(true);
    fetchPageHistoriqueCmcMock.mockRejectedValue(new Error("quota"));
    macroHistoryStore.setState({ snapshots: [snapshot(T0, 100)] });

    await capitalisationAdapter.fetchKlines("TOTAL", "1h", { limit: 10 });

    expect(sourcesCapitalisationStore.getState().sources["TOTAL:1h"]).toBe("coingecko");
  });

  it("respecte endTime et limit sur TOTAL", async () => {
    macroHistoryStore.setState({
      snapshots: [
        snapshot(T0, 100),
        snapshot(T0 + JOUR, 110),
        snapshot(T0 + 2 * JOUR, 120),
        snapshot(T0 + 3 * JOUR, 130),
      ],
    });

    const candles = await capitalisationAdapter.fetchKlines("TOTAL", "1d", {
      endTime: T0 + 2 * JOUR,
      limit: 2,
    });

    expect(candles.map((c) => c.time)).toEqual([T0 + JOUR, T0 + 2 * JOUR]);
    expect(candles.map((c) => c.close)).toEqual([110, 120]);
  });

  it("préfère l'historique CMC public sans clé", async () => {
    chargerHistoriqueCmcMock.mockResolvedValue(
      Array.from({ length: 120 }, (_, i) => snapshot(T0 - (119 - i) * JOUR, 2_000 + i)),
    );
    chargerHistoriqueCcDataMock.mockResolvedValue(
      Array.from({ length: 90 }, (_, i) => snapshot(T0 - (89 - i) * JOUR, 1_000 + i)),
    );

    const candles = await capitalisationAdapter.fetchKlines("TOTAL", "1d", { limit: 500 });

    expect(candles).toHaveLength(120);
    expect(candles.at(-1)?.close).toBe(2_119);
    expect(chargerHistoriqueCcDataMock).not.toHaveBeenCalled();
  });

  it("utilise CCData en repli avant le court historique local", async () => {
    macroHistoryStore.setState({ snapshots: [snapshot(T0, 10), snapshot(T0 + JOUR, 20)] });
    chargerHistoriqueCcDataMock.mockResolvedValue(
      Array.from({ length: 90 }, (_, i) => snapshot(T0 - (89 - i) * JOUR, 1_000 + i)),
    );

    const candles = await capitalisationAdapter.fetchKlines("TOTAL3", "1d", { limit: 500 });

    expect(candles).toHaveLength(90);
    expect(candles.at(-1)?.close).toBe((1_000 + 89) / 4);
  });

  it("charge les timeframes intraday par page CMC", async () => {
    fetchPageHistoriqueCmcMock.mockResolvedValue([
      snapshot(T0, 100),
      snapshot(T0 + 3_600_000, 110),
      snapshot(T0 + 2 * 3_600_000, 105),
    ]);

    const candles = await capitalisationAdapter.fetchKlines("TOTAL", "1h", {
      endTime: T0 + 2 * 3_600_000,
      limit: 3,
    });

    expect(fetchPageHistoriqueCmcMock).toHaveBeenCalledWith("1h", {
      endTime: T0 + 2 * 3_600_000,
      limit: 3,
    });
    expect(candles.map((c) => c.close)).toEqual([100, 110, 105]);
    expect(chargerHistoriqueCmcMock).not.toHaveBeenCalled();
  });

  it("refuse un symbole ou un timeframe non exposé", async () => {
    await expect(capitalisationAdapter.fetchKlines("BTCUSDT", "1d")).rejects.toThrow(/capitalisation/i);
    await expect(capitalisationAdapter.fetchKlines("TOTAL", "5m")).rejects.toThrow(/timeframe/i);
  });

  it("émet la bougie journalière mise à jour et se désabonne", () => {
    macroHistoryStore.setState({ snapshots: [snapshot(T0, 100)] });
    const callback = vi.fn();
    const unsubscribe = capitalisationAdapter.subscribeKline("TOTAL", "1d", callback);

    macroHistoryStore.setState({ snapshots: [snapshot(T0, 100), snapshot(T0 + 12 * 3_600_000, 120)] });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0]).toMatchObject({ time: T0, open: 100, high: 120, low: 100, close: 120 });

    unsubscribe();
    macroHistoryStore.setState({ snapshots: [snapshot(T0, 100), snapshot(T0 + 18 * 3_600_000, 140)] });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("ne mélange pas les ticks CoinGecko avec un historique CMC actif", () => {
    historiqueCmcDisponibleMock.mockReturnValue(true);
    const callback = vi.fn();
    const unsubscribe = capitalisationAdapter.subscribeKline("TOTAL", "1d", callback);

    macroHistoryStore.setState({ snapshots: [snapshot(T0, 100)] });
    expect(callback).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("rafraîchit la bougie courante par repoll CMC quand l'historique CMC est actif", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 90 * 60_000); // 01:30 UTC → bucket 1h courant : T0 + 1 h
    historiqueCmcDisponibleMock.mockReturnValue(true);
    // Source réellement servie par le dernier fetchKlines : "cmc" (comme en usage réel,
    // fetchKlines peuple le graphe AVANT que subscribeKline ne démarre le repoll).
    sourcesCapitalisationStore.setState({ sources: { "TOTAL:1h": "cmc" } });
    fetchPageHistoriqueCmcMock.mockResolvedValue([
      snapshot(T0, 100), // dernier point du bucket précédent → open forward-fillé cohérent
      snapshot(T0 + 3_600_000, 110),
      snapshot(T0 + 90 * 60_000, 115),
    ]);
    const callback = vi.fn();
    const unsubscribe = capitalisationAdapter.subscribeKline("TOTAL", "1h", callback);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchPageHistoriqueCmcMock).toHaveBeenCalledWith("1h", { limit: 3 });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0]).toMatchObject({
      time: T0 + 3_600_000,
      open: 100,
      close: 115,
    });

    // Page identique → signature identique → pas de ré-émission.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchPageHistoriqueCmcMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("ne pousse pas de bougie CMC en repoll si la source réellement servie n'est pas CMC (pas de mélange de niveaux)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 90 * 60_000);
    historiqueCmcDisponibleMock.mockReturnValue(true);
    // Repli CoinGecko déjà en place (ex. panne de l'endpoint intraday CMC avec un cache
    // daily présent) : fetchKlines a publié "coingecko", pas "cmc", pour ce symbole:tf.
    sourcesCapitalisationStore.setState({ sources: { "TOTAL:1h": "coingecko" } });
    fetchPageHistoriqueCmcMock.mockResolvedValue([
      snapshot(T0, 100),
      snapshot(T0 + 3_600_000, 110),
      snapshot(T0 + 90 * 60_000, 115),
    ]);
    const callback = vi.fn();
    const unsubscribe = capitalisationAdapter.subscribeKline("TOTAL", "1h", callback);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchPageHistoriqueCmcMock).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();

    unsubscribe();
    vi.useRealTimers();
  });
});
