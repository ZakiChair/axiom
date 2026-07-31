import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoinTile } from "./marketOverview";
import { agregerSecteur, agregerSecteurs, indexerTuiles, SECTEURS, type Secteur } from "./secteurs";

/** Fabrique une tuile de fixture (tous champs remplis). */
function tuile(partiel: Partial<CoinTile> & Pick<CoinTile, "id" | "symbol">): CoinTile {
  return {
    name: partiel.symbol,
    mcapUsd: 0,
    price: 1,
    changePct24h: 0,
    changePct7j: 0,
    changePct30j: 0,
    ...partiel,
  };
}

// ─────────────────────────── Agrégats sur fixture ───────────────────────────

/**
 * Fixture VÉRIFIÉE À LA MAIN — groupe de 3 membres, 2 couverts :
 *   A : cap 100 G$, Δ24h +2 %, Δ7j +10 %, Δ30j +20 %
 *   B : cap  50 G$, Δ24h −1 %, Δ7j  +4 %, Δ30j absent (vieux cache → undefined)
 *   C : hors top 250 (non couvert)
 * Attendus :
 *   cap totale = 150 G$ ; couverture 2/3
 *   Δ24h = (100×2 + 50×(−1)) / 150 = 150/150 = 1
 *   Δ7j  = (100×10 + 50×4)   / 150 = 1200/150 = 8
 *   Δ30j = (100×20) / 100 = 20            (B écarté : valeur non finie)
 *   poids A = 100/150 = 66,667 % ; poids B = 33,333 % ; poids C = null
 */
const GROUPE_FIXTURE: Secteur = {
  id: "fixture",
  nom: "Fixture",
  membres: [
    { id: "coin-a", ticker: "AAA", paireBinance: "AAAUSDT" },
    { id: "coin-b", ticker: "BBB" },
    { id: "coin-c", ticker: "CCC" },
  ],
};

const TUILES_FIXTURE: CoinTile[] = [
  tuile({ id: "coin-a", symbol: "AAA", mcapUsd: 100e9, price: 10, changePct24h: 2, changePct7j: 10, changePct30j: 20 }),
  // `changePct30j` volontairement ABSENT : simule une entrée de cache antérieure au champ.
  { id: "coin-b", symbol: "BBB", name: "Coin B", mcapUsd: 50e9, price: 5, changePct24h: -1, changePct7j: 4 } as CoinTile,
  tuile({ id: "hors-groupe", symbol: "ZZZ", mcapUsd: 7e9 }),
];

describe("agregerSecteur", () => {
  const agregat = agregerSecteur(GROUPE_FIXTURE, indexerTuiles(TUILES_FIXTURE));

  it("perf pondérée par capitalisation vérifiée à la main (1 j / 7 j)", () => {
    expect(agregat.changePct24h).toBeCloseTo(1, 10);
    expect(agregat.changePct7j).toBeCloseTo(8, 10);
  });

  it("une valeur non finie (vieux cache sans 30 j) est écartée de SA moyenne seulement", () => {
    // Δ30j : seul A est exploitable → 20 exactement (B ne pollue pas avec un 0).
    expect(agregat.changePct30j).toBeCloseTo(20, 10);
  });

  it("cap totale, couverture n/m et poids des membres", () => {
    expect(agregat.mcapUsd).toBe(150e9);
    expect(agregat.couverts).toBe(2);
    expect(agregat.total).toBe(3);
    const [a, b, c] = agregat.membres;
    expect(a?.poidsPct).toBeCloseTo((100 / 150) * 100, 6);
    expect(b?.poidsPct).toBeCloseTo((50 / 150) * 100, 6);
    expect(c?.couvert).toBe(false);
    expect(c?.poidsPct).toBeNull();
    expect(c?.mcapUsd).toBeNull();
  });

  it("groupe entièrement hors top 250 → cap 0, perfs null, 0 couvert", () => {
    const vide = agregerSecteur(GROUPE_FIXTURE, indexerTuiles([]));
    expect(vide.mcapUsd).toBe(0);
    expect(vide.changePct24h).toBeNull();
    expect(vide.changePct7j).toBeNull();
    expect(vide.changePct30j).toBeNull();
    expect(vide.couverts).toBe(0);
    expect(vide.total).toBe(3);
  });
});

describe("agregerSecteurs", () => {
  it("agrège la liste injectée dans l'ordre donné", () => {
    const agregats = agregerSecteurs(TUILES_FIXTURE, [GROUPE_FIXTURE]);
    expect(agregats).toHaveLength(1);
    expect(agregats[0]?.id).toBe("fixture");
  });

  it("par défaut, agrège les 10 secteurs curés", () => {
    const agregats = agregerSecteurs([]);
    expect(agregats).toHaveLength(SECTEURS.length);
  });
});

// ─────────────────────────── Sanité du mapping curé ───────────────────────────

describe("SECTEURS (mapping curé)", () => {
  it("compte 10 groupes de 10 à 20 membres", () => {
    expect(SECTEURS).toHaveLength(10);
    for (const s of SECTEURS) {
      expect(s.membres.length, s.id).toBeGreaterThanOrEqual(10);
      expect(s.membres.length, s.id).toBeLessThanOrEqual(20);
    }
  });

  it("ids de groupe uniques ; membres sans doublon INTRA-groupe ; formats sains", () => {
    expect(new Set(SECTEURS.map((s) => s.id)).size).toBe(SECTEURS.length);
    for (const s of SECTEURS) {
      expect(new Set(s.membres.map((m) => m.id)).size, s.id).toBe(s.membres.length);
      for (const m of s.membres) {
        expect(m.ticker, m.id).toMatch(/^[A-Z0-9]+$/);
        if (m.paireBinance !== undefined) expect(m.paireBinance, m.id).toMatch(/^[A-Z0-9]+USDT$/);
      }
    }
  });

  it("multi-appartenance documentée : LINK vit dans « Éco Ethereum » ET « RWA »", () => {
    const groupesLink = SECTEURS.filter((s) => s.membres.some((m) => m.id === "chainlink")).map((s) => s.id);
    expect(groupesLink.sort()).toEqual(["eco-ethereum", "rwa"]);
  });
});

// ─────────────────────────── Zéro réseau (critère de succès no 2) ───────────────────────────

describe("SECT — aucun appel réseau propre", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("la source du module ne contient ni fetch ni import réseau", () => {
    const source = readFileSync(fileURLToPath(new URL("./secteurs.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|WebSocket/);
    expect(source).not.toMatch(/from\s+["']\.\/extapi["']/);
  });

  it("agréger les 10 secteurs ne déclenche AUCUNE requête (compteur épinglé à 0)", () => {
    const espion = vi.fn(() => {
      throw new Error("SECT ne doit émettre aucune requête réseau");
    });
    vi.stubGlobal("fetch", espion);
    const agregats = agregerSecteurs(TUILES_FIXTURE);
    expect(agregats).toHaveLength(SECTEURS.length);
    expect(espion).not.toHaveBeenCalled();
  });
});
