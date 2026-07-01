/**
 * Persistance locale (localStorage) — restaure et sauvegarde l'état du terminal :
 *  - le `ChartState` (symbole, source, timeframe, indicateurs actifs + params) ;
 *  - la watchlist (GROUPES nommés, onglet actif, sources par symbole) ;
 *  - l'état de SESSION jusqu'ici volatil (comparaison, toggles orderflow / profil de
 *    volume / revenus, overlays macro, sections repliées de la sidebar, échelle de l'axe).
 *
 * Wiring (cf. main.tsx) : `hydrateStores()` AVANT le rendu (les stores prennent la
 * valeur persistée), puis `enablePersistence()` qui sauvegarde sur changement.
 *
 * Garde anti-écriture-en-boucle : on N'ÉCRIT PAS sur tick. Les souscriptions ne visent
 * que des stores BASSE fréquence ; celle du marketStore ne sauvegarde que si
 * symbole/source/timeframe changent (le buffer de bougies, lui, est ignoré).
 *
 * Note périmètre : le thème (`store/theme`) et les alertes (`store/alerts`) gèrent leur
 * propre persistance dans leur module respectif ; ils ne sont donc pas re-persistés ici,
 * mais leurs clés `axiom:*` sont bien couvertes par l'export/import de sauvegarde.
 */
import type { ChartState, ExchangeId, Timeframe } from "@axiom/types";
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
import { volumeProfileStore } from "./volumeProfile";
import { revenueStore } from "./revenue";
import { macroOverlayStore, MACRO_OVERLAYS, type MacroOverlayId } from "./macro-overlays";
import { uiSectionsStore } from "./ui-sections";
import { priceScaleStore, type PriceScaleType } from "../chart/Chart";

const CHART_KEY = "axiom:chartState:v1";
const WATCH_KEY = "axiom:watchlist:v1";
const SESSION_KEY = "axiom:sessionUi:v1";

/** Préfixe commun de toutes les clés du terminal (export/import de sauvegarde). */
const AXIOM_PREFIX = "axiom:";

/** Sources câblées : seules valeurs d'exchange restaurables (cf. data/adapters.ts). */
const RESTORABLE_EXCHANGES: ExchangeId[] = ["binance", "kraken", "coinbase", "twelvedata", "mexc"];

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

/** Écriture JSON tolérante (quota / mode privé => silencieux). */
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore : la persistance est best-effort */
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

// ─────────────────────────── État de session (jusqu'ici volatil) ───────────────────────────

/** Forme persistée de l'état de session (toggles + comparaison + overlays + sections + échelle). */
interface PersistedSession {
  /** Symboles comparés (ordre = ordre d'ajout ; les couleurs sont ré-attribuées à l'identique). */
  compare: string[];
  orderflow: boolean;
  volumeProfile: boolean;
  revenue: boolean;
  macroOverlays: MacroOverlayId[];
  /** État replié des sections de la sidebar (clé = titre ; carte creuse). */
  sections: Record<string, boolean>;
  priceScale: PriceScaleType;
}

/** Construit l'instantané de session courant depuis les stores. */
function currentSession(): PersistedSession {
  return {
    compare: compareStore.getState().symbols.map((c) => c.symbol),
    orderflow: orderflowStore.getState().enabled,
    volumeProfile: volumeProfileStore.getState().enabled,
    revenue: revenueStore.getState().enabled,
    macroOverlays: macroOverlayStore.getState().enabled,
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
  if (typeof p.volumeProfile === "boolean") volumeProfileStore.getState().setEnabled(p.volumeProfile);
  if (typeof p.revenue === "boolean") revenueStore.getState().setEnabled(p.revenue);

  if (Array.isArray(p.macroOverlays)) {
    // setEnabled filtre lui-même les ids inconnus (unique()) — on borne malgré tout ici.
    const ids = p.macroOverlays.filter(
      (id): id is MacroOverlayId => (MACRO_OVERLAYS as readonly string[]).includes(id as string)
    );
    macroOverlayStore.getState().setEnabled(ids);
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
 * Restaure les stores depuis localStorage. À appeler AVANT le premier rendu.
 *
 * Si aucun ChartState n'est persisté (première visite), on amorce le Volume @axiom
 * (pane séparé) par défaut : il remplace l'ancien VOL natif et fait de @axiom/indicators
 * la source unique (cf. BUILD-CONTRACT).
 */
export function hydrateStores(): void {
  const persisted = readJson<Partial<ChartState>>(CHART_KEY);

  if (persisted) {
    if (
      typeof persisted.exchange === "string" &&
      RESTORABLE_EXCHANGES.includes(persisted.exchange)
    ) {
      marketStore.getState().setExchange(persisted.exchange);
    }
    if (typeof persisted.symbol === "string" && persisted.symbol.length > 0) {
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

  hydrateWatchlist();
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
  watchlistStore.subscribe(() => saveWatchlist());

  // État de session : un seul enregistreur partagé, abonné à chaque store concerné.
  compareStore.subscribe(saveSessionUi);
  orderflowStore.subscribe(saveSessionUi);
  volumeProfileStore.subscribe(saveSessionUi);
  revenueStore.subscribe(saveSessionUi);
  macroOverlayStore.subscribe(saveSessionUi);
  uiSectionsStore.subscribe(saveSessionUi);
  priceScaleStore.subscribe(saveSessionUi);
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
