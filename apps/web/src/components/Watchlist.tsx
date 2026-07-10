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
import { watchlistStore } from "../store/watchlist";
import { subscribeTickers, subscribeWatchlistBars } from "../data/ticker";
import type { TickerUpdate, WatchlistBars } from "../data/ticker";
import { SidebarSection } from "./SidebarSection";
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
  price: "w-16",
  change24h: "w-14",
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
  const W = 60;
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
  const add = useStore(watchlistStore, (s) => s.add);
  const remove = useStore(watchlistStore, (s) => s.remove);
  const move = useStore(watchlistStore, (s) => s.move);
  const setActiveGroup = useStore(watchlistStore, (s) => s.setActiveGroup);
  const addGroup = useStore(watchlistStore, (s) => s.addGroup);
  const removeGroup = useStore(watchlistStore, (s) => s.removeGroup);

  const currentSymbol = useStore(marketStore, (s) => s.symbol);
  const setSymbol = useStore(marketStore, (s) => s.setSymbol);
  const setExchange = useStore(marketStore, (s) => s.setExchange);

  const [draft, setDraft] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState("");
  const [visibleCols, setVisibleCols] = useState<VisibleCols>(DEFAULT_COLS);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);

  // Cellules DOM (maj impérative) + dernières valeurs connues (tri par instantané + repaint).
  const cells = useRef(new Map<string, RowCells>());
  const latest = useRef(new Map<string, Snapshot>());
  const menuRef = useRef<HTMLDivElement | null>(null);

  /** Renvoie (en la créant au besoin) l'entrée de snapshot d'un symbole. */
  const snapOf = (symbol: string): Snapshot => {
    let s = latest.current.get(symbol);
    if (!s) {
      s = {};
      latest.current.set(symbol, s);
    }
    return s;
  };

  // Colonnes métriques réellement visibles (ordre figé de METRIC_META).
  const metricCols = useMemo(
    () => METRIC_META.filter((c) => visibleCols[c.key]),
    [visibleCols]
  );

  // Clé stable de l'ENSEMBLE des symboles (indépendante de l'ordre) : un simple
  // réordonnancement ne doit PAS reconnecter le flux ticker ni relancer le poller
  // (les souscriptions ne dépendent que du SET, pas de l'ordre d'affichage).
  const symbolsKey = useMemo(() => symbols.slice().sort().join(","), [symbols]);

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
    return subscribeTickers(symbols, onTicker);
    // Dép. sur le SET (symbolsKey), pas sur l'ordre : le réordonnancement ne reconnecte rien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey]);

  // Souscription statistiques enrichies (Δ%1h/7j + sparkline) au refresh lent (5 min).
  useEffect(() => {
    const onBars = ({ symbol, change1h, change7d, spark }: WatchlistBars) => {
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
    return subscribeWatchlistBars(symbols, onBars);
    // Dép. sur le SET (symbolsKey), pas sur l'ordre (cf. souscription ticker ci-dessus).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey]);

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
  }, [displayOrder, metricCols, visibleCols.spark]);

  // Fermeture du menu ⚙ au clic hors de son conteneur.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const submitAdd = () => {
    add(draft);
    setDraft("");
  };

  const submitGroup = () => {
    addGroup(groupDraft);
    setGroupDraft("");
    setAddingGroup(false);
  };

  /** Clic sur une ligne : change de symbole et restaure la source d'origine si explicite. */
  const selectSymbol = (sym: string) => {
    const src = watchlistStore.getState().sources[sym];
    if (src) setExchange(src);
    setSymbol(sym);
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

  // Menu ⚙ des colonnes, placé dans le slot d'action de la section.
  const columnsMenu = (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        aria-label="Colonnes"
        aria-expanded={menuOpen}
        className="text-text-dim transition hover:text-text"
      >
        ⚙
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-5 z-20 w-36 rounded border border-border bg-surface p-1 shadow-lg">
          {[
            { key: "change24h" as const, label: "Δ% 24h" },
            { key: "change1h" as const, label: "Δ% 1h" },
            { key: "change7d" as const, label: "Δ% 7j" },
            { key: "volume" as const, label: "Volume 24h" },
            { key: "spark" as const, label: "Sparkline" },
          ].map((c) => (
            <label
              key={c.key}
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
          ))}
        </div>
      )}
    </div>
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

      {/* En-tête de colonnes (tri au clic) */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-1.5 py-1 text-[9px] uppercase tracking-wider text-text-dim">
        {manual && <span className="w-3 shrink-0" aria-hidden />}
        <button
          type="button"
          onClick={() => toggleSort("symbol")}
          className="flex flex-1 items-center pl-1 text-left transition hover:text-text"
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
        {visibleCols.spark && <span className="w-[60px] shrink-0 text-right">24h</span>}
        <span className="w-3.5 shrink-0" aria-hidden />
      </div>

      {/* Lignes */}
      <div className="min-h-0 flex-1 overflow-y-auto">
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
              className={`group flex items-center gap-1.5 border-l-2 pr-1.5 text-sm ${
                selected ? "border-accent bg-surface" : "border-transparent hover:bg-surface"
              }`}
            >
              {manual && (
                <span className="flex w-3 shrink-0 flex-col opacity-0 transition group-hover:opacity-100">
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
                className="flex min-w-0 flex-1 items-center py-1.5 pl-1 text-left"
              >
                <span className={`truncate font-medium ${selected ? "text-text" : "text-text-dim"}`}>
                  {sym}
                </span>
              </button>
              <span
                ref={(el) => registerCell(cells.current, sym, "price", el)}
                className={`${COL_WIDTH.price} shrink-0 text-right tabular-nums text-text`}
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
              {visibleCols.spark && (
                <canvas
                  ref={(el) => registerCell(cells.current, sym, "spark", el)}
                  width={60}
                  height={18}
                  className="h-[18px] w-[60px] shrink-0"
                />
              )}
              <button
                type="button"
                onClick={() => remove(sym)}
                aria-label={`Retirer ${sym}`}
                className="w-3.5 shrink-0 text-text-dim opacity-0 transition hover:text-text group-hover:opacity-100"
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
