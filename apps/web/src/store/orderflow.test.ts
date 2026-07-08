import { beforeEach, describe, expect, it } from "vitest";
import { orderflowStore } from "./orderflow";

/**
 * Le store orderflow est session-only (cf. commentaire du module) : on remet donc
 * l'état à false avant chaque test pour l'isolation.
 */
describe("orderflowStore — toggle cvdSpotPerp (Task 17)", () => {
  beforeEach(() => {
    orderflowStore.getState().setCvdSpotPerp(false);
  });

  it("vaut false par défaut", () => {
    expect(orderflowStore.getState().cvdSpotPerp).toBe(false);
  });

  it("setCvdSpotPerp bascule la valeur", () => {
    orderflowStore.getState().setCvdSpotPerp(true);
    expect(orderflowStore.getState().cvdSpotPerp).toBe(true);
    orderflowStore.getState().setCvdSpotPerp(false);
    expect(orderflowStore.getState().cvdSpotPerp).toBe(false);
  });
});
