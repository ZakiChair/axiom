/**
 * BGeometrics — bitcoin-data.com : indicateurs de VALORISATION BTC (MVRV Z-Score, SOPR, NUPL).
 *
 * Endpoints (JSON par métrique), routés en MÊME-ORIGINE via le proxy `/bgapi` (Vite en dev,
 * daemon en prod) — bitcoin-data.com n'expose pas de CORS pour l'auth par clé :
 *   GET /bgapi/v1/<metrique>?startday=YYYY-MM-DD&endday=YYYY-MM-DD
 *   Ex  : /bgapi/v1/mvrv-zscore  → [ { d, unixTs, mvrvZscore }, … ]
 *         /bgapi/v1/sopr         → [ { d, unixTs, sopr }, … ]
 *         /bgapi/v1/nupl         → [ { d, unixTs, nupl }, … ]
 *
 * ⚠️ AUTH & DÉBIT (vérifié en réel) : seul `Authorization: Bearer <clé>` est reconnu par
 *   bitcoin-data.com ; sans clé valide, l'amont retombe sur le quota IP (~15 req/jour).
 *   - Clé PERSONNELLE (Réglages) : envoyée `Authorization: Bearer <clé>` → prioritaire ;
 *     le proxy la relaie sans y toucher.
 *   - Clé de REPLI .env (BGEOMETRICS_API_KEY) : injectée par le proxy `/bgapi` si le front
 *     n'envoie aucun Authorization. Sa seule PRÉSENCE est exposée au bundle via
 *     `BG_CLE_ENV_PRESENTE` (booléen `define` — JAMAIS la valeur).
 *   - Quota : clé active (personnelle OU .env) → ~10 req/HEURE (compteur horaire, « x/10 h ») ;
 *     sinon quota IP ~15 req/JOUR (compteur journalier, « x/15 j »).
 *   - CACHE 24 h OBLIGATOIRE par métrique (3 métriques → 3 req/jour, largement sous la limite).
 *
 * ⚠️ VALEURS : le champ peut valoir la CHAÎNE "NaN" (jour manquant) → le parseur l'ignore.
 * `unixTs` est en SECONDES.
 */
import { ecrireCache, estFrais, lireCache } from "./cache";
import { healthStore } from "../../store/health";
import type { PointMetrique, SerieMetrique } from "./coinmetrics";

const BASE = "/bgapi/v1";
const SOURCE_SANTE = "bgeometrics";
/** TTL de cache : 24 h (quota 15 req/jour). */
export const BG_TTL_MS = 24 * 60 * 60 * 1000;
/** Limite journalière indicative (quota IP, sans clé — affichée en quota santé). */
export const BG_LIMITE_JOUR = 15;
/** Limite horaire indicative quand une clé est active (personnelle ou .env). */
export const BG_LIMITE_HEURE = 10;

/**
 * PRÉSENCE d'une clé .env BGeometrics côté proxy (booléen `define` injecté par Vite —
 * JAMAIS la valeur). `typeof` protège l'évaluation si le `define` n'est pas appliqué.
 */
declare const __BG_CLE_ENV__: boolean;
export const BG_CLE_ENV_PRESENTE: boolean =
  typeof __BG_CLE_ENV__ !== "undefined" ? __BG_CLE_ENV__ : false;

/** Une clé est-elle active ? Clé personnelle non vide OU repli .env présent. */
export function cleActive(cle?: string | null): boolean {
  return (typeof cle === "string" && cle.length > 0) || BG_CLE_ENV_PRESENTE;
}
/** Profondeur d'historique demandée (jours) pour la sparkline. */
const FENETRE_JOURS = 120;

/** Id interne d'une métrique BGeometrics (bitcoin-data.com, BTC uniquement). */
export type BgMetriqueId =
  | "mvrv" | "sopr" | "nupl" | "puell" | "reserveRisk" | "realizedPrice"
  // Comportement des détenteurs (aux chart-only, hors panneau OnchainWindow).
  | "asopr" | "sthSopr" | "lthSopr" | "rhodl"
  // Modèles de plancher de prix (overlays).
  | "cvdd" | "balancedPrice"
  // Structure de marché : dominance BTC (%). GLOBAL (pas gaté sur l'actif affiché).
  | "btcDominance";

/** Définition d'une métrique BGeometrics (id interne, chemin API, champ JSON, libellé). */
export interface DefMetriqueBg {
  id: BgMetriqueId;
  chemin: string;
  champ: string;
  libelle: string;
}

// Défs exportées individuellement (réutilisées par la couche aux du chart, cf. auxProvider).
export const BG_MVRV: DefMetriqueBg = { id: "mvrv", chemin: "mvrv-zscore", champ: "mvrvZscore", libelle: "MVRV Z-Score" };
export const BG_SOPR: DefMetriqueBg = { id: "sopr", chemin: "sopr", champ: "sopr", libelle: "SOPR" };
export const BG_NUPL: DefMetriqueBg = { id: "nupl", chemin: "nupl", champ: "nupl", libelle: "NUPL" };
export const BG_PUELL: DefMetriqueBg = { id: "puell", chemin: "puell-multiple", champ: "puellMultiple", libelle: "Puell Multiple" };
export const BG_RESERVE_RISK: DefMetriqueBg = { id: "reserveRisk", chemin: "reserve-risk", champ: "reserveRisk", libelle: "Reserve Risk" };
// Realized Price : prix moyen d'acquisition on-chain (USD). Overlay prix — hors panneau
// valorisation OnchainWindow (BG_METRIQUES), consommé uniquement par la couche aux.
export const BG_REALIZED_PRICE: DefMetriqueBg = { id: "realizedPrice", chemin: "realized-price", champ: "realizedPrice", libelle: "Realized Price" };
// Comportement des détenteurs — aux CHART-ONLY (hors BG_METRIQUES pour ne pas alourdir
// le burst de fetch d'OnchainWindow ni le quota 10 req/h).
export const BG_ASOPR: DefMetriqueBg = { id: "asopr", chemin: "asopr", champ: "asopr", libelle: "aSOPR" };
export const BG_STH_SOPR: DefMetriqueBg = { id: "sthSopr", chemin: "sth-sopr", champ: "sthSopr", libelle: "STH-SOPR" };
export const BG_LTH_SOPR: DefMetriqueBg = { id: "lthSopr", chemin: "lth-sopr", champ: "lthSopr", libelle: "LTH-SOPR" };
export const BG_RHODL: DefMetriqueBg = { id: "rhodl", chemin: "rhodl-ratio", champ: "rhodlRatio", libelle: "RHODL Ratio" };
// Modèles de plancher de prix (USD) — overlays sur le prix.
export const BG_CVDD: DefMetriqueBg = { id: "cvdd", chemin: "cvdd", champ: "cvdd", libelle: "CVDD" };
export const BG_BALANCED_PRICE: DefMetriqueBg = { id: "balancedPrice", chemin: "balanced-price", champ: "balancedPrice", libelle: "Balanced Price" };
// Dominance BTC (% de la capitalisation crypto totale) — métrique GLOBALE de marché.
export const BG_BTC_DOMINANCE: DefMetriqueBg = { id: "btcDominance", chemin: "bitcoin-dominance", champ: "bitcoinDominance", libelle: "Dominance BTC" };

export const BG_METRIQUES: readonly DefMetriqueBg[] = [
  BG_MVRV,
  BG_SOPR,
  BG_NUPL,
  BG_PUELL,
  BG_RESERVE_RISK,
];

/** Résultat d'une métrique : série + fraîcheur + horodatage de la donnée. */
export interface BgResultat {
  serie: SerieMetrique;
  ts: number;
  perime: boolean;
}

/**
 * Parse une réponse BGeometrics (tableau de points datés) en série pour `champ`.
 * PURE et tolérante : ignore null / "NaN" / valeurs non finies. `unixTs` en SECONDES.
 */
export function parseBgeometrics(json: unknown, champ: string): SerieMetrique {
  const points: PointMetrique[] = [];
  if (Array.isArray(json)) {
    for (const brut of json) {
      const row = brut as Record<string, unknown>;
      const time = Number(row["unixTs"]) * 1000;
      if (!Number.isFinite(time)) continue;
      const v = row[champ];
      if (v === null || v === undefined) continue;
      const value = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(value)) continue; // absorbe la chaîne "NaN"
      points.push({ time, value });
    }
  }
  points.sort((a, b) => a.time - b.time);
  return { points, dernier: points.length > 0 ? points[points.length - 1] : undefined };
}

// ─────────────────────────── Compteur de quota (horaire si clé active, sinon journalier) ───────────────────────────

/**
 * Clé de stockage localStorage du compteur : horaire (`YYYY-MM-DD-HH`) quand une clé est
 * active (quota ~10 req/h), sinon journalière (`YYYY-MM-DD`, quota IP ~15 req/jour). PURE.
 */
export function cleStockageQuota(actif: boolean, maintenant: Date = new Date()): string {
  const iso = maintenant.toISOString();
  const suffixe = actif ? iso.slice(0, 13).replace("T", "-") : iso.slice(0, 10);
  return `axiom:onchain:bg:count:${suffixe}`;
}

/** Limite affichée selon l'activation d'une clé (horaire 10, sinon journalière 15). PURE. */
export function limiteQuota(actif: boolean): number {
  return actif ? BG_LIMITE_HEURE : BG_LIMITE_JOUR;
}

/** Lit le compteur de la fenêtre courante (best-effort). */
function lireCompteur(actif: boolean): number {
  try {
    return Number(localStorage.getItem(cleStockageQuota(actif))) || 0;
  } catch {
    return 0;
  }
}

/** Incrémente le compteur de la fenêtre courante et renvoie la nouvelle valeur. */
function incrementerCompteur(actif: boolean): number {
  const cle = cleStockageQuota(actif);
  const n = lireCompteur(actif) + 1;
  try {
    localStorage.setItem(cle, String(n));
  } catch {
    /* best-effort */
  }
  return n;
}

/** Publie le quota courant (sans incrémenter) dans le store santé. */
export function publierQuotaBg(cle?: string | null): void {
  const actif = cleActive(cle);
  healthStore.getState().setQuota(SOURCE_SANTE, {
    utilise: lireCompteur(actif),
    limite: limiteQuota(actif),
    fenetre: actif ? "1heure" : "1jour",
  });
}

// ─────────────────────────── Fetch ───────────────────────────

function construireUrl(chemin: string): string {
  const fin = new Date();
  const debut = new Date(fin.getTime() - FENETRE_JOURS * 86_400_000);
  const params = new URLSearchParams({
    startday: debut.toISOString().slice(0, 10),
    endday: fin.toISOString().slice(0, 10),
  });
  return `${BASE}/${chemin}?${params.toString()}`;
}

/**
 * Récupère UNE métrique BGeometrics (cache 24 h, dégradation gracieuse). Renvoie le
 * dernier cache — même périmé — si le réseau échoue ; `null` si rien en cache.
 * N'effectue un appel réseau (et n'incrémente le compteur) QUE sur cache absent/périmé.
 */
export async function fetchBgeometricMetrique(
  def: DefMetriqueBg,
  cle?: string | null,
  signal?: AbortSignal,
): Promise<BgResultat | null> {
  const cacheCle = `bg:${def.id}`;
  const cache = await lireCache<SerieMetrique>(cacheCle);
  if (estFrais(cache, BG_TTL_MS) && cache !== null) {
    return { serie: cache.donnee, ts: cache.ts, perime: false };
  }

  const actif = cleActive(cle);
  const headers: Record<string, string> = {};
  // Clé personnelle envoyée `Bearer` (seul format reconnu) ; le repli .env est injecté
  // côté proxy `/bgapi` quand aucun Authorization n'est envoyé ici.
  if (cle) headers["Authorization"] = `Bearer ${cle}`;

  try {
    const compteur = incrementerCompteur(actif);
    publierQuotaBg(cle);
    const res = await fetch(construireUrl(def.chemin), { headers, signal });
    if (!res.ok) throw new Error(`BGeometrics ${def.id} ${res.status}`);
    const json = (await res.json()) as unknown;
    const serie = parseBgeometrics(json, def.champ);
    await ecrireCache(cacheCle, serie);
    healthStore
      .getState()
      .setEtat(SOURCE_SANTE, "polling", {
        dernierMessageTs: Date.now(),
        quota: { utilise: compteur, limite: limiteQuota(actif), fenetre: actif ? "1heure" : "1jour" },
      });
    return { serie, ts: Date.now(), perime: false };
  } catch (e) {
    if (signal?.aborted) return cache ? { serie: cache.donnee, ts: cache.ts, perime: true } : null;
    healthStore.getState().marquerErreur(SOURCE_SANTE, e instanceof Error ? e.message : "échec");
    if (cache !== null) return { serie: cache.donnee, ts: cache.ts, perime: true };
    return null;
  }
}

/** Récupère les 3 métriques de valorisation en parallèle (chacune indépendamment cachée). */
export async function fetchBgeometrics(
  cle?: string | null,
  signal?: AbortSignal,
): Promise<Record<string, BgResultat | null>> {
  publierQuotaBg(cle);
  const resultats = await Promise.all(
    BG_METRIQUES.map(async (def) => [def.id, await fetchBgeometricMetrique(def, cle, signal)] as const),
  );
  return Object.fromEntries(resultats);
}
