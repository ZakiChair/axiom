/**
 * App — layout sombre plein écran : toolbar en haut, graphe sur le reste.
 *
 * Monte aussi les surfaces transverses : palette de commandes (⌘K), raccourcis
 * clavier globaux, runtime des alertes, et le mode plein écran (masque toolbars +
 * sidebar pour ne garder que le graphe).
 */
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { Toolbar } from "./components/Toolbar";
import { DrawingToolbar } from "./components/DrawingToolbar";
import { ChartGrid } from "./chart/ChartGrid";
import { Watchlist } from "./components/Watchlist";
import { AlertsPanel } from "./components/AlertsPanel";
import { CompareControl } from "./components/CompareControl";
import { MacroPanel } from "./components/MacroPanel";
import { DerivativesWindow } from "./components/DerivativesWindow";
import { HealthPanel } from "./components/HealthPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { CommandPalette } from "./components/CommandPalette";
// Fenêtres non modales de la Phase 3 (dockées à droite, montées en permanence : elles se
// cachent elles-mêmes via translate-x quand fermées). EcoWindow importe chart/ecoMarkers en
// effet de bord → doit rester monté pour que les marqueurs éco fonctionnent.
import { EcoWindow } from "./components/EcoWindow";
import { NewsWindow } from "./components/NewsWindow";
import { CorrWindow, commandes as corrCommands } from "./components/CorrWindow";
import { OnchainWindow } from "./components/OnchainWindow";
import { MarketMapWindow, commandes as mapCommands } from "./components/MarketMapWindow";
import { PortfolioWindow } from "./components/PortfolioWindow";
import { NotesWindow } from "./components/NotesWindow";
import { ScreenerWindow } from "./components/ScreenerWindow";
import { TermStructureWindow, commandes as termCommands } from "./components/TermStructureWindow";
import { OptionsWindow, commandes as optionsCommands } from "./components/OptionsWindow";
// Fenêtres non modales de la Phase 4 (le multi-chart est déjà monté via ChartGrid) : dockées
// à droite, montées en permanence (elles se cachent via translate-x quand fermées). Même
// patron que les fenêtres de la Phase 3.
import { DomWindow } from "./components/DomWindow";
import { BacktestWindow } from "./components/BacktestWindow";
import { ReplayWindow } from "./components/ReplayWindow";
// Fenêtres non modales de la Phase 5 (batch souverain / COT / GEX) : même patron que les
// fenêtres des Phases 3-4 (dockées à droite, montées en permanence, cachées via translate-x).
import { MacroRatesWindow, commandes as macroRatesCommands } from "./components/MacroRatesWindow";
import { CotWindow, commandes as cotCommands } from "./components/CotWindow";
import { SeasonalityWindow, commandes as seasonalityCommands } from "./components/SeasonalityWindow";
import { VolWindow, commandes as volCommands } from "./components/VolWindow";
import { FundWindow, commandes as fundCommands } from "./components/FundWindow";
import { settingsUiStore } from "./store/settings-ui";
import { ecoCommands } from "./store/eco";
import { commandes as newsCommands } from "./store/news";
import { commandes as onchainCommands } from "./store/onchain";
import { commandes as portfolioCommands } from "./store/portfolio";
import { commandes as notesCommands } from "./store/notes";
import { commandesScreener } from "./store/screener";
import { commandes as derivChartCommands } from "./store/derivatives-chart";
// Commandes de palette des fenêtres de la Phase 4, et store de disposition grille.
import { commandes as domCommands } from "./store/dom-ui";
import { commandes as backtestCommands } from "./store/backtest";
import { commandes as replayCommands } from "./store/replay";
import { chartLayoutStore, type ChartLayoutMode } from "./store/chart-layout";
import { enregistrerCommandes, type Commande } from "./commands/registry";
import { useRaccourcisGlobaux, fullscreenStore } from "./commands/hotkeys";
import { demarrerAlertes } from "./alerts/runtime";
import { FloatingWindow } from "./components/FloatingWindow";
import { TaskbarMinimized } from "./components/TaskbarMinimized";
import { SnapOverlay } from "./components/SnapOverlay";
import { WINDOW_REGISTRY, windowManagerStore } from "./store/windowManager";

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

// ─────────────────────────── Greffe des commandes de palette (Phase 3) ───────────────────────────

/**
 * Enregistre les commandes de palette des fenêtres de la Phase 3 (point d'extension
 * ADDITIF, idempotent par `id`). Fait à l'IMPORT — donc AVANT le premier rendu de la
 * palette — comme le bloc Workspaces de Toolbar.tsx. Placé ici (et non dans registry.ts)
 * pour NE PAS coupler le registre — ni son test unitaire — au graphe de dépendances lourd
 * des panneaux (chart/canvas/fetchers). Mnémoniques : ECO, NEWS, CORR, CHAIN, IMAP, PORT,
 * NOTE, EQS, TERM, OMON (DES est déjà dans le registre statique).
 */
enregistrerCommandes([
  ...ecoCommands,
  ...newsCommands,
  ...corrCommands,
  ...onchainCommands,
  ...mapCommands,
  ...portfolioCommands,
  ...notesCommands,
  ...commandesScreener,
  ...termCommands,
  ...optionsCommands,
  // Sous-panes OI/funding SUR le chart : le contrôleur (agent « deriv ») est DÉJÀ câblé
  // dans Chart.tsx ; ces bascules (OI / FUND) le rendent atteignable (sinon inerte).
  ...derivChartCommands,
  // Fenêtres de la Phase 4 (DOM/TAPE, BT, REPLAY) + dispositions de la grille multi-chart.
  ...domCommands,
  ...backtestCommands,
  ...replayCommands,
  ...macroRatesCommands,
  ...commandesGrille,
  // Fenêtre COT (Phase 5).
  ...cotCommands,
  // Fenêtres Saisonnalité et Volatilité (Lot C1 analytics).
  ...seasonalityCommands,
  ...volCommands,
  // Fenêtre FUND (Lot E1 — fiche société tradfi, SEC EDGAR + Finnhub).
  ...fundCommands,
]);

// ─────────────────────────── Table composant↔id des fenêtres flottantes ───────────────────────────

/** Association id de fenêtre (WINDOW_REGISTRY) -> composant de contenu. Utilisé pour
 * monter chaque fenêtre sous <FloatingWindow> de façon générique (au lieu de 14 JSX
 * explicites) et pour retirer PANNEAUX_DROITE (l'exclusion mutuelle est remplacée par
 * le z-order de windowManagerStore — plusieurs fenêtres peuvent désormais coexister). */
const WINDOW_COMPONENTS: Record<string, () => JSX.Element> = {
  derivatives: DerivativesWindow,
  eco: EcoWindow,
  news: NewsWindow,
  corr: CorrWindow,
  onchain: OnchainWindow,
  marketMap: MarketMapWindow,
  portfolio: PortfolioWindow,
  notes: NotesWindow,
  screener: ScreenerWindow,
  termStructure: TermStructureWindow,
  options: OptionsWindow,
  dom: DomWindow,
  backtest: BacktestWindow,
  replay: ReplayWindow,
  macroRates: MacroRatesWindow,
  cot: CotWindow,
  seasonality: SeasonalityWindow,
  vol: VolWindow,
  fund: FundWindow,
};

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
  // Un seul ResizeObserver capture aussi bien le resize du navigateur QUE le bascule
  // plein écran (qui démonte/remonte la toolbar et le panneau, changeant la taille de
  // ce div) — un seul point d'entrée au lieu d'un listener par déclencheur. Débounce
  // 150ms conservé (même esprit que l'ancien listener resize).
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
      {/* min-h-0 indispensable pour que le graphe (flex-1) prenne une hauteur réelle. */}
      <main className="flex min-h-0 flex-1">
        {/* Barre d'outils de dessin verticale, à gauche du graphe. */}
        {!plein && <DrawingToolbar />}
        {/* min-w-0 : la grille de graphes peut rétrécir face aux panneaux latéraux. */}
        <div ref={chartAreaRef} className="min-w-0 flex-1">
          <ChartGrid />
        </div>
        {/* Colonne droite : en-tête (accès Réglages) + panneaux empilés, tous harmonisés
            via SidebarSection. Ordre : Watchlist, Alertes, Macro, Comparer, Santé. */}
        {!plein && (
          <aside className="flex w-60 shrink-0 flex-col border-l border-border bg-surface">
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

      {/* Indice discret pour sortir du plein écran (aucune toolbar visible alors). */}
      {plein && (
        <div className="pointer-events-none fixed bottom-3 left-3 z-30 rounded border border-border bg-surface/80 px-2 py-1 text-[10px] text-text-dim">
          F ou Échap : quitter le plein écran
        </div>
      )}

      {/* Les 19 fenêtres Bloomberg non modales, montées génériquement sous <FloatingWindow>
          via WINDOW_REGISTRY (géométrie/z-order/minimize gérés par windowManagerStore). */}
      {WINDOW_REGISTRY.map((entry) => {
        const Contenu = WINDOW_COMPONENTS[entry.id];
        if (!Contenu) return null;
        return (
          <FloatingWindow key={entry.id} id={entry.id} title={entry.title} mnemonic={entry.mnemonic}>
            <Contenu />
          </FloatingWindow>
        );
      })}
      <SnapOverlay />
      <TaskbarMinimized />
      <SettingsPanel />
      <CommandPalette />
    </div>
  );
}
