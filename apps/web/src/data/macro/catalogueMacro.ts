/**
 * Catalogue macro : identifiants et périmètres vérifiés le 7 septembre 2026.
 * Une famille = une unité sur le graphe. Les trous sont des entrées explicites,
 * sans repli vers un concept différent ou un miroir statistique arrêté.
 */
import type { FrequenceMacro } from "./harmonisation";
import type { SerieNbs } from "../../../../../shared/nbs-series";

export type RegionMacro = "US" | "EZ" | "UK" | "JP" | "CN" | "IN" | "CA" | "CH";
export const ORDRE_REGIONS: readonly RegionMacro[] = ["US", "EZ", "UK", "JP", "CN", "IN", "CA", "CH"];
export const REGIONS_MACRO: Record<RegionMacro, string> = {
  US: "États-Unis", EZ: "Zone euro", UK: "Royaume-Uni", JP: "Japon", CN: "Chine", IN: "Inde", CA: "Canada", CH: "Suisse",
};
export type IndicateurMacro = "cpi-aa" | "cpi-mm" | "core-cpi-aa" | "ppi-aa" | "pib-aa" | "chomage" | "production-aa" | "change-reel-aa" | "monnaie-aa" | "taux-reel-us" | "breakeven-us" | "nfci" | "hy-oas" | "demandes-chomage" | "sofr-iorb" | "pce-niveau" | "pce-aa" | "pce-3m" | "pce-6m" | "emploi-variation" | "emploi-moyenne3m" | "retail-niveau" | "retail-mm" | "retail-aa";
export type UniteMacro = "%" | "indice" | "personnes" | "pb" | "indice-2017=100" | "milliers" | "millions-usd-nominaux";
export type SourceMacro =
  | { transport: "fred"; seriesId: string; units?: string }
  | { transport: "oecd"; dataflow: string; cle: string }
  | { transport: "eurostat"; dataset: string; filtres: Record<string, string> }
  | { transport: "ons"; chemin: string }
  | { transport: "nbs"; serie: SerieNbs }
  | { transport: "mospi"; serie: "chomage" }
  | { transport: "statcan"; vectorId: number }
  | { transport: "boj"; code: string }
  | { transport: "ecartFred"; gauche: string; droite: string; facteur: number }
  | { transport: "indisponible"; motif: string };
export interface DefinitionSerieMacro {
  id: string;
  region: RegionMacro;
  indicateur: IndicateurMacro;
  libelleRegion: string;
  libelleSerie?: string;
  frequence: FrequenceMacro;
  source: SourceMacro;
  cleRequise: boolean;
  perimetre?: string;
  transformation?: "aa" | "mm" | "annualise3m" | "annualise6m" | "emploi-variation" | "emploi-moyenne3m";
  /** ONS MGSX est daté au mois CENTRAL de son trimestre glissant. */
  decalageFinMois?: number;
}
export interface DefinitionIndicateurMacro { id: IndicateurMacro; label: string; description: string; unite: UniteMacro }
export const INDICATEURS_MACRO: readonly DefinitionIndicateurMacro[] = [
  { id: "cpi-aa", label: "Inflation CPI (a/a)", unite: "%", description: "Prix à la consommation, variation sur un an. IPC nationaux ; IPCH pour la zone euro." },
  { id: "cpi-mm", label: "Inflation CPI (m/m)", unite: "%", description: "Prix à la consommation, variation sur un mois. Corrections saisonnières propres à chaque série." },
  { id: "core-cpi-aa", label: "Inflation sous-jacente (a/a)", unite: "%", description: "Hors alimentation et énergie ; exclusions nationales précisées par région." },
  { id: "ppi-aa", label: "Prix à la production (a/a)", unite: "%", description: "PPI selon les périmètres nationaux : demande finale ou production industrielle. WPI non substitué." },
  { id: "pib-aa", label: "PIB réel (a/a)", unite: "%", description: "Croissance en volume contre le même trimestre de l'année précédente ; données révisables." },
  { id: "chomage", label: "Chômage", unite: "%", description: "Part de la population active au chômage selon les enquêtes de population ; âges et périodes précisés." },
  { id: "production-aa", label: "Production industrielle (a/a)", unite: "%", description: "Volume de la production industrielle contre le même mois de l'année précédente." },
  { id: "change-reel-aa", label: "Change effectif réel (a/a)", unite: "%", description: "Panier large BIS : variation annuelle de l'indice réel. Une hausse indique une appréciation réelle." },
  { id: "monnaie-aa", label: "Monnaie large (a/a)", unite: "%", description: "Croissance des agrégats nationaux. M2, M3 et M4 ont des périmètres différents ; aucun total mondial." },
  { id: "taux-reel-us", label: "Taux réel US 10 ans", unite: "%", description: "Rendement des obligations US indexées sur l'inflation, maturité constante 10 ans (DFII10)." },
  { id: "breakeven-us", label: "Breakeven US 10 ans", unite: "%", description: "Écart de rendements nominal/réel à 10 ans ; intègre anticipations d'inflation et primes de marché." },
  { id: "nfci", label: "Conditions financières US", unite: "indice", description: "Chicago Fed NFCI. Positif : conditions plus restrictives que la moyenne historique ; indice révisable." },
  { id: "hy-oas", label: "Spread crédit HY US", unite: "%", description: "ICE BofA US High Yield Option-Adjusted Spread, exprimé en points de pourcentage." },
  { id: "demandes-chomage", label: "Inscriptions chômage US", unite: "personnes", description: "Demandes initiales hebdomadaires désaisonnalisées et moyenne officielle sur quatre semaines." },
  { id: "sofr-iorb", label: "SOFR − IORB", unite: "pb", description: "Écart entre SOFR et rémunération des réserves, en points de base, uniquement aux dates communes." },
  { id: "pce-niveau", label: "PCE sous-jacent", unite: "indice-2017=100", description: "Indice PCE hors alimentation et énergie, désaisonnalisé, base 2017=100." },
  { id: "pce-aa", label: "PCE sous-jacent (a/a)", unite: "%", description: "Variation annuelle de l'indice PCE sous-jacent désaisonnalisé." },
  { id: "pce-3m", label: "PCE sous-jacent (3 m annualisé)", unite: "%", description: "Variation sur trois mois civils annualisée de l'indice PCE sous-jacent." },
  { id: "pce-6m", label: "PCE sous-jacent (6 m annualisé)", unite: "%", description: "Variation sur six mois civils annualisée de l'indice PCE sous-jacent." },
  { id: "emploi-variation", label: "Emploi non agricole (m/m)", unite: "milliers", description: "Variation mensuelle PAYEMS, en milliers de personnes." },
  { id: "emploi-moyenne3m", label: "Emploi non agricole (moyenne 3 m)", unite: "milliers", description: "Moyenne des trois variations PAYEMS mensuelles consécutives, en milliers par mois." },
  { id: "retail-niveau", label: "Ventes au détail", unite: "millions-usd-nominaux", description: "Ventes avancées RSAFS, millions de dollars courants, désaisonnalisées." },
  { id: "retail-mm", label: "Ventes au détail (m/m)", unite: "%", description: "Variation mensuelle nominale de RSAFS." },
  { id: "retail-aa", label: "Ventes au détail (a/a)", unite: "%", description: "Variation annuelle nominale de RSAFS." },
];

const PRIX = "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0";
const PRIX_2018 = "OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0";
const KEI = "OECD.SDD.STES,DSD_KEI@DF_KEI,4.0";
const ISO: Record<RegionMacro, string> = { US: "USA", EZ: "EA20", UK: "GBR", JP: "JPN", CN: "CHN", IN: "IND", CA: "CAN", CH: "CHE" };
const fred = (seriesId: string, units?: string): SourceMacro => ({ transport: "fred", seriesId, ...(units ? { units } : {}) });
const oecd = (dataflow: string, cle: string): SourceMacro => ({ transport: "oecd", dataflow, cle });
const ons = (theme: string, cdid: string, dataset: string): SourceMacro => ({ transport: "ons", chemin: `${theme}/timeseries/${cdid}/${dataset}/data` });
const eurostat = (dataset: string, filtres: Record<string, string>): SourceMacro => ({ transport: "eurostat", dataset, filtres });
const absent = (motif: string): SourceMacro => ({ transport: "indisponible", motif });
const PRIX_ONS = "economy/inflationandpriceindices";
const cpiOecd = (r: RegionMacro, core: boolean, mm = false): SourceMacro => oecd(
  r === "JP" || r === "CA" || r === "CH" ? PRIX_2018 : PRIX,
  `${ISO[r]}.M.N.CPI.${mm ? "PC" : "PA"}.${core ? "_TXCP01_NRG" : "_T"}.N.${mm ? "G1" : "GY"}`,
);
const hicp = (poste: string, unite: string): SourceMacro => eurostat("prc_hicp_minr", { freq: "M", unit: unite, coicop18: poste, geo: "EA21" });
function definir(indicateur: IndicateurMacro, region: RegionMacro, source: SourceMacro, options: Partial<Pick<DefinitionSerieMacro, "frequence" | "perimetre" | "transformation" | "decalageFinMois" | "libelleSerie" | "id">> = {}): DefinitionSerieMacro {
  return { id: `${indicateur}-${region.toLowerCase()}`, indicateur, region, libelleRegion: REGIONS_MACRO[region], frequence: "M", source, cleRequise: source.transport === "fred" || source.transport === "ecartFred", ...options };
}

const mondiales = ORDRE_REGIONS.flatMap((r): DefinitionSerieMacro[] => {
  const cpi = r === "US" ? fred("CPIAUCSL", "pc1") : r === "EZ" ? hicp("TOTAL", "RCH_A") : r === "UK" ? ons(PRIX_ONS, "d7g7", "mm23") : cpiOecd(r, false);
  const mm = r === "US" ? fred("CPIAUCSL", "pch") : r === "EZ" ? hicp("TOTAL", "RCH_M") : r === "UK" ? ons(PRIX_ONS, "d7bt", "mm23") : cpiOecd(r, false, true);
  const core = r === "CN" ? { transport: "nbs" as const, serie: "core-cpi-aa" as const } : r === "US" ? fred("CPILFESL", "pc1") : r === "EZ" ? hicp("TOT_X_NRG_FOOD", "RCH_A") : r === "UK" ? ons(PRIX_ONS, "dko8", "mm23") : r === "IN" ? absent("Core CPI comparable non disponible dans les sources publiques vérifiées.") : cpiOecd(r, true);
  const ppi = r === "CA" ? { transport: "statcan" as const, vectorId: 1230995983 } : r === "JP" ? { transport: "boj" as const, code: "PRCG20_2200000000%" } : r === "CN" ? { transport: "nbs" as const, serie: "ppi-aa" as const } : r === "US" ? fred("PPIFIS", "pc1") : r === "UK" ? ons(PRIX_ONS, "gd6y", "ppi") : r === "EZ" || r === "CH" ? eurostat("sts_inpp_m", { freq: "M", indic_bt: "PRC_PRR", nace_r2: "B-E36", s_adj: "NSA", unit: "PCH_SM", geo: r === "EZ" ? "EA21" : "CH" }) : absent(r === "IN" ? "L'Inde publie un WPI : ce n'est pas un PPI comparable." : "PPI absent des sources courantes vérifiées ; miroirs FRED arrêtés en 2022.");
  const gdp = r === "US" ? fred("GDPC1", "pc1") : r === "EZ" ? eurostat("namq_10_gdp", { freq: "Q", unit: "CLV_PCH_SM", s_adj: "SCA", na_item: "B1GQ", geo: "EA21" }) : r === "UK" ? ons("economy/grossdomesticproductgdp", "abmi", "pn2") : oecd(KEI, `${ISO[r]}.Q.B1GQ_Q.GR._T.Y.GY`);
  const unemp = r === "CN" ? { transport: "nbs" as const, serie: "chomage" as const } : r === "US" ? fred("UNRATE") : r === "EZ" ? eurostat("une_rt_m", { freq: "M", s_adj: "SA", age: "TOTAL", unit: "PC_ACT", sex: "T", geo: "EA21" }) : r === "UK" ? ons("employmentandlabourmarket/peoplenotinwork/unemployment", "mgsx", "lms") : r === "IN" ? { transport: "mospi" as const, serie: "chomage" as const } : oecd(KEI, `${ISO[r]}.${r === "CH" ? "Q" : "M"}.UNEMP.PT_LF._T.Y._Z`);
  const ip = r === "US" ? fred("INDPRO", "pc1") : r === "EZ" ? eurostat("sts_inpr_m", { freq: "M", indic_bt: "PRD", nace_r2: "B-D", s_adj: "SCA", unit: "I21", geo: "EA21" }) : r === "UK" ? ons("economy/economicoutputandproductivity/output", "k222", "diop") : r === "CN" ? { transport: "nbs" as const, serie: "production-aa" as const } : oecd(KEI, `${ISO[r]}.M.PRVM.GR.BTE.Y.GY`);
  const reer: Record<RegionMacro, string> = { US: "RBUSBIS", EZ: "RBXMBIS", UK: "RBGBBIS", JP: "RBJPBIS", CN: "RBCNBIS", IN: "RBINBIS", CA: "RBCABIS", CH: "RBCHBIS" };
  const money = r === "US" ? fred("M2SL", "pc1") : r === "JP" || r === "CA" ? oecd(KEI, `${ISO[r]}.M.MABM.GR._Z.Y.GY`) : oecd("OECD.SDD.STES,DSD_STES@DF_MONAGG,4.0", `${ISO[r]}.M.MABM.XDC._Z.N._Z._Z.N`);
  return [
    definir("cpi-aa", r, cpi, { perimetre: r === "US" ? "IPC désaisonnalisé" : r === "EZ" ? "IPCH · zone euro 21 pays" : "IPC national non désaisonnalisé" }),
    definir("cpi-mm", r, mm, { perimetre: r === "US" ? "désaisonnalisé" : "non désaisonnalisé", ...(r === "UK" ? { transformation: "mm" } : {}) }),
    definir("core-cpi-aa", r, core, { perimetre: r === "CN" ? "hors alimentation/énergie · brut · historique depuis 2021" : r === "UK" || r === "EZ" ? "hors alimentation, énergie, alcool et tabac" : "hors alimentation et énergie" }),
    definir("ppi-aa", r, ppi, { perimetre: r === "CA" ? "IPPI · production nationale, exportations incluses · hors taxes indirectes · brut" : r === "JP" ? "CGPI domestique · exportations exclues · taxe de consommation incluse · brut" : r === "CN" ? "prix sortie d’usine · brut" : r === "US" ? "demande finale · désaisonnalisé" : r === "UK" ? "production manufacturière hors droits · brut" : "industrie B–E36 · marché total · brut", ...(r === "UK" || r === "CA" ? { transformation: "aa" } : {}) }),
    definir("pib-aa", r, gdp, { frequence: "Q", perimetre: "volume · corrigé des variations saisonnières", ...(r === "UK" ? { transformation: "aa" } : {}) }),
    definir("chomage", r, unemp, { frequence: r === "CH" ? "Q" : "M", perimetre: r === "IN" ? "PLFS · 15 ans et + · rural et urbain · semaine de référence CWS · brut · depuis avril 2025" : r === "CN" ? "enquête urbaine nationale · brut · depuis 2018" : r === "UK" ? "16 ans et + · trimestre glissant · désaisonnalisé" : r === "US" ? "16 ans et + · désaisonnalisé" : "enquête population active · désaisonnalisé", ...(r === "UK" ? { decalageFinMois: 1 } : {}) }),
    definir("production-aa", r, ip, { perimetre: r === "CN" ? "valeur ajoutée · entreprises au-dessus du seuil national · brut · janvier/février non individualisés" : r === "UK" ? "B–E · volume désaisonnalisé" : r === "EZ" ? "B–D · CVS-CJO" : "industrie hors construction · désaisonnalisé", ...(r === "UK" || r === "EZ" ? { transformation: "aa" } : {}) }),
    definir("change-reel-aa", r, fred(reer[r], "pc1"), { perimetre: "BIS · réel · panier large" }),
    definir("monnaie-aa", r, money, { perimetre: r === "US" ? "M2 · désaisonnalisé" : r === "CN" ? "M2 · brut" : r === "EZ" ? "M3 · zone euro 20 pays · brut" : r === "UK" ? "M4 · brut" : r === "IN" || r === "CH" ? "M3 · brut" : r === "JP" ? "M3 · désaisonnalisé" : "monnaie large OCDE · désaisonnalisé", ...(r !== "US" && r !== "JP" && r !== "CA" ? { transformation: "aa" } : {}) }),
  ];
});

export const CATALOGUE_MACRO: readonly DefinitionSerieMacro[] = [
  ...mondiales,
  definir("taux-reel-us", "US", fred("DFII10"), { frequence: "D" }),
  definir("breakeven-us", "US", fred("T10YIE"), { frequence: "D" }),
  definir("nfci", "US", fred("NFCI"), { frequence: "W" }),
  definir("hy-oas", "US", fred("BAMLH0A0HYM2"), { frequence: "D" }),
  definir("demandes-chomage", "US", fred("ICSA"), { frequence: "W", libelleSerie: "US · demandes initiales" }),
  definir("demandes-chomage", "US", fred("IC4WSA"), { id: "demandes-chomage-us-4s", frequence: "W", libelleSerie: "US · moyenne 4 semaines" }),
  definir("sofr-iorb", "US", { transport: "ecartFred", gauche: "SOFR", droite: "IORB", facteur: 100 }, { frequence: "D", perimetre: "taux effectifs à dates communes" }),
  definir("pce-niveau", "US", fred("PCEPILFE"), { frequence: "M", perimetre: "indice 2017=100 · désaisonnalisé · BEA" }),
  definir("pce-aa", "US", fred("PCEPILFE"), { frequence: "M", transformation: "aa", perimetre: "indice PCE hors alimentation/énergie · désaisonnalisé · a/a" }),
  definir("pce-3m", "US", fred("PCEPILFE"), { frequence: "M", transformation: "annualise3m", perimetre: "indice PCE hors alimentation/énergie · désaisonnalisé · 3 mois annualisé" }),
  definir("pce-6m", "US", fred("PCEPILFE"), { frequence: "M", transformation: "annualise6m", perimetre: "indice PCE hors alimentation/énergie · désaisonnalisé · 6 mois annualisé" }),
  definir("emploi-variation", "US", fred("PAYEMS"), { frequence: "M", transformation: "emploi-variation", perimetre: "enquête établissements · désaisonnalisé · milliers" }),
  definir("emploi-moyenne3m", "US", fred("PAYEMS"), { frequence: "M", transformation: "emploi-moyenne3m", perimetre: "enquête établissements · désaisonnalisé · moyenne de trois variations consécutives · milliers/mois" }),
  definir("retail-niveau", "US", fred("RSAFS"), { frequence: "M", perimetre: "ventes avancées · désaisonnalisées · millions USD nominaux" }),
  definir("retail-mm", "US", fred("RSAFS"), { frequence: "M", transformation: "mm", perimetre: "ventes avancées · désaisonnalisées · variation m/m nominale" }),
  definir("retail-aa", "US", fred("RSAFS"), { frequence: "M", transformation: "aa", perimetre: "ventes avancées · désaisonnalisées · variation a/a nominale" }),
];

/** Séries dans l'ordre stable des zones (une famille US peut comporter deux courbes). */
export function seriesDeIndicateur(indicateur: IndicateurMacro | string): readonly DefinitionSerieMacro[] {
  return ORDRE_REGIONS.flatMap((r) => CATALOGUE_MACRO.filter((d) => d.indicateur === indicateur && d.region === r));
}
