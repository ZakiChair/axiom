import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { runBacktest } from "./engine";
import type { StrategieDef } from "./types";

const H = 3_600_000;
const candle = (i: number, high = 100, low = 100): Candle => ({ time: i * H, open: 100, high, low, close: 100, volume: 1, closed: true });
const params = { fraisPct: 0.1, slippagePct: 0, capitalInitial: 1000, intrabar: true, timeframe: "1h" as const };
const entree: StrategieDef["reglesEntree"] = [{ type: "comparaison", gauche: { type: "prix", champ: "close" }, comparateur: ">", droite: { type: "constante", valeur: 0 } }];
const scenarios = [
  { sens: "long" as const, raison: "stop", stopPct: 5, targetPct: undefined, prix: 95, mae: -5, mfe: 0 },
  { sens: "short" as const, raison: "stop", stopPct: 5, targetPct: undefined, prix: 105, mae: -5, mfe: 0 },
  { sens: "long" as const, raison: "target", stopPct: undefined, targetPct: 10, prix: 110, mae: 0, mfe: 10 },
  { sens: "short" as const, raison: "target", stopPct: undefined, targetPct: 10, prix: 90, mae: 0, mfe: 10 },
];

describe("excursions confirmées quand l'ordre intrabar est inconnu", () => {
  it.each(scenarios.flatMap((s) => [true, false].map((derniere) => ({ ...s, derniere }))))(
    "$sens $raison dernière=$derniere : exclut les extrêmes de la barre de sortie sans changer le trade",
    ({ sens, raison, stopPct, targetPct, prix, mae, mfe, derniere }) => {
      const strat: StrategieDef = { direction: sens, tailleFixe: 1000, reglesEntree: entree, reglesSortie: [], stopPct, targetPct };
      const candles = [candle(0), candle(1, 150, 50), ...(!derniere ? [candle(2)] : [])];
      const r = runBacktest(candles, strat, params);
      const tr = r.trades[0]!;
      expect(tr.prixSortie).toBeCloseTo(prix, 10);
      expect(tr.raison).toBe(raison);
      expect(tr.maePct).toBeCloseTo(mae, 10);
      expect(tr.mfePct).toBeCloseTo(mfe, 10);
      expect(tr).toMatchObject({ excursionsPartielles: true });
      expect(r.stats).toMatchObject({ nbExcursionsPartielles: 1 });
      expect(r.stats.maeMoyenPct).toBeCloseTo(mae, 10);
      expect(r.stats.mfeMoyenPct).toBeCloseTo(mfe, 10);
      const amplifie = runBacktest([candle(0), candle(1, 250, 10), ...(!derniere ? [candle(2)] : [])], strat, params);
      expect(amplifie.trades).toEqual(r.trades);
      expect(amplifie.equity).toEqual(r.equity);
      const pnlBrut = (sens === "long" ? prix - 100 : 100 - prix) * 10;
      expect(tr.pnl).toBeCloseTo(pnlBrut - (1000 + prix * 10) * 0.001, 10);
    },
  );

  it.each(scenarios)("$sens $raison conserve les extrêmes des barres entièrement détenues", ({ sens, stopPct, targetPct, mae, mfe }) => {
    const strat: StrategieDef = { direction: sens, tailleFixe: 1000, reglesEntree: entree, reglesSortie: [], stopPct, targetPct };
    const r = runBacktest([candle(0), candle(1, 104, 96), candle(2, 150, 50)], strat, params);
    expect(r.trades[0]!.maePct).toBeCloseTo(Math.min(-4, mae), 10);
    expect(r.trades[0]!.mfePct).toBeCloseTo(Math.max(4, mfe), 10);
  });

  it("inclut l'ouverture de la barre de sortie, même éloignée du prix d'entrée", () => {
    const strat: StrategieDef = { direction: "long", tailleFixe: 1000, reglesEntree: entree, reglesSortie: [], stopPct: 5 };
    const r = runBacktest([candle(0), candle(1), { ...candle(2, 150, 50), open: 108 }], strat, params);
    expect(r.trades[0]).toMatchObject({ prixEntree: 100, prixSortie: 95, excursionsPartielles: true });
    expect(r.trades[0]!.maePct).toBeCloseTo(-5, 10);
    expect(r.trades[0]!.mfePct).toBeCloseTo(8, 10);
  });

  it("refuse une fin calendaire inventée de 30 jours", () => {
    const strat: StrategieDef = { direction: "long", tailleFixe: 1000, reglesEntree: entree, reglesSortie: [] };
    const janvier = Date.UTC(2026, 0, 1);
    const fevrier = Date.UTC(2026, 1, 1);
    expect(() => runBacktest([{ ...candle(0), time: janvier }, { ...candle(0), time: fevrier }], strat,
      { ...params, timeframe: "1M", finDonneesMs: fevrier + 30 * 24 * H })).toThrow("timeframe fixe requis");
  });

  it("fin réelle sans funding : corrige durée et exposition sans changer le PnL ni l'équité", () => {
    const strat: StrategieDef = { direction: "long", tailleFixe: 1000, reglesEntree: entree, reglesSortie: [] };
    const candles = [candle(0), candle(1), { ...candle(2, 110), close: 110 }];
    const legacy = runBacktest(candles, strat, params);
    const actuel = runBacktest(candles, strat, { ...params, finDonneesMs: 3 * H });
    expect(legacy.trades[0]!.dureeMs).toBe(H);
    expect(actuel.trades[0]!.dureeMs).toBe(2 * H);
    expect(actuel.trades[0]!.instantSortieEffectif).toBe(3 * H);
    expect(actuel.stats.expositionPct).toBeCloseTo(200 / 3, 10);
    expect(actuel.trades[0]!.pnl).toBe(legacy.trades[0]!.pnl);
    expect(actuel.equity).toEqual(legacy.equity);
    expect(actuel.trades[0]).not.toHaveProperty("excursionsPartielles");
    expect(actuel.stats).not.toHaveProperty("nbExcursionsPartielles");
  });
});
