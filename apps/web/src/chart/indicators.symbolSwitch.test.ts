/**
 * Régression : changement d'actif (backfill) avec un indicateur overlay ACTIF sur
 * `candle_pane` (ex. SMA). `sync()` mémoïse par `defId::hashParams` — indépendant du
 * symbole — donc une instance à params inchangés n'était JAMAIS recalculée au switch
 * BTC -> PUMP (ou l'inverse) : elle gardait l'`extendData` de l'ANCIEN actif, à une
 * échelle de prix sans rapport, faussant l'auto-scale de l'axe Y du pane prix
 * (`YAxisImp.calcRange` inclut les valeurs de figure de tout indicateur du pane).
 *
 * `forceRecompute` (4e argument de `sync`) corrige ce cas précis SANS régresser le
 * chemin normal (édition de la liste d'indicateurs, `candles` inchangées) où
 * l'absence de recalcul superflu reste voulue.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Chart } from "klinecharts";
import { ChartIndicators } from "./indicators";
import type { ActiveIndicator } from "../store/indicators";
import type { Candle, IndicatorResult } from "@axiom/types";

vi.mock("klinecharts", () => ({
  registerIndicator: () => {},
  registerOverlay: () => {},
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
}));

interface IndicatorConfigStub {
  name: string;
  shortName?: string;
  extendData?: IndicatorResult;
}

function makeIndicators() {
  const chart = {
    createIndicator: vi.fn((_config: IndicatorConfigStub, _isStack: boolean, opts?: { id: string }) => opts?.id ?? null),
    overrideIndicator: vi.fn((_override: IndicatorConfigStub, _paneId?: string) => {}),
    removeIndicator: vi.fn(),
  };
  const indicators = new ChartIndicators(chart as unknown as Chart);
  return { indicators, chart };
}

// SMA(length: 1) = close de la bougie elle-même à chaque index (fenêtre glissante de
// taille 1) : valeurs directement lisibles, aucune bougie « chauffe » à ignorer.
const smaInstance: ActiveIndicator = { instanceId: "sma-1", defId: "sma", params: { length: 1 } };

const btcCandles: Candle[] = [
  { time: 1_000, open: 90_000, high: 90_500, low: 89_500, close: 90_000, volume: 10 },
  { time: 2_000, open: 90_000, high: 90_600, low: 89_800, close: 90_200, volume: 12 },
];

const pumpCandles: Candle[] = [
  { time: 1_000, open: 0.0030, high: 0.0031, low: 0.0029, close: 0.0030, volume: 1_000_000 },
  { time: 2_000, open: 0.0030, high: 0.0032, low: 0.0029, close: 0.0031, volume: 1_100_000 },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChartIndicators.sync — forceRecompute au changement d'actif", () => {
  it("SANS forceRecompute (params inchangés) : l'indicateur garde l'extendData de l'ancien actif", () => {
    const { indicators, chart } = makeIndicators();

    indicators.sync([smaInstance], btcCandles, "binance");
    expect(chart.createIndicator.mock.calls[0]![0].extendData?.series.sma).toEqual([90_000, 90_200]);

    chart.overrideIndicator.mockClear();
    indicators.sync([smaInstance], pumpCandles, "binance"); // même instanceId/params, PAS forcé

    // Bug reproduit : aucun override -> l'extendData reste celle de BTC (~90000)
    // alors que le pane affiche maintenant des bougies PUMP (~0.003).
    expect(chart.overrideIndicator).not.toHaveBeenCalled();
  });

  it("AVEC forceRecompute (backfill/changement d'actif) : l'indicateur est recalculé sur le nouvel actif", () => {
    const { indicators, chart } = makeIndicators();

    indicators.sync([smaInstance], btcCandles, "binance", true);
    expect(chart.createIndicator.mock.calls[0]![0].extendData?.series.sma).toEqual([90_000, 90_200]);

    chart.overrideIndicator.mockClear();
    indicators.sync([smaInstance], pumpCandles, "binance", true); // même instanceId/params, FORCÉ

    expect(chart.overrideIndicator).toHaveBeenCalledTimes(1);
    const [config] = chart.overrideIndicator.mock.calls[0]!;
    // Plus aucune trace de l'échelle BTC : l'extendData reflète les candles PUMP
    // (tolérance flottante : SMA cumule puis soustrait, cf. utils.ts).
    const sma = config.extendData?.series.sma as number[];
    expect(sma[0]).toBeCloseTo(0.0030, 10);
    expect(sma[1]).toBeCloseTo(0.0031, 10);
  });

  it("forceRecompute n'affecte pas le chemin normal (aucune régression du memo) : mêmes candles, pas de recalcul superflu", () => {
    const { indicators, chart } = makeIndicators();

    indicators.sync([smaInstance], btcCandles, "binance", true);
    chart.overrideIndicator.mockClear();

    // Même RÉFÉRENCE candles (pas un backfill) — juste un re-sync (ex. édition d'un
    // AUTRE indicateur). `forceRecompute` reste TOUJOURS explicitement piloté par
    // l'appelant (ChartInstance.tsx ne le passe `true` qu'au backfill) ; ici on
    // vérifie que le chemin par défaut (false) ne recalculé rien d'inutile.
    indicators.sync([smaInstance], btcCandles, "binance");

    expect(chart.overrideIndicator).not.toHaveBeenCalled();
  });
});
