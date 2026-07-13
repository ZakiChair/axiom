/**
 * Tests pures du catalogue de fiabilité (Lot A0).
 * Couvre les ids exigés par le brief + fallback inconnu + stabilité des labels.
 */
import { describe, expect, it } from "vitest";
import { metaSource, LABEL_NIVEAU, type NiveauFiabilite } from "./fiabilite";

/** Ids minimaux exigés par le brief A0.2. */
const IDS_REQUIS = [
  "coinalyze:oi",
  "coinalyze:liq",
  "binance:forceOrder",
  "funding:ws",
  "coinmetrics:nvt",
  "bgeometrics:mvrv",
] as const;

describe("metaSource — ids requis (A0.2)", () => {
  it.each(IDS_REQUIS)("%s renvoie un MetaFiabilite complet", (id) => {
    const m = metaSource(id);
    expect(m.niveau).toMatch(/^(fiable|partiel|estimation|indisponible)$/);
    expect(m.label.length).toBeGreaterThan(0);
    expect(m.detail?.length ?? 0).toBeGreaterThan(0);
  });

  it("coinalyze:oi / coinalyze:liq → partiel (latence ≤ 1 min)", () => {
    expect(metaSource("coinalyze:oi").niveau).toBe("partiel");
    expect(metaSource("coinalyze:liq").niveau).toBe("partiel");
    expect(metaSource("coinalyze:oi").label).toMatch(/Coinalyze/i);
    expect(metaSource("coinalyze:liq").label).toMatch(/≤\s*1\s*min/i);
  });

  it("binance:forceOrder → estimation (flux throttlé sous-estimé)", () => {
    const m = metaSource("binance:forceOrder");
    expect(m.niveau).toBe("estimation");
    expect(m.label.toLowerCase()).toMatch(/throttl|sous-estim/);
  });

  it("funding:ws → fiable (WS mark price)", () => {
    const m = metaSource("funding:ws");
    expect(m.niveau).toBe("fiable");
    expect(m.label.toLowerCase()).toMatch(/ws|live|binance/);
  });

  it("coinmetrics:nvt → partiel daily", () => {
    const m = metaSource("coinmetrics:nvt");
    expect(m.niveau).toBe("partiel");
    expect(m.label.toLowerCase()).toMatch(/daily|coin metrics/);
  });

  it("bgeometrics:mvrv → partiel daily", () => {
    const m = metaSource("bgeometrics:mvrv");
    expect(m.niveau).toBe("partiel");
    expect(m.label.toLowerCase()).toMatch(/daily|bgeometric/);
  });
});

describe("metaSource — fallback", () => {
  it("id inconnu → indisponible", () => {
    const m = metaSource("fournisseur:inexistant");
    expect(m.niveau).toBe("indisponible");
    expect(m.label.length).toBeGreaterThan(0);
  });
});

describe("LABEL_NIVEAU", () => {
  it("couvre les 4 niveaux", () => {
    const niveaux: NiveauFiabilite[] = ["fiable", "partiel", "estimation", "indisponible"];
    for (const n of niveaux) {
      expect(LABEL_NIVEAU[n]).toBeTruthy();
    }
  });
});
