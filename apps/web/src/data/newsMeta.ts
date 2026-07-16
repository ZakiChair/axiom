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
