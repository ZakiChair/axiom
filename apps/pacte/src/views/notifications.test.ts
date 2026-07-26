import { describe, expect, it } from "vitest";

import {
  consumeNotification,
  deliverContextNotification,
  nextNotification,
  notificationForContext,
} from "./notifications";

describe("nextNotification", () => {
  it("renouvelle l'identifiant lorsque deux annonces ont le même texte", () => {
    const first = nextNotification(null, "error", "Coffre indisponible.");
    const second = nextNotification(first, "error", "Coffre indisponible.");

    expect(first).toEqual({ id: 1, kind: "error", message: "Coffre indisponible." });
    expect(second).toEqual({ id: 2, kind: "error", message: "Coffre indisponible." });
  });
});

describe("notifications contextualisées", () => {
  it("consomme l'annonce à la sélection et ignore le résultat async d'un ancien dossier", () => {
    let current = deliverContextNotification(null, "A", "A", "success", "Copie A terminée.");
    expect(notificationForContext(current, "A")?.message).toBe("Copie A terminée.");

    current = consumeNotification(current);
    current = deliverContextNotification(current, "B", "A", "success", "Résultat A tardif.");
    expect(current).toBeNull();

    current = deliverContextNotification(current, "B", "B", "success", "Copie B terminée.");
    expect(notificationForContext(current, "B")?.message).toBe("Copie B terminée.");

    current = deliverContextNotification(current, "B", "A", "success", "Résultat A après B.");
    expect(notificationForContext(current, "B")?.message).toBe("Copie B terminée.");

    current = consumeNotification(current);
    expect(notificationForContext(current, "A")).toBeNull();
  });
});
