import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WINDOW_REGISTRY, windowManagerStore } from "./windowManager";
import { navigationStore, navigateTool, parseDestination, routeDestination, RUBRIQUES, outilsRubrique, startNavigation, setPresentationMode } from "./navigation";

let stop = () => {};
beforeEach(() => {
  windowManagerStore.setState({ windows: {}, nextZ: 1, workspace: { x: 0, y: 0, width: 500, height: 400 } });
  navigationStore.setState({ active: "chart", mode: "pages" });
  stop = startNavigation();
});
afterEach(() => { stop(); windowManagerStore.getState().preserverGeometrie(false); });

describe("navigation par rubriques", () => {
  it("classe exactement les 39 outils, dont DES, sans doublon", () => {
    const ids = RUBRIQUES.flatMap((r) => outilsRubrique(r.id).map((o) => o.id));
    expect(ids).toHaveLength(39);
    expect(new Set(ids).size).toBe(39);
    expect([...ids].sort()).toEqual(WINDOW_REGISTRY.map((w) => w.id).sort());
  });
  it("valide les routes et conserve le point d'entrée spike", () => {
    expect(parseDestination("#/options/options")).toBe("options");
    expect(parseDestination("#/marches/chart")).toBe("chart");
    expect(parseDestination("#/macro/options")).toBeNull();
    expect(parseDestination("#spike")).toBeNull();
    expect(parseDestination("#/options/%")).toBeNull();
    expect(routeDestination("notes")).toBe("#/portefeuille/notes");
  });
  it("Graphique conserve l'outil ouvert et la sélection est idempotente", async () => {
    navigateTool("notes");
    const note = windowManagerStore.getState().windows.notes;
    navigateTool("notes");
    expect(windowManagerStore.getState().windows.notes).toBe(note);
    navigateTool("chart");
    await Promise.resolve();
    expect(navigationStore.getState().active).toBe("chart");
    expect(windowManagerStore.getState().windows.notes?.minimized).toBe(false);
    expect(windowManagerStore.getState().windows.notes?.open).toBe(true);
  });
  it("les ouvertures externes révèlent la destination même déjà au premier plan", async () => {
    navigateTool("notes");
    navigateTool("chart");
    windowManagerStore.getState().openWindow("notes");
    await Promise.resolve();
    expect(navigationStore.getState().active).toBe("notes");
  });
  it("une restauration qui ferme la page active rejoint l'outil restauré", async () => {
    navigateTool("notes");
    windowManagerStore.getState().openWindow("eco");
    const eco = windowManagerStore.getState().windows.eco!;
    await Promise.resolve();
    navigateTool("notes");
    windowManagerStore.getState().setAll({ eco });
    await Promise.resolve();
    expect(navigationStore.getState().active).toBe("eco");
    windowManagerStore.getState().setAll({});
    await Promise.resolve();
    expect(navigationStore.getState().active).toBe("chart");
  });
  it("les pages protègent la géométrie dans les commandes, snapshots et restaurations", () => {
    const wm = windowManagerStore.getState();
    wm.openWindow("notes");
    const geometry = { x: 1200, y: 700, width: 880, height: 720, preSnapGeometry: { x: 99, y: 88, width: 777, height: 666 } };
    windowManagerStore.setState({ windows: { notes: { ...windowManagerStore.getState().windows.notes!, ...geometry } } });
    wm.openWindow("notes");
    wm.setWorkspace({ x: 0, y: 0, width: 320, height: 300 });
    wm.reclampAll({ x: 0, y: 0, width: 320, height: 300 });

    expect(windowManagerStore.getState().windows.notes).toMatchObject(geometry);
    wm.setAll({ notes: { ...windowManagerStore.getState().windows.notes!, ...geometry, x: 1300 } });
    expect(windowManagerStore.getState().windows.notes?.x).toBe(1300);
    setPresentationMode("windows");
    expect(windowManagerStore.getState().windows.notes).toMatchObject({ ...geometry, x: 1300 });
  });
});
