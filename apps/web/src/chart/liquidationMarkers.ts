/**
 * Heatmap de LIQUIDATIONS sur le chart — profil des liquidations RÉELLEMENT exécutées
 * (flux `allLiquidation` Bybit, cf. data/liquidations.ts), peintes par NIVEAU DE PRIX
 * en bandes horizontales d'intensité viridis proportionnelle au notionnel liquidé à ce
 * niveau (façon CoinGlass, mais données réelles — pas le modèle de levier propriétaire).
 *
 * MODÈLE de données : ÉVÉNEMENTS BRUTS bornés (buffer FIFO de `LiqEvent`) plutôt qu'un
 * accumulateur agrégé. Chaque liquidation (live, seed daemon ou repli Coinalyze) est
 * conservée telle quelle ; l'agrégation par bucket se fait à la volée au rendu. Ce modèle
 * autorise le zoom/pan sur la densité et alimentera le contrôleur canvas (Tâche 6).
 *
 * MODÈLE de câblage : overlay custom `registerOverlay` + contrôleur singleton via
 * `getActiveChart()` (comme tradeMarkers) → NE touche PAS ChartInstance. Le contrôleur
 * gère l'abonnement WS (ouvert seulement si la bascule est ON, refermé/rouvert au
 * changement de symbole), le seed daemon/Coinalyze et le dual-write vers le daemon.
 *
 * ⚠️ Rendu overlay INTÉRIMAIRE : `redraw` agrège les événements en buckets à la volée et
 * dessine les mêmes bandes qu'avant. Il sera remplacé par un canvas en Tâche 6 — ne pas
 * le peaufiner.
 *
 * Fonctions PURES (taille de bucket, index, colormap viridis, sérialisation v2, fusion,
 * borne FIFO, seed Coinalyze) exportées et testées ; couplage KLineChart non testé.
 */
import { registerOverlay } from "klinecharts";
import type { OverlayCreate, OverlayFigure } from "klinecharts";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { Commande } from "../commands/registry";
import { getActiveChart } from "./drawing";
import { marketStore } from "../store/market";
import { themeStore } from "../store/theme";
import { subscribeLiquidations, type Liquidation } from "../data/liquidations";
import { fetchLiquidationHistory, type LiquidationHistPoint } from "../data/coinalyze";
import { liquidationsGet, liquidationsPush, type LiqDaemon } from "../data/daemon";
import type { Candle, Unsubscribe } from "@axiom/types";

const LIQ_HEAT = "liqHeat";
const LIQ_HINT = "liqHint";
const LIQ_GROUP = "axiomLiqHeat";
const STORAGE_PREFIX = "axiom:liqheat:";

/** Événement de liquidation normalisé côté chart. */
export interface LiqEvent {
  time: number;
  side: "long" | "short";
  price: number;
  qty: number;
  usd: number;
  venue: string;
  /** true si issu du seed Coinalyze (prix approximé low/high de bougie) — exclu du tooltip de détail. */
  approx?: boolean;
}

/** FIFO : au-delà de cette borne, on écarte les événements les plus anciens du buffer. */
export const MAX_EVENTS = 20_000;
/** localStorage v2 : on ne persiste que les N derniers événements (limite la taille). */
export const PERSIST_EVENTS = 3_000;

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

// ─────────────────────────── Persistance des événements v2 (localStorage, par symbole) ───────────────────────────

/**
 * Sérialise les `PERSIST_EVENTS` derniers événements RÉELS au format compact v2 :
 * `{v:2, e:[[t, side01, price, qty, usd, venue], ...]}` où side01 = 0 (long) / 1 (short).
 * Les événements `approx` (seed Coinalyze) sont EXCLUS : le tuple à 6 champs (figé) ne
 * porte pas `approx`, donc les persister les ferait réapparaître au reload comme des
 * événements réels (avec `qty:NaN` → null en JSON), et un buffer non vide bloquerait le
 * re-seed. PURE.
 */
export function serialiserEvenements(events: LiqEvent[]): string {
  const derniers = events.filter((ev) => ev.approx !== true).slice(-PERSIST_EVENTS);
  const e = derniers.map((ev) => [
    ev.time,
    ev.side === "long" ? 0 : 1,
    ev.price,
    ev.qty,
    ev.usd,
    ev.venue,
  ]);
  return JSON.stringify({ v: 2, e });
}

/**
 * Désérialise des événements persistés. TOLÉRANT : raw absent/corrompu/version ≠ 2 → [] ;
 * l'ancien format v1 `{t,b}` (buckets agrégés) n'a pas de champ `v:2 + e[]` → [] (jeté).
 * Chaque tuple invalide (longueur ≠ 6, side hors 0-1, prix ≤ 0, venue non-string…) est
 * ignoré. PURE.
 */
export function deserialiserEvenements(raw: string | null): LiqEvent[] {
  if (!raw) return [];
  try {
    const o = JSON.parse(raw) as { v?: unknown; e?: unknown };
    if (o.v !== 2 || !Array.isArray(o.e)) return [];
    const out: LiqEvent[] = [];
    for (const t of o.e) {
      if (!Array.isArray(t) || t.length !== 6) continue;
      const time = Number(t[0]);
      const side01 = Number(t[1]);
      const price = Number(t[2]);
      const qty = Number(t[3]);
      const usd = Number(t[4]);
      const venue = t[5];
      if (!Number.isFinite(time) || (side01 !== 0 && side01 !== 1)) continue;
      if (!Number.isFinite(price) || price <= 0) continue;
      if (!Number.isFinite(qty) || !Number.isFinite(usd)) continue;
      if (typeof venue !== "string") continue;
      out.push({ time, side: side01 === 0 ? "long" : "short", price, qty, usd, venue });
    }
    return out;
  } catch {
    return [];
  }
}

/** Clé d'unicité d'un événement pour le dédoublonnage de fusion. PURE. */
function cleEvenement(ev: LiqEvent): string {
  return `${ev.time}|${ev.venue}|${ev.price}|${ev.qty}`;
}

/**
 * Fusionne plusieurs listes d'événements en dédoublonnant par clé `t|venue|price|qty`
 * (1er vu conservé) et en triant par temps croissant. Sert à fusionner le buffer persisté
 * avec le seed daemon sans recompter des événements identiques. PURE.
 */
export function fusionnerEvenements(...listes: LiqEvent[][]): LiqEvent[] {
  const parCle = new Map<string, LiqEvent>();
  for (const liste of listes) {
    for (const ev of liste) {
      const cle = cleEvenement(ev);
      if (!parCle.has(cle)) parCle.set(cle, ev);
    }
  }
  return [...parCle.values()].sort((a, b) => a.time - b.time);
}

/** Borne un buffer d'événements à `max` (FIFO : on écarte les plus anciens). PURE. */
export function bornerEvenements(events: LiqEvent[], max: number): LiqEvent[] {
  return events.length <= max ? events : events.slice(events.length - max);
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
 * Construit des événements de seed APPROCHÉS depuis l'historique Coinalyze : chaque
 * intervalle est mappé à la bougie qui le contient ; le volume LONG liquidé est placé au
 * BAS de la bougie (ventes forcées → mèches basses), le SHORT au HAUT (rachats forcés →
 * mèches hautes). Événements marqués `approx:true`, venue `coinalyze`, `qty` inconnue
 * (NaN — Coinalyze donne le volume USD par temps, pas la quantité ni le prix). PURE.
 */
export function seedDepuisCoinalyze(
  history: LiquidationHistPoint[],
  candles: Candle[],
): LiqEvent[] {
  const out: LiqEvent[] = [];
  if (candles.length === 0) return out;
  for (const pt of history) {
    const c = candleContenant(candles, pt.time);
    if (c === undefined) continue;
    if (pt.longUsd > 0) {
      out.push({ time: pt.time, side: "long", price: c.low, qty: NaN, usd: pt.longUsd, venue: "coinalyze", approx: true });
    }
    if (pt.shortUsd > 0) {
      out.push({ time: pt.time, side: "short", price: c.high, qty: NaN, usd: pt.shortUsd, venue: "coinalyze", approx: true });
    }
  }
  return out;
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

// ─────────────────────────── Store des événements (buffer borné, vanilla) ───────────────────────────

/** État du buffer d'événements du symbole abonné (données HF → store vanilla, hors React). */
export interface LiqEventsState {
  events: LiqEvent[];
  /** Compteur de révision (bumpé à chaque mutation) — les consommateurs comparent `rev`. */
  rev: number;
  /** Vrai quand le heatmap est actif mais le buffer encore vide (« en attente du flux »). */
  enAttente: boolean;
}

export const liqEventsStore: StoreApi<LiqEventsState> = createStore<LiqEventsState>(() => ({
  events: [],
  rev: 0,
  enAttente: false,
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
/** Buffer FIFO des événements bruts du symbole abonné (mirroité dans liqEventsStore). */
let evenements: LiqEvent[] = [];
let abonnement: Unsubscribe | null = null;
let symboleAbonne: string | null = null;
/** Fenêtre d'historique demandée au daemon / à Coinalyze pour l'amorçage (7 j). */
const SEED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Throttle de persistance localStorage : au plus 1 écriture / 5 s (les liq rafalent). */
const SAVE_THROTTLE_MS = 5_000;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savePending = false;

/** Pousse l'état courant du buffer dans le store vanilla (bump `rev`, calcule `enAttente`). */
function publier(): void {
  const enAttente = liqMarksStore.getState().actif && evenements.length === 0;
  liqEventsStore.setState((s) => ({ events: evenements, rev: s.rev + 1, enAttente }));
}

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

/** Restaure les événements persistés v2 du symbole (best-effort → [] si absent/corrompu). */
function chargerProfil(symbol: string): LiqEvent[] {
  try {
    return deserialiserEvenements(localStorage.getItem(STORAGE_PREFIX + symbol.toUpperCase()));
  } catch {
    return [];
  }
}

/** Persiste immédiatement le buffer courant du symbole (best-effort ; borné à PERSIST_EVENTS). */
function sauverProfil(symbol: string): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + symbol.toUpperCase(), serialiserEvenements(evenements));
  } catch {
    /* quota / mode privé : ignoré */
  }
}

/**
 * Planifie une persistance THROTTLÉE (leading-edge) : écrit tout de suite si aucun timer
 * en cours, puis bloque 5 s ; toute demande pendant le blocage est repoussée à une seule
 * écriture en fin de fenêtre. Évite de marteler localStorage sur une cascade de liq.
 */
function planifierSauvegarde(): void {
  if (symboleAbonne === null) return;
  if (saveTimer !== null) {
    savePending = true;
    return;
  }
  sauverProfil(symboleAbonne);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (savePending) {
      savePending = false;
      planifierSauvegarde();
    }
  }, SAVE_THROTTLE_MS);
}

/** Vide le throttle et persiste l'état courant (flush au changement de symbole / arrêt). */
function flushSauvegarde(symbol: string): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  savePending = false;
  sauverProfil(symbol);
}

/**
 * Rendu overlay INTÉRIMAIRE (remplacé par un canvas en Tâche 6) : agrège les événements
 * du buffer en buckets à la volée (taille dérivée du close de la dernière bougie) et peint
 * les mêmes bandes viridis pleine largeur qu'auparavant.
 */
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

  // Agrégation à la volée des événements en buckets de prix.
  const taille = tailleBucket(dernier.close);
  const buckets = new Map<number, number>();
  if (taille > 0) {
    for (const ev of evenements) {
      if (!(ev.price > 0) || !(ev.usd > 0)) continue;
      const idx = bucketIndex(ev.price, taille);
      buckets.set(idx, (buckets.get(idx) ?? 0) + ev.usd);
    }
  }

  // Buffer vide (aucune liquidation encore reçue) : indicateur « en attente » discret pour
  // signaler que le heatmap est bien ACTIF (flux live sparse, se remplit avec le temps).
  if (buckets.size === 0) {
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
  for (const v of buckets.values()) if (v > max) max = v;
  if (max <= 0) return;

  const ids: string[] = [];
  for (const [idx, notionnel] of buckets) {
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

/** Traduit une liquidation persistée du daemon en événement chart. PURE (locale). */
function depuisDaemon(d: LiqDaemon): LiqEvent {
  return { time: d.t, side: d.side, price: d.price, qty: d.qty, usd: d.usd, venue: d.venue };
}

/**
 * Amorce le buffer au changement de symbole : d'abord le seed DAEMON (historique persistant
 * 7 j), fusionné + dédoublonné avec le buffer localStorage déjà restauré. Si le daemon est
 * ABSENT (`null`) ET le buffer vide, repli COINALYZE (événements approx, long→low/short→high).
 * Garde anti-course : si le symbole change pendant l'attente async, on jette le résultat.
 */
async function amorcerSeed(symbol: string): Promise<void> {
  const daemon = await liquidationsGet(symbol, { depuis: Date.now() - SEED_WINDOW_MS });
  if (symboleAbonne !== symbol) return; // symbole changé pendant l'attente → jeté
  if (daemon !== null) {
    // Daemon présent : on fusionne son historique (même vide → pas de repli Coinalyze).
    if (daemon.length > 0) {
      evenements = bornerEvenements(fusionnerEvenements(evenements, daemon.map(depuisDaemon)), MAX_EVENTS);
      publier();
      sauverProfil(symbol);
      redraw();
    }
    return;
  }
  // Daemon absent ET buffer vide → repli Coinalyze (sinon on garde le buffer persisté).
  if (evenements.length > 0) return;
  const history = await fetchLiquidationHistory(symbol, Date.now() - SEED_WINDOW_MS);
  if (symboleAbonne !== symbol || history.length === 0) return;
  const seed = seedDepuisCoinalyze(history, marketStore.getState().candles);
  if (seed.length === 0) return;
  evenements = bornerEvenements(fusionnerEvenements(evenements, seed), MAX_EVENTS);
  publier();
  sauverProfil(symbol);
  redraw();
}

/** Ajoute une liquidation LIVE au buffer (FIFO), persiste (throttlé) et dual-write daemon. */
function ajouterLive(l: Liquidation): void {
  // venue « bybit » EN DUR : subscribeLiquidations n'expose pas encore le champ venue
  // (il arrive en Tâche 8). Bybit est aujourd'hui le seul flux live branché.
  const ev: LiqEvent = {
    time: l.time,
    side: l.side,
    price: l.price,
    qty: l.qty,
    usd: l.notionalUsd,
    venue: "bybit",
  };
  evenements.push(ev);
  if (evenements.length > MAX_EVENTS) evenements.splice(0, evenements.length - MAX_EVENTS);
  publier();
  planifierSauvegarde();
  // Dual-write best-effort : on ne pousse QUE le live (pas le seed Coinalyze) au daemon.
  if (symboleAbonne !== null) {
    void liquidationsPush(symboleAbonne, [
      { t: ev.time, venue: ev.venue, side: ev.side, price: ev.price, qty: ev.qty, usd: ev.usd },
    ]);
  }
  redraw();
}

/** Aligne l'abonnement WS sur l'état (bascule + symbole). Réinitialise le buffer au changement de symbole. */
function sync(): void {
  const actif = liqMarksStore.getState().actif;
  const symbol = marketStore.getState().symbol;

  if (!actif) {
    if (abonnement) {
      abonnement();
      abonnement = null;
    }
    if (symboleAbonne !== null) flushSauvegarde(symboleAbonne);
    symboleAbonne = null;
    evenements = [];
    publier();
    redraw();
    return;
  }
  if (symboleAbonne !== symbol) {
    if (abonnement) abonnement();
    if (symboleAbonne !== null) flushSauvegarde(symboleAbonne);
    symboleAbonne = symbol;
    // Restaure les événements persistés v2 du symbole (survit aux reloads / changements de
    // symbole) ; les liquidations live s'y ajoutent. Vide si jamais accumulé.
    evenements = chargerProfil(symbol);
    publier();
    abonnement = subscribeLiquidations(symbol, (l) => ajouterLive(l));
    redraw();
    // Seed daemon (puis repli Coinalyze) — asynchrone, gardé anti-course.
    void amorcerSeed(symbol);
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
