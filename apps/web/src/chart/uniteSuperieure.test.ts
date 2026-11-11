/**
 * Éligibilité au calcul sur une unité supérieure (SUG-1, phase 1).
 *
 * Le test de registre recalcule CHAQUE définition admise sur des séries synthétiques : une
 * définition qui lit des bougies futures (valeur à k changée quand on ajoute k+1…) ou qui
 * produit des annotations indexées ne doit pas être admise — sinon la projection à la
 * clôture anticiperait, ou ses annotations désigneraient de mauvaises bougies.
 */
import { describe, expect, it } from "vitest";
import type { Candle, Timeframe } from "@axiom/types";
import { computeIndicator, getIndicator, INDICATORS } from "@axiom/indicators";
import {
  DEFS_EXCLUES_UNITE,
  PLACES_UNITE,
  UNITES_SUPERIEURES,
  defAdmiseUnite,
  raisonUniteRefusee,
  unitesProposees,
} from "./uniteSuperieure";

const H = 3_600_000;
const J = 24 * H;
const LUNDI = Date.UTC(2025, 0, 6);

function serie(n: number, debut: number, pas: number, graine: number): Candle[] {
  let s = graine;
  const alea = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = o * (1 + (alea() - 0.5) * 0.06);
    out.push({
      time: debut + i * pas,
      open: o,
      high: Math.max(o, c) * (1 + alea() * 0.02),
      low: Math.min(o, c) * (1 - alea() * 0.02),
      close: c,
      volume: 1000 + alea() * 500,
      buyVolume: 500 + alea() * 200,
      sellVolume: 500 + alea() * 200,
      trades: 100,
    });
    p = c;
  }
  return out;
}

/** Séries de contrôle : 1d alignée, 4h commencée en milieu de journée (session partielle), 1w. */
const JEUX: Array<{ tf: Timeframe; bougies: Candle[] }> = [
  { tf: "1d", bougies: serie(420, LUNDI, J, 7) },
  { tf: "4h", bougies: serie(420, LUNDI + 8 * H, 4 * H, 13) },
  { tf: "1w", bougies: serie(320, LUNDI, 7 * J, 29) },
];

function egal(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Object.is(a, b) || Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));
}

describe("registre : définitions admises causales et sans annotation", () => {
  const admises = INDICATORS.filter(defAdmiseUnite);

  it("le filtre garde l'essentiel des indicateurs de prix (moyennes, oscillateurs, volatilité)", () => {
    for (const id of ["ema", "sma", "rsi", "macd", "bollinger", "atr", "supertrend", "stochastic", "adx", "obv"]) {
      expect(admises.some((d) => d.id === id), id).toBe(true);
    }
    expect(admises.length).toBeGreaterThan(100);
  });

  it("chaque exclusion nommée existe au registre (pas de faute de frappe)", () => {
    for (const id of DEFS_EXCLUES_UNITE) expect(getIndicator(id), id).toBeDefined();
  });

  it("chaque définition admise est causale par préfixe et ne produit aucune annotation", () => {
    const fautes: string[] = [];
    for (const def of admises) {
      for (const { tf, bougies } of JEUX) {
        const complet = computeIndicator(def, bougies, undefined, undefined, tf);
        if (complet.annotations !== undefined) {
          fautes.push(`${def.id} (${tf}) : annotations`);
          continue;
        }
        for (const n of [100, 150, 199, 260, 301, 333, 380, 419]) {
          const prefixe = computeIndicator(def, bougies.slice(0, n), undefined, undefined, tf);
          const ecart = def.outputs.find((o) => {
            const a = prefixe.series[o.key] ?? [];
            const b = complet.series[o.key] ?? [];
            for (let i = 0; i < n; i++) if (!egal(a[i], b[i])) return true;
            return false;
          });
          if (ecart !== undefined) {
            fautes.push(`${def.id} (${tf}, ${n} bougies) : sortie ${ecart.key} modifiée par les bougies suivantes`);
            break;
          }
        }
      }
    }
    // Une faute ici : ajouter la définition à DEFS_EXCLUES_UNITE (uniteSuperieure.ts).
    expect(fautes).toEqual([]);
  });

  it("les exclusions sont justifiées : chacune anticipe ou annote sur au moins un jeu", () => {
    for (const id of DEFS_EXCLUES_UNITE) {
      const def = getIndicator(id)!;
      const justifiee = JEUX.some(({ tf, bougies }) => {
        const complet = computeIndicator(def, bougies, undefined, undefined, tf);
        if (complet.annotations !== undefined) return true;
        return [150, 200, 260, 333, 400].some((n) => {
          const prefixe = computeIndicator(def, bougies.slice(0, n), undefined, undefined, tf);
          return def.outputs.some((o) => (prefixe.series[o.key] ?? []).some((v, i) => !egal(v, complet.series[o.key]?.[i])));
        });
      });
      expect(justifiee, id).toBe(true);
    }
  });
});

describe("raisonUniteRefusee", () => {
  const ema = getIndicator("ema")!;
  const ctx = (exchange: Parameters<typeof raisonUniteRefusee>[1]["exchange"], timeframe: Timeframe) => ({
    exchange,
    symbol: "BTCUSDT",
    timeframe,
  });

  it("couples alignés UTC seulement : 1h→4h/1d, 4h→1d/1w, 1d→1w", () => {
    expect(UNITES_SUPERIEURES).toEqual({ "1h": ["4h", "1d"], "4h": ["1d", "1w"], "1d": ["1w"] });
    expect(raisonUniteRefusee(ema, ctx("binance", "1h"), "4h")).toBeNull();
    expect(raisonUniteRefusee(ema, ctx("binance", "1h"), "1d")).toBeNull();
    expect(raisonUniteRefusee(ema, ctx("binance", "4h"), "1w")).toBeNull();
    expect(raisonUniteRefusee(ema, ctx("binance", "1d"), "1w")).toBeNull();
    expect(raisonUniteRefusee(ema, ctx("binance", "1h"), "1w")).toBe("Unité 1w non proposée sur un graphe 1h (4h, 1d)");
    expect(raisonUniteRefusee(ema, ctx("binance", "4h"), "4h")).toBe("Unité 4h non proposée sur un graphe 4h (1d, 1w)");
    expect(raisonUniteRefusee(ema, ctx("binance", "15m"), "1h")).toBe("Unité supérieure non proposée sur un graphe 15m");
    expect(raisonUniteRefusee(ema, ctx("binance", "1h"), "n'importe")).not.toBeNull();
  });

  it("places 24/7 seulement ; Coinbase sans 1w ; Twelve Data et synthétique exclus", () => {
    expect([...PLACES_UNITE].sort()).toEqual(["binance", "bybit", "coinbase", "hyperliquid", "kraken", "mexc", "okx"]);
    for (const place of ["bybit", "okx", "hyperliquid", "mexc", "kraken"] as const) {
      expect(raisonUniteRefusee(ema, ctx(place, "4h"), "1w"), place).toBeNull();
    }
    expect(raisonUniteRefusee(ema, ctx("coinbase", "4h"), "1d")).toBeNull();
    expect(raisonUniteRefusee(ema, ctx("coinbase", "4h"), "1w")).toBe("Intervalle 1w non servi par cette place");
    expect(raisonUniteRefusee(ema, ctx("twelvedata", "1h"), "4h")).toBe("Unité supérieure réservée aux places crypto 24/7");
    expect(raisonUniteRefusee(ema, ctx("synthetic", "1h"), "4h")).toBe("Unité supérieure réservée aux places crypto 24/7");
  });

  it("définitions refusées avec motif : stratégie, séries auxiliaires, unité requise, lecture différée", () => {
    const c = ctx("binance", "1h");
    expect(raisonUniteRefusee(getIndicator("stratAxis")!, c, "4h")).toBe("Stratégie : calcul sur l'unité du graphe uniquement");
    expect(raisonUniteRefusee(getIndicator("openInterest")!, c, "4h")).toBe("Séries auxiliaires : calcul sur l'unité du graphe uniquement");
    expect(raisonUniteRefusee(getIndicator("rvolSeasonal")!, c, "4h")).toBe("Réservé à l'intervalle 1h");
    expect(raisonUniteRefusee(getIndicator("ichimoku")!, c, "4h")).toBe("Calcul non projetable (lecture différée ou annotations)");
    expect(raisonUniteRefusee(getIndicator("vwap")!, c, "4h")).toBe("Calcul non projetable (lecture différée ou annotations)");
  });

  it("le contexte de l'unité supérieure passe par les règles du graphe natif (volumes acheteur/vendeur)", () => {
    const cvd = getIndicator("cvd")!;
    expect(raisonUniteRefusee(cvd, ctx("binance", "1h"), "4h")).toBeNull();
    expect(raisonUniteRefusee(cvd, ctx("bybit", "1h"), "4h")).toBe(
      "Volumes acheteur/vendeur historiques complets disponibles uniquement sur Binance",
    );
  });
});

describe("unitesProposees", () => {
  const ema = getIndicator("ema")!;
  it("liste les unités admises sur ce graphe, rien sinon", () => {
    expect(unitesProposees(ema, { exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" })).toEqual(["4h", "1d"]);
    expect(unitesProposees(ema, { exchange: "coinbase", symbol: "BTC-USD", timeframe: "4h" })).toEqual(["1d"]);
    expect(unitesProposees(ema, { exchange: "kraken", symbol: "XBTUSD", timeframe: "1d" })).toEqual(["1w"]);
    expect(unitesProposees(ema, { exchange: "twelvedata", symbol: "AAPL", timeframe: "1h" })).toEqual([]);
    expect(unitesProposees(ema, { exchange: "binance", symbol: "BTCUSDT", timeframe: "1w" })).toEqual([]);
    expect(unitesProposees(getIndicator("stratAxis")!, { exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" })).toEqual([]);
  });
});
