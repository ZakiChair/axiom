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
} from "./windowManager";

beforeEach(() => {
  windowManagerStore.setState({ windows: {}, nextZ: 1, groupSymbols: {} });
});

beforeEach(() => {
  // openWindow lit window.innerWidth/innerHeight pour positionner la cascade initiale.
  // Ce paquet tourne ses tests en environnement vitest "node" (pas de jsdom, cf.
  // vite.config.ts — aucune option `test.environment`) → `window` est undefined sans
  // stub. Même pattern que vi.stubGlobal("fetch", …) dans data/twelvedata.test.ts.
  vi.stubGlobal("window", { innerWidth: 1920, innerHeight: 1080 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cascadePosition", () => {
  it("place la 1ère fenêtre proche du coin haut-gauche (marge 48px)", () => {
    expect(cascadePosition(0, 1920, 1080, 480, 640)).toEqual({ x: 48, y: 48 });
  });

  it("décale chaque fenêtre suivante de 28px en diagonale", () => {
    expect(cascadePosition(1, 1920, 1080, 480, 640)).toEqual({ x: 76, y: 76 });
    expect(cascadePosition(2, 1920, 1080, 480, 640)).toEqual({ x: 104, y: 104 });
  });

  it("ne dépasse jamais le viewport moins la fenêtre et la marge", () => {
    // Viewport étroit : la position brute (index=10 -> 48+10*28=328) dépasserait
    // 1200 - 480 - 48 = 672 ? non ; on force un cas qui dépasse réellement.
    const { x, y } = cascadePosition(50, 600, 400, 480, 300);
    expect(x).toBeLessThanOrEqual(600 - 480 - 48);
    expect(y).toBeLessThanOrEqual(400 - 300 - 48);
  });
});

describe("clampPosition", () => {
  it("laisse une position déjà dans l'écran inchangée", () => {
    expect(clampPosition(100, 100, 480, 1920, 1080)).toEqual({ x: 100, y: 100 });
  });

  it("empêche l'en-tête de sortir par la gauche au-delà de -width+40px visibles", () => {
    // width=480, VISIBLE_MARGIN=40 -> minX = 40 - 480 = -440
    expect(clampPosition(-1000, 100, 480, 1920, 1080).x).toBe(-440);
  });

  it("empêche l'en-tête de sortir par la droite (garde 40px visibles)", () => {
    // maxX = viewportWidth - 40 = 1880
    expect(clampPosition(5000, 100, 480, 1920, 1080).x).toBe(1880);
  });

  it("empêche l'en-tête de sortir en haut (y >= 0)", () => {
    expect(clampPosition(100, -500, 480, 1920, 1080).y).toBe(0);
  });

  it("empêche l'en-tête de sortir en bas (garde 40px visibles)", () => {
    expect(clampPosition(100, 5000, 480, 1920, 1080).y).toBe(1080 - 40);
  });
});

describe("clampSize", () => {
  it("respecte les minimums", () => {
    expect(clampSize(100, 50, 320, 240, 1920, 1080)).toEqual({ width: 320, height: 240 });
  });

  it("ne dépasse pas le viewport", () => {
    expect(clampSize(5000, 5000, 320, 240, 1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it("laisse une taille valide inchangée", () => {
    expect(clampSize(600, 500, 320, 240, 1920, 1080)).toEqual({ width: 600, height: 500 });
  });
});

describe("detectSnapZone", () => {
  it("détecte le bord gauche (cursorX < 8)", () => {
    expect(detectSnapZone(4, 500, 1920, 1080)).toBe("left");
  });

  it("détecte le bord droit (cursorX > viewportWidth - 8)", () => {
    expect(detectSnapZone(1917, 500, 1920, 1080)).toBe("right");
  });

  it("détecte le bord haut (cursorY < 8), prioritaire sur gauche/droite", () => {
    expect(detectSnapZone(4, 4, 1920, 1080)).toBe("top");
  });

  it("retourne null hors des zones de bord", () => {
    expect(detectSnapZone(960, 500, 1920, 1080)).toBeNull();
  });
});

describe("snapGeometry", () => {
  it('"left" -> moitié gauche pleine hauteur', () => {
    expect(snapGeometry("left", 1920, 1080)).toEqual({ x: 0, y: 0, width: 960, height: 1080 });
  });

  it('"right" -> moitié droite pleine hauteur', () => {
    expect(snapGeometry("right", 1920, 1080)).toEqual({ x: 960, y: 0, width: 960, height: 1080 });
  });

  it('"top" -> plein viewport', () => {
    expect(snapGeometry("top", 1920, 1080)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});

describe("WINDOW_REGISTRY", () => {
  it("contient exactement les 14 fenêtres attendues, sans doublon d'id ni de mnémonique", () => {
    expect(WINDOW_REGISTRY).toHaveLength(14);
    const ids = WINDOW_REGISTRY.map((w) => w.id);
    const mnemos = WINDOW_REGISTRY.map((w) => w.mnemonic);
    expect(new Set(ids).size).toBe(14);
    expect(new Set(mnemos).size).toBe(14);
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
  it("recale une fenêtre devenue hors-écran après rétrécissement du viewport", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 1800, 100);
    windowManagerStore.getState().reclampAll(1000, 800);
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.x).toBeLessThanOrEqual(1000 - 40);
  });

  it("ne touche pas une fenêtre déjà dans les bornes", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 100, 100);
    const before = windowManagerStore.getState().windows.derivatives!;
    windowManagerStore.getState().reclampAll(1920, 1080);
    const after = windowManagerStore.getState().windows.derivatives!;
    expect(after).toEqual(before);
  });

  it("ignore les fenêtres fermées (ne les recadre pas)", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 5000, 100);
    windowManagerStore.getState().closeWindow("derivatives");
    windowManagerStore.getState().reclampAll(800, 600);
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.x).toBe(5000);
  });

  it("clampe la position avec la largeur POST-clamp quand le viewport rétrécit aussi la largeur", () => {
    // Régression : clampPosition et clampSize étaient appelés indépendamment, chacun
    // avec w.width (l'ancienne largeur). Si un resize rétrécit à la fois le viewport
    // ET la largeur de la fenêtre, clampPosition calculait minX avec la largeur PÉRIMÉE
    // (plus grande), laissant la fenêtre entièrement hors-écran après le recalage.
    windowManagerStore.getState().openWindow("derivatives"); // width par défaut = 420
    // x=-380 est une position de bordure valide pour width=420 : bord droit exactement
    // à la marge visible de 40px (-380 + 420 = 40).
    windowManagerStore.getState().moveWindow("derivatives", -380, 100);
    windowManagerStore.getState().reclampAll(200, 800);
    const w = windowManagerStore.getState().windows.derivatives!;
    // La largeur finale (200, clampée) doit être utilisée pour clamper x, pas 420.
    expect(w.width).toBe(200);
    expect(w.x + w.width).toBeGreaterThanOrEqual(40);
  });
});
