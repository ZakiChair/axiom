/**
 * Abréviation des grands nombres du volume piégé (PEPE : « 5,316,729,014,174 » dans la
 * légende, axe Y élargi pour TOUS les panes). KLineChart 9.8 n'abrège que les templates
 * `shouldFormatBigNumber` : le pont pose l'option sur trappedVolume SEUL. Le formateur
 * (`customApi.formatBigNumber`) n'est PAS remplacé : il est commun à tout le graphe
 * (légende, axe, crosshair) et servirait aussi CVD, OI, macro et revenus, dont l'affichage
 * doit rester inchangé. Limite assumée : le défaut n'abrège que `v > 1000`, donc les
 * shorts piégés (négatifs) restent en toutes lettres.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Chart } from "klinecharts";
import type { ActiveIndicator } from "../store/indicators";
import { ChartIndicators } from "./indicators";

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

describe("pont — abréviation réservée au volume piégé", () => {
  it("template trappedVolume `shouldFormatBigNumber`, sans toucher au formateur du graphe", () => {
    const { chart, indicators } = monter();
    indicators.sync([rsi, piege], [], "binance");
    expect(enregistres.find((t) => t.name === "AXIOM_gn-piege")?.shouldFormatBigNumber).toBe(true);
    // Un formateur installé sur le graphe changeait l'affichage du CVD voisin (« -20,795 » →
    // « -20.795K ») dès que trappedVolume y avait été ajouté, et le gardait après son retrait.
    indicators.sync([rsi], [], "binance");
    expect(chart.setCustomApi).not.toHaveBeenCalled();
  });

  it("les autres indicateurs gardent l'affichage KLineChart par défaut", () => {
    const { indicators } = monter();
    indicators.sync([rsi], [], "binance");
    const template = enregistres.find((t) => t.name === "AXIOM_gn-rsi");
    expect(template).toBeDefined();
    expect(template?.shouldFormatBigNumber).toBeUndefined();
  });
});
