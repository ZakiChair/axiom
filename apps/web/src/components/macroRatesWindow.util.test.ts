/**
 * Tests des fonctions PURES de la fenêtre RATE (macroRatesWindow.util).
 * Le rendu React n'est pas testé (pas d'environnement DOM/testing-library dans ce
 * projet) : on couvre `paysIndisponibles`, seule logique porteuse d'une régression
 * silencieuse — la dégradation VISIBLE de l'onglet Rendements quand un pays attendu
 * n'a aucune donnée (cas réel : RBA 403 Akamai, cf. sovereignYields.ts).
 */
import { describe, expect, it } from "vitest";
import { paysIndisponibles } from "./macroRatesWindow.util";
import type { RendementsSouverainsMulti } from "../data/macro/sovereignYields";
import type { CourbeRendements } from "../data/macro/treasuryYields";

/** Observation minimale valide (une seule maturité suffit à rendre un pays « présent »). */
const OBS: CourbeRendements[] = [{ date: "2026-07-10", rendements: { "10 Yr": 4.2 } }];

/** Fabrique une réponse multi-pays complète, surchargée par pays. */
function multi(partiel: Partial<RendementsSouverainsMulti>): RendementsSouverainsMulti {
  return {
    us: OBS,
    euro: { "10 Yr": 2.6 },
    jp: OBS,
    ca: OBS,
    au: OBS,
    ...partiel,
  };
}

describe("paysIndisponibles", () => {
  it("null (rien encore chargé) → [] : aucune note pendant le chargement", () => {
    expect(paysIndisponibles(null)).toEqual([]);
  });

  it("toutes les données présentes → [] : aucune note", () => {
    expect(paysIndisponibles(multi({}))).toEqual([]);
  });

  it("Australie seule vide → ['Australie'] (cas réel : RBA 403 Akamai)", () => {
    expect(paysIndisponibles(multi({ au: [] }))).toEqual(["Australie"]);
  });

  it("plusieurs pays vides → liste dans l'ordre d'affichage des colonnes", () => {
    expect(paysIndisponibles(multi({ euro: {}, ca: [], au: [] }))).toEqual([
      "Zone euro",
      "Canada",
      "Australie",
    ]);
  });

  it("tout vide → les 5 pays (le caller affiche alors l'état Vide global, pas la note)", () => {
    expect(paysIndisponibles(multi({ us: [], euro: {}, jp: [], ca: [], au: [] }))).toEqual([
      "US",
      "Zone euro",
      "Japon",
      "Canada",
      "Australie",
    ]);
  });
});
