/**
 * Playbooks 1-clic — scénarios métier composés d'actions stores VANILLA.
 *
 * Un playbook n'est PAS un workspace (snapshot libre renommable) : c'est un
 * scénario figé (scalp orderflow, fade funding, FOMC, risk-off, options) qui
 * bascule la grille, ouvre les fenêtres existantes et active les toggles utiles.
 * Plus riche que le mini-scalp d'onboarding ; découvrable via ⌘K (PLAY, PLAY-SCALP…)
 * et le menu Toolbar « Playbooks » (à côté de Fonctions).
 *
 * Aucun type de fenêtre inventé — uniquement les ids de `WINDOW_REGISTRY`.
 * Commandes exportées ici ; greffe via `enregistrerCommandes` dans App.tsx
 * (même pattern onboarding / eco — pas d'ajout dans construireRegistre).
 */
import type { ExchangeId, Timeframe } from "@axiom/types";
// Import de TYPE uniquement (élidé au runtime) : greffe par l'intégrateur App.tsx.
import type { Commande } from "../commands/registry";
import { chartLayoutStore, type ChartLayoutMode } from "../store/chart-layout";
import { derivativesChartStore } from "../store/derivatives-chart";
import { macroOverlayStore, MACRO_OVERLAYS } from "../store/macro-overlays";
import { marketStore } from "../store/market";
import { orderflowStore } from "../store/orderflow";
import { volumeProfileStore } from "../store/volumeProfile";
import { windowManagerStore } from "../store/windowManager";
import { alertsStore } from "../store/alerts";
import { liqMarksStore } from "../chart/liquidationMarkers";
import { liqEstStore } from "../chart/liquidationEstimates";

// ─────────────────────────── Types ───────────────────────────

/** Scénario 1-clic : métadonnées + action purement store-driven. */
export interface Playbook {
  id: string;
  nom: string;
  /** Mnémonique palette (ex. PLAY-SCALP). */
  mnemonique: string;
  description: string;
  /** Compose des setters de stores vanilla (hors render-loop React). */
  apply: () => void;
}

/** Métadonnées sérialisables d'un playbook (tests pures, sans side-effect). */
export interface PlaybookMeta {
  id: string;
  nom: string;
  mnemonique: string;
  description: string;
}

// ─────────────────────────── Helpers d'application ───────────────────────────

/** Ouvre une liste de fenêtres déjà enregistrées (no-op sur id inconnu côté WM). */
function ouvrirFenetres(...ids: string[]): void {
  const wm = windowManagerStore.getState();
  for (const id of ids) wm.openWindow(id);
}

/** Bascule la grille multi-chart. */
function setLayout(mode: ChartLayoutMode): void {
  chartLayoutStore.getState().setLayout(mode);
}

/** Positionne le marché maître (ordre : source → symbole → TF). */
function setMarche(opts: {
  exchange?: ExchangeId;
  symbol?: string;
  timeframe?: Timeframe;
}): void {
  const m = marketStore.getState();
  if (opts.exchange !== undefined) m.setExchange(opts.exchange);
  if (opts.symbol !== undefined) m.setSymbol(opts.symbol);
  if (opts.timeframe !== undefined) m.setTimeframe(opts.timeframe);
}

// ─────────────────────────── Apply des 5 playbooks ───────────────────────────

/** Scalp BTC orderflow : 1 graphe, DES + DOM, orderflow + VP, 1m. */
export function applyScalpBtc(): void {
  setLayout("1");
  setMarche({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m" });
  ouvrirFenetres("derivatives", "dom");
  orderflowStore.getState().setEnabled(true);
  volumeProfileStore.getState().setEnabled(true);
}

/** Fade funding : 1 graphe, DES + EQS, sous-pane funding ON + CVD S/P (edge). */
export function applyFadeFunding(): void {
  setLayout("1");
  setMarche({ exchange: "binance", symbol: "BTCUSDT", timeframe: "15m" });
  ouvrirFenetres("derivatives", "screener");
  // setState : le store n'expose que toggle — on force ON de façon idempotente.
  derivativesChartStore.setState({ funding: true });
  // Pipeline pour croiser funding crowded + divergence spot/perp.
  orderflowStore.getState().setEnabled(true);
  orderflowStore.getState().setCvdSpotPerp(true);
}

/**
 * Edge CVD spot/perp : BTC 5m, orderflow + CVD S/P + DES, section alertes prête.
 * Crée une alerte « toute divergence S/P » si aucune n'existe encore pour BTCUSDT.
 */
export function applyCvdEdge(): void {
  setLayout("1");
  setMarche({ exchange: "binance", symbol: "BTCUSDT", timeframe: "5m" });
  ouvrirFenetres("derivatives");
  orderflowStore.getState().setEnabled(true);
  orderflowStore.getState().setCvdSpotPerp(true);
  volumeProfileStore.getState().setEnabled(true);
  // Alerte CVD seed (idempotent si déjà une cvd-spot-perp-div sur BTCUSDT).
  const { defs, ajouter } = alertsStore.getState();
  const deja = defs.some(
    (d) =>
      d.symbol === "BTCUSDT" &&
      d.actif &&
      d.condition.type === "cvd-spot-perp-div"
  );
  if (!deja) {
    ajouter({
      symbol: "BTCUSDT",
      source: "binance",
      condition: { type: "cvd-spot-perp-div", kind: "les-deux" },
      message: "Divergence CVD spot vs perp (playbook PLAY-CVD)",
    });
  }
}

/** Macro FOMC : 2h, ECO + RATE + NEWS, overlays macro (M2 / stables / total). */
export function applyMacroFomc(): void {
  setLayout("2h");
  setMarche({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" });
  ouvrirFenetres("eco", "macroRates", "news");
  macroOverlayStore.getState().setEnabled([...MACRO_OVERLAYS]);
}

/** Risk-off globe : 2v, GLOBE + MAP + CORR. */
export function applyRiskOff(): void {
  setLayout("2v");
  setMarche({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" });
  ouvrirFenetres("globe", "marketMap", "corr");
}

/**
 * Options Deribit : 1 graphe, OMON + TERM + VOL.
 * Le graphe maître reste Binance BTCUSDT — `deribit` n'a pas d'adaptateur OHLCV
 * câblé (`getAdapter` lève) ; OMON/TERM/VOL tirent Deribit en propre (devise BTC/ETH UI).
 */
export function applyOptionsDeribit(): void {
  setLayout("1");
  // Spot/perp chart : source câblée uniquement (pas d'exchange "deribit" pour le marketStore).
  setMarche({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" });
  ouvrirFenetres("options", "termStructure", "vol");
}

/**
 * Chasse aux liquidations : ouvre la fenêtre LIQ, active la heatmap des liquidations
 * exécutées + les niveaux ESTIMÉS, passe le TF à 15m. `setActif(true)` est idempotent
 * (n'a d'effet que si la couche est éteinte). Le symbole courant est conservé.
 */
export function applyChasseLiquidations(): void {
  setMarche({ timeframe: "15m" });
  ouvrirFenetres("liquidations");
  liqMarksStore.getState().setActif(true);
  liqEstStore.getState().setActif(true);
}

// ─────────────────────────── Catalogue ───────────────────────────

/** Playbooks seed (ordre d'affichage palette / menu). */
export const PLAYBOOKS: readonly Playbook[] = [
  {
    id: "scalp-btc",
    nom: "Scalp BTC orderflow",
    mnemonique: "PLAY-SCALP",
    description: "BTC 1m · DES + DOM · orderflow + profil de volume",
    apply: applyScalpBtc,
  },
  {
    id: "fade-funding",
    nom: "Fade funding",
    mnemonique: "PLAY-FADE",
    description: "BTC 15m · DES + EQS · funding + CVD S/P",
    apply: applyFadeFunding,
  },
  {
    id: "cvd-edge",
    nom: "Edge CVD spot/perp",
    mnemonique: "PLAY-CVD",
    description: "BTC 5m · DES · orderflow CVD S/P · alerte divergence",
    apply: applyCvdEdge,
  },
  {
    id: "macro-fomc",
    nom: "Macro FOMC",
    mnemonique: "PLAY-FOMC",
    description: "Grille 2h · ECO + RATE + NEWS · overlays macro",
    apply: applyMacroFomc,
  },
  {
    id: "risk-off",
    nom: "Risk-off globe",
    mnemonique: "PLAY-RISK",
    description: "Grille 2v · GLOBE + MAP + CORR",
    apply: applyRiskOff,
  },
  {
    id: "options-deribit",
    nom: "Options",
    mnemonique: "PLAY-OPT",
    description:
      "OMON + TERM + VOL (Deribit) · graphe reste Binance BTC (pas d'adaptateur OHLCV Deribit)",
    apply: applyOptionsDeribit,
  },
  {
    id: "chasse-liquidations",
    nom: "Chasse aux liquidations",
    mnemonique: "PLAY-LIQ",
    description: "LIQ · heatmap exécutées + niveaux estimés · 15m",
    apply: applyChasseLiquidations,
  },
];

/** Métadonnées pures (sans `apply`) — utile aux tests unitaires. */
export function playbooksMeta(): PlaybookMeta[] {
  return PLAYBOOKS.map(({ id, nom, mnemonique, description }) => ({
    id,
    nom,
    mnemonique,
    description,
  }));
}

/** Recherche par id (undefined si inconnu). */
export function playbookParId(id: string): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.id === id);
}

/** Recherche par mnémonique exact (insensible à la casse). */
export function playbookParMnemonique(mnemo: string): Playbook | undefined {
  const u = mnemo.trim().toUpperCase();
  return PLAYBOOKS.find((p) => p.mnemonique.toUpperCase() === u);
}

// ─────────────────────────── Commandes palette ───────────────────────────

/**
 * Commandes greffées : PLAY (index → scalp par défaut) + un mnémonique par playbook.
 * `action` relit le catalogue à l'exécution (HMR-friendly).
 */
export const commandesPlaybooks: Commande[] = [
  {
    id: "playbook:index",
    mnemonique: "PLAY",
    libelle: "Playbooks 1-clic",
    categorie: "action",
    motsCles: [
      "playbook",
      "play",
      "scenario",
      "preset",
      "scalp",
      "funding",
      "fomc",
      "risk",
      "options",
    ],
    apercu: "PLAY-SCALP · PLAY-FADE · PLAY-CVD · PLAY-FOMC · PLAY-RISK · PLAY-OPT · PLAY-LIQ",
    // Entrée générique : applique le playbook phare (scalp) — les autres via PLAY-*.
    action: () => playbookParId("scalp-btc")?.apply(),
  },
  ...PLAYBOOKS.map(
    (p): Commande => ({
      id: `playbook:${p.id}`,
      mnemonique: p.mnemonique,
      libelle: `Playbook — ${p.nom}`,
      categorie: "action",
      motsCles: ["playbook", "play", p.id, p.nom, p.mnemonique],
      apercu: p.description,
      action: () => p.apply(),
    }),
  ),
];

