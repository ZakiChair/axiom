/** Tests des calculs purs de la fenêtre STBL (dominance, impression, pegs, chaînes). */
import { describe, expect, it } from "vitest";
import type { DetailEmetteur, EmetteurStablecoin } from "../data/macro/stablecoinsDetail";
import {
  agregerHistoriqueEmetteur,
  bornes,
  calculerDominance,
  deltaPct,
  ecartPegBps,
  etatPeg,
  impressionNette,
  pointLePlusProche,
  repartitionChaines,
  resumePegs,
  serieImpressionQuotidienne,
  SUPPLY_MIN_USD,
  tronquerSerie,
} from "./stablecoinsWindow.util";

function emetteur(partiel: Partial<EmetteurStablecoin>): EmetteurStablecoin {
  return {
    id: "1",
    nom: "Tether",
    symbole: "USDT",
    pegType: "peggedUSD",
    pegMechanism: "fiat-backed",
    prix: 1,
    mcapUsd: 100,
    mcapVeilleUsd: null,
    mcap7jUsd: null,
    mcap30jUsd: null,
    parChaineUsd: {},
    ...partiel,
  };
}

const JOUR_MS = 86_400_000;

describe("calculerDominance", () => {
  it("calcule les parts en % et agrège la queue dans « Autres »", () => {
    const emetteurs = [
      emetteur({ id: "1", symbole: "USDT", mcapUsd: 600 }),
      emetteur({ id: "2", symbole: "USDC", mcapUsd: 300 }),
      emetteur({ id: "3", symbole: "DAI", mcapUsd: 60 }),
      emetteur({ id: "4", symbole: "FRAX", mcapUsd: 40 }),
    ];
    const parts = calculerDominance(emetteurs, 2);
    expect(parts.map((p) => p.symbole)).toEqual(["USDT", "USDC", "Autres"]);
    expect(parts[0]!.partPct).toBeCloseTo(60);
    expect(parts[2]!).toMatchObject({ id: "", mcapUsd: 100, partPct: 10 });
  });

  it("liste vide → tableau vide (pas de division par zéro)", () => {
    expect(calculerDominance([], 5)).toEqual([]);
  });
});

describe("deltaPct", () => {
  it("variation relative en %", () => {
    expect(deltaPct(110, 100)).toBeCloseTo(10);
    expect(deltaPct(90, 100)).toBeCloseTo(-10);
  });
  it("précédent null ou ≤ 0 → null", () => {
    expect(deltaPct(110, null)).toBeNull();
    expect(deltaPct(110, 0)).toBeNull();
  });
});

describe("ecartPegBps / etatPeg", () => {
  it("écart en bps vs 1,00 $ pour les pegs USD", () => {
    expect(ecartPegBps(emetteur({ prix: 1.001 }))).toBeCloseTo(10);
    expect(ecartPegBps(emetteur({ prix: 0.985 }))).toBeCloseTo(-150);
  });
  it("peg non-USD ou prix absent → null", () => {
    expect(ecartPegBps(emetteur({ pegType: "peggedEUR", prix: 1.08 }))).toBeNull();
    expect(ecartPegBps(emetteur({ prix: null }))).toBeNull();
  });
  it("seuils : <25 stable, <100 tension, ≥100 depeg (écart ABSOLU)", () => {
    expect(etatPeg(10)).toBe("stable");
    expect(etatPeg(-24.9)).toBe("stable");
    expect(etatPeg(25)).toBe("tension");
    expect(etatPeg(-99)).toBe("tension");
    expect(etatPeg(100)).toBe("depeg");
    expect(etatPeg(-150)).toBe("depeg");
  });
});

describe("impressionNette", () => {
  const serie = [
    { time: 0 * JOUR_MS, totalUsd: 100 },
    { time: 5 * JOUR_MS, totalUsd: 110 },
    { time: 10 * JOUR_MS, totalUsd: 130 },
  ];
  it("delta entre le dernier point et le point d'il y a N jours (plus proche ≤ borne)", () => {
    expect(impressionNette(serie, 5)).toBe(20); // 130 - 110
    expect(impressionNette(serie, 10)).toBe(30); // 130 - 100
  });
  it("série trop courte pour la fenêtre → null", () => {
    expect(impressionNette(serie, 30)).toBe(30); // borne avant le 1er point → 1er point
    expect(impressionNette([], 7)).toBeNull();
    expect(impressionNette([{ time: 0, totalUsd: 1 }], 7)).toBeNull();
  });
});

describe("serieImpressionQuotidienne", () => {
  it("delta point à point (mint > 0, burn < 0)", () => {
    const serie = [
      { time: 1 * JOUR_MS, totalUsd: 100 },
      { time: 2 * JOUR_MS, totalUsd: 104 },
      { time: 3 * JOUR_MS, totalUsd: 101 },
    ];
    expect(serieImpressionQuotidienne(serie)).toEqual([
      { time: 2 * JOUR_MS, delta: 4 },
      { time: 3 * JOUR_MS, delta: -3 },
    ]);
  });
});

describe("tronquerSerie", () => {
  const serie = [
    { time: 0 * JOUR_MS, totalUsd: 1 },
    { time: 50 * JOUR_MS, totalUsd: 2 },
    { time: 100 * JOUR_MS, totalUsd: 3 },
  ];
  it("garde les N derniers jours par rapport au dernier point", () => {
    expect(tronquerSerie(serie, 60)).toEqual(serie.slice(1));
  });
  it("null → série entière (mode « tout »)", () => {
    expect(tronquerSerie(serie, null)).toEqual(serie);
  });
});

describe("repartitionChaines", () => {
  it("agrège la supply par chaîne sur tous les émetteurs, tri décroissant", () => {
    const emetteurs = [
      emetteur({ parChaineUsd: { Tron: 60, Ethereum: 50 } }),
      emetteur({ id: "2", symbole: "USDC", parChaineUsd: { Ethereum: 30, Solana: 10 } }),
    ];
    const parts = repartitionChaines(emetteurs);
    expect(parts.map((p) => p.chaine)).toEqual(["Ethereum", "Tron", "Solana"]);
    expect(parts[0]!.totalUsd).toBe(80);
    expect(parts[0]!.partPct).toBeCloseTo((80 / 150) * 100);
  });
});

describe("agregerHistoriqueEmetteur", () => {
  it("somme les chaînes par date et trie chronologiquement", () => {
    const detail: DetailEmetteur = {
      id: "1",
      nom: "Tether",
      symbole: "USDT",
      pegType: "peggedUSD",
      pegMechanism: "fiat-backed",
      prix: 1,
      historiqueParChaine: {
        Tron: [
          { time: 1 * JOUR_MS, totalUsd: 10 },
          { time: 2 * JOUR_MS, totalUsd: 12 },
        ],
        Ethereum: [{ time: 2 * JOUR_MS, totalUsd: 5 }],
      },
    };
    expect(agregerHistoriqueEmetteur(detail)).toEqual([
      { time: 1 * JOUR_MS, totalUsd: 10 },
      { time: 2 * JOUR_MS, totalUsd: 17 },
    ]);
  });
});

describe("bornes", () => {
  it("min/max des valeurs finies", () => {
    expect(bornes([3, 1, 2])).toEqual({ min: 1, max: 3 });
    expect(bornes([Number.NaN, 5])).toEqual({ min: 5, max: 5 });
  });
  it("aucune valeur finie → null", () => {
    expect(bornes([])).toBeNull();
    expect(bornes([Number.NaN])).toBeNull();
  });
});

describe("pointLePlusProche", () => {
  const serie = [
    { time: 1000, totalUsd: 10 },
    { time: 2000, totalUsd: 20 },
    { time: 4000, totalUsd: 40 },
  ];
  it("renvoie le point exact quand `t` correspond", () => {
    expect(pointLePlusProche(serie, 2000)).toEqual({ time: 2000, totalUsd: 20 });
  });
  it("renvoie le point le plus proche quand `t` tombe entre deux points", () => {
    expect(pointLePlusProche(serie, 2900)).toEqual({ time: 2000, totalUsd: 20 });
    expect(pointLePlusProche(serie, 3100)).toEqual({ time: 4000, totalUsd: 40 });
  });
  it("série vide → null", () => {
    expect(pointLePlusProche([], 1000)).toBeNull();
  });
});

describe("resumePegs", () => {
  it("compte les stables, remonte tension/depeg triés par |bps| décroissant", () => {
    const r = resumePegs([
      emetteur({ id: "1", symbole: "USDT", prix: 1.0005, mcapUsd: SUPPLY_MIN_USD }),
      emetteur({ id: "2", symbole: "USDX", prix: 0.9962, mcapUsd: SUPPLY_MIN_USD }),
      emetteur({ id: "3", symbole: "USDY", prix: 0.9788, mcapUsd: SUPPLY_MIN_USD }),
    ]);
    expect(r.stables).toBe(1);
    expect(r.alertes.map((a) => a.symbole)).toEqual(["USDY", "USDX"]);
    expect(r.alertes[0]?.etat).toBe("depeg");
    expect(r.alertes[1]?.etat).toBe("tension");
  });

  it("ignore les non-USD, prix null et sous le seuil de matérialité", () => {
    const r = resumePegs([
      emetteur({ id: "1", pegType: "peggedEUR", prix: 0.9, mcapUsd: SUPPLY_MIN_USD }),
      emetteur({ id: "2", prix: null, mcapUsd: SUPPLY_MIN_USD }),
      emetteur({ id: "3", prix: 0.97, mcapUsd: SUPPLY_MIN_USD - 1 }),
    ]);
    expect(r.stables).toBe(0);
    expect(r.alertes).toEqual([]);
  });
});
