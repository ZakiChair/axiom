import { describe, expect, it } from "vitest";
import { lectures, type EntreesLecture } from "./lecturesBrief";

const VIDE: EntreesLecture = {
  nuitBtcPct: null,
  fundingPercentile: null,
  dvolPercentile: null,
  deltaOi24hPct: null,
  fearGreed: null,
  regimeGamma: null,
  gexNetUsd: null,
};

describe("lectures", () => {
  it("tout absent → aucune phrase", () => {
    expect(lectures(VIDE)).toEqual([]);
  });
  it("phrase de contexte : nuit + funding + vol", () => {
    const l = lectures({
      ...VIDE,
      nuitBtcPct: -2.1,
      fundingPercentile: 48,
      dvolPercentile: 81,
    });
    expect(l[0]).toBe("Nuit baissière (BTC -2.1%), funding neutre (p48), vol élevée (p81).");
  });
  it("nuit seule, haussière puis calme", () => {
    expect(lectures({ ...VIDE, nuitBtcPct: 1.4 })[0]).toBe("Nuit haussière (BTC +1.4%).");
    expect(lectures({ ...VIDE, nuitBtcPct: 0.2 })[0]).toBe("Nuit calme (BTC +0.2%).");
  });
  it("positionnement long tendu : funding ≥ p90 ET ΔOI ≥ +3 %", () => {
    const l = lectures({ ...VIDE, fundingPercentile: 95, deltaOi24hPct: 6 });
    expect(l).toContain("Funding p95 avec ΔOI +6.0% sur 24 h : positionnement long tendu.");
    // Sous le seuil de ΔOI, pas de phrase de positionnement (et pas de nuit → pas de contexte).
    expect(lectures({ ...VIDE, fundingPercentile: 95, deltaOi24hPct: 1 })).toEqual([]);
  });
  it("gamma dealers : lecture seulement quand le régime est tranché", () => {
    expect(lectures({ ...VIDE, regimeGamma: "long-gamma", gexNetUsd: 51_000_000 })).toEqual([
      "Dealers options BTC long gamma (net +$51.00M) : mouvements amortis, aimantation vers les murs.",
    ]);
    expect(lectures({ ...VIDE, regimeGamma: "short-gamma", gexNetUsd: -51_000_000 })).toEqual([
      "Dealers options BTC short gamma (net −$51.00M) : mouvements amplifiés (carburant de squeeze/cascade).",
    ]);
    // Net indisponible : la lecture reste valable, sans la parenthèse de montant.
    expect(lectures({ ...VIDE, regimeGamma: "long-gamma", gexNetUsd: null })).toEqual([
      "Dealers options BTC long gamma : mouvements amortis, aimantation vers les murs.",
    ]);
    // Indéterminé ou absent : pas de phrase.
    expect(lectures({ ...VIDE, regimeGamma: "indetermine", gexNetUsd: 1_000_000 })).toEqual([]);
    expect(lectures(VIDE)).toEqual([]);
  });
  it("sentiment aux extrêmes seulement", () => {
    expect(lectures({ ...VIDE, fearGreed: 80 })).toEqual(["Sentiment en zone avidité (F&G 80)."]);
    expect(lectures({ ...VIDE, fearGreed: 20 })).toEqual(["Sentiment en zone peur (F&G 20)."]);
    expect(lectures({ ...VIDE, fearGreed: 50 })).toEqual([]);
  });
  it("plafond : 3 phrases max, jamais de vocabulaire prescriptif", () => {
    const l = lectures({
      nuitBtcPct: -4,
      fundingPercentile: 95,
      dvolPercentile: 90,
      deltaOi24hPct: 8,
      fearGreed: 12,
      regimeGamma: "short-gamma",
      gexNetUsd: -80_000_000,
    });
    expect(l.length).toBeLessThanOrEqual(3);
    for (const phrase of l) {
      expect(phrase.toLowerCase()).not.toMatch(/acheter|vendre|conseil|prendre position/);
    }
  });

  it("à 4 candidates, c'est la phrase SENTIMENT qui saute (priorité flux > sentiment, documentée)", () => {
    // Scénario de stress où les 4 co-occurrent : nuit + positionnement + gamma
    // + F&G extrême. Le F&G reste visible ailleurs (badge NEWS, pastille REGIME).
    const l = lectures({
      nuitBtcPct: -4,
      fundingPercentile: 95,
      dvolPercentile: 90,
      deltaOi24hPct: 8,
      fearGreed: 12,
      regimeGamma: "short-gamma",
      gexNetUsd: -80_000_000,
    });
    expect(l).toHaveLength(3);
    expect(l.some((p) => p.includes("short gamma"))).toBe(true);
    expect(l.some((p) => p.includes("F&G"))).toBe(false);
  });
});
