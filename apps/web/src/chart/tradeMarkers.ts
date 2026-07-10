/**
 * Marqueurs TRADES & NOTES sur le chart — épingle les évènements du portefeuille et les
 * notes ancrées à leur timestamp/prix, pour relire ses trades dans leur contexte de prix.
 *
 * POURQUOI ce module (et pas un simple panneau) : une entrée/sortie de position ou une
 * note prend tout son sens POSÉE sur la bougie où elle a eu lieu. On dessine donc des
 * overlays informatifs :
 *   - ENTRÉE : triangle ▲ (long) / ▼ (short) au prix d'ouverture, couleur --up/--down ;
 *   - CLÔTURE : triangle inverse au prix de sortie + étiquette du PnL réalisé (formatUsd),
 *     colorée selon le signe du PnL (gain vert / perte rouge) ;
 *   - NOTE ancrée : pastille + court aperçu du texte au prix capturé.
 *
 * MODÈLE : calqué sur `chart/ecoMarkers.ts` (même overlay custom `registerOverlay`,
 * même contrôleur SINGLETON qui rejoue les overlays via `getActiveChart()`, même
 * cycle de vie « efface par nom puis recrée »). Deux différences ASSUMÉES :
 *   1. les marqueurs sont SCOPÉS AU SYMBOLE AFFICHÉ (clé « exchange:symbole », comme
 *      `chart/drawing.ts` scope ses dessins) — un trade BTC ne s'affiche pas sur un ETH ;
 *   2. l'ancrage est en PRIX (coordinate.y de la bougie), pas une ligne pleine hauteur.
 *
 * Comme ecoMarkers : v1 = slot FOCUS uniquement (`getActiveChart`) + symbole du store
 * marché GLOBAL (slot maître). En grille multi-chart, si le focus est un slot secondaire
 * montrant un autre actif, les marqueurs suivent le symbole du slot maître — limitation
 * v1 acceptée (le cas mono-graphe, très majoritaire, est correct).
 *
 * PERF : aucun redraw sur tick. Les couleurs de thème sont lues AU MOMENT DU DESSIN
 * (redraw, via lib/canvasTokens) puis portées par `extendData` — un changement de thème
 * (abonnement themeStore) redéclenche un redraw pour repeindre aux nouvelles couleurs.
 *
 * La SÉLECTION/PROJECTION des évènements et le FORMATAGE des étiquettes sont des fonctions
 * PURES exportées et testées (tradeMarkers.test.ts) ; le couplage KLineChart reste dans le
 * contrôleur non testé (comme ecoMarkers / fibonacci).
 */
import { registerOverlay } from "klinecharts";
import type { OverlayCreate, OverlayFigure } from "klinecharts";
import type { ExchangeId } from "@axiom/types";
// Import de TYPE seul (élidé au runtime) : la palette est câblée par l'intégrateur.
import type { Commande } from "../commands/registry";
import { createStore } from "zustand/vanilla";
import { getActiveChart } from "./drawing";
import { marketStore } from "../store/market";
import { portfolioStore, pnlRealisePosition, type Position } from "../store/portfolio";
import { notesStore, type Note } from "../store/notes";
import { themeStore } from "../store/theme";
import { formatUsd } from "../lib/format";
import { lireTokenCanvas } from "../lib/canvasTokens";

/** Nom de l'overlay custom + groupe (permet un removeOverlay ciblé, cf. ecoMarkers). */
const TRADE_MARKER = "tradeMarker";
const TRADE_GROUP = "axiomTrade";

/** Cap défensif : au-delà, on ne garde que les marqueurs LES PLUS RÉCENTS. */
const MAX_MARQUEURS = 200;

/** Nature d'un marqueur (choisit la figure dessinée). */
export type TypeMarqueur = "entree" | "cloture" | "note";

/** Couleur SÉMANTIQUE d'un marqueur (résolue en token de thème au dessin). */
export type CouleurMarqueur = "up" | "down" | "note";

/** Périmètre d'affichage = l'actif AFFICHÉ sur le chart (source + symbole). */
export interface PerimetreSymbole {
  exchange: ExchangeId;
  symbole: string;
}

/** Un marqueur projeté (donnée pure, indépendante de KLineChart). */
export interface Marqueur {
  /** Clé stable (préfixe par nature + id de l'évènement source). */
  cle: string;
  type: TypeMarqueur;
  /** Horodatage de l'évènement (ms epoch) — ancre en X. */
  timestamp: number;
  /** Prix de l'évènement (> 0, fini) — ancre en Y. */
  prix: number;
  /** Orientation du triangle (entrée/clôture) ; absent pour une note. */
  fleche?: "haut" | "bas";
  couleur: CouleurMarqueur;
  /** Étiquette affichée (PnL pour une clôture, aperçu pour une note, "" pour une entrée). */
  label: string;
}

// ─────────────────────────── Fonctions PURES (testées) ───────────────────────────

/** Un prix est PLAÇABLE s'il est un nombre fini strictement positif (type guard). */
function prixValide(p: number | null | undefined): p is number {
  return p !== null && p !== undefined && Number.isFinite(p) && p > 0;
}

/** Un évènement est dans le périmètre s'il partage l'EXCHANGE et le SYMBOLE affichés. */
function dansLePerimetre(source: ExchangeId, symbole: string, p: PerimetreSymbole): boolean {
  return source === p.exchange && symbole.toUpperCase() === p.symbole.toUpperCase();
}

/**
 * Étiquette d'un PnL réalisé : montant USD compact avec « + » explicite sur les gains
 * (formatUsd rend déjà le « − » des pertes). PURE.
 */
export function etiquettePnl(net: number): string {
  const s = formatUsd(net);
  return net > 0 ? `+${s}` : s;
}

/**
 * Aperçu court d'une note pour la pastille : espaces/retours à la ligne aplatis,
 * tronqué à `n` caractères (… si coupé). PURE.
 */
export function apercuNote(texte: string, n = 24): string {
  const plat = texte.replace(/\s+/g, " ").trim();
  return plat.length > n ? `${plat.slice(0, n - 1)}…` : plat;
}

/**
 * Projette positions + notes en marqueurs typés pour le SYMBOLE affiché :
 *   - chaque position dans le périmètre → 1 marqueur d'entrée (+ 1 de clôture si close) ;
 *   - chaque note dans le périmètre ET ancrée à un prix → 1 marqueur note.
 * Les évènements sans ancrage prix valide sont ignorés (non plaçables en Y). Le résultat
 * est trié ANTICHRONO et borné aux `max` plus récents (encombrement). PURE.
 */
export function projeterMarqueurs(
  positions: Position[],
  notes: Note[],
  perimetre: PerimetreSymbole,
  max = MAX_MARQUEURS,
): Marqueur[] {
  const marqueurs: Marqueur[] = [];

  for (const p of positions) {
    if (!dansLePerimetre(p.source, p.symbole, perimetre)) continue;
    const long = p.direction === "long";

    if (prixValide(p.prixEntree)) {
      marqueurs.push({
        cle: `e:${p.id}`,
        type: "entree",
        timestamp: p.dateEntree,
        prix: p.prixEntree,
        fleche: long ? "haut" : "bas",
        couleur: long ? "up" : "down",
        label: "",
      });
    }

    if (p.statut === "clos" && p.dateSortie !== undefined && prixValide(p.prixSortie)) {
      const pnl = pnlRealisePosition(p);
      const net = pnl ? pnl.net : 0;
      marqueurs.push({
        cle: `x:${p.id}`,
        type: "cloture",
        timestamp: p.dateSortie,
        prix: p.prixSortie, // narrowé par prixValide
        // Sortie d'un long = vente (flèche bas) ; sortie d'un short = achat (flèche haut).
        fleche: long ? "bas" : "haut",
        // Couleur = SIGNE du PnL (gain/perte), pas le sens de la position.
        couleur: net >= 0 ? "up" : "down",
        label: etiquettePnl(net),
      });
    }
  }

  for (const n of notes) {
    if (!dansLePerimetre(n.source, n.symbole, perimetre)) continue;
    if (!prixValide(n.prix)) continue; // note sans ancrage prix : non plaçable sur le chart
    marqueurs.push({
      cle: `n:${n.id}`,
      type: "note",
      timestamp: n.timestamp,
      prix: n.prix, // narrowé par prixValide
      couleur: "note",
      label: apercuNote(n.texte),
    });
  }

  return marqueurs.sort((a, b) => b.timestamp - a.timestamp).slice(0, max);
}

/**
 * Surface MINIMALE d'une instance de chart pour le retrait des marqueurs (structurel :
 * l'instance KLineChart la satisfait). Isolée pour tester la logique de nettoyage
 * multi-instances sans dépendre de klinecharts.
 */
export interface CibleMarqueurs {
  removeOverlay(filtre: { id: string }): void;
}

/**
 * Retire les marqueurs de TOUTES les instances suivies (chacune par ses ids) puis vide le
 * registre. Une instance DÉTRUITE (dispose) peut faire lever `removeOverlay` : on isole
 * chaque instance (try/catch) pour qu'une instance morte n'empêche pas de nettoyer les
 * autres. PURE (n'accède à aucun état de module) → testable avec un chart factice.
 */
export function retirerMarqueursSuivis<C extends CibleMarqueurs>(suivis: Map<C, string[]>): void {
  for (const [chart, ids] of suivis) {
    for (const id of ids) {
      try {
        chart.removeOverlay({ id });
      } catch {
        break; // instance détruite : inutile d'insister sur ses autres ids.
      }
    }
  }
  suivis.clear();
}

// ─────────────────────────── Bascule (store vanilla local) ───────────────────────────

export interface TradeMarksState {
  /** Marqueurs trades & notes affichés sur le chart ? */
  actif: boolean;
  /** Bascule l'affichage. */
  basculer: () => void;
}

/** État on/off local au module — VANILLA, éphémère (NON persisté), cf. derivatives-chart. */
export const tradeMarksStore = createStore<TradeMarksState>((set, get) => ({
  actif: false,
  basculer: () => set({ actif: !get().actif }),
}));

// ─────────────────────────── Rendu KLineChart (non testé) ───────────────────────────

/** Données portées par chaque overlay (lues dans createPointFigures). */
interface DonneesMarqueur {
  type: TypeMarqueur;
  fleche?: "haut" | "bas";
  /** Couleur déjà RÉSOLUE (hex/rgb du thème courant, lue au redraw). */
  couleur: string;
  label: string;
}

/** Demi-taille du triangle (px) et léger décalage pour ne pas recouvrir la bougie. */
const T = 5;
const DECALAGE = 2;

/** Figures d'un triangle directionnel (entrée/clôture) + étiquette optionnelle à droite. */
function figuresFleche(x: number, y: number, d: DonneesMarqueur): OverlayFigure[] {
  // "haut" : apex vers le haut, corps SOUS le prix ; "bas" : apex vers le bas, corps AU-DESSUS.
  const apex = d.fleche === "bas" ? y - DECALAGE : y + DECALAGE;
  const base = d.fleche === "bas" ? apex - 2 * T : apex + 2 * T;
  const figures: OverlayFigure[] = [
    {
      type: "polygon",
      ignoreEvent: true,
      attrs: {
        coordinates: [
          { x, y: apex },
          { x: x - T, y: base },
          { x: x + T, y: base },
        ],
      },
      styles: { style: "fill", color: d.couleur },
    },
  ];
  if (d.label !== "") {
    figures.push({
      type: "text",
      ignoreEvent: true,
      attrs: { x: x + T + 4, y, text: d.label, align: "left", baseline: "middle" },
      styles: { color: d.couleur, size: 10 },
    });
  }
  return figures;
}

/** Figures d'une note : pastille pleine + court aperçu du texte à droite. */
function figuresNote(x: number, y: number, d: DonneesMarqueur): OverlayFigure[] {
  return [
    {
      type: "circle",
      ignoreEvent: true,
      attrs: { x, y, r: 4 },
      styles: { style: "fill", color: d.couleur },
    },
    {
      type: "text",
      ignoreEvent: true,
      attrs: { x: x + 8, y, text: d.label, align: "left", baseline: "middle" },
      styles: { color: d.couleur, size: 10 },
    },
  ];
}

let overlayRegistered = false;

/** Enregistre l'overlay custom « tradeMarker » (idempotent, effet global klinecharts). */
function ensureOverlayRegistered(): void {
  if (overlayRegistered) return;
  overlayRegistered = true;
  registerOverlay({
    name: TRADE_MARKER,
    totalStep: 1, // un seul point (timestamp/prix), toujours créé avec points fournis
    lock: true, // informatif : ne répond à aucun évènement souris
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }) => {
      const c = coordinates[0];
      if (c === undefined) return [];
      const d = overlay.extendData as DonneesMarqueur | undefined;
      if (d === undefined) return [];
      return d.type === "note" ? figuresNote(c.x, c.y, d) : figuresFleche(c.x, c.y, d);
    },
  });
}

// ─────────────────────────── Contrôleur singleton ───────────────────────────

/**
 * Instances de chart portant ACTUELLEMENT des marqueurs, avec les ids posés sur chacune.
 * En grille multi-chart, le focus peut changer entre deux dessins : on doit retirer les
 * overlays sur TOUTES ces instances (pas seulement le focus courant), sinon des marqueurs
 * résiduels restent sur les slots non-focus. Vidée par `retirerMarqueursSuivis`, qui tolère
 * les instances détruites (dispose).
 */
const overlaysSuivis = new Map<CibleMarqueurs, string[]>();

/**
 * (Re)pose les marqueurs. Efface d'abord les anciens sur TOUTES les instances suivies (le
 * focus a pu changer depuis le dernier tracé), puis recrée sur l'instance FOCUS si la
 * bascule est active ET que l'axe temps est prêt (bougies présentes). Les couleurs de thème
 * sont résolues ICI (au moment du dessin) puis portées par extendData.
 */
function redraw(): void {
  // Retire les marqueurs sur toutes les instances qui en portaient (focus courant ou non).
  retirerMarqueursSuivis(overlaysSuivis);

  if (!tradeMarksStore.getState().actif) return;
  const chart = getActiveChart();
  if (chart === null) return;
  const { symbol, exchange, candles } = marketStore.getState();
  if (candles.length === 0) return; // axe temps pas encore prêt

  // Palette du thème courant (repli = valeurs du thème sombre par défaut).
  const palette: Record<CouleurMarqueur, string> = {
    up: lireTokenCanvas("--up", "#34d399"),
    down: lireTokenCanvas("--down", "#f87171"),
    note: lireTokenCanvas("--accent", "#38bdf8"),
  };

  const marqueurs = projeterMarqueurs(
    portfolioStore.getState().positions,
    notesStore.getState().notes,
    { exchange, symbole: symbol },
  );

  const idsPoses: string[] = [];
  for (const m of marqueurs) {
    const extend: DonneesMarqueur = {
      type: m.type,
      fleche: m.fleche,
      couleur: palette[m.couleur],
      label: m.label,
    };
    const overlay: OverlayCreate = {
      name: TRADE_MARKER,
      groupId: TRADE_GROUP,
      lock: true,
      points: [{ timestamp: m.timestamp, value: m.prix }],
      extendData: extend,
    };
    const id = chart.createOverlay(overlay);
    if (typeof id === "string") idsPoses.push(id);
  }
  // Mémorise l'instance et ses ids : ils seront retirés au prochain redraw même si le
  // focus a changé entre-temps (cf. retirerMarqueursSuivis).
  if (idsPoses.length > 0) overlaysSuivis.set(chart, idsPoses);
}

let controllerStarted = false;

/**
 * Démarre le contrôleur (idempotent). Enregistre l'overlay et pose les abonnements de
 * REJEU. Appelé à l'import de ce module (l'intégrateur importe `commandes` → effet de bord) :
 * les abonnements vivent toute la session, inertes tant que la bascule est OFF (early-return
 * dans redraw). Aucun redraw sur tick : on ne redessine que quand le CONTEXTE change.
 */
export function demarrerTradeMarkers(): void {
  if (controllerStarted) return;
  controllerStarted = true;
  ensureOverlayRegistered();

  // Rejeu au changement d'INSTANCE (focus), de SYMBOLE/SOURCE affichés, ou dès que
  // l'axe temps devient prêt. marketStore émet aussi sur tick : on filtre pour ne
  // redessiner QUE si l'un de ces éléments a changé (pas sur le contenu des bougies).
  let prevChart = getActiveChart();
  let prevSymbol = marketStore.getState().symbol;
  let prevExchange = marketStore.getState().exchange;
  let prevReady = marketStore.getState().candles.length > 0;
  marketStore.subscribe(() => {
    const chart = getActiveChart();
    const { symbol, exchange, candles } = marketStore.getState();
    const ready = candles.length > 0;
    if (chart !== prevChart || symbol !== prevSymbol || exchange !== prevExchange || ready !== prevReady) {
      prevChart = chart;
      prevSymbol = symbol;
      prevExchange = exchange;
      prevReady = ready;
      redraw();
    }
  });

  // Rejeu au changement des positions (ajout / clôture / suppression).
  let prevPositions = portfolioStore.getState().positions;
  portfolioStore.subscribe((s) => {
    if (s.positions !== prevPositions) {
      prevPositions = s.positions;
      redraw();
    }
  });

  // Rejeu au changement des notes (création / édition / suppression).
  let prevNotes = notesStore.getState().notes;
  notesStore.subscribe((s) => {
    if (s.notes !== prevNotes) {
      prevNotes = s.notes;
      redraw();
    }
  });

  // Rejeu à la bascule d'affichage.
  let prevActif = tradeMarksStore.getState().actif;
  tradeMarksStore.subscribe((s) => {
    if (s.actif !== prevActif) {
      prevActif = s.actif;
      redraw();
    }
  });

  // Rejeu au changement de THÈME : les couleurs sont résolues au dessin (lireTokenCanvas),
  // il faut redessiner pour repeindre les marqueurs aux couleurs du nouveau thème.
  let prevTheme = themeStore.getState().theme;
  themeStore.subscribe((s) => {
    if (s.theme !== prevTheme) {
      prevTheme = s.theme;
      redraw();
    }
  });
}

// ─────────────────────────── Commande de palette (enregistrée par l'intégrateur) ───────────────────────────

/** Commande à greffer dans la palette (via `enregistrerCommandes`), cf. derivatives-chart. */
export const commandes: Commande[] = [
  {
    id: "action:marks",
    mnemonique: "MARKS",
    libelle: "Trades & notes (chart) — activer / désactiver",
    categorie: "action",
    motsCles: ["marks", "trades", "notes", "portefeuille", "positions", "pnl", "annotations", "chart"],
    apercu: "Épingle les entrées/sorties et notes ancrées sur le graphe",
    action: () => tradeMarksStore.getState().basculer(),
  },
];

// Auto-démarrage à l'import (l'intégrateur importe `commandes` → déclenche cet effet).
demarrerTradeMarkers();
