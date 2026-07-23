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

/** Un point de la série de liquidité nette. */
export interface PointNetliq {
  /** Date ISO "YYYY-MM-DD" (UTC). */
  date: string;
  /** Liquidité nette en milliards de dollars (Md$) : walcl − tga − rrp. */
  netliq: number;
}

/** Durée en millisecondes de la fenêtre delta4s (≈ 4 semaines / 28 jours). */
const MS_28_JOURS = 28 * 24 * 60 * 60 * 1000;

/**
 * Renvoie une COPIE triée par date croissante d'une jambe FRED. Le tri lexicographique
 * des dates ISO "YYYY-MM-DD" équivaut au tri chronologique — d'où la tolérance au
 * désordre d'entrée.
 */
function trierParDate(jambe: PointFred[]): PointFred[] {
  return [...jambe].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * LOCF (Last Observation Carried Forward, NIVEAU) : dernière valeur d'une jambe TRIÉE
 * dont la date est ≤ `date`. Renvoie `null` si la jambe n'est pas encore amorcée à
 * cette date (aucune observation antérieure ou égale).
 */
function valeurLocf(jambeTriee: PointFred[], date: string): number | null {
  let valeur: number | null = null;
  for (const point of jambeTriee) {
    if (point.date <= date) valeur = point.valeur;
    else break;
  }
  return valeur;
}

/**
 * Construit la série de liquidité nette : netliq = walcl − tga − rrp.
 *
 * Axe des dates = UNION des dates des TROIS jambes (décision contrôleur : WALCL et TGA
 * sont HEBDO, seul RRP est quotidien — voir en-tête ; en pratique l'axe quotidien vient
 * du RRP). Chaque jambe est forward-fillée en NIVEAU (LOCF) depuis sa dernière valeur
 * connue, ce qui absorbe les jambes hebdo étalées sur les jours du RRP. Un point n'est
 * émis qu'une fois les 3 jambes amorcées (première date = max des premières dates).
 * Sortie triée chronologiquement. Fonction pure.
 */
export function serieNetliq(walcl: PointFred[], tga: PointFred[], rrp: PointFred[]): PointNetliq[] {
  const w = trierParDate(walcl);
  const t = trierParDate(tga);
  const r = trierParDate(rrp);

  // Union triée des dates des trois jambes (Set → dédoublonnage, puis tri chrono).
  const dates = [...new Set([...w, ...t, ...r].map((p) => p.date))].sort();

  const serie: PointNetliq[] = [];
  for (const date of dates) {
    const vw = valeurLocf(w, date);
    const vt = valeurLocf(t, date);
    const vr = valeurLocf(r, date);
    // Amorce : on n'émet que si les trois jambes ont une valeur connue à cette date.
    if (vw === null || vt === null || vr === null) continue;
    serie.push({ date, netliq: vw - vt - vr });
  }
  return serie;
}

/**
 * Statistiques de synthèse sur une série de liquidité nette (supposée triée chrono) :
 *   - `courant` : netliq du dernier point ;
 *   - `delta4s` : `courant` − netliq du DERNIER point situé à ≥ 28 jours avant le dernier
 *     t (variation ~4 semaines) ; `null` si aucun point n'est assez ancien ;
 *   - `min2a` / `max2a` : extrêmes de netliq sur toute la série (fenêtre ~2 ans).
 * Toutes les stats valent `null` pour une série vide. Fonction pure.
 */
export function statsNetliq(serie: PointNetliq[]): {
  courant: number | null;
  delta4s: number | null;
  min2a: number | null;
  max2a: number | null;
} {
  const dernier = serie[serie.length - 1];
  if (dernier === undefined) return { courant: null, delta4s: null, min2a: null, max2a: null };

  const courant = dernier.netliq;
  const seuilMs = Date.parse(dernier.date) - MS_28_JOURS;

  // Dernier point (le plus récent) dont la date est ≥ 28 jours avant le dernier t.
  let reference: number | null = null;
  for (const point of serie) {
    if (Date.parse(point.date) <= seuilMs) reference = point.netliq;
  }
  const delta4s = reference === null ? null : courant - reference;

  let min2a = courant;
  let max2a = courant;
  for (const point of serie) {
    if (point.netliq < min2a) min2a = point.netliq;
    if (point.netliq > max2a) max2a = point.netliq;
  }

  return { courant, delta4s, min2a, max2a };
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
