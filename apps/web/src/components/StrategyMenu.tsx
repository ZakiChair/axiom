/**
 * Menu dédié des stratégies (foyer exclusif — le menu Indicateurs les exclut).
 * Patron IndicatorMenu assumé en copie adaptée : deux menus, deux évolutions
 * indépendantes.
 *
 * Bouton de la toolbar ouvrant :
 *  1. une section « Actives » en tête (les INSTANCES de catégorie `strategy`
 *     affichées, chacune avec ses params ; dupliquer / éditer / retirer) ;
 *  2. le catalogue des defs `strategy` du registre @axiom/indicators, SECTIONNÉ
 *     par nature (Stratégies / Divergences / Spot vs Perp — dérivé par règle
 *     d'id, robuste aux ajouts), filtrable par recherche.
 *
 * MULTI-INSTANCES : cliquer une stratégie AJOUTE une instance aux params par
 * défaut. L'état vient du `indicatorsStore` (vanilla), comme pour les indicateurs.
 */
import { useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { INDICATORS, getIndicator } from "@axiom/indicators";
import type { IndicatorDef } from "@axiom/types";
import { indicatorsStore, formatInstanceLabel } from "../store/indicators";
import { marketStore } from "../store/market";
import { tfAtLeast } from "../chart/tfOrder";
import { CLASSES_CHAMP, indexRoving } from "./ui";
import { InstanceParamsEditor } from "./IndicatorMenu";
import { raisonUnusableIndicateur } from "../lib/indicatorUsability";

/** Defs de catégorie strategy (catalogue du menu Stratégies). PURE. */
export function defsStrategie(): IndicatorDef[] {
  return INDICATORS.filter((d) => d.category === "strategy");
}

/** Sections d'affichage du catalogue, dans l'ordre de rendu. */
export type SectionStrategie = "strategies" | "divergences" | "spotPerp";

export const LIBELLES_SECTIONS_STRATEGIE: Record<SectionStrategie, string> = {
  strategies: "Stratégies",
  divergences: "Divergences",
  spotPerp: "Spot vs Perp",
};

/**
 * Section d'un def strategy, dérivée PAR RÈGLE d'id (pas de liste en dur —
 * une nouvelle stratégie `stratXxx` se classe seule) : préfixe `strat` →
 * Stratégies ; suffixe `Divergence` → Divergences ; le reste (cvdSpotPerp,
 * premiumSpotPerp) → Spot vs Perp. PURE (testée).
 */
export function sectionStrategie(def: IndicatorDef): SectionStrategie {
  if (def.id.startsWith("strat")) return "strategies";
  if (def.id.endsWith("Divergence")) return "divergences";
  return "spotPerp";
}

/** Découpe un catalogue (déjà filtré) en sections non vides, ordre stable. PURE. */
export function sectionsStrategies(defs: IndicatorDef[]): Array<[SectionStrategie, IndicatorDef[]]> {
  const ordre: SectionStrategie[] = ["strategies", "divergences", "spotPerp"];
  const sections: Array<[SectionStrategie, IndicatorDef[]]> = [];
  for (const s of ordre) {
    const liste = defs.filter((d) => sectionStrategie(d) === s);
    if (liste.length > 0) sections.push([s, liste]);
  }
  return sections;
}

export function StrategyMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // instanceId dont l'éditeur de params est déplié (un seul à la fois).
  const [editingId, setEditingId] = useState<string | null>(null);

  const active = useStore(indicatorsStore, (s) => s.indicators);
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbol = useStore(marketStore, (s) => s.symbol);
  const timeframe = useStore(marketStore, (s) => s.timeframe);
  const add = useStore(indicatorsStore, (s) => s.add);
  const remove = useStore(indicatorsStore, (s) => s.remove);
  const duplicate = useStore(indicatorsStore, (s) => s.duplicate);
  const updateParams = useStore(indicatorsStore, (s) => s.updateParams);

  const strategies = useMemo(() => defsStrategie(), []);

  // Foyer exclusif : ce menu ne montre QUE les instances de stratégies.
  const activesStrategie = useMemo(
    () => active.filter((i) => getIndicator(i.defId)?.category === "strategy"),
    [active],
  );

  // Nombre d'instances actives par defId (badge du catalogue).
  const countByDef = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of activesStrategie) m.set(i.defId, (m.get(i.defId) ?? 0) + 1);
    return m;
  }, [activesStrategie]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return strategies;
    return strategies.filter(
      (d) => d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q),
    );
  }, [q, strategies]);

  // Navigation clavier du panneau : ↑/↓/Home/End en focus roving sur les
  // boutons d'ajout du catalogue ; Échap ferme le menu.
  const rechercheRef = useRef<HTMLInputElement | null>(null);
  const panneauRef = useRef<HTMLDivElement | null>(null);

  function itemsAjout(): HTMLButtonElement[] {
    return Array.from(
      panneauRef.current?.querySelectorAll<HTMLButtonElement>("button[data-item-strategie]:not(:disabled)") ?? [],
    );
  }

  function onKeyDownPanneau(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    // Home/End réservés au champ de recherche : n'intercepter que hors input.
    if ((e.key === "Home" || e.key === "End") && document.activeElement === rechercheRef.current) return;
    const items = itemsAjout();
    if (items.length === 0) return;
    e.preventDefault();
    const courant = items.findIndex((b) => b === document.activeElement);
    const cible = items[indexRoving(items.length, courant, e.key)];
    cible?.focus();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${strategies.length} stratégies · ${activesStrategie.length} active${
          activesStrategie.length > 1 ? "s" : ""
        }`}
        className={`rounded px-2 py-1 text-xs tabular-nums ${
          open
            ? "bg-neutral-200 text-neutral-900"
            : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
        }`}
      >
        Stratégies
        <span className="ml-1 text-[10px] opacity-70">
          {activesStrategie.length > 0 ? activesStrategie.length : strategies.length}
        </span>
      </button>

      {open && (
        <>
        {/* Zone de fermeture au clic extérieur (même mécanisme que les menus de la Toolbar). */}
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div
          ref={panneauRef}
          onKeyDown={onKeyDownPanneau}
          className="absolute left-0 top-full z-50 mt-1 flex max-h-[70vh] w-72 flex-col rounded border border-neutral-800 bg-neutral-900 shadow-xl"
        >
          {/* Section « Actives » : les instances de stratégies, éditables par instance. */}
          {activesStrategie.length > 0 && (
            <div className="border-b border-neutral-800 p-1">
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
                Actives <span className="text-neutral-600">{activesStrategie.length}</span>
              </div>
              {activesStrategie.map((inst) => {
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
                            isEditing ? "text-accent" : "text-neutral-400"
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
                        className="rounded px-1 text-neutral-400 hover:bg-neutral-700 hover:text-down"
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
              ref={rechercheRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher… (croisement, squeeze, divergence…)"
              autoFocus
              className={`${CLASSES_CHAMP} w-full`}
            />
            <p className="mt-1 px-0.5 text-[10px] text-text-dim">
              {filtered.length}/{strategies.length} · setups actionnables
            </p>
          </div>

          {/* Catalogue SECTIONNÉ scrollable (Stratégies / Divergences / Spot vs Perp)
              — cliquer AJOUTE une instance. */}
          <div className="flex-1 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <div className="px-2 py-6 text-center text-xs text-text-dim">
                Aucune stratégie trouvée.
              </div>
            )}

            {sectionsStrategies(filtered).map(([section, defsSection]) => (
              <div key={section} className="mb-1">
                <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-dim">
                  {LIBELLES_SECTIONS_STRATEGIE[section]}
                </div>
                {defsSection.map((def) => {
              const count = countByDef.get(def.id) ?? 0;
              const raisonUnusable = raisonUnusableIndicateur(def, { exchange, symbol, timeframe });
              // Grisage par TF minimal : stratégie non pertinente en dessous de son
              // `minTimeframe` (ex. prime spot-perp sous 15m).
              const disabledTf = def.minTimeframe !== undefined && !tfAtLeast(timeframe, def.minTimeframe);
              const disabled = raisonUnusable !== null || disabledTf;
              return (
                <button
                  key={def.id}
                  type="button"
                  data-item-strategie=""
                  title={raisonUnusable ?? (disabledTf ? `Nécessite ≥ ${def.minTimeframe}` : "Ajouter une instance")}
                  disabled={disabled}
                  onClick={() => {
                    if (!disabled) add(def.id);
                  }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                    disabled
                      ? "cursor-not-allowed text-neutral-600"
                      : "cursor-pointer text-neutral-200 hover:bg-neutral-800"
                  }`}
                >
                  <span className="text-accent">＋</span>
                  <span className="min-w-0 flex-1 truncate">{def.name}</span>
                  {raisonUnusable !== null && (
                    <span className="shrink-0 rounded bg-down/15 px-1 text-[9px] tracking-wider text-down">
                      UNUSABLE
                    </span>
                  )}
                  {/* Statut de validation HORS du `truncate` : dans le nom, il était la
                      première chose coupée par un panneau de 288 px — alors que c'est
                      l'information la plus importante du catalogue. */}
                  {def.validation === "non-valide" && (
                    <span
                      title="Mesurée par la campagne de rejeu puis recalée : le résultat dépend d'hypothèses d'exécution non tenues en réel."
                      className="shrink-0 rounded bg-down/15 px-1 text-[9px] uppercase tracking-wider text-down"
                    >
                      non validé
                    </span>
                  )}
                  {count > 0 && (
                    <span className="rounded bg-accent/20 px-1 text-[10px] text-accent">
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
            ))}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
