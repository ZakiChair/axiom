/**
 * Câblage intrabar de la VPFR : sans identité de marché déclarée, ancien calcul libellé
 * « ≈ » ; sur un chart Binance déclaré par ChartInstance, la plage passe aux sous-bougies
 * après import() du module et chargement anti-rebondi, l'overlay est redessiné
 * (overrideOverlay) et la bougie en cours (dernière de la dataList) n'est jamais
 * remplacée, y compris en replay où l'horloge réelle a dépassé toutes les bougies et où
 * seul ce rang la désigne. `fetch` est une doublure : aucun appel réseau.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@axiom/types";

const gabarit = vi.hoisted(() => ({ courant: null as null | { createPointFigures: (p: unknown) => unknown[] } }));
vi.mock("klinecharts", () => ({
  registerOverlay: (g: { createPointFigures: (p: unknown) => unknown[] }) => {
    gabarit.courant = g;
  },
}));
vi.mock("../lib/canvasTokens", () => ({
  lireTokenCanvas: (_n: string, repli: string) => repli,
  rgbaTokenCanvas: (_n: string, _a: number, repli: string) => repli,
}));

import { declarerMarcheVpfr, VPFR_NAME } from "./volumeRangeOverlay";
import { ANTI_REBOND_MS } from "../data/intrabar";

const MIN = 60_000;
const H1 = 60 * MIN;
const MAINTENANT = Date.UTC(2026, 10, 7, 12, 7, 0);

function minute(t: number): Candle {
  const k = t / MIN;
  const base = 50 + 2 * Math.sin(k / 200);
  const open = base + Math.sin(k) * 0.2;
  const close = base + Math.cos(k) * 0.2;
  const volume = 1 + Math.abs(Math.cos(k * 0.7));
  return { time: t, open, high: Math.max(open, close) + 0.05, low: Math.min(open, close) - 0.05, close, volume, buyVolume: volume / 3 };
}

function agreger(t0: number, duree: number): Candle {
  const ms = Array.from({ length: duree / MIN }, (_, i) => minute(t0 + i * MIN));
  return {
    time: t0,
    open: ms[0]?.open ?? 0,
    close: ms.at(-1)?.close ?? 0,
    high: Math.max(...ms.map((m) => m.high)),
    low: Math.min(...ms.map((m) => m.low)),
    volume: ms.reduce((s, m) => s + m.volume, 0),
    buyVolume: ms.reduce((s, m) => s + (m.buyVolume ?? 0), 0),
  };
}

/** Doublure klines 1m ; les minutes à partir de `repere` ont des prix ×10 (repérables dans le profil). */
function installerServeur(repere = Infinity) {
  const fetchFn = vi.fn(async (input: string | URL | Request) => {
    const q = new URL(String(input)).searchParams;
    expect(q.get("interval")).toBe("1m");
    const lignes: unknown[] = [];
    for (let t = Number(q.get("startTime")); t <= Number(q.get("endTime")) && t <= MAINTENANT; t += MIN) {
      const m = minute(t);
      const c = t < repere ? m : { ...m, open: m.open * 10, high: m.high * 10, low: m.low * 10, close: m.close * 10 };
      lignes.push([t, `${c.open}`, `${c.high}`, `${c.low}`, `${c.close}`, `${c.volume}`, t + MIN - 1, "0", 1, `${c.buyVolume}`, "0", "0"]);
    }
    return new Response(JSON.stringify(lignes), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchFn);
  return fetchFn;
}

/**
 * Chart minimal : dataList KLineData (sans buyVolume ni drapeau `closed`, comme
 * toKLineData) dont la dernière bougie contient `reference`, et échelle y = −prix.
 */
function chartDe(n: number, reference = MAINTENANT) {
  const derniere = Math.floor(reference / H1) * H1;
  const dataList = Array.from({ length: n }, (_, i) => {
    const c = agreger(derniere - (n - 1 - i) * H1, H1);
    return { timestamp: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
  });
  return {
    dataList,
    getDataList: () => dataList,
    convertToPixel: (p: { value: number }) => ({ y: -p.value }),
    overrideOverlay: vi.fn(),
  };
}

function figures(chart: ReturnType<typeof chartDe>, overlay: object, t0: number, t1: number): unknown[] {
  const g = gabarit.courant;
  if (g === null) throw new Error("overlay VPFR non enregistré");
  Object.assign(overlay, { points: [{ timestamp: t0 }, { timestamp: t1 }], extendData: chart });
  return g.createPointFigures({
    overlay,
    coordinates: [{ x: 0, y: 0 }, { x: 400, y: 0 }],
    precision: { price: 2 },
  });
}

function libelle(figs: unknown[]): string | undefined {
  const t = figs.find(
    (f) => (f as { type?: string; attrs?: { text?: string } }).type === "text" && /réparti/.test((f as { attrs: { text: string } }).attrs.text),
  ) as { attrs: { text: string } } | undefined;
  return t?.attrs.text;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("VPFR — intrabar", () => {
  it("sans identité de marché déclarée : ancien calcul libellé « ≈ », aucune requête", () => {
    const fetchFn = installerServeur();
    const chart = chartDe(30);
    const figs = figures(chart, {}, chart.dataList[0]?.timestamp ?? 0, chart.dataList.at(-1)?.timestamp ?? 0);
    expect(libelle(figs)).toBe("≈ réparti sur la bougie");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("chart Binance déclaré : sous-bougies 1m après chargement, bougie en cours exclue", async () => {
    vi.useFakeTimers({ now: MAINTENANT, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const fetchFn = installerServeur();
    const chart = chartDe(30);
    declarerMarcheVpfr(chart, { exchange: "binance", symbol: "SOLUSDT", timeframe: "1h" });
    const overlay = {};
    const t0 = chart.dataList[10]?.timestamp ?? 0;
    const t1 = chart.dataList.at(-1)?.timestamp ?? 0; // jusqu'à la bougie en cours

    expect(libelle(figures(chart, overlay, t0, t1))).toBe("≈ réparti sur la bougie"); // module en route
    await vi.dynamicImportSettled();
    expect(chart.overrideOverlay).toHaveBeenCalledWith({ name: VPFR_NAME, styles: {} });

    expect(libelle(figures(chart, overlay, t0, t1))).toBe("≈ réparti sur la bougie (intrabar 1m en chargement)");
    await vi.advanceTimersByTimeAsync(ANTI_REBOND_MS);
    await vi.runAllTimersAsync();
    // 19 h clôturées = 1 140 minutes : deux blocs alignés de 1 000 au plus.
    expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(2);
    expect(chart.overrideOverlay).toHaveBeenCalledTimes(2);

    // 20 bougies dans la plage, dont la bougie en cours (ancien calcul).
    expect(libelle(figures(chart, overlay, t0, t1))).toBe("réparti à la minute (1m) · 19/20");
  });

  it("façon replay : la dernière bougie de la dataList n'est jamais remplacée, aucune sous-bougie postérieure n'entre", async () => {
    vi.useFakeTimers({ now: MAINTENANT, toFake: ["setTimeout", "clearTimeout", "Date"] });
    // Instant rejoué deux jours avant l'horloge réelle : toutes les bougies sont closes à
    // l'horloge, la dernière n'est « en cours » que par son rang dans la dataList.
    const rejoue = MAINTENANT - 48 * H1;
    const finRejouee = Math.floor(rejoue / H1) * H1 + H1;
    const fetchFn = installerServeur(finRejouee); // minutes postérieures : prix ×10
    const chart = chartDe(30, rejoue);
    declarerMarcheVpfr(chart, { exchange: "binance", symbol: "ADAUSDT", timeframe: "1h" });
    const overlay = {};
    const t0 = chart.dataList[10]?.timestamp ?? 0;
    const t1 = chart.dataList.at(-1)?.timestamp ?? 0;
    expect(t1 + H1).toBeLessThan(MAINTENANT);
    // La bougie rejouée est entière : ses 60 minutes servies retrouvent son volume, le
    // contrôle de cohérence ne la protège donc pas — seul le marquage `closed:false` le fait.
    expect(agreger(t1, H1).volume).toBe(chart.dataList.at(-1)?.volume);

    figures(chart, overlay, t0, t1);
    await vi.dynamicImportSettled();
    figures(chart, overlay, t0, t1);
    await vi.advanceTimersByTimeAsync(ANTI_REBOND_MS);
    await vi.runAllTimersAsync();
    expect(fetchFn).toHaveBeenCalled();
    const figs = figures(chart, overlay, t0, t1);
    expect(libelle(figs)).toBe("réparti à la minute (1m) · 19/20");
    // Rien de postérieur à la bougie rejouée : le profil reste sous le plus haut de la plage
    // (une minute ×10 le ferait monter vers −500 sur l'échelle y = −prix).
    const hautMax = Math.max(...chart.dataList.slice(10).map((d) => d.high));
    const ys = figs.flatMap((f) => (f as { attrs?: { coordinates?: { y: number }[] } }).attrs?.coordinates?.map((c) => c.y) ?? []);
    expect(ys.length).toBeGreaterThan(0);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-hautMax - 1e-9);

    // Témoin : la même plage sur un graphe d'une bougie de plus — l'ancienne dernière
    // n'est plus en cours et passe aux sous-bougies (20/20).
    const temoin = chartDe(31, rejoue + H1);
    declarerMarcheVpfr(temoin, { exchange: "binance", symbol: "XRPUSDT", timeframe: "1h" });
    const overlayTemoin = {};
    expect(temoin.dataList[29]?.timestamp).toBe(t1);
    figures(temoin, overlayTemoin, t0, t1);
    await vi.advanceTimersByTimeAsync(ANTI_REBOND_MS);
    await vi.runAllTimersAsync();
    expect(libelle(figures(temoin, overlayTemoin, t0, t1))).toBe("réparti à la minute (1m) · 20/20");
  });
});
