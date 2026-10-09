#!/usr/bin/env bun
/**
 * AXIOM — test de la v4 d'AXIS (filtre ADX 14 ≥ 25 à l'entrée) contre la v2 et l'EMA 200
 * seule, sur données jamais vues, 9 octobre 2026.
 *
 * Script d'ORCHESTRATION (réseau + disque). Protocole, pool de symboles, fenêtres par
 * cellule, mesures, critères et suites vivent dans `scripts/axis/manifeste-v4-2026-10-09.json`,
 * figé avant tout téléchargement de ces données : son SHA-256, celui du code mesuré,
 * l'arbre des paquets mesurés et l'état git sont vérifiés avant le premier fetch, et
 * toutes les valeurs du protocole sont lues dans le manifeste (une seule source).
 *
 * Pour chaque cellule (paire USDT cotée entre le 2023-07-01 et le 2025-06-30, 4h, de sa
 * cotation au 2026-10-09 exclu), trois stratégies long/plat exécutées par `runBacktest`
 * aux coûts x1, x2, x3 : v4 (adxEntree 25), v2 (adxEntree 0), EMA 200 seule.
 * Critères pré-déclarés : P1 viabilité (expectancy nette regroupée > 0 à x1 et x3),
 * P2 amélioration (Sharpe par bougie v4 > v2 sur ≥ 60 % des cellules comparables),
 * P3 stabilité (même part > 50 % dans chaque moitié de chaque cellule). Contrôles
 * bloquants avant tout verdict (sinon arrêt sans verdict, sans aucune valeur mesurée).
 * Aucun résultat n'est affiché avant la fin du calcul.
 *
 * Tout ce que produit ce script est une mesure PASSÉE, jamais une promesse.
 *
 * Usage : bun scripts/valider-axis-v4.ts --campagne   exécution unique (pool du manifeste)
 *         bun scripts/valider-axis-v4.ts --essai      répétition sur les 8 symboles DÉJÀ VUS,
 *           cellules à partir du 2023-07-01, sorties dans /tmp, sans valeur probante
 *         bun scripts/valider-axis-v4.ts --banc       banc des chemins de verdict sur des
 *           résultats synthétiques, sans aucune donnée
 * Tout autre argument est refusé : une faute de frappe ne lance jamais la campagne.
 * Cache : `scripts/.cache-klines/axis-v4/` (gitignoré, re-vérifié par hash).
 * Vérification : ./node_modules/.bin/tsc --noEmit --strict --noUncheckedIndexedAccess
 *   --target es2022 --module esnext --moduleResolution bundler --skipLibCheck --types node
 *   scripts/valider-axis-v4.ts
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Candle, IndicatorDef, Timeframe } from "../packages/types/src/index";
import {
  closeOf,
  computeIndicator,
  construireTradesStrategie,
  ema,
  INDICATORS,
  MAX_LABELS_SORTIE,
  resolveParams,
  type EtatStrategie,
  type TradeStrategie,
} from "../packages/indicators/src/index";
import { adxOf } from "../packages/indicators/src/trend/adx";
import {
  ADX_ENTREE_PERIODE,
  ADX_ENTREE_TESTE,
  MAX_SIGNAUX_AXIS,
  positionsAxis,
  stratAxis,
  textesAxis,
  votesAxis,
} from "../packages/indicators/src/strategy/stratAxis";
import { runBacktest } from "../packages/backtest/src/engine";
import type { Operande, PointEquity, ResultatBacktest, StrategieDef, TradeResultat } from "../packages/backtest/src/types";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = fileURLToPath(import.meta.url);
const ARGS = process.argv.slice(2);
const MODES = ["--campagne", "--essai", "--banc"] as const;
type Mode = (typeof MODES)[number];
const estMode = (a: string | undefined): a is Mode => (MODES as readonly string[]).includes(a ?? "");
if (ARGS.length !== 1 || !estMode(ARGS[0])) {
  process.stderr.write("usage : bun scripts/valider-axis-v4.ts --campagne | --essai | --banc\n");
  process.exit(2);
}
const MODE: Mode = ARGS[0];
const CAMPAGNE = MODE === "--campagne";
/** Hors campagne (répétition, banc) : les écarts au figeage sont des avertissements, pas des refus. */
const ESSAI = !CAMPAGNE;
const CHEMIN_RUNNER = "scripts/valider-axis-v4.ts";
const CHEMIN_MANIFESTE = "scripts/axis/manifeste-v4-2026-10-09.json";
const MANIFESTE = join(RACINE, CHEMIN_MANIFESTE);
/** SHA-256 du manifeste figé ; « A_FIGER » tant que le figeage n'a pas eu lieu : la campagne est alors refusée. */
const HASH_MANIFESTE: string = "694c9aaf26bdbce7208e6f063e2b410d36640a2b1d46cdb326ad7e50eaf2d36f";
const SORTIES = CAMPAGNE ? join(RACINE, "scripts/axis") : "/tmp/axis-v4-essai";
const SORTIE_JSON = join(SORTIES, "resultat-v4-2026-10-09.json");
const SORTIE_MD = join(SORTIES, "rapport-v4-2026-10-09.md");
const DOSSIER_CACHE = join(RACINE, "scripts/.cache-klines/axis-v4");
const PREFIXE_CACHE = CAMPAGNE ? "H" : "E";
const LIMITE_PAGE = 1000;
/** Dossiers de l'arbre de code mesuré (versions.codeFigeNote) ; sert aussi d'empreinte observée avant figeage. */
const DOSSIERS_ARBRE = ["packages/indicators/src", "packages/backtest/src", "packages/types/src"];
/** Graphe d'import mesuré (versions.codeAuFigeageSha256) : empreintes observées avant figeage, vérifiées après. */
const FICHIERS_FIGES = [
  "packages/indicators/src/strategy/stratAxis.ts",
  "packages/indicators/src/utils.ts",
  "packages/indicators/src/utils-fabrique-strategie.ts",
  "packages/indicators/src/engine.ts",
  "packages/indicators/src/momentum/rsi.ts",
  "packages/indicators/src/trend/adx.ts",
  "packages/indicators/src/trend/macd.ts",
  "packages/indicators/src/trend/supertrend.ts",
  "packages/indicators/src/volume/cmf.ts",
  "packages/indicators/src/trend/ema.ts",
  "packages/indicators/src/registry.ts",
  "packages/indicators/src/index.ts",
  // Importé par le moteur de backtest (raisonTimeframeBacktest) ; ajouté à la demande de la revue, constat m2.
  "packages/indicators/src/timeframes.ts",
  "packages/backtest/src/engine.ts",
  "packages/backtest/src/types.ts",
  "packages/types/src/index.ts",
];
/** Préfixes de la série pour le contrôle de causalité (mesures.controlesBloquants). */
const COUPES_CAUSALITE = [0.4, 0.7, 0.9];
/** Poids Binance par minute au-delà duquel on attend la minute suivante (donnees.debit, vérifié contre la prose). */
const POIDS_MAX_PAR_MINUTE = 4800;
/** Au plus 4 symboles téléchargés en parallèle (donnees.parallelisme). */
const CONCURRENCE = 4;
/** Bornes de cotation du pool (symboles.regle), vérifiées symbole par symbole. */
const COTATION_MIN = "2023-07-01";
const COTATION_MAX = "2025-06-30";
/**
 * Texte 4h actuel de l'infobulle des signaux (RESERVE de stratAxis) : c'est le `{texteBase}`
 * des suites. Vérifié au démarrage contre `textesAxis("4h", 0, 0)`.
 */
const TEXTE_BASE_4H =
  "test réussi sur données jamais vues (crypto 4h, 2017-2024), pas mieux qu'une EMA 200 seule sur 3/4 actifs — mesure passée, pas une promesse";

// ─────────────────────────── Manifeste ───────────────────────────

interface Cout { id: string; frais: number; slippage: number }
interface Tirages { tirages: number; graine: number; fractionMin: number; fractionMax: number }
type Params = Record<string, number>;
interface SymbolePool { symbol: string; premierJour: string }
interface Manifeste {
  schema: string;
  figeLeUtc: string;
  signal: { indicateur: string; version: string; params: Params; paramsV2: Params; adxPeriode: number };
  marche: { endpoint: string; tailleFixeQuote: number; capitalInitialQuote: number };
  symboles: {
    regle: string;
    nombre: number;
    parAnneeDeCotation: Record<string, number>;
    liste: SymbolePool[];
    exclusionsNominatives: { stables: string[]; adosses: string[]; dejaVus: string[] };
  };
  fenetre: {
    id: string;
    timeframe: string;
    dureeMs: number;
    finExclue: string;
    bougiesMinimales: number;
    warmupBougies: number;
  };
  donnees: {
    toleranceBordsH: number;
    partMaxBougiesManquantes: number;
    reprises: { tentativesParPage: number; attentesS: number[] };
    delaiRequeteS: number;
    debit: string;
    pagination: string;
    parallelisme: string;
  };
  mesures: {
    coutsParCotePct: Cout[];
    sharpe: string;
    comparable: string;
    timing: { statut: string; statistique: string; nul: string };
    controlesBloquants: string[];
  };
  criteres: {
    minPartCellulesDisponibles: number;
    minCellulesComparables: number;
    minTradesClosRegroupesV4: number;
    partMinP2: number;
    partMinP3: number;
  };
  descriptif: Record<string, string>;
  limitesConnues: string[];
  suites: {
    FAVORABLE: { infobulle4hAdx25: string; infobulleAutreUniteAdx25: string };
    DEFAVORABLE: { infobulleFiltreActif: string; raisons: { P1: string; P2: string; P3: string; jonction: string } };
    NON_CONCLUANT: { infobulleFiltreActif: string; raisons: { cellules: string; comparables: string; trades: string; moitie: string } };
    communes: { sansFiltre: string; reglageHorsTest: string; placeholders: string };
  };
  repetitionTechnique: { debutInclus: string; symboles: string[] };
  versions: {
    baseCommit: string;
    codeAuFigeageSha256: "A_FIGER" | Record<string, string>;
    arbreCode: "A_FIGER" | { dossiers: string[]; fichiers: number; sha256: string };
    pnpmLockSha256: string;
    bun: string;
  };
}

const sha256 = (contenu: string | Uint8Array): string => createHash("sha256").update(contenu).digest("hex");
const iso = (ms: number): string => new Date(ms).toISOString();
/** Écarts au figeage : refus en campagne, simple avertissement en répétition. */
const avertissements: string[] = [];
const MANIFESTE_BRUT = readFileSync(MANIFESTE, "utf8");
const MANIFESTE_SHA256 = sha256(MANIFESTE_BRUT);

function lireManifeste(): Manifeste {
  if (HASH_MANIFESTE === "A_FIGER") {
    const message = "manifeste non figé (HASH_MANIFESTE = A_FIGER)";
    if (CAMPAGNE) throw new Error(`${message} : campagne refusée, aucun calcul autorisé`);
    avertissements.push(message);
  } else if (MANIFESTE_SHA256 !== HASH_MANIFESTE) {
    const message = `manifeste modifié : ${MANIFESTE_SHA256}, attendu ${HASH_MANIFESTE}`;
    if (CAMPAGNE) throw new Error(`${message}. Aucun calcul autorisé.`);
    avertissements.push(message);
  }
  return JSON.parse(MANIFESTE_BRUT) as Manifeste;
}

const M = lireManifeste();
const P4 = M.signal.params;
const P2 = M.signal.paramsV2;
const ENDPOINT = M.marche.endpoint;
const TAILLE = M.marche.tailleFixeQuote;
const CAPITAL = M.marche.capitalInitialQuote;
const WARMUP = M.fenetre.warmupBougies;
const BOUGIES_MIN = M.fenetre.bougiesMinimales;
const COUTS = M.mesures.coutsParCotePct;
const C = M.criteres;
const DELAI_REQUETE_S = M.donnees.delaiRequeteS;
const SANS_COUT: Cout = { id: "sans-cout", frais: 0, slippage: 0 };
/** Nul du timing : chiffres de `mesures.timing.nul` (prose), recopiés ici et vérifiés contre le texte. */
const TIMING: Tirages = { tirages: 1999, graine: 20261009, fractionMin: 0.1, fractionMax: 0.9 };
/** Bougies 4h par an de `mesures.sharpe` (√2191,5), vérifié contre le texte. */
const BOUGIES_PAR_AN = 2191.5;

const coutParId = (id: string): Cout => {
  const c = COUTS.find((x) => x.id === id);
  if (c === undefined) throw new Error(`manifeste : coût ${id} absent`);
  return c;
};
const X1 = coutParId("x1-central");
const X2 = coutParId("x2");
const X3 = coutParId("x3");

interface Fenetre { tf: Timeframe; dureeMs: number; fin: number }
/** Cellule : un symbole et le début de sa fenêtre (00:00 UTC de son premier jour de cotation). */
interface Cellule { symbol: string; premierJour: string; debut: number }

const debutDe = (premierJour: string): number => Date.parse(`${premierJour}T00:00:00Z`);
const celluleDe = (s: SymbolePool): Cellule => ({ symbol: s.symbol, premierJour: s.premierJour, debut: debutDe(s.premierJour) });

function verifierManifeste(): Fenetre {
  if (M.schema !== "axiom-axis-v4-backtest-v1") throw new Error(`manifeste : schéma ${M.schema} inattendu`);
  if (M.signal.indicateur !== stratAxis.id || M.signal.version !== "v4") throw new Error("manifeste : signal inattendu");
  const f = M.fenetre;
  if (f.timeframe !== "4h" || f.dureeMs !== 14_400_000) throw new Error("manifeste : unité ou durée inattendue");
  const fin = Date.parse(f.finExclue);
  if (!Number.isFinite(fin) || fin % f.dureeMs !== 0) throw new Error("manifeste : finExclue invalide ou hors grille");
  if (!(Number.isInteger(WARMUP) && WARMUP >= 2)) throw new Error("manifeste : warmup invalide");
  if (!(Number.isInteger(BOUGIES_MIN) && BOUGIES_MIN >= WARMUP + 2)) throw new Error("manifeste : bougiesMinimales invalide");
  if (![TAILLE, CAPITAL, C.minPartCellulesDisponibles, C.minCellulesComparables, C.minTradesClosRegroupesV4, C.partMinP2, C.partMinP3].every(Number.isFinite)) {
    throw new Error("manifeste : critères incomplets");
  }
  if (COUTS.length !== 3 || COUTS.some((c) => !(Number.isFinite(c.frais) && Number.isFinite(c.slippage)))) throw new Error("manifeste : coûts incomplets");
  if (!(P4.adxEntree !== undefined && P4.adxEntree > 0) || P2.adxEntree !== 0) throw new Error("manifeste : réglages adxEntree de la v4 et de la v2 incohérents");
  if (P4.adxEntree !== ADX_ENTREE_TESTE) throw new Error(`manifeste : adxEntree ${P4.adxEntree} ≠ ADX_ENTREE_TESTE ${ADX_ENTREE_TESTE} du code`);
  if (P4.stopAtr !== 0 || P2.stopAtr !== 0) throw new Error("manifeste : le test v4 se joue sans stop (stopAtr 0 des deux côtés)");
  for (const k of new Set([...Object.keys(P4), ...Object.keys(P2)])) {
    if (k !== "adxEntree" && P4[k] !== P2[k]) throw new Error(`manifeste : paramètre ${k} différent entre v4 et v2`);
  }
  if (M.signal.adxPeriode !== ADX_ENTREE_PERIODE) throw new Error(`manifeste : ADX ${M.signal.adxPeriode} ≠ ADX_ENTREE_PERIODE ${ADX_ENTREE_PERIODE} du code`);
  const nul = M.mesures.timing.nul;
  const chiffre = (motif: RegExp, valeur: string): void => {
    if (!motif.test(nul)) throw new Error(`manifeste : mesures.timing.nul ne contient pas « ${valeur} »`);
  };
  chiffre(new RegExp(`tirages ${TIMING.tirages}\\b`), `tirages ${TIMING.tirages}`);
  chiffre(new RegExp(`graine ${TIMING.graine}\\b`), `graine ${TIMING.graine}`);
  chiffre(/fractionMin 0,1\b/, "fractionMin 0,1");
  chiffre(/fractionMax 0,9\b/, "fractionMax 0,9");
  if (!/√2191,5/.test(M.mesures.sharpe)) throw new Error("manifeste : mesures.sharpe ne contient pas √2191,5");
  if (!/compte comme NON supérieur/.test(M.mesures.comparable)) throw new Error("manifeste : mesures.comparable ne dit pas qu'un Sharpe v4 indéfini compte comme non supérieur");
  if (!(Number.isFinite(DELAI_REQUETE_S) && DELAI_REQUETE_S > 0)) throw new Error("manifeste : donnees.delaiRequeteS invalide");
  if (!/\b4 800 points de poids Binance par minute\b/.test(M.donnees.debit) || POIDS_MAX_PAR_MINUTE !== 4800) {
    throw new Error("manifeste : donnees.debit ne contient pas « 4 800 points de poids Binance par minute »");
  }
  // Constantes du runner recoupées avec la prose du manifeste.
  if (!/\bpages de 1 000 klines\b/.test(M.donnees.pagination) || LIMITE_PAGE !== 1000) throw new Error("manifeste : donnees.pagination ne dit pas « pages de 1 000 klines »");
  if (!/\bau plus 4 symboles téléchargés en parallèle\b/.test(M.donnees.parallelisme) || CONCURRENCE !== 4) throw new Error("manifeste : donnees.parallelisme ne dit pas « au plus 4 symboles »");
  const causalite = M.mesures.controlesBloquants.find((c) => /^causalité/.test(c)) ?? "";
  if (!/trois préfixes \(40 %, 70 %, 90 % de la série\)/.test(causalite) || COUPES_CAUSALITE.join(",") !== "0.4,0.7,0.9") throw new Error("manifeste : contrôle de causalité sans les préfixes 40 %, 70 %, 90 %");
  const { tentativesParPage, attentesS } = M.donnees.reprises;
  if (attentesS.length !== tentativesParPage || attentesS.some((s) => !(Number.isFinite(s) && s > 0))) throw new Error("manifeste : donnees.reprises.attentesS ne compte pas une attente par tentative");
  const pool = M.symboles.liste.map((s) => s.symbol);
  const dejaVus = M.repetitionTechnique.symboles;
  if (pool.length !== M.symboles.nombre || new Set(pool).size !== pool.length) throw new Error("manifeste : pool incohérent");
  const nomSeul = (x: string): string => x.split(" ")[0] ?? x;
  const exclus = new Set([...M.symboles.exclusionsNominatives.stables, ...M.symboles.exclusionsNominatives.adosses, ...M.symboles.exclusionsNominatives.dejaVus].map(nomSeul));
  if (pool.some((s) => exclus.has(s)) || dejaVus.some((s) => pool.includes(s)) || dejaVus.length === 0) throw new Error("manifeste : ensembles de symboles non disjoints");
  const debutMin = debutDe(COTATION_MIN);
  const debutMax = debutDe(COTATION_MAX);
  for (const s of M.symboles.liste) {
    const j = debutDe(s.premierJour);
    if (!(Number.isFinite(j) && j % f.dureeMs === 0)) throw new Error(`manifeste : ${s.symbol} : premierJour ${s.premierJour} invalide`);
    if (j < debutMin || j > debutMax) throw new Error(`manifeste : ${s.symbol} coté à ${s.premierJour}, hors de la règle du pool (${COTATION_MIN} → ${COTATION_MAX})`);
    if (j + BOUGIES_MIN * f.dureeMs > fin) throw new Error(`manifeste : ${s.symbol} coté à ${s.premierJour} ne peut pas compter ${BOUGIES_MIN} bougies avant ${f.finExclue}`);
  }
  for (let i = 1; i < M.symboles.liste.length; i++) {
    const a = M.symboles.liste[i - 1]!;
    const b = M.symboles.liste[i]!;
    if (a.premierJour > b.premierJour || (a.premierJour === b.premierJour && a.symbol > b.symbol)) throw new Error("manifeste : pool non trié par cotation puis symbole");
  }
  // Faits du pool recoupés avec la liste et les constantes du code (revue, constat m3).
  if (!M.symboles.regle.includes(`entre le ${COTATION_MIN} et le ${COTATION_MAX} inclus`)) {
    throw new Error(`manifeste : symboles.regle ne dit pas « entre le ${COTATION_MIN} et le ${COTATION_MAX} inclus »`);
  }
  const parAnnee = new Map<string, number>();
  for (const s of M.symboles.liste) parAnnee.set(s.premierJour.slice(0, 4), (parAnnee.get(s.premierJour.slice(0, 4)) ?? 0) + 1);
  const annonce = Object.entries(M.symboles.parAnneeDeCotation);
  if (annonce.length !== parAnnee.size || annonce.some(([annee, n]) => parAnnee.get(annee) !== n)) {
    throw new Error("manifeste : symboles.parAnneeDeCotation ne correspond pas à la liste");
  }
  const debutEssai = debutDe(M.repetitionTechnique.debutInclus);
  if (!Number.isFinite(debutEssai) || debutEssai % f.dureeMs !== 0 || debutEssai + BOUGIES_MIN * f.dureeMs > fin) throw new Error("manifeste : repetitionTechnique.debutInclus invalide");
  if (textesAxis("4h", 0, 0).signaux !== TEXTE_BASE_4H) throw new Error("texte 4h de stratAxis différent du {texteBase} attendu : suites non reproductibles");
  if (textesAxis(undefined, 0, 0).signaux !== TEXTE_BASE_4H) throw new Error("texte sans unité de stratAxis différent du texte 4h");
  if (!textesAxis("4h", 0, P4.adxEntree).signaux.startsWith(`${TEXTE_BASE_4H} ; filtre ADX ${ADX_ENTREE_PERIODE} ≥ ${P4.adxEntree} à l'entrée`)) {
    throw new Error("texte 4h avec filtre actif : la mention du filtre ne suit pas le texte de base");
  }
  return { tf: "4h", dureeMs: f.dureeMs, fin };
}

const F = verifierManifeste();

// ─────────────────────────── Données ───────────────────────────

interface PlageManquante { apres: string; reprise: string; bougies: number }
interface BougieEcartee { temps: string; raison: string }
interface Servies { candles: Candle[]; ecartees: BougieEcartee[] }
interface Acquisition {
  source: string;
  acquisLeUtc: string;
  modeCalcul: "cache" | "reseau";
  debutCellule: string;
  nombre: number;
  attendues: number;
  premierOpen: string;
  dernierClose: string;
  /** Bougies attendues absentes de la série utilisée, écartées comprises (après la première bougie servie). */
  manquantes: number;
  plagesManquantes: PlageManquante[];
  ecartees: BougieEcartee[];
  sha256Ohlcv: string;
}

/** Raison d'écarter une bougie servie, `null` si elle est exploitable (volume nul compris). */
function raisonInvalide(c: Candle): string | null {
  if (![c.open, c.high, c.low, c.close, c.volume, c.buyVolume, c.sellVolume].every((v) => typeof v === "number" && Number.isFinite(v))) {
    return "OHLCV ou volume taker non fini";
  }
  if (c.open <= 0 || c.close <= 0 || c.low <= 0) return "prix ≤ 0";
  if (c.volume < 0 || c.buyVolume! < 0 || c.buyVolume! > c.volume * (1 + 1e-9)) return "volume taker incohérent";
  if (c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close)) return "high/low incohérents";
  return null;
}

/** Série servie mais inexploitable : cellule indisponible. Toute autre erreur d'acquisition arrête le run. */
class DonneesInvalides extends Error {}

const attendre = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

/** Pause commune à toutes les requêtes en vol (418/429, poids). */
let pauseJusqua = 0;
const suspendre = (jusqua: number): void => {
  pauseJusqua = Math.max(pauseJusqua, jusqua);
};

/** GET JSON avec les reprises du manifeste (réseau, 418, 429, 5xx, Retry-After) ; 400 code −1121 → indisponible. */
async function lireJson(url: string): Promise<unknown> {
  const { tentativesParPage, attentesS } = M.donnees.reprises;
  let cause = "";
  for (let t = 0; t < tentativesParPage; t++) {
    const derniere = t === tentativesParPage - 1;
    while (Date.now() < pauseJusqua) await attendre(pauseJusqua - Date.now());
    let statut: number;
    let entetes: Headers;
    let corps: string;
    try {
      const reponse = await fetch(url, { signal: AbortSignal.timeout(DELAI_REQUETE_S * 1000) });
      statut = reponse.status;
      entetes = reponse.headers;
      corps = await reponse.text();
    } catch (erreur) {
      cause = `réseau : ${(erreur as Error).message}`;
      if (!derniere) await attendre(1000 * (attentesS[t] ?? 16));
      continue;
    }
    const poids = Number(entetes.get("x-mbx-used-weight-1m"));
    if (Number.isFinite(poids) && poids >= POIDS_MAX_PAR_MINUTE) suspendre((Math.floor(Date.now() / 60_000) + 1) * 60_000 + 1_000);
    if (statut >= 200 && statut < 300) return JSON.parse(corps) as unknown;
    if (statut === 418 || statut === 429 || statut >= 500) {
      const retry = Number(entetes.get("retry-after"));
      const attente = 1000 * (Number.isFinite(retry) && retry > 0 ? retry : attentesS[t] ?? 16);
      cause = `HTTP ${statut}`;
      if (statut === 418 || statut === 429) suspendre(Date.now() + attente);
      if (!derniere) await attendre(attente);
      continue;
    }
    if (statut === 400 && /"code"\s*:\s*-1121/.test(corps)) throw new DonneesInvalides("symbole invalide (code −1121)");
    throw new Error(`Binance HTTP ${statut} : ${corps.slice(0, 200)}`);
  }
  throw new Error(`Binance indisponible après ${tentativesParPage} tentatives (${cause})`);
}

/**
 * Klines spot paginées sur `[debut de la cellule, fin[` (OHLCV + volume taker acheteur,
 * champ 9), bougies clôturées avant `fin` uniquement. Une kline invalide est écartée et
 * datée ; une page vide clôt la série ; une page courte aussi, sauf si sa dernière bougie
 * n'est pas la dernière attendue (la suite est redemandée).
 */
async function telecharger(c: Cellule): Promise<Servies> {
  const parTemps = new Map<number, Candle>();
  const ecartees = new Map<number, string>();
  let curseur = c.debut;
  for (;;) {
    const brut = await lireJson(`${ENDPOINT}?symbol=${c.symbol}&interval=${F.tf}&startTime=${curseur}&endTime=${F.fin - 1}&limit=${LIMITE_PAGE}`);
    if (!Array.isArray(brut)) throw new Error("réponse Binance non tabulaire");
    for (const ligne of brut) {
      if (!Array.isArray(ligne) || ligne.length < 10) throw new Error("ligne kline Binance sans champ taker");
      const [time, open, high, low, close, volume, closeTime, takerBuy] = [0, 1, 2, 3, 4, 5, 6, 9].map((i) => Number(ligne[i])) as [
        number, number, number, number, number, number, number, number,
      ];
      if (!Number.isFinite(time)) throw new Error("kline Binance sans temps d'ouverture exploitable");
      if (time < c.debut || time + F.dureeMs > F.fin) continue;
      const bougie: Candle = { time, open, high, low, close, volume, buyVolume: takerBuy, sellVolume: volume - takerBuy };
      const raison = raisonInvalide(bougie) ?? (closeTime + 1 !== time + F.dureeMs ? "closeTime incohérent" : null);
      if (raison === null) parTemps.set(time, bougie);
      else ecartees.set(time, raison);
    }
    if (brut.length === 0) break;
    const dernier = Number((brut.at(-1) as unknown[])[0]);
    if (!(dernier >= curseur)) throw new Error("pagination Binance sans progression");
    if (brut.length < LIMITE_PAGE && dernier + 2 * F.dureeMs > F.fin) break;
    curseur = dernier + 1;
  }
  return {
    candles: [...parTemps.values()].sort((a, b) => a.time - b.time),
    ecartees: [...ecartees].sort((a, b) => a[0] - b[0]).map(([t, raison]) => ({ temps: iso(t), raison })),
  };
}

interface SerieValidee { candles: Candle[]; attendues: number; manquantes: number; plages: PlageManquante[]; ecartees: BougieEcartee[] }

/**
 * Série exploitable : bougies invalides écartées, grille 4h, croissance stricte, première
 * bougie au plus 24 h après le début de la cellule, dernière au plus 24 h avant la fin,
 * longueur ≥ bougiesMinimales, trous ≤ 1 % des bougies attendues depuis la première servie.
 */
function valider(brutes: Candle[], debut: number): SerieValidee {
  const candles: Candle[] = [];
  const ecartees: BougieEcartee[] = [];
  for (const c of brutes) {
    if (!Number.isFinite(c.time)) throw new DonneesInvalides("bougie sans temps d'ouverture exploitable");
    const raison = raisonInvalide(c);
    if (raison === null) candles.push(c);
    else ecartees.push({ temps: iso(c.time), raison });
  }
  if (candles.length === 0) throw new DonneesInvalides("série vide");
  const d = F.dureeMs;
  const tolerance = Math.max(M.donnees.toleranceBordsH * 3_600_000, d);
  const premier = candles[0]!.time;
  if (premier < debut || premier - debut > tolerance) throw new DonneesInvalides(`première bougie à ${iso(premier)}, hors tolérance du début ${iso(debut)}`);
  for (const c of candles) if ((F.fin - c.time) % d !== 0) throw new DonneesInvalides(`bougie hors grille à ${iso(c.time)}`);
  for (let i = 1; i < candles.length; i++) {
    if (!(candles[i]!.time > candles[i - 1]!.time)) throw new DonneesInvalides(`série non strictement croissante à ${iso(candles[i]!.time)}`);
  }
  const dernier = candles.at(-1)!.time;
  if (dernier + d > F.fin || F.fin - (dernier + d) > tolerance) throw new DonneesInvalides(`dernière clôture à ${iso(dernier + d)}, hors tolérance de la fin ${iso(F.fin)}`);
  // Attendues depuis la première bougie servie : les créneaux du jour de cotation antérieurs ne comptent pas.
  const attendues = (F.fin - premier) / d;
  const derniereAttendue = F.fin - d;
  const plages: PlageManquante[] = [];
  for (let i = 1; i < candles.length; i++) {
    const k = (candles[i]!.time - candles[i - 1]!.time) / d - 1;
    if (k > 0) plages.push({ apres: iso(candles[i - 1]!.time), reprise: iso(candles[i]!.time), bougies: k });
  }
  if (dernier < derniereAttendue) plages.push({ apres: iso(dernier), reprise: iso(F.fin), bougies: (derniereAttendue - dernier) / d });
  const manquantes = plages.reduce((s, p) => s + p.bougies, 0);
  if (manquantes > M.donnees.partMaxBougiesManquantes * attendues) {
    throw new DonneesInvalides(`${manquantes} bougies manquantes (écartées comprises) sur ${attendues} attendues`);
  }
  if (candles.length < BOUGIES_MIN) throw new DonneesInvalides(`${candles.length} bougies, minimum ${BOUGIES_MIN}`);
  return { candles, attendues, manquantes, plages, ecartees };
}

function acquisition(c: Cellule, v: SerieValidee, ecarteesSource: BougieEcartee[], acquisLeUtc: string, modeCalcul: Acquisition["modeCalcul"]): Acquisition {
  return {
    source: ENDPOINT, acquisLeUtc, modeCalcul, debutCellule: iso(c.debut), nombre: v.candles.length, attendues: v.attendues,
    premierOpen: iso(v.candles[0]!.time), dernierClose: iso(v.candles.at(-1)!.time + F.dureeMs),
    manquantes: v.manquantes, plagesManquantes: v.plages,
    ecartees: [...ecarteesSource, ...v.ecartees].sort((a, b) => a.temps.localeCompare(b.temps)),
    sha256Ohlcv: sha256(JSON.stringify(v.candles)),
  };
}

// Cache compact : [time, open, high, low, close, volume, takerBuy] par bougie, gzip.
type Ligne = [number, number, number, number, number, number, number];
interface Enveloppe {
  schema: string; endpoint: string; symbol: string; unite: string; debut: number; fin: number;
  acquisLeUtc: string; sha256: string; lignes: Ligne[]; ecartees: BougieEcartee[];
  erreurSource?: string;
}
const SCHEMA_CACHE = "axiom-klines-axis-v4-v1";
const versLignes = (candles: Candle[]): Ligne[] => candles.map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume, c.buyVolume!]);
const depuisLignes = (lignes: Ligne[]): Candle[] =>
  lignes.map(([time, open, high, low, close, volume, buy]) => ({ time, open, high, low, close, volume, buyVolume: buy, sellVolume: volume - buy }));
const empreinteCache = (lignes: Ligne[], ecartees: BougieEcartee[], erreurSource: string | undefined): string =>
  sha256(JSON.stringify(erreurSource === undefined ? { lignes, ecartees } : { lignes, ecartees, erreurSource }));
const fichierCache = (symbol: string): string => join(DOSSIER_CACHE, `${PREFIXE_CACHE}-${symbol}.json.gz`);

function lireCache(c: Cellule): (Servies & { acquisLeUtc: string; erreurSource: string | undefined }) | null {
  const fichier = fichierCache(c.symbol);
  if (!existsSync(fichier)) return null;
  let e: Enveloppe;
  try {
    e = JSON.parse(gunzipSync(readFileSync(fichier)).toString("utf8")) as Enveloppe;
  } catch {
    throw new Error(`cache ${fichier} illisible : le supprimer pour re-télécharger`);
  }
  if (
    e.schema !== SCHEMA_CACHE || e.endpoint !== ENDPOINT || e.symbol !== c.symbol || e.unite !== F.tf || e.debut !== c.debut || e.fin !== F.fin ||
    !Array.isArray(e.lignes) || !Array.isArray(e.ecartees) || (e.erreurSource !== undefined && typeof e.erreurSource !== "string") ||
    empreinteCache(e.lignes, e.ecartees, e.erreurSource) !== e.sha256
  ) {
    throw new Error(`cache ${fichier} non traçable : le supprimer pour re-télécharger`);
  }
  return { candles: depuisLignes(e.lignes), ecartees: e.ecartees, acquisLeUtc: e.acquisLeUtc, erreurSource: e.erreurSource };
}

function ecrireCache(c: Cellule, servies: Servies, acquisLeUtc: string, erreurSource?: string): void {
  const lignes = versLignes(servies.candles);
  const enveloppe: Enveloppe = {
    schema: SCHEMA_CACHE, endpoint: ENDPOINT, symbol: c.symbol, unite: F.tf, debut: c.debut, fin: F.fin, acquisLeUtc,
    sha256: empreinteCache(lignes, servies.ecartees, erreurSource), lignes, ecartees: servies.ecartees,
    ...(erreurSource === undefined ? {} : { erreurSource }),
  };
  mkdirSync(DOSSIER_CACHE, { recursive: true });
  // Écriture atomique : une interruption ne laisse jamais un cache tronqué.
  const fichier = fichierCache(c.symbol);
  writeFileSync(`${fichier}.tmp`, gzipSync(JSON.stringify(enveloppe)));
  renameSync(`${fichier}.tmp`, fichier);
}

type Acquise =
  | { cellule: Cellule; statut: "disponible"; acquisition: Acquisition }
  | { cellule: Cellule; statut: "indisponible"; erreur: string };

/**
 * Acquisition seule (aucune mesure). La série servie est mise en cache AVANT sa validation,
 * exploitable ou non : une relance relit la même série et rend le même statut.
 */
async function acquerir(c: Cellule): Promise<Acquise> {
  try {
    const cache = lireCache(c);
    if (cache?.erreurSource !== undefined) throw new DonneesInvalides(cache.erreurSource);
    const acquisLeUtc = cache?.acquisLeUtc ?? new Date().toISOString();
    let servies: Servies | null = cache;
    if (servies === null) {
      try {
        servies = await telecharger(c);
      } catch (erreur) {
        if (erreur instanceof DonneesInvalides) ecrireCache(c, { candles: [], ecartees: [] }, acquisLeUtc, erreur.message);
        throw erreur;
      }
      ecrireCache(c, servies, acquisLeUtc);
    }
    const v = valider(servies.candles, c.debut);
    return { cellule: c, statut: "disponible", acquisition: acquisition(c, v, servies.ecartees, acquisLeUtc, cache === null ? "reseau" : "cache") };
  } catch (erreur) {
    if (!(erreur instanceof DonneesInvalides)) throw erreur;
    return { cellule: c, statut: "indisponible", erreur: erreur.message };
  }
}

/** Série d'une cellule disponible, relue depuis le cache et re-validée (identique à l'acquisition). */
function chargerPourMesure(a: Extract<Acquise, { statut: "disponible" }>): Candle[] {
  const cache = lireCache(a.cellule);
  if (cache === null) throw new Error(`cache absent pour ${a.cellule.symbol}`);
  const v = valider(cache.candles, a.cellule.debut);
  if (sha256(JSON.stringify(v.candles)) !== a.acquisition.sha256Ohlcv) throw new Error(`série relue différente de l'acquisition : ${a.cellule.symbol}`);
  return v.candles;
}

async function enParallele<T, R>(items: T[], n: number, f: (x: T) => Promise<R>, progression: (fait: number) => void): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let suivant = 0;
  let fait = 0;
  const travailleur = async (): Promise<void> => {
    while (suivant < items.length) {
      const k = suivant++;
      out[k] = await f(items[k]!);
      progression(++fait);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, travailleur));
  return out;
}

// ─────────────────────────── Position et règles ───────────────────────────

/**
 * Le moteur ne résout que des ids du registre, et la position 0/1 n'est pas une sortie
 * publique d'AXIS. Ces defs n'existent que dans le registre de ce processus : elles
 * lisent la sortie `prixSignal` du chart (définie exactement pendant un achat affiché)
 * avec les paramètres passés par la règle (adxEntree 25 pour la v4, 0 pour la v2).
 */
const ID_POSITION_V4 = "axisPositionV4Campagne";
const ID_POSITION_V2 = "axisPositionV2Campagne";
const defPosition = (id: string, name: string): IndicatorDef => ({
  ...stratAxis,
  id,
  name,
  outputs: [{ key: "position", name: "Position", style: "line" }],
  calc: (candles, params, ctx) => {
    const prix = stratAxis.calc(candles, params, ctx).series.prixSignal ?? [];
    return { series: { position: candles.map((_c, i) => (prix[i] === undefined ? 0 : 1)) } };
  },
});
const DEF_V4 = defPosition(ID_POSITION_V4, "AXIS v4 — position (campagne)");
const DEF_V2 = defPosition(ID_POSITION_V2, "AXIS v2 — position (campagne)");
for (const d of [DEF_V4, DEF_V2]) if (!INDICATORS.some((x) => x.id === d.id)) INDICATORS.push(d);

const positionDe = (def: IndicatorDef, candles: Candle[], params: Params): number[] => {
  const serie = computeIndicator(def, candles, params).series.position ?? [];
  return candles.map((_c, i) => (serie[i] === 1 ? 1 : 0));
};

type StratId = "v4" | "v2" | "ema";
const STRAT_IDS: StratId[] = ["v4", "v2", "ema"];
const LIBELLE_STRAT: Record<StratId, string> = { v4: `v4 (ADX ${ADX_ENTREE_PERIODE} ≥ ${P4.adxEntree} à l'entrée)`, v2: "v2 (sans filtre)", ema: `EMA ${P4.emaTendance} seule` };

const cst = (valeur: number): Operande => ({ type: "constante", valeur });
const jambePosition = (indicateurId: string, params: Params): StrategieDef => {
  const position: Operande = { type: "indicateur", indicateurId, params: { ...params }, output: "position" };
  return {
    direction: "long",
    tailleFixe: TAILLE,
    reglesEntree: [{ type: "croisement", a: position, b: cst(0.5), sens: "hausse" }],
    reglesSortie: [{ type: "comparaison", gauche: position, comparateur: "<", droite: cst(0.5) }],
  };
};
const close: Operande = { type: "prix", champ: "close" };
const emaReference: Operande = { type: "indicateur", indicateurId: "ema", params: { length: P4.emaTendance! }, output: "ema" };
const JAMBES: Record<StratId, StrategieDef> = {
  v4: jambePosition(ID_POSITION_V4, P4),
  v2: jambePosition(ID_POSITION_V2, P2),
  ema: {
    direction: "long",
    tailleFixe: TAILLE,
    reglesEntree: [{ type: "croisement", a: close, b: emaReference, sens: "hausse" }],
    reglesSortie: [{ type: "comparaison", gauche: close, comparateur: "<", droite: emaReference }],
  },
};

const executer = (candles: Candle[], strat: StrategieDef, cout: Cout): ResultatBacktest =>
  runBacktest(candles, strat, {
    fraisPct: cout.frais,
    slippagePct: cout.slippage,
    capitalInitial: CAPITAL,
    timeframe: F.tf,
    debutEvaluationMs: candles[WARMUP]!.time,
    finDonneesMs: candles.at(-1)!.time + F.dureeMs,
  });

const chronologie = (trades: TradeResultat[]): string => trades.map((t) => `${t.sens}:${t.tempsEntree}:${t.tempsSortie}:${t.raison}`).join("|");

// ─────────────────────────── Contrôles bloquants ───────────────────────────

/**
 * Écart détecté par un contrôle bloquant : ARRÊT sans verdict, jamais absorbé en cellule
 * « indisponible ». En campagne, le message ne nomme que la cellule et le contrôle ; le
 * détail (qui peut contenir une valeur) n'apparaît qu'en répétition.
 */
class EcartControle extends Error {
  readonly cellule: string;
  readonly controle: string;
  constructor(cellule: string, controle: string, detail: string) {
    super(ESSAI ? `${cellule} : contrôle « ${controle} » — ${detail}` : `${cellule} : contrôle « ${controle} » en écart`);
    this.cellule = cellule;
    this.controle = controle;
  }
}

type Positions = Array<number | undefined>;
interface Recalcul {
  pos: Positions;
  score: Positions;
  /** close > EMA de tendance (la tendance de la v2, sans filtre). */
  auDessusV2: Array<boolean | undefined>;
  adx: Positions;
  seuilAdx: number;
  seuil: number;
  signaux: number[];
}

/** Position recalculée depuis les fonctions exportées de stratAxis : positionsAxis sur la tendance complétée du filtre (fin = n − 2). */
function recalculer(candles: Candle[], params: Params): Recalcul {
  const p = resolveParams(stratAxis, params);
  const score = votesAxis(candles, p).map((v) => v?.reduce((s, x) => s + x, 0));
  const closes = closeOf(candles);
  const tendance = ema(closes, Number(p.emaTendance));
  const adx = adxOf(candles, ADX_ENTREE_PERIODE).adx;
  const seuilAdx = Number(p.adxEntree);
  const auDessusV2 = tendance.map((t, i) => (t === undefined ? undefined : closes[i]! > t));
  const auDessus = seuilAdx > 0 ? auDessusV2.map((a, i) => (a === undefined ? undefined : a && (adx[i] ?? -Infinity) >= seuilAdx)) : auDessusV2;
  const seuil = Number(p.seuil);
  const pos = positionsAxis(score, auDessus, seuil, Number(p.seuilVente), candles.length - 2);
  const signaux: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = pos[i - 1];
    if (prev !== undefined && pos[i] !== prev) signaux.push(i);
  }
  return { pos, score, auDessusV2, adx, seuilAdx, seuil, signaux };
}

/** Position de campagne (registre → prixSignal) = recalcul direct, à chaque bougie. */
function controlerPosition(cle: string, candles: Candle[], pos: number[], brute: Positions, variante: string): void {
  for (let i = 0; i < candles.length; i++) {
    if ((brute[i] === 1 ? 1 : 0) !== pos[i]) throw new EcartControle(cle, `position ${variante} = recalcul`, `position ${pos[i]} ≠ recalcul ${brute[i]} à ${iso(candles[i]!.time)}`);
  }
}

/** Sans stop (stopAtr 0) : la série « stop » du chart est entièrement indéfinie. */
function controlerSansStop(cle: string, candles: Candle[], params: Params, variante: string): void {
  const stop = computeIndicator(stratAxis, candles, params).series.stop ?? [];
  if (stop.length !== candles.length || stop.some((s) => s !== undefined)) throw new EcartControle(cle, `sans stop ${variante}`, "série « stop » définie sans stop");
}

/** La v2 de la campagne (adxEntree 0) = positionsAxis de la v2 livrée (tendance seule), à chaque bougie. */
function controlerV2(cle: string, candles: Candle[], r: Recalcul): void {
  const p = resolveParams(stratAxis, P2);
  if (r.seuilAdx !== 0) throw new EcartControle(cle, "v2 = positionsAxis", "réglage adxEntree non nul pour la v2");
  const reference = positionsAxis(r.score, r.auDessusV2, Number(p.seuil), Number(p.seuilVente), candles.length - 2);
  for (let i = 0; i < candles.length; i++) {
    if (reference[i] !== r.pos[i]) throw new EcartControle(cle, "v2 = positionsAxis", `recalcul ${r.pos[i]} ≠ positionsAxis ${reference[i]} à ${iso(candles[i]!.time)}`);
  }
}

/** Filtre sur les données réelles : chaque entrée de la v4 a ADX ≥ seuil ET la condition d'achat de la v2 vraie à la bougie de décision. */
function controlerFiltre(cle: string, candles: Candle[], r: Recalcul): void {
  for (let i = 1; i < candles.length; i++) {
    if (!(r.pos[i - 1] === 0 && r.pos[i] === 1)) continue;
    const a = r.adx[i];
    if (a === undefined || a < r.seuilAdx) throw new EcartControle(cle, "entrées v4 à ADX ≥ seuil", `entrée à ${iso(candles[i]!.time)} avec ADX ${a}`);
    const s = r.score[i];
    if (s === undefined || s < r.seuil || r.auDessusV2[i] !== true) throw new EcartControle(cle, "entrées v4 ⊂ condition v2", `entrée à ${iso(candles[i]!.time)} hors condition v2`);
  }
}

const MOTIF_STOP = "close sous le stop suiveur";
const MOTIF_ADX = `ADX ${ADX_ENTREE_PERIODE} `;

/**
 * Marqueurs du chart aux bougies et dans le sens des changements de position (les 120
 * plus récents) ; étiquettes « Achat » / « Vente » (jamais « Stop ») ; infobulle d'achat
 * nommant l'ADX si et seulement si le filtre est actif ; aucune mention de stop.
 */
function controlerMarqueurs(cle: string, candles: Candle[], params: Params, r: Recalcul, variante: string): void {
  const annotations = computeIndicator(stratAxis, candles, params).annotations;
  const marqueurs = (annotations?.marqueurs ?? []).filter((m) => m.couleur !== "--accent");
  const attendus = r.signaux.slice(-MAX_SIGNAUX_AXIS);
  const controle = `marqueurs ${variante} = changements de position`;
  if (marqueurs.length !== attendus.length) throw new EcartControle(cle, controle, `${marqueurs.length} marqueurs ≠ ${attendus.length} changements`);
  marqueurs.forEach((m, k) => {
    const idx = attendus[k]!;
    const achat = r.pos[idx] === 1;
    if (m.idx !== idx || m.forme !== (achat ? "triangleHaut" : "triangleBas")) throw new EcartControle(cle, controle, `marqueur ${k} à ${m.idx} (${m.forme}) ≠ changement à ${idx}`);
    const info = m.info ?? "";
    if (!info.startsWith(achat ? "AXIS achat" : "AXIS vente") || info.includes(MOTIF_STOP)) throw new EcartControle(cle, `infobulle ${variante}`, `infobulle de ${idx} hors contrat`);
    if (achat && info.includes(MOTIF_ADX) !== r.seuilAdx > 0) throw new EcartControle(cle, `infobulle ${variante} « ADX »`, `achat de ${idx} ${r.seuilAdx > 0 ? "sans" : "avec"} mention de l'ADX`);
  });
  const labels = (annotations?.labels ?? []).filter((l) => l.couleur !== "--accent");
  const avecLabel = attendus.slice(-MAX_LABELS_SORTIE);
  if (labels.length !== avecLabel.length) throw new EcartControle(cle, `étiquettes ${variante}`, `${labels.length} étiquettes ≠ ${avecLabel.length} attendues`);
  labels.forEach((l, k) => {
    const idx = avecLabel[k]!;
    const attendu = r.pos[idx] === 1 ? "Achat" : "Vente";
    if (l.idx !== idx || !l.texte.startsWith(attendu)) throw new EcartControle(cle, `étiquettes ${variante}`, `étiquette « ${l.texte} » à ${l.idx}, attendu « ${attendu} » à ${idx}`);
  });
}

/** Causalité : position d'un préfixe identique à la série complète jusqu'à l'avant-dernière bougie du préfixe. */
function controlerCausalite(cle: string, candles: Candle[], def: IndicatorDef, params: Params, pos: number[], variante: string): void {
  for (const f of COUPES_CAUSALITE) {
    const coupe = Math.floor(candles.length * f);
    const prefixe = candles.slice(0, coupe);
    const posPrefixe = positionDe(def, prefixe, params);
    for (let i = 0; i <= coupe - 2; i++) {
      if (posPrefixe[i] !== pos[i]) throw new EcartControle(cle, `causalité ${variante} (position)`, `préfixe ${f} diverge à ${iso(candles[i]!.time)}`);
    }
  }
}

/** Chronologie des décisions du moteur (x1) = changements de position nés après le warmup. */
function controlerChronologie(cle: string, candles: Candle[], rejeu: { trades: TradeStrategie[]; ouvert: TradeStrategie | null }, trades: TradeResultat[], variante: string): void {
  const controle = `chronologie moteur ${variante} = rejeu`;
  const index = new Map(candles.map((c, i) => [c.time, i]));
  const decision = (temps: number): number => {
    const i = index.get(temps);
    if (i === undefined) throw new EcartControle(cle, controle, `fill hors série à ${temps}`);
    return i - 1;
  };
  if (trades.some((t) => t.sens !== "long" || (t.raison !== "regle" && t.raison !== "fin-donnees"))) throw new EcartControle(cle, controle, "trade moteur hors contrat");
  const moteur = trades.filter((t) => t.raison === "regle").map((t) => `${decision(t.tempsEntree)}:${decision(t.tempsSortie)}`);
  const attendu = rejeu.trades.map((t) => `${t.idxEntree}:${t.idxSortie}`);
  if (moteur.join("|") !== attendu.join("|")) throw new EcartControle(cle, controle, `moteur ${moteur.length} trades ≠ rejeu ${attendu.length}`);
  const finDonnees = trades.filter((t) => t.raison === "fin-donnees");
  if (finDonnees.length !== (rejeu.ouvert === null ? 0 : 1)) throw new EcartControle(cle, controle, `${finDonnees.length} position(s) fin-données`);
  if (rejeu.ouvert !== null && decision(finDonnees[0]!.tempsEntree) !== rejeu.ouvert.idxEntree) throw new EcartControle(cle, controle, "entrée fin-données ≠ rejeu");
}

// ─────────────────────────── Timing (descriptif) ───────────────────────────

interface SerieTiming { L: number; prefixe: Float64Array; runs: Array<[number, number]>; exposition: number }
type Intervalles = Array<[number, number]>;

/** Rendement log de la bougie détenue après chaque décision évaluée a … n−2, sommes préfixes sur la série doublée. */
function prefixeTiming(candles: Candle[], a: number): { L: number; prefixe: Float64Array } {
  const n = candles.length;
  const L = n - 1 - a;
  const r = (j: number): number => {
    const i = a + j;
    return i + 2 <= n - 1 ? Math.log(candles[i + 2]!.open / candles[i + 1]!.open) : Math.log(candles[n - 1]!.close / candles[n - 1]!.open);
  };
  const prefixe = new Float64Array(2 * L + 1);
  for (let j = 0; j < 2 * L; j++) prefixe[j + 1] = prefixe[j]! + r(j % L);
  return { L, prefixe };
}

const intervallesValides = (runs: Intervalles, L: number): boolean => runs.every(([d, f]) => d >= 0 && f >= d && f < L);
const exposition = (runs: Intervalles, L: number): number => runs.reduce((s, [d, f]) => s + f - d + 1, 0) / L;
const capte = (x: SerieTiming, k: number): number => x.runs.reduce((s, [d, f]) => s + x.prefixe[f + k + 1]! - x.prefixe[d + k]!, 0);

function serieTiming(cle: string, base: { L: number; prefixe: Float64Array }, trades: TradeStrategie[], ouvert: TradeStrategie | null, a: number, n: number): SerieTiming {
  const runs: Intervalles = trades.map((t) => [t.idxEntree - a, t.idxSortie! - 1 - a]);
  if (ouvert !== null) runs.push([ouvert.idxEntree - a, n - 2 - a]);
  if (!intervallesValides(runs, base.L)) throw new EcartControle(cle, "intervalles de timing", `intervalle hors [0, ${base.L}[`);
  return { ...base, runs, exposition: exposition(runs, base.L) };
}

/** Série de timing reconstruite depuis les fills d'une exécution (référence EMA). */
function serieDepuisFills(cle: string, base: { L: number; prefixe: Float64Array }, candles: Candle[], trades: TradeResultat[], a: number): SerieTiming {
  const index = new Map(candles.map((c, i) => [c.time, i]));
  const n = candles.length;
  const runs: Intervalles = [];
  for (const t of trades) {
    const e = index.get(t.tempsEntree);
    const s = t.raison === "fin-donnees" ? n : index.get(t.tempsSortie);
    if (e === undefined || s === undefined) throw new EcartControle(cle, "intervalles de timing (EMA)", "fill hors série");
    runs.push([e - 1 - a, s - 2 - a]);
  }
  if (!intervallesValides(runs, base.L)) throw new EcartControle(cle, "intervalles de timing (EMA)", `intervalle hors [0, ${base.L}[`);
  return { ...base, runs, exposition: exposition(runs, base.L) };
}

/** Statistique de timing observée = somme des ln(prixSortie/prixEntree) d'une exécution sans frais ni slippage. */
function controlerTiming(cle: string, serie: SerieTiming, sansCout: TradeResultat[], variante: string): void {
  const brut = sansCout.reduce((s, t) => s + Math.log(t.prixSortie / t.prixEntree), 0);
  if (Math.abs(brut - capte(serie, 0)) > 1e-9) throw new EcartControle(cle, `timing ${variante} = moteur sans coût`, `timing ${capte(serie, 0)} ≠ moteur ${brut}`);
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function mulberry32(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const U_TIMING: Float64Array = (() => {
  const rnd = mulberry32(TIMING.graine);
  return Float64Array.from({ length: TIMING.tirages }, () => rnd());
})();
const decalage = (L: number, u: number): number => Math.floor(L * (TIMING.fractionMin + (TIMING.fractionMax - TIMING.fractionMin) * u));

function quantile(v: ArrayLike<number>, q: number): number {
  const s = Float64Array.from(v).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
}

interface ResultatTiming { capteLog: number; p: number; medianeNulle: number; q95Nulle: number; L: number; tirages: number }

/** Décalage circulaire commun : un même k (calculé sur la plus courte fenêtre L) pour toutes les séries. */
function testTiming(series: SerieTiming[]): ResultatTiming {
  const L = Math.min(...series.map((s) => s.L));
  const total = (k: number): number => series.reduce((s, x) => s + capte(x, k), 0);
  const observe = total(0);
  const nul = Float64Array.from(U_TIMING, (u) => total(decalage(L, u)));
  let auDessus = 0;
  for (const v of nul) if (v >= observe) auDessus++;
  return { capteLog: observe, p: (1 + auDessus) / (nul.length + 1), medianeNulle: quantile(nul, 0.5), q95Nulle: quantile(nul, 0.95), L, tirages: nul.length };
}

// ─────────────────────────── Métriques d'une exécution ───────────────────────────

/**
 * Sharpe par bougie sur les points d'equity de `[debut, fin]` : chaque rendement part du
 * point précédent (le premier, du dernier point antérieur à la plage). `null` si moins de
 * deux rendements ou écart-type nul.
 */
function sharpeEquity(points: PointEquity[], debut: number, fin: number): number | null {
  const r: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    if (p.temps < debut || p.temps > fin) continue;
    const q = points[i - 1]!;
    if (q.equity > 0) r.push(p.equity / q.equity - 1);
  }
  return sharpeDe(r);
}

function sharpeDe(r: number[]): number | null {
  if (r.length < 2) return null;
  const m = r.reduce((a, v) => a + v, 0) / r.length;
  const variance = r.reduce((a, v) => a + (v - m) * (v - m), 0) / (r.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return null;
  return (m / sd) * Math.sqrt(BOUGIES_PAR_AN);
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

/** RoMaD = PnL net / drawdown max ; +∞ si drawdown nul avec gain ; `null` sans trade ni perte. */
const romadDe = (pnl: number, dd: number, trades: number): number | null => (dd > 0 ? pnl / dd : trades > 0 && pnl > 0 ? Infinity : null);

interface Plage { trades: number; pnlNet: number; ddMax: number; romad: number | null; sharpe: number | null; expectancyPct: number | null }
interface Metriques {
  trades: number;
  fermes: number;
  finDonnees: number;
  expectancyNette: number | null;
  expectancyPct: number | null;
  pnlTotal: number;
  pnlTotalPct: number;
  winRatePct: number | null;
  profitFactor: number | null;
  ddMax: number;
  ddMaxPct: number;
  romad: number | null;
  sharpe: number | null;
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

/** Open de la première bougie de la seconde moitié : frontière au milieu des décisions évaluées de la cellule (299 … n−2). */
const milieuEvaluation = (candles: Candle[]): number => candles[WARMUP + Math.floor((candles.length - WARMUP) / 2)]!.time;

function metriques(r: ResultatBacktest, candles: Candle[]): Metriques {
  const trades = r.trades;
  const n = trades.length;
  const somme = (f: (t: TradeResultat) => number): number => trades.reduce((acc, t) => acc + f(t), 0);
  const gains = somme((t) => (t.pnl > 0 ? t.pnl : 0));
  const pertes = somme((t) => (t.pnl < 0 ? -t.pnl : 0));
  const debut = candles[WARMUP]!.time;
  const milieu = milieuEvaluation(candles);
  const dernier = candles.at(-1)!.time;
  const dd = drawdownEquity(r.equity, debut, dernier);
  const pnlTotal = somme((t) => t.pnl);
  return {
    trades: n,
    fermes: trades.filter((t) => t.raison === "regle").length,
    finDonnees: trades.filter((t) => t.raison === "fin-donnees").length,
    expectancyNette: n === 0 ? null : pnlTotal / n,
    expectancyPct: n === 0 ? null : somme((t) => t.pnlPct) / n,
    pnlTotal,
    pnlTotalPct: (pnlTotal / CAPITAL) * 100,
    winRatePct: n === 0 ? null : (trades.filter((t) => t.pnl > 0).length / n) * 100,
    profitFactor: pertes > 0 ? gains / pertes : gains > 0 ? Infinity : null,
    ddMax: dd,
    ddMaxPct: (dd / CAPITAL) * 100,
    romad: romadDe(pnlTotal, dd, n),
    sharpe: sharpeEquity(r.equity, debut, dernier),
    dureeMoyenneBarres: n === 0 ? null : somme((t) => t.dureeBarres) / n,
    maeMoyenPct: n === 0 ? null : r.stats.maeMoyenPct,
    fraisTotal: somme((t) => t.frais),
    moities: [plage(r, debut, milieu - 1), plage(r, milieu, dernier)],
  };
}

/**
 * Seconde méthode du Sharpe : equity reconstruite depuis les trades et les closes (capital
 * réalisé + latent − frais d'entrée au taux du coût), sans lire l'equity du moteur.
 */
function sharpeDepuisTrades(candles: Candle[], trades: TradeResultat[], cout: Cout): number | null {
  const r: number[] = [];
  let capital = CAPITAL;
  let precedent = CAPITAL;
  let k = 0;
  for (let j = WARMUP; j < candles.length; j++) {
    const c = candles[j]!;
    while (k < trades.length && trades[k]!.tempsSortie <= c.time) {
      capital += trades[k]!.pnl;
      k++;
    }
    let equity = capital;
    const ouvert = trades[k];
    if (ouvert !== undefined && ouvert.tempsEntree <= c.time) {
      equity += ouvert.quantite * (c.close - ouvert.prixEntree) - ouvert.quantite * ouvert.prixEntree * (cout.frais / 100);
    }
    if (precedent > 0) r.push(equity / precedent - 1);
    precedent = equity;
  }
  return sharpeDe(r);
}

// ─────────────────────────── Mesure d'une cellule ───────────────────────────

/** Trade compact (x1) : [tempsEntree, tempsSortie, prixEntree, prixSortie, pnl, pnlPct, dureeBarres, raison, ADX à la décision d'entrée]. */
type TradeCompact = [number, number, number, number, number, number, number, "regle" | "fin-donnees", number | null];
interface StrategieCellule {
  executions: Record<string, Metriques>;
  exposition: number;
  timing: ResultatTiming;
  parAnnee: Array<{ annee: number; trades: number; pnl: number }>;
  tradesX1: TradeCompact[];
}
/** Effet du filtre sur la cellule (descriptif) : entrées de la v2 nées après le warmup, dont celles à ADX < seuil. */
interface FiltreCellule { entreesV2: number; refuseesParAdx: number; entreesV4: number; sansTradeV4: boolean }
interface CelluleMesuree {
  symbol: string;
  premierJour: string;
  acquisition: Acquisition;
  decisions: number;
  premierFillUtc: string;
  milieuUtc: string;
  achatConservationPct: number;
  strategies: Record<StratId, StrategieCellule>;
  filtre: FiltreCellule;
  sharpeSecondeMethode: { v4: number | null; v2: number | null } | null;
  empreinteChronologieX1: Record<StratId, string>;
}
interface SeriesTimingCellule { v4: SerieTiming; v2: SerieTiming; ema: SerieTiming }

const clos = (trades: TradeStrategie[]): Array<TradeStrategie & { idxSortie: number }> =>
  trades.filter((t): t is TradeStrategie & { idxSortie: number } => t.idxSortie !== undefined);

function parAnnee(trades: TradeResultat[]): Array<{ annee: number; trades: number; pnl: number }> {
  const m = new Map<number, { trades: number; pnl: number }>();
  for (const t of trades) {
    const annee = new Date(t.tempsEntree).getUTCFullYear();
    const g = m.get(annee) ?? { trades: 0, pnl: 0 };
    g.trades++;
    g.pnl += t.pnl;
    m.set(annee, g);
  }
  return [...m].sort((a, b) => a[0] - b[0]).map(([annee, g]) => ({ annee, ...g }));
}

/** Mesures d'une cellule disponible. Toute exception ici est un défaut du calcul : elle arrête la campagne. */
function mesurerCellule(c: Cellule, candles: Candle[], acq: Acquisition, controlerSharpe: boolean): { cellule: CelluleMesuree; series: SeriesTimingCellule } {
  const cle = c.symbol;
  const n = candles.length;
  if (n < WARMUP + 2) throw new Error(`${cle} : ${n} bougies, warmup ${WARMUP} impossible`);
  const a = WARMUP - 1;
  const index = new Map(candles.map((x, i) => [x.time, i]));

  // Contrôles : position du chart = recalcul, sans stop, v2 = positionsAxis, filtre, marqueurs, causalité.
  const r4 = recalculer(candles, P4);
  const r2 = recalculer(candles, P2);
  const pos4 = positionDe(DEF_V4, candles, P4);
  const pos2 = positionDe(DEF_V2, candles, P2);
  controlerPosition(cle, candles, pos4, r4.pos, "v4");
  controlerPosition(cle, candles, pos2, r2.pos, "v2");
  controlerSansStop(cle, candles, P4, "v4");
  controlerSansStop(cle, candles, P2, "v2");
  controlerV2(cle, candles, r2);
  controlerFiltre(cle, candles, r4);
  controlerMarqueurs(cle, candles, P4, r4, "v4");
  controlerMarqueurs(cle, candles, P2, r2, "v2");
  controlerCausalite(cle, candles, DEF_V4, P4, pos4, "v4");
  controlerCausalite(cle, candles, DEF_V2, P2, pos2, "v2");

  // Rejeu : changements de position nés après le warmup.
  const rejeu = (pos: number[]): { trades: Array<TradeStrategie & { idxSortie: number }>; ouvert: TradeStrategie | null } => {
    const brut = construireTradesStrategie(candles, pos as EtatStrategie[]);
    const nes = brut.trades.filter((t) => t.idxEntree >= a);
    const fermes = clos(nes);
    if (fermes.length !== nes.length) throw new EcartControle(cle, "rejeu", "trade du rejeu sans sortie");
    return { trades: fermes, ouvert: brut.ouvert !== null && brut.ouvert.idxEntree >= a ? brut.ouvert : null };
  };
  const rejeux: Record<"v4" | "v2", ReturnType<typeof rejeu>> = { v4: rejeu(pos4), v2: rejeu(pos2) };

  const base = prefixeTiming(candles, a);
  const executions: Record<StratId, Array<{ cout: Cout; r: ResultatBacktest }>> = { v4: [], v2: [], ema: [] };
  const series = {} as SeriesTimingCellule;
  const empreintes = {} as Record<StratId, string>;
  const strategies = {} as Record<StratId, StrategieCellule>;
  for (const id of STRAT_IDS) {
    executions[id] = [...COUTS, SANS_COUT].map((cout) => ({ cout, r: executer(candles, JAMBES[id], cout) }));
    const x1 = executions[id].find((e) => e.cout.id === X1.id)!;
    const sansCout = executions[id].find((e) => e.cout.id === SANS_COUT.id)!;
    const reference = chronologie(x1.r.trades);
    for (const e of executions[id]) {
      if (chronologie(e.r.trades) !== reference) throw new EcartControle(cle, `fills ${id} identiques à tous les coûts`, `écart au niveau ${e.cout.id}`);
    }
    if (id === "ema") {
      series.ema = serieDepuisFills(cle, base, candles, sansCout.r.trades, a);
    } else {
      const rj = rejeux[id];
      controlerChronologie(cle, candles, rj, x1.r.trades, id);
      series[id] = serieTiming(cle, base, rj.trades, rj.ouvert, a, n);
    }
    controlerTiming(cle, series[id], sansCout.r.trades, id);
    empreintes[id] = sha256(reference);
    // ADX à la décision d'entrée (bougie du fill − 1), pour les deux lectures d'AXIS.
    const adxEntree = (t: TradeResultat): number | null => {
      if (id === "ema") return null;
      const i = index.get(t.tempsEntree);
      const v = i === undefined ? undefined : r4.adx[i - 1];
      return v === undefined ? null : v;
    };
    strategies[id] = {
      executions: Object.fromEntries(executions[id].filter((e) => e.cout.id !== SANS_COUT.id).map((e) => [e.cout.id, metriques(e.r, candles)])),
      exposition: series[id].exposition,
      timing: testTiming([series[id]]),
      parAnnee: parAnnee(x1.r.trades),
      tradesX1: x1.r.trades.map((t): TradeCompact => [t.tempsEntree, t.tempsSortie, t.prixEntree, t.prixSortie, t.pnl, t.pnlPct, t.dureeBarres, t.raison === "regle" ? "regle" : "fin-donnees", adxEntree(t)]),
    };
  }

  // Effet du filtre (descriptif) : entrées de la v2 nées après le warmup, dont celles que l'ADX aurait refusées.
  const entreesV2 = [...rejeux.v2.trades.map((t) => t.idxEntree), ...(rejeux.v2.ouvert === null ? [] : [rejeux.v2.ouvert.idxEntree])];
  const refuseesParAdx = entreesV2.filter((i) => (r4.adx[i] ?? -Infinity) < r4.seuilAdx).length;
  const entreesV4 = rejeux.v4.trades.length + (rejeux.v4.ouvert === null ? 0 : 1);
  const tradesV4 = executions.v4.find((e) => e.cout.id === X1.id)!.r.trades.length;
  if (tradesV4 !== entreesV4) throw new EcartControle(cle, "trades v4 = entrées du rejeu", `${tradesV4} ≠ ${entreesV4}`);

  let sharpeSecondeMethode: CelluleMesuree["sharpeSecondeMethode"] = null;
  if (controlerSharpe) {
    const seconde = (id: "v4" | "v2"): number | null => sharpeDepuisTrades(candles, executions[id].find((e) => e.cout.id === X1.id)!.r.trades, X1);
    sharpeSecondeMethode = { v4: seconde("v4"), v2: seconde("v2") };
    for (const id of ["v4", "v2"] as const) {
      const premiere = strategies[id].executions[X1.id]!.sharpe;
      const s2 = sharpeSecondeMethode[id];
      const ecart = premiere === null || s2 === null ? (premiere === s2 ? 0 : Infinity) : Math.abs(premiere - s2);
      if (ecart > 1e-9) throw new EcartControle(cle, `Sharpe ${id} par seconde méthode`, `écart ${ecart}`);
    }
  }

  return {
    series,
    cellule: {
      symbol: c.symbol,
      premierJour: c.premierJour,
      acquisition: acq,
      decisions: base.L,
      premierFillUtc: iso(candles[WARMUP]!.time),
      milieuUtc: iso(milieuEvaluation(candles)),
      achatConservationPct: ((candles[n - 1]!.close - candles[WARMUP]!.open) / candles[WARMUP]!.open) * 100,
      strategies,
      filtre: { entreesV2: entreesV2.length, refuseesParAdx, entreesV4, sansTradeV4: tradesV4 === 0 },
      sharpeSecondeMethode,
      empreinteChronologieX1: empreintes,
    },
  };
}

// ─────────────────────────── Regroupement ───────────────────────────

interface Agregat {
  trades: number;
  fermes: number;
  finDonnees: number;
  sommePnl: number;
  sommePnlPct: number;
  gagnants: number;
  expectancyNette: number | null;
  expectancyPct: number | null;
  winRatePct: number | null;
  /** PnL net total moyen par cellule disponible, en % du capital. */
  pnlMoyenParCellulePct: number;
  /** Médianes des métriques par cellule (descriptif). */
  medianes: { pnlTotalPct: number; ddMaxPct: number; sharpe: number | null; fermes: number };
}
interface Parts {
  /** Cellules dont le Sharpe de la référence est défini sur la plage. */
  comparables: number;
  sharpeSuperieur: number;
  /** Comparables où le Sharpe de la variante est indéfini (comptées non supérieures). */
  varianteIndefinie: number;
  ddPlusFaible: number;
  pnlAuMoinsEgal: number;
  romadSuperieur: number;
  expectancySuperieure: number;
}
interface Comparaison { fenetre: Parts; moitie1: Parts; moitie2: Parts }
interface ParCotation { annee: string; cellules: number; comparables: number; sharpeSuperieur: number; pnlMoyenV4Pct: number; pnlMoyenV2Pct: number }
interface Regroupe {
  cellules: number;
  strategies: Record<StratId, Record<string, Agregat>>;
  comparaisons: { v4v2: Comparaison; v4ema: Comparaison; v2ema: Comparaison };
  testDesSignes: { n: number; k: number; p: number | null };
  filtre: { entreesV2: number; refuseesParAdx: number; partRefusees: number | null; entreesV4: number; partTradesConserves: number | null; cellulesSansTradeV4: number };
  exposition: Record<StratId, number>;
  timing: Record<StratId, ResultatTiming>;
  parAnnee: Array<{ annee: number } & Record<StratId, { trades: number; pnl: number }>>;
  parAnneeDeCotation: ParCotation[];
  achatConservation: { medianePct: number; moyennePct: number };
}

function mediane(valeurs: number[]): number {
  const tri = [...valeurs].sort((a, b) => a - b);
  const m = tri.length >> 1;
  if (tri.length === 0) return 0;
  return tri.length % 2 === 1 ? tri[m]! : (tri[m - 1]! + tri[m]!) / 2;
}
const moyenne = (valeurs: number[]): number => (valeurs.length === 0 ? 0 : valeurs.reduce((s, v) => s + v, 0) / valeurs.length);
const definis = (valeurs: Array<number | null>): number[] => valeurs.filter((v): v is number => v !== null);

function agreger(ms: Metriques[]): Agregat {
  const somme = (f: (m: Metriques) => number): number => ms.reduce((s, m) => s + f(m), 0);
  const t = somme((m) => m.trades);
  const sharpes = definis(ms.map((m) => m.sharpe));
  return {
    trades: t,
    fermes: somme((m) => m.fermes),
    finDonnees: somme((m) => m.finDonnees),
    sommePnl: somme((m) => m.pnlTotal),
    sommePnlPct: somme((m) => (m.expectancyPct ?? 0) * m.trades),
    gagnants: somme((m) => Math.round(((m.winRatePct ?? 0) / 100) * m.trades)),
    expectancyNette: t === 0 ? null : somme((m) => m.pnlTotal) / t,
    expectancyPct: t === 0 ? null : somme((m) => (m.expectancyPct ?? 0) * m.trades) / t,
    winRatePct: t === 0 ? null : (somme((m) => Math.round(((m.winRatePct ?? 0) / 100) * m.trades)) / t) * 100,
    pnlMoyenParCellulePct: moyenne(ms.map((m) => m.pnlTotalPct)),
    medianes: {
      pnlTotalPct: mediane(ms.map((m) => m.pnlTotalPct)),
      ddMaxPct: mediane(ms.map((m) => m.ddMaxPct)),
      sharpe: sharpes.length === 0 ? null : mediane(sharpes),
      fermes: mediane(ms.map((m) => m.fermes)),
    },
  };
}

/**
 * Parts de cellules comparables (Sharpe de la RÉFÉRENCE défini sur la plage) où la variante
 * bat la référence : Sharpe strictement supérieur (égalité ou Sharpe de la variante
 * indéfini = non battue), drawdown max plus faible, PnL net ≥, RoMaD supérieur,
 * expectancy par trade supérieure (les deux définies).
 */
function parts(variante: Plage[], reference: Plage[]): Parts {
  const p: Parts = { comparables: 0, sharpeSuperieur: 0, varianteIndefinie: 0, ddPlusFaible: 0, pnlAuMoinsEgal: 0, romadSuperieur: 0, expectancySuperieure: 0 };
  variante.forEach((v, i) => {
    const r = reference[i]!;
    if (r.sharpe === null) return;
    p.comparables++;
    if (v.sharpe === null) p.varianteIndefinie++;
    else if (v.sharpe > r.sharpe) p.sharpeSuperieur++;
    if (v.ddMax < r.ddMax) p.ddPlusFaible++;
    if (v.pnlNet >= r.pnlNet) p.pnlAuMoinsEgal++;
    if (v.romad !== null && r.romad !== null && v.romad > r.romad) p.romadSuperieur++;
    if (v.expectancyPct !== null && r.expectancyPct !== null && v.expectancyPct > r.expectancyPct) p.expectancySuperieure++;
  });
  return p;
}

const plageFenetre = (m: Metriques): Plage => ({ trades: m.trades, pnlNet: m.pnlTotal, ddMax: m.ddMax, romad: m.romad, sharpe: m.sharpe, expectancyPct: m.expectancyPct });

function comparer(cellules: CelluleMesuree[], variante: StratId, reference: StratId): Comparaison {
  const mv = cellules.map((c) => c.strategies[variante].executions[X1.id]!);
  const mr = cellules.map((c) => c.strategies[reference].executions[X1.id]!);
  return {
    fenetre: parts(mv.map(plageFenetre), mr.map(plageFenetre)),
    moitie1: parts(mv.map((m) => m.moities[0]), mr.map((m) => m.moities[0])),
    moitie2: parts(mv.map((m) => m.moities[1]), mr.map((m) => m.moities[1])),
  };
}

/** p unilatérale binomiale P(X ≥ k | n, ½) ; `null` si n = 0. Cellules supposées indépendantes : optimiste. */
function pBinomiale(k: number, n: number): number | null {
  if (n === 0) return null;
  let lnC = 0;
  const lnCs = new Float64Array(n + 1);
  for (let j = 0; j <= n; j++) {
    lnCs[j] = lnC;
    lnC += Math.log(n - j) - Math.log(j + 1);
  }
  let p = 0;
  for (let j = k; j <= n; j++) p += Math.exp(lnCs[j]! - n * Math.LN2);
  return Math.min(1, p);
}

function regrouper(cellules: CelluleMesuree[], series: SeriesTimingCellule[]): Regroupe {
  const strategies = {} as Record<StratId, Record<string, Agregat>>;
  const expositionParStrat = {} as Record<StratId, number>;
  const timing = {} as Record<StratId, ResultatTiming>;
  for (const id of STRAT_IDS) {
    strategies[id] = Object.fromEntries(COUTS.map((c) => [c.id, agreger(cellules.map((x) => x.strategies[id].executions[c.id]!))]));
    expositionParStrat[id] = moyenne(cellules.map((x) => x.strategies[id].exposition));
    timing[id] = testTiming(series.map((s) => s[id]));
  }
  const v4v2 = comparer(cellules, "v4", "v2");
  const annees = new Map<number, Record<StratId, { trades: number; pnl: number }>>();
  for (const c of cellules) {
    for (const id of STRAT_IDS) {
      for (const x of c.strategies[id].parAnnee) {
        const g = annees.get(x.annee) ?? { v4: { trades: 0, pnl: 0 }, v2: { trades: 0, pnl: 0 }, ema: { trades: 0, pnl: 0 } };
        g[id].trades += x.trades;
        g[id].pnl += x.pnl;
        annees.set(x.annee, g);
      }
    }
  }
  const entreesV2 = cellules.reduce((s, c) => s + c.filtre.entreesV2, 0);
  const refuseesParAdx = cellules.reduce((s, c) => s + c.filtre.refuseesParAdx, 0);
  const entreesV4 = cellules.reduce((s, c) => s + c.filtre.entreesV4, 0);
  const fermesV4 = strategies.v4[X1.id]!.fermes;
  const fermesV2 = strategies.v2[X1.id]!.fermes;
  const parCotation: ParCotation[] = [...new Set(cellules.map((c) => c.premierJour.slice(0, 4)))].sort().map((annee) => {
    const groupe = cellules.filter((c) => c.premierJour.slice(0, 4) === annee);
    const p = comparer(groupe, "v4", "v2").fenetre;
    return {
      annee, cellules: groupe.length, comparables: p.comparables, sharpeSuperieur: p.sharpeSuperieur,
      pnlMoyenV4Pct: moyenne(groupe.map((c) => c.strategies.v4.executions[X1.id]!.pnlTotalPct)),
      pnlMoyenV2Pct: moyenne(groupe.map((c) => c.strategies.v2.executions[X1.id]!.pnlTotalPct)),
    };
  });
  const achat = cellules.map((c) => c.achatConservationPct);
  return {
    cellules: cellules.length,
    strategies,
    comparaisons: { v4v2, v4ema: comparer(cellules, "v4", "ema"), v2ema: comparer(cellules, "v2", "ema") },
    testDesSignes: { n: v4v2.fenetre.comparables, k: v4v2.fenetre.sharpeSuperieur, p: pBinomiale(v4v2.fenetre.sharpeSuperieur, v4v2.fenetre.comparables) },
    filtre: {
      entreesV2, refuseesParAdx, partRefusees: entreesV2 === 0 ? null : refuseesParAdx / entreesV2, entreesV4,
      partTradesConserves: fermesV2 === 0 ? null : fermesV4 / fermesV2, cellulesSansTradeV4: cellules.filter((c) => c.filtre.sansTradeV4).length,
    },
    exposition: expositionParStrat,
    timing,
    parAnnee: [...annees].sort((a, b) => a[0] - b[0]).map(([annee, g]) => ({ annee, ...g })),
    parAnneeDeCotation: parCotation,
    achatConservation: { medianePct: mediane(achat), moyennePct: moyenne(achat) },
  };
}

// ─────────────────────────── Verdict pré-déclaré (fonction pure) ───────────────────────────

type Verdict = "FAVORABLE" | "DEFAVORABLE" | "NON_CONCLUANT";
type StatutBloc = "tenu" | "echec" | "insuffisant";
type RaisonNonConcluant = "cellules" | "comparables" | "moitie" | "trades";
interface Bloc { critere: "P1" | "P2" | "P3"; cle: string; statut: StatutBloc; detail: string }
interface PartSharpe { comparables: number; sharpeSuperieur: number }
/** Tout ce que le verdict lit : extrait du regroupé (campagne) ou synthétique (banc). */
interface EntreeJugement {
  nTotal: number;
  nDispo: number;
  tradesClosV4: number;
  expectancyPct: { x1: number | null; x3: number | null };
  fenetre: PartSharpe;
  moities: [PartSharpe, PartSharpe];
}
interface Jugement { verdict: Verdict; raison: RaisonNonConcluant | null; blocs: Bloc[]; cellulesSuffisantes: boolean; minCellules: number }

const fmt = (v: number | null | undefined, dec = 2): string =>
  v === null || v === undefined ? "—" : !Number.isFinite(v) ? (v > 0 ? "∞" : "−∞") : v.toFixed(dec);
/** Part en % entière, arrondie vers le bas (jamais plus favorable que la mesure). */
const partEntiere = (k: number, n: number): number => (n === 0 ? 0 : Math.floor((100 * k) / n + 1e-9));
/** Comparaison exacte k/n ⋛ seuil en entiers (le seuil du manifeste a au plus 6 décimales). */
const atteint = (k: number, n: number, seuil: number, strict: boolean): boolean => {
  const s = Math.round(seuil * 1e6);
  return strict ? k * 1e6 > s * n : k * 1e6 >= s * n;
};
const minDisponibles = (total: number): number => Math.ceil(C.minPartCellulesDisponibles * total - 1e-9);
const pourcent = (k: number, n: number): string => (n === 0 ? "—" : `${fmt((100 * k) / n, 1)} %`);

function juger(e: EntreeJugement): Jugement {
  const blocs: Bloc[] = [];
  const assezTrades = e.tradesClosV4 >= C.minTradesClosRegroupesV4;
  for (const [cle, exp] of [["x1-central", e.expectancyPct.x1], ["x3", e.expectancyPct.x3]] as const) {
    blocs.push({
      critere: "P1", cle, statut: !assezTrades ? "insuffisant" : (exp ?? 0) > 0 ? "tenu" : "echec",
      detail: `${e.tradesClosV4} trades clos regroupés (minimum ${C.minTradesClosRegroupesV4}), expectancy nette ${fmt(exp, 3)} % par trade`,
    });
  }
  const f = e.fenetre;
  blocs.push({
    critere: "P2", cle: "fenêtre",
    statut: f.comparables < C.minCellulesComparables ? "insuffisant" : atteint(f.sharpeSuperieur, f.comparables, C.partMinP2, false) ? "tenu" : "echec",
    detail: `Sharpe v4 > v2 sur ${f.sharpeSuperieur} cellules comparables sur ${f.comparables} (${pourcent(f.sharpeSuperieur, f.comparables)} ; minimum ${C.minCellulesComparables} comparables, part ≥ ${C.partMinP2 * 100} %)`,
  });
  e.moities.forEach((m, h) => {
    blocs.push({
      critere: "P3", cle: `moitié ${h + 1}`,
      statut: m.comparables < C.minCellulesComparables ? "insuffisant" : atteint(m.sharpeSuperieur, m.comparables, C.partMinP3, true) ? "tenu" : "echec",
      detail: `Sharpe v4 > v2 sur ${m.sharpeSuperieur} cellules comparables sur ${m.comparables} (${pourcent(m.sharpeSuperieur, m.comparables)} ; minimum ${C.minCellulesComparables} comparables, part > ${C.partMinP3 * 100} %)`,
    });
  });
  const minCellules = minDisponibles(e.nTotal);
  const cellulesSuffisantes = e.nDispo >= minCellules && e.nDispo > 0;
  if (blocs.some((b) => b.statut === "echec")) return { verdict: "DEFAVORABLE", raison: null, blocs, cellulesSuffisantes, minCellules };
  // Ordre des raisons : celui du manifeste (criteres.verdict.NON_CONCLUANT).
  const raison: RaisonNonConcluant | null = !cellulesSuffisantes
    ? "cellules"
    : blocs.some((b) => b.critere === "P2" && b.statut === "insuffisant")
      ? "comparables"
      : blocs.some((b) => b.critere === "P3" && b.statut === "insuffisant")
        ? "moitie"
        : blocs.some((b) => b.critere === "P1" && b.statut === "insuffisant")
          ? "trades"
          : null;
  return { verdict: raison === null ? "FAVORABLE" : "NON_CONCLUANT", raison, blocs, cellulesSuffisantes, minCellules };
}

// ─────────────────────────── Formulations pré-déclarées ───────────────────────────

/** Nombre signé à `dec` décimales ; un arrondi nul s'écrit sans signe. */
const signeFixe = (v: number, dec: number): string => {
  const texte = v.toFixed(dec);
  return Number(texte) === 0 ? (0).toFixed(dec) : `${v > 0 ? "+" : ""}${texte}`;
};
const remplir = (gabarit: string, valeurs: Record<string, string>): string =>
  Object.entries(valeurs).reduce((texte, [cle, valeur]) => texte.split(`{${cle}}`).join(valeur), gabarit);

/** Valeurs des placeholders des suites, toutes issues du regroupé x1. */
interface ValeursSuites { nCellules: number; pSharpe: number; pDd: number; pnlV4: number; pnlV2: number; p1: number; p2: number; comparables: number; moitie: number; tradesClos: number }
interface Formulations {
  verdict: Verdict;
  /** Texte exact de l'infobulle 4h des signaux pour le réglage mesuré (adxEntree = 25). */
  infobulle4hAdx25: string;
  /** Même formulation, `{k}` et `{texteBase}` non remplis (autres unités et réglages, par le chart). */
  modeleFiltreActif: string | null;
  /** Autres unités, verdict FAVORABLE : `{texteUnite}` et `{u}` non remplis. */
  modeleAutreUnite: string | null;
  sansFiltre: string;
  reglageHorsTest: string;
  texteBase: string;
  k: number;
  placeholders: Record<string, string>;
}

function formuler(j: Jugement, e: EntreeJugement, v: ValeursSuites): Formulations {
  const S = M.suites;
  const k = String(P4.adxEntree);
  const communs = { nCellules: String(v.nCellules), pSharpe: String(v.pSharpe), pDd: String(v.pDd), pnlV4: signeFixe(v.pnlV4, 1), pnlV2: signeFixe(v.pnlV2, 1), p1: String(v.p1), p2: String(v.p2) };
  const base = { sansFiltre: remplir(S.communes.sansFiltre, { texteBase: TEXTE_BASE_4H }), reglageHorsTest: S.communes.reglageHorsTest, texteBase: TEXTE_BASE_4H, k: Number(k) };
  if (j.verdict === "FAVORABLE") {
    return {
      verdict: j.verdict, ...base,
      infobulle4hAdx25: remplir(S.FAVORABLE.infobulle4hAdx25, { ...communs, texteBase: TEXTE_BASE_4H }),
      modeleFiltreActif: null,
      modeleAutreUnite: S.FAVORABLE.infobulleAutreUniteAdx25,
      placeholders: communs,
    };
  }
  if (j.verdict === "DEFAVORABLE") {
    const echoue = (c: Bloc["critere"]): boolean => j.blocs.some((b) => b.critere === c && b.statut === "echec");
    const raisons = [
      echoue("P1") ? S.DEFAVORABLE.raisons.P1 : null,
      echoue("P2") ? remplir(S.DEFAVORABLE.raisons.P2, communs) : null,
      echoue("P3") ? remplir(S.DEFAVORABLE.raisons.P3, communs) : null,
    ].filter((x): x is string => x !== null).join(S.DEFAVORABLE.raisons.jonction);
    const valeurs = { ...communs, raisons };
    return {
      verdict: j.verdict, ...base,
      infobulle4hAdx25: remplir(S.DEFAVORABLE.infobulleFiltreActif, { ...valeurs, k, texteBase: TEXTE_BASE_4H }),
      modeleFiltreActif: remplir(S.DEFAVORABLE.infobulleFiltreActif, valeurs),
      modeleAutreUnite: null,
      placeholders: valeurs,
    };
  }
  const R = S.NON_CONCLUANT.raisons;
  const raison =
    j.raison === "cellules"
      ? remplir(R.cellules, { n: String(e.nDispo), total: String(e.nTotal) })
      : j.raison === "comparables"
        ? remplir(R.comparables, { n: String(v.comparables) })
        : j.raison === "moitie"
          ? remplir(R.moitie, { n: String(v.moitie) })
          : remplir(R.trades, { n: String(v.tradesClos) });
  const valeurs = { ...communs, raison };
  return {
    verdict: j.verdict, ...base,
    infobulle4hAdx25: remplir(S.NON_CONCLUANT.infobulleFiltreActif, { ...valeurs, k, texteBase: TEXTE_BASE_4H }),
    modeleFiltreActif: remplir(S.NON_CONCLUANT.infobulleFiltreActif, valeurs),
    modeleAutreUnite: null,
    placeholders: valeurs,
  };
}

/** Entrée du verdict et valeurs des suites depuis le regroupé (null si aucune cellule disponible). */
function extraire(nTotal: number, nDispo: number, r: Regroupe | null): { entree: EntreeJugement; valeurs: ValeursSuites } {
  const vide: PartSharpe = { comparables: 0, sharpeSuperieur: 0 };
  if (r === null) {
    return {
      entree: { nTotal, nDispo, tradesClosV4: 0, expectancyPct: { x1: null, x3: null }, fenetre: vide, moities: [vide, vide] },
      valeurs: { nCellules: nDispo, pSharpe: 0, pDd: 0, pnlV4: 0, pnlV2: 0, p1: 0, p2: 0, comparables: 0, moitie: 0, tradesClos: 0 },
    };
  }
  const cmp = r.comparaisons.v4v2;
  const part = (p: Parts): PartSharpe => ({ comparables: p.comparables, sharpeSuperieur: p.sharpeSuperieur });
  const x1 = r.strategies.v4[X1.id]!;
  const moitieFaible = Math.min(cmp.moitie1.comparables, cmp.moitie2.comparables);
  return {
    entree: {
      nTotal, nDispo, tradesClosV4: x1.fermes,
      expectancyPct: { x1: x1.expectancyPct, x3: r.strategies.v4[X3.id]!.expectancyPct },
      fenetre: part(cmp.fenetre), moities: [part(cmp.moitie1), part(cmp.moitie2)],
    },
    valeurs: {
      nCellules: nDispo,
      pSharpe: partEntiere(cmp.fenetre.sharpeSuperieur, cmp.fenetre.comparables),
      pDd: partEntiere(cmp.fenetre.ddPlusFaible, cmp.fenetre.comparables),
      pnlV4: x1.pnlMoyenParCellulePct,
      pnlV2: r.strategies.v2[X1.id]!.pnlMoyenParCellulePct,
      p1: partEntiere(cmp.moitie1.sharpeSuperieur, cmp.moitie1.comparables),
      p2: partEntiere(cmp.moitie2.sharpeSuperieur, cmp.moitie2.comparables),
      comparables: cmp.fenetre.comparables,
      moitie: moitieFaible,
      tradesClos: x1.fermes,
    },
  };
}

// ─────────────────────────── Banc des chemins de verdict ───────────────────────────

/** Résultats synthétiques : chaque chemin du verdict et sa formulation, comptés. Lève à la première divergence. */
function banc(): number {
  let verifications = 0;
  const verifier = (cas: string, condition: boolean, detail: string): void => {
    verifications++;
    if (!condition) throw new Error(`banc : cas « ${cas} » — ${detail}`);
  };
  const total = 123;
  const part = (comparables: number, sharpeSuperieur: number): PartSharpe => ({ comparables, sharpeSuperieur });
  const sain = (): EntreeJugement => ({
    nTotal: total, nDispo: 120, tradesClosV4: 3000, expectancyPct: { x1: 0.5, x3: 0.3 }, fenetre: part(120, 80), moities: [part(120, 70), part(120, 65)],
  });
  const valeurs = (e: EntreeJugement): ValeursSuites => ({
    nCellules: e.nDispo,
    pSharpe: partEntiere(e.fenetre.sharpeSuperieur, e.fenetre.comparables), pDd: 70, pnlV4: 12.345, pnlV2: -3.04,
    p1: partEntiere(e.moities[0].sharpeSuperieur, e.moities[0].comparables), p2: partEntiere(e.moities[1].sharpeSuperieur, e.moities[1].comparables),
    comparables: e.fenetre.comparables, moitie: Math.min(e.moities[0].comparables, e.moities[1].comparables), tradesClos: e.tradesClosV4,
  });
  const statuts = (j: Jugement): string => j.blocs.map((b) => b.statut[0]).join("");
  const texte = (e: EntreeJugement): { j: Jugement; f: Formulations } => {
    const j = juger(e);
    return { j, f: formuler(j, e, valeurs(e)) };
  };
  const S = M.suites;
  const base = `${TEXTE_BASE_4H} ; filtre ADX 14 ≥ 25 à l'entrée actif : test du 9 octobre 2026 `;

  // FAVORABLE : cinq blocs tenus, formulation remplie.
  {
    const { j, f } = texte(sain());
    verifier("favorable", j.verdict === "FAVORABLE" && statuts(j) === "ttttt", `${j.verdict} ${statuts(j)}`);
    verifier("favorable", j.blocs.length === 5 && j.raison === null, "cinq blocs, aucune raison");
    const attendu = S.FAVORABLE.infobulle4hAdx25
      .replace("{texteBase}", TEXTE_BASE_4H).replace("{nCellules}", "120").replace("{pSharpe}", "66").replace("{pDd}", "70").replace("{pnlV4}", "+12.3").replace("{pnlV2}", "-3.0");
    verifier("favorable", f.infobulle4hAdx25 === attendu && !f.infobulle4hAdx25.includes("{"), f.infobulle4hAdx25);
    verifier("favorable", f.infobulle4hAdx25.startsWith(`${TEXTE_BASE_4H} ; filtre ADX 14 ≥ 25 à l'entrée : sur données jamais vues (120 alts`), f.infobulle4hAdx25);
    verifier("favorable", f.modeleAutreUnite === S.FAVORABLE.infobulleAutreUniteAdx25 && f.modeleFiltreActif === null, "modèle autre unité");
    verifier("favorable", f.sansFiltre === `${TEXTE_BASE_4H} ; sans filtre ADX (réglage) : signaux de la v2 testée`, f.sansFiltre);
  }
  // P2 à exactement 60 % : tenu ; P3 à exactement 50 % : échec (strict).
  {
    const e = sain();
    e.fenetre = part(120, 72);
    verifier("P2 égalité 60 %", juger(e).blocs[2]!.statut === "tenu", "60 % doit tenir");
    e.fenetre = part(120, 71);
    verifier("P2 59,2 %", juger(e).blocs[2]!.statut === "echec", "59,2 % doit échouer");
    const m = sain();
    m.moities = [part(120, 60), part(120, 65)];
    verifier("P3 égalité 50 %", juger(m).blocs[3]!.statut === "echec", "50 % doit échouer (strict)");
    m.moities = [part(120, 61), part(120, 65)];
    verifier("P3 50,8 %", juger(m).blocs[3]!.statut === "tenu", "50,8 % doit tenir");
  }
  // Échecs P1 (x1 puis x3), P2, P3 (chaque moitié) : DÉFAVORABLE, raisons du manifeste.
  {
    const e = sain();
    e.expectancyPct = { x1: -0.1, x3: 0.2 };
    const { j, f } = texte(e);
    verifier("échec P1 x1", j.verdict === "DEFAVORABLE" && statuts(j) === "etttt", statuts(j));
    verifier("échec P1 x1", f.infobulle4hAdx25 === `${base}échoué sur données jamais vues (120 alts 4h cotées 2023-2025 : ${S.DEFAVORABLE.raisons.P1}) — pas une amélioration validée`, f.infobulle4hAdx25);
    verifier("échec P1 x1", f.modeleFiltreActif !== null && f.modeleFiltreActif.includes("{k}") && f.modeleFiltreActif.includes("{texteBase}") && !f.modeleFiltreActif.includes("{raisons}"), String(f.modeleFiltreActif));
    const e3 = sain();
    e3.expectancyPct = { x1: 0.3, x3: 0 };
    verifier("échec P1 x3 (expectancy nulle)", statuts(juger(e3)) === "tettt" && juger(e3).verdict === "DEFAVORABLE", statuts(juger(e3)));
    const e2 = sain();
    e2.fenetre = part(120, 68);
    const t2 = texte(e2);
    verifier("échec P2", t2.j.verdict === "DEFAVORABLE" && statuts(t2.j) === "ttett", statuts(t2.j));
    verifier("échec P2", t2.f.infobulle4hAdx25.includes("Sharpe meilleur que sans filtre sur 56 % des actifs seulement"), t2.f.infobulle4hAdx25);
    const e4 = sain();
    e4.moities = [part(120, 48), part(120, 65)];
    const t4 = texte(e4);
    verifier("échec P3 moitié 1", t4.j.verdict === "DEFAVORABLE" && statuts(t4.j) === "tttet", statuts(t4.j));
    verifier("échec P3 moitié 1", t4.f.infobulle4hAdx25.includes("amélioration absente dans une moitié de la période (40 % puis 54 %)"), t4.f.infobulle4hAdx25);
    const e5 = sain();
    e5.moities = [part(120, 70), part(120, 60)];
    verifier("échec P3 moitié 2", statuts(juger(e5)) === "tttte" && juger(e5).verdict === "DEFAVORABLE", statuts(juger(e5)));
    const e6 = sain();
    e6.expectancyPct = { x1: -1, x3: -2 };
    e6.fenetre = part(120, 8);
    e6.moities = [part(120, 8), part(120, 8)];
    const t6 = texte(e6);
    verifier("trois échecs", statuts(t6.j) === "eeeee", statuts(t6.j));
    verifier("trois échecs", t6.f.infobulle4hAdx25.includes(`${S.DEFAVORABLE.raisons.P1} ; Sharpe meilleur que sans filtre sur 6 % des actifs seulement ; amélioration absente dans une moitié de la période (6 % puis 6 %)`), t6.f.infobulle4hAdx25);
  }
  // Insuffisances : cellules, comparables, moitié, trades → NON CONCLUANT, raison du manifeste.
  {
    const e = sain();
    e.nDispo = 92;
    const { j, f } = texte(e);
    verifier("cellules insuffisantes", j.verdict === "NON_CONCLUANT" && j.raison === "cellules" && j.minCellules === 93 && statuts(j) === "ttttt", `${j.verdict} ${j.raison} ${j.minCellules}`);
    verifier("cellules insuffisantes", f.infobulle4hAdx25 === `${base}non concluant sur données jamais vues (92 cellules disponibles sur 123) — non mesuré`, f.infobulle4hAdx25);
    const ok = sain();
    ok.nDispo = 93;
    verifier("cellules au minimum", juger(ok).verdict === "FAVORABLE", "93 cellules suffisent");
    const c = sain();
    c.fenetre = part(79, 60);
    const tc = texte(c);
    verifier("comparables insuffisants", tc.j.verdict === "NON_CONCLUANT" && tc.j.raison === "comparables" && statuts(tc.j) === "ttitt", statuts(tc.j));
    verifier("comparables insuffisants", tc.f.infobulle4hAdx25.endsWith("(79 cellules comparables) — non mesuré"), tc.f.infobulle4hAdx25);
    const m = sain();
    m.moities = [part(120, 70), part(79, 55)];
    const tm = texte(m);
    verifier("moitié insuffisante", tm.j.verdict === "NON_CONCLUANT" && tm.j.raison === "moitie" && statuts(tm.j) === "tttti", statuts(tm.j));
    verifier("moitié insuffisante", tm.f.infobulle4hAdx25.endsWith("(79 cellules comparables dans une moitié) — non mesuré"), tm.f.infobulle4hAdx25);
    const t = sain();
    t.tradesClosV4 = 99;
    const tt = texte(t);
    verifier("trades insuffisants", tt.j.verdict === "NON_CONCLUANT" && tt.j.raison === "trades" && statuts(tt.j) === "iittt", statuts(tt.j));
    verifier("trades insuffisants", tt.f.infobulle4hAdx25.endsWith("(99 trades clos) — non mesuré"), tt.f.infobulle4hAdx25);
    const z = sain();
    z.nDispo = 0;
    z.tradesClosV4 = 0;
    z.expectancyPct = { x1: null, x3: null };
    z.fenetre = part(0, 0);
    z.moities = [part(0, 0), part(0, 0)];
    verifier("aucune cellule", juger(z).verdict === "NON_CONCLUANT" && juger(z).raison === "cellules", "vide → cellules");
  }
  // Un échec mesuré l'emporte sur une insuffisance (lecture littérale de criteres.verdict).
  {
    const e = sain();
    e.expectancyPct = { x1: -1, x3: -1 };
    e.fenetre = part(50, 40);
    const { j, f } = texte(e);
    verifier("échec + insuffisance", j.verdict === "DEFAVORABLE" && statuts(j) === "eeitt", statuts(j));
    verifier("échec + insuffisance", f.infobulle4hAdx25.includes(`: ${S.DEFAVORABLE.raisons.P1}) —`), f.infobulle4hAdx25);
    const c = sain();
    c.nDispo = 90;
    c.moities = [part(90, 40), part(90, 60)];
    verifier("cellules insuffisantes + échec P3", juger(c).verdict === "DEFAVORABLE", juger(c).verdict);
  }
  // Parts : un Sharpe de variante indéfini reste dans le dénominateur, jamais compté supérieur.
  {
    const plageDe = (sharpe: number | null, pnl = 0): Plage => ({ trades: sharpe === null ? 0 : 5, pnlNet: pnl, ddMax: sharpe === null ? 0 : 100, romad: null, sharpe, expectancyPct: null });
    const p = parts([plageDe(null), plageDe(1.5), plageDe(0.5), plageDe(null)], [plageDe(1), plageDe(1), plageDe(1), plageDe(null)]);
    verifier("parts", p.comparables === 3 && p.sharpeSuperieur === 1 && p.varianteIndefinie === 1 && p.ddPlusFaible === 1, JSON.stringify(p));
  }
  // Formats des placeholders : parts arrondies vers le bas, PnL une décimale signée, zéro sans signe.
  verifier("partEntiere", partEntiere(71, 120) === 59 && partEntiere(72, 120) === 60 && partEntiere(0, 0) === 0, "floor");
  verifier("signeFixe", signeFixe(0.04, 1) === "0.0" && signeFixe(-0.04, 1) === "0.0" && signeFixe(2, 1) === "+2.0" && signeFixe(-2.25, 1) === "-2.3", "formats");
  verifier("atteint", atteint(72, 120, 0.6, false) && !atteint(71, 120, 0.6, false) && !atteint(60, 120, 0.5, true) && atteint(61, 120, 0.5, true), "seuils exacts");
  verifier("pBinomiale", Math.abs((pBinomiale(0, 1) ?? 0) - 1) < 1e-12 && Math.abs((pBinomiale(1, 1) ?? 0) - 0.5) < 1e-12 && Math.abs((pBinomiale(2, 3) ?? 0) - 0.5) < 1e-12, "binomiale");
  return verifications;
}

// ─────────────────────────── Rapport ───────────────────────────

interface CelluleResultat {
  symbol: string;
  premierJour: string;
  statut: "disponible" | "indisponible";
  erreur?: string;
  acquisition?: Acquisition;
  mesure?: CelluleMesuree;
}
interface EmpreinteCode {
  runnerSha256: string;
  manifesteSha256: string;
  observeSha256: Record<string, string>;
  arbre: { dossiers: string[]; fichiers: number; sha256: string };
  commitFigeage: string;
  cheminsFigesCommites: boolean;
  identiqueAuFigeage: boolean;
  pnpmLockSha256: string;
  bun: string | null;
}

const ligne = (cells: Array<string | number>): string => `| ${cells.join(" | ")} |`;
const tableau = (entetes: string[], lignes: Array<Array<string | number>>): string =>
  [ligne(entetes), `|${entetes.map(() => "---").join("|")}|`, ...lignes.map(ligne)].join("\n");
const LIBELLE_VERDICT: Record<Verdict, string> = { FAVORABLE: "FAVORABLE", DEFAVORABLE: "DÉFAVORABLE", NON_CONCLUANT: "NON CONCLUANT" };
const LIBELLE_BLOC: Record<StatutBloc, string> = { tenu: "✅ tenu", echec: "❌ échec", insuffisant: "⚠️ insuffisant" };
/** p à 4 décimales arrondie vers le haut ; « ≤ » au plancher 1 / (tirages + 1). */
const fmtP = (p: number | null, tirages: number): string =>
  p === null ? "—" : `${p <= 1 / (tirages + 1) + 1e-12 ? "≤" : "="} ${(Math.ceil(p * 1e4 - 1e-9) / 1e4).toFixed(4)}`;
const partsTexte = (p: Parts): string =>
  `${p.comparables} comparables : Sharpe > ${p.sharpeSuperieur} (${pourcent(p.sharpeSuperieur, p.comparables)}${p.varianteIndefinie > 0 ? ` ; ${p.varianteIndefinie} indéfini(s)` : ""}), DD < ${p.ddPlusFaible} (${pourcent(p.ddPlusFaible, p.comparables)}), PnL ≥ ${p.pnlAuMoinsEgal} (${pourcent(p.pnlAuMoinsEgal, p.comparables)}), RoMaD > ${p.romadSuperieur} (${pourcent(p.romadSuperieur, p.comparables)}), expectancy > ${p.expectancySuperieure} (${pourcent(p.expectancySuperieure, p.comparables)})`;

function rapport(
  cellules: CelluleResultat[], r: Regroupe | null, j: Jugement, e: EntreeJugement, f: Formulations, code: EmpreinteCode,
  horodatage: { debutUtc: string; finUtc: string; dureeS: number }
): string {
  const p: string[] = [];
  const dispo = cellules.filter((c): c is CelluleResultat & { mesure: CelluleMesuree; acquisition: Acquisition } => c.statut === "disponible" && c.mesure !== undefined && c.acquisition !== undefined);
  const indispo = cellules.filter((c) => c.statut === "indisponible");
  p.push(CAMPAGNE ? `# AXIS v4 (filtre ADX ${ADX_ENTREE_PERIODE} ≥ ${P4.adxEntree} à l'entrée) contre v2 et EMA 200 : test sur données jamais vues, 9 octobre 2026` : "# AXIS v4 — RÉPÉTITION TECHNIQUE sur symboles déjà vus (sans valeur probante)");
  p.push(
    `Généré par \`${CHEMIN_RUNNER} ${MODE}\`. Manifeste \`${CHEMIN_MANIFESTE}\` (SHA-256 observé \`${code.manifesteSha256}\`, épinglé \`${HASH_MANIFESTE}\`), figé avant tout téléchargement de ces données. ` +
      "**Toutes les valeurs sont des mesures PASSÉES, jamais une promesse de performance.** Le candidat testé n'a pas été retenu par la règle pré-écrite de l'exploration (condition sur les grandes cryptos levée après coup, manifeste historique.choixV4) : degré de liberté déclaré."
  );
  if (avertissements.length > 0) p.push(`**Avertissements (répétition)** :\n${avertissements.map((x) => `- ${x}`).join("\n")}`);

  p.push(`## Verdict pré-déclaré : **${LIBELLE_VERDICT[j.verdict]}**${j.raison === null ? "" : ` (raison : ${j.raison})`}`);
  p.push(
    `${e.nDispo} cellule(s) disponible(s) sur ${e.nTotal} (minimum ${j.minCellules} : ${j.cellulesSuffisantes ? "atteint" : "NON atteint"}). ` +
      `Règle : DÉFAVORABLE dès qu'un bloc mesuré échoue ; sinon NON CONCLUANT si une insuffisance (cellules, comparables, moitié, trades) ; sinon FAVORABLE (5 blocs tenus).`
  );
  p.push(tableau(["Critère", "Bloc", "Statut", "Détail"], j.blocs.map((b) => [b.critere, b.cle, LIBELLE_BLOC[b.statut], b.detail])));
  p.push(
    [
      `- **P1** viabilité de la v4 : expectancy nette regroupée (pnlPct moyen, trade fin-données compris) > 0 aux coûts ${X1.id} ET ${X3.id} ; au moins ${C.minTradesClosRegroupesV4} trades clos par règle regroupés, sinon insuffisant.`,
      `- **P2** amélioration : part des cellules comparables (Sharpe par bougie de la v2 défini, coûts ${X1.id}) où le Sharpe de la v4 est STRICTEMENT supérieur ≥ ${C.partMinP2 * 100} % ; un Sharpe v4 indéfini compte comme non supérieur ; au moins ${C.minCellulesComparables} comparables.`,
      `- **P3** stabilité : même part > ${C.partMinP3 * 100} % dans CHAQUE moitié de la fenêtre évaluée de chaque cellule (Sharpe de la moitié) ; au moins ${C.minCellulesComparables} comparables par moitié.`,
      `- Dépendance : les cellules partagent le facteur de marché crypto ; le critère est une taille d'effet fixée d'avance, pas une p-valeur ; le p du test des signes est descriptif.`,
    ].join("\n")
  );

  p.push("## Formulations pré-déclarées");
  p.push(tableau(["Objet", "Texte"], [
    [`Infobulle 4h, adxEntree = ${P4.adxEntree}`, f.infobulle4hAdx25],
    ["Modèle filtre actif (autres k et unités)", f.modeleFiltreActif ?? "— (verdict FAVORABLE)"],
    ["Modèle autre unité (FAVORABLE)", f.modeleAutreUnite ?? "—"],
    ["Sans filtre (réglage 0)", f.sansFiltre],
    ["Réglage hors test", f.reglageHorsTest],
  ]));

  if (r !== null) {
    const x1 = r.strategies;
    const ligneAgregat = (nom: string, a: Agregat): Array<string | number> => [
      nom, `${a.trades} (${a.fermes})`, fmt(a.expectancyPct, 3), fmt(a.expectancyNette, 2), fmt(a.sommePnl, 0), fmt(a.pnlMoyenParCellulePct, 1), fmt(a.medianes.pnlTotalPct, 1), fmt(a.medianes.ddMaxPct, 1), fmt(a.medianes.sharpe, 2), fmt(a.winRatePct, 1),
    ];
    p.push(`## Regroupé sur ${r.cellules} cellules disponibles`);
    p.push(tableau(
      ["Stratégie · coût", "Trades (clos par règle)", "Exp. nette %", "Exp. nette USDT", "PnL total USDT", "PnL moyen / cellule %", "PnL médian %", "DD médian %", "Sharpe médian", "Gagnants %"],
      STRAT_IDS.flatMap((id) => COUTS.map((c) => ligneAgregat(`${LIBELLE_STRAT[id]} · ${c.id}`, x1[id][c.id]!)))
    ));
    p.push("### Parts de cellules comparables (coûts x1 ; Sharpe de la référence défini)");
    p.push(tableau(["Comparaison", "Fenêtre", "Moitié 1", "Moitié 2"], [
      ["v4 contre v2", partsTexte(r.comparaisons.v4v2.fenetre), partsTexte(r.comparaisons.v4v2.moitie1), partsTexte(r.comparaisons.v4v2.moitie2)],
      [`v4 contre EMA ${P4.emaTendance}`, partsTexte(r.comparaisons.v4ema.fenetre), partsTexte(r.comparaisons.v4ema.moitie1), partsTexte(r.comparaisons.v4ema.moitie2)],
      [`v2 contre EMA ${P4.emaTendance}`, partsTexte(r.comparaisons.v2ema.fenetre), partsTexte(r.comparaisons.v2ema.moitie1), partsTexte(r.comparaisons.v2ema.moitie2)],
    ]));
    p.push("### Descriptif (aucun effet sur le verdict)");
    const ts = r.testDesSignes;
    const fi = r.filtre;
    p.push(tableau(["Statistique", "Valeur"], [
      ["Test des signes de la part P2 (p unilatérale binomiale, indépendance supposée : optimiste)", `${ts.k} / ${ts.n}, p ${ts.p === null ? "—" : `= ${ts.p.toFixed(4)}`}`],
      [`Entrées de la v2 refusées par le filtre (ADX ${ADX_ENTREE_PERIODE} < ${P4.adxEntree} à la décision) / entrées de la v2 nées après le warmup`, `${fi.refuseesParAdx} / ${fi.entreesV2}${fi.partRefusees === null ? "" : ` (${fmt(fi.partRefusees * 100, 1)} %)`}`],
      ["Trades clos v4 / v2 (x1), part conservée ; entrées v4", `${x1.v4[X1.id]!.fermes} / ${x1.v2[X1.id]!.fermes}${fi.partTradesConserves === null ? "" : ` (${fmt(fi.partTradesConserves * 100, 1)} %)`} ; ${fi.entreesV4}`],
      ["Cellules où la v4 n'a aucun trade (Sharpe indéfini, comptées non supérieures)", String(fi.cellulesSansTradeV4)],
      ["Exposition moyenne (part des décisions évaluées en position) v4 / v2 / EMA", STRAT_IDS.map((id) => `${fmt(r.exposition[id] * 100, 1)} %`).join(" / ")],
      ...STRAT_IDS.map((id): Array<string | number> => [
        `Timing ${LIBELLE_STRAT[id]} : capté / médiane nulle / 95e centile (% log), p (${r.timing[id].tirages} décalages, L = ${r.timing[id].L})`,
        `${fmt(r.timing[id].capteLog * 100, 1)} / ${fmt(r.timing[id].medianeNulle * 100, 1)} / ${fmt(r.timing[id].q95Nulle * 100, 1)}, p ${fmtP(r.timing[id].p, r.timing[id].tirages)}`,
      ]),
      ["Achat-conservation (open du premier fill → dernier close) : médiane / moyenne %", `${fmt(r.achatConservation.medianePct, 1)} / ${fmt(r.achatConservation.moyennePct, 1)}`],
    ]));
    p.push(tableau(["Année d'entrée", ...STRAT_IDS.map((id) => `${LIBELLE_STRAT[id]} : trades / PnL net x1 USDT`)], r.parAnnee.map((x) => [x.annee, ...STRAT_IDS.map((id) => `${x[id].trades} / ${fmt(x[id].pnl, 0)}`)])));
    p.push(tableau(["Année de cotation", "Cellules", "Comparables", "Sharpe v4 > v2", "PnL moyen % v4 / v2"], r.parAnneeDeCotation.map((x) => [x.annee, x.cellules, x.comparables, `${x.sharpeSuperieur} (${pourcent(x.sharpeSuperieur, x.comparables)})`, `${fmt(x.pnlMoyenV4Pct, 1)} / ${fmt(x.pnlMoyenV2Pct, 1)}`])));
  }

  if (dispo.length > 0) {
    p.push(`## Détail par cellule (${dispo.length})`);
    p.push(tableau(
      ["Symbole", "Cotation", "Bougies (manq.)", "Trades x1 v4 / v2 / EMA", "Exp. x1 v4 / v2 %", "PnL % v4 / v2 / EMA", "DD % v4 / v2", "Sharpe v4 / v2", "Entrées v2 refusées"],
      dispo.map((c) => {
        const m = (id: StratId): Metriques => c.mesure.strategies[id].executions[X1.id]!;
        return [
          c.symbol, c.premierJour, `${c.acquisition.nombre} (${c.acquisition.manquantes})`, STRAT_IDS.map((id) => m(id).trades).join(" / "), `${fmt(m("v4").expectancyPct, 2)} / ${fmt(m("v2").expectancyPct, 2)}`,
          STRAT_IDS.map((id) => fmt(m(id).pnlTotalPct, 1)).join(" / "), `${fmt(m("v4").ddMaxPct, 1)} / ${fmt(m("v2").ddMaxPct, 1)}`,
          `${fmt(m("v4").sharpe, 2)} / ${fmt(m("v2").sharpe, 2)}`, `${c.mesure.filtre.refuseesParAdx} / ${c.mesure.filtre.entreesV2}`,
        ];
      })
    ));
  }

  p.push("## Données");
  const manquantes = dispo.reduce((s, c) => s + c.acquisition.manquantes, 0);
  const ecartees = dispo.reduce((s, c) => s + c.acquisition.ecartees.length, 0);
  const longueurs = dispo.map((c) => c.acquisition.nombre);
  p.push(
    [
      `- Klines Binance Spot (\`${ENDPOINT}\`) avec volume taker, une fenêtre par cellule : du 00:00 UTC de son premier jour de cotation au \`${iso(F.fin)}\` exclu (4h, au moins ${BOUGIES_MIN} bougies), ${CAMPAGNE ? `pool de ${M.symboles.nombre} paires USDT cotées entre ${COTATION_MIN} et ${COTATION_MAX}` : `8 symboles déjà vus, cellules à partir du ${M.repetitionTechnique.debutInclus}`}.`,
      `- ${dispo.length} cellule(s) disponible(s), ${indispo.length} indisponible(s)${indispo.length > 0 ? ` : ${indispo.map((c) => `${c.symbol} (${c.erreur})`).join(" ; ")}` : ""} ; longueurs de ${longueurs.length === 0 ? "—" : `${Math.min(...longueurs)} à ${Math.max(...longueurs)}`} bougies.`,
      `- Bougies manquantes (écartées comprises) sur les cellules disponibles : ${manquantes} ; bougies écartées : ${ecartees}.`,
      `- Décisions évaluées : indices ${WARMUP - 1} à n−2 de chaque cellule ; premier fill à l'open de l'indice ${WARMUP} ; frontière des moitiés au milieu des décisions évaluées de la cellule.`,
    ].join("\n")
  );

  p.push("## Protocole et contrôles");
  p.push(
    [
      `- Signal : stratAxis, paramètres ${JSON.stringify(P4)} (v4) et adxEntree = 0 (v2) ; position = sortie prixSignal du chart via le registre ; EMA ${P4.emaTendance} seule : entrée au croisement haussier, sortie si close < EMA.`,
      `- Exécution : runBacktest, jambe longue, taille ${TAILLE} USDT, capital ${CAPITAL} USDT, décision à la clôture et fill à l'open suivant, position ouverte liquidée au dernier close ; coûts par côté ${COUTS.map((c) => `${c.id} = ${c.frais} % + ${c.slippage} %`).join(" ; ")}.`,
      `- Sharpe par bougie : rendements equity_t / equity_{t−1} − 1 des points dont le temps ≥ debutEvaluationMs, × √${BOUGIES_PAR_AN} ; indéfini si moins de deux rendements ou écart-type nul. Drawdown max en cotation sur les points de la fenêtre évaluée (pic repris au premier point de la plage), RoMaD = PnL net / drawdown.`,
      `- Timing (descriptif) : décalage circulaire commun, ${TIMING.tirages} tirages, graine ${TIMING.graine}, k ∈ [⌊${TIMING.fractionMin} L⌋, ⌊${TIMING.fractionMax} L⌋], L = plus courte fenêtre ; p unilatérale (1 + #≥observé) / (tirages + 1), arrondie vers le haut.`,
      `- Contrôles bloquants passés (sinon arrêt sans verdict, ce rapport n'existerait pas) : position v4 et v2 du registre = recalcul direct (votes, EMA de tendance, ADX ${ADX_ENTREE_PERIODE}, positionsAxis sur la tendance complétée du filtre, fin = n−2) ; série « stop » du chart indéfinie ; v2 (adxEntree 0) = positionsAxis ; entrées v4 à ADX ≥ ${P4.adxEntree} et dans la condition v2 ; marqueurs du chart aux changements de position et dans le bon sens, étiquettes Achat/Vente, mention de l'ADX dans les achats de la v4 seulement ; causalité sur préfixes 40/70/90 % ; chronologie moteur x1 = changements nés après le warmup ; fills identiques à tous les coûts ; statistique de timing = somme des ln(prixSortie/prixEntree) sans coût ; Sharpe par seconde méthode (equity reconstruite depuis les trades et les closes) sur trois cellules.`,
      `- Code : ${code.arbre.fichiers} fichiers hors tests de ${code.arbre.dossiers.join(", ")} (SHA-256 \`${code.arbre.sha256}\`), ${code.identiqueAuFigeage ? "identique au" : "DIFFÉRENT du"} figeage ; chemins mesurés ${code.cheminsFigesCommites ? "commités" : "NON commités"} ; HEAD \`${code.commitFigeage}\` ; runner \`${code.runnerSha256}\` ; pnpm-lock \`${code.pnpmLockSha256}\` ; Bun ${code.bun ?? "—"}.`,
      `- Horodatages : début ${horodatage.debutUtc}, fin ${horodatage.finUtc} (${horodatage.dureeS} s).`,
    ].join("\n")
  );

  p.push("## Limites connues (manifeste)");
  p.push(M.limitesConnues.map((x) => `- ${x}`).join("\n"));
  return `${p.join("\n\n")}\n`;
}

// ─────────────────────────── Empreintes et état git ───────────────────────────

function empreinteArbre(dossiers: string[]): { dossiers: string[]; fichiers: number; sha256: string } {
  const lignes: string[] = [];
  const parcourir = (rel: string): void => {
    for (const nom of readdirSync(join(RACINE, rel))) {
      const chemin = `${rel}/${nom}`;
      if (statSync(join(RACINE, chemin)).isDirectory()) parcourir(chemin);
      else if (!/\.test\.tsx?$/.test(nom)) lignes.push(`${chemin} ${sha256(readFileSync(join(RACINE, chemin)))}`);
    }
  };
  for (const d of dossiers) parcourir(d);
  lignes.sort();
  return { dossiers, fichiers: lignes.length, sha256: sha256(lignes.join("\n")) };
}

function etatGit(chemins: string[]): { commit: string; modifies: string[] } {
  const git = (...args: string[]): string => execFileSync("git", ["-C", RACINE, ...args], { encoding: "utf8" });
  return {
    commit: git("rev-parse", "HEAD").trim(),
    modifies: git("status", "--porcelain", "--untracked-files=all", "--", ...chemins).split("\n").filter((l) => l.trim() !== ""),
  };
}

/** Vérifications du figeage AVANT le premier fetch : refus en campagne, avertissements en répétition. */
function verifierFigeage(): EmpreinteCode {
  const ecart = (message: string): void => {
    if (CAMPAGNE) throw new Error(`${message} — campagne refusée`);
    avertissements.push(message);
  };
  const fige = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(M.figeLeUtc) ? Date.parse(M.figeLeUtc) : Number.NaN;
  if (!(fige < Date.now())) ecart(`figeLeUtc absent, invalide ou futur (${M.figeLeUtc})`);
  const V = M.versions;
  const divergents: string[] = [];
  let observeSha256: Record<string, string> = {};
  if (V.codeAuFigeageSha256 === "A_FIGER") {
    divergents.push("codeAuFigeageSha256 = A_FIGER");
    observeSha256 = Object.fromEntries(FICHIERS_FIGES.map((f) => [f, sha256(readFileSync(join(RACINE, f)))]));
  } else {
    observeSha256 = Object.fromEntries(Object.keys(V.codeAuFigeageSha256).map((f) => [f, sha256(readFileSync(join(RACINE, f)))]));
    for (const [f, h] of Object.entries(V.codeAuFigeageSha256)) if (observeSha256[f] !== h) divergents.push(f);
    if (Object.keys(V.codeAuFigeageSha256).length === 0) divergents.push("(aucun fichier figé)");
    for (const f of FICHIERS_FIGES) if (!(f in V.codeAuFigeageSha256)) divergents.push(`${f} absent du figeage`);
  }
  const dossiers = V.arbreCode === "A_FIGER" ? DOSSIERS_ARBRE : V.arbreCode.dossiers;
  const arbre = empreinteArbre(dossiers);
  if (V.arbreCode === "A_FIGER") divergents.push("arbreCode = A_FIGER");
  else if (arbre.sha256 !== V.arbreCode.sha256 || arbre.fichiers !== V.arbreCode.fichiers) divergents.push(`arbre ${dossiers.join(", ")} (${arbre.fichiers} fichiers, ${arbre.sha256})`);
  const pnpmLockSha256 = sha256(readFileSync(join(RACINE, "pnpm-lock.yaml")));
  if (V.pnpmLockSha256 !== pnpmLockSha256) divergents.push(`pnpm-lock.yaml ${pnpmLockSha256}`);
  const bun = process.versions.bun ?? null;
  if (V.bun !== bun) divergents.push(`bun ${bun ?? "absent"}`);
  if (divergents.length > 0) ecart(`code différent du figeage (${divergents.join(", ")})`);
  const git = etatGit([CHEMIN_RUNNER, CHEMIN_MANIFESTE, "pnpm-lock.yaml", ...dossiers]);
  if (git.modifies.length > 0) ecart(`chemins mesurés non commités : ${git.modifies.join(" ; ")} (commiter le figeage d'abord)`);
  return {
    runnerSha256: sha256(readFileSync(SCRIPT)), manifesteSha256: MANIFESTE_SHA256, observeSha256, arbre, commitFigeage: git.commit,
    cheminsFigesCommites: git.modifies.length === 0, identiqueAuFigeage: divergents.length === 0, pnpmLockSha256, bun,
  };
}

// ─────────────────────────── Entrée ───────────────────────────

const infini = (_cle: string, valeur: unknown): unknown => (valeur === Infinity ? "Infinity" : valeur === -Infinity ? "-Infinity" : valeur);

async function main(): Promise<void> {
  const debutUtc = new Date().toISOString();
  const t0 = Date.now();
  const secondes = (): number => Math.round((Date.now() - t0) / 1000);
  // Le banc tourne à chaque lancement : un verdict mal câblé arrête le run avant toute donnée.
  const verifications = banc();
  if (MODE === "--banc") {
    process.stdout.write(`✓ banc des chemins de verdict : ${verifications} vérifications passées (aucune donnée lue)\n`);
    if (avertissements.length > 0) process.stdout.write(`  avertissements : ${avertissements.join(" ; ")}\n`);
    return;
  }
  process.stderr.write(CAMPAGNE ? `✓ manifeste vérifié ${HASH_MANIFESTE}\n` : "⚠ RÉPÉTITION sur symboles déjà vus — sans valeur probante\n");
  process.stderr.write(`✓ banc des chemins de verdict : ${verifications} vérifications\n`);
  const code = verifierFigeage();

  const pool = M.symboles.liste.map(celluleDe);
  const dejaVus = M.repetitionTechnique.symboles.map((symbol) => celluleDe({ symbol, premierJour: M.repetitionTechnique.debutInclus }));
  const cellulesCibles = CAMPAGNE ? pool : dejaVus;
  // Garde d'indépendance : la répétition ne lit jamais un symbole du pool.
  if (!CAMPAGNE && cellulesCibles.some((c) => pool.some((p) => p.symbol === c.symbol))) throw new Error("répétition : symbole du pool interdit");

  const acquises = await enParallele(cellulesCibles, CONCURRENCE, acquerir, (fait) => {
    process.stderr.write(`\r  … acquisition : ${fait}/${cellulesCibles.length} séries (${secondes()} s)`);
  });
  process.stderr.write(`\n✓ acquisition complète (${acquises.filter((a) => a.statut === "disponible").length}/${acquises.length} séries exploitables) — mesures\n`);

  const cellules: CelluleResultat[] = [];
  const mesurees: CelluleMesuree[] = [];
  const series: SeriesTimingCellule[] = [];
  try {
    let controlesSharpe = 0;
    for (const a of acquises) {
      if (a.statut === "indisponible") {
        cellules.push({ symbol: a.cellule.symbol, premierJour: a.cellule.premierJour, statut: "indisponible", erreur: a.erreur });
        continue;
      }
      // Seconde méthode du Sharpe sur les trois premières cellules disponibles (ordre du manifeste, aucune sélection).
      const m = mesurerCellule(a.cellule, chargerPourMesure(a), a.acquisition, controlesSharpe < 3);
      if (m.cellule.sharpeSecondeMethode !== null) controlesSharpe++;
      mesurees.push(m.cellule);
      series.push(m.series);
      cellules.push({ symbol: a.cellule.symbol, premierJour: a.cellule.premierJour, statut: "disponible", acquisition: a.acquisition, mesure: m.cellule });
      process.stderr.write(`\r  … mesures : ${mesurees.length} cellule(s), contrôles bloquants passés (${secondes()} s)`);
    }
    process.stderr.write("\n");
  } catch (erreur) {
    if (!(erreur instanceof EcartControle)) throw erreur;
    // Manifeste : « en cas d'écart : arrêt sans verdict ». Trace horodatée, sans aucune valeur mesurée.
    const calculeLeUtc = new Date().toISOString();
    const trace = join(SORTIES, `arret-v4-${calculeLeUtc.replace(/[:.]/g, "-")}.json`);
    mkdirSync(SORTIES, { recursive: true });
    writeFileSync(
      trace,
      `${JSON.stringify({
        schema: "axiom-axis-v4-backtest-arret-v1", mode: MODE, manifesteSha256: MANIFESTE_SHA256, hashManifesteEpingle: HASH_MANIFESTE, calculeLeUtc, code,
        arret: "ecart-controle", cellule: erreur.cellule, controle: erreur.controle, message: erreur.message, verdict: null,
      }, null, 2)}\n`
    );
    process.stderr.write(`\n✋ écart de contrôle : ${erreur.message}\n  ✓ trace écrite : ${trace} (aucun verdict, aucun rapport)\n`);
    process.exit(1);
  }

  const regroupe = mesurees.length > 0 ? regrouper(mesurees, series) : null;
  const { entree, valeurs } = extraire(cellulesCibles.length, mesurees.length, regroupe);
  const jugement = juger(entree);
  const formulations = formuler(jugement, entree, valeurs);
  const finUtc = new Date().toISOString();
  const horodatage = { debutUtc, finUtc, dureeS: secondes() };
  const resultat = {
    schema: "axiom-axis-v4-backtest-result-v1",
    mode: MODE,
    essai: !CAMPAGNE,
    manifeste: { chemin: CHEMIN_MANIFESTE, sha256: MANIFESTE_SHA256, epingle: HASH_MANIFESTE, figeLeUtc: M.figeLeUtc },
    horodatage,
    runtime: { bun: process.versions.bun ?? null, node: process.versions.node },
    code,
    avertissements,
    fenetre: { id: M.fenetre.id, timeframe: F.tf, debutParCellule: "00:00 UTC du premier jour de cotation", finExclue: iso(F.fin), bougiesMinimales: BOUGIES_MIN, warmupBougies: WARMUP },
    parametres: { v4: P4, v2: P2, couts: COUTS, timing: TIMING, bougiesParAn: BOUGIES_PAR_AN, coupesCausalite: COUPES_CAUSALITE, criteres: C },
    symboles: { total: cellulesCibles.length, disponibles: mesurees.length, minimum: jugement.minCellules, indisponibles: cellules.filter((c) => c.statut === "indisponible").map((c) => ({ symbol: c.symbol, erreur: c.erreur })) },
    verdict: jugement.verdict,
    raison: jugement.raison,
    blocs: jugement.blocs,
    entreeJugement: entree,
    valeursSuites: valeurs,
    formulations,
    regroupe,
    cellules: cellules.map((c) => (c.statut === "indisponible" ? { symbol: c.symbol, premierJour: c.premierJour, statut: c.statut, erreur: c.erreur } : { statut: c.statut, ...c.mesure! })),
    bancVerifications: verifications,
    strategieValideeAutomatiquement: false,
  };
  mkdirSync(SORTIES, { recursive: true });
  writeFileSync(SORTIE_JSON, `${JSON.stringify(resultat, infini, 2)}\n`);
  writeFileSync(SORTIE_MD, rapport(cellules, regroupe, jugement, entree, formulations, code, horodatage));
  process.stderr.write(`✓ verdict écrit${CAMPAGNE ? "" : " (RÉPÉTITION, sans valeur probante)"} : ${SORTIE_JSON} et ${SORTIE_MD} (${secondes()} s)\n`);
}

await main();
