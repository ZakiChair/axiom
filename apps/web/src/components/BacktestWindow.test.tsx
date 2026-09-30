import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { runBacktest } from "@axiom/backtest";
import type { Candle } from "@axiom/types";
import { backtestStore } from "../store/backtest";
import { BacktestWindow } from "./BacktestWindow";

// Les overlays nécessitent un canvas navigateur ; le tableau et les statistiques
// sont ceux du vrai panneau, alimentés par un résultat réel du moteur.
vi.mock("../chart/btMarkers", async () => {
  const { createStore } = await import("zustand/vanilla");
  return { btMarksStore: createStore(() => ({ actif: false, basculer: () => {} })) };
});
vi.mock("../lib/navigation", () => ({ navigateTo: () => {} }));

const initial = backtestStore.getState();
afterEach(() => { backtestStore.setState(initial); vi.restoreAllMocks(); });

function afficher(intrabar: boolean): string {
  const candles: Candle[] = [
    { time: 0, open: 100, high: 100, low: 100, close: 100, volume: 1, closed: true },
    { time: 3_600_000, open: 100, high: 150, low: 50, close: 100, volume: 1, closed: true },
  ];
  const resultat = runBacktest(candles, {
    direction: "long", tailleFixe: 1000, stopPct: 5,
    reglesEntree: [{ type: "comparaison", gauche: { type: "prix", champ: "close" }, comparateur: ">", droite: { type: "constante", valeur: 0 } }],
    reglesSortie: [],
  }, { fraisPct: 0, slippagePct: 0, capitalInitial: 1000, intrabar });
  backtestStore.setState({ resultat, phase: "done", intrabar });
  vi.spyOn(backtestStore, "getInitialState").mockImplementation(backtestStore.getState);
  return renderToStaticMarkup(<BacktestWindow />);
}

describe("résultats BT : excursions confirmées", () => {
  it("affiche les bornes sur le trade et les moyennes avec leur explication", () => {
    const html = afficher(true);
    expect(html.match(/>≤ /g)).toHaveLength(2);
    expect(html.match(/>≥ /g)).toHaveLength(2);
    expect(html).toContain("ordre des extrêmes inconnu");
    expect(html).toContain("1 trade à excursions partielles");
  });

  it("préserve l'affichage exact quand aucune sortie intrabar ne tronque les observations", () => {
    const html = afficher(false);
    expect(html).not.toContain(">≤ ");
    expect(html).not.toContain(">≥ ");
    expect(html).not.toContain("trade à excursions partielles");
  });
});
