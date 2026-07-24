/**
 * Tests du helper PUR de construction des lignes de l'overlay PAPER (paperLignes.ts).
 * Le rendu KLineChart n'est PAS testé. On verrouille : symbole COURANT seulement (les autres
 * exclus), market écarté (pas de prix de repos), limit/stop tracés à leur prix, TP/SL des
 * positions (null ignoré), long+short coexistent, conventions de couleur.
 */
import { describe, expect, it } from "vitest";
import { niveauxPaperLignes } from "./paperLignes";
import type { EtatPaper, OrdrePaper, PositionPaper } from "../data/paper";

function ordre(o: Partial<OrdrePaper>): OrdrePaper {
  return {
    id: "o", symbol: "BTCUSDT", direction: "long", type: "limit",
    prixLimite: null, prixStop: null, taille: 1, tp: null, sl: null, creeTs: 0, ...o,
  };
}
function position(p: Partial<PositionPaper>): PositionPaper {
  return {
    id: "p", symbol: "BTCUSDT", direction: "long", taille: 1, prixEntree: 100,
    tp: null, sl: null, ouvertTs: 0, ...p,
  };
}
function etat(ordres: OrdrePaper[], positions: PositionPaper[]): EtatPaper {
  return { solde: 0, ordres, positions, executions: [] };
}

describe("niveauxPaperLignes", () => {
  it("n'inclut que le symbole courant (les autres symboles sont exclus)", () => {
    const e = etat(
      [ordre({ id: "a", symbol: "BTCUSDT", type: "limit", prixLimite: 100 }),
       ordre({ id: "b", symbol: "ETHUSDT", type: "limit", prixLimite: 50 })],
      [],
    );
    const lignes = niveauxPaperLignes(e, "BTCUSDT");
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ price: 100 });
  });

  it("écarte les ordres market (aucun prix de repos)", () => {
    const e = etat([ordre({ type: "market" })], []);
    expect(niveauxPaperLignes(e, "BTCUSDT")).toEqual([]);
  });

  it("trace un limit long à prixLimite, couleur --up", () => {
    const e = etat([ordre({ type: "limit", direction: "long", prixLimite: 95, taille: 0.5 })], []);
    const lignes = niveauxPaperLignes(e, "BTCUSDT");
    expect(lignes[0]).toMatchObject({ price: 95, couleur: "--up", label: "long limit 0.5", emphase: "forte" });
  });

  it("trace un stop short à prixStop, couleur --down", () => {
    const e = etat([ordre({ type: "stop", direction: "short", prixStop: 120, taille: 2 })], []);
    const lignes = niveauxPaperLignes(e, "BTCUSDT");
    expect(lignes[0]).toMatchObject({ price: 120, couleur: "--down", label: "short stop 2", emphase: "forte" });
  });

  it("trace TP (--up) et SL (--down) d'une position, ignore un niveau null", () => {
    const e = etat([], [
      position({ id: "x", direction: "long", tp: 130, sl: 90, taille: 1 }),
      position({ id: "y", direction: "short", tp: null, sl: 140, taille: 3 }),
    ]);
    const lignes = niveauxPaperLignes(e, "BTCUSDT");
    // x → TP + SL ; y → SL seul (tp null ignoré) = 3 lignes.
    expect(lignes).toHaveLength(3);
    expect(lignes.find((l) => l.price === 130)).toMatchObject({ couleur: "--up", label: "long TP 1" });
    expect(lignes.find((l) => l.price === 90)).toMatchObject({ couleur: "--down", label: "long SL 1" });
    expect(lignes.find((l) => l.price === 140)).toMatchObject({ couleur: "--down", label: "short SL 3" });
  });

  it("long et short coexistent sur le même symbole", () => {
    const e = etat(
      [ordre({ id: "l", type: "limit", direction: "long", prixLimite: 90 }),
       ordre({ id: "s", type: "limit", direction: "short", prixLimite: 110 })],
      [],
    );
    const lignes = niveauxPaperLignes(e, "BTCUSDT");
    expect(lignes).toHaveLength(2);
    expect(lignes.find((l) => l.price === 90)?.couleur).toBe("--up");
    expect(lignes.find((l) => l.price === 110)?.couleur).toBe("--down");
  });

  it("exclut les positions d'un autre symbole", () => {
    const e = etat([], [position({ symbol: "ETHUSDT", tp: 60, sl: 40 })]);
    expect(niveauxPaperLignes(e, "BTCUSDT")).toEqual([]);
  });
});
