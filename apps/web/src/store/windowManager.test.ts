import { describe, expect, it, beforeEach } from "vitest";
import {
  cascadePosition,
  clampPosition,
  clampSize,
  windowManagerStore,
  WINDOW_REGISTRY,
  GROUP_PALETTE,
} from "./windowManager";

beforeEach(() => {
  windowManagerStore.setState({ windows: {}, nextZ: 1, groupSymbols: {} });
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
