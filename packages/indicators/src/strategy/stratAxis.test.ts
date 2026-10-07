/**
 * @axiom/indicators — strategy/stratAxis.test.ts
 *
 * AXIS (confluence, demande du 7 octobre 2026, v2 long/plat) n'a pas de
 * référence externe : la garantie passe par la fixture dorée (300 bougies
 * BTCUSDT-1h à seed fixe, golden/fixture-ohlcv.json, empreinte figée par
 * golden.test.ts) dérivée AU LITTÉRAL, la recomposition des votes contre les
 * cœurs importés directement, et des scores synthétiques pour les positions.
 *
 * Faits dérivés sur la fixture (votes aux défauts : EMA 20/50, Supertrend
 * 10×3, ADX ≥ 20, MACD 12/26/9, RSI 14, CMF 20) :
 *   i=49 : premier score défini (l'EMA 50 est le dernier cœur amorcé), +4 ;
 *   défauts (achat ≥ +5, vente ≤ −4, EMA 200) : la fixture baisse, le close
 *     reste sous l'EMA 200 de i=199 à 298 → aucun achat ; il ne la franchit
 *     qu'à i=299, la dernière bougie, exclue par l'anti-repaint ;
 *   EMA de tendance 50 : achats 60 et 107 (+6/6), ventes 88 et 139 (−4/6),
 *     achat 280 encore ouvert ; la position traverse des scores 0 et −1 ;
 *   seuil 4 + EMA 50 : à i=49 l'achat est déjà vrai (+4, close 60322,86 >
 *     EMA 59570,63) → silence, premier achat à 53 après les scores 0 de 50..52 ;
 *   i=255 : +4 mais close 53057,24 < EMA 50 53098,32 → achat retardé à 256
 *     (avec l'EMA 20, au-dessous du close, il a lieu dès 255).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { getIndicator } from "../registry";
import { supportsIndicatorTimeframe, TIMEFRAME_REQUIS } from "../timeframes";
import { closeOf, ema } from "../utils";
import { MAX_LABELS_SORTIE, specStrategie } from "../utils-fabrique-strategie";
import { rsiOf } from "../momentum/rsi";
import { adxOf } from "../trend/adx";
import { macdOf } from "../trend/macd";
import { supertrendOf } from "../trend/supertrend";
import { cmfOf } from "../volume/cmf";
import fixtureRaw from "../golden/fixture-ohlcv.json";
import { MAX_SIGNAUX_AXIS, episodesAxis, positionsAxis, stratAxis, votesAxis } from "./stratAxis";

const candles = fixtureRaw as Candle[];
const DEFAUTS = { emaRapide: 20, emaLente: 50, stPeriode: 10, stMult: 3, seuilAdx: 20 };
const EMA50 = { emaTendance: 50 };
const RESERVE =
  "test réussi sur données jamais vues (crypto 4h, 2017-2024), pas mieux qu'une EMA 200 seule sur 3/4 actifs — mesure passée, pas une promesse";

/** Signaux d'un résultat sous la forme « 60▲ 88▼ … ». */
function resume(candlesEntree: Candle[], params: Record<string, number> = {}): string {
  const res = computeIndicator(stratAxis, candlesEntree, params);
  return (res.annotations?.marqueurs ?? []).map((m) => `${m.idx}${m.forme === "triangleHaut" ? "▲" : "▼"}`).join(" ");
}

/** Sens strict a vs b, sans −0 (toEqual distingue 0 et −0). */
const sens = (a: number, b: number): number => Math.sign(a - b) + 0;

describe("stratAxis — contrat", () => {
  it("strategy/overlay enregistrée, huit inputs bornés, une sortie prix, réservée au 4h après son test, sans spec de fabrique", () => {
    expect(getIndicator("stratAxis")).toBe(stratAxis);
    expect(stratAxis.name).toBe("AXIS");
    expect(stratAxis.category).toBe("strategy");
    expect(stratAxis.pane).toBe("overlay");
    expect(stratAxis.inputs.map((i) => [i.key, i.default, i.min, i.max])).toEqual([
      ["seuil", 5, 1, 6],
      ["seuilVente", 4, 1, 6],
      ["emaTendance", 200, 2, undefined],
      ["emaRapide", 20, 1, undefined],
      ["emaLente", 50, 2, undefined],
      ["stPeriode", 10, 1, undefined],
      ["stMult", 3, 0.5, undefined],
      ["seuilAdx", 20, 5, 60],
    ]);
    expect(stratAxis.outputs.map((o) => o.key)).toEqual(["prixSignal"]);
    // 1h et 2h n'ont montré aucun avantage, même sur les données d'exploration ;
    // le test du 7 octobre 2026 ne couvre que le 4h : la def est réservée à cette unité.
    expect(stratAxis.minTimeframe).toBe("4h");
    expect(TIMEFRAME_REQUIS.stratAxis).toBe("4h");
    expect(supportsIndicatorTimeframe("stratAxis", "4h")).toBe(true);
    expect(supportsIndicatorTimeframe("stratAxis", "1d")).toBe(false);
    expect(supportsIndicatorTimeframe("stratAxis", "1h")).toBe(false);
    // Verdict FAVORABLE du test sur données jamais vues (scripts/axis/rapport-v2-2026-10-07.md).
    expect(stratAxis.validation).toBeUndefined();
    // Hors fabrique defStrategie : ni trades ni PnL, et scripts/valider-strategies l'ignore.
    expect(specStrategie("stratAxis")).toBeUndefined();
  });
});

describe("votesAxis", () => {
  it("recomposition contre les cœurs : sens stricts, DMI conditionné à l'ADX, CMF indéfini neutre", () => {
    const cl = closeOf(candles);
    const rapide = ema(cl, 20);
    const lente = ema(cl, 50);
    const st = supertrendOf(candles, 10, 3);
    const dmi = adxOf(candles, 14);
    const m = macdOf(cl, 12, 26, 9);
    const rsi = rsiOf(cl, 14);
    const cmf = cmfOf(candles, 20);
    const votes = votesAxis(candles, DEFAUTS);
    // L'EMA 50 est le dernier cœur amorcé : aucun vote avant i=49.
    expect(lente.findIndex((v) => v !== undefined)).toBe(49);
    expect(votes.findIndex((v) => v !== undefined)).toBe(49);
    for (let i = 49; i < candles.length; i++) {
      const adx = dmi.adx[i]!;
      const attendu = [
        sens(rapide[i]!, lente[i]!),
        st.direction[i],
        adx >= 20 ? sens(dmi.plusDI[i]!, dmi.minusDI[i]!) : 0,
        sens(m.macd[i]!, m.signal[i]!),
        sens(rsi[i]!, 50),
        cmf[i] === undefined ? 0 : sens(cmf[i]!, 0),
      ];
      expect(votes[i], `i=${i}`).toEqual(attendu);
    }
  });

  it("i=70 : ADX sous le seuil → DMI neutre ; seuil ADX abaissé → le +DI dominant vote", () => {
    const dmi = adxOf(candles, 14);
    expect(dmi.adx[70]).toBeCloseTo(19.2765, 4);
    expect(dmi.plusDI[70]).toBeCloseTo(28.0211, 4);
    expect(dmi.minusDI[70]).toBeCloseTo(13.3561, 4);
    expect(votesAxis(candles, DEFAUTS)[70]).toEqual([1, 1, 0, 1, 1, 1]);
    expect(votesAxis(candles, { ...DEFAUTS, seuilAdx: 5 })[70]).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("volume nul (forex, série synthétique) : CMF indéfini, vote neutre, score toujours défini", () => {
    const sansVolume = candles.map((c) => ({ ...c, volume: 0 }));
    expect(cmfOf(sansVolume, 20).every((v) => v === undefined)).toBe(true);
    const votes = votesAxis(sansVolume, DEFAUTS);
    expect(votes.findIndex((v) => v !== undefined)).toBe(49);
    expect(votes.slice(49).every((v) => v !== undefined && v[5] === 0)).toBe(true);
    // Cinq votes restent : achat à +5 et vente à −4 encore atteignables.
    expect(resume(sansVolume, EMA50)).toBe("60▲ 96▼ 107▲ 142▼ 274▲");
  });
});

describe("episodesAxis (lecture v1, campagne figée)", () => {
  it("naît au seuil, dure tant que le score garde son signe, se réarme en repassant par 0", () => {
    const score = [undefined, 2, 4, 3, 1, 3, 4, 0, 4, -1, -4, -2, 0, -3, -4];
    expect(episodesAxis(score, 4, score.length - 1)).toEqual([
      undefined, 0, 1, 1, 1, 1, 1, 0, 1, 0, -1, -1, 0, 0, -1,
    ]);
  });

  it("score indéfini ou situé après `fin` : l'état précédent est reporté", () => {
    expect(episodesAxis([4, undefined, 2, 0, -5], 4, 3)).toEqual([1, 1, 1, 0, 0]);
    expect(episodesAxis([undefined, undefined], 4, 1)).toEqual([undefined, undefined]);
  });
});

describe("positionsAxis", () => {
  const haut = (n: number): boolean[] => new Array(n).fill(true);

  it("achat à +seuil une fois armé ; tenue à travers 0 et −3 ; vente à −seuilVente ; réarmé aussitôt", () => {
    const score = [undefined, 2, 5, 4, 0, -3, -4, 0, 5, 6, -5, 6];
    expect(positionsAxis(score, haut(12), 5, 4, 11)).toEqual([undefined, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1]);
  });

  it("achat déjà vrai à la première bougie évaluable : silence jusqu'à un achat faux", () => {
    expect(positionsAxis([5, 6, 5, 4, 5], haut(5), 5, 4, 4)).toEqual([0, 0, 0, 0, 1]);
  });

  it("tendance indéfinie : ni achat ni armement ; sous l'EMA, pas d'achat même à +6", () => {
    const tendance = [undefined, undefined, true, false, false, true, true];
    expect(positionsAxis([4, 6, 6, 6, 4, 5, 5], tendance, 5, 4, 6)).toEqual([0, 0, 0, 0, 0, 1, 1]);
  });

  it("la vente ne dépend pas de la tendance : sous l'EMA, la position tient jusqu'à −seuilVente", () => {
    expect(positionsAxis([3, 5, 2, -2, -4], [true, true, false, false, false], 5, 4, 4)).toEqual([0, 1, 1, 1, 0]);
  });

  it("score indéfini ou situé après `fin` : position reportée", () => {
    expect(positionsAxis([undefined, 3, 5, undefined, -6, -6], haut(6), 5, 4, 3)).toEqual([undefined, 0, 1, 1, 1, 1]);
  });
});

describe("stratAxis — calc sur la fixture dorée", () => {
  const res = computeIndicator(stratAxis, candles, EMA50);

  it("défauts : close sous l'EMA 200 de 199 à 298 → aucun achat ; le franchissement de 299 (dernière bougie) est exclu", () => {
    const e200 = ema(closeOf(candles), 200);
    expect(e200.findIndex((v) => v !== undefined)).toBe(199);
    const auDessus = e200.map((t, i) => t !== undefined && candles[i]!.close > t);
    expect(auDessus.slice(199, 299).some(Boolean)).toBe(false);
    expect(auDessus[299]).toBe(true);
    const defaut = computeIndicator(stratAxis, candles, {});
    expect(defaut.annotations).toBeUndefined();
    expect(defaut.series.prixSignal?.every((v) => v === undefined)).toBe(true);
  });

  it("EMA de tendance 50 : cinq signaux AU LITTÉRAL (▲ au plus bas, ▼ au plus haut, résultat hors frais)", () => {
    const votes = "EMA 20/50 ▲, Supertrend ▲, DMI ▲, MACD ▲, RSI ▲, CMF ▲";
    const baisse = "EMA 20/50 ▲, Supertrend ▼, DMI ▼, MACD ▼, RSI ▼, CMF ▼";
    expect(res.annotations?.marqueurs).toEqual([
      { idx: 60, valeur: 60296.88, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: `AXIS achat — score +6/6 : ${votes} ; close au-dessus de l'EMA 50 — ${RESERVE}` },
      { idx: 88, valeur: 61283.85, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: `AXIS vente — score -4/6 : ${baisse} ; -0.50 % depuis l'achat (hors frais) — ${RESERVE}` },
      { idx: 107, valeur: 61068.78, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: `AXIS achat — score +6/6 : ${votes} ; close au-dessus de l'EMA 50 — ${RESERVE}` },
      { idx: 139, valeur: 61009.07, forme: "triangleBas", couleur: "--down", cible: "prix",
        info: `AXIS vente — score -4/6 : ${baisse} ; -1.86 % depuis l'achat (hors frais) — ${RESERVE}` },
      { idx: 280, valeur: 53948.6, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: `AXIS achat — score +6/6 : ${votes} ; close au-dessus de l'EMA 50 — ${RESERVE}` },
    ]);
    for (const m of res.annotations?.marqueurs ?? []) {
      const b = candles[m.idx]!;
      expect(m.valeur).toBe(m.forme === "triangleHaut" ? b.low : b.high);
    }
    // Résultat = close de vente / close d'achat − 1.
    expect((candles[88]!.close / candles[60]!.close - 1) * 100).toBeCloseTo(-0.5, 2);
    expect((candles[139]!.close / candles[107]!.close - 1) * 100).toBeCloseTo(-1.86, 2);
  });

  it("étiquettes « Achat » sous / « Vente ±x % » au-dessus de chaque signal (≤ 10)", () => {
    const achat = (idx: number, valeur: number) =>
      ({ idx, valeur, texte: "Achat", couleur: "--up", cible: "prix", position: "dessous" });
    const vente = (idx: number, valeur: number, texte: string) =>
      ({ idx, valeur, texte, couleur: "--down", cible: "prix", position: "dessus" });
    expect(res.annotations?.labels).toEqual([
      achat(60, 60296.88), vente(88, 61283.85, "Vente -0.50 %"), achat(107, 61068.78),
      vente(139, 61009.07, "Vente -1.86 %"), achat(280, 53948.6),
    ]);
  });

  it("prixSignal : close de la bougie d'achat, tenu pendant la position, trou à plat et à la vente", () => {
    const positions: Array<[de: number, a: number]> = [[60, 87], [107, 138], [280, 299]];
    const attendu: Array<number | undefined> = new Array(candles.length).fill(undefined);
    for (const [de, a] of positions) for (let i = de; i <= a; i++) attendu[i] = candles[de]!.close;
    expect(res.series.prixSignal).toEqual(attendu);
    expect([candles[60]!.close, candles[107]!.close, candles[280]!.close]).toEqual([60785.17, 61454.2, 54338.01]);
  });

  it("une confluence retombée à 0 ou −1 ne vend pas : seule −4 vend", () => {
    const score = votesAxis(candles, DEFAUTS).map((v) => v?.reduce((a, b) => a + b, 0));
    expect(score.slice(60, 68)).toEqual([6, 4, 2, 2, -1, 1, 1, -1]);
    expect(score.slice(131, 140)).toEqual([4, 2, 0, 0, 0, -2, -2, -2, -4]);
  });

  it("armement : à i=49 l'achat (+4, au-dessus de l'EMA 50) est déjà vrai → premier achat à 53", () => {
    const score = votesAxis(candles, DEFAUTS).map((v) => v?.reduce((a, b) => a + b, 0));
    expect(score.slice(48, 54)).toEqual([undefined, 4, 0, 0, 0, 4]);
    expect(candles[49]!.close).toBeGreaterThan(ema(closeOf(candles), 50)[49]!);
    expect(resume(candles, { ...EMA50, seuil: 4 })).toBe("53▲ 88▼ 107▲ 139▼ 256▲ 263▼ 270▲");
  });

  it("filtre de tendance : à i=255 le close est sous l'EMA 50 (achat à 256), au-dessus de l'EMA 20 (achat à 255)", () => {
    expect(resume(candles, { emaTendance: 20, seuil: 4 })).toBe("53▲ 88▼ 107▲ 139▼ 255▲ 263▼ 270▲");
  });

  it("seuil de vente réglable : vente à −2 → sortie avancée de 139 à 136", () => {
    expect(resume(candles, { ...EMA50, seuilVente: 2 })).toBe("60▲ 88▼ 107▲ 136▼ 280▲");
  });

  it("anti-repaint : la dernière bougie ne crée jamais de signal, la suivante le confirme", () => {
    const enFormation = computeIndicator(stratAxis, candles.slice(0, 61), EMA50);
    expect(enFormation.annotations).toBeUndefined();
    expect(enFormation.series.prixSignal?.[60]).toBeUndefined();
    const confirme = computeIndicator(stratAxis, candles.slice(0, 62), EMA50);
    expect(confirme.annotations?.marqueurs?.map((m) => m.idx)).toEqual([60]);
    expect(confirme.series.prixSignal?.slice(60)).toEqual([60785.17, 60785.17]);
  });

  it("causalité : un préfixe ou un futur altéré ne change jamais le passé", () => {
    const complet = res.series.prixSignal ?? [];
    const marqueurs = res.annotations?.marqueurs ?? [];
    for (const k of [60, 88, 139, 253, 280]) {
      // Préfixe : la bougie k est la dernière (en formation), exclue de la comparaison.
      const prefixe = computeIndicator(stratAxis, candles.slice(0, k + 1), EMA50);
      expect(prefixe.series.prixSignal?.slice(0, k), `préfixe ${k}`).toEqual(complet.slice(0, k));
      expect(prefixe.annotations?.marqueurs ?? []).toEqual(marqueurs.filter((m) => m.idx < k));
      // Futur altéré : la bougie k n'est plus la dernière, elle est comparée aussi.
      const alterees = candles.map((c, i) => (i <= k ? c : { ...c, high: 1e12 + i, low: 1, close: 1e12 - i, volume: 1e12 }));
      const futur = computeIndicator(stratAxis, alterees, EMA50);
      expect(futur.series.prixSignal?.slice(0, k + 1), `futur ${k}`).toEqual(complet.slice(0, k + 1));
      expect((futur.annotations?.marqueurs ?? []).filter((m) => m.idx <= k)).toEqual(marqueurs.filter((m) => m.idx <= k));
    }
  });

  it("moins de 50 bougies : aucun score, aucune annotation", () => {
    const court = computeIndicator(stratAxis, candles.slice(0, 49), EMA50);
    expect(court.annotations).toBeUndefined();
    expect(court.series.prixSignal?.every((v) => v === undefined)).toBe(true);
  });
});

describe("stratAxis — plafonds d'annotation", () => {
  it(`garde les ${MAX_SIGNAUX_AXIS} signaux les plus récents, étiquette les ${MAX_LABELS_SORTIE} derniers`, () => {
    // Sinusoïde de période 60 sur 6 000 bougies : ≈ un achat et une vente par période.
    const n = 6000;
    const sinus: Candle[] = Array.from({ length: n }, (_v, i) => {
      const c = 100 + 10 * Math.sin((2 * Math.PI * i) / 60) + (i % 7) * 0.05;
      return { time: i * 3_600_000, open: c - 0.2, high: c + 1, low: c - 1, close: c, volume: 10 + (i % 5) };
    });
    const score = votesAxis(sinus, DEFAUTS).map((v) => v?.reduce((a, b) => a + b, 0));
    const tendance = ema(closeOf(sinus), 200).map((t, i) => (t === undefined ? undefined : sinus[i]!.close > t));
    const pos = positionsAxis(score, tendance, 5, 4, n - 2);
    const tous: number[] = [];
    for (let i = 1; i < n; i++) if (pos[i - 1] !== undefined && pos[i] !== pos[i - 1]) tous.push(i);
    expect(tous.length).toBe(192);
    const res = computeIndicator(stratAxis, sinus, {});
    expect(res.annotations?.marqueurs?.map((m) => m.idx)).toEqual(tous.slice(-MAX_SIGNAUX_AXIS));
    expect(res.annotations?.labels?.map((l) => l.idx)).toEqual(tous.slice(-MAX_LABELS_SORTIE));
  });
});
