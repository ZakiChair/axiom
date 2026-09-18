/**
 * Tests du modèle PUR de la section DES « Flux takers toutes places » : jour affiché,
 * lectures fournisseur non recalculées, Δ taker, cumul 7 j complet ou absent, situation dans
 * l'archive (`situer`, qui vit ici et non dans le client CryptoQuant), écart à la médiane de
 * volume et courbe à dates réelles.
 */
import { describe, expect, it } from "vitest";
import type { ArchiveCq, LigneTaker } from "../data/onchain/cryptoquant";
import { construireModeleFluxTakers, serieTaker, situer } from "./fluxTakers.util";

const JOUR_MS = 86_400_000;
const AUJOURDHUI = "2026-09-16";
const jourIso = (t: number) => new Date(t).toISOString().slice(0, 10);

function ligne(p: Partial<LigneTaker> = {}): LigneTaker {
  return {
    n: 1_000_000,
    bv: 150_000,
    qv: 11_500_000_000,
    bbv: 75_000,
    qbv: 6_000_000_000,
    bsv: 75_000,
    qsv: 6_050_000_000,
    vwap: 76_000,
    br: 0.5,
    bsr: 1,
    bc: 500_000,
    sc: 500_000,
    ...p,
  };
}

/** Archive spot BTC couvrant [debut, fin] (inclus), jours `exclus` retirés, lignes surchargées. */
function archive(
  debut: string,
  fin: string,
  exclus: readonly string[] = [],
  surcharges: Record<string, Partial<LigneTaker>> = {},
): ArchiveCq {
  const jours: Record<string, LigneTaker> = {};
  for (let t = Date.parse(`${debut}T00:00:00Z`); t <= Date.parse(`${fin}T00:00:00Z`); t += JOUR_MS) {
    const j = jourIso(t);
    if (!exclus.includes(j)) jours[j] = ligne(surcharges[j]);
  }
  return { version: 1, serie: "taker:spot:btc", majTs: Date.UTC(2026, 8, 16, 6), jours };
}

/** Ligne réelle du sondage (spot BTC, 2026-09-15). */
const DERNIER: Partial<LigneTaker> = {
  n: 12_099_486,
  bv: 156_928.13,
  qv: 12_007_360_401.32,
  bbv: 77_681.2,
  qbv: 5_944_281_632.44,
  bsv: 79_246.93,
  qsv: 6_063_078_768.88,
  vwap: 76_515.03,
  br: 0.495,
  bsr: 0.9802,
  bc: 6_133_017,
  sc: 5_966_469,
};

/** 2026-08-17 → 2026-09-15 sans le 1er et le 2 septembre : 28 jours. */
const NOMINALE = archive("2026-08-17", "2026-09-15", ["2026-09-01", "2026-09-02"], {
  "2026-08-20": { bsr: 0.91 },
  "2026-08-25": { bsr: 0.95 },
  "2026-08-30": { bsr: 0.97 },
  "2026-09-05": { bsr: 1.07 },
  "2026-09-15": DERNIER,
});

describe("serieTaker", () => {
  it("compose la série du catalogue CryptoQuant (marché puis actif)", () => {
    expect(serieTaker({ actif: "btc", marche: "spot" })).toBe("taker:spot:btc");
    expect(serieTaker({ actif: "eth", marche: "spot" })).toBe("taker:spot:eth");
    expect(serieTaker({ actif: "btc", marche: "swap" })).toBe("taker:swap:btc");
    expect(serieTaker({ actif: "eth", marche: "swap" })).toBe("taker:swap:eth");
  });
});

describe("situer", () => {
  it("min, médiane, max, rang (1 = plus bas), N ; null si N < 2 ou valeur non finie", () => {
    expect(situer([1.07, 0.91, 0.99, 0.98], 0.98)).toMatchObject({ min: 0.91, max: 1.07, rang: 2, n: 4 });
    expect(situer([1.07, 0.91, 0.99, 0.98], 0.98)?.mediane).toBeCloseTo(0.985, 10);
    expect(situer([3, 1, 2], 1)).toEqual({ min: 1, mediane: 2, max: 3, rang: 1, n: 3 });
    expect([situer([1], 1), situer([1, Number.NaN], 1), situer([1, 2], Number.NaN)]).toEqual([null, null, null]);
  });

  it("ex æquo : rang = 1 + nombre de valeurs strictement inférieures", () => {
    expect(situer([1, 1], 1)).toEqual({ min: 1, mediane: 1, max: 1, rang: 1, n: 2 });
    expect(situer([0.9, 1, 1, 1.1], 1)).toEqual({ min: 0.9, mediane: 1, max: 1.1, rang: 2, n: 4 });
    expect(situer([2, 1, 1, 1], 2)?.rang).toBe(4);
  });
});

describe("construireModeleFluxTakers", () => {
  it("lit le dernier jour clos tel que publié (aucun recalcul du ratio ni du VWAP)", () => {
    const m = construireModeleFluxTakers(NOMINALE, AUJOURDHUI);
    expect(m.jour).toBe("2026-09-15");
    expect(m.ratio).toBe(0.9802);
    expect(m.partAcheteursPct).toBeCloseTo(49.5, 10);
    expect(m.deltaQuote).toBeCloseTo(5_944_281_632.44 - 6_063_078_768.88, 2);
    expect(m.volumeQuote).toBe(12_007_360_401.32);
    expect(m.volumeBase).toBe(156_928.13);
    expect(m.trades).toBe(12_099_486);
    expect(m.vwap).toBe(76_515.03);
  });

  it("ignore un jour du jour UTC en cours ou futur", () => {
    const avecAujourdhui: ArchiveCq = {
      ...NOMINALE,
      jours: { ...NOMINALE.jours, "2026-09-16": ligne({ bsr: 2 }), "2026-09-17": ligne({ bsr: 3 }) },
    };
    const m = construireModeleFluxTakers(avecAujourdhui, AUJOURDHUI);
    expect(m.jour).toBe("2026-09-15");
    expect(m.ratio).toBe(0.9802);
    expect(m.situation?.n).toBe(28);
  });

  it("situe le ratio sur les N jours archivés (min, médiane, max, rang 1 = plus bas)", () => {
    const m = construireModeleFluxTakers(NOMINALE, AUJOURDHUI);
    expect(m.situation).toEqual({ min: 0.91, mediane: 1, max: 1.07, rang: 4, n: 28 });
  });

  it("cumul 7 j : somme des Δ quote quand les sept jours calendaires sont présents", () => {
    const m = construireModeleFluxTakers(NOMINALE, AUJOURDHUI);
    // Six jours à −50 M$ (6,00 G$ − 6,05 G$) et le dernier à −118,80 M$.
    expect(m.cumul7.presents).toBe(7);
    expect(m.cumul7.valeur).toBeCloseTo(6 * -50_000_000 + (5_944_281_632.44 - 6_063_078_768.88), 1);
  });

  it("cumul 7 j : aucune valeur quand un jour manque, seulement le nombre de présents", () => {
    // Jour affiché 2026-09-05 : la fenêtre 30/08 → 05/09 perd le 1er et le 2 septembre.
    const tronquee = archive("2026-08-17", "2026-09-05", ["2026-09-01", "2026-09-02"]);
    const m = construireModeleFluxTakers(tronquee, AUJOURDHUI);
    expect(m.jour).toBe("2026-09-05");
    expect(m.cumul7).toEqual({ valeur: null, presents: 5 });
  });

  it("écart du volume quote à la médiane des 30 derniers jours présents", () => {
    const m = construireModeleFluxTakers(NOMINALE, AUJOURDHUI);
    // Médiane = 11,5 G$ (27 jours sur 28) → 12,007 / 11,5 − 1 = +4,41 %.
    expect(m.vsMediane30Pct).toBeCloseTo(4.4118, 3);
    // Quarante jours dont dix anciens énormes : seuls les 30 plus récents comptent.
    const anciens = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [jourIso(Date.UTC(2026, 7, 7) + i * JOUR_MS), { qv: 99_000_000_000 }]),
    );
    const longue = archive("2026-08-07", "2026-09-15", [], { ...anciens, "2026-09-15": { qv: 12_650_000_000 } });
    expect(construireModeleFluxTakers(longue, AUJOURDHUI).vsMediane30Pct).toBeCloseTo(10, 6);
  });

  it("courbe : chaque jour calendaire de l'archive, null aux jours absents", () => {
    const m = construireModeleFluxTakers(NOMINALE, AUJOURDHUI);
    expect(m.courbe).toHaveLength(30);
    expect(m.courbe[0]).toEqual({ jour: "2026-08-17", valeur: 1 });
    expect(m.courbe.find((p) => p.jour === "2026-09-01")).toEqual({ jour: "2026-09-01", valeur: null });
    expect(m.courbe.find((p) => p.jour === "2026-09-02")).toEqual({ jour: "2026-09-02", valeur: null });
    expect(m.courbe.at(-1)).toEqual({ jour: "2026-09-15", valeur: 0.9802 });
  });

  it("un seul jour : ni situation, ni cumul, ni médiane — jamais 0 à la place", () => {
    const seul = archive("2026-09-15", "2026-09-15", [], { "2026-09-15": DERNIER });
    const m = construireModeleFluxTakers(seul, AUJOURDHUI);
    expect(m.situation).toBeNull();
    expect(m.cumul7).toEqual({ valeur: null, presents: 1 });
    expect(m.vsMediane30Pct).toBeNull();
    expect(m.courbe).toEqual([{ jour: "2026-09-15", valeur: 0.9802 }]);
  });

  it("archive absente ou sans jour clos : modèle vide, aucune valeur inventée", () => {
    const vide = {
      jour: null,
      ratio: null,
      partAcheteursPct: null,
      situation: null,
      deltaQuote: null,
      cumul7: { valeur: null, presents: 0 },
      volumeQuote: null,
      volumeBase: null,
      trades: null,
      vwap: null,
      vsMediane30Pct: null,
      courbe: [],
    };
    expect(construireModeleFluxTakers(null, AUJOURDHUI)).toEqual(vide);
    expect(construireModeleFluxTakers(archive("2026-09-16", "2026-09-17"), AUJOURDHUI)).toEqual(vide);
  });
});
