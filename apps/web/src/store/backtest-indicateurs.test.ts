import { afterEach, describe, expect, it, vi } from "vitest";
import { CATALOGUE_OPERANDES, backtestStore, specParId } from "./backtest";

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
