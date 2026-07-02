/**
 * Store notes / journal — Zustand VANILLA (hors render-loop React).
 *
 * Notes horodatées ANCRÉES à un contexte de marché { symbole, source, timestamp, prix? } :
 * l'équivalent solo du chat d'un terminal pro. Le texte est un markdown court (rendu en
 * clair pour l'instant) et des tags libres permettent le filtrage. Mutations BASSE
 * fréquence (création / édition / suppression) : abonnement composant sans risque de tick.
 *
 * PERSISTANCE : même mécanisme consolidé que `store/alerts`/`store/portfolio` — localStorage
 * INTERNE (clé `axiom:notes:v1`), hydraté à la création, sauvegardé à chaque changement, et
 * miroité (best-effort, debounce) vers le daemon axiomd si détecté (namespace « notes »).
 * Clé `axiom:*` : incluse d'office dans l'export/import de sauvegarde (persist.ts).
 *
 * La recherche/filtre est exportée en fonctions PURES (testées dans notes.test.ts).
 */
import { createStore } from "zustand/vanilla";
import type { ExchangeId } from "@axiom/types";
import { daemonPret, kvPut } from "../data/daemon";
// Import de TYPE uniquement (élidé au runtime) : la palette est câblée par l'intégrateur.
import type { Commande } from "../commands/registry";
import { windowManagerStore, mirrorOpenState } from "./windowManager";

const STORAGE_KEY = "axiom:notes:v1";
/** Namespace + clé KV où les notes sont miroitées vers le daemon. */
const NS_NOTES = "notes";
const CLE_NOTES = "notes";
/** Fenêtre de coalescence des envois au daemon (ms). */
const DEBOUNCE_SYNC_MS = 400;

/** Une note ancrée à un contexte de marché. */
export interface Note {
  id: string;
  symbole: string; // ex. "BTCUSDT"
  source: ExchangeId; // exchange du contexte (pour « voir sur le chart »)
  timestamp: number; // ms epoch (création)
  /** Prix capturé au moment de la note (optionnel). */
  prix?: number;
  /** Texte markdown court. */
  texte: string;
  /** Tags libres (minuscules, dédoublonnés). */
  tags: string[];
}

/** Champs requis pour créer une note (le reste est initialisé par le store). */
export interface NouvelleNote {
  symbole: string;
  source: ExchangeId;
  prix?: number;
  texte: string;
  tags?: string[];
}

// ─────────────────────────── Recherche / filtre (PURS, testés) ───────────────────────────

/**
 * Normalise une saisie de tags en liste de tags propres : séparateurs virgule/espace,
 * minuscules, sans « # » de tête, dédoublonnés, vides écartés. PURE.
 */
export function parseTags(input: string): string[] {
  const tags = input
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase().replace(/^#/, ""))
    .filter((t) => t.length > 0);
  return Array.from(new Set(tags));
}

/** Critères de filtrage des notes (tous optionnels, combinés en ET). */
export interface FiltreNotes {
  /** Recherche plein texte simple (texte + symbole + tags). */
  texte?: string;
  /** Restreint à un symbole exact (insensible à la casse). */
  symbole?: string;
  /** Restreint à un tag exact. */
  tag?: string;
}

/**
 * Filtre les notes selon `filtre` et les RETOURNE en ordre ANTICHRONO (plus récent en
 * tête). Recherche plein texte = sous-chaîne sur texte + symbole + tags. PURE.
 */
export function rechercherNotes(notes: Note[], filtre: FiltreNotes): Note[] {
  const q = (filtre.texte ?? "").trim().toLowerCase();
  const sym = (filtre.symbole ?? "").trim().toUpperCase();
  const tag = (filtre.tag ?? "").trim().toLowerCase();
  return notes
    .filter((n) => {
      if (sym && n.symbole.toUpperCase() !== sym) return false;
      if (tag && !n.tags.includes(tag)) return false;
      if (q) {
        const foin = `${n.texte} ${n.symbole} ${n.tags.join(" ")}`.toLowerCase();
        if (!foin.includes(q)) return false;
      }
      return true;
    })
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp);
}

/** Tous les tags distincts présents dans les notes, triés. PURE. */
export function tousLesTags(notes: Note[]): string[] {
  const set = new Set<string>();
  for (const n of notes) for (const t of n.tags) set.add(t);
  return Array.from(set).sort();
}

// ─────────────────────────── État & persistance ───────────────────────────

export interface NotesState {
  notes: Note[];
  /** Crée une note (id généré, horodatée à maintenant). */
  ajouter: (n: NouvelleNote) => void;
  /** Édite le texte et/ou les tags d'une note existante. */
  modifier: (id: string, patch: { texte?: string; tags?: string[] }) => void;
  supprimer: (id: string) => void;
}

/** Identifiant unique (crypto.randomUUID si dispo, repli horodaté sinon). */
function genId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Lecture tolérante de l'état persisté (localStorage absent / JSON corrompu => vide). */
function lireInitial(): Note[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { notes?: unknown };
    return Array.isArray(parsed.notes) ? (parsed.notes as Note[]) : [];
  } catch {
    return [];
  }
}

/** Écriture tolérante (quota / mode privé => silencieux : persistance best-effort). */
function sauvegarder(notes: Note[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ notes }));
  } catch {
    /* ignore */
  }
}

export const notesStore = createStore<NotesState>((set) => ({
  notes: lireInitial(),

  ajouter: (n) =>
    set((s) => ({
      notes: [
        ...s.notes,
        {
          id: genId(),
          symbole: n.symbole.toUpperCase(),
          source: n.source,
          timestamp: Date.now(),
          prix: n.prix,
          texte: n.texte,
          tags: n.tags ?? [],
        },
      ],
    })),

  modifier: (id, patch) =>
    set((s) => ({
      notes: s.notes.map((n) =>
        n.id === id
          ? {
              ...n,
              texte: patch.texte ?? n.texte,
              tags: patch.tags ?? n.tags,
            }
          : n
      ),
    })),

  supprimer: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
}));

// ─────────────────────────── Miroir daemon (dual-write) ───────────────────────────

let minuteurSync: ReturnType<typeof setTimeout> | undefined;

/** Programme (debounce) un envoi des notes courantes au daemon, si détecté. */
function programmerSyncDaemon(notes: Note[]): void {
  if (!daemonPret()) return;
  if (minuteurSync !== undefined) clearTimeout(minuteurSync);
  minuteurSync = setTimeout(() => {
    void kvPut(NS_NOTES, CLE_NOTES, notes);
  }, DEBOUNCE_SYNC_MS);
}

// Persistance interne : sauvegarde à chaque changement + miroir daemon best-effort.
notesStore.subscribe((state, prev) => {
  if (state.notes === prev.notes) return;
  sauvegarder(state.notes);
  programmerSyncDaemon(state.notes);
});

// ─────────────────────────── Store UI du panneau (éphémère, NON persisté) ───────────────────────────

/** Brouillon de note prérempli (lien portfolio → notes : post-mortem de clôture). */
export interface BrouillonNote {
  symbole: string;
  source: ExchangeId;
  prix?: number;
  texte: string;
  tags?: string[];
}

export interface NotesUiState {
  /** true quand le panneau Notes est ouvert. */
  open: boolean;
  /** Brouillon en attente d'être seedé dans le formulaire (ou null). */
  brouillon: BrouillonNote | null;
  openNotes: () => void;
  closeNotes: () => void;
  toggleNotes: () => void;
  /** Ouvre le panneau et arme un brouillon prérempli (post-mortem). */
  proposerNote: (b: BrouillonNote) => void;
  /** Consomme le brouillon une fois seedé par le formulaire (évite de le rejouer). */
  consommerBrouillon: () => void;
}

/** Ouverture du panneau Notes + brouillon post-mortem — VANILLA, éphémère. */
export const notesUiStore = createStore<NotesUiState>((set) => ({
  open: false,
  brouillon: null,
  openNotes: () => windowManagerStore.getState().openWindow("notes"),
  closeNotes: () => windowManagerStore.getState().closeWindow("notes"),
  toggleNotes: () => windowManagerStore.getState().toggleWindow("notes"),
  proposerNote: (b) => {
    set({ brouillon: b });
    windowManagerStore.getState().openWindow("notes");
  },
  consommerBrouillon: () => set({ brouillon: null }),
}));

mirrorOpenState("notes", notesUiStore);

// ─────────────────────────── Commandes de palette (enregistrées par l'intégrateur) ───────────────────────────

/** Commandes à greffer dans la palette (via `enregistrerCommandes`). */
export const commandes: Commande[] = [
  {
    id: "panneau:notes",
    mnemonique: "NOTE",
    libelle: "Notes / journal",
    categorie: "panneau",
    motsCles: ["notes", "journal", "annotations", "carnet", "post-mortem", "note"],
    apercu: "Ouvre / ferme le panneau des notes",
    action: () => notesUiStore.getState().toggleNotes(),
  },
];
