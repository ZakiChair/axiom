#!/usr/bin/env bun
/**
 * AXIOM — exploration des ENTRÉES d'AXIS (« v4 ») sur données DÉJÀ VUES,
 * 9 octobre 2026.
 *
 * OBJET. Le propriétaire demande de « rendre AXIS encore plus précis ». La v2 (entrée
 * score ≥ 5 ET close > EMA 200, sortie score ≤ −4) a passé son test de 2017-2024 ;
 * la v3 (stop suiveur, sorties) a échoué le sien (scripts/axis/rapport-v3-2026-10-08.md).
 * Reste la dimension jamais explorée : l'ENTRÉE. Une seule variante d'entrée sera
 * testée sur des données jamais vues (paires USDT cotées entre le 2023-07-01 et le
 * 2025-06-30, 4h, jamais lues par le dépôt) ; ce script est l'exploration préalable
 * qui la choisit, sur les SEULES données déjà consommées par les campagnes AXIS, selon
 * une règle écrite ci-dessous AVANT la première exécution. Si aucune variante ne
 * satisfait la règle, aucun test n'est lancé et le pool neuf reste disponible.
 *
 * DONNÉES (déjà vues, SANS VALEUR PROBANTE), deux panels en cache local, vérifiés par
 * hash, jamais téléchargés ici (un cache absent ou non vérifiable = arrêt) :
 *   - panel A « alts » : les 151 paires du test v3 (scripts/axis/manifeste-v3-2026-10-08.json,
 *     symboles.liste), 4h, 2023-07-01 → 2026-10-08, cache gzip
 *     scripts/.cache-klines/axis-v3/H-<symbole>.json.gz (schéma axiom-klines-axis-v3-v1) ;
 *   - panel B « majors » : BTC, ETH, XRP, SOL (E-*) et BNB, ADA, LINK, DOGE (H-*), 4h,
 *     historique complet 2017/2020 → 2026-10-08, cache scripts/.cache-klines/axis-flux/.
 * Indépendance du futur test : en ACTIFS, entière (aucune paire du pool neuf n'est lue
 * ici) ; en TEMPS, nulle par construction — le pool neuf n'existe qu'à partir de
 * 2023-07, période déjà lue sur ces 159 séries. Le panel A est le panel de CHOIX
 * (même type d'actifs et même période que le pool neuf) ; le panel B sert de
 * confirmation (autre population, autres régimes).
 *
 * SORTIE (identique pour toutes les variantes, jamais modifiée) : score ≤ −4 ; aucun
 * stop (stopAtr = 0). Décisions sur i ≤ n−2 ; une bougie à score indéfini reporte la
 * position ; armement de la v2 (la condition d'achat COMPLÈTE doit avoir été
 * évaluable et fausse une fois avant le premier achat et après chaque vente).
 *
 * GRILLE DE 13 VARIANTES D'ENTRÉE. Base B(i) = score[i] ≥ 5 ET close[i] > EMA 200[i].
 * Chaque variante AJOUTE une condition à la base (toutes les positions passent par la
 * fonction pure `positionsAxis` de stratAxis, la condition de tendance étant remplacée
 * par « base ET filtre ») ; une lecture absente vaut filtre faux (pas d'achat, comme
 * `filtreFlux` dans le chart) :
 *   - v2 : B(i) seule (= AXIS actuel, référence) ;
 *   - seuil-6 : score[i] ≥ 6 (unanimité des six votes) ET close > EMA 200 ;
 *   - confirmation-2, confirmation-3 : B vraie sur 2 (3) clôtures consécutives
 *     (i−1 et i ; i−2, i−1 et i) ;
 *   - adx-25, adx-30 : ADX 14 ≥ 25 (30) à la décision (force de tendance) ;
 *   - rsi-70 : RSI 14 < 70 (pas d'achat en surachat) ;
 *   - pente-20, pente-50 : EMA 200[i] > EMA 200[i−20] (i−50) (tendance de fond montante) ;
 *   - distance-10, distance-20 : close ≤ EMA 200 × 1,10 (1,20) (pas d'achat trop loin
 *     de la tendance de fond) ;
 *   - volume-1 : volume ≥ SMA(volume, 20) (volume relatif ≥ 1) ;
 *   - flux-fort : le réglage `filtreFlux` existant du chart — volume ≥ 1,5 × SMA 20 ET
 *     delta taker ≥ +10 % du volume (OI absent : deux lectures, toutes deux requises).
 * seuil-6 et flux-fort sont déjà des réglages du chart (`seuil`, `filtreFlux`) : leur
 * position est contrôlée contre le chart.
 *
 * EXÉCUTION : moteur `runBacktest` (décision à la clôture, fill à l'open suivant),
 * jambe longue, taille fixe 1000, capital 10 000, warmup 300 bougies (debutEvaluationMs
 * = open de la bougie 300), coûts x1 (0,05 % frais + 0,02 % slippage par côté) et x3
 * (0,15 % + 0,06 %).
 *
 * RÈGLE DE CHOIX (pré-déclarée, alignée sur les critères du futur test) :
 *   1. Éligibilité (panel A) : expectancy nette regroupée aux coûts x3 > 0 ET trades
 *      clos regroupés ≥ 50 % de ceux de la v2 (un filtre qui supprime plus de la moitié
 *      des signaux n'est plus « AXIS plus précis », c'est un autre outil).
 *   2. Métrique (panel A, coûts x1) : part des cellules comparables (Sharpe par bougie
 *      défini pour la variante ET pour la v2) où le Sharpe de la variante est
 *      STRICTEMENT supérieur à celui de la v2, sur la fenêtre entière.
 *   3. Classement : part décroissante ; égalité : le plus de trades clos regroupés (la
 *      variante la moins restrictive), puis l'ordre de la grille.
 *   4. Retenue : la première du classement SI ET SEULEMENT SI sa part est ≥ 60 % sur le
 *      panel A (seuil P2 du test), > 50 % dans CHAQUE moitié de la fenêtre du panel A
 *      (seuil P3 du test) et ≥ 5 cellules sur 8 sur le panel B (fenêtre entière).
 *      Sinon, aucune variante n'est proposée.
 * Métrique descriptive, hors règle : la même sélection si la métrique portait sur la
 * part des cellules où l'expectancy nette par trade de la variante dépasse celle de
 * la v2 (lecture « précision par trade »).
 *
 * MESURES (par cellule, variante, coût) : trades, clos, fin-données, expectancy nette
 * (% par trade), PnL net (cotation et % du capital), gagnants, profit factor, drawdown
 * max de l'equity valorisée aux clôtures (cotation et %), RoMaD, Sharpe par bougie
 * (rendements de l'equity par clôture, moyenne / écart-type (n−1) × √2191,5), exposition,
 * durée moyenne, MAE moyenne, frais ; par moitié de la fenêtre évaluée (frontière au
 * milieu des décisions évaluées) : trades entrés, PnL net, drawdown, RoMaD, Sharpe.
 * Parts de cellules battant la v2 (Sharpe >, DD <, PnL ≥, expectancy >, RoMaD >) sur la
 * fenêtre et par moitié.
 *
 * CONTRÔLES BLOQUANTS : hash des 159 caches ; `positions(v2)` strictement égale à
 * `positionsAxis` ET à la position déduite de `stratAxis.calc().series.prixSignal` ;
 * `positions(seuil-6)` égale à celle du chart avec `seuil = 6` ; `positions(flux-fort)`
 * égale à celle du chart avec `filtreFlux = true` ; nombre de trades du moteur = nombre
 * de naissances de position après le warmup, à chaque coût ; mêmes fills à x1 et x3.
 *
 * HISTORIQUE DES EXÉCUTIONS (grille et règle inchangées depuis la première) :
 *   1. 2026-10-09, 08:44 UTC, 159 caches vérifiés, 18 s : AUCUNE VARIANTE RETENUE.
 *      Onze variantes éligibles (flux-fort ne garde que 46 % des trades clos de la v2).
 *      Première du classement : adx-25, Sharpe > v2 sur 94/151 cellules du panel A
 *      (62,3 %), 79/151 puis 92/151 par moitié — mais 2/8 sur le panel B (la part
 *      exigée était ≥ 5/8) : le filtre relève l'expectancy par trade des majors (6/8)
 *      et abaisse leur drawdown (6/8), mais retire aussi des trades gagnants et leur
 *      Sharpe baisse (PnL moyen 60,9 % → 53,9 %). distance-10 2e (60,3 %, 2/8 sur B).
 *      Métrique descriptive (expectancy par trade) : adx-25 aurait été retenue
 *      (102/151, 6/8 sur B) ; les deux métriques ne coïncident pas. Conformément à
 *      la règle, aucun test n'est lancé ; le pool neuf reste disponible. Rapport
 *      recopié dans scripts/axis/rapport-explo-v4-2026-10-09.md.
 *
 * Sorties : /tmp/axis-v4-explo/resultat.json et rapport.md — SANS VALEUR PROBANTE ;
 * le rapport est recopié dans scripts/axis/rapport-explo-v4-2026-10-09.md pour tracer
 * le choix.
 * Usage : bun scripts/explorer-axis-v4.ts   (aucun argument accepté)
 * Vérification : ./node_modules/.bin/tsc --noEmit --strict --noUncheckedIndexedAccess
 *   --target es2022 --module esnext --moduleResolution bundler --skipLibCheck --types node
 *   scripts/explorer-axis-v4.ts
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import type { Candle, IndicatorDef, Timeframe } from "../packages/types/src/index";
import { closeOf, ema } from "../packages/indicators/src/utils";
import { computeIndicator, INDICATORS } from "../packages/indicators/src/index";
import { adxOf } from "../packages/indicators/src/trend/adx";
import { rsiOf } from "../packages/indicators/src/momentum/rsi";
import { fluxAxis, forceFlux, positionsAxis, stratAxis, votesAxis, type FluxBougie } from "../packages/indicators/src/strategy/stratAxis";
import { runBacktest } from "../packages/backtest/src/engine";
import type { Operande, PointEquity, ResultatBacktest, StrategieDef, TradeResultat } from "../packages/backtest/src/types";

if (process.argv.length > 2) throw new Error(`argument refusé : ${process.argv.slice(2).join(" ")} (usage : bun scripts/explorer-axis-v4.ts)`);

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SORTIES = "/tmp/axis-v4-explo";
const CACHE_ALTS = join(RACINE, "scripts/.cache-klines/axis-v3");
const CACHE_MAJORS = join(RACINE, "scripts/.cache-klines/axis-flux");
const MANIFESTE_V3 = join(RACINE, "scripts/axis/manifeste-v3-2026-10-08.json");
const SCHEMA_CACHE_ALTS = "axiom-klines-axis-v3-v1";
const FIN_CACHE = Date.parse("2026-10-08T00:00:00Z");
const TF: Timeframe = "4h";
const TF_MS = 14_400_000;
const WARMUP = 300;
const CAPITAL = 10_000;
const TAILLE = 1000;
const SEUIL = 5;
const SEUIL_VENTE = 4;
const EMA_TENDANCE = 200;
const RVOL_PERIODE = 20;
const SEUIL_RVOL_FORT = 1.5;
const SEUIL_OI = 2;
const BOUGIES_4H_PAR_AN = 2191.5;
/** Règle de choix : part minimale des trades clos de la v2 conservés (éligibilité). */
const PART_MIN_TRADES_V2 = 0.5;
/** Règle de choix : part de cellules du panel A (fenêtre) à atteindre (≥), seuil P2 du test. */
const PART_MIN_FENETRE = 0.6;
/** Règle de choix : part de cellules du panel A à dépasser (>) dans chaque moitié, seuil P3 du test. */
const PART_MIN_MOITIE = 0.5;
/** Règle de choix : cellules du panel B (sur 8) où la variante doit battre la v2. */
const MIN_MAJORS = 5;

interface Cout { id: string; frais: number; slippage: number }
const COUTS: Cout[] = [
  { id: "x1", frais: 0.05, slippage: 0.02 },
  { id: "x3", frais: 0.15, slippage: 0.06 },
];

type Panel = "A" | "B";
const NOM_PANEL: Record<Panel, string> = { A: "A — 151 alts 2023-2026", B: "B — 8 majors 2017-2026" };

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const iso = (ms: number): string => new Date(ms).toISOString();

// ─────────────────────────── Variantes ───────────────────────────

interface Serie {
  panel: Panel;
  symbol: string;
  candles: Candle[];
  score: Array<number | undefined>;
  ema200: Array<number | undefined>;
  /** close > EMA 200 (indéfini tant que l'EMA ne l'est pas). */
  auDessus: Array<boolean | undefined>;
  adx14: Array<number | undefined>;
  rsi14: Array<number | undefined>;
  flux: FluxBougie[];
  chargement: Chargement;
}

interface Variante {
  id: string;
  famille: string;
  /** Rang dans la grille (dernier critère d'égalité). */
  ordre: number;
  seuil: number;
  /** Condition ajoutée à la base ; `undefined` = lecture absente (vaut faux). */
  filtre: (s: Serie, i: number) => boolean | undefined;
  description: string;
}

/** Base B(j) : score ≥ 5 et close au-dessus de l'EMA 200, tous deux définis. */
const base = (s: Serie, j: number): boolean => {
  if (j < 0) return false;
  const sc = s.score[j];
  return sc !== undefined && sc >= SEUIL && s.auDessus[j] === true;
};
const pente = (k: number) => (s: Serie, i: number): boolean | undefined => {
  const e = s.ema200[i];
  const e0 = s.ema200[i - k];
  return e === undefined || e0 === undefined ? undefined : e > e0;
};
const distance = (d: number) => (s: Serie, i: number): boolean | undefined => {
  const e = s.ema200[i];
  return e === undefined ? undefined : s.candles[i]!.close <= e * (1 + d);
};
const adxMin = (x: number) => (s: Serie, i: number): boolean | undefined => {
  const a = s.adx14[i];
  return a === undefined ? undefined : a >= x;
};

const VARIANTES: Variante[] = [
  { id: "v2", famille: "v2", ordre: 0, seuil: SEUIL, filtre: () => true, description: "score ≥ 5 et close > EMA 200 (référence)" },
  { id: "seuil-6", famille: "seuil", ordre: 1, seuil: 6, filtre: () => true, description: "score ≥ 6 (unanimité des six votes) et close > EMA 200" },
  { id: "confirmation-2", famille: "confirmation", ordre: 2, seuil: SEUIL, filtre: (s, i) => base(s, i - 1), description: "base vraie sur 2 clôtures consécutives" },
  { id: "confirmation-3", famille: "confirmation", ordre: 3, seuil: SEUIL, filtre: (s, i) => base(s, i - 1) && base(s, i - 2), description: "base vraie sur 3 clôtures consécutives" },
  { id: "adx-25", famille: "adx", ordre: 4, seuil: SEUIL, filtre: adxMin(25), description: "base et ADX 14 ≥ 25" },
  { id: "adx-30", famille: "adx", ordre: 5, seuil: SEUIL, filtre: adxMin(30), description: "base et ADX 14 ≥ 30" },
  { id: "rsi-70", famille: "rsi", ordre: 6, seuil: SEUIL, filtre: (s, i) => (s.rsi14[i] === undefined ? undefined : s.rsi14[i]! < 70), description: "base et RSI 14 < 70" },
  { id: "pente-20", famille: "pente", ordre: 7, seuil: SEUIL, filtre: pente(20), description: "base et EMA 200 > EMA 200 d'il y a 20 bougies" },
  { id: "pente-50", famille: "pente", ordre: 8, seuil: SEUIL, filtre: pente(50), description: "base et EMA 200 > EMA 200 d'il y a 50 bougies" },
  { id: "distance-10", famille: "distance", ordre: 9, seuil: SEUIL, filtre: distance(0.1), description: "base et close ≤ EMA 200 × 1,10" },
  { id: "distance-20", famille: "distance", ordre: 10, seuil: SEUIL, filtre: distance(0.2), description: "base et close ≤ EMA 200 × 1,20" },
  { id: "volume-1", famille: "volume", ordre: 11, seuil: SEUIL, filtre: (s, i) => (s.flux[i]?.rvol === undefined ? undefined : s.flux[i]!.rvol! >= 1), description: "base et volume ≥ SMA(volume, 20)" },
  { id: "flux-fort", famille: "flux", ordre: 12, seuil: SEUIL, filtre: (s, i) => forceFlux(s.flux[i] ?? {}, 1, SEUIL_RVOL_FORT, SEUIL_OI).fort, description: "base et flux fort (volume ≥ 1,5 × SMA 20 et delta taker ≥ +10 %) : réglage filtreFlux du chart" },
];
if (VARIANTES.length !== 13) throw new Error(`grille de ${VARIANTES.length} variantes, 13 attendues`);
const V2 = VARIANTES[0]!;

// ─────────────────────────── Utilitaires ───────────────────────────

const fmt = (v: number | null | undefined, d = 2): string =>
  v === null || v === undefined ? "—" : v === Infinity ? "∞" : v === -Infinity ? "−∞" : Number.isFinite(v) ? v.toFixed(d) : "—";
const pourcent = (k: number, n: number): string => (n === 0 ? "—" : `${((100 * k) / n).toFixed(1)} %`);
const ligne = (cells: Array<string | number>): string => `| ${cells.join(" | ")} |`;
const tableau = (entetes: string[], lignes: Array<Array<string | number>>): string =>
  [ligne(entetes), ligne(entetes.map(() => "---")), ...lignes.map(ligne)].join("\n");

function mediane(valeurs: number[]): number | null {
  if (valeurs.length === 0) return null;
  const tri = [...valeurs].sort((a, b) => a - b);
  const m = tri.length >> 1;
  if (tri.length % 2 === 1) return tri[m]!;
  const a = tri[m - 1]!;
  const b = tri[m]!;
  if (a === Infinity || b === Infinity) return Infinity;
  return (a + b) / 2;
}
const moyenne = (valeurs: number[]): number | null => (valeurs.length === 0 ? null : valeurs.reduce((s, v) => s + v, 0) / valeurs.length);
const definis = (valeurs: Array<number | null>): number[] => valeurs.filter((v): v is number => v !== null);
/** Comparaison exacte k/n ⋛ seuil en entiers (seuils à au plus 6 décimales). */
const atteint = (k: number, n: number, seuil: number, strict: boolean): boolean => {
  const s = Math.round(seuil * 1e6);
  return n > 0 && (strict ? k * 1e6 > s * n : k * 1e6 >= s * n);
};

/** JSON : les non-finis deviennent des chaînes explicites (RoMaD à drawdown nul). */
const remplaceur = (_k: string, v: unknown): unknown =>
  typeof v === "number" && !Number.isFinite(v) ? (v === Infinity ? "Infinity" : v === -Infinity ? "-Infinity" : "NaN") : v;

// ─────────────────────────── Données (cache seul, vérifié par hash) ───────────────────────────

interface BougieEcartee { temps: string; raison: string }
interface Chargement { fichier: string; sha256: string; acquisLeUtc: string; ecarteesCache: number; invalidesLocales: number }

function raisonInvalide(c: Candle): string | null {
  if (![c.time, c.open, c.high, c.low, c.close, c.volume].every((v) => typeof v === "number" && Number.isFinite(v))) return "OHLCV non fini";
  if (c.open <= 0 || c.close <= 0 || c.low <= 0) return "prix ≤ 0";
  if (c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close)) return "high/low incohérents";
  return null;
}

function controlerSerie(symbol: string, candles: Candle[]): void {
  for (let i = 1; i < candles.length; i++) if (!(candles[i]!.time > candles[i - 1]!.time)) throw new Error(`${symbol} : série non strictement croissante`);
  if (candles.length <= WARMUP + 2) throw new Error(`${symbol} : série trop courte (${candles.length} bougies)`);
  if (candles.some((c) => c.buyVolume === undefined || c.sellVolume === undefined)) throw new Error(`${symbol} : volume taker absent (flux-fort non mesurable)`);
}

/** Panel A : cache gzip du test v3 (lignes compactes, empreinte des lignes et des écartées). */
function chargerAlt(symbol: string): { candles: Candle[]; chargement: Chargement } {
  const fichier = join(CACHE_ALTS, `H-${symbol}.json.gz`);
  if (!existsSync(fichier)) throw new Error(`cache absent : ${fichier} (aucun téléchargement dans cette exploration)`);
  type Ligne = [number, number, number, number, number, number, number];
  const e = JSON.parse(gunzipSync(readFileSync(fichier)).toString("utf8")) as {
    schema: string; symbol: string; unite: string; acquisLeUtc: string; sha256: string; lignes: Ligne[]; ecartees: BougieEcartee[]; erreurSource?: string;
  };
  if (e.schema !== SCHEMA_CACHE_ALTS || e.symbol !== symbol || e.unite !== TF || !Array.isArray(e.lignes) || !Array.isArray(e.ecartees)) {
    throw new Error(`cache ${fichier} : enveloppe inattendue`);
  }
  // Même empreinte que valider-axis-v3.ts (empreinteCache).
  const empreinte = sha256(JSON.stringify(e.erreurSource === undefined ? { lignes: e.lignes, ecartees: e.ecartees } : { lignes: e.lignes, ecartees: e.ecartees, erreurSource: e.erreurSource }));
  if (empreinte !== e.sha256) throw new Error(`cache ${fichier} non traçable (hash ${empreinte.slice(0, 12)}… ≠ ${e.sha256.slice(0, 12)}…)`);
  if (e.erreurSource !== undefined) throw new Error(`${symbol} : cache marqué indisponible (${e.erreurSource})`);
  const brutes: Candle[] = e.lignes.map(([time, open, high, low, close, volume, buy]) => ({ time, open, high, low, close, volume, buyVolume: buy, sellVolume: volume - buy }));
  const candles = brutes.filter((c) => raisonInvalide(c) === null && c.time + TF_MS <= FIN_CACHE);
  controlerSerie(symbol, candles);
  return {
    candles,
    chargement: { fichier: `axis-v3/H-${symbol}.json.gz`, sha256: e.sha256, acquisLeUtc: e.acquisLeUtc, ecarteesCache: e.ecartees.length, invalidesLocales: brutes.length - candles.length },
  };
}

interface MajorDef { symbol: string; fichier: string; enveloppe: "exploration" | "campagne" }
const MAJORS: MajorDef[] = [
  { symbol: "BTCUSDT", fichier: "E-BTCUSDT-4h.json", enveloppe: "exploration" },
  { symbol: "ETHUSDT", fichier: "E-ETHUSDT-4h.json", enveloppe: "exploration" },
  { symbol: "XRPUSDT", fichier: "E-XRPUSDT-4h.json", enveloppe: "exploration" },
  { symbol: "SOLUSDT", fichier: "E-SOLUSDT-4h.json", enveloppe: "exploration" },
  { symbol: "BNBUSDT", fichier: "H-BNBUSDT-4h.json", enveloppe: "campagne" },
  { symbol: "ADAUSDT", fichier: "H-ADAUSDT-4h.json", enveloppe: "campagne" },
  { symbol: "LINKUSDT", fichier: "H-LINKUSDT-4h.json", enveloppe: "campagne" },
  { symbol: "DOGEUSDT", fichier: "H-DOGEUSDT-4h.json", enveloppe: "campagne" },
];

/** Panel B : caches de la couche flux (même empreinte que les scripts qui les ont écrits). */
function chargerMajor(def: MajorDef): { candles: Candle[]; chargement: Chargement } {
  const fichier = join(CACHE_MAJORS, def.fichier);
  if (!existsSync(fichier)) throw new Error(`cache absent : ${fichier} (aucun téléchargement dans cette exploration)`);
  const env = JSON.parse(readFileSync(fichier, "utf8")) as { sha256: string; acquisLeUtc?: string; candles: Candle[]; ecartees?: BougieEcartee[] };
  if (!Array.isArray(env.candles) || typeof env.sha256 !== "string") throw new Error(`cache ${fichier} : enveloppe inattendue`);
  const empreinte = def.enveloppe === "exploration"
    ? sha256(JSON.stringify(env.candles))
    : Array.isArray(env.ecartees) ? sha256(JSON.stringify({ candles: env.candles, ecartees: env.ecartees })) : "";
  if (empreinte !== env.sha256) throw new Error(`cache ${fichier} non traçable (hash ${empreinte.slice(0, 12)}… ≠ ${env.sha256.slice(0, 12)}…)`);
  const candles = env.candles.filter((c) => raisonInvalide(c) === null && c.time + TF_MS <= FIN_CACHE);
  controlerSerie(def.symbol, candles);
  return {
    candles,
    chargement: { fichier: `axis-flux/${def.fichier}`, sha256: env.sha256, acquisLeUtc: env.acquisLeUtc ?? "—", ecarteesCache: env.ecartees?.length ?? 0, invalidesLocales: env.candles.length - candles.length },
  };
}

function symbolesAlts(): string[] {
  const m = JSON.parse(readFileSync(MANIFESTE_V3, "utf8")) as { symboles: { nombre: number; liste: Array<{ symbol: string }> } };
  const liste = m.symboles.liste.map((s) => s.symbol);
  if (liste.length !== 151 || liste.length !== m.symboles.nombre || new Set(liste).size !== liste.length) throw new Error("manifeste v3 : pool de 151 symboles attendu");
  return liste;
}

// ─────────────────────────── Préparation et positions ───────────────────────────

const PARAMS_AXIS = { seuil: SEUIL, seuilVente: SEUIL_VENTE, emaTendance: EMA_TENDANCE };

function lectures(candles: Candle[]): Omit<Serie, "panel" | "symbol" | "chargement"> {
  const votes = votesAxis(candles, PARAMS_AXIS);
  const closes = closeOf(candles);
  const ema200 = ema(closes, EMA_TENDANCE);
  return {
    candles,
    score: votes.map((v) => v?.reduce((a, b) => a + b, 0)),
    ema200,
    auDessus: ema200.map((t, i) => (t === undefined ? undefined : closes[i]! > t)),
    adx14: adxOf(candles, 14).adx,
    rsi14: rsiOf(closes, 14),
    flux: fluxAxis(candles, undefined, RVOL_PERIODE, 6),
  };
}

function preparer(panel: Panel, symbol: string, charge: { candles: Candle[]; chargement: Chargement }): Serie {
  const s: Serie = { panel, symbol, ...lectures(charge.candles), chargement: charge.chargement };
  SERIES_PAR_CANDLES.set(charge.candles, s);
  return s;
}

// Les defs de position lisent ici les séries déjà calculées (le moteur ne passe que
// `candles`) ; une série inconnue est recalculée (compteur affiché : il doit rester à 0).
const SERIES_PAR_CANDLES = new WeakMap<Candle[], Serie>();
let recalculs = 0;
const serieDe = (candles: Candle[]): Serie => {
  let s = SERIES_PAR_CANDLES.get(candles);
  if (s === undefined) {
    recalculs++;
    s = { panel: "A", symbol: "?", ...lectures(candles), chargement: { fichier: "", sha256: "", acquisLeUtc: "", ecarteesCache: 0, invalidesLocales: 0 } };
    SERIES_PAR_CANDLES.set(candles, s);
  }
  return s;
};

/** Condition de tendance de la variante : base (close > EMA 200) ET filtre ; EMA indéfinie → indéfini. */
const tendanceDe = (s: Serie, v: Variante): Array<boolean | undefined> =>
  s.auDessus.map((a, i) => (a === undefined ? undefined : a && (v.filtre(s, i) ?? false)));

const positionsDe = (s: Serie, v: Variante): Array<number | undefined> =>
  positionsAxis(s.score, tendanceDe(s, v), v.seuil, SEUIL_VENTE, s.candles.length - 2);

/** Position du chart (prixSignal défini ⇔ achat affiché) pour des paramètres donnés. */
const positionChart = (candles: Candle[], params: Record<string, number | boolean>): number[] => {
  const prix = computeIndicator(stratAxis, candles, params).series.prixSignal ?? [];
  return candles.map((_c, i) => (prix[i] === undefined ? 0 : 1));
};

const egales = (a: Array<number | undefined>, b: number[]): number => {
  for (let i = 0; i < b.length; i++) if ((a[i] === 1 ? 1 : 0) !== b[i]) return i;
  return -1;
};

/** Contrôles de fidélité : v2 = positionsAxis = chart ; seuil-6 et flux-fort = réglages du chart. */
function controlerFidelite(s: Serie): void {
  const n = s.candles.length;
  const v2 = positionsDe(s, V2);
  const reference = positionsAxis(s.score, s.auDessus, SEUIL, SEUIL_VENTE, n - 2);
  for (let i = 0; i < n; i++) if (v2[i] !== reference[i]) throw new Error(`${s.symbol} : positions(v2) ≠ positionsAxis à l'indice ${i}`);
  const chart = positionChart(s.candles, {});
  let k = egales(v2, chart);
  if (k >= 0) throw new Error(`${s.symbol} : positions(v2) ≠ position du chart à l'indice ${k}`);
  k = egales(positionsDe(s, VARIANTES.find((v) => v.id === "seuil-6")!), positionChart(s.candles, { seuil: 6 }));
  if (k >= 0) throw new Error(`${s.symbol} : positions(seuil-6) ≠ chart (seuil = 6) à l'indice ${k}`);
  k = egales(positionsDe(s, VARIANTES.find((v) => v.id === "flux-fort")!), positionChart(s.candles, { filtreFlux: true }));
  if (k >= 0) throw new Error(`${s.symbol} : positions(flux-fort) ≠ chart (filtreFlux) à l'indice ${k}`);
}

// ─────────────────────────── Moteur ───────────────────────────

const idPosition = (v: Variante): string => `axisV4Position:${v.id}`;
for (const v of VARIANTES) {
  const id = idPosition(v);
  if (INDICATORS.some((d) => d.id === id)) continue;
  const def: IndicatorDef = {
    id,
    name: `AXIS v4 — position (${v.id})`,
    category: "strategy",
    pane: "overlay",
    inputs: [],
    outputs: [{ key: "position", name: "Position", style: "line" }],
    calc: (candles) => {
      const pos = positionsDe(serieDe(candles), v);
      return { series: { position: candles.map((_c, i) => (pos[i] === 1 ? 1 : 0)) } };
    },
  };
  INDICATORS.push(def);
}

const cst = (valeur: number): Operande => ({ type: "constante", valeur });
const strategieDe = (v: Variante): StrategieDef => {
  const position: Operande = { type: "indicateur", indicateurId: idPosition(v), params: {}, output: "position" };
  return {
    direction: "long",
    tailleFixe: TAILLE,
    reglesEntree: [{ type: "croisement", a: position, b: cst(0.5), sens: "hausse" }],
    reglesSortie: [{ type: "comparaison", gauche: position, comparateur: "<", droite: cst(0.5) }],
  };
};

const debutEvaluation = (s: Serie): number => s.candles[WARMUP]!.time;
/** Open de la première bougie de la seconde moitié de la fenêtre d'évaluation. */
const milieuEvaluation = (s: Serie): number => s.candles[WARMUP + Math.floor((s.candles.length - WARMUP) / 2)]!.time;

const executer = (s: Serie, strat: StrategieDef, cout: Cout): ResultatBacktest =>
  runBacktest(s.candles, strat, {
    fraisPct: cout.frais,
    slippagePct: cout.slippage,
    capitalInitial: CAPITAL,
    timeframe: TF,
    debutEvaluationMs: debutEvaluation(s),
    finDonneesMs: s.candles.at(-1)!.time + TF_MS,
  });

const chronologie = (trades: TradeResultat[]): string => trades.map((t) => `${t.tempsEntree}:${t.tempsSortie}:${t.raison}`).join("|");

/** Naissances de position aux décisions i ∈ [WARMUP−1, n−2] : un fill à i+1 ≥ WARMUP. */
function naissancesApresWarmup(pos: Array<number | undefined>): number {
  let k = 0;
  for (let i = WARMUP - 1; i <= pos.length - 2; i++) if (pos[i] === 1 && pos[i - 1] !== 1) k++;
  return k;
}

// ─────────────────────────── Métriques ───────────────────────────

function sharpeEquity(points: PointEquity[], debut: number, fin: number): number | null {
  const r: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    if (p.temps < debut || p.temps > fin) continue;
    const q = points[i - 1]!;
    if (q.equity > 0) r.push(p.equity / q.equity - 1);
  }
  if (r.length < 2) return null;
  const m = r.reduce((a, v) => a + v, 0) / r.length;
  const variance = r.reduce((a, v) => a + (v - m) * (v - m), 0) / (r.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return null;
  return (m / sd) * Math.sqrt(BOUGIES_4H_PAR_AN);
}

function drawdownEquity(points: PointEquity[], debut: number, fin: number): number {
  let pic = -Infinity;
  let dd = 0;
  for (const p of points) {
    if (p.temps < debut || p.temps > fin) continue;
    pic = Math.max(pic, p.equity);
    dd = Math.max(dd, pic - p.equity);
  }
  return dd;
}

const romadDe = (pnl: number, dd: number, trades: number): number | null => (dd > 0 ? pnl / dd : trades > 0 && pnl > 0 ? Infinity : null);

interface Plage { trades: number; pnlNet: number; ddMax: number; romad: number | null; sharpe: number | null; expectancyPct: number | null }
interface Metriques {
  trades: number;
  fermes: number;
  finDonnees: number;
  expectancyPct: number | null;
  pnlTotal: number;
  pnlTotalPct: number;
  winRatePct: number | null;
  profitFactor: number | null;
  ddMax: number;
  ddMaxPct: number;
  romad: number | null;
  sharpe: number | null;
  expositionPct: number;
  dureeMoyenneBarres: number | null;
  maeMoyenPct: number | null;
  fraisTotal: number;
  moities: [Plage, Plage];
}

function plage(r: ResultatBacktest, debut: number, fin: number): Plage {
  const ts = r.trades.filter((t) => t.tempsEntree >= debut && t.tempsEntree <= fin);
  const pnlNet = ts.reduce((a, t) => a + t.pnl, 0);
  const ddMax = drawdownEquity(r.equity, debut, fin);
  return {
    trades: ts.length, pnlNet, ddMax, romad: romadDe(pnlNet, ddMax, ts.length), sharpe: sharpeEquity(r.equity, debut, fin),
    expectancyPct: ts.length === 0 ? null : ts.reduce((a, t) => a + t.pnlPct, 0) / ts.length,
  };
}

function metriques(r: ResultatBacktest, s: Serie): Metriques {
  const trades = r.trades;
  const n = trades.length;
  const somme = (f: (t: TradeResultat) => number): number => trades.reduce((acc, t) => acc + f(t), 0);
  const gains = somme((t) => (t.pnl > 0 ? t.pnl : 0));
  const pertes = somme((t) => (t.pnl < 0 ? -t.pnl : 0));
  const debut = debutEvaluation(s);
  const milieu = milieuEvaluation(s);
  const dernier = s.candles.at(-1)!.time;
  const dd = drawdownEquity(r.equity, debut, dernier);
  const pnlTotal = somme((t) => t.pnl);
  return {
    trades: n,
    fermes: trades.filter((t) => t.raison === "regle").length,
    finDonnees: trades.filter((t) => t.raison === "fin-donnees").length,
    expectancyPct: n === 0 ? null : somme((t) => t.pnlPct) / n,
    pnlTotal,
    pnlTotalPct: (pnlTotal / CAPITAL) * 100,
    winRatePct: n === 0 ? null : (trades.filter((t) => t.pnl > 0).length / n) * 100,
    profitFactor: pertes > 0 ? gains / pertes : gains > 0 ? Infinity : null,
    ddMax: dd,
    ddMaxPct: (dd / CAPITAL) * 100,
    romad: romadDe(pnlTotal, dd, n),
    sharpe: sharpeEquity(r.equity, debut, dernier),
    expositionPct: r.stats.expositionPct,
    dureeMoyenneBarres: n === 0 ? null : somme((t) => t.dureeBarres) / n,
    maeMoyenPct: n === 0 ? null : r.stats.maeMoyenPct,
    fraisTotal: somme((t) => t.frais),
    moities: [plage(r, debut, milieu - 1), plage(r, milieu, dernier)],
  };
}

// ─────────────────────────── Agrégats et comparaisons à v2 ───────────────────────────

/** Parts de cellules comparables (Sharpe défini des deux côtés) où la variante bat v2. */
interface Parts {
  comparables: number;
  sharpeSuperieur: number;
  ddPlusFaible: number;
  pnlAuMoinsEgal: number;
  romadSuperieur: number;
  /** Cellules comparables où les deux expectancies sont définies. */
  comparablesExpectancy: number;
  expectancySuperieure: number;
}
interface ComparaisonV2 { fenetre: Parts; moitie1: Parts; moitie2: Parts }

function parts(variante: Plage[], reference: Plage[]): Parts {
  const p: Parts = { comparables: 0, sharpeSuperieur: 0, ddPlusFaible: 0, pnlAuMoinsEgal: 0, romadSuperieur: 0, comparablesExpectancy: 0, expectancySuperieure: 0 };
  variante.forEach((v, i) => {
    const r = reference[i]!;
    if (v.sharpe === null || r.sharpe === null) return;
    p.comparables++;
    if (v.sharpe > r.sharpe) p.sharpeSuperieur++;
    if (v.ddMax < r.ddMax) p.ddPlusFaible++;
    if (v.pnlNet >= r.pnlNet) p.pnlAuMoinsEgal++;
    if (v.romad !== null && r.romad !== null && v.romad > r.romad) p.romadSuperieur++;
    if (v.expectancyPct !== null && r.expectancyPct !== null) {
      p.comparablesExpectancy++;
      if (v.expectancyPct > r.expectancyPct) p.expectancySuperieure++;
    }
  });
  return p;
}

const plageFenetre = (m: Metriques): Plage => ({ trades: m.trades, pnlNet: m.pnlTotal, ddMax: m.ddMax, romad: m.romad, sharpe: m.sharpe, expectancyPct: m.expectancyPct });

interface Agregat {
  variante: string;
  cellules: number;
  trades: number;
  fermes: number;
  /** Trades clos regroupés / ceux de la v2 (même panel). */
  partFermesV2: number | null;
  expectancyRegroupeeX1: number | null;
  expectancyRegroupeeX3: number | null;
  pnlMoyenPct: number | null;
  medianePnlPct: number | null;
  medianeDdPct: number | null;
  medianeSharpe: number | null;
  medianeFermes: number | null;
  expositionMoyennePct: number | null;
  comparaison: ComparaisonV2;
}

type ParCout = Record<string, Metriques>;
type ParVariante = Record<string, ParCout>;
interface PanelMesure { panel: Panel; series: Serie[]; parCellule: Record<string, ParVariante>; agregats: Record<string, Agregat> }

function agreger(panel: Panel, series: Serie[], parCellule: Record<string, ParVariante>, tradesPct: Record<string, Record<string, number[]>>): Record<string, Agregat> {
  const cellules = series.map((s) => s.symbol);
  const x1 = (id: string, c: string): Metriques => parCellule[c]![id]!["x1"]!;
  const ref = cellules.map((c) => x1("v2", c));
  const fermesV2 = ref.reduce((a, m) => a + m.fermes, 0);
  const agregats: Record<string, Agregat> = {};
  for (const v of VARIANTES) {
    const ms = cellules.map((c) => x1(v.id, c));
    const fermes = ms.reduce((a, m) => a + m.fermes, 0);
    const regroupes = tradesPct[v.id] ?? {};
    agregats[v.id] = {
      variante: v.id,
      cellules: cellules.length,
      trades: ms.reduce((a, m) => a + m.trades, 0),
      fermes,
      partFermesV2: fermesV2 === 0 ? null : fermes / fermesV2,
      expectancyRegroupeeX1: moyenne(regroupes["x1"] ?? []),
      expectancyRegroupeeX3: moyenne(regroupes["x3"] ?? []),
      pnlMoyenPct: moyenne(ms.map((m) => m.pnlTotalPct)),
      medianePnlPct: mediane(ms.map((m) => m.pnlTotalPct)),
      medianeDdPct: mediane(ms.map((m) => m.ddMaxPct)),
      medianeSharpe: mediane(definis(ms.map((m) => m.sharpe))),
      medianeFermes: mediane(ms.map((m) => m.fermes)),
      expositionMoyennePct: moyenne(ms.map((m) => m.expositionPct)),
      comparaison: {
        fenetre: parts(ms.map(plageFenetre), ref.map(plageFenetre)),
        moitie1: parts(ms.map((m) => m.moities[0]), ref.map((m) => m.moities[0])),
        moitie2: parts(ms.map((m) => m.moities[1]), ref.map((m) => m.moities[1])),
      },
    };
  }
  if (panel === "B" && cellules.length !== 8) throw new Error(`panel B : ${cellules.length} cellules, 8 attendues`);
  return agregats;
}

function mesurerPanel(panel: Panel, series: Serie[]): PanelMesure {
  const tradesPct: Record<string, Record<string, number[]>> = {};
  const parCellule: Record<string, ParVariante> = {};
  let faites = 0;
  for (const s of series) {
    const parVariante: ParVariante = {};
    for (const v of VARIANTES) {
      const naissances = naissancesApresWarmup(positionsDe(s, v));
      const parCout: ParCout = {};
      let reference: string | null = null;
      for (const cout of COUTS) {
        const r = executer(s, strategieDe(v), cout);
        if (r.trades.length !== naissances) throw new Error(`${s.symbol} ${v.id} ${cout.id} : ${r.trades.length} trades pour ${naissances} naissances après warmup`);
        const chrono = chronologie(r.trades);
        if (reference === null) reference = chrono;
        else if (chrono !== reference) throw new Error(`${s.symbol} ${v.id} : fills différents entre x1 et ${cout.id}`);
        const m = metriques(r, s);
        if (m.fermes + m.finDonnees !== m.trades) throw new Error(`${s.symbol} ${v.id} : raisons de sortie inattendues`);
        if (m.moities[0].trades + m.moities[1].trades !== m.trades) throw new Error(`${s.symbol} ${v.id} : trades mal répartis entre moitiés`);
        parCout[cout.id] = m;
        ((tradesPct[v.id] ??= {})[cout.id] ??= []).push(...r.trades.map((t) => t.pnlPct));
      }
      parVariante[v.id] = parCout;
    }
    parCellule[s.symbol] = parVariante;
    faites++;
    process.stderr.write(`\r  … panel ${panel} : ${faites}/${series.length} cellules × ${VARIANTES.length} variantes × ${COUTS.length} coûts`);
  }
  process.stderr.write("\n");
  return { panel, series, parCellule, agregats: agreger(panel, series, parCellule, tradesPct) };
}

// ─────────────────────────── Règle de choix (fonction pure) ───────────────────────────

interface Conditions { eligible: boolean; fenetreA: boolean; moitiesA: [boolean, boolean]; majorsB: boolean }
interface Choix {
  metrique: "sharpe" | "expectancy";
  eligibles: string[];
  classement: Array<{ id: string; part: number | null; k: number; n: number; fermes: number }>;
  conditions: Record<string, Conditions>;
  retenue: string | null;
}

/** Part (k, n) de la métrique sur une plage ; `sharpe` : Sharpe > v2 ; `expectancy` : expectancy > v2. */
const partDe = (p: Parts, metrique: Choix["metrique"]): { k: number; n: number } =>
  metrique === "sharpe" ? { k: p.sharpeSuperieur, n: p.comparables } : { k: p.expectancySuperieure, n: p.comparablesExpectancy };

function choisir(A: Record<string, Agregat>, B: Record<string, Agregat>, metrique: Choix["metrique"]): Choix {
  const v2 = A["v2"]!;
  const conditions: Record<string, Conditions> = {};
  const eligibles: string[] = [];
  for (const v of VARIANTES) {
    if (v.id === "v2") continue;
    const a = A[v.id]!;
    const b = B[v.id]!;
    const eligible = (a.expectancyRegroupeeX3 ?? -Infinity) > 0 && a.fermes * 1e6 >= Math.round(PART_MIN_TRADES_V2 * 1e6) * v2.fermes;
    const f = partDe(a.comparaison.fenetre, metrique);
    const m1 = partDe(a.comparaison.moitie1, metrique);
    const m2 = partDe(a.comparaison.moitie2, metrique);
    const pb = partDe(b.comparaison.fenetre, metrique);
    conditions[v.id] = {
      eligible,
      fenetreA: atteint(f.k, f.n, PART_MIN_FENETRE, false),
      moitiesA: [atteint(m1.k, m1.n, PART_MIN_MOITIE, true), atteint(m2.k, m2.n, PART_MIN_MOITIE, true)],
      majorsB: pb.k >= MIN_MAJORS,
    };
    if (eligible) eligibles.push(v.id);
  }
  const valeur = (id: string): { part: number | null; k: number; n: number } => {
    const { k, n } = partDe(A[id]!.comparaison.fenetre, metrique);
    return { part: n === 0 ? null : k / n, k, n };
  };
  const classement = eligibles
    .map((id) => ({ id, ...valeur(id), fermes: A[id]!.fermes }))
    .sort((x, y) => {
      // Comparaison exacte des fractions k/n (produit en croix), puis trades clos, puis grille.
      const d = y.k * x.n - x.k * y.n;
      if (d !== 0) return d;
      if (x.fermes !== y.fermes) return y.fermes - x.fermes;
      return VARIANTES.find((v) => v.id === x.id)!.ordre - VARIANTES.find((v) => v.id === y.id)!.ordre;
    });
  const premiere = classement[0];
  const c = premiere === undefined ? undefined : conditions[premiere.id];
  const retenue = premiere !== undefined && c !== undefined && c.fenetreA && c.moitiesA[0] && c.moitiesA[1] && c.majorsB ? premiere.id : null;
  return { metrique, eligibles, classement, conditions, retenue };
}

// ─────────────────────────── Programme ───────────────────────────

function main(): void {
  mkdirSync(SORTIES, { recursive: true });
  const debutUtc = new Date().toISOString();
  process.stderr.write("Chargement des caches (aucun téléchargement), contrôles de fidélité :\n");
  const alts = symbolesAlts().map((symbol) => preparer("A", symbol, chargerAlt(symbol)));
  const majors = MAJORS.map((d) => preparer("B", d.symbol, chargerMajor(d)));
  for (const s of [...alts, ...majors]) controlerFidelite(s);
  process.stderr.write(`  ✓ panel A : ${alts.length} séries (${alts.reduce((a, s) => a + s.candles.length, 0)} bougies) ; panel B : ${majors.length} séries (${majors.reduce((a, s) => a + s.candles.length, 0)} bougies) ; fidélité v2 / seuil-6 / flux-fort OK\n`);

  const A = mesurerPanel("A", alts);
  const B = mesurerPanel("B", majors);
  if (recalculs !== 0) throw new Error(`${recalculs} recalculs de séries hors cache : les defs de position n'ont pas lu les séries préparées`);

  const choixSharpe = choisir(A.agregats, B.agregats, "sharpe");
  const choixExpectancy = choisir(A.agregats, B.agregats, "expectancy");
  const horodatage = new Date().toISOString();

  const decrireSerie = (s: Serie) => ({
    symbol: s.symbol, fichier: s.chargement.fichier, sha256: s.chargement.sha256, acquisLeUtc: s.chargement.acquisLeUtc,
    bougies: s.candles.length, premierOpen: iso(s.candles[0]!.time), derniereCloture: iso(s.candles.at(-1)!.time + TF_MS),
    ecarteesCache: s.chargement.ecarteesCache, invalidesLocales: s.chargement.invalidesLocales,
    debutEvaluation: iso(debutEvaluation(s)), milieuEvaluation: iso(milieuEvaluation(s)),
  });
  const resultat = {
    objet: "Exploration AXIS v4 (entrées) sur données DÉJÀ VUES — SANS VALEUR PROBANTE",
    debutUtc,
    genereLeUtc: horodatage,
    parametres: {
      timeframe: TF, warmupBougies: WARMUP, capitalInitial: CAPITAL, tailleFixe: TAILLE, seuil: SEUIL, seuilVente: SEUIL_VENTE, emaTendance: EMA_TENDANCE,
      rvolPeriode: RVOL_PERIODE, seuilRvolFort: SEUIL_RVOL_FORT, seuilOi: SEUIL_OI, couts: COUTS, bougies4hParAn: BOUGIES_4H_PAR_AN,
      regleDeChoix: {
        eligibilite: `panel A : expectancy nette regroupée x3 > 0 ET trades clos regroupés ≥ ${PART_MIN_TRADES_V2 * 100} % de ceux de la v2`,
        metrique: "panel A, x1 : part des cellules comparables (Sharpe défini des deux côtés) où Sharpe(variante) > Sharpe(v2), fenêtre entière",
        classement: "part décroissante ; égalité : trades clos regroupés décroissants, puis ordre de la grille",
        retenue: `première du classement si part ≥ ${PART_MIN_FENETRE * 100} % (panel A, fenêtre), > ${PART_MIN_MOITIE * 100} % dans chaque moitié (panel A) et ≥ ${MIN_MAJORS}/8 sur le panel B ; sinon aucune`,
        descriptif: "même sélection avec la part des cellules où l'expectancy nette par trade de la variante dépasse celle de la v2 (hors règle)",
      },
      variantes: VARIANTES.map((v) => ({ id: v.id, famille: v.famille, ordre: v.ordre, seuil: v.seuil, description: v.description })),
    },
    panels: {
      A: { nom: NOM_PANEL.A, caches: alts.map(decrireSerie), agregatsX1: A.agregats, cellules: A.parCellule },
      B: { nom: NOM_PANEL.B, caches: majors.map(decrireSerie), agregatsX1: B.agregats, cellules: B.parCellule },
    },
    choix: { regle: choixSharpe, descriptifExpectancy: choixExpectancy, coincide: choixSharpe.retenue === choixExpectancy.retenue },
  };
  writeFileSync(join(SORTIES, "resultat.json"), JSON.stringify(resultat, remplaceur, 2));
  writeFileSync(join(SORTIES, "rapport.md"), rapport(A, B, choixSharpe, choixExpectancy, horodatage));
  process.stderr.write(
    `\nVariante retenue par la règle (part Sharpe > v2, panel A) : ${choixSharpe.retenue ?? "aucune"} ; ` +
    `si la métrique portait sur l'expectancy par trade : ${choixExpectancy.retenue ?? "aucune"}\nSorties : ${SORTIES}/resultat.json, ${SORTIES}/rapport.md\n`
  );
  process.stdout.write(`${choixSharpe.retenue ?? "aucune"}\n`);
}

// ─────────────────────────── Rapport ───────────────────────────

const partsTexte = (p: Parts): string =>
  `${p.sharpeSuperieur}/${p.comparables} · ${p.ddPlusFaible}/${p.comparables} · ${p.pnlAuMoinsEgal}/${p.comparables} · ${p.expectancySuperieure}/${p.comparablesExpectancy} · ${p.romadSuperieur}/${p.comparables}`;

function tableAgregats(P: PanelMesure, choix: Choix): string {
  const retenue = choix.retenue;
  return tableau(
    ["Variante", "Trades (clos)", "Clos / v2", "Exp. x1 %", "Exp. x3 %", "PnL moyen / cell. %", "Méd. PnL %", "Méd. DD %", "Méd. Sharpe", "Méd. clos", "Expo %", "Fenêtre : Sharpe > · DD < · PnL ≥ · Exp. > · RoMaD >", "Moitié 1 : Sharpe >", "Moitié 2 : Sharpe >", "Éligible"],
    VARIANTES.map((v) => {
      const a = P.agregats[v.id]!;
      const c = a.comparaison;
      return [
        v.id === retenue ? `**${v.id}**` : v.id, `${a.trades} (${a.fermes})`, a.partFermesV2 === null ? "—" : pourcent(a.fermes, Math.round(a.fermes / a.partFermesV2)),
        fmt(a.expectancyRegroupeeX1, 2), fmt(a.expectancyRegroupeeX3, 2), fmt(a.pnlMoyenPct, 1), fmt(a.medianePnlPct, 1), fmt(a.medianeDdPct, 1), fmt(a.medianeSharpe, 2), fmt(a.medianeFermes, 0), fmt(a.expositionMoyennePct, 1),
        partsTexte(c.fenetre), `${c.moitie1.sharpeSuperieur}/${c.moitie1.comparables} (${pourcent(c.moitie1.sharpeSuperieur, c.moitie1.comparables)})`, `${c.moitie2.sharpeSuperieur}/${c.moitie2.comparables} (${pourcent(c.moitie2.sharpeSuperieur, c.moitie2.comparables)})`,
        v.id === "v2" ? "réf." : P.panel === "A" ? (choix.eligibles.includes(v.id) ? "oui" : "non") : "—",
      ];
    })
  );
}

function tableDetail(P: PanelMesure, id: string, cout: string): string {
  return tableau(
    ["Cellule", "Trades", "Clos", "Fin", "Exp. nette %", "PnL net", "PnL %", "Gagnants %", "PF", "DD %", "RoMaD", "Sharpe", "Expo %", "Durée (b.)", "MAE %", "PnL net 1re / 2e moitié (trades)", "Sharpe 1re / 2e moitié"],
    P.series.map((s) => {
      const m = P.parCellule[s.symbol]![id]![cout]!;
      return [
        s.symbol, m.trades, m.fermes, m.finDonnees, fmt(m.expectancyPct, 2), fmt(m.pnlTotal, 0), fmt(m.pnlTotalPct, 1), fmt(m.winRatePct, 0), fmt(m.profitFactor, 2), fmt(m.ddMaxPct, 1), fmt(m.romad, 2), fmt(m.sharpe, 2),
        fmt(m.expositionPct, 0), fmt(m.dureeMoyenneBarres, 0), fmt(m.maeMoyenPct, 2),
        `${fmt(m.moities[0].pnlNet, 0)} (${m.moities[0].trades}) / ${fmt(m.moities[1].pnlNet, 0)} (${m.moities[1].trades})`, `${fmt(m.moities[0].sharpe, 2)} / ${fmt(m.moities[1].sharpe, 2)}`,
      ];
    })
  );
}

/** v2 → variante, cellule par cellule (coûts x1). */
function tableFaceAFace(P: PanelMesure, id: string): string {
  return tableau(
    ["Cellule", "Trades", "Exp. nette %", "PnL %", "DD %", "Sharpe", "Expo %"],
    P.series.map((s) => {
      const a = P.parCellule[s.symbol]!["v2"]!["x1"]!;
      const b = P.parCellule[s.symbol]![id]!["x1"]!;
      return [
        s.symbol, `${a.trades} → ${b.trades}`, `${fmt(a.expectancyPct, 2)} → ${fmt(b.expectancyPct, 2)}`, `${fmt(a.pnlTotalPct, 1)} → ${fmt(b.pnlTotalPct, 1)}`,
        `${fmt(a.ddMaxPct, 1)} → ${fmt(b.ddMaxPct, 1)}`, `${fmt(a.sharpe, 2)} → ${fmt(b.sharpe, 2)}`, `${fmt(a.expositionPct, 0)} → ${fmt(b.expositionPct, 0)}`,
      ];
    })
  );
}

function texteChoix(choix: Choix, A: Record<string, Agregat>, B: Record<string, Agregat>): string[] {
  const conditionsTexte = (id: string): string => {
    const c = choix.conditions[id]!;
    const fa = partDe(A[id]!.comparaison.fenetre, choix.metrique);
    const m1 = partDe(A[id]!.comparaison.moitie1, choix.metrique);
    const m2 = partDe(A[id]!.comparaison.moitie2, choix.metrique);
    const pb = partDe(B[id]!.comparaison.fenetre, choix.metrique);
    return `fenêtre A ${fa.k}/${fa.n} (${pourcent(fa.k, fa.n)}, ≥ ${PART_MIN_FENETRE * 100} % : ${c.fenetreA ? "oui" : "non"}) ; moitiés A ${m1.k}/${m1.n} et ${m2.k}/${m2.n} (> ${PART_MIN_MOITIE * 100} % chacune : ${c.moitiesA[0] && c.moitiesA[1] ? "oui" : "non"}) ; panel B ${pb.k}/${pb.n} (≥ ${MIN_MAJORS} : ${c.majorsB ? "oui" : "non"})`;
  };
  const lignes = [
    `Variantes éligibles : ${choix.eligibles.length === 0 ? "aucune" : choix.eligibles.map((e) => `\`${e}\``).join(", ")}.`,
    "",
    `Classement (panel A, fenêtre) : ${choix.classement.length === 0 ? "—" : choix.classement.map((c) => `${c.id} ${c.k}/${c.n} (${pourcent(c.k, c.n)}, ${c.fermes} clos)`).join(", ")}.`,
    "",
  ];
  const premiere = choix.classement[0];
  if (premiere !== undefined) lignes.push(`Première du classement : \`${premiere.id}\` — ${conditionsTexte(premiere.id)}.`, "");
  lignes.push(
    choix.retenue === null
      ? "**Aucune variante retenue**" + (premiere === undefined ? " : aucune variante éligible." : " : la première du classement ne satisfait pas toutes les conditions de la règle.")
      : `**Variante retenue : \`${choix.retenue}\`** (toutes les conditions de la règle satisfaites).`
  );
  return lignes;
}

function rapport(A: PanelMesure, B: PanelMesure, choixSharpe: Choix, choixExpectancy: Choix, horodatage: string): string {
  const retenue = choixSharpe.retenue;
  const tableCaches = (P: PanelMesure): string =>
    tableau(
      ["Cellule", "Fichier", "SHA-256", "Bougies", "Premier open", "Dernière clôture", "Début d'évaluation", "Milieu (2e moitié dès)", "Écartées (cache) / invalides"],
      P.series.map((s) => [
        s.symbol, s.chargement.fichier, `\`${s.chargement.sha256.slice(0, 16)}…\``, s.candles.length, iso(s.candles[0]!.time), iso(s.candles.at(-1)!.time + TF_MS),
        iso(debutEvaluation(s)), iso(milieuEvaluation(s)), `${s.chargement.ecarteesCache} / ${s.chargement.invalidesLocales}`,
      ])
    );
  const tableConditions = (choix: Choix): string =>
    tableau(
      ["Variante", "Éligible (exp. x3 > 0, clos ≥ 50 % v2)", "Fenêtre A ≥ 60 %", "Moitié 1 A > 50 %", "Moitié 2 A > 50 %", "Panel B ≥ 5/8", "Toutes"],
      VARIANTES.filter((v) => v.id !== "v2").map((v) => {
        const c = choix.conditions[v.id]!;
        const oui = (b: boolean): string => (b ? "oui" : "non");
        return [v.id, oui(c.eligible), oui(c.fenetreA), oui(c.moitiesA[0]), oui(c.moitiesA[1]), oui(c.majorsB), oui(c.eligible && c.fenetreA && c.moitiesA[0] && c.moitiesA[1] && c.majorsB)];
      })
    );
  const sections = [
    "# AXIS v4 — exploration des entrées sur données DÉJÀ VUES",
    "",
    "**SANS VALEUR PROBANTE — données déjà vues, grille de 13 variantes.** Ce rapport sert uniquement à pré-déclarer UNE variante d'entrée pour le test sur données jamais vues (paires USDT cotées 2023-07 → 2025-06), selon la règle écrite dans l'en-tête de `scripts/explorer-axis-v4.ts` avant la première exécution. Si aucune variante n'est retenue, aucun test n'est lancé.",
    "",
    `Généré le ${horodatage}. Moteur \`runBacktest\` : jambe longue, taille fixe ${TAILLE}, capital ${CAPITAL}, warmup ${WARMUP} bougies, décision à la clôture, fill à l'open suivant. Coûts x1 = 0,05 % frais + 0,02 % slippage par côté ; x3 = 0,15 % + 0,06 %. Sortie commune : score ≤ −${SEUIL_VENTE}, sans stop. Drawdown : equity valorisée aux clôtures. Sharpe par bougie : rendements de l'equity par clôture, moyenne / écart-type (n−1) × √${BOUGIES_4H_PAR_AN}. Moitiés : frontière au milieu des décisions évaluées ; trades affectés par le fill d'entrée, drawdown et Sharpe sur les points d'equity de la moitié.`,
    "",
    "## Grille de variantes d'entrée",
    "",
    tableau(["Variante", "Famille", "Seuil de score", "Description"], VARIANTES.map((v) => [v.id, v.famille, v.seuil, v.description])),
    "",
    "## Règle de choix et résultat",
    "",
    `Éligibilité (panel A) : expectancy nette regroupée x3 > 0 ET trades clos regroupés ≥ ${PART_MIN_TRADES_V2 * 100} % de ceux de la v2. Métrique (panel A, x1) : part des cellules comparables où le Sharpe de la variante dépasse strictement celui de la v2, fenêtre entière. Classement : part décroissante, puis trades clos décroissants, puis ordre de la grille. Retenue : la première si part ≥ ${PART_MIN_FENETRE * 100} % (fenêtre A), > ${PART_MIN_MOITIE * 100} % dans chaque moitié (A) et ≥ ${MIN_MAJORS}/8 sur le panel B.`,
    "",
    ...texteChoix(choixSharpe, A.agregats, B.agregats),
    "",
    tableConditions(choixSharpe),
    "",
    "### Descriptif : si la métrique portait sur l'expectancy nette par trade (hors règle)",
    "",
    ...texteChoix(choixExpectancy, A.agregats, B.agregats),
    "",
    choixExpectancy.retenue === retenue ? "Les deux métriques **coïncident**." : "Les deux métriques **ne coïncident pas**.",
    "",
    `## Agrégats — panel ${NOM_PANEL.A} (coûts x1 ; expectancies regroupées x1 et x3)`,
    "",
    tableAgregats(A, choixSharpe),
    "",
    "Lecture des parts : cellules comparables (Sharpe défini pour la variante et la v2) où la variante fait mieux — Sharpe strictement supérieur · drawdown max plus faible · PnL net ≥ · expectancy nette par trade supérieure (les deux définies) · RoMaD supérieur. La ligne `v2` sert de témoin (0 partout).",
    "",
    `## Agrégats — panel ${NOM_PANEL.B} (coûts x1)`,
    "",
    tableAgregats(B, choixSharpe),
    "",
  ];
  const detaillees = [...new Set([retenue, choixExpectancy.retenue].filter((id): id is string => id !== null))];
  for (const id of detaillees) {
    sections.push(`## Face-à-face \`v2\` → \`${id}\`${id === retenue ? " (variante retenue)" : " (descriptif)"} — panel A (coûts x1)`, "", tableFaceAFace(A, id), "");
    sections.push(`## Face-à-face \`v2\` → \`${id}\` — panel B (coûts x1)`, "", tableFaceAFace(B, id), "");
  }
  sections.push("## Détail par cellule — `v2`, panel A (coûts x1)", "", tableDetail(A, "v2", "x1"), "");
  for (const id of detaillees) sections.push(`## Détail par cellule — \`${id}\`, panel A (coûts x1)`, "", tableDetail(A, id, "x1"), "", `## Détail par cellule — \`${id}\`, panel A (coûts x3)`, "", tableDetail(A, id, "x3"), "");
  sections.push("## Détail par cellule — `v2`, panel B (coûts x1)", "", tableDetail(B, "v2", "x1"), "");
  for (const id of detaillees) sections.push(`## Détail par cellule — \`${id}\`, panel B (coûts x1)`, "", tableDetail(B, id, "x1"), "");
  sections.push(
    "## Données (caches vérifiés par hash, aucun téléchargement)",
    "",
    `### Panel ${NOM_PANEL.A}`,
    "",
    tableCaches(A),
    "",
    `### Panel ${NOM_PANEL.B}`,
    "",
    tableCaches(B),
    "",
    "## Lecture",
    "",
    "Mesures PASSÉES sur des données déjà consommées par les campagnes AXIS (151 alts du test v3, 2023-07 → 2026-10 ; 8 grandes cryptos, 2017/2020 → 2026-10) : elles choisissent une variante, elles ne la valident pas. Seul le test sur données jamais vues, pré-déclaré, peut le faire. Contrôles passés : hash des 159 caches ; positions(v2) = positionsAxis = chart ; positions(seuil-6) = chart (seuil 6) ; positions(flux-fort) = chart (filtreFlux) ; trades du moteur = naissances après warmup à chaque coût ; mêmes fills à x1 et x3.",
    ""
  );
  return sections.join("\n");
}

main();
