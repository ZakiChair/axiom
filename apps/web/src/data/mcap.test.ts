import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alignerSurGrille,
  attenteApres429,
  dominance,
  dominanceAlts,
  ErreurCoinGecko,
  fetchHistoriquePiece,
  grilleJournaliere,
  JOUR_MS,
  minuitUtc,
  reconstruireTotal,
  serieDifference,
} from "./mcap";

/** Minuit UTC du jour donné, en ms — raccourci de fixture. */
function j(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

describe("minuitUtc / grilleJournaliere — normalisation de la grille CoinGecko", () => {
  it("ramène un instant quelconque au minuit UTC de son jour", () => {
    expect(minuitUtc(Date.parse("2026-07-29T08:47:11Z"))).toBe(j("2026-07-29"));
    expect(minuitUtc(j("2026-07-29"))).toBe(j("2026-07-29"));
  });

  it("dédoublonne le point « maintenant » que CoinGecko ajoute après le dernier minuit", () => {
    // Forme réelle vérifiée le 2026-07-29 : days=365&interval=daily renvoie 366 points
    // = 365 minuits UTC + UN point à l'heure courante. Sans dédoublonnage, le jour
    // courant compterait deux fois et les pièces ne s'aligneraient pas entre elles.
    const brut: [number, number][] = [
      [j("2026-07-27"), 100],
      [j("2026-07-28"), 200],
      [j("2026-07-29"), 300],
      [Date.parse("2026-07-29T08:47:11Z"), 305], // point « maintenant »
    ];
    expect(grilleJournaliere(brut)).toEqual([
      { t: j("2026-07-27"), v: 100 },
      { t: j("2026-07-28"), v: 200 },
      { t: j("2026-07-29"), v: 305 }, // le DERNIER point du jour gagne
    ]);
  });

  it("trie par ordre croissant et écarte les points non finis", () => {
    const brut: [number, number][] = [
      [j("2026-07-28"), 200],
      [j("2026-07-27"), 100],
      [j("2026-07-26"), Number.NaN],
    ];
    expect(grilleJournaliere(brut)).toEqual([
      { t: j("2026-07-27"), v: 100 },
      { t: j("2026-07-28"), v: 200 },
    ]);
  });

  it("renvoie une série vide pour une entrée vide", () => {
    expect(grilleJournaliere([])).toEqual([]);
  });
});

describe("alignerSurGrille — 0 avant cotation, forward-fill dans la plage connue", () => {
  const grille = [j("2026-07-25"), j("2026-07-26"), j("2026-07-27"), j("2026-07-28")];

  it("contribue 0 avant le premier point de la pièce (listing en cours d'année)", () => {
    // Une pièce listée le 27 n'avait AUCUNE capitalisation avant : 0 est la valeur
    // exacte pour une somme, pas un trou à combler.
    const serie = [
      { t: j("2026-07-27"), v: 50 },
      { t: j("2026-07-28"), v: 60 },
    ];
    expect(alignerSurGrille(serie, grille)).toEqual([0, 0, 50, 60]);
  });

  it("comble un trou interne par la dernière valeur connue (jamais par 0)", () => {
    const serie = [
      { t: j("2026-07-25"), v: 10 },
      // 26 manquant
      { t: j("2026-07-27"), v: 30 },
      { t: j("2026-07-28"), v: 40 },
    ];
    expect(alignerSurGrille(serie, grille)).toEqual([10, 10, 30, 40]);
  });

  it("prolonge la dernière valeur connue si la série s'arrête avant la fin de la grille", () => {
    const serie = [{ t: j("2026-07-25"), v: 10 }];
    expect(alignerSurGrille(serie, grille)).toEqual([10, 10, 10, 10]);
  });

  it("rend toujours un tableau de la longueur de la grille", () => {
    expect(alignerSurGrille([], grille)).toHaveLength(grille.length);
    expect(alignerSurGrille([], grille)).toEqual([0, 0, 0, 0]);
  });
});

describe("reconstruireTotal — somme du panier puis recalibrage sur /global", () => {
  it("somme colonne par colonne et applique k à TOUTE la série", () => {
    const btc = [50, 60];
    const eth = [30, 40];
    // somme = [80, 100] ; /global annonce 110 → k = 1,1 appliqué partout.
    const r = reconstruireTotal([btc, eth], 110);
    expect(r.k).toBeCloseTo(1.1, 12);
    expect(r.recalibre).toBe(true);
    expect(r.total[0]).toBeCloseTo(88, 12);
    expect(r.total[1]).toBeCloseTo(110, 12);
  });

  it("cale exactement le dernier point sur le total /global (invariant du recalibrage)", () => {
    const r = reconstruireTotal([[1, 2, 3]], 42);
    expect(r.total[r.total.length - 1]).toBeCloseTo(42, 9);
  });

  it("n'invente pas de facteur si la somme courante est nulle", () => {
    const r = reconstruireTotal([[0, 0]], 110);
    expect(r.k).toBe(1);
    expect(r.recalibre).toBe(false);
    expect(r.total).toEqual([0, 0]);
  });

  it("rend une série vide sans panier", () => {
    expect(reconstruireTotal([], 110)).toEqual({ total: [], k: 1, recalibre: false });
  });
});

describe("dominance — part en POURCENT du total recalibré", () => {
  it("est invariante d'échelle : multiplier numérateur ET dénominateur ne change rien", () => {
    // C'est la propriété qui protège du bug « divisé par la somme non recalibrée » :
    // seul un facteur appliqué à un SEUL des deux termes déplace le résultat.
    const piece = [50, 60];
    const total = [100, 120];
    const brut = dominance(piece, total);
    const echelle = dominance(
      piece.map((v) => v * 10),
      total.map((v) => v * 10)
    );
    expect(brut).toEqual([50, 50]);
    expect(echelle).toEqual(brut);
  });

  it("rend null quand le total est nul, négatif ou non fini", () => {
    expect(dominance([10, 10, 10], [0, -5, Number.NaN])).toEqual([null, null, null]);
  });

  it("rend null quand la pièce manque à cet index", () => {
    expect(dominance([10], [100, 100])).toEqual([10, null]);
  });
});

describe("serieDifference / dominanceAlts", () => {
  it("retranche plusieurs séries (TOTAL3 = TOTAL − BTC − ETH) et clampe à 0", () => {
    expect(serieDifference([100, 100], [50, 60], [20, 50])).toEqual([30, 0]);
  });

  it("traite une jambe plus courte comme absente (retranche 0)", () => {
    expect(serieDifference([100, 100], [50])).toEqual([50, 100]);
  });

  it("dominanceAlts = 100 − BTC.D − ETH.D et propage les trous", () => {
    expect(dominanceAlts([56.6, null], [10.1, 10])).toEqual([33.3, null]);
    expect(dominanceAlts([56.6], [null])).toEqual([null]);
  });
});

describe("attenteApres429 — cadence de repli", () => {
  it("respecte Retry-After quand l'en-tête est présent", () => {
    expect(attenteApres429(1, 30)).toBe(30_000);
    expect(attenteApres429(4, 2)).toBe(2_000);
  });

  it("replie exponentiellement sans en-tête, plafonné à 60 s", () => {
    expect(attenteApres429(1, null)).toBe(2_000);
    expect(attenteApres429(2, null)).toBe(4_000);
    expect(attenteApres429(3, null)).toBe(8_000);
    expect(attenteApres429(10, null)).toBe(60_000);
  });

  it("ignore un Retry-After absurde (négatif ou non fini)", () => {
    expect(attenteApres429(1, -5)).toBe(2_000);
    expect(attenteApres429(1, Number.NaN)).toBe(2_000);
  });
});

describe("fetchHistoriquePiece — lecture de /coins/{id}/market_chart", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("projette market_caps en série journalière normalisée", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        prices: [[j("2026-07-28"), 1]],
        market_caps: [
          [j("2026-07-28"), 1_000],
          [Date.parse("2026-07-29T08:47:11Z"), 1_100],
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const serie = await fetchHistoriquePiece("bitcoin");
    expect(serie).toEqual([
      { t: j("2026-07-28"), v: 1_000 },
      { t: j("2026-07-29"), v: 1_100 },
    ]);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/coins/bitcoin/market_chart");
    expect(url).toContain("days=365"); // au-delà, CoinGecko renvoie 401 error_code 10012
    expect(url).toContain("interval=daily");
  });

  it("remonte un 429 typé avec son Retry-After (c'est l'appelant qui cadence)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: { get: (n: string) => (n.toLowerCase() === "retry-after" ? "12" : null) },
        json: async () => ({}),
      })
    );

    await expect(fetchHistoriquePiece("bitcoin")).rejects.toBeInstanceOf(ErreurCoinGecko);
    await fetchHistoriquePiece("bitcoin").catch((e: unknown) => {
      expect(e).toBeInstanceOf(ErreurCoinGecko);
      expect((e as ErreurCoinGecko).status).toBe(429);
      expect((e as ErreurCoinGecko).retryAfter).toBe(12);
    });
  });
});

describe("JOUR_MS", () => {
  it("vaut bien 24 h en millisecondes", () => {
    expect(JOUR_MS).toBe(24 * 60 * 60 * 1000);
  });
});
