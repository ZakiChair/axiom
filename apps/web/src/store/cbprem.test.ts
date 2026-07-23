/**
 * Tests de la portion PURE du store CBPREM : `versPointsClos` écarte la bougie en
 * formation (`closed === false`) avant l'alignement — exigence critique du plan que
 * `serieCbprem` (signature `{t, close}`) ne peut structurellement pas assurer.
 *
 * Un test réseau (mock fetch) couvre en plus la garde 200-vide de `run()` — un succès
 * HTTP à série vide ne doit PAS écraser une série valide déjà affichée (cf. revue finale).
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import type { Candle } from "@axiom/types";
import { cbpremStore, versPointsClos } from "./cbprem";

/** Timestamp fixe (passé) pour que les bougies mockées ressortent `closed: true`. */
const T = 1_700_000_000_000;
const H = 3_600_000;

/** Réponse REST Binance minimale (tuple positionnel) pour deux openTime alignés sur T/T+H. */
function binanceRows(): unknown[] {
  return [
    [T, "100", "100", "100", "100", "1", T + H - 1, "1", 1, "0", "0", "0"],
    [T + H, "101", "101", "101", "101", "1", T + 2 * H - 1, "1", 1, "0", "0", "0"],
  ];
}

/** Réponse REST Coinbase minimale (mêmes openTime en secondes) alignée sur binanceRows. */
function coinbaseRows(): { candles: unknown[] } {
  return {
    candles: [
      { start: String(T / 1000), low: "102", high: "102", open: "102", close: "102", volume: "1" },
      { start: String((T + H) / 1000), low: "103", high: "103", open: "103", close: "103", volume: "1" },
    ],
  };
}

/** Mock fetch aiguillé par URL (binance.com vs coinbase.com), succès HTTP dans les deux cas. */
function stubFetch(binance: unknown[], coinbase: { candles: unknown[] }) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    const body = url.includes("binance.com") ? binance : coinbase;
    return { ok: true, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  cbpremStore.setState({ base: "BTC", enCours: false, serie: [], stats: null, erreur: null, majTs: null });
});

/** Bougie minimale (les champs OHLC non pertinents sont posés à des valeurs neutres). */
function candle(time: number, close: number, closed?: boolean): Candle {
  return { time, open: close, high: close, low: close, close, volume: 0, closed };
}

describe("versPointsClos — filtrage de clôture", () => {
  it("écarte la bougie non clôturée (closed === false) et projette en {t, close}", () => {
    const candles = [
      candle(1_000, 101, true),
      candle(2_000, 102, true),
      candle(3_000, 103, false), // en formation → EXCLUE
    ];
    expect(versPointsClos(candles)).toEqual([
      { t: 1_000, close: 101 },
      { t: 2_000, close: 102 },
    ]);
  });

  it("conserve les bougies dont `closed` est undefined (convention finaliser)", () => {
    // Coinbase/Binance REST peuvent renvoyer closed=true|false ; une source sans le
    // drapeau (undefined) ne doit PAS être écartée — seul `closed === false` l'est.
    const candles = [candle(1_000, 101, undefined), candle(2_000, 102, undefined)];
    expect(versPointsClos(candles)).toEqual([
      { t: 1_000, close: 101 },
      { t: 2_000, close: 102 },
    ]);
  });

  it("série vide → tableau vide", () => {
    expect(versPointsClos([])).toEqual([]);
  });
});

describe("run() — garde 200-vide (réponse HTTP OK mais série vide)", () => {
  it("un run réussi à tableaux vides ne remplace PAS une série déjà valide", async () => {
    // 1) premier run : les deux venues renvoient des klines → série non vide établie.
    stubFetch(binanceRows(), coinbaseRows());
    await cbpremStore.getState().run();
    const { serie: serieInitiale, stats: statsInitiaux, majTs: majTsInitial } = cbpremStore.getState();
    expect(serieInitiale.length).toBeGreaterThan(0);
    expect(cbpremStore.getState().erreur).toBeNull();

    // 2) second run : succès HTTP (ok: true) mais tableaux vides des deux côtés.
    stubFetch([], { candles: [] });
    await cbpremStore.getState().run();

    const apres = cbpremStore.getState();
    expect(apres.serie).toBe(serieInitiale); // série précédente conservée (même référence)
    expect(apres.stats).toBe(statsInitiaux);
    expect(apres.majTs).toBe(majTsInitial); // pas réhorodaté
    expect(apres.erreur).toBe("Réponse vide des venues — courbe précédente conservée.");
    expect(apres.enCours).toBe(false);
  });
});
