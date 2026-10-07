#!/usr/bin/env bun
/**
 * AXIOM — test final d'AXIS v2 (stratAxis) sur données jamais vues, 7 octobre 2026.
 *
 * Script d'ORCHESTRATION (réseau + disque). Protocole, fenêtre, coûts, critères
 * et suites vivent dans `scripts/axis/manifeste-v2-2026-10-07.json`, figé avant
 * tout téléchargement de ces données : son SHA-256 et ceux du code mesuré sont
 * vérifiés avant le premier fetch, et les valeurs du protocole sont lues dans le
 * manifeste (une seule source).
 *
 * Position mesurée = celle du chart : 1 quand `prixSignal` d'AXIS est défini, 0
 * sinon. Mesures :
 *  1. EXÉCUTION `runBacktest` : jambe longue, décision à la clôture, fill à
 *     l'open suivant, frais + slippage x1, x2, x3 ;
 *  2. REJEU chart-fidèle (`construireTradesStrategie`) : close-à-close hors
 *     frais, fenêtre évaluée et moitiés ;
 *  3. TIMING : décalage circulaire commun aux cellules (même exposition, mêmes
 *     durées, synchronisation avec les prix détruite).
 * Contrôles bloquants avant tout verdict (sinon arrêt sans verdict). Aucun
 * résultat n'est affiché avant la fin du calcul.
 *
 * Tout ce que produit ce script est une mesure PASSÉE, jamais une promesse.
 *
 * Usage : bun scripts/valider-axis-v2.ts --campagne   exécution unique
 *         bun scripts/valider-axis-v2.ts --essai      répétition sur les données
 *           DÉJÀ VUES (cache de la campagne v1), sorties dans /tmp, sans valeur probante
 * Tout autre argument est refusé : une faute de frappe ne lance jamais la campagne.
 * Cache : `scripts/.cache-klines/axis-v2/` (gitignoré, re-vérifié par hash).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { MAX_SIGNAUX_AXIS, positionsAxis, stratAxis, votesAxis } from "../packages/indicators/src/strategy/stratAxis";
import { runBacktest } from "../packages/backtest/src/engine";
import { statsTrades, type StatsRejeu } from "../packages/backtest/src/statsRejeu";
import type { Operande, StrategieDef, TradeResultat } from "../packages/backtest/src/types";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = fileURLToPath(import.meta.url);
const ARGS = process.argv.slice(2);
if (ARGS.length !== 1 || (ARGS[0] !== "--essai" && ARGS[0] !== "--campagne")) {
  process.stderr.write("usage : bun scripts/valider-axis-v2.ts --essai | --campagne\n");
  process.exit(2);
}
const ESSAI = ARGS[0] === "--essai";
const MANIFESTE = join(RACINE, "scripts/axis/manifeste-v2-2026-10-07.json");
const HASH_MANIFESTE = "588aea2f961549923f81d60ed58d52569f5a61853ac796111255ebadf169af9e";
const SORTIES = ESSAI ? "/tmp/axis-v2-essai" : join(RACINE, "scripts/axis");
const SORTIE_JSON = join(SORTIES, "resultat-v2-2026-10-07.json");
const SORTIE_MD = join(SORTIES, "rapport-v2-2026-10-07.md");
const DOSSIER_CACHE = join(RACINE, "scripts/.cache-klines/axis-v2");
const CACHE_V1 = join(RACINE, "scripts/.cache-klines/axis");
const LIMITE_PAGE = 1000;
const TF_MS: Record<string, number> = { "4h": 14_400_000 };

// ─────────────────────────── Manifeste ───────────────────────────

interface Cout { id: string; frais: number; slippage: number }
interface CelluleManifeste { symbol: string; timeframe: string; debutInclus: string }
interface Manifeste {
  signal: { params: Record<string, number> };
  marche: { endpoint: string; tailleFixeQuote: number; capitalInitialQuote: number };
  cellules: CelluleManifeste[];
  fenetre: {
    finExclue: string;
    warmupBougies: number;
    retardMaxPremiereBougieH: number;
    avanceMaxDerniereClotureH: number;
    partMaxBougiesManquantes: number;
  };
  mesures: {
    coutsParCotePct: Cout[];
    timing: { tirages: number; graine: number; fractionMin: number; fractionMax: number };
    coupesCausalite: number[];
  };
  criteres: { minTradesClos: number; pMax: number };
  descriptif: { emaReference: number };
  suites: { infobulleSiFavorable: { critere: string; emaDominee: string; emaAuMoinsAussiBien: string } };
  repetitionTechnique: { cellules: CelluleManifeste[]; finExclue: string };
  versions: { codeAuFigeageSha256: Record<string, string> };
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
const WARMUP = M.fenetre.warmupBougies;
const CELLULES = ESSAI ? M.repetitionTechnique.cellules : M.cellules;
const FIN = Date.parse(ESSAI ? M.repetitionTechnique.finExclue : M.fenetre.finExclue);
const COUTS = M.mesures.coutsParCotePct;
const MIN_TRADES = M.criteres.minTradesClos;
const P_MAX = M.criteres.pMax;
const coutParId = (id: string): Cout => {
  const c = COUTS.find((x) => x.id === id);
  if (c === undefined) throw new Error(`coût ${id} absent du manifeste`);
  return c;
};
const X1 = coutParId("x1-central");
const X3 = coutParId("x3");
const SANS_COUT: Cout = { id: "sans-cout", frais: 0, slippage: 0 };

// ─────────────────────────── Données ───────────────────────────

interface PlageManquante { apres: string; reprise: string; bougies: number }
interface BougieEcartee { temps: string; raison: string }
interface Acquisition {
  source: string;
  acquisLeUtc: string;
  modeCalcul: "cache" | "reseau" | "deja-vu-cache-v1";
  nombre: number;
  premierOpen: string;
  dernierClose: string;
  /** Bougies attendues absentes de la série utilisée, écartées comprises. */
  manquantes: number;
  plagesManquantes: PlageManquante[];
  ecartees: BougieEcartee[];
  sha256Ohlcv: string;
}

/** Raison d'écarter une bougie servie, `null` si elle est exploitable. */
function raisonInvalide(c: Candle): string | null {
  if (![c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)) return "OHLCV non fini";
  if (c.open <= 0 || c.close <= 0 || c.low <= 0) return "prix ≤ 0";
  if (c.volume < 0) return "volume négatif";
  if (c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close)) return "high/low incohérents";
  return null;
}

/**
 * Klines spot paginées sur `[debut, fin[`, bougies clôturées avant `fin` uniquement.
 * Une kline servie mais invalide est écartée et datée (elle comptera comme manquante) ;
 * une réponse illisible arrête le run.
 */
async function telecharger(symbol: string, tf: string, tfMs: number, debut: number, fin: number): Promise<{ candles: Candle[]; ecartees: BougieEcartee[] }> {
  const parTemps = new Map<number, Candle>();
  const ecartees = new Map<number, string>();
  let curseur = debut;
  for (;;) {
    const url = `${ENDPOINT}?symbol=${symbol}&interval=${tf}&startTime=${curseur}&endTime=${fin - 1}&limit=${LIMITE_PAGE}`;
    const reponse = await fetch(url);
    if (!reponse.ok) throw new Error(`Binance ${reponse.status} ${reponse.statusText} sur ${symbol} ${tf}`);
    const brut: unknown = await reponse.json();
    if (!Array.isArray(brut)) throw new Error("réponse Binance non tabulaire");
    for (const ligne of brut) {
      if (!Array.isArray(ligne) || ligne.length < 7) throw new Error("ligne kline Binance invalide");
      const [time, open, high, low, close, volume, closeTime] = [0, 1, 2, 3, 4, 5, 6].map((i) => Number(ligne[i])) as [
        number, number, number, number, number, number, number,
      ];
      if (!Number.isFinite(time)) throw new Error("kline Binance sans temps d'ouverture exploitable");
      if (time < debut || time + tfMs > fin) continue;
      const bougie: Candle = { time, open, high, low, close, volume };
      const raison = raisonInvalide(bougie) ?? (closeTime + 1 !== time + tfMs ? "closeTime incohérent" : null);
      if (raison === null) parTemps.set(time, bougie);
      else ecartees.set(time, raison);
    }
    if (brut.length < LIMITE_PAGE) break;
    const dernier = Number((brut.at(-1) as unknown[])[0]);
    if (!(dernier >= curseur)) throw new Error("pagination Binance sans progression");
    curseur = dernier + 1;
    process.stderr.write(`\r  … ${symbol} ${tf} : ${parTemps.size} bougies`);
  }
  return {
    candles: [...parTemps.values()].sort((a, b) => a.time - b.time),
    ecartees: [...ecartees].sort((a, b) => a[0] - b[0]).map(([t, raison]) => ({ temps: iso(t), raison })),
  };
}

/**
 * Série servie mais inexploitable selon le manifeste : la cellule devient
 * « indisponible ». Toute autre erreur d'acquisition (réseau, cache) arrête le run
 * AVANT la première mesure.
 */
class DonneesInvalides extends Error {}

interface SerieValidee { candles: Candle[]; manquantes: number; plages: PlageManquante[]; ecartees: BougieEcartee[] }

/**
 * Série exploitable sur `[debut, fin[` : bougies invalides écartées (comptées comme
 * manquantes), temps strictement croissants sur la grille de l'unité, première et
 * dernière bougies dans les tolérances du manifeste, trous datés sous le plafond.
 */
function valider(brutes: Candle[], tfMs: number, debut: number, fin: number): SerieValidee {
  const candles: Candle[] = [];
  const ecartees: BougieEcartee[] = [];
  for (const c of brutes) {
    if (!Number.isFinite(c.time)) throw new DonneesInvalides("bougie sans temps d'ouverture exploitable");
    const raison = raisonInvalide(c);
    if (raison === null) candles.push(c);
    else ecartees.push({ temps: iso(c.time), raison });
  }
  if (candles.length === 0) throw new DonneesInvalides("série vide");
  for (const c of candles) if ((c.time - debut) % tfMs !== 0) throw new DonneesInvalides(`bougie hors grille à ${iso(c.time)}`);
  for (let i = 1; i < candles.length; i++) {
    if (!(candles[i]!.time > candles[i - 1]!.time)) throw new DonneesInvalides(`série non strictement croissante à ${iso(candles[i]!.time)}`);
  }
  const premier = candles[0]!.time;
  const dernierClose = candles.at(-1)!.time + tfMs;
  if (premier < debut || premier - debut > M.fenetre.retardMaxPremiereBougieH * 3_600_000) {
    throw new DonneesInvalides(`première bougie à ${iso(premier)}, hors tolérance du début ${iso(debut)}`);
  }
  if (dernierClose > fin || fin - dernierClose > M.fenetre.avanceMaxDerniereClotureH * 3_600_000) {
    throw new DonneesInvalides(`dernière clôture à ${iso(dernierClose)}, hors tolérance de la fin ${iso(fin)}`);
  }
  const plages: PlageManquante[] = [];
  if (premier > debut) plages.push({ apres: iso(debut - tfMs), reprise: iso(premier), bougies: (premier - debut) / tfMs });
  for (let i = 1; i < candles.length; i++) {
    const k = (candles[i]!.time - candles[i - 1]!.time) / tfMs - 1;
    if (k > 0) plages.push({ apres: iso(candles[i - 1]!.time), reprise: iso(candles[i]!.time), bougies: k });
  }
  if (dernierClose < fin) plages.push({ apres: iso(candles.at(-1)!.time), reprise: iso(fin), bougies: (fin - dernierClose) / tfMs });
  const manquantes = plages.reduce((s, p) => s + p.bougies, 0);
  const attendues = (fin - debut) / tfMs;
  if (manquantes > M.fenetre.partMaxBougiesManquantes * attendues) {
    throw new DonneesInvalides(`${manquantes} bougies manquantes (écartées comprises) sur ${attendues} attendues`);
  }
  return { candles, manquantes, plages, ecartees };
}

function acquisition(v: SerieValidee, ecarteesSource: BougieEcartee[], tfMs: number, source: string, acquisLeUtc: string, modeCalcul: Acquisition["modeCalcul"]): Acquisition {
  return {
    source, acquisLeUtc, modeCalcul, nombre: v.candles.length,
    premierOpen: iso(v.candles[0]!.time), dernierClose: iso(v.candles.at(-1)!.time + tfMs),
    manquantes: v.manquantes, plagesManquantes: v.plages,
    ecartees: [...ecarteesSource, ...v.ecartees].sort((a, b) => a.temps.localeCompare(b.temps)),
    sha256Ohlcv: sha256(JSON.stringify(v.candles)),
  };
}

const empreinteCache = (candles: Candle[], ecartees: BougieEcartee[]): string => sha256(JSON.stringify({ candles, ecartees }));

async function chargerCampagne(symbol: string, tf: string, tfMs: number, debut: number, fin: number): Promise<{ candles: Candle[]; acquisition: Acquisition }> {
  const fichier = join(DOSSIER_CACHE, `H-${symbol}-${tf}.json`);
  let servies: { candles: Candle[]; ecartees: BougieEcartee[] };
  let acquisLeUtc: string;
  let modeCalcul: Acquisition["modeCalcul"];
  if (existsSync(fichier)) {
    const enveloppe = JSON.parse(readFileSync(fichier, "utf8")) as {
      endpoint: string; debut: number; fin: number; acquisLeUtc: string; sha256: string; candles: Candle[]; ecartees: BougieEcartee[];
    };
    if (
      enveloppe.endpoint !== ENDPOINT || enveloppe.debut !== debut || enveloppe.fin !== fin ||
      !Array.isArray(enveloppe.candles) || !Array.isArray(enveloppe.ecartees) ||
      empreinteCache(enveloppe.candles, enveloppe.ecartees) !== enveloppe.sha256
    ) {
      throw new Error(`cache ${fichier} non traçable : le supprimer pour re-télécharger`);
    }
    servies = { candles: enveloppe.candles, ecartees: enveloppe.ecartees };
    acquisLeUtc = enveloppe.acquisLeUtc;
    modeCalcul = "cache";
  } else {
    servies = await telecharger(symbol, tf, tfMs, debut, fin);
    acquisLeUtc = new Date().toISOString();
    modeCalcul = "reseau";
  }
  // Validation AVANT toute mise en cache : une série inexploitable n'est jamais écrite.
  const v = valider(servies.candles, tfMs, debut, fin);
  if (modeCalcul === "reseau") {
    mkdirSync(DOSSIER_CACHE, { recursive: true });
    writeFileSync(fichier, JSON.stringify({ endpoint: ENDPOINT, debut, fin, acquisLeUtc, sha256: empreinteCache(servies.candles, servies.ecartees), ...servies }));
  }
  return { candles: v.candles, acquisition: acquisition(v, servies.ecartees, tfMs, ENDPOINT, acquisLeUtc, modeCalcul) };
}

/** Répétition : séries DÉJÀ VUES du cache v1 (W1 ∪ W2), vérifiées par hash, sans réseau. */
function chargerEssai(symbol: string, tf: string, tfMs: number, debut: number, fin: number): { candles: Candle[]; acquisition: Acquisition } {
  const parTemps = new Map<number, Candle>();
  for (const w of ["W1", "W2"]) {
    const fichier = join(CACHE_V1, `${w}-${symbol}-${tf}.json`);
    const enveloppe = JSON.parse(readFileSync(fichier, "utf8")) as { sha256Ohlcv: string; candles: Candle[] };
    if (sha256(JSON.stringify(enveloppe.candles)) !== enveloppe.sha256Ohlcv) throw new Error(`cache ${fichier} non traçable`);
    for (const c of enveloppe.candles) if (c.time >= debut && c.time + tfMs <= fin) parTemps.set(c.time, c);
  }
  const v = valider([...parTemps.values()].sort((a, b) => a.time - b.time), tfMs, debut, fin);
  return { candles: v.candles, acquisition: acquisition(v, [], tfMs, "cache v1 (données déjà vues)", "—", "deja-vu-cache-v1") };
}

// ─────────────────────────── Position et règles ───────────────────────────

/**
 * Le moteur ne résout que des ids du registre, et la position 0/1 n'est
 * volontairement pas une sortie publique d'AXIS (jamais de telle série sur le pane
 * prix). Cette def n'existe que dans le registre de ce processus : elle lit la
 * sortie `prixSignal` du chart, définie exactement pendant un achat affiché.
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
const emaReference: Operande = { type: "indicateur", indicateurId: "ema", params: { length: M.descriptif.emaReference }, output: "ema" };
const jambeEma: StrategieDef = {
  direction: "long",
  tailleFixe: TAILLE,
  reglesEntree: [{ type: "croisement", a: close, b: emaReference, sens: "hausse" }],
  reglesSortie: [{ type: "comparaison", gauche: close, comparateur: "<", droite: emaReference }],
};

// ─────────────────────────── Mesures ───────────────────────────

interface MetriquesExecution {
  trades: number;
  /** Trades clos par règle (hors liquidation de fin de données). */
  fermes: number;
  finDonnees: number;
  expectancyNette: number | null;
  expectancyPct: number | null;
  pnlTotal: number;
  pnlTotalPct: number;
  winRatePct: number | null;
  profitFactor: number | null;
  ddRealiseMaxPct: number;
  dureeMoyenneBarres: number | null;
  fraisTotal: number;
  meilleurPct: number | null;
  pirePct: number | null;
}

/** Agrégats d'une liste de trades moteur ; DD sur le PnL RÉALISÉ cumulé, en % du capital initial. */
function metriques(trades: TradeResultat[]): MetriquesExecution {
  const n = trades.length;
  const somme = (f: (t: TradeResultat) => number) => trades.reduce((s, t) => s + f(t), 0);
  const gains = somme((t) => (t.pnl > 0 ? t.pnl : 0));
  const pertes = somme((t) => (t.pnl < 0 ? -t.pnl : 0));
  let cumul = 0;
  let pic = 0;
  let dd = 0;
  for (const t of trades) {
    cumul += t.pnl;
    pic = Math.max(pic, cumul);
    dd = Math.max(dd, pic - cumul);
  }
  const pcts = trades.map((t) => t.pnlPct);
  return {
    trades: n,
    fermes: trades.filter((t) => t.raison === "regle").length,
    finDonnees: trades.filter((t) => t.raison === "fin-donnees").length,
    expectancyNette: n === 0 ? null : somme((t) => t.pnl) / n,
    expectancyPct: n === 0 ? null : somme((t) => t.pnlPct) / n,
    pnlTotal: somme((t) => t.pnl),
    pnlTotalPct: (somme((t) => t.pnl) / CAPITAL) * 100,
    winRatePct: n === 0 ? null : (trades.filter((t) => t.pnl > 0).length / n) * 100,
    profitFactor: pertes > 0 ? gains / pertes : gains > 0 ? Infinity : null,
    ddRealiseMaxPct: (dd / CAPITAL) * 100,
    dureeMoyenneBarres: n === 0 ? null : somme((t) => t.dureeBarres) / n,
    fraisTotal: somme((t) => t.frais),
    meilleurPct: n === 0 ? null : Math.max(...pcts),
    pirePct: n === 0 ? null : Math.min(...pcts),
  };
}

interface Bornes { timeframe: Timeframe; debutEvaluationMs: number; finDonneesMs: number }
const executer = (candles: Candle[], strat: StrategieDef, cout: Cout, bornes: Bornes): TradeResultat[] =>
  runBacktest(candles, strat, { fraisPct: cout.frais, slippagePct: cout.slippage, capitalInitial: CAPITAL, ...bornes }).trades;

const chronologie = (trades: TradeResultat[]): string => trades.map((t) => `${t.sens}:${t.tempsEntree}:${t.tempsSortie}:${t.raison}`).join("|");

/**
 * Écart détecté par un contrôle bloquant : ARRÊT sans verdict, jamais absorbé en
 * cellule « indisponible » (réservé aux données inexploitables). En campagne, le
 * message ne nomme que la cellule et le contrôle : aucune valeur mesurée sur les
 * données jamais vues ne sort avant le verdict. Le détail n'apparaît qu'en répétition.
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

function serieTiming(cle: string, candles: Candle[], trades: TradeStrategie[], ouvert: TradeStrategie | null, a: number): SerieTiming {
  const { L, prefixe } = prefixeTiming(candles, a);
  const runs: Intervalles = trades.map((t) => [t.idxEntree - a, t.idxSortie! - 1 - a]);
  if (ouvert !== null) runs.push([ouvert.idxEntree - a, candles.length - 2 - a]);
  if (!intervallesValides(runs, L)) throw new EcartControle(cle, "intervalles de timing", `intervalle hors [0, ${L}[`);
  return { L, prefixe, runs, exposition: exposition(runs, L) };
}

/**
 * Série de timing reconstruite depuis les fills d'une exécution sans coût (référence
 * EMA 200, descriptive) : entrée = décision de la bougie précédant le fill, sortie de
 * même, liquidation fin-données jusqu'à la dernière décision. `null` si la
 * reconstruction ne retrouve pas exactement le rendement brut des fills.
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

const capte = (x: SerieTiming, k: number): number => x.runs.reduce((s, [d, f]) => s + x.prefixe[f + k + 1]! - x.prefixe[d + k]!, 0);

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

const T = M.mesures.timing;
const TIRAGES_U: number[] = (() => {
  const rnd = mulberry32(T.graine);
  return Array.from({ length: T.tirages }, () => rnd());
})();
const decalage = (L: number, u: number): number => Math.floor(L * (T.fractionMin + (T.fractionMax - T.fractionMin) * u));

interface ResultatTiming { capteLog: number; p: number; medianeNulle: number; q95Nulle: number; L: number }

function quantile(v: number[], q: number): number {
  const s = [...v].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

/** Test de décalage circulaire : un même k (calculé sur `L`) pour toutes les séries. */
function testTiming(series: SerieTiming[], L: number): ResultatTiming {
  const total = (k: number) => series.reduce((s, x) => s + capte(x, k), 0);
  const observe = total(0);
  const nul = TIRAGES_U.map((u) => total(decalage(L, u)));
  return {
    capteLog: observe,
    p: (1 + nul.filter((v) => v >= observe).length) / (nul.length + 1),
    medianeNulle: quantile(nul, 0.5),
    q95Nulle: quantile(nul, 0.95),
    L,
  };
}

// ─────────────────────────── Contrôles bloquants ───────────────────────────

/**
 * La position de campagne doit reproduire le chart : recalcul direct depuis les
 * fonctions exportées (paramètres résolus, EMA de tendance, fin = n−2), puis
 * marqueurs affichés aux bougies et dans le sens des changements de position. Ce
 * contrôle vérifie la chaîne registre → `prixSignal` → position, pas la logique du
 * score (même code, couverte par les tests unitaires).
 */
function controlerAffichage(cle: string, candles: Candle[], pos: number[]): void {
  const p = resolveParams(stratAxis, P);
  const score = votesAxis(candles, p).map((v) => v?.reduce((s, x) => s + x, 0));
  const closes = closeOf(candles);
  const tendance = ema(closes, Number(p.emaTendance));
  const recalcul = positionsAxis(
    score,
    tendance.map((t, i) => (t === undefined ? undefined : (closes[i] ?? t) > t)),
    Number(p.seuil),
    Number(p.seuilVente),
    candles.length - 2
  );
  for (let i = 0; i < candles.length; i++) {
    if ((recalcul[i] === 1 ? 1 : 0) !== pos[i]) {
      throw new EcartControle(cle, "position = recalcul", `position ${pos[i]} ≠ recalcul ${recalcul[i]} à ${iso(candles[i]!.time)}`);
    }
  }
  const transitions: number[] = [];
  for (let i = 1; i < pos.length; i++) if (pos[i] !== pos[i - 1]) transitions.push(i);
  const attendus = transitions.slice(-MAX_SIGNAUX_AXIS);
  const marqueurs = computeIndicator(stratAxis, candles, P).annotations?.marqueurs ?? [];
  const conforme =
    marqueurs.length === attendus.length &&
    marqueurs.every((m, k) => m.idx === attendus[k] && m.forme === (pos[m.idx] === 1 ? "triangleHaut" : "triangleBas"));
  if (!conforme) throw new EcartControle(cle, "marqueurs du chart", `${marqueurs.length} marqueurs ≠ ${attendus.length} changements de position attendus`);
}

/** Aucune anticipation sur les données réelles : un préfixe ne change jamais le passé. */
function controlerCausalite(cle: string, candles: Candle[], pos: number[]): void {
  for (const f of M.mesures.coupesCausalite) {
    const coupe = Math.floor(candles.length * f);
    const prefixe = positionDe(candles.slice(0, coupe));
    for (let i = 0; i <= coupe - 2; i++) {
      if (prefixe[i] !== pos[i]) throw new EcartControle(cle, "causalité", `préfixe ${f} diverge à ${iso(candles[i]!.time)}`);
    }
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

// ─────────────────────────── Cellules ───────────────────────────

interface Execution { cout: string; metriques: MetriquesExecution }
type TimingCellule = ResultatTiming & { exposition: number };
interface ResultatCellule {
  acquisition: Acquisition;
  evaluation: { bougiePremiereDecisionUtc: string; premierFillUtc: string; finUtc: string; decisions: number; milieuUtc: string };
  achatConservationPct: number;
  rejeu: { global: StatsRejeu; m1: StatsRejeu; m2: StatsRejeu };
  executions: Execution[];
  timing: TimingCellule;
  parAnneeX1: Array<{ annee: number; trades: number; pnlNet: number; expectancyPct: number }>;
  referenceEma: { executions: Execution[]; timing: TimingCellule | null };
  tradesX1: Array<{ entree: string; sortie: string; prixEntree: number; prixSortie: number; pnl: number; pnlPct: number; raison: string }>;
  empreinteChronologieX1: string;
}
type Statut = { statut: "disponible"; resultat: ResultatCellule } | { statut: "indisponible"; erreur: string };
interface Cellule { id: string; statut: Statut; serie?: SerieTiming; serieEma?: SerieTiming | null }

function parAnnee(trades: TradeResultat[]): ResultatCellule["parAnneeX1"] {
  const groupes = new Map<number, TradeResultat[]>();
  for (const t of trades) {
    const annee = new Date(t.tempsEntree).getUTCFullYear();
    groupes.set(annee, [...(groupes.get(annee) ?? []), t]);
  }
  return [...groupes].sort((x, y) => x[0] - y[0]).map(([annee, g]) => ({
    annee,
    trades: g.length,
    pnlNet: g.reduce((s, t) => s + t.pnl, 0),
    expectancyPct: g.reduce((s, t) => s + t.pnlPct, 0) / g.length,
  }));
}

/** Mesures d'une cellule disponible. Toute exception ici est un défaut du calcul : elle arrête la campagne. */
function mesurer(
  id: string, candles: Candle[], tf: Timeframe, tfMs: number, acq: Acquisition
): { resultat: ResultatCellule; serie: SerieTiming; serieEma: SerieTiming | null } {
  const n = candles.length;
  if (n < WARMUP + 2) throw new EcartControle(id, "warmup", `${n} bougies, warmup ${WARMUP} impossible`);
  const a = WARMUP - 1;
  const pos = positionDe(candles);
  controlerAffichage(id, candles, pos);
  controlerCausalite(id, candles, pos);

  const brut = construireTradesStrategie(candles, pos as EtatStrategie[]);
  const trades = brut.trades.filter((t) => t.idxEntree >= a);
  const ouvert = brut.ouvert !== null && brut.ouvert.idxEntree >= a ? brut.ouvert : null;
  const milieu = a + Math.floor((n - 1 - a) / 2);

  const bornes: Bornes = { timeframe: tf, debutEvaluationMs: candles[WARMUP]!.time, finDonneesMs: candles[n - 1]!.time + tfMs };
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

  process.stderr.write(`  ✓ ${id} : contrôles bloquants passés\n`);
  return {
    serie,
    serieEma,
    resultat: {
      acquisition: acq,
      evaluation: {
        bougiePremiereDecisionUtc: iso(candles[a]!.time),
        premierFillUtc: iso(candles[WARMUP]!.time),
        finUtc: iso(candles[n - 1]!.time + tfMs),
        decisions: serie.L,
        milieuUtc: iso(candles[milieu]!.time),
      },
      achatConservationPct: ((candles[n - 1]!.close - candles[WARMUP]!.open) / candles[WARMUP]!.open) * 100,
      rejeu: {
        global: statsTrades(trades),
        m1: statsTrades(trades.filter((t) => t.idxEntree < milieu)),
        m2: statsTrades(trades.filter((t) => t.idxEntree >= milieu)),
      },
      executions: executions.filter((e) => e.cout.id !== SANS_COUT.id).map((e) => ({ cout: e.cout.id, metriques: metriques(e.trades) })),
      timing: { ...testTiming([serie], serie.L), exposition: serie.exposition },
      parAnneeX1: parAnnee(x1.trades),
      referenceEma: {
        executions: execEma.filter((e) => e.cout.id !== SANS_COUT.id).map((e) => ({ cout: e.cout.id, metriques: metriques(e.trades) })),
        timing: serieEma === null ? null : { ...testTiming([serieEma], serieEma.L), exposition: serieEma.exposition },
      },
      tradesX1: x1.trades.map((t) => ({
        entree: iso(t.tempsEntree), sortie: iso(t.tempsSortie), prixEntree: t.prixEntree, prixSortie: t.prixSortie,
        pnl: t.pnl, pnlPct: t.pnlPct, raison: t.raison,
      })),
      empreinteChronologieX1: sha256(reference),
    },
  };
}

interface Acquise {
  id: string;
  tf: Timeframe;
  tfMs: number;
  donnees: { candles: Candle[]; acquisition: Acquisition } | { erreur: string };
}

/** Acquisition seule : une série invalide rend la cellule indisponible, toute autre erreur arrête le run. */
async function acquerir(c: CelluleManifeste): Promise<Acquise> {
  const id = `${c.symbol} ${c.timeframe}`;
  const tfMs = TF_MS[c.timeframe];
  if (tfMs === undefined) throw new Error(`timeframe ${c.timeframe} non géré`);
  const debut = Date.parse(c.debutInclus);
  const tf = c.timeframe as Timeframe;
  try {
    const donnees = ESSAI ? chargerEssai(c.symbol, c.timeframe, tfMs, debut, FIN) : await chargerCampagne(c.symbol, c.timeframe, tfMs, debut, FIN);
    process.stderr.write(`\r  ✓ ${id} : ${donnees.candles.length} bougies (${donnees.acquisition.modeCalcul}), ${donnees.acquisition.manquantes} manquante(s)\n`);
    return { id, tf, tfMs, donnees };
  } catch (erreur) {
    if (!(erreur instanceof DonneesInvalides)) throw erreur;
    process.stderr.write(`\r  ✗ ${id} : série inexploitable (${erreur.message})\n`);
    return { id, tf, tfMs, donnees: { erreur: erreur.message } };
  }
}

function cellule(a: Acquise): Cellule {
  if ("erreur" in a.donnees) return { id: a.id, statut: { statut: "indisponible", erreur: a.donnees.erreur } };
  const { resultat, serie, serieEma } = mesurer(a.id, a.donnees.candles, a.tf, a.tfMs, a.donnees.acquisition);
  return { id: a.id, statut: { statut: "disponible", resultat }, serie, serieEma };
}

// ─────────────────────────── Verdict pré-déclaré ───────────────────────────

type StatutBloc = "tenu" | "echec" | "insuffisant";
interface Bloc { critere: "C1" | "C2" | "C3"; cle: string; statut: StatutBloc; detail: string }

const fmt = (v: number | null | undefined, dec = 2): string =>
  v === null || v === undefined ? "—" : !Number.isFinite(v) ? (v > 0 ? "∞" : "—") : v.toFixed(dec);
const executionDe = (r: ResultatCellule, cout: string): MetriquesExecution => r.executions.find((e) => e.cout === cout)!.metriques;
const referenceDe = (r: ResultatCellule, cout: string): MetriquesExecution => r.referenceEma.executions.find((e) => e.cout === cout)!.metriques;

function blocs(cellules: Cellule[], commun: ResultatTiming | null): Bloc[] {
  const out: Bloc[] = [];
  for (const c of cellules) {
    if (c.statut.statut === "indisponible") {
      out.push({ critere: "C1", cle: c.id, statut: "insuffisant", detail: `indisponible : ${c.statut.erreur}` });
      out.push({ critere: "C2", cle: c.id, statut: "insuffisant", detail: `indisponible : ${c.statut.erreur}` });
      continue;
    }
    const r = c.statut.resultat;
    for (const cout of [X1, X3]) {
      const m = executionDe(r, cout.id);
      const statut: StatutBloc = m.fermes < MIN_TRADES || m.expectancyNette === null ? "insuffisant" : m.expectancyNette > 0 ? "tenu" : "echec";
      out.push({
        critere: "C1", cle: `${c.id} ${cout.id}`, statut,
        detail: `${m.trades} trades (dont ${m.fermes} clos par règle), expectancy nette ${fmt(m.expectancyNette, 3)} USDT (${fmt(m.expectancyPct, 3)} %)`,
      });
    }
    for (const [moitie, s] of [["fenêtre", r.rejeu.global], ["M1", r.rejeu.m1], ["M2", r.rejeu.m2]] as const) {
      const statut: StatutBloc = s.nbTrades === 0 ? "insuffisant" : s.expectancy > 0 ? "tenu" : "echec";
      out.push({ critere: "C2", cle: `${c.id} ${moitie}`, statut, detail: `${s.nbTrades} trades, expectancy ${fmt(s.expectancy, 3)} % hors frais` });
    }
  }
  out.push(
    commun === null
      ? { critere: "C3", cle: "commun", statut: "insuffisant", detail: "non calculable : cellule indisponible" }
      : {
          critere: "C3", cle: "commun", statut: commun.p <= P_MAX ? "tenu" : "echec",
          detail: `p = ${fmt(commun.p, 4)} (seuil ${P_MAX}) ; capté ${fmt(commun.capteLog * 100, 1)} % log contre médiane nulle ${fmt(commun.medianeNulle * 100, 1)} %`,
        }
  );
  return out;
}

function verdict(b: Bloc[]): "FAVORABLE" | "DEFAVORABLE" | "NON_CONCLUANT" {
  if (b.some((x) => x.statut === "echec")) return "DEFAVORABLE";
  if (b.some((x) => x.statut === "insuffisant")) return "NON_CONCLUANT";
  return "FAVORABLE";
}

/**
 * Comparaison pré-déclarée à l'EMA 200 seule : sans effet sur le verdict, elle fixe
 * la formulation de l'infobulle si le verdict est FAVORABLE.
 */
interface ComparaisonEma {
  critere: string;
  cellulesEmaAuMoinsAussiBien: string[];
  cellulesComparees: number;
  timingCommunEma: ResultatTiming | null;
  infobulleSiFavorable: string;
}

function comparerEma(cellules: Cellule[], communEma: ResultatTiming | null): ComparaisonEma {
  const regle = M.suites.infobulleSiFavorable;
  const dispo = cellules.flatMap((c) => (c.statut.statut === "disponible" ? [{ id: c.id, r: c.statut.resultat }] : []));
  const auMoins = dispo.filter(({ r }) => referenceDe(r, X1.id).pnlTotal >= executionDe(r, X1.id).pnlTotal).map(({ id }) => id);
  return {
    critere: regle.critere,
    cellulesEmaAuMoinsAussiBien: auMoins,
    cellulesComparees: dispo.length,
    timingCommunEma: communEma,
    infobulleSiFavorable:
      auMoins.length === 0
        ? regle.emaDominee
        : regle.emaAuMoinsAussiBien.replace("{n}", String(auMoins.length)).replace("{total}", String(dispo.length)),
  };
}

// ─────────────────────────── Rapport ───────────────────────────

const ligne = (cells: Array<string | number>): string => `| ${cells.join(" | ")} |`;
const tableau = (entetes: string[], lignes: Array<Array<string | number>>): string =>
  [ligne(entetes), `|${entetes.map(() => "---").join("|")}|`, ...lignes.map(ligne)].join("\n");
const jour = (texte: string): string => texte.slice(0, 16).replace("T", " ");
const LIBELLE_VERDICT = { FAVORABLE: "FAVORABLE", DEFAVORABLE: "DÉFAVORABLE", NON_CONCLUANT: "NON CONCLUANT" } as const;
const LIBELLE_BLOC = { tenu: "✅ tenu", echec: "❌ échec", insuffisant: "⚠️ insuffisant" } as const;
const ENTETES_EXECUTION = [
  "Cellule", "Trades (clos)", "Exp. nette USDT", "Exp. nette %", "PnL % capital", "Profit factor", "Gagnants % (PnL > 0)",
  "DD réalisé % capital", "Durée moy. (bougies)", "Meilleur / pire %", "Frais USDT (hors slippage)",
];
const ligneExecution = (cle: string, m: MetriquesExecution): Array<string | number> => [
  cle, `${m.trades} (${m.fermes})`, fmt(m.expectancyNette, 3), fmt(m.expectancyPct, 3), fmt(m.pnlTotalPct), fmt(m.profitFactor),
  fmt(m.winRatePct, 1), fmt(m.ddRealiseMaxPct), fmt(m.dureeMoyenneBarres, 1), `${fmt(m.meilleurPct, 1)} / ${fmt(m.pirePct, 1)}`, fmt(m.fraisTotal, 1),
];

function rapport(
  cellules: Cellule[], b: Bloc[], v: ReturnType<typeof verdict>, commun: ResultatTiming | null, comparaison: ComparaisonEma, runnerSha256: string
): string {
  const dispo = cellules.flatMap((c) => (c.statut.statut === "disponible" ? [{ id: c.id, r: c.statut.resultat }] : []));
  const p: string[] = [];
  p.push(ESSAI ? "# AXIS v2 — RÉPÉTITION TECHNIQUE sur données déjà vues (sans valeur probante)" : "# AXIS v2 — test final sur données jamais vues, 7 octobre 2026");
  p.push(
    `Généré par \`scripts/valider-axis-v2.ts\`${ESSAI ? " --essai" : ""}. Manifeste figé \`${HASH_MANIFESTE}\` ` +
      "(`scripts/axis/manifeste-v2-2026-10-07.json`, figé avant tout téléchargement de ces données). " +
      "**Toutes les valeurs sont des mesures PASSÉES, jamais une promesse de performance.**"
  );
  if (avertissements.length > 0) p.push(`**Avertissements (répétition)** :\n${avertissements.map((x) => `- ${x}`).join("\n")}`);
  p.push(`## Verdict pré-déclaré : **${LIBELLE_VERDICT[v]}**`);
  p.push(
    [
      `- **C1** — exécution : au moins ${MIN_TRADES} trades clos par règle et expectancy nette > 0 aux coûts x1 ET x3, dans chaque cellule (critère OOS du manifeste 2026-09-09).`,
      "- **C2** — rejeu hors frais : expectancy > 0 sur la fenêtre évaluée ET dans chaque moitié, dans chaque cellule (critère champion du spec v2.3 §3).",
      `- **C3** — timing : décalage circulaire commun aux cellules, p ≤ ${P_MAX}.`,
    ].join("\n")
  );
  p.push(tableau(["Critère", "Bloc", "Statut", "Détail"], b.map((x) => [x.critere, x.cle, LIBELLE_BLOC[x.statut], x.detail])));
  const indisponibles = cellules.flatMap((c) => (c.statut.statut === "indisponible" ? [`${c.id} : ${c.statut.erreur}`] : []));
  if (indisponibles.length > 0) p.push(`**Cellules indisponibles** :\n${indisponibles.map((x) => `- ${x}`).join("\n")}`);

  p.push("## Protocole");
  p.push(
    [
      `- **Signal** : AXIS v2 aux défauts livrés (achat à score ≥ +${P.seuil}/6 avec close au-dessus de l'EMA ${P.emaTendance}, vente à score ≤ −${P.seuilVente}/6 ; EMA ${P.emaRapide}/${P.emaLente}, Supertrend ${P.stPeriode} ×${P.stMult}, ADX ≥ ${P.seuilAdx}, MACD 12/26/9, RSI 14, CMF 20). Long pendant un achat affiché, à plat sinon ; aucune vente à découvert.`,
      `- **Données** : klines Binance Spot (\`${ESSAI ? "cache v1" : ENDPOINT}\`), bougies 4h clôturées, du début de chaque cellule au \`${iso(FIN)}\` exclu.`,
      `- **Évaluation** : ${WARMUP} bougies de warmup ; décisions à partir de la clôture de la ${WARMUP}e, fills à partir de l'open de la ${WARMUP + 1}e ; un achat né pendant le warmup n'est pas exécuté.`,
      `- **Exécution** : \`runBacktest\`, décision à la clôture, fill à l'open suivant, taille fixe ${TAILLE} USDT, capital ${CAPITAL} USDT, position ouverte liquidée au dernier close. Coûts par côté : ${COUTS.map((c) => `${c.id} = frais ${c.frais} % + slippage ${c.slippage} %`).join(" ; ")}.`,
      "- **Rejeu** : trades close-à-close hors frais (`construireTradesStrategie`, conventions des marqueurs du chart) ; moitiés = coupe au milieu des décisions évaluées, trade rangé selon son entrée.",
      `- **Timing** : rendement log brut capté (exactement celui des fills du moteur sans coûts) comparé à ${T.tirages} décalages circulaires de la position (même exposition, mêmes durées), un même décalage pour toutes les cellules, k entre ${T.fractionMin * 100} % et ${T.fractionMax * 100} % de la plus courte fenêtre ; graine ${T.graine}.`,
      `- **Code** : les fichiers figés du manifeste sont vérifiés par SHA-256 avant le premier téléchargement (un code différent du figeage refuse la campagne). Le SHA-256 du runner, \`${runnerSha256}\`, est consigné dans le journal de revue avant l'exécution et reporté ici.`,
      "- **Contrôles bloquants passés** (sinon : arrêt sans verdict, ce rapport n'existerait pas) : position = recalcul direct depuis les fonctions exportées et marqueurs du chart (la logique du score elle-même est couverte par les tests unitaires) ; causalité sur trois préfixes des données réelles ; le moteur reproduit exactement les décisions du rejeu ; les coûts ne modifient aucun fill ; la statistique de timing égale le rendement brut du moteur sans coûts.",
    ].join("\n")
  );

  p.push("## Données");
  p.push(
    tableau(
      ["Cellule", "Bougies", "Premier open", "Dernière clôture", "Manquantes (dont écartées)", "Premier fill évalué", "Milieu", "Achat-conservation %", "SHA-256 OHLCV"],
      dispo.map(({ id, r }) => [
        id, r.acquisition.nombre, jour(r.acquisition.premierOpen), jour(r.acquisition.dernierClose),
        `${r.acquisition.manquantes} (${r.acquisition.ecartees.length})`,
        jour(r.evaluation.premierFillUtc), jour(r.evaluation.milieuUtc), fmt(r.achatConservationPct, 1), `\`${r.acquisition.sha256Ohlcv.slice(0, 12)}…\``,
      ])
    )
  );
  const plages = dispo.flatMap(({ id, r }) => r.acquisition.plagesManquantes.map((x) => `${id} : ${x.bougies} bougie(s) entre ${jour(x.apres)} et ${jour(x.reprise)}`));
  if (plages.length > 0) {
    p.push(`Bougies manquantes (maintenances de la source ou bougies écartées ; série utilisée telle que servie) :\n${plages.map((x) => `- ${x}`).join("\n")}`);
  }
  const ecartees = dispo.flatMap(({ id, r }) => r.acquisition.ecartees.map((x) => `${id} : ${jour(x.temps)} (${x.raison})`));
  if (ecartees.length > 0) p.push(`Bougies servies mais écartées (comptées comme manquantes) :\n${ecartees.map((x) => `- ${x}`).join("\n")}`);
  p.push("Achat-conservation : variation du prix entre l'open du premier fill évalué et le dernier close, simple référence.");

  p.push("## C1 — exécution aux coûts x1 et x3");
  p.push(tableau(ENTETES_EXECUTION, dispo.flatMap(({ id, r }) => [X1, X3].map((c) => ligneExecution(`${id} ${c.id}`, executionDe(r, c.id))))));

  p.push("## C2 — rejeu chart-fidèle (hors frais)");
  p.push(
    tableau(
      ["Cellule", "Trades", "Gagnants % (PnL ≥ 0)", "Expectancy %", "PnL composé %", "DD max %", "Durée moy. (bougies)", "M1 : trades / exp. %", "M2 : trades / exp. %"],
      dispo.map(({ id, r }) => [
        id, r.rejeu.global.nbTrades, fmt(r.rejeu.global.winRate, 1), fmt(r.rejeu.global.expectancy, 3), fmt(r.rejeu.global.pnlComposePct, 1),
        fmt(r.rejeu.global.maxDrawdownPct, 1), fmt(r.rejeu.global.dureeMoyenne, 1),
        `${r.rejeu.m1.nbTrades} / ${fmt(r.rejeu.m1.expectancy, 3)}`, `${r.rejeu.m2.nbTrades} / ${fmt(r.rejeu.m2.expectancy, 3)}`,
      ])
    )
  );

  p.push("## C3 — timing (décalage circulaire commun)");
  p.push(
    commun === null
      ? "Non calculable : au moins une cellule indisponible."
      : tableau(
          ["Statistique", "Valeur"],
          [
            ["Rendement log capté (somme des cellules)", `${fmt(commun.capteLog * 100, 1)} %`],
            ["Médiane des décalages", `${fmt(commun.medianeNulle * 100, 1)} %`],
            ["95e centile des décalages", `${fmt(commun.q95Nulle * 100, 1)} %`],
            ["p unilatérale", fmt(commun.p, 4)],
            ["Plus courte fenêtre (décisions)", commun.L],
          ]
        )
  );

  p.push("## Descriptif (sans effet sur le verdict, aucune sélection)");
  p.push("### Timing par cellule");
  p.push(
    tableau(
      ["Cellule", "Exposition %", "Capté log %", "Médiane nulle %", "95e centile %", "p"],
      dispo.map(({ id, r }) => [id, fmt(r.timing.exposition * 100, 1), fmt(r.timing.capteLog * 100, 1), fmt(r.timing.medianeNulle * 100, 1), fmt(r.timing.q95Nulle * 100, 1), fmt(r.timing.p, 4)])
    )
  );
  p.push("### Coûts x2");
  p.push(tableau(ENTETES_EXECUTION, dispo.map(({ id, r }) => ligneExecution(`${id} x2`, executionDe(r, "x2")))));
  p.push("### Par année d'entrée (coûts x1)");
  const annees = [...new Set(dispo.flatMap(({ r }) => r.parAnneeX1.map((x) => x.annee)))].sort((x, y) => x - y);
  p.push(
    tableau(
      ["Année", ...dispo.map(({ id }) => `${id} : trades / PnL net USDT`)],
      annees.map((annee) => [
        annee,
        ...dispo.map(({ r }) => {
          const x = r.parAnneeX1.find((y) => y.annee === annee);
          return x === undefined ? "—" : `${x.trades} / ${fmt(x.pnlNet, 0)}`;
        }),
      ])
    )
  );
  const E = M.descriptif.emaReference;
  p.push(`## Comparaison pré-déclarée : EMA ${E} seule (long/plat, même moteur, sans effet sur le verdict)`);
  p.push(
    tableau(
      [
        "Cellule", "AXIS x1 : trades / exp. %", `EMA ${E} x1 : trades / exp. %`, "AXIS x1 : PnL % capital", `EMA ${E} x1 : PnL % capital`,
        "AXIS x3 : PnL % capital", `EMA ${E} x3 : PnL % capital`, "Exposition AXIS / EMA %", "p timing AXIS / EMA",
      ],
      dispo.map(({ id, r }) => {
        const t = r.referenceEma.timing;
        return [
          id,
          `${executionDe(r, X1.id).trades} / ${fmt(executionDe(r, X1.id).expectancyPct, 3)}`,
          `${referenceDe(r, X1.id).trades} / ${fmt(referenceDe(r, X1.id).expectancyPct, 3)}`,
          fmt(executionDe(r, X1.id).pnlTotalPct, 1),
          fmt(referenceDe(r, X1.id).pnlTotalPct, 1),
          fmt(executionDe(r, X3.id).pnlTotalPct, 1),
          fmt(referenceDe(r, X3.id).pnlTotalPct, 1),
          `${fmt(r.timing.exposition * 100, 1)} / ${t === null ? "—" : fmt(t.exposition * 100, 1)}`,
          `${fmt(r.timing.p, 4)} / ${t === null ? "—" : fmt(t.p, 4)}`,
        ];
      })
    )
  );
  const ce = comparaison.timingCommunEma;
  p.push(
    [
      `- **Critère de formulation** : ${comparaison.critere}`,
      `- **EMA ${E} seule au moins aussi bonne** : ${comparaison.cellulesEmaAuMoinsAussiBien.length} cellule(s) sur ${comparaison.cellulesComparees}${comparaison.cellulesEmaAuMoinsAussiBien.length > 0 ? ` (${comparaison.cellulesEmaAuMoinsAussiBien.join(", ")})` : ""}.`,
      `- **Timing commun de l'EMA ${E} seule** (mêmes tirages) : ${ce === null ? "non calculé" : `p = ${fmt(ce.p, 4)}, capté ${fmt(ce.capteLog * 100, 1)} % log contre médiane nulle ${fmt(ce.medianeNulle * 100, 1)} %`}.`,
      `- **Infobulle${v === "FAVORABLE" ? "" : " (appliquée seulement si FAVORABLE)"}** : « ${comparaison.infobulleSiFavorable} »`,
    ].join("\n")
  );

  p.push("## Limites");
  p.push(
    [
      "- Quatre actifs crypto, une seule unité (4h), marché spot Binance sans funding ni marge : la robustesse hors de ce périmètre (autres marchés, forex sans volume où le CMF reste neutre, historique chargé court où l'EMA 200 et l'armement diffèrent) n'est pas établie.",
      "- La v2 a été choisie sur 2024-2026 parmi environ 35 lectures du score : ce test unique contrôle le sur-ajustement, il ne l'élimine pas.",
      `- C1 et C2 mesurent surtout l'exposition longue d'un marché haussier ; C3 est le seul contrôle du timing. C3 ne distingue pas AXIS d'un simple filtre de tendance : l'apport propre de la confluence n'est établi que si AXIS fait mieux que l'EMA ${E} seule (comparaison ci-dessus, sans effet sur le verdict).`,
      "- Les grandes phases du marché 2017-2024 sont connues de tous, les quatre actifs dépendent d'un même facteur crypto, et le filtre de tendance exploite un fait stylisé répandu.",
      "- Puissance limitée : la conjonction de 21 blocs et le bruit des moitiés de C2 rendent un DÉFAVORABLE plausible même avec un petit avantage réel ; un échec ne prouverait pas l'absence d'avantage.",
      "- Frais et liquidité de 2017-2019 différaient d'aujourd'hui (taker Binance 0,1 % alors, couvert par les niveaux x2 et x3).",
      "- Le test de décalage circulaire suppose une série à peu près stationnaire ; le décalage commun ne préserve que partiellement la corrélation entre actifs quand les séries ont des longueurs différentes.",
      "- Taille fixe, aucun stop, aucune gestion du risque ; le slippage est un scénario, pas une mesure du carnet.",
    ].join("\n")
  );
  return `${p.join("\n\n")}\n`;
}

// ─────────────────────────── Entrée ───────────────────────────

async function main(): Promise<void> {
  process.stderr.write(ESSAI ? "⚠ RÉPÉTITION sur données déjà vues — sans valeur probante\n" : `✓ manifeste vérifié ${HASH_MANIFESTE}\n`);
  const runnerSha256 = sha256(readFileSync(SCRIPT));
  const codeObserve = Object.fromEntries(
    Object.keys(M.versions.codeAuFigeageSha256).map((f) => [f, sha256(readFileSync(join(RACINE, f)))])
  );
  // Le protocole a été figé CONTRE ce code : un signal ou un moteur modifié depuis
  // le figeage invaliderait la campagne. Refus AVANT le premier fetch.
  const divergents = Object.entries(M.versions.codeAuFigeageSha256).filter(([f, h]) => codeObserve[f] !== h).map(([f]) => f);
  if (Object.keys(M.versions.codeAuFigeageSha256).length === 0) divergents.push("(aucun fichier figé)");
  if (divergents.length > 0) {
    const message = `code différent du figeage (${divergents.join(", ")})`;
    if (!ESSAI) throw new Error(`${message} — campagne refusée`);
    avertissements.push(message);
  }
  const code = { runnerSha256, observeSha256: codeObserve, identiqueAuFigeage: divergents.length === 0 };

  // Toutes les séries d'abord : une panne réseau arrête le run avant la première mesure.
  const acquises: Acquise[] = [];
  for (const c of CELLULES) acquises.push(await acquerir(c));
  process.stderr.write("✓ acquisition complète — mesures\n");
  const cellules: Cellule[] = [];
  try {
    for (const a of acquises) cellules.push(cellule(a));
  } catch (erreur) {
    if (!(erreur instanceof EcartControle)) throw erreur;
    // Manifeste : « en cas d'écart : arrêt sans verdict ». Trace horodatée distincte
    // (une relance ne l'écrase pas), sans aucune valeur mesurée, sortie en erreur.
    const calculeLeUtc = new Date().toISOString();
    const trace = join(SORTIES, `arret-v2-${calculeLeUtc.replace(/[:.]/g, "-")}.json`);
    mkdirSync(SORTIES, { recursive: true });
    writeFileSync(
      trace,
      `${JSON.stringify({
        schema: "axiom-axis-backtest-arret-v2", essai: ESSAI, manifesteSha256: HASH_MANIFESTE, calculeLeUtc, code,
        arret: "ecart-controle", cellule: erreur.cellule, controle: erreur.controle, message: erreur.message, verdict: null,
      }, null, 2)}\n`
    );
    process.stderr.write(`✋ écart de contrôle : ${erreur.message}\n  ✓ trace écrite : ${trace} (aucun verdict, aucun rapport)\n`);
    process.exit(1);
  }

  const series = cellules.flatMap((c) => (c.serie === undefined ? [] : [c.serie]));
  const commun = series.length === cellules.length ? testTiming(series, Math.min(...series.map((s) => s.L))) : null;
  const seriesEma = cellules.flatMap((c) => (c.serieEma ? [c.serieEma] : []));
  const communEma = commun !== null && seriesEma.length === cellules.length ? testTiming(seriesEma, commun.L) : null;
  const b = blocs(cellules, commun);
  const v = verdict(b);
  const comparaison = comparerEma(cellules, communEma);
  const resultat = {
    schema: "axiom-axis-backtest-result-v2",
    essai: ESSAI,
    manifesteSha256: HASH_MANIFESTE,
    calculeLeUtc: new Date().toISOString(),
    runtime: { bun: process.versions.bun ?? null, node: process.versions.node },
    code,
    avertissements,
    verdict: v,
    blocs: b,
    timingCommun: commun,
    comparaisonEma: comparaison,
    cellules: cellules.map(({ id, statut }) => ({ id, ...statut })),
    strategieValideeAutomatiquement: false,
  };
  mkdirSync(SORTIES, { recursive: true });
  // JSON ne connaît pas l'infini (profit factor sans perte) : il resterait sinon `null`.
  const infini = (_cle: string, valeur: unknown): unknown => (valeur === Infinity ? "Infinity" : valeur === -Infinity ? "-Infinity" : valeur);
  writeFileSync(SORTIE_JSON, `${JSON.stringify(resultat, infini, 2)}\n`);
  writeFileSync(SORTIE_MD, rapport(cellules, b, v, commun, comparaison, runnerSha256));
  process.stderr.write(`✓ verdict ${LIBELLE_VERDICT[v]}${ESSAI ? " (RÉPÉTITION, sans valeur probante)" : ""} — résultats écrits : ${SORTIE_JSON} et ${SORTIE_MD}\n`);
}

await main();
