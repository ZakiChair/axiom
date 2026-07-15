import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adaptateurReplayActif, debutJour, JOUR_MS } from "../data/replayFeed";
import { chartLayoutStore } from "./chart-layout";
import { marketIdentity, marketStore } from "./market";
import { replayStore } from "./replay";

const DAY = "2026-07-12";

function readyStatus(symbol = "BTCUSDT", day = DAY) {
  return { etat: "pret" as const, symbole: symbol, jour: day, recus: 42 };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  replayStore.getState().stop();
  marketStore.getState().setMarket({ exchange: "kraken", symbol: "ETHUSD", timeframe: "5m" });
  chartLayoutStore.setState({
    layout: "2x2",
    focus: 0,
    linked: false,
    slots: [
      { exchange: "kraken", symbol: "ETHUSD", timeframe: "5m" },
      { exchange: "coinbase", symbol: "SOL-USD", timeframe: "15m" },
      { exchange: "binance", symbol: "BNBUSDT", timeframe: "1h" },
    ],
  });
  replayStore.setState({
    symbole: "BTCUSDT",
    jour: DAY,
    tf: "1m",
    statut: readyStatus(),
    active: false,
    slot: 0,
    returnMarket: null,
    identityTransition: false,
    playing: false,
  });
});

afterEach(() => {
  replayStore.getState().stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("replayStore — identité du slot cible", () => {
  it("applique l'identité replay au maître puis restaure son marché live", () => {
    const original = marketIdentity(marketStore.getState());

    replayStore.getState().start();

    expect(replayStore.getState()).toMatchObject({ active: true, slot: 0 });
    expect(marketIdentity(marketStore.getState())).toEqual({
      exchange: "binance",
      symbol: "BTCUSDT",
      timeframe: "1m",
    });

    replayStore.getState().stop();

    expect(replayStore.getState().active).toBe(false);
    expect(marketIdentity(marketStore.getState())).toEqual(original);
  });

  it("applique et restaure atomiquement l'identité d'un slot secondaire", () => {
    chartLayoutStore.getState().setFocus(1);
    const original = { ...chartLayoutStore.getState().slots[0] };

    replayStore.getState().start();

    expect(replayStore.getState()).toMatchObject({ active: true, slot: 1 });
    expect(chartLayoutStore.getState().slots[0]).toEqual({
      exchange: "binance",
      symbol: "BTCUSDT",
      timeframe: "1m",
    });

    replayStore.getState().stop();
    expect(chartLayoutStore.getState().slots[0]).toEqual(original);
  });

  it("quitte le replay et conserve une nouvelle identité choisie par l'utilisateur", () => {
    replayStore.getState().start();

    marketStore.getState().setMarket({
      exchange: "coinbase",
      symbol: "SOL-USD",
      timeframe: "15m",
    });

    expect(replayStore.getState().active).toBe(false);
    expect(marketIdentity(marketStore.getState())).toEqual({
      exchange: "coinbase",
      symbol: "SOL-USD",
      timeframe: "15m",
    });
  });

  it("ne branche jamais la façade replay sur une identité différente", async () => {
    replayStore.getState().start();
    const adapter = adaptateurReplayActif();
    expect(adapter).not.toBeNull();

    await expect(adapter?.fetchKlines("ETHUSDT", "5m")).rejects.toThrow(
      "Identité replay incohérente",
    );
  });

  it("ne prétend pas lire quand le curseur est déjà à la fin du jour", () => {
    replayStore.getState().start();
    replayStore.getState().seek(debutJour(DAY) + JOUR_MS);

    replayStore.getState().basculerLecture();

    expect(replayStore.getState().playing).toBe(false);
  });
});

describe("replayStore — réponses réseau hors ordre", () => {
  it("ignore un statut prêt reçu pour l'ancienne sélection", async () => {
    const first = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(jsonResponse(readyStatus("BTCUSDT", "2026-07-11")));
    vi.stubGlobal("fetch", fetchMock);
    replayStore.setState({ statut: { etat: "absent", symbole: "BTCUSDT", jour: DAY } });

    replayStore.getState().rafraichirStatut();
    replayStore.getState().setJour("2026-07-11");
    await vi.waitFor(() => expect(replayStore.getState().statut).toEqual(readyStatus("BTCUSDT", "2026-07-11")));

    first.resolve(jsonResponse(readyStatus("BTCUSDT", DAY)));
    await Promise.resolve();
    await Promise.resolve();

    expect(replayStore.getState().jour).toBe("2026-07-11");
    expect(replayStore.getState().statut).toEqual(readyStatus("BTCUSDT", "2026-07-11"));
  });

  it("n'exécute jamais deux polls de statut simultanés pour le même téléchargement", async () => {
    vi.useFakeTimers();
    const firstPoll = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ etat: "en_cours", symbole: "BTCUSDT", jour: DAY, recus: 0 }),
      )
      .mockImplementationOnce(() => firstPoll.promise)
      .mockResolvedValueOnce(jsonResponse(readyStatus()))
      .mockResolvedValue(jsonResponse({ jours: [] }));
    vi.stubGlobal("fetch", fetchMock);

    replayStore.getState().telecharger();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(fetchMock).toHaveBeenCalledTimes(2); // download + premier poll encore en vol

    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(2); // les ticks suivants sont coalescés

    firstPoll.resolve(
      jsonResponse({ etat: "en_cours", symbole: "BTCUSDT", jour: DAY, recus: 10 }),
    );
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_500);
    await Promise.resolve();

    expect(replayStore.getState().statut).toEqual(readyStatus());
  });
});
