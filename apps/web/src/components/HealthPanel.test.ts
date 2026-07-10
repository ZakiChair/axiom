/**
 * Tests des fonctions PURES du panneau « Santé sources » (HealthPanel).
 * Le rendu React n'est pas testé (pas d'environnement DOM/testing-library dans ce
 * projet) : on couvre le formatage local et la logique de dégradation, seuls porteurs
 * de régressions silencieuses (quota faux, badge d'alerte manqué). L'âge relatif est
 * désormais partagé et testé dans lib/format.test.ts.
 */
import { describe, it, expect } from "vitest";
import { dotClass, sourceLabel, formatQuota, degradedLevel } from "./HealthPanel";
import type { SanteSource } from "../store/health";

/** Fabrique une SanteSource minimale pour les tests de degradedLevel. */
function src(source: string, etat: SanteSource["etat"]): SanteSource {
  return { source, etat, dernierMessageTs: 0 };
}

describe("dotClass", () => {
  it("mappe chaque état sur un token de thème (jamais de hex en dur)", () => {
    expect(dotClass("connected")).toBe("bg-up"); // vert
    expect(dotClass("stale")).toBe("bg-amber-500"); // orange
    expect(dotClass("reconnecting")).toBe("bg-amber-500"); // orange
    expect(dotClass("error")).toBe("bg-down"); // rouge
    expect(dotClass("polling")).toBe("bg-text-dim"); // bleu-gris
    expect(dotClass("closed")).toBe("bg-neutral-600"); // gris éteint
  });
});

describe("sourceLabel", () => {
  it("nomme la base et suffixe le canal", () => {
    expect(sourceLabel("binance")).toBe("Binance");
    expect(sourceLabel("binance:trades")).toBe("Binance · trades");
    expect(sourceLabel("twelvedata:quotes")).toBe("Twelve Data · quotes");
    expect(sourceLabel("coinalyze")).toBe("Coinalyze");
  });

  it("retombe sur la base brute pour une source inconnue", () => {
    expect(sourceLabel("okx")).toBe("okx");
  });
});

describe("formatQuota", () => {
  it("fenêtre principale seule (Coinalyze)", () => {
    expect(formatQuota({ utilise: 5, limite: 40, fenetre: "1min" })).toBe("5/40 min");
  });

  it("fenêtre principale + composante journalière (Twelve Data)", () => {
    expect(
      formatQuota({ utilise: 3, limite: 8, fenetre: "1min", jour: { utilise: 142, limite: 800 } })
    ).toBe("3/8 min · 142/800 j");
  });
});

describe("degradedLevel", () => {
  it("null quand tout va bien (connected/polling/closed)", () => {
    expect(degradedLevel({})).toBeNull();
    expect(
      degradedLevel({ a: src("a", "connected"), b: src("b", "polling"), c: src("c", "closed") })
    ).toBeNull();
  });

  it("« warn » quand une source est stale/reconnecting (sans erreur)", () => {
    expect(degradedLevel({ a: src("a", "connected"), b: src("b", "reconnecting") })).toBe("warn");
  });

  it("« error » prime sur « warn »", () => {
    expect(degradedLevel({ a: src("a", "reconnecting"), b: src("b", "error") })).toBe("error");
  });
});
