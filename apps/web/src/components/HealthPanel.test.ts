/**
 * Tests des fonctions PURES du panneau « Santé sources » (HealthPanel).
 * Le rendu React n'est pas testé (pas d'environnement DOM/testing-library dans ce
 * projet) : on couvre le formatage local et la logique de dégradation, seuls porteurs
 * de régressions silencieuses (quota faux, badge d'alerte manqué). L'âge relatif est
 * désormais partagé et testé dans lib/format.test.ts.
 */
import { describe, it, expect } from "vitest";
import { dotClass, sourceLabel, formatQuota, degradedLevel, etatLabel, panelSignature } from "./HealthPanel";
import type { SanteSource } from "../store/health";

/** Fabrique une SanteSource minimale pour les tests de degradedLevel. */
function src(source: string, etat: SanteSource["etat"]): SanteSource {
  return { source, etat, dernierMessageTs: 0 };
}

describe("dotClass", () => {
  it("mappe chaque état sur un token de thème (jamais de hex en dur)", () => {
    expect(dotClass("connected")).toBe("bg-up"); // vert
    expect(dotClass("stale")).toBe("bg-warn"); // avertissement (thémé --ui-amber)
    expect(dotClass("reconnecting")).toBe("bg-warn");
    expect(dotClass("error")).toBe("bg-down"); // rouge
    expect(dotClass("polling")).toBe("bg-text-dim"); // bleu-gris
    expect(dotClass("closed")).toBe("bg-neutral-600"); // gris éteint (rampe --n-*)
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

  it("fenêtre principale + composante crédits (CryptoQuant BASIC), sans jour", () => {
    expect(
      formatQuota({
        utilise: 3,
        limite: 10,
        fenetre: "1min",
        credits: { utilise: 195, limite: 10000, jours: 31 },
      })
    ).toBe("3/10 min · ≈195/10000 crédits 31 j");
  });

  it("fenêtre principale + jour + crédits (tous les segments cumulés)", () => {
    expect(
      formatQuota({
        utilise: 3,
        limite: 8,
        fenetre: "1min",
        jour: { utilise: 142, limite: 800 },
        credits: { utilise: 195, limite: 10000, jours: 31 },
      })
    ).toBe("3/8 min · 142/800 j · ≈195/10000 crédits 31 j");
  });
});

describe("panelSignature (régression : le compteur de crédits doit déclencher un re-rendu)", () => {
  it("change quand seul `credits.utilise` change, sans que `utilise/limite/jour` bougent", () => {
    // Reproduit exactement `publierQuota()` (cryptoquant.ts) : à chaque créneau ET à chaque 200,
    // avec `utilise` (fenêtre minute) identique entre les deux publications (la fenêtre n'a pas
    // encore expiré). Si la signature ignore `credits`, le panneau ne se redessine pas au 200 et
    // le segment DATA reste affiché jusqu'à 60 s en retard (prochaine expiration de fenêtre).
    const avant: SanteSource = {
      source: "cryptoquant",
      etat: "polling",
      dernierMessageTs: 0,
      quota: { utilise: 1, limite: 10, fenetre: "1min", credits: { utilise: 195, limite: 10000, jours: 31 } },
    };
    const apres: SanteSource = {
      ...avant,
      quota: { ...avant.quota!, credits: { utilise: 210, limite: 10000, jours: 31 } },
    };
    expect(panelSignature({ cryptoquant: avant })).not.toBe(panelSignature({ cryptoquant: apres }));
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

describe("etatLabel (panneau détail A0.5)", () => {
  it("libellés FR pour chaque état", () => {
    expect(etatLabel("connected")).toMatch(/connect/i);
    expect(etatLabel("stale")).toMatch(/stale/i);
    expect(etatLabel("reconnecting")).toMatch(/reconnex/i);
    expect(etatLabel("error")).toMatch(/erreur/i);
    expect(etatLabel("polling")).toMatch(/poll/i);
    expect(etatLabel("closed")).toMatch(/ferm/i);
  });
});

