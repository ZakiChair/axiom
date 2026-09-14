import { describe, expect, it } from "vitest";
import {
  calculerModelesPrix,
  JOURS_200_SEMAINES,
  JOURS_2_ANS,
  PI_COEFFICIENT,
  piCycleBottom,
  ratioMoyenne,
} from "./modelesPrix";
import type { PointMetrique } from "./onchain/coinmetrics";

/** Un jour en millisecondes (les points Coin Metrics sont datés à 00:00 UTC). */
const JOUR = 86_400_000;
const T0 = Date.UTC(2020, 0, 1);

/** Série quotidienne à partir de T0 : un point par prix, jour après jour. */
function quotidien(prix: readonly number[]): PointMetrique[] {
  return prix.map((value, i) => ({ time: T0 + i * JOUR, value }));
}

/*
 * Lectures réelles (PriceUSD Coin Metrics, 5 902 points au 2026-09-13, non embarquables) :
 * - SMA 1 400 j 65 101,96 $ · multiple 1,1791 (vraie WMA 200 semaines : 1,1780) · percentile
 *   20,18 · 28 j au-dessus depuis le 2026-08-17 · 1er ratio le 2014-05-17 ;
 * - SMA 730 j 88 221,24 $ · ratio 0,8701 · percentile 21,25 · 228 j en dessous depuis le
 *   2026-01-29 · 1er ratio le 2012-07-16 ;
 * - Pi Cycle Bottom : EMA 150 j 71 516,35 $ · seuil 0,745 × SMA 471 j 65 725,01 $ · ratio
 *   1,0881 · écart +8,81 % · minimum 2026 1,0305 le 2026-08-18 ; épisodes 2015-01-14 (175,64 $)
 *   → 2015-09-28, 2018-12-16 (3 195,41 $) → 2019-05-09, 2022-07-13 (20 155,53 $) → 2023-03-16.
 */

describe("ratioMoyenne", () => {
  it("rapporte le dernier prix à sa SMA et le situe dans l'historique des ratios (rang mi-distance)", () => {
    const points = quotidien([...Array(1400).fill(100), 150]);
    const r = ratioMoyenne(points, JOURS_200_SEMAINES)!;
    const moyenne = (1399 * 100 + 150) / 1400;
    expect(r.moyenne).toBeCloseTo(moyenne, 10);
    expect(r.ratio).toBeCloseTo(150 / moyenne, 10);
    // Deux ratios (1 puis 1,4995) : 1 strictement dessous + le dernier à égalité / 2 → 75.
    expect(r.percentile).toBe(75);
    expect(r.premierMs).toBe(T0 + 1399 * JOUR);
    expect(r.sequence).toEqual({ sens: "dessus", jours: 2, depuisMs: T0 + 1399 * JOUR });
  });

  it("compte les jours consécutifs sous la moyenne et date le début de la séquence", () => {
    const points = quotidien([...Array(730).fill(100), ...Array(10).fill(50)]);
    const r = ratioMoyenne(points, JOURS_2_ANS)!;
    expect(r.ratio).toBeLessThan(1);
    expect(r.sequence).toEqual({ sens: "dessous", jours: 10, depuisMs: T0 + 730 * JOUR });
  });

  it("renvoie null sous la fenêtre ; un seul ratio donne un percentile NaN, jamais 0", () => {
    expect(ratioMoyenne(quotidien(Array(729).fill(100)), JOURS_2_ANS)).toBeNull();
    const r = ratioMoyenne(quotidien(Array(730).fill(100)), JOURS_2_ANS)!;
    expect(r.ratio).toBe(1);
    expect(r.percentile).toBeNaN();
  });

  it("ignore les prix non finis ou ≤ 0 avant le calcul", () => {
    const propres = quotidien([...Array(730).fill(100), ...Array(5).fill(80)]);
    const bruites = [...propres.slice(0, 300), { time: T0 - JOUR, value: Number.NaN }, { time: T0 - 2 * JOUR, value: 0 }, ...propres.slice(300)];
    expect(ratioMoyenne(bruites, JOURS_2_ANS)).toEqual(ratioMoyenne(propres, JOURS_2_ANS));
    expect(ratioMoyenne([...propres.slice(0, 729), { time: T0, value: Number.NaN }], JOURS_2_ANS)).toBeNull();
  });
});

describe("piCycleBottom", () => {
  it("série constante : ratio 1 / 0,745, écart ≈ +34,23 %, aucun épisode", () => {
    const p = piCycleBottom(quotidien(Array(600).fill(100)))!;
    expect(p.ratio).toBeCloseTo(1 / PI_COEFFICIENT, 10);
    expect(p.ecartPct).toBeCloseTo(34.228, 3);
    expect(p.ema150).toBeCloseTo(100, 10);
    expect(p.seuil).toBeCloseTo(74.5, 10);
    expect(p.episodes).toEqual([]);
  });

  it("EMA 150 j par récurrence (k = 2/151, amorce = SMA des 150 premiers points), distincte de la SMA 150 j", () => {
    // Paliers : 75 à 50 puis 75 à 150 (amorce 100), 330 à 100 (l'EMA reste 100), 10 à 200.
    // Une rampe linéaire ne suffit pas : amorcée par la SMA, l'EMA y égale exactement la SMA 150 j.
    const prix = [...Array(75).fill(50), ...Array(75).fill(150), ...Array(330).fill(100), ...Array(10).fill(200)];
    const p = piCycleBottom(quotidien(prix))!;
    const ema150 = 200 - 100 * (149 / 151) ** 10; // ≈ 112,4828
    const sma150 = (140 * 100 + 10 * 200) / 150; // ≈ 106,6667 : valeur d'une SMA à la place de l'EMA
    const sma471 = (56 * 50 + 75 * 150 + 330 * 100 + 10 * 200) / 471; // ≈ 104,1401
    expect(p.ema150).toBeCloseTo(ema150, 6);
    expect(p.ema150).not.toBeCloseTo(sma150, 0);
    expect(p.seuil).toBeCloseTo(PI_COEFFICIENT * sma471, 6);
    expect(p.ratio).toBeCloseTo(ema150 / (PI_COEFFICIENT * sma471), 6);
  });

  it("renvoie null sous 471 prix exploitables", () => {
    expect(piCycleBottom(quotidien(Array(470).fill(100)))).toBeNull();
    expect(piCycleBottom(quotidien(Array(471).fill(100)))).not.toBeNull();
  });

  it("chute puis reprise : un épisode, entrée au premier jour sous le seuil, sortie au retour au-dessus", () => {
    const prix = [...Array(600).fill(100), ...Array(200).fill(40), ...Array(400).fill(300)];
    const points = quotidien(prix);
    const p = piCycleBottom(points)!;
    expect(p.episodes).toHaveLength(1);
    const [episode] = p.episodes;
    const i = Math.round((episode!.entreeMs - T0) / JOUR);
    // Le jour d'entrée est exactement le premier où le ratio passe sous 1.
    expect(piCycleBottom(points.slice(0, i))!.ratio).toBeGreaterThanOrEqual(1);
    expect(piCycleBottom(points.slice(0, i + 1))!.ratio).toBeLessThan(1);
    expect(episode!.prixEntree).toBe(prix[i]);
    expect(episode!.sortieMs).not.toBeNull();
    const s = Math.round((episode!.sortieMs! - T0) / JOUR);
    expect(piCycleBottom(points.slice(0, s))!.ratio).toBeLessThan(1);
    expect(piCycleBottom(points.slice(0, s + 1))!.ratio).toBeGreaterThanOrEqual(1);
    expect(p.ratio).toBeGreaterThanOrEqual(1);
  });

  it("épisode en cours : sortie null tant que le ratio reste sous 1", () => {
    const p = piCycleBottom(quotidien([...Array(600).fill(100), ...Array(200).fill(40)]))!;
    expect(p.ratio).toBeLessThan(1);
    expect(p.episodes).toHaveLength(1);
    expect(p.episodes[0]!.sortieMs).toBeNull();
  });
});

describe("calculerModelesPrix", () => {
  it("assemble les trois modèles ; chacun est null faute d'historique suffisant", () => {
    const court = calculerModelesPrix(quotidien(Array(800).fill(100)));
    expect(court.multiple200Semaines).toBeNull();
    expect(court.ratio2Ans).not.toBeNull();
    expect(court.piCycleBottom).not.toBeNull();
    expect(calculerModelesPrix([])).toEqual({ multiple200Semaines: null, ratio2Ans: null, piCycleBottom: null });
    const long = calculerModelesPrix(quotidien(Array(1400).fill(100)));
    expect(long.multiple200Semaines!.ratio).toBe(1);
  });
});
