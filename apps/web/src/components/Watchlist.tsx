/**
 * Watchlist — panneau latéral droit des favoris, façon « monitor / quote board » (roadmap 1.4).
 *
 * Grille dense par symbole : prix, Δ% 24h, et — selon les colonnes activées — Δ% 1h/7j, volume
 * 24h et une sparkline 24h. Colonnes configurables (menu ⚙) et triables (clic sur l'en-tête).
 * Onglets de GROUPES en tête ; réordonnancement manuel par boutons ▲/▼ au survol.
 *
 * HAUTE FRÉQUENCE : prix / Δ%24h / volume (WS/poll ticker) et Δ%1h/7j / sparkline (refresh lent
 * 5 min) sont écrits IMPÉRATIVEMENT dans le DOM via des refs (aucun state React pour ces valeurs
 * → aucun re-render sur tick, cf. BUILD-CONTRACT). Le composant ne se re-rend qu'au changement de
 * LISTE, d'onglet, de colonnes visibles ou de tri.
 *
 * TRI : par instantané (les valeurs live vivent hors React). Cliquer un en-tête fige l'ordre
 * d'après les DERNIÈRES valeurs connues ; les ticks suivants mettent à jour les cellules mais NON
 * l'ordre (re-cliquer pour re-trier). Le réordonnancement manuel n'est proposé qu'en mode « tri
 * manuel » (aucune colonne active). Un clic sur une ligne change le symbole du graphe (et restaure
 * la source d'origine de l'entrée si elle est explicite).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { marketStore } from "../store/market";
import { watchlistStore, type WatchlistSource } from "../store/watchlist";
import { subscribeTickers, subscribeWatchlistBars, isTickerSource, resolveTickerSource, resolveTickerMarket } from "../data/ticker";
import type { TickerUpdate, WatchlistBars } from "../data/ticker";
import { fetchMarketCatalog, subscribeMarketCatalog, type MarketCatalog } from "../data/marketRouting";
import { SidebarSection } from "./SidebarSection";
import { MenuDeroulant } from "./ui";
import { formatCompact, formatPct, formatPrice, VALEUR_ABSENTE } from "../lib/format";
import { lireTokenCanvas } from "../lib/canvasTokens";

/** Colonnes métriques (hors prix, toujours affiché) : clés = champs de `RowCells` + snapshot. */
type MetricKey = "change24h" | "change1h" | "change7d" | "volume";
/** Clés de tri : colonnes métriques + nom de symbole. */
type SortKey = "symbol" | MetricKey;

/** Cellules DOM d'une ligne, mises à jour impérativement (hors render-loop). */
interface RowCells {
  price: HTMLSpanElement | null;
  change24h: HTMLSpanElement | null;
  change1h: HTMLSpanElement | null;
  change7d: HTMLSpanElement | null;
  volume: HTMLSpanElement | null;
  spark: HTMLCanvasElement | null;
}

/** Dernières valeurs connues par symbole (source du tri par instantané + du repaint). */
interface Snapshot {
  price?: number;
  change24h?: number;
  change1h?: number;
  change7d?: number;
  volume?: number;
  sparkPoints?: number[];
}

/** Colonnes affichables/masquables via le menu ⚙ (le prix reste toujours visible). */
interface VisibleCols {
  change24h: boolean;
  change1h: boolean;
  change7d: boolean;
  volume: boolean;
  spark: boolean;
}

/** Largeur (classe Tailwind) partagée en-tête / cellules pour aligner les colonnes. */
const COL_WIDTH: Record<"price" | MetricKey, string> = {
  // Prix élargi à 68px (et rendu en text-xs côté cellule) pour contenir INTÉGRALEMENT un
  // prix crypto à 6 chiffres (« 108,432.50 ») sans déborder sur la colonne suivante (audit
  // vague 1, garde-fou). Les 12px repris viennent de la colonne 24h (moins contrainte).
  price: "w-[68px]",
  change24h: "w-11",
  change1h: "w-12",
  change7d: "w-12",
  volume: "w-14",
};

/** Libellés courts des colonnes métriques (en-tête). */
const METRIC_META: { key: MetricKey; label: string }[] = [
  { key: "change24h", label: "24h" },
  { key: "change1h", label: "1h" },
  { key: "change7d", label: "7j" },
  { key: "volume", label: "Vol" },
];

/** Colonnes visibles par défaut (compact : 24h + sparkline ; le reste au choix via ⚙). */
const DEFAULT_COLS: VisibleCols = {
  change24h: true,
  change1h: false,
  change7d: false,
  volume: false,
  spark: true,
};

/** Largeur minimale réservée au ticker (BTCUSDT / ETHUSDT / SOLUSDT tiennent en entier). */
export const LARGEUR_MIN_SYMBOLE_CH = 7;

/** Sous 280 px (sidebar w-60 = 240), la sparkline cède la place au symbole. */
export function colonnesWatchlistPourLargeur(largeurPx: number): { change24h: boolean; spark: boolean } {
  return {
    change24h: largeurPx >= 200,
    spark: largeurPx >= 280,
  };
}

/** Écrit une cellule de variation en % (couleur via tokens --up/--down ; « — » si absente). */
function writePctCell(el: HTMLSpanElement, pct: number | null | undefined): void {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    el.textContent = VALEUR_ABSENTE;
    el.style.color = ""; // couleur neutre héritée
    return;
  }
  el.textContent = formatPct(pct);
  el.style.color = pct >= 0 ? "var(--up)" : "var(--down)";
}

/** Couleurs up/down résolues depuis les tokens du thème courant (pour le canvas). */
function readUpDownColors(): { up: string; down: string } {
  return {
    up: lireTokenCanvas("--up", "#2dc08e"),
    down: lireTokenCanvas("--down", "#f92855"),
  };
}

/** Dessine une sparkline (60×18) depuis des clôtures ; couleur = sens (dernier vs premier). */
function drawSparkline(
  canvas: HTMLCanvasElement,
  points: number[],
  colors: { up: string; down: string }
): void {
  // Largeur réduite à 40px (au lieu de 60) pour tenir dans la sidebar w-60 sans clipper
  // l'en-tête de colonnes (cf. audit #12) ; doit rester synchro avec la colonne « 24h ».
  const W = 40;
  const H = 18;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const finite = points.filter((p) => Number.isFinite(p));
  if (finite.length < 2) return;
  let min = Infinity;
  let max = -Infinity;
  for (const p of finite) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  const range = max - min || 1;
  const pad = 2;
  const first = finite[0] ?? 0;
  const last = finite[finite.length - 1] ?? 0;
  ctx.strokeStyle = last >= first ? colors.up : colors.down;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < finite.length; i++) {
    const p = finite[i];
    if (p === undefined) continue;
    const x = pad + (i / (finite.length - 1)) * (W - 2 * pad);
    const y = pad + (1 - (p - min) / range) * (H - 2 * pad);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** Places spot secondaires : Binance, source de référence, les remplace pour un même spot listé. */
const PLACES_SPOT_SECONDAIRES: ReadonlySet<string> = new Set<WatchlistSource>(["kraken", "coinbase", "bybit", "okx", "mexc"]);
const listeParBinance = (catalog: MarketCatalog, symbol: string) =>
  catalog.instruments.some((i) => i.exchange === "binance" && i.kind === "spot" && i.symbol === symbol);
/** Un favori sans prix confirmé est réessayé : les prix peuvent revenir sans nouveau catalogue. */
const REESSAI_PROVENANCE_MS = 30_000;
/** Confirmations de la session : la watchlist démontée (plein écran) ne resonde rien à son retour. */
const CONFIRMEES_SESSION = new Map<string, WatchlistSource>();

/**
 * Provenances des favoris du groupe actif, hors React (testée à timers simulés). Une source
 * n'est retenue qu'après un vrai prix ou un graphe prêt, puis n'est plus sondée de la session
 * (`confirmees`, propre à la session par défaut ; les tests en passent une neuve) :
 *  - seuls les favoris sans source confirmée sont sondés, au catalogue reçu ou republié, à
 *    chaque changement de liste ou de source (réhydratation) et toutes les 30 s tant qu'il en reste ;
 *  - les synthétiques et capitalisations, sans ticker dédié, restent sans prix de favoris :
 *    ni sondés, ni réessayés ;
 *  - un favori Binance que le catalogue Binance liste est confirmé sans sonde : un ticker Binance
 *    en panne ou lent ne le fait jamais glisser vers une place de repli ;
 *  - une place spot secondaire héritée est resondée Binance d'abord quand le catalogue Binance
 *    liste le même spot ; sans prix Binance, le favori garde sa place d'origine.
 * Les sondes routent sur le catalogue reçu : elles ne relancent pas le rafraîchissement commun.
 */
export function suivreProvenancesFavoris(confirmees = CONFIRMEES_SESSION): () => void {
  let catalog: MarketCatalog | undefined;
  let passe: AbortController | undefined;
  let reessai: ReturnType<typeof setInterval> | undefined;
  let arrete = false;

  const confirmer = (symbol: string, source: WatchlistSource) => {
    const avant = confirmees.get(symbol);
    // Notée avant l'écriture : la notification synchrone du store n'y voit pas un changement externe.
    confirmees.set(symbol, source);
    watchlistStore.getState().setSource(symbol, source);
    if (watchlistStore.getState().sources[symbol] === source) return;
    if (avant === undefined) confirmees.delete(symbol);
    else confirmees.set(symbol, avant);
  };
  const aSonder = (): string[] => {
    const { symbols, sources } = watchlistStore.getState();
    return symbols.filter((symbol) => {
      const source = sources[symbol];
      if (!isTickerSource(resolveTickerSource(symbol, source))) return false;
      return source === undefined || confirmees.get(symbol) !== source;
    });
  };
  const ajusterReessai = (actif: boolean) => {
    if (actif && reessai === undefined) reessai = setInterval(lancerPasse, REESSAI_PROVENANCE_MS);
    if (!actif && reessai !== undefined) { clearInterval(reessai); reessai = undefined; }
  };

  function lancerPasse(): void {
    if (arrete || !catalog) return;
    const courant = catalog;
    // Le catalogue Binance prouve déjà la source : une sonde ne pourrait que la perdre.
    const { symbols, sources } = watchlistStore.getState();
    for (const symbol of symbols) {
      if (sources[symbol] === "binance" && confirmees.get(symbol) !== "binance" && listeParBinance(courant, symbol)) confirmer(symbol, "binance");
    }
    passe?.abort();
    const controller = new AbortController();
    passe = controller;
    const symboles = aSonder();
    ajusterReessai(symboles.length > 0);
    void Promise.all(symboles.map(async (symbol) => {
      try {
        const before = marketStore.getState();
        if (before.symbol === symbol && before.dataLoad.status === "ready") return confirmer(symbol, before.exchange);
        const initialSource = watchlistStore.getState().sources[symbol];
        const versBinance = initialSource !== undefined && PLACES_SPOT_SECONDAIRES.has(initialSource) && listeParBinance(courant, symbol);
        // Binance d'abord, sinon la place d'origine : jamais une troisième place pour ce spot.
        const routage: MarketCatalog = versBinance ? {
          instruments: courant.instruments.filter((i) => i.kind === "spot" && i.symbol === symbol && (i.exchange === "binance" || i.exchange === initialSource)),
          unavailableSources: [],
        } : courant;
        const resolved = await resolveTickerMarket({ exchange: versBinance ? "binance" : initialSource, symbol, timeframe: "1h" }, controller.signal, routage);
        if (controller.signal.aborted) return;
        const market = marketStore.getState();
        if (market.symbol === symbol && market.dataLoad.status === "ready") confirmer(symbol, market.exchange);
        else if (resolved && watchlistStore.getState().sources[symbol] === initialSource) confirmer(symbol, resolved.exchange);
      } catch { /* Sans prix confirmé : réessayé au prochain catalogue ou dans 30 s. */ }
    })).then(() => { if (!controller.signal.aborted) ajusterReessai(aSonder().length > 0); });
  }

  const recevoir = (value: MarketCatalog) => { catalog = value; lancerPasse(); };
  const stopCatalogue = subscribeMarketCatalog(recevoir);
  void fetchMarketCatalog().then((value) => { if (value !== catalog) recevoir(value); }).catch(() => {});
  const cleListe = (symbols: readonly string[]) => symbols.slice().sort().join(",");
  let liste = cleListe(watchlistStore.getState().symbols);
  const stopListe = watchlistStore.subscribe((state) => {
    const suivante = cleListe(state.symbols);
    // Une source confirmée changée ailleurs (réhydratation daemon, autre appareil) est resondée.
    let changee = false;
    for (const symbol of state.symbols) {
      const confirmee = confirmees.get(symbol);
      if (confirmee !== undefined && state.sources[symbol] !== confirmee) { confirmees.delete(symbol); changee = true; }
    }
    if (suivante === liste && !changee) return;
    liste = suivante;
    lancerPasse();
  });
  // Tout chargement prêt confirme sa source (jamais resondée ensuite).
  const stopMarche = marketStore.subscribe((state) => {
    if (state.dataLoad.status === "ready") confirmer(state.symbol, state.exchange);
  });

  return () => {
    arrete = true;
    passe?.abort();
    ajusterReessai(false);
    stopCatalogue();
    stopListe();
    stopMarche();
  };
}

/** Enregistre/retire une cellule DOM dans la map (callback de ref). */
function registerCell(
  map: Map<string, RowCells>,
  symbol: string,
  field: keyof RowCells,
  el: HTMLElement | null
): void {
  const cells = map.get(symbol) ?? {
    price: null,
    change24h: null,
    change1h: null,
    change7d: null,
    volume: null,
    spark: null,
  };
  // Le callback de ref fournit toujours le bon type d'élément pour le champ visé.
  cells[field] = el as (HTMLSpanElement & HTMLCanvasElement) | null;
  if (Object.values(cells).every((v) => v === null)) map.delete(symbol);
  else map.set(symbol, cells);
}

export function Watchlist() {
  const groups = useStore(watchlistStore, (s) => s.groups);
  const activeGroupId = useStore(watchlistStore, (s) => s.activeGroupId);
  const symbols = useStore(watchlistStore, (s) => s.symbols);
  const sources = useStore(watchlistStore, (s) => s.sources);
  const add = useStore(watchlistStore, (s) => s.add);
  const remove = useStore(watchlistStore, (s) => s.remove);
  const move = useStore(watchlistStore, (s) => s.move);
  const setActiveGroup = useStore(watchlistStore, (s) => s.setActiveGroup);
  const addGroup = useStore(watchlistStore, (s) => s.addGroup);
  const removeGroup = useStore(watchlistStore, (s) => s.removeGroup);

  const currentSymbol = useStore(marketStore, (s) => s.symbol);

  const [draft, setDraft] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState("");
  const [visibleCols, setVisibleCols] = useState<VisibleCols>(DEFAULT_COLS);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const [largeurListe, setLargeurListe] = useState(240);
  const listeRef = useRef<HTMLDivElement>(null);

  // Cellules DOM (maj impérative) + dernières valeurs connues (tri par instantané + repaint).
  const cells = useRef(new Map<string, RowCells>());
  const latest = useRef(new Map<string, Snapshot>());

  /** Renvoie (en la créant au besoin) l'entrée de snapshot d'un symbole. */
  const snapOf = (symbol: string): Snapshot => {
    let s = latest.current.get(symbol);
    if (!s) {
      s = {};
      latest.current.set(symbol, s);
    }
    return s;
  };

  const espace = colonnesWatchlistPourLargeur(largeurListe);
  const sparkVisible = visibleCols.spark && espace.spark;
  const change24hVisible = visibleCols.change24h && espace.change24h;

  // Colonnes métriques réellement visibles (ordre figé de METRIC_META).
  const metricCols = useMemo(
    () =>
      METRIC_META.filter((c) => {
        if (c.key === "change24h") return change24hVisible;
        return visibleCols[c.key];
      }),
    [visibleCols, change24hVisible]
  );

  useLayoutEffect(() => {
    const el = listeRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const appliquer = (): void => setLargeurListe(el.getBoundingClientRect().width);
    appliquer();
    const obs = new ResizeObserver(appliquer);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Clé stable de l'ENSEMBLE des symboles (indépendante de l'ordre) : un simple
  // réordonnancement ne doit PAS reconnecter le flux ticker ni relancer le poller
  // (les souscriptions ne dépendent que du SET, pas de l'ordre d'affichage).
  const symbolsKey = useMemo(() => symbols.slice().sort().join(","), [symbols]);

  const sourcesKey = symbols.map((symbol) => `${symbol}:${sources[symbol] ?? ""}`).sort().join(",");

  // Un catalogue rétabli relance les prix absents ; une source confirmée n'est plus sondée.
  useEffect(() => suivreProvenancesFavoris(), []);

  // Ordre d'affichage : liste stockée en mode manuel, sinon tri par instantané des valeurs.
  const displayOrder = useMemo(() => {
    if (!sort) return symbols;
    const snap = latest.current;
    const mul = sort.dir === "asc" ? 1 : -1;
    return symbols.slice().sort((a, b) => {
      if (sort.key === "symbol") return a.localeCompare(b) * mul;
      const va = snap.get(a)?.[sort.key];
      const vb = snap.get(b)?.[sort.key];
      // Valeurs absentes (« — ») toujours reléguées en fin, quel que soit le sens.
      if (va === undefined && vb === undefined) return 0;
      if (va === undefined) return 1;
      if (vb === undefined) return -1;
      return (va - vb) * mul;
    });
    // latest.current est une ref (hors render) : le tri est un instantané volontaire.
  }, [symbols, sort]);

  // Souscription ticker (prix / Δ%24h / volume) quand la liste de symboles change.
  useEffect(() => {
    const onTicker = ({ symbol, price, changePercent, quoteVolume }: TickerUpdate) => {
      if (sources[symbol] !== watchlistStore.getState().sources[symbol]) return;
      const snap = snapOf(symbol);
      snap.price = price;
      snap.change24h = changePercent;
      if (quoteVolume !== undefined) snap.volume = quoteVolume;
      const row = cells.current.get(symbol);
      if (!row) return;
      if (row.price) row.price.textContent = formatPrice(price);
      if (row.change24h) writePctCell(row.change24h, changePercent);
      if (row.volume && quoteVolume !== undefined) row.volume.textContent = formatCompact(quoteVolume);
    };
    latest.current.clear();
    for (const row of cells.current.values()) {
      for (const key of ["price", "change24h", "volume", "change1h", "change7d"] as const) {
        const cell = row[key]; if (cell) cell.textContent = "—";
      }
      row.spark?.getContext("2d")?.clearRect(0, 0, row.spark.width, row.spark.height);
    }
    return subscribeTickers(symbols.filter((symbol) => sources[symbol] !== undefined), onTicker);
    // Dép. sur le SET (symbolsKey), pas sur l'ordre : le réordonnancement ne reconnecte rien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey, sourcesKey]);

  // Souscription statistiques enrichies (Δ%1h/7j + sparkline) au refresh lent (5 min).
  useEffect(() => {
    const onBars = ({ symbol, change1h, change7d, spark }: WatchlistBars) => {
      if (sources[symbol] !== watchlistStore.getState().sources[symbol]) return;
      const snap = snapOf(symbol);
      snap.change1h = change1h ?? undefined;
      snap.change7d = change7d ?? undefined;
      snap.sparkPoints = spark;
      const row = cells.current.get(symbol);
      if (!row) return;
      if (row.change1h) writePctCell(row.change1h, change1h);
      if (row.change7d) writePctCell(row.change7d, change7d);
      if (row.spark) drawSparkline(row.spark, spark, readUpDownColors());
    };
    return subscribeWatchlistBars(symbols.filter((symbol) => sources[symbol] !== undefined), onBars);
    // Dép. sur le SET (symbolsKey), pas sur l'ordre (cf. souscription ticker ci-dessus).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey, sourcesKey]);

  // Repaint depuis les dernières valeurs connues après tout re-render de structure (changement
  // de liste, d'onglet, de colonnes ou de tri) : évite le flash « — » d'une cellule qui vient
  // (ré)apparaître avant le prochain tick / refresh lent. useLayoutEffect => refs déjà attachées.
  useLayoutEffect(() => {
    const colors = readUpDownColors();
    cells.current.forEach((row, sym) => {
      const snap = latest.current.get(sym);
      if (!snap) return;
      if (row.price && snap.price !== undefined) row.price.textContent = formatPrice(snap.price);
      if (row.change24h) writePctCell(row.change24h, snap.change24h);
      if (row.change1h) writePctCell(row.change1h, snap.change1h);
      if (row.change7d) writePctCell(row.change7d, snap.change7d);
      if (row.volume && snap.volume !== undefined) row.volume.textContent = formatCompact(snap.volume);
      if (row.spark && snap.sparkPoints) drawSparkline(row.spark, snap.sparkPoints, colors);
    });
  }, [displayOrder, metricCols, sparkVisible]);

  const submitAdd = () => {
    add(draft);
    setDraft("");
  };

  const submitGroup = () => {
    addGroup(groupDraft);
    setGroupDraft("");
    setAddingGroup(false);
  };

  /** La provenance d'un prix déjà confirmé est transmise atomiquement au graphe. */
  const selectSymbol = (sym: string) => {
    const market = marketStore.getState();
    const source = watchlistStore.getState().sources[sym];
    if (source) market.setMarket({ exchange: source, symbol: sym, timeframe: market.timeframe });
    else market.setSymbol(sym);
  };

  /** Cycle de tri d'une colonne : (inactif→desc→asc→manuel) ; symbole part en asc. */
  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: key === "symbol" ? "asc" : "desc" };
      if (key === "symbol") return prev.dir === "asc" ? { key, dir: "desc" } : null;
      return prev.dir === "desc" ? { key, dir: "asc" } : null;
    });
  };

  const sortMark = (key: SortKey): string => {
    if (!sort || sort.key !== key) return "";
    return sort.dir === "asc" ? " ▲" : " ▼";
  };

  const manual = sort === null;
  const pairCount = `${symbols.length} paire${symbols.length > 1 ? "s" : ""}`;

  // Menu ⚙ des colonnes — primitive MenuDeroulant (Échap, clic extérieur, ↑/↓).
  const columnsMenu = (
    <MenuDeroulant
      declencheur="⚙"
      titre="Colonnes"
      ariaLabel="Colonnes de la watchlist"
      align="right"
      classePanneau="w-36"
      chevron={false}
      declencheurClasse="text-text-dim transition hover:text-text"
    >
      {() =>
        (
          [
            { key: "change24h" as const, label: "Δ% 24h" },
            { key: "change1h" as const, label: "Δ% 1h" },
            { key: "change7d" as const, label: "Δ% 7j" },
            { key: "volume" as const, label: "Volume 24h" },
            { key: "spark" as const, label: "Sparkline" },
          ] as const
        ).map((c) => (
          <label
            key={c.key}
            role="menuitem"
            tabIndex={-1}
            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] text-text hover:bg-bg"
          >
            <input
              type="checkbox"
              checked={visibleCols[c.key]}
              onChange={() => setVisibleCols((v) => ({ ...v, [c.key]: !v[c.key] }))}
              className="accent-accent"
            />
            {c.label}
          </label>
        ))
      }
    </MenuDeroulant>
  );

  return (
    <SidebarSection title="Watchlist" grow collapsible badge={pairCount} action={columnsMenu}>
      {/* Onglets de groupes */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setActiveGroup(g.id)}
            className={`shrink-0 rounded px-2 py-0.5 text-[10px] transition ${
              g.id === activeGroupId
                ? "bg-accent text-accent-ink"
                : "text-text-dim hover:text-text"
            }`}
          >
            {g.name}
          </button>
        ))}
        {groups.length > 1 && (
          <button
            type="button"
            onClick={() => removeGroup(activeGroupId)}
            aria-label="Supprimer l'onglet actif"
            className="shrink-0 px-1 text-text-dim transition hover:text-down"
          >
            −
          </button>
        )}
        {addingGroup ? (
          <input
            autoFocus
            value={groupDraft}
            onChange={(e) => setGroupDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitGroup();
              if (e.key === "Escape") {
                setGroupDraft("");
                setAddingGroup(false);
              }
            }}
            onBlur={() => {
              setGroupDraft("");
              setAddingGroup(false);
            }}
            placeholder="Nom"
            spellCheck={false}
            className="w-16 shrink-0 rounded border border-border bg-bg px-1 py-0.5 text-[10px] text-text outline-none focus:border-accent"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingGroup(true)}
            aria-label="Nouvel onglet"
            className="shrink-0 px-1 text-text-dim transition hover:text-text"
          >
            +
          </button>
        )}
      </div>

      {/* En-tête de colonnes (tri au clic). Pas d'espace réservé aux actions hors-flux. */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-1.5 py-1 text-[9px] uppercase tracking-wider text-text-dim">
        <button
          type="button"
          onClick={() => toggleSort("symbol")}
          className="min-w-[7ch] shrink-0 pl-1 text-left transition hover:text-text"
        >
          Sym{sortMark("symbol")}
        </button>
        <span className={`${COL_WIDTH.price} shrink-0 text-right`}>Prix</span>
        {metricCols.map((col) => (
          <button
            key={col.key}
            type="button"
            onClick={() => toggleSort(col.key)}
            className={`${COL_WIDTH[col.key]} shrink-0 text-right transition hover:text-text`}
          >
            {col.label}
            {sortMark(col.key)}
          </button>
        ))}
        {sparkVisible && <span className="w-[40px] shrink-0 text-right">24h</span>}
      </div>

      {/* Lignes — `min-h-[8rem]` (et non `min-h-0`) impose un plancher : la liste des
          paires reste visible/défilable même quand « Santé sources » se déploie et que
          l'aside doit défiler, tout en autorisant le scroll interne quand la place manque. */}
      <div ref={listeRef} className="min-h-[8rem] flex-1 overflow-y-auto">
        {symbols.length === 0 && (
          <p className="px-3 py-3 text-[11px] text-text-dim">
            Aucune paire dans cet onglet. Ajoutez-en une ci-dessous.
          </p>
        )}
        {displayOrder.map((sym, i) => {
          const selected = sym === currentSymbol;
          return (
            <div
              key={sym}
              className={`group relative flex items-center gap-1.5 border-l-2 pr-1.5 text-sm ${
                selected ? "border-accent bg-surface" : "border-transparent hover:bg-surface"
              }`}
            >
              {manual && (
                <span className="absolute right-5 top-1/2 z-10 hidden -translate-y-1/2 flex-col group-hover:flex group-focus-within:flex">
                  <button
                    type="button"
                    onClick={() => move(sym, -1)}
                    disabled={i === 0}
                    aria-label={`Monter ${sym}`}
                    className="text-[8px] leading-none text-text-dim transition hover:text-text disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => move(sym, 1)}
                    disabled={i === displayOrder.length - 1}
                    aria-label={`Descendre ${sym}`}
                    className="text-[8px] leading-none text-text-dim transition hover:text-text disabled:opacity-30"
                  >
                    ▼
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={() => selectSymbol(sym)}
                className="flex min-w-[7ch] shrink-0 items-center py-1.5 pl-1 text-left"
              >
                <span className={`whitespace-nowrap font-medium ${selected ? "text-text" : "text-text-dim"}`}>
                  {sym}
                  {!isTickerSource(resolveTickerSource(sym, sources[sym])) && <span className="block text-[9px] font-normal text-text-dim" title={`Source : ${resolveTickerSource(sym, sources[sym])}`}>ticker indisponible</span>}
                </span>
              </button>
              <span
                ref={(el) => registerCell(cells.current, sym, "price", el)}
                className={`${COL_WIDTH.price} shrink-0 overflow-hidden text-right text-xs tabular-nums text-text`}
              >
                —
              </span>
              {metricCols.map((col) => (
                <span
                  key={col.key}
                  ref={(el) => registerCell(cells.current, sym, col.key, el)}
                  className={`${COL_WIDTH[col.key]} shrink-0 text-right text-[10px] tabular-nums text-text-dim`}
                >
                  —
                </span>
              ))}
              {sparkVisible && (
                <canvas
                  ref={(el) => registerCell(cells.current, sym, "spark", el)}
                  width={40}
                  height={18}
                  className="h-[18px] w-[40px] shrink-0"
                />
              )}
              <button
                type="button"
                onClick={() => remove(sym)}
                aria-label={`Retirer ${sym}`}
                className="absolute right-1 top-1/2 z-10 hidden -translate-y-1/2 text-text-dim hover:text-text group-hover:block group-focus-within:block"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* Ajout de paire */}
      <div className="shrink-0 border-t border-border p-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitAdd();
          }}
          placeholder="Ajouter (ex. BNBUSDT)"
          spellCheck={false}
          className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-text outline-none placeholder:text-text-dim focus:border-accent"
        />
      </div>
    </SidebarSection>
  );
}
