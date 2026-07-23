/**
 * App — layout sombre plein écran : toolbar en haut, graphe sur le reste.
 *
 * Monte aussi les surfaces transverses : palette de commandes (⌘K), raccourcis
 * clavier globaux, runtime des alertes, et le mode plein écran (masque toolbars +
 * sidebar pour ne garder que le graphe).
 *
 * Fenêtres Bloomberg : code-splitées via React.lazy (chargées à la première
 * ouverture). Les commandes palette des panneaux à store co-localisé dans le
 * composant passent par `commands/windowPanels.ts` (windowManager only) pour ne
 * pas tirer le graphe chart/canvas au démarrage.
 */
import { lazy, Suspense, useEffect, useRef, type ComponentType, type LazyExoticComponent } from "react";
import { useStore } from "zustand";
import { Toolbar } from "./components/Toolbar";
import { SessionStrip } from "./components/SessionStrip";
import { TickerBand } from "./components/TickerBand";
import { DrawingToolbar } from "./components/DrawingToolbar";
import { ChartGrid } from "./chart/ChartGrid";
import { Watchlist } from "./components/Watchlist";
import { AlertsPanel } from "./components/AlertsPanel";
import { CompareControl } from "./components/CompareControl";
import { MacroPanel } from "./components/MacroPanel";
import { HealthPanel } from "./components/HealthPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { CommandPalette } from "./components/CommandPalette";
import { settingsUiStore } from "./store/settings-ui";
import { ecoCommands } from "./store/eco";
import { commandes as newsCommands } from "./store/news";
import { commandes as tickerCommands } from "./store/tickerBand";
import { commandes as onchainCommands } from "./store/onchain";
import { commandes as portfolioCommands } from "./store/portfolio";
import { commandes as notesCommands } from "./store/notes";
import { commandesScreener } from "./store/screener";
import { commandesSignaux } from "./store/signaux";
import { commandes as derivChartCommands } from "./store/derivatives-chart";
// Marqueurs de trades/notes SUR le chart : l'import démarre aussi le contrôleur
// (effet de bord d'import).
import { commandes as marksCommands } from "./chart/tradeMarkers";
import { commandes as liqMarksCommands } from "./chart/liquidationMarkers";
import { commandes as liqModeCommands } from "./chart/liquidationHeat";
// Bulles de prints baleines SUR le chart : l'import démarre aussi le contrôleur
// (effet de bord d'import).
import { commandes as whaleCommands } from "./chart/whaleBubbles";
// Heatmap de liquidité du carnet (BOOK) : l'import démarre aussi l'accumulation
// (effet de bord d'import).
import { commandes as depthHeatCommands } from "./chart/depthHeat";
// Niveaux de liquidation ESTIMÉS (modèle levier sur l'OI) — l'import démarre le fetch OI
// singleton (effet de bord) ; couche indépendante de la heatmap réelle.
import { commandes as liqEstCommands } from "./chart/liquidationEstimates";
// Contrôleur marqueurs éco (effet de bord) — indépendant du lazy-load de EcoWindow.
import "./chart/ecoMarkers";
import { commandes as domCommands } from "./store/dom-ui";
import { commandes as backtestCommands } from "./store/backtest";
import { commandes as replayCommands } from "./store/replay";
import { chartLayoutStore, type ChartLayoutMode } from "./store/chart-layout";
import { commandes as globeCommands } from "./store/globe-ui";
import { commandesOnboarding } from "./store/onboarding";
import { commandesPlaybooks } from "./data/playbooks";
import { windowPanelCommands } from "./commands/windowPanels";
import { enregistrerCommandes, type Commande } from "./commands/registry";
import { useRaccourcisGlobaux, fullscreenStore } from "./commands/hotkeys";
import { demarrerAlertes } from "./alerts/runtime";
import { FloatingWindow } from "./components/FloatingWindow";
import { Taskbar } from "./components/Taskbar";
import { SnapOverlay } from "./components/SnapOverlay";
import { OnboardingOverlay } from "./components/OnboardingOverlay";
import { Toasts } from "./components/Toasts";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { WINDOW_REGISTRY, windowManagerStore, type WindowId } from "./store/windowManager";

// ─────────────────────────── Commandes de disposition multi-chart (Phase 4) ───────────────────────────

/**
 * Commandes de palette pour la grille multi-chart. chart-layout n'exporte PAS ses propres
 * commandes (à la différence des fenêtres DOM/BT/REPLAY) : on définit donc ici l'équivalent
 * des mnémoniques GRID demandés. Elles pilotent le store vanilla `chartLayoutStore` (basse
 * fréquence), lequel est déjà lu par la barre flottante de ChartGrid et le sélecteur Toolbar.
 */
const GRID_MODES: { mnemonique: string; mode: ChartLayoutMode; libelle: string; mots: string[] }[] = [
  { mnemonique: "GRID1", mode: "1", libelle: "Disposition — 1 graphe", mots: ["un", "single", "solo"] },
  { mnemonique: "GRID2", mode: "2h", libelle: "Disposition — 2 côte à côte", mots: ["deux", "horizontal", "cote"] },
  { mnemonique: "GRID2V", mode: "2v", libelle: "Disposition — 2 empilés", mots: ["deux", "vertical", "empiles"] },
  { mnemonique: "GRID4", mode: "2x2", libelle: "Disposition — 2×2 (4 graphes)", mots: ["quatre", "2x2", "grille"] },
];

const commandesGrille: Commande[] = GRID_MODES.map((g) => ({
  id: `layout:${g.mode}`,
  mnemonique: g.mnemonique,
  libelle: g.libelle,
  categorie: "action",
  motsCles: ["disposition", "layout", "grille", "multi-chart", "chart", ...g.mots],
  apercu: "Change la disposition de la grille de graphes",
  action: () => chartLayoutStore.getState().setLayout(g.mode),
}));

// ─────────────────────────── Greffe des commandes de palette ───────────────────────────

/**
 * Enregistre les commandes de palette des fenêtres (point d'extension ADDITIF,
 * idempotent par `id`). Fait à l'IMPORT — donc AVANT le premier rendu de la
 * palette. Les panneaux à store co-localisé dans le composant passent par
 * `windowPanelCommands` (pas d'import des fenêtres lourdes).
 */
enregistrerCommandes([
  ...ecoCommands,
  ...newsCommands,
  ...onchainCommands,
  ...portfolioCommands,
  ...notesCommands,
  ...commandesScreener,
  // Vue Signaux d'EQS (SIG : scan de setups).
  ...commandesSignaux,
  // Sous-panes OI/funding SUR le chart + marqueurs trades/notes.
  ...derivChartCommands,
  ...marksCommands,
  ...liqMarksCommands,
  ...liqModeCommands,
  ...liqEstCommands,
  ...whaleCommands,
  ...depthHeatCommands,
  // Fenêtres Phase 4 (DOM/BT/REPLAY) + grille multi-chart.
  ...domCommands,
  ...backtestCommands,
  ...replayCommands,
  ...commandesGrille,
  // GLOBE + bandeau ticker.
  ...globeCommands,
  ...tickerCommands,
  // CORR / MAP / TERM / OMON / RATE / COT / SEAG / VOL / FUND / BRIEF via windowManager.
  ...windowPanelCommands,
  // Onboarding premier lancement (⌘K → ONBOARD pour rejouer).
  ...commandesOnboarding,
  // Playbooks 1-clic (⌘K → PLAY / PLAY-SCALP / PLAY-FADE / PLAY-FOMC / PLAY-RISK / PLAY-OPT).
  ...commandesPlaybooks,
]);

// ─────────────────────────── Fenêtres lazy (code-splitting) ───────────────────────────

type FenetreComp = ComponentType<Record<string, never>>;

/** Chargeurs dynamiques : un chunk par fenêtre, chargé à la première ouverture. */
const WINDOW_COMPONENTS: Record<WindowId, LazyExoticComponent<FenetreComp>> = {
  derivatives: lazy(() =>
    import("./components/DerivativesWindow").then((m) => ({ default: m.DerivativesWindow })),
  ),
  fundingMatrix: lazy(() =>
    import("./components/FundingMatrixWindow").then((m) => ({ default: m.FundingMatrixWindow })),
  ),
  liquidations: lazy(() =>
    import("./components/LiquidationsWindow").then((m) => ({ default: m.LiquidationsWindow })),
  ),
  eco: lazy(() => import("./components/EcoWindow").then((m) => ({ default: m.EcoWindow }))),
  news: lazy(() => import("./components/NewsWindow").then((m) => ({ default: m.NewsWindow }))),
  corr: lazy(() => import("./components/CorrWindow").then((m) => ({ default: m.CorrWindow }))),
  onchain: lazy(() => import("./components/OnchainWindow").then((m) => ({ default: m.OnchainWindow }))),
  marketMap: lazy(() =>
    import("./components/MarketMapWindow").then((m) => ({ default: m.MarketMapWindow })),
  ),
  portfolio: lazy(() =>
    import("./components/PortfolioWindow").then((m) => ({ default: m.PortfolioWindow })),
  ),
  notes: lazy(() => import("./components/NotesWindow").then((m) => ({ default: m.NotesWindow }))),
  screener: lazy(() =>
    import("./components/ScreenerWindow").then((m) => ({ default: m.ScreenerWindow })),
  ),
  termStructure: lazy(() =>
    import("./components/TermStructureWindow").then((m) => ({ default: m.TermStructureWindow })),
  ),
  options: lazy(() =>
    import("./components/OptionsWindow").then((m) => ({ default: m.OptionsWindow })),
  ),
  dom: lazy(() => import("./components/DomWindow").then((m) => ({ default: m.DomWindow }))),
  backtest: lazy(() =>
    import("./components/BacktestWindow").then((m) => ({ default: m.BacktestWindow })),
  ),
  replay: lazy(() => import("./components/ReplayWindow").then((m) => ({ default: m.ReplayWindow }))),
  macroRates: lazy(() =>
    import("./components/MacroRatesWindow").then((m) => ({ default: m.MacroRatesWindow })),
  ),
  cot: lazy(() => import("./components/CotWindow").then((m) => ({ default: m.CotWindow }))),
  seasonality: lazy(() =>
    import("./components/SeasonalityWindow").then((m) => ({ default: m.SeasonalityWindow })),
  ),
  vol: lazy(() => import("./components/VolWindow").then((m) => ({ default: m.VolWindow }))),
  fund: lazy(() => import("./components/FundWindow").then((m) => ({ default: m.FundWindow }))),
  brief: lazy(() => import("./components/BriefWindow").then((m) => ({ default: m.BriefWindow }))),
  globe: lazy(() => import("./components/GlobeWindow").then((m) => ({ default: m.GlobeWindow }))),
  stablecoins: lazy(() =>
    import("./components/StablecoinsWindow").then((m) => ({ default: m.StablecoinsWindow })),
  ),
  squeeze: lazy(() =>
    import("./components/SqueezeWindow").then((m) => ({ default: m.SqueezeWindow })),
  ),
  cbprem: lazy(() =>
    import("./components/CbpremWindow").then((m) => ({ default: m.CbpremWindow })),
  ),
};

/** Placeholder discret pendant le chargement du chunk de la fenêtre. */
function FenetreFallback() {
  return <div className="p-3 text-xs text-text-dim">Chargement…</div>;
}

export function App() {
  const openSettings = useStore(settingsUiStore, (s) => s.openSettings);
  const plein = useStore(fullscreenStore, (s) => s.plein);
  const chartAreaRef = useRef<HTMLDivElement>(null);

  // Écouteur clavier global unique (TF, toggles, plein écran, palette…).
  useRaccourcisGlobaux();

  // Runtime des alertes : démarré une fois pour toute la session (idempotent,
  // compatible double montage React StrictMode). Arrêté au démontage.
  useEffect(() => {
    const stop = demarrerAlertes();
    return () => stop();
  }, []);

  // Zone de travail des fenêtres flottantes = la zone du graphe (exclut toolbar/barre
  // de dessin/panneau latéral) — mesurée sur ce div, PAS sur window.innerWidth/innerHeight.
  useEffect(() => {
    const el = chartAreaRef.current;
    if (!el) return;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const mesurer = (): void => {
      const rect = el.getBoundingClientRect();
      windowManagerStore.getState().setWorkspace({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    };
    mesurer();
    const observer = new ResizeObserver(() => {
      if (minuteur !== undefined) clearTimeout(minuteur);
      minuteur = setTimeout(mesurer, 150);
    });
    observer.observe(el);
    return () => {
      if (minuteur !== undefined) clearTimeout(minuteur);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-text">
      {/* Plein écran : toolbars et sidebar masquées, le graphe occupe tout l'écran. */}
      {!plein && <Toolbar />}
      {/* Strip session (P&L jour · alertes · santé) — hors plein écran, dense 11px. */}
      {!plein && <SessionStrip />}
      {/* Bandeau news défilant (enfant flex : le workspace mesuré par chartAreaRef se
          rétrécit automatiquement). Se masque lui-même selon tickerBandStore (⌘K TICKER). */}
      {!plein && <TickerBand />}
      {/* min-h-0 indispensable pour que le graphe (flex-1) prenne une hauteur réelle. */}
      <main className="flex min-h-0 flex-1">
        {/* Barre d'outils de dessin verticale, à gauche du graphe. */}
        {!plein && <DrawingToolbar />}
        {/* min-w-0 : la grille de graphes peut rétrécir face aux panneaux latéraux. */}
        <div ref={chartAreaRef} className="relative isolate z-0 min-w-0 flex-1">
          <ErrorBoundary scope="Graphiques">
            <ChartGrid />
          </ErrorBoundary>
        </div>
        {/* Colonne droite : en-tête (accès Réglages) + panneaux empilés, tous harmonisés
            via SidebarSection. Ordre : Watchlist, Alertes, Macro, Comparer, Santé. */}
        {!plein && (
          <aside className="flex w-60 shrink-0 flex-col min-h-0 overflow-y-auto border-l border-border bg-surface">
            <div className="flex shrink-0 items-center justify-between px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
                Panneaux
              </span>
              <button
                type="button"
                onClick={openSettings}
                aria-label="Ouvrir les réglages"
                title="Réglages"
                className="rounded p-1 text-text-dim transition hover:bg-surface hover:text-text"
              >
                <span aria-hidden className="text-sm leading-none">
                  ⚙
                </span>
              </button>
            </div>
            <Watchlist />
            <AlertsPanel />
            <MacroPanel />
            <CompareControl />
            <HealthPanel />
          </aside>
        )}
      </main>

      {/* Taskbar des fenêtres ouvertes — DANS LE FLUX (dernier enfant du flex-col) : elle
          réserve sa hauteur, donc le workspace mesuré par chartAreaRef se rétrécit et l'axe
          temporel du chart n'est plus masqué. Rien quand aucune fenêtre n'est ouverte. */}
      <Taskbar />

      {/* Indice discret pour sortir du plein écran (aucune toolbar visible alors). */}
      {plein && (
        <div className="pointer-events-none fixed bottom-3 left-3 z-30 rounded border border-border bg-surface/80 px-2 py-1 text-[10px] text-text-dim">
          F ou Échap : quitter le plein écran
        </div>
      )}

      {/* Fenêtres Bloomberg : chunk chargé à la première ouverture (FloatingWindow
          ne monte les enfants que si open && !minimized). */}
      {WINDOW_REGISTRY.map((entry) => {
        const Contenu = WINDOW_COMPONENTS[entry.id];
        if (!Contenu) return null;
        return (
          <FloatingWindow key={entry.id} id={entry.id} title={entry.title} mnemonic={entry.mnemonic}>
            <ErrorBoundary scope={entry.title} compact recovery="reload">
              <Suspense fallback={<FenetreFallback />}>
                <Contenu />
              </Suspense>
            </ErrorBoundary>
          </FloatingWindow>
        );
      })}
      <SnapOverlay />
      <SettingsPanel />
      <CommandPalette />
      {/* Premier lancement : 3 étapes (masqué si completed ; ⌘K ONBOARD pour rejouer). */}
      <OnboardingOverlay />
      {/* Toasts de feedback (export PNG, workspace, playbook, sauvegarde) — coin bas-droit. */}
      <Toasts />
    </div>
  );
}
