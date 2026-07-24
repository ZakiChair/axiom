/**
 * PAPER TRADING — modèle et évaluateur PUR (aucun effet de bord, aucun accès réseau).
 *
 * Le store (T2) branchera `evaluerTick` sur le flux live ; ici on ne fait QUE de la logique
 * déterministe. Conventions ARRÊTÉES et figées (documentées plutôt que choisies en silence) :
 *
 *  - FRAIS : taker 0.05 %/côté (FRAIS_TAKER). L'ouverture débite `taille × prix × FRAIS_TAKER`
 *    du solde. La clôture débite les frais sur le prix de SORTIE. Le notionnel n'est JAMAIS
 *    débité : le solde ne reflète que les frais + le PnL réalisé.
 *  - COMPTABILITÉ D'UNE CLÔTURE : pnlUsd = brut signé − frais de sortie. Les frais d'entrée ont
 *    déjà été débités à l'ouverture → PAS de double compte. Le solde est crédité de pnlUsd.
 *    (Sur un aller-retour, le solde bouge de : brut − fraisEntrée − fraisSortie.)
 *  - SENS DES TRAVERSÉES (`evaluerTick`) :
 *      · limit long  rempli si last ≤ prixLimite  (on achète moins cher) — AU prix limite ;
 *      · limit short rempli si last ≥ prixLimite  (on vend plus cher)   — AU prix limite ;
 *      · stop  long  déclenché si last ≥ prixStop  (entrée en cassure)  → market → à `last` ;
 *      · stop  short déclenché si last ≤ prixStop                        → market → à `last`.
 *  - TP/SL D'UNE POSITION (remplis AU NIVEAU, pas à `last`) :
 *      · long  : SL si last ≤ sl, TP si last ≥ tp ;
 *      · short : SL si last ≥ sl, TP si last ≤ tp ;
 *      · si les deux sont vrais dans le même tick → SL (hypothèse pessimiste : stop supposé
 *        touché en premier). Impossible avec des niveaux bien formés ; documenté par sûreté.
 *  - FUSION : par symbol + direction. Un renfort recalcule le prix d'entrée moyen pondéré et
 *    additionne les tailles ; le TP/SL de l'ordre ÉCRASE celui de la position s'il est non null.
 *    Long et short d'un même symbole COEXISTENT (pas de netting — l'état porte un tableau).
 *  - PERF : `evaluerTick` sur un symbole sans ordre ni position actif retourne le MÊME objet
 *    (référence identique) — le moteur en dépend.
 *  - executions bornées aux 50 dernières.
 */
import type { TradeJournal } from "./expy";

export interface OrdrePaper {
  id: string;
  symbol: string;
  direction: "long" | "short";
  type: "market" | "limit" | "stop";
  prixLimite: number | null;
  prixStop: number | null;
  taille: number;
  tp: number | null;
  sl: number | null;
  creeTs: number;
}

export interface PositionPaper {
  id: string;
  symbol: string;
  direction: "long" | "short";
  taille: number;
  prixEntree: number;
  tp: number | null;
  sl: number | null;
  ouvertTs: number;
}

/** pnlUsd null pour ouverture/renfort (pas de réalisé) ; renseigné pour tp/sl/cloture-manuelle. */
export interface ExecutionPaper {
  ts: number;
  symbol: string;
  genre: "ouverture" | "renfort" | "tp" | "sl" | "cloture-manuelle";
  direction: "long" | "short";
  taille: number;
  prix: number;
  fraisUsd: number;
  pnlUsd: number | null;
}

export const FRAIS_TAKER = 0.0005;

/** executions bornées aux 50 dernières. */
export interface EtatPaper {
  solde: number;
  ordres: OrdrePaper[];
  positions: PositionPaper[];
  executions: ExecutionPaper[];
}

const MAX_EXECUTIONS = 50;

/** Signe directionnel : long +1, short −1. */
function signe(direction: "long" | "short"): number {
  return direction === "short" ? -1 : 1;
}

/** PnL latent (non réalisé) d'une position au prix `last`, SIGNÉ, SANS frais. Fonction PURE. */
export function pnlLatent(p: PositionPaper, last: number): number {
  return (last - p.prixEntree) * p.taille * signe(p.direction);
}

/** Un remplissage d'ordre résolu ce tick (avant fusion dans les positions). */
interface Remplissage {
  ordreId: string;
  direction: "long" | "short";
  taille: number;
  prix: number;
  tp: number | null;
  sl: number | null;
}

/**
 * Applique un remplissage aux positions : renfort (même symbol+direction) au prix moyen pondéré,
 * sinon nouvelle position (id = id de l'ordre, déterministe). Renvoie les positions mises à jour
 * et le genre de l'exécution. NE mute pas l'entrée.
 */
function fusionner(
  positions: PositionPaper[],
  symbol: string,
  f: Remplissage,
  nowMs: number,
): { positions: PositionPaper[]; genre: "ouverture" | "renfort" } {
  const idx = positions.findIndex((p) => p.symbol === symbol && p.direction === f.direction);
  if (idx === -1) {
    const nouvelle: PositionPaper = {
      id: f.ordreId,
      symbol,
      direction: f.direction,
      taille: f.taille,
      prixEntree: f.prix,
      tp: f.tp,
      sl: f.sl,
      ouvertTs: nowMs,
    };
    return { positions: [...positions, nouvelle], genre: "ouverture" };
  }
  const existante = positions[idx]!;
  const tailleTot = existante.taille + f.taille;
  const prixMoyen = (existante.taille * existante.prixEntree + f.taille * f.prix) / tailleTot;
  const fusionnee: PositionPaper = {
    ...existante,
    taille: tailleTot,
    prixEntree: prixMoyen,
    // Le TP/SL de l'ordre écrase celui de la position s'il est non null, sinon on conserve.
    tp: f.tp !== null ? f.tp : existante.tp,
    sl: f.sl !== null ? f.sl : existante.sl,
  };
  const suivantes = positions.slice();
  suivantes[idx] = fusionnee;
  return { positions: suivantes, genre: "renfort" };
}

/**
 * Évalue un tick de prix sur `symbol`. PURE : retourne un NOUVEL état (ou le MÊME si rien
 * d'actif sur le symbole). Ordre des 4 étapes :
 *   1) stops déclenchés → deviennent market ce tick ;
 *   2) markets remplis à `last` → fusion dans les positions ;
 *   3) limits remplis à la traversée AU prix limite → fusion ;
 *   4) TP/SL des positions du symbole (SL prioritaire) → clôture totale AU niveau + PnL réalisé.
 */
export function evaluerTick(etat: EtatPaper, symbol: string, last: number, nowMs: number): EtatPaper {
  const aDesOrdres = etat.ordres.some((o) => o.symbol === symbol);
  const aDesPositions = etat.positions.some((p) => p.symbol === symbol);
  // Perf : rien à faire sur ce symbole → même référence.
  if (!aDesOrdres && !aDesPositions) return etat;

  let solde = etat.solde;
  const executions: ExecutionPaper[] = [];
  const ordresRestants: OrdrePaper[] = [];
  // Deux seaux SÉPARÉS pour respecter l'ordre des étapes : les markets (étape 2, dont les stops
  // déclenchés à l'étape 1) sont appliqués AVANT les limits (étape 3) — un même tick où un market
  // et un limit ouvrent le même symbole+direction : le market ouvre, le limit renforce.
  const remplissagesMarket: Remplissage[] = [];
  const remplissagesLimit: Remplissage[] = [];

  // Étapes 1→3 : résolution des ordres du symbole. Les ordres des autres symboles passent tels quels.
  for (const o of etat.ordres) {
    if (o.symbol !== symbol) {
      ordresRestants.push(o);
      continue;
    }
    // Étape 1 : un stop déclenché devient market ce tick.
    let type = o.type;
    if (type === "stop") {
      const declenche =
        o.prixStop !== null &&
        (o.direction === "long" ? last >= o.prixStop : last <= o.prixStop);
      if (declenche) type = "market";
    }
    // Étape 2 : market rempli à `last`.
    if (type === "market") {
      remplissagesMarket.push({ ordreId: o.id, direction: o.direction, taille: o.taille, prix: last, tp: o.tp, sl: o.sl });
      continue;
    }
    // Étape 3 : limit rempli à la traversée, AU prix limite.
    if (type === "limit") {
      const traverse =
        o.prixLimite !== null &&
        (o.direction === "long" ? last <= o.prixLimite : last >= o.prixLimite);
      if (traverse) {
        remplissagesLimit.push({ ordreId: o.id, direction: o.direction, taille: o.taille, prix: o.prixLimite as number, tp: o.tp, sl: o.sl });
        continue;
      }
    }
    // Stop non déclenché / limit non traversé → reste en attente.
    ordresRestants.push(o);
  }

  // Application des remplissages aux positions : étape 2 (markets) PUIS étape 3 (limits).
  let positions = etat.positions;
  for (const f of [...remplissagesMarket, ...remplissagesLimit]) {
    const fraisEntree = f.taille * f.prix * FRAIS_TAKER;
    solde -= fraisEntree;
    const { positions: maj, genre } = fusionner(positions, symbol, f, nowMs);
    positions = maj;
    executions.push({
      ts: nowMs, symbol, genre, direction: f.direction,
      taille: f.taille, prix: f.prix, fraisUsd: fraisEntree, pnlUsd: null,
    });
  }

  // Étape 4 : TP/SL des positions du symbole (SL prioritaire), clôture totale AU niveau.
  const positionsRestantes: PositionPaper[] = [];
  for (const p of positions) {
    if (p.symbol !== symbol) {
      positionsRestantes.push(p);
      continue;
    }
    const slTouche =
      p.sl !== null && (p.direction === "long" ? last <= p.sl : last >= p.sl);
    const tpTouche =
      p.tp !== null && (p.direction === "long" ? last >= p.tp : last <= p.tp);
    if (!slTouche && !tpTouche) {
      positionsRestantes.push(p);
      continue;
    }
    const genre: "sl" | "tp" = slTouche ? "sl" : "tp"; // SL prioritaire (pessimiste)
    const prixSortie = (slTouche ? p.sl : p.tp) as number;
    const brut = (prixSortie - p.prixEntree) * p.taille * signe(p.direction);
    const fraisSortie = p.taille * prixSortie * FRAIS_TAKER;
    const pnl = brut - fraisSortie;
    solde += pnl;
    executions.push({
      ts: nowMs, symbol, genre, direction: p.direction,
      taille: p.taille, prix: prixSortie, fraisUsd: fraisSortie, pnlUsd: pnl,
    });
    // Clôture totale : la position disparaît.
  }

  return {
    solde,
    ordres: ordresRestants,
    positions: positionsRestantes,
    executions: [...etat.executions, ...executions].slice(-MAX_EXECUTIONS),
  };
}

/**
 * Clôture manuelle d'une position au prix donné (frais de sortie, PnL réalisé crédité au solde).
 * PURE. Id inconnu → même référence (rien à faire).
 */
export function cloturerPosition(etat: EtatPaper, positionId: string, prix: number, nowMs: number): EtatPaper {
  const p = etat.positions.find((x) => x.id === positionId);
  if (!p) return etat;

  const brut = (prix - p.prixEntree) * p.taille * signe(p.direction);
  const fraisSortie = p.taille * prix * FRAIS_TAKER;
  const pnl = brut - fraisSortie;
  const exec: ExecutionPaper = {
    ts: nowMs, symbol: p.symbol, genre: "cloture-manuelle", direction: p.direction,
    taille: p.taille, prix, fraisUsd: fraisSortie, pnlUsd: pnl,
  };

  return {
    solde: etat.solde + pnl,
    ordres: etat.ordres,
    positions: etat.positions.filter((x) => x.id !== positionId),
    executions: [...etat.executions, exec].slice(-MAX_EXECUTIONS),
  };
}

/**
 * Construit un trade de journal (EXPY) à partir d'une position clôturée et de son exécution.
 * stopInitial = sl ?? prixEntree (si sl null, le risque sera 0 → R null en aval : documenté).
 * tag "paper", note = genre de l'exécution.
 */
export function tradeJournalDepuisCloture(p: PositionPaper, exec: ExecutionPaper): Omit<TradeJournal, "id"> {
  return {
    symbol: p.symbol,
    direction: p.direction,
    entree: p.prixEntree,
    stopInitial: p.sl ?? p.prixEntree,
    taille: p.taille,
    sortie: exec.prix,
    ouvertTs: p.ouvertTs,
    fermeTs: exec.ts,
    note: exec.genre,
    tags: ["paper"],
  };
}
