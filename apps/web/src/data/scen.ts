/**
 * SCEN — moteur de stress-test multi-facteurs. Deux couches nettement séparées :
 *  1. CALCULS PURS (haut du fichier) : rattachement des positions à un facteur, bêtas
 *     roulants et application d'un scénario de chocs. Sans effet de bord, verrouillés en test.
 *  2. COLLECTE (bas, « ── Collecte ── ») : IMPURE — fetch des klines 1 j (facteurs + positions)
 *     puis assemblage des poids et de la VaR. Elle se borne à orchestrer les fonctions pures.
 *
 * GÉNÉRALISE `stressGrid` de portRisque (choc BTC mono-facteur → 5 facteurs, 1 facteur par
 * position) en réutilisant les primitives existantes (`alignerSeries/fenetrer/logRendements`
 * de corr.ts pour les rendements ; `risquePortefeuille/serieRendementsPortefeuille` de
 * portRisque.ts pour la VaR). Modèle ASSUMÉ (spec) : P&L = poids · β · choc, approximation
 * 1-facteur (ordres de grandeur, pas de somme multi-facteurs).
 *
 * Différence méthodologique ASSUMÉE avec CORR (v2.6) : CORR exclut la bougie du jour EN
 * COURS (partielle) de ses corrélations ; SCEN garde la série complète car la dernière
 * clôture sert AUSSI de prix de valorisation des positions (dernierClose) — le biais d'une
 * bougie partielle sur un β roulant de 90 j est marginal, l'exclure fausserait le marquage.
 */

import type { Candle, ExchangeId } from "@axiom/types";
import { getAdapter } from "./adapters";
import { alignerSeries, chargerSerie, fenetrer, logRendements, type SerieCloture } from "./corr";
import {
  risquePortefeuille,
  serieRendementsPortefeuille,
  type PoidsPosition,
  type SerieActif,
} from "./portRisque";
import { mapPool } from "./screenerRun";
// Imports de TYPE uniquement (élidés au runtime : aucun couplage store↔data) — sert aux
// adaptateurs des stores vers `PositionBrute` plus bas.
import type { Position } from "../store/portfolio";
import type { PositionPaper } from "./paper";

export type { SerieCloture };

// ─────────────────────────── Facteurs (pur) ───────────────────────────

/** Identifiant des cinq facteurs de risque proposés aux chocs. */
export type FacteurId = "btc" | "eth" | "dxy" | "spx" | "or";

/** Séries de référence de chaque facteur (crypto via Binance, tradfi via ETF Twelve Data). */
export const FACTEURS: { id: FacteurId; label: string; symbole: string; source: "binance" | "twelvedata" }[] = [
  { id: "btc", label: "BTC", symbole: "BTCUSDT", source: "binance" },
  { id: "eth", label: "ETH", symbole: "ETHUSDT", source: "binance" },
  { id: "dxy", label: "DXY", symbole: "UUP", source: "twelvedata" },
  { id: "spx", label: "S&P 500", symbole: "SPY", source: "twelvedata" },
  { id: "or", label: "Or", symbole: "GLD", source: "twelvedata" },
];

/** Cotations crypto reconnues (les plus longues d'abord : USDT avant USD). */
const COTATIONS = ["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USDD", "USD", "DAI", "BTC", "ETH"];

/** Actif de base d'un symbole crypto (retire la cotation reconnue la plus longue). PURE. */
function baseCrypto(symbole: string): string {
  const s = symbole.toUpperCase();
  for (const q of COTATIONS) {
    if (s.length > q.length && s.endsWith(q)) return s.slice(0, s.length - q.length);
  }
  return s;
}

/**
 * Rattache un symbole à SON facteur (approximation 1-facteur) :
 *  - crypto (source ≠ twelvedata) : base « ETH » → eth, tout le reste → btc ;
 *  - tradfi (twelvedata) : UUP + paires forex → dxy, GLD/SLV → or, sinon spx (actions/indices).
 * PURE.
 */
export function facteurDe(symbole: string, source: ExchangeId): FacteurId {
  if (source === "twelvedata") {
    const s = symbole.toUpperCase();
    if (s === "UUP" || s.includes("/")) return "dxy"; // dollar + paires forex
    if (s === "GLD" || s === "SLV") return "or"; // métaux précieux
    return "spx"; // défaut : actions & indices
  }
  return baseCrypto(symbole) === "ETH" ? "eth" : "btc";
}

// ─────────────────────────── Bêtas roulants (pur) ───────────────────────────

/** Position enrichie pour le scénario : poids signé ($) + facteur + bêta (null si indisponible). */
export interface PositionScen {
  symbole: string;
  poidsUsd: number; // signé, short < 0
  facteur: FacteurId;
  beta: number | null;
}

/**
 * Variance jugée nulle en deçà de ce seuil : une série de rendements ~constante laisse un
 * résidu flottant ~1e-36 qu'un `=== 0` raterait, faisant exploser le ratio cov/var en NaN.
 */
const EPS_VAR = 1e-12;

/**
 * Bêta roulant β = cov(r_A, r_F)/var(r_F) sur les log-rendements 1 j alignés, les deux séries
 * étant d'abord restreintes aux `jours` derniers jours (`fenetrer`) puis alignées par jour
 * commun (`alignerSeries`). `null` si moins de 30 rendements communs finis OU si var(r_F) est
 * nulle (facteur ~constant : β indéfini). Convention du seuil 30 = celle de risquePortefeuille.
 * PURE.
 */
export function betaRoulant(actif: SerieCloture[], facteur: SerieCloture[], jours: number): number | null {
  const { a, b } = alignerSeries(fenetrer(actif, jours), fenetrer(facteur, jours));
  const rA = logRendements(a);
  const rF = logRendements(b);
  // Couples finis appariés (les NaN de logRendements — clôture ≤ 0 — sont écartés).
  const paires: [number, number][] = [];
  for (let i = 0; i < rA.length; i++) {
    const x = rA[i];
    const y = rF[i];
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    paires.push([x, y]);
  }
  if (paires.length < 30) return null;
  const n = paires.length;
  const mA = paires.reduce((s, p) => s + p[0], 0) / n;
  const mF = paires.reduce((s, p) => s + p[1], 0) / n;
  let cov = 0;
  let varF = 0;
  for (const [x, y] of paires) {
    const dF = y - mF;
    cov += (x - mA) * dF;
    varF += dF * dF;
  }
  // Le facteur 1/n se simplifie dans le ratio ; on l'omet. varF nulle ⇒ β indéfini.
  if (varF < EPS_VAR) return null;
  return cov / varF;
}

// ─────────────────────────── Scénario (pur) ───────────────────────────

/** Résultat d'un scénario : une ligne par position + agrégats (total, couvert, notionnel). */
export interface ResultatScen {
  lignes: { position: PositionScen; plUsd: number | null }[];
  totalUsd: number;
  couvertUsd: number;
  sommeAbs: number;
}

/**
 * Applique un jeu de chocs (%) aux positions : plUsd = poids · β · choc/100. Une position à β
 * `null` a un plUsd `null` et est EXCLUE du total (patron `stressGrid`). `couvertUsd` = Σ|poids|
 * des seules positions à β calculable ; `sommeAbs` = Σ|poids| de TOUTES les positions (le
 * ratio couvertUsd/sommeAbs mesure la part du notionnel réellement estimée). PURE.
 */
export function appliquerScenario(positions: PositionScen[], chocsPct: Record<FacteurId, number>): ResultatScen {
  let totalUsd = 0;
  let couvertUsd = 0;
  let sommeAbs = 0;
  const lignes = positions.map((position) => {
    sommeAbs += Math.abs(position.poidsUsd);
    if (position.beta === null) return { position, plUsd: null };
    const choc = chocsPct[position.facteur] ?? 0;
    const plUsd = (position.poidsUsd * position.beta * choc) / 100;
    totalUsd += plUsd;
    couvertUsd += Math.abs(position.poidsUsd);
    return { position, plUsd };
  });
  return { lignes, totalUsd, couvertUsd, sommeAbs };
}

/** Scénarios préréglés (facteurs absents → choc 0 côté UI). */
export const PRESETS_SCEN: { label: string; chocs: Partial<Record<FacteurId, number>> }[] = [
  { label: "Krach crypto", chocs: { btc: -30, eth: -35 } },
  { label: "Choc taux", chocs: { dxy: 3, spx: -5 } },
  { label: "Risk-on", chocs: { btc: 15, eth: 20, spx: 5 } },
];

/**
 * Complète un jeu de chocs PARTIEL (preset) en un Record COMPLET des cinq facteurs : tout
 * facteur absent reçoit un choc de 0. `appliquerScenario` exige ce record complet — c'est le
 * pont entre les presets partiels et l'application du scénario. PURE.
 */
export function mergePresetEnRecord(chocs: Partial<Record<FacteurId, number>>): Record<FacteurId, number> {
  const complet = {} as Record<FacteurId, number>;
  for (const f of FACTEURS) complet[f.id] = chocs[f.id] ?? 0;
  return complet;
}

// ─────────────────────────── Collecte (impure) ───────────────────────────
//
// Fetch des klines 1 j puis assemblage. Les FACTEURS sont récupérés directement via leur
// adaptateur (getAdapter(source).fetchKlines) et NON via chargerSerie : la résolution de
// source par la watchlist n'est pas fiable pour SPY/UUP/GLD hors watchlist. Les séries des
// POSITIONS passent par chargerSerie (cache session corr). Échec d'un facteur ⇒ toutes les
// positions rattachées ont β null ; échec d'un symbole ⇒ β null (repli prix d'entrée pour le
// poids). Les calculs restent les fonctions pures ci-dessus.

/** Entrée brute : les stores ne connaissent pas le prix courant — la collecte le tire du dernier close 1 j. */
export interface PositionBrute {
  symbole: string;
  source: ExchangeId;
  direction: "long" | "short";
  taille: number;
  prixEntree: number;
}

/**
 * Adaptateur portefeuille → entrées brutes : ne garde que les positions OUVERTES et recopie
 * leurs champs directs (l'exchange d'origine `source` est déjà connu). PURE (testée).
 */
export function brutesDepuisPortefeuille(positions: readonly Position[]): PositionBrute[] {
  return positions
    .filter((p) => p.statut === "ouvert")
    .map((p) => ({
      symbole: p.symbole,
      source: p.source,
      direction: p.direction,
      taille: p.taille,
      prixEntree: p.prixEntree,
    }));
}

/**
 * Adaptateur paper trading → entrées brutes. DÉCISION consignée : le store paper ne mémorise
 * pas d'exchange et ses symboles sont crypto → la source est fixée à "binance" (même adaptateur
 * de klines 1 j que le reste du terminal). Le champ `symbol` (anglais) devient `symbole`. PURE
 * (testée). Les positions paper sont toutes ouvertes (les clôtures deviennent des exécutions).
 */
export function brutesDepuisPaper(positions: readonly PositionPaper[]): PositionBrute[] {
  return positions.map((p): PositionBrute => ({
    symbole: p.symbol,
    source: "binance",
    direction: p.direction,
    taille: p.taille,
    prixEntree: p.prixEntree,
  }));
}

/**
 * Signature structurelle DÉTERMINISTE d'un lot d'entrées brutes : concatène les cinq champs de
 * chaque position puis TRIE — deux tableaux aux mêmes valeurs (mais références distinctes)
 * produisent la MÊME chaîne, et toute valeur modifiée la change. Sert à s'abonner aux stores
 * PAR VALEUR (chaîne stable par Object.is) et non par référence : le store paper reconstruit son
 * tableau `positions` à CHAQUE tick d'un symbole ayant une position ouverte (`evaluerTickDetaille`
 * rebâtit `positionsRestantes`, même sur un tick SANS exécution) — un abonnement direct à
 * `s.positions` re-rendrait donc la fenêtre à chaque tick. PURE.
 */
export function signatureBrutes(brutes: readonly PositionBrute[]): string {
  return brutes
    .map((b) => `${b.symbole}|${b.source}|${b.direction}|${b.taille}|${b.prixEntree}`)
    .sort()
    .join(";");
}

/** Résultat de la collecte : positions enrichies, VaR95 en $ (null si incalculable), exclusions annotées. */
export interface CollecteScen {
  positions: PositionScen[];
  varUsd95: number | null;
  exclues: { symbole: string; raison: string }[];
}

/** ~260 bougies 1 j (couvre 90 j de fenêtre, week-ends tradfi écartés). */
const KLINE_LIMIT = 260;
/** Concurrence du pool de collecte des séries positions (décision : sobre). */
const CONCURRENCE = 4;

/** Cache SESSION des séries facteurs (évite le refetch ; vidé par « Recalculer β »). */
const cacheFacteurs = new Map<FacteurId, SerieCloture[]>();

/** Vide le cache des séries facteurs (bouton « Recalculer β » de la fenêtre). */
export function viderCacheFacteurs(): void {
  cacheFacteurs.clear();
}

/** Klines → série de clôtures triée (finie, close > 0). PURE. */
function klinesVersSerie(klines: readonly Candle[]): SerieCloture[] {
  return klines
    .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0)
    .map((c) => ({ time: c.time, close: c.close }))
    .sort((x, y) => x.time - y.time);
}

/** Log-rendements horodatés {t, r} d'une série de clôtures (forme attendue par la VaR portefeuille). PURE. */
function serieVersRendements(serie: SerieCloture[]): { t: number; r: number }[] {
  const out: { t: number; r: number }[] = [];
  for (let i = 1; i < serie.length; i++) {
    const p0 = serie[i - 1]!.close;
    const p1 = serie[i]!.close;
    if (p0 > 0 && p1 > 0) out.push({ t: serie[i]!.time, r: Math.log(p1 / p0) });
  }
  return out;
}

/** Signe directionnel : long +1, short −1. PURE. */
function signe(direction: "long" | "short"): number {
  return direction === "short" ? -1 : 1;
}

/** Charge (ou ressert du cache session) la série d'un facteur ; [] si échec (non caché → réessai possible). IMPURE. */
async function chargerFacteur(f: (typeof FACTEURS)[number]): Promise<SerieCloture[]> {
  const cached = cacheFacteurs.get(f.id);
  if (cached !== undefined) return cached;
  try {
    const klines = await getAdapter(f.source).fetchKlines(f.symbole, "1d", { limit: KLINE_LIMIT });
    const serie = klinesVersSerie(klines);
    cacheFacteurs.set(f.id, serie);
    return serie;
  } catch {
    return [];
  }
}

/**
 * Collecte les séries (facteurs + positions), assemble les poids signés et les bêtas, et
 * calcule la VaR95 en $ du portefeuille. `poidsUsd` = signe(direction) · taille · dernier close
 * (repli prixEntree si série vide — la position reste incluse si β est calculable). Une position
 * à β null figure dans `positions` (beta null, ligne « indispo » côté UI) ET dans `exclues` avec
 * sa raison. `varUsd95` = risquePortefeuille(serieRendementsPortefeuille(...)).var95Pct · Σ|poids|
 * sur les MÊMES séries positions, fenêtrées comme les bêtas (décision : même horizon que β) ;
 * null si moins de 30 rendements communs. IMPURE (réseau).
 */
export async function collecterScen(
  positions: readonly PositionBrute[],
  fenetreJours: number,
): Promise<CollecteScen> {
  // 1. Facteurs requis (uniques) → chargement parallèle avec cache session.
  const facteurParPosition = positions.map((p) => FACTEURS.find((f) => f.id === facteurDe(p.symbole, p.source))!);
  const facteursUniques = [...new Map(facteurParPosition.map((f) => [f.id, f])).values()];
  const seriesFacteurs = new Map<FacteurId, SerieCloture[]>();
  await Promise.all(facteursUniques.map(async (f) => seriesFacteurs.set(f.id, await chargerFacteur(f))));

  // 2. Séries positions (uniques) via chargerSerie (cache session corr), pool concurrence 4.
  const symbolesUniques = [...new Set(positions.map((p) => p.symbole))];
  const seriesPositions = new Map<string, SerieCloture[]>();
  await mapPool(symbolesUniques, CONCURRENCE, async (s) => {
    seriesPositions.set(s, await chargerSerie(s));
  });

  // 3. Assemblage des positions (poids + β) et diagnostic des exclusions.
  const exclues: { symbole: string; raison: string }[] = [];
  const positionsScen: PositionScen[] = positions.map((p, i) => {
    const f = facteurParPosition[i]!;
    const serieActif = seriesPositions.get(p.symbole) ?? [];
    const dernierClose = serieActif[serieActif.length - 1]?.close ?? p.prixEntree; // repli prix d'entrée
    const poidsUsd = signe(p.direction) * p.taille * dernierClose;
    const serieFacteur = seriesFacteurs.get(f.id) ?? [];
    let beta: number | null;
    if (serieFacteur.length === 0) {
      beta = null;
      exclues.push({ symbole: p.symbole, raison: `facteur ${f.label} indisponible` });
    } else if (serieActif.length === 0) {
      beta = null;
      exclues.push({ symbole: p.symbole, raison: "série de prix indisponible" });
    } else {
      beta = betaRoulant(serieActif, serieFacteur, fenetreJours);
      if (beta === null) exclues.push({ symbole: p.symbole, raison: `moins de 30 jours communs avec ${f.label}` });
    }
    return { symbole: p.symbole, poidsUsd, facteur: f.id, beta };
  });

  // 4. VaR95 du portefeuille sur les MÊMES séries positions (poids agrégés par symbole pour
  //    éviter le double-comptage), fenêtrées comme les bêtas. Seuls les symboles pourvus d'une
  //    série entrent dans la VaR et dans son Σ|poids|.
  const poidsParSymbole = new Map<string, number>();
  for (const ps of positionsScen) {
    poidsParSymbole.set(ps.symbole, (poidsParSymbole.get(ps.symbole) ?? 0) + ps.poidsUsd);
  }
  const seriesActifs: SerieActif[] = [];
  const poids: PoidsPosition[] = [];
  let sommeAbs = 0;
  for (const [symbole, poidsUsd] of poidsParSymbole) {
    const serie = seriesPositions.get(symbole) ?? [];
    if (serie.length === 0) continue; // sans série, pas de contribution à la VaR
    seriesActifs.push({ symbol: symbole, rendements: serieVersRendements(fenetrer(serie, fenetreJours)) });
    poids.push({ symbol: symbole, poids: poidsUsd });
    sommeAbs += Math.abs(poidsUsd);
  }
  const risque = risquePortefeuille(serieRendementsPortefeuille(seriesActifs, poids));
  const varUsd95 = risque === null ? null : risque.var95Pct * sommeAbs;

  return { positions: positionsScen, varUsd95, exclues };
}
