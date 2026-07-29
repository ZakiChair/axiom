/**
 * Persistance locale (localStorage) — restaure et sauvegarde l'état du terminal :
 *  - le `ChartState` (symbole, source, timeframe, indicateurs actifs + params) ;
 *  - la watchlist (GROUPES nommés, onglet actif, sources par symbole) ;
 *  - l'état de SESSION jusqu'ici volatil (comparaison, toggles orderflow / profil de
 *    volume / revenus / liquidations, overlays macro, sections repliées de la sidebar,
 *    échelle de l'axe).
 *
 * Wiring (cf. main.tsx) : `hydrateStores()` AVANT le rendu (les stores prennent la
 * valeur persistée), puis `enablePersistence()` qui sauvegarde sur changement.
 *
 * PERSISTANCE DURABLE (Phase 2.E2 — daemon axiomd, OPTIONNEL) : DUAL-WRITE. L'hydratation
 * reste 100 % synchrone depuis localStorage (comportement inchangé) ; en plus, chaque
 * écriture des clés gérées est DOUBLÉE d'un `kvPut` debouncé vers le daemon (namespace
 * « persist », `cle` = clé localStorage) SI le daemon est détecté. Au boot, après
 * l'hydratation locale, `enablePersistence()` déclenche une réconciliation asynchrone :
 * on lit le snapshot du daemon et, par comparaison d'horodatage (SQLite = source de
 * vérité quand le daemon est là), on ADOPTE ce qui est plus récent côté daemon (réappliqué
 * À CHAUD via les hydrateurs par SETTERS ci-dessous — même mécanisme sans reload que
 * `workspaces.applyContent`) et on POUSSE ce qui est plus récent côté local. Sans daemon :
 * aucun effet, repli localStorage intégral (zéro régression).
 *
 * Portée du dual-write : SEULES les 3 clés gérées ici (chart / watchlist / session). Le
 * thème (`store/theme`), les alertes (`store/alerts`) et les workspaces (`store/workspaces`)
 * gèrent leur propre persistance localStorage et ne sont PAS (encore) miroités au daemon —
 * ils restent locaux et ne transitent que par l'export/import de sauvegarde.
 *
 * Garde anti-écriture-en-boucle : on N'ÉCRIT PAS sur tick. Les souscriptions ne visent
 * que des stores BASSE fréquence ; celle du marketStore ne sauvegarde que si
 * symbole/source/timeframe changent (le buffer de bougies, lui, est ignoré).
 *
 * Note périmètre : le thème (`store/theme`) et les alertes (`store/alerts`) gèrent leur
 * propre persistance dans leur module respectif ; ils ne sont donc pas re-persistés ici,
 * mais leurs clés `axiom:*` sont bien couvertes par l'export/import de sauvegarde.
 */
import { EXCHANGE_IDS, type ChartState, type ExchangeId, type Timeframe } from "@axiom/types";
import {
  daemonPret,
  detectDaemon,
  kvPut,
  kvSnapshot,
  type SnapshotKv,
} from "../data/daemon";
import { defaultParams, migratePersistedIndicators, indicatorsStore } from "./indicators";
import { marketStore } from "./market";
import {
  watchlistStore,
  DEFAULT_WATCHLIST,
  PRINCIPAL_GROUP_ID,
  type WatchlistGroup,
  type WatchlistSource,
} from "./watchlist";
import { compareStore } from "./compare";
import { orderflowStore } from "./orderflow";
import { refSymbolStore } from "./refSymbol";
import { volumeProfileStore } from "./volumeProfile";
import { revenueStore } from "./revenue";
import { macroOverlayStore, MACRO_OVERLAYS, type MacroOverlayId } from "./macro-overlays";
import { denominateurStore } from "./denominateur";
import { DENOMINATEURS, type DenominateurId } from "../data/ratio";
import { uiSectionsStore } from "./ui-sections";
import { priceScaleStore, type PriceScaleType } from "../chart/Chart";
import { liqMarksStore, type LiqHeatMode, type Granularite } from "../chart/liquidationMarkers";
import { liqEstStore, LEVIERS } from "../chart/liquidationEstimates";
import { distOverlayStore } from "../chart/distLignes";
import { windowManagerStore, WINDOW_REGISTRY, type EtatFenetre } from "./windowManager";
import { syntheticsStore } from "./synthetics";
import { parseSyntheticSymbol } from "../data/synthetic";

const CHART_KEY = "axiom:chartState:v1";
const WINDOW_MANAGER_KEY = "axiom:windowManager:v1";
const WATCH_KEY = "axiom:watchlist:v1";
const SESSION_KEY = "axiom:sessionUi:v1";
const SYNTHETIC_RECENTS_KEY = "axiom:synthetic:recents:v1";

/** Préfixe commun de toutes les clés du terminal (export/import de sauvegarde). */
const AXIOM_PREFIX = "axiom:";

// ─────────────────────────── Dual-write daemon (Phase 2.E2) ───────────────────────────

/** Namespace KV du daemon où sont miroitées les clés gérées ici. */
const NS_PERSIST = "persist";
/** Clés localStorage doublées vers le daemon (les 3 gérées par ce module). */
const MANAGED_KEYS: readonly string[] = [CHART_KEY, WATCH_KEY, SESSION_KEY, WINDOW_MANAGER_KEY, SYNTHETIC_RECENTS_KEY];
/** Horodatages locaux (ms) par clé gérée — arbitre la réconciliation. NON miroité. */
const META_KEY = "axiom:persistMeta:v1";
/** Fenêtre de coalescence des kvPut par clé (ms). */
const DEBOUNCE_MIROIR_MS = 400;

/** Valeur sérialisée en attente d'envoi + minuteur de debounce, par clé. */
const enAttenteMiroir = new Map<string, string>();
const minuteursMiroir = new Map<string, ReturnType<typeof setTimeout>>();

/** Sources câblées : seules valeurs d'exchange restaurables (cf. data/adapters.ts).
 * Dérivé de la source de vérité unique `EXCHANGE_IDS` (@axiom/types) — plus de copie locale. */
const RESTORABLE_EXCHANGES: ExchangeId[] = [...EXCHANGE_IDS];

/** Échelles d'axe prix valides (miroir de PriceScaleType). */
const PRICE_SCALES: PriceScaleType[] = ["normal", "log", "percentage"];

/** Lecture JSON tolérante (localStorage indisponible / JSON corrompu => null). */
function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** setItem tolérant (quota / mode privé => silencieux). */
function setItemSafe(key: string, valeur: string): void {
  try {
    localStorage.setItem(key, valeur);
  } catch {
    /* ignore : la persistance est best-effort */
  }
}

/**
 * Écriture JSON tolérante. DUAL-WRITE : pour les clés gérées, on note l'horodatage
 * local (arbitrage de réconciliation) et on DOUBLE l'écriture d'un `kvPut` debouncé
 * vers le daemon (si détecté). L'hydratation, elle, reste 100 % synchrone (localStorage).
 */
function writeJson(key: string, value: unknown): void {
  const serialise = JSON.stringify(value);
  setItemSafe(key, serialise);
  if (MANAGED_KEYS.includes(key)) {
    noterMetaLocale(key);
    programmerMiroir(key, serialise);
  }
}

/** Lecture de la table d'horodatages locale (clé gérée → ms). Tolérante. */
function lireMeta(): Record<string, number> {
  const m = readJson<Record<string, number>>(META_KEY);
  return m && typeof m === "object" && !Array.isArray(m) ? m : {};
}

/** Écrit la table d'horodatages (NON miroitée au daemon). */
function ecrireMeta(meta: Record<string, number>): void {
  setItemSafe(META_KEY, JSON.stringify(meta));
}

/**
 * Note l'instant d'écriture LOCALE d'une clé (horloge murale). Persisté même daemon
 * absent : c'est ce qui permet, au prochain démarrage avec daemon, de savoir qu'un
 * changement local est plus récent que la copie du daemon (et de le pousser).
 */
function noterMetaLocale(cle: string): void {
  const meta = lireMeta();
  meta[cle] = Date.now();
  ecrireMeta(meta);
}

/**
 * Programme (debounce) l'envoi d'une valeur au daemon. NE SONDE PAS le réseau :
 * si le daemon n'est pas déjà confirmé présent (`daemonPret`), on n'ordonnance rien
 * (garde les tests hors-réseau ; la réconciliation au boot pousse de toute façon les
 * changements locaux plus récents que le daemon).
 */
function programmerMiroir(cle: string, valeur: string): void {
  if (!daemonPret()) return;
  enAttenteMiroir.set(cle, valeur);
  const existant = minuteursMiroir.get(cle);
  if (existant !== undefined) clearTimeout(existant);
  minuteursMiroir.set(
    cle,
    setTimeout(() => void viderMiroir(cle), DEBOUNCE_MIROIR_MS),
  );
}

/** Envoie au daemon la dernière valeur en attente pour une clé ; met à jour la meta. */
async function viderMiroir(cle: string): Promise<void> {
  minuteursMiroir.delete(cle);
  const valeur = enAttenteMiroir.get(cle);
  enAttenteMiroir.delete(cle);
  if (valeur === undefined || !daemonPret()) return;
  // On envoie la CHAÎNE localStorage telle quelle : kvPut la re-sérialise (JSON string),
  // ce qui la restitue octet pour octet au snapshot → réécriture localStorage fidèle.
  const majA = await kvPut(NS_PERSIST, cle, valeur);
  if (majA !== null) {
    const meta = lireMeta();
    meta[cle] = majA; // horodatage AUTORITAIRE du daemon → stabilise la comparaison
    ecrireMeta(meta);
  }
}

/** Chaîne non vide (garde de type réutilisée par les validateurs). */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// ─────────────────────────── ChartState (symbole / source / TF / indicateurs) ───────────────────────────

/** Construit le ChartState courant depuis les stores. */
function currentChartState(): ChartState {
  const { exchange, symbol, timeframe } = marketStore.getState();
  return {
    symbol,
    exchange,
    timeframe,
    chartType: "candle_solid",
    indicators: indicatorsStore.getState().indicators,
  };
}

export function saveChartState(): void {
  writeJson(CHART_KEY, currentChartState());
}

// ─────────────────────────── WindowManager (géométrie des fenêtres flottantes) ───────────────────────────

/** Construit l'état persistable du gestionnaire de fenêtres. */
function currentWindowManagerState(): Record<string, EtatFenetre> {
  return windowManagerStore.getState().windows;
}

export function saveWindowManagerState(): void {
  writeJson(WINDOW_MANAGER_KEY, currentWindowManagerState());
}

/** Validation légère d'une fenêtre persistée (repli sur des valeurs sûres si un champ
 * est corrompu/manquant — même esprit que `migratePersistedIndicators`). */
function validateEtatFenetre(id: string, raw: unknown): EtatFenetre | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<EtatFenetre>;
  if (
    typeof r.x !== "number" ||
    typeof r.y !== "number" ||
    typeof r.width !== "number" ||
    typeof r.height !== "number" ||
    typeof r.z !== "number"
  ) {
    return null;
  }
  return {
    id,
    // Sémantique unique (revue v2, H15) : l'état ouvert/minimisé est restauré — le plan
    // de travail survit au reload.
    open: r.open === true,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    z: r.z,
    minimized: r.minimized === true,
    groupColor: typeof r.groupColor === "string" ? r.groupColor : null,
    // Jamais persisté (état éphémère de drag) : toujours null à la restauration, même
    // si un ancien enregistrement en contenait un d'une session précédente.
    preSnapGeometry: null,
  };
}

/** Restaure la géométrie des fenêtres depuis localStorage (position/taille/groupe —
 * l'état ouvert/minimisé est restauré — le plan de travail survit au reload, revue v2). */
function hydrateWindowManager(): void {
  const persisted = readJson<Record<string, unknown>>(WINDOW_MANAGER_KEY);
  if (!persisted) return;
  const windows: Record<string, EtatFenetre> = {};
  for (const entry of WINDOW_REGISTRY) {
    const validated = validateEtatFenetre(entry.id, persisted[entry.id]);
    if (validated) windows[entry.id] = validated;
  }
  windowManagerStore.getState().setAll(windows);
}

// ─────────────────────────── Watchlist (groupes + sources) ───────────────────────────

/** Forme persistée de la watchlist (nouveau format à groupes ; l'ancien = liste plate). */
interface PersistedWatchlist {
  groups: WatchlistGroup[];
  activeGroupId: string;
  sources: Record<string, WatchlistSource>;
}

export function saveWatchlist(): void {
  const { groups, activeGroupId, sources } = watchlistStore.getState();
  const payload: PersistedWatchlist = { groups, activeGroupId, sources };
  writeJson(WATCH_KEY, payload);
}

export function saveSyntheticRecents(): void {
  writeJson(SYNTHETIC_RECENTS_KEY, syntheticsStore.getState().recents);
}

/** Source de watchlist valide (sous-ensemble des exchanges câblés). */
function isWatchlistSource(v: unknown): v is WatchlistSource {
  return typeof v === "string" && (RESTORABLE_EXCHANGES as string[]).includes(v);
}

/**
 * Valide un objet watchlist persisté (nouveau format). Filtre les groupes/symboles
 * invalides, garantit au moins un groupe, corrige l'onglet actif et élague les sources
 * orphelines. Renvoie l'état à injecter (avec `symbols` = miroir du groupe actif), ou
 * null si rien d'exploitable.
 */
function validateWatchlist(raw: Record<string, unknown>): PersistedWatchlist & { symbols: string[] } | null {
  if (!Array.isArray(raw.groups)) return null;
  const groups: WatchlistGroup[] = [];
  const usedIds = new Set<string>();
  for (const g of raw.groups) {
    if (!g || typeof g !== "object") continue;
    const o = g as { id?: unknown; name?: unknown; symbols?: unknown };
    if (!isNonEmptyString(o.id) || !isNonEmptyString(o.name) || !Array.isArray(o.symbols)) continue;
    if (usedIds.has(o.id)) continue; // ids dupliqués : on garde le premier
    usedIds.add(o.id);
    const symbols = o.symbols.filter(isNonEmptyString);
    groups.push({ id: o.id, name: o.name, symbols });
  }
  if (groups.length === 0) return null;

  const activeGroupId =
    isNonEmptyString(raw.activeGroupId) && usedIds.has(raw.activeGroupId)
      ? raw.activeGroupId
      : (groups[0]?.id ?? PRINCIPAL_GROUP_ID);

  // Sources : seules les entrées valides ET présentes dans un groupe sont conservées.
  const allSymbols = new Set(groups.flatMap((g) => g.symbols));
  const sources: Record<string, WatchlistSource> = {};
  if (raw.sources && typeof raw.sources === "object") {
    for (const [sym, src] of Object.entries(raw.sources as Record<string, unknown>)) {
      if (allSymbols.has(sym) && isWatchlistSource(src)) sources[sym] = src;
    }
  }

  const symbols = groups.find((g) => g.id === activeGroupId)?.symbols ?? [];
  return { groups, activeGroupId, sources, symbols };
}

/** Restaure la watchlist : nouveau format (groupes) OU ancien (liste plate = migration douce). */
function hydrateWatchlist(): void {
  const raw = readJson<unknown>(WATCH_KEY);
  if (Array.isArray(raw)) {
    // Ancien format : liste plate de symboles -> repli sur un unique groupe « Principal ».
    const symbols = raw.filter(isNonEmptyString);
    watchlistStore.getState().setAll(symbols.length > 0 ? symbols : [...DEFAULT_WATCHLIST]);
    return;
  }
  if (raw && typeof raw === "object") {
    const restored = validateWatchlist(raw as Record<string, unknown>);
    if (restored) {
      // setState direct : le store n'expose pas de restauration multi-groupes (watchlist.ts
      // hors périmètre) ; on injecte un état COHÉRENT (symbols = miroir du groupe actif).
      watchlistStore.setState({
        groups: restored.groups,
        activeGroupId: restored.activeGroupId,
        sources: restored.sources,
        symbols: restored.symbols,
      });
    }
  }
}

function hydrateSyntheticRecents(): void {
  const raw = readJson<unknown>(SYNTHETIC_RECENTS_KEY);
  if (Array.isArray(raw)) syntheticsStore.getState().setRecents(raw.filter(isNonEmptyString));
}

// ─────────────────────────── État de session (jusqu'ici volatil) ───────────────────────────

/** Forme persistée de l'état de session (toggles + comparaison + overlays + sections + échelle). */
interface PersistedSession {
  /** Symboles comparés (ordre = ordre d'ajout ; les couleurs sont ré-attribuées à l'identique). */
  compare: string[];
  orderflow: boolean;
  /** Symbole de référence des indicateurs croisés (refSymbolStore). */
  refSymbol: string;
  volumeProfile: boolean;
  revenue: boolean;
  /** Bascule heatmap liquidations exécutées (chart/liquidationMarkers). */
  liqHeatmap: boolean;
  /** Mode de coloration des cellules de la heatmap (intensité / dominance long-short). */
  liqHeatmapMode: LiqHeatMode;
  /** Granularité des buckets de prix de la heatmap (½× / 1× / 2× — facteur de tailleBucket). */
  liqGranularite: Granularite;
  /** Bascule niveaux de liquidation estimés (chart/liquidationEstimates). */
  liqEstimates: boolean;
  /** Leviers cochés du modèle de niveaux estimés (sous-ensemble NON VIDE de LEVIERS). */
  liqLeviers: number[];
  /** Bascule de l'overlay des bandes VaR sur le chart maître (chart/distLignes). */
  distOverlay: boolean;
  macroOverlays: MacroOverlayId[];
  /** Dénominateur choisi pour le bouton de ratio scindé du bandeau (÷ETH / ÷SOL). */
  denominateur: DenominateurId;
  /** État replié des sections de la sidebar (clé = titre ; carte creuse). */
  sections: Record<string, boolean>;
  priceScale: PriceScaleType;
}

/** Construit l'instantané de session courant depuis les stores. */
function currentSession(): PersistedSession {
  return {
    compare: compareStore.getState().symbols.map((c) => c.symbol),
    orderflow: orderflowStore.getState().enabled,
    refSymbol: refSymbolStore.getState().refSymbol,
    volumeProfile: volumeProfileStore.getState().enabled,
    revenue: revenueStore.getState().enabled,
    liqHeatmap: liqMarksStore.getState().actif,
    liqHeatmapMode: liqMarksStore.getState().mode,
    liqGranularite: liqMarksStore.getState().granularite,
    liqEstimates: liqEstStore.getState().actif,
    liqLeviers: liqEstStore.getState().leviers,
    distOverlay: distOverlayStore.getState().actif,
    macroOverlays: macroOverlayStore.getState().enabled,
    denominateur: denominateurStore.getState().denominateur,
    sections: uiSectionsStore.getState().open,
    priceScale: priceScaleStore.getState().type,
  };
}

export function saveSessionUi(): void {
  writeJson(SESSION_KEY, currentSession());
}

/** Restaure l'état de session (validation champ par champ, valeurs inconnues ignorées). */
function hydrateSession(): void {
  const p = readJson<Partial<PersistedSession>>(SESSION_KEY);
  if (!p) return;

  // Comparaison : on repart à vide puis on ré-ajoute (les couleurs stables sont
  // reconstituées dans l'ordre par le store — cf. firstFreeColor).
  if (Array.isArray(p.compare)) {
    compareStore.getState().clear();
    for (const sym of p.compare) {
      if (isNonEmptyString(sym)) compareStore.getState().add(sym);
    }
  }

  if (typeof p.orderflow === "boolean") orderflowStore.getState().setEnabled(p.orderflow);
  // refSymbol : passe par le setter → normalisation (une valeur éditée à la main en
  // minuscules est remise en MAJUSCULES, une chaîne vide est ignorée).
  if (isNonEmptyString(p.refSymbol)) refSymbolStore.getState().setRefSymbol(p.refSymbol);
  if (typeof p.volumeProfile === "boolean") volumeProfileStore.getState().setEnabled(p.volumeProfile);
  if (typeof p.revenue === "boolean") revenueStore.getState().setEnabled(p.revenue);
  // Liquidations : `setActif` fait passer la bascule via son subscribe → le singleton
  // (re)démarre l'abonnement WS / le fetch OI si `true` est restauré (cf. demarrer*).
  if (typeof p.liqHeatmap === "boolean") liqMarksStore.getState().setActif(p.liqHeatmap);
  // Mode de coloration : union de chaînes — la garde d'égalité filtre toute valeur inconnue.
  if (p.liqHeatmapMode === "intensite" || p.liqHeatmapMode === "dominance") {
    liqMarksStore.getState().setMode(p.liqHeatmapMode);
  }
  // Granularité : union 0.5|1|2 — la garde d'égalité filtre toute valeur inconnue.
  if (p.liqGranularite === 0.5 || p.liqGranularite === 1 || p.liqGranularite === 2) {
    liqMarksStore.getState().setGranularite(p.liqGranularite);
  }
  if (typeof p.liqEstimates === "boolean") liqEstStore.getState().setActif(p.liqEstimates);
  // Leviers estimés : garder les nombres ∈ LEVIERS ; non vide (le setter réordonne
  // canoniquement et ignore une liste vide/invalide — garde : au moins un levier reste).
  if (Array.isArray(p.liqLeviers)) {
    const valides = p.liqLeviers.filter(
      (L): L is number => typeof L === "number" && (LEVIERS as readonly number[]).includes(L),
    );
    if (valides.length > 0) liqEstStore.getState().setLeviers(valides);
  }
  if (typeof p.distOverlay === "boolean") distOverlayStore.getState().setActif(p.distOverlay);

  if (Array.isArray(p.macroOverlays)) {
    // setEnabled filtre lui-même les ids inconnus (unique()) — on borne malgré tout ici.
    const ids = p.macroOverlays.filter(
      (id): id is MacroOverlayId => (MACRO_OVERLAYS as readonly string[]).includes(id as string)
    );
    macroOverlayStore.getState().setEnabled(ids);
  }

  // Dénominateur du bouton de ratio : union fermée — toute valeur inconnue laisse le défaut.
  if (
    typeof p.denominateur === "string" &&
    (DENOMINATEURS as readonly string[]).includes(p.denominateur)
  ) {
    denominateurStore.getState().setDenominateur(p.denominateur as DenominateurId);
  }

  if (p.sections && typeof p.sections === "object" && !Array.isArray(p.sections)) {
    const clean: Record<string, boolean> = {};
    for (const [id, open] of Object.entries(p.sections)) {
      if (typeof open === "boolean") clean[id] = open;
    }
    uiSectionsStore.getState().setAll(clean);
  }

  if (typeof p.priceScale === "string" && (PRICE_SCALES as string[]).includes(p.priceScale)) {
    priceScaleStore.getState().setType(p.priceScale as PriceScaleType);
  }
}

// ─────────────────────────── Hydratation + activation ───────────────────────────

/**
 * Restaure le ChartState (marché + indicateurs) depuis localStorage.
 *
 * Si aucun ChartState n'est persisté (première visite), on amorce le Volume @axiom
 * (pane séparé) par défaut : il remplace l'ancien VOL natif et fait de @axiom/indicators
 * la source unique (cf. BUILD-CONTRACT). Applique via les SETTERS des stores → utilisable
 * aussi bien au boot (avant rendu) qu'À CHAUD lors de la réconciliation daemon.
 */
function hydrateChart(): void {
  const persisted = readJson<Partial<ChartState>>(CHART_KEY);

  if (persisted) {
    // Un état `synthetic` n'est cohérent qu'avec un symbole encodé parsable ;
    // sinon (état corrompu), on ignore le couple exchange+symbol persisté
    // (chart bloqué à chaque reload autrement : adapter synthétique × ticker normal).
    const syntheticIncoherent =
      persisted.exchange === "synthetic" &&
      (typeof persisted.symbol !== "string" || parseSyntheticSymbol(persisted.symbol) === null);
    if (
      !syntheticIncoherent &&
      typeof persisted.exchange === "string" &&
      RESTORABLE_EXCHANGES.includes(persisted.exchange)
    ) {
      marketStore.getState().setExchange(persisted.exchange);
    }
    if (!syntheticIncoherent && typeof persisted.symbol === "string" && persisted.symbol.length > 0) {
      marketStore.getState().setSymbol(persisted.symbol);
    }
    if (typeof persisted.timeframe === "string") {
      marketStore.getState().setTimeframe(persisted.timeframe as Timeframe);
    }
    // Migration/validation des indicateurs (filtre les defId disparus, backfille les params,
    // attribue des instanceId stables) — fonction PURE exportée par store/indicators.
    indicatorsStore.getState().setAll(migratePersistedIndicators(persisted.indicators));
  } else {
    indicatorsStore
      .getState()
      .setAll([{ defId: "volume", params: defaultParams("volume") }]);
  }
}

/**
 * Restaure les stores depuis localStorage. À appeler AVANT le premier rendu.
 */
export function hydrateStores(): void {
  hydrateChart();
  hydrateWindowManager();
  hydrateWatchlist();
  hydrateSyntheticRecents();
  hydrateSession();
}

/**
 * Active la sauvegarde automatique. À appeler APRÈS `hydrateStores()`.
 *  - marketStore : sauvegarde uniquement si symbole/source/timeframe changent (pas sur tick) ;
 *  - autres stores : sauvegarde à tout changement (tous BASSE fréquence).
 */
export function enablePersistence(): void {
  marketStore.subscribe((state, prev) => {
    if (
      state.exchange !== prev.exchange ||
      state.symbol !== prev.symbol ||
      state.timeframe !== prev.timeframe
    ) {
      saveChartState();
    }
  });
  indicatorsStore.subscribe(() => saveChartState());
  windowManagerStore.subscribe(() => saveWindowManagerState());
  watchlistStore.subscribe(() => saveWatchlist());
  syntheticsStore.subscribe(() => saveSyntheticRecents());

  // État de session : un seul enregistreur partagé, abonné à chaque store concerné.
  compareStore.subscribe(saveSessionUi);
  orderflowStore.subscribe(saveSessionUi);
  refSymbolStore.subscribe(saveSessionUi);
  volumeProfileStore.subscribe(saveSessionUi);
  revenueStore.subscribe(saveSessionUi);
  liqMarksStore.subscribe(saveSessionUi);
  liqEstStore.subscribe(saveSessionUi);
  distOverlayStore.subscribe(saveSessionUi);
  macroOverlayStore.subscribe(saveSessionUi);
  denominateurStore.subscribe(saveSessionUi);
  uiSectionsStore.subscribe(saveSessionUi);
  priceScaleStore.subscribe(saveSessionUi);

  // Persistance durable : réconciliation asynchrone avec le daemon (best-effort, silencieux
  // s'il est absent). Déclenchée APRÈS l'hydratation locale déjà faite (hydrateStores).
  void reconcilierDepuisDaemon();
}

// ─────────────────────────── Réconciliation daemon (Phase 2.E2) ───────────────────────────

/** Hydrateur par clé gérée : réapplique À CHAUD (via setters) la valeur adoptée. */
const HYDRATE_PAR_CLE: Record<string, () => void> = {
  [CHART_KEY]: hydrateChart,
  [WATCH_KEY]: hydrateWatchlist,
  [SESSION_KEY]: hydrateSession,
  [WINDOW_MANAGER_KEY]: hydrateWindowManager,
};

/** Décision de réconciliation pour une clé (adopter le daemon, ou lui pousser le local). */
export type DecisionReconcile =
  | { cle: string; action: "adopter"; valeur: string; majA: number }
  | { cle: string; action: "pousser"; valeur: string };

/**
 * Décide, pour chaque clé gérée, quoi faire au boot en comparant le snapshot du daemon,
 * la présence/valeur LOCALE et la table d'horodatages `meta`. Last-write-wins :
 *  - local absent OU daemon strictement plus récent  → ADOPTER (le daemon fait foi) ;
 *  - daemon absent OU local strictement plus récent   → POUSSER (le local fait foi) ;
 *  - à égalité d'horodatage                           → rien.
 * Une clé locale présente mais SANS meta (utilisateur d'avant cette feature) est traitée
 * comme « très récente » (on préfère ne pas écraser la vue courante → on la pousse).
 * Fonction PURE (testée) : ne touche ni localStorage ni le réseau.
 */
export function decisionsReconcile(
  clesGerees: readonly string[],
  snapshot: SnapshotKv,
  localGet: (cle: string) => string | null,
  meta: Record<string, number>,
): DecisionReconcile[] {
  const decisions: DecisionReconcile[] = [];
  for (const cle of clesGerees) {
    const d = snapshot[cle];
    const localVal = localGet(cle);
    const localAbsent = localVal === null;

    if (d && typeof d.valeur === "string") {
      if (localAbsent) {
        decisions.push({ cle, action: "adopter", valeur: d.valeur, majA: d.majA });
        continue;
      }
      const ref = meta[cle] ?? Number.POSITIVE_INFINITY; // présent mais non horodaté → très récent
      if (d.majA > ref) {
        decisions.push({ cle, action: "adopter", valeur: d.valeur, majA: d.majA });
      } else if (ref > d.majA) {
        decisions.push({ cle, action: "pousser", valeur: localVal });
      }
      // ref === d.majA : déjà en phase, rien à faire.
    } else if (!d && !localAbsent) {
      // Le daemon ignore cette clé mais on l'a en local → on l'y sème (durabilité).
      decisions.push({ cle, action: "pousser", valeur: localVal });
    }
  }
  return decisions;
}

/**
 * Réconcilie l'état persisté avec le daemon (si détecté). Adopte les valeurs plus
 * récentes côté daemon (réappliquées à chaud) et pousse les valeurs locales plus
 * récentes. Best-effort et TOTALEMENT silencieux si le daemon est absent (aucune
 * régression : le front a déjà été hydraté depuis localStorage).
 */
async function reconcilierDepuisDaemon(): Promise<void> {
  try {
    if (!(await detectDaemon("kv"))) return;
    const snapshot = await kvSnapshot(NS_PERSIST);
    if (!snapshot) return;

    const meta = lireMeta();
    const decisions = decisionsReconcile(
      MANAGED_KEYS,
      snapshot,
      (cle) => localStorage.getItem(cle),
      meta,
    );

    const aReappliquer = new Set<string>();
    for (const d of decisions) {
      if (d.action === "adopter") {
        setItemSafe(d.cle, d.valeur);
        meta[d.cle] = d.majA;
        aReappliquer.add(d.cle);
      } else {
        const majA = await kvPut(NS_PERSIST, d.cle, d.valeur);
        if (majA !== null) meta[d.cle] = majA;
      }
    }
    ecrireMeta(meta);

    // Réapplication À CHAUD des clés adoptées : réutilise les hydrateurs (setters des
    // stores → Chart/Toolbar/sidebar se reconfigurent en direct, sans reload).
    for (const cle of aReappliquer) HYDRATE_PAR_CLE[cle]?.();
  } catch {
    /* réconciliation best-effort : jamais bloquante */
  }
}

// ─────────────────────────── Sauvegarde complète (export / import JSON) ───────────────────────────

/** Recense les clés `axiom:*` présentes dans localStorage. */
function axiomKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k !== null && k.startsWith(AXIOM_PREFIX)) keys.push(k);
  }
  return keys;
}

/**
 * Exporte TOUT l'état `axiom:*` de localStorage en un fichier JSON horodaté
 * (téléchargement navigateur). Backup complet du terminal : chart, watchlist, session,
 * workspaces, thème, alertes, dessins, clés API… tout ce qui est préfixé `axiom:`.
 */
export function exporterSauvegarde(): void {
  const dump: Record<string, string> = {};
  for (const k of axiomKeys()) {
    const v = localStorage.getItem(k);
    if (v !== null) dump[k] = v;
  }
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  // Horodatage AAAA-MM-JJ-HH-mm (sans « : » ni « T », valides en nom de fichier).
  const date = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const a = document.createElement("a");
  a.href = url;
  a.download = `axiom-sauvegarde-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Importe une sauvegarde JSON : valide la forme (objet clé→string, uniquement `axiom:*`),
 * PURGE les clés `axiom:*` existantes puis réécrit celles du fichier. Renvoie true si le
 * remplacement a eu lieu (l'appelant recharge alors la page pour ré-hydrater proprement),
 * false si le contenu est invalide (aucune modification effectuée). Fonction pure des
 * effets d'UI : la confirmation utilisateur est gérée par l'appelant.
 */
export function importerSauvegarde(json: string): boolean {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return false;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;

  const valides: [string, string][] = [];
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (k.startsWith(AXIOM_PREFIX) && typeof v === "string") valides.push([k, v]);
  }
  if (valides.length === 0) return false;

  for (const k of axiomKeys()) localStorage.removeItem(k);
  for (const [k, v] of valides) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* quota : best-effort */
    }
  }
  return true;
}
