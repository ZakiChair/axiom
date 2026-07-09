import { describe, expect, it } from "vitest";
import {
  fusionnerAvecCache,
  indexerBatch,
  parseEpochInfo,
  parseInflation,
  parsePerfSamples,
  parseSupplyCoinGecko,
  parseVoteAccounts,
  type ReseauSol,
} from "./solana";

describe("indexerBatch", () => {
  it("indexe les réponses d'un batch JSON-RPC par id", () => {
    const batch = [
      { jsonrpc: "2.0", id: 2, result: { epoch: 999 } },
      { jsonrpc: "2.0", id: 1, result: "ok" },
    ];
    const map = indexerBatch(batch);
    expect(map.get(1)).toEqual({ jsonrpc: "2.0", id: 1, result: "ok" });
    expect(map.get(2)).toEqual({ jsonrpc: "2.0", id: 2, result: { epoch: 999 } });
  });
  it("map vide si la réponse n'est pas un tableau (erreur RPC globale)", () => {
    expect(indexerBatch({ error: { code: -32600 } }).size).toBe(0);
  });
});

describe("parseEpochInfo", () => {
  it("extrait l'époque et sa progression 0..1", () => {
    const json = { jsonrpc: "2.0", id: 1, result: { epoch: 999, slotIndex: 108000, slotsInEpoch: 432000 } };
    expect(parseEpochInfo(json)).toEqual({ epoque: 999, progression: 0.25 });
  });
  it("null sur erreur RPC ou forme inconnue", () => {
    expect(parseEpochInfo({ jsonrpc: "2.0", id: 1, error: { code: -32005 } })).toBeNull();
    expect(parseEpochInfo({})).toBeNull();
  });
  it("null si slotsInEpoch vaut 0 (pas de division par zéro)", () => {
    expect(parseEpochInfo({ result: { epoch: 1, slotIndex: 0, slotsInEpoch: 0 } })).toBeNull();
  });
});

describe("parsePerfSamples", () => {
  it("moyenne le TPS total et hors votes sur les échantillons", () => {
    const json = {
      result: [
        { numTransactions: 120_000, numNonVoteTransactions: 60_000, samplePeriodSecs: 60 },
        { numTransactions: 240_000, numNonVoteTransactions: 60_000, samplePeriodSecs: 60 },
      ],
    };
    expect(parsePerfSamples(json)).toEqual({ tps: 3000, tpsHorsVotes: 1000 });
  });
  it("null sur tableau vide ou durée totale nulle", () => {
    expect(parsePerfSamples({ result: [] })).toBeNull();
    expect(parsePerfSamples({ result: [{ numTransactions: 10, numNonVoteTransactions: 5, samplePeriodSecs: 0 }] })).toBeNull();
  });
  it("ignore les échantillons malformés sans jeter", () => {
    const json = {
      result: [{ numTransactions: "n/a" }, { numTransactions: 6_000, numNonVoteTransactions: 3_000, samplePeriodSecs: 60 }],
    };
    expect(parsePerfSamples(json)).toEqual({ tps: 100, tpsHorsVotes: 50 });
  });
});

describe("parseSupplyCoinGecko", () => {
  it("extrait la supply circulante du premier élément de /coins/markets", () => {
    const json = [{ id: "solana", circulating_supply: 581_830_541.68, total_supply: 629_974_779.57 }];
    expect(parseSupplyCoinGecko(json)).toBeCloseTo(581_830_541.68);
  });
  it("null sur tableau vide, erreur ou forme inconnue", () => {
    expect(parseSupplyCoinGecko([])).toBeNull();
    expect(parseSupplyCoinGecko({ status: { error_code: 429 } })).toBeNull();
    expect(parseSupplyCoinGecko([{ circulating_supply: "n/a" }])).toBeNull();
  });
  it("null (et pas 0) si circulating_supply vaut null — trou de données CoinGecko", () => {
    expect(parseSupplyCoinGecko([{ id: "solana", circulating_supply: null }])).toBeNull();
  });
});

describe("fusionnerAvecCache", () => {
  const frais: ReseauSol = {
    epoque: 1000,
    progressionEpoque: 0.5,
    tps: 3000,
    tpsHorsVotes: 1500,
    supplySol: null, // CoinGecko en échec sur ce passage
    inflation: 0.037,
    validateursActifs: 700,
    validateursDelinquants: 20,
    stakeSol: 420_000_000,
  };
  const ancien: ReseauSol = { ...frais, epoque: 999, supplySol: 580_000_000 };

  it("comble les champs null du frais avec l'ancien cache, sans écraser le frais", () => {
    const fusion = fusionnerAvecCache(frais, ancien);
    expect(fusion.supplySol).toBe(580_000_000); // trou comblé par l'ancien
    expect(fusion.epoque).toBe(1000); // le frais reste prioritaire
  });
  it("renvoie le frais tel quel sans cache antérieur", () => {
    expect(fusionnerAvecCache(frais, undefined)).toEqual(frais);
  });
});

describe("parseInflation", () => {
  it("extrait le taux d'inflation annuel total", () => {
    expect(parseInflation({ result: { epoch: 999, total: 0.0375, validator: 0.0375, foundation: 0 } })).toBeCloseTo(0.0375);
  });
  it("null sur forme inconnue", () => {
    expect(parseInflation({ result: { total: "beaucoup" } })).toBeNull();
  });
});

describe("parseVoteAccounts", () => {
  it("compte les validateurs et somme le stake actif en SOL", () => {
    const json = {
      result: {
        current: [{ activatedStake: 2_000_000_000 }, { activatedStake: 3_000_000_000 }],
        delinquent: [{ activatedStake: 1_000_000_000 }],
      },
    };
    expect(parseVoteAccounts(json)).toEqual({ actifs: 2, delinquants: 1, stakeSol: 5 });
  });
  it("null sur forme inconnue", () => {
    expect(parseVoteAccounts({ result: { current: "rien" } })).toBeNull();
  });
});
