#!/usr/bin/env bun
/**
 * AXIOM — exploration des sorties avec stop d'AXIS (« v3 ») sur données DÉJÀ VUES,
 * 8 octobre 2026.
 *
 * OBJET. AXIS v2 (stratAxis) a passé son test sur données jamais vues avec une
 * faiblesse documentée (docs/axis-2026-10-07.md, « Limites du test ») : taille fixe,
 * aucun stop, aucune gestion du risque, et pas mieux qu'une EMA 200 seule en PnL
 * total sur 3 actifs sur 4. Le propriétaire demande d'améliorer l'outil et de le
 * backtester. UNE variante de sortie avec stop sera testée sur des données jamais
 * vues ; ce script est l'exploration préalable qui la choisit, sur les SEULES données
 * déjà consommées par les campagnes AXIS, selon une règle écrite ci-dessous AVANT la
 * première exécution.
 *
 * DONNÉES (déjà vues, SANS VALEUR PROBANTE) : 8 séries 4h en cache local, vérifiées
 * par hash, jamais téléchargées ici (un cache absent ou non vérifiable = arrêt) :
 *   - E-{BTC,ETH,XRP,SOL}USDT-4h (cache d'exploration de la couche flux) ;
 *   - H-{BNB,ADA,LINK,DOGE}USDT-4h (cache de la campagne flux du 8 octobre 2026).
 * Les caches vont jusqu'au 2026-10-08 exclu. FENÊTRE LUE : après vérification du hash,
 * chaque série est tronquée aux bougies dont open + 4 h ≤ `--fin` (défaut
 * 2023-07-01T00:00:00Z ; `--fin complet` ou `--fin 2026-10-08T00:00:00Z` rejoue
 * l'historique entier). Le warmup reste 300 bougies ; debutEvaluationMs = open de la
 * bougie 300 de la série tronquée.
 *
 * ENTRÉE (identique pour toutes les variantes, jamais modifiée) : score ≥ seuil (5)
 * ET close > EMA 200, après armement ; décisions sur i ≤ n−2 ; une bougie à score
 * indéfini ou > fin reporte la position.
 *
 * GRILLE DE 13 VARIANTES DE SORTIE :
 *   - v2 : sortie si score ≤ −seuilVente (4) seulement (= AXIS actuel, référence) ;
 *   - atr-suiveur-k, k ∈ {2, 3, 4, 5} : stop suiveur à cliquet = plus haut close depuis
 *     l'entrée − k × ATR 14 (Wilder), ne descend jamais ; sortie si close < stop en
 *     vigueur (calculé sur les bougies ≤ i−1) OU score ≤ −4 ;
 *   - atr-initial-k, k ∈ {2, 3, 4} : stop fixe = close d'entrée − k × ATR14[entrée] ;
 *     sortie si close < stop OU score ≤ −4 ;
 *   - pct-suiveur-p, p ∈ {10, 15, 20} % : stop suiveur à cliquet = plus haut close
 *     depuis l'entrée × (1 − p) ; sortie si close < stop OU score ≤ −4 ;
 *   - tendance : sortie si close < EMA 200 OU score ≤ −4 ;
 *   - tendance-seule : sortie si close < EMA 200 SEULEMENT (score non lu en sortie).
 * Après une sortie par score, réentrée possible dès la bougie suivante (comme en v2) ;
 * après une sortie par stop ou tendance, la condition d'achat doit redevenir fausse
 * une fois (réarmement).
 * Référence HORS GRILLE : ema200-seule (long si close > EMA 200, à plat sinon ;
 * entrée au croisement haussier, sortie si close < EMA 200), comme `jambeEma` du
 * runner v2.
 *
 * EXÉCUTION : moteur `runBacktest` (décision à la clôture, fill à l'open suivant),
 * jambe longue, taille fixe 1000, capital 10 000, warmup 300 bougies
 * (debutEvaluationMs = open de la bougie 300), coûts x1 (0,05 % frais + 0,02 %
 * slippage par côté) et x3 (0,15 % + 0,06 %).
 *
 * RÈGLE DE CHOIX (pré-déclarée) : « La variante retenue pour le test sur données
 * jamais vues est celle qui maximise la MÉDIANE sur les 8 cellules du RoMaD (PnL net
 * total aux coûts x1 / drawdown max de l'equity valorisée aux clôtures), parmi les
 * variantes dont l'expectancy nette regroupée aux coûts x3 est > 0 et dont la médiane
 * des trades clos par cellule est ≥ 30. Égalité : la variante la plus simple (famille
 * tendance < atr-initial < atr-suiveur < pct-suiveur, puis k ou p le plus petit). Si
 * aucune variante ne dépasse `v2` sur cette médiane, l'exploration ne propose aucune
 * variante. »
 * Précision d'ordre pour l'égalité : `tendance-seule` et `tendance` forment la famille
 * tendance, `tendance-seule` (une seule condition) étant la plus simple des deux.
 *
 * MÉTRIQUE DESCRIPTIVE SUPPLÉMENTAIRE : Sharpe par bougie, depuis l'equity du moteur
 * (un point par clôture, plus le point initial) : rendements r_t = equity_t /
 * equity_{t−1} − 1 des points de la fenêtre d'évaluation (le premier rendement part du
 * dernier point qui la précède), Sharpe = moyenne(r) / écart-type(r, n−1) × √2191,5
 * (bougies 4h par an), `null` si l'écart-type est nul. Il ne fait PAS partie de la
 * règle de choix ; le script indique seulement quelle variante serait retenue si la
 * règle portait sur sa médiane. Par cellule et par moitié de la fenêtre d'évaluation,
 * les métriques (PnL net des trades entrés dans la moitié, drawdown max et Sharpe des
 * points d'equity de la moitié, RoMaD) sont comparées à `v2` ; une moitié sans trade
 * rend la cellule non comparable pour cette moitié.
 *
 * HISTORIQUE DES EXÉCUTIONS :
 *   1. Première exécution sur l'historique complet des caches (jusqu'au 2026-10-08
 *      exclu) : variante retenue par la règle `atr-suiveur-4`, RoMaD médian 4,56
 *      contre 4,39 pour v2 (sorties conservées dans /tmp/axis-v3-explo/complet/).
 *   2. Coupure de la fenêtre d'exploration au 2023-07-01, décidée par l'orchestrateur
 *      avant tout téléchargement de données de test : le test sur données jamais vues
 *      portera sur 2023-07-01 → 2026-10-08 (autres actifs), et cette période doit aussi
 *      rester hors échantillon en temps. Ajout de l'option `--fin` (défaut 2023-07-01)
 *      et du Sharpe par bougie comme métrique descriptive candidate pour le critère du
 *      test ; le choix de la métrique du test sera fait dans le manifeste, avant tout
 *      téléchargement. Grille et règle de choix inchangées.
 *
 * CONTRÔLES BLOQUANTS : hash des 8 caches ; ATR 14 défini partout où le score l'est ;
 * `positionsV3(…, "v2").pos` strictement égal à `positionsAxis` ET à la position
 * déduite de `stratAxis.calc().series.prixSignal` (sur la série tronquée) ; nombre de
 * trades du moteur = nombre de naissances de position après le warmup.
 *
 * Sorties : /tmp/axis-v3-explo/<fenêtre>/resultat.json et rapport.md, <fenêtre> =
 * `complet` ou `avant-AAAA-MM` — SANS VALEUR PROBANTE.
 * Usage : bun scripts/explorer-axis-v3.ts [--fin <ISO> | --fin complet]
 * Vérification : ./node_modules/.bin/tsc --noEmit --strict --noUncheckedIndexedAccess
 *   --target es2022 --module esnext --moduleResolution bundler --skipLibCheck --types node
 *   scripts/explorer-axis-v3.ts
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candle, IndicatorDef, Timeframe } from "../packages/types/src/index";
import { closeOf, ema, rma, trueRange } from "../packages/indicators/src/utils";
import { computeIndicator, INDICATORS } from "../packages/indicators/src/index";
import { positionsAxis, stratAxis, votesAxis } from "../packages/indicators/src/strategy/stratAxis";
import { runBacktest } from "../packages/backtest/src/engine";
import type { Operande, PointEquity, ResultatBacktest, StrategieDef, TradeResultat } from "../packages/backtest/src/types";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const RACINE_SORTIES = "/tmp/axis-v3-explo";
const CACHE = join(RACINE, "scripts/.cache-klines/axis-flux");
const FIN_CACHE = Date.parse("2026-10-08T00:00:00Z");
const FIN_DEFAUT = "2023-07-01T00:00:00Z";
const TF: Timeframe = "4h";
const TF_MS = 14_400_000;
const WARMUP = 300;
const CAPITAL = 10_000;
const TAILLE = 1000;
const SEUIL = 5;
const SEUIL_VENTE = 4;
const EMA_TENDANCE = 200;
const ATR_PERIODE = 14;
const MIN_TRADES_CLOS_MEDIAN = 30;
const BOUGIES_4H_PAR_AN = 2191.5;

// ─────────────────────────── Ligne de commande ───────────────────────────

function lireFin(args: string[]): number {
  let valeur = FIN_DEFAUT;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--fin") {
      const v = args[i + 1];
      if (v === undefined) throw new Error("usage : bun scripts/explorer-axis-v3.ts [--fin <ISO> | --fin complet]");
      valeur = v;
      i++;
    } else if (a.startsWith("--fin=")) {
      valeur = a.slice("--fin=".length);
    } else {
      throw new Error(`argument refusé : ${a} (usage : --fin <ISO> | --fin complet)`);
    }
  }
  if (valeur === "complet") return FIN_CACHE;
  const ms = Date.parse(valeur);
  if (!Number.isFinite(ms)) throw new Error(`--fin : date ISO invalide « ${valeur} »`);
  if (ms > FIN_CACHE) throw new Error(`--fin : au plus ${iso(FIN_CACHE)} (fin des caches)`);
  return ms;
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const iso = (ms: number): string => new Date(ms).toISOString();

/** Dossier de sortie : `complet`, `avant-AAAA-MM` pour un premier du mois à minuit, sinon `avant-AAAA-MM-JJ`. */
function nomFenetre(fin: number): string {
  if (fin === FIN_CACHE) return "complet";
  const d = iso(fin);
  return d.endsWith("-01T00:00:00.000Z") ? `avant-${d.slice(0, 7)}` : `avant-${d.slice(0, 10)}`;
}

const FIN = lireFin(process.argv.slice(2));
const DOSSIER_FENETRE = nomFenetre(FIN);
const SORTIES = join(RACINE_SORTIES, DOSSIER_FENETRE);

interface Cout { id: string; frais: number; slippage: number }
const COUTS: Cout[] = [
  { id: "x1", frais: 0.05, slippage: 0.02 },
  { id: "x3", frais: 0.15, slippage: 0.06 },
];

interface CelluleDef { symbol: string; fichier: string; enveloppe: "exploration" | "campagne" }
const CELLULES: CelluleDef[] = [
  { symbol: "BTCUSDT", fichier: "E-BTCUSDT-4h.json", enveloppe: "exploration" },
  { symbol: "ETHUSDT", fichier: "E-ETHUSDT-4h.json", enveloppe: "exploration" },
  { symbol: "XRPUSDT", fichier: "E-XRPUSDT-4h.json", enveloppe: "exploration" },
  { symbol: "SOLUSDT", fichier: "E-SOLUSDT-4h.json", enveloppe: "exploration" },
  { symbol: "BNBUSDT", fichier: "H-BNBUSDT-4h.json", enveloppe: "campagne" },
  { symbol: "ADAUSDT", fichier: "H-ADAUSDT-4h.json", enveloppe: "campagne" },
  { symbol: "LINKUSDT", fichier: "H-LINKUSDT-4h.json", enveloppe: "campagne" },
  { symbol: "DOGEUSDT", fichier: "H-DOGEUSDT-4h.json", enveloppe: "campagne" },
];

// ─────────────────────────── Variantes ───────────────────────────

type Famille = "v2" | "tendance" | "atr-initial" | "atr-suiveur" | "pct-suiveur";
interface Variante {
  id: string;
  famille: Famille;
  /** Multiplicateur d'ATR (familles atr-*). */
  k?: number;
  /** Retrait en fraction (pct-suiveur) : 0,10 pour 10 %. */
  p?: number;
  /** Rang de simplicité pour l'égalité (plus petit = plus simple). */
  simplicite: number;
  description: string;
}

const VARIANTES: Variante[] = [
  { id: "v2", famille: "v2", simplicite: 0, description: "sortie si score ≤ −4 (référence)" },
  { id: "tendance-seule", famille: "tendance", simplicite: 1, description: "sortie si close < EMA 200 seulement" },
  { id: "tendance", famille: "tendance", simplicite: 2, description: "sortie si close < EMA 200 ou score ≤ −4" },
  ...[2, 3, 4].map((k): Variante => ({ id: `atr-initial-${k}`, famille: "atr-initial", k, simplicite: 10 + k, description: `stop fixe = entrée − ${k}×ATR14 ; sortie si close < stop ou score ≤ −4` })),
  ...[2, 3, 4, 5].map((k): Variante => ({ id: `atr-suiveur-${k}`, famille: "atr-suiveur", k, simplicite: 20 + k, description: `stop suiveur = plus haut close − ${k}×ATR14 (cliquet) ; sortie si close < stop ou score ≤ −4` })),
  ...[10, 15, 20].map((p): Variante => ({ id: `pct-suiveur-${p}`, famille: "pct-suiveur", p: p / 100, simplicite: 30 + p, description: `stop suiveur = plus haut close × (1 − ${p} %) (cliquet) ; sortie si close < stop ou score ≤ −4` })),
];
const ID_EMA_SEULE = "ema200-seule";
/** Variante retenue par la première exécution (historique complet) : toujours détaillée. */
const ID_PREMIERE_RETENUE = "atr-suiveur-4";

if (VARIANTES.length !== 13) throw new Error(`grille de ${VARIANTES.length} variantes, 13 attendues`);

// ─────────────────────────── Utilitaires ───────────────────────────

const fmt = (v: number | null | undefined, d = 2): string =>
  v === null || v === undefined ? "—" : v === Infinity ? "∞" : v === -Infinity ? "−∞" : Number.isFinite(v) ? v.toFixed(d) : "—";
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

/** JSON : les non-finis deviennent des chaînes explicites (RoMaD à drawdown nul). */
const remplaceur = (_k: string, v: unknown): unknown =>
  typeof v === "number" && !Number.isFinite(v) ? (v === Infinity ? "Infinity" : v === -Infinity ? "-Infinity" : "NaN") : v;

// ─────────────────────────── Données (cache seul, vérifié par hash) ───────────────────────────

interface BougieEcartee { temps: string; raison: string }
interface Chargement {
  candles: Candle[];
  sha256: string;
  acquisLeUtc: string;
  ecarteesCache: number;
  invalidesLocales: number;
  /** Bougies du cache (valides) écartées par la troncature à `--fin`. */
  tronquees: number;
}

function raisonInvalide(c: Candle): string | null {
  if (![c.time, c.open, c.high, c.low, c.close, c.volume].every((v) => typeof v === "number" && Number.isFinite(v))) return "OHLCV non fini";
  if (c.open <= 0 || c.close <= 0 || c.low <= 0) return "prix ≤ 0";
  if (c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close)) return "high/low incohérents";
  return null;
}

function charger(def: CelluleDef): Chargement {
  const fichier = join(CACHE, def.fichier);
  if (!existsSync(fichier)) throw new Error(`cache absent : ${fichier} (aucun téléchargement dans cette exploration)`);
  const env = JSON.parse(readFileSync(fichier, "utf8")) as {
    sha256: string; acquisLeUtc?: string; candles: Candle[]; ecartees?: BougieEcartee[];
  };
  if (!Array.isArray(env.candles) || typeof env.sha256 !== "string") throw new Error(`cache ${fichier} : enveloppe inattendue`);
  // Même empreinte que le script qui a écrit chaque cache : candles seules pour
  // l'exploration, { candles, ecartees } pour la campagne (valider-axis-flux.ts).
  const empreinte = def.enveloppe === "exploration"
    ? sha256(JSON.stringify(env.candles))
    : Array.isArray(env.ecartees) ? sha256(JSON.stringify({ candles: env.candles, ecartees: env.ecartees })) : "";
  if (empreinte !== env.sha256) throw new Error(`cache ${fichier} non traçable (hash ${empreinte.slice(0, 12)}… ≠ ${env.sha256.slice(0, 12)}…)`);
  const valides = env.candles.filter((c) => raisonInvalide(c) === null && c.time + TF_MS <= FIN_CACHE);
  // Troncature APRÈS vérification du hash : le cache ne change pas, seule la fenêtre lue.
  const candles = valides.filter((c) => c.time + TF_MS <= FIN);
  for (let i = 1; i < candles.length; i++) if (!(candles[i]!.time > candles[i - 1]!.time)) throw new Error(`${def.symbol} : série non strictement croissante`);
  if (candles.length <= WARMUP + 2) throw new Error(`${def.symbol} : série trop courte (${candles.length} bougies avant ${iso(FIN)})`);
  return {
    candles,
    sha256: env.sha256,
    acquisLeUtc: env.acquisLeUtc ?? "—",
    ecarteesCache: env.ecartees?.length ?? 0,
    invalidesLocales: env.candles.length - valides.length,
    tronquees: valides.length - candles.length,
  };
}

// ─────────────────────────── Positions v3 (fonction pure) ───────────────────────────

type Raison = "score" | "stop";
interface PositionsV3 { pos: Array<number | undefined>; stop: Array<number | undefined>; raisons: Map<number, Raison> }

/**
 * Position long/plat par bougie selon la variante de sortie. Entrée identique à
 * `positionsAxis` (score ≥ seuil ET close > EMA de tendance, après armement). Le stop
 * en vigueur à la bougie i a été fixé sur les bougies ≤ i−1 ; il est mis à jour après
 * la décision. `raisons` : indice de chaque bougie de sortie → "score" | "stop" (la
 * sortie par EMA 200 des variantes tendance compte comme "stop"). PURE.
 */
export function positionsV3(
  candles: Candle[],
  score: Array<number | undefined>,
  ema200: Array<number | undefined>,
  atr14: Array<number | undefined>,
  seuil: number,
  seuilVente: number,
  fin: number,
  variante: Variante
): PositionsV3 {
  const n = candles.length;
  const pos: Array<number | undefined> = new Array(n).fill(undefined);
  const stop: Array<number | undefined> = new Array(n).fill(undefined);
  const raisons = new Map<number, Raison>();
  let p: number | undefined;
  let arme = false;
  let plusHaut = -Infinity;
  let stopCourant: number | undefined;
  const aStop = variante.famille === "atr-initial" || variante.famille === "atr-suiveur" || variante.famille === "pct-suiveur";
  const niveau = (base: number, i: number): number | undefined => {
    if (variante.famille === "atr-initial" || variante.famille === "atr-suiveur") {
      const a = atr14[i];
      if (a === undefined) throw new Error(`ATR indéfini à l'indice ${i} alors que le score est défini`);
      return base - variante.k! * a;
    }
    if (variante.famille === "pct-suiveur") return base * (1 - variante.p!);
    return undefined;
  };

  for (let i = 0; i < n; i++) {
    const s = score[i];
    const close = candles[i]!.close;
    if (s === undefined || i > fin) {
      pos[i] = p;
      stop[i] = p === 1 ? stopCourant : undefined;
      continue;
    }
    if (p === 1) {
      const sortieScore = s <= -seuilVente;
      const e = ema200[i];
      const sortieStop = aStop
        ? stopCourant !== undefined && close < stopCourant
        : variante.famille === "tendance" ? e !== undefined && close < e : false;
      const sortie = variante.id === "tendance-seule" ? sortieStop : sortieScore || sortieStop;
      if (sortie) {
        p = 0;
        arme = sortieScore;
        raisons.set(i, sortieScore ? "score" : "stop");
        stop[i] = undefined;
        stopCourant = undefined;
      } else {
        plusHaut = Math.max(plusHaut, close);
        if (variante.famille === "atr-suiveur" || variante.famille === "pct-suiveur") {
          const candidat = niveau(plusHaut, i)!;
          stopCourant = stopCourant === undefined ? candidat : Math.max(stopCourant, candidat);
        }
        stop[i] = stopCourant;
      }
      pos[i] = p;
      continue;
    }
    p = 0;
    const e = ema200[i];
    if (e !== undefined) {
      const achat = s >= seuil && close > e;
      if (achat && arme) {
        p = 1;
        plusHaut = close;
        stopCourant = niveau(close, i);
        stop[i] = stopCourant;
      }
      arme = !achat;
    }
    pos[i] = p;
  }
  return { pos, stop, raisons };
}

// ─────────────────────────── Préparation par cellule ───────────────────────────

interface Serie {
  symbol: string;
  candles: Candle[];
  score: Array<number | undefined>;
  ema200: Array<number | undefined>;
  atr14: Array<number | undefined>;
  chargement: Chargement;
}

const PARAMS_AXIS = { seuil: SEUIL, seuilVente: SEUIL_VENTE, emaTendance: EMA_TENDANCE };

function preparer(def: CelluleDef): Serie {
  const chargement = charger(def);
  const candles = chargement.candles;
  const votes = votesAxis(candles, PARAMS_AXIS);
  const score = votes.map((v) => v?.reduce((a, b) => a + b, 0));
  const ema200 = ema(closeOf(candles), EMA_TENDANCE);
  const atr14 = rma(trueRange(candles), ATR_PERIODE);
  for (let i = 0; i < candles.length; i++) {
    if (score[i] !== undefined && atr14[i] === undefined) throw new Error(`${def.symbol} : ATR 14 indéfini à ${i} alors que le score est défini`);
  }
  return { symbol: def.symbol, candles, score, ema200, atr14, chargement };
}

// Les defs de position lisent ici les séries déjà calculées (le moteur ne passe que
// `candles`) ; une série inconnue est recalculée, ce qui garde la def autonome.
const SERIES_PAR_CANDLES = new WeakMap<Candle[], Serie>();
const serieDe = (candles: Candle[]): Serie => {
  let s = SERIES_PAR_CANDLES.get(candles);
  if (s === undefined) {
    const votes = votesAxis(candles, PARAMS_AXIS);
    s = {
      symbol: "?",
      candles,
      score: votes.map((v) => v?.reduce((a, b) => a + b, 0)),
      ema200: ema(closeOf(candles), EMA_TENDANCE),
      atr14: rma(trueRange(candles), ATR_PERIODE),
      chargement: { candles, sha256: "", acquisLeUtc: "", ecarteesCache: 0, invalidesLocales: 0, tronquees: 0 },
    };
    SERIES_PAR_CANDLES.set(candles, s);
  }
  return s;
};

const positionsDe = (s: Serie, v: Variante): PositionsV3 =>
  positionsV3(s.candles, s.score, s.ema200, s.atr14, SEUIL, SEUIL_VENTE, s.candles.length - 2, v);

/** Contrôle de fidélité : la variante v2 reproduit exactement AXIS (positionsAxis et chart). */
function controlerFidelite(s: Serie): void {
  const n = s.candles.length;
  const v2 = VARIANTES.find((v) => v.id === "v2")!;
  const nous = positionsDe(s, v2).pos;
  const closes = closeOf(s.candles);
  const auDessus = s.ema200.map((t, i) => (t === undefined ? undefined : closes[i]! > t));
  const reference = positionsAxis(s.score, auDessus, SEUIL, SEUIL_VENTE, n - 2);
  if (reference.length !== n || nous.length !== n) throw new Error(`${s.symbol} : longueurs de positions incohérentes`);
  for (let i = 0; i < n; i++) {
    if (nous[i] !== reference[i]) throw new Error(`${s.symbol} : positionsV3(v2) ≠ positionsAxis à l'indice ${i} (${nous[i]} vs ${reference[i]})`);
  }
  const prix = computeIndicator(stratAxis, s.candles).series.prixSignal ?? [];
  for (let i = 0; i < n; i++) {
    const chart = prix[i] === undefined ? 0 : 1;
    if ((nous[i] === 1 ? 1 : 0) !== chart) throw new Error(`${s.symbol} : positionsV3(v2) ≠ position du chart (prixSignal) à l'indice ${i}`);
  }
}

// ─────────────────────────── Moteur ───────────────────────────

const idPosition = (v: Variante): string => `axisV3Position:${v.id}`;
for (const v of VARIANTES) {
  const id = idPosition(v);
  if (INDICATORS.some((d) => d.id === id)) continue;
  const def: IndicatorDef = {
    id,
    name: `AXIS v3 — position (${v.id})`,
    category: "strategy",
    pane: "overlay",
    inputs: [],
    outputs: [{ key: "position", name: "Position", style: "line" }],
    calc: (candles) => {
      const pos = positionsDe(serieDe(candles), v).pos;
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
const close: Operande = { type: "prix", champ: "close" };
const emaReference: Operande = { type: "indicateur", indicateurId: "ema", params: { length: EMA_TENDANCE }, output: "ema" };
const JAMBE_EMA: StrategieDef = {
  direction: "long",
  tailleFixe: TAILLE,
  reglesEntree: [{ type: "croisement", a: close, b: emaReference, sens: "hausse" }],
  reglesSortie: [{ type: "comparaison", gauche: close, comparateur: "<", droite: emaReference }],
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

// ─────────────────────────── Métriques ───────────────────────────

/**
 * Sharpe par bougie sur les points d'equity de `[debut, fin]` : chaque rendement part
 * du point précédent dans la série complète (le premier, du dernier point avant la
 * fenêtre). `null` si moins de deux rendements ou écart-type nul.
 */
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

/** Drawdown max (cotation) des points d'equity de `[debut, fin]`, pic repris au premier point de la plage. */
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

/** Métriques d'une plage de la fenêtre d'évaluation (fenêtre entière ou moitié). */
interface Bloc {
  debut: string;
  fin: string;
  /** Trades entrés dans la plage (fill d'entrée dans `[debut, fin]`). */
  trades: number;
  pnlNet: number;
  pnlHorsFrais: number;
  ddMax: number;
  /** `null` sans trade ; Infinity si drawdown nul avec des trades. */
  romad: number | null;
  sharpe: number | null;
}

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
  romad: number;
  sharpe: number | null;
  expositionPct: number;
  dureeMoyenneBarres: number | null;
  maeMoyenPct: number | null;
  fraisTotal: number;
  pnlHorsFrais: number;
  sortiesScore: number;
  sortiesStop: number;
  moities: [Bloc, Bloc];
}

function bloc(r: ResultatBacktest, debut: number, fin: number): Bloc {
  const ts = r.trades.filter((t) => t.tempsEntree >= debut && t.tempsEntree <= fin);
  const pnlNet = ts.reduce((a, t) => a + t.pnl, 0);
  const ddMax = drawdownEquity(r.equity, debut, fin);
  return {
    debut: iso(debut),
    fin: iso(fin),
    trades: ts.length,
    pnlNet,
    pnlHorsFrais: ts.reduce((a, t) => a + t.pnl + t.frais, 0),
    ddMax,
    romad: ts.length === 0 ? null : ddMax > 0 ? pnlNet / ddMax : Infinity,
    sharpe: sharpeEquity(r.equity, debut, fin),
  };
}

function metriques(r: ResultatBacktest, s: Serie, raisons: Map<number, Raison> | null): Metriques {
  const trades = r.trades;
  const n = trades.length;
  const somme = (f: (t: TradeResultat) => number) => trades.reduce((acc, t) => acc + f(t), 0);
  const gains = somme((t) => (t.pnl > 0 ? t.pnl : 0));
  const pertes = somme((t) => (t.pnl < 0 ? -t.pnl : 0));
  const debut = debutEvaluation(s);
  const milieu = milieuEvaluation(s);
  const dernier = s.candles.at(-1)!.time;
  const dd = drawdownEquity(r.equity, debut, dernier);
  const pnlTotal = somme((t) => t.pnl);
  let sortiesScore = 0;
  let sortiesStop = 0;
  if (raisons !== null) {
    for (const [i, raison] of raisons) {
      if (i < WARMUP - 1) continue;
      if (raison === "score") sortiesScore++;
      else sortiesStop++;
    }
  }
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
    ddMaxPct: r.stats.maxDrawdownPct,
    romad: dd > 0 ? pnlTotal / dd : Infinity,
    sharpe: sharpeEquity(r.equity, debut, dernier),
    expositionPct: r.stats.expositionPct,
    dureeMoyenneBarres: n === 0 ? null : somme((t) => t.dureeBarres) / n,
    maeMoyenPct: n === 0 ? null : r.stats.maeMoyenPct,
    fraisTotal: somme((t) => t.frais),
    pnlHorsFrais: somme((t) => t.pnl + t.frais),
    sortiesScore,
    sortiesStop,
    moities: [bloc(r, debut, milieu - 1), bloc(r, milieu, dernier)],
  };
}

/** Naissances de position aux décisions i ∈ [WARMUP−1, n−2] : un fill à i+1 ≥ WARMUP. */
function naissancesApresWarmup(pos: Array<number | undefined>): number {
  let k = 0;
  // Même lecture que la def de position du moteur : indéfini vaut 0.
  for (let i = WARMUP - 1; i <= pos.length - 2; i++) if (pos[i] === 1 && pos[i - 1] !== 1) k++;
  return k;
}

// ─────────────────────────── Agrégats et comparaisons à v2 ───────────────────────────

interface Agregat {
  variante: string;
  medianePnlPct: number | null;
  moyennePnlPct: number | null;
  medianeRomad: number | null;
  moyenneRomad: number | null;
  medianeDdPct: number | null;
  moyenneDdPct: number | null;
  medianeExpectancyPct: number | null;
  moyenneExpectancyPct: number | null;
  medianeSharpe: number | null;
  moyenneSharpe: number | null;
  batV2Romad: number;
  batV2Pnl: number;
  batV2Dd: number;
  batV2Sharpe: number;
  expectancyRegroupeeX1: number | null;
  expectancyRegroupeeX3: number | null;
  tradesRegroupesX1: number;
  medianeFermes: number | null;
  sortiesScore: number;
  sortiesStop: number;
}

/** Parts de cellules où la variante fait mieux que v2 sur une plage (fenêtre ou moitié). */
interface Parts {
  /** Cellules où la variante ET v2 ont au moins un trade dans la plage. */
  comparables: number;
  /** Cellules comparables où les deux Sharpe sont définis. */
  comparablesSharpe: number;
  ddPlusFaible: number;
  pnlAuMoinsEgal: number;
  sharpeSuperieur: number;
  romadSuperieur: number;
}
interface ComparaisonV2 { fenetre: Parts; moitie1: Parts; moitie2: Parts }

interface Plage { trades: number; pnlNet: number; ddMax: number; romad: number | null; sharpe: number | null }
const plageFenetre = (m: Metriques): Plage => ({ trades: m.trades, pnlNet: m.pnlTotal, ddMax: m.ddMax, romad: m.romad, sharpe: m.sharpe });
const plageMoitie = (m: Metriques, h: 0 | 1): Plage => {
  const b = m.moities[h];
  return { trades: b.trades, pnlNet: b.pnlNet, ddMax: b.ddMax, romad: b.romad, sharpe: b.sharpe };
};

function parts(variante: Plage[], reference: Plage[]): Parts {
  const p: Parts = { comparables: 0, comparablesSharpe: 0, ddPlusFaible: 0, pnlAuMoinsEgal: 0, sharpeSuperieur: 0, romadSuperieur: 0 };
  variante.forEach((v, i) => {
    const r = reference[i]!;
    if (v.trades === 0 || r.trades === 0) return;
    p.comparables++;
    if (v.ddMax < r.ddMax) p.ddPlusFaible++;
    if (v.pnlNet >= r.pnlNet) p.pnlAuMoinsEgal++;
    if (v.romad !== null && r.romad !== null && v.romad > r.romad) p.romadSuperieur++;
    if (v.sharpe !== null && r.sharpe !== null) {
      p.comparablesSharpe++;
      if (v.sharpe > r.sharpe) p.sharpeSuperieur++;
    }
  });
  return p;
}

// ─────────────────────────── Programme ───────────────────────────

type ParCout = Record<string, Metriques>;
type ParVariante = Record<string, ParCout>;

function main(): void {
  mkdirSync(SORTIES, { recursive: true });
  process.stderr.write(`Fenêtre lue : bougies closes au plus tard le ${iso(FIN)} (${DOSSIER_FENETRE}). Chargement des caches (aucun téléchargement) :\n`);
  const series = CELLULES.map((def) => {
    const s = preparer(def);
    controlerFidelite(s);
    process.stderr.write(
      `  ✓ ${s.symbol} : ${s.candles.length} bougies, ${iso(s.candles[0]!.time)} → ${iso(s.candles.at(-1)!.time + TF_MS)}, ` +
      `sha256 ${s.chargement.sha256.slice(0, 12)}…, écartées (cache) ${s.chargement.ecarteesCache}, invalides locales ${s.chargement.invalidesLocales}, ` +
      `tronquées ${s.chargement.tronquees}, fidélité v2 OK\n`
    );
    return s;
  });

  // Exécution : cellule × variante × coûts, plus la référence EMA 200 seule.
  const tradesRegroupes: Record<string, Record<string, number[]>> = {};
  const parCellule: Record<string, ParVariante> = {};
  for (const s of series) {
    const parVariante: ParVariante = {};
    for (const v of VARIANTES) {
      const positions = positionsDe(s, v);
      const naissances = naissancesApresWarmup(positions.pos);
      const parCout: ParCout = {};
      for (const cout of COUTS) {
        const r = executer(s, strategieDe(v), cout);
        if (r.trades.length !== naissances) {
          throw new Error(`${s.symbol} ${v.id} ${cout.id} : ${r.trades.length} trades pour ${naissances} naissances après warmup`);
        }
        const m = metriques(r, s, positions.raisons);
        if (m.fermes + m.finDonnees !== m.trades) throw new Error(`${s.symbol} ${v.id} : raisons de sortie inattendues`);
        if (m.moities[0].trades + m.moities[1].trades !== m.trades) throw new Error(`${s.symbol} ${v.id} : trades mal répartis entre moitiés`);
        parCout[cout.id] = m;
        ((tradesRegroupes[v.id] ??= {})[cout.id] ??= []).push(...r.trades.map((t) => t.pnlPct));
      }
      parVariante[v.id] = parCout;
    }
    const parCoutEma: ParCout = {};
    for (const cout of COUTS) {
      const r = executer(s, JAMBE_EMA, cout);
      parCoutEma[cout.id] = metriques(r, s, null);
      ((tradesRegroupes[ID_EMA_SEULE] ??= {})[cout.id] ??= []).push(...r.trades.map((t) => t.pnlPct));
    }
    parVariante[ID_EMA_SEULE] = parCoutEma;
    parCellule[s.symbol] = parVariante;
    process.stderr.write(`  · ${s.symbol} : ${VARIANTES.length} variantes + ${ID_EMA_SEULE} exécutées\n`);
  }

  // Agrégats par variante (coûts x1) et comparaisons à v2.
  const ids = [...VARIANTES.map((v) => v.id), ID_EMA_SEULE];
  const cellules = series.map((s) => s.symbol);
  const x1 = (id: string, c: string): Metriques => parCellule[c]![id]!["x1"]!;
  const agregats: Record<string, Agregat> = {};
  const comparaisons: Record<string, ComparaisonV2> = {};
  const ref = cellules.map((c) => x1("v2", c));
  for (const id of ids) {
    const ms = cellules.map((c) => x1(id, c));
    const regroupes = tradesRegroupes[id] ?? {};
    const expReg = (cout: string): number | null => moyenne(regroupes[cout] ?? []);
    const sharpes = definis(ms.map((m) => m.sharpe));
    agregats[id] = {
      variante: id,
      medianePnlPct: mediane(ms.map((m) => m.pnlTotalPct)),
      moyennePnlPct: moyenne(ms.map((m) => m.pnlTotalPct)),
      medianeRomad: mediane(ms.map((m) => m.romad)),
      moyenneRomad: moyenne(ms.map((m) => m.romad)),
      medianeDdPct: mediane(ms.map((m) => m.ddMaxPct)),
      moyenneDdPct: moyenne(ms.map((m) => m.ddMaxPct)),
      medianeExpectancyPct: mediane(definis(ms.map((m) => m.expectancyPct))),
      moyenneExpectancyPct: moyenne(definis(ms.map((m) => m.expectancyPct))),
      medianeSharpe: mediane(sharpes),
      moyenneSharpe: moyenne(sharpes),
      batV2Romad: ms.filter((m, i) => m.romad > ref[i]!.romad).length,
      batV2Pnl: ms.filter((m, i) => m.pnlTotal > ref[i]!.pnlTotal).length,
      batV2Dd: ms.filter((m, i) => m.ddMax < ref[i]!.ddMax).length,
      batV2Sharpe: ms.filter((m, i) => m.sharpe !== null && ref[i]!.sharpe !== null && m.sharpe > ref[i]!.sharpe!).length,
      expectancyRegroupeeX1: expReg("x1"),
      expectancyRegroupeeX3: expReg("x3"),
      tradesRegroupesX1: (regroupes["x1"] ?? []).length,
      medianeFermes: mediane(ms.map((m) => m.fermes)),
      sortiesScore: ms.reduce((a, m) => a + m.sortiesScore, 0),
      sortiesStop: ms.reduce((a, m) => a + m.sortiesStop, 0),
    };
    comparaisons[id] = {
      fenetre: parts(ms.map(plageFenetre), ref.map(plageFenetre)),
      moitie1: parts(ms.map((m) => plageMoitie(m, 0)), ref.map((m) => plageMoitie(m, 0))),
      moitie2: parts(ms.map((m) => plageMoitie(m, 1)), ref.map((m) => plageMoitie(m, 1))),
    };
  }

  // Règle de choix pré-déclarée (RoMaD médian) ; en descriptif, la même règle sur le Sharpe médian.
  const eligibles = VARIANTES.filter((v) => {
    if (v.id === "v2") return false;
    const a = agregats[v.id]!;
    return (a.expectancyRegroupeeX3 ?? -Infinity) > 0 && (a.medianeFermes ?? 0) >= MIN_TRADES_CLOS_MEDIAN;
  });
  const choisir = (critere: (a: Agregat) => number | null): { classement: Variante[]; retenue: string | null; referenceV2: number } => {
    const valeur = (id: string): number => critere(agregats[id]!) ?? -Infinity;
    const classement = [...eligibles].sort((a, b) => (valeur(a.id) !== valeur(b.id) ? valeur(b.id) - valeur(a.id) : a.simplicite - b.simplicite));
    const meilleure = classement[0];
    const referenceV2 = valeur("v2");
    return { classement, retenue: meilleure !== undefined && valeur(meilleure.id) > referenceV2 ? meilleure.id : null, referenceV2 };
  };
  const choixRomad = choisir((a) => a.medianeRomad);
  const choixSharpe = choisir((a) => a.medianeSharpe);

  // Sorties.
  const horodatage = new Date().toISOString();
  const resultat = {
    objet: "Exploration AXIS v3 (sorties avec stop) sur données DÉJÀ VUES — SANS VALEUR PROBANTE",
    genereLeUtc: horodatage,
    fenetre: { finExclue: iso(FIN), dossier: DOSSIER_FENETRE, finCaches: iso(FIN_CACHE) },
    parametres: {
      timeframe: TF, warmupBougies: WARMUP, capitalInitial: CAPITAL, tailleFixe: TAILLE,
      seuil: SEUIL, seuilVente: SEUIL_VENTE, emaTendance: EMA_TENDANCE, atrPeriode: ATR_PERIODE, couts: COUTS,
      bougies4hParAn: BOUGIES_4H_PAR_AN,
      regleDeChoix:
        "Variante maximisant la MÉDIANE sur les 8 cellules du RoMaD (PnL net total x1 / drawdown max de l'equity aux clôtures), " +
        `parmi les variantes à expectancy nette regroupée x3 > 0 et médiane des trades clos ≥ ${MIN_TRADES_CLOS_MEDIAN} ; ` +
        "égalité : la plus simple (tendance < atr-initial < atr-suiveur < pct-suiveur, puis k ou p le plus petit) ; " +
        "aucune variante proposée si aucune ne dépasse v2 sur cette médiane.",
      sharpe: "descriptif, hors règle de choix : rendements par bougie de l'equity du moteur, moyenne / écart-type (n−1) × √2191,5",
      moities: "trades affectés par le fill d'entrée ; drawdown et Sharpe sur les points d'equity de la moitié (pic repris au premier point)",
      variantes: VARIANTES,
      referenceHorsGrille: ID_EMA_SEULE,
    },
    caches: series.map((s) => ({
      symbol: s.symbol, fichier: CELLULES.find((c) => c.symbol === s.symbol)!.fichier, sha256: s.chargement.sha256,
      acquisLeUtc: s.chargement.acquisLeUtc, bougies: s.candles.length, premierOpen: iso(s.candles[0]!.time),
      derniereCloture: iso(s.candles.at(-1)!.time + TF_MS), ecarteesCache: s.chargement.ecarteesCache,
      invalidesLocales: s.chargement.invalidesLocales, tronquees: s.chargement.tronquees,
      debutEvaluation: iso(debutEvaluation(s)), milieuEvaluation: iso(milieuEvaluation(s)),
      fideliteV2: "OK (positionsAxis et prixSignal du chart)",
    })),
    cellules: parCellule,
    agregatsX1: agregats,
    comparaisonsV2X1: comparaisons,
    choix: {
      medianeRomadV2: choixRomad.referenceV2,
      eligibles: eligibles.map((v) => v.id),
      classement: choixRomad.classement.map((v) => ({ id: v.id, medianeRomad: agregats[v.id]!.medianeRomad })),
      retenue: choixRomad.retenue,
      descriptifSharpe: {
        medianeSharpeV2: choixSharpe.referenceV2,
        classement: choixSharpe.classement.map((v) => ({ id: v.id, medianeSharpe: agregats[v.id]!.medianeSharpe })),
        retenueSiSharpe: choixSharpe.retenue,
        coincide: choixSharpe.retenue === choixRomad.retenue,
      },
    },
  };
  writeFileSync(join(SORTIES, "resultat.json"), JSON.stringify(resultat, remplaceur, 2));
  writeFileSync(
    join(SORTIES, "rapport.md"),
    rapport(series, parCellule, agregats, comparaisons, choixRomad, choixSharpe, eligibles.map((v) => v.id), horodatage)
  );
  process.stderr.write(
    `\nVariante retenue par la règle (RoMaD médian) : ${choixRomad.retenue ?? "aucune"} ; ` +
    `si la règle portait sur le Sharpe médian : ${choixSharpe.retenue ?? "aucune"}\nSorties : ${SORTIES}/resultat.json, ${SORTIES}/rapport.md\n`
  );
  process.stdout.write(`${choixRomad.retenue ?? "aucune"}\n`);
}

// ─────────────────────────── Rapport ───────────────────────────

interface Choix { classement: Variante[]; retenue: string | null; referenceV2: number }

function rapport(
  series: Serie[],
  parCellule: Record<string, ParVariante>,
  agregats: Record<string, Agregat>,
  comparaisons: Record<string, ComparaisonV2>,
  choixRomad: Choix,
  choixSharpe: Choix,
  eligibles: string[],
  horodatage: string
): string {
  const retenue = choixRomad.retenue;
  const ids = [...VARIANTES.map((v) => v.id), ID_EMA_SEULE];
  const lignesAgregats = ids.map((id) => {
    const a = agregats[id]!;
    return [
      id === retenue ? `**${id}**` : id,
      fmt(a.medianePnlPct, 1), fmt(a.moyennePnlPct, 1), fmt(a.medianeRomad, 2), fmt(a.medianeDdPct, 1), fmt(a.medianeSharpe, 2), fmt(a.medianeExpectancyPct, 2),
      id === ID_EMA_SEULE ? "—" : `${a.batV2Romad} / ${a.batV2Pnl} / ${a.batV2Dd} / ${a.batV2Sharpe}`,
      fmt(a.expectancyRegroupeeX1, 2), fmt(a.expectancyRegroupeeX3, 2), fmt(a.medianeFermes, 0), a.tradesRegroupesX1,
      id === ID_EMA_SEULE ? "—" : `${a.sortiesScore} / ${a.sortiesStop}`,
      id === "v2" || id === ID_EMA_SEULE ? "réf." : eligibles.includes(id) ? "oui" : "non",
    ];
  });
  const detail = (id: string, cout: string): string =>
    tableau(
      ["Cellule", "Trades", "Clos", "Fin", "Exp. nette %", "PnL net", "PnL %", "Gagnants %", "PF", "DD max", "DD %", "RoMaD", "Sharpe", "Expo %", "Durée (b.)", "MAE %", "Sorties score / stop", "PnL net 1re / 2e moitié", "Sharpe 1re / 2e moitié"],
      series.map((s) => {
        const m = parCellule[s.symbol]![id]![cout]!;
        return [
          s.symbol, m.trades, m.fermes, m.finDonnees, fmt(m.expectancyPct, 2), fmt(m.pnlTotal, 0), fmt(m.pnlTotalPct, 1), fmt(m.winRatePct, 0),
          fmt(m.profitFactor, 2), fmt(m.ddMax, 0), fmt(m.ddMaxPct, 1), fmt(m.romad, 2), fmt(m.sharpe, 2), fmt(m.expositionPct, 0), fmt(m.dureeMoyenneBarres, 0), fmt(m.maeMoyenPct, 2),
          id === ID_EMA_SEULE ? "—" : `${m.sortiesScore} / ${m.sortiesStop}`,
          `${fmt(m.moities[0].pnlNet, 0)} (${m.moities[0].trades}) / ${fmt(m.moities[1].pnlNet, 0)} (${m.moities[1].trades})`,
          `${fmt(m.moities[0].sharpe, 2)} / ${fmt(m.moities[1].sharpe, 2)}`,
        ];
      })
    );
  /** v2 → variante, cellule par cellule (coûts x1). */
  const faceAFace = (id: string): string =>
    tableau(
      ["Cellule", "Trades", "PnL net", "DD max", "RoMaD", "Sharpe", "Expo %", "Sorties score / stop"],
      series.map((s) => {
        const a = parCellule[s.symbol]!["v2"]!["x1"]!;
        const b = parCellule[s.symbol]![id]!["x1"]!;
        return [
          s.symbol, `${a.trades} → ${b.trades}`, `${fmt(a.pnlTotal, 0)} → ${fmt(b.pnlTotal, 0)}`, `${fmt(a.ddMax, 0)} → ${fmt(b.ddMax, 0)}`,
          `${fmt(a.romad, 2)} → ${fmt(b.romad, 2)}`, `${fmt(a.sharpe, 2)} → ${fmt(b.sharpe, 2)}`, `${fmt(a.expositionPct, 0)} → ${fmt(b.expositionPct, 0)}`,
          `${a.sortiesScore} / ${a.sortiesStop} → ${b.sortiesScore} / ${b.sortiesStop}`,
        ];
      })
    );
  const partsTexte = (p: Parts): string =>
    `${p.ddPlusFaible}/${p.comparables} · ${p.pnlAuMoinsEgal}/${p.comparables} · ${p.sharpeSuperieur}/${p.comparablesSharpe} · ${p.romadSuperieur}/${p.comparables}`;
  const tableParts = tableau(
    ["Variante", "Fenêtre entière (DD < · PnL ≥ · Sharpe > · RoMaD >)", "1re moitié", "2e moitié"],
    VARIANTES.map((v) => {
      const c = comparaisons[v.id]!;
      return [v.id === retenue ? `**${v.id}**` : v.id, partsTexte(c.fenetre), partsTexte(c.moitie1), partsTexte(c.moitie2)];
    })
  );
  const premiere = series[0]!;
  const sections = [
    "# AXIS v3 — exploration des sorties avec stop sur données DÉJÀ VUES",
    "",
    "**SANS VALEUR PROBANTE — données déjà vues, grille de 13 variantes.** Ce rapport sert uniquement à pré-déclarer UNE variante pour le test sur données jamais vues, selon la règle écrite dans l'en-tête de `scripts/explorer-axis-v3.ts` avant la première exécution.",
    "",
    `Généré le ${horodatage}. **Fenêtre lue : bougies closes au plus tard le ${iso(FIN)}** (dossier \`${DOSSIER_FENETRE}\`). Moteur \`runBacktest\` : jambe longue, taille fixe ${TAILLE}, capital ${CAPITAL}, warmup ${WARMUP} bougies, décision à la clôture, fill à l'open suivant. Coûts x1 = 0,05 % frais + 0,02 % slippage par côté ; x3 = 0,15 % + 0,06 %. Drawdown : equity valorisée aux clôtures (PnL latent inclus). RoMaD = PnL net total / drawdown max en cotation. Sharpe par bougie : rendements de l'equity par clôture, moyenne / écart-type (n−1) × √${BOUGIES_4H_PAR_AN} — descriptif, hors règle de choix.`,
    "",
    "## Données (fenêtre coupée après vérification du hash)",
    "",
    tableau(
      ["Cellule", "Fichier", "SHA-256", "Bougies lues", "Tronquées", "Premier open", "Dernière clôture", "Début d'évaluation", "Milieu (2e moitié dès)", "Écartées (cache)", "Fidélité v2"],
      series.map((s) => [
        s.symbol, CELLULES.find((c) => c.symbol === s.symbol)!.fichier, `\`${s.chargement.sha256.slice(0, 16)}…\``, s.candles.length, s.chargement.tronquees,
        iso(s.candles[0]!.time), iso(s.candles.at(-1)!.time + TF_MS), iso(debutEvaluation(s)), iso(milieuEvaluation(s)), s.chargement.ecarteesCache, "OK",
      ])
    ),
    "",
    "## Grille de variantes",
    "",
    tableau(["Variante", "Famille", "Description"], VARIANTES.map((v) => [v.id, v.famille, v.description])),
    "",
    `Référence hors grille : \`${ID_EMA_SEULE}\` (long si close > EMA 200, entrée au croisement haussier, sortie si close < EMA 200).`,
    "",
    "## Agrégats par variante (8 cellules, coûts x1)",
    "",
    tableau(
      ["Variante", "Méd. PnL %", "Moy. PnL %", "Méd. RoMaD", "Méd. DD %", "Méd. Sharpe", "Méd. exp. %", "Bat v2 (RoMaD / PnL / DD / Sharpe)", "Exp. regroupée x1 %", "Exp. regroupée x3 %", "Méd. trades clos", "Trades (8 cell.)", "Sorties score / stop", "Éligible"],
      lignesAgregats
    ),
    "",
    `Éligible : expectancy nette regroupée x3 > 0 ET médiane des trades clos ≥ ${MIN_TRADES_CLOS_MEDIAN}. Sorties par raison : décisions ≥ ${WARMUP - 1}, toutes positions (y compris celles nées pendant le warmup).`,
    "",
    "## Règle de choix et résultat",
    "",
    `Médiane du RoMaD de \`v2\` : ${fmt(choixRomad.referenceV2, 2)}. Variantes éligibles : ${eligibles.length === 0 ? "aucune" : eligibles.map((e) => `\`${e}\``).join(", ")}.`,
    "",
    `Classement par RoMaD médian : ${choixRomad.classement.map((v) => `${v.id} (${fmt(agregats[v.id]!.medianeRomad, 2)})`).join(", ")}.`,
    "",
    retenue === null
      ? "**Aucune variante retenue** : aucune variante éligible ne dépasse `v2` sur la médiane du RoMaD."
      : `**Variante retenue : \`${retenue}\`** (médiane du RoMaD ${fmt(agregats[retenue]!.medianeRomad, 2)} contre ${fmt(choixRomad.referenceV2, 2)} pour \`v2\`).`,
    "",
    "### Descriptif : si la règle portait sur la médiane du Sharpe par bougie",
    "",
    `Médiane du Sharpe de \`v2\` : ${fmt(choixSharpe.referenceV2, 2)}. Classement : ${choixSharpe.classement.map((v) => `${v.id} (${fmt(agregats[v.id]!.medianeSharpe, 2)})`).join(", ")}.`,
    "",
    choixSharpe.retenue === null
      ? "Aucune variante éligible ne dépasse `v2` sur la médiane du Sharpe."
      : `Variante qui serait retenue : \`${choixSharpe.retenue}\` (${fmt(agregats[choixSharpe.retenue]!.medianeSharpe, 2)}).`,
    "",
    choixSharpe.retenue === retenue ? "Les deux critères **coïncident**." : "Les deux critères **ne coïncident pas**.",
    "",
    "## Parts de cellules battant `v2` (coûts x1) — fenêtre entière et par moitié",
    "",
    "Lecture : DD max plus faible · PnL net ≥ · Sharpe > · RoMaD >, sur les cellules comparables (variante et v2 avec au moins un trade dans la plage ; Sharpe : les deux définis). Moitiés : trades affectés par le fill d'entrée, drawdown et Sharpe sur les points d'equity de la moitié. La ligne `v2` sert de témoin.",
    "",
    tableParts,
    "",
    `## Face-à-face \`v2\` → \`${ID_PREMIERE_RETENUE}\` (coûts x1)`,
    "",
    faceAFace(ID_PREMIERE_RETENUE),
  ];
  if (retenue !== null && retenue !== ID_PREMIERE_RETENUE) {
    sections.push("", `## Face-à-face \`v2\` → \`${retenue}\` (variante retenue, coûts x1)`, "", faceAFace(retenue));
  }
  sections.push(
    "",
    "## Détail par cellule — `v2` (coûts x1)",
    "",
    detail("v2", "x1"),
    "",
    "## Détail par cellule — `v2` (coûts x3)",
    "",
    detail("v2", "x3")
  );
  const detaillees = [...new Set([retenue, ID_PREMIERE_RETENUE].filter((id): id is string => id !== null))];
  for (const id of detaillees) {
    sections.push(
      "",
      `## Détail par cellule — \`${id}\`${id === retenue ? " (variante retenue)" : ""} (coûts x1)`,
      "",
      detail(id, "x1"),
      "",
      `## Détail par cellule — \`${id}\` (coûts x3)`,
      "",
      detail(id, "x3")
    );
  }
  sections.push(
    "",
    `## Détail par cellule — \`${ID_EMA_SEULE}\` (coûts x1)`,
    "",
    detail(ID_EMA_SEULE, "x1"),
    "",
    "## Sorties par raison (toutes variantes, 8 cellules, décisions après warmup)",
    "",
    tableau(
      ["Variante", "Sorties par score", "Sorties par stop / tendance", "Part des sorties par stop"],
      VARIANTES.map((v) => {
        const a = agregats[v.id]!;
        const total = a.sortiesScore + a.sortiesStop;
        return [v.id, a.sortiesScore, a.sortiesStop, total === 0 ? "—" : `${((a.sortiesStop / total) * 100).toFixed(0)} %`];
      })
    ),
    "",
    "## Lecture",
    "",
    `Mesures PASSÉES sur des données déjà consommées par les campagnes AXIS (fenêtre close au ${iso(FIN)}, première cellule ${premiere.symbol} de ${iso(premiere.candles[0]!.time)} à ${iso(premiere.candles.at(-1)!.time + TF_MS)}) : elles choisissent une variante, elles ne la valident pas. Seul le test sur données jamais vues, pré-déclaré, peut le faire.`,
    ""
  );
  return sections.join("\n");
}

main();
