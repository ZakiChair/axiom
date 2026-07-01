/**
 * Tests de marketStore.upsertCandle — seule logique de dédup/append du buffer de
 * bougies haute-fréquence qui pilote directement le canvas KLineChart (Chart.tsx).
 * Une régression silencieuse ici corrompt l'affichage sans erreur de compilation.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { marketStore } from "./market";

function candle(time: number, close: number): Candle {
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

beforeEach(() => {
  marketStore.setState({ candles: [] });
});

describe("upsertCandle", () => {
  it("remplace la dernière bougie quand le time est identique (tick non clôturé)", () => {
    marketStore.getState().upsertCandle(candle(1000, 10));
    marketStore.getState().upsertCandle(candle(1000, 12)); // même bougie, prix mis à jour

    const candles = marketStore.getState().candles;
    expect(candles).toHaveLength(1);
    expect(candles[0]?.close).toBe(12);
  });

  it("ajoute une nouvelle bougie en fin de buffer quand le time est strictement supérieur", () => {
    marketStore.getState().upsertCandle(candle(1000, 10));
    marketStore.getState().upsertCandle(candle(2000, 20));

    const candles = marketStore.getState().candles;
    expect(candles.map((c) => c.time)).toEqual([1000, 2000]);
  });

  it("ignore silencieusement un tick antérieur au dernier (hors-ordre) sans corrompre le buffer", () => {
    marketStore.getState().upsertCandle(candle(1000, 10));
    marketStore.getState().upsertCandle(candle(2000, 20));
    marketStore.getState().upsertCandle(candle(1500, 99)); // hors-ordre : ni remplacement ni append

    const candles = marketStore.getState().candles;
    expect(candles.map((c) => c.time)).toEqual([1000, 2000]); // buffer inchangé
  });

  it("borne le buffer à une fenêtre glissante : l'ajout au-delà de la limite évince les plus anciennes", () => {
    const MAX_CANDLES = 5000;
    const seeded = Array.from({ length: MAX_CANDLES }, (_, i) => candle(i, i));
    marketStore.setState({ candles: seeded });

    marketStore.getState().upsertCandle(candle(MAX_CANDLES, MAX_CANDLES)); // une de plus

    const candles = marketStore.getState().candles;
    expect(candles).toHaveLength(MAX_CANDLES); // toujours borné
    expect(candles[0]?.time).toBe(1); // la plus ancienne (time=0) a été évincée
    expect(candles[candles.length - 1]?.time).toBe(MAX_CANDLES); // la nouvelle est bien en fin
  });
});
