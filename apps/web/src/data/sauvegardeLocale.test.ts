import { describe, expect, it, vi } from "vitest";
import { CLES_SNAPSHOT, CLES_TRAVAIL_PERSONNEL, remplacerClesLocales } from "./sauvegardeLocale";

describe("sauvegarde des décisions et simulations", () => {
  it("inclut dossiers, PAPER, versions et presets BT sans capturer les credentials", () => {
    const attendues = ["axiom:decisionDossiers:v1", "axiom:paper:v1", "axiom:backtest:history:v1", "axiom:backtest:v1", "axiom:analyseBrief:v1"];
    for (const cle of attendues) {
      expect(CLES_TRAVAIL_PERSONNEL).toContain(cle);
      expect(CLES_SNAPSHOT).toContain(cle);
    }
    expect(CLES_SNAPSHOT.some((cle) => /api.?key|credential|token/i.test(cle))).toBe(false);
  });

  it("restaure les valeurs nouvelles par rollback si le quota casse une écriture tardive", () => {
    const avant = new Map<string, string>([
      ["axiom:decisionDossiers:v1", "dossiers précieux"],
      ["axiom:paper:v1", "positions précieuses"],
      ["axiom:backtest:history:v1", "runs précieux"],
    ]);
    const donnees = new Map(avant);
    const stockage = {
      getItem: vi.fn((cle: string) => donnees.get(cle) ?? null),
      setItem: vi.fn((cle: string, valeur: string) => {
        if (cle === "axiom:backtest:history:v1" && valeur === "nouveau run") throw new Error("quota");
        donnees.set(cle, valeur);
      }),
      removeItem: vi.fn((cle: string) => { donnees.delete(cle); }),
    };
    vi.stubGlobal("localStorage", stockage);
    try {
      const nouveau = new Map([
        ["axiom:decisionDossiers:v1", "nouveau dossier"],
        ["axiom:paper:v1", "nouvelle position"],
        ["axiom:backtest:history:v1", "nouveau run"],
      ]);
      expect(remplacerClesLocales(nouveau, CLES_TRAVAIL_PERSONNEL)).toBe(false);
      expect(donnees).toEqual(avant);
    } finally { vi.unstubAllGlobals(); }
  });
});
