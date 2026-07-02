/**
 * Store portefeuille — Zustand VANILLA (hors render-loop React).
 *
 * Tient les POSITIONS saisies à la main (long/short) : ouvertes puis clôturées. La
 * valorisation LIVE (PnL latent) n'est PAS stockée ici — elle est calculée à la volée
 * par le panneau depuis les prix des WS existants (subscribeTickers), écrite en DOM
 * impératif. Ce store n'héberge que des mutations BASSE fréquence (ajout / clôture /
 * suppression) : un composant peut donc s'y abonner sans re-render sur tick.
 *
 * PERSISTANCE : même mécanisme consolidé que `store/alerts` — localStorage INTERNE au
 * store (clé `axiom:portfolio:v1`), hydraté à la création puis sauvegardé à chaque
 * changement, DOUBLÉ (best-effort) d'un `kvPut` debouncé vers le daemon axiomd si
 * détecté (namespace « portfolio »). Sans daemon : repli localStorage intégral. La clé
 * `axiom:*` est automatiquement incluse dans l'export/import de sauvegarde (persist.ts).
 *
 * La logique de calcul (PnL, exposition, stats de clôtures) est exportée en fonctions
 * PURES (testées dans portfolio.test.ts) et réutilisée par le panneau.
 */
import { createStore } from "zustand/vanilla";
import type { ExchangeId } from "@axiom/types";
import { daemonPret, kvPut } from "../data/daemon";
// Import de TYPE uniquement (élidé au runtime) : la palette est câblée par l'intégrateur.
import type { Commande } from "../commands/registry";
import { windowManagerStore, mirrorOpenState } from "./windowManager";

const STORAGE_KEY = "axiom:portfolio:v1";
/** Namespace + clé KV où les positions sont miroitées vers le daemon. */
const NS_PORTFOLIO = "portfolio";
const CLE_POSITIONS = "positions";
/** Fenêtre de coalescence des envois au daemon (ms). */
const DEBOUNCE_SYNC_MS = 400;

/** Sens d'une position. */
export type Direction = "long" | "short";
/** Cycle de vie d'une position. */
export type StatutPosition = "ouvert" | "clos";

/** Une position du portefeuille (saisie manuelle). */
export interface Position {
  id: string;
  symbole: string; // ex. "BTCUSDT"
  source: ExchangeId; // exchange d'origine (pour « voir sur le chart » + valorisation)
  direction: Direction;
  /** Taille en unités de l'actif de base (quantité). */
  taille: number;
  prixEntree: number;
  /** Frais TOTAL en % appliqué au notionnel (entrée + sortie). Optionnel. */
  fraisPct?: number;
  dateEntree: number; // ms epoch
  /** Note libre courte associée à l'ouverture. Optionnelle. */
  note?: string;
  statut: StatutPosition;
  prixSortie?: number; // rempli à la clôture
  dateSortie?: number; // ms epoch, rempli à la clôture
}

/** Champs requis pour ouvrir une position (le reste est initialisé par le store). */
export interface NouvellePosition {
  symbole: string;
  source: ExchangeId;
  direction: Direction;
  taille: number;
  prixEntree: number;
  fraisPct?: number;
  dateEntree?: number; // défaut = maintenant
  note?: string;
}

/** Résultat d'un calcul de PnL (en devise de cotation). */
export interface PnL {
  /** PnL brut, avant frais. */
  brut: number;
  /** Frais estimés/réalisés (aller-retour). */
  frais: number;
  /** PnL net (brut − frais). */
  net: number;
  /** Rendement net rapporté au notionnel d'entrée, en %. */
  pct: number;
}

/** Ventilation d'exposition (notionnels en devise de cotation). */
export interface Exposition {
  /** Somme des notionnels ouverts (long + short), sans signe. */
  brute: number;
  /** Exposition nette signée (long − short). */
  nette: number;
  longue: number;
  courte: number;
  /** Notionnel NET signé par symbole (long +, short −). */
  parActif: Record<string, number>;
}

/** Statistiques agrégées des positions clôturées. */
export interface StatsClotures {
  nombre: number;
  gagnants: number;
  perdants: number;
  /** Taux de réussite en % (0 si aucune clôture). */
  winRate: number;
  /** Somme des PnL nets réalisés. */
  pnlCumule: number;
  /** Meilleur PnL net réalisé (null si aucune clôture). */
  meilleure: number | null;
  /** Pire PnL net réalisé (null si aucune clôture). */
  pire: number | null;
}

// ─────────────────────────── Calculs PURS (testés) ───────────────────────────

/** Notionnel d'une jambe (prix × taille). PURE. */
function notionnel(prix: number, taille: number): number {
  return prix * taille;
}

/**
 * PnL d'une position valorisée à `prixSortie` (courant pour le latent, effectif pour le
 * réalisé). Long : (sortie − entrée) × taille ; short : (entrée − sortie) × taille. Les
 * frais sont estimés en % du notionnel des DEUX jambes (entrée + sortie). PURE.
 */
function calculerPnl(p: Position, prixSortie: number): PnL {
  const signe = p.direction === "long" ? 1 : -1;
  const brut = signe * (prixSortie - p.prixEntree) * p.taille;
  const tauxFrais = (p.fraisPct ?? 0) / 100;
  const frais = tauxFrais * (notionnel(p.prixEntree, p.taille) + notionnel(prixSortie, p.taille));
  const net = brut - frais;
  const notEntree = notionnel(p.prixEntree, p.taille);
  const pct = notEntree > 0 ? (net / notEntree) * 100 : 0;
  return { brut, frais, net, pct };
}

/** PnL LATENT d'une position au prix courant (null si prix invalide). PURE. */
export function pnlLatentPosition(p: Position, prixCourant: number): PnL | null {
  if (!Number.isFinite(prixCourant) || prixCourant <= 0) return null;
  return calculerPnl(p, prixCourant);
}

/** PnL RÉALISÉ d'une position clôturée (null si non clôturée / prix de sortie absent). PURE. */
export function pnlRealisePosition(p: Position): PnL | null {
  if (p.prixSortie === undefined || !Number.isFinite(p.prixSortie) || p.prixSortie <= 0) return null;
  return calculerPnl(p, p.prixSortie);
}

/**
 * Exposition des positions OUVERTES, valorisées au prix courant (repli sur le prix d'entrée
 * si le symbole n'a pas de prix live). `prix` = carte symbole → prix courant. PURE.
 */
export function calculerExposition(positions: Position[], prix: Record<string, number>): Exposition {
  let longue = 0;
  let courte = 0;
  const parActif: Record<string, number> = {};
  for (const p of positions) {
    if (p.statut !== "ouvert") continue;
    const px = prix[p.symbole];
    const ref = px !== undefined && Number.isFinite(px) && px > 0 ? px : p.prixEntree;
    const not = notionnel(ref, p.taille);
    if (p.direction === "long") longue += not;
    else courte += not;
    const signe = p.direction === "long" ? 1 : -1;
    parActif[p.symbole] = (parActif[p.symbole] ?? 0) + signe * not;
  }
  return { brute: longue + courte, nette: longue - courte, longue, courte, parActif };
}

/**
 * PnL LATENT total des positions ouvertes (somme des nets), en n'incluant que celles dont
 * le prix courant est connu. `prix` = carte symbole → prix courant. PURE.
 */
export function pnlLatentTotal(positions: Position[], prix: Record<string, number>): number {
  let total = 0;
  for (const p of positions) {
    if (p.statut !== "ouvert") continue;
    const px = prix[p.symbole];
    if (px === undefined) continue;
    const pnl = pnlLatentPosition(p, px);
    if (pnl) total += pnl.net;
  }
  return total;
}

/** Statistiques des positions clôturées (win rate, cumul, meilleure/pire). PURE. */
export function statsClotures(positions: Position[]): StatsClotures {
  const nets: number[] = [];
  for (const p of positions) {
    if (p.statut !== "clos") continue;
    const pnl = pnlRealisePosition(p);
    if (pnl) nets.push(pnl.net);
  }
  const nombre = nets.length;
  const gagnants = nets.filter((n) => n > 0).length;
  const perdants = nets.filter((n) => n < 0).length;
  const winRate = nombre > 0 ? (gagnants / nombre) * 100 : 0;
  const pnlCumule = nets.reduce((acc, n) => acc + n, 0);
  const meilleure = nombre > 0 ? Math.max(...nets) : null;
  const pire = nombre > 0 ? Math.min(...nets) : null;
  return { nombre, gagnants, perdants, winRate, pnlCumule, meilleure, pire };
}

// ─────────────────────────── État & persistance ───────────────────────────

export interface PortfolioState {
  positions: Position[];
  /** Ouvre une position (id généré, statut « ouvert »). */
  ajouter: (n: NouvellePosition) => void;
  /** Clôture une position au `prixSortie` donné (statut « clos »). */
  cloturer: (id: string, prixSortie: number) => void;
  supprimer: (id: string) => void;
}

/** Identifiant unique (crypto.randomUUID si dispo, repli horodaté sinon). */
function genId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `pos_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Lecture tolérante de l'état persisté (localStorage absent / JSON corrompu => vide). */
function lireInitial(): Position[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { positions?: unknown };
    return Array.isArray(parsed.positions) ? (parsed.positions as Position[]) : [];
  } catch {
    return [];
  }
}

/** Écriture tolérante (quota / mode privé => silencieux : persistance best-effort). */
function sauvegarder(positions: Position[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ positions }));
  } catch {
    /* ignore */
  }
}

export const portfolioStore = createStore<PortfolioState>((set) => ({
  positions: lireInitial(),

  ajouter: (n) =>
    set((s) => ({
      positions: [
        ...s.positions,
        {
          id: genId(),
          symbole: n.symbole.toUpperCase(),
          source: n.source,
          direction: n.direction,
          taille: n.taille,
          prixEntree: n.prixEntree,
          fraisPct: n.fraisPct,
          dateEntree: n.dateEntree ?? Date.now(),
          note: n.note,
          statut: "ouvert",
        },
      ],
    })),

  cloturer: (id, prixSortie) =>
    set((s) => ({
      positions: s.positions.map((p) =>
        p.id === id ? { ...p, statut: "clos", prixSortie, dateSortie: Date.now() } : p
      ),
    })),

  supprimer: (id) => set((s) => ({ positions: s.positions.filter((p) => p.id !== id) })),
}));

// ─────────────────────────── Miroir daemon (dual-write) ───────────────────────────
//
// Même esprit que store/alerts : en plus de localStorage, les positions sont poussées au
// daemon (KV « portfolio »/« positions ») pour la durabilité. On ne SONDE PAS le réseau
// (daemonPret est synchrone) : sans daemon détecté, aucun effet.

let minuteurSync: ReturnType<typeof setTimeout> | undefined;

/** Programme (debounce) un envoi des positions courantes au daemon, si détecté. */
function programmerSyncDaemon(positions: Position[]): void {
  if (!daemonPret()) return;
  if (minuteurSync !== undefined) clearTimeout(minuteurSync);
  minuteurSync = setTimeout(() => {
    void kvPut(NS_PORTFOLIO, CLE_POSITIONS, positions);
  }, DEBOUNCE_SYNC_MS);
}

// Persistance interne : sauvegarde à chaque changement + miroir daemon best-effort.
portfolioStore.subscribe((state, prev) => {
  if (state.positions === prev.positions) return;
  sauvegarder(state.positions);
  programmerSyncDaemon(state.positions);
});

// ─────────────────────────── Store UI du panneau (éphémère, NON persisté) ───────────────────────────

export interface PortfolioUiState {
  /** true quand le panneau Portefeuille est ouvert. */
  open: boolean;
  openPortfolio: () => void;
  closePortfolio: () => void;
  togglePortfolio: () => void;
}

/** Ouverture du panneau Portefeuille — VANILLA, éphémère (cf. derivatives-ui). */
export const portfolioUiStore = createStore<PortfolioUiState>(() => ({
  open: false,
  openPortfolio: () => windowManagerStore.getState().openWindow("portfolio"),
  closePortfolio: () => windowManagerStore.getState().closeWindow("portfolio"),
  togglePortfolio: () => windowManagerStore.getState().toggleWindow("portfolio"),
}));

mirrorOpenState("portfolio", portfolioUiStore);

// ─────────────────────────── Commandes de palette (enregistrées par l'intégrateur) ───────────────────────────

/** Commandes à greffer dans la palette (via `enregistrerCommandes`). */
export const commandes: Commande[] = [
  {
    id: "panneau:portfolio",
    mnemonique: "PORT",
    libelle: "Portefeuille",
    categorie: "panneau",
    motsCles: ["portefeuille", "portfolio", "positions", "pnl", "exposition", "journal"],
    apercu: "Ouvre / ferme le panneau portefeuille",
    action: () => portfolioUiStore.getState().togglePortfolio(),
  },
];
