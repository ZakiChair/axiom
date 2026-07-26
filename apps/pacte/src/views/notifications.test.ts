import { describe, expect, it } from "vitest";

import { nextNotification } from "./notifications";

describe("nextNotification", () => {
  it("renouvelle l'identifiant lorsque deux annonces ont le même texte", () => {
    const first = nextNotification(null, "error", "Coffre indisponible.");
    const second = nextNotification(first, "error", "Coffre indisponible.");

    expect(first).toEqual({ id: 1, kind: "error", message: "Coffre indisponible." });
    expect(second).toEqual({ id: 2, kind: "error", message: "Coffre indisponible." });
  });
});
