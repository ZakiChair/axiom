/**
 * Tests des calculs purs de coût d'exécution / profondeur / déséquilibre L2.
 * Carnets synthétiques à 5 niveaux : valeurs attendues calculées à la main.
 */
import { describe, expect, it } from "vitest";
import type { OrderBook } from "./depth";
import { coutExecution, desequilibre, profondeurAPct } from "./depthExecution";

function livre(bids: Array<[number, number]>, asks: Array<[number, number]>): OrderBook {
  return { lastUpdateId: 1, bids: new Map(bids), asks: new Map(asks) };
}

/** Carnet mid = 100 : best bid 99, best ask 101. */
const CARNET = livre(
  [
    [99, 1],
    [98, 2],
    [97, 3],
    [96, 4],
    [95, 5],
  ],
  [
    [101, 1],
    [102, 2],
    [103, 3],
    [104, 4],
    [105, 5],
  ],
);

describe("coutExecution", () => {
  it("calcule le prix moyen d'un achat traversant 2,5 niveaux", () => {
    // 250 USD : 1 × 101 = 101, reste 149 → 149/102 ≈ 1.460784 qty au 102.
    // qty = 2.4607843137 ; prixMoyen = 250 / qty = 101.587301587.
    const r = coutExecution(CARNET, "achat", 250);
    expect(r).not.toBeNull();
    expect(r!.couvert).toBe(true);
    expect(r!.niveaux).toBe(2);
    expect(r!.quantiteBase).toBeCloseTo(1 + 149 / 102, 8);
    expect(r!.prixMoyen).toBeCloseTo(250 / (1 + 149 / 102), 8);
    expect(r!.notionnelCouvert).toBeCloseTo(250, 8);
    expect(r!.pirePrix).toBe(102);
    // Défavorable = prixMoyen − 100 ; bps = ×100.
    expect(r!.slippageBps).toBeCloseTo((r!.prixMoyen - 100) * 100, 6);
  });

  it("signe le slippage positif des deux côtés (défavorable)", () => {
    const achat = coutExecution(CARNET, "achat", 101)!;
    const vente = coutExecution(CARNET, "vente", 99)!;
    expect(achat.slippageBps).toBeGreaterThan(0);
    expect(vente.slippageBps).toBeGreaterThan(0);
    expect(achat.prixMoyen).toBe(101);
    expect(vente.prixMoyen).toBe(99);
  });

  it("couverture partielle : couvert=false et fraction exacte (asks totaux = 1555 USD)", () => {
    // 101+204+309+416+525 = 1555 ; qty = 15 ; prixMoyen = 1555/15.
    const r = coutExecution(CARNET, "achat", 2000);
    expect(r).not.toBeNull();
    expect(r!.couvert).toBe(false);
    expect(r!.notionnelCouvert).toBeCloseTo(1555, 8);
    expect(r!.quantiteBase).toBeCloseTo(15, 8);
    expect(r!.prixMoyen).toBeCloseTo(1555 / 15, 8);
    expect(r!.niveaux).toBe(5);
    expect(r!.pirePrix).toBe(105);
  });

  it("null si mid indéfini (un côté vide) ou notionnel non positif", () => {
    expect(coutExecution(livre([[99, 1]], []), "achat", 100)).toBeNull();
    expect(coutExecution(CARNET, "achat", 0)).toBeNull();
    expect(coutExecution(CARNET, "achat", -10)).toBeNull();
  });
});

describe("profondeurAPct", () => {
  it("bornes inclusives autour du mid", () => {
    // mid 100.1 ; ±0,5 % → [99.5995, 100.6005] — les 4 niveaux y tombent.
    const l = livre(
      [
        [100, 10],
        [99.8, 5],
      ],
      [
        [100.2, 8],
        [100.4, 3],
      ],
    );
    const r = profondeurAPct(l, 0.005);
    expect(r).not.toBeNull();
    expect(r!.bidUsd).toBeCloseTo(100 * 10 + 99.8 * 5, 8);
    expect(r!.askUsd).toBeCloseTo(100.2 * 8 + 100.4 * 3, 8);
  });

  it("exclut un niveau hors borne", () => {
    // mid 100 ; ±0,5 % → [99.5, 100.5] — bid 99 et ask 101 exclus.
    const r = profondeurAPct(CARNET, 0.005);
    expect(r).not.toBeNull();
    expect(r!.bidUsd).toBe(0);
    expect(r!.askUsd).toBe(0);
  });
});

describe("desequilibre", () => {
  it("I ∈ [−1, 1] ; 0 sur un carnet symétrique", () => {
    expect(desequilibre(CARNET, 2)).toBeCloseTo(0, 8);
    expect(desequilibre(CARNET, 5)).toBeCloseTo(0, 8);
  });

  it("+1 sans asks dans les n niveaux ; n > niveaux disponibles → tous pris", () => {
    const bidsOnly = livre(
      [
        [99, 4],
        [98, 1],
      ],
      [],
    );
    expect(desequilibre(bidsOnly, 10)).toBe(1);
    const asksOnly = livre([], [[101, 3]]);
    expect(desequilibre(asksOnly, 2)).toBe(-1);
  });

  it("ignore les quantités nulles et renvoie null si denom nulle", () => {
    const vide = livre([[99, 0]], [[101, 0]]);
    expect(desequilibre(vide, 5)).toBeNull();
    expect(desequilibre(CARNET, 0)).toBeNull();
  });
});
