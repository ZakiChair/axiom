import { describe, expect, it } from "vitest";
import { ivRank } from "./ivRank";

// Série uniforme de 30 points : 1, 2, ..., 30 (n=30, seuil minimal).
const serie30 = Array.from({ length: 30 }, (_, i) => i + 1);

describe("ivRank", () => {
  it("courant strictement supérieur à tous les points → 100 (borne haute)", () => {
    expect(ivRank(serie30, 999)).toBe(100);
  });

  it("courant strictement inférieur à tous les points → 0 (borne basse)", () => {
    expect(ivRank(serie30, -999)).toBe(0);
  });

  it("courant à la médiane d'une série uniforme → ~50", () => {
    // 1..30 : 14 points < 15 (1..14) ⇒ 100*14/30 ≈ 46.67 → arrondi 47.
    expect(ivRank(serie30, 15)).toBe(47);
    // Avec 15.5 (valeur non présente dans la série) : 15 points < 15.5 ⇒ 100*15/30 = 50.
    expect(ivRank(serie30, 15.5)).toBe(50);
  });

  it("doublons : les points ÉGAUX au courant ne comptent pas dans « strictement < »", () => {
    // 10 points valant tous 5 : courant = 5 ⇒ 0 point strictement < 5 ⇒ 0.
    const serieConstante = Array(30).fill(5);
    expect(ivRank(serieConstante, 5)).toBe(0);
  });

  it("exclut les points non finis (NaN/Infinity) de l'historique avant de calculer n", () => {
    // 30 points valides (1..30) + 4 NaN + 1 Infinity parasites : n reste 30 après exclusion.
    const avecNaN = [...serie30, NaN, NaN, NaN, NaN, Infinity];
    expect(ivRank(avecNaN, 999)).toBe(100);
    expect(ivRank(avecNaN, 15)).toBe(47);
  });

  it("n < 30 après exclusion des non-finis → null", () => {
    // 29 points valides seulement.
    const serie29 = serie30.slice(0, 29);
    expect(ivRank(serie29, 15)).toBeNull();
    // 30 points bruts mais un seul NaN ramène n à 29 après exclusion.
    const justeSousLeSeuil = [...serie30.slice(0, 29), NaN];
    expect(ivRank(justeSousLeSeuil, 15)).toBeNull();
  });

  it("courant non fini (NaN/Infinity) → null, même avec un historique valide", () => {
    expect(ivRank(serie30, NaN)).toBeNull();
    expect(ivRank(serie30, Infinity)).toBeNull();
    expect(ivRank(serie30, -Infinity)).toBeNull();
  });
});
