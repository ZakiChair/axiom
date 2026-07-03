/**
 * Rendements obligataires souverains — courbe des taux US (source primaire) + zone
 * euro AAA (source secondaire, ECB SDMX).
 *
 * SOURCE US : Daily Treasury Par Yield Curve, CSV officiel du Trésor américain
 *   GET https://home.treasury.gov/resource-center/data-chart-center/interest-rates/
 *       daily-treasury-rates.csv/{annee}/all?type=daily_treasury_yield_curve
 *       &field_tdr_date_value={annee}&_format=csv
 *   Colonnes : Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr",
 *              "3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"
 *   Dates au format MM/DD/YYYY, ligne la plus RÉCENTE en tête. Sans clé. Routé via le
 *   proxy /extapi (hôte `home.treasury.gov`, sans en-tête CORS + WAF exigeant un UA
 *   navigateur, fourni côté proxy).
 *
 * SOURCE ZONE EURO : ECB Data Portal SDMX, dataflow YC (courbe AAA, taux spot).
 *   GET /service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_{n}Y?lastNObservations=1
 *       &format=csvdata   → CSV SDMX avec une colonne OBS_VALUE (le taux %).
 *
 * Le PARSING (CSV → structure) est PUR et testé (treasuryYields.test.ts). Seuls les
 * `charger*` ont des effets de bord (fetch). L'année est calculée dans le wrapper
 * réseau (`new Date().getFullYear()`), JAMAIS dans une fonction pure. Dégradation
 * gracieuse : une source en panne → tableau/valeur absente, jamais d'exception propagée.
 */
import { extUrl } from "../extapi";
import { accesseurColonnes, parseCsv } from "./csv";

// ─────────────────────────── Types ───────────────────────────

/** Une observation de la courbe des taux à une date : taux (%) par maturité. */
export interface CourbeRendements {
  /** Date telle que fournie par la source US (« MM/DD/YYYY »). */
  date: string;
  /** Taux en POURCENT, indexés par le libellé de maturité (« 2 Yr », « 10 Yr »…). */
  rendements: Record<string, number>;
}

/** Maturités mises en avant dans le panneau (ordre d'affichage court → long). */
export const MATURITES_US: readonly string[] = ["3 Mo", "2 Yr", "5 Yr", "10 Yr", "30 Yr"];

// ─────────────────────────── Parsing PUR (US) ───────────────────────────

/**
 * Parse le CSV de la courbe des taux US en une liste d'observations, dans l'ORDRE de
 * la source (la plus récente en tête). Toute cellule non numérique (colonne absente,
 * champ vide « N/A ») est simplement omise des `rendements` de la ligne — jamais NaN.
 * Une ligne sans date exploitable est ignorée. Fonction PURE.
 */
export function parseTreasuryYieldCurveCsv(csv: string): CourbeRendements[] {
  const { entetes, lignes } = parseCsv(csv);
  if (entetes.length === 0) return [];
  const idxDate = entetes.indexOf("Date");
  if (idxDate === -1) return [];

  const out: CourbeRendements[] = [];
  for (const ligne of lignes) {
    const date = (ligne[idxDate] ?? "").trim();
    if (date.length === 0) continue;
    const rendements: Record<string, number> = {};
    for (let c = 0; c < entetes.length; c++) {
      if (c === idxDate) continue;
      const label = entetes[c]!;
      const brut = (ligne[c] ?? "").trim();
      if (brut.length === 0) continue;
      const v = Number(brut);
      if (Number.isFinite(v)) rendements[label] = v;
    }
    out.push({ date, rendements });
  }
  return out;
}

/**
 * Variation jour-sur-jour (en points de %) d'une maturité : première observation
 * moins la suivante. `null` si l'historique est trop court ou la valeur manquante.
 * Fonction PURE.
 */
export function deltaJour(courbes: CourbeRendements[], maturite: string): number | null {
  if (courbes.length < 2) return null;
  const a = courbes[0]!.rendements[maturite];
  const b = courbes[1]!.rendements[maturite];
  if (a === undefined || b === undefined) return null;
  return a - b;
}

/**
 * Écart 2 ans / 10 ans (« 2s10s », indicateur d'inversion de courbe) de la dernière
 * observation : 10 Yr − 2 Yr. Négatif = courbe inversée. `null` si indisponible.
 * Fonction PURE.
 */
export function spread2s10s(courbes: CourbeRendements[]): number | null {
  const derniere = courbes[0];
  if (!derniere) return null;
  const y2 = derniere.rendements["2 Yr"];
  const y10 = derniere.rendements["10 Yr"];
  if (y2 === undefined || y10 === undefined) return null;
  return y10 - y2;
}

// ─────────────────────────── Parsing PUR (ECB SDMX csvdata) ───────────────────────────

/**
 * Extrait la valeur d'observation (colonne `OBS_VALUE`) d'un CSV SDMX ECB à une seule
 * observation (lastNObservations=1). Renvoie `null` si la colonne/valeur est absente
 * ou non numérique. Fonction PURE.
 */
export function parseEcbObsValue(csv: string): number | null {
  const table = parseCsv(csv);
  if (table.lignes.length === 0) return null;
  const col = accesseurColonnes(table.entetes);
  const brut = col(table.lignes[0]!, "OBS_VALUE");
  if (brut === undefined || brut.length === 0) return null;
  const v = Number(brut);
  return Number.isFinite(v) ? v : null;
}

// ─────────────────────────── Chargement (effet de bord) ───────────────────────────

/** Réponse groupée du chargement des rendements souverains. */
export interface RendementsSouverains {
  /** Courbe US (récente en tête), vide si la source est indisponible. */
  us: CourbeRendements[];
  /** Rendements zone euro (AAA) par maturité, en %, si disponibles. */
  euro: Record<string, number>;
}

/** Maturités ECB récupérées (libellé affiché → suffixe SDMX de la série YC). */
const MATURITES_ECB: ReadonlyArray<{ label: string; sdmx: string }> = [
  { label: "2 Yr", sdmx: "SR_2Y" },
  { label: "10 Yr", sdmx: "SR_10Y" },
  { label: "30 Yr", sdmx: "SR_30Y" },
];

/**
 * Charge la courbe des taux US de l'année courante (effet de bord : fetch CSV texte).
 * L'année est résolue ICI (hors fonction pure). Dégradation gracieuse : renvoie []
 * en cas d'échec réseau/HTTP.
 */
export async function chargerRendementsUS(signal?: AbortSignal): Promise<CourbeRendements[]> {
  const annee = new Date().getFullYear();
  try {
    const chemin =
      `resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${annee}/all` +
      `?type=daily_treasury_yield_curve&field_tdr_date_value=${annee}&_format=csv`;
    const res = await fetch(extUrl("home.treasury.gov", chemin), { signal });
    if (!res.ok) return [];
    const csv = await res.text();
    return parseTreasuryYieldCurveCsv(csv);
  } catch {
    return [];
  }
}

/**
 * Charge les rendements AAA zone euro (2/10/30 ans) depuis l'ECB (effet de bord).
 * Chaque maturité est indépendante (Promise.allSettled) : une échéance en panne est
 * simplement absente du résultat. Renvoie {} si tout échoue.
 */
export async function chargerRendementsEuro(signal?: AbortSignal): Promise<Record<string, number>> {
  const resultats = await Promise.allSettled(
    MATURITES_ECB.map(async ({ label, sdmx }) => {
      const chemin =
        `service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.${sdmx}?lastNObservations=1&format=csvdata`;
      const res = await fetch(extUrl("data-api.ecb.europa.eu", chemin), { signal });
      if (!res.ok) throw new Error(`ECB ${sdmx} ${res.status}`);
      const v = parseEcbObsValue(await res.text());
      if (v === null) throw new Error(`ECB ${sdmx} valeur absente`);
      return { label, v };
    }),
  );
  const euro: Record<string, number> = {};
  for (const r of resultats) {
    if (r.status === "fulfilled") euro[r.value.label] = r.value.v;
  }
  return euro;
}

/**
 * Charge l'ensemble « rendements souverains » (US + zone euro) en parallèle, chaque
 * source dégradant indépendamment. N'échoue jamais : sections absentes si indisponibles.
 */
export async function chargerRendementsSouverains(
  signal?: AbortSignal,
): Promise<RendementsSouverains> {
  const [us, euro] = await Promise.all([
    chargerRendementsUS(signal),
    chargerRendementsEuro(signal),
  ]);
  return { us, euro };
}
