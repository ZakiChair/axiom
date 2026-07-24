import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import type { FenetreAlignee, OccurrenceExclue } from "./evts";
import { agregerFenetres, alignerFenetre, statsEvts } from "./evts";

const H = 3_600_000; // une heure en ms

function c(time: number, close: number): Candle {
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

/** Fabrique une fenêtre alignée synthétique à partir d'un dico offset→ratio. */
function fen(eventTime: number, ratios: Record<number, number>): FenetreAlignee {
  const points = Object.entries(ratios)
    .map(([offset, ratio]) => ({ offset: Number(offset), ratio }))
    .sort((a, b) => a.offset - b.offset);
  return { eventTime, points };
}

describe("alignerFenetre", () => {
  // 100 bougies 1h régulières, close distinct par bougie (100 + i) pour pouvoir pister H0.
  const base = Date.UTC(2025, 0, 1);
  const candles: Candle[] = Array.from({ length: 100 }, (_, i) => c(base + i * H, 100 + i));

  it("aligne sur H0 = bougie couvrant l'évènement, 2N+1 points, ratio H0 = 1", () => {
    // Évènement au milieu de la bougie 50 (open time 50h + 30 min).
    const eventTime = base + 50 * H + H / 2;
    const res = alignerFenetre(candles, eventTime, 10) as FenetreAlignee;

    expect("points" in res).toBe(true);
    expect(res.eventTime).toBe(eventTime);
    // Fenêtre [40, 60] → 21 points, offsets −10..+10 en ordre.
    expect(res.points).toHaveLength(21);
    expect(res.points.map((p) => p.offset)).toEqual(
      Array.from({ length: 21 }, (_, k) => k - 10),
    );
    // H0 = bougie 50 → ratio de l'offset 0 exactement 1.
    const h0 = res.points.find((p) => p.offset === 0);
    expect(h0?.ratio).toBe(1);
    // Ratio d'un offset non nul = close(50+offset)/close(50) : pince H0 sur la bougie 50.
    const p1 = res.points.find((p) => p.offset === 1);
    expect(p1?.ratio).toBeCloseTo(151 / 150, 12);
    const pm3 = res.points.find((p) => p.offset === -3);
    expect(pm3?.ratio).toBeCloseTo(147 / 150, 12);
  });

  it("exclut quand la fenêtre déborde du bord gauche", () => {
    const eventTime = base + 3 * H + H / 2; // H0 = bougie 3, 3 − 10 < 0
    const res = alignerFenetre(candles, eventTime, 10);
    expect(res).toEqual<OccurrenceExclue>({ eventTime, raison: "fenetre-incomplete" });
  });

  it("exclut quand la fenêtre déborde du bord droit", () => {
    const eventTime = base + 95 * H + H / 2; // H0 = bougie 95, 95 + 10 ≥ 100
    const res = alignerFenetre(candles, eventTime, 10);
    expect(res).toEqual<OccurrenceExclue>({ eventTime, raison: "fenetre-incomplete" });
  });

  it("exclut quand aucune bougie ne couvre l'évènement (avant la première)", () => {
    const eventTime = base - H; // aucune bougie ≤ eventTime
    const res = alignerFenetre(candles, eventTime, 2);
    expect(res).toEqual<OccurrenceExclue>({ eventTime, raison: "fenetre-incomplete" });
  });

  it("trou entre bougies : H0 = dernière bougie ≤ eventTime, alignement par index", () => {
    // Trou : les bougies 3h et 4h manquent (saut de 2h à 5h).
    const trou: Candle[] = [
      c(base + 0 * H, 10),
      c(base + 1 * H, 20),
      c(base + 2 * H, 30),
      c(base + 5 * H, 40),
      c(base + 6 * H, 50),
      c(base + 7 * H, 60),
      c(base + 8 * H, 70),
    ];
    const eventTime = base + 3 * H + H / 2; // 3h30 → dans le trou
    const res = alignerFenetre(trou, eventTime, 2) as FenetreAlignee;

    expect("points" in res).toBe(true);
    // H0 = index 2 (bougie 2h, close 30), dernière ≤ eventTime malgré le trou.
    expect(res.points).toHaveLength(5);
    expect(res.points.find((p) => p.offset === 0)?.ratio).toBe(1);
    // Offset +1 = index 3 (bougie 5h, close 40) : l'alignement suit les index, pas le temps.
    expect(res.points.find((p) => p.offset === 1)?.ratio).toBeCloseTo(40 / 30, 12);
    expect(res.points.find((p) => p.offset === -1)?.ratio).toBeCloseTo(20 / 30, 12);
  });
});

describe("agregerFenetres", () => {
  it("médiane/p25/p75 point à point (percentile interpolé linéairement)", () => {
    const fenetres = [
      fen(1, { [-1]: 0.9, 0: 1.0, 1: 1.1 }),
      fen(2, { [-1]: 0.95, 0: 1.0, 1: 1.2 }),
      fen(3, { [-1]: 1.0, 0: 1.0, 1: 1.05 }),
    ];
    const out = agregerFenetres(fenetres);

    expect(out.offsets).toEqual([-1, 0, 1]);
    // offset −1 : trié [0.90, 0.95, 1.00] → méd 0.95, p25 0.925, p75 0.975.
    // offset  0 : [1,1,1] → 1 partout.
    // offset +1 : trié [1.05, 1.10, 1.20] → méd 1.10, p25 1.075, p75 1.15.
    const attMed = [0.95, 1.0, 1.1];
    const attP25 = [0.925, 1.0, 1.075];
    const attP75 = [0.975, 1.0, 1.15];
    out.mediane.forEach((v, k) => expect(v).toBeCloseTo(attMed[k]!, 12));
    out.p25.forEach((v, k) => expect(v).toBeCloseTo(attP25[k]!, 12));
    out.p75.forEach((v, k) => expect(v).toBeCloseTo(attP75[k]!, 12));
  });

  it("renvoie des tableaux vides pour une liste vide", () => {
    expect(agregerFenetres([])).toEqual({ offsets: [], mediane: [], p25: [], p75: [] });
  });
});

describe("statsEvts", () => {
  it("valeurs vérifiées à la main sur deux fenêtres synthétiques", () => {
    const a = fen(1, { [-2]: 0.8, [-1]: 0.9, 0: 1.0, 1: 1.1, 2: 1.21 });
    const b = fen(2, { [-2]: 1.2, [-1]: 1.1, 0: 1.0, 1: 0.9, 2: 0.81 });
    const s = statsEvts([a, b]);

    // Pré : médiane des ratios au bord gauche (offset −2) = méd([0.80, 1.20]) = 1.00 → 0 %.
    expect(s.perfMedianePre).toBeCloseTo(0, 10);
    // Post : médiane des ratios au bord droit (offset +2) = méd([1.21, 0.81]) = 1.01 → +1 %.
    expect(s.perfMedianePost).toBeCloseTo(1, 10);
    // Vol post : retours barre post [+0.10, +0.10, −0.10, −0.10] → écart-type pop. 0.10 → 10 %.
    expect(s.volPost).toBeCloseTo(10, 8);
    // Enveloppe sur tous les points : min ratio 0.80 → −20 %, max ratio 1.21 → +21 %.
    expect(s.min).toBeCloseTo(-20, 10);
    expect(s.max).toBeCloseTo(21, 10);
  });

  it("cohérence honnêteté : perf pré/post = extrémités de la médiane agrégée", () => {
    const a = fen(1, { [-2]: 0.8, [-1]: 0.9, 0: 1.0, 1: 1.1, 2: 1.21 });
    const b = fen(2, { [-2]: 1.2, [-1]: 1.1, 0: 1.0, 1: 0.9, 2: 0.81 });
    const agg = agregerFenetres([a, b]);
    const s = statsEvts([a, b]);
    expect(s.perfMedianePre).toBeCloseTo((agg.mediane[0]! - 1) * 100, 10);
    expect(s.perfMedianePost).toBeCloseTo((agg.mediane.at(-1)! - 1) * 100, 10);
  });

  it("fenêtre sans moitié post (demi-fenêtre 0) → volPost = 0, pas de NaN", () => {
    const s = statsEvts([fen(1, { 0: 1.0 })]);
    expect(s).toEqual({ perfMedianePre: 0, perfMedianePost: 0, volPost: 0, min: 0, max: 0 });
  });

  it("liste vide → tout à zéro", () => {
    expect(statsEvts([])).toEqual({
      perfMedianePre: 0,
      perfMedianePost: 0,
      volPost: 0,
      min: 0,
      max: 0,
    });
  });
});
