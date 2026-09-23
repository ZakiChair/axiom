import { describe, expect, it } from "vitest";
import type { OrderBook } from "./depth";
import { cotationCarnetBinance, quantileLineaire, StabiliteCarnet } from "./depthStability";

function livre(id: number, askQty = 100): OrderBook {
  return { lastUpdateId: id, bids: new Map([[99, 100]]), asks: new Map([[101, askQty]]) };
}

describe("stabilité du coût L2", () => {
  it("détermine la cotation Binance sans convertir ni deviner une identité inconnue", () => {
    expect(cotationCarnetBinance("BTCUSDC")).toBe("USDC");
    expect(cotationCarnetBinance("ETHBTC")).toBe("BTC");
    expect(cotationCarnetBinance("BTCXYZ")).toBeNull();
    expect(cotationCarnetBinance("BTC-USD")).toBeNull();
  });

  it("ne compte pas le replay initial comme un créneau écoulé", () => {
    const s = new StabiliteCarnet(1_000, 0);
    s.echantillonner(0, livre(1), 0);
    expect(s.vue(0).fenetres[1].attendus).toBe(0);
    expect(s.vue(0).fenetres[1].achat.creneauxCouverts).toBe(0);
    expect(s.vue(0).fenetres[1].achat.courantBps).toBe(100);
    s.echantillonner(1_000, livre(1), 0);
    const premiere = s.vue(1_000).fenetres[1];
    expect(premiere.attendus).toBe(1);
    expect(premiere.achat.creneauxCouverts).toBe(1);
    expect(premiere.achat.couverture).toBe(1);
  });

  it("borne les fenêtres par IDs de créneau malgré le jitter du premier tick", () => {
    const s = new StabiliteCarnet(1_000, 0);
    s.echantillonner(1_500, livre(1), 1_500);
    expect(s.vue(1_500).fenetres[1].attendus).toBe(1);
    for (let i = 2; i <= 901; i++) {
      s.echantillonner(i * 1_000, livre(i), i * 1_000);
      if (i === 61) {
        const minute = s.vue(i * 1_000).fenetres[1];
        expect(minute.attendus).toBe(60);
        expect(minute.achat.creneauxCouverts).toBe(60);
        expect(minute.achat.couverture).toBe(1);
      }
    }
    const fin = s.vue(901_000);
    expect(fin.fenetres[1].achat.creneauxCouverts).toBe(60);
    expect(fin.fenetres[5].achat.creneauxCouverts).toBe(300);
    expect(fin.fenetres[15].achat.creneauxCouverts).toBe(900);
    expect(fin.fenetres[15].attendus).toBe(900);
    expect(fin.fenetres[15].achat.couverture).toBe(1);
  });
  it("interpole les quantiles sans imposer le seuil UI de 20 observations", () => {
    expect(quantileLineaire([1, 2, 3, 4, 100], 0.5)).toBe(3);
    expect(quantileLineaire([1, 2, 3, 4, 100], 0.95)).toBeCloseTo(80.8, 8);
  });

  it("ne produit les quantiles qu'après 20 créneaux valides et complets", () => {
    const s = new StabiliteCarnet(1_000, 0);
    for (let i = 1; i <= 19; i++) s.echantillonner(i * 1_000, livre(i), i * 1_000);
    expect(s.vue(19_000).fenetres[1].achat.medianeBps).toBeNull();
    s.echantillonner(20_000, livre(20), 20_000);
    expect(s.vue(20_000).fenetres[1].achat.medianeBps).toBe(100);
    expect(s.vue(20_000).fenetres[1].achat.observations).toBe(20);
  });

  it("pondère les quantiles par créneau temporel même avec cinq versions pour vingt créneaux", () => {
    const s = new StabiliteCarnet(1_000, 0);
    for (let i = 1; i <= 20; i++) {
      const version = Math.ceil(i / 4);
      const ask = version === 5 ? 105 : 101;
      const recuA = (version - 1) * 4_000 + 1_000;
      s.echantillonner(i * 1_000, {
        lastUpdateId: version,
        bids: new Map([[version === 5 ? 95 : 99, 100]]),
        asks: new Map([[ask, 100]]),
      }, recuA);
    }
    const achat = s.vue(20_000).fenetres[1].achat;
    expect(achat.creneauxCouverts).toBe(20);
    expect(achat.versionsDistinctes).toBe(5);
    expect(achat.medianeBps).toBe(100);
    expect(achat.p95Bps).toBe(500);
  });

  it("compte le carnet insuffisant et les créneaux sautés dans la couverture", () => {
    const s = new StabiliteCarnet(1_000, 0);
    s.echantillonner(1_000, livre(1), 1_000);
    s.echantillonner(2_000, livre(2, 1), 2_000);
    s.echantillonner(5_000, livre(3), 5_000);
    const v = s.vue(5_000).fenetres[1];
    expect(v.attendus).toBe(5);
    expect(v.achat.observations).toBe(2);
    expect(v.achat.insuffisants).toBe(1);
    expect(v.achat.couverture).toBeCloseTo(0.4);
    expect(v.achat.proportionInsuffisante).toBeCloseTo(0.2);
  });

  it("refuse le carnet croisé et distingue créneaux et versions", () => {
    const s = new StabiliteCarnet(1_000, 0);
    s.echantillonner(1_000, livre(1), 1_000);
    s.echantillonner(2_000, livre(1), 2_000);
    s.echantillonner(3_000, { lastUpdateId: 2, bids: new Map([[102, 100]]), asks: new Map([[101, 100]]) }, 3_000);
    const v = s.vue(3_000).fenetres[1];
    expect(v.achat.observations).toBe(2);
    expect(v.achat.versionsDistinctes).toBe(1);
    expect(v.achat.creneauxCouverts).toBe(2);
    expect(v.achat.couverture).toBeCloseTo(2 / 3);
    expect(v.achat.couvertureFenetre).toBeCloseTo(2 / 60);
    expect(v.invalides).toBe(1);
    expect(v.attendus).toBe(3);
  });

  it("ne réutilise pas un carnet périmé et borne l'historique à quinze minutes", () => {
    const s = new StabiliteCarnet(1_000, 0);
    s.echantillonner(1_000, livre(1), 1_000);
    s.echantillonner(7_000, livre(2), 1_000);
    expect(s.vue(7_000).fenetres[1].achat.observations).toBe(1);
    expect(s.vue(7_000).ageMs).toBe(6_000);
    expect(s.vue(7_000).fenetres[1].achat.courantBps).toBeNull();
    s.echantillonner(901_000, livre(3), 901_000);
    const v = s.vue(901_000).fenetres[15];
    expect(v.attendus).toBe(900);
    expect(v.achat.observations).toBe(1);
  });
});
