/**
 * Tests du chargeur de bougies 1d des niveaux clés (chart/niveaux/bougiesJour.ts) : une
 * requête par jour UTC et par (source, symbole), promesses en vol dédoublonnées, échec non
 * caché, sources sans 1d (ou synthétiques) écartées SANS appel, bougies non alignées sur
 * 00:00 UTC refusées (jamais de « veille » calculée sur un autre découpage).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Candle, ExchangeId, IExchangeAdapter, Timeframe } from "@axiom/types";
import {
  LIMITE_BOUGIES_JOUR,
  _viderCacheBougiesJour,
  bougiesJourDisponibles,
  chargerBougiesJour,
  estAligneUtc,
  msAvantProchainJourUtc,
} from "./bougiesJour";

const JOUR = 86_400_000;
const NOW = Date.UTC(2026, 8, 14, 18);

function bougie(time: number): Candle {
  return { time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 };
}

function depsFactices(options: { tfs?: Timeframe[]; reponse?: () => Promise<Candle[]> } = {}) {
  const appels: { exchange: ExchangeId; symbol: string; tf: Timeframe; limit?: number }[] = [];
  const reponse = options.reponse ?? (async () => [bougie(Date.UTC(2026, 8, 13)), bougie(Date.UTC(2026, 8, 14))]);
  return {
    appels,
    deps: {
      getAdapter: (exchange: ExchangeId) =>
        ({
          fetchKlines: (symbol: string, tf: Timeframe, opts?: { limit?: number }) => {
            appels.push({ exchange, symbol, tf, limit: opts?.limit });
            return reponse();
          },
        }) as unknown as IExchangeAdapter,
      supportedTimeframesFor: () => options.tfs ?? (["1m", "1h", "1d"] as Timeframe[]),
    },
  };
}

beforeEach(() => {
  _viderCacheBougiesJour();
});

describe("estAligneUtc / msAvantProchainJourUtc", () => {
  it("aligné si toutes les bougies ouvrent à 00:00 UTC", () => {
    expect(estAligneUtc([bougie(Date.UTC(2026, 8, 13)), bougie(Date.UTC(2026, 8, 14))])).toBe(true);
    expect(estAligneUtc([bougie(Date.UTC(2026, 8, 13)), bougie(Date.UTC(2026, 8, 14, 4))])).toBe(false);
  });

  it("18:00 UTC → 6 h avant le prochain jour ; minuit pile → 24 h", () => {
    expect(msAvantProchainJourUtc(NOW)).toBe(6 * 3_600_000);
    expect(msAvantProchainJourUtc(Date.UTC(2026, 8, 14))).toBe(JOUR);
  });
});

describe("bougiesJourDisponibles", () => {
  it("refuse les séries synthétiques et les sources sans intervalle 1d", () => {
    expect(bougiesJourDisponibles("synthetic", "BTCUSDT|ETHUSDT", depsFactices().deps)).toBe(false);
    expect(bougiesJourDisponibles("binance", "BTCUSDT", depsFactices({ tfs: ["1m", "1h"] }).deps)).toBe(false);
    expect(bougiesJourDisponibles("binance", "BTCUSDT", depsFactices().deps)).toBe(true);
  });
});

describe("chargerBougiesJour", () => {
  it("demande LIMITE_BOUGIES_JOUR bougies 1d et met le succès en cache pour la journée", async () => {
    const f = depsFactices();
    const a = await chargerBougiesJour("binance", "BTCUSDT", NOW, f.deps);
    const b = await chargerBougiesJour("binance", "BTCUSDT", NOW + 3_600_000, f.deps);
    expect(a).toHaveLength(2);
    expect(b).toBe(a);
    expect(f.appels).toEqual([{ exchange: "binance", symbol: "BTCUSDT", tf: "1d", limit: LIMITE_BOUGIES_JOUR }]);
  });

  it("dédoublonne les requêtes en vol", async () => {
    const f = depsFactices();
    const [a, b] = await Promise.all([
      chargerBougiesJour("binance", "BTCUSDT", NOW, f.deps),
      chargerBougiesJour("binance", "BTCUSDT", NOW, f.deps),
    ]);
    expect(a).toBe(b);
    expect(f.appels).toHaveLength(1);
  });

  it("nouveau jour UTC ou autre symbole → nouvelle requête", async () => {
    const f = depsFactices();
    await chargerBougiesJour("binance", "BTCUSDT", NOW, f.deps);
    await chargerBougiesJour("binance", "BTCUSDT", NOW + JOUR, f.deps);
    await chargerBougiesJour("binance", "ETHUSDT", NOW + JOUR, f.deps);
    expect(f.appels).toHaveLength(3);
  });

  it("échec réseau → null, non caché (le prochain appel réessaie)", async () => {
    let echec = true;
    const f = depsFactices({
      reponse: async () => {
        if (echec) throw new Error("HTTP 503");
        return [bougie(Date.UTC(2026, 8, 14))];
      },
    });
    expect(await chargerBougiesJour("binance", "BTCUSDT", NOW, f.deps)).toBeNull();
    echec = false;
    expect(await chargerBougiesJour("binance", "BTCUSDT", NOW, f.deps)).toHaveLength(1);
    expect(f.appels).toHaveLength(2);
  });

  it("synthétique ou sans 1d → null sans aucun appel", async () => {
    const f = depsFactices({ tfs: ["1m", "1h"] });
    expect(await chargerBougiesJour("synthetic", "BTCUSDT|ETHUSDT", NOW, f.deps)).toBeNull();
    expect(await chargerBougiesJour("coinbase", "BTC-USD", NOW, f.deps)).toBeNull();
    expect(f.appels).toHaveLength(0);
  });

  it("bougies non alignées sur 00:00 UTC → null", async () => {
    const f = depsFactices({ reponse: async () => [bougie(Date.UTC(2026, 8, 13, 5)), bougie(Date.UTC(2026, 8, 14, 5))] });
    expect(await chargerBougiesJour("twelvedata", "SPY", NOW, f.deps)).toBeNull();
  });

  it("réponse vide → null", async () => {
    const f = depsFactices({ reponse: async () => [] });
    expect(await chargerBougiesJour("binance", "BTCUSDT", NOW, f.deps)).toBeNull();
  });
});
