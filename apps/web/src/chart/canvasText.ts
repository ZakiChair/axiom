import { registerFigure, utils, type TextAttrs, type TextStyle } from "klinecharts";

/** KLine 9 arrondit la largeur au plus proche. À DPR 3, WebKit peut ne peindre
 * aucun glyphe lorsque fillText reçoit 54 px pour un texte mesurant 54,48 px.
 * On arrondit uniquement les largeurs automatiques vers le haut ; le renderer
 * public conserve les fonds, alignements, paddings et clips du graphique. */
export function largeurTexteSure(attrs: TextAttrs, largeur: number, styles: Partial<TextStyle>): TextAttrs {
  return attrs.width != null ? attrs : { ...attrs,
    width: Math.ceil(largeur) + (styles.paddingLeft ?? 0) + (styles.paddingRight ?? 0) };
}

registerFigure<TextAttrs | TextAttrs[], Partial<TextStyle>>({
  name: "text",
  checkEventOn: utils.checkCoordinateOnText,
  draw(ctx, attrs, styles) {
    ctx.font = `${styles.weight ?? "normal"} ${styles.size ?? 12}px ${styles.family ?? "Helvetica Neue"}`;
    const mesurer = (a: TextAttrs): TextAttrs => largeurTexteSure(a, ctx.measureText(a.text).width, styles);
    utils.drawText(ctx, Array.isArray(attrs) ? attrs.map(mesurer) : mesurer(attrs), styles);
  },
});
