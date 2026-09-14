import { describe, expect, it } from "vitest";
import {
  libelleCourtEvenement,
  volsForward,
  DT_BASE_MAX_JOURS,
  SEUIL_MASQUE_MS,
  type EvenementVol,
} from "./volForward";

// Convention d'injection du temps du dépôt (cf. termIv.test.ts).
const NOW = Date.UTC(2026, 0, 1);
const UN_AN = 365 * 24 * 60 * 60 * 1000;
const JOUR = 24 * 60 * 60 * 1000;
const HEURE = 3_600_000;

/**
 * Points de term structure dont les vols forward consécutives valent exactement `fwds` (%) :
 * variance totale cumulée V(k+1) = V(k) + f(k)² × Δt, puis σ(k) = √(V(k)/T(k)).
 */
function pointsDepuisFwd(debutMs: number, sigma0: number, fwds: number[], dtJours: number[]) {
  let t = (debutMs - NOW) / UN_AN;
  let v = sigma0 * sigma0 * t;
  let exp = debutMs;
  const out = [{ expiryMs: exp, ivAtm: sigma0 }];
  fwds.forEach((f, i) => {
    const dt = (dtJours[i] ?? 1) * JOUR;
    exp += dt;
    t += dt / UN_AN;
    v += f * f * (dt / UN_AN);
    out.push({ expiryMs: exp, ivAtm: Math.sqrt(v / t) });
  });
  return out;
}

describe("volsForward", () => {
  it("additivité de la variance : σ fwd = √[(σ2²T2 − σ1²T1)/(T2 − T1)]", () => {
    const points = [
      { expiryMs: NOW + 0.1 * UN_AN, ivAtm: 30 },
      { expiryMs: NOW + 0.2 * UN_AN, ivAtm: 40 },
    ];
    const [s] = volsForward(points, NOW, []);
    expect(s?.debutMs).toBe(points[0]?.expiryMs);
    expect(s?.finMs).toBe(points[1]?.expiryMs);
    expect(s?.dtJours).toBeCloseTo(36.5, 9);
    expect(s?.sigmaFwd).toBeCloseTo(Math.sqrt(2300), 9); // ≈ 47,96 %
    expect(s?.masque).toBe(false);
    expect(s?.varianceNegative).toBe(false);
    // Move 1σ sur la fenêtre : σ fwd × √(Δt en années).
    expect(s?.move1SigmaPct).toBeCloseTo(Math.sqrt(2300) * Math.sqrt(0.1), 9);
  });

  it("variance forward négative : σ fwd null (jamais 0) et incohérence signalée", () => {
    const points = [
      { expiryMs: NOW + 0.1 * UN_AN, ivAtm: 50 },
      { expiryMs: NOW + 0.2 * UN_AN, ivAtm: 30 },
    ];
    const [s] = volsForward(points, NOW, []);
    expect(s?.sigmaFwd).toBeNull();
    expect(s?.varianceNegative).toBe(true);
    expect(s?.move1SigmaPct).toBeNull();
    expect(s?.moveEvenementPct).toBeNull();
  });

  it("masque les fenêtres dont une échéance a moins de 12 h de vie", () => {
    expect(SEUIL_MASQUE_MS).toBe(12 * HEURE);
    const fin = NOW + 5 * JOUR;
    const [masque] = volsForward([{ expiryMs: NOW + 11 * HEURE, ivAtm: 40 }, { expiryMs: fin, ivAtm: 40 }], NOW, []);
    expect(masque?.masque).toBe(true);
    expect(masque?.sigmaFwd).toBeNull();
    expect(masque?.varianceNegative).toBe(false);
    expect(masque?.move1SigmaPct).toBeNull();
    const [visible] = volsForward([{ expiryMs: NOW + 13 * HEURE, ivAtm: 40 }, { expiryMs: fin, ivAtm: 40 }], NOW, []);
    expect(visible?.masque).toBe(false);
    expect(visible?.sigmaFwd).toBeCloseTo(40, 9);
  });

  it("événements rattachés à ]début ; fin]", () => {
    const debut = NOW + 2 * JOUR;
    const fin = NOW + 3 * JOUR;
    const points = [
      { expiryMs: debut, ivAtm: 40 },
      { expiryMs: fin, ivAtm: 40 },
    ];
    const dedans: EvenementVol = { time: debut + HEURE, libelle: "FOMC Statement" };
    const surDebut: EvenementVol = { time: debut, libelle: "au début" };
    const surFin: EvenementVol = { time: fin, libelle: "à la fin" };
    const apres: EvenementVol = { time: fin + HEURE, libelle: "après" };
    const [s] = volsForward(points, NOW, [surDebut, dedans, surFin, apres]);
    expect(s?.evenements).toEqual([dedans, surFin]);
  });

  it("part attribuable à l'événement : √(σ fwd² − σ base²) × √Δt, σ base = médiane des fenêtres voisines sans événement", () => {
    const debut = NOW + 2 * JOUR;
    // Fenêtres d'un jour : 34 %, 50 % (FOMC), 36 %, 35,7 %.
    const points = pointsDepuisFwd(debut, 40, [34, 50, 36, 35.7], [1, 1, 1, 1]);
    const fomc: EvenementVol = { time: debut + JOUR + 10 * HEURE, libelle: "Décision FOMC (taux directeur)" };
    const segments = volsForward(points, NOW, [fomc]);
    expect(segments.map((s) => s.sigmaFwd)).toEqual([
      expect.closeTo(34, 9),
      expect.closeTo(50, 9),
      expect.closeTo(36, 9),
      expect.closeTo(35.7, 9),
    ]);
    const evt = segments[1];
    expect(evt?.evenements).toEqual([fomc]);
    expect(evt?.move1SigmaPct).toBeCloseTo(50 / Math.sqrt(365), 9); // ≈ 2,62 %
    expect(evt?.moveEvenementPct).toBeCloseTo(Math.sqrt(50 * 50 - 35.7 * 35.7) / Math.sqrt(365), 9); // ≈ 1,83 %
    // Sans événement : aucune part attribuée.
    expect(segments[0]?.moveEvenementPct).toBeNull();
  });

  it("fenêtre à événement de plusieurs jours (≤ 7 j) : part mise à l'échelle √(Δt/365), pas /√365", () => {
    const debut = NOW + 2 * JOUR;
    // 34 % sur 1 j ; 50 % sur 5 j (FOMC) ; 36 % et 35,7 % sur 1 j → σ base = médiane(34 ; 36 ; 35,7) = 35,7.
    const points = pointsDepuisFwd(debut, 40, [34, 50, 36, 35.7], [1, 5, 1, 1]);
    const fomc: EvenementVol = { time: debut + 3 * JOUR, libelle: "FOMC" };
    const segments = volsForward(points, NOW, [fomc]);
    const evt = segments[1];
    expect(evt?.dtJours).toBeCloseTo(5, 9);
    expect(evt?.evenements).toEqual([fomc]);
    expect(evt?.sigmaFwd).toBeCloseTo(50, 9);
    expect(evt?.move1SigmaPct).toBeCloseTo(50 * Math.sqrt(5 / 365), 9); // ≈ 5,85 %
    expect(evt?.moveEvenementPct).toBeCloseTo(Math.sqrt(50 * 50 - 35.7 * 35.7) * Math.sqrt(5 / 365), 9); // ≈ 4,10 %
  });

  it("σ base ignore les fenêtres longues ; aucune part d'événement lue sur une fenêtre > 7 j", () => {
    expect(DT_BASE_MAX_JOURS).toBe(7);
    const debut = NOW + 2 * JOUR;
    // 34 %, 50 % (évt), 36 %, 35,7 % sur 1 j ; puis 60 % sur 30 j sans évt ; puis 45 % sur 30 j avec évt.
    const points = pointsDepuisFwd(debut, 40, [34, 50, 36, 35.7, 60, 45], [1, 1, 1, 1, 30, 30]);
    const evenements: EvenementVol[] = [
      { time: debut + JOUR + HEURE, libelle: "FOMC" },
      { time: debut + 40 * JOUR, libelle: "CPI" },
    ];
    const segments = volsForward(points, NOW, evenements);
    // La fenêtre de 30 j à 60 % n'entre pas dans la médiane : base toujours 35,7.
    expect(segments[1]?.moveEvenementPct).toBeCloseTo(Math.sqrt(50 * 50 - 35.7 * 35.7) / Math.sqrt(365), 9);
    // Fenêtre de 30 j avec événement : l'excès de variance mêle la pente de la courbe, pas de part lue.
    expect(segments[5]?.evenements).toHaveLength(1);
    expect(segments[5]?.sigmaFwd).toBeCloseTo(45, 9);
    expect(segments[5]?.moveEvenementPct).toBeNull();
  });

  it("σ base indisponible (aucune fenêtre courte sans événement exploitable) : part d'événement null", () => {
    const debut = NOW + 2 * JOUR;
    const points = pointsDepuisFwd(debut, 40, [50], [1]);
    const [s] = volsForward(points, NOW, [{ time: debut + HEURE, libelle: "FOMC" }]);
    expect(s?.sigmaFwd).toBeCloseTo(50, 9);
    expect(s?.moveEvenementPct).toBeNull();
  });

  it("σ fwd sous la base : part d'événement nulle, bornée à 0", () => {
    const debut = NOW + 2 * JOUR;
    const points = pointsDepuisFwd(debut, 40, [40, 30], [1, 1]);
    const segments = volsForward(points, NOW, [{ time: debut + JOUR + HEURE, libelle: "CPI" }]);
    expect(segments[1]?.moveEvenementPct).toBe(0);
  });

  it("moins de deux points : aucun segment", () => {
    expect(volsForward([], NOW, [])).toEqual([]);
    expect(volsForward([{ expiryMs: NOW + JOUR, ivAtm: 40 }], NOW, [])).toEqual([]);
  });
});

describe("libelleCourtEvenement", () => {
  it("abrège les publications connues en six caractères au plus", () => {
    expect(libelleCourtEvenement("Décision FOMC (taux directeur)")).toBe("FOMC");
    expect(libelleCourtEvenement("Federal Funds Rate")).toBe("FOMC");
    expect(libelleCourtEvenement("Core CPI m/m")).toBe("CPI");
    expect(libelleCourtEvenement("Consumer Price Index")).toBe("CPI");
    expect(libelleCourtEvenement("Non-Farm Employment Change")).toBe("NFP");
    expect(libelleCourtEvenement("Employment Situation")).toBe("NFP");
    expect(libelleCourtEvenement("Core PCE Price Index m/m")).toBe("PCE");
    expect(libelleCourtEvenement("Personal Income and Outlays")).toBe("PCE");
    expect(libelleCourtEvenement("Advance GDP q/q")).toBe("PIB");
    expect(libelleCourtEvenement("ISM Manufacturing PMI")).toBe("Évt");
  });
});
