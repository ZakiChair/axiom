/** Recherche d'actifs unifiée. Les fournisseurs restent une provenance, jamais un choix. */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { ExchangeId } from "@axiom/types";
import { marketStore } from "../store/market";
import { SYNTHETIC_PRESETS, syntheticsStore } from "../store/synthetics";
import { estSymboleCapitalisation } from "../data/mcap";
import { TWELVEDATA_SYMBOLS } from "../data/pairs";
import { encodeSyntheticSymbol, formatSyntheticLabel, parseSyntheticSymbol, type SyntheticLegSource } from "../data/synthetic";
import { fetchMarketCatalog, subscribeMarketCatalog, searchMarkets, resolveMarketCandidates, type MarketCandidate, type MarketCatalog } from "../data/marketRouting";
import { CLASSES_CHAMP } from "./ui";

export interface PairSearchProps {
  /** Comparaison : le moteur ne sait actuellement comparer que sur la source du graphe. */
  onPick?: (symbol: string) => void;
  placeholder?: string;
}

function sourceLabel(source: ExchangeId): string {
  if (source === "twelvedata") return "Twelve Data";
  if (source === "synthetic") return "Capitalisation";
  return source === "okx" ? "OKX" : source === "mexc" ? "MEXC" : source[0]?.toUpperCase() + source.slice(1);
}

export const JAMBE_B_TRADFI_DEFAUT = "GLD";

export function PairSearch({ onPick, placeholder = "Rechercher une paire" }: PairSearchProps = {}) {
  const exchange = useStore(marketStore, (s) => s.exchange);
  const recents = useStore(syntheticsStore, (s) => s.recents);
  const [query, setQuery] = useState("");
  // Ce catalogue local ne dépend d'aucun appel crypto. Il reste propre à l'affichage :
  // le résolveur partagé continue de charger les vrais catalogues des autres marchés.
  const [catalog, setCatalog] = useState<MarketCatalog>(() => ({
    instruments: TWELVEDATA_SYMBOLS.map<MarketCandidate>((symbol) => ({ exchange: "twelvedata", symbol, kind: "tradfi" })),
    unavailableSources: [],
  }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [indexActif, setIndexActif] = useState(0);
  const listeRef = useRef<HTMLUListElement>(null);
  const idListe = useId();
  const [syntheticOpen, setSyntheticOpen] = useState(false);
  const [legA, setLegA] = useState("ETHUSDT");
  const [legB, setLegB] = useState(JAMBE_B_TRADFI_DEFAUT);
  const [op, setOp] = useState<"/" | "-">("/");
  const [building, setBuilding] = useState(false);
  const buildGeneration = useRef(0);
  const catalogGeneration = useRef(0);
  const mounted = useRef(false);
  const lastForcedRefresh = useRef(0);
  useEffect(() => () => { buildGeneration.current += 1; }, []);
  const invalidateBuild = () => { buildGeneration.current += 1; setBuilding(false); setError(null); };

  const refreshCatalog = useCallback((force = false) => {
    // Les ouvertures utilisent le cache partagé ; les reprises réseau répétées sont bornées.
    if (force && Date.now() - lastForcedRefresh.current < 2_000) return;
    if (force) lastForcedRefresh.current = Date.now();
    const generation = ++catalogGeneration.current;
    setLoading(true);
    void fetchMarketCatalog({ force }).then((value) => {
      if (mounted.current && generation === catalogGeneration.current) {
        setCatalog(value); setError(null); setLoading(false);
      }
    }).catch(() => {
      if (mounted.current && generation === catalogGeneration.current) {
        setError("Catalogue indisponible — saisie d’un actif possible."); setLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeMarketCatalog((value) => {
      setCatalog(value); setIndexActif(0); setError(null); setLoading(false);
    });
    refreshCatalog();
    let onlineTimer: ReturnType<typeof setTimeout> | undefined;
    const onFocus = () => refreshCatalog();
    const onOnline = () => {
      clearTimeout(onlineTimer);
      onlineTimer = setTimeout(() => refreshCatalog(true), 400);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      mounted.current = false; catalogGeneration.current += 1;
      unsubscribe(); clearTimeout(onlineTimer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [refreshCatalog]);

  useEffect(() => {
    if (!open || loading || catalog.unavailableSources.length === 0) return;
    // Une erreur HTTP peut disparaître sans événement « online » ni nouveau focus.
    const retry = setTimeout(() => refreshCatalog(), 30_000);
    return () => clearTimeout(retry);
  }, [open, loading, catalog, refreshCatalog]);

  // Le moteur de comparaison garde son périmètre réel : aucune sélection d'un actif
  // d'une autre source qui serait ensuite chargé avec le mauvais adaptateur.
  const searchable = onPick ? { ...catalog, instruments: catalog.instruments.filter((m) => m.exchange === exchange) } : catalog;
  const matches = query.trim() ? searchMarkets(searchable, query, 30) : [];
  const listeVisible = open && !syntheticOpen && matches.length > 0;

  useEffect(() => {
    listeRef.current?.querySelector<HTMLElement>(`[data-idx="${indexActif}"]`)?.scrollIntoView({ block: "nearest" });
  }, [indexActif, query]);

  const close = () => { invalidateBuild(); setQuery(""); setOpen(false); };
  const choose = (candidate: MarketCandidate | string) => {
    const symbol = typeof candidate === "string" ? candidate.trim().toUpperCase() : candidate.symbol;
    if (!symbol) return;
    if (onPick) {
      const available = searchable.instruments.some((m) => m.symbol === symbol);
      if (!available) { setError("Cet actif n’est pas disponible pour la comparaison sur le marché affiché."); return; }
      onPick(symbol);
    } else if (typeof candidate === "string") {
      marketStore.getState().setSymbol(symbol);
    } else {
      const current = marketStore.getState();
      current.setMarket({ exchange: candidate.exchange, symbol, timeframe: candidate.kind === "synthetic" ? "1d" : current.timeframe });
    }
    close();
  };

  const chooseSynthetic = (symbol: string) => {
    const spec = parseSyntheticSymbol(symbol);
    if (!estSymboleCapitalisation(symbol) && !spec) return;
    syntheticsStore.getState().addRecent(symbol);
    const state = marketStore.getState();
    const daily = estSymboleCapitalisation(symbol) || spec?.exA === "mcap" || spec?.exB === "mcap";
    state.setMarket({ exchange: "synthetic", symbol, timeframe: daily ? "1d" : state.timeframe });
    close(); setSyntheticOpen(false);
  };

  const buildSynthetic = async () => {
    setBuilding(true); setError(null);
    const generation = ++buildGeneration.current;
    const before = marketStore.getState();
    const timeframe = before.timeframe;
    try {
      const resolveLeg = async (symbol: string): Promise<{ exchange: SyntheticLegSource; symbol: string }> => {
        const normalized = symbol.trim().toUpperCase();
        if (estSymboleCapitalisation(normalized)) return { exchange: "mcap", symbol: normalized };
        const candidates = await resolveMarketCandidates({ symbol: normalized, timeframe });
        const candidate = candidates.find((c) => c.exchange !== "synthetic" && !c.speculative);
        if (!candidate || candidate.exchange === "synthetic") throw new Error(`Actif indisponible : ${normalized}`);
        return { exchange: candidate.exchange, symbol: candidate.symbol };
      };
      const [a, b] = await Promise.all([resolveLeg(legA), resolveLeg(legB)]);
      const current = marketStore.getState();
      if (generation !== buildGeneration.current || current.exchange !== before.exchange || current.symbol !== before.symbol || current.timeframe !== before.timeframe) return;
      chooseSynthetic(encodeSyntheticSymbol({ exA: a.exchange, legA: a.symbol, exB: b.exchange, legB: b.symbol, op }));
    } catch (err) { if (generation === buildGeneration.current) setError(err instanceof Error ? err.message : "Actifs indisponibles."); }
    finally { if (generation === buildGeneration.current) setBuilding(false); }
  };

  return <div className="relative">
    <div className="flex items-center gap-1">
      <input value={query} onChange={(e) => { setQuery(e.target.value.toUpperCase()); setIndexActif(0); setOpen(true); setError(null); }}
        onFocus={() => { setOpen(true); refreshCatalog(); }} onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && listeVisible) { e.preventDefault(); setIndexActif((i) => Math.min(matches.length - 1, i + 1)); }
          else if (e.key === "ArrowUp" && listeVisible) { e.preventDefault(); setIndexActif((i) => Math.max(0, i - 1)); }
          else if (e.key === "Enter") choose(matches[indexActif] ?? query);
          else if (e.key === "Escape") { invalidateBuild(); setOpen(false); setSyntheticOpen(false); }
        }} placeholder={placeholder} spellCheck={false} autoComplete="off" role="combobox" aria-expanded={listeVisible}
        aria-autocomplete="list" aria-controls={listeVisible ? idListe : undefined}
        aria-activedescendant={listeVisible ? `${idListe}-opt-${indexActif}` : undefined}
        className="w-44 rounded border border-border bg-bg px-2 py-1 text-xs text-text outline-none placeholder:text-text-dim focus:border-accent" aria-label={placeholder} />
      {!onPick && <button type="button" title="Construire une série synthétique" onMouseDown={(e) => { e.preventDefault(); invalidateBuild(); setSyntheticOpen((v) => !v); setOpen(true); refreshCatalog(); }}
        className={`rounded border px-2 py-1 text-xs ${syntheticOpen ? "border-emerald-500 bg-emerald-500 text-accent-ink" : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500"}`}>SYN</button>}
    </div>

    {open && !syntheticOpen && (query.trim() || listeVisible || loading || error || catalog.unavailableSources.length > 0) && <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded border border-neutral-700 bg-neutral-900 shadow-lg">
      {listeVisible && <ul ref={listeRef} id={idListe} role="listbox" aria-label="Résultats de paires" className="max-h-72 overflow-y-auto py-1">
        {matches.map((m, i) => <li key={`${m.kind}:${m.symbol}`} role="none"><button id={`${idListe}-opt-${i}`} data-idx={i} type="button" role="option" aria-selected={i === indexActif}
          onMouseDown={(e) => { e.preventDefault(); choose(m); }} onMouseEnter={() => setIndexActif(i)}
          className={`flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-xs text-neutral-200 ${i === indexActif ? "bg-neutral-800" : "hover:bg-neutral-800"}`}>
          <span><span>{m.symbol}</span>{m.label && <span className="block text-[10px] text-text-dim">{m.label}</span>}</span><span className="shrink-0 text-[10px] text-text-dim">{m.kind === "perp" ? "Perp · " : ""}{sourceLabel(m.exchange)}</span>
        </button></li>)}
      </ul>}
      {loading && <p className="px-2 py-1 text-[10px] text-text-dim">Recherche des actifs disponibles…</p>}
      {!loading && query.trim() && matches.length === 0 && <p className="px-2 py-1 text-[11px] text-text-dim">{onPick ? "Aucun actif compatible avec le marché affiché." : "Aucun actif trouvé dans le catalogue actuel. Entrée pour vérifier ce symbole."}</p>}
      {catalog.unavailableSources.length > 0 && <p className="border-t border-neutral-800 px-2 py-1 text-[10px] text-text-dim">Catalogue partiel · {catalog.unavailableSources.map(sourceLabel).join(", ")} indisponible(s)</p>}
      {error && <p role="status" className="px-2 py-1 text-[11px] text-down">{error}</p>}
      <button type="button" disabled={loading} onMouseDown={(e) => e.preventDefault()} onClick={() => refreshCatalog(true)} className="w-full border-t border-neutral-800 px-2 py-1 text-left text-[11px] text-text-dim hover:text-text disabled:opacity-40">Actualiser les actifs</button>
    </div>}

    {syntheticOpen && <div className="absolute left-0 top-full z-30 mt-1 w-[30rem] rounded border border-neutral-700 bg-neutral-900 p-2 shadow-xl">
      <div className="mb-2 flex justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim"><span>Synthétique</span><span>ratio / spread · sources automatiques</span></div>
      <div className="mb-2 flex flex-wrap gap-1">{SYNTHETIC_PRESETS.map((preset) => <button key={preset.symbol} type="button" onClick={() => {
        const spec = parseSyntheticSymbol(preset.symbol);
        if (spec) { invalidateBuild(); setLegA(spec.legA); setLegB(spec.legB); setOp(spec.op); }
      }} className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700">{preset.label}</button>)}</div>
      {recents.length > 0 && <div className="mb-2 flex flex-wrap gap-1 border-t border-neutral-800 pt-2">{recents.map((recent) => {
        const spec = parseSyntheticSymbol(recent);
        return <button key={recent} type="button" onClick={() => {
          if (spec) { invalidateBuild(); setLegA(spec.legA); setLegB(spec.legB); setOp(spec.op); }
          else chooseSynthetic(recent);
        }} className="rounded bg-neutral-950 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800">{spec ? formatSyntheticLabel(spec) : recent}</button>;
      })}</div>}
      <div className="grid grid-cols-[1fr_auto_1fr_auto] items-start gap-2 border-t border-neutral-800 pt-2">
        <LegEditor label="Jambe A" symbol={legA} matches={searchMarkets(catalog, legA, 8)} onSymbol={(value) => { invalidateBuild(); setLegA(value); }} />
        <div className="flex flex-col gap-1 pt-6">{(["/", "-"] as const).map((candidate) => <button key={candidate} type="button" onClick={() => { invalidateBuild(); setOp(candidate); }} className={`h-7 w-7 rounded text-sm ${op === candidate ? "bg-emerald-500 text-accent-ink" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"}`}>{candidate}</button>)}</div>
        <LegEditor label="Jambe B" symbol={legB} matches={searchMarkets(catalog, legB, 8)} onSymbol={(value) => { invalidateBuild(); setLegB(value); }} />
        <button type="button" disabled={building} onClick={() => void buildSynthetic()} className="mt-6 rounded bg-emerald-500 px-3 py-1.5 text-[11px] font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-40">{building ? "Recherche…" : "Charger"}</button>
      </div>
      {error && <p role="status" className="mt-2 text-[11px] text-down">{error}</p>}
      {catalog.unavailableSources.length > 0 && <button type="button" disabled={loading} onClick={() => refreshCatalog(true)} className="mt-2 text-[11px] text-text-dim hover:text-text disabled:opacity-40">Actualiser les actifs</button>}
    </div>}
  </div>;
}

function LegEditor({ label, symbol, matches, onSymbol }: { label: string; symbol: string; matches: MarketCandidate[]; onSymbol: (symbol: string) => void }) {
  return <div className="min-w-0">
    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-text-dim">{label}
      <input value={symbol} aria-label={label} onChange={(e) => onSymbol(e.target.value.toUpperCase())} className={`${CLASSES_CHAMP} mt-1 w-full`} />
    </label>
    {matches.length > 0 && <div className="mt-1 flex max-h-24 flex-col overflow-y-auto rounded border border-neutral-800 bg-neutral-950">
      {matches.map((match) => <button key={`${match.kind}:${match.symbol}`} type="button" onClick={() => onSymbol(match.symbol)} className="px-2 py-0.5 text-left text-[11px] text-neutral-300 hover:bg-neutral-800">{match.symbol}</button>)}
    </div>}
  </div>;
}
