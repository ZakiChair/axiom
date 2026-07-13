/**
 * Tests du pont CVD spot/perp → alertes (store vanilla).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { cvdDivergenceStore } from "./cvd-divergence";

describe("cvdDivergenceStore", () => {
  beforeEach(() => {
    // Reset complet (store singleton).
    cvdDivergenceStore.setState({ bySymbol: {} });
  });

  it("setKind publie null ou un kind ; clear retire la clé", () => {
    cvdDivergenceStore.getState().setKind("btcusdt", null);
    expect(cvdDivergenceStore.getState().bySymbol["BTCUSDT"]).toBeNull();

    cvdDivergenceStore.getState().setKind("BTCUSDT", "spotUp_perpDown");
    expect(cvdDivergenceStore.getState().bySymbol["BTCUSDT"]).toBe("spotUp_perpDown");

    cvdDivergenceStore.getState().clear("btcusdt");
    expect("BTCUSDT" in cvdDivergenceStore.getState().bySymbol).toBe(false);
  });

  it("setKind idempotent ne change pas la référence map si valeur égale", () => {
    cvdDivergenceStore.getState().setKind("ETHUSDT", "spotDown_perpUp");
    const first = cvdDivergenceStore.getState().bySymbol;
    cvdDivergenceStore.getState().setKind("ETHUSDT", "spotDown_perpUp");
    expect(cvdDivergenceStore.getState().bySymbol).toBe(first);
  });
});
