/**
 * Menu « Indicateurs » — bouton de la toolbar ouvrant le catalogue des INDICATORS
 * du registre @axiom/indicators (86 indicateurs), avec une case à cocher par
 * indicateur (activer/désactiver). Vu le volume, le catalogue est :
 *  - GROUPÉ par catégorie en sections repliables ;
 *  - filtrable via un CHAMP DE RECHERCHE (par nom ou id).
 * L'état actif vient du `indicatorsStore` (vanilla) ; le Chart réagit à ses
 * changements de façon impérative (aucun re-render du canvas).
 */
import { useMemo, useState } from "react";
import { useStore } from "zustand";
import { INDICATORS } from "@axiom/indicators";
import type { IndicatorCategory, IndicatorDef } from "@axiom/types";
import { indicatorsStore } from "../store/indicators";

/** Libellés FR des catégories + ordre d'affichage. */
const CATEGORY_LABELS: Partial<Record<IndicatorCategory, string>> = {
  trend: "Tendance",
  momentum: "Momentum",
  volatility: "Volatilité",
  volume: "Volume",
  billwilliams: "Bill Williams",
  support_resistance: "Support / Résistance",
  orderflow: "Order Flow",
  derivatives: "Dérivés",
  custom: "Personnalisés",
};

const CATEGORY_ORDER: IndicatorCategory[] = [
  "trend",
  "momentum",
  "volatility",
  "volume",
  "billwilliams",
  "support_resistance",
  "orderflow",
  "derivatives",
  "custom",
];

/** Regroupe les définitions par catégorie, dans l'ordre déclaré ci-dessus. */
function groupByCategory(defs: IndicatorDef[]): Array<[IndicatorCategory, IndicatorDef[]]> {
  const map = new Map<IndicatorCategory, IndicatorDef[]>();
  for (const def of defs) {
    const list = map.get(def.category) ?? [];
    list.push(def);
    map.set(def.category, list);
  }
  const ordered: Array<[IndicatorCategory, IndicatorDef[]]> = [];
  for (const cat of CATEGORY_ORDER) {
    const list = map.get(cat);
    if (list && list.length > 0) ordered.push([cat, list]);
  }
  return ordered;
}

export function IndicatorMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Sections repliées (set d'ids de catégorie). Par défaut : tout ouvert.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const active = useStore(indicatorsStore, (s) => s.indicators);
  const toggle = useStore(indicatorsStore, (s) => s.toggle);

  const isActive = (defId: string) => active.some((i) => i.defId === defId);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return INDICATORS;
    return INDICATORS.filter(
      (d) => d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q)
    );
  }, [q]);

  const groups = useMemo(() => groupByCategory(filtered), [filtered]);

  const toggleSection = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

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
        <div className="absolute left-0 top-full z-20 mt-1 flex max-h-[70vh] w-64 flex-col rounded border border-neutral-800 bg-neutral-900 shadow-xl">
          {/* Recherche */}
          <div className="border-b border-neutral-800 p-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un indicateur…"
              className="w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Liste groupée scrollable */}
          <div className="flex-1 overflow-y-auto p-1">
            {groups.length === 0 && (
              <div className="px-2 py-3 text-center text-xs text-neutral-500">
                Aucun indicateur trouvé.
              </div>
            )}

            {groups.map(([cat, defs]) => {
              // En recherche active, on ignore l'état replié (résultats toujours visibles).
              const isCollapsed = q ? false : collapsed.has(cat);
              return (
                <div key={cat} className="mb-1">
                  <button
                    type="button"
                    onClick={() => toggleSection(cat)}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 hover:bg-neutral-800"
                  >
                    <span>{CATEGORY_LABELS[cat] ?? cat}</span>
                    <span className="flex items-center gap-1 text-neutral-600">
                      <span>{defs.length}</span>
                      <span>{isCollapsed ? "▸" : "▾"}</span>
                    </span>
                  </button>

                  {!isCollapsed &&
                    defs.map((def) => (
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
