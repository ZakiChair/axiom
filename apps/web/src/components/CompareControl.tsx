/**
 * CompareControl — ajout d'un symbole de comparaison + LÉGENDE des courbes.
 *
 * Panneau latéral droit : un champ (réutilise PairSearch avec `onPick`) ajoute un
 * symbole au compareStore (cap 4) ; la légende liste le symbole PRINCIPAL
 * (référence base 100, retiré via le sélecteur principal, pas ici) puis les
 * comparés (pastille couleur + nom + bouton ×). La comparaison s'affiche dans le
 * sous-pane dédié « Comparaison (base 100) » du graphe.
 *
 * Basse fréquence : se re-rend UNIQUEMENT quand la liste (ou le symbole principal)
 * change — jamais sur tick (cf. BUILD-CONTRACT).
 */
import { useStore } from "zustand";
import { marketStore } from "../store/market";
import { compareStore, MAX_COMPARE, MAIN_COLOR } from "../store/compare";
import { PairSearch } from "./PairSearch";
import { SidebarSection } from "./SidebarSection";

export function CompareControl() {
  const symbols = useStore(compareStore, (s) => s.symbols);
  const add = useStore(compareStore, (s) => s.add);
  const remove = useStore(compareStore, (s) => s.remove);
  const mainSymbol = useStore(marketStore, (s) => s.symbol);

  const full = symbols.length >= MAX_COMPARE;

  return (
    <SidebarSection
      title="Comparer (base 100)"
      action={
        <span className="text-[10px] font-normal text-text-dim">
          {symbols.length}/{MAX_COMPARE}
        </span>
      }
    >
      <div className="px-2 pb-2 pt-2">
        {full ? (
          <p className="px-1 py-1 text-[11px] text-neutral-600">
            Maximum {MAX_COMPARE} symboles comparés.
          </p>
        ) : (
          <PairSearch onPick={add} placeholder="Ajouter à comparer" />
        )}
      </div>

      {symbols.length > 0 && (
        <ul className="px-2 pb-2">
          {/* Référence : symbole principal (retiré via le sélecteur principal). */}
          <li className="flex items-center gap-2 px-1 py-1 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: MAIN_COLOR }}
            />
            <span className="flex-1 truncate font-medium text-neutral-200">
              {mainSymbol}
            </span>
            <span className="text-[10px] text-neutral-600">réf.</span>
          </li>

          {/* Comparés : pastille couleur + nom + retrait. */}
          {symbols.map((c) => (
            <li
              key={c.symbol}
              className="group flex items-center gap-2 px-1 py-1 text-xs"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: c.color }}
              />
              <span className="flex-1 truncate text-neutral-200">{c.symbol}</span>
              <button
                type="button"
                onClick={() => remove(c.symbol)}
                aria-label={`Retirer ${c.symbol}`}
                className="text-neutral-600 transition hover:text-neutral-300"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </SidebarSection>
  );
}
