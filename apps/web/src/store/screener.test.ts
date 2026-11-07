/**
 * Tests du store du screener (EQS) pour les conditions ouvertes : copie profonde des
 * préréglages à règles, ajout et remplacement de conditions, TF et conditions figés au
 * lancement, ouverture d'un résultat au graphe avec les instances de l'unité du run.
 * Réseau et graphe bouchonnés.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { navigateToMock, ajouterPresetMock, executerScreenerMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn(),
  ajouterPresetMock: vi.fn(() => ({ instances: [], raison: null })),
  executerScreenerMock: vi.fn(() => new Promise(() => {})),
}));

vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
vi.mock("../chart/drawing", () => ({ getActiveChart: () => null, setFocusChart: () => {} }));
vi.mock("../lib/navigation", () => ({ navigateTo: navigateToMock }));
vi.mock("../lib/indicatorPresets", () => ({ ajouterPreset: ajouterPresetMock }));
vi.mock("../data/screenerRun", () => ({
  executerScreener: executerScreenerMock,
  mapPool: vi.fn(),
  TICKER_24H_URL: "",
  OI_HIST_LIMIT: 25,
}));

import { ouvrirDansChart, screenerStore } from "./screener";
import { PRESETS_DESCRIPTIFS } from "../data/screenerRegles";

beforeEach(() => {
  navigateToMock.mockClear();
  ajouterPresetMock.mockClear();
  executerScreenerMock.mockClear();
});

describe("préréglages à règles", () => {
  it("loadPreset copie en profondeur : éditer le builder ne touche pas le préréglage", () => {
    const preset = PRESETS_DESCRIPTIFS[0]!;
    const avant = JSON.stringify(preset);
    screenerStore.getState().loadPreset(preset.id);
    const s = screenerStore.getState();
    expect(s.tf).toBe("4h");
    expect(s.dernierPresetCharge).toBe(preset.id);
    const regle = s.indicatorConditions[0]!;
    if (regle.kind !== "regle" || regle.condition.type !== "croisement" || regle.condition.a.type !== "indicateur") {
      throw new Error("règle de squeeze attendue");
    }
    regle.condition.a.params.length = 99;
    expect(JSON.stringify(preset)).toBe(avant);
  });

  it("ajout d'une règle et remplacement d'une condition invalident le preset chargé", () => {
    screenerStore.getState().loadPreset(PRESETS_DESCRIPTIFS[1]!.id);
    const n = screenerStore.getState().indicatorConditions.length;
    screenerStore.getState().addRegleCondition();
    let s = screenerStore.getState();
    expect(s.indicatorConditions).toHaveLength(n + 1);
    expect(s.indicatorConditions[n]!.kind).toBe("regle");
    expect(s.dernierPresetCharge).toBeNull();
    s.replaceIndicatorCondition(0, { kind: "indicator", fieldId: "takerNet", op: ">", value: 10 });
    s = screenerStore.getState();
    expect(s.indicatorConditions[0]).toEqual({ kind: "indicator", fieldId: "takerNet", op: ">", value: 10 });
  });
});

describe("ouverture d'un résultat au graphe", () => {
  it("ouvre à l'unité du RUN avec ses instances, même si le builder a changé depuis", () => {
    screenerStore.getState().loadPreset(PRESETS_DESCRIPTIFS[0]!.id);
    screenerStore.getState().run();
    expect(executerScreenerMock).toHaveBeenCalledTimes(1);
    screenerStore.getState().setTf("1h");
    screenerStore.getState().replaceIndicatorCondition(0, { kind: "indicator", fieldId: "rsi", param: 14, op: "<", value: 30 });

    ouvrirDansChart("SOLUSDT");
    expect(navigateToMock).toHaveBeenCalledWith({ symbol: "SOLUSDT", exchange: "binance", timeframe: "4h", source: "eqs" });
    // Squeeze 4h posé ; le Supertrend 1d n'est pas posé sur un graphe 4h.
    expect(ajouterPresetMock).toHaveBeenCalledTimes(1);
    const arg = (ajouterPresetMock.mock.calls[0] as unknown as [{ instances: unknown[] }])[0];
    expect(arg.instances).toEqual([{ defId: "ttmSqueeze", params: { length: 20, multBB: 2, multKC: 1.5 } }]);
    // Ce qui n'est pas posé est dit : la condition 1d sur un graphe 4h.
    expect(screenerStore.getState().avisGraphe).toBe("SOLUSDT : conditions 1d non posées (graphe ouvert en 4h)");
  });

  it("panneaux pleins : le refus de poser les instances est remonté, jamais implicite", () => {
    screenerStore.setState({ runTf: "4h", runConditions: [{ kind: "indicator", fieldId: "rsi", param: 14, op: "<", value: 30 }] });
    ajouterPresetMock.mockReturnValueOnce({
      instances: [],
      raison: "3 panneaux maximum à cette hauteur : fermez un panneau ou agrandissez le graphique.",
    } as never);
    ouvrirDansChart("ETHUSDT");
    expect(screenerStore.getState().avisGraphe).toBe(
      "ETHUSDT : indicateurs des conditions non posés : 3 panneaux maximum à cette hauteur : fermez un panneau ou agrandissez le graphique.",
    );
    // Instances posées sans réserve : plus d'avis ; un nouveau run l'efface aussi.
    ouvrirDansChart("ETHUSDT");
    expect(screenerStore.getState().avisGraphe).toBeNull();
    screenerStore.setState({ avisGraphe: "ancien" });
    screenerStore.getState().run();
    expect(screenerStore.getState().avisGraphe).toBeNull();
  });

  it("RS Mansfield d'un run 1d : ratio sans instance, et c'est dit", () => {
    screenerStore.setState({ runTf: "1d", runConditions: [{ kind: "indicator", fieldId: "rsMansfield", op: ">", value: 0 }] });
    ouvrirDansChart("ADAUSDT");
    expect(ajouterPresetMock).not.toHaveBeenCalled();
    expect(screenerStore.getState().avisGraphe).toBe("ADAUSDT : RS Mansfield non posé (ratio sans instance sur le graphe)");
  });
});
