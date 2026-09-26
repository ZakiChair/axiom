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

/** Heure et jour de New York (heure d'été comprise) : la séance NYSE suit ce fuseau. */
const NEW_YORK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * Marché plausiblement OUVERT pour `kind` à l'instant `date`. PURE & testée.
 *  - crypto : toujours ouvert (24/7, jamais gaté) ;
 *  - forex  : ouvert du dimanche 22:00 UTC au vendredi 22:00 UTC (fermé le samedi) ;
 *  - stock  : actions/ETF US, lundi-vendredi 09:20-16:10 à New York (séance 09:30-16:00,
 *    marges de 10 min), heure d'été comprise : 13:20-20:10Z en été, 14:20-21:10Z en hiver.
 * Les jours fériés ne sont pas gérés. Objectif = couper le polling nocturne/week-end pour
 * économiser le quota Twelve Data, pas fournir une horloge de marché exacte.
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
  // kind === "stock" : jour et heure de New York.
  const parts = Object.fromEntries(NEW_YORK.formatToParts(date).map((p) => [p.type, p.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false; // week-end : fermé
  const local = Number(parts.hour) * 60 + Number(parts.minute);
  return local >= 9 * 60 + 20 && local < 16 * 60 + 10;
}
