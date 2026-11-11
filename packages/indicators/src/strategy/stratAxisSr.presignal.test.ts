/**
 * @axiom/indicators — strategy/stratAxisSr.presignal.test.ts
 *
 * Pré-signal d'AXIS S/R (demande du 11 novembre 2026). Un seul cas, exact : à plat, à la dernière
 * bougie décidée, toutes les conditions d'achat sont réunies SAUF « clôture au-dessus de l'EMA de
 * tendance ». Le niveau est la valeur de cette EMA à cette bougie : la bougie suivante achète si elle
 * clôture au-dessus et si le score et les filtres tiennent. Non mesuré ; aucune série, aucun signal
 * confirmé, aucun marqueur n'en dépend.
 *
 * Cas de référence BTCUSDT 4h (3 000 bougies closes), réglages par défaut, `refClose` = les closes de
 * la série, unité 4h. Les décomptes épinglés ici sont des fréquences sur des données déjà vues, sans
 * valeur probante : 63 bougies en pré-signal sur 3 000 (18 épisodes), niveau franchi 5 fois à la
 * bougie suivante, 4 achats ; le cas compte 17 achats.
 */
import { describe, expect, it } from "vitest";
import type { Candle, IndicatorResult } from "@axiom/types";
import { buildCalcContext, computeIndicator, resolveParams } from "../engine";
import { closeOf, ema } from "../utils";
import { emaDepuisPremiereDefinie } from "./stratAxis";
import { BOUGIES_PRE_SIGNAL_AXIS, preSignalAxisSr, stratAxisSr } from "./stratAxisSr";
import { bougiesBtcusdt4h } from "./fixtures/btcusdt4h";

const btc = bougiesBtcusdt4h();
const closes = closeOf(btc);
const ema200 = ema(closes, 200);
/** Régime par défaut : la référence (ici les closes de la série) au-dessus de son EMA 100. */
const emaRef = emaDepuisPremiereDefinie(closes, 100);
const regime = (i: number): boolean => emaRef[i] === undefined || closes[i]! > emaRef[i]!;

type Reglages = Record<string, number | boolean | string>;
/** Calcul complet tel que le graphe le fait : `refClose` = les closes de la série, unité 4h. */
const calculer = (bougies: Candle[], params: Reglages = {}): IndicatorResult =>
  computeIndicator(stratAxisSr, bougies, params, { refClose: bougies.map((c) => c.close) }, "4h");
/** Niveau du pré-signal à chaque bougie, réglages résolus comme le fait `computeIndicator`. */
const niveaux = (bougies: Candle[], params: Reglages = {}): Array<number | undefined> =>
  preSignalAxisSr(bougies, resolveParams(stratAxisSr, params), {
    ...buildCalcContext(bougies),
    aux: { refClose: bougies.map((c) => c.close) },
    timeframe: "4h",
  });
const indices = (serie: Array<number | undefined>): number[] => serie.flatMap((v, i) => (v === undefined ? [] : [i]));

const defaut = calculer(btc);
const etat = defaut.series.etat ?? [];
const score = defaut.series.score ?? [];
const complet = niveaux(btc);
const enPreSignal = indices(complet);

describe("preSignalAxisSr — une seule condition manque : la clôture au-dessus de l'EMA de tendance", () => {
  it("cas de référence : 63 bougies, 18 épisodes ; à plat, score ≥ 5, régime tenu, close ≤ EMA 200 ; le niveau est l'EMA 200 de la bougie", () => {
    expect(complet).toHaveLength(3000);
    expect(enPreSignal).toHaveLength(63);
    expect(enPreSignal.slice(0, 6)).toEqual([469, 470, 491, 492, 620, 621]);
    expect(enPreSignal.at(-1)).toBe(2288);
    expect(enPreSignal.filter((i, k) => enPreSignal[k - 1] !== i - 1)).toHaveLength(18);
    for (const i of enPreSignal) {
      expect(complet[i], String(i)).toBe(ema200[i]);
      expect(etat[i], String(i)).toBe(0);
      expect(score[i]!, String(i)).toBeGreaterThanOrEqual(5);
      expect(closes[i]!, String(i)).toBeLessThanOrEqual(ema200[i]!);
      expect(regime(i), String(i)).toBe(true);
    }
    // Réciproque : aucune bougie remplissant ces conditions n'est oubliée (sans stop, « à plat » suffit à l'armement).
    const attendues = btc.flatMap((_c, i) =>
      etat[i] === 0 && (score[i] ?? -9) >= 5 && ema200[i] !== undefined && closes[i]! <= ema200[i]! && regime(i) ? [i] : []
    );
    expect(enPreSignal).toEqual(attendues);
  });

  it("exact : la bougie suivante achète si et seulement si elle clôture au-dessus du niveau, score et régime tenus (5 franchissements, 4 achats)", () => {
    let franchis = 0;
    let achats = 0;
    for (const i of enPreSignal) {
      const niveau = complet[i]!;
      const franchi = closes[i + 1]! > niveau;
      // L'EMA est récursive : clôturer au-dessus de sa valeur précédente, c'est clôturer au-dessus de sa valeur courante.
      expect(closes[i + 1]! > ema200[i + 1]!, String(i)).toBe(franchi);
      const achat = etat[i + 1] === 1;
      expect(achat, String(i)).toBe(franchi && (score[i + 1] ?? -9) >= 5 && regime(i + 1));
      if (franchi) franchis++;
      if (achat) achats++;
    }
    expect([franchis, achats]).toEqual([5, 4]);
    // Ce que le pré-signal annonce, sans l'enjoliver : 4 des 17 achats du cas, d'une bougie.
    const achatsDuCas = etat.flatMap((e, i) => (i > 0 && e === 1 && etat[i - 1] === 0 ? [i] : []));
    expect(achatsDuCas).toHaveLength(17);
    expect(achatsDuCas.filter((i) => complet[i - 1] !== undefined)).toHaveLength(4);
  });

  it("causalité : un préfixe ou un futur altéré ne change aucune valeur déjà décidée", () => {
    for (const k of [468, 469, 470, 471, 492, 493, 1189, 2277, 2288, 2289, 2999]) {
      expect(niveaux(btc.slice(0, k + 1)), `préfixe ${k}`).toEqual(complet.slice(0, k + 1));
      const alterees = btc.map((c, i) => (i <= k ? c : { ...c, high: 1e12 + i, low: 1, close: 1e12 - i, volume: 1e12 }));
      expect(niveaux(alterees).slice(0, k + 1), `futur ${k}`).toEqual(complet.slice(0, k + 1));
    }
  });

  it("bougie en formation : jamais lue, jamais décidée", () => {
    for (const close of [1, 80_000, 1e9]) {
      const enFormation: Candle = { ...btc[2289]!, high: Math.max(close, btc[2288]!.close), low: Math.min(close, btc[2288]!.close), close, closed: false };
      const serie = niveaux([...btc.slice(0, 2289), enFormation]);
      expect(serie[2289], String(close)).toBeUndefined();
      expect(serie.slice(0, 2289), String(close)).toEqual(complet.slice(0, 2289));
    }
    // Témoin : la bougie 2 288, close, est en pré-signal ; la même, encore en formation, n'a pas de valeur.
    const avant = niveaux([...btc.slice(0, 2288), { ...btc[2288]!, closed: false }]);
    expect(complet[2288]).toBeDefined();
    expect(avant[2288]).toBeUndefined();
    expect(avant[2287]).toBe(complet[2287]);
  });

  it("après une sortie par stop, pas de pré-signal : le rachat exige un réarmement (bougie 1 189, stop 0,5 × ATR, sans régime)", () => {
    const params = { stopAtr: 0.5, regimeBtc: 0 };
    const res = calculer(btc, params);
    const e = res.series.etat ?? [];
    const s = res.series.score ?? [];
    const serie = niveaux(btc, params);
    // 1 189 : la position sort par le stop alors que le score vaut encore ≥ 5 et que le close est sous l'EMA 200 ; la
    // bougie 1 190 clôture au-dessus du niveau, score tenu, et n'achète pas : la condition doit d'abord redevenir fausse.
    expect([e[1188], e[1189], e[1190]]).toEqual([1, 0, 0]);
    expect(s[1189]!).toBeGreaterThanOrEqual(5);
    expect(closes[1189]!).toBeLessThanOrEqual(ema200[1189]!);
    expect(closes[1190]!).toBeGreaterThan(ema200[1189]!);
    expect(s[1190]!).toBeGreaterThanOrEqual(5);
    expect(serie[1189]).toBeUndefined();
    // Sans filtre actif, l'exactitude tient sur toutes les bougies en pré-signal de ce réglage.
    const bougies = indices(serie).filter((i) => i < 2999);
    expect(bougies.length).toBeGreaterThan(20);
    for (const i of bougies) expect(e[i + 1] === 1, String(i)).toBe(closes[i + 1]! > serie[i]! && (s[i + 1] ?? -9) >= 5);
  });
});

describe("stratAxisSr — tracé du pré-signal (préfixe clos jusqu'à 2 288, dernière bougie en pré-signal)", () => {
  const clos = btc.slice(0, 2289);
  const niveau = ema200[2288]!;
  const res = calculer(clos);
  const informes = (r: IndicatorResult) => (r.annotations?.segments ?? []).filter((s) => s.info !== undefined);
  const aDroite = (r: IndicatorResult) => (r.annotations?.labels ?? []).filter((l) => l.ancrageX === "droite");
  const SEGMENT = {
    deIdx: 2288 - BOUGIES_PRE_SIGNAL_AXIS,
    deValeur: niveau,
    aIdx: 2288,
    aValeur: niveau,
    trait: "pointille",
    couleur: "--text-dim",
    cible: "prix",
    info: `AXIS S/R · pré-signal non mesuré — achat à la clôture si > ${niveau.toFixed(2)} et si le score et les filtres tiennent`,
  };
  const ETIQUETTE = { idx: 2288, valeur: niveau, texte: "pré-signal", couleur: "--text-dim", cible: "prix", ancrageX: "droite" };

  it("un court segment pointillé au niveau de l'EMA 200, terminé sur la dernière bougie, et une étiquette de 12 caractères au plus au bord droit", () => {
    expect(BOUGIES_PRE_SIGNAL_AXIS).toBe(6);
    expect(informes(res)).toEqual([SEGMENT]);
    expect(aDroite(res).at(-1)).toEqual(ETIQUETTE);
    expect(aDroite(res).filter((l) => l.texte === "pré-signal")).toHaveLength(1);
    expect(ETIQUETTE.texte.length).toBeLessThanOrEqual(12);
    // Au téléphone, la ligne est coupée vers le 55e caractère : la mention « non mesuré » y tient.
    expect(SEGMENT.info.slice(0, 55)).toContain("pré-signal non mesuré");
    expect(niveau).toBeCloseTo(64024.02, 2);
    expect(SEGMENT.info).toBe("AXIS S/R · pré-signal non mesuré — achat à la clôture si > 64024.02 et si le score et les filtres tiennent");
    // Le close de 2 288 est sous le niveau : c'est la seule condition qui manque.
    expect(closes[2288]!).toBeLessThan(niveau);
  });

  it("rien d'autre ne change : sans signaux précoces, mêmes séries, rubans, bords, marqueurs confirmés et autres étiquettes ; ni segment ni étiquette de pré-signal", () => {
    const sans = calculer(clos, { signauxPrecoces: false });
    expect(informes(sans)).toEqual([]);
    expect(aDroite(sans).filter((l) => l.texte === "pré-signal")).toEqual([]);
    expect(res.series).toEqual(sans.series);
    expect(res.annotations?.rubans).toEqual(sans.annotations?.rubans);
    expect((res.annotations?.segments ?? []).filter((s) => s.info === undefined)).toEqual(sans.annotations?.segments);
    expect((res.annotations?.labels ?? []).filter((l) => l.texte !== "pré-signal")).toEqual(sans.annotations?.labels);
    expect((res.annotations?.marqueurs ?? []).filter((m) => m.creux !== true)).toEqual(sans.annotations?.marqueurs);
  });

  it("bougie en formation : le segment se termine sur elle, au niveau de la dernière bougie décidée, quel que soit son prix", () => {
    for (const close of [1, 80_000, 1e9]) {
      const enFormation: Candle = { ...btc[2289]!, high: Math.max(close, btc[2288]!.close), low: Math.min(close, btc[2288]!.close), close, closed: false };
      const r = calculer([...clos, enFormation]);
      expect(informes(r), String(close)).toEqual([{ ...SEGMENT, deIdx: 2289 - BOUGIES_PRE_SIGNAL_AXIS, aIdx: 2289 }]);
      expect(aDroite(r).at(-1), String(close)).toEqual({ ...ETIQUETTE, idx: 2289 });
    }
    // La bougie 2 288 encore en formation : le niveau est l'EMA 200 de 2 287, dernière décidée, pas celle de 2 288.
    const avant = informes(calculer([...btc.slice(0, 2288), { ...btc[2288]!, closed: false }]));
    expect(avant).toHaveLength(1);
    expect(avant[0]).toMatchObject({ deIdx: 2288 - BOUGIES_PRE_SIGNAL_AXIS, aIdx: 2288, deValeur: ema200[2287], aValeur: ema200[2287] });
    expect(ema200[2287]).not.toBe(ema200[2288]);
  });

  it("pas de pré-signal hors du cas : bougie suivante (2 289), cas de référence entier (2 999), position ouverte", () => {
    for (const r of [calculer(btc.slice(0, 2290)), defaut]) {
      expect(informes(r)).toEqual([]);
      expect(aDroite(r).filter((l) => l.texte === "pré-signal")).toEqual([]);
    }
    // 2 740 : achat du cas de référence ; à 2 741 la position est ouverte.
    expect([etat[2739], etat[2740], etat[2741]]).toEqual([0, 1, 1]);
    expect(informes(calculer(btc.slice(0, 2742)))).toEqual([]);
  });

  it("maxZonesSr = 0 : aucune zone tracée, le pré-signal reste, seul segment et seule étiquette au bord droit", () => {
    const zero = calculer(clos, { maxZonesSr: 0 });
    expect(zero.annotations?.rubans).toBeUndefined();
    expect(zero.annotations?.segments).toEqual([SEGMENT]);
    expect(aDroite(zero)).toEqual([ETIQUETTE]);
  });

  it("sans filtre actif (régime 0), le texte ne nomme que le score ; prix × 1e-9 : niveau lisible", () => {
    const sansRegime = informes(calculer(clos, { regimeBtc: 0 }));
    expect(sansRegime).toEqual([{ ...SEGMENT, info: `AXIS S/R · pré-signal non mesuré — achat à la clôture si > ${niveau.toFixed(2)} et si le score tient` }]);
    const minuscules = clos.map((c) => ({ ...c, open: c.open * 1e-9, high: c.high * 1e-9, low: c.low * 1e-9, close: c.close * 1e-9 }));
    const info = informes(calculer(minuscules))[0]?.info ?? "";
    expect(info).toBe("AXIS S/R · pré-signal non mesuré — achat à la clôture si > 0.00006402 et si le score et les filtres tiennent");
  });
});
