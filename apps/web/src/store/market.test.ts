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

  it("ne tronque JAMAIS le buffer : il reste aligné index-par-index avec la dataList du chart", () => {
    // La pagination historique (ChartInstance) pousse les MÊMES bougies dans le store et
    // dans la dataList KLineChart ; une troncature côté store seul décale tous les
    // indicateurs/CVD (mappés par index sur dataList). L'ancienne fenêtre de 5 000 est supprimée.
    const seeded = Array.from({ length: 5000 }, (_, i) => candle(i, i));
    marketStore.setState({ candles: seeded });

    marketStore.getState().upsertCandle(candle(5000, 5000)); // une de plus

    const candles = marketStore.getState().candles;
    expect(candles).toHaveLength(5001); // rien d'évincé
    expect(candles[0]?.time).toBe(0); // la plus ancienne est toujours là
    expect(candles[candles.length - 1]?.time).toBe(5000);
  });
});
