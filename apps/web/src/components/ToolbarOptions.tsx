/**
 * Toolbar — sélection automatique du marché, symbole / timeframe, branchés sur le store marché vanilla.
 * Un changement re-déclenche backfill + souscription côté Chart (effet [exchange, symbol, tf]).
 */
import { useEffect, useRef, useState, type ComponentType } from "react";
import { useStore } from "zustand";
import { marketStore } from "../store/market";
import { orderflowStore } from "../store/orderflow";
import { volumeProfileStore } from "../store/volumeProfile";
import { revenueStore } from "../store/revenue";
import { liqMarksStore } from "../chart/liquidationMarkers";
import { derivativesUiStore } from "../store/derivatives-ui";
// Bandeau ticker (pas une fenêtre Launchpad) + disposition grille.
import { tickerBandStore } from "../store/tickerBand";
// Navigation vers les deux sections CryptoQuant (ni fenêtre, ni indicateur nouveau).
import { cryptoquantUiStore, ENTREES_CQ, type CibleCq } from "../store/cryptoquantUi";
import {
  estNouvelle,
  menuWindowsGroupees,
  windowManagerStore,
  type DisponibiliteVercel,
  type WindowId,
} from "../store/windowManager";
import { chartLayoutStore, type ChartLayoutMode } from "../store/chart-layout";
import { workspacesStore, DEFAULT_WORKSPACE_ID } from "../store/workspaces";
import { exporterSauvegarde, importerSauvegarde } from "../store/persist";
import { PLAYBOOKS } from "../data/playbooks";
import { exportChartImage } from "../chart/drawing";
import { pousserToast } from "../store/toasts";
import { settingsUiStore } from "../store/settings-ui";
import { IS_VERCEL } from "../lib/deployment";
import { raccourciPour } from "../commands/hotkeys";
import { indicatorMenuUiStore } from "../store/indicator-menu-ui";
import { indicatorsStore } from "../store/indicators";
import { macroOverlayStore } from "../store/macro-overlays";
import { INDICATORS, getIndicator } from "@axiom/indicators";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { Badge, CLASSES_CHAMP, LARGEUR_MNEMONIQUE, MenuDeroulant } from "./ui";

const NB_INDICATEURS_ANALYSE = INDICATORS.filter((d) => d.category !== "strategy").length;
const NB_STRATEGIES = INDICATORS.length - NB_INDICATEURS_ANALYSE;

/** Un import ESM échoué peut rester rejeté dans le cache du document courant. */
function ErreurChargement({ message }: { message: string }) {
  return <span role="alert" className="ml-2 text-xs text-down">
    {message}{" "}
    <button type="button" onClick={() => window.location.reload()} className="underline hover:text-text">
      Recharger l'application
    </button>
  </span>;
}

/** Le catalogue n'entre dans le bundle initial qu'à sa première ouverture. */
function IndicateursLazy() {
  const ouvert = useStore(indicatorMenuUiStore, (s) => s.open);
  const actives = useStore(indicatorsStore, (s) => s.indicators);
  const macros = useStore(macroOverlayStore, (s) => s.enabled);
  const nActifs = actives.filter((i) => getIndicator(i.defId)?.category !== "strategy").length + macros.length;
  const [Menu, setMenu] = useState<ComponentType | null>(null);
  const [erreur, setErreur] = useState(false);
  const enVol = useRef(false);
  const conteneur = useRef<HTMLDivElement>(null);
  const etaitOuvert = useRef(ouvert);
  function charger() {
    if (Menu !== null || enVol.current) return;
    enVol.current = true;
    setErreur(false);
    void import("./IndicatorMenu").then((mod) => setMenu(() => mod.IndicatorMenu)).catch(() => setErreur(true))
      .finally(() => { enVol.current = false; });
  }
  useEffect(() => { if (ouvert) charger(); }, [ouvert]);
  useEffect(() => {
    if (etaitOuvert.current && !ouvert) conteneur.current?.querySelector("button")?.focus();
    etaitOuvert.current = ouvert;
  }, [ouvert]);
  if (Menu !== null) return <div ref={conteneur}><Menu /></div>;
  return <div ref={conteneur} className="relative">
    <button type="button" title={`${NB_INDICATEURS_ANALYSE} indicateurs + 3 mesures macro · ${nActifs} actif${nActifs > 1 ? "s" : ""}`}
      className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
      aria-expanded={ouvert && !erreur} disabled={erreur}
      onClick={() => { if (!ouvert) indicatorMenuUiStore.getState().basculer(); charger(); }}>
      Indicateurs <span className="ml-1 text-[10px] opacity-70">{nActifs > 0 ? nActifs : NB_INDICATEURS_ANALYSE}</span>
    </button>
    {erreur && <ErreurChargement message="Chargement impossible." />}
  </div>;
}

/** Le menu Stratégies et son éditeur n'importent pas le menu Indicateurs. */
function StrategiesLazy() {
  const actives = useStore(indicatorsStore, (s) => s.indicators);
  const nActives = actives.filter((i) => getIndicator(i.defId)?.category === "strategy").length;
  const [Menu, setMenu] = useState<ComponentType<{ initialOpen?: boolean }> | null>(null);
  const [erreur, setErreur] = useState(false);
  const enVol = useRef(false);
  if (Menu !== null) return <Menu initialOpen />;
  return <div className="relative">
    <button type="button" title={`${NB_STRATEGIES} stratégies · ${nActives} active${nActives > 1 ? "s" : ""}`}
      className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
      disabled={erreur}
      onClick={() => {
        if (enVol.current) return;
        enVol.current = true;
        setErreur(false);
        void import("./StrategyMenu").then((mod) => setMenu(() => mod.StrategyMenu)).catch(() => setErreur(true))
          .finally(() => { enVol.current = false; });
      }}>
      Stratégies <span className="ml-1 text-[10px] opacity-70">{nActives > 0 ? nActives : NB_STRATEGIES}</span>
    </button>
    {erreur && <ErreurChargement message="Chargement impossible." />}
  </div>;
}

/**
 * Ouvre un sélecteur de fichier, valide et REMPLACE tout l'état `axiom:*` du terminal par
 * la sauvegarde. Confirmation destructive avant écrasement (conservée). Le résultat est
 * signalé par un toast : succès invite à recharger (les stores hydratent au démarrage),
 * échec = message d'erreur — plus de `window.alert` ni de rechargement automatique.
 */
export function declencherImportSauvegarde(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const texte = typeof reader.result === "string" ? reader.result : "";
      if (
        !window.confirm(
          "Remplacer TOUT l'état du terminal par cette sauvegarde ? La page sera rechargée."
        )
      ) {
        return;
      }
      if (importerSauvegarde(texte)) {
        // localStorage vient d'être réécrit : continuer sans recharger laisserait
        // l'état en mémoire incohérent. On recharge (toast visible ~1,2 s avant).
        pousserToast("Sauvegarde importée — rechargement…");
        setTimeout(() => window.location.reload(), 1200);
      } else {
        pousserToast("Sauvegarde invalide : aucun changement effectué.");
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/** Demande un nom et enregistre l'agencement courant sous ce workspace + toast de feedback. */
export function enregistrerWorkspaceAvecNom(): void {
  const nom = window.prompt("Nom du workspace :");
  const label = nom?.trim();
  if (label && label.length > 0) {
    workspacesStore.getState().saveAs(label);
    pousserToast(`Workspace « ${label} » enregistré`);
  }
}

/** Exporte directement les données du terminal, sans credential, puis confirme par toast. */
export function exporterSauvegardeAvecFeedback(): void {
  exporterSauvegarde();
  pousserToast("Sauvegarde exportée · clés API exclues");
}

/** Suffixe « — <touche> » ajouté à une infobulle quand un raccourci existe. */
function avecRaccourci(titre: string, touche: string | null): string {
  return touche === null ? titre : `${titre} — ${touche}`;
}

// Touches des toggles (constantes : dérivées de RACCOURCIS_AIDE, source unique).
const RC_ORDERFLOW = raccourciPour("Orderflow");
const RC_PROFIL_VOL = raccourciPour("Profil Vol");
const RC_LIQ = raccourciPour("Liq");
const RC_REVENUS = raccourciPour("Revenus");
const RC_THEME = raccourciPour("Thème");

// Greffe les commandes Workspaces / sauvegarde dans la palette (⌘K). Enregistrement à
// l'IMPORT (avant le premier rendu de la palette) via le point d'extension du registre.
/**
 * Fenêtres non modales exposées dans le menu « Fonctions » : DÉRIVÉES de
 * `WINDOW_REGISTRY` (source unique) via `menuWindows()` — libellé + mnémonique
 * Bloomberg + ouverture via `windowManagerStore` (évite d'importer les composants
 * lourds / stores co-localisés — prérequis du lazy-load dans App.tsx).
 * TICKER bascule le bandeau (pas une fenêtre) : seule entrée spéciale, insérée
 * après NEWS. DES (`derivatives`) est `menuHidden` (bouton dédié dans la barre).
 */
const TICKER_ENTREE = {
  mnemonique: "TICKER",
  libelle: "Bandeau news défilant",
  ouvrir: () => tickerBandStore.getState().basculer(),
};

/**
 * Entrée de NAVIGATION vers une section CryptoQuant déjà livrée (décision du propriétaire du
 * 2026-09-18) : ni fenêtre du registre (`id` absent), ni indicateur nouveau. Le magasin
 * d'intention ouvre la fenêtre hôte et la section visée se déplie puis défile à l'écran.
 * Mnémonique et libellé viennent de `ENTREES_CQ` (source unique, partagée avec ⌘K) ; le
 * badge « nouveau » a sa propre clé, sans quoi il s'éteindrait avec DES ou CHAIN.
 */
function entreeCq(cible: CibleCq): EntreeFonction {
  const e = ENTREES_CQ[cible];
  return {
    mnemonique: e.mnemonique,
    libelle: e.libelle,
    nouveau: true,
    badgeId: e.badge,
    ouvrir: () => cryptoquantUiStore.getState().demander(cible),
  };
}
type EntreeFonction = {
  id?: WindowId;
  mnemonique: string;
  libelle: string;
  nouveau?: boolean;
  /** Clé du badge « nouveau » d'une entrée SANS fenêtre (sinon `id` en tient lieu). */
  badgeId?: string;
  vercel?: DisponibiliteVercel;
  ouvrir: () => void;
};

/**
 * Badge « nouveau » d'une entrée du menu Fonctions : la clé « vue » est `badgeId` pour une
 * entrée SANS fenêtre (CQTAKR/CQMINE, qui ne doivent pas éteindre le badge de DES ni de
 * CHAIN), sinon l'id de la fenêtre. Sans clé (TICKER), aucun badge. Exportée pour les tests.
 */
export function entreeNeuve(f: EntreeFonction): boolean {
  const cle = f.badgeId ?? f.id;
  return f.nouveau === true && cle !== undefined && estNouvelle(cle);
}

/**
 * Menu Fonctions GROUPÉ par thème (sections dérivées du registre). Il déroulait
 * jusqu'ici 37 entrées à plat dans l'ordre d'implémentation, au-delà de la hauteur du
 * panneau (revue du 2026-08-01 § 6.1). TICKER, qui n'est pas une fenêtre du registre,
 * rejoint « Outils ».
 *
 * Les entrées spéciales (TICKER, CQTAKR, CQMINE) sont ajoutées À LA SUITE des fenêtres de
 * leur groupe : le tri par mnémonique de `menuWindowsGroupees()` ne porte que sur le
 * registre, et les intercaler par ordre alphabétique les noierait parmi les fenêtres.
 * Exporté pour les tests (aucun rendu React possible en environnement node).
 */
export const SECTIONS_FONCTIONS: { groupe: string; entrees: EntreeFonction[] }[] = menuWindowsGroupees().map(
  (section) => ({
    groupe: section.groupe,
    entrees: [
      ...section.entrees.map((w) => ({
        id: w.id,
        mnemonique: w.mnemonique,
        libelle: w.libelle,
        nouveau: w.nouveau,
        vercel: w.vercel,
        ouvrir: () => windowManagerStore.getState().openWindow(w.id),
      })),
      ...(section.groupe === "Outils" ? [TICKER_ENTREE] : []),
      ...(section.groupe === "Marché & dérivés" ? [entreeCq("takers")] : []),
      ...(section.groupe === "On-chain & stablecoins" ? [entreeCq("mineurs")] : []),
    ],
  })
);

/**
 * Menu déroulant compact « Fonctions » : liste les fenêtres non modales (libellé +
 * mnémonique) plutôt que dix boutons dans la barre. Basse fréquence (aucun re-render sur
 * tick) — les actions lisent les stores via getState(), sans abonnement.
 */
export function FonctionsMenu() {
  return (
    <MenuDeroulant
      declencheur={<span>Fonctions</span>}
      titre="Fonctions — ouvrir un panneau (mêmes mnémoniques dans ⌘K)"
    >
      {(fermer) =>
        SECTIONS_FONCTIONS.map((section) => (
          <div key={section.groupe}>
            <div className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-dim">
              {section.groupe}
            </div>
            {section.entrees.map((f) => (
              <button
                key={f.mnemonique}
                type="button"
                role="menuitem"
                onClick={() => {
                  f.ouvrir();
                  fermer();
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-neutral-200 hover:bg-neutral-800"
              >
                {/* Largeur commune du token mnémonique (l'en-tête de fenêtre et la
                    palette en utilisaient trois différentes, et 48 px tronquaient
                    CBPREM / NETLIQ / REPLAY). */}
                <span className={`${LARGEUR_MNEMONIQUE} shrink-0 truncate font-semibold uppercase tracking-wider text-emerald-400`}>
                  {f.mnemonique}
                </span>
                <span className="min-w-0 flex-1 truncate">{f.libelle}</span>
                {IS_VERCEL && f.vercel !== undefined && f.vercel !== "full" && (
                  <Badge ton={f.vercel === "unusable" ? "down" : "warn"}>
                    {f.vercel === "unusable" ? "UNUSABLE" : "PARTIAL"}
                  </Badge>
                )}
                {/* Badge « nouveau » jusqu'à la 1ère ouverture / au 1er clic. */}
                {entreeNeuve(f) && <Badge ton="accent">nouveau</Badge>}
              </button>
            ))}
          </div>
        ))
      }
    </MenuDeroulant>
  );
}

/**
 * Menu « Playbooks » : scénarios 1-clic (PLAY / PLAY-SCALP…). Même pattern que
 * Fonctions — bas fréquence, actions via getState / apply() du catalogue.
 * Découverte Toolbar (B3.3) en plus de la palette ⌘K.
 */
function PlaybooksMenu() {
  return (
    <MenuDeroulant
      declencheur={<span>Playbooks</span>}
      titre="Playbooks 1-clic — mêmes mnémoniques PLAY* dans ⌘K"
      classePanneau="w-72"
    >
      {(fermer) =>
        PLAYBOOKS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="menuitem"
            title={p.description}
            onClick={() => {
              p.apply();
              pousserToast(`Playbook ${p.nom} appliqué`);
              fermer();
            }}
            className="flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800"
          >
            <span className="flex items-center gap-2">
              <span className="shrink-0 font-semibold uppercase tracking-wider text-accent">
                {p.mnemonique}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{p.nom}</span>
            </span>
            <span className="truncate pl-0 text-[10px] text-neutral-500">{p.description}</span>
          </button>
        ))
      }
    </MenuDeroulant>
  );
}

/** Modes de disposition de la grille multi-chart proposés dans la Toolbar (icônes compactes). */
const LAYOUT_OPTIONS: { mode: ChartLayoutMode; label: string; title: string }[] = [
  { mode: "1", label: "1", title: "Un seul graphe" },
  { mode: "2h", label: "2h", title: "Deux côte à côte" },
  { mode: "2v", label: "2v", title: "Deux empilés" },
  { mode: "2x2", label: "4", title: "Grille 2×2" },
];

/**
 * Sélecteur compact de disposition de la grille multi-chart (Phase 4). Pilote le MÊME store
 * vanilla que la barre flottante de ChartGrid — les deux restent donc synchronisés. Basse
 * fréquence (aucun re-render sur tick de marché).
 */
function LayoutSwitcher() {
  const layout = useStore(chartLayoutStore, (s) => s.layout);
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Disposition des graphes">
      {LAYOUT_OPTIONS.map((o) => (
        <button
          key={o.mode}
          type="button"
          title={o.title}
          aria-label={o.title}
          aria-pressed={layout === o.mode}
          onClick={() => chartLayoutStore.getState().setLayout(o.mode)}
          className={`rounded px-2 py-1 font-mono text-xs ${
            layout === o.mode
              ? "bg-neutral-200 text-neutral-900"
              : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Sélecteur de workspaces (presets nommés) — menu compact : nom courant + liste
 * commutable, « Enregistrer sous… », renommer/supprimer les presets, et export/import
 * de la sauvegarde complète. Basse fréquence (aucun re-render sur tick).
 */
function WorkspaceMenu() {
  const workspaces = useStore(workspacesStore, (s) => s.workspaces);
  const currentId = useStore(workspacesStore, (s) => s.currentId);
  const currentName = workspaces.find((w) => w.id === currentId)?.name ?? "Défaut";

  const itemClass =
    "w-full rounded px-2 py-1 text-left text-xs text-neutral-200 hover:bg-neutral-800";

  return (
    <MenuDeroulant
      align="right"
      titre="Workspaces (agencements enregistrés)"
      declencheur={
        <>
          <span className="text-neutral-500">WS</span>
          <span className="max-w-[120px] truncate">{currentName}</span>
        </>
      }
    >
      {(fermer) => {
        const onSaveAs = () => {
          enregistrerWorkspaceAvecNom();
          fermer();
        };
        const onRename = (id: string, name: string) => {
          const nom = window.prompt("Nouveau nom :", name);
          if (nom && nom.trim().length > 0) workspacesStore.getState().rename(id, nom.trim());
        };
        const onRemove = (id: string, name: string) => {
          if (window.confirm(`Supprimer le workspace « ${name} » ?`)) workspacesStore.getState().remove(id);
        };
        return (
          <>
            {workspaces.map((w) => (
              <div key={w.id} className="flex items-center gap-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    workspacesStore.getState().apply(w.id);
                    fermer();
                  }}
                  className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-xs hover:bg-neutral-800 ${
                    w.id === currentId ? "text-emerald-400" : "text-neutral-200"
                  }`}
                >
                  {w.id === currentId ? "● " : ""}
                  {w.name}
                </button>
                {w.id !== DEFAULT_WORKSPACE_ID && (
                  <>
                    <button
                      type="button"
                      onClick={() => onRename(w.id, w.name)}
                      title="Renommer"
                      className="rounded px-1 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(w.id, w.name)}
                      title="Supprimer"
                      className="rounded px-1 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-down"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            ))}

            <div className="my-1 h-px bg-neutral-800" />
            <button type="button" role="menuitem" onClick={onSaveAs} className={itemClass}>
              Enregistrer sous…
            </button>

            <div className="my-1 h-px bg-neutral-800" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                exporterSauvegardeAvecFeedback();
                fermer();
              }}
              className={itemClass}
            >
              Exporter la sauvegarde…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                declencherImportSauvegarde();
                fermer();
              }}
              className={itemClass}
            >
              Importer une sauvegarde…
            </button>
          </>
        );
      }}
    </MenuDeroulant>
  );
}

export function ToolbarOptions({ optionsOuvertes = false, onOptionsChange = () => {} }: {
  optionsOuvertes?: boolean;
  onOptionsChange?: (open: boolean) => void;
}) {
  const optionsRef = useRef<HTMLButtonElement>(null);
  const fermerOptions = () => { onOptionsChange(false); optionsRef.current?.focus(); };
  useEffect(() => {
    if (!optionsOuvertes) return;
    const echap = (e: KeyboardEvent) => {
      // Les menus enfants traitent leur propre Échap et conservent les options.
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector('[role="menu"]')) {
        e.preventDefault();
        fermerOptions();
      }
    };
    document.addEventListener("keydown", echap);
    return () => document.removeEventListener("keydown", echap);
  }, [optionsOuvertes]);
  // Une action de navigation ferme la feuille pour révéler immédiatement la fenêtre.
  useEffect(() => windowManagerStore.subscribe((next, prev) => {
    if (next.windows !== prev.windows && Object.entries(next.windows).some(([id, w]) =>
      w.open && !w.minimized && (!prev.windows[id]?.open || prev.windows[id]?.z !== w.z))) {
      onOptionsChange(false);
    }
  }), [onOptionsChange]);
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbol = useStore(marketStore, (s) => s.symbol);
  const timeframe = useStore(marketStore, (s) => s.timeframe);
  const tickerVisible = useStore(tickerBandStore, (s) => s.visible);
  const orderflowEnabled = useStore(orderflowStore, (s) => s.enabled);
  const toggleOrderflow = useStore(orderflowStore, (s) => s.toggle);
  const vpEnabled = useStore(volumeProfileStore, (s) => s.enabled);
  const toggleVp = useStore(volumeProfileStore, (s) => s.toggle);
  const revenueEnabled = useStore(revenueStore, (s) => s.enabled);
  const toggleRevenue = useStore(revenueStore, (s) => s.toggle);
  const liqActif = useStore(liqMarksStore, (s) => s.actif);
  const toggleLiq = useStore(liqMarksStore, (s) => s.basculer);
  const openDerivatives = useStore(derivativesUiStore, (s) => s.openDerivatives);

  const [footprintPanelOpen, setFootprintPanelOpen] = useState(false);
  const [FootprintPanel, setFootprintPanel] = useState<ComponentType<{ onClose: () => void }> | null>(null);
  const [erreurFootprint, setErreurFootprint] = useState(false);
  const chargementFootprint = useRef(false);
  const declencheurFootprint = useRef<HTMLButtonElement>(null);
  function fermerFootprint() {
    setFootprintPanelOpen(false);
    declencheurFootprint.current?.focus();
  }
  function basculerFootprint() {
    if (erreurFootprint) return;
    if (footprintPanelOpen) { fermerFootprint(); return; }
    setFootprintPanelOpen(true);
    if (FootprintPanel !== null || chargementFootprint.current) return;
    chargementFootprint.current = true;
    setErreurFootprint(false);
    void import("./FootprintSettingsPanel").then((mod) => setFootprintPanel(() => mod.FootprintSettingsPanel))
      .catch(() => { setFootprintPanelOpen(false); setErreurFootprint(true); })
      .finally(() => { chargementFootprint.current = false; });
  }
  useEffect(() => {
    if (!footprintPanelOpen) return;
    const echap = (event: KeyboardEvent) => { if (event.key === "Escape") fermerFootprint(); };
    document.addEventListener("keydown", echap);
    return () => document.removeEventListener("keydown", echap);
  }, [footprintPanelOpen]);

  const isBinance = exchange === "binance";
  const isTradfi = exchange === "twelvedata";
  const isMexc = exchange === "mexc";
  const isSynthetic = exchange === "synthetic";
  // MEXC = catalogue crypto + actions tokenisées → presets dédiés ; sinon crypto/tradfi.
  // Sources SANS flux tick (polling REST) → orderflow/footprint indisponibles.
  const noTradeStream = isTradfi || isMexc || isSynthetic;

  return (
    <>
    <section role="dialog" aria-label="Options du graphique" className="axiom-options-sheet">
      <div className="axiom-sheet-heading"><h2>Options du graphique</h2><button type="button" aria-label="Fermer les options" onClick={fermerOptions}>✕</button></div>
      <div className="axiom-advanced-controls">
      {/* Disposition de la grille multi-chart (1 / 2h / 2v / 4) — synchronisé avec ChartGrid. */}
      <LayoutSwitcher />

      <div className="mx-1 h-5 w-px bg-neutral-800" />

      {/* Panneau des indicateurs @axiom (activer/désactiver). */}
      <IndicateursLazy />

      {/* Panneau des stratégies (catégorie strategy — foyer exclusif). */}
      <StrategiesLazy />

      {/* Orderflow (M5) : CVD + footprint, alimenté par le flux de trades de la
          source active. Footprint sur toutes les sources à flux de trades ; pane CVD
          créé UNIQUEMENT sur Binance (seule source au split buy/sell historique). */}
      <button
        ref={declencheurFootprint}
        type="button"
        onClick={toggleOrderflow}
        onContextMenu={(e) => {
          e.preventDefault();
          basculerFootprint();
        }}
        onKeyDown={(e) => {
          if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
            e.preventDefault();
            basculerFootprint();
          }
        }}
        aria-pressed={orderflowEnabled}
        disabled={noTradeStream}
        title={
          noTradeStream
            ? "Indisponible sur cette source (aucun flux de trades)"
            : avecRaccourci(
                isBinance ? "Orderflow" : "Footprint seul — CVD indisponible (pas de volumes buy/sell sur cette source)",
                RC_ORDERFLOW,
              )
        }
        className={`rounded px-2 py-1 text-xs ${
          noTradeStream
            ? "cursor-not-allowed bg-neutral-900 text-neutral-700"
            : orderflowEnabled
              ? "bg-cyan-500 text-accent-ink"
              : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
        }`}
      >
        Orderflow
      </button>
      {erreurFootprint && <ErreurChargement message="Réglages Footprint indisponibles." />}
      {<button type="button" onClick={basculerFootprint} disabled={noTradeStream}
        className="rounded border border-border px-2 text-xs text-text-dim">Réglages Footprint</button>}

      {/* Profil de volume par zone de prix (VPVR) — toutes sources sauf synthétiques. */}
      <button
        type="button"
        onClick={toggleVp}
        aria-pressed={vpEnabled}
        disabled={isSynthetic}
        title={
          isSynthetic
            ? "Indisponible sur une série synthétique (volume non défini)"
            : avecRaccourci("Volume par zone de prix (plage visible)", RC_PROFIL_VOL)
        }
        className={`rounded px-2 py-1 text-xs ${
          isSynthetic
            ? "cursor-not-allowed bg-neutral-900 text-neutral-700"
            : vpEnabled
              ? "bg-amber-500 text-accent-ink"
              : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
        }`}
      >
        Profil Vol
      </button>

      {/* Heatmap des liquidations RÉELLEMENT exécutées (flux perp Bybit/OKX) — même
          bascule que ⌘K LIQMARK / la fenêtre LIQ (les niveaux ESTIMÉS restent via
          ⌘K LIQEST). Grisé hors perp (tradfi / synthétique : aucun flux de liquidations). */}
      <button
        type="button"
        onClick={toggleLiq}
        aria-pressed={liqActif}
        disabled={isTradfi || isSynthetic}
        title={
          isTradfi || isSynthetic
            ? "Indisponible sur cette source (liquidations perp Bybit/OKX uniquement)"
            : avecRaccourci("Heatmap liquidations (exécutées)", RC_LIQ)
        }
        className={`rounded px-2 py-1 text-xs ${
          isTradfi || isSynthetic
            ? "cursor-not-allowed bg-neutral-900 text-neutral-700"
            : liqActif
              ? "bg-accent text-accent-ink"
              : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
        }`}
      >
        Liq
      </button>

      {/* Revenus on-chain du protocole de l'actif (DefiLlama, sous-pane dédié).
          N'affiche une courbe que pour les actifs « protocole » (UNI, AAVE, GMX…) ;
          dégradation propre (aucun pane) pour BTC/ETH/SOL et tokens sans données. */}
      <button
        type="button"
        onClick={toggleRevenue}
        aria-pressed={revenueEnabled}
        disabled={isTradfi || isSynthetic}
        title={
          isSynthetic
            ? "Indisponible sur une série synthétique (volume non défini)"
            : isTradfi
              ? "Indisponible en marchés traditionnels (revenus on-chain crypto uniquement)"
              : avecRaccourci(
                  "Revenus on-chain du protocole (DefiLlama) — actifs de protocole uniquement",
                  RC_REVENUS,
                )
        }
        className={`rounded px-2 py-1 text-xs ${
          isTradfi || isSynthetic
            ? "cursor-not-allowed bg-neutral-900 text-neutral-700"
            : revenueEnabled
              ? "bg-accent text-accent-ink"
              : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
        }`}
      >
        Revenus
      </button>

      {/* Fenêtre dédiée aux produits dérivés (ouvre même sans clé pour guider vers Réglages). */}
      <button
        type="button"
        onClick={openDerivatives}
        title="Voir les produits dérivés Coinalyze"
        className="rounded px-2 py-1 text-xs bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
      >
        Produits dérivés
      </button>

      {/* Menu compact des fenêtres non modales de la Phase 3 (ECO, NEWS, CORR…). */}

      {/* Playbooks 1-clic (B3) — découverte Toolbar en plus de ⌘K PLAY*. */}
      <PlaybooksMenu />
      <button type="button" aria-pressed={tickerVisible} onClick={() => tickerBandStore.getState().basculer()} className="rounded border border-border px-3 text-xs">Bandeau actualités</button>

      {/* Export du graphe courant en PNG (téléchargement « SYMBOLE-TF-date.png »). */}
      <button
        type="button"
        onClick={() => {
          pousserToast(exportChartImage(symbol, timeframe) ? "PNG exporté" : "Aucun graphe à exporter");
        }}
        title="Exporter le graphe en image PNG"
        className="rounded px-2 py-1 text-xs bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
      >
        Exporter PNG
      </button>

      {/* Workspaces + thème (poussés à droite). */}
      <div className="ml-auto flex items-center gap-2">
        <WorkspaceMenu />
        <span className="text-xs text-neutral-500" title={avecRaccourci("Thème suivant", RC_THEME)}>
          Thème
        </span>
        <ThemeSwitcher />
      </div>
      </div>
    </section>

    {/* Panneau de réglages footprint (cliquer droit sur Orderflow). */}
    {footprintPanelOpen && FootprintPanel && <FootprintPanel onClose={fermerFootprint} />}
    </>
  );
}
