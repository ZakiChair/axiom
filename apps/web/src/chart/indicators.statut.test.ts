/**
 * Statut d'affichage publié par `ChartIndicators` (jamais de pane muet) : un indicateur
 * contextuellement UNUSABLE n'est plus TRACÉ (séries vides) et sa raison est lisible par
 * les légendes DOM ; un résultat sans aucune valeur finie porte une raison explicite
 * (historique trop court pour l'horizon, ou rien de calculable), ou « chargement » tant
 * qu'un aux est attendu. Aucun statut pendant le backfill (buffer vide : l'overlay de
 * chargement du graphe parle) ni pour une stratégie overlay restée à plat (résultat
 * valide) ; `dispose` efface ceux du graphe. Le canal est retrouvé par l'objet `Chart`
 * seul (`statutIndicateur`/`abonnerStatutsIndicateurs`) : les en-têtes n'ont besoin
 * d'aucun câblage supplémentaire.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Chart } from "klinecharts";
import type { Candle, IndicatorResult } from "@axiom/types";
import type { ActiveIndicator } from "../store/indicators";
import { abonnerStatutsIndicateurs, ChartIndicators, statutIndicateur } from "./indicators";
import { auxProvider } from "./auxProvider";

vi.mock("klinecharts", () => ({
  registerIndicator: () => {},
  registerOverlay: () => {},
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
}));

interface ConfigTrace { shortName?: string; extendData?: IndicatorResult }

function monter() {
  const chart = {
    createIndicator: vi.fn((_config: ConfigTrace, _stack: boolean, options?: { id: string }) => options?.id ?? "candle_pane"),
    overrideIndicator: vi.fn((_override: ConfigTrace, _paneId?: string) => {}),
    removeIndicator: vi.fn(),
    setPaneOptions: vi.fn(),
    setCustomApi: vi.fn(),
    getSize: () => ({ top: 0, left: 0, width: 800, height: 100, right: 800, bottom: 100 }),
  };
  const indicators = new ChartIndicators(chart as unknown as Chart);
  return { chart, indicators, kline: chart as unknown as Chart };
}

/** `n` bougies splittées (achat dominant à la baisse : il y a toujours des longs nets piégés). */
function bougies(n: number, split = true): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 - i * 0.5;
    return {
      time: i * 86_400_000,
      open: close + 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 10,
      ...(split ? { buyVolume: 7, sellVolume: 3 } : {}),
      closed: true,
    };
  });
}

const piege: ActiveIndicator = { instanceId: "tv-1", defId: "trappedVolume", params: { length: 96 }, couleurIdx: 0 };

afterEach(() => vi.restoreAllMocks());

describe("ChartIndicators — statut explicite (jamais de pane muet)", () => {
  it("contexte UNUSABLE (split hors Binance) : séries vides, rien de tracé, raison publiée", () => {
    const { chart, indicators, kline } = monter();
    indicators.setMarket("BTCUSDT", "15m");
    // Coinbase : les bougies live PORTENT un split construit par WebSocket — l'ancien pont
    // traçait 1 à 2 barres sur une fenêtre partielle.
    indicators.sync([piege], bougies(120), "coinbase");

    const config = chart.createIndicator.mock.calls[0]![0];
    expect(config.shortName).toBe("Volume piégé (nord/sud) (96) (UNUSABLE)");
    const series = config.extendData!.series;
    expect(series.trappedLong).toHaveLength(120);
    expect(series.trappedLong!.every((v) => v === undefined)).toBe(true);
    expect(series.trappedShort!.every((v) => v === undefined)).toBe(true);
    expect(statutIndicateur(kline, "tv-1")).toEqual({
      etat: "unusable",
      raison: "Volumes acheteur/vendeur historiques complets disponibles uniquement sur Binance",
    });

    chart.overrideIndicator.mockClear();
    indicators.recompute([piege], bougies(121), "coinbase");
    const override = chart.overrideIndicator.mock.calls[0]![0];
    expect(override.extendData!.series.trappedLong!.some((v) => v !== undefined)).toBe(false);
  });

  it("historique plus court que l'horizon (1M, 74 bougies) : raison « Historique insuffisant »", () => {
    const { indicators, kline } = monter();
    indicators.setMarket("SOLUSDT", "1M");
    indicators.sync([piege], bougies(74), "binance");
    expect(statutIndicateur(kline, "tv-1")).toEqual({
      etat: "vide",
      raison: "Historique insuffisant : 74 bougies, horizon 96",
    });
  });

  it("historique suffisant (1M, 110 bougies) : aucune raison, les valeurs sont tracées", () => {
    const { chart, indicators, kline } = monter();
    indicators.setMarket("BTCUSDT", "1M");
    indicators.sync([piege], bougies(110), "binance");
    expect(statutIndicateur(kline, "tv-1")).toBeNull();
    const series = chart.createIndicator.mock.calls[0]![0].extendData!.series;
    expect(series.trappedLong!.filter((v) => v !== undefined)).toHaveLength(15);
  });

  it("horizon couvert mais rien de calculable (aucun split) : « Aucune valeur calculable »", () => {
    const { indicators, kline } = monter();
    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([piege], bougies(200, false), "binance");
    expect(statutIndicateur(kline, "tv-1")).toEqual({
      etat: "vide",
      raison: "Aucune valeur calculable sur cet historique",
    });
  });

  it("stratégie overlay restée à plat : aucun statut (résultat valide, le pane prix reste tracé)", () => {
    const { chart, indicators, kline } = monter();
    indicators.setMarket("BTCUSDT", "1h");
    // Baisse continue : RSI écrasé sous la survente, jamais de recroisement → aucune entrée.
    const strat: ActiveIndicator = {
      instanceId: "strat-1",
      defId: "stratRsiReversion",
      params: { length: 14, survente: 30, surachat: 70, lignesTrades: true },
      couleurIdx: 0,
    };
    indicators.sync([strat], bougies(60), "binance");
    expect(chart.createIndicator.mock.calls[0]![0].shortName).toBe("Stratégie RSI réversion (14, 30, 70)");
    // Aucun badge « indisponible » à côté d'une stratégie qui fonctionne (revue : 3 séries
    // réelles sur 4 pour stratRsiRange).
    expect(statutIndicateur(kline, "strat-1")).toBeNull();
  });

  it("stratégie overlay à aux, aux prêt mais aucun trade : aucun statut non plus", () => {
    const n = 60;
    // Ratio long/short = 1 → Net Foule 0 %, jamais au-delà du seuil de 30 % → aucune entrée.
    vi.spyOn(auxProvider, "getAligned").mockReturnValue({ status: "ready", aux: { lsAccount: new Array<number>(n).fill(1) } });
    const { indicators, kline } = monter();
    indicators.setMarket("BTCUSDT", "1h");
    const strat: ActiveIndicator = { instanceId: "strat-aux", defId: "stratNetPositionFade", params: {}, couleurIdx: 0 };
    indicators.sync([strat], bougies(n), "binance");
    expect(statutIndicateur(kline, "strat-aux")).toBeNull();
  });

  it("« stratégie » de divergence en pane SÉPARÉ : un pane vide garde sa raison", () => {
    const { indicators, kline } = monter();
    indicators.setMarket("SOLUSDT", "1M");
    // rsiDivergence trace un oscillateur dans son propre pane : sans valeur, le pane serait muet.
    const div: ActiveIndicator = { instanceId: "div-1", defId: "rsiDivergence", params: {}, couleurIdx: 0 };
    indicators.sync([div], bougies(5), "binance");
    expect(statutIndicateur(kline, "div-1")).toEqual({
      etat: "vide",
      raison: "Historique insuffisant : 5 bougies, horizon 14",
    });
  });

  it("buffer vide (backfill en cours) : aucun statut, l'overlay de chargement du graphe parle", () => {
    const { indicators, kline } = monter();
    indicators.setMarket("BTCUSDT", "15m");
    // startDataLoad vide le buffer : un sync déclenché pendant le backfill (ajout d'un
    // indicateur, réconciliation du store) affichait « Historique insuffisant : 0 bougies ».
    const rsi: ActiveIndicator = { instanceId: "rsi-1", defId: "rsi", params: {}, couleurIdx: 0 };
    indicators.sync([rsi, piege], [], "binance");
    expect(statutIndicateur(kline, "rsi-1")).toBeNull();
    expect(statutIndicateur(kline, "tv-1")).toBeNull();
    // Le statut revient dès que le buffer est chargé.
    indicators.recompute([rsi, piege], bougies(74), "binance");
    expect(statutIndicateur(kline, "tv-1")?.raison).toBe("Historique insuffisant : 74 bougies, horizon 96");
  });

  it("données auxiliaires en attente, rien de tracé : statut « chargement » explicite", () => {
    vi.spyOn(auxProvider, "getAligned").mockReturnValue({ status: "pending" });
    const { chart, indicators, kline } = monter();
    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([{ instanceId: "oi-1", defId: "openInterest", params: {}, couleurIdx: 0 }], bougies(5), "binance");
    expect(chart.createIndicator.mock.calls[0]![0].shortName).toBe("Open Interest …");
    expect(statutIndicateur(kline, "oi-1")).toEqual({
      etat: "chargement",
      raison: "Chargement des données auxiliaires…",
    });
  });

  it("dispose (changement d'actif) : efface les statuts de ce graphe et le notifie", () => {
    const { indicators, kline } = monter();
    const vus: string[] = [];
    abonnerStatutsIndicateurs(kline, (id) => vus.push(id));
    indicators.setMarket("BTCUSDT", "15m");
    indicators.sync([piege], bougies(50), "okx");
    expect(statutIndicateur(kline, "tv-1")?.etat).toBe("unusable");

    // L'effet DONNÉES rejoue (okx → binance) : l'ancien badge ne doit pas survivre au
    // chargement du nouvel actif (ni rester si ce chargement échoue).
    indicators.dispose();
    expect(statutIndicateur(kline, "tv-1")).toBeNull();
    expect(vus).toEqual(["tv-1", "tv-1"]);
  });

  it("notifie à chaque CHANGEMENT de statut, pas à chaque recalcul identique", () => {
    const { indicators, kline } = monter();
    const vus: string[] = [];
    const desabonner = abonnerStatutsIndicateurs(kline, (id) => vus.push(id));
    indicators.setMarket("BTCUSDT", "1d");

    indicators.sync([piege], bougies(95), "binance");
    expect(vus).toEqual(["tv-1"]);
    indicators.recompute([piege], bougies(95), "binance");
    indicators.recompute([piege], bougies(95), "binance");
    expect(vus).toEqual(["tv-1"]); // même raison : aucune notification (recalcul toutes les 500 ms)

    indicators.recompute([piege], bougies(96), "binance"); // la 96e bougie remplit l'horizon
    expect(statutIndicateur(kline, "tv-1")).toBeNull();
    expect(vus).toEqual(["tv-1", "tv-1"]);

    desabonner();
    indicators.recompute([piege], bougies(10), "binance");
    expect(vus).toHaveLength(2);
  });

  it("retrait de l'instance : statut effacé et notifié", () => {
    const { indicators, kline } = monter();
    const vus: string[] = [];
    abonnerStatutsIndicateurs(kline, (id) => vus.push(id));
    indicators.setMarket("BTCUSDT", "15m");
    indicators.sync([piege], bougies(50), "okx");
    expect(statutIndicateur(kline, "tv-1")?.etat).toBe("unusable");

    indicators.sync([], bougies(50), "okx");
    expect(statutIndicateur(kline, "tv-1")).toBeNull();
    expect(vus).toEqual(["tv-1", "tv-1"]);
  });

  it("source auxiliaire en échec : UNUSABLE avec le message de la source", () => {
    vi.spyOn(auxProvider, "getAligned").mockReturnValue({ status: "error", message: "source injoignable" });
    const { indicators, kline } = monter();
    indicators.setMarket("BTCUSDT", "1h");
    indicators.sync([{ instanceId: "oi-1", defId: "openInterest", params: {}, couleurIdx: 0 }], bougies(5), "binance");
    expect(statutIndicateur(kline, "oi-1")).toEqual({
      etat: "unusable",
      raison: "Données auxiliaires indisponibles : source injoignable",
    });
  });

  it("chaque graphe a son canal : le statut d'un slot ne fuit pas sur l'autre", () => {
    const a = monter();
    const b = monter();
    a.indicators.setMarket("BTCUSDT", "15m");
    b.indicators.setMarket("BTCUSDT", "15m");
    a.indicators.sync([piege], bougies(120), "kraken");
    b.indicators.sync([piege], bougies(120), "binance");
    expect(statutIndicateur(a.kline, "tv-1")?.etat).toBe("unusable");
    expect(statutIndicateur(b.kline, "tv-1")).toBeNull();
  });
});
