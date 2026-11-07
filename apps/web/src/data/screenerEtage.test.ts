/**
 * Tests de data/screenerEtage.ts (boucle du worker EQS) : parsing des klines avec volume
 * taker (k[9]) et drapeau de clôture, exclusion de la bougie en formation, amorce par
 * unité, deux unités par symbole, référence chargée une fois par run, notes de
 * couverture. Le réseau est bouchonné (`lireJson`), jamais appelé.
 */
import { describe, expect, it, vi } from "vitest";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import type { Operande } from "@axiom/backtest";
import type { ConditionChamp, ConditionRegle, ScreenerRow } from "./screener";
import {
  bougiesCloturees,
  executerEtage,
  KLINES_URL,
  limitesParUnite,
  parserKlines,
  REQ_INTERVAL_MS,
  type IoEtage,
} from "./screenerEtage";

const H4 = 14_400_000;
const J1 = 86_400_000;
const MAINTENANT = 1_800_000_000_000;

/** Kline Binance brute : [open, o, h, l, c, v, closeTime, qv, trades, takerBuy, …]. */
function kline(time: number, pas: number, close: number, volume = 100, achat: number | null = 60): unknown[] {
  return [time, String(close), String(close * 1.01), String(close * 0.99), String(close), String(volume), time + pas - 1, "0", 10, achat === null ? undefined : String(achat), "0", "0"];
}

/** Série de klines dont la DERNIÈRE est en formation à MAINTENANT. */
function serie(n: number, pas: number, prix: (i: number) => number): unknown[][] {
  const debutDerniere = Math.floor(MAINTENANT / pas) * pas;
  return Array.from({ length: n }, (_, i) => kline(debutDerniere - (n - 1 - i) * pas, pas, prix(i)));
}

const ligne = (symbol: string): ScreenerRow => ({
  symbol,
  quote: "USDT",
  lastPrice: 1,
  priceChangePct24h: 0,
  volumeUsd24h: 1e9,
});

/** Entrées-sorties bouchonnées : horloge figée, réponses par (symbole, unité). */
function io(reponses: (symbol: string, interval: string, limit: number) => unknown): IoEtage & { urls: string[]; attentes: number[] } {
  const urls: string[] = [];
  const attentes: number[] = [];
  return {
    urls,
    attentes,
    lireJson: vi.fn(async (url: string) => {
      urls.push(url);
      const u = new URL(url);
      return reponses(u.searchParams.get("symbol")!, u.searchParams.get("interval")!, Number(u.searchParams.get("limit")));
    }),
    maintenant: () => MAINTENANT,
    attendre: async (ms: number) => {
      attentes.push(ms);
    },
    progression: vi.fn(),
  };
}

const close: Operande = { type: "prix", champ: "close" };
const cst = (valeur: number): Operande => ({ type: "constante", valeur });

/** Opérande du catalogue « RVOL saisonnier H1 » (paramètres fixes : 84 jours). */
const rvolSaisonnier: ConditionRegle = {
  kind: "regle",
  condition: {
    type: "comparaison",
    gauche: { type: "indicateur", indicateurId: "rvolSeasonal", params: {}, output: "rvol" },
    comparateur: ">",
    droite: cst(0),
  },
};

describe("parserKlines / bougiesCloturees", () => {
  it("garde le volume acheteur taker (k[9]) et date la clôture par k[6]", () => {
    const raw = [kline(0, H4, 10, 100, 70), kline(H4, H4, 11, 100, 30)];
    const c = parserKlines(raw, H4 + 10);
    expect(c[0]).toMatchObject({ close: 10, volume: 100, buyVolume: 70, sellVolume: 30, closed: true });
    expect(c[1]).toMatchObject({ close: 11, buyVolume: 30, sellVolume: 70, closed: false });
    expect(bougiesCloturees(c)).toHaveLength(1);
  });

  it("k[9] absent ou incohérent : volume taker absent (jamais 0) ; lignes corrompues écartées", () => {
    const c = parserKlines([kline(0, H4, 10, 100, null), kline(H4, H4, 10, 100, 150), ["x", "y"], "pas une ligne"], MAINTENANT);
    expect(c).toHaveLength(2);
    expect(c[0]!.buyVolume).toBeUndefined();
    expect(c[0]!.sellVolume).toBeUndefined();
    expect(c[1]!.buyVolume).toBeUndefined();
    expect(parserKlines({ code: -1121 }, MAINTENANT)).toEqual([]);
  });
});

describe("limitesParUnite", () => {
  it("élève le plancher à l'amorce la plus exigeante de chaque unité, plafonne à 999", () => {
    const ema200: ConditionRegle = {
      kind: "regle",
      condition: { type: "comparaison", gauche: close, comparateur: ">", droite: { type: "indicateur", indicateurId: "ema", params: { length: 200 }, output: "ema" } },
    };
    const ema300 = structuredClone(ema200);
    if (ema300.condition.type === "comparaison" && ema300.condition.droite.type === "indicateur") ema300.condition.droite.params = { length: 300 };
    const rsi1d: ConditionChamp = { kind: "indicator", fieldId: "rsi", param: 14, op: "<", value: 30, tf: "1d" };
    const l = limitesParUnite([ema200, rsi1d], "4h", 200);
    expect(l.get("4h")).toEqual({ limite: 802, voulue: 802, plafonnee: false });
    expect(l.get("1d")).toEqual({ limite: 200, voulue: 200, plafonnee: false });
    expect(limitesParUnite([ema300], "4h", 200).get("4h")).toEqual({ limite: 999, voulue: 1202, plafonnee: true });
  });

  it("RVOL saisonnier 1h : 84 jours = 2016 bougies, amorce plafonnée (et non 338 bougies)", () => {
    expect(limitesParUnite([rvolSaisonnier], "1h", 200).get("1h")).toEqual({ limite: 999, voulue: 84 * 24 + 2, plafonnee: true });
  });
});

describe("executerEtage", () => {
  it("écarte la bougie en formation : une condition vraie seulement sur elle ne passe pas", async () => {
    // 200 bougies closes à 100 ; la 201e (en formation) bondit à 200.
    const e = io((_s, interval) => serie(201, interval === "4h" ? H4 : J1, (i) => (i === 200 ? 200 : 100)));
    const cond: ConditionRegle = { kind: "regle", condition: { type: "comparaison", gauche: close, comparateur: ">", droite: cst(150) } };
    const res = await executerEtage({ candidates: [ligne("AAAUSDT")], tf: "4h", conditions: [cond], refSymbol: "BTCUSDT" }, e);
    expect(res.rows).toEqual([]);
    expect(e.urls[0]).toBe(`${KLINES_URL}?symbol=AAAUSDT&interval=4h&limit=201`);
  });

  it("deux unités par symbole, chargées paresseusement ; valeurs et ancienneté renvoyées", async () => {
    const e = io((s, interval) =>
      interval === "4h"
        ? serie(201, H4, (i) => (s === "OKUSDT" && i >= 198 ? 120 : 100))
        : serie(201, J1, () => 100),
    );
    const croise: ConditionRegle = {
      kind: "regle",
      fenetre: 3,
      condition: { type: "croisement", a: close, b: cst(110), sens: "hausse" },
    };
    const journalier: ConditionChamp = { kind: "indicator", fieldId: "rsi", param: 14, op: ">=", value: 0, tf: "1d" };
    const res = await executerEtage(
      { candidates: [ligne("OKUSDT"), ligne("KOUSDT")], tf: "4h", conditions: [croise, journalier], refSymbol: "BTCUSDT" },
      e,
    );
    expect(res.rows.map((r) => r.symbol)).toEqual(["OKUSDT"]);
    // Bougies closes 0..199 : croisement à 198, lu à 199 → il y a 1 bougie.
    expect(res.rows[0]!.indicatorValues![0]).toEqual({ label: "close croise ↑ 110 · 3 b.", value: 120, barresDepuis: 1 });
    // KOUSDT échoue à la 1re condition : son unité 1d n'est jamais demandée.
    expect(e.urls.filter((u) => u.includes("KOUSDT"))).toHaveLength(1);
    expect(e.urls.filter((u) => u.includes("OKUSDT"))).toHaveLength(2);
    expect(e.progression).toHaveBeenCalledTimes(2);
    expect(e.progression).toHaveBeenLastCalledWith(2, 2);
    // Horloge figée : chaque requête après la première attend l'intervalle complet.
    expect(e.attentes.every((ms) => ms === REQ_INTERVAL_MS)).toBe(true);
    expect(e.attentes).toHaveLength(e.urls.length - 1);
  });

  it("charge la référence UNE fois par run et par unité, puis l'aligne sur chaque symbole", async () => {
    const e = io((s) => serie(400, J1, (i) => (s === "BTCUSDT" ? 100 : 1 + i * 0.01)));
    const rs: ConditionChamp = { kind: "indicator", fieldId: "rsMansfield", op: ">", value: 0 };
    const res = await executerEtage(
      { candidates: [ligne("AAAUSDT"), ligne("BBBUSDT"), ligne("CCCUSDT")], tf: "4h", conditions: [rs], refSymbol: "BTCUSDT" },
      e,
    );
    expect(e.urls.filter((u) => u.includes("symbol=BTCUSDT"))).toHaveLength(1);
    expect(e.urls.every((u) => u.includes("interval=1d"))).toBe(true);
    // Actif en hausse régulière contre une référence plate : Mansfield > 0 partout.
    expect(res.rows).toHaveLength(3);
    expect(res.rows[0]!.indicatorValues![0]!.label).toBe("RS Mansfield(364) [1d]");
    expect(res.notes).toEqual([]);
  });

  it("référence indisponible : note honnête, force relative non évaluée", async () => {
    const e = io((s) => {
      if (s === "BTCUSDT") throw new Error("klines 400");
      return serie(400, J1, () => 1);
    });
    const rs: ConditionChamp = { kind: "indicator", fieldId: "rsZ", op: ">", value: -100, tf: "1d" };
    const res = await executerEtage({ candidates: [ligne("AAAUSDT")], tf: "1d", conditions: [rs], refSymbol: "BTCUSDT" }, e);
    expect(res.rows).toEqual([]);
    expect(res.notes).toContain("référence BTCUSDT 1d indisponible : force relative non évaluée");
  });

  it("amorce plafonnée : note avec la profondeur lue et l'amorce voulue", async () => {
    const H1 = 3_600_000;
    const e = io(() => serie(1000, H1, () => 100));
    const res = await executerEtage(
      { candidates: [ligne("AAAUSDT")], tf: "1h", conditions: [rvolSaisonnier], refSymbol: "BTCUSDT" },
      e,
    );
    expect(e.urls[0]).toContain("interval=1h&limit=1000");
    expect(res.notes).toContain("amorce plafonnée à 999 bougies closes en 1h (≈ 41 j ; 2018 voulues) : valeurs ≈");
  });

  it("référence en retard d'une bougie : symbole lu à la dernière bougie commune, note à l'appui", async () => {
    // Référence chargée AVANT la clôture de la dernière bougie des symboles : sa dernière
    // bougie close est leur avant-dernière. À cette bougie manquante, la référence double ;
    // les symboles valent 3 × référence (± une ondulation) partout.
    const n = 201;
    const refVraie = (i: number): number => (i === n - 2 ? 200 : 100 + i * 0.1);
    const ratio = (i: number): number => 3 + 0.05 * Math.sin(i / 3);
    const e = io((s) => {
      const complete = serie(n, H4, (i) => (s === "BTCUSDT" ? refVraie(i) : ratio(i) * refVraie(i)));
      // Réponse de la référence au début du run : la bougie n − 2 n'y figure pas encore.
      return s === "BTCUSDT" ? complete.slice(0, n - 2) : complete;
    });
    const rsZ: ConditionChamp = { kind: "indicator", fieldId: "rsZ", param: 50, op: ">", value: -100 };
    const res = await executerEtage(
      { candidates: [ligne("AAAUSDT"), ligne("BBBUSDT")], tf: "4h", conditions: [rsZ], refSymbol: "BTCUSDT" },
      e,
    );
    expect(res.rows).toHaveLength(2);
    // Attendu : z de spreadZScore sur les bougies 0..n−3 des deux séries, appariées exactement.
    const actif = Array.from({ length: n - 2 }, (_, i) => {
      const c = Number(String(ratio(i) * refVraie(i)));
      return { time: i, open: c, high: c, low: c, close: c, volume: 1 };
    });
    const refCloses = Array.from({ length: n - 2 }, (_, i) => Number(String(refVraie(i))));
    const z = computeIndicator(getIndicator("spreadZScore")!, actif, { length: 50 }, { refClose: refCloses }).series.z!;
    const lu = res.rows[0]!.indicatorValues![0]!.value;
    expect(lu).toBeCloseTo(z[n - 3]!, 9);
    // Sans calage, la bougie n − 2 aurait été appariée à la référence précédente (ratio ≈ 6).
    expect(Math.abs(lu)).toBeLessThan(3);
    expect(res.notes).toContain(
      "2 symboles lus à la dernière bougie commune avec BTCUSDT (bougie close après le chargement de la référence)",
    );
    expect(e.urls.filter((u) => u.includes("symbol=BTCUSDT"))).toHaveLength(1);
  });

  it("référence à jour : aucune bougie retirée, aucune note de calage", async () => {
    const e = io((s) => serie(201, H4, (i) => (s === "BTCUSDT" ? 100 + i : (100 + i) * (3 + 0.05 * Math.sin(i)))));
    const rsZ: ConditionChamp = { kind: "indicator", fieldId: "rsZ", param: 50, op: ">", value: -100 };
    const res = await executerEtage({ candidates: [ligne("AAAUSDT")], tf: "4h", conditions: [rsZ], refSymbol: "BTCUSDT" }, e);
    expect(res.rows).toHaveLength(1);
    expect(res.notes).toEqual([]);
  });

  it("symbole sans klines : écarté et compté ; conditions refusées : rejet explicite", async () => {
    const e = io((s) => {
      if (s === "MORTUSDT") throw new Error("klines 400");
      return serie(201, H4, () => 100);
    });
    const ok: ConditionChamp = { kind: "indicator", fieldId: "rsi", op: ">=", value: 0 };
    const res = await executerEtage({ candidates: [ligne("MORTUSDT"), ligne("VIFUSDT")], tf: "4h", conditions: [ok], refSymbol: "BTCUSDT" }, e);
    expect(res.rows.map((r) => r.symbol)).toEqual(["VIFUSDT"]);
    expect(res.notes).toContain("1 symbole sans klines");

    const troisUnites: ConditionChamp[] = [
      { ...ok, tf: "1h" },
      { ...ok, tf: "1d" },
    ];
    await expect(
      executerEtage({ candidates: [ligne("VIFUSDT")], tf: "4h", conditions: troisUnites, refSymbol: "BTCUSDT" }, e),
    ).rejects.toThrow(/Au plus une unité/);
  });
});
