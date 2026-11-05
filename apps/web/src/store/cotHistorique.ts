/**
 * Store de l'historique COT par marché — alimente l'onglet « Graphique » de la fenêtre COT.
 *
 * Pour le marché et le rapport choisis : découverte des colonnes réelles puis historique complet
 * (cf. `data/cotHistorique.ts`), cache local compact, et SUIVI HEBDOMADAIRE : tant que le
 * graphique est affiché, une minuterie relit la CFTC à la publication suivante (vendredi
 * 15 h 30, New York), puis toutes les 6 h si le rapport attendu tarde, 30 min après un échec.
 * Fenêtre fermée : rien ne tourne ; à la réouverture, un historique périmé est relu.
 *
 * Cache localStorage : une entrée compacte par (rapport, marché), au plus `MAX_ENTREES`
 * (moins récemment consultée évincée). Toute écriture est best-effort : un quota plein ou un
 * stockage indisponible n'empêche jamais l'affichage. Sur échec réseau, la dernière série
 * conservée reste affichée avec un bandeau ; jamais d'exception vers l'interface.
 */
import { createStore } from "zustand/vanilla";
import { WATCHLIST_COT, type DatasetCot } from "../data/cot";
import {
  cheminSocrata,
  colonnesPresentes,
  compacterSerie,
  construireRequeteDecouverte,
  construireRequeteHistorique,
  datasetGraphe,
  decompacterSerie,
  finValiditeHistorique,
  historiqueAJour,
  instrumentCot,
  parserHistorique,
  resoudreColonnes,
  type ModeRapportGraphe,
  type SerieHistoriqueCot,
} from "../data/cotHistorique";
import { extUrl } from "../data/extapi";
import { healthStore } from "./health";

const HOTE = "publicreporting.cftc.gov";
const HEALTH_SOURCE = "cot:cftc";

/** Préfixe des entrées de cache : `axiom:cot:historique:v1:<dataset>:<marché>`. */
export const PREFIXE_CACHE_HISTORIQUE = "axiom:cot:historique:v1:";
/** Index LRU des entrées (clés, de la plus récente à la plus ancienne). */
export const CLE_INDEX_HISTORIQUE = "axiom:cot:historique-index:v1";
/** Dernière sélection (confort de l'utilisateur, non critique). */
export const CLE_SELECTION_HISTORIQUE = "axiom:cot:graphique:v1";
/** Nombre maximal de séries gardées en cache local (≈ 100-150 Kio chacune au plus). */
export const MAX_ENTREES = 8;
/** Nouvelle tentative après un échec réseau, tant que le graphique est affiché. */
export const RELANCE_ERREUR_MS = 30 * 60 * 1000;
/** Marché affiché par défaut : le S&P 500, exposition institutionnelle la plus suivie. */
const MARCHE_DEFAUT = "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE";

// ─────────────────────────── Cache local (effets de bord tolérants) ───────────────────────────

interface EntreeHistorique {
  ts: number;
  serie: SerieHistoriqueCot;
}

export function cleCacheHistorique(dataset: DatasetCot, nom: string): string {
  return `${PREFIXE_CACHE_HISTORIQUE}${dataset}:${nom}`;
}

function stockage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function lireIndex(ls: Storage): string[] {
  try {
    const brut = JSON.parse(ls.getItem(CLE_INDEX_HISTORIQUE) ?? "[]") as unknown;
    return Array.isArray(brut) ? brut.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

/** Lecture tolérante d'une entrée (absente, corrompue ou d'un autre format → null). */
export function lireCacheHistorique(cle: string): EntreeHistorique | null {
  const ls = stockage();
  if (ls === null) return null;
  try {
    const brut = JSON.parse(ls.getItem(cle) ?? "null") as { ts?: unknown; serie?: unknown } | null;
    if (brut === null || typeof brut.ts !== "number" || !Number.isFinite(brut.ts)) return null;
    const serie = decompacterSerie(brut.serie);
    return serie === null ? null : { ts: brut.ts, serie };
  } catch {
    return null;
  }
}

/**
 * Écrit une entrée en tête de l'index LRU et évince au-delà de `MAX_ENTREES`. Sur quota
 * plein, évince la plus ancienne et réessaie, jusqu'à ne garder que l'entrée courante.
 */
export function ecrireCacheHistorique(cle: string, entree: EntreeHistorique): void {
  const ls = stockage();
  if (ls === null) return;
  const valeur = JSON.stringify({ ts: entree.ts, serie: compacterSerie(entree.serie) });
  let index = [cle, ...lireIndex(ls).filter((c) => c !== cle)];
  for (;;) {
    for (const evincee of index.slice(MAX_ENTREES)) {
      try {
        ls.removeItem(evincee);
      } catch {
        /* best-effort */
      }
    }
    index = index.slice(0, MAX_ENTREES);
    try {
      ls.setItem(cle, valeur);
      ls.setItem(CLE_INDEX_HISTORIQUE, JSON.stringify(index));
      return;
    } catch {
      // Quota : libère la plus ancienne entrée (hors courante) et réessaie.
      if (index.length <= 1) return;
      const evincee = index.pop()!;
      try {
        ls.removeItem(evincee);
      } catch {
        return;
      }
    }
  }
}

/** Touche l'index LRU (entrée consultée = plus récente). Best-effort. */
function toucherIndex(cle: string): void {
  const ls = stockage();
  if (ls === null) return;
  try {
    const index = lireIndex(ls);
    if (index[0] === cle || !index.includes(cle)) return;
    ls.setItem(CLE_INDEX_HISTORIQUE, JSON.stringify([cle, ...index.filter((c) => c !== cle)]));
  } catch {
    /* best-effort */
  }
}

function lireSelection(): { marche: string; mode: ModeRapportGraphe } {
  const defaut = { marche: MARCHE_DEFAUT, mode: "detaille" as ModeRapportGraphe };
  const ls = stockage();
  if (ls === null) return defaut;
  try {
    const brut = JSON.parse(ls.getItem(CLE_SELECTION_HISTORIQUE) ?? "null") as { marche?: unknown; mode?: unknown } | null;
    const marche = typeof brut?.marche === "string" && instrumentCot(brut.marche) !== null ? brut.marche : defaut.marche;
    const mode = brut?.mode === "legacy" || brut?.mode === "detaille" ? brut.mode : defaut.mode;
    return { marche, mode };
  } catch {
    return defaut;
  }
}

function ecrireSelection(marche: string, mode: ModeRapportGraphe): void {
  try {
    stockage()?.setItem(CLE_SELECTION_HISTORIQUE, JSON.stringify({ marche, mode }));
  } catch {
    /* best-effort */
  }
}

// ─────────────────────────── Réseau ───────────────────────────

async function lireJson(chemin: string): Promise<unknown> {
  const res = await fetch(extUrl(HOTE, chemin));
  if (!res.ok) throw new Error(`CFTC ${res.status}`);
  return (await res.json()) as unknown;
}

/**
 * Découverte des colonnes puis historique complet. `null` si le marché n'a aucune ligne dans
 * ce rapport (non couvert). Rejette sur échec réseau ou si aucune colonne de positions n'est
 * reconnue dans la réponse réelle.
 */
async function telechargerHistorique(dataset: DatasetCot, nom: string): Promise<SerieHistoriqueCot | null> {
  const decouverte = await lireJson(cheminSocrata(dataset, construireRequeteDecouverte(nom)));
  if (!Array.isArray(decouverte) || decouverte.length === 0) return null;
  const colonnes = resoudreColonnes(dataset, colonnesPresentes(decouverte));
  if (colonnes.categories.every((c) => c === null)) {
    throw new Error("colonnes de positions introuvables dans la réponse CFTC");
  }
  const historique = await lireJson(cheminSocrata(dataset, construireRequeteHistorique(nom, colonnes)));
  return parserHistorique(historique, dataset, nom, colonnes);
}

// ─────────────────────────── Store ───────────────────────────

export interface CotHistoriqueState {
  /** Nom CFTC exact du marché affiché (watchlist). */
  marche: string;
  /** Rapport tracé : détaillé (TFF/Disaggregated) ou Legacy. */
  mode: ModeRapportGraphe;
  /** Série du couple (rapport, marché) courant, null tant qu'aucune n'est connue. */
  serie: SerieHistoriqueCot | null;
  /** Instant de récupération de `serie` (réseau), null sans série. */
  ts: number | null;
  enCours: boolean;
  erreur: string | null;
  /** Le marché n'apparaît pas dans le rapport choisi. */
  nonCouvert: boolean;
  selectionner: (marche: string) => Promise<void>;
  setMode: (mode: ModeRapportGraphe) => Promise<void>;
  /** Charge si absent ou périmé (publication suivante passée). */
  charger: () => Promise<void>;
  /** Relit la CFTC sans attendre (bouton Rafraîchir). */
  rafraichir: () => Promise<void>;
  /** Suivi hebdomadaire actif tant qu'au moins un graphique est monté. Renvoie la désactivation. */
  activerSuivi: () => () => void;
}

const memoire = new Map<string, EntreeHistorique>();
let runCourant = 0;
let minuterie: ReturnType<typeof setTimeout> | null = null;
let suivis = 0;
/** Plafond de setTimeout (2^31 − 1 ms ≈ 24,8 j). */
const DELAI_MAX = 2_147_483_647;

/** Vide l'état module (tests uniquement). */
export function reinitialiserCotHistorique(): void {
  memoire.clear();
  runCourant++;
  if (minuterie !== null) clearTimeout(minuterie);
  minuterie = null;
  suivis = 0;
}

const selection = lireSelection();

export const cotHistoriqueStore = createStore<CotHistoriqueState>((set, get) => {
  const cleCourante = (): { dataset: DatasetCot; nom: string; cle: string } => {
    const { marche, mode } = get();
    const inst = instrumentCot(marche) ?? WATCHLIST_COT[0]!;
    const dataset = datasetGraphe(inst.categorie, mode);
    return { dataset, nom: inst.nom, cle: cleCacheHistorique(dataset, inst.nom) };
  };

  /** (Re)programme la prochaine relecture, seulement si un graphique est affiché. */
  const planifier = (): void => {
    if (minuterie !== null) clearTimeout(minuterie);
    minuterie = null;
    const { serie, ts, erreur, nonCouvert } = get();
    if (suivis <= 0 || nonCouvert) return;
    const now = Date.now();
    const echeance =
      erreur !== null || ts === null
        ? now + RELANCE_ERREUR_MS
        : finValiditeHistorique(serie?.points.at(-1)?.t ?? null, ts);
    // 30 s de marge après l'échéance ; jamais moins d'une minute entre deux relectures.
    const delai = Math.min(Math.max(echeance - now + 30_000, 60_000), DELAI_MAX);
    minuterie = setTimeout(() => {
      minuterie = null;
      void get().charger();
    }, delai);
  };

  /** Affiche immédiatement ce qui est connu (mémoire, puis cache local) pour la clé courante. */
  const afficherConnu = (cle: string): EntreeHistorique | null => {
    let entree = memoire.get(cle) ?? null;
    if (entree === null) {
      entree = lireCacheHistorique(cle);
      if (entree !== null) memoire.set(cle, entree);
    }
    if (entree !== null) toucherIndex(cle);
    set({ serie: entree?.serie ?? null, ts: entree?.ts ?? null, nonCouvert: false });
    return entree;
  };

  const executer = async (force: boolean): Promise<void> => {
    const run = ++runCourant;
    const { dataset, nom, cle } = cleCourante();
    const connu = afficherConnu(cle);
    const dernier = connu?.serie.points.at(-1)?.t ?? null;
    if (!force && connu !== null && historiqueAJour(dernier, connu.ts, Date.now())) {
      set({ enCours: false, erreur: null });
      planifier();
      return;
    }

    set({ enCours: true });
    try {
      const serie = await telechargerHistorique(dataset, nom);
      if (run !== runCourant) return;
      healthStore.getState().setEtat(HEALTH_SOURCE, "polling", { dernierMessageTs: Date.now() });
      if (serie === null) {
        set({ serie: null, ts: null, enCours: false, erreur: null, nonCouvert: true });
        planifier();
        return;
      }
      if (serie.points.length === 0) throw new Error("historique vide");
      const entree = { ts: Date.now(), serie };
      memoire.set(cle, entree);
      ecrireCacheHistorique(cle, entree);
      set({ serie, ts: entree.ts, enCours: false, erreur: null, nonCouvert: false });
    } catch {
      if (run !== runCourant) return;
      healthStore.getState().marquerErreur(HEALTH_SOURCE, "Historique COT (CFTC) indisponible");
      set({
        enCours: false,
        erreur:
          connu !== null
            ? "Historique COT (CFTC) indisponible — dernières données conservées."
            : "Historique COT (CFTC) indisponible.",
      });
    }
    planifier();
  };

  return {
    marche: selection.marche,
    mode: selection.mode,
    serie: null,
    ts: null,
    enCours: false,
    erreur: null,
    nonCouvert: false,

    selectionner: async (marche) => {
      if (instrumentCot(marche) === null || marche === get().marche) return;
      set({ marche, erreur: null });
      ecrireSelection(marche, get().mode);
      await executer(false);
    },

    setMode: async (mode) => {
      if (mode === get().mode) return;
      set({ mode, erreur: null });
      ecrireSelection(get().marche, mode);
      await executer(false);
    },

    charger: () => executer(false),
    rafraichir: () => executer(true),

    activerSuivi: () => {
      suivis++;
      planifier();
      let actif = true;
      return () => {
        if (!actif) return;
        actif = false;
        suivis = Math.max(0, suivis - 1);
        if (suivis === 0 && minuterie !== null) {
          clearTimeout(minuterie);
          minuterie = null;
        }
      };
    },
  };
});
