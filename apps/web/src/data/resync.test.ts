/**
 * Tests de mergeResyncCandles + prepareResyncApply (resync.ts).
 * Une régression de fusion laisserait un trou permanent (bougies manquées pendant
 * une coupure WS) ou dupliquerait/désordonnerait le buffer. Une régression de
 * prepareResyncApply (early-return length-only) laisserait le CVD stale après
 * reconnexion alors que le REST a corrigé buy/sell à open times égaux.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { mergeResyncCandles, prepareResyncApply } from "./resync";

/** Bougie minimale : `time` + `closed` (les seuls champs qui pilotent la fusion). */
function candle(time: number, closed: boolean, close = time): Candle {
  return { time, open: close, high: close, low: close, close, volume: 1, closed };
}

describe("mergeResyncCandles", () => {
  it("comble un trou : les bougies clôturées manquées pendant la coupure sont insérées", () => {
    // Le buffer s'est arrêté à T2 (coupure) ; le REST re-livre T1..T5.
    const existing = [candle(1, true), candle(2, false)];
    const fetched = [candle(1, true), candle(2, true), candle(3, true), candle(4, true), candle(5, false)];

    const merged = mergeResyncCandles(existing, fetched);

    // Trou comblé : les 5 open times présents, en ordre croissant.
    expect(merged.map((c) => c.time)).toEqual([1, 2, 3, 4, 5]);
    expect(merged).toHaveLength(5);
  });

  it("le REST prime à open time égal : la bougie en cours devient sa version clôturée", () => {
    // T2 était en cours dans le buffer ; le REST la re-livre finalisée (closed:true).
    const existing = [candle(1, true), candle(2, false)];
    const fetched = [candle(2, true), candle(3, true)];

    const merged = mergeResyncCandles(existing, fetched);

    expect(merged.map((c) => c.time)).toEqual([1, 2, 3]);
    expect(merged.find((c) => c.time === 2)?.closed).toBe(true); // finalisée par le REST
  });

  it("conserve une bougie live plus récente que le lot REST (course fetch/tick)", () => {
    // Pendant le fetch REST (qui s'arrête à T5), un tick live a déjà posé T6.
    const existing = [candle(4, true), candle(5, true), candle(6, false)];
    const fetched = [candle(3, true), candle(4, true), candle(5, true)];

    const merged = mergeResyncCandles(existing, fetched);

    // T6 (absente du REST) est préservée en fin ; T3 (nouvelle) insérée en tête.
    expect(merged.map((c) => c.time)).toEqual([3, 4, 5, 6]);
    expect(merged.at(-1)?.time).toBe(6);
  });

  it("trie par open time même si les entrées sont désordonnées et dédup", () => {
    const existing = [candle(30, false), candle(10, true)];
    const fetched = [candle(20, true), candle(10, true)];

    const merged = mergeResyncCandles(existing, fetched);

    expect(merged.map((c) => c.time)).toEqual([10, 20, 30]); // ascendant, sans doublon
  });

  it("buffer vide + lot REST : renvoie simplement le lot trié (cas backfill dégénéré)", () => {
    const merged = mergeResyncCandles([], [candle(2, true), candle(1, true)]);
    expect(merged.map((c) => c.time)).toEqual([1, 2]);
  });
});

describe("prepareResyncApply (règle onResync — pas length-only)", () => {
  it("retourne null si le lot REST est vide (rien à appliquer)", () => {
    const existing = [candle(1, true), candle(2, false)];
    expect(prepareResyncApply(existing, [])).toBeNull();
  });

  it("applique même si merged.length === existing.length (anti-régression length-only)", () => {
    // Cas critique A0.4 : REST corrige closed/contenu à open times déjà présents.
    // Une régression `if (merged.length === existing.length) return` ferait
    // retourner null ici et casserait le reseed CVD dans ChartInstance.onResync.
    const existing = [candle(1, true), candle(2, false)];
    const fetched = [candle(1, true), candle(2, true)]; // même cardinalité, contenu différent

    const result = prepareResyncApply(existing, fetched);

    expect(result).not.toBeNull();
    expect(result).toHaveLength(existing.length);
    expect(result!.find((c) => c.time === 2)?.closed).toBe(true);
  });

  it("applique et allonge le buffer quand le REST comble un trou", () => {
    const existing = [candle(1, true)];
    const fetched = [candle(1, true), candle(2, true)];

    const result = prepareResyncApply(existing, fetched);

    expect(result).not.toBeNull();
    expect(result!.map((c) => c.time)).toEqual([1, 2]);
  });

  it("buffer existing vide + lot non vide : applique le lot trié", () => {
    const result = prepareResyncApply([], [candle(2, true), candle(1, true)]);
    expect(result).not.toBeNull();
    expect(result!.map((c) => c.time)).toEqual([1, 2]);
  });
});
