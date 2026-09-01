/**
 * Test du mapping PUR « lecture nulle → statut » de la fenêtre WHALES. Le rendu React
 * n'est pas testé (pas de DOM ici) : on couvre la distinction daemon présent (erreur
 * douce) / daemon absent (consigne « pnpm run up ») — un pane qui ment sur la cause
 * viole le contrat « jamais de pane muet/malhonnête » (BUILD-CONTRACT).
 */
import { describe, expect, it } from "vitest";
import { statutLectureNulle } from "./WhalesWindow";

describe("statutLectureNulle", () => {
  it("daemon présent mais réponse nulle → « erreur » (pas la consigne de lancement, fausse)", () => {
    expect(statutLectureNulle(true)).toBe("erreur");
  });

  it("daemon absent → « sans-daemon » (consigne pnpm run up légitime)", () => {
    expect(statutLectureNulle(false)).toBe("sans-daemon");
  });
});
