/**
 * PairSearch — champ de recherche de paires pour la source courante.
 *
 * Récupère (et met en cache, cf. data/pairs.ts) le catalogue de la source, le filtre
 * EN DIRECT pendant la saisie, et change le symbole du graphe au clic sur un résultat.
 *
 * Surensemble du champ symbole libre : ↑/↓ déplacent l'item actif de la liste
 * (combobox ARIA, convention CommandPalette), Entrée l'ouvre — ou valide la saisie
 * BRUTE s'il n'y a aucun résultat (permet d'ouvrir un symbole absent du catalogue
 * ou si le fetch a échoué). Basse fréquence : aucun re-render sur tick.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { ExchangeId } from "@axiom/types";
import { marketStore } from "../store/market";
import { SYNTHETIC_PRESETS, syntheticsStore } from "../store/synthetics";
import { encodeSyntheticSymbol, formatSyntheticLabel, parseSyntheticSymbol } from "../data/synthetic";
import { fetchPairs, TWELVEDATA_SYMBOLS } from "../data/pairs";

/** Nombre maximum de résultats affichés (perf + lisibilité de la liste). */
const MAX_RESULTS = 30;
const LEG_SOURCES: Exclude<ExchangeId, "synthetic">[] = ["binance", "kraken", "coinbase", "twelvedata", "mexc"];

export interface PairSearchProps {
  /**
   * Validation d'un symbole (résultat cliqué / saisie brute). Par défaut : change
   * le symbole du graphe PRINCIPAL ; surchargé (ex. ajout à la comparaison).
   */
  onPick?: (symbol: string) => void;
  /** Placeholder du champ (et libellé d'accessibilité). */
  placeholder?: string;
}

function sourceLabel(source: ExchangeId): string {
  if (source === "twelvedata") return "TradFi";
  return source[0]?.toUpperCase() + source.slice(1);
}

/**
 * Vrai si la saisie ressemble à un symbole synthétique en construction (contient `/`
 * ou `-`) — SAUF si elle correspond exactement à un résultat du catalogue courant (ex.
 * "EUR/USD", ticker tradfi réel) : dans ce cas on reste sur le chemin de sélection
 * normal, la présence du séparateur seule ne doit pas basculer le constructeur.
 */
export function isBuilderQuery(query: string, pairs: readonly string[]): boolean {
  const q = query.trim().toUpperCase();
  if (pairs.includes(q)) return false;
  return q.includes("/") || q.includes("-");
}

export function PairSearch({
  onPick,
  placeholder = "Rechercher une paire",
}: PairSearchProps = {}) {
  const exchange = useStore(marketStore, (s) => s.exchange);
  const setExchange = useStore(marketStore, (s) => s.setExchange);
  const setSymbol = useStore(marketStore, (s) => s.setSymbol);
  const recents = useStore(syntheticsStore, (s) => s.recents);
  const addRecent = useStore(syntheticsStore, (s) => s.addRecent);

  const defaultLegSource: Exclude<ExchangeId, "synthetic"> = exchange === "synthetic" ? "binance" : exchange;
  const [query, setQuery] = useState("");
  const [pairs, setPairs] = useState<string[]>([]);
  // Échec du chargement du catalogue courant : affiché discrètement (jamais muet).
  const [pairsError, setPairsError] = useState(false);
  const [open, setOpen] = useState(false);
  // Item ACTIF de la liste de résultats (navigation ↑/↓, convention CommandPalette : borné).
  const [indexActif, setIndexActif] = useState(0);
  const listeRef = useRef<HTMLUListElement>(null);
  // Id unique par instance (plusieurs PairSearch coexistent : toolbar, comparaison, dérivés).
  const idListe = useId();
  const [syntheticOpen, setSyntheticOpen] = useState(false);
  const [legAExchange, setLegAExchange] = useState<Exclude<ExchangeId, "synthetic">>(defaultLegSource);
  const [legBExchange, setLegBExchange] = useState<Exclude<ExchangeId, "synthetic">>("twelvedata");
  const [legA, setLegA] = useState("ETHUSDT");
  const [legB, setLegB] = useState("BTCUSDT");
  const [op, setOp] = useState<"/" | "-">("/");
  const [legAPairs, setLegAPairs] = useState<string[]>([]);
  const [legBPairs, setLegBPairs] = useState<string[]>([]);

  // (Re)charge le catalogue quand la source change (cache mémoire => 1 fetch/source/session).
  useEffect(() => {
    let ignore = false;
    fetchPairs(exchange === "synthetic" ? "binance" : exchange)
      .then((list) => {
        if (!ignore) {
          setPairs(list);
          setPairsError(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setPairs([]);
          setPairsError(true);
        }
        console.error("[AXIOM] Échec du chargement des paires", err);
      });
    return () => {
      ignore = true;
    };
  }, [exchange]);

  useEffect(() => {
    let ignore = false;
    fetchPairs(legAExchange)
      .then((list) => {
        if (!ignore) setLegAPairs(list);
      })
      .catch((err) => {
        if (!ignore) setLegAPairs([]);
        console.error("[AXIOM] Échec du chargement des paires (jambe A)", err);
      });
    return () => {
      ignore = true;
    };
  }, [legAExchange]);

  useEffect(() => {
    let ignore = false;
    fetchPairs(legBExchange)
      .then((list) => {
        if (!ignore) setLegBPairs(list);
      })
      .catch((err) => {
        if (!ignore) setLegBPairs([]);
        console.error("[AXIOM] Échec du chargement des paires (jambe B)", err);
      });
    return () => {
      ignore = true;
    };
  }, [legBExchange]);

  useEffect(() => {
    if (exchange !== "synthetic") setLegAExchange(exchange);
  }, [exchange]);

  const q = query.trim().toUpperCase();
  const matches = q.length === 0 ? [] : pairs.filter((p) => p.includes(q)).slice(0, MAX_RESULTS);
  const showBuilder = syntheticOpen || (open && isBuilderQuery(query, pairs));
  const listeVisible = open && matches.length > 0 && !showBuilder;

  // Fait défiler l'item actif dans la vue (aussi quand la saisie recompose la liste).
  useEffect(() => {
    const el = listeRef.current?.querySelector<HTMLElement>(`[data-idx="${indexActif}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [indexActif, query]);

  const legAMatches = useMemo(() => {
    const needle = legA.trim().toUpperCase();
    if (needle.length === 0) return legAPairs.slice(0, 8);
    return legAPairs.filter((p) => p.includes(needle)).slice(0, 8);
  }, [legA, legAPairs]);

  const legBMatches = useMemo(() => {
    const needle = legB.trim().toUpperCase();
    if (needle.length === 0) return legBPairs.slice(0, 8);
    return legBPairs.filter((p) => p.includes(needle)).slice(0, 8);
  }, [legB, legBPairs]);

  /** Valide un symbole (résultat cliqué ou saisie brute), ferme la liste. */
  const choose = (value: string) => {
    const v = value.trim();
    if (v.length === 0) return;
    if (onPick) onPick(v);
    else setSymbol(v);
    setQuery("");
    setOpen(false);
  };

  const chooseSynthetic = (symbol: string) => {
    if (parseSyntheticSymbol(symbol) === null) return;
    addRecent(symbol);
    if (onPick) onPick(symbol);
    else {
      setExchange("synthetic");
      setSymbol(symbol);
    }
    setQuery("");
    setOpen(false);
    setSyntheticOpen(false);
  };

  const buildSynthetic = () => {
    const a = legA.trim().toUpperCase();
    const b = legB.trim().toUpperCase();
    if (a.length === 0 || b.length === 0) return;
    chooseSynthetic(encodeSyntheticSymbol({ exA: legAExchange, legA: a, exB: legBExchange, legB: b, op }));
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value.toUpperCase());
            // Toute évolution de la saisie réinitialise la sélection en tête.
            setIndexActif(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            // ↑/↓ : déplacement BORNÉ de l'item actif (convention CommandPalette).
            if (e.key === "ArrowDown" && listeVisible) {
              e.preventDefault();
              setIndexActif((i) => Math.min(matches.length - 1, i + 1));
            } else if (e.key === "ArrowUp" && listeVisible) {
              e.preventDefault();
              setIndexActif((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              // Entrée : l'item ACTIF s'il existe, sinon la saisie brute (symbole hors catalogue).
              choose(matches[indexActif] ?? query);
            } else if (e.key === "Escape") setOpen(false);
          }}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-expanded={listeVisible}
          aria-autocomplete="list"
          aria-controls={listeVisible ? idListe : undefined}
          aria-activedescendant={listeVisible ? `${idListe}-opt-${indexActif}` : undefined}
          className="w-44 rounded border border-border bg-bg px-2 py-1 text-xs text-text outline-none placeholder:text-text-dim focus:border-accent"
          aria-label={placeholder}
        />
        <button
          type="button"
          title="Construire une série synthétique"
          onMouseDown={(e) => {
            e.preventDefault();
            setSyntheticOpen((v) => !v);
            setOpen(true);
          }}
          className={`rounded border px-2 py-1 text-xs ${
            syntheticOpen
              ? "border-emerald-500 bg-emerald-500 text-accent-ink"
              : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500"
          }`}
        >
          SYN
        </button>
      </div>

      {listeVisible && (
        <ul
          ref={listeRef}
          id={idListe}
          role="listbox"
          aria-label="Résultats de paires"
          className="absolute left-0 top-full z-20 mt-1 max-h-72 w-44 overflow-y-auto rounded border border-neutral-700 bg-neutral-900 py-1 shadow-lg"
        >
          {matches.map((p, i) => (
            <li key={p} role="none">
              <button
                id={`${idListe}-opt-${i}`}
                data-idx={i}
                type="button"
                role="option"
                aria-selected={i === indexActif}
                // onMouseDown (avant le blur du champ) : le clic est pris en compte.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
                onMouseEnter={() => setIndexActif(i)}
                className={`block w-full px-2 py-1 text-left text-xs text-neutral-200 ${
                  i === indexActif ? "bg-neutral-800" : "hover:bg-neutral-800"
                }`}
              >
                {p}
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && pairsError && !showBuilder && (
        <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded border border-border bg-bg px-2 py-1 text-xs text-text-dim shadow-lg">
          Catalogue indisponible
        </div>
      )}

      {showBuilder && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 top-full z-30 mt-1 w-[30rem] rounded border border-neutral-700 bg-neutral-900 p-2 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
            <span>Synthétique</span>
            <span>ratio / spread</span>
          </div>

          <div className="mb-2 flex flex-wrap gap-1">
            {SYNTHETIC_PRESETS.map((preset) => (
              <button
                key={preset.symbol}
                type="button"
                onClick={() => chooseSynthetic(preset.symbol)}
                className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
              >
                {preset.label}
              </button>
            ))}
          </div>

          {recents.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1 border-t border-neutral-800 pt-2">
              {recents.map((recent) => {
                const spec = parseSyntheticSymbol(recent);
                return (
                  <button
                    key={recent}
                    type="button"
                    onClick={() => chooseSynthetic(recent)}
                    className="rounded bg-neutral-950 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    {spec ? formatSyntheticLabel(spec) : recent}
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-[1fr_auto_1fr_auto] items-start gap-2 border-t border-neutral-800 pt-2">
            <LegEditor
              label="Jambe A"
              exchange={legAExchange}
              symbol={legA}
              matches={legAMatches}
              onExchange={setLegAExchange}
              onSymbol={setLegA}
            />
            <div className="flex flex-col gap-1 pt-6">
              {(["/", "-"] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => setOp(candidate)}
                  className={`h-7 w-7 rounded text-sm ${
                    op === candidate
                      ? "bg-emerald-500 text-accent-ink"
                      : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                  }`}
                >
                  {candidate}
                </button>
              ))}
            </div>
            <LegEditor
              label="Jambe B"
              exchange={legBExchange}
              symbol={legB}
              matches={legBMatches}
              onExchange={setLegBExchange}
              onSymbol={setLegB}
            />
            <button
              type="button"
              onClick={buildSynthetic}
              className="mt-6 rounded bg-emerald-500 px-3 py-1.5 text-[11px] font-medium text-accent-ink transition hover:opacity-90"
            >
              Charger
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LegEditor({
  label,
  exchange,
  symbol,
  matches,
  onExchange,
  onSymbol,
}: {
  label: string;
  exchange: Exclude<ExchangeId, "synthetic">;
  symbol: string;
  matches: string[];
  onExchange: (exchange: Exclude<ExchangeId, "synthetic">) => void;
  onSymbol: (symbol: string) => void;
}) {
  const visibleMatches = exchange === "twelvedata" && matches.length === 0
    ? TWELVEDATA_SYMBOLS.slice(0, 8)
    : matches;

  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-dim">{label}</div>
      <div className="flex gap-1">
        <select
          value={exchange}
          onChange={(e) => onExchange(e.target.value as Exclude<ExchangeId, "synthetic">)}
          className="w-24 rounded border border-neutral-700 bg-neutral-950 px-1 py-1 text-xs text-neutral-200 outline-none focus:border-neutral-500"
        >
          {LEG_SOURCES.map((source) => (
            <option key={source} value={source}>{sourceLabel(source)}</option>
          ))}
        </select>
        <input
          value={symbol}
          onChange={(e) => onSymbol(e.target.value.toUpperCase())}
          className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-neutral-500"
        />
      </div>
      {visibleMatches.length > 0 && (
        <div className="mt-1 flex max-h-24 flex-col overflow-y-auto rounded border border-neutral-800 bg-neutral-950">
          {visibleMatches.map((match) => (
            <button
              key={match}
              type="button"
              onClick={() => onSymbol(match)}
              className="px-2 py-0.5 text-left text-[11px] text-neutral-300 hover:bg-neutral-800"
            >
              {match}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
