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
import type { Commande } from "../commands/registry";
import { marketStore } from "../store/market";
import { themeStore } from "../store/theme";
import { volumeProfileStore } from "../store/volumeProfile";
import { formatHeureMinute, formatPrice, formatUsd } from "../lib/format";
import { lireTokenCanvas } from "../lib/canvasTokens";

/** Cellule agrégée : une bougie × un bucket de prix. */
export interface LiqCell {
  candleTime: number;
  bucketIdx: number;
  longUsd: number;
  shortUsd: number;
  count: number;
  /** Temps du dernier événement agrégé dans la cellule (max des `time`) — pilote le fade-in
   *  des cellules fraîches au RENDER (cf. `alphaFadeIn`) ; absent si la cellule est vide. */
  dernierTime?: number;
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
 * de prix, pas tout l'axe). Renvoie `null` si la plage est vide ou la grille sans cellule.
 * PURE.
 */
export function dimensionsGrilleVisible(
  grid: LiqGrid,
  from: number,
  to: number,
): { colonnes: number; bucketMin: number; bucketMax: number } | null {
  const colonnes = to - from;
  if (colonnes < 1 || grid.cells.size === 0) return null;
  let bucketMin = Infinity;
  let bucketMax = -Infinity;
  for (const cell of grid.cells.values()) {
    if (cell.bucketIdx < bucketMin) bucketMin = cell.bucketIdx;
    if (cell.bucketIdx > bucketMax) bucketMax = cell.bucketIdx;
  }
  return { colonnes, bucketMin, bucketMax };
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

/**
 * Parse une couleur CSS concrète (`#rgb`, `#rrggbb` ou `rgb()/rgba()`) en tuple RVB, ou
 * `null` si la chaîne n'est pas reconnue. Le canvas ne reçoit que des tokens déjà résolus
 * (jamais de `var()` ni d'`oklch()`), donc ces deux formes suffisent. Sert à `estFondClair`
 * et aux teintes up/down du mode « dominance » (parsées UNE fois par frame). PURE.
 */
export function parseCssColor(css: string): [number, number, number] | null {
  const s = css.trim();
  if (s.startsWith("#")) {
    const h = s.slice(1);
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) return null;
    const int = Number.parseInt(full, 16);
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  const inner = m?.[1];
  if (inner === undefined) return null;
  const parts = inner.split(",").map((p) => Number.parseFloat(p.trim()));
  const [r, g, b] = parts;
  if (r === undefined || g === undefined || b === undefined) return null;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return [r, g, b];
}

/**
 * Vrai si `bgCss` (couleur de fond du thème, `#hex` ou `rgb()`) est un fond CLAIR :
 * luminance relative (coefficients Rec.709 0.2126/0.7152/0.0722, normalisée) > 0.5. Une
 * chaîne non reconnue renvoie `false` (fond sombre par défaut — le cas majoritaire des
 * thèmes). Sert à inverser la rampe de couleur sur thème clair (cf. `couleurRampe`). PURE.
 */
export function estFondClair(bgCss: string): boolean {
  const rgb = parseCssColor(bgCss);
  if (rgb === null) return false;
  const [r, g, b] = rgb;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
}

/**
 * Rampe de couleur theme-aware pour une intensité `t ∈ [0,1]`. Sur fond SOMBRE : viridis
 * direct (jaune = max, calibré fond noir). Sur fond CLAIR : viridis INVERSÉ `couleurViridis(1−t)`
 * → le violet foncé devient le maximum (contraste rétabli, le jaune pâle illisible sur fond
 * clair passe au minimum). La barre d'échelle et les cellules utilisent la MÊME rampe. PURE.
 */
export function couleurRampe(t: number, fondClair: boolean): [number, number, number] {
  return couleurViridis(fondClair ? 1 - t : t);
}

/** Rampe ambre du thème Bloomberg (brun sombre → ambre saturé — identité « terminal »). L'arrêt 0
 *  reste sombre mais DISTINCT du fond noir pur (à alpha 0.15, [12,10,6] disparaissait). */
const RAMPE_BLOOMBERG: ReadonlyArray<readonly [number, number, number]> = [
  [36, 28, 14],
  [80, 50, 10],
  [160, 110, 10],
  [230, 170, 0],
  [255, 196, 0],
];
/** Rampe vert néon du thème Matrix (vert sombre → vert phosphore). L'arrêt 0 reste sombre mais
 *  DISTINCT du fond noir pur (à alpha 0.15, [4,12,6] disparaissait). */
const RAMPE_MATRIX: ReadonlyArray<readonly [number, number, number]> = [
  [14, 36, 20],
  [16, 60, 32],
  [34, 120, 60],
  [60, 190, 100],
  [91, 255, 143],
];
/** Viridis INVERSÉ (arrêts renversés) : le violet foncé devient le maximum — thèmes à fond clair. */
const VIRIDIS_INVERSE: ReadonlyArray<readonly [number, number, number]> = [...VIRIDIS].reverse();

/**
 * Arrêts RVB (5 crans comme VIRIDIS) de la rampe de couleur ESTHÉTIQUE du thème actif — c'est
 * un choix par thème, PAS un réglage utilisateur : `bloomberg` → noir→ambre, `matrix` →
 * noir→vert néon, `dark`/`aurora` → viridis direct, `cute` (et tout thème à FOND CLAIR) →
 * viridis inversé (contraste rétabli). Thème inconnu → repli sur la logique fond : inversé si
 * `fondClair`, viridis direct sinon. Lue 1×/frame par le contrôleur ; interpolée par
 * `couleurRampeArrets`. PURE.
 */
export function rampePourTheme(
  theme: string,
  fondClair: boolean,
): ReadonlyArray<readonly [number, number, number]> {
  if (theme === "bloomberg") return RAMPE_BLOOMBERG;
  if (theme === "matrix") return RAMPE_MATRIX;
  if (theme === "dark" || theme === "aurora") return VIRIDIS;
  // cute et tout thème à fond clair : viridis inversé (comportement historique de couleurRampe).
  if (theme === "cute" || fondClair) return VIRIDIS_INVERSE;
  // Thème sombre inconnu : repli viridis direct.
  return VIRIDIS;
}

/**
 * Interpolation linéaire générique d'une rampe de couleur (mêmes maths que `couleurViridis`,
 * mais sur des arrêts quelconques) : `t ∈ [0,1]` clampé, `arrets.length ≥ 2`. Sert à peindre
 * cellules, canvas lissé ET barre d'échelle avec LA MÊME rampe du thème actif. PURE.
 */
export function couleurRampeArrets(
  t: number,
  arrets: ReadonlyArray<readonly [number, number, number]>,
): [number, number, number] {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const seg = c * (arrets.length - 1);
  const i = Math.min(Math.floor(seg), arrets.length - 2);
  const f = seg - i;
  const a = arrets[i] as readonly [number, number, number];
  const b = arrets[i + 1] as readonly [number, number, number];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** Durée (ms) du fade-in d'une cellule fraîche : flash plein puis retour à l'alpha nominal. */
const DUREE_FADE_MS = 400;
/** Fenêtre (ms) de tolérance latence WS + skew NTP : une cellule reste « fraîche » si l'horodatage
 *  EXCHANGE de son dernier événement tombe dans ces dernières secondes avant le bump local. */
const FENETRE_FRAICHEUR_MS = 5000;

/**
 * Boost d'alpha du FADE-IN d'une cellule fraîche (live). Deux horloges sont dissociées pour que la
 * latence WS / le skew NTP ne tronquent plus le flash :
 *  • SÉLECTION (horloge EXCHANGE, tolérante) : la cellule flashe si `dernierTime` (dernier événement
 *    de la cellule) est POSTÉRIEUR à `tsDemarrage` (démarrage du contrôleur — exclut le seed initial)
 *    ET tombe dans la fenêtre `FENETRE_FRAICHEUR_MS` avant `bumpTs` (l'événement peut être en retard
 *    de plusieurs secondes sans perdre son flash) ;
 *  • ANIMATION (horloge LOCALE) : le fondu suit `age = now − bumpTs` (instant local du dernier rev
 *    bump), donc insensible à la latence — `alpha = nominal + (1 − nominal) × (1 − age/DUREE_FADE_MS)`
 *    (pleine à age 0, retombe au nominal à DUREE_FADE_MS). Sinon renvoie l'alpha nominal. PURE.
 */
export function alphaFadeIn(
  alphaNominal: number,
  dernierTime: number | undefined,
  tsDemarrage: number,
  bumpTs: number,
  now: number,
): number {
  // Sélection tolérante à la latence (horloge exchange) : postérieur au démarrage (pas le seed) ET
  // dans la fenêtre de fraîcheur avant le bump local (tolère latence WS + skew NTP).
  if (dernierTime === undefined || dernierTime <= tsDemarrage) return alphaNominal;
  if (dernierTime <= bumpTs - FENETRE_FRAICHEUR_MS) return alphaNominal;
  // Animation indexée sur l'horloge LOCALE du bump : le fondu ignore l'âge exchange.
  const age = now - bumpTs;
  if (!(age >= 0) || age >= DUREE_FADE_MS) return alphaNominal;
  return alphaNominal + (1 - alphaNominal) * (1 - age / DUREE_FADE_MS);
}

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
}

/** Replis RVB des teintes up/down si le token du thème n'est pas parsable (#10b981 / #ef4444). */
const UP_RGB_FALLBACK: [number, number, number] = [16, 185, 129];
const DOWN_RGB_FALLBACK: [number, number, number] = [239, 68, 68];
/** Repli RVB de `--accent` (flash de bande) si le token n'est pas parsable (#38bdf8). */
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
  /** Activation demandée par la heatmap RÉELLE (bascule LIQMARK, via setEnabled). */
  private marksWanted = false;
  /** Abonnement permanent à la bascule des niveaux ESTIMÉS (LIQEST) — indépendant de LIQMARK. */
  private readonly unsubLiqEst: () => void;

  private readonly markDirty = (): void => {
    this.grilleObsolete = true;
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
  }

  /** setEnabled pilote la couche RÉELLE (LIQMARK, appelé par ChartInstance). */
  setEnabled(enabled: boolean): void {
    this.marksWanted = enabled;
    this.reconcile();
  }

  /** Le contrôleur tourne si AU MOINS une couche est active (RÉELLE ou ESTIMÉE). */
  private reconcile(): void {
    const want = this.marksWanted || liqEstStore.getState().actif;
    if (want === this.running) return;
    if (want) this.start();
    else this.stop();
  }

  dispose(): void {
    this.stop();
    this.unsubLiqEst();
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
      if (s.granularite !== prev.granularite) {
        this.grilleObsolete = true;
        this.dirty = true;
      }
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
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.animeJusqua = 0;
    this.dernierBumpTs = 0;
    this.dernierCrosshair = null;
    this.derniereGrille = null;
    this.grilleObsolete = true;
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
    };

    // Deux couches INDÉPENDANTES sur le même canvas : heatmap RÉELLE (LIQMARK) et niveaux
    // ESTIMÉS (LIQEST). Chacune est activable seule (cf. reconcile()).
    const heatActif = liqMarksStore.getState().actif;
    const estActif = liqEstStore.getState().actif;
    if (heatActif) this.dessinerHeatmap(main, tokens);
    if (estActif) this.dessinerNiveauxEstimes(main, tokens);
    // Bloc de légendes UNIFIÉ en bas-droite (barre d'échelle USD, mini-légende profil, légende
    // EST) : dessiné une fois par frame APRÈS les couches (la grille est alors en cache), empilé
    // vers le haut au-dessus de l'axe temps — supprime les collisions avec les boutons de layout
    // DOM et la légende du Volume Profile (restée en haut à droite).
    this.dessinerLegendes(main, tokens, heatActif, estActif);
  }

  /**
   * Couche HEATMAP RÉELLE : grille temps×prix (viridis log) + profil latéral long/short +
   * tooltip de survol, depuis les liquidations RÉELLEMENT exécutées (liqEventsStore).
   */
  private dessinerHeatmap(main: Bounding, tokens: Tokens): void {
    const ctx = this.ctx;
    const { left, top, width, height } = main;
    const xRight = left + width;

    const { events, enAttente } = liqEventsStore.getState();
    const candles = marketStore.getState().candles;
    const range = this.chart.getVisibleRange();
    const from = Math.max(0, range.from);
    const to = Math.min(candles.length, range.to);

    // Reconstruction de la grille SEULEMENT si obsolète (données/viewport/resize) : au survol,
    // `onCrosshair` marque `dirty` sans marquer `grilleObsolete`, donc on réutilise la dernière
    // grille rendue pour le hit-test au lieu de ré-agréger tout le buffer à chaque mousemove.
    if (this.grilleObsolete) {
      const facteur = liqMarksStore.getState().granularite;
      this.derniereGrille = to - from >= 1 ? construireGrille(events, candles, from, to, facteur) : null;
      this.grilleObsolete = false;
    }
    const grid = this.derniereGrille;

    // Buffer vide (heatmap actif mais aucune liquidation encore reçue) : indicateur « en
    // attente » discret, en haut à droite SOUS les boutons de layout DOM (top+2..22).
    if (grid === null) {
      if (enAttente) {
        ctx.fillStyle = tokens.textDim;
        ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.fillText("⋯ Heatmap liquidations active — en attente du flux live", xRight - 4, top + 22);
      }
      // Le flash de bande reste rendu même sans grille (clic feed juste après l'allumage) :
      // il matérialise le niveau de prix de la liquidation cliquée.
      this.dessinerFlash(main);
      return;
    }

    // Bords ENTIERS PARTAGÉS par colonne (x0/x1 arrondis) : deux cellules adjacentes partagent
    // exactement le même bord entier → plus de couture d'anti-aliasing (fine grille sombre).
    // La cellule est CENTRÉE sur x ; la dernière bougie réutilise la largeur de l'avant-dernière.
    // On note au passage l'index de COLONNE de chaque bougie (0..n-1 dans la plage visible) pour
    // le rendu lissé offscreen (1 colonne = 1 pixel du petit canvas).
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
    if (!lissage || !this.dessinerCellulesLissees(grid, candles, from, to, largeurs, colonneParTime, mode, tokens, now)) {
      this.dessinerCellulesRects(grid, largeurs, mode, tokens, now);
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
      // sous la toolbar). Annonce du même coup la valeur USD du bucket max (le n°1).
      this.dessinerLabelsClusters(profil, grid, maxProfil, xAncre, maxBandW, main, tokens);
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
   * Rendu CELLULE À CELLULE (bougies larges ≥ SEUIL_LISSAGE_PX) : un fillRect par cellule,
   * rampe theme-aware d'intensité log. Alpha borné [0.15, 0.55] pour ne pas masquer le prix
   * sous les cascades. Bords entiers (x0/x1 partagés par colonne ; yTop/yBot arrondis par
   * bucket → mêmes bords que le bucket voisin).
   * Mode « dominance » : la teinte remplace la rampe du thème — shorts liquidés dominants =
   * `--up` (rachats forcés), longs = `--down` (ventes forcées), même sémantique que le profil
   * latéral — et l'alpha d'intensité est modulé par |deseq| (cellule équilibrée pâle, cellule
   * très déséquilibrée franche). `now` : fade-in des cellules fraîches (cf. alphaFadeIn).
   */
  private dessinerCellulesRects(
    grid: LiqGrid,
    largeurs: Map<number, { x0: number; x1: number }>,
    mode: LiqHeatMode,
    tokens: Tokens,
    now: number,
  ): void {
    const ctx = this.ctx;
    for (const cell of grid.cells.values()) {
      const col = largeurs.get(cell.candleTime);
      if (col === undefined) continue;
      const yTop = this.toPx({ value: (cell.bucketIdx + 1) * grid.taille }).y;
      const yBot = this.toPx({ value: cell.bucketIdx * grid.taille }).y;
      if (yTop === undefined || yBot === undefined || !Number.isFinite(yTop) || !Number.isFinite(yBot)) {
        continue;
      }
      const t = intensiteLog(cell.longUsd + cell.shortUsd, grid.maxUsd);
      const y0 = Math.round(Math.min(yTop, yBot));
      const y1 = Math.round(Math.max(yTop, yBot));
      let rgb: [number, number, number];
      let alpha: number;
      if (mode === "dominance") {
        const d = desequilibre(cell.longUsd, cell.shortUsd);
        rgb = d >= 0 ? tokens.upRgb : tokens.downRgb;
        alpha = (0.15 + 0.4 * t) * (0.35 + 0.65 * Math.abs(d));
      } else {
        rgb = couleurRampeArrets(t, tokens.rampe);
        alpha = 0.15 + 0.4 * t;
      }
      alpha = alphaFadeIn(alpha, cell.dernierTime, this.tsDemarrage, this.dernierBumpTs, now);
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`;
      ctx.fillRect(col.x0, y0, Math.max(1, col.x1 - col.x0), Math.max(1, y1 - y0));
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
   * Renvoie `false` si le rendu lissé est impossible (bornes non convertibles, contexte 2D
   * indisponible…) — l'appelant se replie alors sur les rects.
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
  ): boolean {
    const dims = dimensionsGrilleVisible(grid, from, to);
    if (dims === null) return false;
    const { colonnes, bucketMin, bucketMax } = dims;
    const nbBuckets = bucketMax - bucketMin + 1;

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
      const colonne = colonneParTime.get(cell.candleTime);
      if (colonne === undefined) continue;
      const ligne = bucketMax - cell.bucketIdx; // axe Y inversé (cf. docstring)
      const t = intensiteLog(cell.longUsd + cell.shortUsd, grid.maxUsd);
      let rgb: [number, number, number];
      let alpha: number;
      if (mode === "dominance") {
        const d = desequilibre(cell.longUsd, cell.shortUsd);
        rgb = d >= 0 ? tokens.upRgb : tokens.downRgb;
        alpha = (0.15 + 0.4 * t) * (0.35 + 0.65 * Math.abs(d));
      } else {
        rgb = couleurRampeArrets(t, tokens.rampe);
        alpha = 0.15 + 0.4 * t;
      }
      alpha = alphaFadeIn(alpha, cell.dernierTime, this.tsDemarrage, this.dernierBumpTs, now);
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
    return true;
  }

  /**
   * Étiquettes des clusters les plus lourds du profil latéral : pilule « <prix arrondi au
   * bucket> · <total USD> » à gauche de la barre de chaque bucket (fond `--surface`, bord
   * `--border`, texte `--text` 9 px). On ne garde que les `NB_LABELS_CLUSTER` plus gros, on
   * les dé-chevauche verticalement (14 px, le plus gros gagne) et on exclut ceux qui passeraient
   * sous la toolbar DOM (`y < top + 24`).
   */
  private dessinerLabelsClusters(
    profil: Map<number, { longUsd: number; shortUsd: number }>,
    grid: LiqGrid,
    maxProfil: number,
    xAncre: number,
    maxBandW: number,
    main: Bounding,
    tokens: Tokens,
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
    const tops = candidats.sort((a, b) => b.poids - a.poids).slice(0, NB_LABELS_CLUSTER);
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
    const cross = this.dernierCrosshair;
    if (cross === null) return;
    const cx = cross.x;
    const cy = cross.y;
    if (cx === undefined || cy === undefined) return;

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
    const lignes: Array<{ texte: string; couleur: string }> = [
      {
        texte: `Liquidations ${formatHeureMinute(cell.candleTime)} · ${formatPrice(prixBas)}–${formatPrice(prixHaut)}`,
        couleur: txt,
      },
      { texte: `Total   ${formatUsd(total)}  (${nb})`, couleur: txt },
      // Longs liquidés = ventes forcées → teinte `--down` ; shorts → `--up` (cf. profil latéral).
      { texte: `Longs   ${formatUsd(cell.longUsd)}  ${barre(cell.longUsd)}`, couleur: tokens.down },
      { texte: `Shorts  ${formatUsd(cell.shortUsd)}  ${barre(cell.shortUsd)}`, couleur: tokens.up },
    ];

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
   * Couche NIVEAUX ESTIMÉS (LIQEST) — lignes horizontales orange pointillées calculées par le
   * modèle de levier appliqué à l'OI (calculerNiveauxEstimes). REGROUPÉES par bucket de prix
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

    if (niveaux.length === 0) {
      // Couche active mais OI pas encore chargé (ou aucune hausse d'OI) : indice discret en haut
      // à droite, sous l'éventuel indicateur « en attente » de la heatmap (top+22). La légende
      // « Niveaux ESTIMÉS … » (garde-fou EST.) reste affichée par le bloc de légendes bas-droite.
      const heatEnAttente = liqMarksStore.getState().actif && liqEventsStore.getState().enAttente;
      ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillStyle = est(0.8);
      // Deux cas distincts : OI pas encore chargé (attente réseau) vs OI chargé mais tous les
      // niveaux consommés par le prix (modèle purgé — fréquent sur TF court après un range).
      const oiCharge = oiHistStore.getState().hist.length > 0;
      const msg = oiCharge
        ? "⋯ Niveaux ESTIMÉS — aucun niveau actif (tous consommés par le prix)"
        : "⋯ Niveaux ESTIMÉS — en attente de l'Open Interest";
      ctx.fillText(msg, xRight - 4, top + (heatEnAttente ? 36 : 22));
      return;
    }

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

    // Lignes pointillées orange, une par bucket dense (alpha ∝ intensité log du poids). Clip au pane.
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
    // fond `--surface` / bord orange (identité EST distincte du viridis).
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
   *      réel (tokens.text) et « EST. » (orange) séparés — au SOMMET de la pile.
   * Emplacement jamais occupé par les boutons de layout ni la légende du Volume Profile.
   */
  private dessinerLegendes(main: Bounding, tokens: Tokens, heatActif: boolean, estActif: boolean): void {
    const ctx = this.ctx;
    const { left, top, width, height } = main;
    const xRight = left + width;
    const grid = heatActif ? this.derniereGrille : null;
    let yb = top + height - 4; // bord bas du bloc, juste au-dessus de l'axe temps

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
      // caption
      ctx.fillStyle = tokens.textDim;
      ctx.fillText(`Liq heatmap (exécutées) · ${dominance ? "dominance" : "log"}`, xRight - 4, yb);
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
    }

    // (c) légende EST — dessinée dès que la couche est active (étiquetage non contournable).
    if (estActif) {
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.font = "11px ui-monospace, SFMono-Regular, monospace";
      ctx.fillStyle = `rgba(${tokens.estRgb.join(",")},0.95)`;
      ctx.fillText("Niveaux ESTIMÉS (modèle levier — approximation)", xRight - 4, yb);
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
      if (derniereVisible === undefined) return;
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
        const x = xRight - 4 - wGauche - ctx.measureText(droite).width;
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
  }
}

// ─────────────────────────── Commande de palette ───────────────────────────

export const commandes: Commande[] = [
  {
    id: "action:liqmode",
    mnemonique: "LIQMODE",
    libelle: "Heatmap liquidations — mode intensité / dominance",
    categorie: "action",
    motsCles: ["liquidations", "heatmap", "dominance", "long", "short", "mode", "intensite", "liqmode"],
    apercu: "Bascule la coloration des cellules : intensité totale (viridis) ou dominance long/short",
    action: () => liqMarksStore.getState().basculerMode(),
  },
];
