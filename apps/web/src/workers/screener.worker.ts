/**
 * Worker du screener (EQS) — étage INDICATEURS.
 *
 * Reçoit du store la liste des CANDIDATS (déjà filtrés sur les métriques de base), le TF
 * du run, les conditions indicateurs et le symbole de référence. La boucle vit dans
 * data/screenerEtage.ts (testée avec des bouchons) : klines Binance (`/api/v3/klines`,
 * CORS *) à l'unité de chaque condition, bougie en formation écartée, volume taker
 * conservé, amorce des définitions, calcul via @axiom/indicators (source de vérité
 * unique, cf. BUILD-CONTRACT). Émet la progression au fil de l'eau, puis les lignes
 * survivantes et les notes de couverture.
 *
 * Tout le fetch + calcul vit ICI (hors du thread principal) : le graphe reste fluide
 * pendant un run. Débit auto-limité à ~10 req/s (REQ_INTERVAL_MS entre requêtes).
 *
 * Instancié par le store en `{ type: "module" }` : Vite le bundle en chunk séparé via
 * `new Worker(new URL(...))` — aucune dépendance ajoutée.
 */
import type { Timeframe } from "@axiom/types";
import type { IndicatorCondition, ScreenerRow } from "../data/screener";
import { executerEtage } from "../data/screenerEtage";

/** Requête de run envoyée par le store. */
export interface WorkerRequest {
  type: "run";
  runId: number;
  candidates: ScreenerRow[];
  tf: Timeframe;
  /** Plancher de bougies closes par unité (élevé à l'amorce des conditions). */
  klineLimit: number;
  indicatorConditions: IndicatorCondition[];
  /** Référence des champs de force relative (refSymbolStore, BTCUSDT par défaut). */
  refSymbol: string;
}

/** Réponses émises vers le store. */
export type WorkerResponse =
  | { type: "progress"; runId: number; done: number; total: number }
  | { type: "result"; runId: number; rows: ScreenerRow[]; notes: string[] }
  | { type: "error"; runId: number; message: string };

// Contexte worker typé localement (la lib « webworker » n'est pas chargée dans ce
// tsconfig ; on n'expose que les deux méthodes utilisées, sans dépendre de son type).
const ctx = self as unknown as {
  postMessage(message: WorkerResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
};

async function lireJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`klines ${res.status}`);
  return res.json();
}

ctx.addEventListener("message", (event) => {
  const req = event.data;
  if (!req || req.type !== "run") return;
  const { runId } = req;
  void executerEtage(
    {
      candidates: req.candidates,
      tf: req.tf,
      conditions: req.indicatorConditions,
      plancher: req.klineLimit,
      refSymbol: req.refSymbol,
    },
    {
      lireJson,
      maintenant: () => Date.now(),
      attendre: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      progression: (done, total) => ctx.postMessage({ type: "progress", runId, done, total }),
    },
  )
    .then((res) => ctx.postMessage({ type: "result", runId, rows: res.rows, notes: res.notes }))
    .catch((err: unknown) =>
      ctx.postMessage({ type: "error", runId, message: err instanceof Error ? err.message : String(err) }),
    );
});
