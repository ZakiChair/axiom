/**
 * `liqParBougie` face à une réponse Coinalyze EN VOL après le passage du graphe (revue du 30/10,
 * tours 3 et 5). Course : l'indicateur est actif sur un perp, sa requête `liquidation-history` est
 * en vol (latence, ou attente du quota de 40/min), puis le graphe passe sur une série ou un ticker
 * Twelve Data. ChartInstance appelle alors `indicators.setMarket(cible)` sans sync avant le
 * backfill : `latestArgs` porte encore la source de l'ANCIEN graphe. ChartIndicators jette donc la
 * réponse d'un ancien symbole avant `onAuxReady` (spec §6.1), pour tout changement de symbole :
 * série, TradFi reconnue ou ticker libre (IBM, que le prédicat ne distingue pas d'un perp coté
 * USD1). Ce test prouve ce rejet : sans lui, IBM, PLTR et le témoin perp → perp (réponse périmée
 * jetée, puis nouveau perp demandé au sync du backfill) échouent. La lecture du symbole par la
 * garde (source de transition, `navigateTo` à source explicite) est prouvée par
 * indicatorUsability.test.ts. Vrai ChartIndicators, vrais auxProvider et Coinalyze, capteur fetch
 * global.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chart } from "klinecharts";
import type { Candle } from "@axiom/types";

vi.mock("klinecharts", () => ({
  registerIndicator: () => {},
  registerOverlay: () => {},
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
}));

import { ChartIndicators } from "../chart/indicators";
import { coinalyzeKeyStore } from "../store/coinalyze";
import type { ActiveIndicator } from "../store/indicators";

const urls: string[] = [];
/** Réponses retenues : la requête du perp est EN VOL au moment du passage sur la série. */
let enVol: Array<() => void> = [];

beforeEach(() => {
  urls.length = 0;
  enVol = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return new Promise<Response>((resolve) => {
      enVol.push(() => resolve(new Response("[]", { status: 200 })));
    });
  }));
  coinalyzeKeyStore.setState({ hasKey: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function controleur(): ChartIndicators {
  const chart = {
    createIndicator: vi.fn((_c: unknown, _s: boolean, opts?: { id: string }) => opts?.id ?? null),
    overrideIndicator: vi.fn(),
    removeIndicator: vi.fn(),
    getSize: vi.fn(() => ({ top: 0, left: 0, width: 800, height: 100, right: 800, bottom: 100 })),
    setPaneOptions: vi.fn(),
  };
  return new ChartIndicators(chart as unknown as Chart);
}

const JOUR = 86_400_000;
const bougies: Candle[] = Array.from({ length: 50 }, (_, i) => ({
  time: 1_790_000_000_000 + i * JOUR, open: 1, high: 1, low: 1, close: 1, volume: 1,
}));
const liq: ActiveIndicator = { instanceId: "liq-course", defId: "liqParBougie", params: {}, couleurIdx: 0 };
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Graphe Binance sur `perp` (backfill commité : sync direct), puis passage sur `cible` sans sync,
 * puis réponse en vol. Rend les requêtes Coinalyze parties APRÈS la réponse, et le contrôleur.
 */
async function course(perp: string, cible: string): Promise<{ ind: ChartIndicators; apres: string[] }> {
  const ind = controleur();
  ind.setMarket(perp, "1d");
  ind.sync([liq], bougies, "binance", true);
  await attendre(20);
  expect(urls.some((u) => u.includes("liquidation-history")), "requête du perp en vol").toBe(true);
  ind.setMarket(cible, "1d");
  urls.length = 0;
  for (const relacher of enVol.splice(0)) relacher();
  await attendre(30);
  return { ind, apres: urls.filter((u) => u.includes("coinalyzeapi")) };
}

describe("liqParBougie — réponse Coinalyze en vol après le passage sur une série", () => {
  // Un perp distinct par cas : le cache de l'auxProvider est indexé par symbole.
  it.each([
    ["BTCUSDT", "synthetic", "STABLE.D"],
    ["ETHUSDT", "synthetic", "TOTAL3"],
    ["SOLUSDT", "synthetic", "binance:BTCUSDT|/|binance:ETHUSDT"],
    ["XRPUSDT", "twelvedata", "SPY"],
    ["DOGEUSDT", "twelvedata", "EUR/USD"],
    // Tickers libres Twelve Data, hors catalogue curé : avec la source périmée « binance », le
    // prédicat les laisserait passer (comme BTCUSD1) ; KO, curé, sert de témoin.
    ["LINKUSDT", "twelvedata", "IBM"],
    ["DOTUSDT", "twelvedata", "PLTR"],
    ["LTCUSDT", "twelvedata", "KO"],
  ] as const)("%s (en vol) → %s:%s : aucune requête liquidation-history pour la série", async (perp, _source, serie) => {
    expect((await course(perp, serie)).apres).toEqual([]);
  });

  it("témoin : perp → perp, la réponse périmée est jetée, puis le sync du backfill demande le nouveau perp", async () => {
    const { ind, apres } = await course("ADAUSDT", "AVAXUSDT");
    expect(apres, "réponse de l'ancien perp jetée").toEqual([]);
    ind.sync([liq], bougies, "binance", true);
    await attendre(20);
    expect(urls.some((u) => u.includes("liquidation-history") && u.includes("AVAXUSDT"))).toBe(true);
  });
});
