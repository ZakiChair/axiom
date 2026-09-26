import { describe, expect, it } from "vitest";
import type { Candle, IExchangeAdapter } from "@axiom/types";
import {
  parseSyntheticSymbol,
  encodeSyntheticSymbol,
  formatSyntheticLabel,
  combineKlines,
  createSyntheticAdapter,
} from "./synthetic";

/** Bougie compacte pour les tests. */
function c(time: number, o: number, h: number, l: number, cl: number): Candle {
  return { time, open: o, high: h, low: l, close: cl, volume: 100 };
}

describe("parseSyntheticSymbol", () => {
  it("parse un ratio same-source", () => {
    expect(parseSyntheticSymbol("binance:ETHUSDT|/|binance:BTCUSDT")).toEqual({
      exA: "binance", legA: "ETHUSDT", exB: "binance", legB: "BTCUSDT", op: "/",
    });
  });

  it("parse un spread cross-source avec ticker à slash (EUR/USD)", () => {
    expect(parseSyntheticSymbol("binance:BTCUSDT|-|twelvedata:EUR/USD")).toEqual({
      exA: "binance", legA: "BTCUSDT", exB: "twelvedata", legB: "EUR/USD", op: "-",
    });
  });

  it("parse une capitalisation comme jambe virtuelle bornée", () => {
    expect(parseSyntheticSymbol("mcap:TOTAL3|/|binance:SOLUSDT")).toEqual({
      exA: "mcap", legA: "TOTAL3", exB: "binance", legB: "SOLUSDT", op: "/",
    });
    expect(parseSyntheticSymbol("mcap:INCONNU|/|binance:BTCUSDT")).toBeNull();
  });

  it("rejette : op inconnu, segments manquants, jambe synthetic, jambe vide", () => {
    expect(parseSyntheticSymbol("binance:A|*|binance:B")).toBeNull();
    expect(parseSyntheticSymbol("binance:A|/|")).toBeNull();
    expect(parseSyntheticSymbol("BTCUSDT")).toBeNull();
    expect(parseSyntheticSymbol("synthetic:X|/|binance:B")).toBeNull();
    expect(parseSyntheticSymbol("binance:|/|binance:B")).toBeNull();
  });

  it("encode/parse aller-retour", () => {
    const spec = { exA: "binance", legA: "ETHUSDT", exB: "twelvedata", legB: "GLD", op: "/" } as const;
    expect(parseSyntheticSymbol(encodeSyntheticSymbol(spec))).toEqual(spec);
  });

  it("formatSyntheticLabel produit le libellé court", () => {
    expect(
      formatSyntheticLabel({ exA: "binance", legA: "ETHUSDT", exB: "binance", legB: "BTCUSDT", op: "/" })
    ).toBe("ETHUSDT / BTCUSDT");
  });
});

describe("combineKlines", () => {
  it("ratio aligné bucket par bucket (golden main-calc)", () => {
    // a: O=30 H=40 L=20 C=36 ; b: O=10 H=10 L=10 C=12
    // ratio: O=3 H=4 L=2 C=3 -> H re-clamp max(3,4,2,3)=4, L=min(...)=2
    const out = combineKlines([c(1000, 30, 40, 20, 36)], [c(1000, 10, 10, 10, 12)], "/");
    expect(out).toEqual([
      { time: 1000, open: 3, high: 4, low: 2, close: 3, volume: 0 },
    ]);
  });

  it("re-clampe H/L quand la division inverse l'ordre", () => {
    // a: O=9 H=10 L=9 C=10 ; b: O=2 H=5 L=2 C=5
    // brut: O=4.5 H=2 L=4.5 C=2 -> H=max=4.5, L=min=2
    const out = combineKlines([c(1000, 9, 10, 9, 10)], [c(1000, 2, 5, 2, 5)], "/");
    expect(out[0]).toEqual({ time: 1000, open: 4.5, high: 4.5, low: 2, close: 2, volume: 0 });
  });

  it("spread A-B", () => {
    // O=30-10=20 H=40-10=30 L=20-10=10 C=36-12=24
    const out = combineKlines([c(1000, 30, 40, 20, 36)], [c(1000, 10, 10, 10, 12)], "-");
    expect(out[0]).toEqual({ time: 1000, open: 20, high: 30, low: 10, close: 24, volume: 0 });
  });

  it("forward-fill du close de B quand B n'a pas de bougie dans le bucket (marché fermé)", () => {
    // B n'existe qu'à t=1000 (close 10) ; à t=2000 et t=3000, B plat à 10.
    // a(t=2000): O=20 H=30 L=20 C=30 -> /10 = O=2 H=3 L=2 C=3
    const a = [c(1000, 10, 10, 10, 10), c(2000, 20, 30, 20, 30), c(3000, 40, 40, 40, 40)];
    const b = [c(1000, 5, 5, 5, 10)];
    const out = combineKlines(a, b, "/");
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({ time: 2000, open: 2, high: 3, low: 2, close: 3, volume: 0 });
    expect(out[2]).toEqual({ time: 3000, open: 4, high: 4, low: 4, close: 4, volume: 0 });
  });

  it("saute les bougies de A antérieures à la première bougie de B (pas de ffill possible)", () => {
    const a = [c(1000, 1, 1, 1, 1), c(2000, 2, 2, 2, 2)];
    const b = [c(2000, 4, 4, 4, 4)];
    const out = combineKlines(a, b, "/");
    expect(out).toEqual([{ time: 2000, open: 0.5, high: 0.5, low: 0.5, close: 0.5, volume: 0 }]);
  });

  it("ignore le bucket si un composant du diviseur est 0 (ratio uniquement)", () => {
    const out = combineKlines([c(1000, 1, 1, 1, 1)], [c(1000, 0, 1, 1, 1)], "/");
    expect(out).toEqual([]);
    // le spread, lui, accepte le 0
    const spread = combineKlines([c(1000, 1, 1, 1, 1)], [c(1000, 0, 1, 0, 1)], "-");
    expect(spread).toHaveLength(1);
  });

  it("propage la clôture de la jambe A et écarte les résultats non finis", () => {
    const fermee = { ...c(1000, 10, 12, 8, 11), closed: true };
    expect(combineKlines([fermee], [c(1000, 2, 2, 2, 2)], "/")[0]?.closed).toBe(true);
    expect(combineKlines([c(1000, Number.NaN, 12, 8, 11)], [c(1000, 2, 2, 2, 2)], "/")).toEqual([]);
  });
});

function fakeAdapter(id: string, candles: Candle[]): IExchangeAdapter & { unsubs: number } {
  const fake = {
    id: id as IExchangeAdapter["id"],
    unsubs: 0,
    async fetchKlines() { return candles; },
    subscribeKline(_symbol: string, _tf: string, cb: (candle: Candle) => void) {
      const last = candles[candles.length - 1];
      if (last !== undefined) cb(last);
      return () => { fake.unsubs += 1; };
    },
    subscribeTrades() { return () => {}; },
  };
  return fake as IExchangeAdapter & { unsubs: number };
}

describe("createSyntheticAdapter", () => {
  const legA = fakeAdapter("binance", [c(1000, 30, 40, 20, 36)]);
  const legB = fakeAdapter("kraken", [c(1000, 10, 10, 10, 12)]);
  const resolve = (ex: string) => (ex === "binance" ? legA : legB);
  const syn = createSyntheticAdapter(resolve as never);

  it("fetchKlines compose les deux jambes", async () => {
    const out = await syn.fetchKlines("binance:ETHUSDT|/|kraken:XBTUSD", "1h", {});
    expect(out).toEqual([{ time: 1000, open: 3, high: 4, low: 2, close: 3, volume: 0 }]);
  });

  it("fetchKlines rejette un symbole invalide", async () => {
    await expect(syn.fetchKlines("nimporte", "1h", {})).rejects.toThrow(/invalide/);
  });

  it("délègue TOTAL autonome et compose une jambe mcap", async () => {
    const mcap = fakeAdapter("synthetic", [c(1000, 300, 400, 200, 360)]);
    const btc = fakeAdapter("binance", [c(1000, 10, 10, 10, 12)]);
    const avecMcap = createSyntheticAdapter(
      ((ex: string) => (ex === "mcap" ? mcap : btc)) as never,
      mcap,
    );

    await expect(avecMcap.fetchKlines("TOTAL", "1d", {})).resolves.toEqual([
      c(1000, 300, 400, 200, 360),
    ]);
    await expect(
      avecMcap.fetchKlines("mcap:TOTAL|/|binance:BTCUSDT", "1d", {}),
    ).resolves.toEqual([
      { time: 1000, open: 30, high: 40, low: 20, close: 30, volume: 0 },
    ]);
  });

  it("subscribeKline émet dès que les 2 jambes ont un état, et l'unsubscribe ferme les 2", () => {
    const got: Candle[] = [];
    const off = syn.subscribeKline("binance:ETHUSDT|/|kraken:XBTUSD", "1h", (candle: Candle) => got.push(candle));
    expect(got.length).toBeGreaterThanOrEqual(1);
    expect(got[got.length - 1]?.close).toBe(3);
    off();
    expect(legA.unsubs).toBe(1);
    expect(legB.unsubs).toBe(1);
  });

  it("subscribeTrades est un no-op", () => {
    const off = syn.subscribeTrades("x", () => { throw new Error("ne doit jamais émettre"); });
    expect(typeof off).toBe("function");
    off();
  });
});

/** Adaptateur pilotable : chaque abonnement expose son rappel pour simuler un flux. */
function adaptateurPilote(): IExchangeAdapter & { pousser: (candle: Candle) => void } {
  let rappel: ((candle: Candle) => void) | undefined;
  return {
    id: "binance",
    async fetchKlines() { return []; },
    subscribeKline(_symbol: string, _tf: string, cb: (candle: Candle) => void) { rappel = cb; return () => {}; },
    subscribeTrades() { return () => {}; },
    pousser: (candle: Candle) => rappel?.(candle),
  } as IExchangeAdapter & { pousser: (candle: Candle) => void };
}

describe("subscribeKline — jambe B Twelve Data plus récente que la bougie A (revue du 26/09)", () => {
  const J = Date.UTC(2026, 8, 25);
  const J1 = J + 86_400_000;
  // BTCUSDT 1d réel et CHF/USD 1day réel (daily forex daté J, couvrant J-1 21:00Z → J 21:00Z).
  const btc = (closed: boolean): Candle => ({ time: J, open: 84410.24, high: 85255, low: 83183, close: 84099.99, volume: 1, closed });
  const chf: Candle = { time: J, open: 1.20795, high: 1.20881, low: 1.20507, close: 1.20696, volume: 0, closed: true };
  const chfJ1: Candle = { time: J1, open: 1.20696, high: 1.2071, low: 1.2065, close: 1.207, volume: 0, closed: false };

  function monter() {
    const a = adaptateurPilote();
    const b = adaptateurPilote();
    const recu: Candle[] = [];
    const syn = createSyntheticAdapter(((ex: string) => (ex === "binance" ? a : b)) as never);
    syn.subscribeKline("binance:BTCUSDT|/|twelvedata:CHF/USD", "1d", (candle: Candle) => recu.push(candle));
    return { a, b, recu };
  }

  it("dès 21:00Z (barre B J+1 ouverte), la bougie A J reste émise et sa clôture passe, avec la barre B J", () => {
    const { a, b, recu } = monter();
    a.pousser(btc(false));
    b.pousser(chf);
    b.pousser(chfJ1); // sondage de 21:01Z : [J clôturée, J+1 en cours]
    recu.length = 0;
    a.pousser(btc(false));
    a.pousser(btc(true));
    expect(recu).toHaveLength(2);
    const derniere = recu.at(-1)!;
    expect(derniere.closed).toBe(true);
    expect(derniere.time).toBe(J);
    expect(derniere.close).toBeCloseTo(69679.19, 2);
    expect(derniere.open).toBeCloseTo(69878.92, 2);
  });

  it("sans barre B couvrant A, la dernière clôture B connue sert : jamais d'émission perdue", () => {
    const { a, b, recu } = monter();
    b.pousser(chfJ1);
    a.pousser(btc(true));
    expect(recu).toHaveLength(1);
    expect(recu[0]!.closed).toBe(true);
    expect(recu[0]!.close).toBeCloseTo(84099.99 / 1.207, 6);
  });

  it("une barre B ancienne réémise après la suivante ne remplace pas la plus récente", () => {
    const { a, b, recu } = monter();
    b.pousser(chfJ1);
    b.pousser(chf);
    a.pousser({ ...btc(false), time: J1, close: 84000 });
    expect(recu.at(-1)!.close).toBeCloseTo(84000 / 1.207, 6);
  });
});

describe("subscribeKline — Twelve Data au numérateur après la clôture (contre-revue du 26/09)", () => {
  const M5 = 300_000;
  const t0 = Date.UTC(2026, 8, 24, 19, 55);
  const gld: Candle = { time: t0, open: 395, high: 395.6, low: 394.9, close: 395.4, volume: 1, closed: true };
  const btc = (time: number, close: number): Candle => ({ time, open: close, high: close, low: close, close, volume: 1 });

  it("la dernière bougie tradfi n'est pas repeinte avec le cours crypto au-delà d'une barre", () => {
    const a = adaptateurPilote();
    const b = adaptateurPilote();
    const recu: Candle[] = [];
    const syn = createSyntheticAdapter(((ex: string) => (ex === "twelvedata" ? a : b)) as never);
    syn.subscribeKline("twelvedata:GLD|/|binance:BTCUSDT", "5m", (candle: Candle) => recu.push(candle));
    a.pousser(gld);
    b.pousser(btc(t0, 84000));
    expect(recu.at(-1)!.close).toBeCloseTo(395.4 / 84000, 9);
    b.pousser(btc(t0 + M5, 84100)); // une barre d'avance : repli admis
    const avant = recu.length;
    b.pousser(btc(t0 + 2 * M5, 85000));
    b.pousser(btc(t0 + 43 * M5, 86000)); // 23:30Z : GLD fermé depuis longtemps
    expect(recu).toHaveLength(avant);
  });
});
