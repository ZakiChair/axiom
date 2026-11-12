/**
 * Amorce du backtest (BT-1, 12 novembre 2026) : la fenêtre BT charge, AVANT la plage
 * mesurée, l'historique que lisent ses indicateurs, puis ne mesure que la plage.
 *
 * Cas de référence : BTCUSDT 4h, 3 000 bougies closes de la fixture d'AXIS S/R, servies par
 * un faux `fetch` qui respecte `endTime` et `limit` comme Binance ; horloge figée une
 * demi-heure après la dernière clôture ; faux `Worker` qui garde la requête. Le moteur réel
 * est lancé sur cette requête, comme le ferait le worker, et son résultat rendu au store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@axiom/types";
import {
  runBacktest,
  type Condition,
  type Operande,
  type ParamsBacktest,
  type ResultatBacktest,
  type StrategieDef,
} from "@axiom/backtest";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import fixtureBtc from "../../../../packages/indicators/src/strategy/fixtures/btcusdt-4h-3000.json";
import { AMORCE_MIN_BT, BUILTIN_STRATEGIES, amorceRun, backtestStore, texteAmorceBt } from "./backtest";
import { backtestHistoryStore } from "./backtestHistory";
import { VERSION_MOTEUR_BT, comparerArchives } from "../data/backtestArchive";

const close: Operande = { type: "prix", champ: "close" };
const zero: Operande = { type: "constante", valeur: 0 };
const ind = (indicateurId: string, params: Record<string, number>, output: string): Operande =>
  ({ type: "indicateur", indicateurId, params, output });
const sup = (gauche: Operande, droite: Operande = zero): Condition => ({ type: "comparaison", gauche, comparateur: ">", droite });
/** Amorce d'une stratégie à une règle d'entrée, sans sortie. */
const amorce = (regle: Condition, stopAtr: { length: number; mult: number } | null = null): number =>
  amorceRun({ reglesEntree: [regle], reglesSortie: [], stopAtr });

describe("amorceRun : bougies chargées avant la plage", () => {
  it("0 sans indicateur ni stop ATR : prix, volume et constantes seuls", () => {
    expect(amorce(sup(close))).toBe(0);
    expect(amorce(sup({ type: "prix", champ: "volume" }, close))).toBe(0);
    expect(amorceRun({ reglesEntree: [], reglesSortie: [], stopAtr: null })).toBe(0);
  });

  it("plancher de 300 dès qu'un indicateur est lu ou qu'un stop ATR est posé", () => {
    expect(AMORCE_MIN_BT).toBe(300);
    expect(amorce(sup(close), { length: 14, mult: 2 })).toBe(300);
    expect(amorce(sup(ind("rsi", { length: 14 }, "rsi")))).toBe(300);
    // Paramètres par défaut du def (RSI 14) quand l'opérande n'en porte aucun.
    expect(amorce(sup(ind("rsi", {}, "rsi")))).toBe(300);
  });

  it("4 × le plus grand paramètre numérique résolu, quelle que soit sa clé", () => {
    expect(amorce(sup(close, ind("ema", { length: 200 }, "ema")))).toBe(800);
    expect(amorce(sup(ind("macd", { fast: 12, slow: 100, signal: 9 }, "macd")))).toBe(400);
    expect(amorce(sup(ind("supertrend", { period: 150, multiplier: 3 }, "direction")))).toBe(600);
    expect(amorce(sup(ind("stochastic", { kLength: 120, dLength: 3 }, "k")))).toBe(480);
    // Un croisement compte ses deux opérandes.
    expect(amorce({ type: "croisement", a: ind("ema", { length: 20 }, "ema"), b: ind("sma", { length: 250 }, "sma"), sens: "hausse" })).toBe(1000);
    // Stop ATR : 4 × sa période.
    expect(amorce(sup(close), { length: 200, mult: 2 })).toBe(800);
  });

  it("amorce déclarée par le def : AXIS 1 500, AXIS S/R 3 000 même pour lire son seul état", () => {
    expect(amorceRun({ reglesEntree: [sup(close)], reglesSortie: [sup(ind("stratAxis", {}, "etat"))], stopAtr: null })).toBe(1500);
    expect(amorce(sup(ind("stratAxis", {}, "score")))).toBe(1500);
    expect(amorce(sup(ind("stratAxisSr", {}, "etat")))).toBe(3000);
    expect(amorceRun({
      reglesEntree: [sup(ind("stratAxisSr", {}, "etat"))],
      reglesSortie: [sup(ind("stratAxis", {}, "etat"))],
      stopAtr: { length: 14, mult: 2 },
    })).toBe(3000);
  });

  it("RVOL saisonnier : sa fenêtre se compte en jours, jours × 24 bougies 1h", () => {
    expect(amorce(sup(ind("rvolSeasonal", {}, "rvol")))).toBe(84 * 24);
    expect(amorce(sup(ind("rvolSeasonal", { jours: 30 }, "rvol")))).toBe(30 * 24);
    // Le paramètre « minimum » (références, pas des bougies) ne dépasse pas le plancher.
    expect(amorce(sup(ind("rvolSeasonal", { jours: 7, minimum: 60 }, "rvol")))).toBe(300);
  });

  it("presets livrés : AXIS 1 500, AXIS S/R 3 000, tous les autres 300", () => {
    const amorces = Object.fromEntries(BUILTIN_STRATEGIES.map((s) => [s.id, amorceRun({ ...s, stopAtr: s.stopAtr ?? null })]));
    expect(amorces["builtin:axis"]).toBe(1500);
    expect(amorces["builtin:axis-sr"]).toBe(3000);
    for (const [id, n] of Object.entries(amorces)) {
      if (id !== "builtin:axis" && id !== "builtin:axis-sr") expect(n, id).toBe(300);
    }
  });
});

describe("texteAmorceBt : mention de la note du run", () => {
  it("amorce complète, puis amorce courte, au caractère près", () => {
    expect(texteAmorceBt(1500, 1500)).toBe("amorce 1500 bougies");
    expect(texteAmorceBt(811, 1500)).toBe("amorce courte (811 bougies sur 1500) : premiers signaux pouvant différer de ceux d'une série longue");
    expect(texteAmorceBt(0, 300)).toBe("amorce courte (0 bougie sur 300) : premiers signaux pouvant différer de ceux d'une série longue");
    expect(texteAmorceBt(1, 300)).toBe("amorce courte (1 bougie sur 300) : premiers signaux pouvant différer de ceux d'une série longue");
    // Règle stricte : une seule bougie manquante suffit à dire l'amorce courte.
    expect(texteAmorceBt(1499, 1500)).toContain("amorce courte (1499 bougies sur 1500)");
  });

  it("n'emploie jamais le mot « référence » (épinglé pour une stratégie sans référence)", () => {
    expect(texteAmorceBt(300, 300)).not.toContain("référence");
    expect(texteAmorceBt(0, 300)).not.toContain("référence");
  });
});

// ─────────────────────────── Run sur le cas de référence ───────────────────────────

type Ligne = [number, number, number, number, number, number, number];
const LIGNES = fixtureBtc.bougies as Ligne[];
const PAS_4H = 14_400_000;
const PAS_1H = 3_600_000;
const JOUR = 86_400_000;
/** Une demi-heure après la clôture de la dernière bougie (31 octobre 2026). */
const HORLOGE = LIGNES.at(-1)![0] + PAS_4H + 1_800_000;
/** Ouverture de la bougie `i` de la fixture. */
const T = (i: number): number => LIGNES[i]![0];
const enBougie = ([time, open, high, low, close, volume, buyVolume]: Ligne): Candle =>
  ({ time, open, high, low, close, volume, buyVolume, sellVolume: volume - buyVolume, closed: true });
const TOUTES: Candle[] = LIGNES.map(enBougie);

/**
 * Série 1h synthétique (RVOL saisonnier n'accepte que le 1h) : 5 000 bougies dont la dernière
 * clôt à la même heure que la fixture, volume variable selon l'heure UTC.
 */
const LIGNES_1H: Ligne[] = Array.from({ length: 5000 }, (_, k) => {
  const t = T(2999) + 3 * PAS_1H - (4999 - k) * PAS_1H;
  const prix = 100 + 10 * Math.sin(k / 50);
  const volume = 100 + 50 * ((t / PAS_1H) % 24);
  return [t, prix, prix + 1, prix - 1, prix, volume, volume / 2];
});

/** Dernière bougie servie (index de la fixture) : simule une source qui s'arrête plus tôt. */
let derniereServie = 2999;

/** Klines Binance : `endTime` et `limit` respectés ; BTCUSDT 4h (fixture) et 1h (synthétique). */
function klines(url: string): Response {
  const p = new URL(url).searchParams;
  const intervalle = p.get("interval");
  const source = p.get("symbol") !== "BTCUSDT" ? []
    : intervalle === "4h" ? LIGNES.slice(0, derniereServie + 1)
      : intervalle === "1h" ? LIGNES_1H : [];
  const pas = intervalle === "1h" ? PAS_1H : PAS_4H;
  const fin = Number(p.get("endTime") ?? Infinity);
  const lignes = source.filter(([t]) => t <= fin).slice(-Number(p.get("limit") ?? 500));
  return new Response(JSON.stringify(lignes.map(([t, o, h, l, c, v, a]) =>
    [t, String(o), String(h), String(l), String(c), String(v), t + pas - 1, "0", 1, String(a), "0", "0"])), { status: 200 });
}

interface Requete { candles: Candle[]; strat: StrategieDef; params: ParamsBacktest; runId: number }
let postes: Requete[] = [];
let workers: FauxWorker[] = [];
class FauxWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { workers.push(this); }
  postMessage(m: Requete): void { postes.push(m); }
  terminate(): void {}
}

/** Lance un preset livré sur la plage et rend la requête envoyée au worker. */
async function lancer(preset: string, plage: "3m" | "6m" | "1a"): Promise<Requete> {
  backtestStore.setState({ symbol: "BTCUSDT", plage, modeFunding: "aucun", intrabar: false, fraisPct: 0.05, slippagePct: 0.02, capitalInitial: 10_000 });
  backtestStore.getState().loadPreset(preset);
  backtestStore.getState().run();
  await vi.waitFor(() => { expect(postes.length).toBe(1); }, { timeout: 10_000 });
  return postes[0]!;
}

/** Ce que fait le worker : le moteur réel sur la requête, résultat rendu au store. */
function terminer(req: Requete): ResultatBacktest {
  const resultat = runBacktest(req.candles, req.strat, req.params);
  workers.at(-1)!.onmessage!({ data: { type: "result", runId: req.runId, resultat } } as MessageEvent);
  return resultat;
}

/** Trades lus en index de la fixture : [entrée, sortie, raison]. */
const bornes = (r: ResultatBacktest): Array<[number, number, string]> =>
  r.trades.map((t) => [LIGNES.findIndex(([x]) => x === t.tempsEntree), LIGNES.findIndex(([x]) => x === t.tempsSortie), t.raison]);

/** État d'AXIS calculé sur `candles`, référence BTCUSDT = leurs propres clôtures alignées. */
const etatAxis = (candles: Candle[], refClose: Array<number | undefined> = candles.map((c) => c.close)): Array<number | undefined> =>
  computeIndicator(getIndicator("stratAxis")!, candles, {}, { refClose }).series.etat!;

const TRADES_AXIS_3M: Array<[number, number, string]> = [[2476, 2508, "regle"], [2553, 2690, "regle"], [2741, 2851, "regle"], [2938, 2943, "regle"]];
const NOTE_AXIS_3M = "539 bougies mesurées · BTCUSDT 4h · Binance spot · amorce 1500 bougies · référence BTCUSDT chargée (3000 bougies)";

describe("run sur le cas de référence BTCUSDT 4h", () => {
  beforeEach(() => {
    postes = []; workers = []; derniereServie = 2999;
    vi.spyOn(Date, "now").mockReturnValue(HORLOGE);
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) =>
      (String(url).includes("klines") ? klines(String(url)) : new Response("ko", { status: 404 }))));
    vi.stubGlobal("Worker", FauxWorker);
  });
  afterEach(() => { backtestStore.getState().cancel(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("AXIS 3 mois : 1 500 bougies d'amorce chargées avant la plage, 539 mesurées, note au caractère près", async () => {
    const req = await lancer("builtin:axis", "3m");
    const depuis = HORLOGE - 90 * JOUR;
    expect(req.candles).toHaveLength(2039);
    expect(req.candles[0]!.time).toBe(T(961));
    expect(req.candles[1500]!.time).toBe(T(2461));
    // Amorce strictement antérieure à la plage ; la bougie en formation n'est jamais lue.
    expect(req.candles[1499]!.time).toBeLessThan(depuis);
    expect(req.candles[1500]!.time).toBeGreaterThanOrEqual(depuis);
    expect(req.candles.every((c) => c.closed === true && c.time + PAS_4H <= HORLOGE)).toBe(true);
    expect(req.params.debutEvaluationMs).toBe(depuis);
    // Référence du garde-fou chargée sur toute l'amorce, alignée sur les bougies envoyées.
    expect(req.params.aux?.refClose).toHaveLength(2039);
    expect(req.params.aux?.refClose?.every((v, i) => v === req.candles[i]!.close)).toBe(true);
    expect(backtestStore.getState().note).toBe(NOTE_AXIS_3M);
    expect(backtestStore.getState().nbBougiesChargees).toBe(539);
  });

  it("AXIS 3 mois : 4 trades, fills à l'ouverture qui suit chaque changement d'état du graphe, aucun dans l'amorce", async () => {
    const req = await lancer("builtin:axis", "3m");
    const depuis = HORLOGE - 90 * JOUR;
    const r = terminer(req);
    expect(r.nbBougies).toBe(539);
    expect(bornes(r)).toEqual(TRADES_AXIS_3M);
    expect(r.trades.every((t) => t.tempsEntree >= depuis && t.tempsSortie >= depuis)).toBe(true);
    expect(r.equity[0]!.temps).toBe(T(2461));

    // Changements d'état d'AXIS sur la série complète : achats aux clôtures 2475, 2552, 2740
    // et 2937, ventes à 2507, 2689, 2850 et 2942 ; à plat à la clôture 2460, avant la plage.
    const complet = etatAxis(TOUTES);
    const achats: number[] = [];
    const ventes: number[] = [];
    for (let i = 2460; i < 2999; i++) {
      if ((complet[i] ?? 0) >= 1 && (complet[i - 1] ?? 0) <= 0) achats.push(i);
      if ((complet[i] ?? 0) <= 0 && (complet[i - 1] ?? 0) >= 1) ventes.push(i);
    }
    expect(complet[2460]).toBe(0);
    expect(achats).toEqual([2475, 2552, 2740, 2937]);
    expect(ventes).toEqual([2507, 2689, 2850, 2942]);
    expect(bornes(r)).toEqual(achats.map((a, k) => [a + 1, ventes[k]! + 1, "regle"]));

    // Série longue (3 000 bougies, même borne) : mêmes trades, mêmes stats.
    const longue = runBacktest(TOUTES, req.strat, { ...req.params, aux: { refClose: TOUTES.map((c) => c.close) } });
    expect(bornes(longue)).toEqual(bornes(r));
    expect(longue.stats).toEqual(r.stats);

    // Le run rendu au store : archive datée de la première bougie MESURÉE, plage demandée,
    // et aucun « 1re entrée » (à plat à la clôture qui précède la plage).
    expect(backtestStore.getState().phase).toBe("done");
    expect(backtestStore.getState().resultat?.trades).toHaveLength(4);
    expect(backtestStore.getState().note).toBe(NOTE_AXIS_3M);
    const archive = backtestHistoryStore.getState().runs[0]!;
    expect(archive.donnees.premiereBougieMs).toBe(T(2461));
    expect(archive.donnees.nbBougies).toBe(539);
    expect(archive.fenetreDemandee).toEqual({ debutMs: depuis, finMs: HORLOGE });

    // Contre-épreuve, le calcul d'avant (plage seule, à froid, sans borne) : 2 trades sur 4.
    const froid = req.candles.slice(1500);
    const { debutEvaluationMs: _borne, ...sansBorne } = req.params;
    const avant = runBacktest(froid, req.strat, { ...sansBorne, aux: { refClose: froid.map((c) => c.close) } });
    expect(bornes(avant)).toEqual([[2741, 2851, "regle"], [2938, 2943, "regle"]]);
  });

  it("AXIS 3 mois : l'état lu par le BT est celui du graphe sur toutes les bougies de la plage (sur cette fixture)", async () => {
    const req = await lancer("builtin:axis", "3m");
    const bt = etatAxis(req.candles, req.params.aux!.refClose!);
    const complet = etatAxis(TOUTES);
    // Le graphe charge 1 500 bougies pour AXIS (son amorce déclarée) : 961 avant la plage.
    const graphe = etatAxis(TOUTES.slice(1500));
    const ecartsBt: number[] = [];
    const ecartsGraphe: number[] = [];
    for (let j = 2461; j < 3000; j++) {
      if (bt[j - 961] === undefined || bt[j - 961] !== complet[j]) ecartsBt.push(j);
      if (graphe[j - 1500] !== complet[j]) ecartsGraphe.push(j);
    }
    expect(ecartsBt).toEqual([]);
    expect(ecartsGraphe).toEqual([]);
    // Contre-épreuve à froid (plage seule) : aucun état sur les 49 premières bougies, et un
    // état différent de la série complète sur 186 des 539.
    const froid = etatAxis(TOUTES.slice(2461));
    expect(froid.findIndex((v) => v !== undefined)).toBe(49);
    expect(froid.filter((v, k) => v !== complet[2461 + k])).toHaveLength(186);
  });

  it("archive : version du moteur bt-2026-11-12 ; comparée à un run archivé avant, « Versions du moteur différentes »", async () => {
    expect(VERSION_MOTEUR_BT).toBe("bt-2026-11-12");
    terminer(await lancer("builtin:axis", "3m"));
    const nouveau = backtestHistoryStore.getState().runs[0]!;
    expect(nouveau.moteurVersion).toBe("bt-2026-11-12");
    const ancien = { ...nouveau, id: "run-avant", moteurVersion: "bt-2026-09-30" };
    expect(comparerArchives(ancien, nouveau).avertissements).toContain("Versions du moteur différentes");
  });

  it("AXIS S/R 3 mois : 3 000 bougies demandées, 2 461 disponibles, la note dit l'amorce courte ; mêmes 4 trades", async () => {
    const req = await lancer("builtin:axis-sr", "3m");
    expect(req.candles).toHaveLength(3000);
    expect(backtestStore.getState().note).toBe("539 bougies mesurées · BTCUSDT 4h · Binance spot · amorce courte (2461 bougies sur 3000) : premiers signaux pouvant différer de ceux d'une série longue · référence BTCUSDT chargée (3000 bougies)");
    expect(bornes(terminer(req))).toEqual(TRADES_AXIS_3M);
  });

  it("AXIS 6 mois : position déjà tenue avant la plage, entrée à sa première ouverture, la note le dit", async () => {
    const req = await lancer("builtin:axis", "6m");
    expect(req.candles).toHaveLength(2591);
    expect(req.candles[1500]!.time).toBe(T(1909));
    expect(etatAxis(TOUTES)[1908]).toBe(1);
    const r = terminer(req);
    expect(r.nbBougies).toBe(1091);
    expect(bornes(r)).toHaveLength(6);
    expect(bornes(r)[0]).toEqual([1909, 1975, "regle"]);
    expect(backtestStore.getState().phase).toBe("done");
    expect(backtestStore.getState().note).toBe("1091 bougies mesurées · BTCUSDT 4h · Binance spot · amorce 1500 bougies · référence BTCUSDT chargée (3000 bougies) · 1re entrée à l'ouverture de la plage : règle déjà vraie à la clôture précédente");
  });

  it("AXIS 1 an : amorce courte (811 sur 1 500), 13 trades", async () => {
    const req = await lancer("builtin:axis", "1a");
    expect(req.candles).toHaveLength(3000);
    expect(backtestStore.getState().note).toBe("2189 bougies mesurées · BTCUSDT 4h · Binance spot · amorce courte (811 bougies sur 1500) : premiers signaux pouvant différer de ceux d'une série longue · référence BTCUSDT chargée (3000 bougies)");
    expect(terminer(req).trades).toHaveLength(13);
  });

  it("règle sans indicateur ni stop ATR : ni amorce ni borne, note et run d'avant", async () => {
    backtestStore.setState({
      symbol: "BTCUSDT", tf: "4h", plage: "3m", modeFunding: "aucun", direction: "long", stopAtr: null, stopPct: null, targetPct: null, risquePct: null,
      reglesEntree: [{ type: "comparaison", gauche: { type: "prix", champ: "close" }, comparateur: ">", droite: { type: "constante", valeur: 0 } }],
      reglesSortie: [],
    });
    backtestStore.getState().run();
    await vi.waitFor(() => { expect(postes.length).toBe(1); }, { timeout: 10_000 });
    const req = postes[0]!;
    expect(req.candles).toHaveLength(539);
    expect(req.candles[0]!.time).toBe(T(2461));
    expect(req.params).not.toHaveProperty("debutEvaluationMs");
    const note = "539 bougies · BTCUSDT 4h · Binance spot";
    expect(backtestStore.getState().note).toBe(note);
    const r = terminer(req);
    // Entrée décidée à la clôture de la première bougie chargée : rien n'est ajouté à la note.
    expect(bornes(r)[0]).toEqual([2462, 2999, "fin-donnees"]);
    expect(backtestStore.getState().note).toBe(note);
    expect(backtestHistoryStore.getState().runs[0]!.donnees.premiereBougieMs).toBe(T(2461));
  });

  it("RVOL saisonnier 1h : amorce de 84 jours × 24 bougies, dite dans la note", async () => {
    backtestStore.setState({
      symbol: "BTCUSDT", tf: "1h", plage: "3m", modeFunding: "aucun", direction: "long", stopAtr: null, stopPct: null, targetPct: null, risquePct: null,
      reglesEntree: [{ type: "comparaison", gauche: { type: "indicateur", indicateurId: "rvolSeasonal", params: {}, output: "rvol" }, comparateur: ">", droite: { type: "constante", valeur: 2 } }],
      reglesSortie: [],
    });
    backtestStore.getState().run();
    await vi.waitFor(() => { expect(postes.length).toBe(1); }, { timeout: 10_000 });
    expect(postes[0]!.candles).toHaveLength(2159 + 2016);
    expect(postes[0]!.params.debutEvaluationMs).toBe(HORLOGE - 90 * JOUR);
    expect(backtestStore.getState().note).toBe("2159 bougies mesurées · BTCUSDT 1h · Binance spot · amorce 2016 bougies");
  });

  it("trop peu de bougies MESURÉES : refus même quand l'amorce est complète", async () => {
    // La source s'arrête 20 bougies après le début de la plage : 1 500 d'amorce, 20 mesurées.
    derniereServie = 2480;
    backtestStore.setState({ symbol: "BTCUSDT", plage: "3m", modeFunding: "aucun" });
    backtestStore.getState().loadPreset("builtin:axis");
    backtestStore.getState().run();
    await vi.waitFor(() => { expect(backtestStore.getState().phase).toBe("error"); }, { timeout: 10_000 });
    expect(backtestStore.getState().error).toBe("Trop peu de bougies (20 < 30). Utilise « Charger 2 ans 1d », élargis la plage ou change de TF.");
    expect(backtestStore.getState().nbBougiesChargees).toBe(20);
    expect(postes).toHaveLength(0);
  });

  it("profondeur faible comptée sur les bougies MESURÉES, pas sur le total chargé avec l'amorce", async () => {
    // La source s'arrête 100 bougies après le début de la plage : 1 500 d'amorce + 100
    // mesurées = 1 600 chargées (au-dessus du seuil de 500), mais 100 mesurées seulement.
    derniereServie = 2560;
    const req = await lancer("builtin:axis", "3m");
    expect(req.candles).toHaveLength(1600);
    expect(backtestStore.getState().nbBougiesChargees).toBe(100);
    expect(backtestStore.getState().note).toBe("100 bougies mesurées · BTCUSDT 4h · Binance spot · amorce 1500 bougies · profondeur faible (< 500) — « Charger 2 ans 1d » recommandé · référence BTCUSDT chargée (2000 bougies)");
  });
});
