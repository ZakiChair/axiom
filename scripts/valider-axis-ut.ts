#!/usr/bin/env bun
/**
 * AXIOM — test d'AXIS sur les autres unités de temps, données jamais vues,
 * 8 octobre 2026.
 *
 * Script d'ORCHESTRATION (réseau + disque). Protocole, unités, symboles,
 * fenêtres, critères et suites vivent dans `scripts/axis/manifeste-ut-2026-10-08.json`,
 * figé avant tout téléchargement de ces données : son SHA-256, celui de tout
 * l'arbre de code mesuré et le commit de figeage (chemins figés identiques à
 * HEAD) sont vérifiés avant le premier fetch, et les valeurs du protocole sont
 * lues dans le manifeste (une seule source).
 *
 * Pour chacune des treize unités (1s à 1w, hors 4h déjà testé), sur les mêmes
 * 42 alts jamais vues, deux familles jugées séparément :
 *  1. SIGNAUX ▲/▼ (position du chart, long/plat) : exécution `runBacktest`
 *     (coûts x1, x2, x3), rejeu close-à-close, timing contre des décalages
 *     circulaires communs aux cellules ; critères regroupés S1 à S4 ;
 *  2. FORTS ACHATS (marqueurs --accent) : rendement log signé à 12 bougies
 *     contre des décalages circulaires communs ; critères F1 à F3 (F3 : la
 *     suite moyenne doit dépasser le coût aller-retour).
 * Seuil de p corrigé pour les treize unités (Bonferroni). Contrôles bloquants
 * avant tout verdict (sinon arrêt sans verdict). Aucun résultat n'est affiché
 * avant la fin du calcul.
 *
 * Tout ce que produit ce script est une mesure PASSÉE, jamais une promesse.
 *
 * Usage : bun scripts/valider-axis-ut.ts --campagne   exécution unique
 *         bun scripts/valider-axis-ut.ts --essai      répétition sur les 8 symboles
 *           DÉJÀ VUS, mêmes unités et fenêtres, sorties dans /tmp, sans valeur probante
 * Tout autre argument est refusé : une faute de frappe ne lance jamais la campagne.
 * Cache : `scripts/.cache-klines/axis-ut/` (gitignoré, re-vérifié par hash).
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
  resolveParams,
  type EtatStrategie,
  type TradeStrategie,
} from "../packages/indicators/src/index";
import {
  MAX_GROS_AXIS,
  MAX_SIGNAUX_AXIS,
  fluxAxis,
  grosMouvementsAxis,
  positionsAxis,
  stratAxis,
  votesAxis,
} from "../packages/indicators/src/strategy/stratAxis";
import { runBacktest } from "../packages/backtest/src/engine";
import type { Operande, StrategieDef, TradeResultat } from "../packages/backtest/src/types";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = fileURLToPath(import.meta.url);
const ARGS = process.argv.slice(2);
if (ARGS.length !== 1 || (ARGS[0] !== "--essai" && ARGS[0] !== "--campagne")) {
  process.stderr.write("usage : bun scripts/valider-axis-ut.ts --essai | --campagne\n");
  process.exit(2);
}
const ESSAI = ARGS[0] === "--essai";
const MANIFESTE = join(RACINE, "scripts/axis/manifeste-ut-2026-10-08.json");
const HASH_MANIFESTE = "05ed40f0762578cf57c14cabf4db47c2e6a8141cf898edaf439bff989ea6c068";
const SORTIES = ESSAI ? "/tmp/axis-ut-essai" : join(RACINE, "scripts/axis");
const SORTIE_JSON = join(SORTIES, "resultat-ut-2026-10-08.json");
const SORTIE_MD = join(SORTIES, "rapport-ut-2026-10-08.md");
const DOSSIER_CACHE = join(RACINE, "scripts/.cache-klines/axis-ut");
const PREFIXE_CACHE = ESSAI ? "E" : "H";
const LIMITE_PAGE = 1000;

// ─────────────────────────── Manifeste ───────────────────────────

interface Cout { id: string; frais: number; slippage: number }
interface Tirages { tirages: number; graine: number; fractionMin: number; fractionMax: number }
interface FenetreManifeste { debutInclus: string; finExclue: string; dureeMs: number; ancre: string; libelle: string }
interface Manifeste {
  figeLeUtc: string;
  unites: { mesurees: string[]; nonMesurables: Record<string, string> };
  symboles: { liste: Array<{ symbol: string; premierJour: string }> };
  fenetres: Record<string, FenetreManifeste | string>;
  signal: { params: Record<string, number | boolean> };
  marche: { endpoint: string; tailleFixeQuote: number; capitalInitialQuote: number };
  donnees: {
    toleranceBordsH: number;
    partMaxBougiesManquantes: number;
    reprises: { tentativesParPage: number; attentesS: number[] };
    debit: { poidsMaxParMinute: number; delaiMaxRequeteS: number };
    concurrence: number;
  };
  mesures: {
    signaux: { warmupBougies: number; coutsParCotePct: Cout[]; timing: Tirages; emaReference: number };
    fortsAchats: {
      warmupBougies: number;
      horizons: number[];
      horizonPrincipal: number;
      horizonMax: number;
      timing: Tirages;
      permutationSens: { tirages: number; graine: number };
      coutAllerRetourPct: number;
    };
    coupesCausalite: number[];
  };
  criteres: {
    minPartCellulesDisponibles: number;
    pMax: number;
    signaux: { minTradesClosRegroupes: number };
    fortsAchats: { minFortsAchatsRegroupes: number };
  };
  suites: {
    signaux: {
      favorableEmaDominee: string;
      favorableEmaAuMoinsAussiBien: string;
      defavorable: string;
      echecs: { S1: string; S2: string; S3: string; S4: string };
      nonConcluant: string;
      raisons: { cellules: string; trades: string; moitie: string; fenetre: string };
      nonMesurable: string;
      generique: string;
    };
    fortsAchats: {
      favorable: string;
      forteVenteSignificatif: string;
      forteVenteNonSignificatif: string;
      defavorable: string;
      echecs: { F1: string; F2: string; F3: string; F3ApresF1: string };
      nonConcluant: string;
      raisons: { cellules: string; evenements: string; fenetre: string };
      nonMesurable: string;
      generique: string;
    };
    qualificationHors4h: string;
  };
  repetitionTechnique: { symboles: string[] };
  versions: { codeAuFigeageSha256: Record<string, string>; arbreCode: { dossiers: string[]; fichiers: number; sha256: string } };
}

const sha256 = (contenu: string | Uint8Array): string => createHash("sha256").update(contenu).digest("hex");
const iso = (ms: number): string => new Date(ms).toISOString();
/** Écarts au figeage : refus en campagne, simple avertissement en répétition. */
const avertissements: string[] = [];

function lireManifeste(): Manifeste {
  const brut = readFileSync(MANIFESTE, "utf8");
  const observe = sha256(brut);
  if (observe !== HASH_MANIFESTE) {
    const message = `manifeste modifié : ${observe}, attendu ${HASH_MANIFESTE}`;
    if (!ESSAI) throw new Error(`${message}. Aucun calcul autorisé.`);
    avertissements.push(message);
  }
  return JSON.parse(brut) as Manifeste;
}

const M = lireManifeste();
const P = M.signal.params;
const ENDPOINT = M.marche.endpoint;
const TAILLE = M.marche.tailleFixeQuote;
const CAPITAL = M.marche.capitalInitialQuote;
const MS = M.mesures.signaux;
const MF = M.mesures.fortsAchats;
const WS = MS.warmupBougies;
const WF = MF.warmupBougies;
const HORIZONS = MF.horizons;
const H_PRINCIPAL = MF.horizonPrincipal;
const H_MAX = MF.horizonMax;
const COUTS = MS.coutsParCotePct;
const P_MAX = M.criteres.pMax;
const MIN_PART_DISPO = M.criteres.minPartCellulesDisponibles;
const MIN_TRADES = M.criteres.signaux.minTradesClosRegroupes;
const MIN_ACHATS = M.criteres.fortsAchats.minFortsAchatsRegroupes;
const COUT_AR_PCT = MF.coutAllerRetourPct;
if (!HORIZONS.includes(H_PRINCIPAL) || Math.max(...HORIZONS) !== H_MAX) throw new Error("manifeste : horizons incohérents");
if (![WS, WF, P_MAX, MIN_PART_DISPO, MIN_TRADES, MIN_ACHATS, COUT_AR_PCT, TAILLE, CAPITAL].every(Number.isFinite)) {
  throw new Error("manifeste : critères incomplets");
}
const coutParId = (id: string): Cout => {
  const c = COUTS.find((x) => x.id === id);
  if (c === undefined) throw new Error(`coût ${id} absent du manifeste`);
  return c;
};
const X1 = coutParId("x1-central");
const X3 = coutParId("x3");
const SANS_COUT: Cout = { id: "sans-cout", frais: 0, slippage: 0 };
// F3 compare la suite au coût aller-retour des coûts x1 (deux côtés) : une seule source de vérité.
if (Math.abs(COUT_AR_PCT - 2 * (X1.frais + X1.slippage)) > 1e-12) throw new Error("manifeste : coût aller-retour ≠ 2 × (frais + slippage) x1");

// ─────────────────────────── Unités et fenêtres ───────────────────────────

/** Durées fixes des unités mesurées (même table que le moteur de backtest). */
const TF_MS: Record<string, number> = {
  "1s": 1_000, "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "6h": 21_600_000, "12h": 43_200_000, "1d": 86_400_000,
  "3d": 259_200_000, "1w": 604_800_000,
};
/** Lundi 1970-01-05 00:00 UTC : origine de la grille hebdomadaire de Binance. */
const ORIGINE_LUNDI = 4 * 86_400_000;

interface Unite { tf: Timeframe; dureeMs: number; debut: number; fin: number; ancre: "debut" | "premiere-bougie"; libelle: string }

function lireUnites(): Unite[] {
  if (M.unites.mesurees.length === 0) throw new Error("manifeste : aucune unité mesurée");
  return M.unites.mesurees.map((tf) => {
    const f = M.fenetres[tf];
    if (typeof f !== "object") throw new Error(`manifeste : fenêtre ${tf} absente`);
    const d = TF_MS[tf];
    if (d === undefined || d !== f.dureeMs) throw new Error(`manifeste : durée de ${tf} incohérente`);
    const debut = Date.parse(f.debutInclus);
    const fin = Date.parse(f.finExclue);
    if (!(Number.isFinite(debut) && Number.isFinite(fin) && debut < fin)) throw new Error(`manifeste : bornes de ${tf} invalides`);
    if (f.ancre === "debut") {
      const origine = tf === "1w" ? ORIGINE_LUNDI : 0;
      if ((debut - origine) % d !== 0 || (fin - origine) % d !== 0) throw new Error(`manifeste : fenêtre ${tf} hors grille`);
    } else if (f.ancre !== "premiere-bougie") {
      throw new Error(`manifeste : ancre ${f.ancre} inconnue`);
    }
    return { tf: tf as Timeframe, dureeMs: d, debut, fin, ancre: f.ancre, libelle: f.libelle };
  });
}

// ─────────────────────────── Données ───────────────────────────

interface PlageManquante { apres: string; reprise: string; bougies: number }
interface BougieEcartee { temps: string; raison: string }
/** Série telle que servie par la source, avant validation. */
interface Servies { candles: Candle[]; ecartees: BougieEcartee[] }
interface Acquisition {
  source: string;
  acquisLeUtc: string;
  modeCalcul: "cache" | "reseau";
  nombre: number;
  attendues: number;
  premierOpen: string;
  dernierClose: string;
  /** Bougies attendues absentes de la série utilisée, écartées comprises. */
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

/**
 * Série servie mais inexploitable selon le manifeste : la cellule devient
 * « indisponible ». Toute autre erreur d'acquisition (réseau au-delà des reprises,
 * cache) arrête le run AVANT la première mesure.
 */
class DonneesInvalides extends Error {}

const attendre = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

/**
 * Pause commune à toutes les requêtes en vol : au-delà de la limite de poids, Binance
 * répond 429 puis bannit l'IP (418) si les requêtes continuent.
 */
let pauseJusqua = 0;
const suspendre = (jusqua: number): void => {
  pauseJusqua = Math.max(pauseJusqua, jusqua);
};

/** GET JSON avec le débit et les reprises du manifeste (réseau, 418, 429, 5xx) ; 400 « symbole invalide » → indisponible. */
async function lireJson(url: string): Promise<unknown> {
  const { tentativesParPage, attentesS } = M.donnees.reprises;
  const { poidsMaxParMinute, delaiMaxRequeteS } = M.donnees.debit;
  let cause = "";
  for (let t = 0; t < tentativesParPage; t++) {
    const derniere = t === tentativesParPage - 1;
    while (Date.now() < pauseJusqua) await attendre(pauseJusqua - Date.now());
    let statut: number;
    let entetes: Headers;
    let corps: string;
    try {
      const reponse = await fetch(url, { signal: AbortSignal.timeout(delaiMaxRequeteS * 1000) });
      statut = reponse.status;
      entetes = reponse.headers;
      corps = await reponse.text();
    } catch (erreur) {
      cause = `réseau : ${(erreur as Error).message}`;
      if (!derniere) await attendre(1000 * (attentesS[t] ?? 16));
      continue;
    }
    const poids = Number(entetes.get("x-mbx-used-weight-1m"));
    if (Number.isFinite(poids) && poids >= poidsMaxParMinute) suspendre((Math.floor(Date.now() / 60_000) + 1) * 60_000 + 1_000);
    // Corps illisible : JSON.parse lève, le run s'arrête (aucune reprise).
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
 * Klines spot paginées sur `[debut, fin[` (OHLCV + volume taker acheteur, champ 9),
 * bougies clôturées avant `fin` uniquement. Une kline servie mais invalide est écartée
 * et datée (elle comptera comme manquante) ; une réponse illisible arrête le run.
 * Une page vide clôt la série ; une page courte aussi, sauf si sa dernière bougie n'est
 * pas la dernière attendue : une réponse tronquée d'un miroir ne doit pas se lire
 * comme une fin de série, la suite est redemandée.
 */
async function telecharger(symbol: string, u: Unite): Promise<Servies> {
  const parTemps = new Map<number, Candle>();
  const ecartees = new Map<number, string>();
  let curseur = u.debut;
  for (;;) {
    const brut = await lireJson(`${ENDPOINT}?symbol=${symbol}&interval=${u.tf}&startTime=${curseur}&endTime=${u.fin - 1}&limit=${LIMITE_PAGE}`);
    if (!Array.isArray(brut)) throw new Error("réponse Binance non tabulaire");
    for (const ligne of brut) {
      if (!Array.isArray(ligne) || ligne.length < 10) throw new Error("ligne kline Binance sans champ taker");
      const [time, open, high, low, close, volume, closeTime, takerBuy] = [0, 1, 2, 3, 4, 5, 6, 9].map((i) => Number(ligne[i])) as [
        number, number, number, number, number, number, number, number,
      ];
      if (!Number.isFinite(time)) throw new Error("kline Binance sans temps d'ouverture exploitable");
      if (time < u.debut || time + u.dureeMs > u.fin) continue;
      const bougie: Candle = { time, open, high, low, close, volume, buyVolume: takerBuy, sellVolume: volume - takerBuy };
      const raison = raisonInvalide(bougie) ?? (closeTime + 1 !== time + u.dureeMs ? "closeTime incohérent" : null);
      if (raison === null) parTemps.set(time, bougie);
      else ecartees.set(time, raison);
    }
    if (brut.length === 0) break;
    const dernier = Number((brut.at(-1) as unknown[])[0]);
    if (!(dernier >= curseur)) throw new Error("pagination Binance sans progression");
    if (brut.length < LIMITE_PAGE && dernier + 2 * u.dureeMs > u.fin) break;
    curseur = dernier + 1;
  }
  return {
    candles: [...parTemps.values()].sort((a, b) => a.time - b.time),
    ecartees: [...ecartees].sort((a, b) => a[0] - b[0]).map(([t, raison]) => ({ temps: iso(t), raison })),
  };
}

interface SerieValidee { candles: Candle[]; attendues: number; manquantes: number; plages: PlageManquante[]; ecartees: BougieEcartee[] }

/**
 * Série exploitable sur `[debut, fin[` : bougies invalides écartées (comptées comme
 * manquantes), temps strictement croissants sur la grille de l'unité (ancrée au début,
 * ou à la première bougie pour le 3d), bords dans les tolérances, trous sous le plafond.
 */
function valider(brutes: Candle[], u: Unite): SerieValidee {
  const candles: Candle[] = [];
  const ecartees: BougieEcartee[] = [];
  for (const c of brutes) {
    if (!Number.isFinite(c.time)) throw new DonneesInvalides("bougie sans temps d'ouverture exploitable");
    const raison = raisonInvalide(c);
    if (raison === null) candles.push(c);
    else ecartees.push({ temps: iso(c.time), raison });
  }
  if (candles.length === 0) throw new DonneesInvalides("série vide");
  const d = u.dureeMs;
  const tolerance = Math.max(M.donnees.toleranceBordsH * 3_600_000, d);
  const premier = candles[0]!.time;
  if (premier < u.debut || premier - u.debut > tolerance || (u.ancre === "premiere-bougie" && premier - u.debut >= d)) {
    throw new DonneesInvalides(`première bougie à ${iso(premier)}, hors tolérance du début ${iso(u.debut)}`);
  }
  const ancre = u.ancre === "debut" ? u.debut : premier;
  for (const c of candles) if ((c.time - ancre) % d !== 0) throw new DonneesInvalides(`bougie hors grille à ${iso(c.time)}`);
  for (let i = 1; i < candles.length; i++) {
    if (!(candles[i]!.time > candles[i - 1]!.time)) throw new DonneesInvalides(`série non strictement croissante à ${iso(candles[i]!.time)}`);
  }
  const dernier = candles.at(-1)!.time;
  if (dernier + d > u.fin || u.fin - (dernier + d) > tolerance) {
    throw new DonneesInvalides(`dernière clôture à ${iso(dernier + d)}, hors tolérance de la fin ${iso(u.fin)}`);
  }
  const attendues = Math.floor((u.fin - ancre) / d);
  const derniereAttendue = ancre + (attendues - 1) * d;
  const plages: PlageManquante[] = [];
  if (premier > ancre) plages.push({ apres: iso(ancre - d), reprise: iso(premier), bougies: (premier - ancre) / d });
  for (let i = 1; i < candles.length; i++) {
    const k = (candles[i]!.time - candles[i - 1]!.time) / d - 1;
    if (k > 0) plages.push({ apres: iso(candles[i - 1]!.time), reprise: iso(candles[i]!.time), bougies: k });
  }
  if (dernier < derniereAttendue) plages.push({ apres: iso(dernier), reprise: iso(u.fin), bougies: (derniereAttendue - dernier) / d });
  const manquantes = plages.reduce((s, p) => s + p.bougies, 0);
  if (manquantes > M.donnees.partMaxBougiesManquantes * attendues) {
    throw new DonneesInvalides(`${manquantes} bougies manquantes (écartées comprises) sur ${attendues} attendues`);
  }
  return { candles, attendues, manquantes, plages, ecartees };
}

function acquisition(v: SerieValidee, ecarteesSource: BougieEcartee[], u: Unite, acquisLeUtc: string, modeCalcul: Acquisition["modeCalcul"]): Acquisition {
  return {
    source: ENDPOINT, acquisLeUtc, modeCalcul, nombre: v.candles.length, attendues: v.attendues,
    premierOpen: iso(v.candles[0]!.time), dernierClose: iso(v.candles.at(-1)!.time + u.dureeMs),
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
  /** Erreur de la source qui rend la cellule indisponible (symbole invalide) ; absente sinon. */
  erreurSource?: string;
}
const SCHEMA_CACHE = "axiom-klines-axis-ut-v1";
const versLignes = (candles: Candle[]): Ligne[] => candles.map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume, c.buyVolume!]);
const depuisLignes = (lignes: Ligne[]): Candle[] =>
  lignes.map(([time, open, high, low, close, volume, buy]) => ({ time, open, high, low, close, volume, buyVolume: buy, sellVolume: volume - buy }));
const empreinteCache = (lignes: Ligne[], ecartees: BougieEcartee[], erreurSource: string | undefined): string =>
  sha256(JSON.stringify(erreurSource === undefined ? { lignes, ecartees } : { lignes, ecartees, erreurSource }));
const fichierCache = (symbol: string, u: Unite): string => join(DOSSIER_CACHE, `${PREFIXE_CACHE}-${symbol}-${u.tf}.json.gz`);

function lireCache(symbol: string, u: Unite): (Servies & { acquisLeUtc: string; erreurSource: string | undefined }) | null {
  const fichier = fichierCache(symbol, u);
  if (!existsSync(fichier)) return null;
  let e: Enveloppe;
  try {
    e = JSON.parse(gunzipSync(readFileSync(fichier)).toString("utf8")) as Enveloppe;
  } catch {
    throw new Error(`cache ${fichier} illisible : le supprimer pour re-télécharger`);
  }
  if (
    e.schema !== SCHEMA_CACHE || e.endpoint !== ENDPOINT || e.symbol !== symbol || e.unite !== u.tf || e.debut !== u.debut || e.fin !== u.fin ||
    !Array.isArray(e.lignes) || !Array.isArray(e.ecartees) || (e.erreurSource !== undefined && typeof e.erreurSource !== "string") ||
    empreinteCache(e.lignes, e.ecartees, e.erreurSource) !== e.sha256
  ) {
    throw new Error(`cache ${fichier} non traçable : le supprimer pour re-télécharger`);
  }
  return { candles: depuisLignes(e.lignes), ecartees: e.ecartees, acquisLeUtc: e.acquisLeUtc, erreurSource: e.erreurSource };
}

function ecrireCache(symbol: string, u: Unite, servies: Servies, acquisLeUtc: string, erreurSource?: string): void {
  const lignes = versLignes(servies.candles);
  const enveloppe: Enveloppe = {
    schema: SCHEMA_CACHE, endpoint: ENDPOINT, symbol, unite: u.tf, debut: u.debut, fin: u.fin, acquisLeUtc,
    sha256: empreinteCache(lignes, servies.ecartees, erreurSource), lignes, ecartees: servies.ecartees,
    ...(erreurSource === undefined ? {} : { erreurSource }),
  };
  mkdirSync(DOSSIER_CACHE, { recursive: true });
  // Écriture atomique : une interruption ne laisse jamais un cache tronqué.
  const fichier = fichierCache(symbol, u);
  writeFileSync(`${fichier}.tmp`, gzipSync(JSON.stringify(enveloppe)));
  renameSync(`${fichier}.tmp`, fichier);
}

type Acquise =
  | { symbol: string; unite: Unite; statut: "disponible"; acquisition: Acquisition }
  | { symbol: string; unite: Unite; statut: "indisponible"; erreur: string };

/**
 * Acquisition seule (aucune mesure) : une série invalide rend la cellule indisponible, toute
 * autre erreur arrête le run. La série servie est mise en cache AVANT sa validation, qu'elle
 * soit exploitable ou non (un symbole invalide aussi) : une relance après interruption relit
 * la même série et rend le même statut, sans nouvelle requête.
 */
async function acquerir(symbol: string, u: Unite): Promise<Acquise> {
  try {
    const cache = lireCache(symbol, u);
    if (cache?.erreurSource !== undefined) throw new DonneesInvalides(cache.erreurSource);
    const acquisLeUtc = cache?.acquisLeUtc ?? new Date().toISOString();
    let servies: Servies | null = cache;
    if (servies === null) {
      try {
        servies = await telecharger(symbol, u);
      } catch (erreur) {
        if (erreur instanceof DonneesInvalides) ecrireCache(symbol, u, { candles: [], ecartees: [] }, acquisLeUtc, erreur.message);
        throw erreur;
      }
      ecrireCache(symbol, u, servies, acquisLeUtc);
    }
    const v = valider(servies.candles, u);
    return { symbol, unite: u, statut: "disponible", acquisition: acquisition(v, servies.ecartees, u, acquisLeUtc, cache === null ? "reseau" : "cache") };
  } catch (erreur) {
    if (!(erreur instanceof DonneesInvalides)) throw erreur;
    return { symbol, unite: u, statut: "indisponible", erreur: erreur.message };
  }
}

/** Série d'une cellule disponible, relue depuis le cache et re-validée (identique à l'acquisition). */
function chargerPourMesure(a: Extract<Acquise, { statut: "disponible" }>): Candle[] {
  const cache = lireCache(a.symbol, a.unite);
  if (cache === null) throw new Error(`cache absent pour ${a.symbol} ${a.unite.tf}`);
  const v = valider(cache.candles, a.unite);
  if (sha256(JSON.stringify(v.candles)) !== a.acquisition.sha256Ohlcv) throw new Error(`série relue différente de l'acquisition : ${a.symbol} ${a.unite.tf}`);
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
 * Le moteur ne résout que des ids du registre, et la position 0/1 n'est
 * volontairement pas une sortie publique d'AXIS. Cette def n'existe que dans le
 * registre de ce processus : elle lit la sortie `prixSignal` du chart, définie
 * exactement pendant un achat affiché.
 */
const ID_POSITION = "axisPositionCampagne";
const defPosition: IndicatorDef = {
  ...stratAxis,
  id: ID_POSITION,
  name: "AXIS — position (campagne)",
  outputs: [{ key: "position", name: "Position", style: "line" }],
  calc: (candles, params, ctx) => {
    const prix = stratAxis.calc(candles, params, ctx).series.prixSignal ?? [];
    return { series: { position: candles.map((_c, i) => (prix[i] === undefined ? 0 : 1)) } };
  },
};
if (!INDICATORS.some((d) => d.id === ID_POSITION)) INDICATORS.push(defPosition);

const positionDe = (candles: Candle[]): number[] => {
  const serie = computeIndicator(defPosition, candles, P).series.position ?? [];
  return candles.map((_c, i) => (serie[i] === 1 ? 1 : 0));
};

const cst = (valeur: number): Operande => ({ type: "constante", valeur });
const position: Operande = { type: "indicateur", indicateurId: ID_POSITION, params: { ...P }, output: "position" };
const jambeAxis: StrategieDef = {
  direction: "long",
  tailleFixe: TAILLE,
  reglesEntree: [{ type: "croisement", a: position, b: cst(0.5), sens: "hausse" }],
  reglesSortie: [{ type: "comparaison", gauche: position, comparateur: "<", droite: cst(0.5) }],
};
const close: Operande = { type: "prix", champ: "close" };
const emaReference: Operande = { type: "indicateur", indicateurId: "ema", params: { length: MS.emaReference }, output: "ema" };
const jambeEma: StrategieDef = {
  direction: "long",
  tailleFixe: TAILLE,
  reglesEntree: [{ type: "croisement", a: close, b: emaReference, sens: "hausse" }],
  reglesSortie: [{ type: "comparaison", gauche: close, comparateur: "<", droite: emaReference }],
};

interface Bornes { timeframe: Timeframe; debutEvaluationMs: number; finDonneesMs: number }
const executer = (candles: Candle[], strat: StrategieDef, cout: Cout, bornes: Bornes): TradeResultat[] =>
  runBacktest(candles, strat, { fraisPct: cout.frais, slippagePct: cout.slippage, capitalInitial: CAPITAL, ...bornes }).trades;

const chronologie = (trades: TradeResultat[]): string => trades.map((t) => `${t.sens}:${t.tempsEntree}:${t.tempsSortie}:${t.raison}`).join("|");

// ─────────────────────────── Contrôles bloquants ───────────────────────────

/**
 * Écart détecté par un contrôle bloquant : ARRÊT sans verdict, jamais absorbé en
 * cellule « indisponible » (réservé aux données inexploitables). En campagne, le
 * message ne nomme que la cellule et le contrôle ; le détail n'apparaît qu'en répétition.
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

interface Evenement { idx: number; sens: number }
type Positions = Array<number | undefined>;

/** Position d'AXIS recalculée depuis les fonctions exportées (fin = n − 2) et bougies de signal. */
function positionEtSignaux(candles: Candle[]): { brute: Positions; signaux: number[] } {
  const p = resolveParams(stratAxis, P);
  const score = votesAxis(candles, p).map((v) => v?.reduce((s, x) => s + x, 0));
  const closes = closeOf(candles);
  const tendance = ema(closes, Number(p.emaTendance));
  const brute = positionsAxis(
    score,
    tendance.map((t, i) => (t === undefined ? undefined : (closes[i] ?? t) > t)),
    Number(p.seuil),
    Number(p.seuilVente),
    candles.length - 2
  );
  const signaux: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = brute[i - 1];
    if (prev !== undefined && brute[i] !== prev) signaux.push(i);
  }
  return { brute, signaux };
}

/** Forts mouvements du chart recalculés depuis les fonctions exportées. */
function evenementsDe(candles: Candle[]): { evenements: Evenement[]; brute: Positions; signaux: number[] } {
  const { brute, signaux } = positionEtSignaux(candles);
  const flux = fluxAxis(candles, undefined, Number(P.rvolPeriode), Number(P.oiBougies));
  return { evenements: grosMouvementsAxis(candles, flux, Number(P.seuilGros), new Set(signaux)), brute, signaux };
}

const forme = (sens: number): string => (sens > 0 ? "triangleHaut" : "triangleBas");

/** Position de campagne (registre → prixSignal) = recalcul direct, à chaque bougie. */
function controlerPosition(cle: string, candles: Candle[], pos: number[], brute: Positions): void {
  for (let i = 0; i < candles.length; i++) {
    if ((brute[i] === 1 ? 1 : 0) !== pos[i]) {
      throw new EcartControle(cle, "position = recalcul", `position ${pos[i]} ≠ recalcul ${brute[i]} à ${iso(candles[i]!.time)}`);
    }
  }
}

/** Les signaux (120 derniers) et les forts mouvements (60 derniers) sont exactement les marqueurs du chart. */
function controlerMarqueurs(cle: string, candles: Candle[], pos: number[], signaux: number[], evenements: Evenement[]): void {
  const marqueurs = computeIndicator(stratAxis, candles, P).annotations?.marqueurs ?? [];
  const accent = marqueurs.filter((m) => m.couleur === "--accent");
  const attendus = evenements.slice(-MAX_GROS_AXIS);
  const conforme = accent.length === attendus.length && accent.every((m, k) => m.idx === attendus[k]!.idx && m.forme === forme(attendus[k]!.sens));
  if (!conforme) throw new EcartControle(cle, "forts mouvements = marqueurs du chart", `${accent.length} marqueurs --accent ≠ ${attendus.length} événements attendus`);
  const signauxChart = marqueurs.filter((m) => m.couleur !== "--accent");
  const signauxAttendus = signaux.slice(-MAX_SIGNAUX_AXIS);
  const conformeSignaux =
    signauxChart.length === signauxAttendus.length &&
    signauxChart.every((m, k) => m.idx === signauxAttendus[k] && m.forme === (pos[m.idx] === 1 ? "triangleHaut" : "triangleBas"));
  if (!conformeSignaux) throw new EcartControle(cle, "signaux = marqueurs du chart", `${signauxChart.length} marqueurs ≠ ${signauxAttendus.length} changements de position`);
}

/** Aucune anticipation sur les données réelles : un préfixe ne change jamais la position ni les forts mouvements passés. */
function controlerCausalite(cle: string, candles: Candle[], pos: number[], evenements: Evenement[]): void {
  for (const f of M.mesures.coupesCausalite) {
    const coupe = Math.floor(candles.length * f);
    const prefixe = candles.slice(0, coupe);
    const posPrefixe = positionDe(prefixe);
    for (let i = 0; i <= coupe - 2; i++) {
      if (posPrefixe[i] !== pos[i]) throw new EcartControle(cle, "causalité (position)", `préfixe ${f} diverge à ${iso(candles[i]!.time)}`);
    }
    const ev = evenementsDe(prefixe).evenements.map((e) => `${e.idx}:${e.sens}`).join("|");
    const complet = evenements.filter((e) => e.idx <= coupe - 2).map((e) => `${e.idx}:${e.sens}`).join("|");
    if (ev !== complet) throw new EcartControle(cle, "causalité (forts mouvements)", `préfixe ${f} diverge`);
  }
}

/**
 * Le moteur (fill à l'open i+1) doit reproduire EXACTEMENT les décisions du rejeu
 * (close i) nées après le warmup : trades clos par règle, puis position fin-données.
 */
function controlerChronologie(cle: string, candles: Candle[], rejeu: { trades: TradeStrategie[]; ouvert: TradeStrategie | null }, trades: TradeResultat[]): void {
  const index = new Map(candles.map((c, i) => [c.time, i]));
  const decision = (temps: number): number => {
    const i = index.get(temps);
    if (i === undefined) throw new EcartControle(cle, "chronologie moteur = rejeu", `fill hors série à ${temps}`);
    return i - 1;
  };
  if (trades.some((t) => t.sens !== "long" || (t.raison !== "regle" && t.raison !== "fin-donnees"))) {
    throw new EcartControle(cle, "chronologie moteur = rejeu", "trade moteur hors contrat (sens ou raison)");
  }
  const moteur = trades.filter((t) => t.raison === "regle").map((t) => `${decision(t.tempsEntree)}:${decision(t.tempsSortie)}`);
  const attendu = rejeu.trades.map((t) => `${t.idxEntree}:${t.idxSortie}`);
  if (moteur.join("|") !== attendu.join("|")) {
    throw new EcartControle(cle, "chronologie moteur = rejeu", `moteur ${moteur.length} trades ≠ rejeu ${attendu.length} trades`);
  }
  const finDonnees = trades.filter((t) => t.raison === "fin-donnees");
  const ouvert = rejeu.ouvert;
  if (finDonnees.length !== (ouvert === null ? 0 : 1)) {
    throw new EcartControle(cle, "chronologie moteur = rejeu", `${finDonnees.length} position(s) fin-données, trade ouvert du rejeu ${ouvert === null ? "absent" : "présent"}`);
  }
  if (ouvert !== null && decision(finDonnees[0]!.tempsEntree) !== ouvert.idxEntree) {
    throw new EcartControle(cle, "chronologie moteur = rejeu", `position fin-données entrée ${decision(finDonnees[0]!.tempsEntree)} ≠ rejeu ${ouvert.idxEntree}`);
  }
}

// ─────────────────────────── Timing (signaux) ───────────────────────────

/**
 * Série de timing d'une cellule : décisions évaluées `a … n−2` (L décisions), rendement
 * log de la bougie détenue après chaque décision, et achats nés après le warmup sous
 * forme d'intervalles de décisions `[entrée, sortie − 1]` (décalés de `a`).
 */
interface SerieTiming { L: number; prefixe: Float64Array; runs: Array<[number, number]>; exposition: number }
type Intervalles = Array<[number, number]>;

function prefixeTiming(candles: Candle[], a: number): { L: number; prefixe: Float64Array } {
  const n = candles.length;
  const L = n - 1 - a;
  const r = (j: number): number => {
    const i = a + j;
    return i + 2 <= n - 1 ? Math.log(candles[i + 2]!.open / candles[i + 1]!.open) : Math.log(candles[n - 1]!.close / candles[n - 1]!.open);
  };
  // Sommes préfixes sur la série doublée : un intervalle décalé de k < L reste contigu.
  const prefixe = new Float64Array(2 * L + 1);
  for (let j = 0; j < 2 * L; j++) prefixe[j + 1] = prefixe[j]! + r(j % L);
  return { L, prefixe };
}

const intervallesValides = (runs: Intervalles, L: number): boolean => runs.every(([d, f]) => d >= 0 && f >= d && f < L);
const exposition = (runs: Intervalles, L: number): number => runs.reduce((s, [d, f]) => s + f - d + 1, 0) / L;
const capte = (x: SerieTiming, k: number): number => x.runs.reduce((s, [d, f]) => s + x.prefixe[f + k + 1]! - x.prefixe[d + k]!, 0);

function serieTiming(cle: string, candles: Candle[], trades: TradeStrategie[], ouvert: TradeStrategie | null, a: number): SerieTiming {
  const { L, prefixe } = prefixeTiming(candles, a);
  const runs: Intervalles = trades.map((t) => [t.idxEntree - a, t.idxSortie! - 1 - a]);
  if (ouvert !== null) runs.push([ouvert.idxEntree - a, candles.length - 2 - a]);
  if (!intervallesValides(runs, L)) throw new EcartControle(cle, "intervalles de timing", `intervalle hors [0, ${L}[`);
  return { L, prefixe, runs, exposition: exposition(runs, L) };
}

/**
 * Série de timing reconstruite depuis les fills d'une exécution sans coût (référence
 * EMA 200, descriptive) ; `null` si la reconstruction ne retrouve pas exactement le
 * rendement brut des fills.
 */
function serieDepuisFills(base: { L: number; prefixe: Float64Array }, candles: Candle[], trades: TradeResultat[], a: number): SerieTiming | null {
  const index = new Map(candles.map((c, i) => [c.time, i]));
  const n = candles.length;
  const runs: Intervalles = [];
  for (const t of trades) {
    const e = index.get(t.tempsEntree);
    const s = t.raison === "fin-donnees" ? n : index.get(t.tempsSortie);
    if (e === undefined || s === undefined) return null;
    runs.push([e - 1 - a, s - 2 - a]);
  }
  if (!intervallesValides(runs, base.L)) return null;
  const serie = { ...base, runs, exposition: exposition(runs, base.L) };
  const brut = trades.reduce((x, t) => x + Math.log(t.prixSortie / t.prixEntree), 0);
  return Math.abs(brut - capte(serie, 0)) <= 1e-9 ? serie : null;
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

const tiragesU = (t: Tirages): Float64Array => {
  const rnd = mulberry32(t.graine);
  return Float64Array.from({ length: t.tirages }, () => rnd());
};
const TS = MS.timing;
const TF = MF.timing;
const U_SIGNAUX = tiragesU(TS);
const U_FLUX = tiragesU(TF);
const decalage = (t: Tirages, L: number, u: number): number => Math.floor(L * (t.fractionMin + (t.fractionMax - t.fractionMin) * u));

interface Decalages { ks: Int32Array; exhaustif: boolean }

/**
 * Décalages du nul pour une fenêtre de L décisions : K = {⌊fMin·L⌋, …, ⌈fMax·L⌉ − 1}.
 * Tous les k de K quand |K| ≤ tirages (énumération exhaustive : p exacte, plancher
 * 1 / (|K| + 1)) ; sinon `tirages` k tirés. Des tirages avec remise dans un petit K
 * afficheraient un plancher 1 / (tirages + 1) que le test n'atteint pas. K vide (fenêtre
 * minuscule) : aucun décalage, p = 1.
 */
function decalagesNul(t: Tirages, us: Float64Array, L: number): Decalages {
  const kMin = Math.floor(t.fractionMin * L + 1e-9);
  const kFin = Math.ceil(t.fractionMax * L - 1e-9);
  if (kMin < 1 || kFin > L || kFin <= kMin) return { ks: new Int32Array(0), exhaustif: true };
  const nK = kFin - kMin;
  return nK <= t.tirages
    ? { ks: Int32Array.from({ length: nK }, (_x, j) => kMin + j), exhaustif: true }
    : { ks: Int32Array.from(us, (u) => decalage(t, L, u)), exhaustif: false };
}

function quantile(v: ArrayLike<number>, q: number): number {
  const s = Float64Array.from(v).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
}

interface ResultatTiming { capteLog: number; p: number; medianeNulle: number; q95Nulle: number; L: number; nDecalages: number; exhaustif: boolean }

/** Test de décalage circulaire : un même k (calculé sur `L`) pour toutes les séries. */
function testTiming(series: SerieTiming[], L: number): ResultatTiming {
  const total = (k: number): number => series.reduce((s, x) => s + capte(x, k), 0);
  const observe = total(0);
  const { ks, exhaustif } = decalagesNul(TS, U_SIGNAUX, L);
  const nul = Float64Array.from(ks, (k) => total(k));
  let auDessus = 0;
  for (const v of nul) if (v >= observe) auDessus++;
  return {
    capteLog: observe, p: (1 + auDessus) / (nul.length + 1), medianeNulle: quantile(nul, 0.5), q95Nulle: quantile(nul, 0.95),
    L, nDecalages: nul.length, exhaustif,
  };
}

// ─────────────────────────── Statistiques (forts achats) ───────────────────────────

interface SerieFlux { lnOpen: Float64Array; a: number; b: number }
interface EvenementFlux { idx: number; sens: number; tendance: number; annee: number }
interface JeuFlux { serie: SerieFlux; evenements: EvenementFlux[] }

const rendement = (s: SerieFlux, i: number, sens: number, h: number): number => sens * (s.lnOpen[i + 1 + h]! - s.lnOpen[i + 1]!);

interface Stat {
  n: number;
  moyenneBps: number;
  medianeBps: number;
  hitsPct: number;
  t: number;
  /** Unilatérale (nul ≥ observé) ; `null` hors horizon principal. */
  pUni: number | null;
  /** Bilatérale (|nul| ≥ |observé|) ; `null` hors horizon principal. */
  pBi: number | null;
  medianeNulleBps: number | null;
  q95NulleBps: number | null;
  L: number;
  /** Décalages du nul (0 sans nul) et mode : tous les k de K, ou tirés. */
  nDecalages: number;
  exhaustif: boolean | null;
}

/** Statistique d'un ensemble de jeux à l'horizon h ; nul par décalages communs si demandé. */
function statistique(jeux: JeuFlux[], h: number, avecNul: boolean): Stat {
  const valeurs: number[] = [];
  for (const { serie, evenements } of jeux) for (const e of evenements) valeurs.push(rendement(serie, e.idx, e.sens, h));
  const n = valeurs.length;
  const L = jeux.length === 0 ? 0 : Math.min(...jeux.map(({ serie }) => serie.b - serie.a + 1));
  if (n === 0) {
    return { n: 0, moyenneBps: 0, medianeBps: 0, hitsPct: 0, t: 0, pUni: null, pBi: null, medianeNulleBps: null, q95NulleBps: null, L, nDecalages: 0, exhaustif: null };
  }
  const somme = valeurs.reduce((x, y) => x + y, 0);
  const moyenne = somme / n;
  const variance = valeurs.reduce((x, y) => x + (y - moyenne) ** 2, 0) / Math.max(1, n - 1);
  const base: Stat = {
    n,
    moyenneBps: moyenne * 1e4,
    medianeBps: quantile(valeurs, 0.5) * 1e4,
    hitsPct: (valeurs.filter((v) => v > 0).length / n) * 100,
    t: variance > 0 ? moyenne / Math.sqrt(variance / n) : 0,
    pUni: null,
    pBi: null,
    medianeNulleBps: null,
    q95NulleBps: null,
    L,
    nDecalages: 0,
    exhaustif: null,
  };
  if (!avecNul) return base;
  const compacts = jeux.map(({ serie, evenements }) => ({
    lnOpen: serie.lnOpen, a: serie.a, Ls: serie.b - serie.a + 1,
    idx: Int32Array.from(evenements, (e) => e.idx), sens: Float64Array.from(evenements, (e) => e.sens),
  }));
  const { ks, exhaustif } = decalagesNul(TF, U_FLUX, L);
  const nul = new Float64Array(ks.length);
  for (let d = 0; d < ks.length; d++) {
    const k = ks[d]!;
    let total = 0;
    for (const c of compacts) {
      for (let e = 0; e < c.idx.length; e++) {
        const i = c.a + ((c.idx[e]! - c.a + k) % c.Ls);
        total += c.sens[e]! * (c.lnOpen[i + 1 + h]! - c.lnOpen[i + 1]!);
      }
    }
    nul[d] = total;
  }
  let uni = 0;
  let bi = 0;
  for (const v of nul) {
    if (v >= somme) uni++;
    if (Math.abs(v) >= Math.abs(somme)) bi++;
  }
  return {
    ...base,
    pUni: (1 + uni) / (nul.length + 1),
    pBi: (1 + bi) / (nul.length + 1),
    medianeNulleBps: (quantile(nul, 0.5) / n) * 1e4,
    q95NulleBps: (quantile(nul, 0.95) / n) * 1e4,
    nDecalages: nul.length,
    exhaustif,
  };
}

interface StatPermutation { n: number; total: number; moyenneAchatsBps: number; moyenneTousBps: number; medianeNulleBps: number; pUni: number | null }

/**
 * Nul complémentaire (descriptif) : permutation des sens parmi tous les forts mouvements de
 * chaque cellule. Tirage sans remise par Fisher-Yates partiel en place : sur un tableau
 * quelconque, les `nAchats` premières positions après le tirage forment un échantillon
 * uniforme, l'ordre de départ n'importe pas.
 */
function permutationSens(jeux: Array<{ serie: SerieFlux; achats: EvenementFlux[]; ventes: EvenementFlux[] }>, h: number): StatPermutation {
  const brut = (s: SerieFlux, e: EvenementFlux): number => s.lnOpen[e.idx + 1 + h]! - s.lnOpen[e.idx + 1]!;
  const cellules = jeux.map(({ serie, achats, ventes }) => ({ tous: Float64Array.from([...achats, ...ventes], (e) => brut(serie, e)), nAchats: achats.length }));
  const n = cellules.reduce((s, c) => s + c.nAchats, 0);
  const total = cellules.reduce((s, c) => s + c.tous.length, 0);
  if (n === 0 || total === 0) return { n, total, moyenneAchatsBps: 0, moyenneTousBps: 0, medianeNulleBps: 0, pUni: null };
  const observe = jeux.reduce((s, { serie, achats }) => s + achats.reduce((x, e) => x + brut(serie, e), 0), 0);
  const sommeTous = cellules.reduce((s, c) => s + c.tous.reduce((x, y) => x + y, 0), 0);
  const rnd = mulberry32(MF.permutationSens.graine);
  const nul = new Float64Array(MF.permutationSens.tirages);
  for (let d = 0; d < nul.length; d++) {
    let somme = 0;
    for (const { tous, nAchats } of cellules) {
      for (let j = 0; j < nAchats; j++) {
        const r = j + Math.floor(rnd() * (tous.length - j));
        const x = tous[r]!;
        tous[r] = tous[j]!;
        tous[j] = x;
        somme += x;
      }
    }
    nul[d] = somme;
  }
  let auDessus = 0;
  for (const v of nul) if (v >= observe) auDessus++;
  return {
    n, total,
    moyenneAchatsBps: (observe / n) * 1e4,
    moyenneTousBps: (sommeTous / total) * 1e4,
    medianeNulleBps: (quantile(nul, 0.5) / n) * 1e4,
    pUni: (1 + auDessus) / (nul.length + 1),
  };
}

/** Contrôle : horizon disponible, et somme observée directe = somme par rendements de bougie à bougie cumulés. */
function controlerStatistique(cle: string, candles: Candle[], s: SerieFlux, evenements: Evenement[], h: number): void {
  const n = candles.length;
  const prefixe = new Float64Array(n);
  for (let j = 1; j < n; j++) prefixe[j] = prefixe[j - 1]! + Math.log(candles[j]!.open / candles[j - 1]!.open);
  let direct = 0;
  let parPrefixe = 0;
  for (const e of evenements) {
    if (e.idx + 1 + H_MAX > n - 1) throw new EcartControle(cle, "horizon", `événement ${e.idx} sans ${H_MAX} bougies suivantes`);
    direct += rendement(s, e.idx, e.sens, h);
    parPrefixe += e.sens * (prefixe[e.idx + 1 + h]! - prefixe[e.idx + 1]!);
  }
  if (Math.abs(direct - parPrefixe) > 1e-9) throw new EcartControle(cle, "statistique", `direct ${direct} ≠ préfixes ${parPrefixe}`);
}

// ─────────────────────────── Mesure d'une cellule ───────────────────────────

interface MetriquesCout { trades: number; fermes: number; finDonnees: number; sommePnl: number; sommePnlPct: number; gagnants: number; fraisTotal: number }
interface ResumeRejeu { trades: number; sommePct: number; gagnants: number }
interface SignauxCellule {
  decisions: number;
  premierFillUtc: string;
  executions: Record<string, MetriquesCout>;
  rejeu: { fenetre: ResumeRejeu; m1: ResumeRejeu; m2: ResumeRejeu };
  exposition: number;
  achatConservationPct: number;
  timing: ResultatTiming;
  ema: { executions: Record<string, MetriquesCout>; exposition: number | null; timing: ResultatTiming | null };
  empreinteChronologieX1: string;
}
interface FluxCellule {
  decisions: number;
  premiereDecisionUtc: string;
  derniereDecisionUtc: string;
  achats: number;
  ventes: number;
  moyenneAchats12Bps: number | null;
  hitsAchats12Pct: number | null;
  moyenneVentes12Bps: number | null;
}
interface CelluleMesuree {
  id: string;
  symbol: string;
  acquisition: Acquisition;
  signaux: SignauxCellule;
  flux: FluxCellule;
  serieTiming: SerieTiming;
  serieEma: SerieTiming | null;
  serieFlux: SerieFlux;
  achats: EvenementFlux[];
  ventes: EvenementFlux[];
}

function metriquesCout(trades: TradeResultat[]): MetriquesCout {
  return {
    trades: trades.length,
    fermes: trades.filter((t) => t.raison === "regle").length,
    finDonnees: trades.filter((t) => t.raison === "fin-donnees").length,
    sommePnl: trades.reduce((s, t) => s + t.pnl, 0),
    sommePnlPct: trades.reduce((s, t) => s + t.pnlPct, 0),
    gagnants: trades.filter((t) => t.pnl > 0).length,
    fraisTotal: trades.reduce((s, t) => s + t.frais, 0),
  };
}

/** Trades clos du rejeu (sortie et PnL définis et finis). */
const clos = (trades: TradeStrategie[]): Array<TradeStrategie & { idxSortie: number; pnlPct: number }> =>
  trades.filter((t): t is TradeStrategie & { idxSortie: number; pnlPct: number } => t.idxSortie !== undefined && t.pnlPct !== undefined && Number.isFinite(t.pnlPct));
const resume = (trades: Array<{ pnlPct: number }>): ResumeRejeu => ({
  trades: trades.length,
  sommePct: trades.reduce((s, t) => s + t.pnlPct, 0),
  // Même convention que statsTrades (winRate : pnlPct ≥ 0).
  gagnants: trades.filter((t) => t.pnlPct >= 0).length,
});

function mesurerSignaux(id: string, u: Unite, candles: Candle[], pos: number[]): { resultat: SignauxCellule; serie: SerieTiming; serieEma: SerieTiming | null } {
  const n = candles.length;
  const a = WS - 1;
  const brut = construireTradesStrategie(candles, pos as EtatStrategie[]);
  const trades = clos(brut.trades.filter((t) => t.idxEntree >= a));
  if (trades.length !== brut.trades.filter((t) => t.idxEntree >= a).length) throw new EcartControle(id, "rejeu", "trade du rejeu sans sortie ni PnL");
  const ouvert = brut.ouvert !== null && brut.ouvert.idxEntree >= a ? brut.ouvert : null;
  const milieu = a + Math.floor((n - 1 - a) / 2);

  const bornes: Bornes = { timeframe: u.tf, debutEvaluationMs: candles[WS]!.time, finDonneesMs: candles[n - 1]!.time + u.dureeMs };
  const executions = [...COUTS, SANS_COUT].map((c) => ({ cout: c, trades: executer(candles, jambeAxis, c, bornes) }));
  const x1 = executions.find((e) => e.cout.id === X1.id)!;
  controlerChronologie(id, candles, { trades, ouvert }, x1.trades);
  const reference = chronologie(x1.trades);
  for (const e of executions) {
    if (chronologie(e.trades) !== reference) throw new EcartControle(id, "coûts sans effet sur les fills", `écart au niveau ${e.cout.id}`);
  }

  const serie = serieTiming(id, candles, trades, ouvert, a);
  const sansCout = executions.find((e) => e.cout.id === SANS_COUT.id)!;
  const brutMoteur = sansCout.trades.reduce((s, t) => s + Math.log(t.prixSortie / t.prixEntree), 0);
  if (Math.abs(brutMoteur - capte(serie, 0)) > 1e-9) {
    throw new EcartControle(id, "timing = moteur sans coût", `timing ${capte(serie, 0)} ≠ moteur sans coût ${brutMoteur}`);
  }

  // Référence EMA 200 : descriptive, elle ne bloque jamais (timing omis si non reconstruit).
  const execEma = [X1, X3, SANS_COUT].map((c) => ({ cout: c, trades: executer(candles, jambeEma, c, bornes) }));
  const serieEma = serieDepuisFills(serie, candles, execEma.find((e) => e.cout.id === SANS_COUT.id)!.trades, a);

  return {
    serie,
    serieEma,
    resultat: {
      decisions: serie.L,
      premierFillUtc: iso(candles[WS]!.time),
      executions: Object.fromEntries(executions.filter((e) => e.cout.id !== SANS_COUT.id).map((e) => [e.cout.id, metriquesCout(e.trades)])),
      rejeu: {
        fenetre: resume(trades),
        m1: resume(trades.filter((t) => t.idxEntree < milieu)),
        m2: resume(trades.filter((t) => t.idxEntree >= milieu)),
      },
      exposition: serie.exposition,
      achatConservationPct: ((candles[n - 1]!.close - candles[WS]!.open) / candles[WS]!.open) * 100,
      timing: testTiming([serie], serie.L),
      ema: {
        executions: Object.fromEntries(execEma.filter((e) => e.cout.id !== SANS_COUT.id).map((e) => [e.cout.id, metriquesCout(e.trades)])),
        exposition: serieEma?.exposition ?? null,
        timing: serieEma === null ? null : testTiming([serieEma], serieEma.L),
      },
      empreinteChronologieX1: sha256(reference),
    },
  };
}

const signe = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

function mesurerFlux(id: string, candles: Candle[], evenements: Evenement[]): { resultat: FluxCellule; serie: SerieFlux; achats: EvenementFlux[]; ventes: EvenementFlux[] } {
  const n = candles.length;
  const a = WF - 1;
  const b = n - 2 - H_MAX;
  const serie: SerieFlux = { lnOpen: Float64Array.from(candles, (c) => Math.log(c.open)), a, b };
  const evalues = evenements.filter((e) => e.idx >= a && e.idx <= b);
  controlerStatistique(id, candles, serie, evalues, H_PRINCIPAL);
  const tendance = ema(closeOf(candles), Number(P.emaTendance));
  const enrichi = evalues.map((e): EvenementFlux => {
    const t = tendance[e.idx];
    return { idx: e.idx, sens: e.sens, tendance: t === undefined ? 0 : signe(candles[e.idx]!.close - t), annee: new Date(candles[e.idx]!.time).getUTCFullYear() };
  });
  const achats = enrichi.filter((e) => e.sens > 0);
  const ventes = enrichi.filter((e) => e.sens < 0);
  const moyenne = (ev: EvenementFlux[]): number | null => (ev.length === 0 ? null : (ev.reduce((s, e) => s + rendement(serie, e.idx, e.sens, H_PRINCIPAL), 0) / ev.length) * 1e4);
  return {
    serie,
    achats,
    ventes,
    resultat: {
      decisions: b - a + 1,
      premiereDecisionUtc: iso(candles[a]!.time),
      derniereDecisionUtc: iso(candles[b]!.time),
      achats: achats.length,
      ventes: ventes.length,
      moyenneAchats12Bps: moyenne(achats),
      hitsAchats12Pct: achats.length === 0 ? null : (achats.filter((e) => rendement(serie, e.idx, 1, H_PRINCIPAL) > 0).length / achats.length) * 100,
      moyenneVentes12Bps: moyenne(ventes),
    },
  };
}

/** Mesures d'une cellule disponible. Toute exception ici est un défaut du calcul : elle arrête la campagne. */
function mesurerCellule(symbol: string, u: Unite, candles: Candle[], acq: Acquisition): CelluleMesuree | { id: string; erreur: string } {
  const id = `${symbol} ${u.tf}`;
  const n = candles.length;
  // Bornes exactes : au moins un fill évalué (signaux) et une décision évaluée (forts achats).
  if (n < WS + 2 || n < WF + H_MAX + 1) return { id, erreur: `${n} bougies : warmup ${WS} ou ${WF} + horizon ${H_MAX} impossible` };
  const pos = positionDe(candles);
  const { evenements, brute, signaux } = evenementsDe(candles);
  controlerPosition(id, candles, pos, brute);
  controlerMarqueurs(id, candles, pos, signaux, evenements);
  controlerCausalite(id, candles, pos, evenements);
  const s = mesurerSignaux(id, u, candles, pos);
  const f = mesurerFlux(id, candles, evenements);
  return {
    id, symbol, acquisition: acq,
    signaux: s.resultat, flux: f.resultat,
    serieTiming: s.serie, serieEma: s.serieEma, serieFlux: f.serie, achats: f.achats, ventes: f.ventes,
  };
}

// ─────────────────────────── Regroupement par unité ───────────────────────────

interface Agregat { trades: number; fermes: number; finDonnees: number; sommePnl: number; sommePnlPct: number; gagnants: number; expectancyNette: number | null; expectancyPct: number | null; winRatePct: number | null }
interface AgregatRejeu { trades: number; expectancyPct: number | null; winRatePct: number | null }
interface RegroupeSignaux {
  cellules: number;
  executions: Record<string, Agregat>;
  cellulesAvecTrade: number;
  cellulesPnlPositif: number;
  rejeu: { fenetre: AgregatRejeu; m1: AgregatRejeu; m2: AgregatRejeu };
  expositionMoyenne: number;
  achatConservationMedianPct: number;
  timing: ResultatTiming;
  ema: { executions: Record<string, Agregat>; cellulesEmaAuMoinsAussiBien: number; timing: ResultatTiming | null };
}

function agreger(ms: MetriquesCout[]): Agregat {
  const t = ms.reduce((s, m) => s + m.trades, 0);
  const somme = (f: (m: MetriquesCout) => number): number => ms.reduce((s, m) => s + f(m), 0);
  return {
    trades: t, fermes: somme((m) => m.fermes), finDonnees: somme((m) => m.finDonnees),
    sommePnl: somme((m) => m.sommePnl), sommePnlPct: somme((m) => m.sommePnlPct), gagnants: somme((m) => m.gagnants),
    expectancyNette: t === 0 ? null : somme((m) => m.sommePnl) / t,
    expectancyPct: t === 0 ? null : somme((m) => m.sommePnlPct) / t,
    winRatePct: t === 0 ? null : (somme((m) => m.gagnants) / t) * 100,
  };
}
const agregerRejeu = (rs: ResumeRejeu[]): AgregatRejeu => {
  const t = rs.reduce((s, r) => s + r.trades, 0);
  return { trades: t, expectancyPct: t === 0 ? null : rs.reduce((s, r) => s + r.sommePct, 0) / t, winRatePct: t === 0 ? null : (rs.reduce((s, r) => s + r.gagnants, 0) / t) * 100 };
};

function regrouperSignaux(cellules: CelluleMesuree[]): RegroupeSignaux {
  const ids = [...COUTS.map((c) => c.id)];
  const executions = Object.fromEntries(ids.map((id) => [id, agreger(cellules.map((c) => c.signaux.executions[id]!))]));
  const avecTrade = cellules.filter((c) => c.signaux.executions[X1.id]!.trades > 0);
  const series = cellules.map((c) => c.serieTiming);
  const L = Math.min(...series.map((s) => s.L));
  const seriesEma = cellules.flatMap((c) => (c.serieEma === null ? [] : [c.serieEma]));
  return {
    cellules: cellules.length,
    executions,
    cellulesAvecTrade: avecTrade.length,
    cellulesPnlPositif: avecTrade.filter((c) => c.signaux.executions[X1.id]!.sommePnl > 0).length,
    rejeu: {
      fenetre: agregerRejeu(cellules.map((c) => c.signaux.rejeu.fenetre)),
      m1: agregerRejeu(cellules.map((c) => c.signaux.rejeu.m1)),
      m2: agregerRejeu(cellules.map((c) => c.signaux.rejeu.m2)),
    },
    expositionMoyenne: cellules.reduce((s, c) => s + c.signaux.exposition, 0) / cellules.length,
    achatConservationMedianPct: quantile(cellules.map((c) => c.signaux.achatConservationPct), 0.5),
    timing: testTiming(series, L),
    ema: {
      executions: Object.fromEntries([X1.id, X3.id].map((id) => [id, agreger(cellules.map((c) => c.signaux.ema.executions[id]!))])),
      cellulesEmaAuMoinsAussiBien: cellules.filter((c) => c.signaux.ema.executions[X1.id]!.sommePnl >= c.signaux.executions[X1.id]!.sommePnl).length,
      timing: seriesEma.length === cellules.length ? testTiming(seriesEma, L) : null,
    },
  };
}

interface StatHorizon { h: number; achats: Stat; ventes: Stat }
interface RegroupeFlux {
  cellules: number;
  horizons: StatHorizon[];
  cellulesAvecAchat: number;
  cellulesMoyennePositive: number;
  permutationSens: StatPermutation;
  tendance: { achatsAuDessus: Stat; achatsSous: Stat };
  parAn: Array<{ annee: number; achats: number; ventes: number; moyenneAchats12Bps: number | null }>;
}

function regrouperFlux(cellules: CelluleMesuree[]): RegroupeFlux {
  const jeux = (f: (c: CelluleMesuree) => EvenementFlux[]): JeuFlux[] => cellules.map((c) => ({ serie: c.serieFlux, evenements: f(c) }));
  const horizons = HORIZONS.map((h) => ({
    h,
    achats: statistique(jeux((c) => c.achats), h, h === H_PRINCIPAL),
    ventes: statistique(jeux((c) => c.ventes), h, h === H_PRINCIPAL),
  }));
  const avecAchat = cellules.filter((c) => c.achats.length > 0);
  const annees = new Map<number, { achats: number; ventes: number; somme: number }>();
  for (const c of cellules) {
    for (const e of [...c.achats, ...c.ventes]) {
      const g = annees.get(e.annee) ?? { achats: 0, ventes: 0, somme: 0 };
      if (e.sens > 0) {
        g.achats++;
        g.somme += rendement(c.serieFlux, e.idx, 1, H_PRINCIPAL);
      } else {
        g.ventes++;
      }
      annees.set(e.annee, g);
    }
  }
  return {
    cellules: cellules.length,
    horizons,
    cellulesAvecAchat: avecAchat.length,
    cellulesMoyennePositive: avecAchat.filter((c) => (c.flux.moyenneAchats12Bps ?? 0) > 0).length,
    permutationSens: permutationSens(cellules.map((c) => ({ serie: c.serieFlux, achats: c.achats, ventes: c.ventes })), H_PRINCIPAL),
    tendance: {
      achatsAuDessus: statistique(jeux((c) => c.achats.filter((e) => e.tendance > 0)), H_PRINCIPAL, false),
      achatsSous: statistique(jeux((c) => c.achats.filter((e) => e.tendance < 0)), H_PRINCIPAL, false),
    },
    parAn: [...annees].sort((x, y) => x[0] - y[0]).map(([annee, g]) => ({ annee, achats: g.achats, ventes: g.ventes, moyenneAchats12Bps: g.achats === 0 ? null : (g.somme / g.achats) * 1e4 })),
  };
}

// ─────────────────────────── Verdicts pré-déclarés ───────────────────────────

type Verdict = "FAVORABLE" | "DEFAVORABLE" | "NON_CONCLUANT";
type StatutBloc = "tenu" | "echec" | "insuffisant";
interface Bloc { critere: string; cle: string; statut: StatutBloc; detail: string }
interface Jugement { verdict: Verdict; raison: "cellules" | "trades" | "evenements" | "moitie" | "fenetre" | null; blocs: Bloc[] }

const fmt = (v: number | null | undefined, dec = 2): string =>
  v === null || v === undefined ? "—" : !Number.isFinite(v) ? (v > 0 ? "∞" : "—") : v.toFixed(dec);
/**
 * p à 4 décimales arrondie vers le haut (jamais plus favorable que la mesure) : « = x », ou
 * « ≤ x » au plancher 1 / (décalages + 1), quand aucun décalage n'atteint l'observée.
 */
const fmtP = (p: number | null, nDecalages: number): string =>
  p === null ? "—" : `${p <= 1 / (nDecalages + 1) + 1e-12 ? "≤" : "="} ${(Math.ceil(p * 1e4 - 1e-9) / 1e4).toFixed(4)}`;
/** Plancher de p d'un test à n décalages, arrondi vers le bas : « p ≥ x » reste vrai. */
const fmtPMin = (nDecalages: number): string => (Math.floor(1e4 / (nDecalages + 1) + 1e-9) / 1e4).toFixed(4);
const decrireNul = (x: { nDecalages: number; exhaustif: boolean | null }): string =>
  `${x.nDecalages} décalages${x.exhaustif === true ? ", tous" : x.exhaustif === false ? " tirés" : ""}`;
/** Le test ne peut pas atteindre le seuil : plancher 1 / (décalages + 1) au-dessus de pMax. */
const resolutionInsuffisante = (nDecalages: number): boolean => 1 / (nDecalages + 1) > P_MAX;
const minDisponibles = (total: number): number => Math.ceil(MIN_PART_DISPO * total - 1e-9);

function jugerSignaux(nDispo: number, nTotal: number, r: RegroupeSignaux | null): Jugement {
  if (r === null || nDispo < minDisponibles(nTotal)) {
    return { verdict: "NON_CONCLUANT", raison: "cellules", blocs: [{ critere: "—", cle: "cellules", statut: "insuffisant", detail: `${nDispo} cellules disponibles sur ${nTotal} (minimum ${minDisponibles(nTotal)})` }] };
  }
  const x1 = r.executions[X1.id]!;
  if (x1.fermes < MIN_TRADES) {
    return { verdict: "NON_CONCLUANT", raison: "trades", blocs: [{ critere: "—", cle: "trades", statut: "insuffisant", detail: `${x1.fermes} trades clos par règle regroupés (minimum ${MIN_TRADES})` }] };
  }
  const blocs: Bloc[] = [];
  for (const cout of [X1, X3]) {
    const m = r.executions[cout.id]!;
    blocs.push({
      critere: "S1", cle: cout.id, statut: (m.expectancyNette ?? 0) > 0 ? "tenu" : "echec",
      detail: `${m.trades} trades (dont ${m.fermes} clos par règle), expectancy nette ${fmt(m.expectancyNette, 3)} USDT (${fmt(m.expectancyPct, 3)} %)`,
    });
  }
  blocs.push({
    critere: "S2", cle: "timing",
    statut: resolutionInsuffisante(r.timing.nDecalages) ? "insuffisant" : r.timing.p <= P_MAX ? "tenu" : "echec",
    detail:
      `p ${fmtP(r.timing.p, r.timing.nDecalages)} (seuil ${P_MAX} ; ${decrireNul(r.timing)}, plancher ${fmtPMin(r.timing.nDecalages)}) ; ` +
      `capté ${fmt(r.timing.capteLog * 100, 1)} % log contre médiane nulle ${fmt(r.timing.medianeNulle * 100, 1)} %`,
  });
  blocs.push({
    critere: "S3", cle: "étendue", statut: 2 * r.cellulesPnlPositif > r.cellulesAvecTrade ? "tenu" : "echec",
    detail: `PnL net x1 > 0 dans ${r.cellulesPnlPositif} cellule(s) sur ${r.cellulesAvecTrade} ayant au moins un trade`,
  });
  for (const [cle, s] of [["M1", r.rejeu.m1], ["M2", r.rejeu.m2]] as const) {
    blocs.push({
      critere: "S4", cle, statut: s.trades === 0 ? "insuffisant" : (s.expectancyPct ?? 0) > 0 ? "tenu" : "echec",
      detail: `${s.trades} trades clos, expectancy ${fmt(s.expectancyPct, 3)} % hors frais`,
    });
  }
  if (blocs.some((b) => b.statut === "echec")) return { verdict: "DEFAVORABLE", raison: null, blocs };
  if (blocs.some((b) => b.critere === "S2" && b.statut === "insuffisant")) return { verdict: "NON_CONCLUANT", raison: "fenetre", blocs };
  if (blocs.some((b) => b.statut === "insuffisant")) return { verdict: "NON_CONCLUANT", raison: "moitie", blocs };
  return { verdict: "FAVORABLE", raison: null, blocs };
}

function jugerFlux(nDispo: number, nTotal: number, r: RegroupeFlux | null): Jugement {
  if (r === null || nDispo < minDisponibles(nTotal)) {
    return { verdict: "NON_CONCLUANT", raison: "cellules", blocs: [{ critere: "—", cle: "cellules", statut: "insuffisant", detail: `${nDispo} cellules disponibles sur ${nTotal} (minimum ${minDisponibles(nTotal)})` }] };
  }
  const s = r.horizons.find((x) => x.h === H_PRINCIPAL)!.achats;
  if (s.n < MIN_ACHATS) {
    return { verdict: "NON_CONCLUANT", raison: "evenements", blocs: [{ critere: "—", cle: "forts achats", statut: "insuffisant", detail: `${s.n} forts achats évalués regroupés (minimum ${MIN_ACHATS})` }] };
  }
  const blocs: Bloc[] = [
    {
      critere: "F1", cle: "regroupé",
      statut: resolutionInsuffisante(s.nDecalages) ? "insuffisant" : (s.pUni ?? 1) <= P_MAX ? "tenu" : "echec",
      detail:
        `${s.n} forts achats, ${fmt(s.moyenneBps, 1)} bps en moyenne à ${H_PRINCIPAL} bougies (${fmt(s.hitsPct, 1)} % de hausses), ` +
        `p unilatérale ${fmtP(s.pUni, s.nDecalages)} (seuil ${P_MAX} ; ${decrireNul(s)}, plancher ${fmtPMin(s.nDecalages)}) ; médiane nulle ${fmt(s.medianeNulleBps, 1)} bps`,
    },
    {
      critere: "F2", cle: "cellules", statut: 2 * r.cellulesMoyennePositive > r.cellulesAvecAchat ? "tenu" : "echec",
      detail: `moyenne > 0 dans ${r.cellulesMoyennePositive} cellule(s) sur ${r.cellulesAvecAchat} ayant au moins un fort achat`,
    },
    {
      critere: "F3", cle: "économie", statut: s.moyenneBps > COUT_AR_PCT * 100 ? "tenu" : "echec",
      detail: `moyenne regroupée ${fmt(s.moyenneBps, 1)} bps contre un coût aller-retour de ${fmt(COUT_AR_PCT * 100, 0)} bps`,
    },
  ];
  if (blocs.some((b) => b.statut === "echec")) return { verdict: "DEFAVORABLE", raison: null, blocs };
  if (blocs.some((b) => b.statut === "insuffisant")) return { verdict: "NON_CONCLUANT", raison: "fenetre", blocs };
  return { verdict: "FAVORABLE", raison: null, blocs };
}

// ─────────────────────────── Formulations pré-déclarées ───────────────────────────

interface Formulations { signaux: string; fortAchat: string; forteVente: string; qualification: string }

/** Pourcentage signé à `dec` décimales ; un arrondi nul s'écrit sans signe (ni « +0.00 » ni « -0.00 »). */
const signePct = (v: number, dec = 2): string => {
  const texte = v.toFixed(dec);
  return Number(texte) === 0 ? (0).toFixed(dec) : `${v > 0 ? "+" : ""}${texte}`;
};
const tradesClos = (n: number): string => `${n} trade${n > 1 ? "s" : ""} clos`;
const remplir = (gabarit: string, valeurs: Record<string, string>): string =>
  Object.entries(valeurs).reduce((texte, [cle, valeur]) => texte.split(`{${cle}}`).join(valeur), gabarit);

function formulations(u: Unite, nDispo: number, js: Jugement, rs: RegroupeSignaux | null, jf: Jugement, rf: RegroupeFlux | null): Formulations {
  const S = M.suites.signaux;
  const F = M.suites.fortsAchats;
  const commun = { u: u.tf, nAlts: String(nDispo), periode: u.libelle };

  let signaux: string;
  if (js.verdict === "NON_CONCLUANT" || rs === null) {
    const raison =
      js.raison === "trades" && rs !== null
        ? remplir(S.raisons.trades, { nTradesClos: tradesClos(rs.executions[X1.id]!.fermes) })
        : js.raison === "fenetre" && rs !== null
          ? remplir(S.raisons.fenetre, { pMin: fmtPMin(rs.timing.nDecalages) })
          : js.raison === "moitie"
            ? S.raisons.moitie
            : remplir(S.raisons.cellules, { k: String(nDispo) });
    signaux = remplir(S.nonConcluant, { ...commun, raison });
  } else {
    const valeurs = { ...commun, expX1: signePct(rs.executions[X1.id]!.expectancyPct ?? 0), p: fmtP(rs.timing.p, rs.timing.nDecalages) };
    if (js.verdict === "FAVORABLE") {
      const n = rs.ema.cellulesEmaAuMoinsAussiBien;
      signaux = n === 0 ? remplir(S.favorableEmaDominee, valeurs) : remplir(S.favorableEmaAuMoinsAussiBien, { ...valeurs, n: String(n), total: String(rs.cellules) });
    } else {
      const echoue = (c: string): boolean => js.blocs.some((b) => b.critere === c && b.statut === "echec");
      const echecs = [
        echoue("S1") ? S.echecs.S1 : null,
        echoue("S2") ? S.echecs.S2 : null,
        echoue("S3") ? remplir(S.echecs.S3, { k: String(rs.cellulesPnlPositif), m: String(rs.cellulesAvecTrade) }) : null,
        echoue("S4") ? S.echecs.S4 : null,
      ].filter((x): x is string => x !== null);
      signaux = remplir(S.defavorable, { ...valeurs, echecs: echecs.join(", ") });
    }
  }

  let fortAchat: string;
  let forteVente: string;
  if (jf.verdict === "NON_CONCLUANT" || rf === null) {
    const a = rf?.horizons.find((x) => x.h === H_PRINCIPAL)?.achats ?? null;
    const raison =
      jf.raison === "evenements"
        ? remplir(F.raisons.evenements, { n: String(a?.n ?? 0) })
        : jf.raison === "fenetre" && a !== null
          ? remplir(F.raisons.fenetre, { pMin: fmtPMin(a.nDecalages) })
          : remplir(F.raisons.cellules, { k: String(nDispo) });
    fortAchat = remplir(F.nonConcluant, { ...commun, raison });
    forteVente = fortAchat;
  } else {
    const principal = rf.horizons.find((x) => x.h === H_PRINCIPAL)!;
    const a = principal.achats;
    if (jf.verdict === "FAVORABLE") {
      fortAchat = remplir(F.favorable, { ...commun, moyennePct: signePct(a.moyenneBps / 100), hitsPct: fmt(a.hitsPct, 0), p: fmtP(a.pUni, a.nDecalages) });
      const v = principal.ventes;
      forteVente =
        v.n > 0 && v.pBi !== null && v.pBi <= P_MAX && Math.abs(v.moyenneBps) > COUT_AR_PCT * 100
          ? remplir(F.forteVenteSignificatif, {
              ...commun,
              "continué de baisser|rebondi": v.moyenneBps > 0 ? "continué de baisser" : "rebondi",
              moyennePct: (Math.abs(v.moyenneBps) / 100).toFixed(2),
              p: fmtP(v.pBi, v.nDecalages),
            })
          : remplir(F.forteVenteNonSignificatif, commun);
    } else {
      const echoue = (c: string): boolean => jf.blocs.some((b) => b.critere === c && b.statut === "echec");
      // Ordre F1, F3, F2 : quand F1 échoue, sa phrase donne déjà la moyenne, F3 ne la répète pas.
      const echecs = [
        echoue("F1") ? remplir(F.echecs.F1, { moyennePct: signePct(a.moyenneBps / 100), hitsPct: fmt(a.hitsPct, 0), pBi: fmtP(a.pBi, a.nDecalages) }) : null,
        echoue("F3") ? remplir(echoue("F1") ? F.echecs.F3ApresF1 : F.echecs.F3, { moyennePct: signePct(a.moyenneBps / 100), coutPct: COUT_AR_PCT.toFixed(2) }) : null,
        echoue("F2") ? remplir(F.echecs.F2, { k: String(rf.cellulesMoyennePositive), m: String(rf.cellulesAvecAchat) }) : null,
      ].filter((x): x is string => x !== null);
      fortAchat = remplir(F.defavorable, { ...commun, echecs: echecs.join(", ") });
      forteVente = fortAchat;
    }
  }
  return { signaux, fortAchat, forteVente, qualification: remplir(M.suites.qualificationHors4h, { u: u.tf }) };
}

/** Formulations fixes des unités non mesurables (pré-déclarées, sans données). */
const formulationsNonMesurables = (): Record<string, Formulations> =>
  Object.fromEntries(
    Object.keys(M.unites.nonMesurables).map((tf) => {
      const fa = remplir(M.suites.fortsAchats.nonMesurable, { u: tf });
      return [tf, { signaux: remplir(M.suites.signaux.nonMesurable, { u: tf }), fortAchat: fa, forteVente: fa, qualification: remplir(M.suites.qualificationHors4h, { u: tf }) }];
    })
  );

// ─────────────────────────── Rapport ───────────────────────────

interface ResultatUnite {
  unite: Unite;
  cellules: Array<{ id: string; statut: "disponible" | "indisponible"; erreur?: string; acquisition?: Acquisition; signaux?: SignauxCellule; flux?: FluxCellule }>;
  nDispo: number;
  signaux: { regroupe: RegroupeSignaux | null; jugement: Jugement };
  fortsAchats: { regroupe: RegroupeFlux | null; jugement: Jugement };
  formulations: Formulations;
}

const ligne = (cells: Array<string | number>): string => `| ${cells.join(" | ")} |`;
const tableau = (entetes: string[], lignes: Array<Array<string | number>>): string =>
  [ligne(entetes), `|${entetes.map(() => "---").join("|")}|`, ...lignes.map(ligne)].join("\n");
const jour = (texte: string): string => texte.slice(0, 16).replace("T", " ");
const LIBELLE_VERDICT = { FAVORABLE: "FAVORABLE", DEFAVORABLE: "DÉFAVORABLE", NON_CONCLUANT: "NON CONCLUANT" } as const;
const LIBELLE_BLOC = { tenu: "✅ tenu", echec: "❌ échec", insuffisant: "⚠️ insuffisant" } as const;
const celluleStat = (s: Stat): string => (s.n === 0 ? "0 / — / — / —" : `${s.n} / ${fmt(s.moyenneBps, 1)} / ${fmt(s.hitsPct, 0)} / ${fmt(s.t, 1)}`);

function sectionUnite(r: ResultatUnite): string {
  const p: string[] = [];
  const u = r.unite;
  const indispo = r.cellules.filter((c) => c.statut === "indisponible");
  p.push(`## ${u.tf} — ${u.libelle}`);
  p.push(
    `Fenêtre \`${iso(u.debut)}\` → \`${iso(u.fin)}\` exclu ; ${r.nDispo} cellule(s) disponible(s) sur ${r.cellules.length}` +
      (indispo.length > 0 ? ` ; indisponibles : ${indispo.map((c) => `${c.id} (${c.erreur})`).join(" ; ")}` : "") + "."
  );
  p.push(`**Signaux : ${LIBELLE_VERDICT[r.signaux.jugement.verdict]}** — **Forts achats : ${LIBELLE_VERDICT[r.fortsAchats.jugement.verdict]}**`);
  p.push(tableau(["Famille", "Critère", "Bloc", "Statut", "Détail"], [
    ...r.signaux.jugement.blocs.map((b) => ["Signaux", b.critere, b.cle, LIBELLE_BLOC[b.statut], b.detail]),
    ...r.fortsAchats.jugement.blocs.map((b) => ["Forts achats", b.critere, b.cle, LIBELLE_BLOC[b.statut], b.detail]),
  ]));

  const rs = r.signaux.regroupe;
  if (rs !== null) {
    const ligneCout = (id: string, a: Agregat): Array<string | number> => [
      id, `${a.trades} (${a.fermes})`, fmt(a.expectancyNette, 3), fmt(a.expectancyPct, 3), fmt(a.sommePnl, 0), fmt(a.winRatePct, 1),
    ];
    p.push("### Signaux — regroupé");
    p.push(tableau(["Exécution", "Trades (clos)", "Exp. nette USDT", "Exp. nette %", "PnL total USDT", "Gagnants %"], [
      ...COUTS.map((c) => ligneCout(`AXIS ${c.id}`, rs.executions[c.id]!)),
      ...[X1, X3].map((c) => ligneCout(`EMA ${MS.emaReference} ${c.id}`, rs.ema.executions[c.id]!)),
    ]));
    p.push(tableau(["Statistique", "Valeur"], [
      ["Rejeu hors frais : fenêtre / M1 / M2 (trades, exp. %)", [rs.rejeu.fenetre, rs.rejeu.m1, rs.rejeu.m2].map((x) => `${x.trades}, ${fmt(x.expectancyPct, 3)}`).join(" / ")],
      ["Timing : capté / médiane nulle / 95e centile (% log)", `${fmt(rs.timing.capteLog * 100, 1)} / ${fmt(rs.timing.medianeNulle * 100, 1)} / ${fmt(rs.timing.q95Nulle * 100, 1)}`],
      ["Timing : p unilatérale (plus courte fenêtre)", `${fmtP(rs.timing.p, rs.timing.nDecalages)} (${rs.timing.L} décisions, ${decrireNul(rs.timing)})`],
      [`Timing de l'EMA ${MS.emaReference} seule (mêmes décalages)`, rs.ema.timing === null ? "non calculé" : `p ${fmtP(rs.ema.timing.p, rs.ema.timing.nDecalages)}, capté ${fmt(rs.ema.timing.capteLog * 100, 1)} %`],
      ["Cellules à PnL net x1 > 0 / ayant un trade", `${rs.cellulesPnlPositif} / ${rs.cellulesAvecTrade}`],
      [`Cellules où l'EMA ${MS.emaReference} seule fait au moins aussi bien (PnL x1)`, `${rs.ema.cellulesEmaAuMoinsAussiBien} / ${rs.cellules}`],
      ["Exposition moyenne / achat-conservation médian", `${fmt(rs.expositionMoyenne * 100, 1)} % / ${fmt(rs.achatConservationMedianPct, 1)} %`],
    ]));
  }
  const rf = r.fortsAchats.regroupe;
  if (rf !== null) {
    const principal = rf.horizons.find((x) => x.h === H_PRINCIPAL)!;
    p.push(`### Forts achats — regroupé (cellule = N / moyenne bps / % de continuation / t naïf)`);
    p.push(tableau(["Événements", ...HORIZONS.map((h) => `h = ${h}`)], [
      ["Forts achats", ...rf.horizons.map((x) => celluleStat(x.achats))],
      ["Fortes ventes", ...rf.horizons.map((x) => celluleStat(x.ventes))],
    ]));
    const q = rf.permutationSens;
    p.push(tableau(["Statistique (horizon 12)", "Valeur"], [
      [
        "Forts achats : p unilatérale / bilatérale",
        `${fmtP(principal.achats.pUni, principal.achats.nDecalages)} / ${fmtP(principal.achats.pBi, principal.achats.nDecalages)} (${principal.achats.L} décisions, ${decrireNul(principal.achats)})`,
      ],
      ["Forts achats : médiane / médiane nulle / 95e centile nul (bps)", `${fmt(principal.achats.medianeBps, 0)} / ${fmt(principal.achats.medianeNulleBps, 0)} / ${fmt(principal.achats.q95NulleBps, 0)}`],
      [`Forts achats nets de ${COUT_AR_PCT} % aller-retour (bps)`, fmt(principal.achats.moyenneBps - COUT_AR_PCT * 100, 0)],
      ["Fortes ventes : p bilatérale", fmtP(principal.ventes.pBi, principal.ventes.nDecalages)],
      ["Cellules à moyenne > 0 / ayant un fort achat", `${rf.cellulesMoyennePositive} / ${rf.cellulesAvecAchat}`],
      ["Permutation des sens : tous / achats / médiane nulle (bps), p", `${fmt(q.moyenneTousBps, 0)} / ${fmt(q.moyenneAchatsBps, 0)} / ${fmt(q.medianeNulleBps, 0)}, ${fmtP(q.pUni, MF.permutationSens.tirages)}`],
      [`Au-dessus / sous l'EMA ${P.emaTendance}`, `${celluleStat(rf.tendance.achatsAuDessus)} ; ${celluleStat(rf.tendance.achatsSous)}`],
      ["Par année (achats / ventes ; moyenne achats bps)", rf.parAn.map((x) => `${x.annee} : ${x.achats} / ${x.ventes} ; ${fmt(x.moyenneAchats12Bps, 0)}`).join(" · ")],
    ]));
  }
  const dispo = r.cellules.filter((c) => c.statut === "disponible" && c.signaux !== undefined && c.flux !== undefined);
  if (dispo.length > 0) {
    p.push(
      `<details><summary>Détail par cellule (${dispo.length})</summary>\n\n` +
        tableau(
          ["Cellule", "Bougies (manquantes)", "Trades x1", "PnL x1 USDT", "Exp. nette x1 %", "Exposition %", "p timing", "Forts achats / ventes", "Moy. achats 12 (bps)"],
          dispo.map((c) => {
            const x = c.signaux!.executions[X1.id]!;
            return [
              c.id, `${c.acquisition!.nombre} (${c.acquisition!.manquantes})`, x.trades, fmt(x.sommePnl, 0), x.trades === 0 ? "—" : fmt(x.sommePnlPct / x.trades, 2),
              fmt(c.signaux!.exposition * 100, 1), fmtP(c.signaux!.timing.p, c.signaux!.timing.nDecalages), `${c.flux!.achats} / ${c.flux!.ventes}`, fmt(c.flux!.moyenneAchats12Bps, 1),
            ];
          })
        ) +
        "\n\n</details>"
    );
  }
  return p.join("\n\n");
}

interface EmpreinteCode {
  runnerSha256: string;
  observeSha256: Record<string, string>;
  arbre: { dossiers: string[]; fichiers: number; sha256: string };
  commitFigeage: string;
  cheminsFigesCommites: boolean;
  identiqueAuFigeage: boolean;
}

function rapport(resultats: ResultatUnite[], nonMesurables: Record<string, Formulations>, code: EmpreinteCode): string {
  const p: string[] = [];
  p.push(ESSAI ? "# AXIS — autres unités : RÉPÉTITION TECHNIQUE sur symboles déjà vus (sans valeur probante)" : "# AXIS — autres unités de temps : test sur données jamais vues, 8 octobre 2026");
  p.push(
    `Généré par \`scripts/valider-axis-ut.ts\`${ESSAI ? " --essai" : ""}. Manifeste figé \`${HASH_MANIFESTE}\` ` +
      "(`scripts/axis/manifeste-ut-2026-10-08.json`, figé avant tout téléchargement de ces données). " +
      "**Toutes les valeurs sont des mesures PASSÉES, jamais une promesse de performance.**"
  );
  if (avertissements.length > 0) p.push(`**Avertissements (répétition)** :\n${avertissements.map((x) => `- ${x}`).join("\n")}`);
  p.push("## Verdicts pré-déclarés par unité");
  p.push(
    tableau(
      ["Unité", "Fenêtre", "Cellules", "Signaux", "Trades x1 (clos)", "Exp. nette x1 %", "p timing", "Forts achats", "N", "Moyenne 12 (bps)", "p"],
      resultats.map((r) => {
        const rs = r.signaux.regroupe;
        const fa = r.fortsAchats.regroupe?.horizons.find((x) => x.h === H_PRINCIPAL)?.achats ?? null;
        return [
          r.unite.tf, r.unite.libelle, `${r.nDispo}/${r.cellules.length}`, LIBELLE_VERDICT[r.signaux.jugement.verdict],
          rs === null ? "—" : `${rs.executions[X1.id]!.trades} (${rs.executions[X1.id]!.fermes})`, rs === null ? "—" : fmt(rs.executions[X1.id]!.expectancyPct, 3),
          rs === null ? "—" : fmtP(rs.timing.p, rs.timing.nDecalages), LIBELLE_VERDICT[r.fortsAchats.jugement.verdict],
          fa === null ? "—" : fa.n, fa === null ? "—" : fmt(fa.moyenneBps, 1), fa === null ? "—" : fmtP(fa.pUni, fa.nDecalages),
        ];
      })
    )
  );
  p.push(
    [
      `- **Signaux** (regroupés sur les cellules disponibles de l'unité) — S1 : expectancy nette > 0 aux coûts x1 ET x3 ; S2 : timing, p ≤ ${P_MAX} ; S3 : PnL net x1 > 0 dans plus de la moitié des cellules ayant un trade ; S4 : rejeu hors frais, expectancy > 0 dans chaque moitié. Au moins ${MIN_TRADES} trades clos regroupés.`,
      `- **Forts achats** — F1 : rendement signé à ${H_PRINCIPAL} bougies, p unilatérale ≤ ${P_MAX} ; F2 : moyenne > 0 dans plus de la moitié des cellules ayant un fort achat ; F3 : moyenne regroupée > coût aller-retour x1 (${COUT_AR_PCT} %). Au moins ${MIN_ACHATS} forts achats regroupés.`,
      `- Au moins ${Math.round(MIN_PART_DISPO * 100)} % des cellules de l'unité disponibles, sinon NON CONCLUANT. Seuil ${P_MAX} = 0,05 / 13 (Bonferroni sur les treize unités de chaque famille). Si la fenêtre ne permet pas d'atteindre ce seuil (plancher 1 / (décalages + 1) > ${P_MAX}), S2 ou F1 est insuffisant : NON CONCLUANT, sauf autre bloc en échec.`,
      `- Non mesurables par construction : ${Object.keys(nonMesurables).join(", ")} (historique trop court) ; 4h : tests du 7 et du 8 octobre, inchangés.`,
    ].join("\n")
  );

  p.push("## Protocole");
  p.push(
    [
      `- **Signaux** : AXIS v2 aux défauts livrés (achat à score ≥ +${P.seuil}/6 avec close au-dessus de l'EMA ${P.emaTendance}, vente à score ≤ −${P.seuilVente}/6). Long pendant un achat affiché, à plat sinon. ${WS} bougies de warmup ; \`runBacktest\`, décision à la clôture, fill à l'open suivant, taille fixe ${TAILLE} USDT ; coûts par côté ${COUTS.map((c) => `${c.id} = ${c.frais} % + ${c.slippage} %`).join(" ; ")}. Timing : décalages circulaires de la position, un même k pour toutes les cellules de l'unité, k dans [⌊${TS.fractionMin} L⌋, ⌈${TS.fractionMax} L⌉[ (L = plus courte fenêtre) : tous quand il y en a au plus ${TS.tirages} (p exacte), ${TS.tirages} tirés sinon (graine ${TS.graine}).`,
      `- **Forts achats** : marqueurs « fort achat » d'AXIS (volume ≥ ${P.seuilGros} × la SMA ${P.rvolPeriode}, sens du delta taker sinon du corps, hors bougies de signal et hors dernière bougie). ${WF} bougies de warmup ; décisions jusqu'à n − 2 − ${H_MAX} ; rendement signé sens × ln(open[i+1+h] / open[i+1]). Nul : décalages circulaires communs, mêmes règles (au plus ${TF.tirages}, graine ${TF.graine}) ; nul complémentaire descriptif : ${MF.permutationSens.tirages} permutations des sens (graine ${MF.permutationSens.graine}). p arrondies vers le haut.`,
      `- **Données** : klines Binance Spot (\`${ENDPOINT}\`) avec volume taker, ${ESSAI ? "symboles déjà vus" : "42 alts jamais vues (toutes les paires USDT cotées avant 2020, hors actifs déjà vus et stablecoins)"} ; bougies à volume nul valides (émises sans transaction) ; au plus 1 % de bougies manquantes par cellule.`,
      `- **Code** : vérifié avant le premier téléchargement — ${code.arbre.fichiers} fichiers hors tests de ${code.arbre.dossiers.join(", ")} (SHA-256 \`${code.arbre.sha256}\`), ` +
        `chemins figés ${code.cheminsFigesCommites ? "identiques au" : "DIFFÉRENTS du"} commit \`${code.commitFigeage}\`. SHA-256 du runner : \`${code.runnerSha256}\`.`,
      "- **Contrôles bloquants passés** (sinon : arrêt sans verdict, ce rapport n'existerait pas) : position = recalcul direct ; signaux (120 derniers) et forts mouvements (60 derniers) = marqueurs du chart ; causalité sur trois préfixes ; chronologie moteur = rejeu, coûts sans effet sur les fills, timing = moteur sans coût ; horizon et statistique des forts achats.",
    ].join("\n")
  );
  for (const r of resultats) p.push(sectionUnite(r));

  p.push("## Formulations pré-déclarées des infobulles, par unité");
  p.push(
    tableau(
      ["Unité", "Signaux ▲/▼", "Fort achat", "Forte vente", "Qualification"],
      [
        ...resultats.map((r) => [r.unite.tf, r.formulations.signaux, r.formulations.fortAchat, r.formulations.forteVente, r.formulations.qualification]),
        ...Object.entries(nonMesurables).map(([tf, f]) => [tf, f.signaux, f.fortAchat, f.forteVente, f.qualification]),
      ]
    )
  );
  p.push("Garde inchangée : les formulations des forts mouvements ne s'affichent que sur une bougie dont le delta taker est disponible ; sinon « couche flux non mesurée ». 4h et unité absente : formulations des tests précédents.");

  p.push("## Limites");
  p.push(
    [
      "- 42 alts crypto spot Binance, un même facteur de marché ; ni BTC/ETH (déjà vus), ni autres marchés (forex, actions, sources sans volume taker).",
      "- Petites unités : fenêtres récentes et courtes (12 h en 1s, 30 jours en 1m…), un seul régime de marché ; un résultat y décrit cette période, pas l'unité en général. Grandes unités : 2020-2026, phases connues de tous.",
      "- Sur les paires peu liquides, beaucoup de bougies 1s et 1m ont un volume nul (émises sans transaction) : les lectures de volume et de flux y sont celles que le chart affiche, mais leur sens économique est faible.",
      `- Le décalage circulaire préserve l'exposition et le regroupement des événements, pas la volatilité locale de chaque bougie, et suppose une série à peu près stationnaire ; le décalage commun ne préserve qu'en partie la corrélation entre actifs. Le t naïf suppose des événements indépendants.`,
      `- Correction de Bonferroni (p ≤ ${P_MAX}) : prudente ; un effet réel faible peut échouer, et un échec ne prouve pas l'absence d'effet. Les critères d'étendue (S3, F2) et de stabilité (S4) sont des seuils simples, sans test propre.`,
      `- Les signaux comparés à l'EMA ${MS.emaReference} seule : S2 (timing) ne distingue pas AXIS d'un filtre de tendance ; seule la comparaison descriptive renseigne l'apport propre de la confluence.`,
      "- Taille fixe, aucun stop ; le slippage est un scénario, pas une mesure du carnet ; les frais réels des petites unités (spread des paires peu liquides) peuvent dépasser les niveaux x3.",
      "- Prix constants (paires peu liquides, petites unités) : le RSI vaut 100 sans baisse enregistrée et les votes EMA et MACD se jouent sur des écarts infimes ; mesuré tel que le chart le calcule. Pas de cotation : sur les paires à bas prix, un pas vaut 0,1 à 0,2 % du prix ; ce rebond joue contre les forts achats et les signaux, et une « forte vente » suivie d'un rebond peut en partie en venir.",
      "- En 1s, le volume moyen inclut la bougie courante : une seule transaction parmi 19 secondes vides donne un volume ×20 ; « fort achat » y signifie surtout « seconde dominée par des achats taker ».",
      "- Moyennes de rendements log (prudentes : la moyenne arithmétique serait plus forte aux grandes unités). Le chart calcule sur environ 500 bougies : l'amorce de l'EMA 200 y diffère de la série longue mesurée, comme en 4h.",
    ].join("\n")
  );
  return `${p.join("\n\n")}\n`;
}

// ─────────────────────────── Entrée ───────────────────────────

/**
 * Empreinte de tout ce qui peut s'exécuter depuis les paquets mesurés (le registre importe
 * presque tous les modules) : SHA-256 de la liste triée « chemin sha256 », tests exclus.
 */
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

/** HEAD et chemins figés modifiés ou non suivis : le commit de figeage date le pré-enregistrement. */
function etatGit(chemins: string[]): { commit: string; modifies: string[] } {
  const git = (...args: string[]): string => execFileSync("git", ["-C", RACINE, ...args], { encoding: "utf8" });
  return {
    commit: git("rev-parse", "HEAD").trim(),
    modifies: git("status", "--porcelain", "--untracked-files=all", "--", ...chemins).split("\n").filter((l) => l.trim() !== ""),
  };
}

async function main(): Promise<void> {
  process.stderr.write(ESSAI ? "⚠ RÉPÉTITION sur symboles déjà vus — sans valeur probante\n" : `✓ manifeste vérifié ${HASH_MANIFESTE}\n`);
  // Écart au figeage : refus en campagne AVANT le premier fetch, avertissement en répétition.
  const ecart = (message: string): void => {
    if (!ESSAI) throw new Error(`${message} — campagne refusée`);
    avertissements.push(message);
  };
  const fige = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(M.figeLeUtc) ? Date.parse(M.figeLeUtc) : Number.NaN;
  if (!(fige < Date.now())) ecart(`figeLeUtc absent, invalide ou futur (${M.figeLeUtc})`);
  const runnerSha256 = sha256(readFileSync(SCRIPT));
  const codeObserve = Object.fromEntries(Object.keys(M.versions.codeAuFigeageSha256).map((f) => [f, sha256(readFileSync(join(RACINE, f)))]));
  // Le protocole a été figé CONTRE ce code.
  const divergents = Object.entries(M.versions.codeAuFigeageSha256).filter(([f, h]) => codeObserve[f] !== h).map(([f]) => f);
  if (Object.keys(M.versions.codeAuFigeageSha256).length === 0) divergents.push("(aucun fichier figé)");
  const arbre = empreinteArbre(M.versions.arbreCode.dossiers);
  if (arbre.sha256 !== M.versions.arbreCode.sha256 || arbre.fichiers !== M.versions.arbreCode.fichiers) {
    divergents.push(`arbre ${arbre.dossiers.join(", ")} (${arbre.fichiers} fichiers, ${arbre.sha256})`);
  }
  if (divergents.length > 0) ecart(`code différent du figeage (${divergents.join(", ")})`);
  const git = etatGit(["scripts/valider-axis-ut.ts", "scripts/axis/manifeste-ut-2026-10-08.json", ...M.versions.arbreCode.dossiers]);
  if (git.modifies.length > 0) ecart(`chemins figés non commités : ${git.modifies.join(" ; ")} (commiter le figeage d'abord)`);
  const code: EmpreinteCode = {
    runnerSha256, observeSha256: codeObserve, arbre, commitFigeage: git.commit,
    cheminsFigesCommites: git.modifies.length === 0, identiqueAuFigeage: divergents.length === 0,
  };

  const unites = lireUnites();
  const pool = M.symboles.liste.map((s) => s.symbol);
  const dejaVus = M.repetitionTechnique.symboles;
  // Garde d'indépendance : les deux ensembles sont disjoints, et chaque mode ne lit que le sien.
  if (pool.length === 0 || dejaVus.some((s) => pool.includes(s)) || new Set(pool).size !== pool.length) throw new Error("manifeste : ensembles de symboles invalides");
  const symboles = ESSAI ? dejaVus : pool;

  const taches = unites.flatMap((u) => symboles.map((symbol) => ({ symbol, u })));
  const t0 = Date.now();
  const secondes = (): number => Math.round((Date.now() - t0) / 1000);
  const acquises = await enParallele(taches, M.donnees.concurrence, ({ symbol, u }) => acquerir(symbol, u), (fait) => {
    process.stderr.write(`\r  … acquisition : ${fait}/${taches.length} séries (${secondes()} s)`);
  });
  process.stderr.write(`\n✓ acquisition complète (${acquises.filter((a) => a.statut === "disponible").length}/${acquises.length} séries exploitables) — mesures\n`);

  const resultats: ResultatUnite[] = [];
  try {
    for (const u of unites) {
      const mesurees: CelluleMesuree[] = [];
      const cellules: ResultatUnite["cellules"] = [];
      for (const a of acquises.filter((x) => x.unite.tf === u.tf)) {
        const id = `${a.symbol} ${u.tf}`;
        if (a.statut === "indisponible") {
          cellules.push({ id, statut: "indisponible", erreur: a.erreur });
          continue;
        }
        const m = mesurerCellule(a.symbol, u, chargerPourMesure(a), a.acquisition);
        if ("erreur" in m) {
          cellules.push({ id, statut: "indisponible", erreur: m.erreur, acquisition: a.acquisition });
          continue;
        }
        mesurees.push(m);
        cellules.push({ id, statut: "disponible", acquisition: m.acquisition, signaux: m.signaux, flux: m.flux });
      }
      const nDispo = mesurees.length;
      const assez = nDispo >= minDisponibles(cellules.length) && nDispo > 0;
      const rs = assez ? regrouperSignaux(mesurees) : null;
      const rf = assez ? regrouperFlux(mesurees) : null;
      const js = jugerSignaux(nDispo, cellules.length, rs);
      const jf = jugerFlux(nDispo, cellules.length, rf);
      resultats.push({ unite: u, cellules, nDispo, signaux: { regroupe: rs, jugement: js }, fortsAchats: { regroupe: rf, jugement: jf }, formulations: formulations(u, nDispo, js, rs, jf, rf) });
      process.stderr.write(`  ✓ ${u.tf} : ${nDispo}/${cellules.length} cellules mesurées, contrôles bloquants passés (${secondes()} s)\n`);
    }
  } catch (erreur) {
    if (!(erreur instanceof EcartControle)) throw erreur;
    // Manifeste : « en cas d'écart : arrêt sans verdict ». Trace horodatée distincte, sans valeur mesurée.
    const calculeLeUtc = new Date().toISOString();
    const trace = join(SORTIES, `arret-ut-${calculeLeUtc.replace(/[:.]/g, "-")}.json`);
    mkdirSync(SORTIES, { recursive: true });
    writeFileSync(
      trace,
      `${JSON.stringify({
        schema: "axiom-axis-ut-backtest-arret-v1", essai: ESSAI, manifesteSha256: HASH_MANIFESTE, calculeLeUtc, code,
        arret: "ecart-controle", cellule: erreur.cellule, controle: erreur.controle, message: erreur.message, verdict: null,
      }, null, 2)}\n`
    );
    process.stderr.write(`✋ écart de contrôle : ${erreur.message}\n  ✓ trace écrite : ${trace} (aucun verdict, aucun rapport)\n`);
    process.exit(1);
  }

  const nonMesurables = formulationsNonMesurables();
  const resultat = {
    schema: "axiom-axis-ut-backtest-result-v1",
    essai: ESSAI,
    manifesteSha256: HASH_MANIFESTE,
    calculeLeUtc: new Date().toISOString(),
    runtime: { bun: process.versions.bun ?? null, node: process.versions.node },
    code,
    avertissements,
    unites: resultats.map((r) => ({
      unite: r.unite.tf,
      fenetre: { debutInclus: iso(r.unite.debut), finExclue: iso(r.unite.fin), libelle: r.unite.libelle },
      cellulesDisponibles: r.nDispo,
      signaux: { verdict: r.signaux.jugement.verdict, raison: r.signaux.jugement.raison, blocs: r.signaux.jugement.blocs, regroupe: r.signaux.regroupe },
      fortsAchats: { verdict: r.fortsAchats.jugement.verdict, raison: r.fortsAchats.jugement.raison, blocs: r.fortsAchats.jugement.blocs, regroupe: r.fortsAchats.regroupe },
      formulations: r.formulations,
      cellules: r.cellules,
    })),
    formulations: { ...Object.fromEntries(resultats.map((r) => [r.unite.tf, r.formulations])), ...nonMesurables },
    strategieValideeAutomatiquement: false,
  };
  mkdirSync(SORTIES, { recursive: true });
  const infini = (_cle: string, valeur: unknown): unknown => (valeur === Infinity ? "Infinity" : valeur === -Infinity ? "-Infinity" : valeur);
  writeFileSync(SORTIE_JSON, `${JSON.stringify(resultat, infini, 2)}\n`);
  writeFileSync(SORTIE_MD, rapport(resultats, nonMesurables, code));
  process.stderr.write(`✓ verdicts écrits${ESSAI ? " (RÉPÉTITION, sans valeur probante)" : ""} : ${SORTIE_JSON} et ${SORTIE_MD}\n`);
}

await main();
