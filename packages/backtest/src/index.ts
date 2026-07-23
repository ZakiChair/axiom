/**
 * @axiom/backtest — point d'entrée public.
 *
 * Moteur de backtest PUR et sans I/O sur bougies clôturées (roadmap 03, piste 4.3) :
 * règles composables sur les sorties de @axiom/indicators + prix/volume (PAS de langage
 * de script). Réutilisable côté app (worker) comme, plus tard, côté daemon.
 */

export * from "./types";
export * from "./engine";
export * from "./monteCarlo";
