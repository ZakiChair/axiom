/**
 * Menu « Indicateurs » — bouton de la toolbar ouvrant la liste des INDICATORS du
 * registre @axiom/indicators, avec une case à cocher par indicateur
 * (activer/désactiver). L'état actif vient du `indicatorsStore` (vanilla) ; le
 * Chart réagit à ses changements de façon impérative (aucun re-render du canvas).
 */
import { useState } from "react";
import { useStore } from "zustand";
import { INDICATORS } from "@axiom/indicators";
import { indicatorsStore } from "../store/indicators";

export function IndicatorMenu() {
  const [open, setOpen] = useState(false);
  const active = useStore(indicatorsStore, (s) => s.indicators);
  const toggle = useStore(indicatorsStore, (s) => s.toggle);

  const isActive = (defId: string) => active.some((i) => i.defId === defId);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`rounded px-2 py-1 text-xs ${
          open
            ? "bg-neutral-200 text-neutral-900"
            : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
        }`}
      >
        Indicateurs
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded border border-neutral-800 bg-neutral-900 p-1 shadow-xl">
          {INDICATORS.map((def) => (
            <label
              key={def.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
            >
              <input
                type="checkbox"
                checked={isActive(def.id)}
                onChange={() => toggle(def.id)}
                className="accent-emerald-500"
              />
              <span className="flex-1">{def.name}</span>
              <span className="text-[10px] uppercase text-neutral-500">
                {def.pane === "overlay" ? "prix" : "pane"}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
