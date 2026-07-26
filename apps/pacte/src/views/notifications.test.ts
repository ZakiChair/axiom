import { describe, expect, it } from "vitest";

import {
  advanceContextToken,
  consumeNotification,
  deliverContextNotification,
  nextNotification,
  notificationForContext,
} from "./notifications";
import type { ContextToken } from "./notifications";

describe("nextNotification", () => {
  it("renouvelle l'identifiant lorsque deux annonces ont le même texte", () => {
    const first = nextNotification(null, "error", "Coffre indisponible.");
    const second = nextNotification(first, "error", "Coffre indisponible.");

    expect(first).toEqual({ id: 1, kind: "error", message: "Coffre indisponible." });
    expect(second).toEqual({ id: 2, kind: "error", message: "Coffre indisponible." });
  });
});

describe("notifications contextualisées", () => {
  it("incrémente la génération à chaque sélection lors de A₀ → B₁ → A₂", () => {
    const tokenA0: ContextToken = { contextId: "A", generation: 0 };

    const tokenB1 = advanceContextToken(tokenA0, "B");
    const tokenA2 = advanceContextToken(tokenB1, "A");

    expect(tokenB1).toEqual({ contextId: "B", generation: 1 });
    expect(tokenA2).toEqual({ contextId: "A", generation: 2 });
  });

  it("consomme l'annonce à la sélection et ignore le résultat async d'un ancien dossier", () => {
    const tokenA0: ContextToken = { contextId: "A", generation: 0 };
    const tokenB1: ContextToken = { contextId: "B", generation: 1 };
    let current = deliverContextNotification(
      null,
      tokenA0,
      tokenA0,
      "success",
      "Copie A terminée.",
    );
    expect(notificationForContext(current, "A")?.message).toBe("Copie A terminée.");

    current = consumeNotification(current);
    current = deliverContextNotification(
      current,
      tokenB1,
      tokenA0,
      "success",
      "Résultat A tardif.",
    );
    expect(current).toBeNull();

    current = deliverContextNotification(
      current,
      tokenB1,
      tokenB1,
      "success",
      "Copie B terminée.",
    );
    expect(notificationForContext(current, "B")?.message).toBe("Copie B terminée.");

    current = deliverContextNotification(
      current,
      tokenB1,
      tokenA0,
      "success",
      "Résultat A après B.",
    );
    expect(notificationForContext(current, "B")?.message).toBe("Copie B terminée.");

    current = consumeNotification(current);
    expect(notificationForContext(current, "A")).toBeNull();
  });

  it("ignore A₀ revenu après A₀ → B₁ → A₂ et préserve l'annonce courante", () => {
    const tokenA0: ContextToken = { contextId: "A", generation: 0 };
    const tokenB1 = advanceContextToken(tokenA0, "B");
    const tokenA2 = advanceContextToken(tokenB1, "A");
    let current = deliverContextNotification(
      null,
      tokenA2,
      tokenA2,
      "success",
      "Annonce courante A₂.",
    );
    const currentA2 = current;

    current = deliverContextNotification(
      current,
      tokenA2,
      tokenA0,
      "success",
      "Résultat obsolète A₀.",
    );

    expect(current).toBe(currentA2);
    expect(notificationForContext(current, "A")?.message).toBe("Annonce courante A₂.");
  });
});
