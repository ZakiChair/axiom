/**
 * Heatmap de liquidité du carnet (BOOK) — logique PURE d'accumulation et de grille.
 *
 * POURQUOI ce module (et pas un simple overlay live) : le carnet d'ordres (`OrderBook`)
 * ne donne que l'INSTANT présent — les murs de liquidité qui apparaissent puis se
 * retirent avant exécution (style Bookmap) ne se voient qu'en conservant une TRACE dans
 * le temps. On échantillonne donc le carnet en COLONNES (≈1/seconde), on les accumule
 * dans un FIFO borné, et on projette la fenêtre visible en grille temps × prix au rendu.
 *
 * MODÈLE : le buffer FIFO + rev bump suit `liqEventsStore`/`bornerEvenements`
 * (chart/liquidationMarkers.ts) — colonnes brutes conservées, grille reconstruite à la
 * demande. L'intensité log (mêmes propriétés que `intensiteLog` de liquidationHeat.ts)
 * relève les petits ordres face aux murs massifs.
 *
 * Toutes les fonctions ici sont PURES (aucun accès DOM/store/chart) et testées
 * (depthHeat.test.ts). Le contrôleur canvas (Task 4) et le store d'accumulation
 * (Task 3) consomment ces exports mais ne sont pas dans ce module.
 */
import { agregerNiveaux, pasArrondi, type NiveauAgrege, type OrderBook } from "../data/depth";

/** Nombre de niveaux agrégés conservés PAR CÔTÉ (bid/ask) dans chaque colonne. Convention
 *  reprise de `pasArrondi` (vise ~20 niveaux couvrant ~1 % autour du mid) et de
 *  `DomWindow.tsx` (LADDER_ROWS=20, seul appelant existant d'agregerNiveaux). Réserve :
 *  ajustable si la plage visible typique de la heatmap dépasse cette bande de ~1 %. */
export const LIMITE_NIVEAUX = 20;

/** Une colonne = un instant échantillonné du carnet (niveaux déjà agrégés par pas de prix). */
export interface ColonneDepth {
  t: number;
  pas: number;
  bids: NiveauAgrege[];
  asks: NiveauAgrege[];
}

/** Taille du FIFO de colonnes ≈ 30 min à raison de 1 colonne/seconde. */
export const MAX_COLONNES = 1800;
/** Cadence d'échantillonnage visée (informatif — le contrôleur décide quand appeler). */
export const INTERVALLE_COLONNE_MS = 1000;

/** Meilleur bid / meilleur ask d'un carnet (clé max des bids, clé min des asks). PURE. */
function meilleurs(livre: OrderBook): { bestBid: number; bestAsk: number } | null {
  let bestBid = -Infinity;
  for (const prix of livre.bids.keys()) if (prix > bestBid) bestBid = prix;
  let bestAsk = Infinity;
  for (const prix of livre.asks.keys()) if (prix < bestAsk) bestAsk = prix;
  if (bestBid === -Infinity || bestAsk === Infinity) return null;
  return { bestBid, bestAsk };
}

/**
 * Échantillonne une colonne du carnet à `nowMs` : pas dérivé du mid (`pasArrondi`), bids/asks
 * agrégés par ce pas (`agregerNiveaux`, bornés à `LIMITE_NIVEAUX` par côté). Carnet sans
 * best bid/ask (vide) → mid 0 → `pasArrondi(0)` replie sur 1, colonnes bid/ask vides
 * (agregerNiveaux sur des Maps vides renvoie `[]`). PURE.
 */
export function echantillonnerColonne(livre: OrderBook, nowMs: number): ColonneDepth {
  const best = meilleurs(livre);
  const mid = best === null ? 0 : (best.bestBid + best.bestAsk) / 2;
  const pas = pasArrondi(mid);
  const bids = agregerNiveaux([...livre.bids.entries()], pas, "bid", LIMITE_NIVEAUX);
  const asks = agregerNiveaux([...livre.asks.entries()], pas, "ask", LIMITE_NIVEAUX);
  return { t: nowMs, pas, bids, asks };
}

/** Ajoute une colonne au buffer FIFO, borné à `max` (défaut `MAX_COLONNES`) : au-delà, les
 *  plus anciennes sont écartées (modèle `bornerEvenements`). PURE. */
export function ajouterColonne(colonnes: ColonneDepth[], c: ColonneDepth, max: number = MAX_COLONNES): ColonneDepth[] {
  const next = [...colonnes, c];
  return next.length <= max ? next : next.slice(next.length - max);
}

/** Résultat de la projection en grille : cellules aplaties (colonne-major), nombre de
 *  colonnes couvertes et quantité max (pilote la normalisation de l'intensité). */
export interface GrilleDepth {
  cellules: Float32Array;
  nCols: number;
  qtyMax: number;
}

/**
 * Construit la grille temps × prix sur la plage visible [deMs, aMs) × [prixMin, prixMax],
 * découpée en `nLignes` lignes de prix égales. Colonnes hors plage temporelle exclues ;
 * pour chaque colonne retenue, chaque niveau bid/ask dont le prix tombe dans une ligne
 * cumule sa quantité dans la cellule `[colonne][ligne]` (indexée colonne-major :
 * `col * nLignes + ligne`). `qtyMax` = plus grande valeur de cellule (0 si la grille est
 * vide). PURE.
 */
export function grilleDepuisColonnes(
  colonnes: ColonneDepth[],
  deMs: number,
  aMs: number,
  prixMin: number,
  prixMax: number,
  nLignes: number,
): GrilleDepth {
  const visibles = colonnes.filter((c) => c.t >= deMs && c.t < aMs);
  const nCols = visibles.length;
  const cellules = new Float32Array(Math.max(0, nCols * nLignes));
  let qtyMax = 0;
  if (nCols === 0 || nLignes <= 0 || !(prixMax > prixMin)) return { cellules, nCols, qtyMax };

  const hauteur = (prixMax - prixMin) / nLignes;
  const ajouter = (niveaux: NiveauAgrege[], col: number): void => {
    for (const n of niveaux) {
      if (n.prix < prixMin || n.prix >= prixMax) continue;
      const ligne = Math.min(nLignes - 1, Math.floor((n.prix - prixMin) / hauteur));
      const idx = col * nLignes + ligne;
      const v = (cellules[idx] ?? 0) + n.qte;
      cellules[idx] = v;
      if (v > qtyMax) qtyMax = v;
    }
  };

  visibles.forEach((c, col) => {
    ajouter(c.bids, col);
    ajouter(c.asks, col);
  });

  return { cellules, nCols, qtyMax };
}

/**
 * Intensité log-normalisée ∈ [0,1] : `log1p(qty) / log1p(qtyMax)`, clampée. Même contrat
 * que `intensiteLog` de liquidationHeat.ts — la log relève les petits ordres face aux
 * murs massifs. Renvoie 0 si `qtyMax <= 0`. PURE.
 */
export function intensiteLogDepth(qty: number, qtyMax: number): number {
  if (!(qtyMax > 0)) return 0;
  const t = Math.log1p(Math.max(0, qty)) / Math.log1p(qtyMax);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
