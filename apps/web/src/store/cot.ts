/**
 * Store COT — catégories de positionnement (fetch lazy par dataset + cache v2).
 *
 * Étend la fenêtre « Rapport COT » (data/cot.ts, INCHANGÉ) d'un SÉLECTEUR de catégorie de
 * positionnement — `legacy` (agrégat non-commercial historique), `fonds` (spéculateurs fins :
 * Managed Money en matières premières, Leveraged Funds en financiers) et `commerciaux`
 * (contrepartie : Producer/Merchant, Asset Manager). La catégorie route CHAQUE instrument vers
 * son dataset CFTC via `datasetPour` (Task 1) : pour `fonds`/`commerciaux`, metal/energie tirent
 * du Disaggregated et fx/indice/crypto du TFF — DEUX datasets, résultats JAMAIS mélangés dans une
 * même ligne (chaque ligne vient du dataset routé par sa famille).
 *
 * Fetch LAZY : `setCategorie` ne charge que le/les dataset(s) requis par la catégorie choisie,
 * s'ils sont absents du cache ou périmés (TTL 12 h). Un seul fetch par dataset sert les DEUX
 * catégories fines (net1 + net2 sélectionnés ensemble — `pointCotDataset` choisit la paire au
 * parse), donc basculer `fonds`↔`commerciaux` ne refait AUCUN réseau : on réassemble depuis les
 * records déjà en mémoire.
 *
 * Cache localStorage PAR DATASET : `axiom:cot:cache:v2:<dataset>`, contenu = records BRUTS Socrata
 * (pas la synthèse : un dataset sert deux catégories, la synthèse est category-dépendante). Migration
 * de la clé plate historique `axiom:cot:cache:v2` (écrite par l'orchestrateur legacy de data/cot.ts,
 * forme `{ts, resume}` = ResumeCot DÉJÀ synthétisé) : INVALIDÉE (purge best-effort) — shape
 * incompatible avec le cache records-bruts, et long/short y sont irrécupérables (collapsés en net),
 * donc non réinterprétable comme cache de records. Même précédent que la purge v1 de `lireCache`.
 *
 * Logique de sélection/fusion (`assemblerCategorie`) PURE et testée (cot.test.ts). Le fetch réseau
 * reste non testé (convention repo). Dégradation gracieuse identique à l'existant : sur échec réseau,
 * repli sur le cache périmé (bandeau côté fenêtre) + santé marquée en erreur, jamais d'exception.
 */
import { createStore } from "zustand/vanilla";
import {
  DATASETS_COT,
  WATCHLIST_COT,
  construireRequeteDataset,
  datasetPour,
  pointCotDataset,
  type CategoriePositionnement,
  type DatasetCot,
  type InstrumentCot,
  type LigneCot,
  type PointBrutCot,
  type PointCot,
} from "../data/cot";
import { extUrl } from "../data/extapi";
import { healthStore } from "./health";

// ─────────────────────────── Types ───────────────────────────

/**
 * Ligne d'une catégorie de positionnement : une `LigneCot` classique augmentée d'un marqueur de
 * NON-COUVERTURE. `nonCouvert === true` ⇒ l'instrument n'a AUCUN record dans le dataset routé par
 * sa famille (ex. un instrument absent du TFF pour `commerciaux`) ; la fenêtre (Task 4) la masque.
 * Le marqueur est STRUCTUREL (pas de record ⇒ non couvert) — il ne distingue PAS « dataset pas
 * encore chargé » de « réellement absent » : c'est au store (drapeau `enCours`) de faire ce tri.
 */
export interface LigneCotCategorie extends LigneCot {
  nonCouvert: boolean;
}

/** Résultat assemblé pour UNE catégorie : lignes (ordre watchlist, stubs inclus) + dernière date. */
export interface ResumeCotCategorie {
  lignes: LigneCotCategorie[];
  /** Date du dernier rapport publié (max sur les lignes COUVERTES), null si aucune couverte. */
  dateRapport: number | null;
}

// ─────────────────────────── Logique PURE : sélection / fusion ───────────────────────────

/**
 * Datasets à charger pour afficher une catégorie donnée (déduits de `datasetPour` sur la watchlist).
 *  - `legacy` → `["legacy"]` ;
 *  - `fonds`/`commerciaux` → `["disaggregated", "tff"]` (matières premières + financiers).
 * Fonction PURE.
 */
export function datasetsRequis(categorie: CategoriePositionnement): DatasetCot[] {
  const set = new Set<DatasetCot>();
  for (const inst of WATCHLIST_COT) {
    const d = datasetPour(inst.categorie, categorie);
    if (d) set.add(d);
  }
  return [...set];
}

/**
 * Assemble les lignes de la catégorie `categorie` à partir des records bruts DÉJÀ récupérés par
 * dataset (`recordsParDataset`). Pour CHAQUE instrument de la watchlist (dans l'ordre) :
 *  1. route sa famille vers son dataset (`datasetPour`) — le routage se fait par FAMILLE, jamais par
 *     présence fortuite du nom dans un autre dataset : un fx présent dans le Disaggregated est ignoré,
 *     sa série vient du TFF ;
 *  2. parse les records de CE dataset filtrés à son nom via `pointCotDataset` (paire net1/net2 choisie
 *     par la catégorie) ;
 *  3. si des points existent → ligne synthétisée (série chrono ↑, net du dernier, delta hebdo) ;
 *     sinon → stub marqué `nonCouvert` (série vide, delta null).
 * `dateRapport` = max sur les lignes couvertes (null si aucune). Fonction PURE (aucun effet de bord).
 * Pour la catégorie `legacy`, `pointCotDataset("legacy","legacy")` reproduit `pointCot` ⇒ résultat
 * IDENTIQUE à `resumerCot` sur les instruments couverts (non-régression, testée).
 */
export function assemblerCategorie(
  recordsParDataset: Partial<Record<DatasetCot, unknown>>,
  categorie: CategoriePositionnement,
  watchlist: readonly InstrumentCot[] = WATCHLIST_COT,
): ResumeCotCategorie {
  const lignes: LigneCotCategorie[] = [];

  for (const inst of watchlist) {
    const dataset = datasetPour(inst.categorie, categorie);
    const brut = dataset ? recordsParDataset[dataset] : undefined;
    const liste = Array.isArray(brut) ? brut : [];

    // Parse les points de cet instrument DANS son dataset routé (filtre par nom exact).
    const pts: PointBrutCot[] = [];
    for (const rec of liste) {
      const pt = dataset ? pointCotDataset(dataset, categorie, rec) : null;
      if (pt === null || pt.nom !== inst.nom) continue;
      pts.push(pt);
    }

    if (pts.length === 0) {
      // Non couvert : stub structurel (net/OI moot — la fenêtre le masque). Type-valide.
      lignes.push({
        nom: inst.nom,
        libelle: inst.libelle,
        categorie: inst.categorie,
        net: NaN,
        delta: null,
        openInterest: NaN,
        dateRapport: 0,
        serie: [],
        nonCouvert: true,
      });
      continue;
    }

    // Tri chrono CROISSANT (même contrat que `resumerCot`) : dernier rapport en fin de tableau.
    pts.sort((a, b) => a.dateRapport - b.dateRapport);
    const serie: PointCot[] = pts.map((p) => ({ t: p.dateRapport, net: p.net, oi: p.openInterest }));
    const dernier = pts[pts.length - 1]!;
    const precedent = pts[pts.length - 2];
    lignes.push({
      nom: inst.nom,
      libelle: inst.libelle,
      categorie: inst.categorie,
      net: dernier.net,
      delta: precedent ? dernier.net - precedent.net : null,
      openInterest: dernier.openInterest,
      dateRapport: dernier.dateRapport,
      serie,
      nonCouvert: false,
    });
  }

  const couvertes = lignes.filter((l) => !l.nonCouvert);
  const dateRapport = couvertes.length > 0 ? Math.max(...couvertes.map((l) => l.dateRapport)) : null;
  return { lignes, dateRapport };
}

// ─────────────────────────── Cache localStorage par dataset (effet de bord) ───────────────────────────

const HOTE = "publicreporting.cftc.gov";
const HEALTH_SOURCE = "cot:cftc";
/** Préfixe des clés de cache par dataset : `axiom:cot:cache:v2:<dataset>`. */
const CACHE_PREFIX = "axiom:cot:cache:v2:";
/** Clé plate historique (orchestrateur legacy de data/cot.ts) — purgée à l'init (shape incompatible). */
const CACHE_LEGACY_PLAT = "axiom:cot:cache:v2";
/** TTL du cache : 12 h (rapport publié une fois par semaine, le vendredi). */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function cleDataset(dataset: DatasetCot): string {
  return CACHE_PREFIX + dataset;
}

interface CacheDataset {
  ts: number;
  records: unknown[];
}

/** Purge best-effort de la clé plate historique (une fois, à l'init du module). */
function purgerCacheLegacyPlat(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(CACHE_LEGACY_PLAT);
  } catch {
    /* silencieux : localStorage indisponible / readonly. */
  }
}

/** Lecture tolérante du cache d'un dataset (absent / JSON corrompu / shape inattendue → null). */
function lireCacheDataset(dataset: DatasetCot): CacheDataset | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(cleDataset(dataset));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<CacheDataset> | null;
    if (!p || typeof p.ts !== "number" || !Array.isArray(p.records)) return null;
    return { ts: p.ts, records: p.records };
  } catch {
    return null;
  }
}

/** Écriture tolérante du cache d'un dataset (best-effort — quota localStorage peut échouer). */
function ecrireCacheDataset(dataset: DatasetCot, records: unknown[], ts: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(cleDataset(dataset), JSON.stringify({ ts, records }));
  } catch {
    /* best-effort : pas de cache vaut mieux qu'une UI cassée, le prochain run repartira du réseau. */
  }
}

/**
 * Lit le cache legacy SEUL et l'assemble en résumé, SANS AUCUN réseau (instantané pour le
 * BRIEF). Réutilise le lecteur de cache privé (clé/shape internes au module) et
 * `assemblerCategorie` — plus robuste que relire la clé localStorage depuis l'extérieur.
 * `null` si le cache legacy est absent (⇒ la section BRIEF est masquée). La fraîcheur (TTL)
 * est IGNORÉE : un rapport COT est hebdomadaire et le BRIEF n'est qu'un instantané.
 */
export function lireResumeLegacyCache(): ResumeCotCategorie | null {
  const cache = lireCacheDataset("legacy");
  if (cache === null) return null;
  return assemblerCategorie({ legacy: cache.records }, "legacy");
}

/** Fetch d'un dataset (records bruts). Rejette sur échec réseau/HTTP. */
async function fetchDataset(dataset: DatasetCot): Promise<unknown[]> {
  const qs = construireRequeteDataset(dataset, WATCHLIST_COT, Date.now());
  const res = await fetch(extUrl(HOTE, `resource/${DATASETS_COT[dataset].id}.json?${qs}`));
  if (!res.ok) throw new Error(`CFTC ${res.status}`);
  const json = (await res.json()) as unknown;
  return Array.isArray(json) ? json : [];
}

// Records en mémoire par dataset (miroir du cache localStorage, évite de re-parser le JSON à chaque
// bascule de catégorie). Hors du store zustand : ce sont des données volumineuses non réactives.
const recordsMem: Partial<Record<DatasetCot, unknown[]>> = {};
const recordsTs: Partial<Record<DatasetCot, number>> = {};

/** Identifiant de run courant : les résultats d'un run périmé (bascule rapide de catégorie) sont ignorés. */
let runCourant = 0;

purgerCacheLegacyPlat();

// ─────────────────────────── Store zustand vanilla ───────────────────────────

export interface CotState {
  /** Catégorie de positionnement affichée (défaut `legacy`). */
  categorie: CategoriePositionnement;
  /** Résumé assemblé pour la catégorie courante (lignes en ordre watchlist, stubs `nonCouvert` inclus). */
  resume: ResumeCotCategorie;
  /** true pendant un chargement réseau (la fenêtre affiche un état de chargement plutôt que « non couvert »). */
  enCours: boolean;
  /** Message d'erreur affichable si un fetch a échoué, sinon null. */
  erreur: string | null;
  /** true si le rendu courant s'appuie (au moins en partie) sur un cache PÉRIMÉ (bandeau côté fenêtre). */
  depuisCache: boolean;
  /** Horodatage du dernier assemblage, sinon null. */
  dateMaj: number | null;
  /** Change la catégorie et charge (lazy) le/les dataset(s) requis si absent(s)/périmé(s). */
  setCategorie: (categorie: CategoriePositionnement) => Promise<void>;
  /** Charge (lazy) les datasets requis par la catégorie courante puis réassemble. */
  charger: () => Promise<void>;
  /** Force le refetch des datasets de la catégorie courante (bouton Rafraîchir). */
  rafraichir: () => Promise<void>;
}

/**
 * S'assure que les records de `datasets` sont en mémoire et frais (< TTL), sinon les charge :
 * cache localStorage frais > réseau > repli sur cache périmé. Effet de bord (réseau + cache +
 * `recordsMem`/`recordsTs`). Renvoie un bilan de fraîcheur/échec pour la dégradation gracieuse.
 */
async function assurerDatasets(
  datasets: readonly DatasetCot[],
  force: boolean,
): Promise<{ echec: boolean; servisPerime: boolean }> {
  let echec = false;
  let servisPerime = false;

  for (const dataset of datasets) {
    // Mémoire fraîche : rien à faire (sauf force).
    const tsMem = recordsTs[dataset];
    if (!force && recordsMem[dataset] && tsMem !== undefined && Date.now() - tsMem < CACHE_TTL_MS) {
      continue;
    }

    // Cache localStorage frais : hydrate la mémoire sans réseau.
    const cache = lireCacheDataset(dataset);
    if (!force && cache && Date.now() - cache.ts < CACHE_TTL_MS) {
      recordsMem[dataset] = cache.records;
      recordsTs[dataset] = cache.ts;
      continue;
    }

    // Réseau (avec repli sur cache périmé en cas d'échec — même dégradation que l'existant).
    try {
      const records = await fetchDataset(dataset);
      const ts = Date.now();
      // Réponse vide alors qu'un cache existe : on préfère le cache (échec probable en amont).
      if (records.length === 0 && cache) {
        recordsMem[dataset] = cache.records;
        recordsTs[dataset] = cache.ts;
        servisPerime = true;
        continue;
      }
      recordsMem[dataset] = records;
      recordsTs[dataset] = ts;
      ecrireCacheDataset(dataset, records, ts);
    } catch {
      echec = true;
      const stale = cache ?? lireCacheDataset(dataset);
      if (stale) {
        recordsMem[dataset] = stale.records;
        recordsTs[dataset] = stale.ts;
        servisPerime = true;
      }
    }
  }

  return { echec, servisPerime };
}

export const cotStore = createStore<CotState>((set, get) => ({
  categorie: "legacy",
  resume: { lignes: [], dateRapport: null },
  enCours: false,
  erreur: null,
  depuisCache: false,
  dateMaj: null,

  charger: async () => {
    const run = ++runCourant;
    const categorie = get().categorie;
    set({ enCours: true });

    const { echec, servisPerime } = await assurerDatasets(datasetsRequis(categorie), false);

    // Run périmé (bascule de catégorie survenue pendant le fetch) : on abandonne ce rendu.
    if (run !== runCourant) return;

    if (echec) {
      healthStore.getState().marquerErreur(HEALTH_SOURCE, "Rapport COT (CFTC) indisponible");
    } else {
      healthStore.getState().setEtat(HEALTH_SOURCE, "polling", { dernierMessageTs: Date.now() });
    }

    const resume = assemblerCategorie(recordsMem, categorie);
    set({
      resume,
      enCours: false,
      depuisCache: servisPerime,
      erreur: echec ? "Rapport COT (CFTC) indisponible — dernières données conservées." : null,
      dateMaj: Date.now(),
    });
  },

  setCategorie: async (categorie) => {
    if (get().categorie === categorie) return;
    set({ categorie });
    // Réassemble IMMÉDIATEMENT depuis les records déjà en mémoire (feedback instantané, sans réseau
    // si les datasets requis sont déjà chargés — ex. bascule fonds↔commerciaux sur un dataset commun).
    set({ resume: assemblerCategorie(recordsMem, categorie) });
    await get().charger();
  },

  rafraichir: async () => {
    const run = ++runCourant;
    const categorie = get().categorie;
    set({ enCours: true });

    const { echec, servisPerime } = await assurerDatasets(datasetsRequis(categorie), true);
    if (run !== runCourant) return;

    if (echec) {
      healthStore.getState().marquerErreur(HEALTH_SOURCE, "Rapport COT (CFTC) indisponible");
    } else {
      healthStore.getState().setEtat(HEALTH_SOURCE, "polling", { dernierMessageTs: Date.now() });
    }

    const resume = assemblerCategorie(recordsMem, categorie);
    set({
      resume,
      enCours: false,
      depuisCache: servisPerime,
      erreur: echec ? "Rapport COT (CFTC) indisponible — dernières données conservées." : null,
      dateMaj: Date.now(),
    });
  },
}));
