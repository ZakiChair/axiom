import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { trappedVolume } from "./trappedVolume";

const ctx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

let t = 0;
/** Bougie [low, high] clôturée à `close`, split taker optionnel (absent = pas de split). */
function b(low: number, high: number, close: number, buy?: number, sell?: number): Candle {
  return {
    time: ++t,
    open: close,
    high,
    low,
    close,
    volume: (buy ?? 0) + (sell ?? 0),
    ...(buy === undefined ? {} : { buyVolume: buy }),
    ...(sell === undefined ? {} : { sellVolume: sell }),
  };
}

function calc(candles: Array<Candle | undefined>, length: number) {
  const { series } = trappedVolume.calc(candles as Candle[], { length }, ctx);
  return { L: series.trappedLong ?? [], S: series.trappedShort ?? [] };
}

/** Série pseudo-aléatoire DÉTERMINISTE (LCG) : marche de prix ±1 %, split taker quelconque. */
function serieAleatoire(n: number, graine: number): Candle[] {
  let s = graine;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  let p = 100;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const o = p;
    p *= 1 + (rnd() - 0.5) * 0.02;
    const high = Math.max(o, p) * (1 + rnd() * 0.005);
    const low = Math.min(o, p) * (1 - rnd() * 0.005);
    const volume = 100 * rnd();
    const buy = volume * rnd();
    out.push({ time: i, open: o, high, low, close: p, volume, buyVolume: buy, sellVolume: volume - buy });
  }
  return out;
}

describe("trappedVolume — delta net sous l'eau, libéré au retour du prix", () => {
  it("T1 : undefined tant que la fenêtre n'est pas pleine", () => {
    const { L, S } = calc([b(100, 110, 108, 60, 20), b(95, 101, 96, 5, 15)], 3);
    expect(L).toEqual([undefined, undefined]);
    expect(S).toEqual([undefined, undefined]);
  });

  it("T2 : dump sans retour → le lot long net reste piégé, pondéré par son âge", () => {
    // b0 [100,110] δ = 60 − 20 = +40 → lot LONG ; b1 [95,101] δ = 5 − 15 = −10 → lot
    // SHORT ; b2 [90,97] δ = 0 → rien. Libérations du long : k=1 retire (108, 101] = ∅,
    // k=2 retire (96, 97] (hors [100,110]) → vivant [100,110], tout au-dessus de 91 :
    // f = 1, âge 2, w = 1 − 2/3 = 1/3 → L = 40/3 = 13,333.
    // Short : k=2 retire [90, 96) → vivant [96,101], rien sous 91 → S = 0.
    const { L, S } = calc([b(100, 110, 108, 60, 20), b(95, 101, 96, 5, 15), b(90, 97, 91, 10, 10)], 3);
    expect(L[2]).toBeCloseTo(40 / 3, 10);
    expect(S[2]).toBe(0);
    expect(Object.is(S[2], -0)).toBe(false); // jamais « -0 »
  });

  it("T3 : retour complet au niveau → lot libéré", () => {
    // T2 + b3 [90,111] clôture 92 (10/10) : k=3 retire (91, 111] ⊇ [100,110] → L = 0.
    // Short [96,101] : k=3 retire [90, 91) → inchangé, rien sous 92 → S = 0.
    const { L, S } = calc(
      [b(100, 110, 108, 60, 20), b(95, 101, 96, 5, 15), b(90, 97, 91, 10, 10), b(90, 111, 92, 10, 10)],
      4,
    );
    expect(L[3]).toBe(0);
    expect(S[3]).toBe(0);
  });

  it("T4 : retour partiel → seule la tranche non retouchée reste piégée", () => {
    // b3 high 105 : k=3 retire (91, 105] → vivant [105,110], 5 sur 10 au-dessus de 92 :
    // f = 0,5 ; âge 3, w = 1 − 3/4 = 1/4 → L = 40 × 1/4 × 0,5 = 5.
    const { L } = calc(
      [b(100, 110, 108, 60, 20), b(95, 101, 96, 5, 15), b(90, 97, 91, 10, 10), b(90, 105, 92, 10, 10)],
      4,
    );
    expect(L[3]).toBeCloseTo(5, 10);
  });

  it("T5 : un long en profit qui repasse sous son entrée DEVIENT piégé", () => {
    // b0 [100,102] δ = +20 ; b1 [102,110] clôture 110 : k=1 retire (102, 110] — le lot
    // est en profit, rien n'est libéré ; b2 [95,110] (sans split) : k=2 retire (110, 110]
    // = ∅. Vivant [100,102], tout au-dessus de 96 → L = 20 × 1/3 = 6,667.
    const { L, S } = calc([b(100, 102, 102, 30, 10), b(102, 110, 110, 10, 10), b(95, 110, 96)], 3);
    expect(L[2]).toBeCloseTo(20 / 3, 10);
    expect(S[2]).toBe(0);
  });

  it("T6 : miroir (pump sans retour) → shorts piégés, émis négatifs", () => {
    // b0 [100,110] δ = 20 − 60 = −40 → SHORT ; k=1 retire [109, 102) = ∅, k=2 retire
    // [113, 114) (hors lot) → vivant [100,110], tout sous 119 : S = −40 × 1/3 = −13,333.
    // b1 [109,115] δ = +10 → LONG ; k=2 retire (114, 120] → vivant [109,114], rien
    // au-dessus de 119 → L = 0.
    const { L, S } = calc([b(100, 110, 102, 20, 60), b(109, 115, 114, 15, 5), b(113, 120, 119, 10, 10)], 3);
    expect(S[2]).toBeCloseTo(-40 / 3, 10);
    expect(L[2]).toBe(0);
  });

  it("T7 : fenêtre équilibrée (buy = sell) → 0 / 0, pas undefined", () => {
    const { L, S } = calc([b(100, 110, 105, 50, 50), b(100, 110, 101, 50, 50), b(100, 110, 109, 50, 50)], 3);
    expect(L[2]).toBe(0);
    expect(S[2]).toBe(0);
  });

  it("T8 : aucune bougie à split valide dans la fenêtre → undefined", () => {
    const { L, S } = calc([b(100, 110, 108), b(95, 101, 96), b(90, 97, 91)], 3);
    expect(L[2]).toBeUndefined();
    expect(S[2]).toBeUndefined();
  });

  it("T8b : une bougie SANS split ne crée pas de lot mais libère", () => {
    // b2 [90,111] sans split : k=2 retire (96, 111] ⊇ [100,110] → L = 0 ; le short
    // [95,101] perd [90, 96) → [96,101], rien sous 91 → S = 0 (défini : b0 et b1 splittées).
    const { L, S } = calc([b(100, 110, 108, 60, 20), b(95, 101, 96, 5, 15), b(90, 111, 91)], 3);
    expect(L[2]).toBe(0);
    expect(S[2]).toBe(0);
  });

  it("T9 : bougie-point → lot ponctuel au close, piégé tant que non libéré", () => {
    // b0 point 105, δ = +20. Libéré si prevClose < 105 ≤ high_k : k=1 : 105 < 105 faux ;
    // k=2 : 100 < 105 ≤ 103 faux → vivant, 105 > 99 → L = 20 × 1/3 = 6,667.
    const { L } = calc([b(105, 105, 105, 30, 10), b(99, 104, 100, 10, 10), b(98, 103, 99, 10, 10)], 3);
    expect(L[2]).toBeCloseTo(20 / 3, 10);
  });

  it("T9b : bougie-point retouchée → libérée", () => {
    // k=2 : 100 < 105 ≤ 106 → libéré → L = 0.
    const { L } = calc([b(105, 105, 105, 30, 10), b(99, 104, 100, 10, 10), b(98, 106, 99, 10, 10)], 3);
    expect(L[2]).toBe(0);
  });

  it("T10 : bord de fenêtre — un lot d'âge length−1 pèse q/length, puis sort sans reste", () => {
    // b0 [100,110] δ = +40 ; b1..b3 [90,95] ne retouchent jamais le lot. À i=2 (âge 2) :
    // w = 1 − 2/3 = 1/3 → 40/3 = 13,333 ; à i=3 (âge 3 = length) le lot est hors fenêtre → 0.
    const { L } = calc(
      [b(100, 110, 100, 60, 20), b(90, 95, 91, 10, 10), b(90, 95, 91, 10, 10), b(90, 95, 91, 10, 10)],
      3,
    );
    expect(L[2]).toBeCloseTo(40 / 3, 10);
    expect(L[3]).toBe(0);
  });

  it("trou de données (undefined) : barre sautée, la référence reste le dernier close fini", () => {
    // b0 [100,110] clôture 101, δ = +40 ; b1 = trou ; b2 [90,105] : prevClose = 101
    // (close de b0, pas le trou) → retire (101, 105] → vivant [100,101] ∪ [105,110],
    // mesure 1 + 5 = 6 au-dessus de 91 : f = 0,6 ; w = 1/3 → L = 40 × 0,6 / 3 = 8.
    const { L, S } = calc([b(100, 110, 101, 60, 20), undefined, b(90, 105, 91, 10, 10)], 3);
    expect(L[2]).toBeCloseTo(8, 10);
    expect(S[2]).toBe(0);
  });

  it("close non fini : undefined à cette barre, mais elle libère", () => {
    // b1 [95,111] clôture NaN (sans split) : retire (108, 111] → vivant [100,108]. b2
    // [90,97] : retire (108, 97] = ∅ (vide quelle que soit la référence, cf. test suivant)
    // → 8 sur 10 au-dessus de 91, w = 1/3 → L = 40 × 0,8 / 3 = 10,667. b3 clôture NaN → undefined.
    const { L, S } = calc(
      [b(100, 110, 108, 60, 20), b(95, 111, Number.NaN), b(90, 97, 91, 10, 10), b(90, 96, Number.NaN, 10, 10)],
      3,
    );
    expect(L[2]).toBeCloseTo(32 / 3, 10);
    expect(S[2]).toBe(0);
    expect(L[3]).toBeUndefined();
    expect(S[3]).toBeUndefined();
  });

  it("après un close non fini, la référence de libération reste le dernier close FINI", () => {
    // b0 [100,110] clôture 108, δ = +40. b1 [95,105] clôture NaN : retire (108, 105] = ∅,
    // la référence reste 108. b2 [90,109] : retire (108, 109] → vivant [100,108] ∪ [109,110],
    // 9 sur 10 au-dessus de 91 ; w = 1/3 → L = 40 × 0,9 / 3 = 12. (Référence écrasée par
    // le NaN : b2 ne libère rien → 40/3.)
    const { L, S } = calc([b(100, 110, 108, 60, 20), b(95, 105, Number.NaN), b(90, 109, 91, 10, 10)], 3);
    expect(L[2]).toBeCloseTo(12, 10);
    expect(S[2]).toBe(0);
  });

  it("un lot n'est jamais libéré par SA PROPRE barre (libérations sur k = b+1..i)", () => {
    // b0 δ = 0 → rien. b1 [95,110] clôture 96, δ = 30 − 10 = +20 → lot LONG, âge 0, w = 1 ;
    // aucune barre postérieure → vivant [95,110], 14 sur 15 au-dessus de 96 :
    // L = 20 × 14/15 = 18,667. Libéré par sa propre barre ((95, 110] depuis le close 95
    // de b0), il vaudrait 0 — valeurs 4 à 7 fois trop basses sur les klines réelles.
    const { L, S } = calc([b(90, 100, 95, 10, 10), b(95, 110, 96, 30, 10)], 2);
    expect(L[1]).toBeCloseTo(20 * 14 / 15, 10);
    expect(S[1]).toBe(0);
  });

  it("bougie-point : libération STRICTE côté clôture précédente (prevClose < e, e < prevClose)", () => {
    // Long au point 105 (δ = +20). k=1 : high 106 atteint 105 mais 105 < 105 est faux → pas
    // libéré (prevClose vaut e à k = b+1) ; k=2 : 100 < 105 ≤ 103 faux → vivant, 105 > 99
    // → L = 20 × 1/3 = 6,667.
    const long = calc([b(105, 105, 105, 30, 10), b(99, 106, 100, 10, 10), b(98, 103, 99, 10, 10)], 3);
    expect(long.L[2]).toBeCloseTo(20 / 3, 10);
    // Miroir : short au point 95 (δ = −20). k=1 : 94 ≤ 95 mais 95 < 95 faux ; k=2 : 97 ≤ 95
    // faux → vivant, 95 < 101 → S = −20 × 1/3 = −6,667.
    const court = calc([b(95, 95, 95, 10, 30), b(94, 101, 100, 10, 10), b(97, 102, 101, 10, 10)], 3);
    expect(court.S[2]).toBeCloseTo(-20 / 3, 10);
    expect(court.L[2]).toBe(0);
  });

  it("bougie-point au niveau exact du close courant : pas piégée (e > p_i, e < p_i stricts)", () => {
    // Long au point 105 ; k=1 : 105 < 105 faux ; k=2 : 106 < 105 faux → vivant. À i=2 le
    // close vaut 105 : 105 > 105 faux → L = 0 (un lot AU prix n'est pas sous l'eau).
    const long = calc([b(105, 105, 105, 30, 10), b(104, 107, 106, 10, 10), b(104, 106, 105, 10, 10)], 3);
    expect(long.L[2]).toBe(0);
    // Miroir : short au point 95 ; k=1 : 95 < 95 faux ; k=2 : 95 < 94 faux → vivant ; close 95 → S = 0.
    const court = calc([b(95, 95, 95, 10, 30), b(93, 96, 94, 10, 10), b(94, 96, 95, 10, 10)], 3);
    expect(court.S[2]).toBe(0);
  });

  it("seule bougie splittée pile à i − length : hors fenêtre → undefined", () => {
    // length 2. b0 δ = +20 sur [100,110]. i=1 : fenêtre (−1, 1] ∋ b0 → défini ; b1 retire
    // (105, 110] → vivant [100,105], 1 sur 10 au-dessus de 104, w = 1/2 → L = 20 × 0,5 × 0,1 = 1.
    // i=2 : fenêtre (0, 2] = {b1, b2}, aucun split → undefined (pas 0/0).
    const { L, S } = calc([b(100, 110, 105, 30, 10), b(100, 110, 104), b(100, 110, 103)], 2);
    expect(L[1]).toBeCloseTo(1, 10);
    expect(S[1]).toBe(0);
    expect(L[2]).toBeUndefined();
    expect(S[2]).toBeUndefined();
  });

  it("le split compte : 50/50 → rien de piégé ; split permuté → autre résultat", () => {
    const serie = serieAleatoire(300, 7);
    const equilibre = serie.map((c) => ({ ...c, buyVolume: c.volume / 2, sellVolume: c.volume / 2 }));
    const e = calc(equilibre, 50);
    for (let i = 49; i < 300; i++) {
      expect(e.L[i]).toBe(0);
      expect(e.S[i]).toBe(0);
    }
    // Permutation déterministe des splits entre bougies (prix inchangés).
    const splits = serie.map((c) => [c.buyVolume, c.sellVolume] as const);
    const permutee = serie.map((c, i) => {
      const [buy, sell] = splits[(i * 7 + 3) % splits.length]!;
      return { ...c, buyVolume: buy, sellVolume: sell };
    });
    const a = calc(serie, 50);
    const p = calc(permutee, 50);
    let ecart = 0;
    for (let i = 49; i < 300; i++) ecart = Math.max(ecart, Math.abs(a.L[i]! - p.L[i]!), Math.abs(a.S[i]! - p.S[i]!));
    expect(ecart).toBeGreaterThan(1);
  });

  it("T11 : L ≥ 0, S ≤ 0, L + |S| ≤ Σ|δ| de la fenêtre, invariance par préfixe", () => {
    const length = 50;
    const serie = serieAleatoire(400, 12345);
    const prefixe = serieAleatoire(150, 999);
    const seule = calc(serie, length);
    const prefixee = calc([...prefixe, ...serie], length);
    for (let i = length - 1; i < serie.length; i++) {
      const l = seule.L[i]!;
      const s = seule.S[i]!;
      expect(l).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0);
      let sommeDelta = 0;
      for (let j = i - length + 1; j <= i; j++) {
        const c = serie[j]!;
        sommeDelta += Math.abs(c.buyVolume! - c.sellVolume!);
      }
      expect(l + Math.abs(s)).toBeLessThanOrEqual(sommeDelta + 1e-9);
      // La sortie à i ne dépend que de (i − length, i] : 150 bougies de plus devant n'y changent rien.
      expect(Math.abs(l - prefixee.L[i + prefixe.length]!)).toBeLessThan(1e-9);
      expect(Math.abs(s - prefixee.S[i + prefixe.length]!)).toBeLessThan(1e-9);
    }
  });

  it("coût : 500 barres, horizon 96, sous 10 ms (passe avant unique)", () => {
    const serie = serieAleatoire(500, 42);
    for (let r = 0; r < 3; r++) calc(serie, 96); // chauffe du JIT
    let meilleur = Infinity;
    for (let r = 0; r < 5; r++) {
      const t0 = performance.now();
      calc(serie, 96);
      meilleur = Math.min(meilleur, performance.now() - t0);
    }
    // Meilleur de 5 passes : robuste à la charge de la CI. La version naïve O(n·length²)
    // coûte ~50 ms ; le prototype en passe unique 2,6 ms.
    expect(meilleur).toBeLessThan(10);
  });

  it("conserve l'identité du def : id, sorties, couleurs, input « length »", () => {
    expect(trappedVolume.id).toBe("trappedVolume");
    expect(trappedVolume.name).toBe("Volume piégé (nord/sud)");
    expect(trappedVolume.outputs.map((o) => [o.key, o.style, o.color])).toEqual([
      ["trappedLong", "histogram", "--down"],
      ["trappedShort", "histogram", "--up"],
    ]);
    expect(trappedVolume.inputs).toEqual([
      { key: "length", name: "Horizon (barres)", type: "number", default: 96, min: 2, max: 1000 },
    ]);
    // Valeurs nettes sous l'unité en 1s : la précision 0 affichait « 0 »/« -0 » sous une barre.
    expect(trappedVolume.precision).toBe(2);
  });
});
