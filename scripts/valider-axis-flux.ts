#!/usr/bin/env bun
/**
 * AXIOM — test final de la couche flux d'AXIS (forts achats / fortes ventes) sur
 * données jamais vues, 8 octobre 2026.
 *
 * Script d'ORCHESTRATION (réseau + disque). Protocole, hypothèse, horizon,
 * critères et suites vivent dans `scripts/axis/manifeste-flux-2026-10-08.json`,
 * figé avant tout téléchargement de ces données : son SHA-256 et ceux du code
 * mesuré sont vérifiés avant le premier fetch, et les valeurs du protocole sont
 * lues dans le manifeste (une seule source).
 *
 * Événement mesuré = marqueur --accent du chart : bougie à volume ≥ seuilGros ×
 * SMA 20, sens par delta taker (sinon corps), hors bougies de signal AXIS et hors
 * dernière bougie (`grosMouvementsAxis`). Mesure : rendement log SIGNÉ après fill à
 * l'open suivant, sens × ln(open[i+1+h] / open[i+1]), contre des décalages
 * circulaires communs aux cellules (mêmes effectifs, même regroupement).
 * Hypothèse pré-déclarée : forts achats → continuation à 12 bougies (C1 : p
 * unilatérale ≤ 0,05 regroupée ; C2 : moyenne > 0 dans 3 cellules sur 4). Les
 * fortes ventes, les autres horizons et les signaux AXIS sont descriptifs.
 * Contrôles bloquants avant tout verdict (sinon arrêt sans verdict). Aucun
 * résultat n'est affiché avant la fin du calcul.
 *
 * Tout ce que produit ce script est une mesure PASSÉE, jamais une promesse.
 *
 * Usage : bun scripts/valider-axis-flux.ts --campagne   exécution unique
 *         bun scripts/valider-axis-flux.ts --essai      répétition sur les données
 *           DÉJÀ VUES (cache d'exploration BTC/ETH 4h), sorties dans /tmp, sans valeur probante
 * Tout autre argument est refusé : une faute de frappe ne lance jamais la campagne.
 * Cache : `scripts/.cache-klines/axis-flux/` (gitignoré, re-vérifié par hash).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candle } from "../packages/types/src/index";
import { closeOf, computeIndicator, construireTradesStrategie, ema, resolveParams, type EtatStrategie } from "../packages/indicators/src/index";
import {
  MAX_GROS_AXIS,
  MAX_SIGNAUX_AXIS,
  fluxAxis,
  forceFlux,
  grosMouvementsAxis,
  positionsAxis,
  stratAxis,
  votesAxis,
  type FluxBougie,
} from "../packages/indicators/src/strategy/stratAxis";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = fileURLToPath(import.meta.url);
const ARGS = process.argv.slice(2);
if (ARGS.length !== 1 || (ARGS[0] !== "--essai" && ARGS[0] !== "--campagne")) {
  process.stderr.write("usage : bun scripts/valider-axis-flux.ts --essai | --campagne\n");
  process.exit(2);
}
const ESSAI = ARGS[0] === "--essai";
const MANIFESTE = join(RACINE, "scripts/axis/manifeste-flux-2026-10-08.json");
const HASH_MANIFESTE = "29d9449b8130d61adea69965f0e57debcfa6f2bcaa8ee952498f3e34efabfc88";
const SORTIES = ESSAI ? "/tmp/axis-flux-essai" : join(RACINE, "scripts/axis");
const SORTIE_JSON = join(SORTIES, "resultat-flux-2026-10-08.json");
const SORTIE_MD = join(SORTIES, "rapport-flux-2026-10-08.md");
const DOSSIER_CACHE = join(RACINE, "scripts/.cache-klines/axis-flux");
const LIMITE_PAGE = 1000;
const TF_MS: Record<string, number> = { "4h": 14_400_000 };

// ─────────────────────────── Manifeste ───────────────────────────

interface CelluleManifeste { symbol: string; timeframe: string; debutInclus: string }
interface Manifeste {
  evenement: { params: Record<string, number | boolean> };
  marche: { endpoint: string };
  cellules: CelluleManifeste[];
  fenetre: {
    finExclue: string;
    warmupBougies: number;
    horizonMax: number;
    retardMaxPremiereBougieH: number;
    avanceMaxDerniereClotureH: number;
    partMaxBougiesManquantes: number;
  };
  mesures: {
    horizons: number[];
    horizonPrincipal: number;
    timing: { tirages: number; graine: number; fractionMin: number; fractionMax: number };
    permutationSens: { tirages: number; graine: number };
    coupesCausalite: number[];
  };
  criteres: { minFortsAchatsParCellule: number; pMax: number; minCellulesPositives: number };
  secondaires: { minVentesFortesAxis: number; coutAllerRetourPct: number };
  suites: {
    infobulleFortAchat: string;
    infobulleForteVente: { significatif: string; nonSignificatif: string };
    infobulleVenteForte: string;
    infobulleDefavorable: string;
  };
  repetitionTechnique: { cellules: CelluleManifeste[]; finExclue: string };
  versions: { codeAuFigeageSha256: Record<string, string> };
}

const sha256 = (contenu: string | Uint8Array): string => createHash("sha256").update(contenu).digest("hex");
const iso = (ms: number): string => new Date(ms).toISOString();
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
const P = M.evenement.params;
const ENDPOINT = M.marche.endpoint;
const WARMUP = M.fenetre.warmupBougies;
const H_MAX = M.fenetre.horizonMax;
const HORIZONS = M.mesures.horizons;
const H_PRINCIPAL = M.mesures.horizonPrincipal;
const CELLULES = ESSAI ? M.repetitionTechnique.cellules : M.cellules;
const FIN = Date.parse(ESSAI ? M.repetitionTechnique.finExclue : M.fenetre.finExclue);
const MIN_EVENEMENTS = M.criteres.minFortsAchatsParCellule;
const P_MAX = M.criteres.pMax;
const MIN_CELLULES_POSITIVES = M.criteres.minCellulesPositives;
const MIN_VENTES_FORTES_AXIS = M.secondaires.minVentesFortesAxis;
const COUT_ALLER_RETOUR_PCT = M.secondaires.coutAllerRetourPct;
if (!HORIZONS.includes(H_PRINCIPAL) || Math.max(...HORIZONS) !== H_MAX) throw new Error("manifeste : horizons incohérents");
if (![MIN_EVENEMENTS, P_MAX, MIN_CELLULES_POSITIVES, MIN_VENTES_FORTES_AXIS, COUT_ALLER_RETOUR_PCT].every(Number.isFinite)) throw new Error("manifeste : critères incomplets");

// ─────────────────────────── Données ───────────────────────────

interface PlageManquante { apres: string; reprise: string; bougies: number }
interface BougieEcartee { temps: string; raison: string }
interface Acquisition {
  source: string;
  acquisLeUtc: string;
  modeCalcul: "cache" | "reseau" | "deja-vu-cache-exploration";
  nombre: number;
  premierOpen: string;
  dernierClose: string;
  manquantes: number;
  plagesManquantes: PlageManquante[];
  ecartees: BougieEcartee[];
  sha256Ohlcv: string;
}

function raisonInvalide(c: Candle): string | null {
  if (![c.open, c.high, c.low, c.close, c.volume, c.buyVolume, c.sellVolume].every((v) => typeof v === "number" && Number.isFinite(v))) return "OHLCV ou volume taker non fini";
  if (c.open <= 0 || c.close <= 0 || c.low <= 0) return "prix ≤ 0";
  if (c.volume < 0 || c.buyVolume! < 0 || c.buyVolume! > c.volume * (1 + 1e-9)) return "volume taker incohérent";
  if (c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close)) return "high/low incohérents";
  return null;
}

/** Klines spot paginées sur `[debut, fin[` (OHLCV + volume taker acheteur, champ 9), bougies clôturées avant `fin`. */
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
      if (!Array.isArray(ligne) || ligne.length < 10) throw new Error("ligne kline Binance sans champ taker");
      const [time, open, high, low, close, volume, closeTime, takerBuy] = [0, 1, 2, 3, 4, 5, 6, 9].map((i) => Number(ligne[i])) as [
        number, number, number, number, number, number, number, number,
      ];
      if (!Number.isFinite(time)) throw new Error("kline Binance sans temps d'ouverture exploitable");
      if (time < debut || time + tfMs > fin) continue;
      const bougie: Candle = { time, open, high, low, close, volume, buyVolume: takerBuy, sellVolume: volume - takerBuy };
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

class DonneesInvalides extends Error {}

interface SerieValidee { candles: Candle[]; manquantes: number; plages: PlageManquante[]; ecartees: BougieEcartee[] }

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
  const v = valider(servies.candles, tfMs, debut, fin);
  if (modeCalcul === "reseau") {
    mkdirSync(DOSSIER_CACHE, { recursive: true });
    writeFileSync(fichier, JSON.stringify({ endpoint: ENDPOINT, debut, fin, acquisLeUtc, sha256: empreinteCache(servies.candles, servies.ecartees), ...servies }));
  }
  return { candles: v.candles, acquisition: acquisition(v, servies.ecartees, tfMs, ENDPOINT, acquisLeUtc, modeCalcul) };
}

/** Répétition : séries DÉJÀ VUES du cache d'exploration, vérifiées par hash, sans réseau. */
function chargerEssai(symbol: string, tf: string, tfMs: number, debut: number, fin: number): { candles: Candle[]; acquisition: Acquisition } {
  const fichier = join(DOSSIER_CACHE, `E-${symbol}-${tf}.json`);
  const enveloppe = JSON.parse(readFileSync(fichier, "utf8")) as { sha256: string; candles: Candle[] };
  if (sha256(JSON.stringify(enveloppe.candles)) !== enveloppe.sha256) throw new Error(`cache ${fichier} non traçable`);
  const v = valider(enveloppe.candles.filter((c) => c.time >= debut && c.time + tfMs <= fin), tfMs, debut, fin);
  return { candles: v.candles, acquisition: acquisition(v, [], tfMs, "cache d'exploration (données déjà vues)", "—", "deja-vu-cache-exploration") };
}

// ─────────────────────────── Événements ───────────────────────────

interface Evenement { idx: number; sens: number }

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

/** Position 0/1 d'AXIS (recalcul direct, fin = n − 2) et bougies de signal (changements de position définis). */
function positionEtSignaux(candles: Candle[]): { pos: Positions; signaux: number[] } {
  const p = resolveParams(stratAxis, P);
  const score = votesAxis(candles, p).map((v) => v?.reduce((s, x) => s + x, 0));
  const closes = closeOf(candles);
  const tendance = ema(closes, Number(p.emaTendance));
  const pos = positionsAxis(
    score,
    tendance.map((t, i) => (t === undefined ? undefined : (closes[i] ?? t) > t)),
    Number(p.seuil),
    Number(p.seuilVente),
    candles.length - 2
  );
  const signaux: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = pos[i - 1];
    if (prev !== undefined && pos[i] !== prev) signaux.push(i);
  }
  return { pos, signaux };
}

/** Événements du chart recalculés depuis les fonctions exportées. */
function evenementsDe(candles: Candle[]): { evenements: Evenement[]; flux: FluxBougie[]; pos: Positions; signaux: number[] } {
  const { pos, signaux } = positionEtSignaux(candles);
  const flux = fluxAxis(candles, undefined, Number(P.rvolPeriode), Number(P.oiBougies));
  return { evenements: grosMouvementsAxis(candles, flux, Number(P.seuilGros), new Set(signaux)), flux, pos, signaux };
}

const forme = (sens: number): string => (sens > 0 ? "triangleHaut" : "triangleBas");

/** Les événements de campagne sont exactement les marqueurs du chart (les 60 derniers), les signaux aussi (120 derniers). */
function controlerAffichage(cle: string, candles: Candle[], evenements: Evenement[], pos: Positions, signaux: number[]): void {
  const marqueurs = computeIndicator(stratAxis, candles, P).annotations?.marqueurs ?? [];
  const accent = marqueurs.filter((m) => m.couleur === "--accent");
  const attendus = evenements.slice(-MAX_GROS_AXIS);
  const conforme = accent.length === attendus.length && accent.every((m, k) => m.idx === attendus[k]!.idx && m.forme === forme(attendus[k]!.sens));
  if (!conforme) throw new EcartControle(cle, "événements = marqueurs du chart", `${accent.length} marqueurs --accent ≠ ${attendus.length} événements attendus`);
  const signauxChart = marqueurs.filter((m) => m.couleur !== "--accent");
  const signauxAttendus = signaux.slice(-MAX_SIGNAUX_AXIS);
  const conformeSignaux =
    signauxChart.length === signauxAttendus.length &&
    signauxChart.every((m, k) => m.idx === signauxAttendus[k] && m.forme === (pos[m.idx] === 1 ? "triangleHaut" : "triangleBas"));
  if (!conformeSignaux) throw new EcartControle(cle, "signaux = marqueurs du chart", `${signauxChart.length} marqueurs ≠ ${signauxAttendus.length} changements de position`);
}

/** Aucune anticipation sur les données réelles : un préfixe ne change jamais les événements passés. */
function controlerCausalite(cle: string, candles: Candle[], evenements: Evenement[]): void {
  for (const f of M.mesures.coupesCausalite) {
    const coupe = Math.floor(candles.length * f);
    const prefixe = evenementsDe(candles.slice(0, coupe)).evenements.map((e) => `${e.idx}:${e.sens}`).join("|");
    const complet = evenements.filter((e) => e.idx <= coupe - 2).map((e) => `${e.idx}:${e.sens}`).join("|");
    if (prefixe !== complet) throw new EcartControle(cle, "causalité", `préfixe ${f} diverge`);
  }
}

// ─────────────────────────── Statistiques ───────────────────────────

interface Serie {
  id: string;
  candles: Candle[];
  lnOpen: Float64Array;
  /** Fenêtre évaluée des décisions [a, b]. */
  a: number;
  b: number;
  tendance: Array<number | undefined>;
}
interface Jeu { serie: Serie; evenements: Evenement[] }

const rendement = (s: Serie, i: number, sens: number, h: number): number => sens * (s.lnOpen[i + 1 + h]! - s.lnOpen[i + 1]!);

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

interface Stat {
  n: number;
  sommeLog: number;
  moyenneBps: number;
  medianeBps: number;
  hitsPct: number;
  t: number;
  /** Unilatérale : nul ≥ observé. */
  pUni: number;
  /** Bilatérale : |nul| ≥ |observé|. */
  pBi: number;
  medianeNulleBps: number;
  q95NulleBps: number;
  L: number;
}

function quantile(v: number[], q: number): number {
  const s = [...v].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

/** Statistique d'un ensemble de jeux à l'horizon h : somme des rendements signés contre décalages communs. */
function statistique(jeux: Jeu[], h: number): Stat {
  const valeurs: number[] = [];
  for (const { serie, evenements } of jeux) for (const e of evenements) valeurs.push(rendement(serie, e.idx, e.sens, h));
  const n = valeurs.length;
  const L = Math.min(...jeux.map(({ serie }) => serie.b - serie.a + 1));
  if (n === 0) return { n: 0, sommeLog: 0, moyenneBps: 0, medianeBps: 0, hitsPct: 0, t: 0, pUni: 1, pBi: 1, medianeNulleBps: 0, q95NulleBps: 0, L };
  const somme = valeurs.reduce((x, y) => x + y, 0);
  const moyenne = somme / n;
  const variance = valeurs.reduce((x, y) => x + (y - moyenne) ** 2, 0) / Math.max(1, n - 1);
  const nul = TIRAGES_U.map((u) => {
    const k = decalage(L, u);
    let total = 0;
    for (const { serie, evenements } of jeux) {
      const Ls = serie.b - serie.a + 1;
      for (const e of evenements) total += rendement(serie, serie.a + ((e.idx - serie.a + k) % Ls), e.sens, h);
    }
    return total;
  });
  return {
    n,
    sommeLog: somme,
    moyenneBps: moyenne * 1e4,
    medianeBps: quantile(valeurs, 0.5) * 1e4,
    hitsPct: (valeurs.filter((v) => v > 0).length / n) * 100,
    t: variance > 0 ? moyenne / Math.sqrt(variance / n) : 0,
    pUni: (1 + nul.filter((v) => v >= somme).length) / (nul.length + 1),
    pBi: (1 + nul.filter((v) => Math.abs(v) >= Math.abs(somme)).length) / (nul.length + 1),
    medianeNulleBps: (quantile(nul, 0.5) / n) * 1e4,
    q95NulleBps: (quantile(nul, 0.95) / n) * 1e4,
    L,
  };
}

interface StatPermutation {
  /** Forts achats (tirés comme tels sous le nul). */
  n: number;
  /** Forts mouvements évalués, achats et ventes réunis. */
  total: number;
  moyenneAchatsBps: number;
  moyenneTousBps: number;
  medianeNulleBps: number;
  pUni: number;
}

/**
 * Nul complémentaire (descriptif) : permutation des sens parmi tous les forts mouvements de chaque
 * cellule — instants, effectifs par sens et volatilité locale préservés. Tirage sans remise de
 * `achats.length` bougies parmi achats ∪ ventes, somme de leurs rendements bruts à l'horizon h.
 */
function permutationSens(jeux: Array<{ serie: Serie; achats: Evenement[]; ventes: Evenement[] }>, h: number): StatPermutation {
  const brut = (s: Serie, e: Evenement): number => s.lnOpen[e.idx + 1 + h]! - s.lnOpen[e.idx + 1]!;
  const cellules = jeux.map(({ serie, achats, ventes }) => ({ tous: [...achats, ...ventes].map((e) => brut(serie, e)), nAchats: achats.length }));
  const n = cellules.reduce((s, c) => s + c.nAchats, 0);
  const total = cellules.reduce((s, c) => s + c.tous.length, 0);
  if (n === 0 || total === 0) return { n, total, moyenneAchatsBps: 0, moyenneTousBps: 0, medianeNulleBps: 0, pUni: 1 };
  const observe = jeux.reduce((s, { serie, achats }) => s + achats.reduce((x, e) => x + brut(serie, e), 0), 0);
  const sommeTous = cellules.reduce((s, c) => s + c.tous.reduce((x, y) => x + y, 0), 0);
  const rnd = mulberry32(M.mesures.permutationSens.graine);
  const nul = Array.from({ length: M.mesures.permutationSens.tirages }, () => {
    let somme = 0;
    for (const { tous, nAchats } of cellules) {
      const v = tous.slice();
      for (let j = 0; j < nAchats; j++) {
        const r = j + Math.floor(rnd() * (v.length - j));
        [v[j], v[r]] = [v[r]!, v[j]!];
        somme += v[j]!;
      }
    }
    return somme;
  });
  return {
    n,
    total,
    moyenneAchatsBps: (observe / n) * 1e4,
    moyenneTousBps: (sommeTous / total) * 1e4,
    medianeNulleBps: (quantile(nul, 0.5) / n) * 1e4,
    pUni: (1 + nul.filter((v) => v >= observe).length) / (nul.length + 1),
  };
}

/** Contrôle : somme observée par différences de lnOpen = somme par préfixes de rendements de bougie à bougie. */
function controlerStatistique(cle: string, s: Serie, evenements: Evenement[], h: number): void {
  const n = s.candles.length;
  const prefixe = new Float64Array(n);
  for (let j = 1; j < n; j++) prefixe[j] = prefixe[j - 1]! + Math.log(s.candles[j]!.open / s.candles[j - 1]!.open);
  let direct = 0;
  let parPrefixe = 0;
  for (const e of evenements) {
    if (e.idx + 1 + H_MAX > n - 1) throw new EcartControle(cle, "horizon", `événement ${e.idx} sans ${H_MAX} bougies suivantes`);
    direct += rendement(s, e.idx, e.sens, h);
    parPrefixe += e.sens * (prefixe[e.idx + 1 + h]! - prefixe[e.idx + 1]!);
  }
  if (Math.abs(direct - parPrefixe) > 1e-9) throw new EcartControle(cle, "statistique", `direct ${direct} ≠ préfixes ${parPrefixe}`);
}

// ─────────────────────────── Cellules ───────────────────────────

interface StatHorizon { h: number; achats: Stat; ventes: Stat }
interface TradeAxis { idxEntree: number; idxSortie: number; pct: number; qualite: string; qualiteSortie: string }
interface ResultatCellule {
  acquisition: Acquisition;
  evaluation: { premiereDecisionUtc: string; derniereDecisionUtc: string; decisions: number };
  evenements: { total: number; achats: number; ventes: number; parAn: Array<{ annee: number; achats: number; ventes: number; moyenneAchats12Bps: number | null }> };
  horizons: StatHorizon[];
  permutationSens: StatPermutation;
  tendance: { achatsAuDessus: Stat; achatsSous: Stat };
  signauxAxis: {
    achatsParQualite: Array<{ qualite: string; trades: number; expectancyPct: number | null; gagnantsPct: number | null }>;
    ventesFortes: number;
  };
}
type Statut = { statut: "disponible"; resultat: ResultatCellule } | { statut: "indisponible"; erreur: string };
interface Cellule {
  id: string;
  statut: Statut;
  serie?: Serie;
  achats?: Evenement[];
  ventes?: Evenement[];
  ventesFortesAxis?: Evenement[];
}

const signe = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

function mesurer(id: string, candles: Candle[], tfMs: number, acq: Acquisition): Cellule {
  const n = candles.length;
  // Au moins une décision évaluable : a = WARMUP − 1 ≤ b = n − 2 − H_MAX.
  if (n < WARMUP + H_MAX + 1) return { id, statut: { statut: "indisponible", erreur: `${n} bougies : warmup ${WARMUP} + horizon ${H_MAX} impossible` } };
  const { evenements, flux, pos, signaux } = evenementsDe(candles);
  controlerAffichage(id, candles, evenements, pos, signaux);
  controlerCausalite(id, candles, evenements);

  const a = WARMUP - 1;
  const b = n - 2 - H_MAX;
  const serie: Serie = { id, candles, lnOpen: new Float64Array(candles.map((c) => Math.log(c.open))), a, b, tendance: ema(closeOf(candles), Number(P.emaTendance)) };
  const evalues = evenements.filter((e) => e.idx >= a && e.idx <= b);
  controlerStatistique(id, serie, evalues, H_PRINCIPAL);
  const achats = evalues.filter((e) => e.sens > 0);
  const ventes = evalues.filter((e) => e.sens < 0);

  const horizons: StatHorizon[] = HORIZONS.map((h) => ({ h, achats: statistique([{ serie, evenements: achats }], h), ventes: statistique([{ serie, evenements: ventes }], h) }));
  const permutation = permutationSens([{ serie, achats, ventes }], H_PRINCIPAL);
  const tendanceDe = (i: number): number => {
    const t = serie.tendance[i];
    return t === undefined ? 0 : signe(candles[i]!.close - t);
  };
  const tendance = {
    achatsAuDessus: statistique([{ serie, evenements: achats.filter((e) => tendanceDe(e.idx) > 0) }], H_PRINCIPAL),
    achatsSous: statistique([{ serie, evenements: achats.filter((e) => tendanceDe(e.idx) < 0) }], H_PRINCIPAL),
  };

  const annees = new Map<number, { achats: Evenement[]; ventes: number }>();
  for (const e of evalues) {
    const annee = new Date(candles[e.idx]!.time).getUTCFullYear();
    const g = annees.get(annee) ?? { achats: [], ventes: 0 };
    if (e.sens > 0) g.achats.push(e);
    else g.ventes++;
    annees.set(annee, g);
  }
  const parAn = [...annees].sort((x, y) => x[0] - y[0]).map(([annee, g]) => ({
    annee,
    achats: g.achats.length,
    ventes: g.ventes,
    moyenneAchats12Bps: g.achats.length === 0 ? null : (g.achats.reduce((s, e) => s + rendement(serie, e.idx, 1, H_PRINCIPAL), 0) / g.achats.length) * 1e4,
  }));

  // Signaux AXIS (descriptif) : trades close-à-close du rejeu, qualité de flux à l'entrée et à la sortie.
  const brut = construireTradesStrategie(candles, pos as Array<EtatStrategie | undefined>);
  const qualite = (i: number, sens: number): string => {
    const fo = forceFlux(flux[i] ?? {}, sens, Number(P.seuilRvol), Number(P.seuilOi));
    return fo.dispo === 0 ? "indisponible" : fo.fort ? "fort" : fo.contre ? "contre-sens" : "ordinaire";
  };
  // `brut.trades` ne contient que des trades clôturés (sortie et PnL définis) ; le trade ouvert est à part.
  const trades: TradeAxis[] = brut.trades.flatMap((t) =>
    t.idxEntree >= a && t.idxSortie !== undefined && t.pnlPct !== undefined
      ? [{ idxEntree: t.idxEntree, idxSortie: t.idxSortie, pct: t.pnlPct, qualite: qualite(t.idxEntree, 1), qualiteSortie: qualite(t.idxSortie, -1) }]
      : []
  );
  const achatsParQualite = ["fort", "ordinaire", "contre-sens", "indisponible"].map((q) => {
    const ts = trades.filter((t) => t.qualite === q);
    return {
      qualite: q,
      trades: ts.length,
      expectancyPct: ts.length === 0 ? null : ts.reduce((s, t) => s + t.pct, 0) / ts.length,
      gagnantsPct: ts.length === 0 ? null : (ts.filter((t) => t.pct > 0).length / ts.length) * 100,
    };
  });
  const ventesFortesAxis: Evenement[] = trades.filter((t) => t.qualiteSortie === "fort" && t.idxSortie >= a && t.idxSortie <= b).map((t) => ({ idx: t.idxSortie, sens: -1 }));

  process.stderr.write(`  ✓ ${id} : contrôles bloquants passés\n`);
  return {
    id,
    serie,
    achats,
    ventes,
    ventesFortesAxis,
    statut: {
      statut: "disponible",
      resultat: {
        acquisition: acq,
        evaluation: { premiereDecisionUtc: iso(candles[a]!.time), derniereDecisionUtc: iso(candles[b]!.time), decisions: b - a + 1 },
        evenements: { total: evalues.length, achats: achats.length, ventes: ventes.length, parAn },
        horizons,
        permutationSens: permutation,
        tendance,
        signauxAxis: { achatsParQualite, ventesFortes: ventesFortesAxis.length },
      },
    },
  };
}

interface Acquise { id: string; tfMs: number; donnees: { candles: Candle[]; acquisition: Acquisition } | { erreur: string } }

async function acquerir(c: CelluleManifeste): Promise<Acquise> {
  const id = `${c.symbol} ${c.timeframe}`;
  const tfMs = TF_MS[c.timeframe];
  if (tfMs === undefined) throw new Error(`timeframe ${c.timeframe} non géré`);
  const debut = Date.parse(c.debutInclus);
  try {
    const donnees = ESSAI ? chargerEssai(c.symbol, c.timeframe, tfMs, debut, FIN) : await chargerCampagne(c.symbol, c.timeframe, tfMs, debut, FIN);
    process.stderr.write(`\r  ✓ ${id} : ${donnees.candles.length} bougies (${donnees.acquisition.modeCalcul}), ${donnees.acquisition.manquantes} manquante(s)\n`);
    return { id, tfMs, donnees };
  } catch (erreur) {
    if (!(erreur instanceof DonneesInvalides)) throw erreur;
    process.stderr.write(`\r  ✗ ${id} : série inexploitable (${erreur.message})\n`);
    return { id, tfMs, donnees: { erreur: erreur.message } };
  }
}

const cellule = (a: Acquise): Cellule =>
  "erreur" in a.donnees ? { id: a.id, statut: { statut: "indisponible", erreur: a.donnees.erreur } } : mesurer(a.id, a.donnees.candles, a.tfMs, a.donnees.acquisition);

// ─────────────────────────── Verdict pré-déclaré ───────────────────────────

type StatutBloc = "tenu" | "echec" | "insuffisant";
interface Bloc { critere: "C1" | "C2"; cle: string; statut: StatutBloc; detail: string }

const fmt = (v: number | null | undefined, dec = 2): string => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(dec));
const statPrincipale = (r: ResultatCellule): Stat => r.horizons.find((x) => x.h === H_PRINCIPAL)!.achats;

function blocs(cellules: Cellule[], commun: Stat | null): Bloc[] {
  const indispo = cellules.filter((c) => c.statut.statut === "indisponible");
  const insuffisantes = cellules.filter((c) => c.statut.statut === "disponible" && statPrincipale(c.statut.resultat).n < MIN_EVENEMENTS);
  const detailManque = [
    ...indispo.map((c) => `${c.id} indisponible`),
    ...insuffisantes.map((c) => `${c.id} : ${statPrincipale((c.statut as { resultat: ResultatCellule }).resultat).n} forts achats < ${MIN_EVENEMENTS}`),
  ].join(" ; ");
  if (commun === null || detailManque.length > 0) {
    return [
      { critere: "C1", cle: "regroupé", statut: "insuffisant", detail: `non calculable au complet : ${detailManque}` },
      { critere: "C2", cle: "cellules", statut: "insuffisant", detail: `non calculable au complet : ${detailManque}` },
    ];
  }
  const dispo = cellules.flatMap((c) => (c.statut.statut === "disponible" ? [{ id: c.id, s: statPrincipale(c.statut.resultat) }] : []));
  const positives = dispo.filter(({ s }) => s.moyenneBps > 0);
  return [
    {
      critere: "C1", cle: "regroupé", statut: commun.pUni <= P_MAX ? "tenu" : "echec",
      detail: `${commun.n} forts achats, ${fmt(commun.moyenneBps, 0)} bps en moyenne à ${H_PRINCIPAL} bougies (${fmt(commun.hitsPct, 1)} % de hausses), p unilatérale = ${fmt(commun.pUni, 4)} (seuil ${P_MAX}) ; médiane nulle ${fmt(commun.medianeNulleBps, 0)} bps`,
    },
    {
      critere: "C2", cle: "cellules", statut: positives.length >= MIN_CELLULES_POSITIVES ? "tenu" : "echec",
      detail: `${positives.length} cellule(s) sur ${dispo.length} à moyenne > 0 (seuil ${MIN_CELLULES_POSITIVES}) : ${dispo.map(({ id, s }) => `${id} ${fmt(s.moyenneBps, 0)} bps (n = ${s.n})`).join(", ")}`,
    },
  ];
}

/** p Monte-Carlo : « = x », ou « ≤ x » au plancher 1 / (tirages + 1) (aucun tirage n'atteint l'observée). */
const fmtP = (p: number, tirages: number): string => `${p <= 1 / (tirages + 1) + 1e-12 ? "≤" : "="} ${fmt(p, 4)}`;

function verdict(b: Bloc[]): "FAVORABLE" | "DEFAVORABLE" | "NON_CONCLUANT" {
  if (b.some((x) => x.statut === "insuffisant")) return "NON_CONCLUANT";
  if (b.some((x) => x.statut === "echec")) return "DEFAVORABLE";
  return "FAVORABLE";
}

/** Formulations pré-déclarées des infobulles (valeurs du résultat regroupé à l'horizon principal). */
interface Formulations { fortAchat: string; forteVente: string; venteForteAxis: string | null }
const pct = (bps: number): string => `${bps > 0 ? "+" : ""}${(bps / 100).toFixed(2)}`;

function formulations(v: ReturnType<typeof verdict>, achats: Stat | null, ventes: Stat | null, ventesAxis: Stat | null): Formulations {
  const S = M.suites;
  const fortAchat =
    v === "FAVORABLE" && achats !== null
      ? S.infobulleFortAchat.replace("{moyennePct}", pct(achats.moyenneBps)).replace("{hitsPct}", fmt(achats.hitsPct, 0)).replace("{p}", fmtP(achats.pUni, T.tirages))
      : v === "DEFAVORABLE"
        ? S.infobulleDefavorable
        : "couche flux non mesurée";
  const forteVente =
    v !== "FAVORABLE" || ventes === null
      ? fortAchat
      : ventes.pBi <= P_MAX
        ? S.infobulleForteVente.significatif
            .replace("{continué de baisser|rebondi}", ventes.moyenneBps > 0 ? "continué de baisser" : "rebondi")
            .replace("{moyennePct}", (Math.abs(ventes.moyenneBps) / 100).toFixed(2))
            .replace("{p}", fmtP(ventes.pBi, T.tirages))
        : S.infobulleForteVente.nonSignificatif;
  const venteForteAxis =
    v === "FAVORABLE" && ventesAxis !== null && ventesAxis.n >= MIN_VENTES_FORTES_AXIS && ventesAxis.pUni <= P_MAX && ventesAxis.moyenneBps > 0
      ? S.infobulleVenteForte.replace("{moyennePct}", (ventesAxis.moyenneBps / 100).toFixed(2)).replace("{p}", fmtP(ventesAxis.pUni, T.tirages))
      : null;
  return { fortAchat, forteVente, venteForteAxis };
}

// ─────────────────────────── Rapport ───────────────────────────

const ligne = (cells: Array<string | number>): string => `| ${cells.join(" | ")} |`;
const tableau = (entetes: string[], lignes: Array<Array<string | number>>): string =>
  [ligne(entetes), `|${entetes.map(() => "---").join("|")}|`, ...lignes.map(ligne)].join("\n");
const jour = (texte: string): string => texte.slice(0, 16).replace("T", " ");
const LIBELLE_VERDICT = { FAVORABLE: "FAVORABLE", DEFAVORABLE: "DÉFAVORABLE", NON_CONCLUANT: "NON CONCLUANT" } as const;
const LIBELLE_BLOC = { tenu: "✅ tenu", echec: "❌ échec", insuffisant: "⚠️ insuffisant" } as const;
const celluleStat = (s: Stat): string => (s.n === 0 ? "0 / — / — / —" : `${s.n} / ${fmt(s.moyenneBps, 0)} / ${fmt(s.hitsPct, 0)} / ${fmt(s.pBi, 4)}`);
const lignePermutation = (id: string, q: StatPermutation): Array<string | number> => [
  id, q.total, q.n, fmt(q.moyenneTousBps, 0), fmt(q.moyenneAchatsBps, 0), fmt(q.medianeNulleBps, 0), q.n === 0 ? "—" : fmt(q.pUni, 4),
];

function rapport(
  cellules: Cellule[], b: Bloc[], v: ReturnType<typeof verdict>, communs: Array<{ h: number; achats: Stat; ventes: Stat }> | null,
  permutation: StatPermutation | null, ventesAxis: Stat | null, f: Formulations, runnerSha256: string
): string {
  const dispo = cellules.flatMap((c) => (c.statut.statut === "disponible" ? [{ id: c.id, r: c.statut.resultat }] : []));
  const principal = communs?.find((x) => x.h === H_PRINCIPAL) ?? null;
  const p: string[] = [];
  p.push(ESSAI ? "# AXIS — couche flux : RÉPÉTITION TECHNIQUE sur données déjà vues (sans valeur probante)" : "# AXIS — couche flux : test final sur données jamais vues, 8 octobre 2026");
  p.push(
    `Généré par \`scripts/valider-axis-flux.ts\`${ESSAI ? " --essai" : ""}. Manifeste figé \`${HASH_MANIFESTE}\` ` +
      "(`scripts/axis/manifeste-flux-2026-10-08.json`, figé avant tout téléchargement de ces données). " +
      "**Toutes les valeurs sont des mesures PASSÉES, jamais une promesse de performance.** " +
      "Rendement signé = sens × ln(open[i+1+h] / open[i+1]) : positif = continuation du mouvement, négatif = retour. Cellule des tableaux = « N / moyenne en bps / % de continuation / p bilatérale »."
  );
  if (avertissements.length > 0) p.push(`**Avertissements (répétition)** :\n${avertissements.map((x) => `- ${x}`).join("\n")}`);
  p.push(`## Verdict pré-déclaré : **${LIBELLE_VERDICT[v]}**`);
  p.push(
    [
      `- **C1** — forts achats, horizon ${H_PRINCIPAL} bougies, cellules regroupées, décalage circulaire commun : p unilatérale (continuation) ≤ ${P_MAX}.`,
      `- **C2** — forts achats, horizon ${H_PRINCIPAL} : rendement signé moyen > 0 dans au moins ${MIN_CELLULES_POSITIVES} cellules sur ${CELLULES.length}.`,
      `- Chaque cellule doit compter au moins ${MIN_EVENEMENTS} forts achats évalués, sinon NON CONCLUANT.`,
    ].join("\n")
  );
  p.push(tableau(["Critère", "Bloc", "Statut", "Détail"], b.map((x) => [x.critere, x.cle, LIBELLE_BLOC[x.statut], x.detail])));
  const indisponibles = cellules.flatMap((c) => (c.statut.statut === "indisponible" ? [`${c.id} : ${c.statut.erreur}`] : []));
  if (indisponibles.length > 0) p.push(`**Cellules indisponibles** :\n${indisponibles.map((x) => `- ${x}`).join("\n")}`);

  p.push("## Protocole");
  p.push(
    [
      `- **Événement** : marqueur « fort achat / forte vente » d'AXIS aux défauts livrés — volume ≥ ${P.seuilGros} × la SMA ${P.rvolPeriode} du volume (bougie comprise), sens du delta taker si |delta| ≥ 10 % du volume, sinon du corps ; hors bougies de signal AXIS et hors dernière bougie (\`grosMouvementsAxis\`). Delta taker depuis le volume taker acheteur des klines (champ 9) ; intérêt ouvert hors mesure (pas d'historique long).`,
      `- **Données** : klines Binance Spot (\`${ESSAI ? "cache d'exploration" : ENDPOINT}\`), bougies 4h clôturées, du début de chaque cellule au \`${iso(FIN)}\` exclu.`,
      `- **Évaluation** : ${WARMUP} bougies de warmup ; décisions des indices ${WARMUP - 1} à n − 2 − ${H_MAX} (chaque événement dispose de ses ${H_MAX} bougies suivantes ; mêmes événements à tous les horizons).`,
      `- **Statistique** : somme des rendements signés à ${H_PRINCIPAL} bougies ; nul = ${T.tirages} décalages circulaires des événements dans la fenêtre évaluée de chaque cellule (mêmes effectifs, mêmes sens, même regroupement), un même décalage pour toutes les cellules, k entre ${T.fractionMin * 100} % et ${T.fractionMax * 100} % de la plus courte fenêtre ; graine ${T.graine}. Nul complémentaire descriptif : ${M.mesures.permutationSens.tirages} permutations des sens parmi tous les forts mouvements de chaque cellule (graine ${M.mesures.permutationSens.graine}).`,
      `- **Code** : les fichiers figés du manifeste sont vérifiés par SHA-256 avant le premier téléchargement. SHA-256 du runner : \`${runnerSha256}\`.`,
      "- **Contrôles bloquants passés** (sinon : arrêt sans verdict, ce rapport n'existerait pas) : événements = marqueurs --accent du chart (60 derniers) et signaux = marqueurs du chart (120 derniers) ; causalité sur trois préfixes des données réelles ; horizon disponible pour chaque événement ; statistique directe = statistique par sommes préfixes.",
    ].join("\n")
  );

  p.push("## Données");
  p.push(
    tableau(
      ["Cellule", "Bougies", "Premier open", "Dernière clôture", "Manquantes (dont écartées)", "Décisions évaluées", "Forts achats", "Fortes ventes", "SHA-256 OHLCV+taker"],
      dispo.map(({ id, r }) => [
        id, r.acquisition.nombre, jour(r.acquisition.premierOpen), jour(r.acquisition.dernierClose),
        `${r.acquisition.manquantes} (${r.acquisition.ecartees.length})`, r.evaluation.decisions, r.evenements.achats, r.evenements.ventes,
        `\`${r.acquisition.sha256Ohlcv.slice(0, 12)}…\``,
      ])
    )
  );
  const plages = dispo.flatMap(({ id, r }) => r.acquisition.plagesManquantes.map((x) => `${id} : ${x.bougies} bougie(s) entre ${jour(x.apres)} et ${jour(x.reprise)}`));
  if (plages.length > 0) p.push(`Bougies manquantes (maintenances de la source ou bougies écartées ; série utilisée telle que servie) :\n${plages.map((x) => `- ${x}`).join("\n")}`);
  const ecartees = dispo.flatMap(({ id, r }) => r.acquisition.ecartees.map((x) => `${id} : ${jour(x.temps)} (${x.raison})`));
  if (ecartees.length > 0) p.push(`Bougies servies mais écartées (comptées comme manquantes) :\n${ecartees.map((x) => `- ${x}`).join("\n")}`);

  p.push(`## C1 et C2 — forts achats à ${H_PRINCIPAL} bougies`);
  if (principal !== null) {
    p.push(
      tableau(
        ["Statistique (cellules regroupées)", "Valeur"],
        [
          ["Forts achats", principal.achats.n],
          ["Rendement signé moyen", `${fmt(principal.achats.moyenneBps, 0)} bps (${pct(principal.achats.moyenneBps)} %)`],
          ["Médiane", `${fmt(principal.achats.medianeBps, 0)} bps`],
          ["Continuation (rendement > 0)", `${fmt(principal.achats.hitsPct, 1)} %`],
          ["t (naïf, événements supposés indépendants)", fmt(principal.achats.t, 2)],
          ["p unilatérale (décalage commun)", fmt(principal.achats.pUni, 4)],
          ["Médiane / 95e centile des décalages", `${fmt(principal.achats.medianeNulleBps, 0)} / ${fmt(principal.achats.q95NulleBps, 0)} bps`],
          [`Net de ${COUT_ALLER_RETOUR_PCT} % aller-retour`, `${fmt(principal.achats.moyenneBps - COUT_ALLER_RETOUR_PCT * 100, 0)} bps`],
          ["Plus courte fenêtre (décisions)", principal.achats.L],
        ]
      )
    );
  }
  p.push(
    tableau(
      ["Cellule", "Forts achats", "Moyenne bps", "Médiane bps", "Continuation %", "t", "p unilatérale (décalage propre)"],
      dispo.map(({ id, r }) => {
        const s = statPrincipale(r);
        return [id, s.n, fmt(s.moyenneBps, 0), fmt(s.medianeBps, 0), fmt(s.hitsPct, 1), fmt(s.t, 2), fmt(s.pUni, 4)];
      })
    )
  );

  p.push("## Descriptif (sans effet sur le verdict, aucune sélection)");
  p.push(`### Nul complémentaire : permutation des sens parmi tous les forts mouvements (horizon ${H_PRINCIPAL})`);
  p.push(
    "Les forts achats sont-ils suivis de plus de hausse que les forts mouvements en général (fortes ventes comprises) ? Instants, effectifs et volatilité locale préservés ; seul le sens est tiré au sort."
  );
  p.push(
    tableau(
      ["Cellule", "Forts mouvements", "dont forts achats", "Moyenne brute de tous (bps)", "Moyenne des forts achats (bps)", "Médiane nulle (bps)", "p unilatérale"],
      [...dispo.map(({ id, r }) => lignePermutation(id, r.permutationSens)), ...(permutation === null ? [] : [lignePermutation("**Regroupé**", permutation)])]
    )
  );
  p.push("### Tous horizons, cellules regroupées");
  if (communs !== null) {
    p.push(
      tableau(
        ["Événements", ...HORIZONS.map((h) => `h = ${h}`)],
        [
          ["Forts achats", ...communs.map((x) => celluleStat(x.achats))],
          ["Fortes ventes", ...communs.map((x) => celluleStat(x.ventes))],
        ]
      )
    );
  }
  p.push("### Tous horizons, par cellule (décalage propre)");
  p.push(
    tableau(
      ["Cellule", "Événements", ...HORIZONS.map((h) => `h = ${h}`)],
      dispo.flatMap(({ id, r }) => [
        [id, "Forts achats", ...r.horizons.map((x) => celluleStat(x.achats))],
        [id, "Fortes ventes", ...r.horizons.map((x) => celluleStat(x.ventes))],
      ])
    )
  );
  p.push(`### Forts achats et EMA ${P.emaTendance} (horizon ${H_PRINCIPAL})`);
  p.push(
    tableau(
      ["Cellule", "Au-dessus : N / bps / % / p bi", "Sous : N / bps / % / p bi"],
      dispo.map(({ id, r }) => [id, celluleStat(r.tendance.achatsAuDessus), celluleStat(r.tendance.achatsSous)])
    )
  );
  p.push(`### Par année (forts achats / fortes ventes ; moyenne des forts achats à ${H_PRINCIPAL} bougies en bps)`);
  const annees = [...new Set(dispo.flatMap(({ r }) => r.evenements.parAn.map((x) => x.annee)))].sort((x, y) => x - y);
  p.push(
    tableau(
      ["Année", ...dispo.map(({ id }) => id)],
      annees.map((annee) => [
        annee,
        ...dispo.map(({ r }) => {
          const x = r.evenements.parAn.find((y) => y.annee === annee);
          return x === undefined ? "—" : `${x.achats} / ${x.ventes} ; ${fmt(x.moyenneAchats12Bps, 0)}`;
        }),
      ])
    )
  );
  p.push("### Signaux AXIS v2 par qualité de flux à l'entrée (rejeu close-à-close, hors frais)");
  p.push(
    tableau(
      ["Cellule", ...["fort", "ordinaire", "contre-sens", "indisponible"].map((q) => `${q} : trades / exp. % / gagnants %`)],
      dispo.map(({ id, r }) => [id, ...r.signauxAxis.achatsParQualite.map((q) => `${q.trades} / ${fmt(q.expectancyPct, 2)} / ${fmt(q.gagnantsPct, 0)}`)])
    )
  );
  p.push(
    ventesAxis === null
      ? "Ventes AXIS « fortes » : non calculées."
      : `Ventes AXIS « fortes » (cellules regroupées, rendement signé −1 × ln à ${H_PRINCIPAL} bougies après la sortie) : ${ventesAxis.n} ventes, ${fmt(ventesAxis.moyenneBps, 0)} bps en moyenne, ${fmt(ventesAxis.hitsPct, 0)} % de baisses supplémentaires, p unilatérale ${ventesAxis.n >= MIN_VENTES_FORTES_AXIS ? fmtP(ventesAxis.pUni, T.tirages) : `non calculée (effectif < ${MIN_VENTES_FORTES_AXIS})`}.`
  );

  p.push("## Formulations pré-déclarées des infobulles");
  p.push(
    [
      `- **Fort achat**${v === "FAVORABLE" ? "" : " (verdict non favorable)"} : « ${f.fortAchat} »`,
      `- **Forte vente** : « ${f.forteVente} »`,
      `- **Vente forte (signal AXIS)** : ${f.venteForteAxis === null ? "aucune formulation mesurée (effectif, p ou verdict insuffisants) ; « non mesurée » reste" : `« ${f.venteForteAxis} »`}`,
      "- Garde : ces formulations ne s'affichent que sur une bougie dont le delta taker est disponible (population mesurée : klines Binance avec volume taker) ; sans delta taker, le sens vient du corps seul et « couche flux non mesurée » reste.",
    ].join("\n")
  );

  p.push("## Limites");
  p.push(
    [
      "- Quatre alts crypto spot Binance, une seule unité (4h), même facteur de marché que BTC/ETH : la robustesse hors de ce périmètre (BTC/ETH eux-mêmes hors échantillon vu, autres unités, marchés sans volume taker) n'est pas établie ; en 1h l'exploration ne voyait presque rien.",
      "- Le sens testé (achats) et l'horizon (12 bougies) viennent de l'exploration sur données vues ; ce test unique contrôle ce choix, il ne l'élimine pas. La définition elle-même est antérieure à toute donnée.",
      "- Les événements sont conditionnés sur le volume, donc sur la volatilité, et se regroupent dans les phases agitées ; le décalage circulaire préserve ce regroupement mais pas la volatilité locale de chaque bougie d'événement, et suppose une série à peu près stationnaire ; le nul par permutation des sens (descriptif) préserve instants et volatilité mais répond à une autre question ; le t naïf suppose des événements indépendants et n'est qu'indicatif.",
      "- Rendement log sans coût ni slippage, fill à l'open suivant : un repère de lecture (« que fait le prix après ? »), pas une stratégie exécutable ; aucun stop, aucune gestion du risque.",
      "- L'intérêt ouvert n'est pas mesuré (pas d'historique long) ; dans le chart, les lectures d'OI restent descriptives et le disent.",
      "- Puissance : avec quelques centaines d'événements regroupés (une centaine par cellule), un effet de l'ordre de 1 % à 12 bougies est détectable ; un effet plus petit ne le serait pas, et un échec ne prouverait pas l'absence d'effet.",
    ].join("\n")
  );
  return `${p.join("\n\n")}\n`;
}

// ─────────────────────────── Entrée ───────────────────────────

async function main(): Promise<void> {
  process.stderr.write(ESSAI ? "⚠ RÉPÉTITION sur données déjà vues — sans valeur probante\n" : `✓ manifeste vérifié ${HASH_MANIFESTE}\n`);
  const runnerSha256 = sha256(readFileSync(SCRIPT));
  const codeObserve = Object.fromEntries(Object.keys(M.versions.codeAuFigeageSha256).map((f) => [f, sha256(readFileSync(join(RACINE, f)))]));
  const divergents = Object.entries(M.versions.codeAuFigeageSha256).filter(([f, h]) => codeObserve[f] !== h).map(([f]) => f);
  if (Object.keys(M.versions.codeAuFigeageSha256).length === 0) divergents.push("(aucun fichier figé)");
  if (divergents.length > 0) {
    const message = `code différent du figeage (${divergents.join(", ")})`;
    if (!ESSAI) throw new Error(`${message} — campagne refusée`);
    avertissements.push(message);
  }
  const code = { runnerSha256, observeSha256: codeObserve, identiqueAuFigeage: divergents.length === 0 };

  const acquises: Acquise[] = [];
  for (const c of CELLULES) acquises.push(await acquerir(c));
  process.stderr.write("✓ acquisition complète — mesures\n");
  const cellules: Cellule[] = [];
  try {
    for (const a of acquises) cellules.push(cellule(a));
  } catch (erreur) {
    if (!(erreur instanceof EcartControle)) throw erreur;
    const calculeLeUtc = new Date().toISOString();
    const trace = join(SORTIES, `arret-flux-${calculeLeUtc.replace(/[:.]/g, "-")}.json`);
    mkdirSync(SORTIES, { recursive: true });
    writeFileSync(
      trace,
      `${JSON.stringify({
        schema: "axiom-axis-flux-backtest-arret-v1", essai: ESSAI, manifesteSha256: HASH_MANIFESTE, calculeLeUtc, code,
        arret: "ecart-controle", cellule: erreur.cellule, controle: erreur.controle, message: erreur.message, verdict: null,
      }, null, 2)}\n`
    );
    process.stderr.write(`✋ écart de contrôle : ${erreur.message}\n  ✓ trace écrite : ${trace} (aucun verdict, aucun rapport)\n`);
    process.exit(1);
  }

  const toutes = cellules.every((c) => c.serie !== undefined);
  const jeux = (f: (c: Cellule) => Evenement[]): Jeu[] => cellules.flatMap((c) => (c.serie === undefined ? [] : [{ serie: c.serie, evenements: f(c) }]));
  const communs = toutes ? HORIZONS.map((h) => ({ h, achats: statistique(jeux((c) => c.achats!), h), ventes: statistique(jeux((c) => c.ventes!), h) })) : null;
  const principal = communs?.find((x) => x.h === H_PRINCIPAL) ?? null;
  const permutation = toutes
    ? permutationSens(cellules.map((c) => ({ serie: c.serie!, achats: c.achats!, ventes: c.ventes! })), H_PRINCIPAL)
    : null;
  const ventesAxis = toutes ? statistique(jeux((c) => c.ventesFortesAxis!), H_PRINCIPAL) : null;
  const b = blocs(cellules, principal?.achats ?? null);
  const v = verdict(b);
  const f = formulations(v, principal?.achats ?? null, principal?.ventes ?? null, ventesAxis);
  const resultat = {
    schema: "axiom-axis-flux-backtest-result-v1",
    essai: ESSAI,
    manifesteSha256: HASH_MANIFESTE,
    calculeLeUtc: new Date().toISOString(),
    runtime: { bun: process.versions.bun ?? null, node: process.versions.node },
    code,
    avertissements,
    verdict: v,
    blocs: b,
    regroupe: communs,
    regroupePermutationSens: permutation,
    ventesFortesAxis: ventesAxis,
    formulations: f,
    cellules: cellules.map(({ id, statut }) => ({ id, ...statut })),
    strategieValideeAutomatiquement: false,
  };
  mkdirSync(SORTIES, { recursive: true });
  writeFileSync(SORTIE_JSON, `${JSON.stringify(resultat, null, 2)}\n`);
  writeFileSync(SORTIE_MD, rapport(cellules, b, v, communs, permutation, ventesAxis, f, runnerSha256));
  process.stderr.write(`✓ verdict ${LIBELLE_VERDICT[v]}${ESSAI ? " (RÉPÉTITION, sans valeur probante)" : ""} — résultats écrits : ${SORTIE_JSON} et ${SORTIE_MD}\n`);
}

await main();
