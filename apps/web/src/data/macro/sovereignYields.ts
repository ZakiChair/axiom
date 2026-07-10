/**
 * Rendements obligataires souverains — extension multi-pays : Japon, Canada, Australie.
 * Module FRÈRE de `treasuryYields.ts` (US + zone euro, inchangé) : mêmes types
 * (`CourbeRendements`), mêmes conventions (récente en tête, parsing PUR testé,
 * dégradation gracieuse → [] jamais d'exception propagée).
 *
 * SOURCE JAPON : MOF, courbe JGB du mois courant (quotidienne, 15 maturités 1Y→40Y).
 *   GET https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv
 *   Ligne 1 = TITRE (« Interest Rate (July 2026),…,(Unit : %) »), en-tête réel en ligne 2
 *   (« Date,1Y,2Y,…,40Y »), dates « AAAA/M/J » en ordre chronologique ASCENDANT.
 *   ⚠️ PIED DE PAGE PARASITE : une ligne finale « "  ※If you cannot download…" » dont la
 *   cellule Date N'EST PAS vide (texte Shift-JIS, mojibake après décodage UTF-8) — la
 *   garde est « au moins une maturité numérique », pas seulement « date non vide ».
 *   Sans CORS → routé via le proxy /extapi (hôte `www.mof.go.jp` whitelisté).
 *
 * SOURCE CANADA : Banque du Canada, Valet API (quotidienne, 2/3/5/7/10 ans — pas de
 * 30 ans sous ce nommage de séries).
 *   GET https://www.bankofcanada.ca/valet/observations/BD.CDN.{n}YR.DQ.YLD,…/json?recent=2
 *   Appel direct sans proxy /extapi (`Access-Control-Allow-Origin: *` vérifié en
 *   direct, cf. docs/research/04 §1bis), comme finnhub dans news.ts — la plupart des
 *   sources du repo passent par /extapi, le proxy serait ici un intermédiaire inutile.
 *
 * SOURCE AUSTRALIE : RBA, table F2 « Capital Market Yields – Government Bonds »
 * (quotidienne, 2/3/5/10 ans + obligation indexée 10 ans, historique depuis 2013).
 *   GET https://www.rba.gov.au/statistics/tables/csv/f2-data.csv
 *   Bloc de métadonnées en tête (Title/Description/…/Publication date), la ligne
 *   « Series ID,FCMYGBAG2D,… » sert d'en-tête réel ; dates « JJ-Mmm-AAAA » en ordre
 *   ASCENDANT, cellules vides fréquentes en début d'historique. Sans CORS → /extapi
 *   (hôte `www.rba.gov.au` whitelisté).
 *   ⚠️ EN PANNE EN PRATIQUE (constat empirique du 2026-07-11) : l'edge Akamai de
 *   www.rba.gov.au renvoie 403 (fingerprint TLS/client) à travers LES DEUX chemins
 *   proxy réels du repo — proxy Vite dev (http-proxy/node) ET daemon Bun ; seul
 *   undici passe, qu'aucun chemin n'utilise. Le chargeur dégrade en [] → la colonne
 *   Australie est vide (dégradation rendue VISIBLE dans MacroRatesWindow). Chargeur
 *   CONSERVÉ tel quel : si l'edge Akamai change ou si le réseau diffère, la colonne
 *   se remplit toute seule.
 */
import { extUrl } from "../extapi";
import { parseCsv } from "./csv";
import {
  chargerRendementsSouverains,
  type CourbeRendements,
  type RendementsSouverains,
} from "./treasuryYields";

// ─────────────────────────── Maturités par pays ───────────────────────────

/** Maturités JGB (libellés normalisés « N Yr », ordre court → long). */
export const MATURITES_JP: readonly string[] = [
  "1 Yr",
  "2 Yr",
  "3 Yr",
  "4 Yr",
  "5 Yr",
  "6 Yr",
  "7 Yr",
  "8 Yr",
  "9 Yr",
  "10 Yr",
  "15 Yr",
  "20 Yr",
  "25 Yr",
  "30 Yr",
  "40 Yr",
];

/** Séries Valet BoC récupérées (libellé affiché → id de série). */
const SERIES_BOC: ReadonlyArray<{ label: string; serie: string }> = [
  { label: "2 Yr", serie: "BD.CDN.2YR.DQ.YLD" },
  { label: "3 Yr", serie: "BD.CDN.3YR.DQ.YLD" },
  { label: "5 Yr", serie: "BD.CDN.5YR.DQ.YLD" },
  { label: "7 Yr", serie: "BD.CDN.7YR.DQ.YLD" },
  { label: "10 Yr", serie: "BD.CDN.10YR.DQ.YLD" },
];

/** Maturités canadiennes (ordre court → long). */
export const MATURITES_CA: readonly string[] = SERIES_BOC.map((s) => s.label);

/**
 * Libellé de l'obligation australienne indexée 10 ans (rendement RÉEL) : affichée au
 * tableau mais JAMAIS tracée sur la courbe nominale — `anneesDeMaturite` rejette ce
 * libellé (NaN), ce qui l'écarte automatiquement des points de `CourbeTaux`.
 */
export const MATURITE_AU_INDEXEE = "10 Yr (indexée)";

/** Séries RBA F2 récupérées (libellé affiché → Series ID de la table). */
const SERIES_RBA: ReadonlyArray<{ label: string; serie: string }> = [
  { label: "2 Yr", serie: "FCMYGBAG2D" },
  { label: "3 Yr", serie: "FCMYGBAG3D" },
  { label: "5 Yr", serie: "FCMYGBAG5D" },
  { label: "10 Yr", serie: "FCMYGBAG10D" },
  { label: MATURITE_AU_INDEXEE, serie: "FCMYGBAGID" },
];

/** Maturités australiennes (ordre court → long, indexée en dernier). */
export const MATURITES_AU: readonly string[] = SERIES_RBA.map((s) => s.label);

// ─────────────────────────── Parsing PUR (Japon, MOF) ───────────────────────────

/**
 * Parse le CSV JGB du MOF en observations « récente en tête » (la source est
 * chronologique ascendante → inversée ici). Les en-têtes « NY » sont normalisés en
 * « N Yr » (axe commun avec les autres pays). GARDE ANTI-LIGNE-FANTÔME : une ligne
 * sans AUCUNE maturité numérique est écartée (le pied de page Shift-JIS du fichier a
 * une cellule Date non vide — filtrer sur la date seule ne suffit pas). Fonction PURE.
 */
export function parseJgbCsv(csv: string): CourbeRendements[] {
  // La 1re ligne du fichier est un titre : l'en-tête réel (« Date,1Y,… ») est localisé.
  const lignesBrutes = csv.split(/\r?\n/);
  const idxEntete = lignesBrutes.findIndex((l) => l.startsWith("Date,"));
  if (idxEntete === -1) return [];
  const { entetes, lignes } = parseCsv(lignesBrutes.slice(idxEntete).join("\n"));

  const out: CourbeRendements[] = [];
  for (const ligne of lignes) {
    const date = (ligne[0] ?? "").trim();
    if (date.length === 0) continue;
    const rendements: Record<string, number> = {};
    for (let c = 1; c < entetes.length; c++) {
      const m = /^(\d+)Y$/.exec(entetes[c] ?? "");
      if (m === null) continue;
      const brut = (ligne[c] ?? "").trim();
      if (brut.length === 0) continue;
      const v = Number(brut);
      if (Number.isFinite(v)) rendements[`${m[1]} Yr`] = v;
    }
    if (Object.keys(rendements).length === 0) continue; // ligne-fantôme (pied de page)
    out.push({ date, rendements });
  }
  return out.reverse(); // ascendant → convention du repo « récente en tête »
}

// ─────────────────────────── Parsing PUR (Canada, BoC Valet) ───────────────────────────

/**
 * Parse la réponse JSON groupée de la Valet API (`observations` : une entrée par date,
 * chaque série présente sous son id avec `{ v: "2.80" }`). Les séries absentes d'une
 * date sont simplement omises. L'ordre n'étant pas contractuel, les observations sont
 * triées par date ISO décroissante (récente en tête). Fonction PURE.
 */
export function parseBocValetJson(json: unknown): CourbeRendements[] {
  if (typeof json !== "object" || json === null) return [];
  const obs = (json as { observations?: unknown }).observations;
  if (!Array.isArray(obs)) return [];

  const out: CourbeRendements[] = [];
  for (const o of obs) {
    if (typeof o !== "object" || o === null) continue;
    const ligne = o as Record<string, unknown>;
    const date = typeof ligne["d"] === "string" ? ligne["d"] : "";
    if (date.length === 0) continue;
    const rendements: Record<string, number> = {};
    for (const { label, serie } of SERIES_BOC) {
      const cellule = ligne[serie];
      if (typeof cellule !== "object" || cellule === null) continue;
      const brut = (cellule as { v?: unknown }).v;
      if (typeof brut !== "string" || brut.length === 0) continue;
      const v = Number(brut);
      if (Number.isFinite(v)) rendements[label] = v;
    }
    if (Object.keys(rendements).length === 0) continue;
    out.push({ date, rendements });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// ─────────────────────────── Parsing PUR (Australie, RBA F2) ───────────────────────────

/**
 * Parse le CSV F2 de la RBA en observations « récente en tête » (source ascendante →
 * inversée). Le bloc de métadonnées est sauté en localisant la ligne « Series ID » qui
 * sert d'en-tête réel : les colonnes sont identifiées par id de série (robuste au
 * réordonnancement), puis mappées sur les libellés de maturité communs. Les cellules
 * vides (fréquentes en début d'historique) sont omises ; une ligne sans aucune valeur
 * numérique est écartée. Fonction PURE.
 */
export function parseRbaF2Csv(csv: string): CourbeRendements[] {
  const lignesBrutes = csv.split(/\r?\n/);
  const idxSeries = lignesBrutes.findIndex((l) => l.startsWith("Series ID,"));
  if (idxSeries === -1) return [];
  const { entetes, lignes } = parseCsv(lignesBrutes.slice(idxSeries).join("\n"));

  // Index de colonne → libellé de maturité (seules les séries connues sont retenues).
  const labelParIndex = new Map<number, string>();
  entetes.forEach((id, i) => {
    const s = SERIES_RBA.find((x) => x.serie === id);
    if (s !== undefined) labelParIndex.set(i, s.label);
  });
  if (labelParIndex.size === 0) return [];

  const out: CourbeRendements[] = [];
  for (const ligne of lignes) {
    const date = (ligne[0] ?? "").trim();
    if (date.length === 0) continue;
    const rendements: Record<string, number> = {};
    for (const [i, label] of labelParIndex) {
      const brut = (ligne[i] ?? "").trim();
      if (brut.length === 0) continue;
      const v = Number(brut);
      if (Number.isFinite(v)) rendements[label] = v;
    }
    if (Object.keys(rendements).length === 0) continue;
    out.push({ date, rendements });
  }
  return out.reverse(); // ascendant → convention du repo « récente en tête »
}

// ─────────────────────────── Chargement (effet de bord) ───────────────────────────

/**
 * Charge la courbe JGB du mois courant depuis le MOF (effet de bord : fetch CSV via
 * /extapi). Dégradation gracieuse : [] en cas d'échec réseau/HTTP.
 */
export async function chargerRendementsJP(signal?: AbortSignal): Promise<CourbeRendements[]> {
  try {
    const res = await fetch(
      extUrl("www.mof.go.jp", "english/policy/jgbs/reference/interest_rate/jgbcme.csv"),
      { signal },
    );
    if (!res.ok) return [];
    return parseJgbCsv(await res.text());
  } catch {
    return [];
  }
}

/**
 * Charge la courbe canadienne depuis la Valet API de la BoC (effet de bord). Appel
 * direct sans proxy (CORS `*` confirmé), comme finnhub dans news.ts — la plupart des
 * sources du repo passent par /extapi (cf. en-tête de fichier).
 * `recent=2` : dernière observation + précédente (assez pour la variation jour).
 * Dégradation gracieuse : [] en cas d'échec réseau/HTTP.
 */
export async function chargerRendementsCA(signal?: AbortSignal): Promise<CourbeRendements[]> {
  try {
    const series = SERIES_BOC.map((s) => s.serie).join(",");
    const res = await fetch(
      `https://www.bankofcanada.ca/valet/observations/${series}/json?recent=2`,
      { signal },
    );
    if (!res.ok) return [];
    return parseBocValetJson(await res.json());
  } catch {
    return [];
  }
}

/**
 * Charge la courbe australienne depuis la table F2 de la RBA (effet de bord : fetch
 * CSV via /extapi). Dégradation gracieuse : [] en cas d'échec réseau/HTTP.
 * ⚠️ Constat empirique du 2026-07-11 : l'edge Akamai de www.rba.gov.au renvoie 403
 * (fingerprint TLS/client) via les DEUX chemins proxy du repo (proxy Vite dev
 * http-proxy/node ET daemon Bun — seul undici passe, qu'aucun chemin n'utilise) → en
 * pratique cette fonction renvoie [] aujourd'hui. GARDER le chargeur : si l'edge
 * Akamai change ou si le réseau diffère, la colonne se remplit toute seule (la
 * dégradation est rendue visible dans MacroRatesWindow, onglet Rendements).
 */
export async function chargerRendementsAU(signal?: AbortSignal): Promise<CourbeRendements[]> {
  try {
    const res = await fetch(extUrl("www.rba.gov.au", "statistics/tables/csv/f2-data.csv"), {
      signal,
    });
    if (!res.ok) return [];
    return parseRbaF2Csv(await res.text());
  } catch {
    return [];
  }
}

/** Réponse groupée « toutes courbes souveraines » : base US/zone euro + JP/CA/AU. */
export interface RendementsSouverainsMulti extends RendementsSouverains {
  /** Courbe JGB (récente en tête), vide si la source est indisponible. */
  jp: CourbeRendements[];
  /** Courbe canadienne (récente en tête), vide si la source est indisponible. */
  ca: CourbeRendements[];
  /** Courbe australienne (récente en tête), vide si la source est indisponible. */
  au: CourbeRendements[];
}

/**
 * Charge l'ensemble des courbes souveraines (US + zone euro + Japon + Canada +
 * Australie) en parallèle. Chaque pays dégrade INDÉPENDAMMENT (Promise.allSettled en
 * ceinture-bretelles : les chargeurs individuels ne rejettent déjà jamais). N'échoue
 * jamais : sections vides si indisponibles.
 */
export async function chargerRendementsSouverainsMulti(
  signal?: AbortSignal,
): Promise<RendementsSouverainsMulti> {
  const [base, jp, ca, au] = await Promise.allSettled([
    chargerRendementsSouverains(signal),
    chargerRendementsJP(signal),
    chargerRendementsCA(signal),
    chargerRendementsAU(signal),
  ]);
  return {
    us: base.status === "fulfilled" ? base.value.us : [],
    euro: base.status === "fulfilled" ? base.value.euro : {},
    jp: jp.status === "fulfilled" ? jp.value : [],
    ca: ca.status === "fulfilled" ? ca.value : [],
    au: au.status === "fulfilled" ? au.value : [],
  };
}
