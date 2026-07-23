/**
 * Bulles de prints BALEINES (WHALE) sur le chart — épingle les gros trades AGRESSIFS
 * directement sur les bougies, en bulles proportionnelles au notionnel, vert/rouge
 * selon le côté agresseur.
 *
 * POURQUOI ce module : un « print » de plusieurs centaines de milliers de dollars qui
 * frappe le carnet est un évènement de flux ; POSÉ sur la bougie où il a eu lieu, il
 * raconte QUI a pris l'initiative (achat/vente agressif) et à QUEL prix. On dessine donc
 * un cercle plein (rayon ∝ √notionnel, borné) coloré --up/--down, + une étiquette du
 * montant (formatUsd) pour les prints VRAIMENT énormes (≥ 5× le seuil) — le reste du
 * temps le rayon seul suffit et l'écran reste lisible.
 *
 * MODÈLE : calqué sur `chart/tradeMarkers.ts` (même overlay custom `registerOverlay`,
 * même contrôleur SINGLETON qui pose ses overlays via `getActiveChart()`, même cycle
 * « efface par id suivi puis recrée », mêmes abonnements filtrés `prev*`). Différence
 * ASSUMÉE avec tradeMarkers : la source n'est pas un store d'évènements mais un FLUX
 * TICK (trades spot + perp), consommé façon `OrderflowController.ensureTrades` —
 * accumulation dans un BUFFER hors React (jamais de tick dans un store Zustand, cf.
 * BUILD-CONTRACT), redraw THROTTLÉ (~2 Hz : les overlays KLineChart sont plus coûteux
 * qu'un canvas).
 *
 * Convention de CÔTÉ : `Trade.side` = agresseur (taker), tel que produit par
 * `aggTradeToTrade` (data/binance.ts) — on ne l'inverse JAMAIS.
 *
 * La PROJECTION des trades en prints, l'échelle de rayon et le nettoyage des overlays
 * sont des fonctions PURES exportées et testées (whaleBubbles.test.ts) ; le couplage
 * KLineChart reste dans le contrôleur non testé (comme tradeMarkers / ecoMarkers).
 */
import type { Trade } from "@axiom/types";
import { formatUsd } from "../lib/format";

/** Cap défensif du buffer de prints : au-delà, on garde les PLUS RÉCENTS (FIFO). */
export const WHALE_MAX_PRINTS = 500;

/** Rayon min/max (px) d'une bulle — borne l'échelle √notionnel (lisibilité + perf). */
const R_MIN = 4;
const R_MAX = 18;

/** Un print baleine projeté (donnée pure, indépendante de KLineChart). */
export interface WhalePrint {
  /** Horodatage du trade (ms epoch) — ancre en X. */
  time: number;
  /** Prix du trade (> 0) — ancre en Y. */
  price: number;
  /** Notionnel en devise de cotation = price × qty (absent du type Trade, calculé ici). */
  notionnel: number;
  /** Côté AGRESSEUR (taker) — jamais inversé (cf. aggTradeToTrade). */
  side: "buy" | "sell";
}

// ─────────────────────────── Fonctions PURES (testées) ───────────────────────────

/**
 * Projette un trade en print baleine SI son notionnel (price × qty) atteint le seuil,
 * sinon `null` (trade trop petit, filtré en amont du buffer). Le côté agresseur est
 * conservé tel quel. PURE.
 */
export function versWhalePrint(t: Trade, seuil: number): WhalePrint | null {
  const notionnel = t.price * t.qty;
  if (notionnel < seuil) return null;
  return { time: t.time, price: t.price, notionnel, side: t.side };
}

/**
 * Ajoute un print au buffer en le bornant à `max` (FIFO : évince les plus anciens).
 * Renvoie un NOUVEAU tableau (ne mute pas l'entrée). PURE.
 */
export function ajouterPrint(
  buffer: WhalePrint[],
  p: WhalePrint,
  max = WHALE_MAX_PRINTS,
): WhalePrint[] {
  const suite = [...buffer, p];
  return suite.length > max ? suite.slice(suite.length - max) : suite;
}

/**
 * Rayon (px) d'une bulle : proportionnel à √(notionnel/seuil) — l'AIRE croît donc
 * linéairement avec le notionnel (perception visuelle correcte), bornée [R_MIN, R_MAX].
 * Au seuil exact → R_MIN ; ×4 le notionnel → ×2 le rayon. PURE.
 */
export function rayonBulle(notionnel: number, seuil: number): number {
  const r = R_MIN * Math.sqrt(notionnel / seuil);
  return Math.max(R_MIN, Math.min(R_MAX, r));
}

/**
 * Étiquette du montant (formatUsd) pour les prints VRAIMENT énormes (≥ 5× le seuil),
 * sinon `null` (le rayon seul suffit — on n'encombre pas l'écran de texte). PURE.
 */
export function labelPourPrint(p: WhalePrint, seuil: number): string | null {
  return p.notionnel >= 5 * seuil ? formatUsd(p.notionnel) : null;
}

/**
 * Surface MINIMALE d'une instance de chart pour le retrait des bulles (structurel :
 * l'instance KLineChart la satisfait). Isolée pour tester la logique de nettoyage
 * multi-instances sans dépendre de klinecharts.
 */
export interface CibleOverlays {
  removeOverlay(filtre: { id: string }): void;
}

/**
 * Retire les bulles de TOUTES les instances suivies (chacune par ses ids) puis vide le
 * registre. Une instance DÉTRUITE (dispose) peut faire lever `removeOverlay` : on isole
 * chaque instance (try/catch) pour qu'une instance morte n'empêche pas de nettoyer les
 * autres. PURE (n'accède à aucun état de module) → testable avec un chart factice.
 * Identique à `retirerMarqueursSuivis` (tradeMarkers.ts).
 */
export function retirerBullesSuivies<C extends CibleOverlays>(suivis: Map<C, string[]>): void {
  for (const [chart, ids] of suivis) {
    for (const id of ids) {
      try {
        chart.removeOverlay({ id });
      } catch {
        break; // instance détruite : inutile d'insister sur ses autres ids.
      }
    }
  }
  suivis.clear();
}
