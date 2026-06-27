/**
 * Watchlist — panneau latéral droit des symboles favoris.
 *
 * Prix et variation 24 h sont LIVE : écrits IMPÉRATIVEMENT dans le DOM via des
 * refs (aucun state React pour les valeurs, donc aucun re-render sur tick —
 * cf. BUILD-CONTRACT). Le composant ne se re-rend que lorsque la LISTE de
 * symboles change. Un clic sur une ligne change le symbole du graphe.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { marketStore } from "../store/market";
import { watchlistStore } from "../store/watchlist";
import { subscribeTickers } from "../data/ticker";
import { SidebarSection } from "./SidebarSection";

/** Cellules DOM (prix + variation) d'une ligne, mises à jour impérativement. */
interface RowCells {
  price: HTMLSpanElement | null;
  change: HTMLSpanElement | null;
}

/** Formatte un prix selon son ordre de grandeur. */
function formatPrice(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toPrecision(4);
}

/** Enregistre/retire une cellule DOM dans la map (callback de ref). */
function registerCell(
  map: Map<string, RowCells>,
  symbol: string,
  field: keyof RowCells,
  el: HTMLSpanElement | null
): void {
  const cells = map.get(symbol) ?? { price: null, change: null };
  cells[field] = el;
  if (cells.price === null && cells.change === null) {
    map.delete(symbol);
  } else {
    map.set(symbol, cells);
  }
}

export function Watchlist() {
  const symbols = useStore(watchlistStore, (s) => s.symbols);
  const currentSymbol = useStore(marketStore, (s) => s.symbol);
  const setSymbol = useStore(marketStore, (s) => s.setSymbol);
  const add = useStore(watchlistStore, (s) => s.add);
  const remove = useStore(watchlistStore, (s) => s.remove);

  const [draft, setDraft] = useState("");

  // Map symbole -> cellules DOM, pour mise à jour impérative (hors render-loop).
  const cells = useRef(new Map<string, RowCells>());

  // (Re)souscription au flux ticker quand la liste de symboles change.
  useEffect(() => {
    const unsubscribe = subscribeTickers(symbols, ({ symbol, price, changePercent }) => {
      const row = cells.current.get(symbol);
      if (!row) return;
      if (row.price) row.price.textContent = formatPrice(price);
      if (row.change) {
        const sign = changePercent >= 0 ? "+" : "";
        row.change.textContent = `${sign}${changePercent.toFixed(2)}%`;
        row.change.style.color = changePercent >= 0 ? "#34d399" : "#f87171";
      }
    });
    return unsubscribe;
  }, [symbols]);

  const submitAdd = () => {
    add(draft);
    setDraft("");
  };

  return (
    <SidebarSection title="Watchlist" grow>
      <div className="flex-1 overflow-y-auto">
        {symbols.map((sym) => (
          <div
            key={sym}
            className={`group flex items-center gap-2 px-3 py-2 text-sm ${
              sym === currentSymbol ? "bg-neutral-900" : "hover:bg-neutral-900"
            }`}
          >
            <button
              type="button"
              onClick={() => setSymbol(sym)}
              className="flex flex-1 items-center justify-between gap-2 text-left"
            >
              <span className="font-medium text-neutral-100">{sym}</span>
              <span className="flex flex-col items-end">
                <span
                  ref={(el) => registerCell(cells.current, sym, "price", el)}
                  className="tabular-nums text-neutral-200"
                >
                  —
                </span>
                <span
                  ref={(el) => registerCell(cells.current, sym, "change", el)}
                  className="text-[11px] tabular-nums text-neutral-500"
                >
                  —
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => remove(sym)}
              aria-label={`Retirer ${sym}`}
              className="text-neutral-600 opacity-0 transition hover:text-neutral-300 group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-neutral-800 p-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitAdd();
          }}
          placeholder="Ajouter (ex. BNBUSDT)"
          spellCheck={false}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500"
        />
      </div>
    </SidebarSection>
  );
}
