import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Candle } from "@axiom/types";
import { runBacktest, type Operande, type StrategieDef } from "@axiom/backtest";
import { BUILTIN_STRATEGIES, CATALOGUE_OPERANDES, backtestStore, decrireOperande, specParId } from "./backtest";
import { refSymbolStore } from "./refSymbol";

afterEach(() => vi.unstubAllGlobals());
describe("nouveaux opérandes du backtest", () => {
  it("expose les vraies sorties RVOL et variance, avec les paramètres effectifs", () => {
    expect(specParId("rvolSeasonal:rvol")?.make()).toEqual({ type: "indicateur", indicateurId: "rvolSeasonal", params: {}, output: "rvol" });
    expect(specParId("downsideVariance:down")?.make(20)).toEqual({ type: "indicateur", indicateurId: "downsideVariance", params: { length: 20 }, output: "down" });
    expect(CATALOGUE_OPERANDES.some(s => s.id === "downsideVariance:up")).toBe(true);
  });
  it("refuse RVOL hors H1 avant d'engager un chargement réseau", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    backtestStore.setState({ tf: "15m", reglesEntree: [{ type: "comparaison", gauche: { type: "indicateur", indicateurId: "rvolSeasonal", params: {}, output: "rvol" }, comparateur: ">", droite: { type: "constante", valeur: 2 } }] });
    backtestStore.getState().run();
    expect(backtestStore.getState().phase).toBe("error");
    expect(backtestStore.getState().error).toContain("1h");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("opérandes et preset AXIS (sorties masquées, 9 octobre 2026)", () => {
  it("le catalogue expose etat et score d'AXIS aux défauts, et decrireOperande les retrouve", () => {
    const etat = specParId("stratAxis:etat");
    const score = specParId("stratAxis:score");
    expect(etat?.make()).toEqual({ type: "indicateur", indicateurId: "stratAxis", params: {}, output: "etat" });
    expect(score?.make()).toEqual({ type: "indicateur", indicateurId: "stratAxis", params: {}, output: "score" });
    expect(CATALOGUE_OPERANDES.filter((s) => s.id.startsWith("stratAxis:"))).toHaveLength(2);
    expect(decrireOperande(etat!.make()!)).toEqual({ specId: "stratAxis:etat" });
    expect(decrireOperande(score!.make()!)).toEqual({ specId: "stratAxis:score" });
  });

  it("builtin:axis : preset livré, long, 4h, entrée etat ≥ 1, sortie etat ≤ 0, rien de pré-réglé", () => {
    const preset = BUILTIN_STRATEGIES.find((s) => s.id === "builtin:axis");
    expect(preset).toMatchObject({ name: "AXIS confluence (4h)", tf: "4h", direction: "long", builtin: true, stopPct: null, targetPct: null });
    const etat: Operande = { type: "indicateur", indicateurId: "stratAxis", params: {}, output: "etat" };
    expect(preset?.reglesEntree).toEqual([{ type: "comparaison", gauche: etat, comparateur: ">=", droite: { type: "constante", valeur: 1 } }]);
    expect(preset?.reglesSortie).toEqual([{ type: "comparaison", gauche: etat, comparateur: "<=", droite: { type: "constante", valeur: 0 } }]);
  });

  it("runBacktest sur la fixture dorée : les fills suivent les achats AXIS d'une bougie (open suivant)", () => {
    // Même fixture que stratAxis.test.ts (EMA de tendance 50 : achats 60/107/280,
    // ventes 88/139), toutes bougies dites clôturées — la dernière est décidée.
    const fixture = (
      JSON.parse(
        readFileSync(new URL("../../../../packages/indicators/src/golden/fixture-ohlcv.json", import.meta.url), "utf8")
      ) as Candle[]
    ).map((c) => ({ ...c, closed: true }));
    const etat50: Operande = { type: "indicateur", indicateurId: "stratAxis", params: { emaTendance: 50 }, output: "etat" };
    const strat: StrategieDef = {
      direction: "long",
      tailleFixe: 1000,
      reglesEntree: [{ type: "comparaison", gauche: etat50, comparateur: ">=", droite: { type: "constante", valeur: 1 } }],
      reglesSortie: [{ type: "comparaison", gauche: etat50, comparateur: "<=", droite: { type: "constante", valeur: 0 } }],
    };
    const r = runBacktest(fixture, strat, { fraisPct: 0, slippagePct: 0, capitalInitial: 10_000, timeframe: "4h" });
    // Décision à la clôture de la bougie de signal, fill à l'open de la suivante :
    // achats 60/107/280 → entrées à 61/108/281 ; ventes 88/139 → sorties à 89/140 ;
    // la position ouverte à 281 est clôturée par fin de données.
    expect(r.trades.map((t) => t.tempsEntree)).toEqual([fixture[61]!.time, fixture[108]!.time, fixture[281]!.time]);
    expect(r.trades.map((t) => t.tempsSortie)).toEqual([fixture[89]!.time, fixture[140]!.time, fixture[299]!.time]);
    expect(r.trades).toHaveLength(3);
  });
});

describe("référence du garde-fou de régime dans la fenêtre BT (10 octobre 2026)", () => {
  const PAS_1D = 86_400_000;
  const T0 = Date.now() - 120 * PAS_1D;
  /** Kline REST brute : [openTime, open, high, low, close, volume, ...]. */
  const kline = (t: number, c: number) => [t, String(c), String(c), String(c), String(c), "1", t + PAS_1D - 1, "0", 0, "0", "0"];
  /** Sert des klines 1d à `stubFetch` : série ETHUSDT (cellule) / BTCUSDT (référence). */
  const klinesPour = (url: string) => {
    const u = new URL(url);
    const symbol = u.searchParams.get("symbol");
    const end = Number(u.searchParams.get("endTime") ?? Number.MAX_SAFE_INTEGER);
    const rows: unknown[] = [];
    for (let i = 0; i < 120; i++) {
      const t = T0 + i * PAS_1D;
      if (t <= end) rows.push(kline(t, symbol === "BTCUSDT" ? 40_000 + i * 100 : 100 + i));
    }
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  let postes: unknown[] = [];
  class FauxWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(m: unknown): void { postes.push(m); }
    terminate(): void {}
  }
  const regleAxis = () => [
    { type: "comparaison" as const, gauche: { type: "indicateur" as const, indicateurId: "stratAxis", params: {}, output: "etat" }, comparateur: ">=" as const, droite: { type: "constante" as const, valeur: 1 } },
  ];

  afterEach(() => { postes = []; refSymbolStore.getState().setRefSymbol("BTCUSDT"); });

  async function lancer(): Promise<unknown> {
    backtestStore.getState().run();
    await vi.waitFor(() => { expect(postes.length).toBeGreaterThan(0); }, { timeout: 10_000 });
    return postes[0];
  }

  it("une règle AXIS déclenche le chargement de la référence : params.aux.refClose aligné sur les bougies du run, note « référence … chargée »", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("klines")) return klinesPour(u);
      return new Response("ko", { status: 404 });
    }));
    vi.stubGlobal("Worker", FauxWorker);
    backtestStore.setState({
      symbol: "ETHUSDT", tf: "1d", plage: "3m", modeFunding: "aucun",
      reglesEntree: regleAxis(),
      reglesSortie: [{ type: "comparaison", gauche: { type: "indicateur", indicateurId: "stratAxis", params: {}, output: "etat" }, comparateur: "<=", droite: { type: "constante", valeur: 0 } }],
    });
    const req = await lancer() as { params: { aux?: { refClose?: Array<number | undefined> } }; candles: Candle[] };
    expect(req.params.aux?.refClose).toBeDefined();
    const ref = req.params.aux!.refClose!;
    expect(ref.length).toBe(req.candles.length);
    expect(ref.some((v) => v !== undefined)).toBe(true);
    expect(backtestStore.getState().note).toContain("référence BTCUSDT chargée");
  });

  it("échec réseau de la référence → run sans aux et note « indisponible… v2 »", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("klines") && new URL(u).searchParams.get("symbol") === "BTCUSDT") throw new Error("réseau");
      if (u.includes("klines")) return klinesPour(u);
      return new Response("ko", { status: 404 });
    }));
    vi.stubGlobal("Worker", FauxWorker);
    backtestStore.setState({
      symbol: "ETHUSDT", tf: "1d", plage: "3m", modeFunding: "aucun",
      reglesEntree: regleAxis(),
      reglesSortie: [{ type: "comparaison", gauche: { type: "indicateur", indicateurId: "stratAxis", params: {}, output: "etat" }, comparateur: "<=", droite: { type: "constante", valeur: 0 } }],
    });
    const req = await lancer() as { params: { aux?: unknown } };
    expect(req.params.aux).toBeUndefined();
    expect(backtestStore.getState().note).toContain("garde-fou de régime non appliqué");
  });

  it("une stratégie sans indicateur à refClose ne fetch pas la référence", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("klines")) return klinesPour(u);
      return new Response("ko", { status: 404 });
    });
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("Worker", FauxWorker);
    backtestStore.setState({
      symbol: "ETHUSDT", tf: "1d", plage: "3m", modeFunding: "aucun",
      reglesEntree: [{ type: "comparaison", gauche: { type: "indicateur", indicateurId: "rsi", params: {}, output: "rsi" }, comparateur: ">", droite: { type: "constante", valeur: 60 } }],
      reglesSortie: [],
    });
    const req = await lancer() as { params: { aux?: unknown } };
    expect(req.params.aux).toBeUndefined();
    expect(fetcher.mock.calls.every(([u]) => !String(u).includes("symbol=BTCUSDT"))).toBe(true);
    expect(backtestStore.getState().note ?? "").not.toContain("référence");
  });
});
