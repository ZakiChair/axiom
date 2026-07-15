/**
 * Heatmap de LIQUIDATIONS sur le chart — profil des liquidations RÉELLEMENT exécutées
 * (flux `allLiquidation` Bybit, cf. data/liquidations.ts), agrégées par NIVEAU DE PRIX
 * et peintes en bandes horizontales pleine largeur, d'intensité viridis proportionnelle
 * au notionnel liquidé à ce niveau (façon CoinGlass, mais données réelles — pas le
 * modèle de levier propriétaire).
 *
 * MODÈLE de câblage : overlay custom `registerOverlay` + contrôleur singleton via
 * `getActiveChart()` (comme tradeMarkers) → NE touche PAS ChartInstance. Différences :
 *   1. Source LIVE : le contrôleur gère l'abonnement WS (ouvert seulement si la bascule
 *      est ON, refermé/rouvert au changement de symbole).
 *   2. Accumulation par BUCKET DE PRIX (profil cumulatif depuis la souscription), pas
 *      des marqueurs individuels.
 *   3. Rendu = bandes pleine largeur ancrées à 2 points de prix (haut/bas du bucket) →
 *      repositionnées automatiquement au pan ET au zoom, sans redraw.
 *
 * Limites assumées : liquidations EXÉCUTÉES (pas estimées), accumulées en LIVE (le
 * heatmap se construit tant que c'est activé), Bybit uniquement.
 *
 * Fonctions PURES (taille de bucket, index, colormap viridis) exportées et testées ;
 * couplage KLineChart non testé.
 */
import { registerOverlay } from "klinecharts";
import type { OverlayCreate, OverlayFigure } from "klinecharts";
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry";
import { getActiveChart } from "./drawing";
import { marketStore } from "../store/market";
import { themeStore } from "../store/theme";
import { subscribeLiquidations, type Liquidation } from "../data/liquidations";
import { fetchLiquidationHistory, type LiquidationHistPoint } from "../data/coinalyze";
import type { Candle, Unsubscribe } from "@axiom/types";

const LIQ_HEAT = "liqHeat";
const LIQ_HINT = "liqHint";
const LIQ_GROUP = "axiomLiqHeat";
const STORAGE_PREFIX = "axiom:liqheat:";
/** Borne le nombre de buckets persistés (les plus gros) — limite la taille localStorage. */
const MAX_BUCKETS_PERSIST = 600;

// ─────────────────────────── Fonctions PURES (testées) ───────────────────────────

/**
 * Taille « jolie » d'un bucket de prix (~0,1 % du prix, arrondi à 1/2/5 × 10ⁿ).
 * Ex. BTC 65 000 → 50 ; ETH 1 900 → 2 ; token 0,001 → 1e-6. PURE.
 */
export function tailleBucket(prix: number): number {
  const brut = prix * 0.001;
  if (!(brut > 0) || !Number.isFinite(brut)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(brut)));
  const norm = brut / mag;
  const nice = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return nice * mag;
}

/** Index de bucket contenant `prix` pour une `taille` donnée (bande = [idx·t, (idx+1)·t]). PURE. */
export function bucketIndex(prix: number, taille: number): number {
  return Math.floor(prix / taille);
}

/** Arrêts de la colormap viridis (violet → bleu → teal → vert → jaune). */
const VIRIDIS: ReadonlyArray<readonly [number, number, number]> = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

/** Couleur viridis pour une intensité t ∈ [0,1] → [r,g,b] (interpolation linéaire). PURE. */
export function couleurViridis(t: number): [number, number, number] {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const seg = c * (VIRIDIS.length - 1);
  const i = Math.min(Math.floor(seg), VIRIDIS.length - 2);
  const f = seg - i;
  const a = VIRIDIS[i] as readonly [number, number, number];
  const b = VIRIDIS[i + 1] as readonly [number, number, number];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

// ─────────────────────────── Persistance du profil (localStorage, par symbole) ───────────────────────────

/** Sérialise le profil (taille + `MAX_BUCKETS_PERSIST` plus gros buckets) en JSON. PURE. */
export function serialiserProfil(t: number, acc: Map<number, number>): string {
  const b = [...acc.entries()].sort((a, z) => z[1] - a[1]).slice(0, MAX_BUCKETS_PERSIST);
  return JSON.stringify({ t, b });
}

/** Désérialise un profil persisté (tolérant : null si absent/corrompu). PURE. */
export function deserialiserProfil(
  raw: string | null,
): { taille: number; buckets: Map<number, number> } | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { t?: unknown; b?: unknown };
    const t = Number(o.t);
    if (!(t > 0) || !Array.isArray(o.b)) return null;
    const buckets = new Map<number, number>();
    for (const e of o.b) {
      if (Array.isArray(e) && e.length === 2) {
        const idx = Number(e[0]);
        const usd = Number(e[1]);
        if (Number.isInteger(idx) && Number.isFinite(usd) && usd > 0) buckets.set(idx, usd);
      }
    }
    return { taille: t, buckets };
  } catch {
    return null;
  }
}

// ─────────────────────────── Amorçage historique (Coinalyze) — fonctions pures ───────────────────────────

/** Bougie CONTENANT `time` (plus grand temps de bougie ≤ time), ou undefined. PURE. */
export function candleContenant(candles: Candle[], time: number): Candle | undefined {
  const n = candles.length;
  const first = candles[0];
  if (n === 0 || first === undefined || time < first.time) return undefined;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const c = candles[mid];
    if (c !== undefined && c.time <= time) lo = mid;
    else hi = mid - 1;
  }
  return candles[lo];
}

/**
 * Construit un profil de seed par bucket de prix depuis l'historique Coinalyze : chaque
 * intervalle est mappé à la bougie qui le contient ; le volume LONG liquidé est placé au
 * BAS de la bougie (ventes forcées → mèches basses), le SHORT au HAUT (rachats forcés →
 * mèches hautes). Approximation assumée (Coinalyze donne le volume par temps, pas par
 * prix). PURE.
 */
export function construireSeed(
  history: LiquidationHistPoint[],
  candles: Candle[],
  taille: number,
): Map<number, number> {
  const seed = new Map<number, number>();
  if (taille <= 0 || candles.length === 0) return seed;
  const ajouter = (prix: number, usd: number): void => {
    if (!(usd > 0) || !Number.isFinite(prix) || prix <= 0) return;
    const idx = bucketIndex(prix, taille);
    seed.set(idx, (seed.get(idx) ?? 0) + usd);
  };
  for (const pt of history) {
    const c = candleContenant(candles, pt.time);
    if (c === undefined) continue;
    ajouter(c.low, pt.longUsd);
    ajouter(c.high, pt.shortUsd);
  }
  return seed;
}

// ─────────────────────────── Bascule (store vanilla local) ───────────────────────────

export interface LiqMarksState {
  actif: boolean;
  basculer: () => void;
}

export const liqMarksStore = createStore<LiqMarksState>((set, get) => ({
  actif: false,
  basculer: () => set({ actif: !get().actif }),
}));

// ─────────────────────────── Rendu KLineChart (non testé) ───────────────────────────

interface DonneesBande {
  couleur: string; // rgba déjà résolue
}

let overlayRegistered = false;
function ensureOverlayRegistered(): void {
  if (overlayRegistered) return;
  overlayRegistered = true;
  registerOverlay({
    name: LIQ_HEAT,
    totalStep: 2, // 2 points : (t0, prixHaut) et (t1, prixBas) du bucket
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }) => {
      const c0 = coordinates[0];
      const c1 = coordinates[1];
      if (c0 === undefined || c1 === undefined) return [];
      const d = overlay.extendData as DonneesBande | undefined;
      if (d === undefined) return [];
      const x = Math.min(c0.x, c1.x);
      const y = Math.min(c0.y, c1.y);
      const width = Math.abs(c1.x - c0.x);
      const height = Math.max(1, Math.abs(c1.y - c0.y)); // au moins 1px de haut
      const fig: OverlayFigure = {
        type: "rect",
        ignoreEvent: true,
        attrs: { x, y, width, height },
        styles: { style: "fill", color: d.couleur },
      };
      return [fig];
    },
  });
  // Indicateur « en attente » (heatmap active mais profil vide) : un texte discret.
  registerOverlay({
    name: LIQ_HINT,
    totalStep: 1,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates }) => {
      const c = coordinates[0];
      if (c === undefined) return [];
      const fig: OverlayFigure = {
        type: "text",
        ignoreEvent: true,
        attrs: {
          x: c.x - 10,
          y: c.y - 14,
          text: "⋯ Heatmap liquidations active — en attente du flux live",
          align: "right",
          baseline: "middle",
        },
        styles: { color: "rgba(130,130,150,0.95)", size: 11 },
      };
      return [fig];
    },
  });
}

// ─────────────────────────── Contrôleur singleton ───────────────────────────

const overlaysSuivis = new Map<{ removeOverlay(f: { id: string }): void }, string[]>();
/** Accumulateur notionnel par bucket de prix (profil, depuis la souscription). */
let accumulateur = new Map<number, number>();
/** Taille de bucket figée à la souscription (calculée sur le 1er prix vu). */
let taille = 0;
let abonnement: Unsubscribe | null = null;
let symboleAbonne: string | null = null;
/** Évite un double amorçage Coinalyze par souscription. */
let dejaSeed = false;
/** Fenêtre d'historique demandée à Coinalyze pour l'amorçage (48 h). */
const SEED_WINDOW_MS = 48 * 60 * 60 * 1000;

function retirerOverlays(): void {
  for (const [chart, ids] of overlaysSuivis) {
    for (const id of ids) {
      try {
        chart.removeOverlay({ id });
      } catch {
        break;
      }
    }
  }
  overlaysSuivis.clear();
}

/** Restaure le profil persisté du symbole dans l'accumulateur (best-effort). */
function chargerProfil(symbol: string): void {
  try {
    const d = deserialiserProfil(localStorage.getItem(STORAGE_PREFIX + symbol.toUpperCase()));
    if (d) {
      accumulateur = d.buckets;
      taille = d.taille;
    }
  } catch {
    /* best-effort */
  }
}

/** Persiste le profil courant du symbole (best-effort ; borné par serialiserProfil). */
function sauverProfil(symbol: string): void {
  try {
    if (taille > 0 && accumulateur.size > 0) {
      localStorage.setItem(STORAGE_PREFIX + symbol.toUpperCase(), serialiserProfil(taille, accumulateur));
    }
  } catch {
    /* quota / mode privé : ignoré */
  }
}

function redraw(): void {
  retirerOverlays();
  if (!liqMarksStore.getState().actif) return;
  const chart = getActiveChart();
  if (chart === null) return;
  const candles = marketStore.getState().candles;
  if (candles.length === 0) return;

  const premier = candles[0];
  const dernier = candles[candles.length - 1];
  if (premier === undefined || dernier === undefined) return;

  // Profil vide (aucune liquidation encore accumulée) : indicateur « en attente » discret
  // pour signaler que le heatmap est bien ACTIF (flux live sparse, se remplit avec le temps).
  if (accumulateur.size === 0 || taille <= 0) {
    const hint: OverlayCreate = {
      name: LIQ_HINT,
      groupId: LIQ_GROUP,
      lock: true,
      points: [{ timestamp: dernier.time, value: dernier.close }],
      extendData: {},
    };
    const id = chart.createOverlay(hint);
    if (typeof id === "string") overlaysSuivis.set(chart, [id]);
    return;
  }

  let max = 0;
  for (const v of accumulateur.values()) if (v > max) max = v;
  if (max <= 0) return;

  const ids: string[] = [];
  for (const [idx, notionnel] of accumulateur) {
    const t = notionnel / max;
    const [r, g, b] = couleurViridis(t);
    const alpha = 0.2 + 0.6 * t;
    const overlay: OverlayCreate = {
      name: LIQ_HEAT,
      groupId: LIQ_GROUP,
      lock: true,
      points: [
        { timestamp: premier.time, value: (idx + 1) * taille },
        { timestamp: dernier.time, value: idx * taille },
      ],
      extendData: { couleur: `rgba(${r},${g},${b},${alpha.toFixed(3)})` } satisfies DonneesBande,
    };
    const id = chart.createOverlay(overlay);
    if (typeof id === "string") ids.push(id);
  }
  if (ids.length > 0) overlaysSuivis.set(chart, ids);
}

/**
 * Amorce le profil depuis l'historique Coinalyze (une seule fois par souscription).
 * Inerte sans clé Coinalyze (fetchLiquidationHistory renvoie [] → aucun effet). Le seed
 * historique est ADDITIF au profil ; on ne l'exécute qu'au 1er remplissage (profil vide)
 * pour éviter de recompter l'historique déjà accumulé/persisté.
 */
async function amorcerCoinalyze(symbol: string): Promise<void> {
  if (dejaSeed) return;
  dejaSeed = true;
  const history = await fetchLiquidationHistory(symbol, Date.now() - SEED_WINDOW_MS);
  if (symboleAbonne !== symbol || history.length === 0) return; // symbole changé / rien
  const candles = marketStore.getState().candles;
  const dernier = candles[candles.length - 1];
  if (dernier === undefined) return;
  if (taille <= 0) taille = tailleBucket(dernier.close);
  const seed = construireSeed(history, candles, taille);
  for (const [idx, usd] of seed) accumulateur.set(idx, (accumulateur.get(idx) ?? 0) + usd);
  sauverProfil(symbol);
  redraw();
}

/** Accumule une liquidation dans le bucket de son prix (fige la taille au 1er appel) + persiste. */
function accumuler(l: Liquidation): void {
  if (taille <= 0) taille = tailleBucket(l.price);
  const idx = bucketIndex(l.price, taille);
  accumulateur.set(idx, (accumulateur.get(idx) ?? 0) + l.notionalUsd);
  if (symboleAbonne !== null) sauverProfil(symboleAbonne);
}

/** Aligne l'abonnement WS sur l'état (bascule + symbole). Réinitialise le profil au changement de symbole. */
function sync(): void {
  const actif = liqMarksStore.getState().actif;
  const symbol = marketStore.getState().symbol;

  if (!actif) {
    if (abonnement) {
      abonnement();
      abonnement = null;
    }
    symboleAbonne = null;
    accumulateur = new Map();
    taille = 0;
    redraw();
    return;
  }
  if (symboleAbonne !== symbol) {
    if (abonnement) abonnement();
    // Restaure le profil persisté du symbole (survit aux reloads / changements de symbole) ;
    // les liquidations live s'y ajoutent. Vide si jamais accumulé.
    accumulateur = new Map();
    taille = 0;
    dejaSeed = false;
    symboleAbonne = symbol;
    chargerProfil(symbol);
    abonnement = subscribeLiquidations(symbol, (l) => {
      accumuler(l);
      redraw();
    });
    redraw();
    // Amorçage historique Coinalyze UNIQUEMENT si aucun profil persisté (1re activation) :
    // évite de recompter l'historique déjà présent. Inerte sans clé.
    if (accumulateur.size === 0) void amorcerCoinalyze(symbol);
  }
}

let controllerStarted = false;
export function demarrerLiquidationMarkers(): void {
  if (controllerStarted) return;
  controllerStarted = true;
  ensureOverlayRegistered();

  let prevSymbol = marketStore.getState().symbol;
  let prevChart = getActiveChart();
  let prevReady = marketStore.getState().candles.length > 0;
  const bornes = () => {
    const c = marketStore.getState().candles;
    return c.length === 0 ? "" : `${c[0]?.time}:${c[c.length - 1]?.time}`;
  };
  let prevBornes = bornes();
  marketStore.subscribe(() => {
    const chart = getActiveChart();
    const { symbol, candles } = marketStore.getState();
    const ready = candles.length > 0;
    if (symbol !== prevSymbol || chart !== prevChart || ready !== prevReady) {
      prevSymbol = symbol;
      prevChart = chart;
      prevReady = ready;
      prevBornes = bornes();
      sync();
      return;
    }
    // Plage de bougies étendue (historique chargé / nouvelle bougie) → réancrer les bandes
    // pleine largeur, sans redessiner sur chaque tick de prix intra-bougie.
    const b = bornes();
    if (b !== prevBornes) {
      prevBornes = b;
      redraw();
    }
  });

  let prevActif = liqMarksStore.getState().actif;
  liqMarksStore.subscribe((s) => {
    if (s.actif !== prevActif) {
      prevActif = s.actif;
      sync();
    }
  });

  // Le heatmap viridis ne dépend pas du thème, mais un changement de thème peut
  // reconstruire le chart : on redessine par sûreté.
  let prevTheme = themeStore.getState().theme;
  themeStore.subscribe((s) => {
    if (s.theme !== prevTheme) {
      prevTheme = s.theme;
      redraw();
    }
  });
}

// ─────────────────────────── Commande de palette ───────────────────────────

export const commandes: Commande[] = [
  {
    id: "action:liqmarks",
    mnemonique: "LIQMARK",
    libelle: "Heatmap liquidations (chart) — activer / désactiver",
    categorie: "action",
    motsCles: ["liquidations", "heatmap", "liqmark", "chart", "profil", "niveaux", "clusters", "perp"],
    apercu: "Peint le profil des liquidations perp (bandes par niveau de prix) sur le graphe",
    action: () => liqMarksStore.getState().basculer(),
  },
];

demarrerLiquidationMarkers();
