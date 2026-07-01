/**
 * Menu « Indicateurs » — bouton de la toolbar ouvrant :
 *  1. une section « Actifs » en tête (les INSTANCES affichées, chacune avec ses
 *     params ; boutons dupliquer / éditer / retirer, éditeur de params inline) ;
 *  2. le CATALOGUE des indicateurs du registre @axiom/indicators (86 indicateurs),
 *     groupé par catégorie en sections repliables et filtrable par recherche.
 *
 * MULTI-INSTANCES : cliquer un indicateur du catalogue AJOUTE une nouvelle instance
 * aux params par défaut (EMA(20) puis EMA(50) coexistent). L'état vient du
 * `indicatorsStore` (vanilla) ; le Chart réagit à ses changements de façon
 * impérative (aucun re-render du canvas).
 */
import { useMemo, useState } from "react";
import { useStore } from "zustand";
import { INDICATORS, getIndicator } from "@axiom/indicators";
import type { IndicatorCategory, IndicatorDef, IndicatorInput } from "@axiom/types";
import {
  indicatorsStore,
  formatInstanceLabel,
  type ActiveIndicator,
} from "../store/indicators";

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

/**
 * Éditeur de params d'UNE instance : un contrôle par `input` de la définition
 * (nombre / booléen / choix). Chaque changement remplace le jeu de params complet
 * de l'instance (instanceId inchangé → override en place côté chart).
 */
function InstanceParamsEditor({
  def,
  instance,
  onChange,
}: {
  def: IndicatorDef;
  instance: ActiveIndicator;
  onChange: (params: ActiveIndicator["params"]) => void;
}) {
  if (def.inputs.length === 0) {
    return <div className="px-2 pb-2 text-[11px] text-neutral-500">Aucun paramètre.</div>;
  }

  const set = (key: string, value: number | boolean | string) =>
    onChange({ ...instance.params, [key]: value });

  const renderControl = (input: IndicatorInput) => {
    const value = instance.params[input.key] ?? input.default;
    // Choix explicite (select) ou source avec options : liste déroulante.
    if ((input.type === "select" || input.type === "source") && input.options && input.options.length > 0) {
      return (
        <select
          value={String(value)}
          onChange={(e) => set(input.key, e.target.value)}
          className="w-24 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          {input.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }
    if (input.type === "boolean") {
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => set(input.key, e.target.checked)}
          className="accent-emerald-500"
        />
      );
    }
    if (input.type === "number") {
      return (
        <input
          type="number"
          value={typeof value === "number" ? value : Number(value)}
          min={input.min}
          max={input.max}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            // On ignore une saisie non finie (champ vidé transitoirement).
            if (Number.isFinite(n)) set(input.key, n);
          }}
          className="w-20 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      );
    }
    // Repli (source sans options) : saisie texte libre.
    return (
      <input
        type="text"
        value={String(value)}
        onChange={(e) => set(input.key, e.target.value)}
        className="w-24 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
    );
  };

  return (
    <div className="flex flex-col gap-1.5 px-2 pb-2">
      {def.inputs.map((input) => (
        <label key={input.key} className="flex items-center justify-between gap-2 text-xs text-neutral-300">
          <span className="truncate">{input.name}</span>
          {renderControl(input)}
        </label>
      ))}
    </div>
  );
}

export function IndicatorMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Sections repliées (set d'ids de catégorie). Par défaut : tout ouvert.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // instanceId dont l'éditeur de params est déplié (un seul à la fois).
  const [editingId, setEditingId] = useState<string | null>(null);

  const active = useStore(indicatorsStore, (s) => s.indicators);
  const add = useStore(indicatorsStore, (s) => s.add);
  const remove = useStore(indicatorsStore, (s) => s.remove);
  const duplicate = useStore(indicatorsStore, (s) => s.duplicate);
  const updateParams = useStore(indicatorsStore, (s) => s.updateParams);

  // Nombre d'instances actives par defId (badge du catalogue).
  const countByDef = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of active) m.set(i.defId, (m.get(i.defId) ?? 0) + 1);
    return m;
  }, [active]);

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
        <div className="absolute left-0 top-full z-20 mt-1 flex max-h-[70vh] w-72 flex-col rounded border border-neutral-800 bg-neutral-900 shadow-xl">
          {/* Section « Actifs » : les instances affichées, éditables par instance. */}
          {active.length > 0 && (
            <div className="border-b border-neutral-800 p-1">
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                Actifs <span className="text-neutral-600">{active.length}</span>
              </div>
              {active.map((inst) => {
                const def = getIndicator(inst.defId);
                const label = def ? formatInstanceLabel(def, inst.params) : inst.defId;
                const isEditing = editingId === inst.instanceId;
                return (
                  <div key={inst.instanceId} className="rounded hover:bg-neutral-800/60">
                    <div className="flex items-center gap-1 px-2 py-1.5 text-sm text-neutral-200">
                      <span className="flex-1 truncate">{label}</span>
                      {def && (
                        <span className="text-[10px] uppercase text-neutral-500">
                          {def.pane === "overlay" ? "prix" : "pane"}
                        </span>
                      )}
                      <button
                        type="button"
                        title="Dupliquer"
                        aria-label="Dupliquer"
                        onClick={() => duplicate(inst.instanceId)}
                        className="rounded px-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
                      >
                        ⧉
                      </button>
                      {def && def.inputs.length > 0 && (
                        <button
                          type="button"
                          title="Éditer les paramètres"
                          aria-label="Éditer les paramètres"
                          onClick={() =>
                            setEditingId((cur) => (cur === inst.instanceId ? null : inst.instanceId))
                          }
                          className={`rounded px-1 hover:bg-neutral-700 hover:text-neutral-100 ${
                            isEditing ? "text-emerald-400" : "text-neutral-400"
                          }`}
                        >
                          ✎
                        </button>
                      )}
                      <button
                        type="button"
                        title="Retirer"
                        aria-label="Retirer"
                        onClick={() => {
                          if (editingId === inst.instanceId) setEditingId(null);
                          remove(inst.instanceId);
                        }}
                        className="rounded px-1 text-neutral-400 hover:bg-neutral-700 hover:text-red-400"
                      >
                        ✕
                      </button>
                    </div>
                    {isEditing && def && (
                      <InstanceParamsEditor
                        def={def}
                        instance={inst}
                        onChange={(params) => updateParams(inst.instanceId, params)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

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

          {/* Catalogue groupé scrollable — cliquer AJOUTE une instance. */}
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
                    defs.map((def) => {
                      const count = countByDef.get(def.id) ?? 0;
                      return (
                        <button
                          key={def.id}
                          type="button"
                          title="Ajouter une instance"
                          onClick={() => add(def.id)}
                          className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                        >
                          <span className="text-emerald-500">＋</span>
                          <span className="flex-1 truncate">{def.name}</span>
                          {count > 0 && (
                            <span className="rounded bg-emerald-900/60 px-1 text-[10px] text-emerald-300">
                              {count}
                            </span>
                          )}
                          <span className="text-[10px] uppercase text-neutral-500">
                            {def.pane === "overlay" ? "prix" : "pane"}
                          </span>
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
