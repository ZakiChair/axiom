/**
 * Worker du screener (EQS) — étage INDICATEURS.
 *
 * Reçoit du store la liste des CANDIDATS (déjà filtrés sur les métriques de base) + le
 * TF + les conditions indicateurs. Pour chaque candidat, télécharge ses klines Binance
 * (`/api/v3/klines`, CORS *), calcule les indicateurs demandés via @axiom/indicators
 * (source de vérité unique — cf. BUILD-CONTRACT), en dérive un scalaire et évalue les
 * conditions. Émet la progression au fil de l'eau, puis les lignes survivantes.
 *
 * Tout le fetch + calcul vit ICI (hors du thread principal) : le graphe reste fluide
 * pendant un run. Débit auto-limité à ~10 req/s (throttle simple entre requêtes).
 *
 * Instancié par le store en `{ type: "module" }` : Vite le bundle en chunk séparé via
 * `new Worker(new URL(...))` — aucune dépendance ajoutée.
 */
import type { Candle } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import {
  compareOp,
  deriveScalar,
  getIndicatorField,
  indicatorConditionLabel,
  lastClose,
  type IndicatorCondition,
  type IndicatorValue,
  type ScreenerRow,
} from "../data/screener";

const KLINES_URL = "https://api.binance.com/api/v3/klines";
/** Intervalle minimal entre deux requêtes klines (~10 req/s). */
const REQ_INTERVAL_MS = 100;

/** Requête de run envoyée par le store. */
export interface WorkerRequest {
  type: "run";
  runId: number;
  candidates: ScreenerRow[];
  tf: string;
  klineLimit: number;
  indicatorConditions: IndicatorCondition[];
}

/** Réponses émises vers le store. */
export type WorkerResponse =
  | { type: "progress"; runId: number; done: number; total: number }
  | { type: "result"; runId: number; rows: ScreenerRow[] }
  | { type: "error"; runId: number; message: string };

// Contexte worker typé localement (la lib « webworker » n'est pas chargée dans ce
// tsconfig ; on n'expose que les deux méthodes utilisées, sans dépendre de son type).
const ctx = self as unknown as {
  postMessage(message: WorkerResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Télécharge et convertit les klines d'un symbole en bougies (champs OHLCV). */
async function fetchCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const url = `${KLINES_URL}?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(
    interval,
  )}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`klines ${res.status}`);
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) return [];
  const out: Candle[] = [];
  for (const k of raw) {
    if (!Array.isArray(k)) continue;
    out.push({
      time: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    });
  }
  return out;
}

/**
 * Évalue toutes les conditions indicateurs sur un jeu de bougies. Court-circuite dès
 * qu'une condition échoue (ou qu'un scalaire est indérivable). Renvoie aussi les valeurs
 * calculées, pour affichage sur les lignes qui passent.
 */
function evalIndicators(
  candles: Candle[],
  conditions: IndicatorCondition[],
): { pass: boolean; values: IndicatorValue[] } {
  const values: IndicatorValue[] = [];
  const close = lastClose(candles);
  for (const cond of conditions) {
    const spec = getIndicatorField(cond.fieldId);
    if (spec === undefined) return { pass: false, values };
    const def = getIndicator(spec.indicatorId);
    if (def === undefined) return { pass: false, values };

    const params: Record<string, number> = {};
    if (spec.paramKey !== undefined) {
      const p = cond.param ?? spec.defaultParam;
      if (p !== undefined) params[spec.paramKey] = p;
    }

    const result = computeIndicator(def, candles, params);
    const series = result.series[spec.output] ?? [];
    const scalar = deriveScalar(spec, series, close);
    if (scalar === undefined) return { pass: false, values };

    values.push({ label: indicatorConditionLabel(cond), value: scalar });
    if (!compareOp(scalar, cond.op, cond.value)) return { pass: false, values };
  }
  return { pass: true, values };
}

/** Traite tous les candidats en série, en émettant la progression. */
async function run(req: WorkerRequest): Promise<void> {
  const { runId, candidates, tf, klineLimit, indicatorConditions } = req;
  const survivors: ScreenerRow[] = [];
  const total = candidates.length;
  let done = 0;

  for (const cand of candidates) {
    const started = Date.now();
    try {
      const candles = await fetchCandles(cand.symbol, tf, klineLimit);
      const { pass, values } = evalIndicators(candles, indicatorConditions);
      if (pass) survivors.push({ ...cand, indicatorValues: values });
    } catch {
      // Symbole en échec (klines indisponibles, réseau) : ignoré, il ne passe pas.
    }
    done++;
    ctx.postMessage({ type: "progress", runId, done, total });

    // Throttle ~10 req/s (on déduit le temps déjà passé sur la requête + le calcul).
    const elapsed = Date.now() - started;
    if (done < total && elapsed < REQ_INTERVAL_MS) await sleep(REQ_INTERVAL_MS - elapsed);
  }

  ctx.postMessage({ type: "result", runId, rows: survivors });
}

ctx.addEventListener("message", (event) => {
  const req = event.data;
  if (req && req.type === "run") {
    void run(req).catch((err) =>
      ctx.postMessage({ type: "error", runId: req.runId, message: String(err) }),
    );
  }
});
