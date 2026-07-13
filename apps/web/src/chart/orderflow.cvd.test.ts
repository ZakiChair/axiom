/**
 * Non-régression CVD reseed (Lot A0.4).
 *
 * Audit A0.1 (chemins onResync / backfill / pagination) :
 *  - ChartInstance backfill initial → orderflow.onCandles() → refreshCvd()
 *  - ChartInstance onResync → prepareResyncApply → setCandles → orderflow.onCandles()
 *  - Pagination historique → orderflow.onCandles()
 *  - onTick kline → orderflow.onTick() → refreshCvd()
 *  - binance/kraken/coinbase subscribeKline : 4e arg onResync câblé (TF natifs)
 *  - TF longs Binance agrégés (3M/6M/12M) : resync volontairement non câblé
 *    (échelle mensuelle — aucune bougie clôturée manquée sur coupure WS)
 *  - mexc/twelvedata : polling REST (pas de onResync ; le poll comble les trous)
 *
 * Ce test fige le pipeline PUR prepareResyncApply → computeCvd : après fusion REST
 * (même open times, contenu corrigé), computeCvd doit refléter les buy/sell
 * finalisés — c'est ce que refreshCvd() applique au sous-pane.
 * La règle d'application (pas length-only) est verrouillée dans resync.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { prepareResyncApply } from "../data/resync";
import { computeCvd } from "./orderflow";

function candle(
  time: number,
  opts: { buy: number; sell: number; closed?: boolean },
): Candle {
  return {
    time,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: opts.buy + opts.sell,
    buyVolume: opts.buy,
    sellVolume: opts.sell,
    closed: opts.closed ?? true,
  };
}

describe("CVD reseed après mergeResyncCandles (non-régression A0.4)", () => {
  it("recalcule le CVD cumulé après correction REST à open times égaux", () => {
    // Buffer live partiel (volumes buy/sell incomplets pendant la coupure).
    const existing = [
      candle(1_000, { buy: 10, sell: 5 }),
      candle(2_000, { buy: 1, sell: 0, closed: false }), // bougie en cours sous-estimée
    ];
    // REST finalise la bougie 2_000 (même longueur de buffer, contenu différent).
    const fetched = [
      candle(1_000, { buy: 10, sell: 5 }),
      candle(2_000, { buy: 20, sell: 8, closed: true }),
    ];

    const merged = prepareResyncApply(existing, fetched);
    // prepareResyncApply ne doit PAS retourner null sur même length (règle A0.4).
    expect(merged).not.toBeNull();
    expect(merged!).toHaveLength(2);
    expect(merged!.length).toBe(existing.length);

    const cvdAvant = computeCvd(existing);
    const cvdApres = computeCvd(merged!);

    // Avant : (10-5)=5 puis (1-0)=1 → [5, 6]
    expect(cvdAvant).toEqual([5, 6]);
    // Après : (10-5)=5 puis (20-8)=12 → [5, 17]
    expect(cvdApres).toEqual([5, 17]);
    expect(cvdApres).not.toEqual(cvdAvant);
  });

  it("comble un trou (nouvelle open time) et prolonge le CVD", () => {
    const existing = [candle(1_000, { buy: 4, sell: 1 })];
    const fetched = [
      candle(1_000, { buy: 4, sell: 1 }),
      candle(2_000, { buy: 0, sell: 3 }), // bougie manquée pendant la coupure
    ];
    const merged = prepareResyncApply(existing, fetched);
    expect(merged).not.toBeNull();
    expect(merged!).toHaveLength(2);
    expect(computeCvd(merged!)).toEqual([3, 0]); // 3 puis 3-3=0
  });
});
