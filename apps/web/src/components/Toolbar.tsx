/**
 * Toolbar — sélecteurs source / symbole / timeframe, branchés sur le store marché vanilla.
 * Un changement re-déclenche backfill + souscription côté Chart (effet [exchange, symbol, tf]).
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { ExchangeId, Timeframe } from "@axiom/types";
import { marketStore } from "../store/market";
import { orderflowStore } from "../store/orderflow";
import { volumeProfileStore } from "../store/volumeProfile";
import { revenueStore } from "../store/revenue";
import { liqMarksStore } from "../chart/liquidationMarkers";
import { derivativesUiStore } from "../store/derivatives-ui";
// Bandeau ticker (pas une fenêtre Launchpad) + disposition grille.
import { tickerBandStore } from "../store/tickerBand";
import {
  estNouvelle,
  menuWindowsGroupees,
  windowManagerStore,
  type DisponibiliteVercel,
  type WindowId,
} from "../store/windowManager";
import { FootprintSettingsPanel } from "./FootprintSettingsPanel";
import { chartLayoutStore, type ChartLayoutMode } from "../store/chart-layout";
import { workspacesStore, DEFAULT_WORKSPACE_ID } from "../store/workspaces";
import { exporterSauvegarde, importerSauvegarde } from "../store/persist";
import { enregistrerCommandes } from "../commands/registry";
import { supportedTimeframesFor } from "../data/adapters";
import { PLAYBOOKS } from "../data/playbooks";
import { priceScaleStore, type PriceScaleType } from "../chart/Chart";
import { exportChartImage } from "../chart/drawing";
import { pousserToast } from "../store/toasts";
import { settingsUiStore } from "../store/settings-ui";
import { twelveDataKeyStore } from "../store/twelvedata";
import { IS_VERCEL } from "../lib/deployment";
import { raccourciPour, raccourciTimeframe } from "../commands/hotkeys";
import { IndicatorMenu } from "./IndicatorMenu";
import { StrategyMenu } from "./StrategyMenu";
import { PairSearch } from "./PairSearch";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { Badge, CLASSES_CHAMP, LARGEUR_MNEMONIQUE, MenuDeroulant } from "./ui";

/**
 * Ouvre un sélecteur de fichier, valide et REMPLACE tout l'état `axiom:*` du terminal par
 * la sauvegarde. Confirmation destructive avant écrasement (conservée). Le résultat est
 * signalé par un toast : succès invite à recharger (les stores hydratent au démarrage),
 * échec = message d'erreur — plus de `window.alert` ni de rechargement automatique.
 */
function declencherImportSauvegarde(): void {
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
function enregistrerWorkspaceAvecNom(): void {
  const nom = window.prompt("Nom du workspace :");
  const label = nom?.trim();
  if (label && label.length > 0) {
    workspacesStore.getState().saveAs(label);
    pousserToast(`Workspace « ${label} » enregistré`);
  }
}

/** Exporte la sauvegarde complète (téléchargement) + toast de feedback. */
function exporterSauvegardeAvecFeedback(): void {
  exporterSauvegarde();
  pousserToast("Sauvegarde exportée");
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
enregistrerCommandes([
  {
    id: "workspace:enregistrer",
    mnemonique: "WS",
    libelle: "Enregistrer le workspace sous…",
    categorie: "action",
    motsCles: ["workspace", "preset", "enregistrer", "sauver", "layout", "espace de travail"],
    apercu: "Sauvegarde l'agencement courant sous un nom",
    action: () => enregistrerWorkspaceAvecNom(),
  },
  {
    id: "workspace:exporter",
    mnemonique: "BACKUP",
    libelle: "Exporter la sauvegarde (JSON)",
    categorie: "action",
    motsCles: ["backup", "sauvegarde", "export", "json", "exporter", "telecharger"],
    apercu: "Télécharge une sauvegarde de tout le terminal",
    action: () => exporterSauvegardeAvecFeedback(),
  },
  {
    id: "workspace:importer",
    mnemonique: "RESTORE",
    libelle: "Importer une sauvegarde (JSON)",
    categorie: "action",
    motsCles: ["restore", "restaurer", "import", "json", "importer", "sauvegarde"],
    apercu: "Remplace l'état du terminal par une sauvegarde",
    action: () => declencherImportSauvegarde(),
  },
]);

/** Presets symbole selon le type de source (crypto / tradfi / MEXC tokenisé). */
const CRYPTO_PRESETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const TRADFI_PRESETS = ["SPY", "GLD", "EUR/USD"]; // S&P500 (ETF), or (ETF), EUR/USD
const MEXC_PRESETS = ["AAPLXUSDT", "TSLAONUSDT", "SPYXUSDT"]; // actions tokenisées
/** Symbole par défaut au passage crypto ↔ tradfi. */
const DEFAULT_CRYPTO_SYMBOL = "BTCUSDT";
const DEFAULT_TRADFI_SYMBOL = "SPY";

// "m" = minute, "M" = mois (1M/3M/6M/12M). 1w & 1M sont natifs Binance ;
// 3M/6M/12M sont agrégés côté client depuis le mensuel (voir binance.ts).
const TIMEFRAMES: Timeframe[] = [
  "1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M", "3M", "6M", "12M",
];

/** Sources câblées + libellés affichés (crypto + marchés traditionnels). */
const EXCHANGES: { id: ExchangeId; label: string }[] = [
  { id: "binance", label: "Binance" },
  { id: "bybit", label: "Bybit" },
  { id: "okx", label: "OKX" },
  { id: "hyperliquid", label: "Hyperliquid (perp DEX)" },
  { id: "kraken", label: "Kraken" },
  { id: "coinbase", label: "Coinbase" },
  { id: "twelvedata", label: "TradFi (Twelve Data)" },
  { id: "mexc", label: "MEXC (crypto + actions tokenisées)" },
];

/** Libellé d'une source (pour les infobulles de grisage). */
function exchangeLabel(id: ExchangeId): string {
  return EXCHANGES.find((e) => e.id === id)?.label ?? id;
}

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
type EntreeFonction = {
  id?: WindowId;
  mnemonique: string;
  libelle: string;
  nouveau?: boolean;
  vercel?: DisponibiliteVercel;
  ouvrir: () => void;
};

/**
 * Menu Fonctions GROUPÉ par thème (sections dérivées du registre). Il déroulait
 * jusqu'ici 37 entrées à plat dans l'ordre d'implémentation, au-delà de la hauteur du
 * panneau (revue du 2026-08-01 § 6.1). TICKER, qui n'est pas une fenêtre du registre,
 * rejoint « Outils ».
 */
const SECTIONS_FONCTIONS: { groupe: string; entrees: EntreeFonction[] }[] = menuWindowsGroupees().map(
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
    ],
  })
);

/**
 * Menu déroulant compact « Fonctions » : liste les fenêtres non modales (libellé +
 * mnémonique) plutôt que dix boutons dans la barre. Basse fréquence (aucun re-render sur
 * tick) — les actions lisent les stores via getState(), sans abonnement.
 */
function FonctionsMenu() {
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
                {/* Badge « nouveau » (fenêtres récentes) jusqu'à la 1ère ouverture. */}
                {f.nouveau && f.id !== undefined && estNouvelle(f.id) && (
                  <Badge ton="accent">nouveau</Badge>
                )}
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

export function Toolbar() {
  const exchange = useStore(marketStore, (s) => s.exchange);
  const symbol = useStore(marketStore, (s) => s.symbol);
  const timeframe = useStore(marketStore, (s) => s.timeframe);
  const setExchange = useStore(marketStore, (s) => s.setExchange);
  const setSymbol = useStore(marketStore, (s) => s.setSymbol);
  const setTimeframe = useStore(marketStore, (s) => s.setTimeframe);
  const orderflowEnabled = useStore(orderflowStore, (s) => s.enabled);
  const toggleOrderflow = useStore(orderflowStore, (s) => s.toggle);
  const vpEnabled = useStore(volumeProfileStore, (s) => s.enabled);
  const toggleVp = useStore(volumeProfileStore, (s) => s.toggle);
  const revenueEnabled = useStore(revenueStore, (s) => s.enabled);
  const toggleRevenue = useStore(revenueStore, (s) => s.toggle);
  const liqActif = useStore(liqMarksStore, (s) => s.actif);
  const toggleLiq = useStore(liqMarksStore, (s) => s.basculer);
  const openDerivatives = useStore(derivativesUiStore, (s) => s.openDerivatives);
  const twelveDataHasKey = useStore(twelveDataKeyStore, (s) => s.hasKey);
  const openSettings = useStore(settingsUiStore, (s) => s.openSettings);
  const priceScale = useStore(priceScaleStore, (s) => s.type);
  const setPriceScale = useStore(priceScaleStore, (s) => s.setType);

  const [footprintPanelOpen, setFootprintPanelOpen] = useState(false);

  const supportedTf = supportedTimeframesFor(exchange, symbol);
  const isBinance = exchange === "binance";
  const isTradfi = exchange === "twelvedata";
  const isMexc = exchange === "mexc";
  const isSynthetic = exchange === "synthetic";
  // MEXC = catalogue crypto + actions tokenisées → presets dédiés ; sinon crypto/tradfi.
  const presets = isTradfi ? TRADFI_PRESETS : isMexc ? MEXC_PRESETS : CRYPTO_PRESETS;
  // Sources SANS flux tick (polling REST) → orderflow/footprint indisponibles.
  const noTradeStream = isTradfi || isMexc || isSynthetic;

  /**
   * Changement de source : si le TF courant n'est pas supporté par la nouvelle source,
   * on retombe sur 1h (commun à toutes). En FRANCHISSANT la frontière crypto ↔ tradfi,
   * on réinitialise le symbole (un "BTCUSDT" n'existe pas en tradfi, et inversement).
   * Idem en quittant MEXC avec un preset d'action tokenisée (AAPLXUSDT…) sélectionné :
   * ce symbole n'existe sur AUCUNE autre source et casserait silencieusement le backfill.
   */
  const onChangeExchange = (next: ExchangeId) => {
    if (IS_VERCEL && next === "twelvedata" && !twelveDataHasKey) {
      pousserToast("UNUSABLE — clé Twelve Data requise sur Vercel");
      openSettings();
      return;
    }
    const wasTradfi = exchange === "twelvedata";
    const willBeTradfi = next === "twelvedata";
    const wasMexcOnlySymbol =
      exchange === "mexc" && next !== "mexc" && (MEXC_PRESETS as readonly string[]).includes(symbol);
    setExchange(next);
    if (willBeTradfi && !wasTradfi) setSymbol(DEFAULT_TRADFI_SYMBOL);
    else if (!willBeTradfi && (wasTradfi || wasMexcOnlySymbol)) setSymbol(DEFAULT_CRYPTO_SYMBOL);
    const supported = supportedTimeframesFor(next, next === "synthetic" ? symbol : "");
    if (!supported.includes(timeframe)) setTimeframe("1h");
  };

  useEffect(() => {
    if (!IS_VERCEL || twelveDataHasKey || exchange !== "twelvedata") return;
    setExchange("binance");
    setSymbol(DEFAULT_CRYPTO_SYMBOL);
    if (!supportedTimeframesFor("binance", "").includes(timeframe)) setTimeframe("1h");
    pousserToast("UNUSABLE — clé Twelve Data requise sur Vercel");
    openSettings();
  }, [exchange, openSettings, setExchange, setSymbol, setTimeframe, timeframe, twelveDataHasKey]);

  return (
    <>
    <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4 py-2">
      <span className="axiom-wordmark font-semibold tracking-wide text-text">AXIOM</span>

      {/* Sélecteur de source. */}
      <select
        value={exchange}
        onChange={(e) => onChangeExchange(e.target.value as ExchangeId)}
        className={CLASSES_CHAMP}
        aria-label="Source"
      >
        {EXCHANGES.map((ex) => (
          <option key={ex.id} value={ex.id}>
            {ex.id === "twelvedata" && IS_VERCEL && !twelveDataHasKey
              ? `${ex.label} — UNUSABLE sans clé`
              : ex.label}
          </option>
        ))}
      </select>

      {/* Recherche de paires (catalogue de la source courante) + saisie libre. */}
      <PairSearch />

      {/* Presets symbole (adaptés à la source : crypto ou tradfi). */}
      <div className="flex gap-1">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => {
              // Un preset crypto est un ticker Binance : quitter la source virtuelle
              // synthetic, sinon état incohérent (symbole normal × adapter synthétique).
              if (isSynthetic) setExchange("binance");
              setSymbol(preset);
            }}
            className={`rounded px-2 py-1 text-xs ${
              symbol === preset
                ? "bg-neutral-200 text-neutral-900"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            }`}
          >
            {preset}
          </button>
        ))}
      </div>

      <div className="mx-1 h-5 w-px bg-neutral-800" />

      {/* Sélecteur de timeframe (grisé si non supporté par la source). */}
      <div className="flex gap-1">
        {TIMEFRAMES.map((tf) => {
          const unsupported = !supportedTf.includes(tf);
          const rcTf = raccourciTimeframe(tf);
          return (
            <button
              key={tf}
              type="button"
              disabled={unsupported}
              onClick={() => setTimeframe(tf)}
              title={
                unsupported
                  ? `non supporté par ${exchangeLabel(exchange)}`
                  : rcTf
                    ? `${tf} — ${rcTf}`
                    : undefined
              }
              className={`rounded px-2 py-1 text-xs ${
                unsupported
                  ? "cursor-not-allowed bg-neutral-900 text-neutral-700"
                  : timeframe === tf
                    ? "bg-emerald-500 text-accent-ink"
                    : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
              }`}
            >
              {tf}
            </button>
          );
        })}
      </div>

      <div className="mx-1 h-5 w-px bg-neutral-800" />

      {/* Échelle de l'axe prix : linéaire / logarithmique / pourcentage. */}
      <select
        value={priceScale}
        onChange={(e) => setPriceScale(e.target.value as PriceScaleType)}
        className={CLASSES_CHAMP}
        aria-label="Échelle de l'axe prix"
        title="Échelle de l'axe prix"
      >
        <option value="normal">Linéaire</option>
        <option value="log">Log</option>
        <option value="percentage">%</option>
      </select>

      {/* Disposition de la grille multi-chart (1 / 2h / 2v / 4) — synchronisé avec ChartGrid. */}
      <LayoutSwitcher />

      <div className="mx-1 h-5 w-px bg-neutral-800" />

      {/* Panneau des indicateurs @axiom (activer/désactiver). */}
      <IndicatorMenu />

      {/* Panneau des stratégies (catégorie strategy — foyer exclusif). */}
      <StrategyMenu />

      {/* Orderflow (M5) : CVD + footprint, alimenté par le flux de trades de la
          source active. Footprint sur toutes les sources à flux de trades ; pane CVD
          créé UNIQUEMENT sur Binance (seule source au split buy/sell historique). */}
      <button
        type="button"
        onClick={toggleOrderflow}
        onContextMenu={(e) => {
          e.preventDefault();
          setFootprintPanelOpen((o) => !o);
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
      <FonctionsMenu />
      {/* Playbooks 1-clic (B3) — découverte Toolbar en plus de ⌘K PLAY*. */}
      <PlaybooksMenu />

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
    </header>

    {/* Panneau de réglages footprint (cliquer droit sur Orderflow). */}
    {footprintPanelOpen && <FootprintSettingsPanel onClose={() => setFootprintPanelOpen(false)} />}
    </>
  );
}
