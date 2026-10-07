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
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type LazyExoticComponent } from "react";
import { useStore } from "zustand";
import { Toolbar } from "./components/Toolbar";
import { MobileNavigation } from "./components/MobileNavigation";
import { useMobileLayout } from "./hooks/useMobileLayout";
import { SessionStrip } from "./components/SessionStrip";
import { TickerBand } from "./components/TickerBand";
import { DrawingToolbar } from "./components/DrawingToolbar";
import { ChartGrid } from "./chart/ChartGrid";
import { Watchlist } from "./components/Watchlist";
import { CompareControl } from "./components/CompareControl";
import { HealthPanel } from "./components/HealthPanel";
import { settingsUiStore } from "./store/settings-ui";
import { ecoCommands } from "./store/eco";
import { commandes as newsCommands } from "./store/news";
import { commandes as tickerCommands } from "./store/tickerBand";
import { commandes as onchainCommands } from "./store/onchain";
import { commandes as portfolioCommands } from "./store/portfolio";
import { commandes as notesCommands } from "./store/notes";
import { commandes as derivChartCommands } from "./store/derivatives-chart";
import { commandes as liqMarksCommands } from "./chart/liquidationMarkers";
// Heatmap de liquidité du carnet (BOOK) : l'import démarre aussi l'accumulation
// (effet de bord d'import).
import { commandes as depthHeatCommands } from "./chart/depthHeat";
// Niveaux clés du chart maître : bascule persistée + familles (code des sources chargé à la demande).
import { commandesNiveauxOverlays } from "./chart/niveauxOverlays";
// Niveaux de liquidation ESTIMÉS (modèle levier sur l'OI) — l'import démarre le fetch OI
// singleton (effet de bord) ; couche indépendante de la heatmap réelle.
import { commandes as liqEstCommands } from "./chart/liquidationEstimates";
// Niveaux de liquidation RÉELS Hyperliquid (top adresses, via le daemon) — l'import démarre le
// singleton de rafraîchissement (effet de bord) ; 3e couche indépendante du même contrôleur.
import { commandes as hlLiqCommands } from "./data/hyperliquidLiq";
import { commandes as domCommands } from "./store/dom-ui";
import { commandes as replayCommands } from "./store/replay";
import { chartLayoutStore, type ChartLayoutMode } from "./store/chart-layout";
import { commandes as globeCommands } from "./store/globe-ui";
import { commandesOnboarding, onboardingStore } from "./store/onboarding";
import { commandesPlaybooks } from "./data/playbooks";
import {
  commandesBacktest,
  commandesScreener,
  commandesSignaux,
  commandesTradeMarkers,
  commandesWhaleBubbles,
  windowPanelCommands,
} from "./commands/windowPanels";
import { enregistrerCommandes, paletteStore, type Commande } from "./commands/registry";
import { useRaccourcisGlobaux, fullscreenStore } from "./commands/hotkeys";
import { demarrerAlertes } from "./alerts/runtime";
import { demarrerMoteurPaper } from "./store/paper";
import { FloatingWindow } from "./components/FloatingWindow";
import { Taskbar } from "./components/Taskbar";
import { SnapOverlay } from "./components/SnapOverlay";
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
  // EQS : bascule directe, sans charger store/screener (cf. commands/windowPanels.ts).
  ...commandesScreener,
  // Vue Signaux d'EQS (SIG : scan de setups), sans charger store/signaux (cf. commands/windowPanels.ts).
  ...commandesSignaux,
  // Sous-panes OI/funding SUR le chart + marqueurs trades/notes (MARKS : contrôleur chargé
  // au premier usage, cf. commands/windowPanels.ts ; marqueurs éco : chargés avec EcoWindow).
  ...derivChartCommands,
  ...commandesTradeMarkers,
  ...liqMarksCommands,
  ...liqEstCommands,
  ...hlLiqCommands,
  // WHALE : bulles de prints, contrôleur chargé au premier usage (cf. commands/windowPanels.ts).
  ...commandesWhaleBubbles,
  ...depthHeatCommands,
  ...commandesNiveauxOverlays,
  // Fenêtres Phase 4 (DOM/BT/REPLAY) + grille multi-chart.
  ...domCommands,
  // BT : bascule directe, sans charger store/backtest (cf. commands/windowPanels.ts).
  ...commandesBacktest,
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
  dist: lazy(() => import("./components/DistWindow").then((m) => ({ default: m.DistWindow }))),
  netliq: lazy(() =>
    import("./components/NetliqWindow").then((m) => ({ default: m.NetliqWindow })),
  ),
  data: lazy(() => import("./components/DataWindow").then((m) => ({ default: m.DataWindow }))),
  expy: lazy(() => import("./components/ExpyWindow").then((m) => ({ default: m.ExpyWindow }))),
  paper: lazy(() => import("./components/PaperWindow").then((m) => ({ default: m.PaperWindow }))),
  mine: lazy(() => import("./components/MineWindow").then((m) => ({ default: m.MineWindow }))),
  whales: lazy(() => import("./components/WhalesWindow").then((m) => ({ default: m.WhalesWindow }))),
  cycle: lazy(() => import("./components/CycleWindow").then((m) => ({ default: m.CycleWindow }))),
  btcPowerLaw: lazy(() =>
    import("./components/BtcPowerLawWindow").then((m) => ({ default: m.BtcPowerLawWindow })),
  ),
  evts: lazy(() => import("./components/EvtsWindow").then((m) => ({ default: m.EvtsWindow }))),
  scen: lazy(() => import("./components/ScenWindow").then((m) => ({ default: m.ScenWindow }))),
  mcap: lazy(() => import("./components/McapWindow").then((m) => ({ default: m.McapWindow }))),
  sect: lazy(() => import("./components/SectWindow").then((m) => ({ default: m.SectWindow }))),
};

/** Placeholder discret pendant le chargement du chunk de la fenêtre. */
function FenetreFallback() {
  return <div className="p-3 text-xs text-text-dim">Chargement…</div>;
}

const SettingsPanel = lazy(() => import("./components/SettingsPanel").then(m => ({ default: m.SettingsPanel })));
// Panneau Alertes de la sidebar : lazy comme les fenêtres (chunk hors budget initial).
// Le runtime d'alertes (`demarrerAlertes`) reste statique — le module n'a aucun effet
// de bord nécessaire au boot.
const AlertsPanel = lazy(() => import("./components/AlertsPanel").then(m => ({ default: m.AlertsPanel })));
const OnboardingOverlay = lazy(() => import("./components/OnboardingOverlay").then(m => ({ default: m.OnboardingOverlay })));
const CommandPalette = lazy(() => import("./components/CommandPalette").then(m => ({ default: m.CommandPalette })));

/** Repli Suspense d'AlertsPanel : en-tête « Alertes » statique, même hauteur/typo
 *  que le header de `SidebarSection` replié (son état par défaut). */
function AlertsPanelFallback() {
  return (
    <section className="flex shrink-0 flex-col border-t border-border">
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="w-2 text-[9px] leading-none text-text-dim">
            ▶
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
            Alertes
          </span>
        </span>
      </header>
    </section>
  );
}

export function App() {
  const mobile = useMobileLayout();
  const [panneauxOuverts, setPanneauxOuverts] = useState(false);
  const [panneauxCharges, setPanneauxCharges] = useState(!mobile);
  const [dessinsOuverts, setDessinsOuverts] = useState(false);
  const [optionsOuvertes, setOptionsOuvertes] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panneauxRef = useRef<HTMLElement>(null);
  const openSettings = useStore(settingsUiStore, (s) => s.openSettings);
  const reglagesOuverts = useStore(settingsUiStore, (s) => s.open);
  const onboardingTermine = useStore(onboardingStore, (s) => s.completed);
  const paletteOuverte = useStore(paletteStore, (s) => s.ouvert);
  const [paletteChargee, setPaletteChargee] = useState(paletteOuverte);
  const [reglagesCharges, setReglagesCharges] = useState(reglagesOuverts);
  // Chargé à la première ouverture, puis conservé pour préserver les brouillons.
  useEffect(() => { if (reglagesOuverts) setReglagesCharges(true); }, [reglagesOuverts]);
  useEffect(() => { if (paletteOuverte) setPaletteChargee(true); }, [paletteOuverte]);
  const plein = useStore(fullscreenStore, (s) => s.plein);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const panneauxMasques = plein || (mobile && !panneauxOuverts);
  const fermerFeuilles = useCallback(() => {
    setPanneauxOuverts(false);
    setDessinsOuverts(false);
    setOptionsOuvertes(false);
  }, []);

  // Même durée de vie que la sidebar desktop après sa première utilisation :
  // fermer le tiroir ne doit pas jeter le formulaire d'alerte en cours.
  useEffect(() => {
    if (!mobile || panneauxOuverts) setPanneauxCharges(true);
  }, [mobile, panneauxOuverts]);
  useLayoutEffect(() => {
    if (panneauxRef.current) panneauxRef.current.inert = panneauxMasques;
  }, [panneauxMasques, panneauxCharges]);

  // Toutes les entrées vers une fenêtre (menu, ticker, raccourci, restauration)
  // révèlent le contenu demandé plutôt que de le laisser sous un tiroir.
  useEffect(() => windowManagerStore.subscribe((next, prev) => {
    if (next.windows !== prev.windows && Object.entries(next.windows).some(([id, w]) => {
      const avant = prev.windows[id];
      return w.open && !w.minimized && (!avant?.open || avant.minimized || avant.z !== w.z);
    })) fermerFeuilles();
  }), [fermerFeuilles]);

  useEffect(() => {
    if (!mobile || reglagesOuverts || paletteOuverte || plein) {
      setPanneauxOuverts(false);
      setDessinsOuverts(false);
      setOptionsOuvertes(false);
    }
  }, [mobile, reglagesOuverts, paletteOuverte, plein]);

  useEffect(() => {
    if (!panneauxOuverts && !dessinsOuverts) return;
    const echap = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPanneauxOuverts(false); setDessinsOuverts(false); }
    };
    document.addEventListener("keydown", echap);
    return () => document.removeEventListener("keydown", echap);
  }, [panneauxOuverts, dessinsOuverts]);

  // Écouteur clavier global unique (TF, toggles, plein écran, palette…).
  useRaccourcisGlobaux();

  // Runtime des alertes : démarré une fois pour toute la session (idempotent,
  // compatible double montage React StrictMode). Arrêté au démontage.
  useEffect(() => {
    const stop = demarrerAlertes();
    return () => stop();
  }, []);

  // Moteur paper trading : idem alertes (idempotent, StrictMode-safe). Ne souscrit aux tickers
  // que s'il y a des ordres/positions actifs ; dort sinon (aucun coût réseau).
  useEffect(() => {
    const stop = demarrerMoteurPaper();
    return () => stop();
  }, []);

  // Zone de travail des fenêtres flottantes = la zone du graphe (exclut toolbar/barre
  // de dessin/panneau latéral) — mesurée sur ce div, PAS sur window.innerWidth/innerHeight.
  useLayoutEffect(() => {
    const el = chartAreaRef.current;
    if (!el) return;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const mesurer = (): void => {
      const rect = el.getBoundingClientRect();
      // Le cadrage téléphone est uniquement visuel : setWorkspace reclampe et
      // persiste les fenêtres desktop, donc ne doit pas recevoir ce petit rectangle.
      if (mobile) {
        const style = rootRef.current?.style;
        style?.setProperty("--mobile-workspace-x", `${rect.x}px`);
        style?.setProperty("--mobile-workspace-y", `${rect.y}px`);
        style?.setProperty("--mobile-workspace-width", `${rect.width}px`);
        style?.setProperty("--mobile-workspace-height", `${rect.height}px`);
      } else {
        windowManagerStore.getState().setWorkspace({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      }
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
  }, [mobile, plein]);

  return (
    <div ref={rootRef} className={`axiom-app flex h-screen w-full flex-col overflow-hidden bg-bg text-text${mobile ? " axiom-mobile" : ""}`}>
      {/* Plein écran : toolbars et sidebar masquées, le graphe occupe tout l'écran. */}
      {!plein && <Toolbar optionsOuvertes={optionsOuvertes} onOptionsChange={(open) => {
        setOptionsOuvertes(open);
        if (open) { setPanneauxOuverts(false); setDessinsOuverts(false); }
      }} />}
      {/* Strip session (P&L jour · alertes · santé) — hors plein écran, dense 11px. */}
      {!plein && <SessionStrip />}
      {/* Bandeau news défilant (enfant flex : le workspace mesuré par chartAreaRef se
          rétrécit automatiquement). Se masque lui-même selon tickerBandStore (⌘K TICKER). */}
      {!plein && <TickerBand />}
      {/* min-h-0 indispensable pour que le graphe (flex-1) prenne une hauteur réelle. */}
      <main className="relative flex min-h-0 flex-1">
        {/* Barre d'outils de dessin verticale, à gauche du graphe. */}
        {!plein && <DrawingToolbar mobileOpen={dessinsOuverts} onClose={() => setDessinsOuverts(false)} />}
        {/* min-w-0 : la grille de graphes peut rétrécir face aux panneaux latéraux. */}
        <div ref={chartAreaRef} className="relative isolate z-0 min-w-0 flex-1">
          <ErrorBoundary scope="Graphiques">
            <ChartGrid />
          </ErrorBoundary>
        </div>
        {/* Colonne droite : en-tête (accès Réglages) + panneaux empilés, tous harmonisés
            via SidebarSection. Ordre : Watchlist, Alertes, Comparer, Santé. Les mesures
            macro ont quitté la sidebar pour l'onglet « Macro » du menu Indicateurs. */}
        {(!mobile || panneauxOuverts || panneauxCharges) && (
          <aside ref={panneauxRef} id="panneaux-terminal" aria-label="Panneaux du terminal"
            role={mobile ? "dialog" : undefined}
            aria-hidden={panneauxMasques || undefined}
            style={{ display: panneauxMasques ? "none" : undefined }}
            className={`${mobile ? "axiom-mobile-sidebar" : "flex w-60 shrink-0"} flex-col min-h-0 overflow-y-auto border-l border-border bg-surface`}>
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
              {mobile && <button type="button" aria-label="Fermer les panneaux" onClick={() => setPanneauxOuverts(false)}
                className="rounded px-3 text-text-dim">✕</button>}
            </div>
            <Watchlist />
            <Suspense fallback={<AlertsPanelFallback />}>
              <AlertsPanel />
            </Suspense>
            <CompareControl />
            <HealthPanel />
          </aside>
        )}
      </main>

      {/* Taskbar des fenêtres ouvertes — DANS LE FLUX (dernier enfant du flex-col) : elle
          réserve sa hauteur, donc le workspace mesuré par chartAreaRef se rétrécit et l'axe
          temporel du chart n'est plus masqué. Rien quand aucune fenêtre n'est ouverte. */}
      <Taskbar onNavigate={fermerFeuilles} feuilleOuverte={mobile && (panneauxOuverts || dessinsOuverts || optionsOuvertes)} />
      {mobile && !plein && <MobileNavigation panneauxOuverts={panneauxOuverts} dessinsOuverts={dessinsOuverts}
        onNavigate={fermerFeuilles}
        onPanneaux={() => { setPanneauxOuverts((o) => !o); setDessinsOuverts(false); setOptionsOuvertes(false); }}
        onDessins={() => {
          if (!dessinsOuverts) windowManagerStore.getState().minimizeAll();
          setDessinsOuverts((o) => !o); setPanneauxOuverts(false); setOptionsOuvertes(false);
        }} />}

      {/* Indice discret pour sortir du plein écran (aucune toolbar visible alors). */}
      {plein && (
        <button type="button" onClick={() => fullscreenStore.getState().definir(false)}
          className="fixed bottom-3 left-3 z-30 min-h-11 rounded border border-border bg-surface px-3 py-1 text-xs text-text-dim">
          Quitter le plein écran
        </button>
      )}

      {/* Fenêtres Bloomberg : chunk chargé à la première ouverture. Sur mobile,
          les fenêtres réduites restent montées pour conserver leurs brouillons. */}
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
      <Suspense fallback={null}>{(reglagesOuverts || reglagesCharges) && <SettingsPanel />}</Suspense>
      <Suspense fallback={null}>{(paletteOuverte || paletteChargee) && <CommandPalette />}</Suspense>
      {/* Premier lancement : 3 étapes (masqué si completed ; ⌘K ONBOARD pour rejouer). */}
      <Suspense fallback={null}>{!onboardingTermine && <OnboardingOverlay />}</Suspense>
      {/* Toasts de feedback (export PNG, workspace, playbook, sauvegarde) — coin bas-droit. */}
      <Toasts />
    </div>
  );
}
