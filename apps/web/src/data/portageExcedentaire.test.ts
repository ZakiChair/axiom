import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PointBasis } from "./binanceDapi";
import { parseTreasuryYieldCurveCsv, type CourbeRendements } from "./macro/treasuryYields";
import {
  calculerPortage,
  dateCourbeUsVersMs,
  echantillonsTbill,
  portageMaturiteConstante,
  tauxSimpleDepuisBey,
  tbillInterpole,
  type PointPortage,
} from "./portageExcedentaire";

// Extrait RÉEL (home.treasury.gov, courbe du vendredi 2026-09-11).
const CSV_11_SEPT = `Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr"
09/11/2026,3.93,3.99,4.05,4.07,4.15,4.12,4.35,4.63`;
const COURBE = parseTreasuryYieldCurveCsv(CSV_11_SEPT)[0]!;
const JOUR = 86_400_000;

/** Point de basis minimal (seuls `jours`, `basisAnnualise` et `source` servent au calcul). */
function point(instrument: string, jours: number, basisAnnualise: number, source: "binance" | "deribit" = "deribit"): PointBasis {
  return { instrument, expiryMs: Date.UTC(2026, 8, 14) + jours * JOUR, future: 0, spot: 0, basisAnnualise, jours, source };
}

describe("tauxSimpleDepuisBey", () => {
  it("identité jusqu'à 182,5 j (le BEY d'un bill court est déjà un taux simple act/365)", () => {
    expect(tauxSimpleDepuisBey(4.12, 182.5)).toBeCloseTo(4.12, 10);
    expect(tauxSimpleDepuisBey(3.93, 30.4)).toBeCloseTo(3.93, 10);
  });
  it("convertit la convention semi-annuelle du Trésor au-delà de 182,5 j (365 j : i + i²/4)", () => {
    expect(tauxSimpleDepuisBey(4.35, 365)).toBeCloseTo(4.397306, 5);
  });
});

describe("tbillInterpole", () => {
  it("aucun taux sous 7 jours ni pour une durée invalide", () => {
    expect(tbillInterpole(COURBE, 5)).toBeNull();
    expect(tbillInterpole(COURBE, Number.NaN)).toBeNull();
  });
  it("plat sous la première maturité présente", () => {
    expect(tbillInterpole(COURBE, 10.5)).toBeCloseTo(3.93, 6);
  });
  it("interpolation linéaire en jours entre maturités, conversion au terme visé", () => {
    expect(tbillInterpole(COURBE, 45.5)).toBeCloseTo(3.989605, 5);
    expect(tbillInterpole(COURBE, 101.5)).toBeCloseTo(4.096842, 5);
    expect(tbillInterpole(COURBE, 192.5)).toBeCloseTo(4.137039, 5);
    expect(tbillInterpole(COURBE, 283.5)).toBeCloseTo(4.279421, 5);
    expect(tbillInterpole(COURBE, 365)).toBeCloseTo(4.397306, 5);
  });
  it("n'utilise que les maturités présentes (colonne « 1.5 Month » vide)", () => {
    const c = parseTreasuryYieldCurveCsv(`Date,"1 Mo","1.5 Month","2 Mo","3 Mo"\n01/02/2025,4.45,,4.36,4.36`)[0]!;
    // 1 Mo (30,4 j, 4.45) → 2 Mo (60,8 j, 4.36) : 45,6 j est le milieu.
    expect(tbillInterpole(c, 45.6)).toBeCloseTo(4.405, 6);
  });
  it("courbe sans aucune maturité bill → null", () => {
    const c: CourbeRendements = { date: "09/11/2026", rendements: { "2 Yr": 4.63 } };
    expect(tbillInterpole(c, 90)).toBeNull();
  });
});

describe("calculerPortage", () => {
  it("portage = basis annualisé (%) − T-bill interpolé à la même durée", () => {
    const [p] = calculerPortage([point("BTC-25DEC26", 101.5, 0.0479)], COURBE);
    expect(p!.instrument).toBe("BTC-25DEC26");
    expect(p!.basisPct).toBeCloseTo(4.79, 10);
    expect(p!.tbillPct).toBeCloseTo(4.096842, 5);
    expect(p!.excesPt).toBeCloseTo(0.693158, 5);
  });
  it("exclut les échéances à moins de 7 jours et les basis non finis", () => {
    const out = calculerPortage(
      [point("BTC-15SEP26", 0.5, -0.0784), point("BTC-X", 40, Number.NaN), point("BTC-25DEC26", 101.5, 0.0479)],
      COURBE,
    );
    expect(out.map((p) => p.instrument)).toEqual(["BTC-25DEC26"]);
  });
  it("courbe absente → []", () => {
    expect(calculerPortage([point("BTC-25DEC26", 101.5, 0.0479)], null)).toEqual([]);
  });
});

describe("portageMaturiteConstante", () => {
  // Relecture du 2026-09-14 19:28 UTC (courbe du 11/09), plus deux contrats Binance COIN-M.
  const deribit = [
    point("BTC-25SEP26", 10.5, 0.0349),
    point("BTC-30OCT26", 45.5, 0.0424),
    point("BTC-27NOV26", 73.5, 0.0458),
    point("BTC-25DEC26", 101.5, 0.0479),
    point("BTC-26MAR27", 192.5, 0.047),
  ];
  const binance = [point("BTCUSD_260925", 10.5, 0.03, "binance"), point("BTCUSD_261225", 101.5, 0.05, "binance")];

  it("interpole le basis Deribit entre les deux échéances qui encadrent 90 j, moins le T-bill 90 j", () => {
    const r = portageMaturiteConstante(calculerPortage([...binance, ...deribit], COURBE), COURBE)!;
    expect(r.source).toBe("deribit");
    expect(r.jours).toBe(90);
    expect(r.avant.instrument).toBe("BTC-27NOV26");
    expect(r.apres.instrument).toBe("BTC-25DEC26");
    expect(r.basisPct).toBeCloseTo(4.70375, 6);
    expect(r.tbillPct).toBeCloseTo(4.069148, 5);
    expect(r.excesPt).toBeCloseTo(0.634602, 5);
  });

  it("repli Binance COIN-M quand Deribit est absent", () => {
    const r = portageMaturiteConstante(calculerPortage(binance, COURBE), COURBE)!;
    expect(r.source).toBe("binance");
    expect(r.avant.instrument).toBe("BTCUSD_260925");
    expect(r.apres.instrument).toBe("BTCUSD_261225");
    expect(r.basisPct).toBeCloseTo(4.747253, 5);
    expect(r.excesPt).toBeCloseTo(0.678105, 5);
  });

  it("échéance exactement à 90 j : son basis, sans interpolation", () => {
    const r = portageMaturiteConstante(calculerPortage([point("BTC-A", 60, 0.04), point("BTC-B", 90, 0.045), point("BTC-C", 120, 0.06)], COURBE), COURBE)!;
    expect(r.avant.instrument).toBe("BTC-B");
    expect(r.apres.instrument).toBe("BTC-B");
    expect(r.basisPct).toBeCloseTo(4.5, 10);
  });

  it("aucune paire encadrante (ni extrapolation) → null", () => {
    const courtes = calculerPortage([point("BTC-A", 20, 0.04), point("BTC-B", 60, 0.045)], COURBE);
    expect(portageMaturiteConstante(courtes, COURBE)).toBeNull();
    // Les échéances < 7 j sont exclues du portage : elles n'encadrent rien.
    const avecTresCourte = calculerPortage([point("BTC-A", 3, 0.02), point("BTC-B", 120, 0.05)], COURBE);
    expect(portageMaturiteConstante(avecTresCourte, COURBE)).toBeNull();
  });

  it("courbe absente → null", () => {
    const pts: PointPortage[] = calculerPortage(deribit, COURBE);
    expect(portageMaturiteConstante(pts, null)).toBeNull();
  });
});

describe("echantillonsTbill", () => {
  const now = Date.UTC(2026, 8, 14, 12);

  it("aucun point avant maintenant + 7 j, bornes du domaine respectées, valeurs interpolées", () => {
    const domaine = { min: now + 2 * JOUR, max: now + 200 * JOUR };
    const pts = echantillonsTbill(COURBE, now, domaine);
    expect(pts.length).toBeGreaterThan(2);
    expect(pts[0]!.ms).toBe(now + 7 * JOUR);
    expect(pts.at(-1)!.ms).toBe(domaine.max);
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.ms).toBeGreaterThan(pts[i - 1]!.ms);
    for (const p of pts) {
      expect(p.ms).toBeGreaterThanOrEqual(now + 7 * JOUR);
      expect(p.ms).toBeLessThanOrEqual(domaine.max);
      expect(p.pct).toBeCloseTo(tbillInterpole(COURBE, (p.ms - now) / JOUR)!, 10);
    }
    // Les nœuds présents dans le domaine sont échantillonnés (angles exacts de la courbe).
    expect(pts.some((p) => Math.abs(p.ms - (now + 91.3 * JOUR)) < 1)).toBe(true);
  });

  it("domaine entièrement avant 7 j ou courbe absente → []", () => {
    expect(echantillonsTbill(COURBE, now, { min: now, max: now + 5 * JOUR })).toEqual([]);
    expect(echantillonsTbill(null, now, { min: now, max: now + 100 * JOUR })).toEqual([]);
  });
});

describe("dateCourbeUsVersMs", () => {
  it("« MM/DD/YYYY » → minuit local du jour", () => {
    expect(dateCourbeUsVersMs("09/11/2026")).toBe(new Date(2026, 8, 11).getTime());
  });
  it("format inattendu → NaN", () => {
    expect(dateCourbeUsVersMs("2026-09-11")).toBeNaN();
    expect(dateCourbeUsVersMs("")).toBeNaN();
  });
});

describe("chargerCourbeTbill (mémo 1 h)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const T0 = Date.UTC(2026, 8, 14, 12);

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deux appels à moins d'une heure : une seule requête, la ligne la plus récente", async () => {
    const { chargerCourbeTbill } = await import("./portageExcedentaire");
    fetchMock.mockResolvedValue({ ok: true, text: async () => CSV_11_SEPT });
    const a = await chargerCourbeTbill(T0);
    const b = await chargerCourbeTbill(T0 + 59 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(COURBE);
    expect(b).toEqual(COURBE);
  });

  it("au-delà d'une heure : nouvelle requête", async () => {
    const { chargerCourbeTbill } = await import("./portageExcedentaire");
    fetchMock.mockResolvedValue({ ok: true, text: async () => CSV_11_SEPT });
    await chargerCourbeTbill(T0);
    await chargerCourbeTbill(T0 + 61 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("panne après un succès : dernière courbe connue ; panne sans historique : null", async () => {
    const { chargerCourbeTbill } = await import("./portageExcedentaire");
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => "" });
    expect(await chargerCourbeTbill(T0)).toBeNull();
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => CSV_11_SEPT });
    expect(await chargerCourbeTbill(T0 + 60_000)).toEqual(COURBE);
    fetchMock.mockRejectedValueOnce(new Error("réseau"));
    expect(await chargerCourbeTbill(T0 + 2 * 3_600_000)).toEqual(COURBE);
  });
});
