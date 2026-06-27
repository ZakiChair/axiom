/**
 * PairSearch — champ de recherche de paires pour la source courante.
 *
 * Récupère (et met en cache, cf. data/pairs.ts) le catalogue de la source, le filtre
 * EN DIRECT pendant la saisie, et change le symbole du graphe au clic sur un résultat.
 *
 * Surensemble du champ symbole libre : Entrée valide la saisie BRUTE telle quelle
 * (permet d'ouvrir un symbole absent du catalogue ou si le fetch a échoué), tandis
 * que la liste déroulante ajoute la découverte. Basse fréquence : aucun re-render sur tick.
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { marketStore } from "../store/market";
import { fetchPairs } from "../data/pairs";

/** Nombre maximum de résultats affichés (perf + lisibilité de la liste). */
const MAX_RESULTS = 30;

export interface PairSearchProps {
  /**
   * Validation d'un symbole (résultat cliqué / saisie brute). Par défaut : change
   * le symbole du graphe PRINCIPAL ; surchargé (ex. ajout à la comparaison).
   */
  onPick?: (symbol: string) => void;
  /** Placeholder du champ (et libellé d'accessibilité). */
  placeholder?: string;
}

export function PairSearch({
  onPick,
  placeholder = "Rechercher une paire",
}: PairSearchProps = {}) {
  const exchange = useStore(marketStore, (s) => s.exchange);
  const setSymbol = useStore(marketStore, (s) => s.setSymbol);

  const [query, setQuery] = useState("");
  const [pairs, setPairs] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  // (Re)charge le catalogue quand la source change (cache mémoire => 1 fetch/source/session).
  useEffect(() => {
    let ignore = false;
    fetchPairs(exchange)
      .then((list) => {
        if (!ignore) setPairs(list);
      })
      .catch((err) => {
        if (!ignore) setPairs([]);
        console.error("[AXIOM] Échec du chargement des paires", err);
      });
    return () => {
      ignore = true;
    };
  }, [exchange]);

  const q = query.trim().toUpperCase();
  const matches = q.length === 0 ? [] : pairs.filter((p) => p.includes(q)).slice(0, MAX_RESULTS);

  /** Valide un symbole (résultat cliqué ou saisie brute), ferme la liste. */
  const choose = (value: string) => {
    const v = value.trim();
    if (v.length === 0) return;
    if (onPick) onPick(v);
    else setSymbol(v);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value.toUpperCase());
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          // Entrée : si un résultat existe on prend le 1er, sinon on valide la saisie brute.
          if (e.key === "Enter") choose(matches[0] ?? query);
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="w-44 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500"
        aria-label={placeholder}
      />

      {open && matches.length > 0 && (
        <ul className="absolute left-0 top-full z-20 mt-1 max-h-72 w-44 overflow-y-auto rounded border border-neutral-700 bg-neutral-900 py-1 shadow-lg">
          {matches.map((p) => (
            <li key={p}>
              <button
                type="button"
                // onMouseDown (avant le blur du champ) : le clic est pris en compte.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
                className="block w-full px-2 py-1 text-left text-xs text-neutral-200 hover:bg-neutral-800"
              >
                {p}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
