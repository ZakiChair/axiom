/**
 * Ordre de granularité des `Timeframe` (@axiom/types) — du plus fin au plus grossier.
 *
 * Ni `TF_MS` (data/replayFeed.ts) ni `SUPPORTED_TIMEFRAMES` (data/adapters.ts) ne
 * conviennent tels quels : le premier est privé et ne couvre que les 4 TF de replay
 * intraday (jusqu'à 1h, sans 1d) ; le second reflète la CAPACITÉ d'un exchange
 * donné (pas un ordre canonique) et omet 5s/15s. L'ordre ci-dessous reprend
 * simplement celui, déjà canonique, de la déclaration du type `Timeframe` dans
 * `packages/types/src/index.ts` (documenté croissant en granularité).
 */
import type { Timeframe } from "@axiom/types";

const TF_ORDER: Timeframe[] = [
  "1s", "5s", "15s",
  "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "6h", "12h",
  "1d", "3d", "1w", "1M",
  "3M", "6M", "12M",
];

const RANG: Record<Timeframe, number> = Object.fromEntries(
  TF_ORDER.map((tf, i) => [tf, i])
) as Record<Timeframe, number>;

/** `tf` satisfait-il le minimum `min` (i.e. `tf` est au moins aussi grossier) ? Inclusif. */
export function tfAtLeast(tf: Timeframe, min: Timeframe): boolean {
  return RANG[tf] >= RANG[min];
}
