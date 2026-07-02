/**
 * Worker du backtest (BT) — exécute le MOTEUR (@axiom/backtest) hors du thread principal.
 *
 * Reçoit du store les bougies déjà accumulées (data/backtestData.ts) + la stratégie + les
 * paramètres (frais/slippage/capital), lance `runBacktest` (pur, avec calcul des
 * indicateurs via @axiom/indicators), et renvoie le résultat. Le calcul est déporté ici
 * pour que le graphe reste fluide même sur 50 000 bougies.
 *
 * Instancié par le store en `{ type: "module" }` : Vite le bundle en chunk séparé via
 * `new Worker(new URL(...))` — aucune dépendance ajoutée (même pattern que screener.worker).
 */
import type { Candle } from "@axiom/types";
import { runBacktest } from "@axiom/backtest";
import type { ParamsBacktest, ResultatBacktest, StrategieDef } from "@axiom/backtest";

/** Requête de run envoyée par le store. */
export interface WorkerRequest {
  type: "run";
  runId: number;
  candles: Candle[];
  strat: StrategieDef;
  params: ParamsBacktest;
}

/** Réponses émises vers le store. */
export type WorkerResponse =
  | { type: "progress"; runId: number; phase: "calcul" }
  | { type: "result"; runId: number; resultat: ResultatBacktest }
  | { type: "error"; runId: number; message: string };

// Contexte worker typé localement (la lib « webworker » n'est pas chargée dans ce tsconfig ;
// on n'expose que les méthodes utilisées, comme dans screener.worker.ts).
const ctx = self as unknown as {
  postMessage(message: WorkerResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
};

ctx.addEventListener("message", (event) => {
  const req = event.data;
  if (!req || req.type !== "run") return;
  try {
    ctx.postMessage({ type: "progress", runId: req.runId, phase: "calcul" });
    const resultat = runBacktest(req.candles, req.strat, req.params);
    ctx.postMessage({ type: "result", runId: req.runId, resultat });
  } catch (err) {
    ctx.postMessage({ type: "error", runId: req.runId, message: String(err) });
  }
});
