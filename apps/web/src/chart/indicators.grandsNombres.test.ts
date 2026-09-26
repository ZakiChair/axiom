/**
 * Abréviation des grands nombres du volume piégé (PEPE : « 5,316,729,014,174 » dans la
 * légende, axe Y élargi pour TOUS les panes). KLineChart 9.8 n'abrège que les templates
 * `shouldFormatBigNumber` : le pont pose l'option sur trappedVolume SEUL. Le formateur
 * (`customApi.formatBigNumber`) est installé une fois à `init` (ChartInstance), jamais par le
 * pont : l'affichage ne dépend pas de l'historique du graphe. Il sert aussi CVD, OI, macro et
 * revenus, dont les négatifs sont désormais abrégés comme leurs positifs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Chart } from "klinecharts";
import type { ActiveIndicator } from "../store/indicators";
import { ChartIndicators, formatGrandNombre } from "./indicators";

const { enregistres } = vi.hoisted(() => ({ enregistres: [] as Array<{ name: string; shouldFormatBigNumber?: boolean }> }));

vi.mock("klinecharts", () => ({
  registerIndicator: (template: { name: string; shouldFormatBigNumber?: boolean }) => enregistres.push(template),
  registerOverlay: () => {},
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
}));

function monter() {
  const chart = {
    createIndicator: vi.fn((_c: unknown, _s: boolean, options?: { id: string }) => options?.id ?? "candle_pane"),
    overrideIndicator: vi.fn(),
    removeIndicator: vi.fn(),
    setPaneOptions: vi.fn(),
    setCustomApi: vi.fn(),
    getSize: () => ({ top: 0, left: 0, width: 800, height: 100, right: 800, bottom: 100 }),
  };
  const indicators = new ChartIndicators(chart as unknown as Chart);
  indicators.setMarket("PEPEUSDT", "15m");
  return { chart, indicators };
}

const piege: ActiveIndicator = { instanceId: "gn-piege", defId: "trappedVolume", params: { length: 96 }, couleurIdx: 0 };
const rsi: ActiveIndicator = { instanceId: "gn-rsi", defId: "rsi", params: { length: 14, source: "close" }, couleurIdx: 1 };

afterEach(() => vi.restoreAllMocks());

describe("pont — abréviation réservée aux séries à très grands nombres", () => {
  it("template trappedVolume `shouldFormatBigNumber`, sans toucher au formateur du graphe", () => {
    const { chart, indicators } = monter();
    indicators.sync([rsi, piege], [], "binance");
    expect(enregistres.find((t) => t.name === "AXIOM_gn-piege")?.shouldFormatBigNumber).toBe(true);
    // Un formateur installé sur le graphe changeait l'affichage du CVD voisin (« -20,795 » →
    // « -20.795K ») dès que trappedVolume y avait été ajouté, et le gardait après son retrait.
    indicators.sync([rsi], [], "binance");
    expect(chart.setCustomApi).not.toHaveBeenCalled();
  });

  it("impression et offre de stablecoins (milliards de $) : abrégées aussi", () => {
    const { indicators } = monter();
    indicators.setMarket("BTCUSDT", "1d");
    indicators.sync([
      { instanceId: "gn-stbl", defId: "stablecoinPrint", params: {}, couleurIdx: 2 },
      { instanceId: "gn-offre", defId: "stablecoinSupply", params: {}, couleurIdx: 3 },
    ], [], "binance");
    expect(enregistres.find((t) => t.name === "AXIOM_gn-stbl")?.shouldFormatBigNumber).toBe(true);
    expect(enregistres.find((t) => t.name === "AXIOM_gn-offre")?.shouldFormatBigNumber).toBe(true);
  });

  it("les autres indicateurs gardent l'affichage KLineChart par défaut", () => {
    const { indicators } = monter();
    indicators.sync([rsi], [], "binance");
    const template = enregistres.find((t) => t.name === "AXIOM_gn-rsi");
    expect(template).toBeDefined();
    expect(template?.shouldFormatBigNumber).toBeUndefined();
  });
});

describe("formatGrandNombre — abréviation symétrique en signe (option A)", () => {
  it("positifs : identique au défaut KLineChart 9.8.12", () => {
    expect(formatGrandNombre("16301000000.00")).toBe("16.301B");
    expect(formatGrandNombre(5739.1)).toBe("5.739K");
    expect(formatGrandNombre("999.99")).toBe("999.99");
  });
  it("négatifs abrégés comme les positifs (légende et graduations)", () => {
    expect(formatGrandNombre("-67795267738.99")).toBe("-67.795B");
    expect(formatGrandNombre(-150_000_000_000)).toBe("-150B");
    expect(formatGrandNombre("-5602.53")).toBe("-5.603K");
  });
  it("un zéro arrondi perd son signe, le reste passe tel quel", () => {
    expect(formatGrandNombre("-0.00")).toBe("0.00");
    expect(formatGrandNombre("-12.50")).toBe("-12.50");
    expect(formatGrandNombre("--")).toBe("--");
  });
});
