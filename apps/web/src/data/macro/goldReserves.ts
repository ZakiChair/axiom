/**
 * Réserves d'or officielles par pays — source IMF SDMX 3.0, dataflow IRFCL.
 *
 * Indicateur RÉSOLU EN DIRECT (2026-07-03, via le codelist CL_IRFCL_INDICATOR_PUB) :
 *   IRFCLDT1_IRFCL56V_FTO = « Official reserve assets, gold volume in fine troy ounces ».
 * La valeur d'observation est en ONCES TROY FINES ; on la convertit en TONNES
 * (÷ 32 150,7465). Vérifié : USA 261 499 000 oz → 8 133,5 t, DEU → 3 349,5 t,
 * CHN → 2 331,5 t (concordent avec le World Gold Council au dixième de tonne près).
 *
 * Requête (clé de dimensions COUNTRY.INDICATOR.SECTOR.FREQUENCY, jokers `*`) :
 *   GET https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.STA/IRFCL/12.0.0/
 *       *.IRFCLDT1_IRFCL56V_FTO.*.M?lastNObservations=1&format=jsondata
 *   Renvoie ~85 pays. Sans clé (confirmé HTTP 200 sans auth). Routé via /extapi
 *   (hôte `api.imf.org`).
 *
 * HYGIÈNE DES DONNÉES (le brut IMF contient des scories) :
 *   1. Codes AGRÉGATS / institutionnels (G163, EZB…) : écartés — non présents dans la
 *      table de noms curée `NOMS_PAYS_OR`.
 *   2. Quelques déclarants au chiffre CORROMPU (ex. BRA ≈ 172 000 t, AGO ≈ 18 000 t,
 *      valeurs manifestement mal échelonnées à la source) : écartés par un PLAFOND de
 *      plausibilité — aucun État souverain ne dépasse ~8 200 t (USA, le plus gros
 *      détenteur). Un chiffre erroné est ainsi ABSENT plutôt que faux (cf. convention
 *      de fiabilité : dégrader vers l'absence, jamais vers une valeur trompeuse).
 *
 * Le parsing SDMX-JSON (→ liste triée) est PUR et testé (goldReserves.test.ts). Seul
 * `chargerReservesOr` a un effet de bord. Aucune exception propagée à l'UI.
 */
import { fetchJsonExt } from "../binanceDapi";

// ─────────────────────────── Constantes ───────────────────────────

/** Onces troy fines dans une tonne métrique (conversion volume → tonnes). */
export const ONCES_TROY_PAR_TONNE = 32150.7465;

/**
 * Plafond de plausibilité (tonnes). Le plus gros détenteur souverain (USA) tourne
 * autour de 8 133 t ; une valeur au-delà de ce seuil trahit une donnée source
 * corrompue (mauvaise échelle) → écartée. Marge confortable au-dessus du réel.
 */
export const PLAFOND_TONNES = 10000;

/** Indicateur IRFCL du volume d'or (onces troy fines). */
export const INDICATEUR_OR_FTO = "IRFCLDT1_IRFCL56V_FTO";

/**
 * Table CURÉE des grands détenteurs souverains : code pays ISO-3 (codelist IMF
 * CL_IRFCL_COUNTRY_PUB) → nom d'affichage FR. Sert AUSSI de filtre d'inclusion : tout
 * code hors de cette table (agrégats G163/EZB, micro-déclarants au chiffre douteux)
 * est écarté du classement. Couvre les ~40 premières nations par tonnage.
 */
export const NOMS_PAYS_OR: Record<string, string> = {
  USA: "États-Unis",
  DEU: "Allemagne",
  ITA: "Italie",
  FRA: "France",
  CHN: "Chine",
  RUS: "Russie",
  CHE: "Suisse",
  IND: "Inde",
  JPN: "Japon",
  TUR: "Turquie",
  NLD: "Pays-Bas",
  POL: "Pologne",
  PRT: "Portugal",
  KAZ: "Kazakhstan",
  SAU: "Arabie saoudite",
  GBR: "Royaume-Uni",
  ESP: "Espagne",
  AUT: "Autriche",
  THA: "Thaïlande",
  BEL: "Belgique",
  SGP: "Singapour",
  PHL: "Philippines",
  EGY: "Égypte",
  SWE: "Suède",
  ZAF: "Afrique du Sud",
  MEX: "Mexique",
  GRC: "Grèce",
  HUN: "Hongrie",
  KOR: "Corée du Sud",
  ROU: "Roumanie",
  IDN: "Indonésie",
  CZE: "Tchéquie",
  AUS: "Australie",
  DNK: "Danemark",
  BRA: "Brésil",
  QAT: "Qatar",
  IRQ: "Irak",
  ARE: "Émirats arabes unis",
  PER: "Pérou",
  UKR: "Ukraine",
  DZA: "Algérie",
  LBY: "Libye",
  ARG: "Argentine",
};

// ─────────────────────────── Types ───────────────────────────

/** Réserve d'or d'un pays (unité : tonnes). */
export interface ReserveOr {
  /** Code pays ISO-3. */
  pays: string;
  /** Nom d'affichage FR. */
  nom: string;
  /** Réserve en TONNES métriques. */
  tonnes: number;
  /** Période de l'observation (« YYYY-Mnn »). */
  periode: string;
}

// ─────────────────────────── Parsing PUR (SDMX-JSON) ───────────────────────────

/** Forme partielle d'une réponse SDMX-JSON « jsondata » (champs utiles). */
interface SdmxDimension {
  id?: unknown;
  values?: Array<{ id?: unknown; value?: unknown }>;
}
interface SdmxSdmxJson {
  data?: {
    structures?: Array<{
      dimensions?: {
        series?: SdmxDimension[];
        observation?: SdmxDimension[];
      };
    }>;
    dataSets?: Array<{
      series?: Record<string, { observations?: Record<string, Array<unknown>> }>;
    }>;
  };
}

/**
 * Parse la réponse SDMX-JSON IRFCL en un classement des réserves d'or par pays
 * (tonnes), DÉCROISSANT. Applique l'hygiène des données : inclusion via `NOMS_PAYS_OR`,
 * plafond de plausibilité, déduplication par pays (on garde la plus grande valeur si
 * plusieurs séries/secteurs) et conversion onces → tonnes. Renvoie [] si la structure
 * est absente/inattendue. Fonction PURE.
 */
export function parseImfGoldReserves(json: unknown): ReserveOr[] {
  const racine = json as SdmxSdmxJson | null;
  const structure = racine?.data?.structures?.[0];
  const dimsSeries = structure?.dimensions?.series;
  const dimsObs = structure?.dimensions?.observation?.[0]?.values;
  const series = racine?.data?.dataSets?.[0]?.series;
  if (!Array.isArray(dimsSeries) || !Array.isArray(dimsObs) || !series) return [];

  // Position de la dimension COUNTRY dans la clé de série, et ses codes ISO-3.
  const posPays = dimsSeries.findIndex((d) => d.id === "COUNTRY");
  if (posPays === -1) return [];
  const codesPays = (dimsSeries[posPays]?.values ?? []).map((v) =>
    typeof v.id === "string" ? v.id : "",
  );
  const periodes = dimsObs.map((v) => (typeof v.value === "string" ? v.value : ""));

  // Meilleure (plus grande) réserve retenue par pays.
  const parPays = new Map<string, { tonnes: number; periode: string }>();
  for (const [cle, valeur] of Object.entries(series)) {
    const segments = cle.split(":");
    const idxPays = Number(segments[posPays]);
    const pays = codesPays[idxPays];
    if (pays === undefined || pays.length === 0) continue;
    const nom = NOMS_PAYS_OR[pays];
    if (nom === undefined) continue; // hors table curée (agrégat / micro-déclarant)

    // Observation la plus récente de cette série.
    const observations = valeur?.observations ?? {};
    let meilleur: { tonnes: number; periode: string } | null = null;
    for (const [tpIdx, obs] of Object.entries(observations)) {
      const brut = Array.isArray(obs) ? obs[0] : undefined;
      const onces = typeof brut === "string" ? Number(brut) : typeof brut === "number" ? brut : NaN;
      if (!Number.isFinite(onces) || onces <= 0) continue;
      const tonnes = onces / ONCES_TROY_PAR_TONNE;
      if (tonnes > PLAFOND_TONNES) continue; // donnée source corrompue → écartée
      const periode = periodes[Number(tpIdx)] ?? "";
      if (meilleur === null || periode > meilleur.periode) meilleur = { tonnes, periode };
    }
    if (meilleur === null) continue;
    const existant = parPays.get(pays);
    if (existant === undefined || meilleur.tonnes > existant.tonnes) {
      parPays.set(pays, meilleur);
    }
  }

  const out: ReserveOr[] = [];
  for (const [pays, { tonnes, periode }] of parPays) {
    out.push({ pays, nom: NOMS_PAYS_OR[pays]!, tonnes, periode });
  }
  out.sort((a, b) => b.tonnes - a.tonnes);
  return out;
}

// ─────────────────────────── Chargement (effet de bord) ───────────────────────────

/**
 * Charge le classement des réserves d'or par pays (effet de bord : fetch SDMX-JSON via
 * /extapi). Dégradation gracieuse : renvoie [] en cas d'échec réseau/HTTP/parse.
 */
export async function chargerReservesOr(): Promise<ReserveOr[]> {
  try {
    const chemin =
      `external/sdmx/3.0/data/dataflow/IMF.STA/IRFCL/12.0.0/` +
      `*.${INDICATEUR_OR_FTO}.*.M?lastNObservations=1&format=jsondata`;
    const json = await fetchJsonExt("api.imf.org", chemin);
    return parseImfGoldReserves(json);
  } catch {
    return [];
  }
}
