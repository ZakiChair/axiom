#!/usr/bin/env bun
/**
 * AXIOM — backtest d'AXIS (stratAxis), campagne du 7 octobre 2026.
 *
 * Script d'ORCHESTRATION (réseau + disque). Protocole, fenêtres, coûts et
 * critères vivent dans `scripts/axis/manifeste-2026-10-07.json`, figé avant
 * tout calcul AXIS : son SHA-256 est vérifié avant le premier fetch, et les
 * valeurs du protocole sont lues dans le manifeste (une seule source).
 *
 * Mesures, toutes sur l'état d'épisode du chart (`votesAxis` + `episodesAxis`) :
 *  1. REJEU chart-fidèle (W1) : `construireTradesStrategie`, close-à-close,
 *     hors frais, global et moitiés temporelles ;
 *  2. EXÉCUTION `runBacktest` (W1 et W2) : décision à la clôture, fill à l'open
 *     suivant, frais + slippage, une jambe longue et une jambe courte.
 * Contrôles bloquants avant tout verdict : l'état de campagne reproduit
 * l'affichage (`prixSignal`), le moteur reproduit la chronologie du rejeu,
 * les coûts ne modifient aucun fill.
 *
 * Tout ce que produit ce script est une mesure PASSÉE, jamais une promesse.
 *
 * Usage (depuis n'importe où) : bun scripts/valider-axis.ts
 * Cache : `scripts/.cache-klines/axis/` (gitignoré, re-vérifié par hash).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candle, IndicatorDef, Timeframe } from "../packages/types/src/index";
import {
  computeIndicator,
  construireTradesStrategie,
  INDICATORS,
  resolveParams,
  type EtatStrategie,
  type TradeStrategie,
} from "../packages/indicators/src/index";
import { episodesAxis, stratAxis, votesAxis } from "../packages/indicators/src/strategy/stratAxis";
import { runBacktest } from "../packages/backtest/src/engine";
import { partagerMoities, statsTrades, type StatsRejeu } from "../packages/backtest/src/statsRejeu";
import type { Condition, Operande, StrategieDef, TradeResultat } from "../packages/backtest/src/types";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = fileURLToPath(import.meta.url);
const MANIFESTE = join(RACINE, "scripts/axis/manifeste-2026-10-07.json");
const HASH_MANIFESTE = "a516571bace590b838c2811d831daaba1ff772122ed7ecda63743c585f63bf0f";
const SORTIE_JSON = join(RACINE, "scripts/axis/resultat-2026-10-07.json");
const SORTIE_MD = join(RACINE, "scripts/axis/rapport-2026-10-07.md");
const DOSSIER_CACHE = join(RACINE, "scripts/.cache-klines/axis");
const LIMITE_PAGE = 1000;
const TF_MS: Record<string, number> = { "1h": 3_600_000, "4h": 14_400_000 };
const MIN_TRADES_W2 = 30;
const SEUILS_OAT = [3, 5] as const;

// ─────────────────────────── Manifeste ───────────────────────────

interface Cout { id: string; frais: number; slippage: number }
interface Manifeste {
  signal: { params: Record<string, number> };
  marche: { endpoint: string; tailleFixeQuote: number; capitalInitialQuote: number };
  cellules: Array<{ symbol: string; timeframe: string }>;
  fenetres: {
    W1: { debutInclus: string; finExclue: string };
    W2: { debutInclus: string; finExclue: string; warmupBougies: number };
  };
  mesures: { coutsParCotePct: Cout[] };
  versions: { codeAuFigeageSha256: Record<string, string> };
}

const sha256 = (contenu: string | Uint8Array): string => createHash("sha256").update(contenu).digest("hex");

function lireManifeste(): Manifeste {
  const brut = readFileSync(MANIFESTE, "utf8");
  const observe = sha256(brut);
  if (observe !== HASH_MANIFESTE) {
    throw new Error(`Manifeste modifié : ${observe}, attendu ${HASH_MANIFESTE}. Aucun calcul autorisé.`);
  }
  return JSON.parse(brut) as Manifeste;
}

const M = lireManifeste();
const ENDPOINT = M.marche.endpoint;
const TAILLE = M.marche.tailleFixeQuote;
const CAPITAL = M.marche.capitalInitialQuote;
const SEUIL_BASE = M.signal.params.seuil ?? Number.NaN;
const W1 = { debut: Date.parse(M.fenetres.W1.debutInclus), fin: Date.parse(M.fenetres.W1.finExclue) };
const W2 = { debut: Date.parse(M.fenetres.W2.debutInclus), fin: Date.parse(M.fenetres.W2.finExclue), warmup: M.fenetres.W2.warmupBougies };
const COUTS = M.mesures.coutsParCotePct;
const coutParId = (id: string): Cout => {
  const c = COUTS.find((x) => x.id === id);
  if (c === undefined) throw new Error(`coût ${id} absent du manifeste`);
  return c;
};
const X1 = coutParId("x1-central");
const X3 = coutParId("x3");

// ─────────────────────────── Données ───────────────────────────

interface Acquisition {
  endpoint: string;
  acquisLeUtc: string;
  modeCalcul: "cache" | "reseau";
  nombre: number;
  premierOpen: string;
  dernierClose: string;
  trous: number;
  sha256Ohlcv: string;
}

/** Klines spot paginées sur `[debut, fin[`, bougies clôturées avant `fin` uniquement. */
async function telecharger(symbol: string, tf: string, debut: number, fin: number): Promise<Candle[]> {
  const tfMs = TF_MS[tf];
  if (tfMs === undefined) throw new Error(`timeframe ${tf} non géré`);
  const parTemps = new Map<number, Candle>();
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
      if (![time, open, high, low, close, volume, closeTime].every(Number.isFinite)) throw new Error("kline Binance non finie");
      if (closeTime + 1 !== time + tfMs) throw new Error(`closeTime incohérent à ${new Date(time).toISOString()}`);
      if (time < debut || closeTime >= fin) continue;
      parTemps.set(time, { time, open, high, low, close, volume });
    }
    if (brut.length < LIMITE_PAGE) break;
    const dernier = Number((brut.at(-1) as unknown[])[0]);
    if (!(dernier >= curseur)) throw new Error("pagination Binance sans progression");
    curseur = dernier + 1;
    process.stderr.write(`\r  … ${symbol} ${tf} : ${parTemps.size} bougies`);
  }
  return [...parTemps.values()].sort((a, b) => a.time - b.time);
}

function verifierOhlcv(candles: Candle[]): void {
  for (const c of candles) {
    const fini = [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite);
    if (!fini || c.open <= 0 || c.close <= 0 || c.volume < 0 || c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close)) {
      throw new Error(`OHLCV invalide à ${new Date(c.time).toISOString()}`);
    }
  }
}

function compterTrous(candles: Candle[], tfMs: number): number {
  let trous = 0;
  for (let i = 1; i < candles.length; i++) {
    const ecart = candles[i]!.time - candles[i - 1]!.time;
    if (ecart !== tfMs) trous += Math.max(1, Math.round(ecart / tfMs) - 1);
  }
  return trous;
}

async function charger(fenetre: "W1" | "W2", symbol: string, tf: string, debut: number, fin: number): Promise<{ candles: Candle[]; acquisition: Acquisition }> {
  const tfMs = TF_MS[tf];
  if (tfMs === undefined) throw new Error(`timeframe ${tf} non géré`);
  const fichier = join(DOSSIER_CACHE, `${fenetre}-${symbol}-${tf}.json`);
  let candles: Candle[];
  let acquisLeUtc: string;
  let modeCalcul: Acquisition["modeCalcul"];
  if (existsSync(fichier)) {
    const enveloppe = JSON.parse(readFileSync(fichier, "utf8")) as {
      endpoint: string; debut: number; fin: number; acquisLeUtc: string; sha256Ohlcv: string; candles: Candle[];
    };
    if (enveloppe.endpoint !== ENDPOINT || enveloppe.debut !== debut || enveloppe.fin !== fin || sha256(JSON.stringify(enveloppe.candles)) !== enveloppe.sha256Ohlcv) {
      throw new Error(`cache ${fichier} non traçable : le supprimer pour re-télécharger`);
    }
    candles = enveloppe.candles;
    acquisLeUtc = enveloppe.acquisLeUtc;
    modeCalcul = "cache";
  } else {
    candles = await telecharger(symbol, tf, debut, fin);
    acquisLeUtc = new Date().toISOString();
    modeCalcul = "reseau";
  }
  // Validation AVANT toute mise en cache : une série invalide ne doit jamais
  // être écrite puis relue. Les bornes exactes sont exigées sur W1 comme sur W2
  // (alignées 1h et 4h) : une pagination interrompue trop tôt échoue ici, pas
  // en silence.
  if (candles.length === 0) throw new Error("série vide");
  verifierOhlcv(candles);
  if (candles[0]!.time !== debut) throw new Error(fenetre === "W2" ? "warmup W2 incomplet" : "début W1 incomplet");
  if (candles.at(-1)!.time + tfMs !== fin) throw new Error(`borne finale ${fenetre} incomplète`);
  const trous = compterTrous(candles, tfMs);
  if (fenetre === "W2" && trous > 0) throw new Error(`${trous} bougie(s) manquante(s) : série W2 discontinue`);
  if (modeCalcul === "reseau") {
    mkdirSync(DOSSIER_CACHE, { recursive: true });
    writeFileSync(fichier, JSON.stringify({ endpoint: ENDPOINT, debut, fin, acquisLeUtc, sha256Ohlcv: sha256(JSON.stringify(candles)), candles }));
  }
  process.stderr.write(`\r  ✓ ${fenetre} ${symbol} ${tf} : ${candles.length} bougies (${modeCalcul})\n`);
  return {
    candles,
    acquisition: {
      endpoint: ENDPOINT, acquisLeUtc, modeCalcul, nombre: candles.length,
      premierOpen: new Date(candles[0]!.time).toISOString(),
      dernierClose: new Date(candles.at(-1)!.time + tfMs).toISOString(),
      trous, sha256Ohlcv: sha256(JSON.stringify(candles)),
    },
  };
}

// ─────────────────────────── État d'épisode et règles ───────────────────────────

/** État d'épisode, calculé exactement comme `stratAxis.calc` (score, seuil, fin = n−2). */
function etatsAxis(candles: Candle[], params: Record<string, number | boolean | string>): Array<EtatStrategie | undefined> {
  const p = resolveParams(stratAxis, params);
  const score = votesAxis(candles, p).map((v) => v?.reduce((a, b) => a + b, 0));
  return episodesAxis(score, Number(p.seuil), candles.length - 2) as Array<EtatStrategie | undefined>;
}

/**
 * Le moteur ne résout que des ids du registre, et l'état −1/0/+1 n'est volontairement
 * pas une sortie publique d'AXIS (jamais de telle série sur le pane prix). La def
 * ci-dessous n'existe que dans le registre de ce processus de campagne.
 */
const ID_ETAT = "axisEtatCampagne";
const defEtat: IndicatorDef = {
  ...stratAxis,
  id: ID_ETAT,
  name: "AXIS — état d'épisode (campagne)",
  outputs: [{ key: "etat", name: "État d'épisode", style: "line" }],
  calc: (candles, params) => ({ series: { etat: etatsAxis(candles, params) } }),
};
if (!INDICATORS.some((d) => d.id === ID_ETAT)) INDICATORS.push(defEtat);

const etat = (seuil: number): Operande => ({ type: "indicateur", indicateurId: ID_ETAT, params: { ...M.signal.params, seuil }, output: "etat" });
const cst = (valeur: number): Operande => ({ type: "constante", valeur });
const croise = (a: Operande, b: Operande, sens: "hausse" | "baisse"): Condition => ({ type: "croisement", a, b, sens });
const cmp = (gauche: Operande, comparateur: "<" | ">", droite: Operande): Condition => ({ type: "comparaison", gauche, comparateur, droite });

/** Entrée = naissance de l'épisode (croisement, jamais un épisode déjà en cours) ; sortie = fin de l'épisode. */
const jambeLongue = (seuil: number): StrategieDef => ({
  direction: "long", tailleFixe: TAILLE,
  reglesEntree: [croise(etat(seuil), cst(0.5), "hausse")],
  reglesSortie: [cmp(etat(seuil), "<", cst(0.5))],
});
const jambeCourte = (seuil: number): StrategieDef => ({
  direction: "short", tailleFixe: TAILLE,
  reglesEntree: [croise(etat(seuil), cst(-0.5), "baisse")],
  reglesSortie: [cmp(etat(seuil), ">", cst(-0.5))],
});

// ─────────────────────────── Mesures ───────────────────────────

interface MesureRejeu {
  global: StatsRejeu; m1: StatsRejeu; m2: StatsRejeu; longs: StatsRejeu; shorts: StatsRejeu;
  trades: TradeStrategie[]; ouvert: TradeStrategie | null;
}

function rejouer(candles: Candle[], seuil: number): MesureRejeu {
  const { trades, ouvert } = construireTradesStrategie(candles, etatsAxis(candles, { ...M.signal.params, seuil }));
  const { m1, m2 } = partagerMoities(trades, candles.length);
  return {
    global: statsTrades(trades), m1: statsTrades(m1), m2: statsTrades(m2),
    longs: statsTrades(trades.filter((t) => t.sens === 1)), shorts: statsTrades(trades.filter((t) => t.sens === -1)),
    trades, ouvert,
  };
}

interface MetriquesExecution {
  trades: number;
  /** Trades clos par règle (hors liquidation de fin de données). */
  fermes: number;
  longs: number;
  shorts: number;
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
}

/** Agrégats d'une liste de trades moteur (jambes réunies) ; DD sur le PnL RÉALISÉ cumulé. */
function metriques(trades: TradeResultat[]): MetriquesExecution {
  const n = trades.length;
  const somme = (f: (t: TradeResultat) => number) => trades.reduce((s, t) => s + f(t), 0);
  const gains = somme((t) => (t.pnl > 0 ? t.pnl : 0));
  const pertes = somme((t) => (t.pnl < 0 ? -t.pnl : 0));
  let cumul = 0;
  let pic = 0;
  let dd = 0;
  for (const t of [...trades].sort((a, b) => a.tempsSortie - b.tempsSortie || a.tempsEntree - b.tempsEntree)) {
    cumul += t.pnl;
    pic = Math.max(pic, cumul);
    dd = Math.max(dd, pic - cumul);
  }
  return {
    trades: n,
    fermes: trades.filter((t) => t.raison !== "fin-donnees").length,
    longs: trades.filter((t) => t.sens === "long").length,
    shorts: trades.filter((t) => t.sens === "short").length,
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
  };
}

interface MesureExecution {
  cout: string;
  seuil: number;
  reunies: MetriquesExecution;
  longue: MetriquesExecution;
  courte: MetriquesExecution;
  trades: TradeResultat[];
}

function executer(
  candles: Candle[], tf: string, seuil: number, cout: Cout, bornes: { debutEvaluationMs?: number; finDonneesMs?: number },
): MesureExecution {
  const params = { timeframe: tf as Timeframe, fraisPct: cout.frais, slippagePct: cout.slippage, capitalInitial: CAPITAL, ...bornes };
  const longue = runBacktest(candles, jambeLongue(seuil), params).trades;
  const courte = runBacktest(candles, jambeCourte(seuil), params).trades;
  const trades = [...longue, ...courte].sort((a, b) => a.tempsEntree - b.tempsEntree || a.tempsSortie - b.tempsSortie);
  return { cout: cout.id, seuil, reunies: metriques(trades), longue: metriques(longue), courte: metriques(courte), trades };
}

const chronologie = (trades: TradeResultat[]): string => trades.map((t) => `${t.sens}:${t.tempsEntree}:${t.tempsSortie}:${t.raison}`).join("|");

// ─────────────────────────── Contrôles bloquants ───────────────────────────

/**
 * Écart détecté par un contrôle bloquant : ARRÊT sans verdict (manifeste :
 * « en cas d'écart : arrêt sans verdict »), jamais absorbé en cellule
 * « indisponible » — seules les erreurs d'acquisition ou de données y ont droit.
 */
class EcartControle extends Error {}

/**
 * L'état de campagne doit reproduire l'affichage À L'IDENTIQUE : miroir de la
 * logique `ref` de `stratAxis.calc` — prixSignal indéfini hors épisode ET
 * pendant l'épisode initial silencieux (naissance sans état précédent défini),
 * égal au close de naissance et tenu pendant tout l'épisode. Contrôle presque
 * tautologique par construction : il protège la résolution des paramètres et
 * la logique `ref`, pas les votes eux-mêmes.
 */
function controlerAffichage(cle: string, candles: Candle[], seuil: number): void {
  const params = { ...M.signal.params, seuil };
  const etats = etatsAxis(candles, params);
  const prixSignal = computeIndicator(stratAxis, candles, params).series.prixSignal ?? [];
  let ref: number | undefined;
  for (let i = 0; i < candles.length; i++) {
    const e = etats[i];
    const p = i > 0 ? etats[i - 1] : undefined;
    if (e !== p) ref = e !== undefined && e !== 0 && p !== undefined ? candles[i]!.close : undefined;
    const attendu = e !== undefined && e !== 0 ? ref : undefined;
    if (prixSignal[i] !== attendu) {
      throw new EcartControle(
        `${cle} : prixSignal ${prixSignal[i]} ≠ ${attendu} à ${new Date(candles[i]!.time).toISOString()} (seuil ${seuil})`
      );
    }
  }
}

/**
 * Le moteur (fill à l'open i+1) doit reproduire EXACTEMENT les décisions du
 * rejeu (close i) : trades clos par règle, et le trade encore ouvert (sens et
 * bougie d'entrée). `rejeu` peut être filtré (W2 : décisions post-warmup).
 */
function controlerChronologie(
  cle: string,
  candles: Candle[],
  rejeu: { trades: TradeStrategie[]; ouvert: TradeStrategie | null },
  execution: MesureExecution
): void {
  const index = new Map(candles.map((c, i) => [c.time, i]));
  const decision = (temps: number): number => {
    const i = index.get(temps);
    if (i === undefined) throw new EcartControle(`${cle} : fill hors série à ${temps}`);
    return i - 1;
  };
  const moteur = execution.trades
    .filter((t) => t.raison === "regle")
    .map((t) => `${t.sens === "long" ? 1 : -1}:${decision(t.tempsEntree)}:${decision(t.tempsSortie)}`)
    .sort();
  const attendu = rejeu.trades.map((t) => `${t.sens}:${t.idxEntree}:${t.idxSortie}`).sort();
  if (moteur.join("|") !== attendu.join("|")) {
    throw new EcartControle(`${cle} : chronologie moteur (${moteur.length} trades) ≠ rejeu (${attendu.length} trades)`);
  }
  const finDonnees = execution.trades.filter((t) => t.raison === "fin-donnees");
  const ouvert = rejeu.ouvert;
  if (ouvert === null || finDonnees.length !== 1) {
    if (ouvert !== null || finDonnees.length !== 0) {
      throw new EcartControle(
        `${cle} : ${finDonnees.length} position(s) fin-données, trade ouvert du rejeu ${ouvert === null ? "absent" : "présent"}`
      );
    }
    return;
  }
  const t = finDonnees[0]!;
  if ((t.sens === "long" ? 1 : -1) !== ouvert.sens || decision(t.tempsEntree) !== ouvert.idxEntree) {
    throw new EcartControle(
      `${cle} : position fin-données ${t.sens} entrée ${decision(t.tempsEntree)} ≠ rejeu ${ouvert.sens} entrée ${ouvert.idxEntree}`
    );
  }
}

function controlerCouts(cle: string, executions: MesureExecution[]): void {
  const parSeuil = new Map<number, string>();
  for (const e of executions) {
    const c = chronologie(e.trades);
    const reference = parSeuil.get(e.seuil);
    if (reference === undefined) parSeuil.set(e.seuil, c);
    else if (reference !== c) throw new EcartControle(`${cle} : les coûts ont modifié les fills (seuil ${e.seuil}, ${e.cout})`);
  }
}

// ─────────────────────────── Cellules ───────────────────────────

interface ResultatW1 {
  acquisition: Acquisition;
  achatConservationPct: number;
  rejeu: Record<string, Omit<MesureRejeu, "trades" | "ouvert">>;
  executions: Array<Omit<MesureExecution, "trades">>;
  empreinteChronologieX1: string;
}
interface ResultatW2 {
  acquisition: Acquisition;
  achatConservationPct: number;
  executions: Array<Omit<MesureExecution, "trades">>;
  empreinteChronologieX1: string;
}
type Statut<T> = { statut: "disponible"; resultat: T } | { statut: "indisponible"; erreur: string };

const sansTrades = <T extends { trades: unknown; ouvert?: unknown }>({
  trades: _t,
  ouvert: _o,
  ...reste
}: T): Omit<T, "trades" | "ouvert"> => reste;
const variationPct = (candles: Candle[], depuis = 0): number => ((candles.at(-1)!.close - candles[depuis]!.open) / candles[depuis]!.open) * 100;

async function cellule(symbol: string, tf: string): Promise<{ id: string; w1: Statut<ResultatW1>; w2: Statut<ResultatW2> }> {
  const id = `${symbol} ${tf}`;
  const tfMs = TF_MS[tf]!;
  const seuils = [SEUIL_BASE, ...SEUILS_OAT];
  let w1: Statut<ResultatW1>;
  try {
    const { candles, acquisition } = await charger("W1", symbol, tf, W1.debut, W1.fin);
    for (const s of seuils) controlerAffichage(`W1 ${id} seuil ${s}`, candles, s);
    const rejeux = new Map(seuils.map((s) => [s, rejouer(candles, s)]));
    const executions = [
      ...COUTS.map((c) => executer(candles, tf, SEUIL_BASE, c, {})),
      ...SEUILS_OAT.map((s) => executer(candles, tf, s, X1, {})),
    ];
    const x1 = executions.find((e) => e.seuil === SEUIL_BASE && e.cout === X1.id)!;
    controlerChronologie(`W1 ${id}`, candles, rejeux.get(SEUIL_BASE)!, x1);
    for (const s of SEUILS_OAT) controlerChronologie(`W1 ${id} seuil ${s}`, candles, rejeux.get(s)!, executions.find((e) => e.seuil === s)!);
    controlerCouts(`W1 ${id}`, executions);
    w1 = {
      statut: "disponible",
      resultat: {
        acquisition,
        achatConservationPct: variationPct(candles),
        rejeu: Object.fromEntries([...rejeux].map(([s, r]) => [`seuil-${s}`, sansTrades(r)])),
        executions: executions.map(sansTrades),
        empreinteChronologieX1: sha256(chronologie(x1.trades)),
      },
    };
  } catch (erreur) {
    if (erreur instanceof EcartControle) throw erreur; // arrêt sans verdict, jamais « indisponible »
    w1 = { statut: "indisponible", erreur: erreur instanceof Error ? erreur.message : String(erreur) };
  }

  let w2: Statut<ResultatW2>;
  try {
    const { candles, acquisition } = await charger("W2", symbol, tf, W2.debut - W2.warmup * tfMs, W2.fin);
    for (const s of seuils) controlerAffichage(`W2 ${id} seuil ${s}`, candles, s);
    const bornes = { debutEvaluationMs: W2.debut, finDonneesMs: W2.fin };
    const executions = [
      ...COUTS.map((c) => executer(candles, tf, SEUIL_BASE, c, bornes)),
      ...SEUILS_OAT.map((s) => executer(candles, tf, s, X1, bornes)),
    ];
    // Chronologie W2 : le moteur doit reproduire les décisions du rejeu prises
    // DEPUIS la clôture de la dernière bougie de warmup (indice warmup − 1, fill
    // à l'open de la première bougie évaluée). Un épisode né avant la fenêtre ne
    // produit aucune entrée : le croisement est consommé avant le début.
    for (const s of seuils) {
      const r = rejouer(candles, s);
      const filtre = {
        trades: r.trades.filter((t) => t.idxEntree >= W2.warmup - 1),
        ouvert: r.ouvert !== null && r.ouvert.idxEntree >= W2.warmup - 1 ? r.ouvert : null,
      };
      const e = executions.find((x) => x.seuil === s && x.cout === X1.id)!;
      controlerChronologie(`W2 ${id} seuil ${s}`, candles, filtre, e);
    }
    controlerCouts(`W2 ${id}`, executions);
    const x1 = executions.find((e) => e.seuil === SEUIL_BASE && e.cout === X1.id)!;
    w2 = {
      statut: "disponible",
      resultat: {
        acquisition,
        achatConservationPct: variationPct(candles, W2.warmup),
        executions: executions.map(sansTrades),
        empreinteChronologieX1: sha256(chronologie(x1.trades)),
      },
    };
  } catch (erreur) {
    if (erreur instanceof EcartControle) throw erreur; // arrêt sans verdict, jamais « indisponible »
    w2 = { statut: "indisponible", erreur: erreur instanceof Error ? erreur.message : String(erreur) };
  }
  return { id, w1, w2 };
}

// ─────────────────────────── Verdict pré-déclaré ───────────────────────────

type StatutBloc = "tenu" | "echec" | "insuffisant";
interface Bloc { critere: "C1" | "C2" | "C3"; cle: string; statut: StatutBloc; detail: string }
type Cellule = Awaited<ReturnType<typeof cellule>>;

const fmt = (v: number | null | undefined, dec = 2): string =>
  v === null || v === undefined ? "—" : !Number.isFinite(v) ? (v > 0 ? "∞" : "—") : v.toFixed(dec);

const execution = (r: { executions: Array<Omit<MesureExecution, "trades">> }, seuil: number, cout: string) =>
  r.executions.find((e) => e.seuil === seuil && e.cout === cout)!;

function blocs(cellules: Cellule[]): Bloc[] {
  const out: Bloc[] = [];
  for (const c of cellules) {
    if (c.w1.statut === "indisponible") {
      out.push({ critere: "C1", cle: c.id, statut: "insuffisant", detail: `W1 indisponible : ${c.w1.erreur}` });
      out.push({ critere: "C2", cle: c.id, statut: "insuffisant", detail: `W1 indisponible : ${c.w1.erreur}` });
    } else {
      const r = c.w1.resultat.rejeu[`seuil-${SEUIL_BASE}`]!;
      for (const [moitie, s] of [["global", r.global], ["M1", r.m1], ["M2", r.m2]] as const) {
        const statut: StatutBloc = s.nbTrades === 0 ? "insuffisant" : s.expectancy > 0 ? "tenu" : "echec";
        out.push({ critere: "C1", cle: `${c.id} ${moitie}`, statut, detail: `${s.nbTrades} trades, expectancy ${fmt(s.expectancy, 3)} %` });
      }
      const m = execution(c.w1.resultat, SEUIL_BASE, X1.id).reunies;
      const statut: StatutBloc = m.trades === 0 || m.expectancyNette === null ? "insuffisant" : m.expectancyNette > 0 ? "tenu" : "echec";
      out.push({ critere: "C2", cle: c.id, statut, detail: `${m.trades} trades, expectancy nette ${fmt(m.expectancyNette, 4)} USDT` });
    }
    for (const cout of [X1, X3]) {
      if (c.w2.statut === "indisponible") {
        out.push({ critere: "C3", cle: `${c.id} ${cout.id}`, statut: "insuffisant", detail: `W2 indisponible : ${c.w2.erreur}` });
        continue;
      }
      const m = execution(c.w2.resultat, SEUIL_BASE, cout.id).reunies;
      const statut: StatutBloc =
        m.trades < MIN_TRADES_W2 || m.expectancyNette === null ? "insuffisant" : m.expectancyNette > 0 ? "tenu" : "echec";
      const viaFinDonnees = m.trades >= MIN_TRADES_W2 && m.fermes < MIN_TRADES_W2;
      out.push({
        critere: "C3",
        cle: `${c.id} ${cout.id}`,
        statut,
        detail:
          `${m.trades} trades (dont ${m.fermes} fermés), expectancy nette ${fmt(m.expectancyNette, 4)} USDT` +
          (viaFinDonnees ? " — seuil atteint SEULEMENT avec la liquidation de fin de données" : ""),
      });
    }
  }
  return out;
}

function verdict(b: Bloc[]): "FAVORABLE" | "DEFAVORABLE" | "NON_CONCLUANT" {
  if (b.some((x) => x.statut === "echec")) return "DEFAVORABLE";
  if (b.some((x) => x.statut === "insuffisant")) return "NON_CONCLUANT";
  return "FAVORABLE";
}

// ─────────────────────────── Rapport ───────────────────────────

const ligne = (cells: Array<string | number>): string => `| ${cells.join(" | ")} |`;
const tableau = (entetes: string[], lignes: Array<Array<string | number>>): string =>
  [ligne(entetes), `|${entetes.map(() => "---").join("|")}|`, ...lignes.map(ligne)].join("\n");
const jour = (iso: string): string => iso.slice(0, 16).replace("T", " ");
const LIBELLE_VERDICT = { FAVORABLE: "FAVORABLE", DEFAVORABLE: "DÉFAVORABLE", NON_CONCLUANT: "NON CONCLUANT" } as const;
const LIBELLE_BLOC = { tenu: "✅ tenu", echec: "❌ échec", insuffisant: "⚠️ insuffisant" } as const;

function ligneExecution(cle: string, m: MetriquesExecution): Array<string | number> {
  return [
    cle, m.trades, `${m.longs}/${m.shorts}`, fmt(m.expectancyNette, 3), fmt(m.expectancyPct, 3), fmt(m.pnlTotalPct),
    fmt(m.profitFactor), fmt(m.winRatePct, 1), fmt(m.ddRealiseMaxPct), fmt(m.dureeMoyenneBarres, 1), fmt(m.fraisTotal, 1),
  ];
}
const ENTETES_EXECUTION = [
  "Cellule", "Trades", "Long/short", "Exp. nette USDT", "Exp. nette %", "PnL % capital", "Profit factor", "Gagnants % (PnL > 0)",
  "DD réalisé % capital", "Durée moy. (bougies)", "Frais USDT (hors slippage)",
];

function rapport(cellules: Cellule[], b: Bloc[], v: ReturnType<typeof verdict>, runnerSha256: string): string {
  const w1 = cellules.flatMap((c) => (c.w1.statut === "disponible" ? [{ id: c.id, r: c.w1.resultat }] : []));
  const w2 = cellules.flatMap((c) => (c.w2.statut === "disponible" ? [{ id: c.id, r: c.w2.resultat }] : []));
  const p: string[] = [];
  p.push("# Backtest d'AXIS — campagne du 7 octobre 2026");
  p.push(
    `Généré par \`scripts/valider-axis.ts\`. Manifeste figé \`${HASH_MANIFESTE}\` ` +
      "(`scripts/axis/manifeste-2026-10-07.json`, figé avant tout calcul AXIS). " +
      "**Toutes les valeurs sont des mesures PASSÉES, jamais une promesse de performance.**"
  );
  p.push(`## Verdict pré-déclaré : **${LIBELLE_VERDICT[v]}**`);
  p.push(
    [
      "- **C1** — W1, rejeu hors frais : expectancy > 0 dans chaque cellule ET chaque moitié (critère champion du spec v2.3 §3).",
      "- **C2** — W1, exécution aux coûts x1 : expectancy nette > 0 dans chaque cellule.",
      `- **C3** — W2, exécution : au moins ${MIN_TRADES_W2} trades et expectancy nette > 0 aux coûts x1 ET x3 dans chaque cellule (critère OOS du manifeste 2026-09-09).`,
    ].join("\n")
  );
  p.push(tableau(["Critère", "Bloc", "Statut", "Détail"], b.map((x) => [x.critere, x.cle, LIBELLE_BLOC[x.statut], x.detail])));
  const indisponibles = cellules.flatMap((c) => [
    ...(c.w1.statut === "indisponible" ? [`W1 ${c.id} : ${c.w1.erreur}`] : []),
    ...(c.w2.statut === "indisponible" ? [`W2 ${c.id} : ${c.w2.erreur}`] : []),
  ]);
  if (indisponibles.length > 0) p.push(`**Cellules indisponibles** :\n${indisponibles.map((x) => `- ${x}`).join("\n")}`);

  p.push("## Protocole");
  p.push(
    [
      `- **Signal** : AXIS aux défauts livrés (seuil ${SEUIL_BASE}/6, EMA 20/50, Supertrend 10 ×3, ADX ≥ 20, MACD 12/26/9, RSI 14, CMF 20). Long pendant un épisode haussier fort, short pendant un épisode baissier fort, à plat sinon. Entrée à la naissance de l'épisode (le ▲/▼ du chart), sortie à sa fin.`,
      `- **Données** : klines Binance Spot (\`${ENDPOINT}\`), bougies clôturées.`,
      `- **W1** : \`[${M.fenetres.W1.debutInclus} → ${M.fenetres.W1.finExclue}[\`, fenêtre figée de la campagne des stratégies.`,
      `- **W2** : \`[${M.fenetres.W2.debutInclus} → ${M.fenetres.W2.finExclue}[\`, ${W2.warmup} bougies de warmup, aucune décision avant le début.`,
      "- **Rejeu** : trades close-à-close hors frais (`construireTradesStrategie`, conventions des marqueurs du chart) ; moitiés = coupe au milieu des bougies, trade rangé selon son entrée.",
      `- **Exécution** : \`runBacktest\`, décision à la clôture, fill à l'open suivant, taille fixe ${TAILLE} USDT, capital ${CAPITAL} USDT ; jambes longue et courte exécutées séparément puis réunies. Coûts par côté : ${COUTS.map((c) => `${c.id} = frais ${c.frais} % + slippage ${c.slippage} %`).join(" ; ")}.`,
      "- **Expectancy nette** : moyenne des PnL nets par trade (USDT), position fin-données comprise. Le DD réalisé est calculé sur le PnL cumulé des clôtures, en % du capital initial.",
      "- **Signes et comptages** : « DD max » du rejeu est NÉGATIF (equity composée), « DD réalisé » de l'exécution est POSITIF ; « Gagnants % » compte un trade nul comme gagnant au rejeu (PnL ≥ 0, hors frais) et l'exige strictement positif à l'exécution (PnL > 0, net). Le slippage est intégré aux prix de fill, jamais dans la colonne « Frais ».",
      `- **Code** : le runner (\`${runnerSha256.slice(0, 12)}…\`) et les cinq fichiers figés du manifeste sont vérifiés par SHA-256 avant le premier téléchargement ; un code différent du figeage refuse la campagne. Les cœurs d'AXIS (supertrend, adx, macd, rsi, cmf, moteur d'indicateurs) ne font pas partie de la liste figée : journalisé dans \`scripts/axis/journal-revue-2026-10-07.md\`.`,
      "- **Contrôles bloquants passés** (sinon : arrêt sans verdict, ce rapport n'existerait pas) : l'état de campagne reproduit `prixSignal` du chart à chaque seuil ; le moteur reproduit exactement les décisions du rejeu (fill décalé d'une bougie) sur W1 et sur W2 (décisions post-warmup) ; les coûts ne modifient aucun fill.",
    ].join("\n")
  );

  p.push("## Données");
  p.push(
    tableau(
      ["Fenêtre", "Cellule", "Bougies", "Premier open", "Dernière clôture", "Trous", "Achat-conservation %", "SHA-256 OHLCV"],
      [
        ...w1.map(({ id, r }) => ["W1", id, r.acquisition.nombre, jour(r.acquisition.premierOpen), jour(r.acquisition.dernierClose), r.acquisition.trous, fmt(r.achatConservationPct), `\`${r.acquisition.sha256Ohlcv.slice(0, 12)}…\``]),
        ...w2.map(({ id, r }) => ["W2", id, r.acquisition.nombre, jour(r.acquisition.premierOpen), jour(r.acquisition.dernierClose), r.acquisition.trous, fmt(r.achatConservationPct), `\`${r.acquisition.sha256Ohlcv.slice(0, 12)}…\``]),
      ]
    )
  );
  p.push("Achat-conservation : variation du prix sur la fenêtre évaluée (W2 : après le warmup), simple référence.");

  p.push("## C1 — W1, rejeu chart-fidèle (hors frais)");
  p.push(
    tableau(
      ["Cellule", "Trades", "Gagnants % (PnL ≥ 0)", "Expectancy %", "PnL composé %", "DD max %", "Durée moy. (bougies)", "Exp. M1 %", "Exp. M2 %"],
      w1.map(({ id, r }) => {
        const x = r.rejeu[`seuil-${SEUIL_BASE}`]!;
        return [id, x.global.nbTrades, fmt(x.global.winRate, 1), fmt(x.global.expectancy, 3), fmt(x.global.pnlComposePct), fmt(x.global.maxDrawdownPct), fmt(x.global.dureeMoyenne, 1), fmt(x.m1.expectancy, 3), fmt(x.m2.expectancy, 3)];
      })
    )
  );

  p.push("## C2 — W1, exécution aux coûts x1");
  p.push(tableau(ENTETES_EXECUTION, w1.map(({ id, r }) => ligneExecution(id, execution(r, SEUIL_BASE, X1.id).reunies))));

  p.push("## C3 — W2, exécution aux coûts x1 et x3");
  p.push(
    tableau(
      ENTETES_EXECUTION,
      w2.flatMap(({ id, r }) => [X1, X3].map((c) => ligneExecution(`${id} ${c.id}`, execution(r, SEUIL_BASE, c.id).reunies)))
    )
  );

  p.push("## Descriptif (sans effet sur le verdict, aucune sélection)");
  p.push("### Jambes séparées");
  p.push(
    tableau(
      ["Cellule", "Rejeu W1 long : trades / exp. %", "Rejeu W1 short : trades / exp. %", "W1 x1 long : trades / exp. USDT", "W1 x1 short : trades / exp. USDT", "W2 x1 long : trades / exp. USDT", "W2 x1 short : trades / exp. USDT"],
      cellules.map((c) => {
        const r1 = c.w1.statut === "disponible" ? c.w1.resultat : undefined;
        const r2 = c.w2.statut === "disponible" ? c.w2.resultat : undefined;
        const rj = r1?.rejeu[`seuil-${SEUIL_BASE}`];
        const e1 = r1 === undefined ? undefined : execution(r1, SEUIL_BASE, X1.id);
        const e2 = r2 === undefined ? undefined : execution(r2, SEUIL_BASE, X1.id);
        const cel = (m: MetriquesExecution | undefined) => (m === undefined ? "—" : `${m.trades} / ${fmt(m.expectancyNette, 3)}`);
        return [
          c.id,
          rj === undefined ? "—" : `${rj.longs.nbTrades} / ${fmt(rj.longs.expectancy, 3)}`,
          rj === undefined ? "—" : `${rj.shorts.nbTrades} / ${fmt(rj.shorts.expectancy, 3)}`,
          cel(e1?.longue), cel(e1?.courte), cel(e2?.longue), cel(e2?.courte),
        ];
      })
    )
  );
  p.push("### Niveaux de coût");
  p.push(
    tableau(
      ENTETES_EXECUTION,
      [
        ...w1.flatMap(({ id, r }) => COUTS.map((c) => ligneExecution(`W1 ${id} ${c.id}`, execution(r, SEUIL_BASE, c.id).reunies))),
        ...w2.flatMap(({ id, r }) => COUTS.map((c) => ligneExecution(`W2 ${id} ${c.id}`, execution(r, SEUIL_BASE, c.id).reunies))),
      ]
    )
  );
  p.push(`### Sensibilité du seuil (OAT ${SEUILS_OAT.join(" et ")}, défaut ${SEUIL_BASE})`);
  p.push(
    tableau(
      ["Cellule", "Seuil", "Rejeu W1 : trades", "Rejeu W1 : exp. %", "Exp. M1 %", "Exp. M2 %", "W1 x1 : exp. nette USDT", "W2 x1 : trades", "W2 x1 : exp. nette USDT"],
      cellules.flatMap((c) =>
        [SEUIL_BASE, ...SEUILS_OAT].map((s) => {
          const r1 = c.w1.statut === "disponible" ? c.w1.resultat : undefined;
          const r2 = c.w2.statut === "disponible" ? c.w2.resultat : undefined;
          const rj = r1?.rejeu[`seuil-${s}`];
          const e1 = r1 === undefined ? undefined : execution(r1, s, X1.id).reunies;
          const e2 = r2 === undefined ? undefined : execution(r2, s, X1.id).reunies;
          return [
            c.id, s === SEUIL_BASE ? `${s} (défaut)` : s, rj?.global.nbTrades ?? "—", fmt(rj?.global.expectancy, 3),
            fmt(rj?.m1.expectancy, 3), fmt(rj?.m2.expectancy, 3), fmt(e1?.expectancyNette, 3), e2?.trades ?? "—", fmt(e2?.expectancyNette, 3),
          ];
        })
      )
    )
  );

  p.push("## Limites");
  p.push(
    [
      "- Deux symboles, deux unités de temps, marché spot sans funding ni marge : la robustesse hors de ce périmètre n'est pas établie.",
      "- W1 est la fenêtre d'étude de la campagne des stratégies ; aucun paramètre d'AXIS n'y a été ajusté, mais ses six cœurs y avaient déjà été mesurés isolément.",
      "- W2 n'est pas un holdout vierge : elle chevauche ~60 % de la fenêtre OOS du 9 septembre 2026, dont les résultats (dont Supertrend 10 ×3, un cœur d'AXIS) étaient connus avant la conception d'AXIS ; et l'absence de consultation d'AXIS lui-même pendant le développement n'est pas attestable.",
      "- W2 couvre environ dix semaines : le seuil de 30 trades de C3 vient de stratégies toujours en position, alors qu'AXIS ne trade que par épisodes — les cellules 4h (~420 bougies) peuvent rester sous le seuil. Un NON CONCLUANT ne se lit pas comme « presque favorable ».",
      "- C2 n'est exigé qu'aux coûts x1 (0,05 % par côté), sous le tarif taker courant de Binance Spot ; x2 et x3 sur W1 restent du descriptif.",
      "- Taille fixe, aucun stop, aucune gestion du risque ; le slippage est un scénario, pas une mesure du carnet.",
      "- Les shorts supposent un emprunt du sous-jacent sans coût, ce que le spot n'offre pas tel quel.",
    ].join("\n")
  );
  return `${p.join("\n\n")}\n`;
}

// ─────────────────────────── Entrée ───────────────────────────

async function main(): Promise<void> {
  process.stderr.write(`✓ manifeste vérifié ${HASH_MANIFESTE}\n`);
  const runnerSha256 = sha256(readFileSync(SCRIPT));
  const codeObserve = Object.fromEntries(
    Object.keys(M.versions.codeAuFigeageSha256).map((f) => [f, sha256(readFileSync(join(RACINE, f)))])
  );
  // Le protocole a été figé CONTRE ce code : un signal ou un moteur modifié
  // depuis le figeage invaliderait la campagne. Refus AVANT le premier fetch.
  const divergents = Object.entries(M.versions.codeAuFigeageSha256)
    .filter(([f, h]) => codeObserve[f] !== h)
    .map(([f]) => f);
  if (divergents.length > 0) {
    throw new Error(`code différent du figeage (${divergents.join(", ")}) — campagne refusée`);
  }
  const code = { runnerSha256, observeSha256: codeObserve, identiqueAuFigeage: true };

  const cellules: Cellule[] = [];
  try {
    for (const { symbol, timeframe } of M.cellules) cellules.push(await cellule(symbol, timeframe));
  } catch (erreur) {
    if (!(erreur instanceof EcartControle)) throw erreur;
    // Manifeste : « en cas d'écart : arrêt sans verdict ». Une trace JSON est
    // écrite, aucun rapport de verdict n'est produit, sortie en erreur.
    mkdirSync(dirname(SORTIE_JSON), { recursive: true });
    writeFileSync(
      SORTIE_JSON,
      `${JSON.stringify(
        {
          schema: "axiom-axis-backtest-result-v1",
          manifesteSha256: HASH_MANIFESTE,
          calculeLeUtc: new Date().toISOString(),
          runtime: { bun: process.versions.bun ?? null, node: process.versions.node },
          code,
          arret: "ecart-controle",
          detail: erreur.message,
          verdict: null,
          cellules,
        },
        null,
        2
      )}\n`
    );
    process.stderr.write(`✋ écart de contrôle : ${erreur.message}\n  ✓ trace écrite : ${SORTIE_JSON} (aucun verdict, aucun rapport)\n`);
    process.exit(1);
  }

  const b = blocs(cellules);
  const v = verdict(b);
  const resultat = {
    schema: "axiom-axis-backtest-result-v1",
    manifesteSha256: HASH_MANIFESTE,
    calculeLeUtc: new Date().toISOString(),
    runtime: { bun: process.versions.bun ?? null, node: process.versions.node },
    code,
    verdict: v,
    blocs: b,
    cellules,
    strategieValideeAutomatiquement: false,
  };
  mkdirSync(dirname(SORTIE_JSON), { recursive: true });
  writeFileSync(SORTIE_JSON, `${JSON.stringify(resultat, null, 2)}\n`);
  writeFileSync(SORTIE_MD, rapport(cellules, b, v, runnerSha256));
  process.stderr.write(`✓ verdict ${LIBELLE_VERDICT[v]} — résultats écrits : ${SORTIE_JSON} et ${SORTIE_MD}\n`);
}

await main();
