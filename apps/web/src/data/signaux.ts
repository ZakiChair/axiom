/**
 * Signaux — détecteurs de SETUPS par symbole (logique PURE, testable hors navigateur).
 *
 * Vue « Signaux » d'EQS (spec 2026-07-23) : au lieu de filtres bruts, le run détecte
 * des lectures nommées — quadrant OI×prix (doc 02 B1), funding extrême par z-score
 * temporel (B2), divergence RSI/prix par pivots, positionnement top traders vs foule
 * (B6) — et les agrège en score de confluence par symbole.
 *
 * Règle d'or (doc 02) : chaque signal porte un label de FIABILITÉ ; les heuristiques
 * ne sont jamais présentées comme des données. Ce module ne fait AUCUN fetch : les
 * effets réseau vivent dans store/signaux.ts.
 */
import type { ScreenerRow } from "./screener";

// ─────────────────────────── Types ───────────────────────────

export type DirectionSignal = "haussier" | "baissier";

/** Qualité de la lecture, affichée telle quelle (jamais un modèle vendu comme un fait). */
export type FiabiliteSignal = "fiable" | "échantillonné" | "heuristique" | "bruité";

export interface SignalDetecte {
  id: "quadrant" | "funding" | "divergence-rsi" | "positionnement";
  direction: DirectionSignal;
  /** Libellé court (badge). */
  libelle: string;
  /** Lecture complète : valeurs + interprétation + limite de la donnée (tooltip). */
  detail: string;
  fiabilite: FiabiliteSignal;
  /** Poids dans le score de confluence. */
  poids: number;
}

/** Ligne de l'inbox de setups (uniquement les symboles à ≥ 1 signal). */
export interface LigneSignaux {
  symbol: string;
  lastPrice: number;
  priceChangePct24h: number;
  volumeUsd24h: number;
  signaux: SignalDetecte[];
  /** Σ poids de tous les signaux (intensité de confluence). */
  score: number;
  /** Direction agrégée : signe de la somme signée des poids. */
  direction: DirectionSignal | "mixte";
}

// ─────────────────────────── Constantes (spec) ───────────────────────────

/** Top N liquides à perp de l'échantillon (chaque symbole coûte ~4 requêtes). */
export const SIGNAUX_CAP = 20;
/** Plafond total échantillon (top liquides ∪ watchlist). */
export const SIGNAUX_CAP_TOTAL = 28;
/** Quadrant OI×prix : seuils de significativité (%). */
export const SEUIL_PRIX_PCT = 2;
export const SEUIL_OI_PCT = 3;
/** Funding : |z| déclencheur et fenêtre du z-score (points de funding réglé, 8 h). */
export const SEUIL_Z_FUNDING = 2;
export const FENETRE_Z_FUNDING = 60;
/** Positionnement : ratio (top traders / foule) déclencheur (et son inverse). */
export const SEUIL_RATIO_POSITIONNEMENT = 1.25;
/** Divergence RSI : profondeur de détection des pivots et fraîcheur exigée (bougies). */
export const FENETRE_DIVERGENCE = 60;
export const PIVOT_K = 3;
export const FRAICHEUR_DIVERGENCE = 15;

// ─────────────────────────── Quadrant OI × Prix (B1) ───────────────────────────

/**
 * Classe le couple (Δprix 24 h, ΔOI ~24 h) dans un des 4 quadrants du doc 02 B1.
 * null si l'un des deltas est sous son seuil de significativité (bruit). PURE.
 */
export function signalQuadrantOiPrix(
  deltaPrixPct: number,
  deltaOiPct: number,
): SignalDetecte | null {
  if (!Number.isFinite(deltaPrixPct) || !Number.isFinite(deltaOiPct)) return null;
  if (Math.abs(deltaPrixPct) < SEUIL_PRIX_PCT || Math.abs(deltaOiPct) < SEUIL_OI_PCT) return null;

  const prix = `${deltaPrixPct > 0 ? "+" : ""}${deltaPrixPct.toFixed(1)} %`;
  const oi = `${deltaOiPct > 0 ? "+" : ""}${deltaOiPct.toFixed(1)} %`;
  const commun = `Prix ${prix} / OI ${oi} sur ~24 h · ΔOI sur échantillon Binance futures data`;

  let libelle: string;
  let direction: DirectionSignal;
  let lecture: string;
  if (deltaPrixPct > 0 && deltaOiPct > 0) {
    libelle = "Build-up long";
    direction = "haussier";
    lecture = "positions longues qui s'accumulent (continuation)";
  } else if (deltaPrixPct < 0 && deltaOiPct > 0) {
    libelle = "Build-up short";
    direction = "baissier";
    lecture = "positions courtes qui s'accumulent (continuation)";
  } else if (deltaPrixPct > 0 && deltaOiPct < 0) {
    libelle = "Short squeeze";
    direction = "haussier";
    lecture = "hausse alimentée par des rachats de shorts — peu de positionnement neuf, mouvement fragile";
  } else {
    libelle = "Dé-leveraging";
    direction = "baissier";
    lecture = "les longs se dénouent — dérisquage en cours";
  }
  return {
    id: "quadrant",
    direction,
    libelle,
    detail: `${lecture} · ${commun}`,
    fiabilite: "échantillonné",
    poids: 1,
  };
}

// ─────────────────────────── Funding extrême (B2, z-score temporel) ───────────────────────────

/**
 * Z-score du DERNIER funding réglé vs la fenêtre des `FENETRE_Z_FUNDING` points
 * précédents. Lecture CONTRARIAN : funding très positif = longs crowded = baissier.
 * `hist` = fractions (série `histFunding`), triées croissantes. null si fenêtre
 * incomplète, écart-type nul, ou |z| < seuil. PURE.
 */
export function signalFundingExtreme(hist: readonly number[]): SignalDetecte | null {
  if (hist.length < FENETRE_Z_FUNDING + 1) return null;
  const dernier = hist[hist.length - 1];
  if (dernier === undefined || !Number.isFinite(dernier)) return null;
  const fenetre = hist.slice(-(FENETRE_Z_FUNDING + 1), -1);

  let somme = 0;
  for (const v of fenetre) somme += v;
  const moyenne = somme / fenetre.length;
  let variance = 0;
  for (const v of fenetre) variance += (v - moyenne) ** 2;
  const ecartType = Math.sqrt(variance / fenetre.length);
  if (ecartType === 0) return null;

  const z = (dernier - moyenne) / ecartType;
  if (Math.abs(z) < SEUIL_Z_FUNDING) return null;

  const crowdedLong = z > 0;
  const pct8h = (dernier * 100).toFixed(4);
  const annualise = (dernier * 3 * 365 * 100).toFixed(0);
  return {
    id: "funding",
    direction: crowdedLong ? "baissier" : "haussier",
    libelle: crowdedLong ? "Funding crowded long" : "Funding crowded short",
    detail:
      `z = ${z >= 0 ? "+" : ""}${z.toFixed(1)} vs ${FENETRE_Z_FUNDING} derniers règlements (~20 j) · ` +
      `${pct8h} %/8 h (≈ ${annualise} %/an) : les ${crowdedLong ? "longs" : "shorts"} paient cher — ` +
      `extrême contrarian ${crowdedLong ? "baissier" : "haussier"} · funding réglé Binance (donnée exacte)`,
    fiabilite: "fiable",
    poids: 2,
  };
}

// ─────────────────────────── Divergence RSI / prix (pivots) ───────────────────────────

export interface Pivot {
  index: number;
  value: number;
}

/**
 * Pivots locaux d'une série : indices strictement supérieurs (sens="haut") ou
 * inférieurs (sens="bas") à leurs `k` voisins de chaque côté. Les bords (moins de
 * k voisins) et les valeurs indéfinies sont exclus. PURE.
 */
export function pivotsLocaux(
  values: ReadonlyArray<number | undefined>,
  sens: "haut" | "bas",
  k: number = PIVOT_K,
): Pivot[] {
  const out: Pivot[] = [];
  for (let i = k; i < values.length - k; i++) {
    const v = values[i];
    if (v === undefined || !Number.isFinite(v)) continue;
    let pivot = true;
    for (let j = i - k; j <= i + k && pivot; j++) {
      if (j === i) continue;
      const w = values[j];
      if (w === undefined || !Number.isFinite(w)) {
        pivot = false;
      } else if (sens === "haut" ? w >= v : w <= v) {
        pivot = false;
      }
    }
    if (pivot) out.push({ index: i, value: v });
  }
  return out;
}

/**
 * Divergence classique prix/RSI sur les `FENETRE_DIVERGENCE` dernières bougies :
 *  - baissière : le prix fait un plus-haut plus haut, le RSI un plus-haut plus bas ;
 *  - haussière : le prix fait un plus-bas plus bas, le RSI un plus-bas plus haut.
 * Le pivot le plus récent doit dater de ≤ FRAICHEUR_DIVERGENCE bougies (setup
 * actionnable, pas de l'archéologie). Si les deux existent, la plus récente gagne.
 * `closes` et `rsi` sont alignés index à index. PURE, heuristique assumée.
 */
export function signalDivergenceRsi(
  closes: ReadonlyArray<number>,
  rsi: ReadonlyArray<number | undefined>,
): SignalDetecte | null {
  const n = closes.length;
  if (n < PIVOT_K * 2 + 2) return null;
  const debut = Math.max(0, n - FENETRE_DIVERGENCE);
  const fenetreCloses = closes.slice(debut);
  const fenetreRsi = rsi.slice(debut);

  const construire = (sens: "haut" | "bas"): { signal: SignalDetecte; recence: number } | null => {
    const pivots = pivotsLocaux(fenetreCloses, sens);
    if (pivots.length < 2) return null;
    const p1 = pivots[pivots.length - 2];
    const p2 = pivots[pivots.length - 1];
    if (p1 === undefined || p2 === undefined) return null;
    if (fenetreCloses.length - 1 - p2.index > FRAICHEUR_DIVERGENCE) return null;
    const r1 = fenetreRsi[p1.index];
    const r2 = fenetreRsi[p2.index];
    if (r1 === undefined || r2 === undefined) return null;

    const baissiere = sens === "haut";
    const prixDiverge = baissiere ? p2.value > p1.value : p2.value < p1.value;
    const rsiDiverge = baissiere ? r2 < r1 : r2 > r1;
    if (!prixDiverge || !rsiDiverge) return null;

    return {
      recence: p2.index,
      signal: {
        id: "divergence-rsi",
        direction: baissiere ? "baissier" : "haussier",
        libelle: baissiere ? "Divergence RSI baissière" : "Divergence RSI haussière",
        detail:
          (baissiere
            ? `prix en plus-haut (${p1.value.toPrecision(5)} → ${p2.value.toPrecision(5)}), RSI en retrait (${r1.toFixed(0)} → ${r2.toFixed(0)})`
            : `prix en plus-bas (${p1.value.toPrecision(5)} → ${p2.value.toPrecision(5)}), RSI en reprise (${r1.toFixed(0)} → ${r2.toFixed(0)})`) +
          " · pivots 4 h — heuristique, pas une donnée",
        fiabilite: "heuristique",
        poids: 2,
      },
    };
  };

  const baissiere = construire("haut");
  const haussiere = construire("bas");
  if (baissiere !== null && haussiere !== null) {
    return baissiere.recence >= haussiere.recence ? baissiere.signal : haussiere.signal;
  }
  return baissiere?.signal ?? haussiere?.signal ?? null;
}

// ─────────────────────────── Positionnement top traders vs foule (B6) ───────────────────────────

/**
 * Les gros comptes (top traders, ratio de POSITIONS) sont-ils à contre-courant de la
 * foule (comptes globaux) ? Déclenche si top/foule ≥ 1.25 ou ≤ 1/1.25. PURE.
 */
export function signalPositionnement(lsFoule: number, lsTop: number): SignalDetecte | null {
  if (!Number.isFinite(lsFoule) || !Number.isFinite(lsTop) || lsFoule <= 0 || lsTop <= 0) {
    return null;
  }
  const ratio = lsTop / lsFoule;
  if (ratio < SEUIL_RATIO_POSITIONNEMENT && ratio > 1 / SEUIL_RATIO_POSITIONNEMENT) return null;

  const topLong = ratio >= SEUIL_RATIO_POSITIONNEMENT;
  return {
    id: "positionnement",
    direction: topLong ? "haussier" : "baissier",
    libelle: topLong ? "Top traders longs vs foule" : "Top traders shorts vs foule",
    detail:
      `L/S top traders (positions) ${lsTop.toFixed(2)} vs foule (comptes) ${lsFoule.toFixed(2)} — ` +
      `les gros comptes sont ${topLong ? "plus longs" : "plus shorts"} que le marché · ` +
      "ratios Binance futures data, bruités (méthodologies comptes/positions différentes)",
    fiabilite: "bruité",
    poids: 1,
  };
}

// ─────────────────────────── Confluence ───────────────────────────

/**
 * Agrège les signaux d'un symbole en ligne d'inbox : score = Σ poids, direction =
 * signe de la somme signée (haussier +, baissier −), « mixte » si équilibre.
 * null si aucun signal (le symbole n'apparaît pas dans l'inbox). PURE.
 */
export function agregerSignaux(
  base: Pick<ScreenerRow, "symbol" | "lastPrice" | "priceChangePct24h" | "volumeUsd24h">,
  signaux: ReadonlyArray<SignalDetecte | null>,
): LigneSignaux | null {
  const retenus = signaux.filter((s): s is SignalDetecte => s !== null);
  if (retenus.length === 0) return null;
  let score = 0;
  let net = 0;
  for (const s of retenus) {
    score += s.poids;
    net += s.direction === "haussier" ? s.poids : -s.poids;
  }
  return {
    symbol: base.symbol,
    lastPrice: base.lastPrice,
    priceChangePct24h: base.priceChangePct24h,
    volumeUsd24h: base.volumeUsd24h,
    signaux: retenus,
    score,
    direction: net > 0 ? "haussier" : net < 0 ? "baissier" : "mixte",
  };
}

// ─────────────────────────── Échantillon ───────────────────────────

/**
 * Échantillon du run : top `capTop` liquides parmi les lignes À PERP (funding
 * présent — tous les détecteurs sont perp-based), puis symboles de watchlist
 * présents dans cet univers perp, jusqu'à `capTotal`. Ordre : volume décroissant,
 * watchlist ajoutée à la suite. PURE.
 */
export function selectionEchantillon(
  rows: readonly ScreenerRow[],
  watchlist: readonly string[],
  capTop: number = SIGNAUX_CAP,
  capTotal: number = SIGNAUX_CAP_TOTAL,
): ScreenerRow[] {
  const perp = rows.filter((r) => r.fundingPct !== undefined);
  const parVolume = [...perp].sort((a, b) => b.volumeUsd24h - a.volumeUsd24h);
  const retenus = parVolume.slice(0, capTop);
  const pris = new Set(retenus.map((r) => r.symbol));
  const parSymbole = new Map(perp.map((r) => [r.symbol, r]));
  for (const s of watchlist) {
    if (retenus.length >= capTotal) break;
    const row = parSymbole.get(s);
    if (row !== undefined && !pris.has(s)) {
      retenus.push(row);
      pris.add(s);
    }
  }
  return retenus;
}
