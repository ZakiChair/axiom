/**
 * Projection PURE des trades d'un run de backtest en marqueurs de graphe (lot C1).
 *
 * Il n'existait AUCUN fil entre le backtest et le graphique : `backtestStore` n'était lu
 * que par sa propre fenêtre, `chart/tradeMarkers.ts` ne connaît que le portefeuille, et la
 * table des trades n'était pas cliquable. Le troisième verbe du parcours — régler, lancer,
 * puis VOIR chaque trade dans son contexte de prix — n'était câblé à rien
 * (revue du 2026-08-01 § 6.3).
 *
 * DEUX GARDES qui font la valeur de ce module :
 *  1. le SCOPE : un run décrit un couple (symbole, pas de temps) précis. Projeter ses
 *     trades sur un autre actif afficherait des entrées à des prix qui n'ont aucun sens
 *     sur la série affichée ;
 *  2. la DISTINCTION visuelle : le chart porte déjà deux familles de triangles pleins
 *     (stratégies et trades du portefeuille). Ceux-ci sont CREUX — plein = signal ou
 *     trade réel, creux = trade simulé.
 */
import type { TradeResultat } from "@axiom/backtest";
import type { Timeframe } from "@axiom/types";

/** Cap défensif, aligné sur `tradeMarkers` : au-delà, on garde les plus RÉCENTS. */
export const MAX_MARQUEURS_BT = 200;

/** Ce qu'un run décrit : ses marqueurs n'ont de sens que sur ce couple. */
export interface ScopeRun {
  symbole: string;
  timeframe: Timeframe;
}

/** Un marqueur de trade simulé, prêt à dessiner (aucune dépendance à klinecharts). */
export interface MarqueurBt {
  /** Clé stable — l'index du trade dans le run suffit, il ne bouge pas. */
  cle: string;
  /** Bornes du trade (ms epoch de l'open des bougies de fill). */
  tempsEntree: number;
  tempsSortie: number;
  prixEntree: number;
  prixSortie: number;
  /** Sens de la position : oriente le triangle d'entrée. */
  sens: "long" | "short";
  /** Signe du PnL net : couleur du segment et de la sortie. */
  gagnant: boolean;
  /** Étiquette de sortie, déjà formatée (« +1.24 % »). */
  label: string;
}

/** Un prix plaçable en Y : fini et strictement positif. */
function prixValide(p: number): boolean {
  return Number.isFinite(p) && p > 0;
}

/**
 * Le run décrit-il bien l'actif AFFICHÉ ? Comparaison insensible à la casse sur le
 * symbole (le builder accepte « btcusdt »), stricte sur le pas de temps. PURE.
 */
export function memeScope(run: ScopeRun | null, affiche: ScopeRun): boolean {
  if (run === null) return false;
  return (
    run.symbole.toUpperCase() === affiche.symbole.toUpperCase() &&
    run.timeframe === affiche.timeframe
  );
}

/**
 * Étiquette d'un trade simulé : le pourcentage rapporté à la taille engagée, avec « + »
 * explicite sur les gains. PURE.
 */
export function etiquetteTradeBt(pnlPct: number): string {
  const s = `${pnlPct.toFixed(2)} %`;
  return pnlPct > 0 ? `+${s}` : s;
}

/**
 * Projette les trades d'un run en marqueurs. Retourne une liste VIDE si le run ne décrit
 * pas l'actif affiché — la garde est ici, pas au call site, pour qu'elle soit testée.
 * Les trades aux prix non plaçables sont ignorés ; le résultat est borné aux `max` plus
 * récents (les plus anciens sortent en premier, comme ailleurs sur le chart). PURE.
 */
export function projeterTradesBt(
  trades: readonly TradeResultat[],
  run: ScopeRun | null,
  affiche: ScopeRun,
  max = MAX_MARQUEURS_BT
): MarqueurBt[] {
  if (!memeScope(run, affiche)) return [];
  const out: MarqueurBt[] = [];
  trades.forEach((t, i) => {
    if (!prixValide(t.prixEntree) || !prixValide(t.prixSortie)) return;
    if (!Number.isFinite(t.tempsEntree) || !Number.isFinite(t.tempsSortie)) return;
    out.push({
      cle: `bt:${i}`,
      tempsEntree: t.tempsEntree,
      tempsSortie: t.tempsSortie,
      prixEntree: t.prixEntree,
      prixSortie: t.prixSortie,
      sens: t.sens === "short" ? "short" : "long",
      gagnant: t.pnl >= 0,
      label: etiquetteTradeBt(t.pnlPct),
    });
  });
  return out.sort((a, b) => b.tempsEntree - a.tempsEntree).slice(0, max);
}

/**
 * Nombre de trades ÉCARTÉS par le cap — affiché en clair plutôt que tronqué en silence
 * (le chart avait déjà trois plafonds muets, cf. revue § 6.3). PURE.
 */
export function tradesTronques(nbTrades: number, max = MAX_MARQUEURS_BT): number {
  return Math.max(0, nbTrades - max);
}
