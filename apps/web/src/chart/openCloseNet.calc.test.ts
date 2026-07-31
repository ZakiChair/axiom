/**
 * Couverture du calcul pur OCN (Open/Close Net) — cf. spec
 * docs/superpowers/specs/2026-07-31-open-close-net-design.md.
 *
 * Invariants testés : répartition prorata du ΔOI, classement du sens par le
 * delta agressif du niveau, consommation proportionnelle avec clamp à 0,
 * conservation (Σ restant = Σ attribué − Σ consommé), POC, ΔOI = 0/absent.
 */
import { describe, expect, it } from "vitest";
import type { FootprintBar, FootprintRow } from "@axiom/types";
import { computeOpenCloseNet, deltasOiParBougie } from "./openCloseNet.calc";

const BUCKET = 100;

function row(price: number, buyVol: number, sellVol: number): FootprintRow {
  return { price, buyVol, sellVol };
}

function bar(time: number, rows: FootprintRow[]): FootprintBar {
  let delta = 0;
  for (const r of rows) delta += r.buyVol - r.sellVol;
  return { time, rows, poc: rows[0]?.price ?? 0, vah: 0, val: 0, delta };
}

describe("deltasOiParBougie — alignement OI → ΔOI par bougie", () => {
  it("attribue le ΔOI à la bougie PENDANT laquelle il s'est produit", () => {
    // Snapshot à T = OI à la clôture de la bougie qui se termine en T.
    // oi(60)=1300 vs baseline oi(0)=1000 → +300 pendant la bougie [0,60).
    const times = [0, 60, 120];
    const oi = [
      { time: 0, oi: 1000 },
      { time: 60, oi: 1300 },
      { time: 120, oi: 1100 },
    ];
    const deltas = deltasOiParBougie(times, oi);
    expect(deltas.get(0)).toBe(300);
    expect(deltas.get(60)).toBe(-200);
    // Dernière bougie : aucun snapshot postérieur → OI inchangé.
    expect(deltas.get(120)).toBe(0);
  });

  it("snapshot manquant pour une bougie → ΔOI = 0 (OI inchangé), pas un trou", () => {
    const times = [0, 60, 120];
    const oi = [
      { time: 0, oi: 1000 },
      { time: 120, oi: 1500 },
    ];
    const deltas = deltasOiParBougie(times, oi);
    expect(deltas.get(0)).toBe(0);
    expect(deltas.get(60)).toBe(500);
    expect(deltas.get(120)).toBe(0);
  });

  it("pas de baseline avant la première bougie → première bougie absente", () => {
    const times = [0, 60];
    const oi = [
      { time: 60, oi: 1000 },
      { time: 120, oi: 1100 },
    ];
    const deltas = deltasOiParBougie(times, oi);
    expect(deltas.has(0)).toBe(false);
    expect(deltas.get(60)).toBe(100);
  });

  it("séries vides → map vide", () => {
    expect(deltasOiParBougie([], []).size).toBe(0);
    expect(deltasOiParBougie([0, 60], []).size).toBe(0);
  });
});

describe("computeOpenCloseNet — ouvertures (ΔOI > 0)", () => {
  it("répartit |ΔOI| au prorata du volume et classe le sens par niveau", () => {
    // Niveau 100 : sell net (30 vs 10) → shorts ; niveau 200 : buy net → longs.
    // Volumes totaux : 40 et 60 → répartition 40 % / 60 % de ΔOI = 500.
    const bars = [bar(60, [row(100, 10, 30), row(200, 50, 10)])];
    const res = computeOpenCloseNet(bars, new Map([[60, 500]]), BUCKET);
    expect(res.entries).toHaveLength(2);
    const short = res.entries.find((e) => e.side === "short");
    const long = res.entries.find((e) => e.side === "long");
    expect(short).toMatchObject({ time: 60, price: 100, opened: 200, remaining: 200 });
    expect(long).toMatchObject({ time: 60, price: 200, opened: 300, remaining: 300 });
  });

  it("niveau parfaitement équilibré (buy = sell) → moitié long, moitié short", () => {
    const bars = [bar(60, [row(100, 20, 20)])];
    const res = computeOpenCloseNet(bars, new Map([[60, 100]]), BUCKET);
    const long = res.entries.find((e) => e.side === "long");
    const short = res.entries.find((e) => e.side === "short");
    expect(long?.opened).toBe(50);
    expect(short?.opened).toBe(50);
  });

  it("ΔOI = 0 ou absent → aucune entrée", () => {
    const bars = [bar(60, [row(100, 10, 30)]), bar(120, [row(100, 5, 5)])];
    const res = computeOpenCloseNet(bars, new Map([[60, 0]]), BUCKET);
    expect(res.entries).toHaveLength(0);
  });
});

describe("computeOpenCloseNet — fermetures (ΔOI < 0)", () => {
  it("delta agressif acheteur → consomme les shorts, proportionnellement", () => {
    // Bougie 1 : 400 de shorts ouverts sur deux niveaux (100 → 100, 200 → 300).
    // Bougie 2 : ΔOI = −200, delta acheteur → les shorts sont rachetés à 50 %.
    const bars = [
      bar(60, [row(100, 0, 10), row(200, 0, 30)]),
      bar(120, [row(300, 20, 0)]),
    ];
    const deltas = new Map([
      [60, 400],
      [120, -200],
    ]);
    const res = computeOpenCloseNet(bars, deltas, BUCKET);
    const shorts = res.entries.filter((e) => e.side === "short");
    expect(shorts.map((e) => e.remaining)).toEqual([50, 150]);
    // Conservation : Σ restant = Σ ouvert − consommé.
    const totalRemaining = res.entries.reduce((s, e) => s + e.remaining, 0);
    const totalOpened = res.entries.reduce((s, e) => s + e.opened, 0);
    // ΔOI de la bougie 2 est positif côté longs ? Non : ΔOI < 0 → aucune ouverture.
    expect(totalOpened).toBe(400);
    expect(totalRemaining).toBe(200);
  });

  it("delta agressif vendeur → consomme les longs", () => {
    const bars = [
      bar(60, [row(100, 10, 0)]),
      bar(120, [row(200, 0, 20)]),
    ];
    const deltas = new Map([
      [60, 100],
      [120, -40],
    ]);
    const res = computeOpenCloseNet(bars, deltas, BUCKET);
    const long = res.entries.find((e) => e.side === "long");
    expect(long?.remaining).toBe(60);
  });

  it("sur-consommation clampée à 0 (jamais négatif)", () => {
    const bars = [
      bar(60, [row(100, 0, 10)]),
      bar(120, [row(200, 20, 0)]),
    ];
    const deltas = new Map([
      [60, 100],
      [120, -9999],
    ]);
    const res = computeOpenCloseNet(bars, deltas, BUCKET);
    for (const e of res.entries) expect(e.remaining).toBeGreaterThanOrEqual(0);
    const short = res.entries.find((e) => e.side === "short");
    expect(short?.remaining).toBe(0);
  });

  it("delta agressif nul → consomme les deux côtés au prorata de leurs totaux", () => {
    // 300 de shorts, 100 de longs ouverts ; fermeture de 100 avec delta neutre
    // → 75 pris aux shorts, 25 aux longs (prorata des stocks).
    const bars = [
      bar(60, [row(100, 0, 30), row(200, 10, 0)]),
      bar(120, [row(300, 10, 10)]),
    ];
    const deltas = new Map([
      [60, 400],
      [120, -100],
    ]);
    const res = computeOpenCloseNet(bars, deltas, BUCKET);
    const short = res.entries.find((e) => e.side === "short");
    const long = res.entries.find((e) => e.side === "long");
    expect(short?.remaining).toBeCloseTo(225);
    expect(long?.remaining).toBeCloseTo(75);
  });
});

describe("computeOpenCloseNet — profil et POC", () => {
  it("agrège le net restant par niveau (profil latéral) et trouve le POC", () => {
    // Deux bougies ouvrent des shorts au même niveau 100 ; le niveau 200 a le
    // plus gros volume total → POC = 200.
    const bars = [
      bar(60, [row(100, 0, 10), row(200, 30, 20)]),
      bar(120, [row(100, 0, 10)]),
    ];
    const deltas = new Map([
      [60, 100],
      [120, 50],
    ]);
    const res = computeOpenCloseNet(bars, deltas, BUCKET);
    expect(res.poc).toBe(200);
    const lvl100 = res.profile.find((p) => p.price === 100);
    expect(lvl100).toBeDefined();
    expect(lvl100?.openShort).toBeGreaterThan(0);
    expect(lvl100?.openLong).toBe(0);
  });

  it("fenêtre vide → résultat vide, POC null", () => {
    const res = computeOpenCloseNet([], new Map(), BUCKET);
    expect(res.entries).toHaveLength(0);
    expect(res.profile).toHaveLength(0);
    expect(res.poc).toBeNull();
  });

  it("bougies sans volume → ignorées sans throw", () => {
    const bars = [bar(60, [])];
    const res = computeOpenCloseNet(bars, new Map([[60, 500]]), BUCKET);
    expect(res.entries).toHaveLength(0);
  });
});
