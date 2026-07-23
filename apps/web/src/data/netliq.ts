/**
 * NETLIQ — Liquidité nette de la Fed : WALCL − WTREGEN − RRPONTSYD.
 *
 * Cette partie (Task 1) ne fait QUE le fetch des trois séries FRED, en réutilisant
 * EXACTEMENT le chemin M2 existant (`createFredM2Provider`, data/macro/fred.ts) :
 * même URL proxifiée `/fredapi`, même injection de clé (proxy .env ou clé perso
 * localStorage), même parseur qui écarte les valeurs manquantes `"."` (Number(".")
 * → NaN → point ignoré). Le calcul (Task 2) et le store/fenêtre (Task 3+) suivront.
 *
 * ─── PREUVE LIVE (vérifiée le 2026-07-23 via curl sur le proxy dev :5174) ──────────
 * Endpoint /fred/series (métadonnées) et /fred/series/observations :
 *
 *   WALCL     — « Total Assets … Wednesday Level »
 *               frequency = "Weekly, As of Wednesday"      (HEBDO)
 *               units     = "Millions of U.S. Dollars"     → ÷ 1000 pour des Md$
 *               ex. 2026-07-15 ≈ 6 735 609 M$  ≈ 6 735,6 Md$
 *               0 valeur "." sur 104 points (fenêtre 2 ans).
 *
 *   WTREGEN   — « U.S. Treasury, General Account: Week Average » (le TGA)
 *               frequency = "Weekly, Ending Wednesday"      (HEBDO — voir RÉSERVE)
 *               units     = "Millions of U.S. Dollars"     → ÷ 1000 pour des Md$
 *               ex. 2026-06-24 ≈ 918 696 M$   ≈ 918,7 Md$
 *               0 valeur "." sur 104 points (fenêtre 2 ans).
 *
 *   RRPONTSYD — « Overnight Reverse Repurchase Agreements … » (le RRP)
 *               frequency = "Daily"                         (QUOTIDIEN)
 *               units     = "Billions of US Dollars"        → × 1 (déjà en Md$)
 *               ex. 2026-06-02 ≈ 2,502 Md$
 *               24 valeurs "." sur 522 points (fenêtre 2 ans) — week-ends/fériés
 *               intercalés ; écartées par le parseur réutilisé.
 *
 * ⚠️ RÉSERVE pour la Task 2 : WTREGEN (TGA) est HEBDOMADAIRE, pas quotidien —
 *    contrairement à l'hypothèse « axe = union des dates quotidiennes de tga/rrp »
 *    du plan. Seul RRPONTSYD est réellement quotidien ; WALCL et WTREGEN sont hebdo.
 *    Le LOCF (niveau, forward-fill) prévu sur CHAQUE jambe absorbe cette différence,
 *    mais l'axe des dates quotidiennes viendra essentiellement de RRPONTSYD.
 *    (Alternative écartée : WDTGAL est lui aussi hebdo « Wednesday Level » — il n'existe
 *    pas de TGA quotidien trivial dans cette famille FRED.)
 * ──────────────────────────────────────────────────────────────────────────────────
 */
import { createFredM2Provider } from "./macro/fred";
import type { MacroSeries } from "./macro/types";

/** Un point d'une série FRED normalisée. */
export interface PointFred {
  /** Date ISO "YYYY-MM-DD" (UTC). */
  date: string;
  /** Valeur en MILLIARDS de dollars (Md$), APRÈS normalisation d'unité. */
  valeur: number;
}

/** Identifiants FRED des trois jambes (vérifiés live — voir PREUVE ci-dessus). */
const SERIE_WALCL = "WALCL";
const SERIE_TGA = "WTREGEN";
const SERIE_RRP = "RRPONTSYD";

/**
 * Facteurs de normalisation vers les MILLIARDS de dollars, par jambe (unités FRED
 * constatées live) :
 *   - WALCL / WTREGEN : « Millions of U.S. Dollars » → ÷ 1000  (1e-3)
 *   - RRPONTSYD       : « Billions of US Dollars »   → × 1     (déjà en Md$)
 */
const FACTEUR_MILLIONS_VERS_MILLIARDS = 1e-3;
const FACTEUR_DEJA_MILLIARDS = 1;

/** Convertit un horodatage ms (UTC) en date FRED "YYYY-MM-DD". */
function versDateIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Normalise une série macro brute (MacroPoint[] : {time ms, value}) en PointFred[]
 * (date ISO + valeur en Md$). Pur et testable sans réseau. L'ordre est préservé.
 * @param facteur facteur multiplicatif d'unité (voir constantes FACTEUR_*).
 */
export function normaliserSerie(brute: MacroSeries, facteur: number): PointFred[] {
  return brute.map((p) => ({ date: versDateIso(p.time), valeur: p.value * facteur }));
}

/** Recule un horodatage de deux années calendaires (UTC). */
function ilYaDeuxAns(nowMs: number): number {
  const d = new Date(nowMs);
  d.setUTCFullYear(d.getUTCFullYear() - 2);
  return d.getTime();
}

/**
 * Récupère une série FRED via le chemin M2 réutilisé, filtrée depuis `debutMs`,
 * puis normalisée en Md$.
 */
async function fetchSerieFred(seriesId: string, debutMs: number, facteur: number): Promise<PointFred[]> {
  const brute = await createFredM2Provider(seriesId).fetchSeries({ start: debutMs });
  return normaliserSerie(brute, facteur);
}

/**
 * Récupère les trois séries FRED de la liquidité nette, sur une fenêtre de 2 ans
 * (observation_start = nowMs − 2 ans), chacune normalisée en milliards de dollars.
 */
export async function fetchSeriesNetliq(
  nowMs: number,
): Promise<{ walcl: PointFred[]; tga: PointFred[]; rrp: PointFred[] }> {
  const debutMs = ilYaDeuxAns(nowMs);
  const [walcl, tga, rrp] = await Promise.all([
    fetchSerieFred(SERIE_WALCL, debutMs, FACTEUR_MILLIONS_VERS_MILLIARDS),
    fetchSerieFred(SERIE_TGA, debutMs, FACTEUR_MILLIONS_VERS_MILLIARDS),
    fetchSerieFred(SERIE_RRP, debutMs, FACTEUR_DEJA_MILLIARDS),
  ]);
  return { walcl, tga, rrp };
}
