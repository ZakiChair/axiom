#!/usr/bin/env bun
/** Campagne OOS figée. Le hash du manifeste est vérifié avant le premier fetch. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candle } from "../packages/types/src/index";
import { monteCarloTrades, mulberry32 } from "../packages/backtest/src/monteCarlo";
import { runBacktest } from "../packages/backtest/src/engine";
import type { Condition, Operande, StrategieDef } from "../packages/backtest/src/types";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = fileURLToPath(import.meta.url);
const MANIFESTE = join(RACINE, "scripts/oos/manifeste-2026-09-09.json");
const HASH_MANIFESTE = "9b3d1c764946c61311467a79c846158759c9deb76c5489364fdaf6c577a749f4";
const DEBUT = Date.parse("2026-07-29T00:00:00Z");
const FIN = Date.parse("2026-09-09T00:00:00Z");
const WARMUP = 200;
const CAPITAL = 10_000;
const TAILLE = 1_000;
const CHEMINS = 1_000;
const SEED = 20_260_909;
const CELLULES = [
  { symbol: "BTCUSDT", tf: "1h" as const, tfMs: 3_600_000 },
  { symbol: "BTCUSDT", tf: "4h" as const, tfMs: 14_400_000 },
  { symbol: "ETHUSDT", tf: "1h" as const, tfMs: 3_600_000 },
  { symbol: "ETHUSDT", tf: "4h" as const, tfMs: 14_400_000 },
] as const;
const COUTS = [
  { id: "x1-central", fraisPct: 0.05, slippagePct: 0.02 },
  { id: "x2", fraisPct: 0.10, slippagePct: 0.04 },
  { id: "x3", fraisPct: 0.15, slippagePct: 0.06 },
] as const;

type CandleAcquise = Candle & { closeTime: number };
type Cellule = typeof CELLULES[number];

function sha256(texte: string | Uint8Array): string {
  return createHash("sha256").update(texte).digest("hex");
}

function verifierManifeste(): void {
  const brut = readFileSync(MANIFESTE, "utf8");
  const observe = sha256(brut);
  if (observe !== HASH_MANIFESTE) throw new Error(`Manifeste modifié : ${observe}, attendu ${HASH_MANIFESTE}. Aucun calcul autorisé.`);
}

function parserKlines(brut: unknown, debut: number, fin: number): CandleAcquise[] {
  if (!Array.isArray(brut)) throw new Error("réponse Binance non tabulaire");
  const resultat: CandleAcquise[] = [];
  for (const ligne of brut) {
    if (!Array.isArray(ligne) || ligne.length < 11) throw new Error("ligne kline Binance invalide");
    const valeurs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => Number(ligne[i]));
    if (!valeurs.every(Number.isFinite)) throw new Error("kline Binance non finie");
    const [time, open, high, low, close, volume, closeTime, quoteVolume, trades, buyVolume] = valeurs as [number, number, number, number, number, number, number, number, number, number];
    if (time < debut || closeTime >= fin) continue;
    resultat.push({ time, open, high, low, close, volume, closeTime, quoteVolume, trades, buyVolume, sellVolume: volume - buyVolume, closed: true });
  }
  return resultat;
}

function validerSerie(candles: CandleAcquise[], cellule: Cellule, acquisitionDebut: number): void {
  if (candles.length === 0) throw new Error("série vide");
  let precedent = acquisitionDebut - cellule.tfMs;
  for (const c of candles) {
    if (c.time !== precedent + cellule.tfMs) throw new Error(`trou ou doublon à ${new Date(c.time).toISOString()}`);
    if (c.closeTime + 1 !== c.time + cellule.tfMs) throw new Error(`closeTime incohérent à ${c.time}`);
    if (![c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) || c.open <= 0 || c.close <= 0 || c.volume < 0 || c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close) || c.low > c.high) {
      throw new Error(`OHLCV invalide à ${c.time}`);
    }
    precedent = c.time;
  }
  if (candles[0]!.time !== acquisitionDebut) throw new Error("warmup incomplet");
  if (candles.at(-1)!.closeTime + 1 !== FIN) throw new Error("borne finale incomplète");
}

async function charger(cellule: Cellule): Promise<{ candles: CandleAcquise[]; acquisition: Record<string, unknown> }> {
  const acquisitionDebut = DEBUT - WARMUP * cellule.tfMs;
  const cache = join(RACINE, `.superpowers/sdd/2026-09-09-revue-integrale/oos-cache/${HASH_MANIFESTE}/${cellule.symbol}-${cellule.tf}.json`);
  let candles: CandleAcquise[];
  let modeCalcul: "cache" | "reseau";
  let modeAcquisitionOriginal: "reseau";
  let acquisLeUtcOriginal: string;
  if (existsSync(cache)) {
    const enveloppe = JSON.parse(readFileSync(cache, "utf8")) as {
      manifesteSha256: string; candles: CandleAcquise[]; sha256Ohlcv: string;
      modeAcquisitionOriginal?: string; acquisLeUtcOriginal?: string;
    };
    if (enveloppe.manifesteSha256 !== HASH_MANIFESTE || sha256(JSON.stringify(enveloppe.candles)) !== enveloppe.sha256Ohlcv) throw new Error("cache OOS non traçable");
    if (enveloppe.modeAcquisitionOriginal !== "reseau" || typeof enveloppe.acquisLeUtcOriginal !== "string") throw new Error("origine réseau du cache OOS non traçable");
    candles = enveloppe.candles;
    modeCalcul = "cache";
    modeAcquisitionOriginal = "reseau";
    acquisLeUtcOriginal = enveloppe.acquisLeUtcOriginal;
  } else {
    candles = [];
    let curseur = acquisitionDebut;
    for (;;) {
      const url = `https://api.binance.com/api/v3/klines?symbol=${cellule.symbol}&interval=${cellule.tf}&startTime=${curseur}&endTime=${FIN - 1}&limit=1000`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Binance Spot ${response.status} ${response.statusText}`);
      const brut: unknown = await response.json();
      const lot = parserKlines(brut, acquisitionDebut, FIN);
      candles.push(...lot);
      if (!Array.isArray(brut) || brut.length < 1000) break;
      const dernier = lot.at(-1)?.time;
      if (dernier === undefined || dernier < curseur) throw new Error("pagination Binance sans progression");
      curseur = dernier + 1;
    }
    candles = [...new Map(candles.map((c) => [c.time, c])).values()].sort((a, b) => a.time - b.time);
    mkdirSync(dirname(cache), { recursive: true });
    modeAcquisitionOriginal = "reseau";
    acquisLeUtcOriginal = new Date().toISOString();
    const contenu = {
      manifesteSha256: HASH_MANIFESTE, sha256Ohlcv: sha256(JSON.stringify(candles)),
      modeAcquisitionOriginal, acquisLeUtcOriginal, candles,
    };
    writeFileSync(cache, JSON.stringify(contenu));
    modeCalcul = "reseau";
  }
  validerSerie(candles, cellule, acquisitionDebut);
  return {
    candles,
    acquisition: {
      source: "Binance Spot", endpoint: "https://api.binance.com/api/v3/klines",
      modeCalcul, modeAcquisitionOriginal, acquisLeUtc: acquisLeUtcOriginal, nombre: candles.length,
      premierOpen: new Date(candles[0]!.time).toISOString(), dernierClose: new Date(candles.at(-1)!.closeTime + 1).toISOString(),
      sha256Ohlcv: sha256(JSON.stringify(candles)),
    },
  };
}

const indicateur = (id: string, params: Record<string, number>, output: string): Operande => ({ type: "indicateur", indicateurId: id, params, output });
const constante = (valeur: number): Operande => ({ type: "constante", valeur });
const comparaison = (gauche: Operande, comparateur: ">" | ">=" | "<", droite: Operande): Condition => ({ type: "comparaison", gauche, comparateur, droite });
const croisement = (a: Operande, b: Operande): Condition => ({ type: "croisement", a, b, sens: "hausse" });

interface Variante { id: string; base: boolean; strategie: StrategieDef }
function variantes(): Variante[] {
  const ema = (rapide: number, lente: number): StrategieDef => ({
    direction: "les-deux", tailleFixe: TAILLE,
    reglesEntree: [comparaison(indicateur("ema", { length: rapide }, "ema"), ">", indicateur("ema", { length: lente }, "ema"))],
    reglesSortie: [comparaison(indicateur("ema", { length: rapide }, "ema"), "<", indicateur("ema", { length: lente }, "ema"))],
  });
  const rsi = (length: number, entree: number, sortie: number): StrategieDef => ({
    direction: "long", tailleFixe: TAILLE,
    reglesEntree: [croisement(indicateur("rsi", { length }, "rsi"), constante(entree))],
    reglesSortie: [comparaison(indicateur("rsi", { length }, "rsi"), ">=", constante(sortie))],
  });
  const st = (period: number, multiplier: number): StrategieDef => ({
    direction: "les-deux", tailleFixe: TAILLE,
    reglesEntree: [comparaison(indicateur("supertrend", { period, multiplier }, "direction"), ">", constante(0))],
    reglesSortie: [comparaison(indicateur("supertrend", { period, multiplier }, "direction"), "<", constante(0))],
  });
  return [
    { id: "ema-9-21", base: true, strategie: ema(9, 21) },
    { id: "ema-rapide-7", base: false, strategie: ema(7, 21) }, { id: "ema-rapide-11", base: false, strategie: ema(11, 21) },
    { id: "ema-lente-17", base: false, strategie: ema(9, 17) }, { id: "ema-lente-25", base: false, strategie: ema(9, 25) },
    { id: "rsi-14-reversion", base: true, strategie: rsi(14, 30, 70) },
    { id: "rsi-length-11", base: false, strategie: rsi(11, 30, 70) }, { id: "rsi-length-17", base: false, strategie: rsi(17, 30, 70) },
    { id: "rsi-entree-24", base: false, strategie: rsi(14, 24, 70) }, { id: "rsi-entree-36", base: false, strategie: rsi(14, 36, 70) },
    { id: "rsi-sortie-56", base: false, strategie: rsi(14, 30, 56) }, { id: "rsi-sortie-84", base: false, strategie: rsi(14, 30, 84) },
    { id: "supertrend-10-3", base: true, strategie: st(10, 3) },
    { id: "supertrend-period-8", base: false, strategie: st(8, 3) }, { id: "supertrend-period-12", base: false, strategie: st(12, 3) },
    { id: "supertrend-mult-2.4", base: false, strategie: st(10, 2.4) }, { id: "supertrend-mult-3.6", base: false, strategie: st(10, 3.6) },
  ];
}

function metriques(resultat: ReturnType<typeof runBacktest>): Record<string, number | null> {
  const expectancy = resultat.trades.length === 0 ? null : resultat.trades.reduce((s, t) => s + t.pnl, 0) / resultat.trades.length;
  return {
    trades: resultat.stats.nbTrades, expectancyQuote: expectancy,
    expectancyPct: resultat.trades.length === 0 ? null : resultat.trades.reduce((s, t) => s + t.pnlPct, 0) / resultat.trades.length,
    pnlTotal: resultat.stats.pnlTotal, pnlTotalPct: resultat.stats.pnlTotalPct,
    maxDrawdownPicPct: resultat.stats.maxDrawdownPct, winRatePct: resultat.stats.winRatePct,
    profitFactor: Number.isFinite(resultat.stats.profitFactor) ? resultat.stats.profitFactor : null,
  };
}

function evaluer(cellule: Cellule, candles: CandleAcquise[]) {
  const sorties: Array<Record<string, unknown>> = [];
  for (const variante of variantes()) {
    const couts = variante.base ? COUTS : [COUTS[0]];
    let chronologie: string | null = null;
    for (const cout of couts) {
      const r = runBacktest(candles, variante.strategie, {
        timeframe: cellule.tf, debutEvaluationMs: DEBUT, finDonneesMs: FIN,
        fraisPct: cout.fraisPct, slippagePct: cout.slippagePct, capitalInitial: CAPITAL,
      });
      const cle = r.trades.map((t) => `${t.sens}:${t.tempsEntree}:${t.tempsSortie}`).join("|");
      if (chronologie !== null && cle !== chronologie) throw new Error(`les coûts ont modifié les signaux/fills de ${variante.id}`);
      chronologie = cle;
      const mc = variante.base && cout.id === "x1-central" && r.trades.length >= 10
        ? [5, 3, 10, 1].map((tailleBloc) => ({
            mode: tailleBloc === 1 ? "iid" : "blocs", tailleBloc,
            resultat: monteCarloTrades(r.trades.map((t) => t.pnl), CHEMINS, mulberry32(SEED), CAPITAL, tailleBloc === 1 ? { mode: "iid" } : { mode: "blocs", tailleBloc }),
          }))
        : null;
      sorties.push({ strategie: variante.id, varianteBase: variante.base, cout: cout.id, metriques: metriques(r), monteCarlo: mc });
    }
  }
  return sorties;
}

function rapportMarkdown(resultat: Record<string, unknown>): string {
  const cellules = resultat.cellules as Array<Record<string, unknown>>;
  const lignes = [
    "# Campagne hors échantillon AXIOM — 9 septembre 2026",
    "",
    `Manifeste figé : \`${HASH_MANIFESTE}\`. Holdout historique ; absence de consultation antérieure non attestée. Aucune stratégie n'est automatiquement déclarée validée.`,
    "",
    `Capital initial : ${CAPITAL.toLocaleString("fr-FR")} USDT ; taille notionnelle fixe : ${TAILLE.toLocaleString("fr-FR")} USDT par position. Les coûts sont appliqués par côté.`,
    "",
    "| Cellule | Statut | Stratégie | Coût | Trades | Expectancy nette (USDT/trade) | PnL % | DD pic % | Fréq. sim. chemin≤0 L5 | Fréq. sim. final<0 L5 |",
    "|---|---|---|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const cellule of cellules) {
    if (cellule.statut !== "disponible") {
      lignes.push(`| ${cellule.id} | indisponible : ${cellule.erreur} | — | — | — | — | — | — | — | — |`);
      continue;
    }
    for (const run of cellule.runs as Array<any>) {
      if (!run.varianteBase) continue;
      const m = run.metriques;
      const mcL5 = run.monteCarlo?.find((x: any) => x.tailleBloc === 5)?.resultat;
      lignes.push(`| ${cellule.id} | disponible | ${run.strategie} | ${run.cout} | ${m.trades} | ${m.expectancyQuote === null ? "—" : m.expectancyQuote.toFixed(4)} | ${m.pnlTotalPct.toFixed(3)} | ${m.maxDrawdownPicPct.toFixed(3)} | ${mcL5 ? (mcL5.probRuine * 100).toFixed(2) + "%" : "—"} | ${mcL5 ? (mcL5.probFinaleNegative * 100).toFixed(2) + "%" : "—"} |`);
    }
  }
  lignes.push(
    "",
    "## Sensibilités de paramètres (OAT, coûts centraux)",
    "",
    "| Cellule | Variante pré-déclarée | Trades | Expectancy nette (USDT/trade) | PnL % | DD pic % |",
    "|---|---|---:|---:|---:|---:|",
  );
  for (const cellule of cellules) {
    if (cellule.statut !== "disponible") continue;
    for (const run of cellule.runs as Array<any>) {
      if (run.varianteBase || run.cout !== "x1-central") continue;
      const m = run.metriques;
      lignes.push(`| ${cellule.id} | ${run.strategie} | ${m.trades} | ${m.expectancyQuote === null ? "—" : m.expectancyQuote.toFixed(4)} | ${m.pnlTotalPct.toFixed(3)} | ${m.maxDrawdownPicPct.toFixed(3)} |`);
    }
  }
  lignes.push(
    "",
    `Verdict pré-déclaré : **${resultat.verdict}**.`,
    "",
    "Les 30 stratégies du catalogue observé demeurent non validées ; aucun résultat de sensibilité n'a servi à sélectionner une variante.",
    "",
    "Limites : six semaines environ, bootstrap sur PnL fixes (pas un rééchantillonnage du marché), aucune marge/liquidation, coût scénarisé et campagne spot sans funding. Une fréquence simulée de 0 % signifie seulement qu'aucun des 1 000 chemins de cette simulation n'a franchi le seuil ; elle ne garantit pas un risque nul.",
  );
  return `${lignes.join("\n")}\n`;
}

async function main(): Promise<void> {
  verifierManifeste();
  process.stderr.write(`✓ manifeste vérifié ${HASH_MANIFESTE} — acquisition OOS autorisée\n`);
  const cellules: Array<Record<string, unknown>> = [];
  for (const cellule of CELLULES) {
    const id = `${cellule.symbol}-${cellule.tf}`;
    try {
      const { candles, acquisition } = await charger(cellule);
      cellules.push({ id, statut: "disponible", acquisition, runs: evaluer(cellule, candles) });
      process.stderr.write(`✓ ${id} acquis et calculé\n`);
    } catch (erreur) {
      cellules.push({ id, statut: "indisponible", erreur: erreur instanceof Error ? erreur.message : String(erreur) });
      process.stderr.write(`! ${id} indisponible\n`);
    }
  }
  const bases = ["ema-9-21", "rsi-14-reversion", "supertrend-10-3"];
  const disponibles = cellules.filter((c) => c.statut === "disponible");
  const verdict = disponibles.length < CELLULES.length ? "NON CONCLUANT — cellules incomplètes" : bases.every((id) => cellules.every((c: any) => {
    const x1 = c.runs.find((r: any) => r.strategie === id && r.cout === "x1-central")?.metriques;
    const x3 = c.runs.find((r: any) => r.strategie === id && r.cout === "x3")?.metriques;
    return x1?.trades >= 30 && x1.expectancyQuote > 0 && x3?.trades >= 30 && x3.expectancyQuote > 0;
  })) ? "CRITÈRES TENUS PAR LES TROIS RÈGLES — aucune sélection ni promesse" : "NON CONCLUANT — au moins un critère pré-déclaré échoue";
  const resultat = {
    schema: "axiom-oos-result-v1", manifesteSha256: HASH_MANIFESTE,
    calculeLeUtc: new Date().toISOString(), runtime: { bun: Bun.version },
    code: {
      runnerSha256: sha256(readFileSync(SCRIPT)),
      engineSha256: sha256(readFileSync(join(RACINE, "packages/backtest/src/engine.ts"))),
      monteCarloSha256: sha256(readFileSync(join(RACINE, "packages/backtest/src/monteCarlo.ts"))),
    },
    cellules, verdict, catalogueStrategies: 30, strategieValideeAutomatiquement: false,
  };
  const json = join(RACINE, "scripts/oos/resultat-2026-09-09.json");
  const md = join(RACINE, "scripts/oos/rapport-2026-09-09.md");
  writeFileSync(json, `${JSON.stringify(resultat, null, 2)}\n`);
  writeFileSync(md, rapportMarkdown(resultat));
  process.stderr.write(`✓ résultats écrits : ${json} et ${md}\n`);
}

if (import.meta.main) await main();
