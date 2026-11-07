import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { alignAux } from "../utils-aux";
import { primeVol } from "./primeVol";

const JOUR = 86_400_000;
const H4 = 4 * 3_600_000;
const T0 = Date.UTC(2026, 0, 1);

/** Clôture du jour d (prix déterministe, rendements alternés de ±2 % et ±1 %). */
const cloture = (d: number): number => 100 * Math.exp(d % 2 === 0 ? 0.02 * (d % 4 === 0 ? 1 : -1) : 0.01);
/** DVOL clos du jour d (croissant : le dernier jour est le plus haut de sa fenêtre). */
const dvolJour = (d: number): number => 40 + d * 0.5;

const jours = (nb: number, decalage = 0): Candle[] =>
  Array.from({ length: nb }, (_, d) => ({ time: T0 + d * JOUR + decalage, open: 100, high: 110, low: 90, close: cloture(d), volume: 1 }));

/** Points DVOL datés à la FIN de leur jour (instant connu), comme l'aux `dvol`. */
const pointsDvol = (nb: number) => Array.from({ length: nb }, (_, d) => ({ time: T0 + (d + 1) * JOUR, value: dvolJour(d) }));

const calc = (candles: Candle[], nbJoursDvol: number, params: Record<string, number> = { longueurRv: 5, fenetre: 20 }) =>
  computeIndicator(primeVol, candles, params, { dvol: alignAux(candles.map((c) => c.time), pointsDvol(nbJoursDvol), true) });

/** RV annualisée attendue des jours [d − L, d] (écart-type population × √365 × 100). */
function rvAttendue(d: number, L: number): number {
  const r = Array.from({ length: L }, (_, k) => Math.log(cloture(d - L + 1 + k) / cloture(d - L + k)));
  const m = r.reduce((a, b) => a + b, 0) / L;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / L * 365) * 100;
}

describe("primeVol — DVOL, VRP = DVOL − RV, percentile du DVOL", () => {
  it("en 1d : la bougie D lit la clôture DVOL de D et la RV des L rendements jusqu'à D", () => {
    const r = calc(jours(40), 40).series;
    expect(r.dvol?.[30]).toBe(dvolJour(30));
    expect(r.vrp?.[4]).toBeUndefined(); // 5 rendements exigent 6 clôtures
    expect(r.vrp?.[5]).toBeCloseTo(dvolJour(5) - rvAttendue(5, 5), 10);
    expect(r.vrp?.[30]).toBeCloseTo(dvolJour(30) - rvAttendue(30, 5), 10);
    expect(r.percentile?.[18]).toBeUndefined(); // 20 jours de DVOL exigés
    expect(r.percentile?.[30]).toBe(97.5); // plus haut de sa fenêtre : (19 + ½) / 20
  });

  it("la bougie en cours n'ajoute aucune clôture : elle porte l'état du dernier jour clos", () => {
    const candles = jours(40);
    candles[39] = { ...candles[39]!, closed: false, close: 1 }; // clôture provisoire absurde
    const r = calc(candles, 39).series; // DVOL du jour en cours absent (bougie non close)
    expect(r.vrp?.[39]).toBeCloseTo(r.vrp?.[38] ?? Number.NaN, 12);
    expect(r.percentile?.[39]).toBe(r.percentile?.[38]);
  });

  it("causalité par préfixe : ajouter des bougies ne change aucune valeur passée", () => {
    const toutes = jours(45);
    const complet = calc(toutes, 45).series;
    for (const k of [10, 26, 33]) {
      const prefixe = calc(toutes.slice(0, k), 45).series;
      for (const cle of ["dvol", "vrp", "percentile"] as const) {
        expect(prefixe[cle], `${cle} sur ${k} bougies`).toEqual(complet[cle]?.slice(0, k));
      }
    }
  });

  it("en 4h : valeurs quotidiennes identiques au 1d, mises à jour à la bougie qui finit à minuit", () => {
    const quotidien = calc(jours(32), 32).series;
    const h4: Candle[] = [];
    for (let d = 0; d < 32; d++) {
      for (let k = 0; k < 6; k++) h4.push({ time: T0 + d * JOUR + k * H4, open: 100, high: 101, low: 99, close: k === 5 ? cloture(d) : 100, volume: 1 });
    }
    const r = calc(h4, 32).series;
    const iFin = 30 * 6 + 5; // 20:00 du jour 30 : finit à minuit, lit la clôture du jour 30
    expect(r.vrp?.[iFin]).toBeCloseTo(quotidien.vrp?.[30] ?? Number.NaN, 10);
    expect(r.percentile?.[iFin]).toBe(quotidien.percentile?.[30]);
    // 08:00 du jour 31 : état du jour 30 (DVOL de la veille, RV jusqu'à la veille).
    expect(r.vrp?.[31 * 6 + 2]).toBeCloseTo(quotidien.vrp?.[30] ?? Number.NaN, 10);
    // 16:00 du jour 30 : encore l'état du jour 29.
    expect(r.vrp?.[30 * 6 + 4]).toBeCloseTo(quotidien.vrp?.[29] ?? Number.NaN, 10);
  });

  it("DVOL absent (actif sans options Deribit) : aucune valeur inventée, libellé explicite", () => {
    const r = calc(jours(40), 0);
    expect(r.series.dvol?.every((v) => v === undefined)).toBe(true);
    expect(r.series.vrp?.every((v) => v === undefined)).toBe(true);
    expect(r.annotations?.labels?.[0]).toMatchObject({ idx: 39, ancrageY: "haut-pane", texte: "DVOL indisponible (BTC/ETH seulement)" });
  });

  it("libellé d'état : percentile en attente, puis lecture complète ; aucune bougie, aucune annotation", () => {
    expect(calc(jours(12), 12).annotations?.labels?.[0]?.texte).toBe("Percentile : 20 j de DVOL requis");
    expect(calc(jours(40), 40).annotations?.labels?.[0]?.texte).toBe("VRP ex ante, percentile 20 j");
    expect(calc([], 0).annotations).toBeUndefined();
  });

  it("bougies hebdomadaires ou non alignées sur minuit UTC : RV non mesurée, DVOL seul", () => {
    const decalees = calc(jours(40, 3_600_000), 40);
    expect(decalees.series.vrp?.every((v) => v === undefined)).toBe(true);
    expect(decalees.series.dvol?.[30]).toBeDefined();
    // Attendre ne changera rien : le libellé ne parle pas de clôtures « requises ».
    expect(decalees.annotations?.labels?.[0]?.texte).toBe("RV non mesurée (bougies > 1 j ou non alignées sur minuit UTC)");
    const hebdo: Candle[] = Array.from({ length: 30 }, (_, k) => ({ time: T0 + k * 7 * JOUR, open: 1, high: 2, low: 1, close: 1 + k / 100, volume: 1 }));
    const res = computeIndicator(primeVol, hebdo, { longueurRv: 5, fenetre: 20 }, { dvol: hebdo.map(() => 50) });
    const r = res.series;
    expect(r.vrp?.every((v) => v === undefined)).toBe(true);
    expect(r.percentile?.every((v) => v === undefined)).toBe(true);
    expect(res.annotations?.labels?.[0]?.texte).toBe("RV non mesurée (bougies > 1 j ou non alignées sur minuit UTC)");
    // Historique simplement trop court : l'attente suffit, le libellé le dit.
    expect(calc(jours(4), 4).annotations?.labels?.[0]?.texte).toBe("RV : 6 clôtures UTC consécutives requises");
  });

  it("un jour manquant rompt la chaîne : RV et percentile repartent de zéro", () => {
    const candles = jours(40).filter((_, d) => d !== 20);
    const r = calc(candles, 40).series;
    expect(r.vrp?.[19]).toBeDefined(); // jour 19
    expect(r.vrp?.[20]).toBeUndefined(); // jour 21, juste après le trou
    expect(r.vrp?.[24]).toBeUndefined(); // jour 25 : 5 clôtures seulement depuis le trou
    expect(r.vrp?.[25]).toBeCloseTo(dvolJour(26) - rvAttendue(26, 5), 10);
    expect(r.percentile?.[30]).toBeUndefined(); // moins de 20 jours depuis le trou
  });

  it("paramètres bornés (entiers, défauts 30 et 90)", () => {
    const candles = jours(130);
    const aux = { dvol: alignAux(candles.map((c) => c.time), pointsDvol(130), true) };
    const defauts = computeIndicator(primeVol, candles, { longueurRv: Number.NaN, fenetre: Number.NaN }, aux).series;
    expect(defauts.vrp?.findIndex((v) => v !== undefined)).toBe(30);
    expect(defauts.percentile?.findIndex((v) => v !== undefined)).toBe(89);
    const bornes = computeIndicator(primeVol, candles, { longueurRv: 2.7, fenetre: 1e6 }, aux).series;
    expect(bornes.vrp?.findIndex((v) => v !== undefined)).toBe(5); // 2,7 → 5 (minimum)
    expect(bornes.percentile?.every((v) => v === undefined)).toBe(true); // 1e6 → 365 > 130 jours
  });
});
