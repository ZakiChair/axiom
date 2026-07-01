/**
 * Tests de macroHistoryStore.record — dédup (MIN_GAP_MS) + tampon circulaire
 * (MAX_POINTS) qui construisent la SEULE série historique de capitalisation crypto
 * (CoinGecko gratuit ne fournit qu'un instantané, aucun backfill possible). Une
 * régression ici perd silencieusement des points qui ne peuvent PAS être reconstitués.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { macroHistoryStore } from "./macroHistory";

const MIN_GAP_MS = 4 * 60_000;
const MAX_POINTS = 1500;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  macroHistoryStore.setState({ snapshots: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("macroHistoryStore.record", () => {
  it("enregistre un premier échantillon", () => {
    macroHistoryStore.getState().record(100, 50, 10);
    const snaps = macroHistoryStore.getState().snapshots;
    expect(snaps).toEqual([{ t: 0, total: 100, total2: 50, total3: 10 }]);
  });

  it("ignore un second appel trop proche du dernier (< MIN_GAP_MS)", () => {
    macroHistoryStore.getState().record(100, 50, 10);
    vi.setSystemTime(MIN_GAP_MS - 1);
    macroHistoryStore.getState().record(200, 60, 20);

    expect(macroHistoryStore.getState().snapshots).toHaveLength(1); // 2e appel ignoré
  });

  it("enregistre un nouveau point une fois MIN_GAP_MS écoulé", () => {
    macroHistoryStore.getState().record(100, 50, 10);
    vi.setSystemTime(MIN_GAP_MS);
    macroHistoryStore.getState().record(200, 60, 20);

    const snaps = macroHistoryStore.getState().snapshots;
    expect(snaps.map((s) => s.total)).toEqual([100, 200]);
  });

  it("ignore un total non fini (NaN/Infinity) sans toucher au buffer", () => {
    macroHistoryStore.getState().record(100, 50, 10);
    macroHistoryStore.getState().record(NaN, 60, 20);

    expect(macroHistoryStore.getState().snapshots).toHaveLength(1);
  });

  it("borne la série à MAX_POINTS : l'ajout au-delà évince le plus ancien échantillon", () => {
    const seeded = Array.from({ length: MAX_POINTS }, (_, i) => ({
      t: i * MIN_GAP_MS,
      total: i,
      total2: 0,
      total3: 0,
    }));
    macroHistoryStore.setState({ snapshots: seeded });
    vi.setSystemTime(MAX_POINTS * MIN_GAP_MS);

    macroHistoryStore.getState().record(MAX_POINTS, 0, 0); // un échantillon de plus

    const snaps = macroHistoryStore.getState().snapshots;
    expect(snaps).toHaveLength(MAX_POINTS); // toujours borné
    expect(snaps[0]?.total).toBe(1); // le plus ancien (total=0) a été évincé
    expect(snaps[snaps.length - 1]?.total).toBe(MAX_POINTS); // le nouveau est bien en fin
  });
});
