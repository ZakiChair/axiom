/**
 * Stores NEWS — Zustand VANILLA (hors render-loop React).
 *
 * Deux stores dans un seul module (périmètre de la mission) :
 *  - `newsUiStore`  : ouverture du PANNEAU non modal (comme derivatives-ui) — éphémère,
 *                     NON persisté.
 *  - `newsStore`    : données agrégées (items, statuts par flux, dernière maj) + marquage
 *                     LU/non-lu léger. Les items sont écrits par la veille (data/news.ts)
 *                     et lus en basse fréquence par le panneau. Le marquage « lu » est
 *                     persisté seul dans localStorage (léger, best-effort, borné).
 *
 * Le tableau `commandes` est exporté pour la palette : l'intégrateur l'enregistre via
 * `enregistrerCommandes` (import de TYPE seul depuis commands/registry → aucune
 * dépendance runtime, pas de cycle).
 */
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry";
import type { FeedStatut, NewsItem, NewsSourceId } from "../data/news";

// ─────────────────────────── Store UI (ouverture du panneau) ───────────────────────────

export interface NewsUiState {
  /** true quand le panneau NEWS est ouvert. */
  open: boolean;
  openNews: () => void;
  closeNews: () => void;
  /** Bascule l'ouverture (mnémonique NEWS). */
  toggleNews: () => void;
}

export const newsUiStore = createStore<NewsUiState>((set, get) => ({
  open: false,
  openNews: () => set({ open: true }),
  closeNews: () => set({ open: false }),
  toggleNews: () => set({ open: !get().open }),
}));

// ─────────────────────────── Persistance « lu » (localStorage, léger) ───────────────────────────

const STORAGE_LUS = "axiom:news:read";
/** Plafond d'ids « lus » conservés (évite une croissance illimitée). */
const MAX_LUS = 1000;

/** Lecture tolérante des ids lus persistés. */
function lireLus(): string[] {
  try {
    const brut = localStorage.getItem(STORAGE_LUS);
    if (brut === null) return [];
    const arr = JSON.parse(brut) as unknown;
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Écriture tolérante (mode privé / quota => silencieux), bornée à MAX_LUS entrées. */
function ecrireLus(ids: Iterable<string>): void {
  try {
    const arr = [...ids];
    const borne = arr.length > MAX_LUS ? arr.slice(arr.length - MAX_LUS) : arr;
    localStorage.setItem(STORAGE_LUS, JSON.stringify(borne));
  } catch {
    /* best-effort : le marquage lu n'est pas critique */
  }
}

// ─────────────────────────── Store données ───────────────────────────

export interface NewsDataState {
  /** News fusionnées, triées par date décroissante. */
  items: NewsItem[];
  /** Statut du dernier cycle par flux (pour l'affichage « source hors ligne »). */
  statuts: Partial<Record<NewsSourceId, FeedStatut>>;
  /** Horodatage ms de la dernière mise à jour réussie (null = jamais). */
  derniereMaj: number | null;
  /** Ensemble des ids marqués lus (persisté). */
  lus: ReadonlySet<string>;
  /** Applique un cycle réussi : remplace items + statuts, met à jour derniereMaj. */
  appliquerResultat: (items: NewsItem[], statuts: Partial<Record<NewsSourceId, FeedStatut>>) => void;
  /** Met à jour les seuls statuts (cycle tout-en-erreur : items conservés). */
  setStatuts: (statuts: Partial<Record<NewsSourceId, FeedStatut>>) => void;
  /** Marque une news lue (persisté). */
  marquerLu: (id: string) => void;
  /** Marque plusieurs news lues d'un coup (« tout marquer lu »). */
  marquerLus: (ids: string[]) => void;
}

export const newsStore = createStore<NewsDataState>((set, get) => ({
  items: [],
  statuts: {},
  derniereMaj: null,
  lus: new Set(lireLus()),

  appliquerResultat: (items, statuts) =>
    set((s) => ({ items, statuts: { ...s.statuts, ...statuts }, derniereMaj: Date.now() })),

  setStatuts: (statuts) => set((s) => ({ statuts: { ...s.statuts, ...statuts } })),

  marquerLu: (id) => {
    if (get().lus.has(id)) return;
    const lus = new Set(get().lus);
    lus.add(id);
    ecrireLus(lus);
    set({ lus });
  },

  marquerLus: (ids) => {
    const lus = new Set(get().lus);
    let change = false;
    for (const id of ids) {
      if (!lus.has(id)) {
        lus.add(id);
        change = true;
      }
    }
    if (!change) return;
    ecrireLus(lus);
    set({ lus });
  },
}));

// ─────────────────────────── Commandes de palette (additives) ───────────────────────────

/** Commandes NEWS greffées dans la palette par l'intégrateur (`enregistrerCommandes`). */
export const commandes: Commande[] = [
  {
    id: "panneau:news",
    mnemonique: "NEWS",
    libelle: "Actualités crypto",
    categorie: "panneau",
    motsCles: ["news", "actualites", "flux", "rss", "coindesk", "cointelegraph", "the block", "decrypt"],
    apercu: "Ouvre / ferme le panneau des actualités",
    action: () => newsUiStore.getState().toggleNews(),
  },
];
