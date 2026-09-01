/**
 * Store des WORKSPACES — presets nommés du terminal (Zustand VANILLA, hors render-loop).
 *
 * Un workspace = instantané COMMUTABLE de l'agencement : marché (symbole / source / TF),
 * indicateurs (instances), toggles (orderflow / profil de volume / revenus), comparaison,
 * overlays macro, thème, sections repliées de la sidebar et échelle de l'axe prix.
 *
 * Appliquer un workspace passe par les SETTERS des stores existants (pas de rechargement
 * de page) : le graphe et l'UI se reconfigurent en direct via les souscriptions déjà en
 * place (Chart, Toolbar, sidebar…).
 *
 * « Défaut » : un workspace réservé (id `defaut`), TOUJOURS présent et indestructible. Il
 * est AUTO-mis à jour : chaque fois que l'on QUITTE « Défaut » pour un preset, la session
 * libre en cours y est figée — revenir sur « Défaut » restaure donc l'agencement d'avant.
 * (La session live elle-même est déjà persistée en continu par `persist.ts` ; « Défaut »
 * n'a besoin d'être rafraîchi qu'au moment où l'on bascule ailleurs.)
 *
 * Persistance : localStorage INTERNE au module (clé `axiom:workspaces:v1`, hydratée au
 * chargement, sauvegardée à chaque changement) — même pattern que `store/alerts`.
 *
 * Playbooks 1-clic (scénarios métier figés PLAY / PLAY-SCALP…) : module séparé
 * `data/playbooks.ts`, greffés dans la palette depuis App.tsx — distincts des
 * workspaces (snapshot libre renommable vs scénario métier figé).
 */
import { createStore } from "zustand/vanilla";
import { EXCHANGE_IDS, type ExchangeId, type Timeframe } from "@axiom/types";
import { marketStore } from "./market";
import { indicatorsStore, migratePersistedIndicators, type ActiveIndicator } from "./indicators";
import { compareStore } from "./compare";
import { orderflowStore } from "./orderflow";
import { volumeProfileStore } from "./volumeProfile";
import { revenueStore } from "./revenue";
import { macroOverlayStore, MACRO_OVERLAYS, type MacroOverlayId } from "./macro-overlays";
import { uiSectionsStore } from "./ui-sections";
import { themeStore, THEMES, type ThemeId } from "./theme";
import { priceScaleStore, type PriceScaleType } from "../chart/Chart";
import { windowManagerStore, type EtatFenetre } from "./windowManager";
import { supportedTimeframesFor } from "../data/adapters";

const STORAGE_KEY = "axiom:workspaces:v1";
/** Identifiant réservé du workspace « Défaut » (indestructible, auto-mis à jour). */
export const DEFAULT_WORKSPACE_ID = "defaut";
const DEFAULT_WORKSPACE_NAME = "Défaut";

/** Sources restaurables. Dérivé de la source de vérité unique `EXCHANGE_IDS` (@axiom/types) — plus de copie locale. */
const RESTORABLE_EXCHANGES: ExchangeId[] = [...EXCHANGE_IDS];
/** Échelles d'axe prix valides. */
const PRICE_SCALES: PriceScaleType[] = ["normal", "log", "percentage"];

/** Contenu d'un workspace : l'instantané complet de l'agencement. */
export interface WorkspaceContent {
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
  indicators: ActiveIndicator[];
  orderflow: boolean;
  volumeProfile: boolean;
  revenue: boolean;
  /** Symboles comparés (couleurs ré-attribuées à l'identique dans l'ordre). */
  compare: string[];
  macroOverlays: MacroOverlayId[];
  theme: ThemeId;
  /** État replié des sections (clé = titre). */
  sections: Record<string, boolean>;
  priceScale: PriceScaleType;
  /** Géométrie ET état ouvert/minimisé des fenêtres flottantes — restaurés à
   * l'application, y compris après reload (sémantique unique, revue v2 H15). */
  windowGeometry: Record<string, EtatFenetre>;
}

/** Un workspace nommé. */
export interface Workspace {
  id: string;
  name: string;
  content: WorkspaceContent;
}

// ─────────────────────────── Snapshot / application ───────────────────────────

/** Capture l'agencement courant depuis tous les stores concernés. */
function snapshot(): WorkspaceContent {
  const m = marketStore.getState();
  return {
    exchange: m.exchange,
    symbol: m.symbol,
    timeframe: m.timeframe,
    indicators: indicatorsStore.getState().indicators.map((i) => ({
      instanceId: i.instanceId,
      defId: i.defId,
      params: { ...i.params },
      // La couleur fait partie de l'agencement : réappliquer un workspace doit rendre
      // au graphe exactement les mêmes courbes, aux mêmes couleurs.
      couleurIdx: i.couleurIdx,
    })),
    orderflow: orderflowStore.getState().enabled,
    volumeProfile: volumeProfileStore.getState().enabled,
    revenue: revenueStore.getState().enabled,
    compare: compareStore.getState().symbols.map((c) => c.symbol),
    macroOverlays: [...macroOverlayStore.getState().enabled],
    theme: themeStore.getState().theme,
    sections: { ...uiSectionsStore.getState().open },
    priceScale: priceScaleStore.getState().type,
    windowGeometry: windowManagerStore.getState().windows,
  };
}

/** Applique un contenu de workspace aux stores (via leurs setters — pas de reload). */
function applyContent(c: WorkspaceContent): void {
  const m = marketStore.getState();
  m.setExchange(c.exchange);
  m.setSymbol(c.symbol);
  m.setTimeframe(c.timeframe);
  indicatorsStore.getState().setAll(c.indicators);
  orderflowStore.getState().setEnabled(c.orderflow);
  volumeProfileStore.getState().setEnabled(c.volumeProfile);
  revenueStore.getState().setEnabled(c.revenue);
  compareStore.getState().clear();
  for (const sym of c.compare) compareStore.getState().add(sym);
  macroOverlayStore.getState().setEnabled(c.macroOverlays);
  themeStore.getState().setTheme(c.theme);
  uiSectionsStore.getState().setAll(c.sections);
  priceScaleStore.getState().setType(c.priceScale);
  windowManagerStore.getState().setAll(c.windowGeometry);
  // Re-clamp contre le workspace COURANT (même protection que le boot, cf. App.tsx /
  // setWorkspace) : une géométrie sauvegardée sur un grand écran ne doit pas rouvrir
  // hors du workspace actuel (revue whole-branch, finding #1).
  windowManagerStore.getState().reclampAll(windowManagerStore.getState().workspace);
}

/** Rafraîchit le contenu du workspace « Défaut » avec l'agencement courant. */
function majDefautDans(workspaces: Workspace[]): Workspace[] {
  const content = snapshot();
  return workspaces.map((w) => (w.id === DEFAULT_WORKSPACE_ID ? { ...w, content } : w));
}

// ─────────────────────────── Validation / persistance ───────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
function isBool(v: unknown): v is boolean {
  return typeof v === "boolean";
}

/**
 * Valide une géométrie de fenêtres persistée (même esprit que `validateEtatFenetre` de
 * persist.ts) : entrées corrompues écartées ; `open`/`minimized` sont conservés depuis la
 * sauvegarde (sémantique unique, revue v2 H15 — un workspace restaure aussi son plan de
 * fenêtres), avec repli sûr sur `false` si absents (compat sauvegardes existantes).
 */
function validateWindowGeometry(raw: unknown): Record<string, EtatFenetre> {
  const windows: Record<string, EtatFenetre> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return windows;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const r = v as Partial<EtatFenetre>;
    if (
      typeof r.x !== "number" ||
      typeof r.y !== "number" ||
      typeof r.width !== "number" ||
      typeof r.height !== "number" ||
      typeof r.z !== "number"
    ) {
      continue;
    }
    windows[id] = {
      id,
      // Sémantique unique (revue v2, H15) : l'état ouvert/minimisé fait partie du
      // workspace — un preset restaure son plan de fenêtres, en session COMME après reload.
      open: r.open === true,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      z: r.z,
      minimized: r.minimized === true,
      groupColor: typeof r.groupColor === "string" ? r.groupColor : null,
      preSnapGeometry: null,
    };
  }
  return windows;
}

/**
 * Normalise un contenu persisté en `WorkspaceContent` TOUJOURS applicable : chaque champ
 * invalide retombe sur un défaut sûr (source câblée, thème connu, échelle valide…). Les
 * indicateurs passent par la migration pure du store (filtre les defId disparus).
 */
function validateContent(raw: unknown): WorkspaceContent {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sections: Record<string, boolean> = {};
  if (o.sections && typeof o.sections === "object" && !Array.isArray(o.sections)) {
    for (const [k, v] of Object.entries(o.sections as Record<string, unknown>)) {
      if (isBool(v)) sections[k] = v;
    }
  }
  const exchange =
    typeof o.exchange === "string" && (RESTORABLE_EXCHANGES as string[]).includes(o.exchange)
      ? (o.exchange as ExchangeId)
      : "binance";
  const symbol = isNonEmptyString(o.symbol) ? o.symbol : "BTCUSDT";
  // TF « TOUJOURS applicable » (docstring) : validé contre la source restaurée,
  // repli 1h si supporté, sinon premier TF supporté.
  const supportes = supportedTimeframesFor(exchange, symbol);
  const timeframe =
    isNonEmptyString(o.timeframe) && (supportes as readonly string[]).includes(o.timeframe)
      ? (o.timeframe as Timeframe)
      : supportes.includes("1h")
        ? "1h"
        : (supportes[0] ?? "1h");
  return {
    exchange,
    symbol,
    timeframe,
    indicators: migratePersistedIndicators(o.indicators),
    orderflow: isBool(o.orderflow) ? o.orderflow : false,
    volumeProfile: isBool(o.volumeProfile) ? o.volumeProfile : false,
    revenue: isBool(o.revenue) ? o.revenue : false,
    compare: Array.isArray(o.compare) ? o.compare.filter(isNonEmptyString) : [],
    macroOverlays: Array.isArray(o.macroOverlays)
      ? o.macroOverlays.filter(
          (x): x is MacroOverlayId => (MACRO_OVERLAYS as readonly string[]).includes(x as string)
        )
      : [],
    theme:
      typeof o.theme === "string" && (THEMES as readonly string[]).includes(o.theme)
        ? (o.theme as ThemeId)
        : "dark",
    sections,
    priceScale:
      typeof o.priceScale === "string" && (PRICE_SCALES as string[]).includes(o.priceScale)
        ? (o.priceScale as PriceScaleType)
        : "normal",
    windowGeometry: validateWindowGeometry(o.windowGeometry),
  };
}

interface Persiste {
  workspaces: Workspace[];
  currentId: string;
}

/** Lecture tolérante de l'état persisté (défaut seedé si absent / corrompu). */
function lireInitial(): Persiste {
  const seedDefaut = (): Workspace => ({
    id: DEFAULT_WORKSPACE_ID,
    name: DEFAULT_WORKSPACE_NAME,
    content: snapshot(),
  });
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { workspaces: [seedDefaut()], currentId: DEFAULT_WORKSPACE_ID };
    const parsed = JSON.parse(raw) as { workspaces?: unknown; currentId?: unknown };
    const workspaces: Workspace[] = [];
    const usedIds = new Set<string>();
    if (Array.isArray(parsed.workspaces)) {
      for (const w of parsed.workspaces) {
        if (!w || typeof w !== "object") continue;
        const o = w as { id?: unknown; name?: unknown; content?: unknown };
        if (!isNonEmptyString(o.id) || !isNonEmptyString(o.name) || usedIds.has(o.id)) continue;
        usedIds.add(o.id);
        workspaces.push({ id: o.id, name: o.name, content: validateContent(o.content) });
      }
    }
    // « Défaut » garanti présent (en tête).
    if (!usedIds.has(DEFAULT_WORKSPACE_ID)) workspaces.unshift(seedDefaut());
    const currentId =
      isNonEmptyString(parsed.currentId) && workspaces.some((w) => w.id === parsed.currentId)
        ? parsed.currentId
        : DEFAULT_WORKSPACE_ID;
    return { workspaces, currentId };
  } catch {
    return { workspaces: [seedDefaut()], currentId: DEFAULT_WORKSPACE_ID };
  }
}

/** Écriture tolérante (best-effort). */
function sauvegarder(state: WorkspacesState): void {
  try {
    const payload: Persiste = { workspaces: state.workspaces, currentId: state.currentId };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore : best-effort */
  }
}

/** Identifiant court et unique pour un nouveau preset. */
function uniqueWorkspaceId(workspaces: Workspace[]): string {
  const taken = new Set(workspaces.map((w) => w.id));
  let n = workspaces.length + 1;
  let id = `ws-${n}`;
  while (taken.has(id)) {
    n += 1;
    id = `ws-${n}`;
  }
  return id;
}

// ─────────────────────────── Store ───────────────────────────

export interface WorkspacesState {
  workspaces: Workspace[];
  /** Workspace « actif » (pour la mise en évidence + l'auto-maj du Défaut). */
  currentId: string;
  /**
   * Enregistre l'agencement courant sous un nom. Si un preset de MÊME nom existe déjà
   * (hors « Défaut »), il est ÉCRASÉ ; sinon un nouveau preset est créé. Devient courant.
   */
  saveAs: (name: string) => void;
  /** Applique un workspace (no-op s'il est déjà courant) ; fige le Défaut si on le quitte. */
  apply: (id: string) => void;
  /** Renomme un preset (le « Défaut » garde son nom réservé). */
  rename: (id: string, name: string) => void;
  /** Supprime un preset (« Défaut » indestructible) ; bascule sur Défaut si c'était le courant. */
  remove: (id: string) => void;
}

const initial = lireInitial();

export const workspacesStore = createStore<WorkspacesState>((set, get) => ({
  workspaces: initial.workspaces,
  currentId: initial.currentId,

  saveAs: (name) => {
    const label = name.trim();
    if (label.length === 0) return;
    const content = snapshot();
    const { workspaces, currentId } = get();
    // Enregistrer depuis « Défaut » y fige aussi la session (cohérence de l'auto-maj :
    // « Défaut » et le nouveau preset reflètent alors la même vue courante).
    const base = currentId === DEFAULT_WORKSPACE_ID ? majDefautDans(workspaces) : workspaces;
    const existant = base.find((w) => w.id !== DEFAULT_WORKSPACE_ID && w.name === label);
    if (existant) {
      set({
        workspaces: base.map((w) => (w.id === existant.id ? { ...w, content } : w)),
        currentId: existant.id,
      });
    } else {
      const id = uniqueWorkspaceId(base);
      set({ workspaces: [...base, { id, name: label, content }], currentId: id });
    }
  },

  apply: (id) => {
    const { workspaces, currentId } = get();
    if (id === currentId) return; // déjà actif : rien à faire (évite d'écraser la vue courante)
    const cible = workspaces.find((w) => w.id === id);
    if (!cible) return;
    // Avant de quitter « Défaut », on y fige la session libre en cours.
    const nextWorkspaces = currentId === DEFAULT_WORKSPACE_ID ? majDefautDans(workspaces) : workspaces;
    set({ workspaces: nextWorkspaces, currentId: id });
    applyContent(cible.content);
  },

  rename: (id, name) => {
    if (id === DEFAULT_WORKSPACE_ID) return; // nom réservé
    const label = name.trim();
    if (label.length === 0) return;
    set({ workspaces: get().workspaces.map((w) => (w.id === id ? { ...w, name: label } : w)) });
  },

  remove: (id) => {
    if (id === DEFAULT_WORKSPACE_ID) return; // indestructible
    const { workspaces, currentId } = get();
    const filtered = workspaces.filter((w) => w.id !== id);
    if (filtered.length === workspaces.length) return; // id inconnu
    if (currentId === id) {
      // On supprimait le preset courant : fige la vue dans « Défaut » et bascule dessus.
      set({ workspaces: majDefautDans(filtered), currentId: DEFAULT_WORKSPACE_ID });
    } else {
      set({ workspaces: filtered, currentId });
    }
  },
}));

// Persistance interne : sauvegarde à chaque changement (basse fréquence).
workspacesStore.subscribe((state) => sauvegarder(state));
