/**
 * Historique COT par marché — exposition de TOUTES les catégories de traders, rapport après
 * rapport (demande du propriétaire du 5 novembre 2026 : « chaque semaine on récupère les
 * résultats et on trace le graphique de l'exposition des institutions »).
 *
 * La fenêtre COT résumait déjà le dernier rapport (une catégorie à la fois, 3 ans, sparkline).
 * Ce module PUR alimente le graphique : pour UN marché de la watchlist, les positions longues et
 * courtes de chaque catégorie du rapport CFTC (« Futures Only ») sur tout l'historique publié :
 *  - financiers (devises, indices, crypto) → rapport TFF : Dealers, Gérants d'actifs,
 *    Fonds à effet de levier, Autres déclarants, Non déclarants ;
 *  - matières premières (métaux, énergie) → rapport Disaggregated : Producteurs/négociants,
 *    Swap dealers, Managed Money, Autres déclarants, Non déclarants ;
 *  - au choix, le rapport Legacy pour tous : Commerciaux, Non-commerciaux, Non déclarants.
 *
 * COLONNES VÉRIFIÉES À L'EXÉCUTION. Le contrat interdit de deviner les noms de champs Socrata
 * (asymétries `_all`, coquilles d'origine). Seules quatre paires étaient vérifiées en direct
 * (cf. `DATASETS_COT`). Les autres noms ne sont donc JAMAIS envoyés à l'aveugle :
 *  1. une requête de DÉCOUVERTE sans `$select` lit les dernières lignes réelles du marché ;
 *  2. chaque catégorie est résolue contre les clés RÉELLEMENT présentes (liste de candidats) ;
 *  3. la requête d'historique ne sélectionne que des colonnes vues dans la réponse.
 * Une catégorie non résolue est déclarée absente (jamais zéro). Un contrôle de cohérence
 * vérifie à chaque rapport que la somme des nets de toutes les catégories vaut zéro (chaque
 * contrat a un acheteur et un vendeur ; les spreads se compensent) : une colonne mal associée
 * se voit, elle ne fausse pas le graphe en silence.
 *
 * CADENCE HEBDOMADAIRE. La CFTC publie le vendredi à 15 h 30 (New York) les positions du mardi.
 * Les données restent à jour jusqu'à la publication suivante ; au-delà, elles sont relues. Si le
 * rapport attendu n'est pas encore là (jour férié : publication décalée), on revérifie toutes
 * les 6 h. Aucun effet de bord ici : le réseau et le cache vivent dans `store/cotHistorique.ts`.
 */
import {
  DATASETS_COT,
  WATCHLIST_COT,
  cotIndex,
  nombreCot,
  netSurOi,
  type CotCategorie,
  type DatasetCot,
  type InstrumentCot,
  type PointCot,
} from "./cot";

// ─────────────────────────── Catégories de traders par rapport ───────────────────────────

/** Rapport tracé : détaillé (TFF ou Disaggregated selon la famille) ou Legacy. */
export type ModeRapportGraphe = "detaille" | "legacy";

/** Une catégorie de traders d'un rapport CFTC. */
export interface CategorieGraphe {
  /** Identifiant stable (clé de couleur et de visibilité). */
  id: string;
  /** Libellé complet (tableau-légende, notes). */
  libelle: string;
  /** Libellé court (infobulle du graphe). */
  court: string;
  /** Qui se trouve dans la catégorie (définition CFTC résumée). */
  description: string;
  /**
   * Noms de colonnes CANDIDATS, essayés dans l'ordre contre les clés réellement renvoyées.
   * Aucun n'est envoyé à la CFTC sans avoir été vu dans une réponse (cf. en-tête du module).
   */
  long: readonly string[];
  short: readonly string[];
  /** Positions sous le seuil de déclaration, obtenues par différence : tracé en retrait. */
  residuel?: boolean;
}

const NON_DECLARANTS: CategorieGraphe = {
  id: "nonrept",
  libelle: "Non déclarants",
  court: "Non déclarants",
  description:
    "Positions sous le seuil de déclaration (petits porteurs), calculées par la CFTC par différence avec l'open interest.",
  long: ["nonrept_positions_long_all", "nonrept_positions_long"],
  short: ["nonrept_positions_short_all", "nonrept_positions_short"],
  residuel: true,
};

const AUTRES_DECLARANTS = (description: string): CategorieGraphe => ({
  id: "other_rept",
  libelle: "Autres déclarants",
  court: "Autres décl.",
  description,
  long: ["other_rept_positions_long", "other_rept_positions_long_all"],
  short: ["other_rept_positions_short", "other_rept_positions_short_all"],
});

/**
 * Catégories de chaque rapport, dans l'ordre FIXE d'affichage (et donc de couleur). Les paires
 * déjà vérifiées en direct (`DATASETS_COT`) sont placées en tête de leurs candidats.
 */
export const CATEGORIES_GRAPHE: Record<DatasetCot, readonly CategorieGraphe[]> = {
  tff: [
    {
      id: "dealer",
      libelle: "Dealers / intermédiaires",
      court: "Dealers",
      description:
        "Côté « vendeur » du marché : grandes banques et intermédiaires en titres, swaps et dérivés, souvent contrepartie de leurs clients.",
      long: ["dealer_positions_long_all", "dealer_positions_long"],
      short: ["dealer_positions_short_all", "dealer_positions_short"],
    },
    {
      id: "asset_mgr",
      libelle: "Gérants d'actifs / institutionnels",
      court: "Gérants d'actifs",
      description:
        "Investisseurs institutionnels : fonds de pension, fondations, assureurs, fonds communs et gérants à clientèle institutionnelle.",
      long: [DATASETS_COT.tff.champs.net2[0], "asset_mgr_positions_long_all"],
      short: [DATASETS_COT.tff.champs.net2[1], "asset_mgr_positions_short_all"],
    },
    {
      id: "lev_money",
      libelle: "Fonds à effet de levier",
      court: "Fonds à levier",
      description: "Hedge funds et gérants de fonds de contrats à terme (CTA, CPO, fonds non enregistrés).",
      long: [DATASETS_COT.tff.champs.net1[0], "lev_money_positions_long_all"],
      short: [DATASETS_COT.tff.champs.net1[1], "lev_money_positions_short_all"],
    },
    AUTRES_DECLARANTS(
      "Déclarants hors des trois catégories, souvent en couverture : trésoreries d'entreprises, banques centrales, petites banques.",
    ),
    NON_DECLARANTS,
  ],
  disaggregated: [
    {
      id: "prod_merc",
      libelle: "Producteurs / négociants",
      court: "Producteurs",
      description:
        "Producteurs, négociants, transformateurs et utilisateurs du physique qui couvrent leur activité.",
      long: [DATASETS_COT.disaggregated.champs.net2[0], "prod_merc_positions_long_all"],
      short: [DATASETS_COT.disaggregated.champs.net2[1], "prod_merc_positions_short_all"],
    },
    {
      id: "swap",
      libelle: "Swap dealers",
      court: "Swap dealers",
      description: "Teneurs de swaps sur matières premières qui couvrent sur les futures le risque de leurs swaps.",
      long: ["swap_positions_long_all", "swap_positions_long"],
      // La colonne courte porte un double tiret bas dans certaines publications Socrata :
      // les deux graphies restent des CANDIDATS, résolus contre la réponse réelle.
      short: ["swap__positions_short_all", "swap_positions_short_all", "swap_positions_short"],
    },
    {
      id: "m_money",
      libelle: "Managed Money",
      court: "Managed Money",
      description: "Gestion alternative pour compte de clients : CTA, CPO et fonds identifiés par la CFTC.",
      long: [DATASETS_COT.disaggregated.champs.net1[0], "m_money_positions_long"],
      short: [DATASETS_COT.disaggregated.champs.net1[1], "m_money_positions_short"],
    },
    AUTRES_DECLARANTS("Déclarants hors des trois catégories précédentes."),
    NON_DECLARANTS,
  ],
  legacy: [
    {
      id: "comm",
      libelle: "Commerciaux",
      court: "Commerciaux",
      description: "Positions déclarées comme couverture d'une activité commerciale (définition legacy).",
      long: [DATASETS_COT.legacy.champs.net2[0]],
      short: [DATASETS_COT.legacy.champs.net2[1]],
    },
    {
      id: "noncomm",
      libelle: "Non-commerciaux",
      court: "Non-commerciaux",
      description: "Spéculateurs déclarants : fonds, CTA, autres positions sans couverture commerciale.",
      long: [DATASETS_COT.legacy.champs.net1[0]],
      short: [DATASETS_COT.legacy.champs.net1[1]],
    },
    NON_DECLARANTS,
  ],
};

/** Libellé du rapport source (notes, sous-titre). */
export const LIBELLE_RAPPORT: Record<DatasetCot, string> = {
  tff: "Traders in Financial Futures (TFF)",
  disaggregated: "Disaggregated",
  legacy: "Legacy",
};

/** Dataset tracé pour une famille d'instrument et un mode. Fonction PURE. */
export function datasetGraphe(famille: CotCategorie, mode: ModeRapportGraphe): DatasetCot {
  if (mode === "legacy") return "legacy";
  return famille === "metal" || famille === "energie" ? "disaggregated" : "tff";
}

/** Instrument de la watchlist par nom CFTC exact, sinon null. */
export function instrumentCot(nom: string, watchlist: readonly InstrumentCot[] = WATCHLIST_COT): InstrumentCot | null {
  return watchlist.find((i) => i.nom === nom) ?? null;
}

// ─────────────────────────── Découverte et résolution des colonnes ───────────────────────────

const CHAMP_NOM = "market_and_exchange_names";
const CHAMP_DATE = "report_date_as_yyyy_mm_dd";
const CANDIDATS_OI = ["open_interest_all"] as const;

/** Union des clés réellement présentes dans des enregistrements Socrata. Fonction PURE. */
export function colonnesPresentes(records: unknown): Set<string> {
  const cles = new Set<string>();
  if (!Array.isArray(records)) return cles;
  for (const rec of records) {
    if (rec !== null && typeof rec === "object" && !Array.isArray(rec)) {
      for (const cle of Object.keys(rec)) cles.add(cle);
    }
  }
  return cles;
}

/** Paire de colonnes résolue d'une catégorie. */
export interface ColonnesCategorie {
  long: string;
  short: string;
}

/** Colonnes résolues d'un rapport : alignées sur `CATEGORIES_GRAPHE[dataset]` (null = absente). */
export interface ColonnesResolues {
  oi: string | null;
  categories: (ColonnesCategorie | null)[];
}

function premierPresent(candidats: readonly string[], presentes: ReadonlySet<string>): string | null {
  return candidats.find((c) => presentes.has(c)) ?? null;
}

/**
 * Résout chaque catégorie contre les colonnes réellement vues. Une catégorie dont le long OU le
 * short manque est déclarée absente (null) : jamais de demi-position. Fonction PURE.
 */
export function resoudreColonnes(dataset: DatasetCot, presentes: ReadonlySet<string>): ColonnesResolues {
  return {
    oi: premierPresent(CANDIDATS_OI, presentes),
    categories: CATEGORIES_GRAPHE[dataset].map((cat) => {
      const long = premierPresent(cat.long, presentes);
      const short = premierPresent(cat.short, presentes);
      return long !== null && short !== null ? { long, short } : null;
    }),
  };
}

/** Échappe une chaîne pour un littéral SoQL entre apostrophes (' → ''). */
function litteralSoql(valeur: string): string {
  return `'${valeur.replace(/'/g, "''")}'`;
}

/** Chemin Socrata (`resource/<id>.json?…`) d'une requête sur un dataset. Fonction PURE. */
export function cheminSocrata(dataset: DatasetCot, requete: string): string {
  return `resource/${DATASETS_COT[dataset].id}.json?${requete}`;
}

/** Nombre de lignes lues pour découvrir les colonnes (Socrata omet les clés nulles). */
export const LIGNES_DECOUVERTE = 4;

/**
 * Requête de DÉCOUVERTE : les dernières lignes complètes du marché, SANS `$select` (une colonne
 * inconnue dans `$select` ferait échouer toute la requête en HTTP 400). Fonction PURE.
 */
export function construireRequeteDecouverte(nom: string): string {
  const params = new URLSearchParams();
  params.set("$where", `${CHAMP_NOM}=${litteralSoql(nom)}`);
  params.set("$order", `${CHAMP_DATE} DESC`);
  params.set("$limit", String(LIGNES_DECOUVERTE));
  return params.toString();
}

/** Plafond de lignes d'historique : ~96 ans hebdomadaires, au-delà de tout historique publié. */
export const LIMITE_HISTORIQUE = 5000;

/**
 * Requête d'HISTORIQUE complète d'un marché, restreinte aux colonnes résolues (toutes vues
 * dans la réponse de découverte). Tri chronologique croissant. Fonction PURE.
 */
export function construireRequeteHistorique(nom: string, colonnes: ColonnesResolues): string {
  const select = [CHAMP_NOM, CHAMP_DATE];
  if (colonnes.oi !== null) select.push(colonnes.oi);
  for (const c of colonnes.categories) if (c !== null) select.push(c.long, c.short);
  const params = new URLSearchParams();
  params.set("$select", [...new Set(select)].join(","));
  params.set("$where", `${CHAMP_NOM}=${litteralSoql(nom)}`);
  params.set("$order", `${CHAMP_DATE} ASC`);
  params.set("$limit", String(LIMITE_HISTORIQUE));
  return params.toString();
}

// ─────────────────────────── Série historique ───────────────────────────

/** Un rapport : stocks long/short par catégorie (alignés sur les catégories ; NaN = absent). */
export interface PointHistoriqueCot {
  /** Date du rapport (positions du mardi), ms epoch — même convention que `data/cot.ts`. */
  t: number;
  /** Open interest total du contrat (NaN si absent). */
  oi: number;
  longs: number[];
  shorts: number[];
}

/** Historique d'un marché pour un rapport donné. */
export interface SerieHistoriqueCot {
  dataset: DatasetCot;
  nom: string;
  /** Catégorie résolue dans la réponse CFTC (aligné sur `CATEGORIES_GRAPHE[dataset]`). */
  disponibles: boolean[];
  /** Rapports triés par date croissante, sans doublon de date. */
  points: PointHistoriqueCot[];
}

function stock(v: unknown): number {
  const n = nombreCot(v);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/**
 * Parse la réponse d'historique. Ignore les lignes d'un autre marché ou sans date exploitable ;
 * une valeur absente/invalide reste NaN (jamais 0). Dédoublonne par date (dernière occurrence)
 * et trie par date croissante. Fonction PURE.
 */
export function parserHistorique(
  records: unknown,
  dataset: DatasetCot,
  nom: string,
  colonnes: ColonnesResolues,
): SerieHistoriqueCot {
  const parDate = new Map<number, PointHistoriqueCot>();
  const liste = Array.isArray(records) ? records : [];
  for (const brut of liste) {
    if (brut === null || typeof brut !== "object") continue;
    const r = brut as Record<string, unknown>;
    if (typeof r[CHAMP_NOM] === "string" && r[CHAMP_NOM] !== nom) continue;
    const t = typeof r[CHAMP_DATE] === "string" ? Date.parse(r[CHAMP_DATE] as string) : NaN;
    if (!Number.isFinite(t)) continue;
    parDate.set(t, {
      t,
      oi: colonnes.oi === null ? NaN : stock(r[colonnes.oi]),
      longs: colonnes.categories.map((c) => (c === null ? NaN : stock(r[c.long]))),
      shorts: colonnes.categories.map((c) => (c === null ? NaN : stock(r[c.short]))),
    });
  }
  return {
    dataset,
    nom,
    disponibles: colonnes.categories.map((c) => c !== null),
    points: [...parDate.values()].sort((a, b) => a.t - b.t),
  };
}

/** Net (long − short) de la catégorie `i` à un rapport, null si un côté manque. Fonction PURE. */
export function netCategorie(p: PointHistoriqueCot, i: number): number | null {
  const l = p.longs[i];
  const s = p.shorts[i];
  return l !== undefined && s !== undefined && Number.isFinite(l) && Number.isFinite(s) ? l - s : null;
}

// ─────────────────────────── Contrôle de cohérence ───────────────────────────

/** Tolérance du contrôle : 0,1 % de l'OI, au moins 1 contrat. */
function tolerance(oi: number): number {
  return Math.max(1, Number.isFinite(oi) ? oi * 0.001 : 0);
}

/**
 * Somme des nets de TOUTES les catégories d'un rapport (doit valoir 0 : chaque contrat a un
 * acheteur et un vendeur, les spreads comptent des deux côtés). `null` si une catégorie manque.
 * Fonction PURE.
 */
export function sommeNets(p: PointHistoriqueCot): number | null {
  let somme = 0;
  for (let i = 0; i < p.longs.length; i++) {
    const n = netCategorie(p, i);
    if (n === null) return null;
    somme += n;
  }
  return somme;
}

/** Bilan du contrôle Σ nets = 0 sur toute la série. */
export interface BilanCoherence {
  /** Rapports où toutes les catégories sont présentes (contrôle possible). */
  controles: number;
  /** Rapports où |Σ nets| dépasse la tolérance. */
  ecarts: number;
  /** Date du dernier rapport en écart, sinon null. */
  dernierEcart: number | null;
}

/** Contrôle Σ nets = 0 rapport par rapport. Fonction PURE. */
export function bilanCoherence(serie: SerieHistoriqueCot): BilanCoherence {
  let controles = 0;
  let ecarts = 0;
  let dernierEcart: number | null = null;
  for (const p of serie.points) {
    const s = sommeNets(p);
    if (s === null) continue;
    controles++;
    if (Math.abs(s) > tolerance(p.oi)) {
      ecarts++;
      dernierEcart = p.t;
    }
  }
  return { controles, ecarts, dernierEcart };
}

// ─────────────────────────── Exposition au dernier rapport ───────────────────────────

/** Ligne du tableau d'exposition d'une catégorie au dernier rapport. */
export interface ExpositionCategorie {
  index: number;
  categorie: CategorieGraphe;
  disponible: boolean;
  long: number | null;
  short: number | null;
  net: number | null;
  /** Variation du net vs le rapport précédent de la série, null sans comparaison. */
  deltaNet: number | null;
  /** Net en % de l'OI total du marché. */
  netPctOi: number | null;
  /** Position du net dans son amplitude min–max des 156 derniers rapports (0-100). */
  indice: number | null;
}

/**
 * Exposition de chaque catégorie au dernier rapport de la série (ordre fixe des catégories).
 * L'indice réutilise `cotIndex` (même définition que la synthèse). Fonction PURE.
 */
export function expositionDerniere(serie: SerieHistoriqueCot): ExpositionCategorie[] {
  const dernier = serie.points.at(-1);
  const precedent = serie.points.at(-2);
  return CATEGORIES_GRAPHE[serie.dataset].map((categorie, index) => {
    const disponible = serie.disponibles[index] === true;
    const net = dernier ? netCategorie(dernier, index) : null;
    const netAvant = precedent ? netCategorie(precedent, index) : null;
    const long = dernier?.longs[index];
    const short = dernier?.shorts[index];
    const nets: PointCot[] = [];
    for (const p of serie.points) {
      const n = netCategorie(p, index);
      if (n !== null) nets.push({ t: p.t, net: n, oi: p.oi });
    }
    return {
      index,
      categorie,
      disponible,
      long: long !== undefined && Number.isFinite(long) ? long : null,
      short: short !== undefined && Number.isFinite(short) ? short : null,
      net,
      deltaNet: net !== null && netAvant !== null ? net - netAvant : null,
      netPctOi: net !== null && dernier ? netSurOi(net, dernier.oi) : null,
      indice: net !== null ? cotIndex(nets) : null,
    };
  });
}

// ─────────────────────────── Calendrier de publication hebdomadaire ───────────────────────────

/** Relecture minimale quand le rapport attendu tarde (jour férié, retard de publication). */
export const RELANCE_MIN_MS = 6 * 60 * 60 * 1000;

/**
 * Instant de publication du rapport SUIVANT celui daté `dernierRapport` (positions d'un mardi).
 * Le rapport du mardi T sort le vendredi T+3 ; le suivant (T+7) sort donc le vendredi T+10.
 * Heure retenue : 20 h 30 UTC = 15 h 30 à New York en hiver (16 h 30 l'été : une heure de marge).
 * Le jour est lu en composantes LOCALES, comme la date l'a été au parsing. Fonction PURE.
 */
export function prochainePublicationCot(dernierRapport: number): number {
  const d = new Date(dernierRapport);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + 10, 20, 30);
}

/**
 * Instant jusqu'auquel un historique récupéré à `ts` reste à jour : la publication suivante,
 * ou `ts + 6 h` si celle-ci est déjà passée sans nouveau rapport. Fonction PURE.
 */
export function finValiditeHistorique(dernierRapport: number | null, ts: number): number {
  const relance = ts + RELANCE_MIN_MS;
  return dernierRapport === null ? relance : Math.max(prochainePublicationCot(dernierRapport), relance);
}

/** L'historique est-il à jour à `now` ? Fonction PURE. */
export function historiqueAJour(dernierRapport: number | null, ts: number, now: number): boolean {
  return now < finValiditeHistorique(dernierRapport, ts);
}

/** Le rapport suivant aurait-il dû paraître (publication attendue dépassée) ? Fonction PURE. */
export function rapportEnRetard(dernierRapport: number | null, now: number): boolean {
  return dernierRapport !== null && now >= prochainePublicationCot(dernierRapport);
}

/**
 * Date (mardi) des positions du rapport suivant, à minuit local comme au parsing. Calcul en
 * composantes de date : ajouter 7 × 24 h glisserait d'un jour au changement d'heure. PURE.
 */
export function dateRapportSuivant(dernierRapport: number): number {
  const d = new Date(dernierRapport);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
}

// ─────────────────────────── Sérialisation compacte (cache) ───────────────────────────

/** Version du format de cache compact. */
export const VERSION_CACHE_HISTORIQUE = 1;

/** Forme JSON compacte : une ligne = [t, oi, l0, s0, l1, s1, …], null pour NaN. */
export interface SerieCompacte {
  v: number;
  dataset: DatasetCot;
  nom: string;
  disponibles: boolean[];
  lignes: (number | null)[][];
}

const versJson = (n: number): number | null => (Number.isFinite(n) ? n : null);
const depuisJson = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

/** Sérialise une série en forme compacte (≈ 10× plus petite que les records Socrata). PURE. */
export function compacterSerie(serie: SerieHistoriqueCot): SerieCompacte {
  return {
    v: VERSION_CACHE_HISTORIQUE,
    dataset: serie.dataset,
    nom: serie.nom,
    disponibles: [...serie.disponibles],
    lignes: serie.points.map((p) => {
      const ligne: (number | null)[] = [p.t, versJson(p.oi)];
      for (let i = 0; i < p.longs.length; i++) ligne.push(versJson(p.longs[i]!), versJson(p.shorts[i]!));
      return ligne;
    }),
  };
}

/** Relit une forme compacte ; null si version, rapport ou forme inattendus. Fonction PURE. */
export function decompacterSerie(brut: unknown): SerieHistoriqueCot | null {
  const c = brut as Partial<SerieCompacte> | null;
  if (c === null || typeof c !== "object" || c.v !== VERSION_CACHE_HISTORIQUE) return null;
  if (c.dataset === undefined || !(c.dataset in CATEGORIES_GRAPHE) || typeof c.nom !== "string") return null;
  const nbCategories = CATEGORIES_GRAPHE[c.dataset].length;
  if (!Array.isArray(c.disponibles) || c.disponibles.length !== nbCategories || !Array.isArray(c.lignes)) return null;
  const points: PointHistoriqueCot[] = [];
  for (const ligne of c.lignes) {
    if (!Array.isArray(ligne) || ligne.length !== 2 + 2 * nbCategories) return null;
    const t = depuisJson(ligne[0]);
    if (!Number.isFinite(t)) return null;
    const longs: number[] = [];
    const shorts: number[] = [];
    for (let i = 0; i < nbCategories; i++) {
      longs.push(depuisJson(ligne[2 + 2 * i]));
      shorts.push(depuisJson(ligne[3 + 2 * i]));
    }
    points.push({ t, oi: depuisJson(ligne[1]), longs, shorts });
  }
  return {
    dataset: c.dataset,
    nom: c.nom,
    disponibles: c.disponibles.map((d) => d === true),
    points: points.sort((a, b) => a.t - b.t),
  };
}
