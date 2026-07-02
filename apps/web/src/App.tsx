/**
 * App — layout sombre plein écran : toolbar en haut, graphe sur le reste.
 *
 * Monte aussi les surfaces transverses : palette de commandes (⌘K), raccourcis
 * clavier globaux, runtime des alertes, et le mode plein écran (masque toolbars +
 * sidebar pour ne garder que le graphe).
 */
import { useEffect } from "react";
import { useStore } from "zustand";
import { Toolbar } from "./components/Toolbar";
import { DrawingToolbar } from "./components/DrawingToolbar";
import { Chart } from "./chart/Chart";
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
import { CorrWindow, corrUiStore, commandes as corrCommands } from "./components/CorrWindow";
import { OnchainWindow } from "./components/OnchainWindow";
import { MarketMapWindow, commandes as mapCommands } from "./components/MarketMapWindow";
import { PortfolioWindow } from "./components/PortfolioWindow";
import { NotesWindow } from "./components/NotesWindow";
import { ScreenerWindow } from "./components/ScreenerWindow";
import {
  TermStructureWindow,
  termStructureUiStore,
  commandes as termCommands,
} from "./components/TermStructureWindow";
import { OptionsWindow, optionsUiStore, commandes as optionsCommands } from "./components/OptionsWindow";
import { settingsUiStore } from "./store/settings-ui";
import { derivativesUiStore } from "./store/derivatives-ui";
import { ecoStore, ecoCommands } from "./store/eco";
import { newsUiStore, commandes as newsCommands } from "./store/news";
import { onchainUiStore, commandes as onchainCommands } from "./store/onchain";
import { marketMapUiStore } from "./store/marketmap-ui";
import { portfolioUiStore, commandes as portfolioCommands } from "./store/portfolio";
import { notesUiStore, commandes as notesCommands } from "./store/notes";
import { screenerStore, commandesScreener } from "./store/screener";
import { commandes as derivChartCommands } from "./store/derivatives-chart";
import { enregistrerCommandes } from "./commands/registry";
import { useRaccourcisGlobaux, fullscreenStore } from "./commands/hotkeys";
import { demarrerAlertes } from "./alerts/runtime";

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
]);

// ─────────────────────────── Exclusion mutuelle des panneaux dockés à droite ───────────────────────────

/**
 * Tous les panneaux non modaux partagent le MÊME emplacement (`fixed right-0 top-0 z-40`).
 * On n'en montre donc qu'UN à la fois : ouvrir l'un ferme les autres. Bénéfice double —
 * pas d'empilement visuel, et le polling des panneaux masqués s'arrête (leurs effets se
 * coupent sur `open === false`). Chaque store vanilla expose `open` + une méthode de fermeture.
 */
const PANNEAUX_DROITE: {
  estOuvert: () => boolean;
  fermer: () => void;
  sabonner: (cb: () => void) => () => void;
}[] = [
  { estOuvert: () => derivativesUiStore.getState().open, fermer: () => derivativesUiStore.getState().closeDerivatives(), sabonner: (cb) => derivativesUiStore.subscribe(cb) },
  { estOuvert: () => ecoStore.getState().open, fermer: () => ecoStore.getState().closeEco(), sabonner: (cb) => ecoStore.subscribe(cb) },
  { estOuvert: () => newsUiStore.getState().open, fermer: () => newsUiStore.getState().closeNews(), sabonner: (cb) => newsUiStore.subscribe(cb) },
  { estOuvert: () => corrUiStore.getState().open, fermer: () => corrUiStore.getState().closeCorr(), sabonner: (cb) => corrUiStore.subscribe(cb) },
  { estOuvert: () => onchainUiStore.getState().open, fermer: () => onchainUiStore.getState().closeOnchain(), sabonner: (cb) => onchainUiStore.subscribe(cb) },
  { estOuvert: () => marketMapUiStore.getState().open, fermer: () => marketMapUiStore.getState().closeMarketMap(), sabonner: (cb) => marketMapUiStore.subscribe(cb) },
  { estOuvert: () => portfolioUiStore.getState().open, fermer: () => portfolioUiStore.getState().closePortfolio(), sabonner: (cb) => portfolioUiStore.subscribe(cb) },
  { estOuvert: () => notesUiStore.getState().open, fermer: () => notesUiStore.getState().closeNotes(), sabonner: (cb) => notesUiStore.subscribe(cb) },
  { estOuvert: () => screenerStore.getState().open, fermer: () => screenerStore.getState().closeScreener(), sabonner: (cb) => screenerStore.subscribe(cb) },
  { estOuvert: () => termStructureUiStore.getState().open, fermer: () => termStructureUiStore.getState().closeTermStructure(), sabonner: (cb) => termStructureUiStore.subscribe(cb) },
  { estOuvert: () => optionsUiStore.getState().open, fermer: () => optionsUiStore.getState().closeOptions(), sabonner: (cb) => optionsUiStore.subscribe(cb) },
];

export function App() {
  const openSettings = useStore(settingsUiStore, (s) => s.openSettings);
  const plein = useStore(fullscreenStore, (s) => s.plein);

  // Écouteur clavier global unique (TF, toggles, plein écran, palette…).
  useRaccourcisGlobaux();

  // Runtime des alertes : démarré une fois pour toute la session (idempotent,
  // compatible double montage React StrictMode). Arrêté au démontage.
  useEffect(() => {
    const stop = demarrerAlertes();
    return () => stop();
  }, []);

  // Exclusion mutuelle des panneaux dockés à droite (cf. PANNEAUX_DROITE) : ils
  // partagent tous le MÊME emplacement (fixed right-0 top-0), on n'en montre donc qu'UN.
  // Dès qu'un panneau passe à « ouvert », on ferme les autres → règle « dernière ouverte
  // devant » sans empilement ni cascade. Un abonnement par store, nettoyé au démontage ;
  // la garde `enCascade` ignore les notifications déclenchées par nos propres fermetures.
  useEffect(() => {
    let precedents = PANNEAUX_DROITE.map((p) => p.estOuvert());
    let enCascade = false;
    const gerer = (): void => {
      if (enCascade) return;
      const maintenant = PANNEAUX_DROITE.map((p) => p.estOuvert());
      const ouvrant = maintenant.findIndex((ouvert, i) => ouvert && !precedents[i]);
      if (ouvrant !== -1) {
        enCascade = true;
        PANNEAUX_DROITE.forEach((p, k) => {
          if (k !== ouvrant) p.fermer();
        });
        enCascade = false;
      }
      precedents = PANNEAUX_DROITE.map((p) => p.estOuvert());
    };
    const desabonnements = PANNEAUX_DROITE.map((p) => p.sabonner(gerer));
    return () => desabonnements.forEach((off) => off());
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-text">
      {/* Plein écran : toolbars et sidebar masquées, le graphe occupe tout l'écran. */}
      {!plein && <Toolbar />}
      {/* min-h-0 indispensable pour que le graphe (flex-1) prenne une hauteur réelle. */}
      <main className="flex min-h-0 flex-1">
        {/* Barre d'outils de dessin verticale, à gauche du graphe. */}
        {!plein && <DrawingToolbar />}
        {/* min-w-0 : le graphe peut rétrécir face aux panneaux latéraux. */}
        <div className="min-w-0 flex-1">
          <Chart />
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

      {/* Surfaces globales montées au niveau racine, au-dessus du reste. */}
      <DerivativesWindow />
      {/* Fenêtres non modales de la Phase 3 : montées en permanence (elles se cachent
          elles-mêmes via translate-x quand fermées). L'exclusion mutuelle ci-dessus
          garantit qu'une seule reste visible à la fois. */}
      <EcoWindow />
      <NewsWindow />
      <CorrWindow />
      <OnchainWindow />
      <MarketMapWindow />
      <PortfolioWindow />
      <NotesWindow />
      <ScreenerWindow />
      <TermStructureWindow />
      <OptionsWindow />
      <SettingsPanel />
      <CommandPalette />
    </div>
  );
}
