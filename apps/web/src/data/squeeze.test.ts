/**
 * Tests des fonctions PURES du radar de squeeze : classification en quadrants
 * funding×ΔOI, construction/exclusion des points, échelle de rayon, hit-testing.
 * Les valeurs attendues sont justifiées en commentaire.
 */
import { describe, it, expect } from "vitest";
import {
  quadrantFundingOi,
  construirePoints,
  rayonPoint,
  plusProchePoint,
  fusionnerSources,
  RAYON_MIN,
  RAYON_MAX,
} from "./squeeze";

describe("quadrantFundingOi — 4 quadrants + zone neutre", () => {
  it("classe les 4 quadrants et la zone neutre", () => {
    // funding<0 & OI↑ = les shorts paient et l'OI monte → carburant à short squeeze.
    expect(quadrantFundingOi(-0.05, 8)).toBe("carburant-squeeze");
    // funding>0 & OI↑ = les longs paient et s'accumulent → longs crowded.
    expect(quadrantFundingOi(0.05, 8)).toBe("longs-crowded");
    // funding>0 & OI↓ = les longs se dénouent → dé-leveraging.
    expect(quadrantFundingOi(0.05, -8)).toBe("deleveraging");
    // funding<0 & OI↓ = rachat/couverture de shorts → shorts crowded.
    expect(quadrantFundingOi(-0.05, -8)).toBe("shorts-crowded");
    // Sous LES DEUX seuils → neutre (bruit / couverture).
    expect(quadrantFundingOi(0.001, 1)).toBe("neutre");
  });

  it("un seul axe sous son seuil ne suffit pas à neutraliser (ET, pas OU)", () => {
    // funding négligeable mais ΔOI significatif → classé par le signe (OI↑, funding≥0).
    expect(quadrantFundingOi(0.001, 8)).toBe("longs-crowded");
    // ΔOI négligeable (−1, sous seuil) mais funding significatif → classé (funding<0, OI<0).
    expect(quadrantFundingOi(-0.05, -1)).toBe("shorts-crowded");
  });

  it("borne stricte du seuil funding : 0.01 %/8h (funding par défaut Binance) reste neutre", () => {
    // ΔOI=8 est significatif à lui seul (≥ SEUIL_DOI_PCT) : l'AND des deux axes ne rend
    // donc PAS le résultat global « neutre » ici — seul l'axe funding est neutre, et
    // l'axe négligeable reste porté par son signe (funding=0.01 est positif) → même
    // quadrant que 0.0101 (significatif) : la borne stricte ne change pas ce cas-ci.
    expect(quadrantFundingOi(0.01, 8)).toBe("longs-crowded");
    expect(quadrantFundingOi(0.0101, 8)).toBe("longs-crowded");
    // Cas qui révèle réellement la borne stricte : ΔOI aussi sous seuil (les DEUX axes
    // doivent être neutres pour "neutre"). Avant le fix (>=), 0.01 était classé
    // significatif → "longs-crowded" ; avec le fix (>), 0.01 est neutre → "neutre".
    expect(quadrantFundingOi(0.01, 1)).toBe("neutre");
    expect(quadrantFundingOi(0.0101, 1)).toBe("longs-crowded");
  });
});

describe("construirePoints — exclusion des lignes incomplètes", () => {
  it("exclut les lignes sans funding OU sans ΔOI et calcule le quadrant", () => {
    const points = construirePoints([
      { symbol: "AUSDT", fundingPct: -0.05, dOiPct: 8, volumeUsd24h: 100 },
      { symbol: "BUSDT", dOiPct: 8, volumeUsd24h: 50 }, // sans funding → exclu
      { symbol: "CUSDT", fundingPct: 0.05, volumeUsd24h: 50 }, // sans ΔOI → exclu
    ]);
    expect(points.map((p) => p.symbol)).toEqual(["AUSDT"]);
    expect(points[0]?.quadrant).toBe("carburant-squeeze");
  });
});

describe("rayonPoint — monotone et borné", () => {
  it("est borné [RAYON_MIN, RAYON_MAX] et proportionnel à √volume", () => {
    // Volume max → rayon max ; volume nul → rayon min (plancher).
    expect(rayonPoint(100, 100)).toBe(RAYON_MAX);
    expect(rayonPoint(0, 100)).toBe(RAYON_MIN);
    // ×4 volume → ×2 rayon (√) tant qu'on reste dans la plage non bornée.
    const r1 = rayonPoint(25, 100); // √(1/4)=0.5 → 8
    const r4 = rayonPoint(100, 100); // √1=1 → 16
    expect(r4).toBeCloseTo(r1 * 2, 6);
    // Monotone croissant.
    expect(rayonPoint(50, 100)).toBeGreaterThan(rayonPoint(25, 100));
  });
});

describe("plusProchePoint — rayon de capture", () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
  ];
  it("retourne l'index du plus proche dans le rayon de capture", () => {
    expect(plusProchePoint(pts, 3, 4, 12)).toBe(0); // distance 5 ≤ 12
    expect(plusProchePoint(pts, 98, 99, 12)).toBe(1);
  });
  it("retourne -1 hors capture et sur liste vide", () => {
    expect(plusProchePoint(pts, 50, 50, 12)).toBe(-1); // trop loin des deux
    expect(plusProchePoint([], 0, 0, 12)).toBe(-1);
  });
});

describe("fusionnerSources — fusion ticker × funding × ΔOI", () => {
  it("mappe volume du ticker, funding et ΔOI par symbole (absent → undefined)", () => {
    const tickers = [
      { symbol: "AUSDT", volumeUsd24h: 100 },
      { symbol: "BUSDT", volumeUsd24h: 50 },
    ];
    const funding = new Map([["AUSDT", -0.05]]); // BUSDT absent de funding
    const oi = new Map([
      ["AUSDT", 8],
      ["BUSDT", 3],
    ]);
    const rows = fusionnerSources(tickers, funding, oi);
    expect(rows).toEqual([
      { symbol: "AUSDT", fundingPct: -0.05, dOiPct: 8, volumeUsd24h: 100 },
      { symbol: "BUSDT", fundingPct: undefined, dOiPct: 3, volumeUsd24h: 50 },
    ]);
    // BUSDT (sans funding) est exclu par construirePoints.
    expect(construirePoints(rows).map((p) => p.symbol)).toEqual(["AUSDT"]);
  });
});
