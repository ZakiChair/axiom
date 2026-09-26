/**
 * Heures de marché plausibles des actifs Twelve Data (UTC), sans dépendance : partagées par
 * les cotations de la watchlist (data/ticker.ts) et le sondage des jambes de ratio
 * (data/twelvedata.ts), sans cycle d'import entre ces modules.
 */

/** Nature de marché d'un actif tradfi (heures d'ouverture distinctes). */
export type TradfiMarketKind = "crypto" | "stock" | "forex";

/** Un symbole tradfi à slash est du FOREX ; sinon action/ETF (heures de bourse US). */
export function classifyTradfi(symbol: string): "stock" | "forex" {
  return symbol.includes("/") ? "forex" : "stock";
}

/**
 * Marché plausiblement OUVERT pour `kind` à l'instant `date` (UTC). PURE & testée.
 *  - crypto : toujours ouvert (24/7, jamais gaté) ;
 *  - forex  : ouvert du dimanche 22:00 UTC au vendredi 22:00 UTC (fermé le samedi) ;
 *  - stock  : actions/ETF US, lundi-vendredi 13:20-20:10 UTC.
 *
 * APPROXIMATION DST (documentée) : la fenêtre actions est calée sur l'HEURE D'ÉTÉ (EDT,
 * UTC-4 → séance NYSE 13:30-20:00 UTC, élargie à 13:20-20:10). En HIVER (EST, UTC-5) la
 * séance réelle est 14:30-21:00 UTC : la fenêtre sous-couvre alors la dernière ~heure
 * (prix figé, jamais de crash) et sur-couvre le début de matinée. Les jours fériés ne sont
 * pas gérés. Objectif = couper le polling nocturne/week-end pour économiser le quota Twelve
 * Data, pas fournir une horloge de marché exacte.
 */
export function isMarketOpen(kind: TradfiMarketKind, date: Date): boolean {
  if (kind === "crypto") return true;
  const day = date.getUTCDay(); // 0 = dimanche … 6 = samedi
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (kind === "forex") {
    if (day === 6) return false; // samedi : fermé
    if (day === 0) return minutes >= 22 * 60; // dimanche : ouvre à 22:00 UTC
    if (day === 5) return minutes < 22 * 60; // vendredi : ferme à 22:00 UTC
    return true; // lundi-jeudi : ouvert en continu
  }
  // kind === "stock"
  if (day === 0 || day === 6) return false; // week-end : fermé
  return minutes >= 13 * 60 + 20 && minutes < 20 * 60 + 10;
}
