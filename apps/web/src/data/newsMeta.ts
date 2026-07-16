import { NEWS_FEEDS, type NewsSourceId } from "./news";

/**
 * Libellé + couleur par source de news — partagé NewsWindow / TickerBand
 * (les deux copies verbatim de la revue v2). GDELT n'est pas un feed déclaré :
 * couleur de série thémée (var résolue par le style inline).
 */
export const META_SOURCE: Record<NewsSourceId, { label: string; color: string }> = {
  ...(Object.fromEntries(NEWS_FEEDS.map((f) => [f.id, { label: f.label, color: f.color }])) as Record<
    NewsSourceId,
    { label: string; color: string }
  >),
  gdelt: { label: "GDELT", color: "var(--serie-4)" },
};

/**
 * Bordure adoucie (~33 %) pour la couleur d'un badge de source : les hex prennent
 * un suffixe alpha, les tokens var(--x) passent par leur triplet --x-rgb
 * (déclarés pour les 5 thèmes — garde-fou themeTokens).
 */
export function bordureSource(color: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(color);
  return m !== null && m[1] !== undefined ? `rgb(var(${m[1]}-rgb) / 0.33)` : `${color}55`;
}
