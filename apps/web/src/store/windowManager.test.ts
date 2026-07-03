import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  cascadePosition,
  clampPosition,
  clampSize,
  detectSnapZone,
  snapGeometry,
  windowManagerStore,
  mirrorOpenState,
  WINDOW_REGISTRY,
  GROUP_PALETTE,
  type EtatFenetre,
  type WorkspaceRect,
} from "./windowManager";

beforeEach(() => {
  windowManagerStore.setState({
    windows: {},
    nextZ: 1,
    groupSymbols: {},
    dragPreview: null,
    workspace: { x: 0, y: 0, width: 1920, height: 1080 },
  });
});

describe("cascadePosition", () => {
  const workspace: WorkspaceRect = { x: 0, y: 0, width: 1920, height: 1080 };

  it("place la 1ère fenêtre proche du coin haut-gauche du workspace (marge 48px)", () => {
    expect(cascadePosition(0, workspace, 480, 640)).toEqual({ x: 48, y: 48 });
  });

  it("décale chaque fenêtre suivante de 28px en diagonale", () => {
    expect(cascadePosition(1, workspace, 480, 640)).toEqual({ x: 76, y: 76 });
    expect(cascadePosition(2, workspace, 480, 640)).toEqual({ x: 104, y: 104 });
  });

  it("ne dépasse jamais le workspace moins la fenêtre et la marge", () => {
    const etroit: WorkspaceRect = { x: 0, y: 0, width: 600, height: 400 };
    const { x, y } = cascadePosition(50, etroit, 480, 300);
    expect(x).toBeLessThanOrEqual(600 - 480 - 48);
    expect(y).toBeLessThanOrEqual(400 - 300 - 48);
  });

  it("ancre la cascade à l'origine du workspace (x/y non nuls)", () => {
    const decale: WorkspaceRect = { x: 200, y: 100, width: 1920, height: 1080 };
    expect(cascadePosition(0, decale, 480, 640)).toEqual({ x: 248, y: 148 });
  });
});

describe("clampPosition", () => {
  const workspace: WorkspaceRect = { x: 0, y: 0, width: 1920, height: 1080 };

  it("laisse une position déjà dans le workspace inchangée", () => {
    expect(clampPosition(100, 100, 480, 640, workspace)).toEqual({ x: 100, y: 100 });
  });

  it("confinement strict : ramène le bord gauche à l'intérieur du workspace", () => {
    expect(clampPosition(-1000, 100, 480, 640, workspace).x).toBe(0);
  });

  it("confinement strict : ramène le bord droit à l'intérieur du workspace", () => {
    // width=480 -> maxX = 1920 - 480 = 1440
    expect(clampPosition(5000, 100, 480, 640, workspace).x).toBe(1440);
  });

  it("confinement strict sur l'axe Y : bord haut et bord bas", () => {
    expect(clampPosition(100, -500, 480, 640, workspace).y).toBe(0);
    // height=640 -> maxY = 1080 - 640 = 440
    expect(clampPosition(100, 5000, 480, 640, workspace).y).toBe(440);
  });

  it("respecte une origine de workspace non nulle (x/y > 0)", () => {
    const decale: WorkspaceRect = { x: 200, y: 100, width: 800, height: 600 };
    expect(clampPosition(0, 0, 300, 200, decale)).toEqual({ x: 200, y: 100 });
    // maxX = 200+800-300=700 ; maxY = 100+600-200=500
    expect(clampPosition(9999, 9999, 300, 200, decale)).toEqual({ x: 700, y: 500 });
  });
});

describe("clampSize", () => {
  const workspace: WorkspaceRect = { x: 0, y: 0, width: 1920, height: 1080 };

  it("laisse une taille déjà dans les bornes inchangée", () => {
    expect(clampSize(480, 640, 320, 240, workspace)).toEqual({ width: 480, height: 640 });
  });

  it("remonte sous le minimum", () => {
    expect(clampSize(100, 100, 320, 240, workspace)).toEqual({ width: 320, height: 240 });
  });

  it("plafonne à la largeur/hauteur du workspace (pas du viewport)", () => {
    const etroit: WorkspaceRect = { x: 0, y: 0, width: 500, height: 300 };
    expect(clampSize(2000, 2000, 320, 240, etroit)).toEqual({ width: 500, height: 300 });
  });
});

describe("detectSnapZone", () => {
  const workspace: WorkspaceRect = { x: 0, y: 0, width: 1920, height: 1080 };

  it("détecte le bord gauche du workspace (cursorX < workspace.x + 8)", () => {
    expect(detectSnapZone(4, 500, workspace)).toBe("left");
  });

  it("détecte le bord droit du workspace (cursorX > workspace.x + workspace.width - 8)", () => {
    expect(detectSnapZone(1917, 500, workspace)).toBe("right");
  });

  it("détecte le bord haut du workspace (cursorY < workspace.y + 8), prioritaire sur gauche/droite", () => {
    expect(detectSnapZone(4, 4, workspace)).toBe("top");
  });

  it("retourne null hors des zones de bord", () => {
    expect(detectSnapZone(960, 500, workspace)).toBeNull();
  });

  it("un curseur hors du workspace (au-delà du bord) compte quand même dans la zone (ex. survole la barre de dessin à gauche)", () => {
    const decale: WorkspaceRect = { x: 200, y: 100, width: 800, height: 600 };
    expect(detectSnapZone(50, 500, decale)).toBe("left"); // bien avant workspace.x=200, toujours "left"
    expect(detectSnapZone(500, 500, decale)).toBeNull(); // au milieu du workspace
  });
});

describe("snapGeometry", () => {
  const workspace: WorkspaceRect = { x: 0, y: 0, width: 1920, height: 1080 };

  it('"left" -> moitié gauche du workspace, pleine hauteur', () => {
    expect(snapGeometry("left", workspace)).toEqual({ x: 0, y: 0, width: 960, height: 1080 });
  });

  it('"right" -> moitié droite du workspace, pleine hauteur', () => {
    expect(snapGeometry("right", workspace)).toEqual({ x: 960, y: 0, width: 960, height: 1080 });
  });

  it('"top" -> workspace entier (pas le viewport)', () => {
    expect(snapGeometry("top", workspace)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it("respecte l'origine d'un workspace décalé", () => {
    const decale: WorkspaceRect = { x: 200, y: 100, width: 800, height: 600 };
    expect(snapGeometry("left", decale)).toEqual({ x: 200, y: 100, width: 400, height: 600 });
    expect(snapGeometry("right", decale)).toEqual({ x: 600, y: 100, width: 400, height: 600 });
  });
});

describe("WINDOW_REGISTRY", () => {
  it("contient exactement les 16 fenêtres attendues, sans doublon d'id ni de mnémonique", () => {
    expect(WINDOW_REGISTRY).toHaveLength(16);
    const ids = WINDOW_REGISTRY.map((w) => w.id);
    const mnemos = WINDOW_REGISTRY.map((w) => w.mnemonic);
    expect(new Set(ids).size).toBe(16);
    expect(new Set(mnemos).size).toBe(16);
    expect(ids).toContain("macroRates");
    expect(mnemos).toContain("RATE");
    expect(ids).toContain("cot");
    expect(mnemos).toContain("COT");
  });
});

describe("GROUP_PALETTE", () => {
  it("réutilise la palette de comparaison existante (cohérence visuelle)", () => {
    expect(GROUP_PALETTE.length).toBeGreaterThanOrEqual(4);
  });
});

// Couleur de groupe utilisée dans les tests ci-dessous. Assertion non-null : la
// palette a au moins 4 couleurs (garanti par le describe "GROUP_PALETTE" ci-dessus),
// même convention que `bougies[0]!` dans data/replayFeed.test.ts (noUncheckedIndexedAccess).
const GROUP_COLOR = GROUP_PALETTE[0]!;

describe("openWindow — fenêtre jamais ouverte", () => {
  it("crée l'entrée avec la taille par défaut du registre et la position en cascade", () => {
    windowManagerStore.getState().openWindow("derivatives");
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.open).toBe(true);
    expect(w.minimized).toBe(false);
    expect(w.groupColor).toBeNull();
    // defaultWidth/defaultHeight de "derivatives" dans WINDOW_REGISTRY : 420x640.
    expect(w.width).toBe(420);
    expect(w.height).toBe(640);
    // 1ère fenêtre ouverte (openCount=0) -> cascade au coin haut-gauche (marge 48px).
    expect(w.x).toBe(48);
    expect(w.y).toBe(48);
    expect(typeof w.z).toBe("number");
  });
});

describe("openWindow — réouverture d'une fenêtre déjà fermée", () => {
  it("préserve la géométrie précédente au lieu de recalculer la cascade", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 900, 500);
    windowManagerStore.getState().resizeWindow("derivatives", 600, 700);
    windowManagerStore.getState().setGroup("derivatives", GROUP_COLOR);
    windowManagerStore.getState().closeWindow("derivatives");

    windowManagerStore.getState().openWindow("derivatives");
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.open).toBe(true);
    expect(w.minimized).toBe(false);
    expect(w.x).toBe(900);
    expect(w.y).toBe(500);
    expect(w.width).toBe(600);
    expect(w.height).toBe(700);
    expect(w.groupColor).toBe(GROUP_COLOR);
  });
});

describe("z-order — openWindow / focusWindow", () => {
  it("bump z à une valeur strictement croissante à chaque ouverture puis à chaque focus", () => {
    windowManagerStore.getState().openWindow("derivatives");
    const z1 = windowManagerStore.getState().windows.derivatives!.z;

    windowManagerStore.getState().openWindow("eco");
    const z2 = windowManagerStore.getState().windows.eco!.z;
    expect(z2).toBeGreaterThan(z1);

    windowManagerStore.getState().focusWindow("derivatives");
    const z1Focused = windowManagerStore.getState().windows.derivatives!.z;
    expect(z1Focused).toBeGreaterThan(z2);
  });

  it("focusWindow est un no-op sur un id inconnu", () => {
    expect(() => windowManagerStore.getState().focusWindow("inconnu")).not.toThrow();
    expect(windowManagerStore.getState().windows.inconnu).toBeUndefined();
  });
});

describe("closeWindow", () => {
  it("passe open à false sans supprimer l'entrée ni modifier la géométrie", () => {
    windowManagerStore.getState().openWindow("derivatives");
    const before = windowManagerStore.getState().windows.derivatives!;

    windowManagerStore.getState().closeWindow("derivatives");
    const after = windowManagerStore.getState().windows.derivatives!;
    expect(after.open).toBe(false);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
  });

  it("est un no-op sur un id jamais ouvert (ne crée pas d'entrée)", () => {
    expect(() => windowManagerStore.getState().closeWindow("inconnu")).not.toThrow();
    expect(windowManagerStore.getState().windows.inconnu).toBeUndefined();
  });
});

describe("toggleWindow", () => {
  it("ouvre une fenêtre fermée ou jamais ouverte", () => {
    windowManagerStore.getState().toggleWindow("derivatives");
    expect(windowManagerStore.getState().windows.derivatives!.open).toBe(true);
  });

  it("ferme une fenêtre ouverte", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().toggleWindow("derivatives");
    expect(windowManagerStore.getState().windows.derivatives!.open).toBe(false);
  });
});

describe("moveWindow / resizeWindow", () => {
  it("moveWindow met à jour x/y d'une fenêtre existante", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 123, 456);
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.x).toBe(123);
    expect(w.y).toBe(456);
  });

  it("resizeWindow met à jour width/height d'une fenêtre existante", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().resizeWindow("derivatives", 500, 550);
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.width).toBe(500);
    expect(w.height).toBe(550);
  });

  it("sont des no-op sur un id inconnu (ne créent pas d'entrée)", () => {
    expect(() => windowManagerStore.getState().moveWindow("inconnu", 1, 2)).not.toThrow();
    expect(() => windowManagerStore.getState().resizeWindow("inconnu", 1, 2)).not.toThrow();
    expect(windowManagerStore.getState().windows.inconnu).toBeUndefined();
  });
});

describe("minimizeWindow / restoreWindow", () => {
  it("minimizeWindow passe minimized à true sans changer z", () => {
    windowManagerStore.getState().openWindow("derivatives");
    const zBefore = windowManagerStore.getState().windows.derivatives!.z;

    windowManagerStore.getState().minimizeWindow("derivatives");
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.minimized).toBe(true);
    expect(w.z).toBe(zBefore);
  });

  it("restoreWindow passe minimized à false ET bump z", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().minimizeWindow("derivatives");
    const zBeforeRestore = windowManagerStore.getState().windows.derivatives!.z;

    windowManagerStore.getState().restoreWindow("derivatives");
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.minimized).toBe(false);
    expect(w.z).toBeGreaterThan(zBeforeRestore);
  });

  it("sont des no-op sur un id inconnu", () => {
    expect(() => windowManagerStore.getState().minimizeWindow("inconnu")).not.toThrow();
    expect(() => windowManagerStore.getState().restoreWindow("inconnu")).not.toThrow();
    expect(windowManagerStore.getState().windows.inconnu).toBeUndefined();
  });
});

describe("setGroup", () => {
  it("assigne une couleur de groupe à une fenêtre existante, puis la retire (null)", () => {
    windowManagerStore.getState().openWindow("derivatives");

    windowManagerStore.getState().setGroup("derivatives", GROUP_COLOR);
    expect(windowManagerStore.getState().windows.derivatives!.groupColor).toBe(GROUP_COLOR);

    windowManagerStore.getState().setGroup("derivatives", null);
    expect(windowManagerStore.getState().windows.derivatives!.groupColor).toBeNull();
  });

  it("est un no-op sur un id inconnu", () => {
    expect(() => windowManagerStore.getState().setGroup("inconnu", GROUP_COLOR)).not.toThrow();
    expect(windowManagerStore.getState().windows.inconnu).toBeUndefined();
  });
});

describe("setGroupSymbol", () => {
  it("met à jour le dernier symbole diffusé pour une couleur de groupe", () => {
    windowManagerStore.getState().setGroupSymbol(GROUP_COLOR, "BTCUSDT");
    expect(windowManagerStore.getState().groupSymbols[GROUP_COLOR]).toBe("BTCUSDT");

    windowManagerStore.getState().setGroupSymbol(GROUP_COLOR, "ETHUSDT");
    expect(windowManagerStore.getState().groupSymbols[GROUP_COLOR]).toBe("ETHUSDT");
  });
});

describe("setAll", () => {
  it("remplace intégralement le record windows (restauration workspace/persistance)", () => {
    windowManagerStore.getState().openWindow("derivatives");

    const nouveauxWindows: Record<string, EtatFenetre> = {
      eco: {
        id: "eco",
        open: true,
        x: 10,
        y: 20,
        width: 440,
        height: 640,
        z: 99,
        minimized: false,
        groupColor: null,
      },
    };
    windowManagerStore.getState().setAll(nouveauxWindows);

    expect(windowManagerStore.getState().windows).toEqual(nouveauxWindows);
    // Remplacement, pas fusion : l'ancienne entrée "derivatives" a disparu.
    expect(windowManagerStore.getState().windows.derivatives).toBeUndefined();
  });

  it("réconcilie nextZ pour qu'un focus/openWindow ultérieur dépasse le z le plus haut restauré", () => {
    const nouveauxWindows: Record<string, EtatFenetre> = {
      eco: {
        id: "eco",
        open: true,
        x: 10,
        y: 20,
        width: 440,
        height: 640,
        z: 500, // très supérieur au nextZ courant (1) — cas non atteignable aujourd'hui.
        minimized: false,
        groupColor: null,
      },
    };
    windowManagerStore.getState().setAll(nouveauxWindows);

    windowManagerStore.getState().focusWindow("eco");
    expect(windowManagerStore.getState().windows.eco!.z).toBeGreaterThan(500);
  });
});

describe("mirrorOpenState", () => {
  it("synchronise le champ open d'un store cible (*UiStore) dans les deux sens", () => {
    // Cible minimale mimant la forme d'un *UiStore (ex. derivativesUiStore) sans en
    // importer un réel — aucun *UiStore n'existe encore à ce stade du plan (13 tâches
    // restantes en dépendent).
    let open = false;
    const fakeUiStore = {
      getState: () => ({ open }),
      setState: (partial: { open: boolean }) => {
        open = partial.open;
      },
    };
    mirrorOpenState("mirror-test", fakeUiStore);

    windowManagerStore.getState().openWindow("mirror-test");
    expect(fakeUiStore.getState().open).toBe(true);

    windowManagerStore.getState().closeWindow("mirror-test");
    expect(fakeUiStore.getState().open).toBe(false);
  });
});

describe("reclampAll", () => {
  it("confinement strict : la fenêtre entière rentre dans le nouveau workspace (position ET taille)", () => {
    windowManagerStore.getState().openWindow("derivatives"); // defaultWidth 420, defaultHeight 640
    windowManagerStore.getState().moveWindow("derivatives", 1800, 100);
    const cible = { x: 0, y: 0, width: 500, height: 400 };
    windowManagerStore.getState().reclampAll(cible);
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.x).toBeGreaterThanOrEqual(cible.x);
    expect(w.y).toBeGreaterThanOrEqual(cible.y);
    expect(w.x + w.width).toBeLessThanOrEqual(cible.x + cible.width);
    expect(w.y + w.height).toBeLessThanOrEqual(cible.y + cible.height);
  });

  it("ne touche pas une fenêtre déjà dans les bornes", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 100, 100);
    const before = windowManagerStore.getState().windows.derivatives!;
    windowManagerStore.getState().reclampAll({ x: 0, y: 0, width: 1920, height: 1080 });
    const after = windowManagerStore.getState().windows.derivatives!;
    expect(after).toEqual(before);
  });

  it("ignore les fenêtres fermées (ne les recadre pas)", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 5000, 100);
    windowManagerStore.getState().closeWindow("derivatives");
    windowManagerStore.getState().reclampAll({ x: 0, y: 0, width: 800, height: 600 });
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.x).toBe(5000);
  });

  it("recale contre une origine de workspace non nulle", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 0, 0);
    windowManagerStore.getState().reclampAll({ x: 200, y: 100, width: 1000, height: 800 });
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.x).toBeGreaterThanOrEqual(200);
    expect(w.y).toBeGreaterThanOrEqual(100);
  });
});

describe("setWorkspace", () => {
  it("met à jour l'état workspace ET recale les fenêtres ouvertes", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 1800, 100);
    windowManagerStore.getState().setWorkspace({ x: 0, y: 0, width: 500, height: 400 });
    expect(windowManagerStore.getState().workspace).toEqual({ x: 0, y: 0, width: 500, height: 400 });
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.x + w.width).toBeLessThanOrEqual(500);
  });
});

describe("setDragPreview", () => {
  it("définit puis efface l'aperçu de snap", () => {
    windowManagerStore.getState().setDragPreview({ x: 0, y: 0, width: 960, height: 1080 });
    expect(windowManagerStore.getState().dragPreview).toEqual({ x: 0, y: 0, width: 960, height: 1080 });
    windowManagerStore.getState().setDragPreview(null);
    expect(windowManagerStore.getState().dragPreview).toBeNull();
  });
});
