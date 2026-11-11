/**
 * @axiom/alerts — engine.axisSr.test.ts
 *
 * Preuve du lot 3 d'AXIS S/R (conception du 2026-11-09, §3.5) : une alerte de seuil existante
 * (`indicateur-seuil`) sur les sorties masquées `reactionSupport` et `reactionResistance` de
 * `stratAxisSr`, réglages par défaut, évaluée bougie par bougie sur des préfixes croissants du cas
 * de référence BTCUSDT 4h (toutes bougies `closed: true`, comme les klines servies au runtime), se
 * déclenche exactement aux bougies de réaction sur zone forte, sans bougie de retard.
 *
 * Les bougies viennent du JSON de la fixture, converties ici : importer `fixtures/btcusdt4h.ts`
 * depuis ce paquet le placerait hors du `rootDir` de `tsc` (TS6059). Les indices attendus sont
 * ceux que `stratAxisSr.reactions.test.ts` épingle depuis l'index 2 700 (20 sur support fort,
 * 11 sur résistance forte) ; aucun n'en suit un autre du même sens, d'où un tir par réaction.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { evaluerAlertes } from "./engine";
import type { AlertDef, Condition, ContexteAlerte } from "./types";
import fixtureBtc from "../../indicators/src/strategy/fixtures/btcusdt-4h-3000.json";

/** Une ligne du JSON, colonnes `time`, `open`, `high`, `low`, `close`, `volume`, `buyVolume`. */
type LigneBougie = [time: number, open: number, high: number, low: number, close: number, volume: number, buyVolume: number];

/** Les 3 000 bougies, toutes closes ; `sellVolume = volume − buyVolume`. */
const candles: Candle[] = (fixtureBtc.bougies as LigneBougie[]).map(([time, open, high, low, close, volume, buyVolume]) => ({
  time,
  open,
  high,
  low,
  close,
  volume,
  buyVolume,
  sellVolume: volume - buyVolume,
  closed: true,
}));

/** Pilote une def sur les préfixes croissants ; renvoie les indices de déclenchement. */
function declenchements(condition: Condition, premierIndice: number): number[] {
  let courante: AlertDef = {
    id: "axis-sr",
    symbol: "BTCUSDT",
    source: "binance",
    condition,
    actif: true,
    declenchements: [],
  };
  const tires: number[] = [];
  for (let i = premierIndice; i < candles.length; i++) {
    const ctx: ContexteAlerte = {
      maintenant: i,
      dernierPrix: candles[i]!.close,
      candles: candles.slice(0, i + 1),
    };
    const res = evaluerAlertes([courante], ctx);
    if (res.defs[0]) courante = res.defs[0];
    if (res.declenchements.length > 0) tires.push(i);
  }
  return tires;
}

const reaction = (output: "reactionSupport" | "reactionResistance"): Condition => ({
  type: "indicateur-seuil",
  indicateurId: "stratAxisSr",
  params: {},
  output,
  comparateur: ">=",
  valeur: 1,
});

describe("indicateur-seuil sur stratAxisSr.reactionSupport / reactionResistance (BTCUSDT 4h, bougies closes)", () => {
  it("reactionSupport >= 1 : calibre sans tirer à l'index 2 700, puis tire exactement aux 20 réactions sur support fort", () => {
    expect(declenchements(reaction("reactionSupport"), 2700)).toEqual([
      2733, 2750, 2766, 2798, 2803, 2809, 2853, 2860, 2896, 2901, 2904, 2916, 2928, 2946, 2957, 2961, 2974, 2980, 2985, 2988,
    ]);
  }, 60_000);

  it("reactionResistance >= 1 : calibre sans tirer à l'index 2 700, puis tire exactement aux 11 réactions sur résistance forte, 2 850 (signal confirmé) compris", () => {
    expect(declenchements(reaction("reactionResistance"), 2700)).toEqual([2754, 2761, 2767, 2811, 2821, 2824, 2835, 2838, 2850, 2859, 2954]);
  }, 60_000);
});
