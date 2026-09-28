import { describe, expect, it } from "vitest";
import { fenetreMobileActive } from "./FloatingWindow";
import { windowManagerStore } from "../store/windowManager";

describe("sélection d'une fenêtre mobile", () => {
  it("suit focus, réduction et fermeture sans changer les géométries desktop", () => {
    const original = windowManagerStore.getState();
    try {
      original.setAll({});
      original.openWindow("news");
      original.openWindow("notes");
      const geometres = () => Object.fromEntries(Object.entries(windowManagerStore.getState().windows)
        .map(([id, w]) => [id, { x: w.x, y: w.y, width: w.width, height: w.height, preSnapGeometry: w.preSnapGeometry }]));
      const avant = geometres();
      expect(fenetreMobileActive(windowManagerStore.getState().windows)).toBe("notes");
      original.focusWindow("news");
      expect(fenetreMobileActive(windowManagerStore.getState().windows)).toBe("news");
      original.minimizeWindow("news");
      expect(fenetreMobileActive(windowManagerStore.getState().windows)).toBe("notes");
      original.closeWindow("notes");
      expect(fenetreMobileActive(windowManagerStore.getState().windows)).toBeNull();
      expect(geometres()).toEqual(avant);
    } finally {
      windowManagerStore.setState(original, true);
    }
  });

  it("ne montre qu'une fenêtre lorsque des z historiques sont égaux", () => {
    const original = windowManagerStore.getState();
    try {
      original.setAll({});
      original.openWindow("news");
      original.openWindow("notes");
      const windows = windowManagerStore.getState().windows;
      const news = windows["news"]!;
      const notes = windows["notes"]!;
      expect(fenetreMobileActive({ news: { ...news, z: 12 }, notes: { ...notes, z: 12 } })).toBe("news");
    } finally {
      windowManagerStore.setState(original, true);
    }
  });
});
