/**
 * Fenêtre « CORR » — matrice de corrélation (FloatingWindow du registre, toggle par le
 * mnémonique CORR ou la palette ; le graphe reste interactif pendant l'analyse).
 *
 * Contenu :
 *  - univers segmenté Watchlist | Top 10 | Top 20 | Top 30 (top N par capitalisation du
 *    top 250 CoinGecko déjà chargé — mcapStore, repli fetchMarketOverview en cache 5 min ;
 *    stablecoins exclus, conversion ticker→paire via toBinanceUsdtPair) + références
 *    tradfi préréglées (toggles individuels, elles s'AJOUTENT à l'univers) + ajout ponctuel ;
 *  - matrice N×N (canvas), dégradé down→up entre -1 et +1, valeur au survol, cellules à
 *    n < 20 rendements ATTÉNUÉES, tri Watchlist / Alphabétique / Similarité (ordonnancement
 *    glouton — VUE pure sur la matrice calculée, aucun refetch) ;
 *  - onglet « Paires » : TableTriable de toutes les paires hors diagonale (r, n, fiabilité),
 *    raccourcis 10 plus / 10 moins corrélées ;
 *  - clic sur une cellule = mini-détail : corrélation glissante en sparkline (canvas),
 *    fenêtre glissante = les rendements communs de la fenêtre sélectionnée (le
 *    dernier point coïncide avec la valeur de la cellule) ;
 *  - bascule Pearson / Spearman, fenêtre 7/30/90/180 j, bouton « recalculer » (re-fetch
 *    forcé), indication de fraîcheur, chips d'erreur par symbole en échec de chargement.
 *
 * Données : klines 1d des adaptateurs existants (aucune source nouvelle), en CACHE session
 * (réouvrir ≠ refetch ; changer méthode/fenêtre/tri/onglet ne refetch pas ; changer
 * d'univers ne refetch QUE les symboles nouveaux — quota Twelve Data ménagé).
 * Le point du jour UTC courant est EXCLU des calculs (bougie partielle, crypto comme tradfi).
 * Réglages (méthode, fenêtre, extras, références, univers, tri, onglet) dans le store
 * PERSISTÉ store/corrUi.ts — la fermeture démonte le composant, un useState les perdait.
 * L'état de session (sélection, survol, saisie, tri de la table) reste en React ; seul le
 * dessin passe par le canvas.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { Commande } from "../commands/registry";
import { watchlistStore } from "../store/watchlist";
import { corrUiStore } from "../store/corrUi";
import { mcapStore } from "../store/mcap";
import { QUOTE_ASSETS } from "../data/symbol";
import { fetchMarketOverview, type CoinTile } from "../data/marketOverview";
import { fetchPairs } from "../data/pairs";
import {
  alignerSeries,
  calculerMatrice,
  chargerSeries,
  correlationGlissante,
  exclureJourCourant,
  FENETRES_CORR,
  filtrerPairesExtremes,
  listerPaires,
  logRendements,
  ordonnerMatrice,
  pointsFiables,
  REFERENCES_CORR,
  SEUIL_POINTS_FIABLES,
  symbolesEnEchec,
  topPairesUnivers,
  TRIS_CORR,
  UNIVERS_CORR,
  viderCacheSeries,
  type MatriceCorr,
  type OngletCorr,
  type PaireCorr,
  type SerieCloture,
} from "../data/corr";
import { formatDec } from "../lib/format";
import { lireTokenCanvas, POLICE_CANVAS, POLICE_CANVAS_MONO } from "../lib/canvasTokens";
import { Badge, BadgeFiabilite, Bouton, BoutonBascule, BoutonRafraichir, Chargement, Chip, EnTeteFenetre, ErreurBloc, Fraicheur, Input, NoteSource, Onglets, Segmente, SegmenteCompact, Vide } from "./ui";
import { TableTriable, trierLignes, type ColonneTable, type TriTable } from "./TableTriable";

/**
 * Commandes exposées à la palette (l'intégrateur les enregistre via `enregistrerCommandes`).
 * Le toggle pilote le store vanilla → appelable palette / raccourci indifféremment.
 */
export const commandes: Commande[] = [
  {
    id: "panneau:corr",
    mnemonique: "CORR",
    libelle: "Corrélations",
    categorie: "panneau",
    motsCles: ["correlation", "corr", "pearson", "spearman", "matrice", "diversification", "hedge"],
    apercu: "Ouvre / ferme la matrice de corrélation",
    action: () => corrUiStore.getState().toggleCorr(),
  },
];

// ─────────────────────────── Helpers couleur / libellé (purs) ───────────────────────────

/** Convertit un hex (#rgb ou #rrggbb) en triplet RGB, ou null si non hex. */
function hexRgb(hex: string): [number, number, number] | null {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Interpole linéairement deux couleurs RGB (t ∈ [0,1]). */
function melanger(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

/** Chaîne CSS d'un triplet RGB. */
function rgbCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r},${g},${b})`;
}

/** Luminance perçue approx. (0 sombre → 1 clair) pour choisir un texte contrasté. */
function luminance([r, g, b]: [number, number, number]): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Couleur d'une cellule : neutre à 0, dégradé vers `up` (positif) ou `down` (négatif).
 * Cellule sans valeur → couleur de bordure (creux « pas de donnée »).
 */
function couleurCellule(
  v: number | null,
  neutre: [number, number, number],
  up: [number, number, number],
  down: [number, number, number],
  vide: [number, number, number]
): [number, number, number] {
  if (v === null || !Number.isFinite(v)) return vide;
  const t = Math.max(-1, Math.min(1, v));
  return t >= 0 ? melanger(neutre, up, t) : melanger(neutre, down, -t);
}

/** Base d'un symbole (retire la cotation) pour l'étiquette compacte de la matrice. */
function courtSymbole(s: string): string {
  if (s.includes("/")) return s; // forex EUR/USD conservé
  for (const q of QUOTE_ASSETS) {
    if (s.endsWith(q) && s.length > q.length) return s.slice(0, -q.length);
  }
  return s;
}

// ─────────────────────────── Géométrie de la matrice ───────────────────────────

const GUTTER_L = 54; // marge gauche pour les étiquettes de lignes
const GUTTER_T = 18; // marge haute pour les étiquettes de colonnes

/** Taille de cellule adaptée au nombre de symboles (matrice plus dense = cellules plus petites). */
function tailleCellule(n: number): number {
  if (n <= 5) return 46;
  if (n <= 8) return 38;
  if (n <= 12) return 30;
  return 24;
}

// ─────────────────────────── Onglet « Paires » (déclaratif) ───────────────────────────

/** Onglets de la fenêtre (matrice canvas / liste des paires). */
const ONGLETS_CORR: readonly { id: OngletCorr; label: string }[] = [
  { id: "matrice", label: "Matrice" },
  { id: "paires", label: "Paires" },
];

/** Colonnes de la table des paires (module : aucune dépendance à l'état du composant). */
const COLONNES_PAIRES: readonly ColonneTable<PaireCorr>[] = [
  {
    id: "paire",
    label: "Paire",
    largeur: "2fr",
    triable: true,
    valeurTri: (l) => `${l.a} × ${l.b}`,
    rendu: (l) => (
      <span title={`${l.a} × ${l.b}`}>
        {courtSymbole(l.a)} × {courtSymbole(l.b)}
      </span>
    ),
  },
  {
    id: "r",
    label: "r",
    align: "right",
    triable: true,
    valeurTri: (l) => l.valeur,
    rendu: (l) => (
      <span className={l.valeur === null ? "text-text-dim" : l.valeur >= 0 ? "text-up" : "text-down"}>
        {formatDec(l.valeur)}
      </span>
    ),
  },
  {
    id: "n",
    label: "n",
    align: "right",
    triable: true,
    valeurTri: (l) => l.points,
    rendu: (l) => <>{l.points}</>,
  },
  {
    id: "fiab",
    label: "Fiab.",
    align: "right",
    rendu: (l) =>
      pointsFiables(l.points) ? (
        <BadgeFiabilite
          niveau="fiable"
          label="fiable"
          title={`${l.points} rendements communs (seuil de fiabilité : ${SEUIL_POINTS_FIABLES})`}
        />
      ) : (
        <BadgeFiabilite
          niveau="partiel"
          label="faible"
          title={`${l.points} rendements communs — sous le seuil de ${SEUIL_POINTS_FIABLES}, corrélation bruitée`}
        />
      ),
  },
];

/** Référence stable du catalogue vide (un `[]` littéral par rendu invaliderait les memos). */
const CATALOGUE_VIDE: CoinTile[] = [];

/** Univers top-N en attente du catalogue des paires Binance : référence STABLE. */
const CATALOGUE_PAIRES_EN_COURS: string[] = [];

// ─────────────────────────── Composant ───────────────────────────

export function CorrWindow() {
  const open = useStore(corrUiStore, (s) => s.open);
  const watchSymbols = useStore(watchlistStore, (s) => s.symbols);

  // Réglages persistés (store corrUi — survivent à la fermeture/réouverture).
  const methode = useStore(corrUiStore, (s) => s.methode);
  const fenetreJours = useStore(corrUiStore, (s) => s.fenetreJours);
  const extras = useStore(corrUiStore, (s) => s.extras);
  const referencesActives = useStore(corrUiStore, (s) => s.referencesActives);
  const univers = useStore(corrUiStore, (s) => s.univers);
  const tri = useStore(corrUiStore, (s) => s.tri);
  const onglet = useStore(corrUiStore, (s) => s.onglet);

  const [saisie, setSaisie] = useState("");
  const [nonce, setNonce] = useState(0); // bump = recalcul forcé (re-fetch)
  const [matrice, setMatrice] = useState<MatriceCorr | null>(null);
  const [echecs, setEchecs] = useState<string[]>([]); // symboles en échec de chargement
  const [loading, setLoading] = useState(false);
  const [majTs, setMajTs] = useState<number | null>(null);
  const [selection, setSelection] = useState<{ r: number; c: number } | null>(null);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    titre: string;
    lignes: { label: string; valeur: string }[];
  } | null>(null);

  // État de session de l'onglet « Paires » (tri de table + raccourcis — non persisté).
  const [triTable, setTriTable] = useState<TriTable | null>({ colonne: "r", dir: -1 });
  const [filtrePaires, setFiltrePaires] = useState<"plus" | "moins" | null>(null);

  // Catalogue top 250 pour l'univers top-N : mcapStore s'il est déjà peuplé (lecture
  // seule), sinon repli fetchMarketOverview — cache 5 min partagé, budget CoinGecko
  // existant (aucun appel dans la fenêtre de fraîcheur).
  const marches = useStore(mcapStore, (s) => s.marches);
  const [catalogueRepli, setCatalogueRepli] = useState<CoinTile[] | null>(null);
  const [catalogueErreur, setCatalogueErreur] = useState(false);
  const topN = UNIVERS_CORR.find((u) => u.id === univers)?.topN ?? null;
  const catalogue = marches.length > 0 ? marches : catalogueRepli ?? CATALOGUE_VIDE;

  useEffect(() => {
    if (!open || topN === null || marches.length > 0 || catalogueRepli !== null) return;
    let ignore = false;
    void fetchMarketOverview()
      .then((o) => {
        if (ignore) return;
        // Un 200 au format inattendu (ou un cache stale vide) donne coins: [] — le
        // traiter comme un succès figerait le spinner pour toujours (revue Lot 3) :
        // c'est une ERREUR, sans poser le repli (le re-fetch reste possible).
        if (o.coins.length === 0) {
          setCatalogueErreur(true);
          return;
        }
        setCatalogueRepli(o.coins);
        setCatalogueErreur(false);
      })
      .catch(() => {
        if (!ignore) setCatalogueErreur(true);
      });
    return () => {
      ignore = true;
    };
  }, [open, topN, marches, catalogueRepli]);

  // Catalogue des paires Binance réelles (fetchPairs, mémoïsé par data/pairs — même
  // patron que MAP/SECT) : l'univers top-N n'est composé QU'AVEC des paires listées,
  // en itérant au-delà du rang N pour remplacer les tickers sans paire (LEO, HYPE,
  // XMR délisté… — sans ce filtre, ~7 lignes mortes sur 20 mesurées en revue).
  // `undefined` = résolution en cours (l'univers top-N attend) ; `null` = échec du
  // fetch (best-effort : composition SANS filtre, les paires mortes remontent en chips).
  const [pairesBinance, setPairesBinance] = useState<ReadonlySet<string> | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!open || topN === null || pairesBinance !== undefined) return;
    let ignore = false;
    void fetchPairs("binance")
      .then((liste) => {
        // Une liste VIDE est forcément anormale (réponse au mauvais format) :
        // filtrer avec viderait tout l'univers — repli « sans filtre » comme un échec.
        if (!ignore) setPairesBinance(liste.length > 0 ? new Set(liste) : null);
      })
      .catch(() => {
        if (!ignore) setPairesBinance(null);
      });
    return () => {
      ignore = true;
    };
  }, [open, topN, pairesBinance]);

  // Séries chargées (pour la sparkline glissante) — hors state React (pas de re-render).
  const seriesRef = useRef<Map<string, SerieCloture[]>>(new Map());
  const matrixCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sparkCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Base de l'univers : watchlist (groupe actif) ou top N par capitalisation (stablecoins
  // et emballés exclus, paires filtrées contre le catalogue Binance réel — tant que ce
  // catalogue se résout (`undefined`), l'univers top-N reste vide (spinner).
  const basePaires = useMemo(() => {
    if (topN === null) return watchSymbols;
    if (pairesBinance === undefined) return CATALOGUE_PAIRES_EN_COURS;
    return topPairesUnivers(catalogue, topN, pairesBinance);
  }, [topN, watchSymbols, catalogue, pairesBinance]);

  // Symboles = univers + références tradfi actives + ajouts ponctuels, normalisés et
  // dédoublonnés (les références forment un bloc contigu dans la matrice). STABILISÉS
  // par signature de contenu : un rafraîchissement de mcapStore (ouverture de CAP,
  // TTL, backfill) produit un NOUVEAU tableau `marches` à contenu identique — sans
  // cette stabilisation, l'effet de chargement re-tournait et effaçait la sélection
  // et la sparkline sans qu'aucune donnée n'ait changé (revue Lot 3).
  const symbolsSignature = useMemo(() => {
    const all = [...basePaires, ...referencesActives, ...extras]
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
    return [...new Set(all)].join("|");
  }, [basePaires, referencesActives, extras]);
  const symbols = useMemo(
    () => (symbolsSignature.length === 0 ? [] : symbolsSignature.split("|")),
    [symbolsSignature],
  );

  // Chargement + calcul de la matrice (déclenché à l'ouverture et sur changement de
  // symboles / méthode / fenêtre / recalcul). Changer la fenêtre ou la méthode NE refetch
  // PAS (cache session) ; seul « recalculer » (nonce) vide le cache au préalable.
  useEffect(() => {
    if (!open) return;
    let ignore = false;
    if (symbols.length < 2) {
      setMatrice(null);
      setSelection(null);
      setEchecs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      const brutes = await chargerSeries(symbols);
      if (ignore) return;
      // Bougie du jour partielle (crypto comme tradfi) : le point du jour UTC courant
      // est écarté AVANT tout calcul (matrice ET sparkline via seriesRef).
      const seriesMap = new Map<string, SerieCloture[]>();
      for (const [s, serie] of brutes) seriesMap.set(s, exclureJourCourant(serie, Date.now()));
      seriesRef.current = seriesMap;
      setEchecs(symbolesEnEchec(brutes, symbols)); // sur les séries BRUTES : vide = échec de chargement
      setMatrice(calculerMatrice(seriesMap, symbols, methode, fenetreJours));
      setSelection(null);
      setMajTs(Date.now());
      setLoading(false);
    })();
    return () => {
      ignore = true;
    };
  }, [open, symbols, methode, fenetreJours, nonce]);

  // VUE réordonnée de la matrice selon le tri choisi — pur, aucun refetch ni recalcul
  // de corrélation (changer le tri ne touche pas l'effet de chargement ci-dessus).
  const matriceAffichee = useMemo(
    () => (matrice === null ? null : ordonnerMatrice(matrice, tri)),
    [matrice, tri]
  );

  // Changer le tri permute les indices : la sélection/le survol pointeraient une autre
  // cellule — on les efface.
  useEffect(() => {
    setSelection(null);
    setHover(null);
    setTooltip(null);
  }, [tri]);

  // Onglet « Paires » : liste dédupliquée (triangle supérieur de la matrice BASE — l'ordre
  // d'affichage de la matrice n'a pas à faire bouger la table), filtrée puis triée.
  const paires = useMemo(() => (matrice === null ? [] : listerPaires(matrice)), [matrice]);
  const pairesVisibles = useMemo(() => {
    const filtrees = filtrePaires === null ? paires : filtrerPairesExtremes(paires, filtrePaires);
    return trierLignes(filtrees, COLONNES_PAIRES, triTable);
  }, [paires, filtrePaires, triTable]);

  // Dessin de la matrice (canvas) — redessine sur nouvelle matrice / tri / survol /
  // sélection, et au RETOUR sur l'onglet matrice (le canvas est remonté à ce moment-là).
  useEffect(() => {
    if (onglet !== "matrice") return;
    const canvas = matrixCanvasRef.current;
    const matrice = matriceAffichee;
    if (canvas === null || matrice === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    const n = matrice.symbols.length;
    const cell = tailleCellule(n);
    const W = GUTTER_L + n * cell + 4;
    const H = GUTTER_T + n * cell + 4;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const up = hexRgb(lireTokenCanvas("--up", "#2dc08e")) ?? [45, 192, 142];
    const down = hexRgb(lireTokenCanvas("--down", "#f92855")) ?? [249, 40, 85];
    const neutre = hexRgb(lireTokenCanvas("--surface", "#171717")) ?? [23, 23, 23];
    const vide = hexRgb(lireTokenCanvas("--border", "#262626")) ?? [38, 38, 38];
    const dim = lireTokenCanvas("--text-dim", "#9ca3af");
    const texte = lireTokenCanvas("--text", "#e5e7eb");

    // Étiquettes de colonnes (base des symboles, en haut).
    ctx.font = POLICE_CANVAS;
    ctx.fillStyle = dim;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (let c = 0; c < n; c++) {
      const label = courtSymbole(matrice.symbols[c] ?? "");
      ctx.fillText(label, GUTTER_L + c * cell + cell / 2, GUTTER_T - 6, cell);
    }
    // Étiquettes de lignes (à gauche).
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let r = 0; r < n; r++) {
      const label = courtSymbole(matrice.symbols[r] ?? "");
      ctx.fillText(label, GUTTER_L - 6, GUTTER_T + r * cell + cell / 2, GUTTER_L - 8);
    }

    // Cellules.
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cel = matrice.cellules[r]?.[c];
        const v = cel?.valeur ?? null;
        const rgb = couleurCellule(v, neutre, up, down, vide);
        const x = GUTTER_L + c * cell;
        const y = GUTTER_T + r * cell;
        // Fiabilité : une cellule calculée sur trop peu de rendements communs (croisement
        // crypto×tradfi à fenêtre courte) est ATTÉNUÉE — cf. note de légende sous la matrice.
        const attenuee = v !== null && Number.isFinite(v) && !pointsFiables(cel?.points ?? 0);
        if (attenuee) ctx.globalAlpha = 0.35;
        ctx.fillStyle = rgbCss(rgb);
        ctx.fillRect(x, y, cell - 1, cell - 1);

        // Valeur au centre quand la cellule est assez grande et la valeur définie.
        if (cell >= 34 && v !== null && Number.isFinite(v)) {
          // Texte contrasté sur le fond CALCULÉ de la cellule : noir/blanc quasi purs,
          // volontairement hors thème (le contraste suit la luminance de la cellule, pas
          // le thème — dériver de --text inverserait le contraste en thème clair).
          ctx.fillStyle = luminance(rgb) > 0.55 ? "#0b0b0b" : "#f5f5f5";
          ctx.font = POLICE_CANVAS_MONO;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(v.toFixed(2), x + (cell - 1) / 2, y + (cell - 1) / 2);
        }
        if (attenuee) ctx.globalAlpha = 1;
      }
    }

    // Surbrillance : survol (contour clair) puis sélection (contour accentué) par-dessus.
    const cadre = (r: number, c: number, couleur: string, w: number) => {
      ctx.strokeStyle = couleur;
      ctx.lineWidth = w;
      ctx.strokeRect(GUTTER_L + c * cell + 0.5, GUTTER_T + r * cell + 0.5, cell - 2, cell - 2);
    };
    if (hover) cadre(hover.r, hover.c, texte, 1);
    if (selection) cadre(selection.r, selection.c, lireTokenCanvas("--accent", texte), 2);
  }, [matriceAffichee, hover, selection, onglet]);

  // Dessin de la sparkline de corrélation glissante pour la cellule sélectionnée.
  // Fenêtre glissante en RENDEMENTS COMMUNS = ceux que la cellule a réellement
  // utilisés (son champ `points`) : la matrice fenêtre en JOURS calendaires, et
  // sur un croisement tradfi 90 j ≈ 62 rendements communs — passer fenetreJours
  // brut décalait le dernier point de la sparkline par rapport à la cellule et
  // la vidait à 180 j (revue v2.6, trouvailles no 5/10). Ainsi le dernier point
  // de la sparkline EST la corrélation de la cellule sélectionnée.
  useEffect(() => {
    if (onglet !== "matrice") return;
    const canvas = sparkCanvasRef.current;
    const matrice = matriceAffichee; // la sélection pointe des indices de la vue AFFICHÉE
    if (canvas === null || selection === null || matrice === null) return;
    const { r, c } = selection;
    const sr = matrice.symbols[r];
    const sc = matrice.symbols[c];
    if (sr === undefined || sc === undefined) return;
    const A = seriesRef.current.get(sr) ?? [];
    const B = seriesRef.current.get(sc) ?? [];
    const { a, b } = alignerSeries(A, B);
    const cellule = matrice.cellules[r]?.[c];
    const fenetreRendements = Math.max(2, Math.min(cellule?.points ?? fenetreJours, fenetreJours));
    const serie = correlationGlissante(methode, logRendements(a), logRendements(b), fenetreRendements);

    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    const W = 260;
    const Hp = 60;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(Hp * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${Hp}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, Hp);

    const dim = lireTokenCanvas("--text-dim", "#9ca3af");
    const accent = lireTokenCanvas("--accent", lireTokenCanvas("--text", "#38bdf8"));
    const pad = 6;
    const mid = Hp / 2;
    const half = mid - pad;
    // Repère : ligne 0 et bornes ±1.
    ctx.strokeStyle = dim;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(W, mid);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (serie.length >= 2) {
      const step = W / (serie.length - 1);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      let dessine = false;
      serie.forEach((v, i) => {
        if (v === null || !Number.isFinite(v)) {
          dessine = false; // trou : on interrompt le tracé
          return;
        }
        const x = i * step;
        const y = mid - Math.max(-1, Math.min(1, v)) * half;
        if (dessine) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        dessine = true;
      });
      ctx.stroke();
    } else {
      // État vide HONNÊTE : jamais de canvas muet (revue v2.6, trouvaille no 10).
      ctx.fillStyle = dim;
      ctx.font = POLICE_CANVAS;
      ctx.textAlign = "center";
      ctx.fillText("historique insuffisant pour la fenêtre glissante", W / 2, mid - 4);
      ctx.textAlign = "start";
    }
  }, [selection, methode, fenetreJours, matriceAffichee, onglet]);

  // Interactions de la matrice (survol → tooltip ; clic → sélection pour le mini-détail).
  const n = matriceAffichee?.symbols.length ?? 0;
  const cell = tailleCellule(n);

  const cellDepuisEvenement = (clientX: number, clientY: number, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const cx = Math.floor((clientX - rect.left - GUTTER_L) / cell);
    const cy = Math.floor((clientY - rect.top - GUTTER_T) / cell);
    if (clientX - rect.left < GUTTER_L || clientY - rect.top < GUTTER_T) return null;
    if (cx < 0 || cx >= n || cy < 0 || cy >= n) return null;
    return { r: cy, c: cx, localX: clientX - rect.left, localY: clientY - rect.top };
  };

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (matriceAffichee === null) return;
    const hit = cellDepuisEvenement(e.clientX, e.clientY, e.currentTarget);
    if (hit === null) {
      setHover(null);
      setTooltip(null);
      return;
    }
    setHover({ r: hit.r, c: hit.c });
    const cel = matriceAffichee.cellules[hit.r]?.[hit.c];
    const sr = matriceAffichee.symbols[hit.r];
    const sc = matriceAffichee.symbols[hit.c];
    // localX est relatif au CANVAS (plus large que le conteneur en Top 20/30) ; le
    // tooltip est positionné dans l'ancêtre `relative` — soustraire le défilement
    // horizontal du wrapper, sinon le tooltip dérive de scrollLeft (revue Lot 3).
    const scrollX = e.currentTarget.parentElement?.scrollLeft ?? 0;
    setTooltip({
      x: hit.localX - scrollX,
      y: hit.localY,
      titre: `${sr} × ${sc}`,
      lignes: [
        { label: "r", valeur: formatDec(cel?.valeur) },
        { label: "n", valeur: `${cel?.points ?? 0} rendements` },
      ],
    });
  };

  const onLeave = () => {
    setHover(null);
    setTooltip(null);
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (matriceAffichee === null) return;
    const hit = cellDepuisEvenement(e.clientX, e.clientY, e.currentTarget);
    if (hit === null || hit.r === hit.c) {
      setSelection(null); // diagonale (auto-corrélation = 1) → pas de mini-détail
      return;
    }
    setSelection({ r: hit.r, c: hit.c });
  };

  const recalculer = () => {
    viderCacheSeries(); // re-fetch forcé (le simple ré-affichage reste sur cache)
    setNonce((k) => k + 1);
  };

  const ajouterSymbole = (e: React.FormEvent) => {
    e.preventDefault();
    const v = saisie.trim().toUpperCase();
    setSaisie("");
    if (v.length === 0 || symbols.includes(v)) return;
    corrUiStore.getState().ajouterExtra(v);
  };

  const selCellule = selection ? matriceAffichee?.cellules[selection.r]?.[selection.c] : undefined;
  const selLabel =
    selection && matriceAffichee
      ? `${matriceAffichee.symbols[selection.r] ?? ""} × ${matriceAffichee.symbols[selection.c] ?? ""}`
      : "";

  return (
    <>
      {/* En-tête standard ; croix de fermeture fournie par le chrome FloatingWindow. */}
      <EnTeteFenetre
        mnemo="CORR"
        titre="Corrélations"
        sousTitre={`Log-rendements journaliers · ${methode === "pearson" ? "Pearson" : "Spearman"} · ${fenetreJours} j`}
        actions={
          <>
            <Fraicheur loading={loading} majTs={majTs} />
            <BoutonRafraichir onClick={recalculer} libelle="Recalculer" />
          </>
        }
      />

      {/* Onglets Matrice / Paires (persistés — deux VUES de la même matrice calculée). */}
      <Onglets
        options={ONGLETS_CORR.map((o) => ({ id: o.id, label: o.label }))}
        actif={onglet}
        onChange={(o) => corrUiStore.getState().setOnglet(o)}
      />

      <div className="px-4 py-3">
        {/* Contrôles : méthode, fenêtre (réglages persistés — store corrUi). */}
        <div className="mb-3 flex items-center gap-2">
          <Segmente
            options={[
              { id: "pearson", label: "Pearson" },
              { id: "spearman", label: "Spearman" },
            ] as const}
            actif={methode}
            onChange={(m) => corrUiStore.getState().setMethode(m)}
          />
          <Segmente
            options={FENETRES_CORR.map((f) => ({ id: f, label: `${f}j` }))}
            actif={fenetreJours}
            onChange={(f) => corrUiStore.getState().setFenetre(f)}
          />
        </div>

        {/* Univers de la matrice (watchlist / top N CoinGecko) et tri d'affichage. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SegmenteCompact
            ariaLabel="Univers de la matrice"
            options={UNIVERS_CORR.map((u) => ({ id: u.id, label: u.label }))}
            actif={univers}
            onChange={(u) => corrUiStore.getState().setUnivers(u)}
          />
          <SegmenteCompact
            ariaLabel="Tri de la matrice"
            options={TRIS_CORR.map((t) => ({
              id: t.id,
              // Le tri identité suit l'ORDRE D'ENTRÉE de la matrice : la watchlist en
              // univers Watchlist, la capitalisation décroissante en univers Top-N —
              // le libellé suit, sinon il ment (revue Lot 3).
              label: t.id === "watchlist" && topN !== null ? "Cap." : t.label,
            }))}
            actif={tri}
            onChange={(t) => corrUiStore.getState().setTri(t)}
          />
        </div>

        {/* Références tradfi préréglées : toggles individuels, les actives rejoignent
            l'univers de la matrice (routage curé → twelvedata, 1 crédit par recalcul). */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Références tradfi">
          {REFERENCES_CORR.map((ref) => (
            <BoutonBascule
              key={ref.symbole}
              actif={referencesActives.includes(ref.symbole)}
              onClick={() => corrUiStore.getState().basculerReference(ref.symbole)}
              title={`${ref.libelle} — croiser avec la matrice`}
            >
              {ref.libelle}
            </BoutonBascule>
          ))}
        </div>

        {/* Ajout ponctuel de symboles (hors watchlist). */}
        <form onSubmit={ajouterSymbole} className="mb-3 flex gap-2">
          <Input
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder="Ajouter un symbole (ex. AVAXUSDT, SPY)"
            className="min-w-0 flex-1"
          />
          <Bouton type="submit">+</Bouton>
        </form>
        {extras.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {extras.map((s) => (
              <Chip key={s} onRetirer={() => corrUiStore.getState().retirerExtra(s)} retirerLabel={`Retirer ${s}`}>
                {s}
              </Chip>
            ))}
          </div>
        )}

        {/* Chips d'erreur : chaque série en échec est signalée (plus de cellules vides
            silencieuses — un quota Twelve Data épuisé est la cause la plus probable). */}
        {echecs.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {echecs.map((s) => (
              <Badge key={s} ton="warn" title={`Série ${s} indisponible : cellules vides dans la matrice`}>
                {s} — série indisponible (paire non listée, source en panne ou quota)
              </Badge>
            ))}
          </div>
        )}

        {/* Matrice, table des paires ou message d'état. */}
        {topN !== null && (catalogue.length === 0 || pairesBinance === undefined) ? (
          catalogueErreur ? (
            <ErreurBloc>
              Catalogue CoinGecko indisponible — l'univers Top {topN} ne peut pas être construit.
              Repassez sur Watchlist ou réessayez plus tard.
            </ErreurBloc>
          ) : (
            <Chargement libelle="Catalogues (CoinGecko · paires Binance)…" />
          )
        ) : symbols.length < 2 ? (
          <Vide>Au moins deux symboles sont nécessaires. Ajoutez-en à la watchlist ou via le champ ci-dessus.</Vide>
        ) : matrice === null ? (
          <Chargement libelle="Calcul…" />
        ) : onglet === "paires" ? (
          <div>
            {/* Raccourcis : filtres exclusifs sur la table (re-clic = toutes les paires). */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <BoutonBascule
                actif={filtrePaires === "plus"}
                onClick={() => setFiltrePaires(filtrePaires === "plus" ? null : "plus")}
                title="Les 10 paires à la corrélation la plus haute"
              >
                10 plus corrélées
              </BoutonBascule>
              <BoutonBascule
                actif={filtrePaires === "moins"}
                onClick={() => setFiltrePaires(filtrePaires === "moins" ? null : "moins")}
                title="Les 10 paires à la corrélation la plus basse"
              >
                10 moins corrélées
              </BoutonBascule>
            </div>
            <TableTriable
              colonnes={COLONNES_PAIRES}
              lignes={pairesVisibles}
              tri={triTable}
              onTri={setTriTable}
              cle={(l) => `${l.a}×${l.b}`}
              vide="Aucune paire à afficher."
              maxHauteur="340px"
            />
          </div>
        ) : (
          <div className="relative">
            <div className="overflow-x-auto">
              <canvas
                ref={matrixCanvasRef}
                onMouseMove={onMove}
                onMouseLeave={onLeave}
                onClick={onClick}
                className="cursor-pointer"
              />
            </div>
            {/* Tooltip maison (grille dense ≠ courbe : InfobulleGraphe inadapté) mais au
                STYLE de l'infobulle partagée — mêmes classes de panneau, titre estompé. */}
            {tooltip && (
              <div
                className="pointer-events-none absolute z-10 whitespace-nowrap rounded border border-border bg-surface px-2 py-1 text-[11px] tabular-nums text-text shadow-lg"
                style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
              >
                <div className="text-text-dim">{tooltip.titre}</div>
                {tooltip.lignes.map((l) => (
                  <div key={l.label}>
                    {l.label} : {l.valeur}
                  </div>
                ))}
              </div>
            )}
            <p className="mt-1 text-[10px] leading-snug text-text-dim">
              Cellules atténuées : n &lt; {SEUIL_POINTS_FIABLES} rendements communs (fiabilité limitée —
              l'alignement sur les jours de bourse écarte les week-ends).
            </p>
          </div>
        )}

        {/* Mini-détail : corrélation glissante (fenêtre sélectionnée) de la cellule choisie. */}
        {onglet === "matrice" && selection && matriceAffichee && (
          <section className="mt-3 rounded-md border border-border bg-bg">
            <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
              <span className="text-[11px] font-medium text-text">{selLabel}</span>
              <span className="text-[11px] tabular-nums text-text-dim">
                r={formatDec(selCellule?.valeur)} · n={selCellule?.points ?? 0}
              </span>
            </div>
            <div className="px-3 py-2">
              <canvas ref={sparkCanvasRef} className="w-full" />
              <p className="mt-1 text-[10px] leading-snug text-text-dim">
                Corrélation glissante — fenêtre {fenetreJours} j, exprimée en rendements
                communs de la paire (le dernier point est la valeur de la cellule).
              </p>
            </div>
          </section>
        )}

        <div className="mt-3">
          <NoteSource>
            Corrélations sur log-rendements journaliers, alignés sur les jours calendaires UTC communs
            (crypto 7j/7 vs bourse 5j/7) ; clôtures NON synchrones (bourse ~20-21h UTC vs crypto 00:00 UTC) ;
            jour en cours exclu (bougie partielle). Proxys assumés : UUP = dollar (DXY), GLD = or.
            Klines réutilisées des sources existantes, en cache de session.
          </NoteSource>
        </div>
      </div>
    </>
  );
}
