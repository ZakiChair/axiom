/**
 * Tests de `coinbaseAdapter.fetchKlines` — construction de la requête REST candles.
 *
 * Vérifié par appels publics (sans clé) le 2026-09-16 sur BTC-USD / ONE_HOUR : quand le
 * paramètre `limit` est présent, Coinbase IGNORE start/end et renvoie les `limit` DERNIÈRES
 * bougies. La pagination arrière par `endTime` (store cbprem, défilement des charts Coinbase,
 * EVTS, saisonnalité) recevait donc toujours la même page. Sans `limit`, la fenêtre est
 * honorée (350 bougies max, sinon HTTP 400).
 *
 * Ces tests figent : aucun `limit` dans l'URL, fenêtre start/end = exactement limit × tf,
 * borne à 350, et tri ascendant des bougies (Coinbase répond du plus récent au plus ancien).
 * `fetch` est mocké (vi.stubGlobal) : aucun réseau, on inspecte l'URL réellement appelée.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@axiom/types";
import { coinbaseAdapter } from "./coinbase";

/** Timestamp fixe (passé) : les bougies mockées ressortent `closed: true`. */
const T = 1_700_000_000_000;
const H = 3_600_000;
const H_SEC = 3600;

/** Accès indexé gardé explicitement (noUncheckedIndexedAccess actif sur apps/web). */
function at(c: Candle[], i: number): Candle {
  const v = c[i];
  if (v === undefined) throw new Error(`bougie ${i} absente`);
  return v;
}

/** Mock fetch : succès HTTP, corps JSON fourni. Renvoie le mock pour inspecter l'URL appelée. */
function stubFetch(body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async () => ({ ok: true, json: async () => body }) as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Paramètres de requête de l'unique appel fetch. `extUrl` produit un chemin RELATIF
 * (`/extapi/api.coinbase.com/…`) hors daemon : une base factice permet de le parser.
 */
function paramsAppel(fetchMock: ReturnType<typeof stubFetch>): URLSearchParams {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const url = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://axiom.local");
  expect(url.pathname).toBe("/extapi/api.coinbase.com/api/v3/brokerage/market/products/BTC-USD/candles");
  return url.searchParams;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("coinbaseAdapter.fetchKlines — requête REST candles", () => {
  it("n'envoie PAS le paramètre `limit` (sa présence fait ignorer start/end côté Coinbase)", async () => {
    const fetchMock = stubFetch({ candles: [] });
    await coinbaseAdapter.fetchKlines("BTCUSD", "1h", { limit: 300, endTime: T });

    const params = paramsAppel(fetchMock);
    expect(params.get("limit")).toBeNull();
    expect(params.get("granularity")).toBe("ONE_HOUR");
  });

  it("end = floor(endTime / 1000) et end − start = limit × tf (secondes)", async () => {
    const fetchMock = stubFetch({ candles: [] });
    // endTime non arrondi à la seconde : exerce réellement le floor.
    await coinbaseAdapter.fetchKlines("BTCUSD", "1h", { limit: 300, endTime: T + 999 });

    const params = paramsAppel(fetchMock);
    const end = Number(params.get("end"));
    const start = Number(params.get("start"));
    expect(end).toBe(Math.floor((T + 999) / 1000));
    expect(end - start).toBe(300 * H_SEC);
  });

  it("borne un `limit` demandé > 350 à 350 (fenêtre de 350 × tf)", async () => {
    const fetchMock = stubFetch({ candles: [] });
    await coinbaseAdapter.fetchKlines("BTCUSD", "1h", { limit: 1000, endTime: T });

    const params = paramsAppel(fetchMock);
    const end = Number(params.get("end"));
    const start = Number(params.get("start"));
    expect(end - start).toBe(350 * H_SEC);
  });

  it("trie par temps croissant les bougies renvoyées du plus récent au plus ancien", async () => {
    // Ordre Coinbase : la plus récente d'abord. Les valeurs sont des chaînes (start = UNIX secondes).
    stubFetch({
      candles: [
        { start: String((T + 2 * H) / 1000), low: "98", high: "104", open: "103", close: "102", volume: "3" },
        { start: String((T + H) / 1000), low: "99", high: "103", open: "101", close: "103", volume: "2" },
        { start: String(T / 1000), low: "100", high: "102", open: "100", close: "101", volume: "1" },
      ],
    });
    const out = await coinbaseAdapter.fetchKlines("BTCUSD", "1h", { limit: 3, endTime: T + 3 * H });

    expect(out.map((c) => c.time)).toEqual([T, T + H, T + 2 * H]);
    expect(at(out, 0)).toMatchObject({ open: 100, high: 102, low: 100, close: 101, volume: 1, closed: true });
    expect(at(out, 2)).toMatchObject({ open: 103, high: 104, low: 98, close: 102, volume: 3, closed: true });
  });
});
