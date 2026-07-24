/**
 * Tests de la logique PURE du moteur de stress-test (data/scen.ts) : rattachement des
 * facteurs, bêtas roulants (fixtures synthétiques aux valeurs calculées à la main) et
 * application d'un scénario de chocs. La collecte réseau (`collecterScen`) n'est pas testée
 * ici : elle se borne à orchestrer le fetch puis à appeler ces fonctions pures verrouillées.
 */
import { describe, expect, it } from "vitest";
import {
  appliquerScenario,
  betaRoulant,
  facteurDe,
  type PositionScen,
  type SerieCloture,
} from "./scen";

const JOUR = 86_400_000;
/** Horodatage (ms) du jour calendaire UTC n° `n`. */
const j = (n: number): number => n * JOUR;

/**
 * Reconstruit une série de clôtures (jours consécutifs) à partir de log-rendements donnés :
 * close_0 = base, close_t = close_{t-1}·exp(r_t). Ainsi `logRendements` de la série
 * recalcule EXACTEMENT les rendements fournis — β maîtrisé au chiffre près.
 */
function serieDepuisRendements(rendements: number[], base = 100): SerieCloture[] {
  const closes = [base];
  for (const r of rendements) closes.push(closes[closes.length - 1]! * Math.exp(r));
  return closes.map((close, i) => ({ time: j(i), close }));
}

describe("facteurDe (rattachement 1-facteur)", () => {
  it("crypto : base ETH → eth, tout le reste → btc", () => {
    expect(facteurDe("ETHUSDT", "binance")).toBe("eth");
    expect(facteurDe("SOLUSDT", "binance")).toBe("btc");
    expect(facteurDe("BTCUSDT", "binance")).toBe("btc");
  });
  it("twelvedata : UUP + forex → dxy, GLD/SLV → or, sinon spx", () => {
    expect(facteurDe("UUP", "twelvedata")).toBe("dxy");
    expect(facteurDe("EUR/USD", "twelvedata")).toBe("dxy");
    expect(facteurDe("GLD", "twelvedata")).toBe("or");
    expect(facteurDe("SLV", "twelvedata")).toBe("or");
    expect(facteurDe("NVDA", "twelvedata")).toBe("spx");
    expect(facteurDe("SPY", "twelvedata")).toBe("spx");
  });
});

describe("betaRoulant", () => {
  it("β ≈ 2 quand actif = 2·facteur (≥ 30 rendements communs)", () => {
    // 34 rendements variés (variance > 0) ; actif construit avec r_A = 2·r_F ⇒ β = 2.
    const rF = Array.from({ length: 34 }, (_, i) => ((i % 5) - 2) * 0.01);
    const facteur = serieDepuisRendements(rF);
    const actif = serieDepuisRendements(rF.map((r) => 2 * r));
    expect(betaRoulant(actif, facteur, 90)).toBeCloseTo(2, 10);
  });

  it("β ≈ 0 pour deux séries décorrélées (cov nulle par construction)", () => {
    const d = 0.01;
    // r_F = [d,−d,d,−d,…] ; r_A = [d,d,−d,−d,…] : sur chaque bloc de 4, Σ r_A·r_F = 0.
    const rF = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? d : -d));
    const rA = Array.from({ length: 40 }, (_, i) => (i % 4 < 2 ? d : -d));
    expect(betaRoulant(serieDepuisRendements(rA), serieDepuisRendements(rF), 90)).toBeCloseTo(0, 10);
  });

  it("null si moins de 30 rendements communs (20 clôtures → 19 rendements)", () => {
    const r = Array.from({ length: 19 }, (_, i) => ((i % 5) - 2) * 0.01); // 20 clôtures
    expect(betaRoulant(serieDepuisRendements(r), serieDepuisRendements(r), 90)).toBeNull();
  });

  it("null si le facteur est ~constant (variance nulle → évite 0/0 = NaN)", () => {
    const rActif = Array.from({ length: 34 }, (_, i) => ((i % 5) - 2) * 0.01);
    const rFacteurPlat = Array.from({ length: 34 }, () => 0.01); // rendements constants ⇒ var 0
    expect(betaRoulant(serieDepuisRendements(rActif), serieDepuisRendements(rFacteurPlat), 90)).toBeNull();
  });
});

describe("appliquerScenario", () => {
  const positions: PositionScen[] = [
    { symbole: "AAA", poidsUsd: 1000, facteur: "btc", beta: 1.5 },
    { symbole: "BBB", poidsUsd: -500, facteur: "eth", beta: null },
  ];

  it("P&L = poids·β·choc/100 ; β null → plUsd null, exclu du total", () => {
    const res = appliquerScenario(positions, { btc: -30, eth: 0, dxy: 0, spx: 0, or: 0 });
    // AAA : 1000 · 1,5 · (−30/100) = −450
    expect(res.lignes[0]!.plUsd).toBeCloseTo(-450, 10);
    // BBB : β null ⇒ plUsd null (non estimable)
    expect(res.lignes[1]!.plUsd).toBeNull();
    expect(res.totalUsd).toBeCloseTo(-450, 10); // BBB exclu du total
    expect(res.couvertUsd).toBeCloseTo(1000, 10); // Σ|poids| des seules positions à β calculable
    expect(res.sommeAbs).toBeCloseTo(1500, 10); // notionnel total (|1000| + |−500|)
  });

  it("chocs tous nuls → total nul", () => {
    const res = appliquerScenario(positions, { btc: 0, eth: 0, dxy: 0, spx: 0, or: 0 });
    expect(res.totalUsd).toBe(0);
  });

  it("un short profite d'un choc négatif (signe du poids respecté)", () => {
    const shorts: PositionScen[] = [{ symbole: "SSS", poidsUsd: -500, facteur: "btc", beta: 1 }];
    const res = appliquerScenario(shorts, { btc: -30, eth: 0, dxy: 0, spx: 0, or: 0 });
    // −500 · 1 · (−0,30) = +150 (le short gagne quand le facteur baisse)
    expect(res.lignes[0]!.plUsd).toBeCloseTo(150, 10);
    expect(res.totalUsd).toBeCloseTo(150, 10);
  });
});
