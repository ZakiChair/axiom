/**
 * Tests des fonctions PURES des bulles de prints baleines (whaleBubbles.ts) :
 * projection d'un trade agressif en print (filtre par seuil notionnel + calcul du
 * notionnel), bornage FIFO du buffer, échelle de rayon (√notionnel, bornée), étiquette
 * conditionnelle des très gros prints, et nettoyage des overlays suivis (tolère une
 * instance disposée). Le couplage KLineChart n'est PAS testé (rendu impératif, comme
 * tradeMarkers / ecoMarkers).
 *
 * whaleBubbles.ts appelle `registerOverlay`, importe `./drawing` (klinecharts) et
 * `../store/theme` (pose [data-theme] sur <html> au chargement) ; on les stub pour
 * importer le module en environnement Node (mocks identiques à tradeMarkers.test.ts).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
vi.mock("./drawing", () => ({ getActiveChart: () => null }));
vi.mock("../store/theme", () => ({
  themeStore: { getState: () => ({ theme: "dark" }), subscribe: () => () => {} },
}));

import {
  versWhalePrint,
  ajouterPrint,
  rayonBulle,
  labelPourPrint,
  retirerBullesSuivies,
  WHALE_MAX_PRINTS,
  type WhalePrint,
  type CibleOverlays,
} from "./whaleBubbles";
import type { Trade } from "@axiom/types";

describe("versWhalePrint — filtre par seuil + notionnel", () => {
  it("filtre sous le seuil et calcule le notionnel (price × qty)", () => {
    const t: Trade = { time: 1, price: 50_000, qty: 3, side: "buy" };
    expect(versWhalePrint(t, 100_000)?.notionnel).toBe(150_000);
    expect(versWhalePrint({ ...t, qty: 1 }, 100_000)).toBeNull();
  });

  it("accepte un notionnel EXACTEMENT égal au seuil (bulle valide)", () => {
    const t: Trade = { time: 2, price: 100_000, qty: 1, side: "sell" };
    expect(versWhalePrint(t, 100_000)).toMatchObject({
      time: 2,
      price: 100_000,
      notionnel: 100_000,
      side: "sell",
    });
  });

  it("conserve le côté agresseur tel quel (ne l'inverse pas)", () => {
    const buy: Trade = { time: 3, price: 60_000, qty: 5, side: "buy" };
    const sell: Trade = { time: 4, price: 60_000, qty: 5, side: "sell" };
    expect(versWhalePrint(buy, 100_000)?.side).toBe("buy");
    expect(versWhalePrint(sell, 100_000)?.side).toBe("sell");
  });

  it("rejette un trade malformé (price/qty NaN) au lieu de laisser passer un notionnel NaN", () => {
    const t: Trade = { time: 5, price: NaN, qty: 3, side: "buy" };
    expect(versWhalePrint(t, 100_000)).toBeNull();
  });
});

describe("ajouterPrint — FIFO borné", () => {
  it("évince les plus anciens au-delà du max (garde les derniers)", () => {
    const p = (time: number): WhalePrint => ({ time, price: 1, notionnel: 1, side: "buy" });
    let buf: WhalePrint[] = [];
    buf = ajouterPrint(buf, p(1), 2);
    buf = ajouterPrint(buf, p(2), 2);
    buf = ajouterPrint(buf, p(3), 2);
    expect(buf.map((x) => x.time)).toEqual([2, 3]);
  });

  it("utilise WHALE_MAX_PRINTS par défaut", () => {
    let buf: WhalePrint[] = [];
    for (let i = 0; i < WHALE_MAX_PRINTS + 10; i++) {
      buf = ajouterPrint(buf, { time: i, price: 1, notionnel: 1, side: "buy" });
    }
    expect(buf).toHaveLength(WHALE_MAX_PRINTS);
    expect(buf[0]?.time).toBe(10); // les 10 premiers ont été évincés
  });
});

describe("rayonBulle — √notionnel, monotone et borné", () => {
  it("vaut R_MIN au seuil, ×2 pour ×4 le notionnel, plafonne à R_MAX", () => {
    expect(rayonBulle(100_000, 100_000)).toBe(4); // R_MIN
    expect(rayonBulle(400_000, 100_000)).toBe(8); // ×4 notionnel → ×2 rayon
    expect(rayonBulle(1e9, 100_000)).toBe(18); // plafonné à R_MAX
  });

  it("clampe à R_MIN sous le seuil (print bufferisé avant relèvement du seuil)", () => {
    expect(rayonBulle(1_000, 100_000)).toBe(4); // R_MIN
  });
});

describe("labelPourPrint — n'étiquette que les très gros prints", () => {
  it("null sous 5× le seuil, étiquette formatUsd à partir de 5×", () => {
    const p = (notionnel: number): WhalePrint => ({ time: 1, price: 1, notionnel, side: "buy" });
    expect(labelPourPrint(p(499_000), 100_000)).toBeNull();
    expect(labelPourPrint(p(500_000), 100_000)).toBe("$500.00K");
  });
});

describe("retirerBullesSuivies — nettoyage multi-instances", () => {
  /** Chart factice : enregistre les ids retirés ; `detruit` simule une instance disposée. */
  function chartFactice(detruit = false): CibleOverlays & { retires: string[] } {
    const retires: string[] = [];
    return {
      retires,
      removeOverlay({ id }: { id: string }): void {
        if (detruit) throw new Error("instance détruite");
        retires.push(id);
      },
    };
  }

  it("retire chaque id sur CHAQUE instance suivie puis vide le registre", () => {
    const a = chartFactice();
    const b = chartFactice();
    const suivis = new Map<CibleOverlays, string[]>([
      [a, ["a1", "a2"]],
      [b, ["b1"]],
    ]);
    retirerBullesSuivies(suivis);
    expect(a.retires).toEqual(["a1", "a2"]);
    expect(b.retires).toEqual(["b1"]);
    expect(suivis.size).toBe(0);
  });

  it("tolère une instance détruite (removeOverlay lève) et nettoie les autres", () => {
    const morte = chartFactice(true);
    const vivante = chartFactice();
    const suivis = new Map<CibleOverlays, string[]>([
      [morte, ["m1", "m2"]],
      [vivante, ["v1"]],
    ]);
    expect(() => retirerBullesSuivies(suivis)).not.toThrow();
    expect(vivante.retires).toEqual(["v1"]);
    expect(suivis.size).toBe(0);
  });
});
