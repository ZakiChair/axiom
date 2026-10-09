#!/usr/bin/env bun
/**
 * AXIOM — exploration d'un GARDE-FOU DE RÉGIME BTC pour AXIS (« v5 ») sur données
 * DÉJÀ VUES, 9 octobre 2026.
 *
 * OBJET. Revue AXIS du 9 octobre 2026 : trois variantes de signal (flux, stop v3,
 * filtre ADX v4) ont échoué leur test sur données jamais vues ; les rapports v3 et
 * v4 montrent que les cellules partagent un même facteur de marché (2025 perdante
 * pour toutes les stratégies long/plat ; paires jeunes en baisse). La v2 achète un
 * alt au-dessus de SA propre EMA 200 même quand BTC — le marché — est sous la
 * sienne. Hypothèse unique explorée ici : n'acheter que si BTC est aussi dans sa
 * tendance de fond (régime de marché), mécanisme qui colle au mode d'échec observé,
 * jamais exploré (les variantes « pente » de la v4 portaient sur l'EMA 200 de
 * l'alt lui-même). Ce script choisit, selon une règle écrite AVANT la première
 * exécution, au plus UNE variante à soumettre au propriétaire ; il ne lance aucun
 * test. Si aucune variante ne satisfait la règle, aucune n'est proposée.
 *
 * DONNÉES (déjà vues, SANS VALEUR PROBANTE), deux panels, 4h, re-téléchargés depuis
 * Binance Spot /api/v3/klines dans scripts/.cache-klines/axis-v5/ (gitignoré) car
 * les caches des campagnes n'existent pas sur cette machine, et vérifiés par hash
 * contre les résultats commités (sha256 de JSON.stringify(candles), même parsing
 * que scripts/valider-axis-v3.ts) : panel A « alts » = les 151 paires de
 * scripts/axis/manifeste-v3-2026-10-08.json (symboles.liste), 2023-07-01 →
 * 2026-10-08 exclu, hash attendu = sha256Ohlcv de scripts/axis/resultat-v3-2026-10-08.json ;
 * panel B « majors » = BTC, ETH, XRP, SOL, BNB, ADA, LINK, DOGE, historique complet
 * → 2026-10-08 exclu, hash attendu = sha256Ohlcv de
 * scripts/axis/resultat-flux-2026-10-08.json pour BNB/ADA/LINK/DOGE ; pour
 * BTC/ETH/XRP/SOL (caches d'essai de la campagne flux, hash non commité), la
 * vérification passe par la REPRODUCTION EXACTE du témoin v2 (ci-dessous). Une
 * série dont le hash attendu existe et diffère = arrêt sans résultat. Indépendance
 * d'un futur test : en actifs entière si le pool neuf est pris hors de ces 159
 * paires ; en temps nulle (période déjà lue).
 *
 * RÉFÉRENCE BTC. Pour chaque cellule, la série de référence R est BTCUSDT 4h
 * ALIGNÉE sur les bougies de la cellule par heure d'ouverture, avec report de la
 * dernière bougie BTC d'heure d'ouverture ≤ celle de la bougie de la cellule
 * (LOCF, comme la série auxiliaire `refClose` du chart) ; aucune bougie BTC
 * antérieure = lecture absente. Les EMA de R sont calculées sur la série ALIGNÉE
 * (même longueur que la cellule : c'est ce qu'une implémentation chart calculerait
 * sur son buffer). Pour la cellule BTCUSDT, R = la cellule elle-même : tout
 * garde-fou y coïncide avec la base, la cellule est donc EXCLUE du panel B pour
 * les variantes (rapportée à titre descriptif) ; le panel B compte 7 cellules.
 *
 * SORTIE (inchangée sauf mention contraire) : score ≤ −4 ; aucun stop. Décisions
 * sur i ≤ n−2 ; bougie à score indéfini = position reportée ; armement de la v2
 * (la condition d'achat COMPLÈTE doit avoir été évaluable et fausse une fois avant
 * le premier achat et après chaque vente).
 *
 * GRILLE DE 6 VARIANTES. Base B(i) = score[i] ≥ 5 ET close[i] > EMA 200[i] (de la
 * cellule). Un garde-fou G(i) s'ajoute à la base (condition de tendance = B ET G,
 * passée par `positionsAxis`) ; une lecture absente vaut G faux :
 *   - v2 : B seule (référence) ;
 *   - btc-ema200 : R[i] > EMA 200(R)[i] ;
 *   - btc-ema100 : R[i] > EMA 100(R)[i] ;
 *   - btc-ema400 : R[i] > EMA 400(R)[i] ;
 *   - btc-pente-50 : EMA 200(R)[i] > EMA 200(R)[i−50] ;
 *   - btc-ema200-sortie : entrée = base ET R[i] > EMA 200(R)[i] ; sortie =
 *     score ≤ −4 OU R[i] ≤ EMA 200(R)[i] à la clôture i (sortie « régime », décidée
 *     à la clôture, même armement après sortie que la v2 après une vente :
 *     réentrée possible dès que la condition complète redevient vraie après avoir
 *     été fausse une fois) ;
 *   - btc-axis : BTC lui-même en position AXIS (positionsAxis sur les bougies BTC
 *     alignées, défauts : score ≥ 5 ET R > EMA 200(R), sortie score ≤ −4).
 *
 * EXÉCUTION : moteur `runBacktest` (décision à la clôture, fill à l'open suivant),
 * jambe longue, taille fixe 1000, capital 10 000, warmup 300 bougies, coûts x1
 * (0,05 % frais + 0,02 % slippage par côté) et x3 (0,15 % + 0,06 %) — identique à
 * la v4.
 *
 * RÈGLE DE CHOIX (pré-déclarée, identique à celle de l'exploration v4) :
 *   1. Éligibilité (panel A) : expectancy nette regroupée aux coûts x3 > 0 ET
 *      trades clos regroupés ≥ 50 % de ceux de la v2.
 *   2. Métrique (panel A, coûts x1) : part des cellules comparables (Sharpe par
 *      bougie défini pour la variante ET la v2) où le Sharpe de la variante est
 *      STRICTEMENT supérieur à celui de la v2, fenêtre entière.
 *   3. Classement : part décroissante ; égalité : plus de trades clos regroupés,
 *      puis ordre de la grille.
 *   4. Retenue : la première du classement SI ET SEULEMENT SI part ≥ 60 % sur le
 *      panel A, > 50 % dans CHAQUE moitié de la fenêtre du panel A, et ≥ 5 cellules
 *      sur 7 sur le panel B (fenêtre entière). Sinon aucune variante n'est
 *      proposée. Métrique descriptive hors règle : même sélection avec la part des
 *      cellules où l'expectancy nette par trade dépasse celle de la v2.
 * Descriptifs supplémentaires (sans effet) : part des cellules où le PnL net de la
 * variante est ≥ v2 et où le drawdown est plus faible ; nombre de bougies où G est
 * faux alors que B est vraie (entrées refusées) ; part des bougies de la cellule
 * alignées par report (LOCF).
 *
 * MESURES : celles de l'exploration v4, inchangées.
 *
 * CONTRÔLES BLOQUANTS : hashes disponibles vérifiés ; `positions(v2)` strictement
 * égale à `positionsAxis` ET à la position déduite de `stratAxis.calc().series.etat`
 * (sortie masquée, Phase 1) ; une variante à G ≡ vrai égale la v2 ;
 * `btc-ema200-sortie` avec sortie régime jamais vraie égale `btc-ema200` ; pour
 * chaque bougie alignée, l'heure BTC retenue est ≤ l'heure de la cellule et aucune
 * bougie BTC d'heure intermédiaire n'existe ; nombre de trades du moteur = nombre
 * de naissances de position après le warmup, à chaque coût ; mêmes fills à x1 et
 * x3 ; TÉMOIN : les agrégats de la ligne v2 doivent reproduire EXACTEMENT ceux de
 * scripts/axis/rapport-explo-v4-2026-10-09.md — panel A : 6320 trades (6278 clos),
 * exp. x1 1.52 %, x3 1.24 %, PnL moyen 6.4 %, méd. PnL 3.9 %, méd. DD 15.4 %,
 * méd. Sharpe 0.19, méd. clos 42, expo 30.5 % ; panel B (8 cellules, BTC
 * comprise) : 973 (972), 5.01 / 4.72, 60.9, 55.2, 15.3, 0.84, 123, 38.6. Un écart
 * = arrêt sans résultat (données ou moteur différents).
 *
 * HISTORIQUE DES EXÉCUTIONS (grille et règle inchangées depuis la première) :
 *   1. 2026-10-09, 21:10 UTC, téléchargement de 159 séries (1 352 requêtes,
 *      ~10 min) puis mesures, ~12 min au total : VARIANTE RETENUE `btc-ema100`.
 *      Les six variantes sont éligibles (expectancy x3 > 0 et clos ≥ 50 % de la
 *      v2 partout). Première du classement : btc-ema100, Sharpe > v2 sur 117/151
 *      cellules du panel A (77,5 %), 88/151 puis 109/151 par moitié, 6/7 sur le
 *      panel B hors BTC — toutes les conditions de la règle satisfaites.
 *      Métrique descriptive (expectancy par trade) : btc-ema100 aussi (124/151,
 *      6/7 sur B) — les deux métriques coïncident. Témoin v2 reproduit à la
 *      décimale près sur les deux panels. Rapport recopié dans
 *      scripts/axis/rapport-explo-v5-2026-10-09.md.
 *   2. 2026-10-09, ~21:25 UTC, relance sans argument sur le cache écrit par
 *      l'exécution 1 (aucun téléchargement, 155 hashes commités revérifiés) :
 *      même verdict, `btc-ema100`.
 *
 * Sorties : /tmp/axis-v5-explo/resultat.json et rapport.md — SANS VALEUR PROBANTE ;
 * le rapport est recopié dans scripts/axis/rapport-explo-v5-2026-10-09.md.
 * Usage : bun scripts/explorer-axis-v5.ts (aucun argument) ; `--telecharger`
 *   autorisé une fois pour remplir le cache, le run sans argument refuse un cache
 *   absent.
 * Vérification : ./node_modules/.bin/tsc --noEmit --strict --noUncheckedIndexedAccess
 *   --target es2022 --module esnext --moduleResolution bundler --skipLibCheck --types node
 *   scripts/explorer-axis-v5.ts
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Candle, IndicatorDef, Timeframe } from "../packages/types/src/index";
import { closeOf, ema } from "../packages/indicators/src/utils";
import { computeIndicator, INDICATORS } from "../packages/indicators/src/index";
import { positionsAxis, stratAxis, votesAxis } from "../packages/indicators/src/strategy/stratAxis";
import { runBacktest } from "../packages/backtest/src/engine";
import type { Operande, PointEquity, ResultatBacktest, StrategieDef, TradeResultat } from "../packages/backtest/src/types";

const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 1 && args[0] === "--telecharger"))) {
  throw new Error(`argument refusé : ${args.join(" ")} (usage : bun scripts/explorer-axis-v5.ts [--telecharger])`);
}
const TELECHARGER = args[0] === "--telecharger";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SORTIES = "/tmp/axis-v5-explo";
const CACHE = join(RACINE, "scripts/.cache-klines/axis-v5");
const MANIFESTE_V3 = join(RACINE, "scripts/axis/manifeste-v3-2026-10-08.json");
const RESULTAT_V3 = join(RACINE, "scripts/axis/resultat-v3-2026-10-08.json");
const RESULTAT_FLUX = join(RACINE, "scripts/axis/resultat-flux-2026-10-08.json");
const SCHEMA_CACHE = "axiom-klines-axis-v5-v1";
const ENDPOINT = "https://data-api.binance.vision/api/v3/klines";
const FIN = Date.parse("2026-10-08T00:00:00Z");
const DEBUT_ALTS = Date.parse("2023-07-01T00:00:00Z");
const TF: Timeframe = "4h";
const TF_MS = 14_400_000;
const LIMITE_PAGE = 1000;
const DELAI_REQUETE_S = 30;
const PAUSE_REQUETE_MS = 120;
const WARMUP = 300;
const CAPITAL = 10_000;
const TAILLE = 1000;
const SEUIL = 5;
const SEUIL_VENTE = 4;
const EMA_TENDANCE = 200;
const PENTE_K = 50;
const BOUGIES_4H_PAR_AN = 2191.5;
/** Règle de choix : part minimale des trades clos de la v2 conservés (éligibilité). */
const PART_MIN_TRADES_V2 = 0.5;
/** Règle de choix : part de cellules du panel A (fenêtre) à atteindre (≥), seuil P2 du test. */
const PART_MIN_FENETRE = 0.6;
/** Règle de choix : part de cellules du panel A à dépasser (>) dans chaque moitié, seuil P3 du test. */
const PART_MIN_MOITIE = 0.5;
/** Règle de choix : cellules du panel B (sur 7, BTC exclue) où la variante doit battre la v2. */
const MIN_MAJORS = 5;
/** Témoin : agrégats de la ligne v2 à reproduire exactement (rapport-explo-v4-2026-10-09.md). */
const TEMOIN = {
  A: { trades: 6320, fermes: 6278, expX1: "1.52", expX3: "1.24", pnlMoyen: "6.4", medPnl: "3.9", medDd: "15.4", medSharpe: "0.19", medFermes: "42", expo: "30.5" },
  B: { trades: 973, fermes: 972, expX1: "5.01", expX3: "4.72", pnlMoyen: "60.9", medPnl: "55.2", medDd: "15.3", medSharpe: "0.84", medFermes: "123", expo: "38.6" },
};

interface Cout { id: string; frais: number; slippage: number }
const COUTS: Cout[] = [
  { id: "x1", frais: 0.05, slippage: 0.02 },
  { id: "x3", frais: 0.15, slippage: 0.06 },
];

type Panel = "A" | "B";
const NOM_PANEL: Record<Panel, string> = { A: "A — 151 alts 2023-2026", B: "B — 8 majors 2017-2026 (7 hors BTC pour la règle)" };

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
  /** Close de la référence BTC alignée (LOCF) ; `undefined` avant la première bougie BTC. */
  r: Array<number | undefined>;
  ema100R: Array<number | undefined>;
  ema200R: Array<number | undefined>;
  ema400R: Array<number | undefined>;
  /** BTC lui-même en position AXIS (sur les bougies alignées), pour `btc-axis`. */
  posBtc: Array<number | undefined>;
  /** Bougies de la cellule alignées par report (heure BTC < heure de la cellule). */
  locf: number;
  chargement: Chargement;
}

interface Variante {
  id: string;
  famille: string;
  /** Rang dans la grille (dernier critère d'égalité). */
  ordre: number;
  seuil: number;
  /** Garde-fou ajouté à la base ; `undefined` = lecture absente (vaut faux). */
  filtre: (s: Serie, i: number) => boolean | undefined;
  /** Prédicat de sortie additionnel à la clôture i (variantes de sortie « régime »). */
  sortie?: (s: Serie, i: number) => boolean | undefined;
  description: string;
}

/** Base B(j) : score ≥ 5 et close au-dessus de l'EMA 200, tous deux définis. */
const base = (s: Serie, j: number): boolean => {
  if (j < 0) return false;
  const sc = s.score[j];
  return sc !== undefined && sc >= SEUIL && s.auDessus[j] === true;
};
/** R au-dessus de sa propre EMA (indéfini tant qu'une lecture manque). */
const regimeEma = (k: number) => {
  const serieEma = (s: Serie): Array<number | undefined> => (k === 100 ? s.ema100R : k === 200 ? s.ema200R : s.ema400R);
  return (s: Serie, i: number): boolean | undefined => {
    const r = s.r[i];
    const e = serieEma(s)[i];
    return r === undefined || e === undefined ? undefined : r > e;
  };
};

const G_EMA200 = regimeEma(EMA_TENDANCE);
const VARIANTES: Variante[] = [
  { id: "v2", famille: "v2", ordre: 0, seuil: SEUIL, filtre: () => true, description: "score ≥ 5 et close > EMA 200 (référence)" },
  { id: "btc-ema200", famille: "regime", ordre: 1, seuil: SEUIL, filtre: G_EMA200, description: "base et BTC > EMA 200(BTC)" },
  { id: "btc-ema100", famille: "regime", ordre: 2, seuil: SEUIL, filtre: regimeEma(100), description: "base et BTC > EMA 100(BTC)" },
  { id: "btc-ema400", famille: "regime", ordre: 3, seuil: SEUIL, filtre: regimeEma(400), description: "base et BTC > EMA 400(BTC)" },
  {
    id: "btc-pente-50", famille: "regime", ordre: 4, seuil: SEUIL,
    filtre: (s, i) => {
      const e = s.ema200R[i];
      const e0 = s.ema200R[i - PENTE_K];
      return e === undefined || e0 === undefined ? undefined : e > e0;
    },
    description: `base et EMA 200(BTC) > EMA 200(BTC) d'il y a ${PENTE_K} bougies`,
  },
  {
    id: "btc-ema200-sortie", famille: "regime-sortie", ordre: 5, seuil: SEUIL,
    filtre: G_EMA200,
    sortie: (s, i) => {
      const r = s.r[i];
      const e = s.ema200R[i];
      return r === undefined || e === undefined ? undefined : r <= e;
    },
    description: "entrée : base et BTC > EMA 200(BTC) ; sortie : score ≤ −4 ou BTC ≤ EMA 200(BTC)",
  },
  { id: "btc-axis", famille: "regime", ordre: 6, seuil: SEUIL, filtre: (s, i) => (s.posBtc[i] === undefined ? undefined : s.posBtc[i] === 1), description: "base et BTC lui-même en position AXIS" },
];
if (VARIANTES.length !== 7) throw new Error(`grille de ${VARIANTES.length} lignes, 7 attendues (v2 + 6 variantes)`);
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

// ─────────────────────────── Acquisition (parsing identique à valider-axis-v3.ts) ───────────────────────────

interface BougieEcartee { temps: string; raison: string }
interface Servies { candles: Candle[]; ecartees: BougieEcartee[] }
interface Chargement { fichier: string; sha256: string; sha256Attendu: string | null; acquisLeUtc: string; ecarteesCache: number; invalidesLocales: number }

/** Raison d'écarter une bougie servie (identique à valider-axis-v3.ts). */
function raisonInvalide(c: Candle): string | null {
  if (![c.open, c.high, c.low, c.close, c.volume, c.buyVolume, c.sellVolume].every((v) => typeof v === "number" && Number.isFinite(v))) {
    return "OHLCV ou volume taker non fini";
  }
  if (c.open <= 0 || c.close <= 0 || c.low <= 0) return "prix ≤ 0";
  if (c.volume < 0 || c.buyVolume! < 0 || c.buyVolume! > c.volume * (1 + 1e-9)) return "volume taker incohérent";
  if (c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close)) return "high/low incohérents";
  return null;
}

const attendre = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
let requetes = 0;

/** GET JSON : délai 30 s, une nouvelle tentative, pause entre requêtes (limite Binance). */
async function lireJson(url: string): Promise<unknown> {
  await attendre(PAUSE_REQUETE_MS);
  for (let t = 0; t < 2; t++) {
    requetes++;
    const reponse = await fetch(url, { signal: AbortSignal.timeout(DELAI_REQUETE_S * 1000) });
    const corps = await reponse.text();
    if (reponse.ok) return JSON.parse(corps) as unknown;
    if (t === 0 && (reponse.status === 418 || reponse.status === 429 || reponse.status >= 500)) {
      const retry = Number(reponse.headers.get("retry-after"));
      await attendre(1000 * (Number.isFinite(retry) && retry > 0 ? retry : 4));
      continue;
    }
    throw new Error(`Binance HTTP ${reponse.status} : ${corps.slice(0, 200)}`);
  }
  throw new Error("inaccessible");
}

/**
 * Klines spot paginées sur `[debut, fin[` : champs et ordre identiques à
 * valider-axis-v3.ts (`{time, open, high, low, close, volume, buyVolume, sellVolume}`)
 * pour que sha256(JSON.stringify(candles)) reproduise les `sha256Ohlcv` commités.
 */
async function telecharger(symbol: string, debut: number): Promise<Servies> {
  const parTemps = new Map<number, Candle>();
  const ecartees = new Map<number, string>();
  let curseur = debut;
  for (;;) {
    const brut = await lireJson(`${ENDPOINT}?symbol=${symbol}&interval=${TF}&startTime=${curseur}&endTime=${FIN - 1}&limit=${LIMITE_PAGE}`);
    if (!Array.isArray(brut)) throw new Error("réponse Binance non tabulaire");
    for (const l of brut) {
      if (!Array.isArray(l) || l.length < 10) throw new Error("ligne kline Binance sans champ taker");
      const [time, open, high, low, close, volume, closeTime, takerBuy] = [0, 1, 2, 3, 4, 5, 6, 9].map((i) => Number(l[i])) as [
        number, number, number, number, number, number, number, number,
      ];
      if (!Number.isFinite(time)) throw new Error("kline Binance sans temps d'ouverture exploitable");
      if (time < debut || time + TF_MS > FIN) continue;
      const bougie: Candle = { time, open, high, low, close, volume, buyVolume: takerBuy, sellVolume: volume - takerBuy };
      const raison = raisonInvalide(bougie) ?? (closeTime + 1 !== time + TF_MS ? "closeTime incohérent" : null);
      if (raison === null) parTemps.set(time, bougie);
      else ecartees.set(time, raison);
    }
    if (brut.length === 0) break;
    const dernier = Number((brut.at(-1) as unknown[])[0]);
    if (!(dernier >= curseur)) throw new Error("pagination Binance sans progression");
    if (brut.length < LIMITE_PAGE && dernier + 2 * TF_MS > FIN) break;
    curseur = dernier + 1;
    process.stderr.write(`\r  … ${symbol} : ${parTemps.size} bougies (${requetes} requêtes)`);
  }
  return {
    candles: [...parTemps.values()].sort((a, b) => a.time - b.time),
    ecartees: [...ecartees].sort((a, b) => a[0] - b[0]).map(([t, raison]) => ({ temps: iso(t), raison })),
  };
}

// Cache compact : [time, open, high, low, close, volume, takerBuy] par bougie, gzip.
type Ligne = [number, number, number, number, number, number, number];
interface Enveloppe { schema: string; endpoint: string; symbol: string; unite: string; debut: number; fin: number; acquisLeUtc: string; sha256: string; lignes: Ligne[]; ecartees: BougieEcartee[] }
const versLignes = (candles: Candle[]): Ligne[] => candles.map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume, c.buyVolume!]);
const depuisLignes = (lignes: Ligne[]): Candle[] =>
  lignes.map(([time, open, high, low, close, volume, buy]) => ({ time, open, high, low, close, volume, buyVolume: buy, sellVolume: volume - buy }));
const empreinteCache = (lignes: Ligne[], ecartees: BougieEcartee[]): string => sha256(JSON.stringify({ lignes, ecartees }));
const fichierCache = (symbol: string): string => join(CACHE, `${symbol}.json.gz`);

interface SerieDef { symbol: string; debut: number }

function lireCache(def: SerieDef): { candles: Candle[]; acquisLeUtc: string; ecartees: BougieEcartee[] } {
  const fichier = fichierCache(def.symbol);
  if (!existsSync(fichier)) throw new Error(`cache absent : ${fichier} (lancer une fois « --telecharger »)`);
  const e = JSON.parse(gunzipSync(readFileSync(fichier)).toString("utf8")) as Enveloppe;
  if (
    e.schema !== SCHEMA_CACHE || e.endpoint !== ENDPOINT || e.symbol !== def.symbol || e.unite !== TF ||
    e.debut !== def.debut || e.fin !== FIN || !Array.isArray(e.lignes) || !Array.isArray(e.ecartees) ||
    empreinteCache(e.lignes, e.ecartees) !== e.sha256
  ) {
    throw new Error(`cache ${fichier} non traçable : le supprimer pour re-télécharger`);
  }
  return { candles: depuisLignes(e.lignes), ecartees: e.ecartees, acquisLeUtc: e.acquisLeUtc };
}

function ecrireCache(def: SerieDef, servies: Servies, acquisLeUtc: string): void {
  const lignes = versLignes(servies.candles);
  const enveloppe: Enveloppe = {
    schema: SCHEMA_CACHE, endpoint: ENDPOINT, symbol: def.symbol, unite: TF, debut: def.debut, fin: FIN,
    acquisLeUtc, sha256: empreinteCache(lignes, servies.ecartees), lignes, ecartees: servies.ecartees,
  };
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(fichierCache(def.symbol), gzipSync(JSON.stringify(enveloppe)));
}

function controlerSerie(symbol: string, candles: Candle[]): void {
  for (let i = 1; i < candles.length; i++) if (!(candles[i]!.time > candles[i - 1]!.time)) throw new Error(`${symbol} : série non strictement croissante`);
  if (candles.length <= WARMUP + 2) throw new Error(`${symbol} : série trop courte (${candles.length} bougies)`);
}

/** Hashes commités : 151 alts (résultat v3) + 4 majors (résultat flux). */
function hashesAttendus(): Map<string, string> {
  const attendus = new Map<string, string>();
  const v3 = JSON.parse(readFileSync(RESULTAT_V3, "utf8")) as { cellules: Array<{ symbol: string; acquisition: { sha256Ohlcv: string } }> };
  for (const c of v3.cellules) attendus.set(c.symbol, c.acquisition.sha256Ohlcv);
  const flux = JSON.parse(readFileSync(RESULTAT_FLUX, "utf8")) as { cellules: Array<{ id: string; resultat: { acquisition: { sha256Ohlcv: string } } }> };
  for (const c of flux.cellules) attendus.set(c.id.split(" ")[0]!, c.resultat.acquisition.sha256Ohlcv);
  return attendus;
}

async function chargerSerie(def: SerieDef, attendus: Map<string, string>): Promise<{ candles: Candle[]; chargement: Chargement }> {
  let servies: Servies;
  let acquisLeUtc: string;
  if (TELECHARGER) {
    servies = await telecharger(def.symbol, def.debut);
    acquisLeUtc = new Date().toISOString();
    ecrireCache(def, servies, acquisLeUtc);
  } else {
    const e = lireCache(def);
    servies = { candles: e.candles, ecartees: e.ecartees };
    acquisLeUtc = e.acquisLeUtc;
  }
  const empreinte = sha256(JSON.stringify(servies.candles));
  const attendu = attendus.get(def.symbol) ?? null;
  if (attendu !== null && empreinte !== attendu) {
    throw new Error(`${def.symbol} : sha256 mesuré ${empreinte.slice(0, 16)}… ≠ hash commité ${attendu.slice(0, 16)}… — arrêt sans résultat`);
  }
  controlerSerie(def.symbol, servies.candles);
  return {
    candles: servies.candles,
    chargement: { fichier: `axis-v5/${def.symbol}.json.gz`, sha256: empreinte, sha256Attendu: attendu, acquisLeUtc, ecarteesCache: servies.ecartees.length, invalidesLocales: 0 },
  };
}

function symbolesAlts(): SerieDef[] {
  const m = JSON.parse(readFileSync(MANIFESTE_V3, "utf8")) as { symboles: { nombre: number; liste: Array<{ symbol: string }> } };
  const liste = m.symboles.liste.map((s) => s.symbol);
  if (liste.length !== 151 || liste.length !== m.symboles.nombre || new Set(liste).size !== liste.length) throw new Error("manifeste v3 : pool de 151 symboles attendu");
  return liste.map((symbol) => ({ symbol, debut: DEBUT_ALTS }));
}

/** Panel B : mêmes débuts que les caches de la couche flux (essai E-* + campagne H-*). */
const MAJORS: SerieDef[] = [
  { symbol: "BTCUSDT", debut: Date.parse("2017-09-01T00:00:00Z") },
  { symbol: "ETHUSDT", debut: Date.parse("2017-09-01T00:00:00Z") },
  { symbol: "XRPUSDT", debut: Date.parse("2018-06-01T00:00:00Z") },
  { symbol: "SOLUSDT", debut: Date.parse("2020-09-01T00:00:00Z") },
  { symbol: "BNBUSDT", debut: Date.parse("2017-12-01T00:00:00Z") },
  { symbol: "ADAUSDT", debut: Date.parse("2018-05-01T00:00:00Z") },
  { symbol: "LINKUSDT", debut: Date.parse("2019-02-01T00:00:00Z") },
  { symbol: "DOGEUSDT", debut: Date.parse("2019-08-01T00:00:00Z") },
];

// ─────────────────────────── Référence BTC alignée (LOCF) ───────────────────────────

/**
 * Pour chaque bougie de la cellule : la dernière bougie BTC d'heure d'ouverture
 * ≤ la sienne. Contrôle bloquant : l'heure retenue est ≤ celle de la cellule et
 * aucune bougie BTC d'heure intermédiaire n'existe.
 */
function alignerBtc(btc: Candle[], candles: Candle[], symbol: string): { alignees: Array<Candle | undefined>; locf: number } {
  const heuresBtc = new Set(btc.map((c) => c.time));
  const alignees: Array<Candle | undefined> = new Array(candles.length).fill(undefined);
  let j = -1;
  let locf = 0;
  for (let i = 0; i < candles.length; i++) {
    const t = candles[i]!.time;
    while (j + 1 < btc.length && btc[j + 1]!.time <= t) j++;
    if (j < 0) continue;
    const b = btc[j]!;
    if (b.time > t) throw new Error(`${symbol} : alignement BTC incohérent à ${iso(t)}`);
    for (let k = j + 1; k < btc.length && btc[k]!.time <= t; k++) throw new Error(`${symbol} : bougie BTC intermédiaire oubliée à ${iso(t)}`);
    if (b.time < t) locf++;
    if (!heuresBtc.has(b.time)) throw new Error(`${symbol} : bougie BTC alignée absente de la série`);
    alignees[i] = b;
  }
  return { alignees, locf };
}

// ─────────────────────────── Préparation et positions ───────────────────────────

const PARAMS_AXIS = { seuil: SEUIL, seuilVente: SEUIL_VENTE, emaTendance: EMA_TENDANCE };

function lectures(candles: Candle[], btc: Candle[] | undefined, symbol: string): Omit<Serie, "panel" | "symbol" | "chargement"> {
  const votes = votesAxis(candles, PARAMS_AXIS);
  const closes = closeOf(candles);
  const ema200 = ema(closes, EMA_TENDANCE);
  if (btc === undefined) return { candles, score: votes.map((v) => v?.reduce((a, b) => a + b, 0)), ema200, auDessus: ema200.map((t, i) => (t === undefined ? undefined : closes[i]! > t)), r: [], ema100R: [], ema200R: [], ema400R: [], posBtc: [], locf: 0 };
  const { alignees, locf } = alignerBtc(btc, candles, symbol);
  const r = alignees.map((c) => c?.close);
  const ema100R = ema(r as number[], 100);
  const ema200R = ema(r as number[], EMA_TENDANCE);
  const ema400R = ema(r as number[], 400);
  // `btc-axis` : AXIS rejoué sur les bougies BTC alignées (même longueur, fin n−2).
  const candlesBtc = alignees.map((c, i) => c ?? candles[i]!);
  const votesBtc = votesAxis(candlesBtc, PARAMS_AXIS);
  const scoreBtc = votesBtc.map((v) => v?.reduce((a, b) => a + b, 0));
  const auDessusBtc = ema200R.map((t, i) => (t === undefined || r[i] === undefined ? undefined : r[i]! > t));
  const posBtc = positionsAxis(scoreBtc, auDessusBtc, SEUIL, SEUIL_VENTE, candles.length - 2);
  return { candles, score: votes.map((v) => v?.reduce((a, b) => a + b, 0)), ema200, auDessus: ema200.map((t, i) => (t === undefined ? undefined : closes[i]! > t)), r, ema100R, ema200R, ema400R, posBtc, locf };
}

function preparer(panel: Panel, symbol: string, charge: { candles: Candle[]; chargement: Chargement }, btc: Candle[] | undefined): Serie {
  const s: Serie = { panel, symbol, ...lectures(charge.candles, btc, symbol), chargement: charge.chargement };
  SERIES_PAR_CANDLES.set(charge.candles, s);
  return s;
}

// Les defs de position lisent ici les séries déjà calculées (le moteur ne passe que
// `candles`) ; une série inconnue est recalculée (compteur affiché : il doit rester à 0).
const SERIES_PAR_CANDLES = new WeakMap<Candle[], Serie>();
let recalculs = 0;
let BTC_REC: Candle[] = [];
const serieDe = (candles: Candle[]): Serie => {
  let s = SERIES_PAR_CANDLES.get(candles);
  if (s === undefined) {
    recalculs++;
    s = { panel: "A", symbol: "?", ...lectures(candles, BTC_REC, "?"), chargement: { fichier: "", sha256: "", sha256Attendu: null, acquisLeUtc: "", ecarteesCache: 0, invalidesLocales: 0 } };
    SERIES_PAR_CANDLES.set(candles, s);
  }
  return s;
};

/** Condition de tendance de la variante : base (close > EMA 200) ET garde-fou ; EMA indéfinie → indéfini. */
const tendanceDe = (s: Serie, v: Variante): Array<boolean | undefined> =>
  s.auDessus.map((a, i) => (a === undefined ? undefined : a && (v.filtre(s, i) ?? false)));

/**
 * Position d'une variante à garde-fou d'entrée seul : `positionsAxis` sur la
 * tendance composée. Les variantes à prédicat de sortie (`btc-ema200-sortie`)
 * passent par `positionsRegime` — modèle de `positionsV3` de l'exploration v3.
 */
function positionsRegime(s: Serie, v: Variante): Array<number | undefined> {
  const n = s.candles.length;
  const fin = n - 2;
  const tendance = tendanceDe(s, v);
  const pos: Array<number | undefined> = new Array(n).fill(undefined);
  let p: number | undefined;
  let arme = false;
  for (let i = 0; i < n; i++) {
    const sc = s.score[i];
    if (sc === undefined || i > fin) {
      pos[i] = p;
      continue;
    }
    if (p === 1) {
      const sortieScore = sc <= -SEUIL_VENTE;
      // Sortie « régime » à la clôture i ; lecture absente = pas de sortie par elle.
      const sortie = sortieScore || (v.sortie!(s, i) ?? false);
      if (sortie) {
        p = 0;
        // Armement de la v2 après une vente : à toute sortie, la condition complète
        // est fausse à l'instant i (score ≤ −4, ou le garde-fou coupé) ; réentrée
        // possible dès qu'elle redevient vraie.
        arme = true;
      }
      pos[i] = p;
      continue;
    }
    p = 0;
    const t = tendance[i];
    if (t !== undefined) {
      const achat = sc >= v.seuil && t;
      if (achat && arme) p = 1;
      arme = !achat;
    }
    pos[i] = p;
  }
  return pos;
}

const positionsDe = (s: Serie, v: Variante): Array<number | undefined> =>
  v.sortie === undefined
    ? positionsAxis(s.score, tendanceDe(s, v), v.seuil, SEUIL_VENTE, s.candles.length - 2)
    : positionsRegime(s, v);

/** Position du chart : sortie masquée `etat` (Phase 1) de `stratAxis.calc`. */
const positionChart = (candles: Candle[], params: Record<string, number | boolean>): Array<number | undefined> => {
  const etat = computeIndicator(stratAxis, candles, params).series.etat ?? [];
  return candles.map((_c, i) => etat[i]);
};

/** Contrôles de fidélité : v2 = positionsAxis = etat du chart ; G ≡ vrai = v2 ; sortie régime jamais vraie = btc-ema200. */
function controlerFidelite(s: Serie): void {
  const n = s.candles.length;
  const v2 = positionsDe(s, V2);
  const reference = positionsAxis(s.score, s.auDessus, SEUIL, SEUIL_VENTE, n - 2);
  for (let i = 0; i < n; i++) if (v2[i] !== reference[i]) throw new Error(`${s.symbol} : positions(v2) ≠ positionsAxis à l'indice ${i}`);
  const chart = positionChart(s.candles, {});
  for (let i = 0; i < n; i++) if (v2[i] !== chart[i]) throw new Error(`${s.symbol} : positions(v2) ≠ etat du chart à l'indice ${i}`);
  // Une variante dont le garde-fou vaut toujours vrai égale la v2.
  const toutVrai: Variante = { id: "controle-g-vrai", famille: "controle", ordre: -1, seuil: SEUIL, filtre: () => true, description: "" };
  const gVrai = positionsDe(s, toutVrai);
  for (let i = 0; i < n; i++) if (gVrai[i] !== v2[i]) throw new Error(`${s.symbol} : G ≡ vrai ≠ v2 à l'indice ${i}`);
  // `btc-ema200-sortie` dont la sortie régime n'est jamais vraie égale `btc-ema200`.
  const jamaisSortie: Variante = { id: "controle-sortie", famille: "controle", ordre: -1, seuil: SEUIL, filtre: G_EMA200, sortie: () => false, description: "" };
  const entree = positionsDe(s, VARIANTES[1]!);
  const reg = positionsDe(s, jamaisSortie);
  for (let i = 0; i < n; i++) if (reg[i] !== entree[i]) throw new Error(`${s.symbol} : sortie régime jamais vraie ≠ btc-ema200 à l'indice ${i}`);
}

// ─────────────────────────── Moteur ───────────────────────────

const idPosition = (v: Variante): string => `axisV5Position:${v.id}`;
for (const v of VARIANTES) {
  const id = idPosition(v);
  if (INDICATORS.some((d) => d.id === id)) continue;
  const def: IndicatorDef = {
    id,
    name: `AXIS v5 — position (${v.id})`,
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
  /** Bougies où le garde-fou est faux alors que la base est vraie (entrées refusées). */
  entreesRefusees: number;
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
    let refusees = 0;
    if (v.id !== "v2") {
      for (const s of series) {
        const t = tendanceDe(s, V2);
        for (let i = 0; i < s.candles.length; i++) if (t[i] === true && (v.filtre(s, i) ?? false) === false) refusees++;
      }
    }
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
      entreesRefusees: refusees,
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

/** Parts fenêtre du panel B restreintes aux 7 cellules hors BTC (la règle n'y lit pas BTC). */
function partsPanelB(B: PanelMesure): Record<string, Parts> {
  const hors = B.series.filter((s) => s.symbol !== "BTCUSDT");
  const ref = hors.map((s) => plageFenetre(B.parCellule[s.symbol]!["v2"]!["x1"]!));
  const out: Record<string, Parts> = {};
  for (const v of VARIANTES) {
    out[v.id] = parts(hors.map((s) => plageFenetre(B.parCellule[s.symbol]![v.id]!["x1"]!)), ref);
  }
  return out;
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

function choisir(A: Record<string, Agregat>, partsB: Record<string, Parts>, metrique: Choix["metrique"]): Choix {
  const v2 = A["v2"]!;
  const conditions: Record<string, Conditions> = {};
  const eligibles: string[] = [];
  for (const v of VARIANTES) {
    if (v.id === "v2") continue;
    const a = A[v.id]!;
    const eligible = (a.expectancyRegroupeeX3 ?? -Infinity) > 0 && a.fermes * 1e6 >= Math.round(PART_MIN_TRADES_V2 * 1e6) * v2.fermes;
    const f = partDe(a.comparaison.fenetre, metrique);
    const m1 = partDe(a.comparaison.moitie1, metrique);
    const m2 = partDe(a.comparaison.moitie2, metrique);
    const pb = partDe(partsB[v.id]!, metrique);
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

/** Témoin : la ligne v2 de chaque panel doit reproduire les agrégats du rapport v4. */
function controlerTemoin(A: PanelMesure, B: PanelMesure): void {
  const ecarts: string[] = [];
  const verif = (nom: string, a: Agregat, t: typeof TEMOIN.A): void => {
    if (a.trades !== t.trades) ecarts.push(`${nom} trades ${a.trades} ≠ ${t.trades}`);
    if (a.fermes !== t.fermes) ecarts.push(`${nom} clos ${a.fermes} ≠ ${t.fermes}`);
    if (fmt(a.expectancyRegroupeeX1, 2) !== t.expX1) ecarts.push(`${nom} exp x1 ${fmt(a.expectancyRegroupeeX1, 2)} ≠ ${t.expX1}`);
    if (fmt(a.expectancyRegroupeeX3, 2) !== t.expX3) ecarts.push(`${nom} exp x3 ${fmt(a.expectancyRegroupeeX3, 2)} ≠ ${t.expX3}`);
    if (fmt(a.pnlMoyenPct, 1) !== t.pnlMoyen) ecarts.push(`${nom} PnL moyen ${fmt(a.pnlMoyenPct, 1)} ≠ ${t.pnlMoyen}`);
    if (fmt(a.medianePnlPct, 1) !== t.medPnl) ecarts.push(`${nom} méd. PnL ${fmt(a.medianePnlPct, 1)} ≠ ${t.medPnl}`);
    if (fmt(a.medianeDdPct, 1) !== t.medDd) ecarts.push(`${nom} méd. DD ${fmt(a.medianeDdPct, 1)} ≠ ${t.medDd}`);
    if (fmt(a.medianeSharpe, 2) !== t.medSharpe) ecarts.push(`${nom} méd. Sharpe ${fmt(a.medianeSharpe, 2)} ≠ ${t.medSharpe}`);
    if (fmt(a.medianeFermes, 0) !== t.medFermes) ecarts.push(`${nom} méd. clos ${fmt(a.medianeFermes, 0)} ≠ ${t.medFermes}`);
    if (fmt(a.expositionMoyennePct, 1) !== t.expo) ecarts.push(`${nom} expo ${fmt(a.expositionMoyennePct, 1)} ≠ ${t.expo}`);
  };
  verif("panel A v2", A.agregats["v2"]!, TEMOIN.A);
  verif("panel B v2 (8 cellules)", B.agregats["v2"]!, TEMOIN.B);
  if (ecarts.length > 0) throw new Error(`témoin v2 non reproduit — arrêt sans résultat :\n  ${ecarts.join("\n  ")}`);
}

// ─────────────────────────── Programme ───────────────────────────

async function main(): Promise<void> {
  mkdirSync(SORTIES, { recursive: true });
  const debutUtc = new Date().toISOString();
  const attendus = hashesAttendus();
  process.stderr.write(TELECHARGER ? "Téléchargement des 159 séries (klines Binance Spot, pages de 1 000) :\n" : "Lecture du cache axis-v5 (aucun téléchargement) :\n");
  // Référence BTC en premier : toutes les cellules (y compris BTC elle-même) sont
  // préparées avec R alignée.
  const btcCharge = await chargerSerie(MAJORS[0]!, attendus);
  const btcSerie = btcCharge.candles;
  BTC_REC = btcSerie;
  const altsAvecBtc: Serie[] = [];
  for (const d of symbolesAlts()) altsAvecBtc.push(preparer("A", d.symbol, await chargerSerie(d, attendus), btcSerie));
  const majors: Serie[] = [preparer("B", MAJORS[0]!.symbol, btcCharge, btcSerie)];
  for (const d of MAJORS.slice(1)) majors.push(preparer("B", d.symbol, await chargerSerie(d, attendus), btcSerie));

  for (const s of [...altsAvecBtc, ...majors]) controlerFidelite(s);
  const verifies = [...altsAvecBtc, ...majors].filter((s) => s.chargement.sha256Attendu !== null).length;
  const parTemoin = [...altsAvecBtc, ...majors].length - verifies;
  process.stderr.write(`\n  ✓ panel A : ${altsAvecBtc.length} séries (${altsAvecBtc.reduce((a, s) => a + s.candles.length, 0)} bougies) ; panel B : ${majors.length} séries (${majors.reduce((a, s) => a + s.candles.length, 0)} bougies) ; ${verifies} hashes commités vérifiés, ${parTemoin} séries sans hash (témoin v2) ; fidélité OK\n`);

  const A = mesurerPanel("A", altsAvecBtc);
  const B = mesurerPanel("B", majors);
  if (recalculs !== 0) throw new Error(`${recalculs} recalculs de séries hors cache : les defs de position n'ont pas lu les séries préparées`);

  controlerTemoin(A, B);
  process.stderr.write("  ✓ témoin : agrégats v2 reproduits à la décimale près (panels A et B)\n");

  const partsB = partsPanelB(B);
  const choixSharpe = choisir(A.agregats, partsB, "sharpe");
  const choixExpectancy = choisir(A.agregats, partsB, "expectancy");
  const horodatage = new Date().toISOString();

  const decrireSerie = (s: Serie) => ({
    symbol: s.symbol, fichier: s.chargement.fichier, sha256: s.chargement.sha256, sha256Attendu: s.chargement.sha256Attendu, acquisLeUtc: s.chargement.acquisLeUtc,
    bougies: s.candles.length, premierOpen: iso(s.candles[0]!.time), derniereCloture: iso(s.candles.at(-1)!.time + TF_MS),
    ecarteesCache: s.chargement.ecarteesCache, invalidesLocales: s.chargement.invalidesLocales,
    debutEvaluation: iso(debutEvaluation(s)), milieuEvaluation: iso(milieuEvaluation(s)),
    bougiesLocf: s.locf, partLocf: s.candles.length === 0 ? null : s.locf / s.candles.length,
  });
  const resultat = {
    objet: "Exploration AXIS v5 (garde-fou de régime BTC) sur données DÉJÀ VUES — SANS VALEUR PROBANTE",
    debutUtc,
    genereLeUtc: horodatage,
    parametres: {
      timeframe: TF, warmupBougies: WARMUP, capitalInitial: CAPITAL, tailleFixe: TAILLE, seuil: SEUIL, seuilVente: SEUIL_VENTE, emaTendance: EMA_TENDANCE,
      referenceBtc: "BTCUSDT 4h alignée par heure d'ouverture (LOCF) ; EMA de R sur la série alignée ; lecture absente = garde-fou faux",
      couts: COUTS, bougies4hParAn: BOUGIES_4H_PAR_AN,
      regleDeChoix: {
        eligibilite: `panel A : expectancy nette regroupée x3 > 0 ET trades clos regroupés ≥ ${PART_MIN_TRADES_V2 * 100} % de ceux de la v2`,
        metrique: "panel A, x1 : part des cellules comparables (Sharpe défini des deux côtés) où Sharpe(variante) > Sharpe(v2), fenêtre entière",
        classement: "part décroissante ; égalité : trades clos regroupés décroissants, puis ordre de la grille",
        retenue: `première du classement si part ≥ ${PART_MIN_FENETRE * 100} % (panel A, fenêtre), > ${PART_MIN_MOITIE * 100} % dans chaque moitié (panel A) et ≥ ${MIN_MAJORS}/7 sur le panel B hors BTC ; sinon aucune`,
        descriptif: "même sélection avec la part des cellules où l'expectancy nette par trade de la variante dépasse celle de la v2 (hors règle)",
      },
      variantes: VARIANTES.map((v) => ({ id: v.id, famille: v.famille, ordre: v.ordre, seuil: v.seuil, description: v.description })),
    },
    panels: {
      A: { nom: NOM_PANEL.A, caches: altsAvecBtc.map(decrireSerie), agregatsX1: A.agregats, cellules: A.parCellule },
      B: { nom: NOM_PANEL.B, caches: majors.map(decrireSerie), agregatsX1: B.agregats, cellules: B.parCellule },
    },
    choix: { regle: choixSharpe, descriptifExpectancy: choixExpectancy, coincide: choixSharpe.retenue === choixExpectancy.retenue },
  };
  writeFileSync(join(SORTIES, "resultat.json"), JSON.stringify(resultat, remplaceur, 2));
  writeFileSync(join(SORTIES, "rapport.md"), rapport(A, B, partsB, choixSharpe, choixExpectancy, horodatage));
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
    ["Variante", "Trades (clos)", "Clos / v2", "Exp. x1 %", "Exp. x3 %", "PnL moyen / cell. %", "Méd. PnL %", "Méd. DD %", "Méd. Sharpe", "Méd. clos", "Expo %", "Entrées refusées", "Fenêtre : Sharpe > · DD < · PnL ≥ · Exp. > · RoMaD >", "Moitié 1 : Sharpe >", "Moitié 2 : Sharpe >", "Éligible"],
    VARIANTES.map((v) => {
      const a = P.agregats[v.id]!;
      const c = a.comparaison;
      return [
        v.id === retenue ? `**${v.id}**` : v.id, `${a.trades} (${a.fermes})`, a.partFermesV2 === null ? "—" : pourcent(a.fermes, Math.round(a.fermes / a.partFermesV2)),
        fmt(a.expectancyRegroupeeX1, 2), fmt(a.expectancyRegroupeeX3, 2), fmt(a.pnlMoyenPct, 1), fmt(a.medianePnlPct, 1), fmt(a.medianeDdPct, 1), fmt(a.medianeSharpe, 2), fmt(a.medianeFermes, 0), fmt(a.expositionMoyennePct, 1), a.entreesRefusees,
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

function texteChoix(choix: Choix, A: Record<string, Agregat>, partsB: Record<string, Parts>): string[] {
  const conditionsTexte = (id: string): string => {
    const c = choix.conditions[id]!;
    const fa = partDe(A[id]!.comparaison.fenetre, choix.metrique);
    const m1 = partDe(A[id]!.comparaison.moitie1, choix.metrique);
    const m2 = partDe(A[id]!.comparaison.moitie2, choix.metrique);
    const pb = partDe(partsB[id]!, choix.metrique);
    return `fenêtre A ${fa.k}/${fa.n} (${pourcent(fa.k, fa.n)}, ≥ ${PART_MIN_FENETRE * 100} % : ${c.fenetreA ? "oui" : "non"}) ; moitiés A ${m1.k}/${m1.n} et ${m2.k}/${m2.n} (> ${PART_MIN_MOITIE * 100} % chacune : ${c.moitiesA[0] && c.moitiesA[1] ? "oui" : "non"}) ; panel B hors BTC ${pb.k}/${pb.n} (≥ ${MIN_MAJORS} : ${c.majorsB ? "oui" : "non"})`;
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

function rapport(A: PanelMesure, B: PanelMesure, partsB: Record<string, Parts>, choixSharpe: Choix, choixExpectancy: Choix, horodatage: string): string {
  const retenue = choixSharpe.retenue;
  const tableCaches = (P: PanelMesure): string =>
    tableau(
      ["Cellule", "Fichier", "SHA-256 mesuré", "SHA-256 commité", "Bougies", "Premier open", "Dernière clôture", "LOCF", "Début d'évaluation", "Milieu (2e moitié dès)", "Écartées"],
      P.series.map((s) => [
        s.symbol, s.chargement.fichier, `\`${s.chargement.sha256.slice(0, 16)}…\``, s.chargement.sha256Attendu === null ? "— (témoin)" : `\`${s.chargement.sha256Attendu.slice(0, 16)}…\``,
        s.candles.length, iso(s.candles[0]!.time), iso(s.candles.at(-1)!.time + TF_MS), `${s.locf} (${pourcent(s.locf, s.candles.length)})`,
        iso(debutEvaluation(s)), iso(milieuEvaluation(s)), `${s.chargement.ecarteesCache}`,
      ])
    );
  const tableConditions = (choix: Choix): string =>
    tableau(
      ["Variante", "Éligible (exp. x3 > 0, clos ≥ 50 % v2)", "Fenêtre A ≥ 60 %", "Moitié 1 A > 50 %", "Moitié 2 A > 50 %", "Panel B hors BTC ≥ 5/7", "Toutes"],
      VARIANTES.filter((v) => v.id !== "v2").map((v) => {
        const c = choix.conditions[v.id]!;
        const oui = (b: boolean): string => (b ? "oui" : "non");
        return [v.id, oui(c.eligible), oui(c.fenetreA), oui(c.moitiesA[0]), oui(c.moitiesA[1]), oui(c.majorsB), oui(c.eligible && c.fenetreA && c.moitiesA[0] && c.moitiesA[1] && c.majorsB)];
      })
    );
  const sections = [
    "# AXIS v5 — exploration d'un garde-fou de régime BTC sur données DÉJÀ VUES",
    "",
    "**SANS VALEUR PROBANTE — données déjà vues, grille de 6 variantes.** Ce rapport sert uniquement à pré-déclarer au plus UNE variante à soumettre au propriétaire, selon la règle écrite dans l'en-tête de `scripts/explorer-axis-v5.ts` avant la première exécution. Si aucune variante n'est retenue, aucune n'est proposée.",
    "",
    `Généré le ${horodatage}. Référence BTC : BTCUSDT 4h alignée par heure d'ouverture sur chaque cellule (LOCF, comme \`refClose\` du chart) ; les EMA de R sont calculées sur la série alignée ; lecture absente = garde-fou faux. Moteur \`runBacktest\` : jambe longue, taille fixe ${TAILLE}, capital ${CAPITAL}, warmup ${WARMUP} bougies, décision à la clôture, fill à l'open suivant. Coûts x1 = 0,05 % frais + 0,02 % slippage par côté ; x3 = 0,15 % + 0,06 %. Sortie commune : score ≤ −${SEUIL_VENTE}, sans stop (sauf \`btc-ema200-sortie\` : sortie additionnelle si BTC ≤ EMA 200(BTC)). Drawdown : equity valorisée aux clôtures. Sharpe par bougie : rendements de l'equity par clôture, moyenne / écart-type (n−1) × √${BOUGIES_4H_PAR_AN}. Moitiés : frontière au milieu des décisions évaluées ; trades affectés par le fill d'entrée, drawdown et Sharpe sur les points d'equity de la moitié.`,
    "",
    "## Grille de variantes",
    "",
    tableau(["Variante", "Famille", "Seuil de score", "Description"], VARIANTES.map((v) => [v.id, v.famille, v.seuil, v.description])),
    "",
    "La cellule BTCUSDT du panel B coïncide avec la référence : tout garde-fou y égale la base ; elle est rapportée à titre descriptif et EXCLUE des parts du panel B (7 cellules).",
    "",
    "## Règle de choix et résultat",
    "",
    `Éligibilité (panel A) : expectancy nette regroupée x3 > 0 ET trades clos regroupés ≥ ${PART_MIN_TRADES_V2 * 100} % de ceux de la v2. Métrique (panel A, x1) : part des cellules comparables où le Sharpe de la variante dépasse strictement celui de la v2, fenêtre entière. Classement : part décroissante, puis trades clos décroissants, puis ordre de la grille. Retenue : la première si part ≥ ${PART_MIN_FENETRE * 100} % (fenêtre A), > ${PART_MIN_MOITIE * 100} % dans chaque moitié (A) et ≥ ${MIN_MAJORS}/7 sur le panel B hors BTC.`,
    "",
    ...texteChoix(choixSharpe, A.agregats, partsB),
    "",
    tableConditions(choixSharpe),
    "",
    "### Descriptif : si la métrique portait sur l'expectancy nette par trade (hors règle)",
    "",
    ...texteChoix(choixExpectancy, A.agregats, partsB),
    "",
    choixExpectancy.retenue === retenue ? "Les deux métriques **coïncident**." : "Les deux métriques **ne coïncident pas**.",
    "",
    `## Agrégats — panel ${NOM_PANEL.A} (coûts x1 ; expectancies regroupées x1 et x3)`,
    "",
    tableAgregats(A, choixSharpe),
    "",
    "Lecture des parts : cellules comparables (Sharpe défini pour la variante et la v2) où la variante fait mieux — Sharpe strictement supérieur · drawdown max plus faible · PnL net ≥ · expectancy nette par trade supérieure (les deux définies) · RoMaD supérieur. La ligne `v2` sert de témoin (0 partout). « Entrées refusées » : bougies où le garde-fou est faux alors que la base est vraie.",
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
    "## Données (re-téléchargées dans `scripts/.cache-klines/axis-v5/`, vérifiées par hash)",
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
    "Mesures PASSÉES sur des données déjà consommées par les campagnes AXIS (151 alts du test v3, 2023-07 → 2026-10 ; 8 grandes cryptos, 2017/2020 → 2026-10) : elles choisissent une variante, elles ne la valident pas. Seul un test sur données jamais vues, pré-déclaré, peut le faire. Contrôles passés : hash des 155 séries qui en ont un commité (151 alts + BNB/ADA/LINK/DOGE) ; BTC/ETH/XRP/SOL sans hash commité, vérifiés par la reproduction exacte du témoin v2 ; positions(v2) = positionsAxis = sortie masquée `etat` du chart ; G ≡ vrai = v2 ; sortie régime jamais vraie = btc-ema200 ; alignement LOCF contrôlé bougie par bougie ; trades du moteur = naissances après warmup à chaque coût ; mêmes fills à x1 et x3.",
    ""
  );
  return sections.join("\n");
}

void main();
