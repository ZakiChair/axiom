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

describe("orderflowStore — seuil notionnel baleine (WHALE)", () => {
  it("vaut 100 000 $ par défaut", () => {
    expect(orderflowStore.getState().whaleNotionalMin).toBe(100_000);
  });

  it("setWhaleNotionalMin met à jour la valeur", () => {
    orderflowStore.getState().setWhaleNotionalMin(250_000);
    expect(orderflowStore.getState().whaleNotionalMin).toBe(250_000);
    orderflowStore.getState().setWhaleNotionalMin(100_000);
    expect(orderflowStore.getState().whaleNotionalMin).toBe(100_000);
  });
});
