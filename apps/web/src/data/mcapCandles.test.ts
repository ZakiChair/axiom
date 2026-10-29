import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle, Timeframe } from "@axiom/types";
import type { McapSnapshot } from "../store/macroHistory";
import { macroHistoryStore } from "../store/macroHistory";
import { dataLoadErrorMessage } from "../chart/dataLoadErrorMessage";

const {
  chargerHistoriqueCcDataMock,
  historiqueCcDataDisponibleMock,
  chargerHistoriqueCmcMock,
  fetchPageHistoriqueCmcMock,
  historiqueCmcDisponibleMock,
  fetchKlinesDominanceMock,
  abonnerDominanceMock,
} = vi.hoisted(() => ({
  chargerHistoriqueCcDataMock: vi.fn<() => Promise<McapSnapshot[] | null>>(),
  historiqueCcDataDisponibleMock: vi.fn<() => boolean>(),
  chargerHistoriqueCmcMock: vi.fn<() => Promise<McapSnapshot[] | null>>(),
  fetchPageHistoriqueCmcMock: vi.fn<
    (intervalle: "1h" | "4h" | "1d", options?: { endTime?: number; limit?: number }) => Promise<McapSnapshot[]>
  >(),
  historiqueCmcDisponibleMock: vi.fn<() => boolean>(),
  fetchKlinesDominanceMock: vi.fn<(tf: Timeframe, opts?: { endTime?: number; limit?: number }) => Promise<Candle[]>>(),
  abonnerDominanceMock: vi.fn<(tf: Timeframe, cb: (bougie: Candle) => void) => () => void>(),
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

// Module paresseux de STABLE.D (chargé par import()) : vi.mock intercepte aussi les imports dynamiques.
vi.mock("./dominanceStablecoins", () => ({
  bougiesDominance: fetchKlinesDominanceMock,
  abonnerDominance: abonnerDominanceMock,
}));

import {
  abonnerApresChargement,
  capitalisationAdapter,
  chargeurMemorise,
  construireBougiesCapitalisation,
  construireBougiesSerie,
  sourcesCapitalisationStore,
} from "./mcapCandles";

const JOUR = 86_400_000;
const HEURE = 3_600_000;
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
  fetchKlinesDominanceMock.mockReset().mockResolvedValue([]);
  abonnerDominanceMock.mockReset().mockReturnValue(() => {});
  sourcesCapitalisationStore.setState({ sources: {} });
});

/** Laisse arriver le chunk simulé (import() dynamique + microtâches de son `then`). */
async function chunkCharge(): Promise<void> {
  await vi.dynamicImportSettled();
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

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

describe("construireBougiesSerie — constructeur générique depuis une série {t, v}", () => {
  it("1d : open = clôture précédente, haut/bas sur les points du bucket, volume 0, closed selon la fin du bucket", () => {
    const bougies = construireBougiesSerie(
      [
        { t: T0 + JOUR + 12 * HEURE, v: 9.4 },
        { t: T0, v: 9.5 },
        { t: T0 + JOUR, v: 9.6 },
        { t: T0 + 2 * JOUR, v: 9.55 },
      ],
      "1d",
      T0 + 2 * JOUR + HEURE,
    );

    expect(bougies).toEqual([
      { time: T0, open: 9.5, high: 9.5, low: 9.5, close: 9.5, volume: 0, closed: true },
      { time: T0 + JOUR, open: 9.5, high: 9.6, low: 9.4, close: 9.4, volume: 0, closed: true },
      // Bucket du jour encore ouvert à « maintenant ».
      { time: T0 + 2 * JOUR, open: 9.4, high: 9.55, low: 9.4, close: 9.55, volume: 0, closed: false },
    ]);
  });

  it("1w : semaines UTC commençant le lundi, ouverture = clôture de la semaine précédente", () => {
    // 2026-01-01 est un jeudi : semaine du lundi 2025-12-29.
    const bougies = construireBougiesSerie(
      [
        { t: Date.UTC(2026, 0, 1), v: 9.2 },
        { t: Date.UTC(2026, 0, 4), v: 9.0 },
        { t: Date.UTC(2026, 0, 5), v: 9.3 },
      ],
      "1w",
      Date.UTC(2026, 0, 20),
    );

    expect(bougies).toEqual([
      { time: Date.UTC(2025, 11, 29), open: 9.2, high: 9.2, low: 9.0, close: 9.0, volume: 0, closed: true },
      { time: Date.UTC(2026, 0, 5), open: 9.0, high: 9.3, low: 9.0, close: 9.3, volume: 0, closed: true },
    ]);
  });

  it("écarte les valeurs non finies ou non positives (somme nulle avant USDT : rien n'est tracé)", () => {
    const bougies = construireBougiesSerie(
      [
        { t: T0, v: 0 },
        { t: T0 + JOUR, v: Number.NaN },
        { t: Number.NaN, v: 9 },
        { t: T0 + 2 * JOUR, v: 9.1 },
      ],
      "1d",
      T0 + 3 * JOUR,
    );

    expect(bougies.map((bougie) => [bougie.time, bougie.open, bougie.close])).toEqual([[T0 + 2 * JOUR, 9.1, 9.1]]);
  });

  it("MESURE_PAR_SYMBOLE ne connaît que les capitalisations en USD : STABLE.D refusée dès la compilation", () => {
    // Si le typage acceptait un jour STABLE.D, ce @ts-expect-error ferait échouer `tsc`.
    // @ts-expect-error — une dominance (en %) n'a aucune mesure de McapSnapshot.
    const bougies = construireBougiesCapitalisation([snapshot(T0, 100)], "STABLE.D", "1d", T0 + JOUR);
    expect(bougies).toEqual([]);
  });

  it("TOTAL passe par la projection de sa mesure : mêmes bougies que la série {t, total}", () => {
    const snapshots = [snapshot(T0, 1_000, 600, 400), snapshot(T0 + JOUR, 1_100, 650, 420)];
    for (const [symbole, mesure] of [["TOTAL", "total"], ["TOTAL2", "total2"], ["TOTAL3", "total3"]] as const) {
      expect(construireBougiesCapitalisation(snapshots, symbole, "1d", T0 + 2 * JOUR)).toEqual(
        construireBougiesSerie(snapshots.map((s) => ({ t: s.t, v: s[mesure] })), "1d", T0 + 2 * JOUR),
      );
    }
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

describe("STABLE.D — aiguillage vers le module paresseux de la dominance", () => {
  const BOUGIE: Candle = { time: T0, open: 9.6, high: 9.6, low: 9.5, close: 9.51, volume: 0, closed: true };

  it("fetchKlines délègue au module, publie la provenance « cmc » seule, sans aucune chaîne TOTAL", async () => {
    fetchKlinesDominanceMock.mockResolvedValue([BOUGIE]);
    macroHistoryStore.setState({ snapshots: [snapshot(T0, 100)] });

    const bougies = await capitalisationAdapter.fetchKlines("STABLE.D", "1d", { limit: 10 });

    expect(bougies).toEqual([BOUGIE]);
    expect(fetchKlinesDominanceMock).toHaveBeenCalledWith("1d", { limit: 10 });
    expect(sourcesCapitalisationStore.getState().sources).toEqual({ "STABLE.D:1d": "cmc" });
    expect(chargerHistoriqueCmcMock).not.toHaveBeenCalled();
    expect(fetchPageHistoriqueCmcMock).not.toHaveBeenCalled();
    expect(chargerHistoriqueCcDataMock).not.toHaveBeenCalled();
  });

  it("échec du module : rejet explicite, aucune bascule CCData/CoinGecko, aucune provenance publiée", async () => {
    fetchKlinesDominanceMock.mockRejectedValue(new Error("Dominance stablecoins indisponible : CoinMarketCap public ne répond pas"));
    chargerHistoriqueCcDataMock.mockResolvedValue([snapshot(T0, 100)]);
    macroHistoryStore.setState({ snapshots: [snapshot(T0, 100)] });

    await expect(capitalisationAdapter.fetchKlines("STABLE.D", "1h", { limit: 10 })).rejects.toThrow(/Dominance stablecoins indisponible/);
    await expect(capitalisationAdapter.fetchKlines("STABLE.D", "1d")).rejects.toThrow(/Dominance stablecoins indisponible/);

    expect(chargerHistoriqueCcDataMock).not.toHaveBeenCalled();
    expect(sourcesCapitalisationStore.getState().sources).toEqual({});
  });

  it("refuse un timeframe non exposé avant tout chargement du module", async () => {
    await expect(capitalisationAdapter.fetchKlines("STABLE.D", "5m")).rejects.toThrow(/timeframe/i);
    expect(fetchKlinesDominanceMock).not.toHaveBeenCalled();
  });

  it("TOTAL reste sur sa chaîne : le module de dominance n'est jamais sollicité", async () => {
    chargerHistoriqueCmcMock.mockResolvedValue([snapshot(T0, 100)]);
    await capitalisationAdapter.fetchKlines("TOTAL", "1d", { limit: 10 });
    capitalisationAdapter.subscribeKline("TOTAL3", "1d", vi.fn())();
    await chunkCharge();

    expect(fetchKlinesDominanceMock).not.toHaveBeenCalled();
    expect(abonnerDominanceMock).not.toHaveBeenCalled();
    expect(sourcesCapitalisationStore.getState().sources).toEqual({ "TOTAL:1d": "cmc" });
  });

  it("désabonnement AVANT l'arrivée du chunk : aucun abonnement, donc aucun minuteur orphelin", async () => {
    const off = capitalisationAdapter.subscribeKline("STABLE.D", "1d", vi.fn());
    off();
    await chunkCharge();

    expect(abonnerDominanceMock).not.toHaveBeenCalled();
  });

  it("après le chunk : délègue au module (pas de mode dégradé macroHistory) et le désabonnement l'arrête", async () => {
    const arret = vi.fn();
    abonnerDominanceMock.mockReturnValue(arret);
    const cb = vi.fn();

    const off = capitalisationAdapter.subscribeKline("STABLE.D", "4h", cb);
    await chunkCharge();
    expect(abonnerDominanceMock).toHaveBeenCalledWith("4h", cb);

    macroHistoryStore.setState({ snapshots: [snapshot(T0, 100), snapshot(T0 + JOUR, 120)] });
    expect(cb).not.toHaveBeenCalled();

    off();
    expect(arret).toHaveBeenCalledTimes(1);
  });
});

describe("chargement paresseux — briques génériques", () => {
  it("chargeurMemorise : un seul import() en vol, l'échec est oublié (coupure réseau passagère ; un redéploiement, lui, exige un rechargement)", async () => {
    let essais = 0;
    const importer = vi.fn(async () => {
      essais += 1;
      if (essais === 1) throw new Error("réseau coupé");
      return { pret: true };
    });
    const charger = chargeurMemorise(importer);

    await expect(charger()).rejects.toThrow("réseau coupé");
    const premier = charger();
    expect(charger()).toBe(premier);
    await expect(premier).resolves.toEqual({ pret: true });
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it("abonnerApresChargement : sûr dans les deux ordres, et inerte si le chunk ne charge pas", async () => {
    let livrer: (module: string) => void = () => {};
    const arret = vi.fn();
    const abonner = vi.fn(() => arret);

    const avantChunk = abonnerApresChargement(() => new Promise<string>((resolve) => { livrer = resolve; }), abonner);
    avantChunk();
    livrer("module");
    await Promise.resolve();
    await Promise.resolve();
    expect(abonner).not.toHaveBeenCalled();

    const apresChunk = abonnerApresChargement(async () => "module", abonner);
    await Promise.resolve();
    await Promise.resolve();
    expect(abonner).toHaveBeenCalledWith("module");
    apresChunk();
    expect(arret).toHaveBeenCalledTimes(1);

    const sansChunk = abonnerApresChargement(() => Promise.reject(new Error("chunk introuvable")), abonner);
    await Promise.resolve();
    await Promise.resolve();
    sansChunk();
    expect(abonner).toHaveBeenCalledTimes(1);
  });
});

describe("STABLE.D — chunk introuvable (redéploiement : l'ancien nom haché n'existe plus)", () => {
  const TEXTE = "Dominance stablecoins non chargée (réseau ou mise à jour d'AXIOM) ; rechargez la page.";

  afterEach(() => {
    // Fabrique du module simulé rétablie pour tout import ultérieur.
    vi.doMock("./dominanceStablecoins", () => ({ bougiesDominance: fetchKlinesDominanceMock, abonnerDominance: abonnerDominanceMock }));
    vi.resetModules();
  });

  it("import() rejeté : ErreurDominanceStablecoins au texte fixe « rechargez la page », cause conservée, affichée telle quelle", async () => {
    vi.resetModules();
    vi.doMock("./dominanceStablecoins", () => {
      throw new TypeError("Failed to fetch dynamically imported module: /assets/dominanceStablecoins-ancien.js");
    });
    const { capitalisationAdapter: adaptateur, sourcesCapitalisationStore: sources } = await import("./mcapCandles");

    const erreur: unknown = await adaptateur.fetchKlines("STABLE.D", "1d").catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(Error);
    expect(erreur).toMatchObject({ name: "ErreurDominanceStablecoins", message: TEXTE });
    expect((erreur as Error).cause).toBeDefined();
    // L'overlay n'accuse plus « la source » : le texte fixe dit quoi faire.
    expect(dataLoadErrorMessage(erreur)).toBe(TEXTE);
    expect(sources.getState().sources).toEqual({});
  });
});
