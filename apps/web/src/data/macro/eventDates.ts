/**
 * Dates d'évènements macro (EVTS — étude d'évènements).
 *
 * Fournit les horodatages EXACTS de publication de trois évènements qui font bouger
 * le marché, pour aligner la performance du prix autour de leurs dernières occurrences :
 *   - CPI US  (indice des prix à la consommation) — release FRED id 10, publié 08:30 ET ;
 *   - NFP     (Employment Situation / paie non agricole) — release FRED id 50, 08:30 ET ;
 *   - FOMC    (décision de taux directeur) — statique, décision publiée 14:00 ET.
 *
 * Sources :
 *   - CPI / NFP : dates HISTORIQUES + FUTURES via FRED `release/dates` (proxy /fredapi déjà
 *     câblé, cf. data/eco.ts). Exactes et complètes 2020 → présent, sans liste à maintenir.
 *   - FOMC : dates de décision codées en dur (aucun réseau) — l'historique 2020-2025 curé
 *     depuis les pages officielles de la Réserve fédérale + le futur 2026-2027 réutilisé
 *     depuis data/eco.ts (`FOMC_DATES`, source unique — pas de recopie).
 *
 * Parsing / calcul d'heure = PURS et testés (eventDates.test.ts). Seul `chargerDatesEvenement`
 * a un effet de bord (fetch + cache localStorage). Dégradation gracieuse : /fredapi en panne
 * → cache ; sans cache → [] (le composant EVTS affichera « CPI/NFP indisponibles »).
 */
import { FOMC_DATES } from "../eco";

// ─────────────────────────── Types & contrat ───────────────────────────

/** Type d'évènement étudié. */
export type TypeEvenement = "cpi" | "nfp" | "fomc";

/** Liste ordonnée des types (contrôles UI + libellés). */
export const TYPES_EVENEMENT: { id: TypeEvenement; label: string }[] = [
  { id: "cpi", label: "CPI US" },
  { id: "nfp", label: "NFP" },
  { id: "fomc", label: "FOMC" },
];

/** Une occurrence d'évènement, horodatée à la milliseconde UTC de publication. */
export interface DateEvenement {
  /** ms epoch UTC de la publication (heure ET convertie, DST calculé). */
  time: number;
  /** Jour de publication « YYYY-MM-DD » (clé lisible + regroupement). */
  ymd: string;
}

// ─────────────────────────── DST US (heure d'été, règle post-2007) ───────────────────────────

/** Jour du mois (1-31) du n-ième dimanche du mois (année, mois 0-indexé). */
function niemeDimanche(annee: number, mois0: number, n: number): number {
  const jourSemaine1er = new Date(Date.UTC(annee, mois0, 1)).getUTCDay(); // 0 = dimanche
  const premierDimanche = ((7 - jourSemaine1er) % 7) + 1;
  return premierDimanche + (n - 1) * 7;
}

/**
 * L'heure d'été US (EDT) s'applique-t-elle à cette date ? Règle fédérale post-2007 :
 * du 2ᵉ dimanche de mars (inclus) au 1er dimanche de novembre (exclu). On raisonne à
 * la granularité du JOUR : la bascule réelle a lieu à 02:00 locale, mais nos heures de
 * publication (08:30 / 14:00 ET) sont toutes postérieures à 02:00, donc le décalage du
 * jour de transition est déjà correct. Fonction PURE.
 */
export function estEteUs(ymd: string): boolean {
  const a = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const j = Number(ymd.slice(8, 10));
  const debutEte = Date.UTC(a, 2, niemeDimanche(a, 2, 2)); // 2ᵉ dimanche de mars (mois 2)
  const finEte = Date.UTC(a, 10, niemeDimanche(a, 10, 1)); // 1er dimanche de novembre (mois 10)
  const jour = Date.UTC(a, m - 1, j);
  return jour >= debutEte && jour < finEte;
}

// ─────────────────────────── Heure de publication (ET → UTC) ───────────────────────────

/** Heure locale (Eastern Time) de publication par type d'évènement. */
const HEURE_LOCALE_ET: Record<TypeEvenement, { h: number; min: number }> = {
  cpi: { h: 8, min: 30 }, // 08:30 ET
  nfp: { h: 8, min: 30 }, // 08:30 ET
  fomc: { h: 14, min: 0 }, // 14:00 ET (communiqué de décision)
};

/**
 * Horodatage UTC exact de la publication de `type` le jour `ymd`. Convertit l'heure ET
 * en UTC selon le DST US (EDT = UTC-4 en été, EST = UTC-5 en hiver). Fonction PURE.
 *
 * ⚠️ Approximation connue : les deux baisses d'urgence de mars 2020 (2020-03-03,
 * 2020-03-15) n'ont PAS été annoncées à 14:00 ET — on les ancre quand même à 14:00 ET
 * (heure marquée « approx. » côté fenêtre), leur horaire exact étant hors périmètre.
 */
export function tsPublicationUtc(ymd: string, type: TypeEvenement): number {
  const jour = Date.parse(`${ymd}T00:00:00Z`);
  const { h, min } = HEURE_LOCALE_ET[type];
  const decalageUtc = estEteUs(ymd) ? 4 : 5; // EDT = UTC-4, EST = UTC-5
  return jour + ((h + decalageUtc) * 60 + min) * 60 * 1000;
}

// ─────────────────────────── Parsing FRED release/dates ───────────────────────────

/** Réponse partielle de /fred/release/dates (seul `date` est exploité). */
interface ReponseReleaseDates {
  release_dates?: Array<{ date?: unknown }>;
}

/**
 * Parse /fred/release/dates → DateEvenement[] trié par temps croissant, dédoublonné par
 * jour, dates invalides (format ou calendrier) ignorées. `date` FRED = « YYYY-MM-DD »,
 * ancrée à l'heure de publication du type. Fonction PURE.
 */
export function parseReleaseDates(donnees: unknown, type: TypeEvenement): DateEvenement[] {
  const rep = donnees as ReponseReleaseDates | null;
  const liste = rep?.release_dates;
  if (!Array.isArray(liste)) return [];
  const parYmd = new Map<string, DateEvenement>();
  for (const r of liste) {
    const ymd = typeof r?.date === "string" ? r.date : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || parYmd.has(ymd)) continue;
    const time = tsPublicationUtc(ymd, type);
    if (!Number.isFinite(time)) continue; // ex. « 2025-13-99 » → NaN → ignoré
    parYmd.set(ymd, { time, ymd });
  }
  return [...parYmd.values()].sort((a, b) => a.time - b.time);
}

// ─────────────────────────── FOMC statique (historique + futur) ───────────────────────────

/**
 * Dates de DÉCISION du FOMC 2020-2025 (2ᵉ jour de chaque réunion, ou jour d'annonce pour
 * les décisions d'urgence). Curé depuis les calendriers officiels de la Réserve fédérale
 * (federalreserve.gov/monetarypolicy/fomccalendars.htm + fomchistorical2020.htm).
 *
 * La réunion programmée de mars 2020 (17-18) a été ANNULÉE : à sa place, deux baisses de
 * taux d'urgence (annoncées le 2020-03-03 et le 2020-03-15, dimanche), toutes deux
 * explicitement confirmées sur la page 2020 → INCLUSES. Le vote de notation du 22 août 2025
 * (pas une décision de réunion) est EXCLU. Les dates 2026-2027 viennent de `FOMC_DATES`
 * (data/eco.ts) — source unique, concaténée ci-dessous.
 */
const FOMC_DATES_HISTO: readonly string[] = [
  // 2020 — 7 réunions programmées (mars annulée) + 2 baisses d'urgence
  "2020-01-29",
  "2020-03-03", // baisse d'urgence (−50 pb)
  "2020-03-15", // baisse d'urgence (−100 pb, dimanche)
  "2020-04-29",
  "2020-06-10",
  "2020-07-29",
  "2020-09-16",
  "2020-11-05",
  "2020-12-16",
  // 2021
  "2021-01-27",
  "2021-03-17",
  "2021-04-28",
  "2021-06-16",
  "2021-07-28",
  "2021-09-22",
  "2021-11-03",
  "2021-12-15",
  // 2022
  "2022-01-26",
  "2022-03-16",
  "2022-05-04",
  "2022-06-15",
  "2022-07-27",
  "2022-09-21",
  "2022-11-02",
  "2022-12-14",
  // 2023
  "2023-02-01",
  "2023-03-22",
  "2023-05-03",
  "2023-06-14",
  "2023-07-26",
  "2023-09-20",
  "2023-11-01",
  "2023-12-13",
  // 2024
  "2024-01-31",
  "2024-03-20",
  "2024-05-01",
  "2024-06-12",
  "2024-07-31",
  "2024-09-18",
  "2024-11-07",
  "2024-12-18",
  // 2025
  "2025-01-29",
  "2025-03-19",
  "2025-05-07",
  "2025-06-18",
  "2025-07-30",
  "2025-09-17",
  "2025-10-29",
  "2025-12-10",
];

/** Dates FOMC fusionnées (historique 2020-2025 + futur 2026-2027), triées par temps. */
function datesFomc(): DateEvenement[] {
  const parYmd = new Map<string, DateEvenement>();
  for (const ymd of [...FOMC_DATES_HISTO, ...FOMC_DATES]) {
    if (parYmd.has(ymd)) continue; // dédoublonnage défensif (les deux listes ne se recouvrent pas)
    parYmd.set(ymd, { time: tsPublicationUtc(ymd, "fomc"), ymd });
  }
  return [...parYmd.values()].sort((a, b) => a.time - b.time);
}

// ─────────────────────────── Chargement (fetch + cache) ───────────────────────────

/** Release FRED par type (CPI = 10, NFP / Employment Situation = 50). */
const RELEASE_ID: Record<Exclude<TypeEvenement, "fomc">, number> = { cpi: 10, nfp: 50 };

/** TTL du cache : 24 h (le calendrier des publications bouge lentement). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheDates {
  ts: number;
  dates: DateEvenement[];
}

/** Lecture tolérante du cache (localStorage absent / JSON corrompu → null). Patron eco.ts. */
function lireCache(cle: string): CacheDates | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(cle);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<CacheDates> | null;
    if (!p || typeof p.ts !== "number" || !Array.isArray(p.dates)) return null;
    return { ts: p.ts, dates: p.dates as DateEvenement[] };
  } catch {
    return null;
  }
}

/** Écriture tolérante du cache (best-effort). Patron eco.ts. */
function ecrireCache(cle: string, dates: DateEvenement[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(cle, JSON.stringify({ ts: Date.now(), dates }));
  } catch {
    /* best-effort : la persistance des dates n'est pas bloquante */
  }
}

/**
 * Charge les dates d'un évènement (historique + futur), triées par temps croissant.
 *  - FOMC : statique, AUCUN réseau ;
 *  - CPI / NFP : cache localStorage frais (<24 h) → renvoyé ; sinon fetch FRED
 *    `release/dates` (clé injectée par le proxy /fredapi). Échec réseau → cache périmé
 *    s'il existe, sinon [] (dégradation gracieuse, aucune exception propagée).
 */
export async function chargerDatesEvenement(type: TypeEvenement): Promise<DateEvenement[]> {
  if (type === "fomc") return datesFomc();

  const cle = `axiom:evts:dates:v1:${type}`;
  const cache = lireCache(cle);
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.dates;

  try {
    const params = new URLSearchParams({
      release_id: String(RELEASE_ID[type]),
      include_release_dates_with_no_data: "true",
      realtime_start: "2020-01-01",
      limit: "1000",
      sort_order: "asc",
      file_type: "json",
    });
    // Clé injectée par le proxy /fredapi (.env) : aucune clé côté front.
    const res = await fetch(`/fredapi/fred/release/dates?${params.toString()}`);
    if (!res.ok) throw new Error(`FRED release/dates ${res.status}`);
    const json = (await res.json()) as unknown;
    const dates = parseReleaseDates(json, type);
    if (dates.length > 0) ecrireCache(cle, dates);
    return dates;
  } catch {
    return cache?.dates ?? []; // cache périmé en repli, sinon vide
  }
}
