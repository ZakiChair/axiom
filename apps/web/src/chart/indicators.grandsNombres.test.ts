/**
 * Abréviation des grands nombres du volume piégé (PEPE : « 5,316,729,014,174 » dans la
 * légende, axe Y élargi pour TOUS les panes) et fin du « -0 ». KLineChart 9.8 n'abrège
 * que les templates `shouldFormatBigNumber`, et son `formatBigNumber` par défaut ignore
 * les négatifs (`v > 1000`) : le pont pose l'option sur trappedVolume SEUL et installe,
 * sur le graphe qui l'accueille, un formateur symétrique en signe.
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

describe("formatGrandNombre", () => {
  it("abrège les DEUX signes (K/M/B, 3 décimales) comme le défaut KLineChart pour les positifs", () => {
    expect(formatGrandNombre("5316729014174.12")).toBe("5316.729B");
    expect(formatGrandNombre("-2473218802928.00")).toBe("-2473.219B");
    expect(formatGrandNombre("-399564844.93")).toBe("-399.565M");
    expect(formatGrandNombre(1500)).toBe("1.5K");
    expect(formatGrandNombre("-1500")).toBe("-1.5K");
    // Seuil STRICT, comme le défaut (`v > 1000`) : 1000 reste tel quel.
    expect(formatGrandNombre("1000")).toBe("1000");
  });

  it("laisse intacts les petits nombres déjà formatés, sans jamais rendre « -0 »", () => {
    expect(formatGrandNombre("180.37")).toBe("180.37");
    expect(formatGrandNombre("-0.40")).toBe("-0.40");
    expect(formatGrandNombre("-0.00")).toBe("0.00");
    expect(formatGrandNombre("-0")).toBe("0");
    expect(formatGrandNombre(-0)).toBe("0");
    expect(formatGrandNombre("n/a")).toBe("n/a");
  });
});

describe("pont — abréviation réservée au volume piégé", () => {
  it("template trappedVolume shouldFormatBigNumber, formateur installé une seule fois sur ce graphe", () => {
    const { chart, indicators } = monter();
    indicators.sync([piege, { ...piege, instanceId: "gn-piege-2" }], [], "binance");
    const template = enregistres.find((t) => t.name === "AXIOM_gn-piege");
    expect(template?.shouldFormatBigNumber).toBe(true);
    expect(chart.setCustomApi).toHaveBeenCalledTimes(1);
    expect(chart.setCustomApi).toHaveBeenCalledWith({ formatBigNumber: formatGrandNombre });
  });

  it("les autres indicateurs gardent l'affichage KLineChart par défaut", () => {
    const { chart, indicators } = monter();
    indicators.sync([rsi], [], "binance");
    const template = enregistres.find((t) => t.name === "AXIOM_gn-rsi");
    expect(template).toBeDefined();
    expect(template?.shouldFormatBigNumber).toBeUndefined();
    expect(chart.setCustomApi).not.toHaveBeenCalled();
  });
});
