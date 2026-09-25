/**
 * Grille 2D pure des liquidations : agrège les événements bruts (`LiqEvent`, Tâche 4) en
 * cellules (une BOUGIE × un BUCKET de prix) sur la plage visible, en séparant long/short.
 * C'est le moteur d'agrégation qui alimentera le contrôleur canvas de la heatmap (Tâche 6).
 *
 * Modèle : les événements sont conservés bruts ; le re-bucketing est gratuit, donc la taille
 * de bucket est RECALCULÉE à chaque construction depuis le close de la dernière bougie de la
 * plage (plus de taille figée). L'échelle d'intensité est LOGARITHMIQUE (log1p) pour relever
 * les petits niveaux face aux cascades massives.
 *
 * Toutes les fonctions ici sont PURES (aucun accès DOM/store/chart) et testées.
 */
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { ActionType, DomPosition } from "klinecharts";
import type { Bounding, Chart, Crosshair, Point } from "klinecharts";
import type { Candle } from "@axiom/types";
import {
  tailleBucket,
  bucketIndex,
  candleContenant,
  couleurViridis,
  VIRIDIS,
  liqEventsStore,
  liqMarksStore,
  joursApproxDansEvenements,
  type LiqEvent,
  type LiqHeatMode,
} from "./liquidationMarkers";
import {
  liqEstStore,
  oiHistStore,
  calculerNiveauxEstimesDetail,
  type NiveauEstime,
  type NiveauConsomme,
} from "./liquidationEstimates";
import { hlLiqStore, type EtatHl } from "../data/hyperliquidLiq";
import {
  assurerHeat,
  arreterHeat,
  hlHeatStore,
  type EtatHeat,
  type InstantaneHlHeat,
} from "../data/hyperliquidHeat";
import { basePerp, splitSymbol } from "../data/symbol";
import type { Commande } from "../commands/registry";
import { marketStore } from "../store/market";
import { themeStore } from "../store/theme";
import { orderflowStore } from "../store/orderflow";
import { volumeProfileStore } from "../store/volumeProfile";
import { formatDateHeure, formatHeureMinute, formatPrice, formatUsd } from "../lib/format";
import { lireTokenCanvas } from "../lib/canvasTokens";

/** Cellule agrégée : une bougie × un bucket de prix. */
export interface LiqCell {
  candleTime: number;
  bucketIdx: number;
  longUsd: number;
  shortUsd: number;
  count: number;
  /** Temps du dernier événement agrégé dans la cellule (max des `time`) — pilote le fade-in
   *  des cellules fraîches au RENDER (cf. `alphaFadeIn`) ; absent si la cellule est vide.
   *  Sur la grille HL, porte le `ts` de l'instantané retenu (affiché dans le tooltip). */
  dernierTime?: number;
  /** Nombre de niveaux par côté — renseigné par la grille HL (tooltip « (n) »). */
  nLong?: number;
  nShort?: number;
}

/** Grille complète : cellules indexées par `${candleTime}:${bucketIdx}` + méta. */
export interface LiqGrid {
  cells: Map<string, LiqCell>;
  taille: number;
  maxUsd: number; // max(longUsd + shortUsd) sur les cellules
}

/**
 * Agrège les `events` en cellules (bougie × bucket) sur la plage de bougies [from, to)
 * (INDEX de bougies, convention `getVisibleRange`). La taille de bucket est dérivée du close
 * de la DERNIÈRE bougie de la plage, MULTIPLIÉE par `facteurTaille` (granularité utilisateur :
 * ½× / 1× / 2× — cf. `liqMarksStore.granularite`) ; chaque événement est rattaché à sa bougie
 * contenante (`candleContenant`), et les événements hors de [candles[from].time,
 * candles[to-1].time] sont écartés. Renvoie `null` si la plage contient < 1 bougie ou ne
 * produit aucune cellule. PURE.
 */
export function construireGrille(
  events: LiqEvent[],
  candles: Candle[],
  from: number,
  to: number,
  facteurTaille = 1,
): LiqGrid | null {
  if (to - from < 1) return null;
  const premier = candles[from];
  const dernier = candles[to - 1];
  if (premier === undefined || dernier === undefined) return null;

  const taille = tailleBucket(dernier.close) * facteurTaille;
  if (!(taille > 0)) return null;

  const cells = new Map<string, LiqCell>();
  for (const ev of events) {
    if (!(ev.price > 0) || !Number.isFinite(ev.usd)) continue;
    const c = candleContenant(candles, ev.time);
    if (c === undefined) continue;
    // Rattachement borné à la plage visible : les temps de bougie sont croissants, donc
    // c.time ∈ [premier.time, dernier.time] ⇔ index de la bougie ∈ [from, to).
    if (c.time < premier.time || c.time > dernier.time) continue;

    const bucketIdx = bucketIndex(ev.price, taille);
    const cle = `${c.time}:${bucketIdx}`;
    let cell = cells.get(cle);
    if (cell === undefined) {
      cell = { candleTime: c.time, bucketIdx, longUsd: 0, shortUsd: 0, count: 0 };
      cells.set(cle, cell);
    }
    if (ev.side === "long") cell.longUsd += ev.usd;
    else cell.shortUsd += ev.usd;
    cell.count += 1;
    // Temps du dernier événement de la cellule (max) : sert au fade-in des cellules fraîches.
    if (cell.dernierTime === undefined || ev.time > cell.dernierTime) cell.dernierTime = ev.time;
  }

  if (cells.size === 0) return null;

  let maxUsd = 0;
  for (const cell of cells.values()) {
    const total = cell.longUsd + cell.shortUsd;
    if (total > maxUsd) maxUsd = total;
  }

  return { cells, taille, maxUsd };
}

/**
 * Intensité log-normalisée ∈ [0,1] : `log1p(usd) / log1p(maxUsd)`, clampée. La log relève
 * les petits niveaux face aux cascades massives. Renvoie 0 si `maxUsd <= 0`. PURE.
 */
export function intensiteLog(usd: number, maxUsd: number): number {
  if (!(maxUsd > 0)) return 0;
  const t = Math.log1p(Math.max(0, usd)) / Math.log1p(maxUsd);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Déséquilibre long/short d'une cellule ∈ [-1, +1] : `(short − long) / (short + long)`.
 * +1 = 100 % de shorts liquidés, −1 = 100 % de longs liquidés, 0 à l'équilibre ou si le
 * total est nul/invalide. Pilote la teinte et la franchise des cellules en mode
 * « dominance » (cf. dessinerHeatmap). PURE.
 */
export function desequilibre(longUsd: number, shortUsd: number): number {
  const total = longUsd + shortUsd;
  if (!(total > 0)) return 0;
  return (shortUsd - longUsd) / total;
}

/**
 * Profil latéral par bucket de prix : somme long/short de toutes les bougies pour chaque
 * bucketIdx (alimente les bandes du bord droit). PURE.
 */
export function profilParPrix(grid: LiqGrid): Map<number, { longUsd: number; shortUsd: number }> {
  const profil = new Map<number, { longUsd: number; shortUsd: number }>();
  for (const cell of grid.cells.values()) {
    let agg = profil.get(cell.bucketIdx);
    if (agg === undefined) {
      agg = { longUsd: 0, shortUsd: 0 };
      profil.set(cell.bucketIdx, agg);
    }
    agg.longUsd += cell.longUsd;
    agg.shortUsd += cell.shortUsd;
  }
  return profil;
}

/**
 * Mini-CLLD : totaux de liquidations CUMULÉS de part et d'autre du prix spot, en séparant
 * réel (profil par bucket, cf. `profilParPrix` — montant = longUsd + shortUsd) et estimé
 * (niveaux du modèle levier, pondérés par `poidsUsd`). Un bucket réel est « au-dessus » si
 * son prix CENTRE ((idx + 0.5) × taille) est STRICTEMENT supérieur au spot (centre exactement
 * sur le spot → en-dessous) ; un niveau estimé suit la même convention sur son `price`. Les
 * niveaux au poids non fini sont ignorés (même garde que leur tracé). Entrées vides → zéros.
 * PURE.
 */
export function cumulsAutourSpot(
  profil: Map<number, { longUsd: number; shortUsd: number }>,
  taille: number,
  niveaux: Array<{ price: number; poidsUsd: number }>,
  spot: number,
): { reelAuDessus: number; reelEnDessous: number; estAuDessus: number; estEnDessous: number } {
  let reelAuDessus = 0;
  let reelEnDessous = 0;
  let estAuDessus = 0;
  let estEnDessous = 0;
  for (const [idx, agg] of profil) {
    const montant = agg.longUsd + agg.shortUsd;
    if ((idx + 0.5) * taille > spot) reelAuDessus += montant;
    else reelEnDessous += montant;
  }
  for (const n of niveaux) {
    if (!Number.isFinite(n.poidsUsd)) continue;
    if (n.price > spot) estAuDessus += n.poidsUsd;
    else estEnDessous += n.poidsUsd;
  }
  return { reelAuDessus, reelEnDessous, estAuDessus, estEnDessous };
}

/**
 * Dimensions de la grille VISIBLE pour le rendu offscreen basse résolution : nombre de
 * colonnes (`to − from`, une par bougie de la plage) et bornes [bucketMin, bucketMax] des
 * buckets réellement PRÉSENTS dans les cellules (le petit canvas ne couvre que cette bande
 * de prix, pas tout l'axe).
 *
 * `bornes` (optionnel) = buckets couverts par l'ÉCRAN (bornes INCLUSES) : la plage présente
 * est INTERSECTÉE avec elle. Sans cela, une seule aberration lointaine (niveau HL à 27 M$
 * sur BTC ≈ bucket 270 000) dimensionnait le canvas sur des centaines de milliers de lignes
 * pour ne rien montrer de plus. Renvoie `null` si la plage est vide, la grille sans cellule
 * ou l'intersection vide. PURE.
 */
export function dimensionsGrilleVisible(
  grid: LiqGrid,
  from: number,
  to: number,
  bornes?: { bucketMin: number; bucketMax: number },
): { colonnes: number; bucketMin: number; bucketMax: number } | null {
  const colonnes = to - from;
  if (colonnes < 1 || grid.cells.size === 0) return null;
  let bucketMin = Infinity;
  let bucketMax = -Infinity;
  for (const cell of grid.cells.values()) {
    if (cell.bucketIdx < bucketMin) bucketMin = cell.bucketIdx;
    if (cell.bucketIdx > bucketMax) bucketMax = cell.bucketIdx;
  }
  if (bornes !== undefined) {
    bucketMin = Math.max(bucketMin, bornes.bucketMin);
    bucketMax = Math.min(bucketMax, bornes.bucketMax);
    if (bucketMin > bucketMax) return null;
  }
  return { colonnes, bucketMin, bucketMax };
}

/**
 * Max des totaux (long + short) des CELLULES dont le bucket ∈ [bucketMin, bucketMax]
 * (bornes INCLUSES) — max par cellule, pas somme par bucket, comme `grid.maxUsd`. Sert à
 * normaliser l'intensité de la heatmap HL sur ce qui est À L'ÉCRAN : un niveau lointain
 * énorme n'écrase plus la rampe des cellules visibles. Aucune cellule dans la bande → 0.
 * PURE.
 */
export function maxUsdBuckets(grid: LiqGrid, bucketMin: number, bucketMax: number): number {
  let max = 0;
  for (const cell of grid.cells.values()) {
    if (cell.bucketIdx < bucketMin || cell.bucketIdx > bucketMax) continue;
    const total = cell.longUsd + cell.shortUsd;
    if (total > max) max = total;
  }
  return max;
}

/**
 * Hit-test PUR du survol : retrouve la cellule sous le curseur à partir d'un `timestamp`
 * (converti en bougie CONTENANTE via `candleContenant`) et d'une valeur de prix (`value`,
 * convertie en bucket via `bucketIndex`), puis lookup O(1) dans `grid.cells`. Renvoie `null`
 * si l'un des deux est indéfini, si le timestamp tombe hors des bougies, ou si aucune
 * liquidation n'occupe la cellule visée.
 *
 * NB : écart au brief (signature `cellSousCurseur(grid, timestamp, value)`) — `candles` est
 * ajouté en paramètre car la grille seule ne connaît pas les bornes temporelles des bougies ;
 * `candleContenant` en a besoin pour rattacher un timestamp à sa bougie. PURE.
 */
export function cellSousCurseur(
  grid: LiqGrid,
  candles: Candle[],
  timestamp: number | undefined,
  value: number | undefined,
): LiqCell | null {
  if (timestamp === undefined || value === undefined) return null;
  if (!Number.isFinite(timestamp) || !Number.isFinite(value)) return null;
  const c = candleContenant(candles, timestamp);
  if (c === undefined) return null;
  const bucketIdx = bucketIndex(value, grid.taille);
  return grid.cells.get(`${c.time}:${bucketIdx}`) ?? null;
}

// ─────────────────────────── Bulles de clusters (rendu « CoinGlass ») ───────────────────────────

/** Une bulle à dessiner : une CELLULE de la grille retenue comme cluster significatif. */
export interface BulleLiq {
  candleTime: number;
  bucketIdx: number;
  /** Total USD de la cellule (longUsd + shortUsd). */
  usd: number;
  /** Côté DOMINANT en USD (égalité → "long") — pilote la teinte (--down/--up). */
  side: "long" | "short";
  /** Rayon en px CSS : rMin + (rMax − rMin) × √(usd / maxUsd) — la racine comprime les cascades. */
  rayon: number;
  /** Temps du dernier événement de la cellule — pilote le fade-in (cf. alphaFadeIn). */
  dernierTime?: number;
}

/**
 * Sélectionne les bulles à peindre depuis la grille agrégée : une bulle PAR CELLULE
 * (bougie × bucket), pas par événement — une cascade donne UNE grosse bulle au lieu de
 * 200 cercles superposés.
 *
 * Sélection : ne garder que les cellules dont le total USD atteint le QUANTILE EMPIRIQUE
 * `quantile` des totaux (tri croissant, index `min(n − 1, floor(q × n))`) — la plus grosse
 * cellule est TOUJOURS retenue (le quantile ne peut pas dépasser le max), puis tri
 * décroissant et plafond `maxBulles`. `rayon` ∝ √usd normalisé sur la plus grosse cellule
 * RETENUE ∈ [rMin, rMax]. Grille sans cellule à total > 0 → []. PURE.
 */
export function bullesDepuisGrille(
  grid: LiqGrid,
  quantile = 0.7,
  maxBulles = 300,
  rMin = 2.5,
  rMax = 14,
): BulleLiq[] {
  const cellules = [...grid.cells.values()]
    .map((cell) => ({ cell, total: cell.longUsd + cell.shortUsd }))
    .filter((e) => e.total > 0);
  if (cellules.length === 0) return [];

  const totaux = cellules.map((e) => e.total).sort((a, b) => a - b);
  const q = quantile < 0 ? 0 : quantile > 1 ? 1 : quantile;
  // Quantile empirique : index floor(q × n) borné à n−1 — q=0,7 sur 5 cellules vise le
  // 4e total (seuil haut), q=1 vise le dernier (seule la plus grosse cellule reste).
  const seuil = totaux[Math.min(totaux.length - 1, Math.floor(q * totaux.length))] ?? 0;

  const retenues = cellules
    .filter((e) => e.total >= seuil)
    .sort((a, b) => b.total - a.total)
    .slice(0, maxBulles);
  const maxUsd = retenues[0]?.total ?? 0;
  if (!(maxUsd > 0)) return [];

  return retenues.map(({ cell, total }) => {
    const bulle: BulleLiq = {
      candleTime: cell.candleTime,
      bucketIdx: cell.bucketIdx,
      usd: total,
      side: cell.longUsd >= cell.shortUsd ? "long" : "short",
      rayon: rMin + (rMax - rMin) * Math.sqrt(total / maxUsd),
    };
    if (cell.dernierTime !== undefined) bulle.dernierTime = cell.dernierTime;
    return bulle;
  });
}

// Couleurs/alpha des heatmaps : extraites dans ./rampesHeat (partagées avec depthHeat.ts,
// qui reste dans le chunk d'entrée). Ré-exportées ici pour les tests et les appelants
// historiques — l'implémentation vit dans rampesHeat.ts.
import {
  alphaFadeIn,
  attenuationFootprint,
  couleurRampe,
  couleurRampeArrets,
  estFondClair,
  parseCssColor,
  rampePourTheme,
  RAMPE_HL_AMBRE,
  RAMPE_HL_AMBRE_INVERSEE,
} from "./rampesHeat";
export {
  alphaFadeIn,
  attenuationFootprint,
  couleurRampe,
  couleurRampeArrets,
  estFondClair,
  parseCssColor,
  rampePourTheme,
} from "./rampesHeat";

/**
 * Filtre les buckets pour n'en garder que les plus significatifs : ceux dont `poids` atteint
 * `seuilFrac × max`, PLAFONNÉ aux `maxN` plus lourds (tri décroissant). Évite de tracer des
 * centaines de niveaux estimés quasi nuls. Liste vide ou `max ≤ 0` → `[]`. PURE.
 */
export function filtrerNiveauxDenses<T extends { poids: number }>(
  buckets: T[],
  seuilFrac: number,
  maxN: number,
): T[] {
  let max = 0;
  for (const b of buckets) if (b.poids > max) max = b.poids;
  if (!(max > 0)) return [];
  const borne = seuilFrac * max;
  return buckets
    .filter((b) => b.poids >= borne)
    .sort((a, b) => b.poids - a.poids)
    .slice(0, maxN);
}

/**
 * Dé-chevauchement vertical d'étiquettes : trie par `poids` décroissant (le plus lourd
 * gagne) puis ne retient un item que si son `y` est à ≥ `minEcart` px de TOUS les items déjà
 * retenus. Renvoie les items conservés (ordre poids décroissant). Réutilisé par les labels de
 * clusters (profil réel) et les labels EST. PURE.
 */
export function dechevaucher<T extends { y: number; poids: number }>(
  items: T[],
  minEcart: number,
): T[] {
  const retenus: T[] = [];
  for (const item of [...items].sort((a, b) => b.poids - a.poids)) {
    if (retenus.every((r) => Math.abs(r.y - item.y) >= minEcart)) retenus.push(item);
  }
  return retenus;
}

/**
 * Libellé de la légende de la couche ESTIMÉE, RAISON COMPRISE — une couche active mais vide
 * doit rester distinguable d'une couche éteinte (le mode d'échec le plus fréquent : hors perp
 * Binance, la source d'OI ne renvoie rien et la couche se taisait). Trois cas :
 *  - des niveaux → libellé nominal (garde-fou BUILD-CONTRACT « approximation ») ;
 *  - aucun niveau ET OI vide → « OI indisponible (<symbole du chart>) » — le symbole affiché est
 *    celui que l'utilisateur RECONNAÎT (« BTC-USD »), pas la base normalisée du fetch ;
 *  - aucun niveau mais OI présent → « tous consommés » (le prix a traversé tous les niveaux).
 * PURE.
 */
export function libelleLegendeEst(symbol: string, oiCharge: boolean, nbNiveauxActifs: number): string {
  if (nbNiveauxActifs > 0) return "Niveaux ESTIMÉS (modèle levier — approximation)";
  if (!oiCharge) return `Niveaux ESTIMÉS — OI indisponible (${symbol})`;
  return "Niveaux ESTIMÉS — tous consommés";
}

// ───────────── Niveaux de liquidation RÉELS Hyperliquid (couche LIQHL) — fonctions PURES ─────────────

/** Largeur d'un bucket de clustering HL, en fraction du prix (0,25 %). */
const HL_BUCKET_FRAC = 0.0025;

/** Forme minimale d'un niveau HL pour le rendu (px + side + montant). */
export interface NiveauHlRendu {
  px: number;
  side: "long" | "short";
  valueUsd: number;
}

/** Un groupe de niveaux HL voisins : une barre à l'écran. */
export interface ClusterHl {
  /** Prix moyen PONDÉRÉ par le notionnel (le gros de la masse, pas le centre du bucket). */
  pxMoyenPondere: number;
  totalUsd: number;
  /** Side DOMINANT en USD du groupe (égalité → « long », arbitraire et sans enjeu). */
  side: "long" | "short";
  /** Notionnel des positions LONGUES du groupe (liquidées SOUS le prix). */
  longUsd: number;
  /** Notionnel des positions COURTES du groupe (liquidées AU-DESSUS du prix). */
  shortUsd: number;
  /** Nombre de niveaux regroupés. */
  n: number;
}

/** Cluster HL positionné à l'écran (y absolu du canvas, cf. toPx). */
export interface ClusterHlPlace extends ClusterHl {
  y: number;
}

/** Agrégat des clusters HL hors de la plage Y visible, d'un côté du pane. */
export interface HorsEcranHl {
  /** Somme des `n` des clusters (nombre de NIVEAUX, pas de clusters). */
  nNiveaux: number;
  totalUsd: number;
  longUsd: number;
  shortUsd: number;
  /** `pxMoyenPondere` du cluster le plus proche du bord (auDessus : plus grand y ; enDessous : plus petit y). */
  plusProchePx: number | null;
  /** Cluster au plus gros `totalUsd`. */
  plusGros: ClusterHl | null;
}

/**
 * Filtre de VALIDITÉ seulement : garde les niveaux à `px` > 0 et fini, `valueUsd` > 0 et fini.
 * Préserve le type d'entrée (mêmes objets). PURE.
 *
 * Plus AUCUNE fenêtre autour du prix ni plancher de notionnel. Mesure du 25/09/2026 sur le vrai
 * daemon : l'ancienne fenêtre ±40 % (+ plancher 10 k$), seul filtre de distance de toute la
 * chaîne, écartait 55 % du notionnel BTC, 61 % ETH et 97 % SOL (ex. un short BTC de 238 M$ à
 * +57 %) — alors qu'aucun niveau n'était « du mauvais côté » et qu'au-delà de ×10 du prix les
 * aberrations de marge croisée pèsent < 0,2 % du notionnel (max 27 M$ pour BTC à ~320×).
 * Le risque qu'elle couvrait (une aberration qui écrase l'échelle des barres) est désormais
 * traité au RENDU : le hors-écran est RÉSUMÉ en bord (`partitionnerClustersHl` +
 * `libelleBordHl`) et la normalisation des barres est faite sur les clusters VISIBLES seulement.
 */
export function filtrerNiveauxHl<T extends NiveauHlRendu>(niveaux: readonly T[]): T[] {
  return niveaux.filter(
    (n) => n.px > 0 && Number.isFinite(n.px) && n.valueUsd > 0 && Number.isFinite(n.valueUsd),
  );
}

/**
 * Regroupe les niveaux en buckets de `HL_BUCKET_FRAC` du prix (0,25 %) : sans cela, des
 * centaines de positions voisines donneraient autant de barres illisibles d'un pixel. Chaque
 * cluster porte le total USD, son split long/short, le prix moyen PONDÉRÉ par le notionnel,
 * le side dominant en USD et le nombre de niveaux. N'applique AUCUN filtre (composer avec
 * `filtrerNiveauxHl`). Entrée vide ou prix invalide → `[]`. PURE.
 */
export function clusteriserNiveauxHl(niveaux: readonly NiveauHlRendu[], prix: number): ClusterHl[] {
  if (!(prix > 0) || !Number.isFinite(prix)) return [];
  const taille = prix * HL_BUCKET_FRAC;
  if (!(taille > 0)) return [];

  const parBucket = new Map<
    number,
    { sommePx: number; totalUsd: number; longUsd: number; shortUsd: number; n: number }
  >();
  for (const n of niveaux) {
    if (!(n.px > 0) || !Number.isFinite(n.px) || !Number.isFinite(n.valueUsd)) continue;
    const idx = Math.floor(n.px / taille);
    let b = parBucket.get(idx);
    if (b === undefined) {
      b = { sommePx: 0, totalUsd: 0, longUsd: 0, shortUsd: 0, n: 0 };
      parBucket.set(idx, b);
    }
    b.sommePx += n.px * n.valueUsd;
    b.totalUsd += n.valueUsd;
    if (n.side === "long") b.longUsd += n.valueUsd;
    else b.shortUsd += n.valueUsd;
    b.n += 1;
  }

  const clusters: ClusterHl[] = [];
  for (const b of parBucket.values()) {
    if (!(b.totalUsd > 0)) continue;
    clusters.push({
      pxMoyenPondere: b.sommePx / b.totalUsd,
      totalUsd: b.totalUsd,
      side: b.longUsd >= b.shortUsd ? "long" : "short",
      longUsd: b.longUsd,
      shortUsd: b.shortUsd,
      n: b.n,
    });
  }
  return clusters;
}

/** Agrégat hors écran vide (aucun cluster de ce côté). */
function horsEcranVide(): HorsEcranHl {
  return { nNiveaux: 0, totalUsd: 0, longUsd: 0, shortUsd: 0, plusProchePx: null, plusGros: null };
}

/**
 * Sépare les clusters positionnés selon la plage Y VISIBLE du pane [haut, bas] (y absolus du
 * canvas, y croît vers le BAS) : `haut ≤ y ≤ bas` (bornes INCLUSES) → visible ; `y < haut` →
 * au-dessus ; `y > bas` → en dessous ; `y` non fini → ignoré PARTOUT (ni peint ni compté).
 *
 * Chaque côté hors écran est RÉSUMÉ (`HorsEcranHl`) : Σ n, notionnels total/long/short, prix du
 * cluster le plus proche du bord (au-dessus : plus grand y ; en dessous : plus petit y) et plus
 * gros cluster. C'est ce résumé que le contrôleur affiche en repère de bord, au lieu de laisser
 * `ctx.clip()` jeter silencieusement ce que l'axe Y (calé sur les bougies) ne montre pas. Les
 * visibles gardent l'ordre d'entrée. PURE.
 */
export function partitionnerClustersHl(
  clusters: readonly ClusterHlPlace[],
  haut: number,
  bas: number,
): { visibles: ClusterHlPlace[]; auDessus: HorsEcranHl; enDessous: HorsEcranHl } {
  const visibles: ClusterHlPlace[] = [];
  const auDessus = horsEcranVide();
  const enDessous = horsEcranVide();
  // y du cluster « le plus proche » retenu de chaque côté (pilote plusProchePx).
  let yProcheDessus = -Infinity;
  let yProcheDessous = Infinity;
  for (const c of clusters) {
    if (!Number.isFinite(c.y)) continue;
    if (c.y >= haut && c.y <= bas) {
      visibles.push(c);
      continue;
    }
    const cote = c.y < haut ? auDessus : enDessous;
    cote.nNiveaux += c.n;
    cote.totalUsd += c.totalUsd;
    cote.longUsd += c.longUsd;
    cote.shortUsd += c.shortUsd;
    if (cote.plusGros === null || c.totalUsd > cote.plusGros.totalUsd) cote.plusGros = c;
    if (c.y < haut) {
      if (c.y > yProcheDessus) {
        yProcheDessus = c.y;
        auDessus.plusProchePx = c.pxMoyenPondere;
      }
    } else if (c.y < yProcheDessous) {
      yProcheDessous = c.y;
      enDessous.plusProchePx = c.pxMoyenPondere;
    }
  }
  return { visibles, auDessus, enDessous };
}

/**
 * Libellé du repère de BORD des niveaux HL hors écran : « ▲ 46 niv. hors écran · $781.00M ·
 * max $238.00M @ 132,743.00 » (▼ pour le bas). Montants via `formatUsd`, prix via `formatPrice`
 * (conventions du dépôt). Le segment « max … @ … » est omis sans `plusGros`. `null` quand rien
 * n'est hors écran de ce côté (aucun repère à peindre).
 *
 * ⚠️ HONNÊTETÉ : « niv. » compte des niveaux de l'ÉCHANTILLON du leaderboard — jamais « toutes
 * les liquidations » (cf. l'en-tête de data/hyperliquidLiq.ts). PURE.
 */
export function libelleBordHl(h: HorsEcranHl, sens: "haut" | "bas"): string | null {
  if (h.nNiveaux === 0) return null;
  const fleche = sens === "haut" ? "▲" : "▼";
  let libelle = `${fleche} ${h.nNiveaux} niv. hors écran · ${formatUsd(h.totalUsd)}`;
  if (h.plusGros !== null) {
    libelle += ` · max ${formatUsd(h.plusGros.totalUsd)} @ ${formatPrice(h.plusGros.pxMoyenPondere)}`;
  }
  return libelle;
}

/**
 * Cumuls de notionnel HL de part et d'autre du `prix`, sur TOUS les niveaux VALIDES (même garde
 * que `filtrerNiveauxHl` ; aucune fenêtre) : `px > prix` → au-dessus, sinon en dessous (même
 * convention que `cumulsAutourSpot`). Prix invalide → zéros. PURE.
 */
export function cumulsHl(
  niveaux: readonly NiveauHlRendu[],
  prix: number,
): { auDessus: number; enDessous: number } {
  let auDessus = 0;
  let enDessous = 0;
  if (!(prix > 0) || !Number.isFinite(prix)) return { auDessus, enDessous };
  for (const n of filtrerNiveauxHl(niveaux)) {
    if (n.px > prix) auDessus += n.valueUsd;
    else enDessous += n.valueUsd;
  }
  return { auDessus, enDessous };
}

/**
 * Libellé de la légende de la couche HL, RAISON COMPRISE (même exigence que `libelleLegendeEst` :
 * une couche active ne doit jamais être muette). En état « ok », annonce la couverture
 * (« N adresses · P positions ») puis, si fournis, les cumuls « ↑ X · ↓ Y » de TOUS les niveaux
 * de l'échantillon (plus de fenêtre : le hors-écran est résumé en bord, cf. `libelleBordHl`).
 * Une `raison` non nulle (cf. `raisonCotationHl`) PRIME sur l'état : la couche est alors muette
 * à l'écran et la légende dit pourquoi.
 *
 * ⚠️ HONNÊTETÉ : « N adresses » annonce la COUVERTURE réelle (top du leaderboard), pas le carnet
 * entier — cf. l'en-tête de data/hyperliquidLiq.ts. PURE.
 */
export function libelleLegendeHl(
  etat: EtatHl,
  adressesScannees: number,
  nbPositions: number,
  cumuls: { auDessus: number; enDessous: number } | null,
  raison: string | null = null,
): string {
  if (raison !== null) return `LIQ HL RÉELS — ${raison}`;
  if (etat === "sans-daemon") return "LIQ HL RÉELS — nécessite le daemon axiomd";
  if (etat === "chargement") return "LIQ HL RÉELS — chargement…";
  if (etat === "erreur") return "LIQ HL RÉELS — source indisponible";
  if (etat === "vide") return "LIQ HL RÉELS — aucun niveau pour ce symbole";
  const base = `LIQ HL RÉELS — ${adressesScannees} adresses · ${nbPositions} positions`;
  if (cumuls === null) return base;
  return `${base} · ↑ ${formatUsd(cumuls.auDessus)} · ↓ ${formatUsd(cumuls.enDessous)}`;
}

/** Cotations assimilées au dollar : USD et stablecoins USD de `QUOTE_ASSETS` (data/symbol.ts). */
const COTATIONS_USD: ReadonlySet<string> = new Set(["USD", "USDT", "USDC", "USDD", "TUSD", "USDE", "DAI"]);

/**
 * Raison de TAIRE la couche HL sur ce symbole, ou `null` quand ses niveaux sont affichables.
 * Les niveaux Hyperliquid sont des prix en USD (perps USDC) ; le coin est la BASE du symbole
 * (`basePerp`), donc sur ETHBTC le store sert les niveaux d'ETH en USD, à comparer à un prix en
 * BTC. La fenêtre ±40 % masquait ce cas par accident ; sans elle, l'UI affichait « ▲ 79 niv. hors
 * écran · $1.34B » et « ↑ $1.34B · ↓ $0.00 » (relecture du 25/09/2026). Une cotation hors USD
 * (crypto ou fiat, EUR compris : ~8 % d'écart suffisent à fausser les niveaux) donne
 * « cotation BTC ≠ USD, niveaux masqués ».
 *
 * Même normalisation que `basePerp` : suffixe « -PERP » (perp Hyperliquid, en USD) → `null` ;
 * tiret Coinbase ramené au slash ; symbole synthétique ou cotation inconnue → `null`, car
 * `basePerp` renonce alors déjà au fetch (état « vide », qui dit la chose honnêtement). PURE.
 */
export function raisonCotationHl(symbol: string): string | null {
  const s = symbol.trim().toUpperCase();
  if (s.length === 0 || s.includes("|") || s.endsWith("-PERP")) return null;
  let cotation: string;
  try {
    cotation = splitSymbol(s.replace("-", "/"), "raisonCotationHl").quote;
  } catch {
    return null;
  }
  return COTATIONS_USD.has(cotation) ? null : `cotation ${cotation} ≠ USD, niveaux masqués`;
}

/** Hauteur (px CSS) des pilules HL — étiquettes de clusters et repères de bord. */
const HL_PILULE_H = 14;
/** Écart (px CSS) entre une pilule de repère HL et ses voisins (surcouche DOM, barre, étiquette). */
const ECART_REPERE_PX = 2;

/** Rectangle en px CSS du canvas (repère du conteneur du graphe). */
export interface RectPx {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Plus petit `y ≥ yMin` où une pilule de hauteur `h` couvrant [x0, x1] ne recoupe AUCUN obstacle
 * (écart `ecart` compris). Les obstacles sont les surcouches DOM ancrées en haut du conteneur
 * (bandeau symbole, lignes de légende overlay, badges), qui passent AU-DESSUS du canvas : une
 * pilule peinte dessous serait invisible. On descend sous chaque obstacle recoupé, dans l'ordre
 * de leur bord haut, jusqu'à stabilité — une pile d'obstacles jointifs se franchit en entier.
 * Chaque obstacle pousse au plus une fois (y ne fait que croître) : terminaison garantie.
 * Coordonnée non finie → obstacle ignoré (comparaisons fausses). PURE.
 */
export function yLibreSousObstacles(
  yMin: number,
  h: number,
  x0: number,
  x1: number,
  obstacles: readonly RectPx[],
  ecart: number = ECART_REPERE_PX,
): number {
  const tries = [...obstacles].sort((a, b) => a.y0 - b.y0);
  let y = yMin;
  let deplace = true;
  while (deplace) {
    deplace = false;
    for (const o of tries) {
      if (o.x0 < x1 && o.x1 > x0 && o.y0 < y + h + ecart && o.y1 + ecart > y) {
        y = o.y1 + ecart;
        deplace = true;
      }
    }
  }
  return y;
}

/**
 * Bande verticale [y0, y1] occupée par une pilule de repère HL dont le bord haut est à `yHaut`,
 * écart compris. Sert deux fois : BORD de la zone des barres (tout cluster au-delà est RÉSUMÉ
 * dans le repère au lieu d'être peint puis masqué par la pilule) et zone INTERDITE aux
 * étiquettes quand la pilule est peinte (`filtrerHorsBandes`). PURE.
 */
export function bandeRepereHl(yHaut: number): [number, number] {
  return [yHaut - ECART_REPERE_PX, yHaut + HL_PILULE_H + ECART_REPERE_PX];
}

/**
 * Garde les items dont l'étiquette [y − demiHauteur, y + demiHauteur] ne recoupe aucune bande
 * (un contact de bord passe). À appliquer AVANT de retenir les N plus gros : un cluster masqué par
 * un repère ne doit pas voler une place d'étiquette. Préserve le type et l'ordre. PURE.
 */
export function filtrerHorsBandes<T extends { y: number }>(
  items: readonly T[],
  bandes: ReadonlyArray<readonly [number, number]>,
  demiHauteur: number,
): T[] {
  return items.filter((it) => bandes.every(([b0, b1]) => it.y + demiHauteur <= b0 || it.y - demiHauteur >= b1));
}

// ───────────── Heatmap des instantanés HL (LIQHL) — fonctions PURES ─────────────

/** Pas minimal de collecte côté daemon (5 min) : plancher du `pas` demandé à la route. */
export const PERIODE_SNAP_HL_MS = 5 * 60_000;
/** Report admissible d'un instantané sur une bougie, en multiples du pas (2 périodes). */
const HL_REPORT_MAX_PAS = 2;

/**
 * Pas temporel des bougies de la plage [from, to) : MÉDIANE des écarts consécutifs
 * (robuste aux trous de données — une session interrompue ne décale pas le pas),
 * plancher 60 000 ms. PURE.
 */
export function pasBougieMs(candles: Candle[], from: number, to: number): number {
  const ecarts: number[] = [];
  for (let i = Math.max(1, from + 1); i < to && i < candles.length; i++) {
    const a = candles[i - 1];
    const b = candles[i];
    if (a !== undefined && b !== undefined && b.time > a.time) ecarts.push(b.time - a.time);
  }
  const mediane = ecarts.sort((x, y) => x - y)[Math.floor(ecarts.length / 2)];
  return Math.max(60_000, mediane ?? 0);
}

/**
 * Grille HL : pour chaque bougie d'index i ∈ [from, to), retient le DERNIER instantané
 * dont `ts ≤ fin de bougie` (`time + pasBougie`) ET `ts ≥ time − 2 × pasMs` — au-delà de
 * 2 périodes de report la colonne reste VIDE (un instantané trop vieux ne mesure plus
 * le carnet au temps de la bougie). Les niveaux du snapshot retenu sont répartis par
 * bucket (`tailleBucket(close dernière bougie) × facteurTaille`, même taille que la
 * grille exécutée) en séparant long/short ; `dernierTime` porte le `ts` de l'instantané
 * (tooltip) et `nLong`/`nShort` le nombre de niveaux de chaque côté. `instantanes` est
 * attendu trié par ts croissant (cf. `fusionnerInstantanes`) : le curseur ne recule
 * donc jamais. Renvoie `null` si la plage est vide ou ne produit aucune cellule. PURE.
 */
export function construireGrilleHl(
  instantanes: readonly InstantaneHlHeat[],
  candles: Candle[],
  from: number,
  to: number,
  pasMs: number,
  facteurTaille = 1,
): LiqGrid | null {
  if (to - from < 1 || !(pasMs > 0)) return null;
  const dernier = candles[to - 1];
  if (dernier === undefined) return null;
  const taille = tailleBucket(dernier.close) * facteurTaille;
  if (!(taille > 0)) return null;
  const pasBougie = pasBougieMs(candles, from, to);

  const cells = new Map<string, LiqCell>();
  let curseur = -1; // dernier instantané avec ts ≤ fin de bougie courante (croissant avec i)
  for (let i = from; i < to; i++) {
    const c = candles[i];
    if (c === undefined) continue;
    const fin = c.time + pasBougie;
    while (curseur + 1 < instantanes.length) {
      const s = instantanes[curseur + 1];
      if (s === undefined || s.ts > fin) break;
      curseur += 1;
    }
    const snap = curseur >= 0 ? instantanes[curseur] : undefined;
    if (snap === undefined || snap.ts < c.time - HL_REPORT_MAX_PAS * pasMs) continue;
    for (const n of snap.niveaux) {
      if (!(n.px > 0) || !Number.isFinite(n.usd)) continue;
      const bucketIdx = bucketIndex(n.px, taille);
      const cle = `${c.time}:${bucketIdx}`;
      let cell = cells.get(cle);
      if (cell === undefined) {
        cell = { candleTime: c.time, bucketIdx, longUsd: 0, shortUsd: 0, count: 0 };
        cells.set(cle, cell);
      }
      if (n.side === "long") {
        cell.longUsd += n.usd;
        cell.nLong = (cell.nLong ?? 0) + 1;
      } else {
        cell.shortUsd += n.usd;
        cell.nShort = (cell.nShort ?? 0) + 1;
      }
      cell.count += 1;
      if (cell.dernierTime === undefined || snap.ts > cell.dernierTime) cell.dernierTime = snap.ts;
    }
  }

  if (cells.size === 0) return null;
  let maxUsd = 0;
  for (const cell of cells.values()) {
    const total = cell.longUsd + cell.shortUsd;
    if (total > maxUsd) maxUsd = total;
  }
  return { cells, taille, maxUsd };
}

/**
 * Compte les TROUS de collecte dans [debut, fin] : un trou par écart > 3 × pasMs entre
 * instantanés consécutifs de la fenêtre, PLUS le trou initial quand le premier
 * instantané arrive > 3 pas après `debut` ALORS QUE la collecte avait déjà commencé
 * (`premierTs < debut` — sinon l'absence en tête signifie juste « pas encore collecté »).
 * Ces trous matérialisent les périodes où le daemon était éteint (légende « T trous »).
 * PURE.
 */
export function compterTrous(
  instantanes: readonly InstantaneHlHeat[],
  debut: number,
  fin: number,
  pasMs: number,
  premierTs: number | null = null,
): number {
  if (!(pasMs > 0)) return 0;
  const seuil = 3 * pasMs;
  let trous = 0;
  let precedent: number | null = null;
  for (const s of instantanes) {
    if (s.ts < debut || s.ts > fin) continue;
    if (precedent === null) {
      if (premierTs !== null && premierTs < debut && s.ts - debut > seuil) trous += 1;
    } else if (s.ts - precedent > seuil) {
      trous += 1;
    }
    precedent = s.ts;
  }
  return trous;
}

/**
 * Libellé de la légende HL HEATMAP, RAISON COMPRISE (même exigence que `libelleLegendeHl`).
 * ⚠️ HONNÊTETÉ : « couverture ≈ Y % OI » annonce la part MESURÉE de l'open interest
 * couverte par l'échantillon du leaderboard — jamais le carnet entier ; « T trous =
 * daemon éteint » signale les interruptions de collecte au lieu de les masquer. PURE.
 */
export function libelleLegendeHlHeat(
  etat: EtatHeat,
  nbInstantanes: number,
  adresses: number,
  couverture: number | null,
  pasMs: number,
  trous: number,
  collecteActive: boolean,
  premierTs: number | null = null,
): string {
  if (etat === "sans-daemon") return "HL HEATMAP — nécessite le daemon axiomd";
  if (etat === "erreur") return "HL HEATMAP — source indisponible";
  if (etat === "inactif") return "HL HEATMAP — collecte daemon arrêtée — reprendre dans LIQ";
  if (etat === "vide") {
    return collecteActive
      ? `HL HEATMAP — aucun instantané encore (collecte active${
          premierTs !== null ? ` depuis ${formatDateHeure(premierTs)}` : ""
        })`
      : "HL HEATMAP — aucun instantané encore";
  }
  const couv =
    couverture === null
      ? "couverture en mesure"
      : `couverture ≈ ${Math.round(couverture * 100)} % OI`;
  let libelle = `HL HEATMAP (niveaux réels) — ${nbInstantanes} instantanés · ${adresses} adresses · ${couv} · pas ${Math.round(pasMs / 60_000)} min`;
  if (trous > 0) libelle += ` · ${trous} trous = daemon éteint`;
  return libelle;
}

// ─────────────────────────── Flash de bande (lien feed→chart) ───────────────────────────

/** Durée (ms) du flash de bande déclenché par un clic dans le feed LIQ. */
const FLASH_DUREE_MS = 1500;

/** État du flash : prix à surligner + échéance (Date.now() ≥ jusqua ⇒ flash expiré). */
export interface LiqFlashState {
  price: number | null;
  jusqua: number;
}

/**
 * Mini-store vanilla du flash de bande : la fenêtre LIQ (clic sur une liquidation du feed)
 * pose un prix via `flasherNiveau` ; le contrôleur s'y abonne (start/stop) et surligne la
 * bande de prix correspondante pendant FLASH_DUREE_MS (fade linéaire, cf. dessinerFlash).
 */
export const liqFlashStore: StoreApi<LiqFlashState> = createStore<LiqFlashState>(() => ({
  price: null,
  jusqua: 0,
}));

/** Déclenche le flash de la bande contenant `price` pour FLASH_DUREE_MS (re-pose l'échéance). */
export function flasherNiveau(price: number): void {
  liqFlashStore.setState({ price, jusqua: Date.now() + FLASH_DUREE_MS });
}

// ─────────────────────────── Contrôleur canvas (non testé — couplage KLineChart) ───────────────────────────

/** Pane prix (id par défaut KLineChart). */
const CANDLE_PANE_ID = "candle_pane";
/** Largeur max des bandes latérales du profil = fraction de la largeur du pane prix. */
const MAX_BAND_FRAC = 0.12;
/** Largeur du Volume Profile (fraction du pane) — miroir de `MAX_WIDTH_FRAC` de volumeProfile.ts :
 *  quand le VP est actif, on décale l'ancre des bandes liq de cette largeur pour ne pas se mélanger. */
const VP_WIDTH_FRAC = 0.32;
/** Largeur de repli d'une cellule quand la largeur de bougie n'est pas déductible. */
const FALLBACK_CELL_W = 6;
/** Seuil de LISSAGE « CoinGlass » (px) : sous cette largeur de bougie (zoom large), le rendu
 *  cellule à cellule (un fillRect par cellule) est remplacé par un offscreen basse résolution
 *  (1 cellule = 1 pixel) upscalé avec interpolation — rendu continu, 1 seul drawImage par
 *  frame. Au-dessus (zoom serré), les rects précis restent : lecture cellule à cellule. */
const SEUIL_LISSAGE_PX = 6;
/** Garde DURE du rendu lissé : au-delà de ce nombre de LIGNES (buckets) du petit canvas, on
 *  se replie sur les rects. Même borné à l'écran, un zoom vertical extrême ne doit jamais
 *  réallouer un ImageData géant (createImageData lève → la boucle rAF mourait). */
const MAX_LIGNES_LISSAGE = 4096;
/**
 * Teinte RVB des niveaux ESTIMÉS, choisie PAR THÈME pour contraster avec la rampe
 * réelle (garde-fou « estimation ≠ donnée » — sur bloomberg la rampe est ambre,
 * l'orange y était indiscernable ; revue v2, H7).
 */
export function teinteEstPourTheme(theme: string): readonly [number, number, number] {
  if (theme === "bloomberg") return [96, 165, 250]; // bleu clair vs rampe ambre
  return [245, 158, 11]; // orange vs viridis / rampe verte matrix
}
/** Poids min (fraction du max) pour tracer un niveau ESTIMÉ + plafond de niveaux tracés.
 *  Seuil bas (4 %) : la distribution des poids est très inégale (un pic d'OI domine) — un seuil
 *  agressif ne laissait que 1-2 lignes (constat gate visuel) ; le plafond fait l'anti-bruit. */
const EST_SEUIL_FRAC = 0.04;
const EST_MAX_NIVEAUX = 30;
/** Nombre de buckets estimés étiquetés « EST. ×L » (les plus gros poids). */
const NB_LABELS_EST = 4;
/** Nombre de clusters du profil réel étiquetés (prix · USD) au bord droit. */
const NB_LABELS_CLUSTER = 3;
/** Longueur max (px CSS) d'une barre de cluster HL — plafond du plus gros cluster visible. */
const HL_BARRE_MAX_PX = 120;
/** Épaisseur (px CSS) d'une barre HL. */
const HL_BARRE_H = 3;
/** Opacité des barres HL (assez franches pour se lire, assez douces pour laisser voir le prix). */
const HL_ALPHA = 0.75;
/** Nombre de clusters HL étiquetés (les plus gros VISIBLES). */
const NB_LABELS_HL = 3;
/**
 * Marge haute MINIMALE (px CSS) des étiquettes canvas et du repère haut HL. Ce n'est PAS la
 * hauteur réelle des surcouches DOM : sur le graphe maître, le bandeau SymbolBanner occupe
 * top+8…top+44 (et plus s'il passe sur 2 lignes), et les lignes de la légende overlay s'empilent
 * en haut à droite. Le repère haut HL les MESURE (`obstaclesDom` + `yLibreSousObstacles`).
 */
const BANDE_DOM_PX = 24;
/** Message d'état de la heatmap RÉELLE, buffer vide : haut-droite du pane, à top + Y_MSG_ATTENTE_PX. */
const MSG_ATTENTE_LIQ = "⋯ Heatmap liquidations active — en attente du flux live";
const POLICE_MSG_ATTENTE = "10px ui-monospace, SFMono-Regular, monospace";
const Y_MSG_ATTENTE_PX = 22;
/** Hauteur de ligne (px) du message d'état (police 10 px, textBaseline « top »). */
const H_MSG_ATTENTE_PX = 12;
/** Hauteur (px) du fond d'une ligne de la pile de légendes bas-droite (police 11 px, pas de 14 px). */
const H_LIGNE_LEGENDE = 13;
/** Opacité du fond `--surface` des lignes de légende : lisible sur les heatmaps, laisse deviner le dessous. */
const FOND_LEGENDE_ALPHA = 0.82;

interface PixelXY {
  x?: number;
  y?: number;
}

/** Tokens de couleur du thème, lus UNE fois par frame (getComputedStyle est coûteux). */
interface Tokens {
  textDim: string;
  up: string;
  down: string;
  text: string;
  surface: string;
  border: string;
  /** Arrêts RVB de la rampe ESTHÉTIQUE du thème actif (cf. `rampePourTheme`), résolus 1×/frame ;
   *  partagés par les cellules rects, le canvas lissé ET la barre d'échelle. */
  rampe: ReadonlyArray<readonly [number, number, number]>;
  /** Teintes up/down PARSÉES en RVB une fois par frame (mode dominance : rgba par cellule). */
  upRgb: [number, number, number];
  downRgb: [number, number, number];
  /** Teinte EST du thème, résolue 1×/frame (cf. `teinteEstPourTheme`). */
  estRgb: readonly [number, number, number];
  /** Rampe ambre de la heatmap HL (inversée sur fond clair), résolue 1×/frame. */
  rampeHl: ReadonlyArray<readonly [number, number, number]>;
}

/** Paramètres de rendu alternatifs des cellules — la heatmap HL (instantanés daemon)
 *  réutilise le même rendu que les cellules exécutées mais avec la rampe AMBRE, un alpha
 *  plus franc (niveaux DEBOUT, pas un flux passé) et SANS fade-in (un instantané n'est
 *  pas un événement « frais »). */
interface OptionsCellules {
  rampe?: ReadonlyArray<readonly [number, number, number]>;
  alphaMin?: number;
  alphaMax?: number;
  sansFade?: boolean;
  /** Maximum de normalisation de l'intensité (défaut : `grid.maxUsd`). La heatmap HL passe le
   *  max des cellules VISIBLES (`maxUsdBuckets`) : un niveau lointain n'écrase plus la rampe. */
  maxUsd?: number;
  /** Buckets couverts par l'écran (bornes incluses, marge comprise) : le rendu LISSÉ n'alloue
   *  que cette bande (cf. `dimensionsGrilleVisible`). Optimisation pure — rien de visible ne change. */
  bornes?: { bucketMin: number; bucketMax: number };
}

/**
 * Élargit d'UN bucket de chaque côté les buckets visibles passés au rendu lissé : l'upscale
 * interpolé mélange chaque ligne avec sa voisine — sans cette marge, la ligne au bord de
 * l'écran se mélangerait au vide au lieu de la cellule hors écran (rendu identique à la
 * grille non bornée dans la zone visible). `null` → pas de bornes (grille entière, sous la
 * garde MAX_LIGNES_LISSAGE).
 */
function avecMargeBucket(
  b: { bucketMin: number; bucketMax: number } | null,
): { bucketMin: number; bucketMax: number } | undefined {
  return b === null ? undefined : { bucketMin: b.bucketMin - 1, bucketMax: b.bucketMax + 1 };
}

/** Disposition des barres HL d'une frame (cf. `disposerHl`), calculée AVANT la heatmap exécutée. */
interface DispositionHl {
  /** Clusters de tous les niveaux valides, positionnés (y absolu du canvas, fini). */
  places: ClusterHlPlace[];
  /** Ancre droite des barres ET des repères de bord (px). */
  xAncre: number;
  /** Bord haut de la pilule ▲, sous les surcouches DOM mesurées. */
  yRepereHaut: number;
  /** Bande de la pilule ▲ (`bandeRepereHl`) : son bord bas est le HAUT de la zone des barres. */
  bandeHaut: [number, number];
  /** Vrai si la pilule ▲ sera peinte (au moins un cluster au-dessus de la zone des barres). */
  repereHaut: boolean;
}

/** Constantes de repli RVB pour les teintes up/down si le token du thème n'est pas parsable (#10b981 / #ef4444). */
const UP_RGB_FALLBACK: [number, number, number] = [16, 185, 129];
const DOWN_RGB_FALLBACK: [number, number, number] = [239, 68, 68];
/** Constante de repli RVB pour `--accent` (flash de bande) si le token n'est pas parsable (#38bdf8). */
const ACCENT_RGB_FALLBACK: [number, number, number] = [56, 189, 248];

/**
 * Contrôleur canvas de la HEATMAP de liquidations (bougie × bucket de prix). Remplace le
 * rendu overlay intérimaire : peint une grille 2D temps×prix (intensité log viridis) plus
 * un profil latéral long/short au bord droit. Même mécanique éprouvée que
 * `VolumeProfileController` : rAF + dirty flag, `subscribeAction` du viewport,
 * `convertToPixel`, ResizeObserver, clip du pane, DPR. Aucun re-render React.
 *
 * Source : le buffer d'événements bruts (`liqEventsStore`, alimenté par le singleton WS de
 * liquidationMarkers) agrégé à la volée sur la plage visible via `construireGrille`.
 */
export class LiquidationHeatController {
  private readonly chart: Chart;
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private running = false;
  private raf = 0;
  /** Reconstruit/redessine seulement si dirty : évite un recalcul complet à 60 fps au repos. */
  private dirty = true;
  /** Date de démarrage (start) : une cellule n'est « fraîche » que si son dernier événement est
   *  postérieur — exclut le seed initial du fade-in (cf. alphaFadeIn). */
  private tsDemarrage = 0;
  /** Échéance (ms) jusqu'à laquelle la boucle rAF force le repaint pour animer le fade-in des
   *  cellules fraîches ; posée au rev bump de liqEventsStore (nouvelle liquidation live). */
  private animeJusqua = 0;
  /** Instant LOCAL (Date.now()) du dernier rev bump de liqEventsStore : indexe l'ANIMATION du
   *  fade-in sur l'horloge locale (insensible à la latence WS / skew NTP), cf. alphaFadeIn. */
  private dernierBumpTs = 0;
  /**
   * La grille (agrégat coûteux sur tout le buffer d'événements) n'est reconstruite que sur
   * changement de données/viewport/taille — PAS au survol : le crosshair marque `dirty`
   * (repeindre) sans marquer `grilleObsolete`, de sorte que le hit-test réutilise la dernière
   * grille rendue au lieu de la recalculer à chaque mouvement de souris.
   */
  private grilleObsolete = true;
  private derniereGrille: LiqGrid | null = null;
  /**
   * Grille HL (instantanés historiques du daemon) mémoïsée comme la grille exécutée :
   * mêmes invalidations via `markDirty` (données/viewport/granularité) PLUS chaque
   * publication de `hlHeatStore` — les instantanés arrivent hors du flux liquidations.
   */
  private grilleHlObsolete = true;
  private derniereGrilleHl: LiqGrid | null = null;
  private unsubHeat: (() => void) | null = null;
  /** Heatmap HL DEMANDÉE à la frame précédente (LIQHL actif ET cotation USD). Sa retombée
   *  (LIQHL → OFF, ou passage sur une paire hors USD) appelle `arreterHeat`, qui coupe le
   *  minuteur du store : aucun fetch inutile d'instantanés qu'on ne peindra pas. */
  private hlEtaitActif = false;
  /**
   * Cache SYMÉTRIQUE à la grille pour les niveaux ESTIMÉS (calcul O(pointsOI × bougies)) :
   * recalculé seulement sur les mêmes signaux que la grille (données/viewport/OI/symbole via
   * `markDirty`), JAMAIS au survol — `onCrosshair` marque `dirty` sans marquer `niveauxObsoletes`.
   */
  private niveauxObsoletes = true;
  private derniersNiveaux: NiveauEstime[] | null = null;
  /** Niveaux estimés CONSOMMÉS mémoïsés (mêmes invalidations que `derniersNiveaux`) : source de
   *  la trace grisée éphémère (fade ~10 bougies). Recalculés en même temps (calculerNiveauxEstimesDetail). */
  private derniersConsommes: NiveauConsomme[] | null = null;
  /**
   * Petit canvas DÉTACHÉ du rendu lissé « CoinGlass » (1 cellule de la grille = 1 pixel),
   * membre RÉUTILISÉ entre frames : créé paresseusement au premier rendu lissé, redimensionné
   * seulement quand les dimensions de la grille visible changent (cf. dessinerCellulesLissees).
   */
  private offscreen: HTMLCanvasElement | null = null;
  private offscreenCtx: CanvasRenderingContext2D | null = null;
  /**
   * ImageData du rendu lissé, membre RÉUTILISÉ entre frames : le survol déclenche un repaint,
   * donc une allocation par frame mettait le GC sous pression. Recréée seulement si les
   * dimensions de la grille visible changent, sinon vidée en tête de frame (cf. dessinerCellulesLissees).
   */
  private imageDataLissage: ImageData | null = null;
  /** Dernier crosshair reçu (position + bougie survolée) ; null quand le curseur quitte le graphe. */
  private dernierCrosshair: Crosshair | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private unsubMarket: (() => void) | null = null;
  private unsubEvents: (() => void) | null = null;
  /** Flash de bande (clic feed LIQ, cf. liqFlashStore) : repaint animé, sans toucher la grille. */
  private unsubFlash: (() => void) | null = null;
  private unsubOi: (() => void) | null = null;
  private unsubTheme: (() => void) | null = null;
  /** Changement de MODE (intensité/dominance) : repaint SEUL — ne touche ni grille ni niveaux. */
  private unsubMode: (() => void) | null = null;
  /** Bascule du footprint (orderflowStore.enabled) : repaint SEUL pour (dés)atténuer la heatmap
   *  — l'atténuation est au rendu, la grille agrégée est indépendante (comme le MODE). */
  private unsubOrderflow: (() => void) | null = null;
  /** Activation demandée par la heatmap RÉELLE (bascule LIQMARK, via setEnabled). */
  private marksWanted = false;
  /** Abonnement permanent à la bascule des niveaux ESTIMÉS (LIQEST) — indépendant de LIQMARK. */
  private readonly unsubLiqEst: () => void;
  /** Idem pour la bascule des niveaux RÉELS Hyperliquid (LIQHL) — 3e couche indépendante. */
  private readonly unsubHl: () => void;
  /**
   * Bande de la pilule ▼ HL peinte à la frame PRÉCÉDENTE. Les étiquettes de la heatmap exécutée
   * sont posées AVANT la pile de légendes qui fixe la position de ▼ : elles évitent donc la bande
   * de la frame d'avant, et tout changement de cette bande relance une frame. Convergence en une
   * frame : la pile ne dépend pas de ces étiquettes.
   */
  private bandeBasHlPrec: [number, number] | null = null;

  private readonly markDirty = (): void => {
    this.grilleObsolete = true;
    this.grilleHlObsolete = true;
    this.niveauxObsoletes = true;
    this.dirty = true;
  };

  /** Survol : mémorise le crosshair et demande un repaint (sans reconstruire la grille). */
  private readonly onCrosshair = (data?: Crosshair): void => {
    this.dernierCrosshair = data ?? null;
    this.dirty = true;
  };

  /**
   * Rev bump de liqEventsStore (liquidation(s) reçue(s)) : mémorise `dernierBumpTs` (horloge
   * LOCALE qui indexe l'animation du fade-in) et ouvre une fenêtre d'animation de ~450 ms
   * (> DUREE_FADE_MS pour couvrir la retombée) pendant laquelle la boucle rAF force le repaint,
   * puis invalide la grille (nouveau `dernierTime`) via markDirty. Le seed initial pose aussi la
   * fenêtre mais ne flashe rien (aucune cellule n'a `dernierTime > tsDemarrage`).
   */
  private readonly onEventsBump = (): void => {
    const now = Date.now();
    this.dernierBumpTs = now;
    this.animeJusqua = now + 450;
    this.markDirty();
  };

  /**
   * Flash posé (`flasherNiveau`, clic feed LIQ) : étend la fenêtre d'animation jusqu'à
   * l'échéance du flash — la boucle rAF repeint alors chaque frame (fade linéaire) — et
   * demande un repaint SANS invalider la grille (le flash est une couche de rendu pure).
   */
  private readonly onFlash = (): void => {
    const { jusqua } = liqFlashStore.getState();
    if (jusqua > this.animeJusqua) this.animeJusqua = jusqua;
    this.dirty = true;
  };

  constructor(chart: Chart, container: HTMLElement, canvas: HTMLCanvasElement) {
    this.chart = chart;
    this.container = container;
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Contexte 2D du canvas heatmap-liquidations indisponible");
    this.ctx = ctx;
    // Les deux couches (heatmap RÉELLE + niveaux ESTIMÉS) partagent ce contrôleur canvas mais
    // sont activables SÉPARÉMENT : on suit la bascule LIQEST en plus de setEnabled (LIQMARK).
    this.unsubLiqEst = liqEstStore.subscribe(() => {
      this.reconcile();
      this.markDirty();
    });
    // Idem pour LIQHL. `dirty` SEUL (pas `markDirty`) : le store change à chaque fetch (toutes
    // les 4 min) et les niveaux HL sont re-clusterisés à chaque peinture — inutile d'invalider
    // au passage la grille réelle et les niveaux estimés mémoïsés.
    this.unsubHl = hlLiqStore.subscribe(() => {
      this.reconcile();
      this.dirty = true;
    });
  }

  /** setEnabled pilote la couche RÉELLE (LIQMARK, appelé par ChartInstance). */
  setEnabled(enabled: boolean): void {
    this.marksWanted = enabled;
    this.reconcile();
  }

  /** Le contrôleur tourne si AU MOINS une couche est active (RÉELLE, ESTIMÉE ou HL). */
  private reconcile(): void {
    const want = this.marksWanted || liqEstStore.getState().actif || hlLiqStore.getState().actif;
    if (want === this.running) return;
    if (want) this.start();
    else this.stop();
  }

  dispose(): void {
    this.stop();
    this.unsubLiqEst();
    this.unsubHl();
  }

  private start(): void {
    this.running = true;
    this.dirty = true;
    // Référence temporelle du fade-in : seules les liquidations reçues APRÈS ce start flashent
    // (le seed initial, antérieur, est exclu — cf. alphaFadeIn / onEventsBump).
    this.tsDemarrage = Date.now();
    this.canvas.style.display = "block";
    this.subscribeActions();
    // Nouvelle bougie / backfill : le buffer marché change → recalcul. Le flux de
    // liquidations (buffer d'événements) est publié dans `liqEventsStore` par le singleton
    // WS de liquidationMarkers : on suit sa révision pour repeindre au fil des liquidations
    // (onEventsBump ouvre en plus la fenêtre d'animation du fade-in).
    this.unsubMarket = marketStore.subscribe(this.markDirty);
    this.unsubEvents = liqEventsStore.subscribe(this.onEventsBump);
    // Flash de bande (clic feed LIQ) : ouvre la fenêtre d'animation jusqu'à son échéance.
    this.unsubFlash = liqFlashStore.subscribe(this.onFlash);
    // Nouvel historique OI (fetch au toggle / refresh 15 min) → recalcul des niveaux estimés.
    this.unsubOi = oiHistStore.subscribe(this.markDirty);
    // Changement de thème : bandes/tooltip/lignes lisent des tokens CSS → repeindre pour
    // adopter les nouvelles couleurs (un simple repaint suffit ; `markDirty` par symétrie).
    this.unsubTheme = themeStore.subscribe(this.markDirty);
    // Changements de liqMarksStore hors `actif` (relayé par setEnabled) :
    //  • MODE de coloration (LIQMODE) : ne change QUE le fillStyle des cellules → simple repaint
    //    (`dirty`), SANS invalider la grille ni les niveaux mémoïsés ;
    //  • GRANULARITÉ des buckets : change la taille de bucket → la GRILLE (agrégat par bucket) est
    //    à reconstruire (`grilleObsolete`) ; les niveaux ESTIMÉS restent valides — leur CALCUL ne
    //    dépend pas de la taille (le regroupement se fait au rendu), d'où pas de `niveauxObsoletes`.
    this.unsubMode = liqMarksStore.subscribe((s, prev) => {
      if (s.mode !== prev.mode) this.dirty = true;
      // Bascule des bulles : repaint SEUL — la grille agrégée est inchangée.
      if (s.bulles !== prev.bulles) this.dirty = true;
      if (s.granularite !== prev.granularite) {
        this.grilleObsolete = true;
        this.dirty = true;
      }
    });
    // Bascule du footprint (orderflowStore.enabled) : l'atténuation ×0.5 est appliquée au
    // RENDU, donc un simple repaint (`dirty`) — la grille agrégée reste valide (comme le MODE).
    this.unsubOrderflow = orderflowStore.subscribe((s, prev) => {
      if (s.enabled !== prev.enabled) this.dirty = true;
    });
    // Publication d'instantanés HL (fetch toutes les 5 min tant que LIQHL est actif) :
    // la grille HL est à reconstruire, puis un repaint — comme un changement de données.
    this.unsubHeat = hlHeatStore.subscribe(() => {
      this.grilleHlObsolete = true;
      this.dirty = true;
    });
    // Redimensionnement du conteneur (resize fenêtre, toggle sidebar…) : aucun
    // scroll/zoom/tick ne le signale autrement, d'où l'observer dédié.
    this.resizeObserver = new ResizeObserver(this.markDirty);
    this.resizeObserver.observe(this.container);
    this.loop();
  }

  private stop(): void {
    this.running = false;
    this.canvas.style.display = "none";
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.unsubscribeActions();
    this.unsubMarket?.();
    this.unsubMarket = null;
    this.unsubEvents?.();
    this.unsubEvents = null;
    this.unsubFlash?.();
    this.unsubFlash = null;
    this.unsubOi?.();
    this.unsubOi = null;
    this.unsubTheme?.();
    this.unsubTheme = null;
    this.unsubMode?.();
    this.unsubMode = null;
    this.unsubOrderflow?.();
    this.unsubOrderflow = null;
    this.unsubHeat?.();
    this.unsubHeat = null;
    // Coupe le minuteur et vide le store HL : sans contrôleur actif, rien ne consomme
    // les instantanés (LIQHL OFF ou contrôleur arrêté).
    arreterHeat();
    this.hlEtaitActif = false;
    this.bandeBasHlPrec = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.animeJusqua = 0;
    this.dernierBumpTs = 0;
    this.dernierCrosshair = null;
    this.derniereGrille = null;
    this.grilleObsolete = true;
    this.derniereGrilleHl = null;
    this.grilleHlObsolete = true;
    this.derniersNiveaux = null;
    this.derniersConsommes = null;
    this.niveauxObsoletes = true;
    this.imageDataLissage = null;
    this.clearCanvas();
  }

  private readonly onViewport = (): void => {
    this.markDirty();
    this.render();
  };

  private subscribeActions(): void {
    this.chart.subscribeAction(ActionType.OnScroll, this.onViewport);
    this.chart.subscribeAction(ActionType.OnZoom, this.onViewport);
    this.chart.subscribeAction(ActionType.OnVisibleRangeChange, this.onViewport);
    this.chart.subscribeAction(ActionType.OnCrosshairChange, this.onCrosshair);
  }

  private unsubscribeActions(): void {
    this.chart.unsubscribeAction(ActionType.OnScroll, this.onViewport);
    this.chart.unsubscribeAction(ActionType.OnZoom, this.onViewport);
    this.chart.unsubscribeAction(ActionType.OnVisibleRangeChange, this.onViewport);
    this.chart.unsubscribeAction(ActionType.OnCrosshairChange, this.onCrosshair);
  }

  private readonly loop = (): void => {
    // Fenêtre d'animation du fade-in en cours : forcer le repaint pour faire retomber l'alpha
    // des cellules fraîches frame après frame (sinon un seul rendu figerait le flash).
    if (this.animeJusqua > Date.now()) this.dirty = true;
    if (this.dirty) this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private toPx(p: Partial<Point>): PixelXY {
    return this.chart.convertToPixel(p, {
      paneId: CANDLE_PANE_ID,
      absolute: true,
    }) as PixelXY;
  }

  private clearCanvas(): void {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.container.clientWidth, this.container.clientHeight);
  }

  private render(): void {
    if (!this.running) return;
    this.dirty = false; // consommé : la prochaine frame ne refera rien tant que rien ne change.
    const ctx = this.ctx;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = this.container.clientWidth;
    const cssH = this.container.clientHeight;
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
      this.canvas.style.width = `${cssW}px`;
      this.canvas.style.height = `${cssH}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const main = this.chart.getSize(CANDLE_PANE_ID, DomPosition.Main);
    if (!main) return;

    // Tokens de couleur lus UNE fois par frame (getComputedStyle est coûteux) et réutilisés
    // par toutes les couches, comme le fait volumeProfile.ts. La rampe ESTHÉTIQUE de la heatmap
    // est choisie par le THÈME actif (Bloomberg ambre, Matrix vert, dark/aurora viridis…), avec
    // repli fond clair/sombre via `--bg` pour un thème inconnu (cf. rampePourTheme).
    const up = lireTokenCanvas("--up", "#10b981");
    const down = lireTokenCanvas("--down", "#ef4444");
    const fondClair = estFondClair(lireTokenCanvas("--bg", ""));
    const tokens: Tokens = {
      textDim: lireTokenCanvas("--text-dim", "#9ca3af"),
      up,
      down,
      text: lireTokenCanvas("--text", "#e5e7eb"),
      surface: lireTokenCanvas("--surface", "#171717"),
      border: lireTokenCanvas("--border", "#262626"),
      rampe: rampePourTheme(themeStore.getState().theme, fondClair),
      // Parse UNE fois par frame (le mode dominance compose un rgba PAR cellule).
      upRgb: parseCssColor(up) ?? UP_RGB_FALLBACK,
      downRgb: parseCssColor(down) ?? DOWN_RGB_FALLBACK,
      estRgb: teinteEstPourTheme(themeStore.getState().theme),
      rampeHl: fondClair ? RAMPE_HL_AMBRE_INVERSEE : RAMPE_HL_AMBRE,
    };

    // Trois couches INDÉPENDANTES sur le même canvas : heatmap RÉELLE (LIQMARK), niveaux
    // ESTIMÉS (LIQEST) et niveaux RÉELS HL (LIQHL — barres + heatmap d'instantanés).
    const heatActif = liqMarksStore.getState().actif;
    const estActif = liqEstStore.getState().actif;
    const hlActif = hlLiqStore.getState().actif;
    // Niveaux HL = prix en USD : sur une paire cotée hors USD (ETHBTC, BTCJPY…), la couche se
    // tait à l'écran et la légende dit pourquoi (cf. raisonCotationHl).
    const raisonHl = hlActif ? raisonCotationHl(marketStore.getState().symbol) : null;
    const hlDessinable = hlActif && raisonHl === null;
    // Retombée de la heatmap HL (LIQHL → OFF ou paire hors USD) : coupe le minuteur, vide le store.
    if (!hlDessinable && this.hlEtaitActif) arreterHeat();
    this.hlEtaitActif = hlDessinable;
    if (hlDessinable) {
      // Alimente l'historique d'instantanés SANS bloquer le rendu (fetch incrémental).
      this.assurerHeatVue();
      // La heatmap des instantanés est peinte D'ABORD : les cellules exécutées (données
      // live) passent par-dessus — le flux récent prime la mesure historique.
      this.dessinerHeatmapHl(main, tokens, heatActif);
    }
    // Disposition des barres HL AVANT la heatmap exécutée : ses étiquettes de clusters doivent
    // éviter la pilule du repère haut HL, peinte plus tard (cf. disposerHl).
    const dispoHl = hlDessinable ? this.disposerHl(main, heatActif) : null;
    const bandesHl: Array<[number, number]> = [];
    if (dispoHl?.repereHaut === true) bandesHl.push(dispoHl.bandeHaut);
    if (dispoHl !== null && this.bandeBasHlPrec !== null) bandesHl.push(this.bandeBasHlPrec);
    if (heatActif) this.dessinerHeatmap(main, tokens, bandesHl);
    if (estActif) this.dessinerNiveauxEstimes(main, tokens);
    // Bloc de légendes UNIFIÉ en bas-droite (barre d'échelle USD, mini-légende profil, légende
    // EST) : dessiné une fois par frame APRÈS les couches (la grille est alors en cache), empilé
    // vers le haut au-dessus de l'axe temps — supprime les collisions avec les boutons de layout
    // DOM et la légende du Volume Profile (restée en haut à droite).
    const sommetPile = this.dessinerLegendes(main, tokens, heatActif, estActif, hlActif, raisonHl);
    // Barres HL APRÈS la pile : le repère BAS se pose au-dessus d'elle (hauteur variable selon
    // les couches actives) et la zone des barres s'arrête à ce repère — aucune barre ni étiquette
    // HL n'entre donc dans la pile, et les légendes (garde-fous non contournables) restent lisibles.
    const bandeBas = dispoHl !== null ? this.dessinerNiveauxHl(main, tokens, dispoHl, sommetPile) : null;
    const memeBande =
      bandeBas === this.bandeBasHlPrec ||
      (bandeBas !== null && this.bandeBasHlPrec !== null &&
        bandeBas[0] === this.bandeBasHlPrec[0] && bandeBas[1] === this.bandeBasHlPrec[1]);
    if (!memeBande) {
      this.bandeBasHlPrec = bandeBas;
      if (heatActif) this.dirty = true; // étiquettes exécutées posées contre une bande périmée
    }
  }

  /**
   * Couche NIVEAUX RÉELS HYPERLIQUID (LIQHL) — barres horizontales PLEINES ancrées au bord
   * droit, une par cluster de positions ouvertes de l'échantillon (cf. `filtrerNiveauxHl` —
   * validité seule, plus de fenêtre — / `clusteriserNiveauxHl`, pures et testées).
   *
   * Prix de référence = close de la DERNIÈRE bougie CHARGÉE (prix live), pas de la dernière
   * visible : faire défiler l'historique ne change ni le bucketing ni l'ensemble des clusters.
   *
   * Hors écran RÉSUMÉ, pas jeté : l'axe Y de KLineChart se cale sur les bougies visibles et
   * `convertToPixel` extrapole sans borne — un cluster hors de [top, top+height] était peint
   * puis jeté par `ctx.clip()` sans aucun repère. `partitionnerClustersHl` sépare désormais
   * visibles / au-dessus / en dessous : seuls les VISIBLES ont une barre et une étiquette, et
   * chaque côté porte un repère de BORD (`libelleBordHl`).
   *
   * ZONE DES BARRES = entre les deux repères, pas le pane entier (`bandeRepereHl`) :
   *  - repère HAUT posé par `disposerHl` SOUS les surcouches DOM MESURÉES (bandeau SymbolBanner
   *    top+8…top+44 voire plus s'il passe sur 2 lignes, lignes de légende overlay, message
   *    d'attente de la heatmap exécutée). L'ancienne hypothèse « bande DOM de 24 px » était
   *    fausse : posé à top+24, le repère disparaissait sous le bandeau (z-10, au-dessus du canvas) ;
   *  - repère BAS posé AU-DESSUS de la pile de légendes bas-droite (`sommetPile`).
   * Un cluster au-dessus du bord bas de la pilule ▲ (hors écran, sous le bandeau ou sous la
   * pilule elle-même) ou sous le bord haut de la pilule ▼ est RÉSUMÉ dans le repère, jamais peint
   * puis masqué sans être compté. Les étiquettes évitent de même les bandes des pilules peintes.
   *
   * Distincte à l'œil des deux autres couches : la heatmap réelle peint des cellules
   * temps×prix, les niveaux ESTIMÉS des lignes POINTILLÉES pleine largeur — ici des barres
   * PLEINES adossées au bord droit, dont la LONGUEUR ∝ √(totalUsd) (la racine comprime les
   * cascades sans écraser les petits clusters, comme le log ailleurs), normalisée au plus gros
   * cluster VISIBLE (une aberration hors écran n'écrase donc plus l'échelle) et plafonnée à
   * `HL_BARRE_MAX_PX`.
   *
   * Couleurs : longs liquidés (SOUS le prix, ventes forcées) → `--down` ; shorts (AU-DESSUS,
   * rachats forcés) → `--up` — même sémantique que le profil latéral et le tooltip.
   *
   * ANCRAGE : décalé vers l'intérieur de la largeur du Volume Profile s'il est actif ET de
   * celle des bandes du profil réel si la heatmap est active — sans quoi les trois histogrammes
   * du bord droit se peindraient les uns sur les autres.
   *
   * Renvoie la bande de la pilule ▼ si elle est peinte, sinon `null` (cf. `bandeBasHlPrec`).
   */
  private dessinerNiveauxHl(
    main: Bounding,
    tokens: Tokens,
    dispo: DispositionHl,
    sommetPile: number,
  ): [number, number] | null {
    const { places, xAncre, yRepereHaut, bandeHaut } = dispo;
    const ctx = this.ctx;
    const { left, top, width, height } = main;
    // Repère BAS : pilule posée à ECART_REPERE_PX au-dessus du sommet de la pile de légendes.
    const yRepereBas = sommetPile - ECART_REPERE_PX - HL_PILULE_H;
    const bandeBas = bandeRepereHl(yRepereBas);
    const { visibles, auDessus, enDessous } = partitionnerClustersHl(places, bandeHaut[1], bandeBas[0]);

    // Racine de normalisation sur les VISIBLES seulement.
    let maxUsd = 0;
    for (const c of visibles) if (c.totalUsd > maxUsd) maxUsd = c.totalUsd;
    if (maxUsd > 0) {
      const racineMax = Math.sqrt(maxUsd);
      const longueurMax = Math.min(HL_BARRE_MAX_PX, width * 0.25);
      const largeur = (c: ClusterHl): number => Math.max(2, (Math.sqrt(c.totalUsd) / racineMax) * longueurMax);

      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, width, height);
      ctx.clip();
      // Barres, du bord droit vers la gauche. `y` centré sur le prix moyen pondéré du cluster.
      ctx.globalAlpha = HL_ALPHA;
      for (const c of visibles) {
        ctx.fillStyle = c.side === "long" ? tokens.down : tokens.up;
        ctx.fillRect(xAncre - largeur(c), Math.round(c.y) - HL_BARRE_H / 2, largeur(c), HL_BARRE_H);
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // Étiquettes des NB_LABELS_HL plus gros clusters VISIBLES hors des bandes des repères
      // PEINTS (filtre AVANT le slice : un gros cluster sous une pilule ne doit pas voler une
      // place), à gauche de leur barre — même pilule et même ordre « prix · USD » que les labels
      // du profil réel. Les visibles sont déjà sous les surcouches DOM (zone des barres).
      ctx.font = "9px ui-monospace, SFMono-Regular, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const bandes: Array<[number, number]> = [];
      if (auDessus.nNiveaux > 0) bandes.push(bandeHaut);
      if (enDessous.nNiveaux > 0) bandes.push(bandeBas);
      const candidats = filtrerHorsBandes(visibles, bandes, HL_PILULE_H / 2)
        .sort((a, b) => b.totalUsd - a.totalUsd)
        .slice(0, NB_LABELS_HL)
        .map((c) => ({ y: c.y, poids: c.totalUsd, px: c.pxMoyenPondere, w: largeur(c) }));
      for (const item of dechevaucher(candidats, 14)) {
        const label = `${formatPrice(item.px)} · ${formatUsd(item.poids)}`;
        const droite = xAncre - item.w - 4;
        const w = ctx.measureText(label).width;
        ctx.fillStyle = tokens.surface;
        ctx.globalAlpha = 0.96;
        ctx.fillRect(droite - w - 6, item.y - HL_PILULE_H / 2, w + 6, HL_PILULE_H);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = tokens.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(droite - w - 6, item.y - HL_PILULE_H / 2, w + 6, HL_PILULE_H);
        ctx.fillStyle = tokens.text;
        ctx.fillText(label, droite - 3, item.y);
      }
    }

    // Repères de bord (rien si le côté est vide), peints en DERNIER : au-dessus des barres.
    this.dessinerRepereBordHl(auDessus, "haut", xAncre, yRepereHaut, tokens);
    this.dessinerRepereBordHl(enDessous, "bas", xAncre, yRepereBas, tokens);
    return enDessous.nNiveaux > 0 ? bandeBas : null;
  }

  /**
   * Disposition des barres HL de la frame, calculée AVANT la heatmap exécutée (dont les
   * étiquettes doivent éviter la pilule ▲) : clusters de TOUS les niveaux valides autour du
   * prix LIVE (close de la DERNIÈRE bougie CHARGÉE), positionnés par `toPx` (y non fini écarté),
   * ancre droite des barres, et position du repère HAUT.
   *
   * Repère haut : premier y ≥ top + BANDE_DOM_PX libre de toute surcouche DOM (`obstaclesDom`)
   * et du message d'attente de la heatmap exécutée sur [left, xAncre] — toute la largeur à
   * gauche de l'ancre, car la pilule y grandit vers la gauche avec son libellé (dont la longueur
   * dépend de la partition, elle-même fonction de ce y : la largeur maximale casse la boucle).
   * Plafonné au tiers haut du pane (surcouches pathologiques). `null` si rien à peindre.
   */
  private disposerHl(main: Bounding, heatActif: boolean): DispositionHl | null {
    const { niveaux } = hlLiqStore.getState();
    if (niveaux.length === 0) return null;
    const candles = marketStore.getState().candles;
    const derniere = candles[candles.length - 1];
    if (derniere === undefined) return null;
    const clusters = clusteriserNiveauxHl(filtrerNiveauxHl(niveaux), derniere.close);
    if (clusters.length === 0) return null;

    const { left, top, width, height } = main;
    const places: ClusterHlPlace[] = [];
    for (const c of clusters) {
      const y = this.toPx({ value: c.pxMoyenPondere }).y;
      if (y !== undefined && Number.isFinite(y)) places.push({ ...c, y });
    }
    const vpActif = volumeProfileStore.getState().enabled;
    const xAncre =
      left + width - (vpActif ? width * VP_WIDTH_FRAC : 0) - (heatActif ? width * MAX_BAND_FRAC : 0);

    const obstacles = this.obstaclesDom();
    if (heatActif && liqEventsStore.getState().enAttente && this.grilleReelle() === null) {
      obstacles.push(this.rectMessageAttente(main));
    }
    const yRepereHaut = Math.min(
      yLibreSousObstacles(top + BANDE_DOM_PX, HL_PILULE_H, left, xAncre, obstacles),
      top + height / 3,
    );
    const bandeHaut = bandeRepereHl(yRepereHaut);
    return { places, xAncre, yRepereHaut, bandeHaut, repereHaut: places.some((c) => c.y < bandeHaut[1]) };
  }

  /**
   * Surcouches DOM du conteneur, en px CSS du canvas : bandeau symbole (SymbolBanner), lignes de
   * la légende overlay (OverlayLegend), badges REPLAY / orderflow… Elles passent AU-DESSUS du
   * canvas (z-10/z-20) : une pilule peinte dessous serait invisible. Exclut les canvases et tout
   * élément d'au moins la moitié de la hauteur (div du graphe, voile de chargement plein cadre).
   * Lecture de layout seulement aux frames SALES (`render` est dirty-only), ~15 enfants.
   */
  private obstaclesDom(): RectPx[] {
    const base = this.container.getBoundingClientRect();
    const obstacles: RectPx[] = [];
    for (const el of Array.from(this.container.children)) {
      if (el instanceof HTMLCanvasElement) continue;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0) || !(r.height > 0) || r.height >= base.height / 2) continue;
      obstacles.push({
        x0: r.left - base.left,
        x1: r.right - base.left,
        y0: r.top - base.top,
        y1: r.bottom - base.top,
      });
    }
    return obstacles;
  }

  /** Emprise du message d'attente de la heatmap exécutée (mêmes constantes que son tracé). */
  private rectMessageAttente(main: Bounding): RectPx {
    this.ctx.font = POLICE_MSG_ATTENTE;
    const w = this.ctx.measureText(MSG_ATTENTE_LIQ).width;
    const xRight = main.left + main.width;
    const y0 = main.top + Y_MSG_ATTENTE_PX;
    return { x0: xRight - 4 - w, x1: xRight - 4, y0, y1: y0 + H_MSG_ATTENTE_PX };
  }

  /**
   * Repère de BORD des niveaux HL hors écran : pilule « ▲/▼ N niv. hors écran · total · max … @
   * prix » (`libelleBordHl`, pure et testée) ancrée à DROITE sur `xDroite` (l'ancre des barres,
   * −4 px comme le retrait des légendes), bord haut à `yHaut`. Même style que les étiquettes de
   * clusters (fond `--surface`, bord `--border`, texte `--text`, 9 px mono) ; seul le TRIANGLE
   * est teinté du côté dominant du hors-écran — `--up` si les shorts (rachats forcés) pèsent au
   * moins autant que les longs, sinon `--down`. Rien si le côté est vide.
   */
  private dessinerRepereBordHl(
    h: HorsEcranHl,
    sens: "haut" | "bas",
    xDroite: number,
    yHaut: number,
    tokens: Tokens,
  ): void {
    const label = libelleBordHl(h, sens);
    if (label === null) return;
    const ctx = this.ctx;
    ctx.font = "9px ui-monospace, SFMono-Regular, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const fleche = label.slice(0, 1); // « ▲ » / « ▼ » (un seul code unit BMP)
    const reste = label.slice(1);
    const wFleche = ctx.measureText(fleche).width;
    const w = wFleche + ctx.measureText(reste).width;
    const x0 = xDroite - 4 - (w + 6);
    const yMilieu = yHaut + HL_PILULE_H / 2;
    ctx.fillStyle = tokens.surface;
    ctx.globalAlpha = 0.96;
    ctx.fillRect(x0, yHaut, w + 6, HL_PILULE_H);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = tokens.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, yHaut, w + 6, HL_PILULE_H);
    ctx.fillStyle = h.shortUsd >= h.longUsd ? tokens.up : tokens.down;
    ctx.fillText(fleche, x0 + 3, yMilieu);
    ctx.fillStyle = tokens.text;
    ctx.fillText(reste, x0 + 3 + wFleche, yMilieu);
  }

  /**
   * Demande non bloquante de l'historique d'instantanés HL couvrant la plage VISIBLE :
   * coin = base perp du symbole (« BTC »), pas = max(5 min, pas des bougies visibles),
   * borne basse = première bougie visible − 2 pas de report (cf. construireGrilleHl).
   * Idempotente — appelée à chaque frame tant que LIQHL est actif.
   */
  private assurerHeatVue(): void {
    const candles = marketStore.getState().candles;
    const range = this.chart.getVisibleRange();
    const from = Math.max(0, range.from);
    const to = Math.min(candles.length, range.to);
    const premier = candles[from];
    if (to - from < 1 || premier === undefined) return;
    const coin = basePerp(marketStore.getState().symbol);
    if (coin === null) return;
    const pas = Math.max(PERIODE_SNAP_HL_MS, pasBougieMs(candles, from, to));
    assurerHeat({ coin, pasMs: pas, depuisMs: premier.time - HL_REPORT_MAX_PAS * pas });
  }

  /**
   * Couche HEATMAP HL (LIQHL) : peint les niveaux de liquidation RÉELS des INSTANTANÉS
   * historiques collectés par le daemon (`hlHeatStore`, top leaderboard — ÉCHANTILLON
   * dont la couverture mesurée est affichée en légende). Peinte AVANT la heatmap des
   * liquidations exécutées : le flux live reste par-dessus.
   *
   * Rendu = mêmes cellules que la grille exécutée (rects précis / lissé « CoinGlass »)
   * paramétrées par la RAMPE AMBRE (`RAMPE_HL_AMBRE`, inversée sur fond clair), intensité
   * log normalisée sur la grille HL, alpha plus franc (0.15 → 0.85 : niveaux DEBOUT, pas
   * un flux passé), atténuation footprint conservée, SANS fade-in (un instantané n'est
   * pas un événement frais). La grille est mémoïsée (`grilleHlObsolete`, invalidations
   * identiques à la grille exécutée + chaque publication de `hlHeatStore`).
   *
   * Tooltip : seulement si AUCUNE cellule exécutée n'est sous le curseur (le tooltip
   * réel de `dessinerHeatmap` garde la priorité).
   */
  private dessinerHeatmapHl(main: Bounding, tokens: Tokens, heatActif: boolean): void {
    const instantanes = hlHeatStore.getState().instantanes;
    if (instantanes.length === 0) return;

    const candles = marketStore.getState().candles;
    const range = this.chart.getVisibleRange();
    const from = Math.max(0, range.from);
    const to = Math.min(candles.length, range.to);
    if (to - from < 1) return;

    if (this.grilleHlObsolete) {
      const pas = Math.max(PERIODE_SNAP_HL_MS, pasBougieMs(candles, from, to));
      this.derniereGrilleHl = construireGrilleHl(
        instantanes,
        candles,
        from,
        to,
        pas,
        liqMarksStore.getState().granularite,
      );
      this.grilleHlObsolete = false;
    }
    const grid = this.derniereGrilleHl;
    if (grid === null) return;

    const { largeurs, colonneParTime, largeurRef } = this.colonnesVisibles(candles, from, to);
    const ctx = this.ctx;
    const { left, top, width, height } = main;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    const now = Date.now();
    // Normalisation de l'intensité sur les cellules des buckets VISIBLES (HL seulement) : un
    // niveau lointain énorme (aberration de marge croisée) n'écrase plus la rampe de l'écran.
    // Repli sur `grid.maxUsd` si rien n'est visible ou si l'écran n'est pas convertible.
    const visibles = this.bucketsVisibles(main, grid.taille);
    const maxVisible = visibles === null ? 0 : maxUsdBuckets(grid, visibles.bucketMin, visibles.bucketMax);
    const opts: OptionsCellules = {
      rampe: tokens.rampeHl,
      alphaMin: 0.15,
      alphaMax: 0.85,
      sansFade: true,
      maxUsd: maxVisible > 0 ? maxVisible : grid.maxUsd,
      bornes: avecMargeBucket(visibles),
    };
    const lissage = largeurRef < SEUIL_LISSAGE_PX;
    if (
      !lissage ||
      !this.dessinerCellulesLissees(
        grid, candles, from, to, largeurs, colonneParTime, "intensite", tokens, now, opts,
      )
    ) {
      this.dessinerCellulesRects(grid, largeurs, "intensite", tokens, now, opts);
    }
    ctx.restore();

    // Tooltip HL hors clip : seulement si aucune cellule EXÉCUTÉE n'est sous le curseur.
    const survolReel =
      heatActif && this.derniereGrille !== null
        ? this.cellSurvolee(this.derniereGrille, candles)
        : null;
    if (survolReel === null) {
      const survolHl = this.cellSurvolee(grid, candles);
      if (survolHl !== null) this.dessinerTooltipHl(survolHl, grid, main, tokens);
    }
  }

  /**
   * Grille RÉELLE de la plage visible, reconstruite SEULEMENT si obsolète (données/viewport/
   * resize) : au survol, `onCrosshair` marque `dirty` sans marquer `grilleObsolete`, donc on
   * réutilise la dernière grille rendue pour le hit-test au lieu de ré-agréger tout le buffer à
   * chaque mousemove. Appelée aussi par `disposerHl` (le message d'attente, peint quand elle est
   * nulle, est un obstacle du repère haut HL) — idempotente dans la frame.
   */
  private grilleReelle(): LiqGrid | null {
    if (this.grilleObsolete) {
      const candles = marketStore.getState().candles;
      const range = this.chart.getVisibleRange();
      const from = Math.max(0, range.from);
      const to = Math.min(candles.length, range.to);
      const facteur = liqMarksStore.getState().granularite;
      this.derniereGrille =
        to - from >= 1 ? construireGrille(liqEventsStore.getState().events, candles, from, to, facteur) : null;
      this.grilleObsolete = false;
    }
    return this.derniereGrille;
  }

  /**
   * Couche HEATMAP RÉELLE : grille temps×prix (viridis log) + profil latéral long/short +
   * tooltip de survol, depuis les liquidations RÉELLEMENT exécutées (liqEventsStore).
   * `bandesHl` : bandes verticales des pilules de repère HL qui seront peintes par-dessus —
   * interdites aux étiquettes de clusters (cf. `dessinerLabelsClusters`).
   */
  private dessinerHeatmap(main: Bounding, tokens: Tokens, bandesHl: ReadonlyArray<readonly [number, number]>): void {
    const ctx = this.ctx;
    const { left, top, width, height } = main;
    const xRight = left + width;

    const { enAttente } = liqEventsStore.getState();
    const candles = marketStore.getState().candles;
    const range = this.chart.getVisibleRange();
    const from = Math.max(0, range.from);
    const to = Math.min(candles.length, range.to);
    const grid = this.grilleReelle();

    // Buffer vide (heatmap actif mais aucune liquidation encore reçue) : indicateur « en
    // attente » discret, en haut à droite (top+22). Le repère haut HL le traite en obstacle.
    if (grid === null) {
      if (enAttente) {
        ctx.fillStyle = tokens.textDim;
        ctx.font = POLICE_MSG_ATTENTE;
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.fillText(MSG_ATTENTE_LIQ, xRight - 4, top + Y_MSG_ATTENTE_PX);
      }
      // Le flash de bande reste rendu même sans grille (clic feed juste après l'allumage) :
      // il matérialise le niveau de prix de la liquidation cliquée.
      this.dessinerFlash(main);
      return;
    }

    // Bords ENTIERS PARTAGÉS par colonne (x0/x1 arrondis) : deux cellules adjacentes partagent
    // exactement le même bord entier → plus de couture d'anti-aliasing (fine grille sombre).
    // La cellule est CENTRÉE sur x ; la dernière bougie réutilise la largeur de l'avant-dernière.
    const { largeurs, colonneParTime, largeurRef: prevW } = this.colonnesVisibles(candles, from, to);

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    // Deux RENDUS de cellules selon la largeur de bougie (l'espacement klinecharts est uniforme,
    // `prevW` — dernier espacement mesuré — en est représentatif) :
    //  • bougies FINES (< SEUIL_LISSAGE_PX, zoom large) : offscreen basse résolution upscalé
    //    (« CoinGlass ») — rendu continu, 1 drawImage au lieu de centaines de fillRect ;
    //  • bougies LARGES (zoom serré) : rects précis, lecture cellule à cellule.
    // Repli sur les rects si le lissé ne peut pas se dessiner (bornes non convertibles…).
    // Le mode ne change QUE la couleur des cellules (grille mémoïsée intacte).
    const mode = liqMarksStore.getState().mode;
    // Horodatage unique de la frame : sert au fade-in des cellules fraîches (même `now` pour
    // les deux chemins de rendu, cohérence de l'animation).
    const now = Date.now();
    const lissage = prevW < SEUIL_LISSAGE_PX;
    // Bornes de l'écran passées au SEUL rendu lissé (allocation du petit canvas limitée à la
    // bande visible) — normalisation inchangée (`grid.maxUsd`) pour la heatmap exécutée.
    const optsLissage: OptionsCellules = lissage
      ? { bornes: avecMargeBucket(this.bucketsVisibles(main, grid.taille)) }
      : {};
    if (
      !lissage ||
      !this.dessinerCellulesLissees(grid, candles, from, to, largeurs, colonneParTime, mode, tokens, now, optsLissage)
    ) {
      this.dessinerCellulesRects(grid, largeurs, mode, tokens, now);
    }

    // Bulles de clusters (rendu « CoinGlass ») : une bulle PAR CELLULE significative
    // (≥ P70 des totaux, cf. bullesDepuisGrille), rayon ∝ √notionnel, teinte du côté
    // dominant (longs liquidés = ventes forcées → --down ; shorts → --up). Dessinées
    // APRÈS les cellules (fond de densité) et AVANT les bandes du profil latéral.
    if (liqMarksStore.getState().bulles) {
      this.dessinerBulles(grid, largeurs, tokens, now, main);
    }

    // Bandes latérales du profil par prix : largeur ∝ intensité log (max 12 % du pane), SPLIT
    // proportionnel — shorts (rachats forcés) teinte `--up`, longs (ventes forcées) teinte
    // `--down`. Ancre décalée vers l'intérieur de la largeur VP quand le Volume Profile est
    // actif (sinon les deux histogrammes se mélangeraient au bord droit). Alpha 0.35 (les
    // bandes masquaient les dernières bougies et l'étiquette de prix).
    const profil = profilParPrix(grid);
    let maxProfil = 0;
    for (const agg of profil.values()) {
      const total = agg.longUsd + agg.shortUsd;
      if (total > maxProfil) maxProfil = total;
    }
    const vpActif = volumeProfileStore.getState().enabled;
    const xAncre = xRight - (vpActif ? width * VP_WIDTH_FRAC : 0);
    if (maxProfil > 0) {
      const maxBandW = width * MAX_BAND_FRAC;
      const up = tokens.up;
      const down = tokens.down;
      ctx.globalAlpha = 0.35;
      for (const [idx, agg] of profil) {
        const total = agg.longUsd + agg.shortUsd;
        if (total <= 0) continue;
        const yTop = this.toPx({ value: (idx + 1) * grid.taille }).y;
        const yBot = this.toPx({ value: idx * grid.taille }).y;
        if (yTop === undefined || yBot === undefined || !Number.isFinite(yTop) || !Number.isFinite(yBot)) {
          continue;
        }
        const y0 = Math.round(Math.min(yTop, yBot));
        const y1 = Math.round(Math.max(yTop, yBot));
        const h = Math.max(1, y1 - y0);
        const w = intensiteLog(total, maxProfil) * maxBandW;
        const longW = Math.round(w * (agg.longUsd / total));
        const shortW = Math.round(w) - longW;
        // longs (--down) collés à l'ancre, shorts (--up) à leur gauche. globalAlpha plutôt
        // qu'une couleur rgba pré-calculée : robuste quel que soit le format du token de thème.
        ctx.fillStyle = down;
        ctx.fillRect(xAncre - longW, y0, longW, h);
        ctx.fillStyle = up;
        ctx.fillRect(xAncre - longW - shortW, y0, shortW, h);
      }
      ctx.globalAlpha = 1;

      // Étiquettes des top clusters : pilule « prix · USD » à gauche de la barre, pour les
      // NB_LABELS_CLUSTER plus gros buckets (dé-chevauchement 14 px, le plus gros gagne, exclus
      // sous la toolbar et sous les pilules de repère HL). Annonce du même coup la valeur USD du
      // bucket max (le n°1).
      this.dessinerLabelsClusters(profil, grid, maxProfil, xAncre, maxBandW, main, tokens, bandesHl);
    }

    // Surbrillance de la cellule survolée (contour 1.5 px tokens.text) — tracée seulement quand
    // une cellule est sous le curseur (le tooltip est alors affiché).
    const hover = this.cellSurvolee(grid, candles);
    if (hover !== null) {
      const col = largeurs.get(hover.candleTime);
      const yTop = this.toPx({ value: (hover.bucketIdx + 1) * grid.taille }).y;
      const yBot = this.toPx({ value: hover.bucketIdx * grid.taille }).y;
      if (col !== undefined && yTop !== undefined && yBot !== undefined && Number.isFinite(yTop) && Number.isFinite(yBot)) {
        const y0 = Math.round(Math.min(yTop, yBot));
        const y1 = Math.round(Math.max(yTop, yBot));
        ctx.strokeStyle = tokens.text;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(col.x0 + 0.75, y0 + 0.75, Math.max(1, col.x1 - col.x0) - 1.5, Math.max(1, y1 - y0) - 1.5);
        ctx.globalAlpha = 1;
      }
    }

    ctx.restore();

    // Flash de bande (clic feed LIQ) : AU-DESSUS des cellules et du profil, SOUS le tooltip.
    this.dessinerFlash(main);

    // Tooltip de survol : dessiné HORS clip (au-dessus de la heatmap), après restauration.
    if (hover !== null) this.dessinerTooltip(hover, grid, main, tokens);
  }

  /**
   * Buckets de prix couverts par l'ÉCRAN (bornes incluses) pour une taille de bucket : prix
   * aux pixels `top` et `top + height` convertis PAR L'API (`convertFromPixel`, `absolute` car
   * `main.top` est absolu comme pour `toPx`) — jamais à la main : l'axe peut être log ou en
   * pourcentage, voire inversé (d'où min/max). Un bas d'écran ≤ 0 (axe linéaire très dézoomé)
   * est ramené à 0 : aucun niveau n'existe sous zéro. `null` si la conversion échoue.
   */
  private bucketsVisibles(main: Bounding, taille: number): { bucketMin: number; bucketMax: number } | null {
    if (!(taille > 0)) return null;
    const conv = this.chart.convertFromPixel([{ y: main.top }, { y: main.top + main.height }], {
      paneId: CANDLE_PANE_ID,
      absolute: true,
    });
    const points = Array.isArray(conv) ? conv : [conv];
    const a = points[0]?.value;
    const b = points[1]?.value;
    if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return null;
    const prixMax = Math.max(a, b);
    if (!(prixMax > 0)) return null;
    const prixMin = Math.max(0, Math.min(a, b));
    return { bucketMin: bucketIndex(prixMin, taille), bucketMax: bucketIndex(prixMax, taille) };
  }

  /**
   * Bords de colonnes partagés des bougies visibles : `{x0, x1}` entiers par bougie
   * (cellule CENTRÉE sur x, dernière bougie = largeur de l'avant-dernière), index de
   * colonne `0..n-1` par `candle.time` (rendu lissé offscreen : 1 colonne = 1 pixel) et
   * `largeurRef` = dernier espacement mesuré (représentatif de l'espacement uniforme
   * klinecharts — pilote le seuil de lissage). Factorise le calcul commun aux heatmaps
   * exécutée et HL (instantanés).
   */
  private colonnesVisibles(
    candles: Candle[],
    from: number,
    to: number,
  ): {
    largeurs: Map<number, { x0: number; x1: number }>;
    colonneParTime: Map<number, number>;
    largeurRef: number;
  } {
    const largeurs = new Map<number, { x0: number; x1: number }>();
    const colonneParTime = new Map<number, number>();
    let prevW = FALLBACK_CELL_W;
    for (let i = from; i < to; i++) {
      const c = candles[i];
      if (c === undefined) continue;
      colonneParTime.set(c.time, i - from);
      const x = this.toPx({ timestamp: c.time }).x;
      if (x === undefined || !Number.isFinite(x)) continue;
      const suivant = i + 1 < to ? candles[i + 1] : undefined;
      let w = prevW;
      if (suivant !== undefined) {
        const xn = this.toPx({ timestamp: suivant.time }).x;
        if (xn !== undefined && Number.isFinite(xn)) w = Math.max(1, xn - x);
      }
      prevW = w;
      largeurs.set(c.time, { x0: Math.round(x - w / 2), x1: Math.round(x + w / 2) });
    }
    return { largeurs, colonneParTime, largeurRef: prevW };
  }

  /**
   * Rendu CELLULE À CELLULE (bougies larges ≥ SEUIL_LISSAGE_PX) : un fillRect par cellule,
   * rampe theme-aware d'intensité log. Alpha borné [0.15, 0.55] pour ne pas masquer le prix
   * sous les cascades (bornes réglables via `opts` — la heatmap HL monte à 0.85). Bords
   * entiers (x0/x1 partagés par colonne ; yTop/yBot arrondis par bucket → mêmes bords que
   * le bucket voisin).
   * Mode « dominance » : la teinte remplace la rampe du thème — shorts liquidés dominants =
   * `--up` (rachats forcés), longs = `--down` (ventes forcées), même sémantique que le profil
   * latéral — et l'alpha d'intensité est modulé par |deseq| (cellule équilibrée pâle, cellule
   * très déséquilibrée franche). `now` : fade-in des cellules fraîches (cf. alphaFadeIn,
   * sauté quand `opts.sansFade` — les instantanés HL ne sont pas des événements).
   */
  private dessinerCellulesRects(
    grid: LiqGrid,
    largeurs: Map<number, { x0: number; x1: number }>,
    mode: LiqHeatMode,
    tokens: Tokens,
    now: number,
    opts?: OptionsCellules,
  ): void {
    const ctx = this.ctx;
    // Atténuation ×0.5 si le footprint est actif : lue 1×/frame (les deux couches se
    // superposent sur les mêmes bougies — cf. attenuationFootprint).
    const footprintActif = orderflowStore.getState().enabled;
    const aMin = opts?.alphaMin ?? 0.15;
    const aMax = opts?.alphaMax ?? 0.55;
    const maxUsd = opts?.maxUsd ?? grid.maxUsd;
    for (const cell of grid.cells.values()) {
      const col = largeurs.get(cell.candleTime);
      if (col === undefined) continue;
      const yTop = this.toPx({ value: (cell.bucketIdx + 1) * grid.taille }).y;
      const yBot = this.toPx({ value: cell.bucketIdx * grid.taille }).y;
      if (yTop === undefined || yBot === undefined || !Number.isFinite(yTop) || !Number.isFinite(yBot)) {
        continue;
      }
      const t = intensiteLog(cell.longUsd + cell.shortUsd, maxUsd);
      const y0 = Math.round(Math.min(yTop, yBot));
      const y1 = Math.round(Math.max(yTop, yBot));
      let rgb: [number, number, number];
      let alpha: number;
      if (mode === "dominance") {
        const d = desequilibre(cell.longUsd, cell.shortUsd);
        rgb = d >= 0 ? tokens.upRgb : tokens.downRgb;
        alpha = (aMin + (aMax - aMin) * t) * (0.35 + 0.65 * Math.abs(d));
      } else {
        rgb = couleurRampeArrets(t, opts?.rampe ?? tokens.rampe);
        alpha = aMin + (aMax - aMin) * t;
      }
      alpha = attenuationFootprint(alpha, footprintActif);
      if (opts?.sansFade !== true) {
        alpha = alphaFadeIn(alpha, cell.dernierTime, this.tsDemarrage, this.dernierBumpTs, now);
      }
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`;
      ctx.fillRect(col.x0, y0, Math.max(1, col.x1 - col.x0), Math.max(1, y1 - y0));
    }
  }

  /**
   * Bulles de clusters (« CoinGlass ») : cercles posés au milieu de la colonne de bougie et
   * au CENTRE du bucket de prix, rayon ∝ √notionnel (`bullesDepuisGrille`, pure et testée).
   * Remplissage rgba de la teinte du côté dominant (alpha 0.35 modulé par l'atténuation
   * footprint et le fade-in des cellules fraîches — les nouvelles liquidations « apparaissent »),
   * contour 1 px opaque de la même teinte. Appelé SOUS le clip du pane ; une bulle entièrement
   * hors du rectangle du pane n'est pas tracée. Les 4 plus grosses portent une pilule
   * « formatUsd » à droite (repliée à gauche si elle déborde du bord droit).
   */
  private dessinerBulles(
    grid: LiqGrid,
    largeurs: Map<number, { x0: number; x1: number }>,
    tokens: Tokens,
    now: number,
    main: Bounding,
  ): void {
    const ctx = this.ctx;
    const { left, top, width, height } = main;
    const xRight = left + width;
    const yBas = top + height;
    // Même atténuation ×0.5 que les cellules quand le footprint est actif (couches superposées).
    const footprintActif = orderflowStore.getState().enabled;
    const dessinees: Array<{ x: number; y: number; rayon: number; usd: number }> = [];
    for (const b of bullesDepuisGrille(grid)) {
      const col = largeurs.get(b.candleTime);
      if (col === undefined) continue;
      const x = (col.x0 + col.x1) / 2;
      const y = this.toPx({ value: (b.bucketIdx + 0.5) * grid.taille }).y;
      if (y === undefined || !Number.isFinite(y)) continue;
      if (x + b.rayon < left || x - b.rayon > xRight || y + b.rayon < top || y - b.rayon > yBas) continue;
      const rgb = b.side === "long" ? tokens.downRgb : tokens.upRgb;
      let alpha = attenuationFootprint(0.35, footprintActif);
      alpha = alphaFadeIn(alpha, b.dernierTime, this.tsDemarrage, this.dernierBumpTs, now);
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, b.rayon, 0, Math.PI * 2);
      ctx.fill();
      // Contour 1 px opaque de la même teinte : la bulle reste lisible sur la heatmap.
      ctx.strokeStyle = b.side === "long" ? tokens.down : tokens.up;
      ctx.lineWidth = 1;
      ctx.stroke();
      dessinees.push({ x, y, rayon: b.rayon, usd: b.usd });
    }

    // Étiquettes des 4 plus grosses bulles : pilule « USD » à droite de la bulle
    // (x + rayon + 4), repliée à gauche si elle déborde du bord droit du pane —
    // même style que les labels de clusters du profil (surface 0.96 / border / text 9 px).
    ctx.font = "9px ui-monospace, SFMono-Regular, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const candidats = dessinees
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 4)
      .map((d) => ({ ...d, poids: d.usd }));
    for (const item of dechevaucher(candidats, 14)) {
      const label = formatUsd(item.usd);
      const w = ctx.measureText(label).width;
      let xPilule = item.x + item.rayon + 4;
      if (xPilule + w + 6 > xRight) xPilule = item.x - item.rayon - 4 - (w + 6);
      ctx.fillStyle = tokens.surface;
      ctx.globalAlpha = 0.96;
      ctx.fillRect(xPilule, item.y - 7, w + 6, 14);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = tokens.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(xPilule, item.y - 7, w + 6, 14);
      ctx.fillStyle = tokens.text;
      ctx.fillText(label, xPilule + 3, item.y);
    }
  }

  /**
   * Rendu LISSÉ « CoinGlass » (bougies fines < SEUIL_LISSAGE_PX) : le petit canvas détaché
   * (`offscreen`, 1 cellule = 1 pixel, dimensions colonnes × buckets couverts) est peint via
   * ImageData — couleur PLEINE du mode courant, intensité encodée dans le canal ALPHA du pixel
   * (mêmes formules que les rects : 0.15 + 0.40t, × (0.35 + 0.65|deseq|) en dominance) — puis
   * upscalé en UN drawImage interpolé vers le rect englobant de la grille visible (bornes
   * converties par convertToPixel, comme les cellules rects). PAS de globalAlpha au drawImage :
   * l'atténuation est déjà dans les pixels (sinon double atténuation).
   *
   * AXE Y INVERSÉ : le prix croît vers le HAUT à l'écran alors que y canvas croît vers le BAS —
   * le bucket le plus HAUT en prix (bucketMax) occupe donc la ligne 0 (haut du petit canvas) :
   * ligne = bucketMax − bucketIdx.
   *
   * BORNES : `opts.bornes` (buckets de l'écran + marge) limite le petit canvas à la bande
   * visible — les cellules hors bande sont SAUTÉES (sinon leur ligne sortirait du tableau).
   * Garde DURE : plus de `MAX_LIGNES_LISSAGE` lignes, ou `createImageData` / `putImageData` /
   * `drawImage` qui lève → `false` (repli rects) : aucune exception ne doit sortir vers la
   * boucle rAF (elle mourait sur un RangeError avec des niveaux HL à 27 M$).
   * Intensité normalisée sur `opts.maxUsd` s'il est fourni (heatmap HL : max VISIBLE).
   *
   * Renvoie `false` si le rendu lissé est impossible (bornes non convertibles, contexte 2D
   * indisponible, bande trop haute, allocation refusée…) — l'appelant se replie alors sur les rects.
   */
  private dessinerCellulesLissees(
    grid: LiqGrid,
    candles: Candle[],
    from: number,
    to: number,
    largeurs: Map<number, { x0: number; x1: number }>,
    colonneParTime: Map<number, number>,
    mode: LiqHeatMode,
    tokens: Tokens,
    now: number,
    opts?: OptionsCellules,
  ): boolean {
    const dims = dimensionsGrilleVisible(grid, from, to, opts?.bornes);
    if (dims === null) return false;
    const { colonnes, bucketMin, bucketMax } = dims;
    const nbBuckets = bucketMax - bucketMin + 1;
    if (nbBuckets > MAX_LIGNES_LISSAGE) return false;

    // Rect cible ENGLOBANT : bords x des colonnes extrêmes (mêmes bords entiers partagés que
    // les rects) + y des bornes de prix [bucketMin, bucketMax+1] convertis par convertToPixel.
    const premier = candles[from];
    const dernier = candles[to - 1];
    if (premier === undefined || dernier === undefined) return false;
    const colPremiere = largeurs.get(premier.time);
    const colDerniere = largeurs.get(dernier.time);
    if (colPremiere === undefined || colDerniere === undefined) return false;
    const yHaut = this.toPx({ value: (bucketMax + 1) * grid.taille }).y;
    const yBas = this.toPx({ value: bucketMin * grid.taille }).y;
    if (yHaut === undefined || yBas === undefined || !Number.isFinite(yHaut) || !Number.isFinite(yBas)) {
      return false;
    }

    // Petit canvas membre, créé paresseusement et RÉUTILISÉ entre frames ; redimensionné
    // seulement si les dimensions de la grille visible changent (resize = réallocation).
    if (this.offscreen === null) {
      this.offscreen = document.createElement("canvas");
      this.offscreenCtx = this.offscreen.getContext("2d");
    }
    const off = this.offscreen;
    const offCtx = this.offscreenCtx;
    if (offCtx === null) return false;

    // Atténuation ×0.5 si le footprint est actif : lue 1×/frame (l'atténuation est encodée
    // dans le canal alpha du pixel, pas au globalAlpha du blit — cf. attenuationFootprint).
    const footprintActif = orderflowStore.getState().enabled;
    const aMin = opts?.alphaMin ?? 0.15;
    const aMax = opts?.alphaMax ?? 0.55;
    const maxUsd = opts?.maxUsd ?? grid.maxUsd;
    try {
      if (off.width !== colonnes || off.height !== nbBuckets) {
        off.width = colonnes;
        off.height = nbBuckets;
      }

      // 1 cellule = 1 pixel. ImageData membre RÉUTILISÉE entre frames (évite une alloc par frame
      // au survol) : recréée seulement si les dimensions changent, sinon vidée par `px.fill(0)`
      // en tête de frame → les cellules vides restent transparentes sans clearRect préalable.
      let img = this.imageDataLissage;
      if (img === null || img.width !== colonnes || img.height !== nbBuckets) {
        img = offCtx.createImageData(colonnes, nbBuckets);
        this.imageDataLissage = img;
      }
      const px = img.data;
      px.fill(0);
      for (const cell of grid.cells.values()) {
        // Hors de la bande allouée (bornes de l'écran) : sautée — sa ligne sortirait du tableau.
        if (cell.bucketIdx < bucketMin || cell.bucketIdx > bucketMax) continue;
        const colonne = colonneParTime.get(cell.candleTime);
        if (colonne === undefined) continue;
        const ligne = bucketMax - cell.bucketIdx; // axe Y inversé (cf. docstring)
        const t = intensiteLog(cell.longUsd + cell.shortUsd, maxUsd);
        let rgb: [number, number, number];
        let alpha: number;
        if (mode === "dominance") {
          const d = desequilibre(cell.longUsd, cell.shortUsd);
          rgb = d >= 0 ? tokens.upRgb : tokens.downRgb;
          alpha = (aMin + (aMax - aMin) * t) * (0.35 + 0.65 * Math.abs(d));
        } else {
          rgb = couleurRampeArrets(t, opts?.rampe ?? tokens.rampe);
          alpha = aMin + (aMax - aMin) * t;
        }
        alpha = attenuationFootprint(alpha, footprintActif);
        if (opts?.sansFade !== true) {
          alpha = alphaFadeIn(alpha, cell.dernierTime, this.tsDemarrage, this.dernierBumpTs, now);
        }
        const o = (ligne * colonnes + colonne) * 4;
        px[o] = rgb[0];
        px[o + 1] = rgb[1];
        px[o + 2] = rgb[2];
        px[o + 3] = Math.round(alpha * 255);
      }
      offCtx.putImageData(img, 0, 0);

      // Upscale INTERPOLÉ vers le pane : un seul drawImage par frame. L'état du contexte
      // (imageSmoothing…) est restauré par le ctx.restore() du clip de l'appelant.
      const ctx = this.ctx;
      const y0 = Math.round(Math.min(yHaut, yBas));
      const y1 = Math.round(Math.max(yHaut, yBas));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high"; // bicubique : c'est lui qui donne le rendu continu
      ctx.drawImage(off, colPremiere.x0, y0, Math.max(1, colDerniere.x1 - colPremiere.x0), Math.max(1, y1 - y0));
    } catch {
      // Allocation refusée (RangeError) ou canvas inutilisable : on oublie l'ImageData (peut-être
      // partielle) et on laisse l'appelant repeindre en rects — la boucle rAF survit.
      this.imageDataLissage = null;
      return false;
    }
    return true;
  }

  /**
   * Étiquettes des clusters les plus lourds du profil latéral : pilule « <prix arrondi au
   * bucket> · <total USD> » à gauche de la barre de chaque bucket (fond `--surface`, bord
   * `--border`, texte `--text` 9 px). On ne garde que les `NB_LABELS_CLUSTER` plus gros, on
   * les dé-chevauche verticalement (14 px, le plus gros gagne) et on exclut ceux qui passeraient
   * sous la toolbar DOM (`y < top + 24`) ou sous une pilule de repère HL peinte ensuite par-dessus
   * (`bandesHl`, filtre AVANT le slice : un cluster masqué ne vole pas une place d'étiquette).
   */
  private dessinerLabelsClusters(
    profil: Map<number, { longUsd: number; shortUsd: number }>,
    grid: LiqGrid,
    maxProfil: number,
    xAncre: number,
    maxBandW: number,
    main: Bounding,
    tokens: Tokens,
    bandesHl: ReadonlyArray<readonly [number, number]>,
  ): void {
    const ctx = this.ctx;
    const { top } = main;
    // Candidats : centre pixel du bucket + total ; on ne trace que les plus lourds, dé-chevauchés.
    const candidats: Array<{ y: number; poids: number; idx: number; total: number }> = [];
    for (const [idx, agg] of profil) {
      const total = agg.longUsd + agg.shortUsd;
      if (total <= 0) continue;
      const yTop = this.toPx({ value: (idx + 1) * grid.taille }).y;
      const yBot = this.toPx({ value: idx * grid.taille }).y;
      if (yTop === undefined || yBot === undefined || !Number.isFinite(yTop) || !Number.isFinite(yBot)) continue;
      candidats.push({ y: (yTop + yBot) / 2, poids: total, idx, total });
    }
    const tops = filtrerHorsBandes(candidats, bandesHl, 7)
      .sort((a, b) => b.poids - a.poids)
      .slice(0, NB_LABELS_CLUSTER);
    ctx.font = "9px ui-monospace, SFMono-Regular, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const item of dechevaucher(tops, 14)) {
      if (item.y < top + 24) continue;
      const label = `${formatPrice(item.idx * grid.taille)} · ${formatUsd(item.total)}`;
      const bandW = intensiteLog(item.total, maxProfil) * maxBandW;
      const droite = xAncre - bandW - 4; // juste à gauche de la barre du bucket
      const w = ctx.measureText(label).width;
      ctx.fillStyle = tokens.surface;
      ctx.globalAlpha = 0.96;
      ctx.fillRect(droite - w - 6, item.y - 7, w + 6, 14);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = tokens.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(droite - w - 6, item.y - 7, w + 6, 14);
      ctx.fillStyle = tokens.text;
      ctx.fillText(label, droite - 3, item.y);
    }
  }

  /**
   * Cellule sous le curseur (hit-test O(1) via `cellSousCurseur` sur la dernière grille) —
   * factorise l'extraction du crosshair pour la surbrillance ET le tooltip. `null` si le
   * curseur est hors du pane prix ou si aucune liquidation n'occupe la cellule visée.
   */
  private cellSurvolee(grid: LiqGrid, candles: Candle[]): LiqCell | null {
    const cross = this.dernierCrosshair;
    if (cross === null || cross.paneId !== CANDLE_PANE_ID) return null;
    const cy = cross.y;
    if (cy === undefined) return null;
    const timestamp = cross.kLineData?.timestamp;
    const conv = this.chart.convertFromPixel([{ y: cy }], { paneId: CANDLE_PANE_ID });
    const value = (Array.isArray(conv) ? conv[0] : conv)?.value;
    return cellSousCurseur(grid, candles, timestamp, value);
  }

  /**
   * FLASH de bande (lien feed→chart, cf. liqFlashStore/flasherNiveau) : rect pleine largeur
   * du pane sur la bande de prix contenant `price` — même taille de bucket (× granularité)
   * que la grille —, couleur `--accent`, alpha `0.28 × (restant / FLASH_DUREE_MS)` (fade
   * linéaire vers 0). Dessiné AU-DESSUS des cellules et du profil, SOUS le tooltip. Sans
   * grille (buffer vide au moment du clic), la taille de bucket est recalculée comme le
   * ferait `construireGrille` (close de la dernière bougie × granularité). Ne dessine rien
   * si le flash est expiré ou si la bande n'est pas convertible en pixels.
   */
  private dessinerFlash(main: Bounding): void {
    const { price, jusqua } = liqFlashStore.getState();
    if (price === null) return;
    const restant = jusqua - Date.now();
    if (restant <= 0) return;

    let taille = this.derniereGrille?.taille ?? 0;
    if (!(taille > 0)) {
      const candles = marketStore.getState().candles;
      const dernier = candles[candles.length - 1];
      if (dernier === undefined) return;
      taille = tailleBucket(dernier.close) * liqMarksStore.getState().granularite;
    }
    if (!(taille > 0)) return;

    const idx = bucketIndex(price, taille);
    const yTop = this.toPx({ value: (idx + 1) * taille }).y;
    const yBot = this.toPx({ value: idx * taille }).y;
    if (yTop === undefined || yBot === undefined || !Number.isFinite(yTop) || !Number.isFinite(yBot)) {
      return;
    }
    const y0 = Math.round(Math.min(yTop, yBot));
    const y1 = Math.round(Math.max(yTop, yBot));

    const rgb = parseCssColor(lireTokenCanvas("--accent", "")) ?? ACCENT_RGB_FALLBACK;
    const alpha = 0.28 * (restant / FLASH_DUREE_MS);
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(main.left, main.top, main.width, main.height);
    ctx.clip();
    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`;
    ctx.fillRect(main.left, y0, main.width, Math.max(1, y1 - y0));
    ctx.restore();
  }

  /**
   * Tooltip de survol : détail de la cellule sous le curseur — heure de la bougie, plage de
   * prix du bucket, total USD + nombre d'événements, split longs/shorts avec mini-barres
   * proportionnelles. Hit-test O(1) via `cellSousCurseur` sur la dernière grille (aucun
   * recalcul au mousemove). Décalé pour rester dans le pane (repli à gauche près du bord
   * droit, au-dessus près du bas). Ne dessine rien hors du pane prix ou sans cellule survolée.
   */
  private dessinerTooltip(cell: LiqCell, grid: LiqGrid, main: Bounding, tokens: Tokens): void {
    const total = cell.longUsd + cell.shortUsd;
    const prixBas = cell.bucketIdx * grid.taille;
    const prixHaut = (cell.bucketIdx + 1) * grid.taille;
    // Mini-barre 10 crans, remplissage ∝ part du total.
    const barre = (part: number): string => {
      const n = total > 0 ? Math.round((part / total) * 10) : 0;
      const plein = n < 0 ? 0 : n > 10 ? 10 : n;
      return "▮".repeat(plein) + "▯".repeat(10 - plein);
    };
    const nb = `${cell.count} événement${cell.count > 1 ? "s" : ""}`;
    const txt = tokens.text;
    this.dessinerBoiteTooltip(
      [
        {
          texte: `Liquidations ${formatHeureMinute(cell.candleTime)} · ${formatPrice(prixBas)}–${formatPrice(prixHaut)}`,
          couleur: txt,
        },
        { texte: `Total   ${formatUsd(total)}  (${nb})`, couleur: txt },
        // Longs liquidés = ventes forcées → teinte `--down` ; shorts → `--up` (cf. profil latéral).
        { texte: `Longs   ${formatUsd(cell.longUsd)}  ${barre(cell.longUsd)}`, couleur: tokens.down },
        { texte: `Shorts  ${formatUsd(cell.shortUsd)}  ${barre(cell.shortUsd)}`, couleur: tokens.up },
      ],
      main,
      tokens,
    );
  }

  /**
   * Tooltip de la heatmap HL (instantanés) : une pilule d'UNE ligne — « HL niveaux
   * réels · <prix du bucket> · longs $X (n) · shorts $Y (n) · instantané HH:MM » —
   * distincte du tooltip des liquidations exécutées (cellule = niveaux mesurés, pas un
   * flux). `cell.dernierTime` porte le ts de l'instantané retenu (cf. construireGrilleHl).
   */
  private dessinerTooltipHl(cell: LiqCell, grid: LiqGrid, main: Bounding, tokens: Tokens): void {
    const prix = (cell.bucketIdx + 0.5) * grid.taille;
    const tsTxt = cell.dernierTime === undefined ? "—" : formatHeureMinute(cell.dernierTime);
    this.dessinerBoiteTooltip(
      [
        {
          texte: `HL niveaux réels · ${formatPrice(prix)} · longs ${formatUsd(cell.longUsd)} (${cell.nLong ?? 0}) · shorts ${formatUsd(cell.shortUsd)} (${cell.nShort ?? 0}) · instantané ${tsTxt}`,
          couleur: tokens.text,
        },
      ],
      main,
      tokens,
    );
  }

  /**
   * Boîte de tooltip commune (fond `--surface`, bord `--border`, texte 11 px mono) :
   * affiche les `lignes` près du crosshair, repliée pour rester dans le pane prix.
   * Factorise le dessin entre le tooltip des liquidations exécutées et celui de la
   * heatmap HL. Ne dessine rien sans crosshair dans le pane.
   */
  private dessinerBoiteTooltip(
    lignes: Array<{ texte: string; couleur: string }>,
    main: Bounding,
    tokens: Tokens,
  ): void {
    const cross = this.dernierCrosshair;
    if (cross === null) return;
    const cx = cross.x;
    const cy = cross.y;
    if (cx === undefined || cy === undefined) return;

    const ctx = this.ctx;
    ctx.font = "11px ui-monospace, SFMono-Regular, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const pad = 8;
    const lh = 15;
    let maxW = 0;
    for (const l of lignes) maxW = Math.max(maxW, ctx.measureText(l.texte).width);
    const boxW = maxW + pad * 2;
    const boxH = lignes.length * lh + pad * 2;

    // Position : à droite/en dessous du curseur, repliée pour ne pas déborder du pane.
    const { left, top, width, height } = main;
    const gap = 14;
    let bx = cx + gap;
    let by = cy + gap;
    if (bx + boxW > left + width) bx = cx - gap - boxW;
    if (by + boxH > top + height) by = cy - gap - boxH;
    bx = Math.max(left + 2, Math.min(bx, left + width - boxW - 2));
    by = Math.max(top + 2, Math.min(by, top + height - boxH - 2));

    // Boîte aux tokens du thème (comme le reste de l'UI) : fond `--surface`, bord `--border`.
    ctx.globalAlpha = 0.96;
    ctx.fillStyle = tokens.surface;
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 5);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = tokens.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    for (let i = 0; i < lignes.length; i++) {
      const l = lignes[i];
      if (l === undefined) continue;
      ctx.fillStyle = l.couleur;
      ctx.fillText(l.texte, bx + pad, by + pad + i * lh);
    }
  }

  /**
   * Couche NIVEAUX ESTIMÉS (LIQEST) — lignes horizontales pointillées (teinte EST par thème,
   * cf. `teinteEstPourTheme`) calculées par le modèle de levier appliqué à l'OI
   * (calculerNiveauxEstimes). REGROUPÉES par bucket de prix
   * (somme des poids) pour éviter des centaines de lignes ; alpha ∝ log du poids ; les
   * `NB_LABELS_EST` buckets les plus lourds portent l'étiquette « EST. ×<levier dominant> ».
   *
   * ⚠️ APPROXIMATION (garde-fou BUILD-CONTRACT) : la légende « Niveaux ESTIMÉS … » et le préfixe
   * « EST. » signalent explicitement qu'il ne s'agit PAS des liquidations réelles.
   */
  private dessinerNiveauxEstimes(main: Bounding, tokens: Tokens): void {
    const ctx = this.ctx;
    const { left, top, width, height } = main;
    const xRight = left + width;
    const est = (a: number): string => `rgba(${tokens.estRgb.join(",")},${a.toFixed(3)})`;

    const candles = marketStore.getState().candles;
    const dernier = candles[candles.length - 1];
    if (dernier === undefined) return;
    // Recalcul MÉMOÏSÉ (calcul O(pointsOI × bougies)) : seulement si obsolète (données/viewport/
    // OI/symbole via `markDirty`) — au survol `onCrosshair` marque `dirty` sans marquer
    // `niveauxObsoletes`, donc on réutilise le dernier résultat au lieu de tout recalculer.
    if (this.niveauxObsoletes) {
      // Leviers cochés par l'utilisateur (sous-ensemble de LEVIERS) — cf. liqEstStore. Le
      // recalcul est réinvalidé par l'abonnement permanent à liqEstStore (unsubLiqEst → markDirty),
      // donc décocher/cocher un levier recalcule bien les niveaux. On mémoïse en un seul calcul
      // les niveaux ACTIFS et les niveaux CONSOMMÉS (trace grisée éphémère).
      const detail = calculerNiveauxEstimesDetail(
        oiHistStore.getState().hist,
        candles,
        liqEstStore.getState().leviers,
      );
      this.derniersNiveaux = detail.actifs;
      this.derniersConsommes = detail.consommes;
      this.niveauxObsoletes = false;
    }
    const niveaux = this.derniersNiveaux ?? [];

    // Taille de bucket (granularité utilisateur) partagée par la trace consommée ET les niveaux
    // actifs — même bucketing que la heatmap réelle (choix de RENDU, indépendant du calcul).
    const taille = tailleBucket(dernier.close) * liqMarksStore.getState().granularite;

    // Trace grisée ÉPHÉMÈRE des consommés récents, dessinée SOUS les niveaux actifs (fond discret).
    if (taille > 0) this.dessinerTraceConsommes(this.derniersConsommes ?? [], candles, taille, main, tokens);

    // Couche active mais aucun niveau : la RAISON (OI indisponible vs tous consommés) est
    // désormais portée par la légende bas-droite (`libelleLegendeEst`, cf. dessinerLegendes) —
    // l'indice haut-droite qui la répétait mot pour mot a été retiré pour ne pas afficher deux
    // formulations concurrentes du même état.
    if (niveaux.length === 0) return;

    if (!(taille > 0)) return;
    // Regroupement par bucket de prix : somme des poids + levier dominant du bucket (la taille de
    // bucket, calculée plus haut, suit la GRANULARITÉ utilisateur comme la heatmap réelle — un
    // choix de RENDU ; les niveaux mémoïsés, eux, ne dépendent pas de la taille de bucket).
    const parBucket = new Map<number, { poids: number; parLevier: Map<number, number> }>();
    for (const n of niveaux) {
      if (!(n.price > 0) || !Number.isFinite(n.poidsUsd)) continue;
      const idx = bucketIndex(n.price, taille);
      let b = parBucket.get(idx);
      if (b === undefined) {
        b = { poids: 0, parLevier: new Map() };
        parBucket.set(idx, b);
      }
      b.poids += n.poidsUsd;
      b.parLevier.set(n.levier, (b.parLevier.get(n.levier) ?? 0) + n.poidsUsd);
    }
    // Densité : ne garder que les buckets ≥ EST_SEUIL_FRAC du max, plafonnés aux EST_MAX_NIVEAUX
    // plus lourds (évite des centaines de lignes quasi nulles). `filtrerNiveauxDenses` est pure et testée.
    const denses = filtrerNiveauxDenses(
      [...parBucket.entries()].map(([idx, b]) => ({ idx, poids: b.poids, parLevier: b.parLevier })),
      EST_SEUIL_FRAC,
      EST_MAX_NIVEAUX,
    );
    if (denses.length === 0) return;
    let maxPoids = 0;
    for (const b of denses) if (b.poids > maxPoids) maxPoids = b.poids;
    if (maxPoids <= 0) return;

    // Lignes pointillées (teinte EST du thème), une par bucket dense (alpha ∝ intensité log du poids). Clip au pane.
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    for (const b of denses) {
      const y = this.toPx({ value: (b.idx + 0.5) * taille }).y;
      if (y === undefined || !Number.isFinite(y)) continue;
      const t = intensiteLog(b.poids, maxPoids);
      ctx.strokeStyle = est(0.2 + 0.6 * t);
      ctx.beginPath();
      ctx.moveTo(left, Math.round(y) + 0.5);
      ctx.lineTo(xRight, Math.round(y) + 0.5);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // Étiquettes « EST. ×L » : top NB_LABELS_EST buckets, dé-chevauchés (15 px, le plus gros
    // gagne, `dechevaucher` pure et testée), exclus sous la toolbar DOM (y < top+24). Pilule
    // fond `--surface` / bord teinte EST (identité distincte de la rampe réelle).
    const candidatsLabel = denses.slice(0, NB_LABELS_EST).flatMap((b) => {
      const y = this.toPx({ value: (b.idx + 0.5) * taille }).y;
      if (y === undefined || !Number.isFinite(y)) return [];
      let levierDominant = 0;
      let poidsDominant = -1;
      for (const [L, p] of b.parLevier) {
        if (p > poidsDominant) {
          poidsDominant = p;
          levierDominant = L;
        }
      }
      return [{ y, poids: b.poids, levierDominant }];
    });
    ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const item of dechevaucher(candidatsLabel, 15)) {
      if (item.y < top + 24 || item.y > top + height) continue;
      const label = `EST. ×${item.levierDominant}`;
      const w = ctx.measureText(label).width;
      ctx.fillStyle = tokens.surface;
      ctx.globalAlpha = 0.96;
      ctx.fillRect(left + 3, item.y - 7, w + 6, 14);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = est(0.9);
      ctx.lineWidth = 1;
      ctx.strokeRect(left + 3, item.y - 7, w + 6, 14);
      ctx.fillStyle = est(0.98);
      ctx.fillText(label, left + 6, item.y);
    }
  }

  /**
   * Trace grisée ÉPHÉMÈRE des niveaux estimés CONSOMMÉS (traversés par le prix) : lignes
   * pointillées `tokens.textDim` dessinées SOUS les niveaux actifs, SANS étiquette. Plafonnée aux
   * 15 consommés LES PLUS RÉCENTS, regroupés par bucket de prix comme les actifs (une ligne par
   * bucket, l'horodatage retenu étant le `tsConsommation` le plus RÉCENT du bucket). Alpha
   * décroissant `0.35 × max(0, 1 − age/10)` où `age` = nombre de bougies visibles entre
   * `tsConsommation` et la dernière bougie (≈ `(dernierTime − tsConsommation) / dureeBougie`,
   * `dureeBougie` = écart moyen entre bougies visibles) → la trace s'efface au bout de ~10 bougies.
   */
  private dessinerTraceConsommes(
    consommes: NiveauConsomme[],
    candles: Candle[],
    taille: number,
    main: Bounding,
    tokens: Tokens,
  ): void {
    if (consommes.length === 0) return;
    const ctx = this.ctx;
    const { left, top, width, height } = main;
    const xRight = left + width;

    const dernier = candles[candles.length - 1];
    if (dernier === undefined) return;

    // Durée d'une bougie ≈ écart moyen entre bougies VISIBLES : (time[to−1] − time[from]) / (to − from − 1).
    const range = this.chart.getVisibleRange();
    const from = Math.max(0, range.from);
    const to = Math.min(candles.length, range.to);
    const premierVis = candles[from];
    const dernierVis = candles[to - 1];
    if (premierVis === undefined || dernierVis === undefined || to - from < 2) return;
    const dureeBougie = (dernierVis.time - premierVis.time) / (to - from - 1);
    if (!(dureeBougie > 0)) return;

    // 15 consommés les plus récents (tsConsommation décroissant), puis regroupés par bucket : une
    // ligne par bucket, on retient le tsConsommation le PLUS RÉCENT du bucket (pilote l'alpha).
    const parBucket = new Map<number, number>(); // idx bucket → tsConsommation le plus récent
    for (const c of [...consommes].sort((a, b) => b.tsConsommation - a.tsConsommation).slice(0, 15)) {
      if (!(c.price > 0)) continue;
      const idx = bucketIndex(c.price, taille);
      const prev = parBucket.get(idx);
      if (prev === undefined || c.tsConsommation > prev) parBucket.set(idx, c.tsConsommation);
    }
    if (parBucket.size === 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = tokens.textDim;
    for (const [idx, ts] of parBucket) {
      const age = (dernier.time - ts) / dureeBougie;
      const alpha = 0.35 * Math.max(0, 1 - age / 10);
      if (!(alpha > 0)) continue; // au-delà de ~10 bougies, la trace est effacée
      const y = this.toPx({ value: (idx + 0.5) * taille }).y;
      if (y === undefined || !Number.isFinite(y)) continue;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(left, Math.round(y) + 0.5);
      ctx.lineTo(xRight, Math.round(y) + 0.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.restore();
  }

  /**
   * Bloc de légendes en BAS-DROITE du pane (au-dessus de l'axe temps), empilé vers le haut :
   *  (a) barre d'échelle de couleur gradient (mêmes 24 crans que les cellules) « 0 … maxUsd » +
   *      caption « Liq heatmap (exécutées) · log » — quand la heatmap est active et peuplée ;
   *  (b) mini-légende du profil « ▮ shorts ▮ longs » (carrés teintes `--up`/`--down`) — idem ;
   *  (c) légende « Niveaux ESTIMÉS (modèle levier — approximation) » — dès que la couche EST est
   *      active (garde-fou BUILD-CONTRACT NON contournable) ;
   *  (d) mini-CLLD : cumuls de liquidations « ↑ » (au-dessus du spot) / « ↓ » (en-dessous),
   *      réel (tokens.text) et « EST. » (teinte EST du thème) séparés — au SOMMET de la pile.
   * Emplacement jamais occupé par les boutons de layout ni la légende du Volume Profile.
   *
   * Renvoie le SOMMET de la pile (ligne de base de la prochaine ligne libre, y absolu) : le
   * repère de bord BAS des niveaux HL hors écran s'y pose au-dessus (hauteur de pile variable).
   */
  private dessinerLegendes(
    main: Bounding,
    tokens: Tokens,
    heatActif: boolean,
    estActif: boolean,
    hlActif: boolean,
    raisonHl: string | null,
  ): number {
    const ctx = this.ctx;
    const { left, top, width, height } = main;
    const xRight = left + width;
    const grid = heatActif ? this.derniereGrille : null;
    let yb = top + height - 4; // bord bas du bloc, juste au-dessus de l'axe temps
    ctx.font = "11px ui-monospace, SFMono-Regular, monospace";

    // Fond translucide `--surface` sous chaque ligne de la pile : elle est peinte PAR-DESSUS les
    // heatmaps (cellules ambre HL, rampe des exécutées) et le texte nu s'y noyait — constaté le
    // 25/09/2026 avec LIQHL actif, la ligne des cumuls ↑/↓ devenait illisible. `xGauche`/`largeur`
    // = emprise horizontale du texte de la ligne dont `yb` est le bas.
    const fond = (xGauche: number, largeur: number): void => {
      const style = ctx.fillStyle;
      ctx.fillStyle = tokens.surface;
      ctx.globalAlpha = FOND_LEGENDE_ALPHA;
      ctx.fillRect(xGauche - 2, yb - H_LIGNE_LEGENDE, largeur + 4, H_LIGNE_LEGENDE + 1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = style;
    };
    // Ligne alignée à droite (bord `xRight − 4`, ligne de base basse `yb`) posée sur son fond.
    const ecrireADroite = (texte: string, couleur: string): void => {
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      const w = ctx.measureText(texte).width;
      fond(xRight - 4 - w, w);
      ctx.fillStyle = couleur;
      ctx.fillText(texte, xRight - 4, yb);
    };

    // (a) + (b) : uniquement quand la heatmap est active ET a produit une grille (des liquidations).
    if (grid !== null) {
      // (a) barre d'échelle gradient 84×8 px (mêmes 24 crans que les cellules). Mode intensité :
      // rampe viridis, « 0 » à gauche, formatUsd(maxUsd) à droite. Mode dominance : gradient
      // DIVERGENT down → (mélange pâle au centre) → up — mêmes teintes/alphas que les cellules
      // (0.35 + 0.65×|deseq|) —, extrémités étiquetées « longs » / « shorts ».
      const dominance = liqMarksStore.getState().mode === "dominance";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.font = "11px ui-monospace, SFMono-Regular, monospace";
      const maxTxt = dominance ? "shorts" : formatUsd(grid.maxUsd);
      const wMax = ctx.measureText(maxTxt).width;
      const barW = 84;
      const barH = 8;
      const barRight = xRight - 4 - wMax - 4;
      const barLeft = barRight - barW;
      const barTop = yb - barH;
      const gaucheLigne = barLeft - 4 - ctx.measureText(dominance ? "longs" : "0").width;
      fond(gaucheLigne, xRight - 4 - gaucheLigne);
      for (let i = 0; i < 24; i++) {
        if (dominance) {
          const d = (2 * i) / 23 - 1; // cran → deseq ∈ [-1, +1] (longs → shorts)
          const [r, g, b] = d >= 0 ? tokens.upRgb : tokens.downRgb;
          ctx.fillStyle = `rgba(${r},${g},${b},${(0.35 + 0.65 * Math.abs(d)).toFixed(3)})`;
        } else {
          const [r, g, b] = couleurRampeArrets(i / 23, tokens.rampe);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
        }
        ctx.fillRect(barLeft + (barW * i) / 24, barTop, barW / 24 + 1, barH); // +1 : pas de couture
      }
      ctx.fillStyle = tokens.textDim;
      ctx.fillText(maxTxt, xRight - 4, yb); // borne haute (maxUsd / « shorts ») à droite de la barre
      ctx.fillText(dominance ? "longs" : "0", barLeft - 4, yb); // borne basse à gauche de la barre
      yb -= 13;
      // caption — « Coinalyze ≈ sur N j » annonce la part du buffer issue du repli
      // historique approximé (jours sans événement réel, cf. joursSansEvenements).
      const joursApprox = joursApproxDansEvenements(liqEventsStore.getState().events);
      const suffixeApprox = joursApprox > 0 ? ` · Coinalyze ≈ sur ${joursApprox} j` : "";
      ecrireADroite(`Liq heatmap (exécutées) · ${dominance ? "dominance" : "log"}${suffixeApprox}`, tokens.textDim);
      yb -= 14;

      // (b) mini-légende profil « ▮ shorts ▮ longs » (shorts = --up, longs = --down).
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const sq = 7;
      const gap = 3;
      const gap2 = 8;
      const wSh = ctx.measureText("shorts").width;
      const wLo = ctx.measureText("longs").width;
      const totalW = sq + gap + wSh + gap2 + sq + gap + wLo;
      let x = xRight - 4 - totalW;
      const ymid = yb - 6;
      fond(x, totalW);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = tokens.up;
      ctx.fillRect(x, ymid - sq / 2, sq, sq);
      ctx.globalAlpha = 1;
      x += sq + gap;
      ctx.fillStyle = tokens.textDim;
      ctx.fillText("shorts", x, ymid);
      x += wSh + gap2;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = tokens.down;
      ctx.fillRect(x, ymid - sq / 2, sq, sq);
      ctx.globalAlpha = 1;
      x += sq + gap;
      ctx.fillStyle = tokens.textDim;
      ctx.fillText("longs", x, ymid);
      yb -= 14;

      // (b bis) mini-légende des bulles de clusters — quand la couche est active.
      if (liqMarksStore.getState().bulles) {
        ecrireADroite("● bulles = clusters ≥ P70 · rayon ∝ √USD", tokens.textDim);
        yb -= 14;
      }
    }

    // (c) légende EST — dessinée dès que la couche est active (étiquetage non contournable),
    // AVEC la raison quand la couche est vide (cf. libelleLegendeEst) : ON-mais-vide ne doit
    // jamais être indistinguable de OFF.
    if (estActif) {
      ecrireADroite(
        libelleLegendeEst(
          marketStore.getState().symbol,
          oiHistStore.getState().hist.length > 0,
          (this.derniersNiveaux ?? []).length,
        ),
        `rgba(${tokens.estRgb.join(",")},0.95)`,
      );
      yb -= 14;
    }

    // (c bis) légende LIQ HL RÉELS — dessinée dès que la couche est active, AVANT (d) : ce
    // dernier peut sortir tôt (aucune bougie visible), ce qui escamoterait la légende.
    // Cumuls ↑/↓ sur TOUS les niveaux valides de l'échantillon autour du prix LIVE (close de la
    // dernière bougie CHARGÉE, même référence que les barres) — calculés ici, indépendamment de
    // `dessinerNiveauxHl`.
    // ⚠️ « N adresses » = TOP du leaderboard Hyperliquid, PAS tout le carnet (cf. libelleLegendeHl).
    // Paire cotée hors USD (`raisonHl`) : une seule ligne qui dit pourquoi la couche est muette
    // — ni cumuls (niveaux USD contre un prix en BTC/JPY…), ni légende de heatmap HL.
    if (hlActif) {
      const hl = hlLiqStore.getState();
      const candlesHl = marketStore.getState().candles;
      const prixLive = candlesHl[candlesHl.length - 1]?.close;
      const cumuls = raisonHl !== null || prixLive === undefined ? null : cumulsHl(hl.niveaux, prixLive);
      ecrireADroite(
        libelleLegendeHl(hl.etat, hl.adressesScannees, hl.niveaux.length, cumuls, raisonHl),
        tokens.textDim,
      );
      yb -= 14;
    }
    if (hlActif && raisonHl === null) {
      // (c ter) légende HL HEATMAP (instantanés historiques) : nb d'instantanés, adresses
      // scannées, couverture MESURÉE de l'OI et trous de collecte (« daemon éteint ») —
      // l'échantillonnage du leaderboard n'est jamais présenté comme exhaustif.
      const heat = hlHeatStore.getState();
      const candlesLeg = marketStore.getState().candles;
      const rangeLeg = this.chart.getVisibleRange();
      const fromLeg = Math.max(0, rangeLeg.from);
      const toLeg = Math.min(candlesLeg.length, rangeLeg.to);
      const premierLeg = candlesLeg[fromLeg];
      const derniereLeg = candlesLeg[toLeg - 1];
      const pasLeg =
        toLeg - fromLeg >= 1 ? Math.max(PERIODE_SNAP_HL_MS, pasBougieMs(candlesLeg, fromLeg, toLeg)) : PERIODE_SNAP_HL_MS;
      const dernierSnap = heat.instantanes[heat.instantanes.length - 1];
      const trous =
        premierLeg !== undefined && derniereLeg !== undefined
          ? compterTrous(
              heat.instantanes,
              premierLeg.time,
              derniereLeg.time + pasLeg,
              pasLeg,
              heat.collecte?.premierTs ?? null,
            )
          : 0;
      const ambre = couleurRampeArrets(0.65, tokens.rampeHl);
      ecrireADroite(
        libelleLegendeHlHeat(
          heat.etat,
          heat.instantanes.length,
          dernierSnap?.adresses ?? 0,
          dernierSnap?.couverture ?? null,
          pasLeg,
          trous,
          heat.collecte?.actif ?? false,
          heat.collecte?.premierTs ?? null,
        ),
        `rgba(${ambre[0]},${ambre[1]},${ambre[2]},0.95)`,
      );
      yb -= 14;
    }

    // (d) mini-CLLD : cumuls au-dessus/en-dessous du SPOT (close de la dernière bougie
    // visible — même source que la taille de bucket de la grille), scope = plage visible.
    // Partie réelle depuis le profil de la grille en cache (recalcul O(buckets) par frame
    // dirty), partie « EST. » depuis les niveaux estimés mémoïsés — chacune affichée
    // SEULEMENT si sa couche est active/peuplée. Ligne ↓ tracée d'abord (empilement vers le
    // haut) : la ligne ↑ finit au sommet de la pile, comme au-dessus/en-dessous à l'écran.
    const niveaux = estActif ? this.derniersNiveaux ?? [] : [];
    if (grid !== null || niveaux.length > 0) {
      const candles = marketStore.getState().candles;
      const range = this.chart.getVisibleRange();
      const derniereVisible = candles[Math.min(candles.length, range.to) - 1];
      if (derniereVisible === undefined) return yb;
      const cumuls = cumulsAutourSpot(
        grid !== null ? profilParPrix(grid) : new Map(),
        grid?.taille ?? 0,
        niveaux,
        derniereVisible.close,
      );
      ctx.font = "11px ui-monospace, SFMono-Regular, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      const ligne = (prefixe: string, reel: number | null, est: number | null): void => {
        // La ligne n'apparaît que si au moins un des montants AFFICHÉS est > 0.
        if (!((reel ?? 0) > 0 || (est ?? 0) > 0)) return;
        let gauche = reel !== null ? `${prefixe} ${formatUsd(reel)}` : prefixe;
        if (est !== null) gauche += reel !== null ? " · " : " ";
        const droite = est !== null ? `EST. ${formatUsd(est)}` : "";
        const wGauche = ctx.measureText(gauche).width;
        const wDroite = ctx.measureText(droite).width;
        const x = xRight - 4 - wGauche - wDroite;
        fond(x, wGauche + wDroite);
        ctx.fillStyle = tokens.text;
        ctx.fillText(gauche, x, yb);
        if (droite !== "") {
          ctx.fillStyle = `rgba(${tokens.estRgb.join(",")},0.95)`;
          ctx.fillText(droite, x + wGauche, yb);
        }
        yb -= 14;
      };
      const reelAffiche = grid !== null;
      ligne("↓", reelAffiche ? cumuls.reelEnDessous : null, estActif ? cumuls.estEnDessous : null);
      ligne("↑", reelAffiche ? cumuls.reelAuDessus : null, estActif ? cumuls.estAuDessus : null);
    }
    return yb;
  }
}

