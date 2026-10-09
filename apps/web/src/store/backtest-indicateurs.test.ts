import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Candle } from "@axiom/types";
import { runBacktest, type Operande, type StrategieDef } from "@axiom/backtest";
import { BUILTIN_STRATEGIES, CATALOGUE_OPERANDES, backtestStore, decrireOperande, specParId } from "./backtest";

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
