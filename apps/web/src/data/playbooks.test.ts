/**
 * Tests PURES des playbooks 1-clic : métadonnées du catalogue + résolution.
 * Les `apply` composent des stores vanilla ; on les exerce via spies (pas de DOM).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLAYBOOKS,
  applyFadeFunding,
  applyMacroFomc,
  applyOptionsDeribit,
  applyRiskOff,
  applyScalpBtc,
  commandesPlaybooks,
  playbookParId,
  playbookParMnemonique,
  playbooksMeta,
} from "./playbooks";
import { chartLayoutStore } from "../store/chart-layout";
import { derivativesChartStore } from "../store/derivatives-chart";
import { macroOverlayStore } from "../store/macro-overlays";
import { marketStore } from "../store/market";
import { orderflowStore } from "../store/orderflow";
import { volumeProfileStore } from "../store/volumeProfile";
import { windowManagerStore } from "../store/windowManager";

/** Seed localStorage pour les stores qui hydratent au chargement. */
function installMockLocalStorage(): void {
  const data = new Map<string, string>();
  const mock: Storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  };
  (globalThis as { localStorage?: Storage }).localStorage = mock;
}

installMockLocalStorage();

describe("playbooksMeta — catalogue seed", () => {
  it("expose exactement 5 playbooks avec ids uniques", () => {
    const meta = playbooksMeta();
    expect(meta).toHaveLength(5);
    const ids = meta.map((m) => m.id);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual([
      "scalp-btc",
      "fade-funding",
      "macro-fomc",
      "risk-off",
      "options-deribit",
    ]);
  });

  it("associe les mnémoniques PLAY-* attendus", () => {
    const byId = Object.fromEntries(playbooksMeta().map((m) => [m.id, m.mnemonique]));
    expect(byId["scalp-btc"]).toBe("PLAY-SCALP");
    expect(byId["fade-funding"]).toBe("PLAY-FADE");
    expect(byId["macro-fomc"]).toBe("PLAY-FOMC");
    expect(byId["risk-off"]).toBe("PLAY-RISK");
    expect(byId["options-deribit"]).toBe("PLAY-OPT");
  });

  it("chaque entrée a nom + description non vides", () => {
    for (const m of playbooksMeta()) {
      expect(m.nom.trim().length).toBeGreaterThan(0);
      expect(m.description.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("playbookParId / playbookParMnemonique", () => {
  it("résout un id connu et renvoie undefined sinon", () => {
    expect(playbookParId("scalp-btc")?.mnemonique).toBe("PLAY-SCALP");
    expect(playbookParId("inconnu")).toBeUndefined();
  });

  it("résout un mnémonique (casse libre)", () => {
    expect(playbookParMnemonique("play-fomc")?.id).toBe("macro-fomc");
    expect(playbookParMnemonique("PLAY-OPT")?.id).toBe("options-deribit");
    expect(playbookParMnemonique("")).toBeUndefined();
  });
});

describe("commandesPlaybooks", () => {
  it("enregistre PLAY + un mnémonique par playbook", () => {
    const mnemos = commandesPlaybooks.map((c) => c.mnemonique);
    expect(mnemos).toContain("PLAY");
    for (const p of PLAYBOOKS) {
      expect(mnemos).toContain(p.mnemonique);
    }
    // Dédup ids
    const ids = commandesPlaybooks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("apply* — composition stores (spies)", () => {
  beforeEach(() => {
    // Remise à zéro des drapeaux session-only.
    orderflowStore.getState().setEnabled(false);
    volumeProfileStore.getState().setEnabled(false);
    derivativesChartStore.setState({ oi: false, funding: false });
    macroOverlayStore.getState().setEnabled([]);
    chartLayoutStore.getState().setLayout("1");
    marketStore.getState().setExchange("binance");
    marketStore.getState().setSymbol("ETHUSDT");
    marketStore.getState().setTimeframe("1h");
    vi.restoreAllMocks();
  });

  it("applyScalpBtc : layout 1, DES+DOM, orderflow+VP, BTC 1m", () => {
    const open = vi.spyOn(windowManagerStore.getState(), "openWindow");
    applyScalpBtc();
    expect(chartLayoutStore.getState().layout).toBe("1");
    expect(marketStore.getState().symbol).toBe("BTCUSDT");
    expect(marketStore.getState().timeframe).toBe("1m");
    expect(orderflowStore.getState().enabled).toBe(true);
    expect(volumeProfileStore.getState().enabled).toBe(true);
    expect(open).toHaveBeenCalledWith("derivatives");
    expect(open).toHaveBeenCalledWith("dom");
  });

  it("applyFadeFunding : DES+EQS + funding pane ON", () => {
    const open = vi.spyOn(windowManagerStore.getState(), "openWindow");
    applyFadeFunding();
    expect(derivativesChartStore.getState().funding).toBe(true);
    expect(open).toHaveBeenCalledWith("derivatives");
    expect(open).toHaveBeenCalledWith("screener");
  });

  it("applyMacroFomc : 2h, ECO+RATE+NEWS, overlays macro", () => {
    const open = vi.spyOn(windowManagerStore.getState(), "openWindow");
    applyMacroFomc();
    expect(chartLayoutStore.getState().layout).toBe("2h");
    expect(macroOverlayStore.getState().enabled).toEqual(["crypto-total", "stablecoins", "m2"]);
    expect(open).toHaveBeenCalledWith("eco");
    expect(open).toHaveBeenCalledWith("macroRates");
    expect(open).toHaveBeenCalledWith("news");
  });

  it("applyRiskOff : 2v, GLOBE+MAP+CORR", () => {
    const open = vi.spyOn(windowManagerStore.getState(), "openWindow");
    applyRiskOff();
    expect(chartLayoutStore.getState().layout).toBe("2v");
    expect(open).toHaveBeenCalledWith("globe");
    expect(open).toHaveBeenCalledWith("marketMap");
    expect(open).toHaveBeenCalledWith("corr");
  });

  it("applyOptionsDeribit : OMON+TERM+VOL", () => {
    const open = vi.spyOn(windowManagerStore.getState(), "openWindow");
    applyOptionsDeribit();
    expect(chartLayoutStore.getState().layout).toBe("1");
    expect(open).toHaveBeenCalledWith("options");
    expect(open).toHaveBeenCalledWith("termStructure");
    expect(open).toHaveBeenCalledWith("vol");
  });
});
