/**
 * Gestionnaire de fenêtres flottantes AXIOM (« Launchpad ») — Zustand VANILLA, hors
 * render-loop React. Source de vérité UNIQUE de la géométrie/état (position, taille,
 * z-order, minimize, groupe de couleur) des fenêtres Bloomberg non modales du registre.
 *
 * Chaque fenêtre garde son propre store métier (`*UiStore`, ex. `derivativesUiStore`)
 * pour sa logique interne ; ces stores DÉLÈGUENT `open`/`close`/`toggle` ici via
 * `mirrorOpenState` (cf. store correspondant) pour rester 100% rétro-compatibles avec
 * leurs consommateurs existants (`useStore(derivativesUiStore, s => s.open)` continue
 * de fonctionner sans aucune modification des composants).
 *
 * Design des fonctions géométriques : PURES et exportées séparément des actions du
 * store, pour rester testables sans DOM (cf. windowManager.test.ts). Les actions du
 * store (qui lisent `window.innerWidth/innerHeight`) les appellent avec les dimensions
 * réelles du viewport — même pattern que `isMarketOpen` (pur) + call site qui injecte
 * `Date.now()`.
 */
import { createStore } from "zustand/vanilla";
import { COMPARE_PALETTE } from "./compare";

/** Palette des groupes liés — réutilise la palette de comparaison multi-symboles
 * existante (déjà choisie pour être lisible sur les 5 thèmes du terminal). */
export const GROUP_PALETTE: readonly string[] = COMPARE_PALETTE;

/** Définition d'une fenêtre du registre. Le libellé du menu Fonctions vaut `title`
 *  sauf si `menuLabel` est fourni ; `menuHidden` exclut la fenêtre du menu (ex.
 *  `derivatives` possède son bouton DES dédié dans la Toolbar). `nouveau` marque une
 *  fenêtre récente : badge « nouveau » dans le menu Fonctions jusqu'à sa 1ère ouverture. */
export interface DefinitionFenetre {
  readonly id: string;
  readonly title: string;
  readonly mnemonic: string;
  readonly defaultWidth: number;
  readonly defaultHeight: number;
  readonly menuLabel?: string;
  readonly menuHidden?: boolean;
  readonly nouveau?: boolean;
}

/** Registre statique des fenêtres Bloomberg — SOURCE UNIQUE : titre/mnémonique/
 * taille par défaut + appartenance au menu Fonctions. Utilisé par `App.tsx` (montage,
 * dont la map de composants est typée par `WindowId`), `Taskbar.tsx` (libellé
 * des pastilles), `openWindow` (taille initiale), la Toolbar (menu Fonctions dérivé via
 * `menuWindows`) et `persist`. Ajouter une fenêtre = 1 entrée ici + 1 composant dans
 * `WINDOW_COMPONENTS` (App.tsx, sinon erreur de compilation) ; menu + montage en découlent. */
export const WINDOW_REGISTRY = [
  { id: "derivatives", title: "Produits dérivés", mnemonic: "DES", defaultWidth: 420, defaultHeight: 640, menuHidden: true },
  { id: "fundingMatrix", title: "Funding cross-exchange", mnemonic: "FUNDX", defaultWidth: 460, defaultHeight: 420 },
  { id: "liquidations", title: "Liquidations", mnemonic: "LIQ", defaultWidth: 460, defaultHeight: 520, nouveau: true },
  { id: "eco", title: "Calendrier économique", mnemonic: "ECO", defaultWidth: 440, defaultHeight: 640 },
  { id: "news", title: "Actualités crypto", mnemonic: "NEWS", defaultWidth: 440, defaultHeight: 640 },
  { id: "corr", title: "Corrélations", mnemonic: "CORR", defaultWidth: 480, defaultHeight: 640 },
  { id: "onchain", title: "On-chain", mnemonic: "CHAIN", defaultWidth: 460, defaultHeight: 640 },
  { id: "marketMap", title: "Vue marché (treemap)", mnemonic: "MAP", defaultWidth: 1100, defaultHeight: 720 },
  { id: "portfolio", title: "Portefeuille", mnemonic: "PORT", defaultWidth: 460, defaultHeight: 640 },
  { id: "notes", title: "Notes / journal", mnemonic: "NOTE", defaultWidth: 440, defaultHeight: 640 },
  { id: "screener", title: "Screener d'actifs", mnemonic: "EQS", defaultWidth: 680, defaultHeight: 680 },
  { id: "termStructure", title: "Structure par terme", mnemonic: "TERM", defaultWidth: 480, defaultHeight: 640 },
  { id: "options", title: "Options (smile IV, max pain)", mnemonic: "OMON", defaultWidth: 480, defaultHeight: 640 },
  { id: "dom", title: "Carnet d'ordres (DOM / depth)", mnemonic: "DOM", defaultWidth: 560, defaultHeight: 680 },
  { id: "backtest", title: "Backtest de stratégie", mnemonic: "BT", defaultWidth: 720, defaultHeight: 680 },
  { id: "replay", title: "Replay de marché", mnemonic: "REPLAY", defaultWidth: 420, defaultHeight: 640 },
  { id: "macroRates", title: "Taux & Réserves souveraines", mnemonic: "RATE", defaultWidth: 560, defaultHeight: 680 },
  { id: "cot", title: "Rapport COT (CFTC)", mnemonic: "COT", defaultWidth: 520, defaultHeight: 680 },
  { id: "seasonality", title: "Saisonnalité", mnemonic: "SEAG", defaultWidth: 760, defaultHeight: 560 },
  { id: "vol", title: "Volatilité (cône RV, VRP)", mnemonic: "VOL", defaultWidth: 760, defaultHeight: 560 },
  { id: "fund", title: "Fiche société (FUND)", mnemonic: "FUND", defaultWidth: 480, defaultHeight: 640 },
  { id: "brief", title: "Point marché", mnemonic: "BRIEF", defaultWidth: 480, defaultHeight: 720, menuLabel: "Point marché (snapshot)" },
  { id: "globe", title: "Globe (chokepoints & trafic aérien)", mnemonic: "GLOBE", defaultWidth: 720, defaultHeight: 720, menuLabel: "Globe (géopolitique, chokepoints & trafic aérien)", nouveau: true },
  { id: "stablecoins", title: "Stablecoins (supply, dominance, pegs)", mnemonic: "STBL", defaultWidth: 860, defaultHeight: 640, nouveau: true },
  { id: "squeeze", title: "Radar squeeze", mnemonic: "SQZ", defaultWidth: 640, defaultHeight: 560, nouveau: true },
  { id: "cbprem", title: "Coinbase premium", mnemonic: "CBPREM", defaultWidth: 640, defaultHeight: 560, nouveau: true },
  { id: "netliq", title: "Liquidité nette Fed", mnemonic: "NETLIQ", defaultWidth: 640, defaultHeight: 560, nouveau: true },
  { id: "data", title: "Sources de données", mnemonic: "DATA", defaultWidth: 640, defaultHeight: 560, nouveau: true },
  { id: "dist", title: "Distribution des rendements (VaR)", mnemonic: "DIST", defaultWidth: 560, defaultHeight: 480, nouveau: true },
  { id: "expy", title: "Journal de trades", mnemonic: "EXPY", defaultWidth: 680, defaultHeight: 700, nouveau: true },
  { id: "paper", title: "Paper trading", mnemonic: "PAPER", defaultWidth: 720, defaultHeight: 640, nouveau: true },
] as const satisfies readonly DefinitionFenetre[];

/** Union des ids de fenêtre — DÉRIVÉE du registre (source unique). Sert à typer la
 *  map des composants dans App.tsx : un id sans composant devient une erreur de type. */
export type WindowId = (typeof WINDOW_REGISTRY)[number]["id"];

/** Fenêtres exposées dans le menu « Fonctions » (registre moins les `menuHidden`),
 *  avec le libellé d'affichage résolu (`menuLabel ?? title`) et le drapeau `nouveau`
 *  (badge de découvrabilité). PURE (sans DOM) : la Toolbar y greffe l'action
 *  d'ouverture. Testée dans windowManager.test.ts. */
export function menuWindows(): { id: WindowId; mnemonique: string; libelle: string; nouveau: boolean }[] {
  return (WINDOW_REGISTRY as readonly DefinitionFenetre[])
    .filter((w) => !w.menuHidden)
    .map((w) => ({
      id: w.id as WindowId,
      mnemonique: w.mnemonic,
      libelle: w.menuLabel ?? w.title,
      nouveau: w.nouveau ?? false,
    }));
}

/** Préfixe localStorage marquant qu'une fenêtre « nouveau » a déjà été ouverte (badge). */
const SEEN_PREFIX = "axiom:seen:";

/** Marque une fenêtre comme VUE (best-effort) : son badge « nouveau » disparaît ensuite.
 *  Même pattern localStorage tolérant que le reste du repo (mode privé / Node : no-op). */
export function marquerVue(id: string): void {
  try {
    localStorage.setItem(SEEN_PREFIX + id, "1");
  } catch {
    /* localStorage indisponible : best-effort */
  }
}

/** true si la fenêtre n'a jamais été ouverte (aucun flag « vu » en localStorage). En cas
 *  d'indisponibilité du stockage, renvoie false (pas de badge parasite permanent). */
export function estNouvelle(id: string): boolean {
  try {
    return localStorage.getItem(SEEN_PREFIX + id) === null;
  } catch {
    return false;
  }
}

/** Espace minimal toujours visible d'une fenêtre (pixels), pour le drag comme le resize. */
export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 240;

/** Bande réservée aux fenêtres flottantes. Les overlays globaux/modal backdrops
 * commencent à `z-40` (Toolbar, réglages, palette…) : une fenêtre ne doit donc
 * JAMAIS atteindre cette strate, même après une très longue session. */
export const WINDOW_Z_MIN = 1;
export const WINDOW_Z_MAX = 39;

export interface EtatFenetre {
  id: string;
  open: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  minimized: boolean;
  groupColor: string | null;
  /** Géométrie d'avant le dernier snap Aero appliqué (gauche/droite/haut) — permet de
   * restaurer en glissant l'en-tête depuis l'état maximisé/ancré, comme Windows/macOS.
   * `null` si la fenêtre n'est pas actuellement dans un état issu d'un snap. */
  preSnapGeometry: { x: number; y: number; width: number; height: number } | null;
}

/** Nombre de niveaux distincts disponibles sous la première strate modale (`z-40`). */
const WINDOW_Z_CAPACITY = WINDOW_Z_MAX - WINDOW_Z_MIN + 1;

/** Valeur de tri tolérante pour un ancien état persisté : on conserve son ordre
 * relatif même si son z est négatif ou très supérieur à la bande actuelle. */
function valeurZPourTri(z: number): number {
  return Number.isFinite(z) ? z : WINDOW_Z_MIN - 1;
}

/** Compacte tous les z dans la bande réservée, sans changer l'ordre relatif des
 * fenêtres. Les égalités sont stables selon l'ordre d'insertion du record — utile
 * pour les anciens états persistés qui pouvaient contenir des doublons.
 *
 * Si un futur registre dépassait la capacité de la bande, seules les fenêtres les
 * plus basses partageraient `WINDOW_Z_MIN`; le sommet reste distinct et borné. */
export function normaliserOrdreZ(
  windows: Record<string, EtatFenetre>
): { windows: Record<string, EtatFenetre>; nextZ: number } {
  const tries = Object.entries(windows)
    .map(([id, fenetre], index) => ({ id, fenetre, index }))
    .sort(
      (a, b) =>
        valeurZPourTri(a.fenetre.z) - valeurZPourTri(b.fenetre.z) || a.index - b.index
    );
  const debordement = Math.max(0, tries.length - WINDOW_Z_CAPACITY);
  const normalises: Record<string, EtatFenetre> = {};
  for (let rang = 0; rang < tries.length; rang += 1) {
    const entree = tries[rang];
    if (!entree) continue;
    const z = WINDOW_Z_MIN + Math.max(0, rang - debordement);
    normalises[entree.id] = { ...entree.fenetre, z };
  }
  const zSommet =
    tries.length === 0
      ? WINDOW_Z_MIN - 1
      : Math.min(WINDOW_Z_MAX, WINDOW_Z_MIN + tries.length - 1);
  return { windows: normalises, nextZ: Math.min(WINDOW_Z_MAX + 1, zSommet + 1) };
}

function maximumZ(windows: Record<string, EtatFenetre>): number {
  let maximum = WINDOW_Z_MIN - 1;
  for (const fenetre of Object.values(windows)) maximum = Math.max(maximum, fenetre.z);
  return maximum;
}

/** Détecte les états injectés/restaurés qui doivent passer par la migration douce
 * (hors bande, fractionnaires, non finis ou doublons ambigus). */
function ordreZDoitEtreNormalise(windows: Record<string, EtatFenetre>): boolean {
  const vus = new Set<number>();
  for (const fenetre of Object.values(windows)) {
    if (
      !Number.isInteger(fenetre.z) ||
      fenetre.z < WINDOW_Z_MIN ||
      fenetre.z > WINDOW_Z_MAX ||
      vus.has(fenetre.z)
    ) {
      return true;
    }
    vus.add(fenetre.z);
  }
  return false;
}

/** Rectangle de la zone de travail des fenêtres flottantes (le conteneur du graphe,
 * PAS window.innerWidth/innerHeight) — exclut toolbar/barre de dessin/panneau latéral.
 * Mesuré par App.tsx via ResizeObserver, injecté dans toutes les fonctions ci-dessous
 * (elles restent pures, testables sans DOM). */
export interface WorkspaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Position en cascade pour l'ouverture initiale d'une fenêtre (évite l'empilement
 * exact au même endroit). `index` = nombre de fenêtres déjà ouvertes. */
export function cascadePosition(
  index: number,
  workspace: WorkspaceRect,
  width: number,
  height: number
): { x: number; y: number } {
  const STEP = 28;
  const MARGIN = 48;
  const rawX = workspace.x + MARGIN + (index % 8) * STEP;
  const rawY = workspace.y + MARGIN + (index % 8) * STEP;
  const x = Math.min(rawX, Math.max(workspace.x + MARGIN, workspace.x + workspace.width - width - MARGIN));
  const y = Math.min(rawY, Math.max(workspace.y + MARGIN, workspace.y + workspace.height - height - MARGIN));
  return { x, y };
}

/** Grille de mosaïque pour disposer `n` fenêtres dans un rectangle sans recouvrement :
 * `cols = ceil(sqrt(n))`, `rows = ceil(n / cols)`, marge de 8px autour et ENTRE les
 * cellules. Renvoie `n` rectangles rangés ligne par ligne (la dernière ligne peut être
 * incomplète, ex. n=5 → 3 colonnes × 2 lignes, dernière ligne à 2). PURE (sans DOM),
 * testée dans windowManager.test.ts. */
export function grilleMosaique(
  n: number,
  viewport: WorkspaceRect
): { x: number; y: number; width: number; height: number }[] {
  if (n <= 0) return [];
  const MARGE = 8;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const largeurCellule = (viewport.width - MARGE * (cols + 1)) / cols;
  const hauteurCellule = (viewport.height - MARGE * (rows + 1)) / rows;
  // Plancher de taille : à fort n, une cellule peut passer sous les minima d'une
  // fenêtre. On borne la taille ÉMISE aux minima du store (le pas de la grille reste
  // sur la taille brute) → les fenêtres se chevauchent légèrement, comportement
  // cohérent avec le clamp du drag/resize.
  const largeurCase = Math.max(largeurCellule, MIN_WIDTH);
  const hauteurCase = Math.max(hauteurCellule, MIN_HEIGHT);
  const rects: { x: number; y: number; width: number; height: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    const col = i % cols;
    const ligne = Math.floor(i / cols);
    rects.push({
      x: viewport.x + MARGE + col * (largeurCellule + MARGE),
      y: viewport.y + MARGE + ligne * (hauteurCellule + MARGE),
      width: largeurCase,
      height: hauteurCase,
    });
  }
  return rects;
}

/** Confine une position au workspace — STRICTEMENT (la fenêtre entière, pas seulement
 * un bord, doit rester dans le rect). Suppose `width`/`height` déjà plafonnés via
 * `clampSize` contre le MÊME workspace (sinon le résultat peut légèrement déborder). */
export function clampPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  workspace: WorkspaceRect
): { x: number; y: number } {
  const clampedX = Math.min(Math.max(x, workspace.x), workspace.x + workspace.width - width);
  const clampedY = Math.min(Math.max(y, workspace.y), workspace.y + workspace.height - height);
  return { x: clampedX, y: clampedY };
}

/** Contraint une taille entre les minimums et les dimensions du workspace. */
export function clampSize(
  width: number,
  height: number,
  minWidth: number,
  minHeight: number,
  workspace: WorkspaceRect
): { width: number; height: number } {
  return {
    width: Math.min(Math.max(width, minWidth), workspace.width),
    height: Math.min(Math.max(height, minHeight), workspace.height),
  };
}

/** Zone de snap façon Aero — uniquement les bords (pas les coins/quarts dans ce lot). */
export type SnapZone = "left" | "right" | "top";

/** Distance au bord (px) déclenchant une zone de snap pendant un drag d'en-tête. */
const SNAP_EDGE_PX = 8;

/** Détecte la zone de snap active pour une position de curseur donnée, relative au
 * workspace (pas au viewport). `null` hors zone. Le bord haut est prioritaire (testé
 * en premier) : un curseur dans le coin haut-gauche déclenche "top", pas "left". Un
 * curseur au-delà du bord du workspace (ex. sur la barre de dessin ou le panneau
 * latéral) compte toujours dans la zone correspondante. */
export function detectSnapZone(
  cursorX: number,
  cursorY: number,
  workspace: WorkspaceRect
): SnapZone | null {
  if (cursorY < workspace.y + SNAP_EDGE_PX) return "top";
  if (cursorX < workspace.x + SNAP_EDGE_PX) return "left";
  if (cursorX > workspace.x + workspace.width - SNAP_EDGE_PX) return "right";
  return null;
}

/** Géométrie cible pour une zone de snap (moitié gauche/droite pleine hauteur, ou
 * workspace entier pour "top" — maximise DANS la zone de travail, jamais par-dessus
 * la toolbar/le panneau). */
export function snapGeometry(
  zone: SnapZone,
  workspace: WorkspaceRect
): { x: number; y: number; width: number; height: number } {
  if (zone === "left") {
    return { x: workspace.x, y: workspace.y, width: workspace.width / 2, height: workspace.height };
  }
  if (zone === "right") {
    return {
      x: workspace.x + workspace.width / 2,
      y: workspace.y,
      width: workspace.width / 2,
      height: workspace.height,
    };
  }
  return { x: workspace.x, y: workspace.y, width: workspace.width, height: workspace.height };
}

/** z de la fenêtre FOCALISÉE = z le plus haut parmi les fenêtres OUVERTES et NON
 *  réduites (une fenêtre réduite n'a jamais le focus). `null` si aucune n'est éligible
 *  (toutes réduites ou aucune ouverte). PURE (sans DOM), testée : sert à la taskbar pour
 *  marquer la pastille active et à `toggleFocusMinimize` pour son toggle. */
export function zFenetreFocalisee(windows: Record<string, EtatFenetre>): number | null {
  let max: number | null = null;
  for (const w of Object.values(windows)) {
    if (w.open && !w.minimized && (max === null || w.z > max)) max = w.z;
  }
  return max;
}

/** État visuel d'une pastille de la taskbar : « minimisee » (fenêtre réduite, atténuée),
 *  « focus » (fenêtre au premier plan = z égal à `zFocus`), sinon « normale ». PURE, testée. */
export function etatPastille(
  win: EtatFenetre,
  zFocus: number | null
): "focus" | "minimisee" | "normale" {
  if (win.minimized) return "minimisee";
  if (zFocus !== null && win.z === zFocus) return "focus";
  return "normale";
}

export interface WindowManagerState {
  windows: Record<string, EtatFenetre>;
  /** Prochain z disponible dans la bande des fenêtres. Peut valoir
   * `WINDOW_Z_MAX + 1` comme sentinelle : la prochaine promotion compacte alors
   * l'ordre avant d'allouer un nouveau sommet. */
  nextZ: number;
  /** Couleur de groupe -> dernier symbole diffusé aux fenêtres/composants de ce groupe. */
  groupSymbols: Record<string, string>;
  /** Aperçu de snap actif pendant un drag d'en-tête (géométrie cible de la zone
   * survolée) — état ÉPHÉMÈRE, jamais persisté (persist.ts construit explicitement
   * le sous-ensemble sauvegardé, ce champ n'y figure simplement pas). */
  dragPreview: { x: number; y: number; width: number; height: number } | null;
  /** Zone de travail actuelle (rect du conteneur du graphe, exclut toolbar/barre de
   * dessin/panneau latéral) — mesurée par App.tsx via ResizeObserver, jamais persistée
   * (recalculée à chaque montage). Référentiel de TOUT le placement/redimensionnement/
   * snap des fenêtres flottantes, à la place de window.innerWidth/innerHeight. */
  workspace: WorkspaceRect;

  openWindow: (id: string) => void;
  closeWindow: (id: string) => void;
  toggleWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, width: number, height: number) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  /** Clic sur une pastille de la taskbar (toggle standard type Windows/macOS) :
   *  fenêtre réduite → restaure au premier plan ; fenêtre focalisée (z le plus haut
   *  parmi les non-réduites) → réduit ; sinon → passe au premier plan. */
  toggleFocusMinimize: (id: string) => void;
  setGroup: (id: string, color: string | null) => void;
  setGroupSymbol: (color: string, symbol: string) => void;
  /** Applique une géométrie de snap Aero : sauvegarde la géométrie ACTUELLE dans
   * `preSnapGeometry` (pour restaurer plus tard en glissant l'en-tête), puis applique
   * la nouvelle géométrie. Remplace le couple moveWindow+resizeWindow pour un snap. */
  snapWindow: (id: string, geometrie: { x: number; y: number; width: number; height: number }) => void;
  setPreSnapGeometry: (id: string, preSnapGeometry: { x: number; y: number; width: number; height: number } | null) => void;
  setDragPreview: (preview: { x: number; y: number; width: number; height: number } | null) => void;
  /** Restauration depuis la persistance (déjà validée par l'appelant). */
  setAll: (windows: Record<string, EtatFenetre>) => void;
  /** Recale position/taille de toutes les fenêtres OUVERTES contre un nouveau workspace
   * (déclenché par un resize du navigateur, cf. App.tsx) — même clamp pur que le
   * drag/resize interactif, appliqué en lot. */
  reclampAll: (workspace: WorkspaceRect) => void;
  setWorkspace: (workspace: WorkspaceRect) => void;

  /** Réduit d'un coup toutes les fenêtres ouvertes et non déjà réduites. */
  minimizeAll: () => void;
  /** Restaure d'un coup toutes les fenêtres ouvertes et réduites. */
  restoreAll: () => void;
  /** Ferme d'un coup toutes les fenêtres ouvertes (géométrie conservée). */
  closeAll: () => void;
  /** Dispose les fenêtres ouvertes non réduites en mosaïque (cf. `grilleMosaique`),
   *  ordonnées par z ascendant, DANS le workspace du store (cadré sous la toolbar/le
   *  panneau, pas le viewport plein écran). Efface le preSnap des fenêtres retuilées. */
  tileOpenWindows: () => void;
  /** Réempile les fenêtres ouvertes non réduites en cascade (cf. `cascadePosition`),
   *  ordonnées par z ascendant, sans changer leur taille, DANS le workspace du store. */
  cascadeAll: () => void;
}

interface EtatOrdreZ {
  windows: Record<string, EtatFenetre>;
  nextZ: number;
}

/** Prépare un z libre pour une nouvelle fenêtre. Un compteur périmé (ancien état,
 * saturation de la bande ou injection directe en test) déclenche une compaction. */
function allouerNouveauZ(state: EtatOrdreZ): EtatOrdreZ & { z: number } {
  let windows = state.windows;
  let nextZ = state.nextZ;
  const max = ordreZDoitEtreNormalise(windows) ? Number.NaN : maximumZ(windows);
  if (
    !Number.isInteger(nextZ) ||
    !Number.isFinite(max) ||
    nextZ <= max ||
    nextZ > WINDOW_Z_MAX
  ) {
    ({ windows, nextZ } = normaliserOrdreZ(windows));
  }

  // Le registre courant tient largement dans la bande. Ce repli défensif garde
  // néanmoins un z rendu borné si un futur appelant crée plus de 39 ids dynamiques.
  const z = Math.min(nextZ, WINDOW_Z_MAX);
  return { windows, z, nextZ: Math.min(WINDOW_Z_MAX + 1, z + 1) };
}

/** Monte une fenêtre existante au sommet. Si elle y est déjà, renvoie exactement
 * les références/compteur reçus : aucun bump, aucun write Zustand/persistance.
 * Les anciens z hors bande sont d'abord normalisés en conservant leur ordre. */
function mettreAuSommet(state: EtatOrdreZ, id: string): EtatOrdreZ {
  let windows = state.windows;
  let nextZ = state.nextZ;

  if (ordreZDoitEtreNormalise(windows)) {
    ({ windows, nextZ } = normaliserOrdreZ(windows));
  }

  let existing = windows[id];
  if (!existing) return { windows, nextZ };
  let max = maximumZ(windows);
  if (existing.z === max) return { windows, nextZ };

  if (!Number.isInteger(nextZ) || nextZ <= max || nextZ > WINDOW_Z_MAX) {
    ({ windows, nextZ } = normaliserOrdreZ(windows));
    existing = windows[id];
    if (!existing) return { windows, nextZ };
    max = maximumZ(windows);
    if (existing.z === max) return { windows, nextZ };
  }

  // Bande saturée après compaction : place temporairement la cible au-dessus puis
  // recompacte l'ensemble. Aucun z rendu ne franchit WINDOW_Z_MAX.
  if (nextZ > WINDOW_Z_MAX) {
    return normaliserOrdreZ({
      ...windows,
      [id]: { ...existing, z: WINDOW_Z_MAX + 1 },
    });
  }

  return {
    windows: { ...windows, [id]: { ...existing, z: nextZ } },
    nextZ: nextZ + 1,
  };
}

export const windowManagerStore = createStore<WindowManagerState>((set, get) => ({
  windows: {},
  nextZ: 1,
  groupSymbols: {},
  dragPreview: null,
  workspace: { x: 0, y: 0, width: 1920, height: 1080 },

  openWindow: (id) => {
    // Marque la fenêtre comme vue : son badge « nouveau » (menu Fonctions) disparaît.
    marquerVue(id);
    const state = get();
    if (state.windows[id]) {
      const ordre = mettreAuSommet(state, id);
      const existing = ordre.windows[id];
      if (!existing) return;
      const size = clampSize(existing.width, existing.height, MIN_WIDTH, MIN_HEIGHT, state.workspace);
      const pos = clampPosition(existing.x, existing.y, size.width, size.height, state.workspace);
      const etatInchange =
        existing.open &&
        !existing.minimized &&
        existing.x === pos.x &&
        existing.y === pos.y &&
        existing.width === size.width &&
        existing.height === size.height;
      if (etatInchange && ordre.windows === state.windows && ordre.nextZ === state.nextZ) return;
      set({
        windows: etatInchange
          ? ordre.windows
          : { ...ordre.windows, [id]: { ...existing, ...pos, ...size, open: true, minimized: false } },
        nextZ: ordre.nextZ,
      });
      return;
    }
    const ordre = allouerNouveauZ(state);
    const entry = WINDOW_REGISTRY.find((w) => w.id === id);
    // Taille par défaut plafonnée au workspace : MAP (1100) ou STBL (860) débordaient
    // sur laptop (revue v2). Marge 24 px pour garder la poignée accessible.
    const width = Math.min(entry?.defaultWidth ?? 480, Math.max(MIN_WIDTH, state.workspace.width - 24));
    const height = Math.min(entry?.defaultHeight ?? 640, Math.max(MIN_HEIGHT, state.workspace.height - 24));
    const openCount = Object.values(state.windows).filter((w) => w.open).length;
    const { x, y } = cascadePosition(openCount, state.workspace, width, height);
    set({
      windows: {
        ...ordre.windows,
        [id]: {
          id,
          open: true,
          x,
          y,
          width,
          height,
          z: ordre.z,
          minimized: false,
          groupColor: null,
          preSnapGeometry: null,
        },
      },
      nextZ: ordre.nextZ,
    });
  },

  closeWindow: (id) => {
    const existing = get().windows[id];
    if (!existing) return;
    set({ windows: { ...get().windows, [id]: { ...existing, open: false } } });
  },

  toggleWindow: (id) => {
    const w = get().windows[id];
    // Une fenêtre minimisée se RESTAURE (⌘K la faisait disparaître — revue v2).
    if (w?.open && w.minimized) {
      get().restoreWindow(id);
      return;
    }
    if (w?.open) get().closeWindow(id);
    else get().openWindow(id);
  },

  focusWindow: (id) => {
    const state = get();
    if (!state.windows[id]) return;
    const ordre = mettreAuSommet(state, id);
    if (ordre.windows === state.windows && ordre.nextZ === state.nextZ) return;
    set(ordre);
  },

  moveWindow: (id, x, y) => {
    const existing = get().windows[id];
    if (!existing) return;
    set({ windows: { ...get().windows, [id]: { ...existing, x, y } } });
  },

  resizeWindow: (id, width, height) => {
    const existing = get().windows[id];
    if (!existing) return;
    set({ windows: { ...get().windows, [id]: { ...existing, width, height } } });
  },

  minimizeWindow: (id) => {
    const existing = get().windows[id];
    if (!existing) return;
    set({ windows: { ...get().windows, [id]: { ...existing, minimized: true } } });
  },

  restoreWindow: (id) => {
    const state = get();
    if (!state.windows[id]) return;
    const ordre = mettreAuSommet(state, id);
    const existing = ordre.windows[id];
    if (!existing) return;
    if (!existing.minimized && ordre.windows === state.windows && ordre.nextZ === state.nextZ) return;
    set({
      windows: existing.minimized
        ? { ...ordre.windows, [id]: { ...existing, minimized: false } }
        : ordre.windows,
      nextZ: ordre.nextZ,
    });
  },

  toggleFocusMinimize: (id) => {
    const state = get();
    const w = state.windows[id];
    if (!w || !w.open) return;
    if (w.minimized) {
      get().restoreWindow(id);
      return;
    }
    // Fenêtre au premier plan → on la réduit ; sinon on la remonte au sommet.
    if (w.z === zFenetreFocalisee(state.windows)) {
      get().minimizeWindow(id);
    } else {
      get().focusWindow(id);
    }
  },

  setGroup: (id, color) => {
    const existing = get().windows[id];
    if (!existing) return;
    set({ windows: { ...get().windows, [id]: { ...existing, groupColor: color } } });
  },

  setGroupSymbol: (color, symbol) => {
    set({ groupSymbols: { ...get().groupSymbols, [color]: symbol } });
  },

  snapWindow: (id, geometrie) => {
    const existing = get().windows[id];
    if (!existing) return;
    set({
      windows: {
        ...get().windows,
        [id]: {
          ...existing,
          ...geometrie,
          preSnapGeometry: { x: existing.x, y: existing.y, width: existing.width, height: existing.height },
        },
      },
    });
  },

  setPreSnapGeometry: (id, preSnapGeometry) => {
    const existing = get().windows[id];
    if (!existing) return;
    set({ windows: { ...get().windows, [id]: { ...existing, preSnapGeometry } } });
  },

  setDragPreview: (preview) => set({ dragPreview: preview }),

  setWorkspace: (workspace) => {
    set({ workspace });
    get().reclampAll(workspace);
  },

  setAll: (windows) => {
    // Migration douce des sauvegardes/workspaces historiques : leurs z monotones
    // peuvent être très supérieurs aux overlays actuels. On garde leur ordre relatif,
    // mais on les réinjecte immédiatement dans la bande sûre.
    set(normaliserOrdreZ(windows));
  },

  reclampAll: (workspace) => {
    const state = get();
    const next: Record<string, EtatFenetre> = {};
    let changed = false;
    for (const [id, w] of Object.entries(state.windows)) {
      if (!w.open) {
        next[id] = w;
        continue;
      }
      const size = clampSize(w.width, w.height, MIN_WIDTH, MIN_HEIGHT, workspace);
      const pos = clampPosition(w.x, w.y, size.width, size.height, workspace);
      if (pos.x !== w.x || pos.y !== w.y || size.width !== w.width || size.height !== w.height) {
        changed = true;
        next[id] = { ...w, ...pos, ...size };
      } else {
        next[id] = w;
      }
    }
    if (changed) set({ windows: next });
  },

  minimizeAll: () => {
    const windows = get().windows;
    const next: Record<string, EtatFenetre> = {};
    let changed = false;
    for (const [id, w] of Object.entries(windows)) {
      if (w.open && !w.minimized) {
        changed = true;
        next[id] = { ...w, minimized: true };
      } else {
        next[id] = w;
      }
    }
    if (changed) set({ windows: next });
  },

  restoreAll: () => {
    const windows = get().windows;
    const next: Record<string, EtatFenetre> = {};
    let changed = false;
    for (const [id, w] of Object.entries(windows)) {
      if (w.open && w.minimized) {
        changed = true;
        next[id] = { ...w, minimized: false };
      } else {
        next[id] = w;
      }
    }
    if (changed) set({ windows: next });
  },

  closeAll: () => {
    const windows = get().windows;
    const next: Record<string, EtatFenetre> = {};
    let changed = false;
    for (const [id, w] of Object.entries(windows)) {
      if (w.open) {
        changed = true;
        next[id] = { ...w, open: false };
      } else {
        next[id] = w;
      }
    }
    if (changed) set({ windows: next });
  },

  tileOpenWindows: () => {
    const { windows, workspace } = get();
    const ouvertes = Object.values(windows)
      .filter((w) => w.open && !w.minimized)
      .sort((a, b) => a.z - b.z);
    if (ouvertes.length === 0) return;
    const grille = grilleMosaique(ouvertes.length, workspace);
    const next = { ...windows };
    for (let i = 0; i < ouvertes.length; i += 1) {
      const fenetre = ouvertes[i];
      const cellule = grille[i];
      if (!fenetre || !cellule) continue;
      next[fenetre.id] = { ...fenetre, ...cellule, preSnapGeometry: null };
    }
    set({ windows: next });
  },

  cascadeAll: () => {
    const { windows, workspace } = get();
    const ouvertes = Object.values(windows)
      .filter((w) => w.open && !w.minimized)
      .sort((a, b) => a.z - b.z);
    if (ouvertes.length === 0) return;
    const next = { ...windows };
    for (let i = 0; i < ouvertes.length; i += 1) {
      const fenetre = ouvertes[i];
      if (!fenetre) continue;
      const { x, y } = cascadePosition(i, workspace, fenetre.width, fenetre.height);
      next[fenetre.id] = { ...fenetre, x, y, preSnapGeometry: null };
    }
    set({ windows: next });
  },
}));

/**
 * Synchronise le champ `open` d'un store `*UiStore` EXISTANT avec `windowManagerStore`
 * (source de vérité). À appeler une fois au chargement du module du store concerné.
 * Capte aussi bien les changements déclenchés par les commandes (`openEco()` etc.) que
 * ceux déclenchés par le chrome `<FloatingWindow>` (croix, minimize, restore).
 *
 * Sync IMMÉDIAT à l'enregistrement : indispensable pour le lazy-load des fenêtres
 * (le module store se charge APRÈS `openWindow`, sans nouvel évènement subscribe).
 */
export function mirrorOpenState(
  id: string,
  target: { getState: () => { open: boolean }; setState: (partial: { open: boolean }) => void }
): void {
  const sync = (isOpen: boolean): void => {
    if (isOpen !== target.getState().open) {
      target.setState({ open: isOpen });
    }
  };
  sync(windowManagerStore.getState().windows[id]?.open ?? false);
  windowManagerStore.subscribe((state) => {
    sync(state.windows[id]?.open ?? false);
  });
}
