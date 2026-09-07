/**
 * Catalogue déclaratif des séries macroéconomiques — SOURCE UNIQUE des identifiants amont.
 *
 * Eurostat a rebasé son HICP (ECOICOP v2 : la dimension est `coicop18`, le poste global
 * `TOTAL`), l'OCDE versionne ses dataflows et l'ONS a décommissionné son ancienne API en
 * 2024. Toute rupture amont se corrige DANS CE SEUL FICHIER, sans rouvrir un transport.
 *
 * Tous les identifiants ci-dessous ont été vérifiés en live le 2026-09-06 (HTTP 200 avec
 * observations). Les valeurs citées en commentaire servent d'oracles de relecture — elles
 * ne sont JAMAIS fetchées par un test.
 *
 * RÈGLE D'AXE UNIQUE : l'onglet n'affiche que des pourcentages. Chaque série entre donc en
 * taux ou en glissement annuel, servi NATIVEMENT par sa source — aucun calcul maison.
 */
import type { FrequenceMacro } from "./harmonisation";

/** Les six zones économiques suivies. L'ordre fixe l'affichage ET la couleur de série. */
export type RegionMacro = "US" | "EZ" | "UK" | "JP" | "CN" | "IN";

/** Ordre d'affichage : l'index + 1 donne le token de couleur `--serie-N` (1…6). */
export const ORDRE_REGIONS: readonly RegionMacro[] = ["US", "EZ", "UK", "JP", "CN", "IN"];

/** Indicateurs disponibles. Le lot 1 n'en livre qu'un : la seule ligne comparable 6/6. */
export type IndicateurMacro = "cpi-aa";

/** Paramètres de récupération, propres à chaque transport (union discriminée). */
export type SourceMacro =
  | { transport: "fred"; seriesId: string; units?: string }
  | { transport: "oecd"; dataflow: string; cle: string }
  | { transport: "eurostat"; dataset: string; filtres: Record<string, string> }
  | { transport: "ons"; chemin: string };

/** Une série du catalogue. */
export interface DefinitionSerieMacro {
  /** Identifiant stable, ex. « cpi-aa-us ». Sert de clé de cache et de cible aux ponts ECO. */
  id: string;
  region: RegionMacro;
  indicateur: IndicateurMacro;
  /** Libellé de légende, ex. « États-Unis ». */
  libelleRegion: string;
  frequence: FrequenceMacro;
  source: SourceMacro;
  /** Vrai si une clé API est nécessaire (FRED seul). Pilote l'état « sans clé ». */
  cleRequise: boolean;
  /**
   * Étiquette de périmètre à AFFICHER quand la définition dévie de celle des autres
   * régions (« core-core », « extra-EA »…). Absente quand le périmètre est standard.
   */
  perimetre?: string;
}

/** Indicateurs déclarés, dans l'ordre du sélecteur. */
export const INDICATEURS_MACRO: ReadonlyArray<{
  id: IndicateurMacro;
  label: string;
  description: string;
}> = [
  {
    id: "cpi-aa",
    label: "Inflation (a/a)",
    description: "Indice des prix à la consommation, glissement annuel en %.",
  },
];

/**
 * Le catalogue. Un appel OCDE PAR PAYS : une clé multi-pays (« CHN+IND ») tronque
 * silencieusement la seconde série en HTTP 200 — mesuré le 2026-09-06.
 */
export const CATALOGUE_MACRO: readonly DefinitionSerieMacro[] = [
  {
    id: "cpi-aa-us",
    region: "US",
    indicateur: "cpi-aa",
    libelleRegion: "États-Unis",
    frequence: "M",
    cleRequise: true,
    // FRED sert le glissement annuel via units=pc1. Oracle : 2026-07 ≈ 3,30 %.
    source: { transport: "fred", seriesId: "CPIAUCSL", units: "pc1" },
  },
  {
    id: "cpi-aa-ez",
    region: "EZ",
    indicateur: "cpi-aa",
    libelleRegion: "Zone euro",
    frequence: "M",
    cleRequise: false,
    // ECOICOP v2 : dimension `coicop18`, poste `TOTAL`. Oracle : 2026-08 = 3,2 %.
    // `prc_hicp_manr` est ARCHIVÉ (son label annonce « (1997-2025) »), ne pas l'employer.
    source: {
      transport: "eurostat",
      dataset: "prc_hicp_minr",
      filtres: { freq: "M", unit: "RCH_A", coicop18: "TOTAL", geo: "EA21" },
    },
  },
  {
    id: "cpi-aa-uk",
    region: "UK",
    indicateur: "cpi-aa",
    libelleRegion: "Royaume-Uni",
    frequence: "M",
    cleRequise: false,
    // Hôte www.ons.gov.uk — api.ons.gov.uk est DÉCOMMISSIONNÉE (retirée le 25/11/2024).
    // Oracle : 2026-07 = 2,9 %.
    source: {
      transport: "ons",
      chemin: "economy/inflationandpriceindices/timeseries/d7g7/mm23/data",
    },
  },
  {
    id: "cpi-aa-jp",
    region: "JP",
    indicateur: "cpi-aa",
    libelleRegion: "Japon",
    frequence: "M",
    cleRequise: false,
    // Le Japon vit dans un dataflow DISTINCT (COICOP2018). Oracle : 2026-07 = 1,9 %.
    source: {
      transport: "oecd",
      dataflow: "OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0",
      cle: "JPN.M.N.CPI.PA._T.N.GY",
    },
  },
  {
    id: "cpi-aa-cn",
    region: "CN",
    indicateur: "cpi-aa",
    libelleRegion: "Chine",
    frequence: "M",
    cleRequise: false,
    // Oracle : 2026-07 = 0,5 %.
    source: {
      transport: "oecd",
      dataflow: "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0",
      cle: "CHN.M.N.CPI.PA._T.N.GY",
    },
  },
  {
    id: "cpi-aa-in",
    region: "IN",
    indicateur: "cpi-aa",
    libelleRegion: "Inde",
    frequence: "M",
    cleRequise: false,
    // Oracle : 2026-07 ≈ 4,57 %.
    source: {
      transport: "oecd",
      dataflow: "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0",
      cle: "IND.M.N.CPI.PA._T.N.GY",
    },
  },
];

/** Séries d'un indicateur, dans l'ordre d'affichage des régions. PURE. */
export function seriesDeIndicateur(indicateur: IndicateurMacro): readonly DefinitionSerieMacro[] {
  return ORDRE_REGIONS.flatMap((r) =>
    CATALOGUE_MACRO.filter((d) => d.indicateur === indicateur && d.region === r),
  );
}
