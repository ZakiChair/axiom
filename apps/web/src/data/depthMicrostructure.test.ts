import { describe, expect, it } from "vitest";
import type { OrderBook } from "./depth";
import {
  contributionOfi,
  diagnostiquerPrixOiCvd,
  DepthMicrostructure,
  extrairePrixEtCvdReel,
  PersistanceDiagnostic,
  type ConfigurationDiagnostic,
} from "./depthMicrostructure";

const CONFIG_DIAGNOSTIC: ConfigurationDiagnostic = {
  fenetreMs: 60_000,
  minimumObservations: 3,
  couvertureMin: 0.8,
  seuilPrixPct: 1,
  seuilOiPct: 2,
  seuilCvdBase: 5,
  persistanceMs: 10_000,
  trouResetMs: 15_000,
  cadencePrixCvdMs: 30_000,
  cadenceOiMs: 30_000,
  ageMaxMs: 15_000,
};

function book(): OrderBook {
  return { lastUpdateId: 1, bids: new Map([[99.99, 10], [99.8, 1]]), asks: new Map([[100.01, 10], [100.2, 1]]) };
}
function tick(model: DepthMicrostructure, b: OrderBook, t: number, bid = 10, ask = 10) {
  b.lastUpdateId++;
  b.bids.set(99.99, bid);
  b.asks.set(100.01, ask);
  model.observe(b, t);
}
function warm(model: DepthMicrostructure, b: OrderBook, until = 10_000) {
  for (let t = 0; t <= until; t += 250) tick(model, b, t);
}

describe("OFI dynamique L1", () => {
  it("compte les variations de taille et les déplacements des meilleurs prix", () => {
    const p = { bid: 99, bidQty: 10, ask: 101, askQty: 20 };
    expect(contributionOfi(p, { ...p, bidQty: 13, askQty: 15 })).toBe(8);
    expect(contributionOfi(p, { bid: 100, bidQty: 4, ask: 102, askQty: 8 })).toBe(24);
    expect(contributionOfi(p, { bid: 98, bidQty: 4, ask: 100, askQty: 8 })).toBe(-18);
  });
  it("copie L1 avant mutation du carnet, normalise et borne à 30 s", () => {
    const m = new DepthMicrostructure(); const b = book();
    warm(m, b, 5_000);
    tick(m, b, 5_250, 15, 5);
    const v = m.view(5_250);
    expect(v.ofi).toBe(10);
    expect(v.ofiNormalized).toBeCloseTo(1);
    expect(v.micropriceBps).toBeCloseTo(0.5);
    expect(v.samples).toBe(21);
    for (let t = 5_500; t <= 36_000; t += 250) tick(m, b, t, 15, 5);
    expect(m.view(36_000).ofi).toBe(0);
    expect(m.view(36_000).durationMs).toBeLessThanOrEqual(30_000);
  });
  it("reste indisponible en chauffe, flux muet, carnet croisé ou vide", () => {
    const m = new DepthMicrostructure(); const b = book();
    tick(m, b, 0);
    expect(m.view(0).ofi).toBeNull();
    warm(m, b);
    expect(m.view(10_000).ofi).toBe(0);
    expect(m.view(15_001).ofi).toBeNull();
    expect(m.view(15_001).micropriceBps).toBeNull();
    b.bids.set(101, 5); tick(m, b, 15_250);
    expect(m.view(15_250).status).toContain("invalide");
    b.bids.clear(); m.observe(b, 15_500);
    expect(m.view(15_500).micropriceBps).toBeNull();
  });
  it("réinitialise après resnapshot, régression d'id, trou temporel et reset explicite", () => {
    const m = new DepthMicrostructure(); let b = book(); warm(m, b);
    b = book(); tick(m, b, 10_250, 1000, 1);
    expect(m.view(10_250).samples).toBe(0);
    for (let t = 10_500; t <= 16_000; t += 250) tick(m, b, t);
    expect(m.view(16_000).ofi).not.toBeNull();
    b.lastUpdateId = 0; m.observe(b, 16_250);
    expect(m.view(16_250).samples).toBe(0);
    tick(m, b, 30_000);
    expect(m.view(30_000).samples).toBe(0);
    m.reset(); expect(m.view(30_000).micropriceBps).toBeNull();
  });
});

describe("retrait / reconstitution L2, heuristique de session", () => {
  it("chauffe aussi avec des timestamps irréguliers sans exiger un point exactement à −10 s", () => {
    const m = new DepthMicrostructure(); const b = book();
    for (let i = 0; i <= 31; i++) tick(m, b, i * 333);
    tick(m, b, 10_656, 4);
    expect(m.view(10_656).bid.pendingMs).toBe(0);
  });
  it("mesure le temps de retour à 80 % après retrait de 50 %, confirmé pendant 500 ms", () => {
    const m = new DepthMicrostructure(); const b = book(); warm(m, b);
    tick(m, b, 10_250, 4);
    expect(m.view(10_250).bid.pendingMs).toBe(0);
    tick(m, b, 10_500, 8); tick(m, b, 10_750, 8);
    expect(m.view(10_750).bid.completed).toBe(0);
    tick(m, b, 11_000, 8);
    expect(m.view(11_000).bid).toMatchObject({ medianMs: 250, completed: 1, censored: 0, pendingMs: null });
    expect(m.view(11_000).ask.completed).toBe(0);
  });
  it("rejette un rebond fugace et censure à 30 s sans inventer de temps de retour", () => {
    const m = new DepthMicrostructure(); const b = book(); warm(m, b);
    tick(m, b, 10_250, 4); tick(m, b, 10_500, 8); tick(m, b, 10_750, 4);
    for (let t = 11_000; t <= 40_250; t += 250) tick(m, b, t, 4);
    expect(m.view(40_250).bid).toMatchObject({ medianMs: null, completed: 0, censored: 1, pendingMs: null });
  });
  it("ne compare pas des bandes déplacées par le prix et remet à zéro sur rupture", () => {
    const m = new DepthMicrostructure(); const b = book(); warm(m, b);
    tick(m, b, 10_250, 4);
    b.lastUpdateId++; b.bids = new Map([[101.99, 10], [101.8, 1]]); b.asks = new Map([[102.01, 10], [102.2, 1]]);
    m.observe(b, 10_500);
    expect(m.view(10_500).bid).toMatchObject({ completed: 0, censored: 1, pendingMs: null });
    m.reset();
    expect(m.view(10_500).bid).toMatchObject({ completed: 0, censored: 0, baselineSamples: 0 });
  });
  it("refuse la reconstitution si la profondeur reçue ne couvre pas ±10 bps", () => {
    const m = new DepthMicrostructure(); const b = book();
    b.bids.delete(99.8); b.asks.delete(100.2);
    warm(m, b); tick(m, b, 10_250, 4);
    expect(m.view(10_250).resilienceStatus).toContain("couverture");
    expect(m.view(10_250).bid.pendingMs).toBeNull();
  });
});

describe("diagnostic prix / OI quantité / CVD réel", () => {
  it("construit le CVD seulement quand chaque bougie porte le split acheteur/vendeur réel", () => {
    const completes = extrairePrixEtCvdReel([
      { time: 0, close: 100, buyVolume: 6, sellVolume: 4 },
      { time: 30_000, close: 101, buyVolume: 3, sellVolume: 5 },
      { time: 60_000, close: 102, buyVolume: 9, sellVolume: 4 },
    ], 60_000, 60_000);
    expect(completes.prix).toEqual([{ t: 0, v: 100 }, { t: 30_000, v: 101 }, { t: 60_000, v: 102 }]);
    expect(completes.cvdReel).toEqual([{ t: 0, v: 2 }, { t: 30_000, v: 0 }, { t: 60_000, v: 5 }]);
    expect(extrairePrixEtCvdReel([
      { time: 0, close: 100, buyVolume: 6, sellVolume: 4 },
      { time: 60_000, close: 102 },
    ], 60_000, 60_000).cvdReel).toBeNull();
  });
  it("distingue prix↑ / OI↑ / CVD↓ avec couverture temporelle explicite", () => {
    const res = diagnostiquerPrixOiCvd({
      prix: [{ t: 0, v: 100 }, { t: 30_000, v: 101 }, { t: 60_000, v: 102 }],
      oiQuantite: [{ t: 0, v: 10 }, { t: 30_000, v: 10.2 }, { t: 60_000, v: 10.5 }],
      cvdReel: [{ t: 0, v: 0 }, { t: 30_000, v: -3 }, { t: 60_000, v: -7 }],
    }, CONFIG_DIAGNOSTIC, 60_000);
    expect(res.code).toBe("prix+|oi+|cvd-");
    expect(res.libelle).toBe("Prix ↑ · OI ↑ · CVD ↓");
    expect(res.prix.variation).toBeCloseTo(2);
    expect(res.oi.variation).toBeCloseTo(5);
    expect(res.cvd.variation).toBe(-7);
    expect(res.qualite).toBe("complet");
    expect(res.oi.unite).toBe("%");
  });

  it("garde un flux neutre neutre et ne transforme jamais une absence de CVD en zéro", () => {
    const base = [{ t: 0, v: 100 }, { t: 30_000, v: 100.2 }, { t: 60_000, v: 100.3 }];
    const res = diagnostiquerPrixOiCvd({
      prix: base,
      oiQuantite: [{ t: 0, v: 10 }, { t: 30_000, v: 10.1 }, { t: 60_000, v: 10.1 }],
      cvdReel: null,
    }, CONFIG_DIAGNOSTIC, 60_000);
    expect(res.code).toBeNull();
    expect(res.prix.signe).toBe("neutre");
    expect(res.oi.signe).toBe("neutre");
    expect(res.cvd.variation).toBeNull();
    expect(res.cvd.disponible).toBe(false);
    expect(res.qualite).toBe("incomplet");
  });

  it("refuse l'OI notionnel mécanique et une couverture trop courte", () => {
    const res = diagnostiquerPrixOiCvd({
      prix: [{ t: 50_000, v: 100 }, { t: 55_000, v: 105 }, { t: 60_000, v: 110 }],
      oiQuantite: [{ t: 50_000, v: 10 }, { t: 55_000, v: 10 }, { t: 60_000, v: 10 }],
      cvdReel: [{ t: 50_000, v: 0 }, { t: 55_000, v: 10 }, { t: 60_000, v: 20 }],
    }, CONFIG_DIAGNOSTIC, 60_000);
    expect(res.oi.variation).toBeNull();
    expect(res.oi.couverture).toBeCloseTo(1 / 6);
    expect(res.code).toBeNull();
  });

  it("refuse une série trouée ou périmée malgré une bonne étendue premier→dernier", () => {
    const trouee = [{ t: 0, v: 100 }, { t: 10_000, v: 101 }, { t: 60_000, v: 102 }];
    const dense = [{ t: 0, v: 10 }, { t: 10_000, v: 11 }, { t: 20_000, v: 12 }, { t: 30_000, v: 13 }, { t: 40_000, v: 14 }, { t: 50_000, v: 15 }, { t: 60_000, v: 16 }];
    const config = { ...CONFIG_DIAGNOSTIC, cadencePrixCvdMs: 10_000, cadenceOiMs: 10_000 };
    const a = diagnostiquerPrixOiCvd({ prix: trouee, oiQuantite: dense, cvdReel: dense }, config, 60_000);
    expect(a.prix.disponible).toBe(false);
    expect(a.prix.couverture).toBeCloseTo(3 / 7);
    const b = diagnostiquerPrixOiCvd({ prix: dense, oiQuantite: dense, cvdReel: dense }, config, 80_000);
    expect(b.prix.disponible).toBe(false);
    expect(b.code).toBeNull();
  });

  it("compare les trois métriques sur leurs bornes temporelles communes", () => {
    const res = diagnostiquerPrixOiCvd({
      prix: [{ t: 0, v: 90 }, { t: 30_000, v: 100 }, { t: 60_000, v: 102 }, { t: 90_000, v: 103 }],
      oiQuantite: [{ t: 30_000, v: 10 }, { t: 60_000, v: 10.5 }, { t: 90_000, v: 11 }],
      cvdReel: [{ t: 0, v: -100 }, { t: 30_000, v: 0 }, { t: 60_000, v: -3 }, { t: 90_000, v: -7 }],
    }, CONFIG_DIAGNOSTIC, 90_000);
    expect(res.bornesCommunes).toEqual({ debut: 30_000, fin: 90_000 });
    expect(res.prix.variation).toBeCloseTo(3);
    expect(res.cvd.variation).toBe(-7);
  });
});

describe("persistance du diagnostic en temps continu", () => {
  it("confirme après la durée, se réarme au changement et reset sur trou/déconnexion", () => {
    const p = new PersistanceDiagnostic(10_000, 15_000);
    expect(p.observe("prix+|oi+|cvd-", 1_000)).toMatchObject({ confirme: false, persistanceMs: 0 });
    expect(p.observe("prix+|oi+|cvd-", 11_000)).toMatchObject({ confirme: true, persistanceMs: 10_000 });
    expect(p.observe("prix-|oi+|cvd+", 12_000)).toMatchObject({ confirme: false, persistanceMs: 0 });
    expect(p.observe("prix-|oi+|cvd+", 30_000)).toMatchObject({ code: "prix-|oi+|cvd+", confirme: false, persistanceMs: 0 });
    p.deconnecter();
    expect(p.view(31_000)).toMatchObject({ code: null, confirme: false, persistanceMs: 0 });
  });
});
