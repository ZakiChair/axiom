/**
 * Menu « Indicateurs » — bouton de la toolbar ouvrant un panneau à DEUX ONGLETS.
 *
 * Onglet « Techniques » (catalogue du registre) :
 *  1. une section « Actifs » en tête (les INSTANCES affichées, chacune avec ses
 *     params ; boutons dupliquer / éditer / retirer, éditeur de params inline) ;
 *  2. le CATALOGUE des indicateurs du registre @axiom/indicators (compteur live),
 *     groupé par catégorie en sections repliables et filtrable par recherche.
 *     Ordre des catégories orienté crypto : Order Flow → Volume → Dérivés
 *     d'abord. Les stratégies ont leur propre menu (foyer exclusif).
 *
 * Onglet « Macro » (MacroIndicators) : les 3 mesures de liquidité (cap. crypto,
 * stablecoins, M2), chacune cochable pour tracer le pane macro du graphe. Elles
 * vivaient dans la sidebar droite ; l'onglet leur rend la place latérale. Ce ne sont
 * PAS des `IndicatorDef` — séries fetchées en async, dessinées par un contrôleur
 * dédié (chart/macro.ts) — d'où un onglet plutôt qu'une catégorie du registre.
 *
 * MULTI-INSTANCES : cliquer un indicateur du catalogue AJOUTE une nouvelle instance
 * aux params par défaut (EMA(20) puis EMA(50) coexistent). L'état vient du
 * `indicatorsStore` (vanilla) ; le Chart réagit à ses changements de façon
 * impérative (aucun re-render du canvas).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { INDICATORS, getIndicator } from "@axiom/indicators";
import type { IndicatorCategory, IndicatorDef, IndicatorInput } from "@axiom/types";
import {
  indicatorsStore,
  formatInstanceLabel,
  type ActiveIndicator,
} from "../store/indicators";
import { marketStore } from "../store/market";
import { orderflowStore } from "../store/orderflow";
import { OCN_PERIODS } from "../chart/openCloseNet.calc";
import { macroOverlayStore } from "../store/macro-overlays";
import { indicatorMenuUiStore } from "../store/indicator-menu-ui";
import { chartCapaciteStore, plafondPanesAtteint } from "../store/chartCapacite";
import { correspondAlias, normaliser } from "./indicateurAlias";
import { settingsUiStore } from "../store/settings-ui";
import { tfAtLeast } from "../chart/tfOrder";
import { CLASSES_CHAMP, indexRoving, Input, Onglets, Select } from "./ui";
import { MacroIndicators } from "./MacroIndicators";
import { JeuxIndicateurs } from "./JeuxIndicateurs";
import { raisonUnusableIndicateur } from "../lib/indicatorUsability";

/** Catalogue du menu Indicateurs : TOUT sauf les stratégies (foyer exclusif — menu Stratégies). */
export const INDICATEURS_ANALYSE = INDICATORS.filter((d) => d.category !== "strategy");

/** Libellés FR des catégories + ordre d'affichage. */
const CATEGORY_LABELS: Partial<Record<IndicatorCategory, string>> = {
  orderflow: "Order Flow",
  volume: "Volume",
  derivatives: "Dérivés",
  trend: "Tendance",
  momentum: "Momentum",
  volatility: "Volatilité",
  statistical: "Statistiques",
  support_resistance: "Support / Résistance",
  billwilliams: "Bill Williams",
};

/**
 * Ordre DA crypto-first : l'edge (orderflow / volume / dérivés) en tête, avant
 * le catalogue technique classique — cohérent avec le positionnement AXIOM.
 * `strategy` est absent : filtré en amont par `INDICATEURS_ANALYSE`.
 * EXHAUSTIVITÉ verrouillée par test : une catégorie présente dans le catalogue
 * mais absente d'ici rendrait ses defs INVISIBLES en silence (groupByCategory
 * n'itère que cet ordre) — cf. IndicatorMenu.sousGroupes.test.ts.
 */
export const CATEGORY_ORDER: IndicatorCategory[] = [
  "orderflow",
  "volume",
  "derivatives",
  "trend",
  "momentum",
  "volatility",
  "statistical",
  "support_resistance",
  "billwilliams",
];

/**
 * Sous-groupes d'AFFICHAGE de la catégorie Dérivés (classement produit, pas un
 * type) : la catégorie mélange trois natures que le menu sépare — dérivés perp
 * (funding/OI/basis), métriques on-chain BTC et positionnement (ratios L/S).
 * Table exhaustive : un def `derivatives` absent d'ici fait échouer le test
 * jumeau (IndicatorMenu.sousGroupes.test.ts) — classer avant de câbler.
 */
export const SOUS_GROUPES_DERIVES: Record<string, "perp" | "onchain" | "positionnement"> = {
  openInterest: "perp",
  fundingRate: "perp",
  fundingZScore: "perp",
  fundingApr: "perp",
  fundingNotional: "perp",
  oiChange: "perp",
  basisPct: "perp",
  quarterlyBasis: "perp",
  nvt: "onchain",
  mvrv: "onchain",
  mvrvZScore: "onchain",
  nupl: "onchain",
  puell: "onchain",
  sopr: "onchain",
  asopr: "onchain",
  sthSopr: "onchain",
  lthSopr: "onchain",
  reserveRisk: "onchain",
  rhodlRatio: "onchain",
  cvdd: "onchain",
  balancedPrice: "onchain",
  realizedPrice: "onchain",
  ssr: "onchain",
  stablecoinSupply: "onchain",
  lsAccountRatio: "positionnement",
  lsTopTraderRatio: "positionnement",
  takerBuySellRatio: "positionnement",
};

const LIBELLES_SOUS_GROUPES_DERIVES: Record<"perp" | "onchain" | "positionnement", string> = {
  perp: "Dérivés perp",
  onchain: "On-chain",
  positionnement: "Positionnement",
};

/**
 * Découpe une section du catalogue en sous-groupes d'affichage : seule la
 * catégorie Dérivés en a ; les autres rendent un unique groupe sans sous-titre.
 * PURE (testée) — un def derivatives non classé retombe dans « Dérivés perp ».
 */
export function groupesAffichage(
  cat: IndicatorCategory,
  defs: IndicatorDef[],
): Array<[string | null, IndicatorDef[]]> {
  if (cat !== "derivatives") return [[null, defs]];
  const ordre = ["perp", "onchain", "positionnement"] as const;
  const groupes: Array<[string | null, IndicatorDef[]]> = [];
  for (const g of ordre) {
    const liste = defs.filter((d) => (SOUS_GROUPES_DERIVES[d.id] ?? "perp") === g);
    if (liste.length > 0) groupes.push([LIBELLES_SOUS_GROUPES_DERIVES[g], liste]);
  }
  return groupes;
}

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
export function InstanceParamsEditor({
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
        <Select
          value={String(value)}
          onChange={(e) => set(input.key, e.target.value)}
          className="w-24"
        >
          {input.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </Select>
      );
    }
    if (input.type === "boolean") {
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => set(input.key, e.target.checked)}
          className="accent-accent"
        />
      );
    }
    if (input.type === "number") {
      return (
        <Input
          type="number"
          value={typeof value === "number" ? value : Number(value)}
          min={input.min}
          max={input.max}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            // On ignore une saisie non finie (champ vidé transitoirement).
            if (Number.isFinite(n)) set(input.key, n);
          }}
          className="w-20"
        />
      );
    }
    // Repli (source sans options) : saisie texte libre.
    return (
      <Input
        type="text"
        value={String(value)}
        onChange={(e) => set(input.key, e.target.value)}
        className="w-24"
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
  // Ouverture + onglet dans un store : la commande Launchpad « MACRO » ouvre le menu
  // directement sur l'onglet Macro (cf. store/indicator-menu-ui.ts).
  const open = useStore(indicatorMenuUiStore, (s) => s.open);
  const onglet = useStore(indicatorMenuUiStore, (s) => s.onglet);
  const basculerMenu = useStore(indicatorMenuUiStore, (s) => s.basculer);
  const fermerMenu = useStore(indicatorMenuUiStore, (s) => s.fermer);
  const setOnglet = useStore(indicatorMenuUiStore, (s) => s.setOnglet);
  const instanceCible = useStore(indicatorMenuUiStore, (s) => s.instanceCible);
  const cibleConsommee = useStore(indicatorMenuUiStore, (s) => s.cibleConsommee);
  const [query, setQuery] = useState("");
  // Sections repliées (set d'ids de catégorie). Par défaut : tout ouvert.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // instanceId dont l'éditeur de params est déplié (un seul à la fois).
  const [editingId, setEditingId] = useState<string | null>(null);

  // Ouverture ciblée depuis le graphe (⚙ d'une légende, double-clic sur un pane) :
  // on déplie l'éditeur de CETTE instance, puis on accuse réception — l'intention ne
  // doit pas se rejouer à la prochaine ouverture du menu.
  useEffect(() => {
    if (instanceCible === null) return;
    setEditingId(instanceCible);
    cibleConsommee();
  }, [instanceCible, cibleConsommee]);

  const active = useStore(indicatorsStore, (s) => s.indicators);
  // Capacité en panes du graphe maître, publiée par le contrôleur d'indicateurs.
  const paneMaxCourant = useStore(chartCapaciteStore, (s) => s.paneMax);
  const panesActifs = useMemo(
    () => active.filter((i) => getIndicator(i.defId)?.pane !== "overlay").length,
    [active]
  );
  // Macros actives : elles comptent dans le badge du bouton au même titre que les
  // instances techniques (sinon, macros seules cochées, le badge afficherait le total
  // du catalogue — ce qui se lit comme « aucune active »).
  const macrosActives = useStore(macroOverlayStore, (s) => s.enabled);
  const openSettings = useStore(settingsUiStore, (s) => s.openSettings);
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbol = useStore(marketStore, (s) => s.symbol);
  const timeframe = useStore(marketStore, (s) => s.timeframe);
  // OCN (overlay Open/Close Net) : épinglé en tête de la section Order Flow.
  // Pas un IndicatorDef (overlay canvas du contrôleur orderflow, cf. openCloseNet.ts).
  const ocnActif = useStore(orderflowStore, (s) => s.showOpenCloseNet);
  const setOcn = useStore(orderflowStore, (s) => s.setShowOpenCloseNet);
  const orderflowEnabled = useStore(orderflowStore, (s) => s.enabled);
  const setOrderflowEnabled = useStore(orderflowStore, (s) => s.setEnabled);
  const add = useStore(indicatorsStore, (s) => s.add);
  const remove = useStore(indicatorsStore, (s) => s.remove);
  const duplicate = useStore(indicatorsStore, (s) => s.duplicate);
  const updateParams = useStore(indicatorsStore, (s) => s.updateParams);

  // Foyer exclusif : les instances de stratégies vivent dans le menu Stratégies.
  const activesAnalyse = useMemo(
    () => active.filter((i) => getIndicator(i.defId)?.category !== "strategy"),
    [active],
  );

  // Nombre d'instances actives par defId (badge du catalogue).
  const countByDef = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of active) m.set(i.defId, (m.get(i.defId) ?? 0) + 1);
    return m;
  }, [active]);

  const q = query.trim().toLowerCase();
  // Requête normalisée (sans accents ni tirets) pour les alias français : le catalogue
  // est en sigles anglais, « moyenne mobile » ne matchait rien dans une app 100 % FR.
  const qNorm = normaliser(query);
  const filtered = useMemo(() => {
    if (!q) return INDICATEURS_ANALYSE;
    return INDICATEURS_ANALYSE.filter((d) => {
      if (d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q)) return true;
      // Recherche par libellé de catégorie (ex. « order », « dérivés »).
      const catLabel = (CATEGORY_LABELS[d.category] ?? d.category).toLowerCase();
      if (catLabel.includes(q) || d.category.toLowerCase().includes(q)) return true;
      return correspondAlias(d.id, qNorm);
    });
  }, [q, qNorm]);

  // L'OCN est une pseudo-entrée épinglée HORS registre : quand la recherche le
  // matche sans matcher aucun def orderflow, on garde la section visible.
  const ocnMatch = !q || "open/close net ocn oi positions flux".includes(q);
  const groups = useMemo(() => {
    const g = groupByCategory(filtered);
    if (q && ocnMatch && !g.some(([cat]) => cat === "orderflow")) {
      g.unshift(["orderflow", []]);
    }
    return g;
  }, [filtered, ocnMatch, q]);

  const toggleSection = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // Navigation clavier du panneau : ↑/↓/Home/End en focus roving sur les
  // boutons d'ajout du catalogue ; Échap ferme le menu.
  const rechercheRef = useRef<HTMLInputElement | null>(null);
  const panneauRef = useRef<HTMLDivElement | null>(null);

  function itemsAjout(): HTMLButtonElement[] {
    return Array.from(
      panneauRef.current?.querySelectorAll<HTMLButtonElement>("button[data-item-indicateur]:not(:disabled)") ?? [],
    );
  }

  function onKeyDownPanneau(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      fermerMenu();
      return;
    }
    // Entrée depuis le champ de recherche : ajoute le PREMIER résultat non grisé.
    // Sans cela, même avec un unique résultat il fallait ↓ puis Entrée.
    if (e.key === "Enter" && document.activeElement === rechercheRef.current) {
      const premier = itemsAjout()[0];
      if (premier) {
        e.preventDefault();
        premier.click();
        rechercheRef.current?.focus(); // on reste dans le champ pour enchaîner
      }
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

  // Total affiché en badge : instances techniques + mesures macro cochées.
  const totalActifs = activesAnalyse.length + macrosActives.length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => basculerMenu()}
        title={`${INDICATEURS_ANALYSE.length} indicateurs + 3 mesures macro · ${totalActifs} actif${
          totalActifs > 1 ? "s" : ""
        }`}
        className={`rounded px-2 py-1 text-xs tabular-nums ${
          open
            ? "bg-neutral-200 text-neutral-900"
            : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
        }`}
      >
        Indicateurs
        <span className="ml-1 text-[10px] opacity-70">
          {totalActifs > 0 ? totalActifs : INDICATEURS_ANALYSE.length}
        </span>
      </button>

      {open && (
        <>
        {/* Zone de fermeture au clic extérieur (même mécanisme que les menus de la Toolbar). */}
        <div className="fixed inset-0 z-40" onClick={() => fermerMenu()} />
        <div
          ref={panneauRef}
          onKeyDown={onKeyDownPanneau}
          className="absolute left-0 top-full z-50 mt-1 flex max-h-[70vh] w-72 flex-col rounded border border-neutral-800 bg-neutral-900 shadow-xl"
        >
          {/* Onglets : catalogue technique | mesures macro. Les contenus sont montés
              CONDITIONNELLEMENT (pas masqués en CSS) — les items de l'onglet inactif ne
              sont donc pas dans le DOM et le focus roving ↑/↓ ne les traverse jamais. */}
          <Onglets
            options={[
              { id: "techniques", label: "Techniques" },
              {
                id: "macro",
                label: macrosActives.length > 0 ? `Macro ${macrosActives.length}` : "Macro",
              },
            ]}
            actif={onglet}
            onChange={setOnglet}
          />

          {onglet === "macro" && (
            <MacroIndicators
              onOuvrirReglages={() => {
                // Le slide-over Réglages passerait devant un menu resté ouvert.
                fermerMenu();
                openSettings();
              }}
            />
          )}

          {onglet === "techniques" && (
          <>
          {/* Section « Actifs » : les instances affichées, éditables par instance. */}
          {activesAnalyse.length > 0 && (
            <div className="border-b border-neutral-800 p-1">
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
                Actifs <span className="text-neutral-600">{activesAnalyse.length}</span>
              </div>
              {activesAnalyse.map((inst) => {
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

          {/* Jeux nommés : rappeler un setup complet en un clic (ou une frappe ⌘K)
              plutôt que re-cocher huit lignes dans un panneau de 288 px. */}
          <JeuxIndicateurs actives={activesAnalyse} />

          {/* Recherche */}
          <div className="border-b border-neutral-800 p-2">
            <input
              ref={rechercheRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher… (CVD, RVOL, orderflow…)"
              autoFocus
              className={`${CLASSES_CHAMP} w-full`}
            />
            <p className="mt-1 px-0.5 text-[10px] text-text-dim">
              {filtered.length}/{INDICATEURS_ANALYSE.length} · Order Flow en tête du catalogue
            </p>
          </div>

          {/* Catalogue groupé scrollable — cliquer AJOUTE une instance. */}
          <div className="flex-1 overflow-y-auto p-1">
            {groups.length === 0 && (
              <div className="px-2 py-6 text-center text-xs text-text-dim">
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
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim hover:bg-neutral-800"
                  >
                    <span>{CATEGORY_LABELS[cat] ?? cat}</span>
                    <span className="flex items-center gap-1 text-neutral-600">
                      <span>{defs.length}</span>
                      <span>{isCollapsed ? "▸" : "▾"}</span>
                    </span>
                  </button>

                  {/* OCN épinglé en tête d'Order Flow — overlay contrôleur, hors registre.
                      L'activer enclenche aussi l'orderflow (prérequis flux tick). */}
                  {cat === "orderflow" &&
                    !isCollapsed &&
                    ocnMatch &&
                    (() => {
                      const ocnDisabled =
                        exchange !== "binance" || !OCN_PERIODS.has(timeframe);
                      const ocnTitle =
                        exchange !== "binance"
                          ? "Open interest disponible uniquement sur Binance"
                          : !OCN_PERIODS.has(timeframe)
                            ? "Nécessite un timeframe entre 5m et 1d"
                            : ocnActif
                              ? "Retirer l'overlay OCN"
                              : "Afficher l'overlay OCN (active l'orderflow)";
                      return (
                        <button
                          type="button"
                          data-item-indicateur=""
                          title={ocnTitle}
                          disabled={ocnDisabled}
                          onClick={() => {
                            if (ocnDisabled) return;
                            const suivant = !ocnActif;
                            setOcn(suivant);
                            if (suivant && !orderflowEnabled) setOrderflowEnabled(true);
                          }}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                            ocnDisabled
                              ? "cursor-not-allowed text-neutral-600"
                              : "cursor-pointer text-neutral-200 hover:bg-neutral-800"
                          }`}
                        >
                          <span className="text-accent">{ocnActif ? "✓" : "＋"}</span>
                          <span className="flex-1 truncate">Open/Close Net (OCN)</span>
                          {ocnActif && (
                            <span className="rounded bg-accent/20 px-1 text-[10px] text-accent">
                              actif
                            </span>
                          )}
                          <span className="text-[10px] uppercase text-neutral-500">prix</span>
                        </button>
                      );
                    })()}

                  {!isCollapsed &&
                    groupesAffichage(cat, defs).map(([sousTitre, defsGroupe]) => (
                      <div key={sousTitre ?? "tous"}>
                        {sousTitre !== null && (
                          <div className="px-2 pb-0.5 pt-1.5 text-[10px] uppercase tracking-[0.12em] text-neutral-600">
                            {sousTitre}
                          </div>
                        )}
                        {defsGroupe.map((def) => {
                      const count = countByDef.get(def.id) ?? 0;
                      const raisonUnusable = raisonUnusableIndicateur(def, { exchange, symbol, timeframe });
                      const disabledSynthetic = exchange === "synthetic" && def.id === "volume";
                      // Grisage par TF minimal (Task 14) : def dérivé (OI/funding/NVT/MVRV…)
                      // non pertinent en dessous de son `minTimeframe` (ex. données quotidiennes).
                      const disabledTf =
                        def.minTimeframe !== undefined && !tfAtLeast(timeframe, def.minTimeframe);
                      // Plus de place en hauteur : au-delà du plafond, klinecharts prend
                      // la hauteur du pane PRIX (aucun plancher côté bougies) et
                      // l'indicateur ajouté rendrait 0 px sans le dire. On refuse en
                      // amont, avec la sortie à faire.
                      const disabledPlace =
                        def.pane !== "overlay" && plafondPanesAtteint(panesActifs, paneMaxCourant);
                      const disabled = raisonUnusable !== null || disabledSynthetic || disabledTf || disabledPlace;
                      const title = raisonUnusable ?? (disabledSynthetic
                        ? "Volume non défini sur une série synthétique"
                        : disabledTf
                          ? `Nécessite ≥ ${def.minTimeframe}`
                          : disabledPlace
                            ? `${paneMaxCourant} panes maximum à cette hauteur de fenêtre : fermez-en un, agrandissez la fenêtre, ou choisissez un indicateur qui se pose sur les prix`
                            : "Ajouter une instance");
                      return (
                        <button
                          key={def.id}
                          type="button"
                          data-item-indicateur=""
                          title={title}
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
                          <span className="flex-1 truncate">{def.name}</span>
                          {raisonUnusable !== null && (
                            <span className="shrink-0 rounded bg-down/15 px-1 text-[9px] tracking-wider text-down">
                              UNUSABLE
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
              );
            })}
          </div>
          </>
          )}
        </div>
        </>
      )}
    </div>
  );
}
