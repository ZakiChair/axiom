#!/usr/bin/env bun
/**
 * AXIOM — exploration de la couche flux d'AXIS sur données DÉJÀ VUES, 8 octobre 2026.
 *
 * Demande du propriétaire : AXIS doit repérer les mouvements de fort achat et de
 * forte vente, et cette lecture doit être backtestée. Ce script explore, sur les
 * données déjà consommées par les campagnes AXIS (BTC/ETH/XRP/SOL 4h depuis
 * 2017-2020, BTC/ETH 1h depuis 2024-07), ce qui suit une bougie à fort volume
 * exécuté :
 *  - définitions candidates : seuil de volume relatif (volume / SMA 20), sens par
 *    delta taker et/ou corps de la bougie, seuil de delta ;
 *  - horizons de 1 à 42 bougies ; rendement log SIGNÉ, sens × ln(open[i+1+h] /
 *    open[i+1]) : positif = continuation, négatif = retour ;
 *  - test de décalage circulaire des événements (même nombre, même regroupement,
 *    synchronisation avec les prix détruite), p bilatérale ;
 *  - signaux AXIS v2 par qualité de flux à l'entrée, variante « filtreFlux ».
 * Les klines spot publient le volume taker acheteur (champ 9) : delta taker
 * disponible sur tout l'historique. L'intérêt ouvert n'a pas d'historique long :
 * il reste hors mesure.
 *
 * Sorties : /tmp/axis-flux-explo/ — SANS VALEUR PROBANTE (données vues, grille de
 * variantes). Sert uniquement à pré-déclarer UNE définition et UN sens pour le test
 * final sur données jamais vues (scripts/axis/manifeste-flux-2026-10-08.json).
 * Cache : scripts/.cache-klines/axis-flux/ (gitignoré, vérifié par hash).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candle } from "../packages/types/src/index";
import { closeOf, ema, trueRange, sma } from "../packages/indicators/src/utils";
import { computeIndicator, construireTradesStrategie, type EtatStrategie } from "../packages/indicators/src/index";
import { fluxAxis, forceFlux, stratAxis, type FluxBougie } from "../packages/indicators/src/strategy/stratAxis";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SORTIES = "/tmp/axis-flux-explo";
const CACHE = join(RACINE, "scripts/.cache-klines/axis-flux");
const ENDPOINT = "https://data-api.binance.vision/api/v3/klines";
const FIN = Date.parse("2026-10-08T00:00:00Z");
const TF_MS: Record<string, number> = { "1h": 3_600_000, "4h": 14_400_000 };
const WARMUP = 300;
const HORIZONS = [1, 2, 3, 6, 12, 24, 42];
const H_MAX = Math.max(...HORIZONS);
const TIRAGES = 999;
const GRAINE = 20261008;
const COUT_ALLER_RETOUR_PCT = 0.14; // x1 : (0,05 % frais + 0,02 % slippage) × 2 côtés

const CELLULES = [
  { symbol: "BTCUSDT", tf: "4h", debut: "2017-09-01T00:00:00Z" },
  { symbol: "ETHUSDT", tf: "4h", debut: "2017-09-01T00:00:00Z" },
  { symbol: "XRPUSDT", tf: "4h", debut: "2018-06-01T00:00:00Z" },
  { symbol: "SOLUSDT", tf: "4h", debut: "2020-09-01T00:00:00Z" },
  { symbol: "BTCUSDT", tf: "1h", debut: "2024-07-01T00:00:00Z" },
  { symbol: "ETHUSDT", tf: "1h", debut: "2024-07-01T00:00:00Z" },
];

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const iso = (ms: number): string => new Date(ms).toISOString();

// ─────────────────────────── Données (klines spot avec volume taker) ───────────────────────────

async function telecharger(symbol: string, tf: string, tfMs: number, debut: number, fin: number): Promise<Candle[]> {
  const parTemps = new Map<number, Candle>();
  let curseur = debut;
  for (;;) {
    const url = `${ENDPOINT}?symbol=${symbol}&interval=${tf}&startTime=${curseur}&endTime=${fin - 1}&limit=1000`;
    const reponse = await fetch(url);
    if (!reponse.ok) throw new Error(`Binance ${reponse.status} sur ${symbol} ${tf}`);
    const brut: unknown = await reponse.json();
    if (!Array.isArray(brut)) throw new Error("réponse non tabulaire");
    for (const ligne of brut) {
      if (!Array.isArray(ligne) || ligne.length < 10) throw new Error("kline sans champ taker");
      const [time, open, high, low, close, volume, closeTime] = [0, 1, 2, 3, 4, 5, 6].map((i) => Number(ligne[i])) as number[];
      const takerBuy = Number(ligne[9]);
      if (time! < debut || time! + tfMs > fin) continue;
      if (![open, high, low, close, volume, takerBuy].every(Number.isFinite) || closeTime! + 1 !== time! + tfMs) continue;
      if (open! <= 0 || close! <= 0 || low! <= 0 || volume! < 0 || takerBuy < 0 || takerBuy > volume! * (1 + 1e-9)) continue;
      parTemps.set(time!, { time: time!, open: open!, high: high!, low: low!, close: close!, volume: volume!, buyVolume: takerBuy, sellVolume: Math.max(0, volume! - takerBuy) });
    }
    if (brut.length < 1000) break;
    const dernier = Number((brut.at(-1) as unknown[])[0]);
    if (!(dernier >= curseur)) throw new Error("pagination sans progression");
    curseur = dernier + 1;
    process.stderr.write(`\r  … ${symbol} ${tf} : ${parTemps.size} bougies`);
  }
  return [...parTemps.values()].sort((a, b) => a.time - b.time);
}

async function charger(symbol: string, tf: string, debut: string): Promise<Candle[]> {
  const tfMs = TF_MS[tf]!;
  const fichier = join(CACHE, `E-${symbol}-${tf}.json`);
  let candles: Candle[];
  if (existsSync(fichier)) {
    const env = JSON.parse(readFileSync(fichier, "utf8")) as { sha256: string; candles: Candle[] };
    if (sha256(JSON.stringify(env.candles)) !== env.sha256) throw new Error(`cache ${fichier} non traçable`);
    candles = env.candles;
  } else {
    candles = await telecharger(symbol, tf, tfMs, Date.parse(debut), FIN);
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(fichier, JSON.stringify({ endpoint: ENDPOINT, debut, fin: iso(FIN), acquisLeUtc: new Date().toISOString(), sha256: sha256(JSON.stringify(candles)), candles }));
  }
  for (let i = 1; i < candles.length; i++) if (!(candles[i]!.time > candles[i - 1]!.time)) throw new Error("série non croissante");
  const manquantes = (FIN - Date.parse(debut)) / tfMs - candles.length;
  process.stderr.write(`\r  ✓ ${symbol} ${tf} : ${candles.length} bougies, ${manquantes} manquante(s), ${iso(candles[0]!.time)} → ${iso(candles.at(-1)!.time + tfMs)}\n`);
  return candles;
}

// ─────────────────────────── Définitions d'événement ───────────────────────────

type ModeSens = "delta-ou-corps" | "corps" | "delta-et-corps" | "delta";
interface Def { id: string; seuilVol: number; sens: ModeSens; seuilDelta: number; corpsMinAtr?: number }

const signe = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

/** Sens de l'événement à la bougie i selon la définition (0 = pas d'événement). */
function sensDe(def: Def, f: FluxBougie, c: Candle, atr: number | undefined): number {
  if (f.rvol === undefined || f.rvol < def.seuilVol) return 0;
  const corps = signe(c.close - c.open);
  const delta = f.delta !== undefined && Math.abs(f.delta) >= def.seuilDelta ? Math.sign(f.delta) : 0;
  let s = 0;
  if (def.sens === "corps") s = corps;
  else if (def.sens === "delta") s = delta;
  else if (def.sens === "delta-ou-corps") s = delta !== 0 ? delta : corps;
  else s = delta !== 0 && delta === corps ? delta : 0;
  if (s === 0) return 0;
  if (def.corpsMinAtr !== undefined) {
    if (atr === undefined || atr <= 0 || Math.abs(c.close - c.open) / atr < def.corpsMinAtr) return 0;
  }
  return s;
}

interface Evenement { i: number; sens: number }

// ─────────────────────────── Mesures ───────────────────────────

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
const TIRAGES_U = (() => {
  const rnd = mulberry32(GRAINE);
  return Array.from({ length: TIRAGES }, () => rnd());
})();

interface Serie {
  id: string;
  candles: Candle[];
  flux: FluxBougie[];
  atr: Array<number | undefined>;
  tendance: Array<number | undefined>;
  lnOpen: Float64Array;
  /** Fenêtre évaluable des décisions : [a, b] inclus. */
  a: number;
  b: number;
}

function preparer(id: string, candles: Candle[]): Serie {
  const flux = fluxAxis(candles, undefined, 20, 6);
  const tr = trueRange(candles);
  const atr = sma(tr, 14);
  const tendance = ema(closeOf(candles), 200);
  const lnOpen = new Float64Array(candles.map((c) => Math.log(c.open)));
  return { id, candles, flux, atr, tendance, lnOpen, a: WARMUP - 1, b: candles.length - 2 - H_MAX };
}

const evenements = (s: Serie, def: Def): Evenement[] => {
  const out: Evenement[] = [];
  for (let i = s.a; i <= s.b; i++) {
    const sens = sensDe(def, s.flux[i] ?? {}, s.candles[i]!, s.atr[i]);
    if (sens !== 0) out.push({ i, sens });
  }
  return out;
};

/** Rendement log signé après la décision i (fill open i+1), horizon h bougies. */
const rendement = (s: Serie, i: number, sens: number, h: number): number => sens * (s.lnOpen[i + 1 + h]! - s.lnOpen[i + 1]!);

interface Stat { n: number; moyenneBps: number; hitPct: number; t: number; p: number; medianeNulleBps: number }

/** Statistique pour un horizon : somme des rendements signés contre décalages circulaires communs aux séries. */
function statistique(series: Array<{ s: Serie; ev: Evenement[] }>, h: number): Stat {
  const valeurs: number[] = [];
  for (const { s, ev } of series) for (const e of ev) valeurs.push(rendement(s, e.i, e.sens, h));
  const n = valeurs.length;
  if (n === 0) return { n: 0, moyenneBps: 0, hitPct: 0, t: 0, p: 1, medianeNulleBps: 0 };
  const somme = valeurs.reduce((x, y) => x + y, 0);
  const moyenne = somme / n;
  const variance = valeurs.reduce((x, y) => x + (y - moyenne) ** 2, 0) / Math.max(1, n - 1);
  const t = variance > 0 ? moyenne / Math.sqrt(variance / n) : 0;
  const Lmin = Math.min(...series.map(({ s }) => s.b - s.a + 1));
  const nul = TIRAGES_U.map((u) => {
    const k = Math.floor(Lmin * (0.1 + 0.8 * u));
    let total = 0;
    for (const { s, ev } of series) {
      const L = s.b - s.a + 1;
      for (const e of ev) total += rendement(s, s.a + ((e.i - s.a + k) % L), e.sens, h);
    }
    return total;
  });
  const p = (1 + nul.filter((v) => Math.abs(v) >= Math.abs(somme)).length) / (nul.length + 1);
  const tri = [...nul].sort((x, y) => x - y);
  return {
    n,
    moyenneBps: moyenne * 1e4,
    hitPct: (valeurs.filter((v) => v > 0).length / n) * 100,
    t,
    p,
    medianeNulleBps: (tri[Math.floor(tri.length / 2)]! / n) * 1e4,
  };
}

// ─────────────────────────── Signaux AXIS par qualité de flux ───────────────────────────

interface TradeQualifie { cellule: string; idxEntree: number; idxSortie: number; pct: number; qualite: string; qualiteSortie: string }

function tradesAxis(s: Serie, params: Record<string, number | boolean>): { trades: TradeQualifie[]; ouvert: number | null } {
  const prix = computeIndicator(stratAxis, s.candles, params).series.prixSignal ?? [];
  const pos = s.candles.map((_c, i) => (prix[i] === undefined ? 0 : 1)) as EtatStrategie[];
  const brut = construireTradesStrategie(s.candles, pos);
  const qualite = (i: number, sens: number): string => {
    const fo = forceFlux(s.flux[i] ?? {}, sens, 1.5, 2);
    return fo.dispo === 0 ? "indisponible" : fo.fort ? "fort" : fo.contre ? "contre-sens" : "ordinaire";
  };
  return {
    // `brut.trades` ne contient que des trades clôturés (sortie et PnL définis).
    trades: brut.trades.flatMap((t) =>
      t.idxEntree >= s.a && t.idxSortie !== undefined && t.pnlPct !== undefined
        ? [{ cellule: s.id, idxEntree: t.idxEntree, idxSortie: t.idxSortie, pct: t.pnlPct, qualite: qualite(t.idxEntree, 1), qualiteSortie: qualite(t.idxSortie, -1) }]
        : []
    ),
    ouvert: brut.ouvert !== null && brut.ouvert.idxEntree >= s.a ? brut.ouvert.idxEntree : null,
  };
}

// ─────────────────────────── Rapport ───────────────────────────

const fmt = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d) : "—");
const ligne = (cells: Array<string | number>): string => `| ${cells.join(" | ")} |`;
const tableau = (entetes: string[], lignes: Array<Array<string | number>>): string =>
  [ligne(entetes), `|${entetes.map(() => "---").join("|")}|`, ...lignes.map(ligne)].join("\n");
const celluleStat = (st: Stat): string => `${st.n} / ${fmt(st.moyenneBps, 0)} / ${fmt(st.hitPct, 0)} / ${fmt(st.t, 1)} / ${fmt(st.p, 3)}`;

async function main(): Promise<void> {
  mkdirSync(SORTIES, { recursive: true });
  const series: Serie[] = [];
  for (const c of CELLULES) series.push(preparer(`${c.symbol} ${c.tf}`, await charger(c.symbol, c.tf, c.debut)));
  const s4h = series.filter((s) => s.id.endsWith("4h"));
  const s1h = series.filter((s) => s.id.endsWith("1h"));

  const defs: Def[] = [];
  for (const seuilVol of [2, 3, 4, 5]) {
    defs.push({ id: `V${seuilVol} delta|corps d≥0.1`, seuilVol, sens: "delta-ou-corps", seuilDelta: 0.1 });
    defs.push({ id: `V${seuilVol} corps`, seuilVol, sens: "corps", seuilDelta: 0.1 });
    for (const seuilDelta of [0.1, 0.2, 0.3]) {
      defs.push({ id: `V${seuilVol} delta&corps d≥${seuilDelta}`, seuilVol, sens: "delta-et-corps", seuilDelta });
      defs.push({ id: `V${seuilVol} delta seul d≥${seuilDelta}`, seuilVol, sens: "delta", seuilDelta });
    }
    defs.push({ id: `V${seuilVol} delta&corps d≥0.1 corps≥1 ATR`, seuilVol, sens: "delta-et-corps", seuilDelta: 0.1, corpsMinAtr: 1 });
  }

  const p: string[] = [];
  p.push("# AXIS — exploration de la couche flux sur données DÉJÀ VUES (8 octobre 2026)");
  p.push("**Sans valeur probante** : données déjà consommées par les campagnes AXIS, grille de variantes. Cellule = « N / moyenne (bps) / hits % / t / p bilatérale (décalage circulaire) ». Rendement signé = sens × ln(open[i+1+h]/open[i+1]) : positif = continuation, négatif = retour.");
  p.push(tableau(["Cellule", "Bougies", "Fenêtre évaluable (décisions)", "Du", "Au"], series.map((s) => [s.id, s.candles.length, s.b - s.a + 1, iso(s.candles[s.a]!.time).slice(0, 10), iso(s.candles[s.b]!.time).slice(0, 10)])));

  // Grille pooled 4h
  p.push("## Grille 4h (BTC, ETH, XRP, SOL regroupés) — par horizon");
  const resume: Array<{ def: Def; stats: Stat[] }> = [];
  for (const def of defs) {
    const ev = s4h.map((s) => ({ s, ev: evenements(s, def) }));
    const stats = HORIZONS.map((h) => statistique(ev, h));
    resume.push({ def, stats });
  }
  p.push(tableau(["Définition", "N", ...HORIZONS.map((h) => `h=${h}`)], resume.map(({ def, stats }) => [def.id, stats[0]!.n, ...stats.map((st) => `${fmt(st.moyenneBps, 0)} (${fmt(st.hitPct, 0)} %, p ${fmt(st.p, 3)})`)])));

  // Détail par cellule pour quelques définitions clés
  const cles = defs.filter((d) => ["V3 delta|corps d≥0.1", "V3 delta&corps d≥0.1", "V3 delta&corps d≥0.2", "V2 delta&corps d≥0.2", "V4 delta&corps d≥0.2", "V3 delta seul d≥0.2", "V3 delta&corps d≥0.1 corps≥1 ATR"].includes(d.id));
  for (const def of cles) {
    p.push(`## ${def.id} — par cellule`);
    p.push(
      tableau(
        ["Cellule", ...HORIZONS.map((h) => `h=${h}`)],
        [...s4h, ...s1h].map((s) => {
          const ev = [{ s, ev: evenements(s, def) }];
          return [s.id, ...HORIZONS.map((h) => celluleStat(statistique(ev, h)))];
        })
      )
    );
    // Achats vs ventes, avec/contre tendance (pooled 4h)
    const split = (filtre: (s: Serie, e: Evenement) => boolean) => s4h.map((s) => ({ s, ev: evenements(s, def).filter((e) => filtre(s, e)) }));
    const tendanceDe = (s: Serie, i: number): number => {
      const t = s.tendance[i];
      return t === undefined ? 0 : signe(s.candles[i]!.close - t);
    };
    p.push(
      tableau(
        ["Sous-ensemble (4h regroupé)", ...HORIZONS.map((h) => `h=${h}`)],
        [
          ["Forts achats (sens +1)", ...HORIZONS.map((h) => celluleStat(statistique(split((_s, e) => e.sens > 0), h)))],
          ["Fortes ventes (sens −1)", ...HORIZONS.map((h) => celluleStat(statistique(split((_s, e) => e.sens < 0), h)))],
          ["Dans le sens de l'EMA 200", ...HORIZONS.map((h) => celluleStat(statistique(split((s, e) => tendanceDe(s, e.i) === e.sens), h)))],
          ["Contre l'EMA 200", ...HORIZONS.map((h) => celluleStat(statistique(split((s, e) => tendanceDe(s, e.i) === -e.sens), h)))],
          ["Achats au-dessus de l'EMA 200", ...HORIZONS.map((h) => celluleStat(statistique(split((s, e) => e.sens > 0 && tendanceDe(s, e.i) > 0), h)))],
          ["Ventes sous l'EMA 200", ...HORIZONS.map((h) => celluleStat(statistique(split((s, e) => e.sens < 0 && tendanceDe(s, e.i) < 0), h)))],
          ["Achats sous l'EMA 200", ...HORIZONS.map((h) => celluleStat(statistique(split((s, e) => e.sens > 0 && tendanceDe(s, e.i) < 0), h)))],
          ["Ventes au-dessus de l'EMA 200", ...HORIZONS.map((h) => celluleStat(statistique(split((s, e) => e.sens < 0 && tendanceDe(s, e.i) > 0), h)))],
        ]
      )
    );
  }

  // Signaux AXIS par qualité de flux
  p.push("## Signaux AXIS v2 (défauts) par qualité de flux à l'entrée — rejeu close-à-close, 4h");
  const tous: TradeQualifie[] = [];
  for (const s of s4h) tous.push(...tradesAxis(s, {}).trades);
  const groupes = ["fort", "ordinaire", "contre-sens", "indisponible"];
  const statsGroupe = (ts: TradeQualifie[]): Array<string | number> => {
    const n = ts.length;
    if (n === 0) return [0, "—", "—", "—"];
    const exp = ts.reduce((x, t) => x + t.pct, 0) / n;
    return [n, fmt(exp, 2), fmt(exp - COUT_ALLER_RETOUR_PCT, 2), fmt((ts.filter((t) => t.pct > 0).length / n) * 100, 0)];
  };
  p.push(
    tableau(
      ["Qualité à l'entrée", "Trades", "Exp. % hors frais", "Exp. % − 0,14 (x1)", "Gagnants %"],
      [...groupes.map((g) => [g, ...statsGroupe(tous.filter((t) => t.qualite === g))]), ["TOUS", ...statsGroupe(tous)]]
    )
  );
  p.push(tableau(["Cellule", ...groupes.map((g) => `${g} : n / exp. %`)], s4h.map((s) => [s.id, ...groupes.map((g) => { const ts = tous.filter((t) => t.cellule === s.id && t.qualite === g); return ts.length === 0 ? "0 / —" : `${ts.length} / ${fmt(ts.reduce((x, t) => x + t.pct, 0) / ts.length, 2)}`; })])));
  p.push("### Ventes AXIS par qualité : rendement signé (−1 × ln) après la sortie, 4h regroupé");
  const apresSortie = (g: string, h: number): string => {
    const vals: number[] = [];
    for (const s of s4h) for (const t of tous.filter((x) => x.cellule === s.id && x.qualiteSortie === g && x.idxSortie + 1 + h <= s.candles.length - 1)) vals.push(-(s.lnOpen[t.idxSortie + 1 + h]! - s.lnOpen[t.idxSortie + 1]!));
    if (vals.length === 0) return "—";
    const m = vals.reduce((x, y) => x + y, 0) / vals.length;
    return `${vals.length} / ${fmt(m * 1e4, 0)} / ${fmt((vals.filter((v) => v > 0).length / vals.length) * 100, 0)}`;
  };
  p.push(tableau(["Qualité de la vente", ...HORIZONS.map((h) => `h=${h} : n / bps / hits %`)], groupes.map((g) => [g, ...HORIZONS.map((h) => apresSortie(g, h))])));

  p.push("## Variante filtreFlux (n'acheter que sur flux fort) contre défaut — rejeu close-à-close, 4h");
  p.push(
    tableau(
      ["Cellule", "Défaut : trades / exp. % / PnL simple %", "filtreFlux : trades / exp. % / PnL simple %"],
      s4h.map((s) => {
        const d = tradesAxis(s, {}).trades;
        const f = tradesAxis(s, { filtreFlux: true }).trades;
        const r = (ts: TradeQualifie[]) => (ts.length === 0 ? "0 / — / —" : `${ts.length} / ${fmt(ts.reduce((x, t) => x + t.pct, 0) / ts.length, 2)} / ${fmt(ts.reduce((x, t) => x + t.pct - COUT_ALLER_RETOUR_PCT, 0), 1)}`);
        return [s.id, r(d), r(f)];
      })
    )
  );

  const texte = `${p.join("\n\n")}\n`;
  writeFileSync(join(SORTIES, "exploration.md"), texte);
  process.stdout.write(texte);
}

await main();
