import { describe, expect, it, vi } from "vitest";
import { registerFigure, utils, type TextAttrs } from "klinecharts";
import { largeurTexteSure } from "./canvasText";

vi.mock("klinecharts", () => ({ registerFigure: vi.fn(), utils: { checkCoordinateOnText: vi.fn(), drawText: vi.fn() } }));

describe("largeur du texte canvas", () => {
  it("laisse toute la largeur aux glyphes fractionnaires sans changer leur ancrage", () => {
    const attrs = { x: 80, y: 120, text: "60,031.61", align: "right" as const, baseline: "middle" as const };
    expect(largeurTexteSure(attrs, 54.48046875, { paddingLeft: 4, paddingRight: 4 }))
      .toEqual({ ...attrs, width: 63 });
  });
  it("respecte une largeur explicitement limitée et ne modifie pas les attributs", () => {
    const attrs = { x: 0, y: 0, text: "texte long", width: 30 };
    expect(largeurTexteSure(attrs, 100.5, {})).toBe(attrs);
  });
  it("traite une largeur null comme automatique et transmet police, style et tableau au renderer", () => {
    const attrs = { x: 0, y: 10, text: "60,031.61", width: null } as unknown as TextAttrs;
    expect(largeurTexteSure(attrs, 54.48, {})).toEqual({ ...attrs, width: 55 });
    const styles = { size: 14, family: "sans-serif", weight: "600", paddingLeft: 2, paddingRight: 3, color: "#fff" };
    const ctx = { font: "", measureText: () => ({ width: 54.48 }) } as unknown as CanvasRenderingContext2D;
    const figure = vi.mocked(registerFigure).mock.calls[0]![0];
    figure.draw(ctx, [attrs], styles);
    expect(ctx.font).toBe("600 14px sans-serif");
    expect(utils.drawText).toHaveBeenCalledWith(ctx, [{ ...attrs, width: 60 }], styles);
  });
});
