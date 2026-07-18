/**
 * Tests des fonctions PURES de l'outil de mesure « Shift + glisser » :
 * `calculerMesure` (écart %, Δ prix, nb bougies, durée, sens) et `formaterDuree`
 * (durée compacte). Le contrôleur DOM/événements est vérifié par rendu réel.
 */
import { describe, expect, it } from "vitest";
import { calculerMesure, formaterDuree } from "./measureTool";

describe("calculerMesure", () => {
  it("mesure une hausse (écart %, Δ prix, sens)", () => {
    const m = calculerMesure(
      { prix: 100, timestamp: 1_000, dataIndex: 10 },
      { prix: 110, timestamp: 4_600_000, dataIndex: 15 },
    );
    expect(m.pct).toBeCloseTo(10, 6);
    expect(m.deltaPrix).toBeCloseTo(10, 6);
    expect(m.nBougies).toBe(5);
    expect(m.dureeMs).toBe(4_599_000);
    expect(m.hausse).toBe(true);
  });

  it("mesure une baisse (Δ négatif, sens bas)", () => {
    const m = calculerMesure(
      { prix: 200, timestamp: 5_000, dataIndex: 20 },
      { prix: 150, timestamp: 2_000, dataIndex: 12 },
    );
    expect(m.pct).toBeCloseTo(-25, 6);
    expect(m.deltaPrix).toBeCloseTo(-50, 6);
    // nb bougies et durée sont des écarts ABSOLUS, quel que soit le sens du glissement.
    expect(m.nBougies).toBe(8);
    expect(m.dureeMs).toBe(3_000);
    expect(m.hausse).toBe(false);
  });

  it("égalité stricte compte comme hausse (bord)", () => {
    const m = calculerMesure(
      { prix: 100, timestamp: 0, dataIndex: 0 },
      { prix: 100, timestamp: 0, dataIndex: 0 },
    );
    expect(m.pct).toBe(0);
    expect(m.deltaPrix).toBe(0);
    expect(m.hausse).toBe(true);
  });

  it("prix de départ 0 ou non fini → pct NaN (pas de division par zéro)", () => {
    const m = calculerMesure(
      { prix: 0, timestamp: 0, dataIndex: 0 },
      { prix: 50, timestamp: 0, dataIndex: 1 },
    );
    expect(Number.isNaN(m.pct)).toBe(true);
    expect(m.deltaPrix).toBe(50);
  });
});

describe("formaterDuree", () => {
  it("secondes sous la minute", () => {
    expect(formaterDuree(0)).toBe("0s");
    expect(formaterDuree(45_000)).toBe("45s");
    expect(formaterDuree(59_400)).toBe("59s");
  });

  it("minutes (sans reste de secondes)", () => {
    expect(formaterDuree(60_000)).toBe("1m");
    expect(formaterDuree(45 * 60_000)).toBe("45m");
  });

  it("heures avec minutes restantes (omises si nulles)", () => {
    expect(formaterDuree(2 * 3_600_000)).toBe("2h");
    expect(formaterDuree(2 * 3_600_000 + 15 * 60_000)).toBe("2h 15m");
  });

  it("jours avec heures restantes (omises si nulles)", () => {
    expect(formaterDuree(3 * 86_400_000)).toBe("3j");
    expect(formaterDuree(3 * 86_400_000 + 4 * 3_600_000)).toBe("3j 4h");
  });

  it("entrée non finie ou négative → tiret", () => {
    expect(formaterDuree(Number.NaN)).toBe("—");
    expect(formaterDuree(-1)).toBe("—");
  });
});
