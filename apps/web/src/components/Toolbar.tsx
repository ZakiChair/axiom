/**
 * Toolbar — sélecteurs source / symbole / timeframe, branchés sur le store marché vanilla.
 * Un changement re-déclenche backfill + souscription côté Chart (effet [exchange, symbol, tf]).
 */
import { useState } from "react";
import { useStore } from "zustand";
import type { ExchangeId, Timeframe } from "@axiom/types";
import { marketStore } from "../store/market";
import { orderflowStore } from "../store/orderflow";
import { volumeProfileStore } from "../store/volumeProfile";
import { revenueStore } from "../store/revenue";
import { derivativesUiStore } from "../store/derivatives-ui";
// Stores UI des fenêtres non modales (Phase 3), pour le menu déroulant « Fonctions ».
import { ecoStore } from "../store/eco";
import { newsUiStore } from "../store/news";
import { onchainUiStore } from "../store/onchain";
import { marketMapUiStore } from "../store/marketmap-ui";
import { portfolioUiStore } from "../store/portfolio";
import { notesUiStore } from "../store/notes";
import { screenerStore } from "../store/screener";
import { corrUiStore } from "./CorrWindow";
import { termStructureUiStore } from "./TermStructureWindow";
import { optionsUiStore } from "./OptionsWindow";
import { workspacesStore, DEFAULT_WORKSPACE_ID } from "../store/workspaces";
import { exporterSauvegarde, importerSauvegarde } from "../store/persist";
import { enregistrerCommandes } from "../commands/registry";
import { SUPPORTED_TIMEFRAMES } from "../data/adapters";
import { priceScaleStore, type PriceScaleType } from "../chart/Chart";
import { exportChartImage } from "../chart/drawing";
import { IndicatorMenu } from "./IndicatorMenu";
import { PairSearch } from "./PairSearch";
import { ThemeSwitcher } from "./ThemeSwitcher";

/**
 * Ouvre un sélecteur de fichier, valide et REMPLACE tout l'état `axiom:*` du terminal par
 * la sauvegarde, puis recharge la page (ré-hydratation propre). Confirmation avant écrasement.
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
      if (importerSauvegarde(texte)) window.location.reload();
      else window.alert("Sauvegarde invalide : aucun changement effectué.");
    };
    reader.readAsText(file);
  };
  input.click();
}

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
    action: () => {
      const nom = window.prompt("Nom du workspace :");
      if (nom && nom.trim().length > 0) workspacesStore.getState().saveAs(nom.trim());
    },
  },
  {
    id: "workspace:exporter",
    mnemonique: "BACKUP",
    libelle: "Exporter la sauvegarde (JSON)",
    categorie: "action",
    motsCles: ["backup", "sauvegarde", "export", "json", "exporter", "telecharger"],
    apercu: "Télécharge une sauvegarde de tout le terminal",
    action: () => exporterSauvegarde(),
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
 * Fenêtres non modales de la Phase 3 exposées dans le menu « Fonctions » : libellé +
 * mnémonique Bloomberg + ouverture du panneau. L'exclusion mutuelle (App.tsx) ferme les
 * autres panneaux dockés à droite au passage. Les mêmes mnémoniques restent tapables dans
 * la palette (⌘K). DES (Produits dérivés) garde son bouton dédié ; OI/FUND sont des
 * sous-panes du chart (pilotés depuis la fenêtre Produits dérivés), pas des fenêtres.
 */
const FONCTIONS: { mnemonique: string; libelle: string; ouvrir: () => void }[] = [
  { mnemonique: "ECO", libelle: "Calendrier économique", ouvrir: () => ecoStore.getState().openEco() },
  { mnemonique: "NEWS", libelle: "Actualités crypto", ouvrir: () => newsUiStore.getState().openNews() },
  { mnemonique: "CORR", libelle: "Corrélations", ouvrir: () => corrUiStore.getState().openCorr() },
  { mnemonique: "CHAIN", libelle: "On-chain", ouvrir: () => onchainUiStore.getState().openOnchain() },
  { mnemonique: "IMAP", libelle: "Vue marché (treemap)", ouvrir: () => marketMapUiStore.getState().openMarketMap() },
  { mnemonique: "PORT", libelle: "Portefeuille", ouvrir: () => portfolioUiStore.getState().openPortfolio() },
  { mnemonique: "NOTE", libelle: "Notes / journal", ouvrir: () => notesUiStore.getState().openNotes() },
  { mnemonique: "EQS", libelle: "Screener d'actifs", ouvrir: () => screenerStore.getState().openScreener() },
  { mnemonique: "TERM", libelle: "Structure par terme", ouvrir: () => termStructureUiStore.getState().openTermStructure() },
  { mnemonique: "OMON", libelle: "Options (smile IV, max pain)", ouvrir: () => optionsUiStore.getState().openOptions() },
];

/**
 * Menu déroulant compact « Fonctions » : liste les fenêtres non modales (libellé +
 * mnémonique) plutôt que dix boutons dans la barre. Basse fréquence (aucun re-render sur
 * tick) — les actions lisent les stores via getState(), sans abonnement.
 */
function FonctionsMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Fonctions — ouvrir un panneau (mêmes mnémoniques dans ⌘K)"
        className="flex items-center gap-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 hover:border-neutral-500"
      >
        <span>Fonctions</span>
        <span aria-hidden className="text-[9px] text-neutral-500">▾</span>
      </button>

      {open && (
        <>
          {/* Zone de fermeture au clic extérieur. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute left-0 z-50 mt-1 w-60 rounded border border-neutral-700 bg-neutral-900 p-1 shadow-xl"
          >
            {FONCTIONS.map((f) => (
              <button
                key={f.mnemonique}
                type="button"
                role="menuitem"
                onClick={() => {
                  f.ouvrir();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-neutral-200 hover:bg-neutral-800"
              >
                <span className="w-12 shrink-0 font-semibold uppercase tracking-wider text-emerald-400">
                  {f.mnemonique}
                </span>
                <span className="min-w-0 flex-1 truncate">{f.libelle}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Sélecteur de workspaces (presets nommés) — menu compact : nom courant + liste
 * commutable, « Enregistrer sous… », renommer/supprimer les presets, et export/import
 * de la sauvegarde complète. Basse fréquence (aucun re-render sur tick).
 */
function WorkspaceMenu() {
  const [open, setOpen] = useState(false);
  const workspaces = useStore(workspacesStore, (s) => s.workspaces);
  const currentId = useStore(workspacesStore, (s) => s.currentId);
  const currentName = workspaces.find((w) => w.id === currentId)?.name ?? "Défaut";

  const onSaveAs = () => {
    const nom = window.prompt("Nom du workspace :");
    if (nom && nom.trim().length > 0) workspacesStore.getState().saveAs(nom.trim());
    setOpen(false);
  };
  const onRename = (id: string, name: string) => {
    const nom = window.prompt("Nouveau nom :", name);
    if (nom && nom.trim().length > 0) workspacesStore.getState().rename(id, nom.trim());
  };
  const onRemove = (id: string, name: string) => {
    if (window.confirm(`Supprimer le workspace « ${name} » ?`)) workspacesStore.getState().remove(id);
  };

  const itemClass =
    "w-full rounded px-2 py-1 text-left text-xs text-neutral-200 hover:bg-neutral-800";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Workspaces (agencements enregistrés)"
        className="flex items-center gap-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 hover:border-neutral-500"
      >
        <span className="text-neutral-500">WS</span>
        <span className="max-w-[120px] truncate">{currentName}</span>
        <span aria-hidden className="text-[9px] text-neutral-500">▾</span>
      </button>

      {open && (
        <>
          {/* Zone de fermeture au clic extérieur. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-1 w-60 rounded border border-neutral-700 bg-neutral-900 p-1 shadow-xl"
          >
            {workspaces.map((w) => (
              <div key={w.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    workspacesStore.getState().apply(w.id);
                    setOpen(false);
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
                      className="rounded px-1 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            ))}

            <div className="my-1 h-px bg-neutral-800" />
            <button type="button" onClick={onSaveAs} className={itemClass}>
              Enregistrer sous…
            </button>

            <div className="my-1 h-px bg-neutral-800" />
            <button
              type="button"
              onClick={() => {
                exporterSauvegarde();
                setOpen(false);
              }}
              className={itemClass}
            >
              Exporter la sauvegarde…
            </button>
            <button
              type="button"
              onClick={() => {
                declencherImportSauvegarde();
                setOpen(false);
              }}
              className={itemClass}
            >
              Importer une sauvegarde…
            </button>
          </div>
        </>
      )}
    </div>
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
  const openDerivatives = useStore(derivativesUiStore, (s) => s.openDerivatives);
  const priceScale = useStore(priceScaleStore, (s) => s.type);
  const setPriceScale = useStore(priceScaleStore, (s) => s.setType);

  const supportedTf = SUPPORTED_TIMEFRAMES[exchange] ?? [];
  const isBinance = exchange === "binance";
  const isTradfi = exchange === "twelvedata";
  const isMexc = exchange === "mexc";
  // MEXC = catalogue crypto + actions tokenisées → presets dédiés ; sinon crypto/tradfi.
  const presets = isTradfi ? TRADFI_PRESETS : isMexc ? MEXC_PRESETS : CRYPTO_PRESETS;
  // Sources SANS flux tick (polling REST) → orderflow/footprint indisponibles.
  const noTradeStream = isTradfi || isMexc;

  /**
   * Changement de source : si le TF courant n'est pas supporté par la nouvelle source,
   * on retombe sur 1h (commun à toutes). En FRANCHISSANT la frontière crypto ↔ tradfi,
   * on réinitialise le symbole (un "BTCUSDT" n'existe pas en tradfi, et inversement).
   * Idem en quittant MEXC avec un preset d'action tokenisée (AAPLXUSDT…) sélectionné :
   * ce symbole n'existe sur AUCUNE autre source et casserait silencieusement le backfill.
   */
  const onChangeExchange = (next: ExchangeId) => {
    const wasTradfi = exchange === "twelvedata";
    const willBeTradfi = next === "twelvedata";
    const wasMexcOnlySymbol =
      exchange === "mexc" && next !== "mexc" && (MEXC_PRESETS as readonly string[]).includes(symbol);
    setExchange(next);
    if (willBeTradfi && !wasTradfi) setSymbol(DEFAULT_TRADFI_SYMBOL);
    else if (!willBeTradfi && (wasTradfi || wasMexcOnlySymbol)) setSymbol(DEFAULT_CRYPTO_SYMBOL);
    const supported = SUPPORTED_TIMEFRAMES[next] ?? [];
    if (!supported.includes(timeframe)) setTimeframe("1h");
  };

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4 py-2">
      <span className="axiom-wordmark font-semibold tracking-wide text-text">AXIOM</span>

      {/* Sélecteur de source. */}
      <select
        value={exchange}
        onChange={(e) => onChangeExchange(e.target.value as ExchangeId)}
        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        aria-label="Source"
      >
        {EXCHANGES.map((ex) => (
          <option key={ex.id} value={ex.id}>
            {ex.label}
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
            onClick={() => setSymbol(preset)}
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
          return (
            <button
              key={tf}
              type="button"
              disabled={unsupported}
              onClick={() => setTimeframe(tf)}
              title={unsupported ? `non supporté par ${exchangeLabel(exchange)}` : undefined}
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
        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-neutral-500"
        aria-label="Échelle de l'axe prix"
        title="Échelle de l'axe prix"
      >
        <option value="normal">Linéaire</option>
        <option value="log">Log</option>
        <option value="percentage">%</option>
      </select>

      <div className="mx-1 h-5 w-px bg-neutral-800" />

      {/* Panneau des indicateurs @axiom (activer/désactiver). */}
      <IndicatorMenu />

      {/* Orderflow (M5) : CVD + footprint, alimenté par le flux de trades de la
          source active. Footprint sur les 3 sources ; CVD complet sur
          Binance/Coinbase (klines à volume taker), plat sur Kraken. */}
      <button
        type="button"
        onClick={toggleOrderflow}
        aria-pressed={orderflowEnabled}
        disabled={noTradeStream}
        title={
          noTradeStream
            ? "Indisponible sur cette source (aucun flux de trades)"
            : isBinance
              ? undefined
              : "Footprint complet ; CVD limité hors Binance/Coinbase"
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

      {/* Profil de volume par zone de prix (VPVR) — toutes sources. */}
      <button
        type="button"
        onClick={toggleVp}
        aria-pressed={vpEnabled}
        title="Volume par zone de prix (plage visible)"
        className={`rounded px-2 py-1 text-xs ${
          vpEnabled
            ? "bg-amber-500 text-accent-ink"
            : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
        }`}
      >
        Profil Vol
      </button>

      {/* Revenus on-chain du protocole de l'actif (DefiLlama, sous-pane dédié).
          N'affiche une courbe que pour les actifs « protocole » (UNI, AAVE, GMX…) ;
          dégradation propre (aucun pane) pour BTC/ETH/SOL et tokens sans données. */}
      <button
        type="button"
        onClick={toggleRevenue}
        aria-pressed={revenueEnabled}
        disabled={isTradfi}
        title={
          isTradfi
            ? "Indisponible en marchés traditionnels (revenus on-chain crypto uniquement)"
            : "Revenus on-chain du protocole (DefiLlama) — actifs de protocole uniquement"
        }
        className={`rounded px-2 py-1 text-xs ${
          isTradfi
            ? "cursor-not-allowed bg-neutral-900 text-neutral-700"
            : revenueEnabled
              ? "bg-yellow-500 text-accent-ink"
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

      {/* Export du graphe courant en PNG (téléchargement « SYMBOLE-TF-date.png »). */}
      <button
        type="button"
        onClick={() => exportChartImage(symbol, timeframe)}
        title="Exporter le graphe en image PNG"
        className="rounded px-2 py-1 text-xs bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
      >
        Export PNG
      </button>

      {/* Workspaces + thème (poussés à droite). */}
      <div className="ml-auto flex items-center gap-2">
        <WorkspaceMenu />
        <span className="text-xs text-neutral-500">Thème</span>
        <ThemeSwitcher />
      </div>
    </header>
  );
}
