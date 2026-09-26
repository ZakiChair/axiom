import { describe, expect, it } from "vitest";
import { marketMapUiStore } from "./marketmap-ui";
import { windowManagerStore } from "./windowManager";

const ouverte = () => windowManagerStore.getState().windows.marketMap?.open === true;

describe("vue marché : onglet demandé par TOP, MAP rouvre sur la carte", () => {
  it("TOP ouvre la fenêtre sur le classement, sans la fermer si elle est déjà ouverte", () => {
    marketMapUiStore.getState().ouvrirClassement();
    expect(ouverte()).toBe(true);
    expect(marketMapUiStore.getState().onglet).toBe("classement");
    marketMapUiStore.getState().ouvrirClassement();
    expect(ouverte()).toBe(true);
  });

  it("MAP (bascule) ferme puis rouvre sur la carte, pas sur l'onglet laissé par TOP", () => {
    marketMapUiStore.getState().ouvrirClassement();
    marketMapUiStore.getState().toggleMarketMap();
    expect(ouverte()).toBe(false);
    marketMapUiStore.getState().toggleMarketMap();
    expect(ouverte()).toBe(true);
    expect(marketMapUiStore.getState().onglet).toBe("carte");
  });
});
