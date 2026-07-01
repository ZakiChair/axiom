/**
 * Store watchlist — Zustand VANILLA (hors render-loop React).
 *
 * Favoris organisés en GROUPES nommés (onglets), modifiés seulement à basse fréquence
 * (ajout/suppression/réordonnancement/changement d'onglet). Les PRIX live ne transitent
 * PAS par ce store : ils sont écrits impérativement dans le DOM par le composant Watchlist
 * (aucun re-render React sur tick — cf. BUILD-CONTRACT).
 *
 * GROUPES (roadmap 1.4) : `groups` liste les onglets (défaut « Principal ») ; `activeGroupId`
 * désigne l'onglet affiché. Le champ `symbols` est un MIROIR en lecture du groupe actif,
 * conservé pour rétro-compatibilité : `persist.ts` (hors de ce périmètre) persiste et restaure
 * UNIQUEMENT cette liste plate via `setAll`. Tant que la persistance n'aura pas été étendue aux
 * groupes (agent ultérieur), un rechargement replie l'ensemble sur un unique groupe « Principal ».
 *
 * SOURCE D'ORIGINE (roadmap 0.4b) : chaque entrée peut porter la source dont elle provient
 * (`sources[symbole]`, map GLOBALE creuse), pour que data/ticker route le flux de prix vers le
 * bon exchange et que le clic sur une ligne restaure aussi la source. Seules les entrées à source
 * EXPLICITE y figurent ; les autres sont routées par inférence côté ticker (tradfi -> Twelve Data,
 * sinon Binance par défaut). Ce défaut couvre les entrées historiques / persistées en clair.
 */
import { createStore } from "zustand/vanilla";

/** Sources câblées pouvant alimenter un ticker de watchlist (cf. data/adapters.ts). */
export type WatchlistSource = "binance" | "kraken" | "coinbase" | "mexc" | "twelvedata";

/** Identifiant stable du groupe par défaut (jamais supprimable s'il reste seul). */
export const PRINCIPAL_GROUP_ID = "principal";

/** Favoris par défaut (écrasés par la valeur persistée si présente). */
export const DEFAULT_WATCHLIST = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

/** Un onglet nommé de la watchlist : liste ORDONNÉE de symboles (l'ordre = l'affichage). */
export interface WatchlistGroup {
  id: string;
  name: string;
  symbols: string[];
}

export interface WatchlistState {
  /** Onglets nommés (au moins un). */
  groups: WatchlistGroup[];
  /** Identifiant de l'onglet affiché. */
  activeGroupId: string;
  /** Sources EXPLICITES par symbole (map GLOBALE creuse ; absence => inférence côté ticker). */
  sources: Record<string, WatchlistSource>;
  /** MIROIR en lecture du groupe actif (rétro-compat persist.ts + rendu de la liste). */
  symbols: string[];

  /** Ajoute un symbole au GROUPE ACTIF ; `source` optionnelle fige sa provenance (sinon inférée). */
  add: (symbol: string, source?: WatchlistSource) => void;
  /** Retire un symbole du GROUPE ACTIF (et purge sa source s'il ne figure plus dans aucun groupe). */
  remove: (symbol: string) => void;
  /** Déplace un symbole dans le groupe actif : dir=-1 (monter) / +1 (descendre). */
  move: (symbol: string, dir: -1 | 1) => void;

  /** Sélectionne l'onglet affiché (no-op si l'id est inconnu). */
  setActiveGroup: (id: string) => void;
  /** Crée un nouvel onglet (vide) et le sélectionne. */
  addGroup: (name: string) => void;
  /** Supprime un onglet (ignoré s'il ne reste qu'un seul groupe) ; purge les sources orphelines. */
  removeGroup: (id: string) => void;

  /** Remplace TOUTE la watchlist par un unique groupe « Principal » (restauration persist.ts). */
  setAll: (symbols: string[], sources?: Record<string, WatchlistSource>) => void;
}

/** Symboles du groupe actif (liste vide si l'id est introuvable). */
function activeSymbols(groups: WatchlistGroup[], activeGroupId: string): string[] {
  return groups.find((g) => g.id === activeGroupId)?.symbols ?? [];
}

/** Vrai si `symbol` figure dans au moins un groupe (pour décider de purger sa source). */
function existsAnywhere(groups: WatchlistGroup[], symbol: string): boolean {
  return groups.some((g) => g.symbols.includes(symbol));
}

/** Purge de `sources` toute clé qui ne figure plus dans aucun groupe (garde la map creuse). */
function pruneSources(
  sources: Record<string, WatchlistSource>,
  groups: WatchlistGroup[]
): Record<string, WatchlistSource> {
  const next: Record<string, WatchlistSource> = {};
  for (const [sym, src] of Object.entries(sources)) {
    if (existsAnywhere(groups, sym)) next[sym] = src;
  }
  return next;
}

/** Slug court unique (base « groupe » + suffixe numérique) pour un nouvel onglet. */
function uniqueGroupId(groups: WatchlistGroup[]): string {
  let n = groups.length + 1;
  let id = `groupe-${n}`;
  const taken = new Set(groups.map((g) => g.id));
  while (taken.has(id)) {
    n += 1;
    id = `groupe-${n}`;
  }
  return id;
}

export const watchlistStore = createStore<WatchlistState>((set, get) => ({
  groups: [{ id: PRINCIPAL_GROUP_ID, name: "Principal", symbols: [...DEFAULT_WATCHLIST] }],
  activeGroupId: PRINCIPAL_GROUP_ID,
  sources: {},
  symbols: [...DEFAULT_WATCHLIST],

  add: (symbol, source) => {
    const s = symbol.trim().toUpperCase();
    if (s.length === 0) return;
    const { groups, activeGroupId } = get();
    const active = groups.find((g) => g.id === activeGroupId);
    if (!active || active.symbols.includes(s)) return; // doublon dans le groupe actif => ignoré
    const nextGroups = groups.map((g) =>
      g.id === activeGroupId ? { ...g, symbols: [...g.symbols, s] } : g
    );
    const sources = source ? { ...get().sources, [s]: source } : get().sources;
    set({ groups: nextGroups, sources, symbols: activeSymbols(nextGroups, activeGroupId) });
  },

  remove: (symbol) => {
    const { groups, activeGroupId } = get();
    const nextGroups = groups.map((g) =>
      g.id === activeGroupId ? { ...g, symbols: g.symbols.filter((s) => s !== symbol) } : g
    );
    set({
      groups: nextGroups,
      sources: pruneSources(get().sources, nextGroups),
      symbols: activeSymbols(nextGroups, activeGroupId),
    });
  },

  move: (symbol, dir) => {
    const { groups, activeGroupId } = get();
    const active = groups.find((g) => g.id === activeGroupId);
    if (!active) return;
    const i = active.symbols.indexOf(symbol);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= active.symbols.length) return; // hors bornes => no-op
    const reordered = active.symbols.slice();
    const a = reordered[i];
    const b = reordered[j];
    if (a === undefined || b === undefined) return;
    reordered[i] = b;
    reordered[j] = a;
    const nextGroups = groups.map((g) => (g.id === activeGroupId ? { ...g, symbols: reordered } : g));
    set({ groups: nextGroups, symbols: activeSymbols(nextGroups, activeGroupId) });
  },

  setActiveGroup: (id) => {
    const { groups } = get();
    if (!groups.some((g) => g.id === id)) return;
    set({ activeGroupId: id, symbols: activeSymbols(groups, id) });
  },

  addGroup: (name) => {
    const label = name.trim();
    if (label.length === 0) return;
    const { groups } = get();
    const id = uniqueGroupId(groups);
    const nextGroups = [...groups, { id, name: label, symbols: [] as string[] }];
    set({ groups: nextGroups, activeGroupId: id, symbols: [] });
  },

  removeGroup: (id) => {
    const { groups, activeGroupId } = get();
    if (groups.length <= 1) return; // on garde toujours au moins un onglet
    const nextGroups = groups.filter((g) => g.id !== id);
    if (nextGroups.length === groups.length) return; // id inconnu
    const nextActive = activeGroupId === id ? (nextGroups[0]?.id ?? PRINCIPAL_GROUP_ID) : activeGroupId;
    set({
      groups: nextGroups,
      activeGroupId: nextActive,
      sources: pruneSources(get().sources, nextGroups),
      symbols: activeSymbols(nextGroups, nextActive),
    });
  },

  setAll: (symbols, sources) => {
    const groups: WatchlistGroup[] = [
      { id: PRINCIPAL_GROUP_ID, name: "Principal", symbols: [...symbols] },
    ];
    set({ groups, activeGroupId: PRINCIPAL_GROUP_ID, sources: sources ?? {}, symbols: [...symbols] });
  },
}));
