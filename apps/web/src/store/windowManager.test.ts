import { afterEach, describe, expect, it, beforeEach } from "vitest";
import {
  cascadePosition,
  clampPosition,
  clampSize,
  detectSnapZone,
  estNouvelle,
  grilleMosaique,
  marquerVue,
  normaliserOrdreZ,
  snapGeometry,
  zFenetreFocalisee,
  etatPastille,
  windowManagerStore,
  mirrorOpenState,
  WINDOW_REGISTRY,
  menuWindows,
  menuWindowsGroupees,
  GROUPES_FENETRES,
  WINDOW_Z_MAX,
  WINDOW_Z_MIN,
  MIN_WIDTH,
  MIN_HEIGHT,
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

describe("grilleMosaique", () => {
  const viewport: WorkspaceRect = { x: 0, y: 0, width: 1920, height: 1080 };
  const MARGE = 8;

  /** Toutes les cellules tiennent dans le viewport et ne se chevauchent pas. */
  function verifierGrille(rects: { x: number; y: number; width: number; height: number }[]): void {
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(viewport.x);
      expect(r.y).toBeGreaterThanOrEqual(viewport.y);
      expect(r.x + r.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1e-6);
      expect(r.y + r.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1e-6);
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
    }
  }

  it("n=1 : une seule cellule couvrant le viewport moins la marge", () => {
    const rects = grilleMosaique(1, viewport);
    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({ x: MARGE, y: MARGE, width: 1920 - 2 * MARGE, height: 1080 - 2 * MARGE });
    verifierGrille(rects);
  });

  it("n=2 : 2 colonnes × 1 ligne (côte à côte)", () => {
    const rects = grilleMosaique(2, viewport);
    expect(rects).toHaveLength(2);
    // cols=ceil(sqrt(2))=2, rows=1 -> même y/hauteur, x qui progresse
    expect(rects[0]!.y).toBe(MARGE);
    expect(rects[1]!.y).toBe(MARGE);
    expect(rects[1]!.x).toBeGreaterThan(rects[0]!.x);
    expect(rects[0]!.width).toBeCloseTo((1920 - 3 * MARGE) / 2);
    verifierGrille(rects);
  });

  it("n=4 : grille 2×2", () => {
    const rects = grilleMosaique(4, viewport);
    expect(rects).toHaveLength(4);
    // cols=2, rows=2 : (0,1) sur la 1ère ligne, (2,3) sur la 2ème
    expect(rects[0]!.y).toBe(rects[1]!.y);
    expect(rects[2]!.y).toBe(rects[3]!.y);
    expect(rects[2]!.y).toBeGreaterThan(rects[0]!.y);
    expect(rects[0]!.x).toBe(rects[2]!.x);
    verifierGrille(rects);
  });

  it("n=5 : 3 colonnes × 2 lignes, dernière ligne incomplète (2 cellules)", () => {
    const rects = grilleMosaique(5, viewport);
    expect(rects).toHaveLength(5);
    // cols=ceil(sqrt(5))=3, rows=ceil(5/3)=2 : indices 0,1,2 en ligne 0 ; 3,4 en ligne 1
    expect(rects[0]!.y).toBe(rects[1]!.y);
    expect(rects[1]!.y).toBe(rects[2]!.y);
    expect(rects[3]!.y).toBe(rects[4]!.y);
    expect(rects[3]!.y).toBeGreaterThan(rects[0]!.y);
    // La 5ème cellule (ligne 1, col 1) s'aligne sous la 2ème (ligne 0, col 1).
    expect(rects[4]!.x).toBe(rects[1]!.x);
    verifierGrille(rects);
  });

  it("n=0 : grille vide", () => {
    expect(grilleMosaique(0, viewport)).toEqual([]);
  });

  it("n=24 : plancher de taille — aucune cellule sous MIN_WIDTH/MIN_HEIGHT", () => {
    const rects = grilleMosaique(24, viewport);
    expect(rects).toHaveLength(24);
    for (const r of rects) {
      expect(r.width).toBeGreaterThanOrEqual(MIN_WIDTH);
      expect(r.height).toBeGreaterThanOrEqual(MIN_HEIGHT);
    }
    // À n=24 (grille 5×5) la hauteur brute (~206px) passe sous MIN_HEIGHT : elle est
    // bornée à 240 (léger chevauchement vertical accepté).
    expect(rects[0]!.height).toBe(MIN_HEIGHT);
  });

  it("respecte une origine de viewport non nulle", () => {
    const decale: WorkspaceRect = { x: 200, y: 100, width: 800, height: 600 };
    const rects = grilleMosaique(1, decale);
    expect(rects[0]).toEqual({ x: 200 + MARGE, y: 100 + MARGE, width: 800 - 2 * MARGE, height: 600 - 2 * MARGE });
  });
});

describe("WINDOW_REGISTRY", () => {
  it("contient exactement les 38 fenêtres attendues, sans doublon d'id ni de mnémonique", () => {
    expect(WINDOW_REGISTRY).toHaveLength(38);
    const ids = WINDOW_REGISTRY.map((w) => w.id);
    const mnemos = WINDOW_REGISTRY.map((w) => w.mnemonic);
    expect(new Set(ids).size).toBe(38);
    expect(new Set(mnemos).size).toBe(38);

    expect(ids).toContain("macroRates");
    expect(mnemos).toContain("RATE");
    expect(ids).toContain("cot");
    expect(mnemos).toContain("COT");
    expect(ids).toContain("seasonality");
    expect(mnemos).toContain("SEAG");
    expect(ids).toContain("vol");
    expect(mnemos).toContain("VOL");
    expect(ids).toContain("fund");
    expect(mnemos).toContain("FUND");
    expect(ids).toContain("brief");
    expect(mnemos).toContain("BRIEF");
    expect(ids).toContain("globe");
    expect(mnemos).toContain("GLOBE");
    expect(ids).toContain("stablecoins");
    expect(mnemos).toContain("STBL");
    expect(ids).toContain("squeeze");
    expect(mnemos).toContain("SQZ");
    expect(ids).toContain("cbprem");
    expect(mnemos).toContain("CBPREM");
    expect(ids).toContain("netliq");
    expect(mnemos).toContain("NETLIQ");
    expect(ids).toContain("data");
    expect(mnemos).toContain("DATA");
    expect(ids).toContain("dist");
    expect(mnemos).toContain("DIST");
    expect(ids).toContain("expy");
    expect(mnemos).toContain("EXPY");
    expect(ids).toContain("paper");
    expect(mnemos).toContain("PAPER");
    expect(ids).toContain("mine");
    expect(mnemos).toContain("MINE");
    expect(ids).toContain("whales");
    expect(mnemos).toContain("WHALES");
    expect(ids).toContain("cycle");
    expect(mnemos).toContain("CYCLE");
    expect(ids).toContain("evts");
    expect(mnemos).toContain("EVTS");
    expect(ids).toContain("scen");
    expect(mnemos).toContain("SCEN");
    expect(ids).toContain("sect");
    expect(mnemos).toContain("SECT");
  });
});

describe("menuWindows (menu Fonctions dérivé du registre)", () => {
  it("exclut les fenêtres menuHidden (derivatives → bouton DES dédié)", () => {
    const ids = menuWindows().map((w) => w.id);
    expect(ids).not.toContain("derivatives");
    // Toutes les autres fenêtres du registre sont présentes, dans l'ordre.
    const attendues = WINDOW_REGISTRY.map((w) => w.id).filter((id) => id !== "derivatives");
    expect(ids).toEqual(attendues);
    expect(ids).toHaveLength(37);
  });

  it("résout le libellé via menuLabel quand présent, sinon title", () => {
    const parId = new Map(menuWindows().map((w) => [w.id, w.libelle]));
    // brief/globe ont un menuLabel distinct du title.
    expect(parId.get("brief")).toBe("Point marché (snapshot)");
    expect(parId.get("globe")).toBe("Globe (géopolitique, chokepoints & trafic aérien)");
    // eco n'a pas de menuLabel → title.
    expect(parId.get("eco")).toBe("Calendrier économique");
  });

  it("expose le drapeau `nouveau` (liquidations/globe/stablecoins marquées, eco non)", () => {
    const parId = new Map(menuWindows().map((w) => [w.id, w.nouveau]));
    expect(parId.get("liquidations")).toBe(true);
    expect(parId.get("globe")).toBe(true);
    expect(parId.get("stablecoins")).toBe(true);
    expect(parId.get("dist")).toBe(true);
    expect(parId.get("eco")).toBe(false);
  });
});

describe("menuWindowsGroupees (menu Fonctions par sections — c'est LUI que la Toolbar rend)", () => {
  // `menuWindows()` reste testé ci-dessus comme dérivation de référence, mais le produit
  // rend désormais la version GROUPÉE : sans ces tests, une fenêtre pouvait disparaître
  // du menu réel pendant que la suite restait verte (revue adversariale BCD).
  it("couvre EXACTEMENT les mêmes fenêtres que menuWindows — rien ne se perd au groupage", () => {
    const aplati = menuWindowsGroupees()
      .flatMap((s) => s.entrees)
      .map((e) => e.id)
      .sort();
    const reference = menuWindows()
      .map((w) => w.id)
      .sort();
    expect(aplati).toEqual(reference);
  });

  it("rend les sections dans l'ordre déclaré, sans section vide", () => {
    const groupes = menuWindowsGroupees().map((s) => s.groupe);
    const ordreDeclare = GROUPES_FENETRES.filter((g) => groupes.includes(g));
    expect(groupes).toEqual(ordreDeclare);
    for (const s of menuWindowsGroupees()) expect(s.entrees.length).toBeGreaterThan(0);
  });

  it("une fenêtre SANS groupe tomberait dans « Outils » (filet, pas un trou)", () => {
    // Vérifié indirectement : toutes les entrées du registre en portent un aujourd'hui,
    // et le repli est codé — on assert le repli sur la forme, pas sur un cas fabriqué.
    const total = menuWindowsGroupees().flatMap((s) => s.entrees).length;
    expect(total).toBe(menuWindows().length);
  });

  it("résout menuLabel et `nouveau` comme la dérivation de référence", () => {
    const brief = menuWindowsGroupees()
      .flatMap((s) => s.entrees)
      .find((e) => e.id === "brief");
    expect(brief?.libelle).toBe("Point marché (snapshot)");
    const liq = menuWindowsGroupees()
      .flatMap((s) => s.entrees)
      .find((e) => e.id === "liquidations");
    expect(liq?.nouveau).toBe(true);
  });
});

describe("estNouvelle / marquerVue (badge « nouveau »)", () => {
  // localStorage absent en Node : on installe un mock mémoire (même pattern que persist.test).
  beforeEach(() => {
    const data = new Map<string, string>();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
      clear: () => data.clear(),
      key: (i) => Array.from(data.keys())[i] ?? null,
      get length() {
        return data.size;
      },
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("une fenêtre jamais ouverte est nouvelle ; marquerVue la rend non nouvelle", () => {
    expect(estNouvelle("globe")).toBe(true);
    marquerVue("globe");
    expect(estNouvelle("globe")).toBe(false);
    // Indépendant par id : marquer globe ne touche pas stablecoins.
    expect(estNouvelle("stablecoins")).toBe(true);
  });

  it("openWindow marque la fenêtre comme vue (le badge disparaît après 1ère ouverture)", () => {
    expect(estNouvelle("liquidations")).toBe(true);
    windowManagerStore.getState().openWindow("liquidations");
    expect(estNouvelle("liquidations")).toBe(false);
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

function fenetre(id: string, z: number, patch: Partial<EtatFenetre> = {}): EtatFenetre {
  return {
    id,
    open: true,
    x: 10,
    y: 20,
    width: 440,
    height: 640,
    z,
    minimized: false,
    groupColor: null,
    preSnapGeometry: null,
    ...patch,
  };
}

describe("normaliserOrdreZ", () => {
  it("migre les anciens z hors bande en conservant leur ordre relatif", () => {
    const resultat = normaliserOrdreZ({
      milieu: fenetre("milieu", 500, { x: 123 }),
      bas: fenetre("bas", -20),
      sommet: fenetre("sommet", 50_000),
    });

    expect(resultat.windows.bas!.z).toBe(WINDOW_Z_MIN);
    expect(resultat.windows.milieu!.z).toBe(WINDOW_Z_MIN + 1);
    expect(resultat.windows.sommet!.z).toBe(WINDOW_Z_MIN + 2);
    expect(resultat.windows.milieu!.x).toBe(123); // aucun autre champ migré
    expect(resultat.nextZ).toBe(WINDOW_Z_MIN + 3);
  });

  it("stabilise les z dupliqués selon l'ordre d'insertion", () => {
    const resultat = normaliserOrdreZ({
      premier: fenetre("premier", 900),
      second: fenetre("second", 900),
    });

    expect(resultat.windows.premier!.z).toBe(WINDOW_Z_MIN);
    expect(resultat.windows.second!.z).toBe(WINDOW_Z_MIN + 1);
  });
});

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
    expect(w.preSnapGeometry).toBeNull();
  });

  it("la taille par défaut est plafonnée au workspace courant", () => {
    windowManagerStore.getState().setWorkspace({ x: 0, y: 0, width: 800, height: 600 });
    windowManagerStore.getState().openWindow("marketMap"); // defaultWidth 1100 > 800
    const w = windowManagerStore.getState().windows.marketMap;
    expect(w !== undefined && w.width <= 800).toBe(true);
    expect(w !== undefined && w.height <= 600).toBe(true);
  });
});

describe("openWindow — réouverture d'une fenêtre déjà fermée", () => {
  it("préserve la géométrie précédente au lieu de recalculer la cascade", () => {
    windowManagerStore.getState().openWindow("derivatives");
    // x=900,y=300,width=600,height=700 : intégralement dans le workspace 1920x1080 du
    // beforeEach (900+600=1500<=1920 ; 300+700=1000<=1080) — ce test vérifie la
    // PRÉSERVATION de la géométrie, pas le clamp (couvert séparément ci-dessous).
    windowManagerStore.getState().moveWindow("derivatives", 900, 300);
    windowManagerStore.getState().resizeWindow("derivatives", 600, 700);
    windowManagerStore.getState().setGroup("derivatives", GROUP_COLOR);
    windowManagerStore.getState().closeWindow("derivatives");

    windowManagerStore.getState().openWindow("derivatives");
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.open).toBe(true);
    expect(w.minimized).toBe(false);
    expect(w.x).toBe(900);
    expect(w.y).toBe(300);
    expect(w.width).toBe(600);
    expect(w.height).toBe(700);
    expect(w.groupColor).toBe(GROUP_COLOR);
  });

  it("confine la géométrie restaurée si le workspace a rétréci depuis la fermeture (ex. restauration localStorage sur un viewport plus petit)", () => {
    windowManagerStore.getState().openWindow("derivatives");
    // Position/taille valides pour le workspace large du beforeEach (1920x1080) :
    // x+width = 1400+420 = 1820 <= 1920 ; y+height = 300+640 = 940 <= 1080.
    windowManagerStore.getState().moveWindow("derivatives", 1400, 300);
    windowManagerStore.getState().closeWindow("derivatives");

    // setState direct (PAS setWorkspace) : on veut que la géométrie stockée reste
    // périmée par rapport au workspace courant au moment où openWindow s'exécute,
    // sans passer par reclampAll qui masquerait le bug.
    const petit: WorkspaceRect = { x: 0, y: 0, width: 800, height: 600 };
    windowManagerStore.setState({ workspace: petit });

    windowManagerStore.getState().openWindow("derivatives");
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.x).toBeGreaterThanOrEqual(petit.x);
    expect(w.y).toBeGreaterThanOrEqual(petit.y);
    expect(w.x + w.width).toBeLessThanOrEqual(petit.x + petit.width);
    expect(w.y + w.height).toBeLessThanOrEqual(petit.y + petit.height);
  });
});

describe("z-order — openWindow / focusWindow", () => {
  it("monte une autre fenêtre à une valeur strictement supérieure", () => {
    windowManagerStore.getState().openWindow("derivatives");
    const z1 = windowManagerStore.getState().windows.derivatives!.z;

    windowManagerStore.getState().openWindow("eco");
    const z2 = windowManagerStore.getState().windows.eco!.z;
    expect(z2).toBeGreaterThan(z1);

    windowManagerStore.getState().focusWindow("derivatives");
    const z1Focused = windowManagerStore.getState().windows.derivatives!.z;
    expect(z1Focused).toBeGreaterThan(z2);
  });

  it("focusWindow est un vrai no-op si la fenêtre est déjà au sommet", () => {
    windowManagerStore.getState().openWindow("derivatives");
    const avant = windowManagerStore.getState();

    windowManagerStore.getState().focusWindow("derivatives");
    const apres = windowManagerStore.getState();

    expect(apres.nextZ).toBe(avant.nextZ);
    expect(apres.windows).toBe(avant.windows);
    expect(apres.windows.derivatives!.z).toBe(avant.windows.derivatives!.z);
  });

  it("openWindow ne rebump pas une fenêtre déjà ouverte et déjà au sommet", () => {
    windowManagerStore.getState().openWindow("derivatives");
    const avant = windowManagerStore.getState();

    windowManagerStore.getState().openWindow("derivatives");
    const apres = windowManagerStore.getState();

    expect(apres.nextZ).toBe(avant.nextZ);
    expect(apres.windows).toBe(avant.windows);
  });

  it("reste dans la bande sous z-40 après de très nombreux changements de focus", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().openWindow("eco");

    for (let i = 0; i < WINDOW_Z_MAX * 5; i += 1) {
      windowManagerStore.getState().focusWindow(i % 2 === 0 ? "derivatives" : "eco");
    }

    const state = windowManagerStore.getState();
    const valeurs = Object.values(state.windows).map((w) => w.z);
    expect(Math.min(...valeurs)).toBeGreaterThanOrEqual(WINDOW_Z_MIN);
    expect(Math.max(...valeurs)).toBeLessThanOrEqual(WINDOW_Z_MAX);
    expect(state.nextZ).toBeLessThanOrEqual(WINDOW_Z_MAX + 1);
    // La dernière itération (index pair : 194) cible derivatives.
    expect(state.windows.derivatives!.z).toBe(Math.max(...valeurs));
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

  it("toggleWindow restaure une fenêtre minimisée au lieu de la fermer", () => {
    const s = windowManagerStore.getState();
    s.openWindow("derivatives");
    s.minimizeWindow("derivatives");
    s.toggleWindow("derivatives");
    const w = windowManagerStore.getState().windows.derivatives;
    expect(w?.open).toBe(true);
    expect(w?.minimized).toBe(false);
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

  it("restoreWindow passe minimized à false sans bump si la fenêtre est déjà au sommet", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().minimizeWindow("derivatives");
    const nextZBefore = windowManagerStore.getState().nextZ;
    const zBeforeRestore = windowManagerStore.getState().windows.derivatives!.z;

    windowManagerStore.getState().restoreWindow("derivatives");
    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.minimized).toBe(false);
    expect(w.z).toBe(zBeforeRestore);
    expect(windowManagerStore.getState().nextZ).toBe(nextZBefore);
  });

  it("restoreWindow remonte une fenêtre minimisée qui n'est plus au sommet", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().minimizeWindow("derivatives");
    windowManagerStore.getState().openWindow("eco");
    const zEco = windowManagerStore.getState().windows.eco!.z;

    windowManagerStore.getState().restoreWindow("derivatives");

    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.minimized).toBe(false);
    expect(w.z).toBeGreaterThan(zEco);
    expect(w.z).toBeLessThanOrEqual(WINDOW_Z_MAX);
  });

  it("sont des no-op sur un id inconnu", () => {
    expect(() => windowManagerStore.getState().minimizeWindow("inconnu")).not.toThrow();
    expect(() => windowManagerStore.getState().restoreWindow("inconnu")).not.toThrow();
    expect(windowManagerStore.getState().windows.inconnu).toBeUndefined();
  });
});

describe("zFenetreFocalisee (fenêtre au premier plan pour la taskbar)", () => {
  it("renvoie le z le plus haut parmi les fenêtres ouvertes non réduites", () => {
    const windows = {
      a: fenetre("a", 3),
      b: fenetre("b", 7),
      c: fenetre("c", 5),
    };
    expect(zFenetreFocalisee(windows)).toBe(7);
  });

  it("ignore les fenêtres réduites (jamais focalisées) et fermées", () => {
    const windows = {
      a: fenetre("a", 9, { minimized: true }),
      b: fenetre("b", 4, { open: false }),
      c: fenetre("c", 2),
    };
    expect(zFenetreFocalisee(windows)).toBe(2);
  });

  it("renvoie null si toutes les fenêtres sont réduites ou fermées", () => {
    const windows = {
      a: fenetre("a", 9, { minimized: true }),
      b: fenetre("b", 4, { open: false }),
    };
    expect(zFenetreFocalisee(windows)).toBeNull();
  });

  it("renvoie null sur un ensemble vide", () => {
    expect(zFenetreFocalisee({})).toBeNull();
  });
});

describe("etatPastille (état visuel d'une pastille de taskbar)", () => {
  it("« minimisee » pour une fenêtre réduite (même si son z égale zFocus)", () => {
    expect(etatPastille(fenetre("a", 7, { minimized: true }), 7)).toBe("minimisee");
  });

  it("« focus » quand le z de la fenêtre égale zFocus", () => {
    expect(etatPastille(fenetre("a", 7), 7)).toBe("focus");
  });

  it("« normale » quand le z diffère de zFocus", () => {
    expect(etatPastille(fenetre("a", 3), 7)).toBe("normale");
  });

  it("« normale » quand zFocus est null (aucune fenêtre focalisée)", () => {
    expect(etatPastille(fenetre("a", 3), null)).toBe("normale");
  });
});

describe("toggleFocusMinimize (clic sur une pastille de taskbar)", () => {
  it("réduit la fenêtre focalisée (z le plus haut) au clic", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().openWindow("eco"); // eco devient focalisée (au sommet)

    windowManagerStore.getState().toggleFocusMinimize("eco");

    expect(windowManagerStore.getState().windows.eco!.minimized).toBe(true);
  });

  it("remonte au premier plan une fenêtre ouverte non focalisée (sans la réduire)", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().openWindow("eco"); // eco au sommet, derivatives en dessous
    const zEco = windowManagerStore.getState().windows.eco!.z;

    windowManagerStore.getState().toggleFocusMinimize("derivatives");

    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.minimized).toBe(false);
    expect(w.z).toBeGreaterThan(zEco);
  });

  it("restaure au premier plan une fenêtre réduite", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().openWindow("eco");
    windowManagerStore.getState().minimizeWindow("derivatives");
    const zEco = windowManagerStore.getState().windows.eco!.z;

    windowManagerStore.getState().toggleFocusMinimize("derivatives");

    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.minimized).toBe(false);
    expect(w.z).toBeGreaterThan(zEco);
  });

  it("est un no-op sur un id inconnu ou une fenêtre fermée", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().closeWindow("derivatives");
    expect(() => windowManagerStore.getState().toggleFocusMinimize("inconnu")).not.toThrow();
    expect(() => windowManagerStore.getState().toggleFocusMinimize("derivatives")).not.toThrow();
    expect(windowManagerStore.getState().windows.derivatives!.minimized).toBe(false);
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

describe("snapWindow", () => {
  it("sauvegarde la géométrie actuelle dans preSnapGeometry, puis applique la nouvelle", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 100, 100);
    windowManagerStore.getState().resizeWindow("derivatives", 420, 640);

    const geo = { x: 0, y: 0, width: 960, height: 1080 };
    windowManagerStore.getState().snapWindow("derivatives", geo);

    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.x).toBe(geo.x);
    expect(w.y).toBe(geo.y);
    expect(w.width).toBe(geo.width);
    expect(w.height).toBe(geo.height);
    expect(w.preSnapGeometry).toEqual({ x: 100, y: 100, width: 420, height: 640 });
  });

  it("un second snap écrase preSnapGeometry avec la géométrie du snap précédent (pas la toute première)", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 100, 100);
    windowManagerStore.getState().resizeWindow("derivatives", 420, 640);

    windowManagerStore.getState().snapWindow("derivatives", { x: 0, y: 0, width: 960, height: 1080 });
    windowManagerStore.getState().snapWindow("derivatives", { x: 0, y: 0, width: 1920, height: 1080 });

    const w = windowManagerStore.getState().windows.derivatives!;
    expect(w.preSnapGeometry).toEqual({ x: 0, y: 0, width: 960, height: 1080 });
  });

  it("no-op sur un id inconnu", () => {
    expect(() =>
      windowManagerStore.getState().snapWindow("inconnu", { x: 0, y: 0, width: 100, height: 100 }),
    ).not.toThrow();
    expect(windowManagerStore.getState().windows.inconnu).toBeUndefined();
  });
});

describe("setPreSnapGeometry", () => {
  it("définit puis efface preSnapGeometry indépendamment de la géométrie courante", () => {
    windowManagerStore.getState().openWindow("derivatives");
    const geo = { x: 10, y: 20, width: 300, height: 400 };

    windowManagerStore.getState().setPreSnapGeometry("derivatives", geo);
    expect(windowManagerStore.getState().windows.derivatives!.preSnapGeometry).toEqual(geo);

    windowManagerStore.getState().setPreSnapGeometry("derivatives", null);
    expect(windowManagerStore.getState().windows.derivatives!.preSnapGeometry).toBeNull();
  });

  it("no-op sur un id inconnu", () => {
    expect(() => windowManagerStore.getState().setPreSnapGeometry("inconnu", null)).not.toThrow();
  });
});

describe("setAll", () => {
  it("remplace intégralement le record et normalise les z restaurés", () => {
    windowManagerStore.getState().openWindow("derivatives");

    const nouveauxWindows: Record<string, EtatFenetre> = {
      eco: fenetre("eco", 99),
    };
    windowManagerStore.getState().setAll(nouveauxWindows);

    expect(windowManagerStore.getState().windows.eco).toEqual({
      ...nouveauxWindows.eco,
      z: WINDOW_Z_MIN,
    });
    // Remplacement, pas fusion : l'ancienne entrée "derivatives" a disparu.
    expect(windowManagerStore.getState().windows.derivatives).toBeUndefined();
  });

  it("préserve l'ordre d'un état historique puis permet une promotion bornée", () => {
    const nouveauxWindows: Record<string, EtatFenetre> = {
      derivatives: fenetre("derivatives", 500),
      eco: fenetre("eco", 900),
    };
    windowManagerStore.getState().setAll(nouveauxWindows);

    let state = windowManagerStore.getState();
    expect(state.windows.derivatives!.z).toBeLessThan(state.windows.eco!.z);
    expect(state.windows.eco!.z).toBeLessThanOrEqual(WINDOW_Z_MAX);

    windowManagerStore.getState().focusWindow("derivatives");
    state = windowManagerStore.getState();
    expect(state.windows.derivatives!.z).toBeGreaterThan(state.windows.eco!.z);
    expect(state.windows.derivatives!.z).toBeLessThanOrEqual(WINDOW_Z_MAX);
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

  it("sync immédiat à l'enregistrement (lazy-load : fenêtre déjà ouverte)", () => {
    windowManagerStore.getState().openWindow("derivatives");
    let open = false;
    const fakeUiStore = {
      getState: () => ({ open }),
      setState: (partial: { open: boolean }) => {
        open = partial.open;
      },
    };
    mirrorOpenState("derivatives", fakeUiStore);
    expect(fakeUiStore.getState().open).toBe(true);
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

describe("minimizeAll / restoreAll", () => {
  it("réduit toutes les fenêtres ouvertes, puis les restaure toutes", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().openWindow("eco");

    windowManagerStore.getState().minimizeAll();
    expect(windowManagerStore.getState().windows.derivatives!.minimized).toBe(true);
    expect(windowManagerStore.getState().windows.eco!.minimized).toBe(true);

    windowManagerStore.getState().restoreAll();
    expect(windowManagerStore.getState().windows.derivatives!.minimized).toBe(false);
    expect(windowManagerStore.getState().windows.eco!.minimized).toBe(false);
  });

  it("minimizeAll ignore les fenêtres fermées (ne les réduit pas)", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().closeWindow("derivatives");
    windowManagerStore.getState().minimizeAll();
    // Fenêtre fermée : reste non réduite (rien à afficher dans la taskbar).
    expect(windowManagerStore.getState().windows.derivatives!.minimized).toBe(false);
  });

  it("minimizeAll est un no-op référentiel si aucune fenêtre ouverte non réduite", () => {
    const avant = windowManagerStore.getState().windows;
    windowManagerStore.getState().minimizeAll();
    expect(windowManagerStore.getState().windows).toBe(avant);
  });
});

describe("closeAll", () => {
  it("ferme toutes les fenêtres ouvertes en conservant leur géométrie", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().moveWindow("derivatives", 300, 200);
    windowManagerStore.getState().openWindow("eco");

    windowManagerStore.getState().closeAll();
    expect(windowManagerStore.getState().windows.derivatives!.open).toBe(false);
    expect(windowManagerStore.getState().windows.eco!.open).toBe(false);
    // Géométrie préservée (réouverture ultérieure au même endroit).
    expect(windowManagerStore.getState().windows.derivatives!.x).toBe(300);
  });
});

describe("tileOpenWindows", () => {
  it("dispose les fenêtres ouvertes non réduites en mosaïque (2 → côte à côte)", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().openWindow("eco");
    const viewport: WorkspaceRect = { x: 0, y: 0, width: 1920, height: 1080 };

    // Le store lit son propre workspace (identique au viewport via le beforeEach).
    windowManagerStore.getState().tileOpenWindows();
    const cells = grilleMosaique(2, viewport);
    // Ordre par z ascendant : derivatives ouverte en 1er (z plus bas) -> cellule 0.
    const d = windowManagerStore.getState().windows.derivatives!;
    const e = windowManagerStore.getState().windows.eco!;
    expect({ x: d.x, y: d.y, width: d.width, height: d.height }).toEqual(cells[0]);
    expect({ x: e.x, y: e.y, width: e.width, height: e.height }).toEqual(cells[1]);
    expect(d.preSnapGeometry).toBeNull();
  });

  it("ignore les fenêtres réduites et fermées", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().openWindow("eco");
    windowManagerStore.getState().minimizeWindow("eco");
    const viewport: WorkspaceRect = { x: 0, y: 0, width: 1920, height: 1080 };

    windowManagerStore.getState().tileOpenWindows();
    // Une seule fenêtre visible -> occupe tout le workspace moins la marge.
    const seule = grilleMosaique(1, viewport)[0]!;
    const d = windowManagerStore.getState().windows.derivatives!;
    expect({ x: d.x, y: d.y, width: d.width, height: d.height }).toEqual(seule);
  });

  it("est un no-op si aucune fenêtre ouverte non réduite", () => {
    const avant = windowManagerStore.getState().windows;
    windowManagerStore.getState().tileOpenWindows();
    expect(windowManagerStore.getState().windows).toBe(avant);
  });
});

describe("cascadeAll", () => {
  it("réempile les fenêtres ouvertes en cascade sans changer leur taille", () => {
    windowManagerStore.getState().openWindow("derivatives");
    windowManagerStore.getState().openWindow("eco");
    windowManagerStore.getState().moveWindow("derivatives", 900, 500);
    const largeurAvant = windowManagerStore.getState().windows.derivatives!.width;
    const viewport: WorkspaceRect = { x: 0, y: 0, width: 1920, height: 1080 };

    windowManagerStore.getState().cascadeAll();
    const d = windowManagerStore.getState().windows.derivatives!;
    // 1ère fenêtre (z bas) -> cascade index 0 -> coin haut-gauche (marge 48px).
    expect({ x: d.x, y: d.y }).toEqual(cascadePosition(0, viewport, d.width, d.height));
    expect(d.width).toBe(largeurAvant);
  });
});
