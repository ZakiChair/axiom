/**
 * Tests de la portion PURE du store CBPREM : `versPointsClos` écarte la bougie en
 * formation (`closed === false`) avant l'alignement — exigence critique du plan que
 * `serieCbprem` (signature `{t, close}`) ne peut structurellement pas assurer.
 *
 * Des tests réseau (mock fetch aiguillé par hôte) couvrent en plus : la garde 200-vide de
 * `run()` — un succès HTTP à série vide ne doit PAS écraser une série valide déjà affichée
 * (cf. revue finale) — et le contrat de l'ajustement USDT/USD (Kraken) : échec Kraken NON
 * destructif pour `erreur` (et tracé en console), mode « ajuste » par défaut (y compris après
 * un premier run vide), `setMode` sans refetch, persistance du mode entre deux runs, forme de
 * la requête Kraken (pair, interval, un seul appel).
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

/**
 * Réponse REST Kraken minimale (tuple positionnel, openTime en SECONDES comme Coinbase)
 * pour USDT/USD aux mêmes openTime T/T+H, close = `k` sur les deux bougies.
 */
function krakenRows(k = 1): { error: string[]; result: Record<string, unknown[]> } {
  const c = String(k);
  return {
    error: [],
    result: {
      USDTZUSD: [
        [T / 1000, c, c, c, c, c, "100", 5],
        [(T + H) / 1000, c, c, c, c, c, "100", 5],
      ],
    },
  };
}

/** Corps Kraken servi par le stub, ou « echec » pour simuler un 503 (l'adaptateur rejette sur !ok). */
type StubKraken = ReturnType<typeof krakenRows> | "echec";

/**
 * Mock fetch aiguillé par URL : kraken.com (testé EN PREMIER — sinon il recevrait le corps
 * Coinbase), binance.com, sinon coinbase. Succès HTTP partout sauf Kraken « echec ».
 * Par défaut Kraken répond k = 1 (ajustement neutre) pour que les tests historiques
 * gardent leurs valeurs. Coinbase est paginé en arrière par le store (jusqu'à 3 pages) :
 * la page n'est servie qu'UNE fois puis vide (fin de pagination) — sinon la même page
 * serait comptée trois fois (openTime dupliqués dans la série).
 */
function stubFetch(binance: unknown[], coinbase: { candles: unknown[] }, kraken: StubKraken = krakenRows()) {
  let coinbaseServi = false;
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes("api.kraken.com")) {
      if (kraken === "echec") {
        return { ok: false, status: 503, statusText: "Service Unavailable" } as Response;
      }
      return { ok: true, json: async () => kraken } as Response;
    }
    if (url.includes("binance.com")) return { ok: true, json: async () => binance } as Response;
    const page = coinbaseServi ? { candles: [] } : coinbase;
    coinbaseServi = true;
    return { ok: true, json: async () => page } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  cbpremStore.setState({
    base: "BTC",
    enCours: false,
    serie: [],
    stats: null,
    erreur: null,
    majTs: null,
    mode: "ajuste",
    serieBrute: [],
    serieAjustee: [],
    ecartPegPct: null,
    noteAjustement: null,
  });
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

describe("run() — wording du PREMIER échec (aucune série préalable)", () => {
  it("un échec réseau sans série déjà affichée pose un message SANS « conservé »", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error("réseau");
    });
    vi.stubGlobal("fetch", fetchMock);

    await cbpremStore.getState().run();

    const s = cbpremStore.getState();
    expect(s.serie).toEqual([]); // rien n'a jamais été affiché
    expect(s.erreur).toBe("Klines indisponibles (Coinbase ou Binance).");
    expect(s.enCours).toBe(false);
  });
});

/**
 * Valeurs de référence des tests d'ajustement (closes Coinbase 102/103, Binance 100/101) :
 *  - brut      : t=T (102−100)/100 = 2 % ; t=T+H (103−101)/101 = 1.9801980198019802 %.
 *  - ajusté k=0.998 : t=T (102−99.8)/99.8 = 2.2044088176352736 % ;
 *                     t=T+H (103−100.798)/100.798 = 2.1845671541101988 %.
 *  - écart de peg : (0.998 − 1) × 100 = −0.2 %.
 */
const NOTE_KRAKEN = "Ajustement USDT indisponible (Kraken) — prime brute affichée.";

describe("run() — ajustement USDT/USD (Kraken) NON destructif pour `erreur`", () => {
  it("Kraken en échec ⇒ mode 'brute', note posée, `erreur` reste null, série brute affichée, échec tracé en console", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(binanceRows(), coinbaseRows(), "echec");
    await cbpremStore.getState().run();

    // L'échec est avalé (bonus non destructif) mais PAS en silence : diagnostic en console.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("Kraken");
    warn.mockRestore();

    const s = cbpremStore.getState();
    expect(s.erreur).toBeNull(); // `erreur` = Coinbase/Binance uniquement
    expect(s.mode).toBe("brute");
    expect(s.noteAjustement).toBe(NOTE_KRAKEN);
    expect(s.serieAjustee).toEqual([]);
    expect(s.ecartPegPct).toBeNull();
    expect(s.serieBrute.length).toBe(2);
    expect(s.serie).toBe(s.serieBrute); // même référence : c'est la brute qui est affichée
    expect(s.serie[0]?.premiumPct).toBeCloseTo(2, 9);
    expect(s.stats?.courant).toBeCloseTo(1.9801980198019802, 9);
    expect(s.majTs).not.toBeNull();
  });

  it("Kraken OK ⇒ mode 'ajuste' par défaut, `serie` = ajustée, écart de peg du dernier point, note absente", async () => {
    stubFetch(binanceRows(), coinbaseRows(), krakenRows(0.998));
    await cbpremStore.getState().run();

    const s = cbpremStore.getState();
    expect(s.erreur).toBeNull();
    expect(s.noteAjustement).toBeNull();
    expect(s.mode).toBe("ajuste");
    expect(s.serieAjustee.length).toBe(2);
    expect(s.serie).toBe(s.serieAjustee);
    expect(s.serie[0]?.premiumPct).toBeCloseTo(2.2044088176352736, 9);
    expect(s.stats?.courant).toBeCloseTo(2.1845671541101988, 9);
    expect(s.ecartPegPct).toBeCloseTo(-0.2, 9);
    // La brute reste disponible à côté, avec ses propres valeurs.
    expect(s.serieBrute[0]?.premiumPct).toBeCloseTo(2, 9);
  });

  it("interroge Kraken USDT/USD 1h en 1 seul appel : pair=USDTUSD, interval=60 (forme de la requête verrouillée)", async () => {
    // Verrou de la REQUÊTE (paire, intervalle, un seul appel — Kraken n'a pas d'endTime), pas
    // de la forme du symbole : « USDTUSD » concaténé donnerait par coïncidence la même URL REST
    // (découpé en USD + TUSD puis reconcaténé) ; la barre oblique du store est une question
    // d'honnêteté du découpage (cf. docblock SYMBOLE_USDT_USD), invérifiable par l'URL.
    const fetchMock = stubFetch(binanceRows(), coinbaseRows(), krakenRows(0.998));
    await cbpremStore.getState().run();

    const urlsKraken = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("api.kraken.com"));
    expect(urlsKraken).toHaveLength(1);
    expect(urlsKraken[0]).toContain("pair=USDTUSD");
    expect(urlsKraken[0]).toContain("interval=60");
  });

  it("setMode('brute') puis setMode('ajuste') basculent `serie`/`stats` SANS nouvel appel fetch", async () => {
    const fetchMock = stubFetch(binanceRows(), coinbaseRows(), krakenRows(0.998));
    await cbpremStore.getState().run();
    const appels = fetchMock.mock.calls.length;
    const { serieBrute, serieAjustee } = cbpremStore.getState();

    cbpremStore.getState().setMode("brute");
    let s = cbpremStore.getState();
    expect(s.mode).toBe("brute");
    expect(s.serie).toBe(serieBrute);
    expect(s.stats?.courant).toBeCloseTo(1.9801980198019802, 9);
    expect(fetchMock.mock.calls.length).toBe(appels);

    cbpremStore.getState().setMode("ajuste");
    s = cbpremStore.getState();
    expect(s.mode).toBe("ajuste");
    expect(s.serie).toBe(serieAjustee);
    expect(s.stats?.courant).toBeCloseTo(2.1845671541101988, 9);
    expect(fetchMock.mock.calls.length).toBe(appels);
  });

  it("setMode('ajuste') est ignoré quand la série ajustée est indisponible (reste en brute)", async () => {
    stubFetch(binanceRows(), coinbaseRows(), "echec");
    await cbpremStore.getState().run();
    const { serieBrute } = cbpremStore.getState();

    cbpremStore.getState().setMode("ajuste");
    const s = cbpremStore.getState();
    expect(s.mode).toBe("brute");
    expect(s.serie).toBe(serieBrute);
  });

  it("le choix 'brute' de l'utilisateur survit à un run suivant où l'ajustée est disponible", async () => {
    stubFetch(binanceRows(), coinbaseRows(), krakenRows(0.998));
    await cbpremStore.getState().run();
    cbpremStore.getState().setMode("brute");
    const avant = cbpremStore.getState();

    // Nouveau stub : la page Coinbase n'est servie qu'une fois par stub (fin de pagination).
    stubFetch(binanceRows(), coinbaseRows(), krakenRows(0.998));
    await cbpremStore.getState().run();
    const s = cbpremStore.getState();
    // Un VRAI second succès (pas la garde 200-vide qui préserverait l'état) : pas d'erreur
    // et séries recalculées (nouvelles références).
    expect(s.erreur).toBeNull();
    expect(s.serieAjustee).not.toBe(avant.serieAjustee);
    expect(s.serieAjustee.length).toBe(2);
    expect(s.mode).toBe("brute");
    expect(s.serie).toBe(s.serieBrute);
    expect(s.noteAjustement).toBeNull(); // brute CHOISIE, pas forcée : pas de note
  });

  it("un 'brute' FORCÉ (Kraken en échec) revient à 'ajuste' dès que Kraken répond au run suivant", async () => {
    stubFetch(binanceRows(), coinbaseRows(), "echec");
    await cbpremStore.getState().run();
    expect(cbpremStore.getState().mode).toBe("brute");
    expect(cbpremStore.getState().noteAjustement).toBe(NOTE_KRAKEN);

    stubFetch(binanceRows(), coinbaseRows(), krakenRows(0.998));
    await cbpremStore.getState().run();
    const s = cbpremStore.getState();
    expect(s.mode).toBe("ajuste");
    expect(s.serie).toBe(s.serieAjustee);
    expect(s.noteAjustement).toBeNull();
  });

  it.each([
    ["Kraken OK", krakenRows(0.998)],
    ["Kraken en échec", "echec"],
  ] as const)(
    "régression : PREMIER run 200-vide (%s) puis run OK ⇒ mode 'ajuste' (un brute sans ajustée n'est jamais un choix)",
    async (_, kraken) => {
      // Run 1 : venues vides (200 vide, aucune série préalable → la garde 200-vide ne joue pas).
      stubFetch([], { candles: [] }, kraken);
      await cbpremStore.getState().run();
      const apres1 = cbpremStore.getState();
      // Précondition (chemin reproduit) : brute FORCÉE mais SANS note (rien n'est affiché).
      expect(apres1.erreur).toBeNull();
      expect(apres1.serie).toEqual([]);
      expect(apres1.serieAjustee).toEqual([]);
      expect(apres1.mode).toBe("brute");
      expect(apres1.noteAjustement).toBeNull();

      // Run 2 : tout est disponible → le défaut « ajuste » doit s'appliquer.
      stubFetch(binanceRows(), coinbaseRows(), krakenRows(0.998));
      await cbpremStore.getState().run();
      const s = cbpremStore.getState();
      expect(s.erreur).toBeNull();
      expect(s.serieAjustee.length).toBe(2);
      expect(s.mode).toBe("ajuste");
      expect(s.serie).toBe(s.serieAjustee);
      expect(s.noteAjustement).toBeNull();
    },
  );

  it("garde 200-vide : un run à venues vides mais Kraken OK conserve la série précédente (sans réhorodater)", async () => {
    stubFetch(binanceRows(), coinbaseRows(), krakenRows(0.998));
    await cbpremStore.getState().run();
    const avant = cbpremStore.getState();
    expect(avant.serieAjustee.length).toBe(2); // précondition : une ajustée VALIDE est affichée

    stubFetch([], { candles: [] }, krakenRows(0.998));
    await cbpremStore.getState().run();
    const apres = cbpremStore.getState();
    expect(apres.serie).toBe(avant.serie);
    expect(apres.serieAjustee).toBe(avant.serieAjustee);
    expect(apres.serieBrute).toBe(avant.serieBrute);
    expect(apres.majTs).toBe(avant.majTs);
    expect(apres.erreur).toBe("Réponse vide des venues — courbe précédente conservée.");
  });
});
