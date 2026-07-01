import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Candle } from "@axiom/types";
import { parseMexcKlines, mexcAdapter } from "./mexc";

/** Accès indexé gardé explicitement (noUncheckedIndexedAccess actif sur apps/web). */
function at(c: Candle[], i: number): Candle {
  const v = c[i];
  if (v === undefined) throw new Error(`bougie ${i} absente`);
  return v;
}

describe("parseMexcKlines", () => {
  const NOW = 1_782_700_000_000;

  it("convertit les tuples klines en bougies (tri ascendant)", () => {
    const raw = [
      [1782518400000, "282.09", "285.27", "279.81", "279.85", "194.168", 1782604800000, "54864.31"],
      [1782604800000, "279.85", "284.1", "279.85", "280.96", "172.018", 1782691200000, "48000.0"],
    ];
    const c = parseMexcKlines(raw, NOW);
    expect(c).toHaveLength(2);
    expect(at(c, 0)).toMatchObject({
      time: 1782518400000,
      open: 282.09,
      high: 285.27,
      low: 279.81,
      close: 279.85,
      volume: 194.168,
      quoteVolume: 54864.31,
    });
    expect(at(c, 0).closed).toBe(true); // closeTime < NOW
    expect(at(c, 1).time).toBe(1782604800000);
  });

  it("dérive `closed` de closeTime vs maintenant (dernière barre en cours)", () => {
    const raw = [
      [1782600000000, "1", "2", "0.5", "1.5", "10", 1782600060000, "15"], // closeTime < NOW → closed
      [1782699960000, "1.5", "1.6", "1.4", "1.55", "5", 1782760000000, "8"], // closeTime > NOW → en cours
    ];
    const c = parseMexcKlines(raw, NOW);
    expect(at(c, 0).closed).toBe(true);
    expect(at(c, 1).closed).toBe(false);
  });

  it("écarte les barres non numériques", () => {
    const raw = [
      [1782518400000, "100", "101", "99", "100.5", "3", 1782518460000, "300"],
      [1782518460000, "x", "y", "z", "w", "", 1782518520000, ""],
    ];
    expect(parseMexcKlines(raw, NOW)).toHaveLength(1);
  });

  it("renvoie [] si la réponse n'est pas un tableau", () => {
    expect(parseMexcKlines({ code: 700002, msg: "Signature for this request is not valid" }, NOW)).toEqual([]);
  });
});

/**
 * subscribeKline (polling) doit émettre la bougie PRÉCÉDENTE en closed:true exactement
 * une fois quand elle se clôture, AVANT de transmettre la bougie en cours — sinon les
 * indicateurs ne recalculent plus jamais après le backfill (régression réelle corrigée
 * ici). Timers + fetch mockés : déterministe, pas de réseau ni de navigateur requis.
 */
describe("mexcAdapter.subscribeKline — séquence closed:true", () => {
  const T0 = 1_700_000_000_000;
  // Bucket A : déjà clos avant le 1er poll (closeTime = T0+1000 < poll1 à T0+5000).
  const bucketA = [T0 - 5000, "100", "101", "99", "100.5", "10", T0 + 1000, "1000"];
  // Bucket B : en cours aux polls 1 et 2 (closeTime = T0+12000), clos au poll 3 (now=T0+15000).
  const bucketB = [T0, "100.5", "102", "100", "101", "20", T0 + 12000, "2000"];
  // Bucket C : nouvelle bougie en cours, visible seulement au poll 3.
  const bucketC = [T0 + 12000, "101", "103", "100.5", "102", "5", T0 + 25000, "500"];

  let calls: number;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    calls = 0;
    fetchMock = vi.fn(() => {
      calls += 1;
      // Poll 1 & 2 : [A, B] (B pas encore clos) ; poll 3+ : [B, C] (B vient de clore).
      const body = calls <= 2 ? [bucketA, bucketB] : [bucketB, bucketC];
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("émet la bougie close une seule fois à sa clôture, jamais en double, avant la bougie en cours", async () => {
    const received: Array<{ time: number; closed: boolean | undefined }> = [];
    const unsubscribe = mexcAdapter.subscribeKline("BTCUSDT", "1m", (c) => {
      received.push({ time: c.time, closed: c.closed });
    });

    await vi.advanceTimersByTimeAsync(5_000); // poll 1 (now = T0+5000)
    await vi.advanceTimersByTimeAsync(5_000); // poll 2 (now = T0+10000)
    await vi.advanceTimersByTimeAsync(5_000); // poll 3 (now = T0+15000) — B se clôture

    unsubscribe();

    expect(received).toEqual([
      { time: T0 - 5000, closed: true }, // poll 1 : A déjà close, émise avant B
      { time: T0, closed: false }, // poll 1 : B en cours
      { time: T0, closed: false }, // poll 2 : B toujours en cours (PAS de ré-émission de A)
      { time: T0, closed: true }, // poll 3 : B vient de clore → recalcul des indicateurs
      { time: T0 + 12000, closed: false }, // poll 3 : C, la nouvelle bougie en cours
    ]);
  });
});
