/**
 * Tests des calculs PURS du portefeuille (PnL latent/réalisé, exposition, stats de
 * clôtures) + du conteneur (ajout / clôture / suppression). Env node : `localStorage`
 * absent → la persistance interne est un no-op (couverte par try/catch), sans effet ici.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  portfolioStore,
  pnlLatentPosition,
  pnlRealisePosition,
  calculerExposition,
  pnlLatentTotal,
  statsClotures,
  type Position,
  type NouvellePosition,
} from "./portfolio";

/** Fabrique une position de test avec des défauts raisonnables. */
function pos(over: Partial<Position>): Position {
  return {
    id: over.id ?? "p1",
    symbole: over.symbole ?? "BTCUSDT",
    source: over.source ?? "binance",
    direction: over.direction ?? "long",
    taille: over.taille ?? 1,
    prixEntree: over.prixEntree ?? 100,
    fraisPct: over.fraisPct,
    dateEntree: over.dateEntree ?? 0,
    note: over.note,
    statut: over.statut ?? "ouvert",
    prixSortie: over.prixSortie,
    dateSortie: over.dateSortie,
  };
}

describe("pnlLatentPosition", () => {
  it("long : gain proportionnel à la hausse × taille (sans frais)", () => {
    const pnl = pnlLatentPosition(pos({ direction: "long", prixEntree: 100, taille: 2 }), 110);
    expect(pnl?.brut).toBe(20); // (110-100)*2
    expect(pnl?.frais).toBe(0);
    expect(pnl?.net).toBe(20);
    expect(pnl?.pct).toBeCloseTo(10); // 20 / (100*2) * 100
  });

  it("short : gagne quand le prix baisse", () => {
    const pnl = pnlLatentPosition(pos({ direction: "short", prixEntree: 100, taille: 1 }), 90);
    expect(pnl?.brut).toBe(10);
    expect(pnl?.net).toBe(10);
  });

  it("short : perd quand le prix monte", () => {
    const pnl = pnlLatentPosition(pos({ direction: "short", prixEntree: 100, taille: 1 }), 130);
    expect(pnl?.brut).toBe(-30);
  });

  it("applique les frais sur les deux jambes (entrée + sortie)", () => {
    const pnl = pnlLatentPosition(pos({ prixEntree: 100, taille: 1, fraisPct: 0.1 }), 110);
    // frais = 0.1% * (100 + 110) = 0.21 ; net = 10 - 0.21
    expect(pnl?.frais).toBeCloseTo(0.21);
    expect(pnl?.net).toBeCloseTo(9.79);
  });

  it("prix invalide (≤ 0 ou NaN) → null", () => {
    expect(pnlLatentPosition(pos({}), 0)).toBeNull();
    expect(pnlLatentPosition(pos({}), Number.NaN)).toBeNull();
  });
});

describe("pnlRealisePosition", () => {
  it("valorise au prix de sortie de la position clôturée", () => {
    const pnl = pnlRealisePosition(
      pos({ statut: "clos", direction: "long", prixEntree: 100, taille: 1, prixSortie: 120 })
    );
    expect(pnl?.net).toBe(20);
  });

  it("null si aucun prix de sortie", () => {
    expect(pnlRealisePosition(pos({ statut: "ouvert" }))).toBeNull();
  });
});

describe("calculerExposition", () => {
  it("valorise au prix courant, ventile long/short et par actif", () => {
    const positions = [
      pos({ id: "a", symbole: "BTCUSDT", direction: "long", prixEntree: 100, taille: 1 }),
      pos({ id: "b", symbole: "ETHUSDT", direction: "short", prixEntree: 50, taille: 2 }),
    ];
    const exp = calculerExposition(positions, { BTCUSDT: 200, ETHUSDT: 40 });
    expect(exp.longue).toBe(200); // 200*1
    expect(exp.courte).toBe(80); // 40*2
    expect(exp.brute).toBe(280);
    expect(exp.nette).toBe(120); // 200 - 80
    expect(exp.parActif.BTCUSDT).toBe(200);
    expect(exp.parActif.ETHUSDT).toBe(-80);
  });

  it("repli sur le prix d'entrée si le prix courant manque", () => {
    const exp = calculerExposition([pos({ symbole: "BTCUSDT", prixEntree: 100, taille: 1 })], {});
    expect(exp.longue).toBe(100);
  });

  it("ignore les positions clôturées", () => {
    const exp = calculerExposition(
      [pos({ statut: "clos", prixEntree: 100, taille: 1, prixSortie: 120 })],
      { BTCUSDT: 200 }
    );
    expect(exp.brute).toBe(0);
  });

  it("agrège deux positions du même actif dans parActif", () => {
    const positions = [
      pos({ id: "a", symbole: "BTCUSDT", direction: "long", prixEntree: 100, taille: 1 }),
      pos({ id: "b", symbole: "BTCUSDT", direction: "short", prixEntree: 100, taille: 1 }),
    ];
    const exp = calculerExposition(positions, { BTCUSDT: 100 });
    expect(exp.parActif.BTCUSDT).toBe(0); // +100 (long) - 100 (short)
    expect(exp.brute).toBe(200);
  });
});

describe("pnlLatentTotal", () => {
  it("somme les nets des positions dont le prix est connu, ignore les autres", () => {
    const positions = [
      pos({ id: "a", symbole: "BTCUSDT", direction: "long", prixEntree: 100, taille: 1 }),
      pos({ id: "b", symbole: "ETHUSDT", direction: "long", prixEntree: 50, taille: 1 }),
    ];
    // Seul BTC a un prix courant → +20 ; ETH ignoré.
    expect(pnlLatentTotal(positions, { BTCUSDT: 120 })).toBe(20);
  });
});

describe("statsClotures", () => {
  it("compte gagnants/perdants, win rate, cumul, meilleure et pire", () => {
    const positions = [
      pos({ id: "a", statut: "clos", direction: "long", prixEntree: 100, taille: 1, prixSortie: 130 }), // +30
      pos({ id: "b", statut: "clos", direction: "long", prixEntree: 100, taille: 1, prixSortie: 90 }), // -10
      pos({ id: "c", statut: "clos", direction: "long", prixEntree: 100, taille: 1, prixSortie: 110 }), // +10
      pos({ id: "d", statut: "ouvert", direction: "long", prixEntree: 100, taille: 1 }), // ignorée
    ];
    const s = statsClotures(positions);
    expect(s.nombre).toBe(3);
    expect(s.gagnants).toBe(2);
    expect(s.perdants).toBe(1);
    expect(s.winRate).toBeCloseTo((2 / 3) * 100);
    expect(s.pnlCumule).toBe(30);
    expect(s.meilleure).toBe(30);
    expect(s.pire).toBe(-10);
  });

  it("aucune clôture → zéros et meilleure/pire null", () => {
    const s = statsClotures([pos({ statut: "ouvert" })]);
    expect(s.nombre).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.meilleure).toBeNull();
    expect(s.pire).toBeNull();
  });
});

describe("portfolioStore", () => {
  beforeEach(() => portfolioStore.setState({ positions: [] }));

  const NOUVELLE: NouvellePosition = {
    symbole: "btcusdt",
    source: "binance",
    direction: "long",
    taille: 1,
    prixEntree: 100,
  };

  it("ajouter : crée une position ouverte, symbole normalisé, id généré", () => {
    portfolioStore.getState().ajouter(NOUVELLE);
    const p = portfolioStore.getState().positions[0];
    expect(p?.symbole).toBe("BTCUSDT");
    expect(p?.statut).toBe("ouvert");
    expect(typeof p?.id).toBe("string");
    expect(p?.prixSortie).toBeUndefined();
  });

  it("cloturer : passe la position en « clos » avec prix de sortie et date", () => {
    portfolioStore.getState().ajouter(NOUVELLE);
    const id = portfolioStore.getState().positions[0]?.id ?? "";
    portfolioStore.getState().cloturer(id, 150);
    const p = portfolioStore.getState().positions[0];
    expect(p?.statut).toBe("clos");
    expect(p?.prixSortie).toBe(150);
    expect(typeof p?.dateSortie).toBe("number");
  });

  it("supprimer : retire la position par id", () => {
    portfolioStore.getState().ajouter(NOUVELLE);
    const id = portfolioStore.getState().positions[0]?.id ?? "";
    portfolioStore.getState().supprimer(id);
    expect(portfolioStore.getState().positions).toHaveLength(0);
  });
});
