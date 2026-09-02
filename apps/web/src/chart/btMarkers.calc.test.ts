/**
 * Projection des trades d'un backtest sur le graphe (C1). Le garde-fou central est le
 * SCOPE : un run décrit un couple (symbole, pas de temps), et projeter ses trades
 * ailleurs afficherait des prix qui n'ont aucun sens sur la série affichée.
 */
import { describe, expect, it } from "vitest";
import type { TradeResultat } from "@axiom/backtest";
import {
  MAX_MARQUEURS_BT,
  etiquetteTradeBt,
  memeScope,
  projeterTradesBt,
  tradesTronques,
} from "./btMarkers.calc";

const trade = (over: Partial<TradeResultat> = {}): TradeResultat => ({
  sens: "long",
  tempsEntree: 1_000,
  prixEntree: 100,
  tempsSortie: 2_000,
  prixSortie: 110,
  raison: "regle",
  quantite: 1,
  pnl: 10,
  pnlPct: 10,
  frais: 0,
  dureeBarres: 1,
  dureeMs: 1_000,
  risqueInitial: null,
  r: null,
  ...over,
});

const SCOPE = { symbole: "BTCUSDT", timeframe: "1h" } as const;

describe("memeScope", () => {
  it("refuse un run absent (aucun backtest lancé)", () => {
    expect(memeScope(null, SCOPE)).toBe(false);
  });

  it("compare le symbole sans tenir compte de la casse", () => {
    expect(memeScope({ symbole: "btcusdt", timeframe: "1h" }, SCOPE)).toBe(true);
  });

  it("refuse un autre symbole", () => {
    expect(memeScope({ symbole: "ETHUSDT", timeframe: "1h" }, SCOPE)).toBe(false);
  });

  it("refuse un autre pas de temps — les prix seraient posés sur les mauvaises bougies", () => {
    expect(memeScope({ symbole: "BTCUSDT", timeframe: "4h" }, SCOPE)).toBe(false);
  });
});

describe("etiquetteTradeBt", () => {
  it("marque explicitement les gains", () => {
    expect(etiquetteTradeBt(1.234)).toBe("+1.23 %");
  });

  it("laisse le signe des pertes", () => {
    expect(etiquetteTradeBt(-2.5)).toBe("-2.50 %");
  });

  it("ne préfixe pas un résultat nul", () => {
    expect(etiquetteTradeBt(0)).toBe("0.00 %");
  });
});

describe("projeterTradesBt", () => {
  it("ne projette RIEN hors du scope du run", () => {
    expect(projeterTradesBt([trade()], { symbole: "ETHUSDT", timeframe: "1h" }, SCOPE)).toEqual([]);
    expect(projeterTradesBt([trade()], null, SCOPE)).toEqual([]);
  });

  it("projette un trade dans le scope", () => {
    const [m] = projeterTradesBt([trade()], SCOPE, SCOPE);
    expect(m?.cle).toBe("bt:0");
    expect(m?.prixEntree).toBe(100);
    expect(m?.prixSortie).toBe(110);
    expect(m?.gagnant).toBe(true);
    expect(m?.label).toBe("+10.00 %");
  });

  it("porte le SENS pour orienter le triangle d'entrée", () => {
    const [m] = projeterTradesBt([trade({ sens: "short" })], SCOPE, SCOPE);
    expect(m?.sens).toBe("short");
  });

  it("un trade à PnL nul compte comme non perdant (pas de rouge injustifié)", () => {
    const [m] = projeterTradesBt([trade({ pnl: 0, pnlPct: 0 })], SCOPE, SCOPE);
    expect(m?.gagnant).toBe(true);
  });

  it("ignore les prix non plaçables plutôt que de dessiner à zéro", () => {
    const mauvais = [
      trade({ prixEntree: 0 }),
      trade({ prixSortie: Number.NaN }),
      trade({ prixEntree: -5 }),
    ];
    expect(projeterTradesBt(mauvais, SCOPE, SCOPE)).toEqual([]);
  });

  it("ignore les horodatages non finis", () => {
    expect(projeterTradesBt([trade({ tempsSortie: Number.NaN })], SCOPE, SCOPE)).toEqual([]);
  });

  it("garde les trades les plus RÉCENTS quand le cap est dépassé", () => {
    const nombreux = Array.from({ length: MAX_MARQUEURS_BT + 20 }, (_, i) =>
      trade({ tempsEntree: i * 1_000, tempsSortie: i * 1_000 + 500 })
    );
    const projetes = projeterTradesBt(nombreux, SCOPE, SCOPE);
    expect(projetes).toHaveLength(MAX_MARQUEURS_BT);
    // Le plus récent en tête, et le plus ancien conservé est bien postérieur aux exclus.
    expect(projetes[0]?.tempsEntree).toBe((MAX_MARQUEURS_BT + 19) * 1_000);
    expect(projetes.at(-1)?.tempsEntree).toBe(20 * 1_000);
  });

  it("respecte un cap explicite", () => {
    const trois = [trade(), trade({ tempsEntree: 2_000 }), trade({ tempsEntree: 3_000 })];
    expect(projeterTradesBt(trois, SCOPE, SCOPE, 2)).toHaveLength(2);
  });
});

describe("tradesTronques", () => {
  it("vaut 0 tant que le cap n'est pas atteint", () => {
    expect(tradesTronques(10)).toBe(0);
    expect(tradesTronques(MAX_MARQUEURS_BT)).toBe(0);
  });

  it("compte les trades écartés — la troncature doit être ANNONCÉE, pas muette", () => {
    expect(tradesTronques(MAX_MARQUEURS_BT + 43)).toBe(43);
  });
});
