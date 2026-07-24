/**
 * Overlay PAPER — ordres simulés et TP/SL des positions du chart MAÎTRE en lignes de prix
 * horizontales. Pour le SYMBOLE COURANT du maître uniquement : ordres en attente limit/stop
 * (à leur prix de repos) + take-profit / stop-loss des positions ouvertes. Toggle DANS
 * PaperWindow (défaut ON, éphémère — le contraste avec DIST « persisté » est voulu).
 *
 * CONVENTION DE COULEUR (choix assumé) :
 *  - ORDRES en attente : couleur par SENS — long → `--up`, short → `--down` ;
 *  - TP/SL des positions : couleur par NATURE — TP → `--up` (cible), SL → `--down` (protection),
 *    indépendamment du sens de la position (un SL de long comme de short est un repli « down »).
 * Toutes en emphase FORTE (ce sont des niveaux d'action, pas du contexte). Pas de drag (v1 :
 * l'édition passe par la fenêtre).
 *
 * SOURCE : `paperStore` (état de trading, hors React) + symbole du `marketStore` maître. Réactif
 * à l'ajout/annulation/fill d'ordre et au changement de symbole du chart. Ce module n'expose que
 * le store de bascule, le helper PUR `niveauxPaperLignes` (testé) et un `FournisseurLignes`
 * singleton ; le RENDU est assuré par `NiveauxLignesController`, instancié par ChartInstance.
 */
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { Unsubscribe } from "@axiom/types";
import type { EtatPaper } from "../data/paper";
import { paperStore } from "../store/paper";
import { marketStore } from "../store/market";
import type { FournisseurLignes, LigneNiveau } from "./niveauxLignes";

// ─────────────────────────── Helper PUR (testé) ───────────────────────────

/** Taille compacte (jusqu'à 4 décimales, zéros de fin retirés) pour l'étiquette. PURE. */
function fmtTaille(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 1e4) / 1e4) : "—";
}

/**
 * Construit les lignes de niveaux PAPER pour `symbol` (le symbole courant du maître) UNIQUEMENT :
 *  - ordres du symbole : limit → prixLimite, stop → prixStop (les market n'ont PAS de prix de
 *    repos → écartés), étiquette « côté type taille », couleur par sens (long/short) ;
 *  - positions du symbole : une ligne par TP non null et une par SL non null, étiquette
 *    « côté TP|SL taille », couleur TP=`--up` / SL=`--down`.
 * Les ordres/positions des AUTRES symboles sont ignorés. PURE.
 */
export function niveauxPaperLignes(etat: EtatPaper, symbol: string): LigneNiveau[] {
  const lignes: LigneNiveau[] = [];

  for (const o of etat.ordres) {
    if (o.symbol !== symbol) continue;
    const couleur = o.direction === "long" ? "--up" : "--down";
    const taille = fmtTaille(o.taille);
    if (o.type === "limit" && o.prixLimite !== null) {
      lignes.push({ price: o.prixLimite, label: `${o.direction} limit ${taille}`, couleur, emphase: "forte" });
    } else if (o.type === "stop" && o.prixStop !== null) {
      lignes.push({ price: o.prixStop, label: `${o.direction} stop ${taille}`, couleur, emphase: "forte" });
    }
    // type market → aucun prix de repos à tracer.
  }

  for (const p of etat.positions) {
    if (p.symbol !== symbol) continue;
    const taille = fmtTaille(p.taille);
    if (p.tp !== null) {
      lignes.push({ price: p.tp, label: `${p.direction} TP ${taille}`, couleur: "--up", emphase: "forte" });
    }
    if (p.sl !== null) {
      lignes.push({ price: p.sl, label: `${p.direction} SL ${taille}`, couleur: "--down", emphase: "forte" });
    }
  }

  return lignes;
}

// ─────────────────────────── Bascule (store vanilla, éphémère) ───────────────────────────

export interface PaperOverlayState {
  actif: boolean;
  basculer: () => void;
}

/** État on/off de l'overlay PAPER — VANILLA, éphémère (NON persisté), défaut ON. */
export const paperOverlayStore: StoreApi<PaperOverlayState> = createStore<PaperOverlayState>((set, get) => ({
  actif: true,
  basculer: () => set({ actif: !get().actif }),
}));

// ─────────────────────────── Fournisseur de lignes ───────────────────────────

/**
 * Fournisseur des lignes PAPER : lignes du symbole COURANT du maître, recalculées quand les
 * ordres/positions changent (ajout/annulation/fill — on ignore les ticks qui ne touchent que
 * `derniersPrix`) ou quand le symbole du chart change.
 */
export const fournisseurPaperLignes: FournisseurLignes = {
  getLignes(): LigneNiveau[] {
    return niveauxPaperLignes(paperStore.getState(), marketStore.getState().symbol);
  },
  subscribe(onChange: () => void): Unsubscribe {
    // Store paper : ne réagir qu'aux mutations ordres/positions (un tick ne change que
    // `derniersPrix` → pas de recalcul des lignes).
    let prevOrdres = paperStore.getState().ordres;
    let prevPositions = paperStore.getState().positions;
    const unsubPaper = paperStore.subscribe((s) => {
      if (s.ordres !== prevOrdres || s.positions !== prevPositions) {
        prevOrdres = s.ordres;
        prevPositions = s.positions;
        onChange();
      }
    });
    // Marché : changement de symbole du maître (les lignes suivent le symbole affiché).
    let prevSymbol = marketStore.getState().symbol;
    const unsubMarket = marketStore.subscribe(() => {
      const symbol = marketStore.getState().symbol;
      if (symbol !== prevSymbol) {
        prevSymbol = symbol;
        onChange();
      }
    });
    return () => {
      unsubPaper();
      unsubMarket();
    };
  },
};
