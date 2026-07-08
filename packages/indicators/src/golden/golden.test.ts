/**
 * @axiom/indicators — golden/golden.test.ts
 *
 * Tests de non-régression numérique : compare 4 de nos défs (ADX, SuperTrend,
 * Ichimoku, PSAR) aux golden JSON générés HORS-LIGNE par pandas-ta-classic
 * (voir `scripts/golden/generate.py` et `scripts/golden/README.md`).
 *
 * Ce test ne lance JAMAIS Python : il ne fait que lire les fixtures `.json`
 * déjà committées dans ce dossier — conforme à BUILD-CONTRACT.md
 * (« pandas-ta-classic peut servir d'oracle de référence en commentaire de
 * test, mais AUCUNE dépendance runtime Python »). Le moteur `@axiom/indicators`
 * reste pur et synchrone.
 *
 * Fixture : `fixture-ohlcv.json`, 300 bougies BTCUSDT-1h synthétiques mais
 * réalistes (marche aléatoire à seed fixe — aucune fixture réelle committée
 * n'existait dans le repo pour être réutilisée, voir le rapport de tâche 18).
 *
 * Convention de comparaison : point à point avec `toBeCloseTo(v, 6)`, à partir
 * du premier index où LES DEUX séries (nôtre et pandas-ta) sont définies.
 * Quand une divergence de convention d'amorçage est identifiée (voir chaque
 * `describe` ci-dessous), les N premiers points concernés sont exclus
 * explicitement — jamais en élargissant la tolérance.
 */

import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { getIndicator } from "../registry";

import fixtureRaw from "./fixture-ohlcv.json";
import adxGolden from "./adx.golden.json";
import supertrendGolden from "./supertrend.golden.json";
import ichimokuGolden from "./ichimoku.golden.json";
import psarGolden from "./psar.golden.json";

const candles = fixtureRaw as Candle[];

/**
 * Compare deux séries point à point à partir du premier index où LES DEUX
 * sont définies (ou `skipUntil` si fourni, pour exclure explicitement un
 * amorçage de convention divergente). Échoue si aucun point n'a pu être
 * comparé (garde-fou contre un mapping de colonnes silencieusement vide).
 */
function expectSeriesCloseTo(
  ours: Array<number | undefined>,
  golden: Array<number | null | undefined>,
  precision: number,
  skipUntil = 0
): void {
  let compared = 0;
  for (let i = 0; i < ours.length; i++) {
    const a = ours[i];
    const b = golden[i];
    if (i < skipUntil || a === undefined || b === null || b === undefined) {
      continue;
    }
    expect(a).toBeCloseTo(b, precision);
    compared++;
  }
  expect(compared).toBeGreaterThan(0);
}

function getSeries(
  series: Record<string, Array<number | undefined>>,
  key: string
): Array<number | undefined> {
  const s = series[key];
  if (s === undefined) throw new Error(`série "${key}" absente du résultat`);
  return s;
}

describe("ADX vs pandas-ta-classic adx(14)", () => {
  const def = getIndicator("adx");
  if (def === undefined) throw new Error('indicateur "adx" introuvable dans le registre');
  const { series } = computeIndicator(def, candles, { length: 14 });

  it("+DI / -DI : matches DMP_14 / DMN_14 (à partir de l'index 14)", () => {
    // pandas-ta-classic définit DMP_14/DMN_14 dès l'index 13 (son rma() interne
    // seed sur les 14 premières valeurs BRUTES de +DM/-DM/TR, sans les
    // compacter) ; nous compactons +DM/-DM/TR à partir de la bougie 1 avant de
    // lisser, donc notre premier point défini est l'index 14. Un seul point
    // d'écart d'amorçage (index 13) — exclu naturellement car `ours[13]` est
    // `undefined` (aucune tolérance élargie). À partir de 14, écart max observé
    // ~1.4e-14 (bruit flottant), largement sous la tolérance toBeCloseTo(6).
    expectSeriesCloseTo(getSeries(series, "plusDI"), adxGolden.series.DMP_14, 6);
    expectSeriesCloseTo(getSeries(series, "minusDI"), adxGolden.series.DMN_14, 6);
  });

  it("ADX : amorçage du second lissage RMA — 236 premiers points exclus (index 27 à 262)", () => {
    // Investigation (voir rapport tâche 18) : pandas-ta-classic réutilise un
    // même helper générique `rma()` pour lisser +DM/-DM/TR ET pour lisser DX en
    // ADX. Ce helper amorce sa graine via `dx.iloc[0:length].mean()` — un
    // `.mean()` pandas ignore les NaN (skipna=True) par défaut. Comme la série
    // DX a 13 NaN en tête (index 0..12, avant que +DI/-DI soient définis), ce
    // "seed sur 14 valeurs" dégénère en une COPIE de la seule valeur réelle
    // disponible (dx[13]) plutôt qu'une vraie SMA de 14 échantillons de DX.
    // Notre implémentation, elle, compacte DX (aucun NaN dedans) avant de le
    // lisser : le seed est une authentique SMA des 14 premiers DX, donc l'ADX
    // n'est défini qu'à l'index 2*length-1 = 27 (convention Wilder / StockCharts
    // manuel : "attendre la 27e période pour le premier point ADX").
    //
    // Ce n'est PAS un bug : les deux utilisent la même récurrence EWMA
    // (alpha = 1/14), elles ne diffèrent que par la valeur de départ. L'écart
    // introduit par ce seed dégénéré décroît donc géométriquement en (13/14)^k
    // à chaque pas — vérifié numériquement (script d'investigation, non
    // committé) sur cette fixture : l'écart passe sous 5e-7 (tolérance
    // toBeCloseTo(6)) à partir de l'index 263, avec une marge de sécurité
    // ~5x (écart max observé ensuite : 9.42e-8, aucune régression ultérieure
    // jusqu'à l'index 299).
    expectSeriesCloseTo(getSeries(series, "adx"), adxGolden.series.ADX_14, 6, 263);
  });
});

describe("SuperTrend vs pandas-ta-classic supertrend(10,3)", () => {
  const def = getIndicator("supertrend");
  if (def === undefined) throw new Error('indicateur "supertrend" introuvable dans le registre');
  const { series } = computeIndicator(def, candles, { period: 10, multiplier: 3 });

  it("line : matches SUPERT_10_3.0 — 190 premiers points exclus (index 9 à 198, amorçage ATR)", () => {
    // pandas-ta-classic initialise ses tableaux numpy avec `trend = np.zeros(m)`
    // (0.0 par défaut, pas NaN) : l'index 0 du golden contient donc un 0.0
    // "factice" (jamais écrit par la boucle, qui démarre à i=1) plutôt qu'un
    // null — ignoré naturellement car `ours[0]` est `undefined`.
    //
    // Le vrai amorçage divergent est dans l'ATR sous-jacent : la fonction
    // `true_range()` de pandas-ta-classic met explicitement `TR[0] = NaN`
    // (`true_range.iloc[:drift] = NaN`, drift=1, pas de clôture précédente),
    // alors que notre `trueRange()` définit TR[0] = high[0]-low[0] (TR est
    // défini dès la première bougie, cf. utils.ts). Le seed de son `rma()`
    // générique (`.mean()` sur les 10 premières valeurs de TR, skipna=True)
    // moyenne donc seulement 9 valeurs réelles (index 1..9) au lieu de nos 10
    // (index 0..9) — même famille de quirk que le seed dégénéré identifié sur
    // ADX. Ce léger décalage de seed (~16 en valeur absolue sur l'ATR) se
    // propage ensuite dans les bandes ratchetées et décroît géométriquement
    // (alpha = 1/10) au fil des bougies.
    //
    // Ce n'est PAS un bug : la logique de renversement (`direction`, testée
    // séparément ci-dessous) est identique et EXACTE dès le premier point sur
    // toute la fixture — seule la valeur absolue de la ligne met du temps à
    // converger. Investigation numérique (voir rapport tâche 18) : l'écart
    // passe sous 1e-7 (marge ~5x sous la tolérance toBeCloseTo(6) = 5e-7) à
    // partir de l'index 199, écart max observé ensuite : 9.89e-8, aucune
    // régression jusqu'à l'index 299.
    expectSeriesCloseTo(getSeries(series, "line"), supertrendGolden.series["SUPERT_10_3.0"], 6, 199);
  });

  it("direction : matches SUPERTd_10_3.0 exactement (+1/-1)", () => {
    const ours = getSeries(series, "direction");
    const golden = supertrendGolden.series["SUPERTd_10_3.0"];
    let compared = 0;
    for (let i = 0; i < ours.length; i++) {
      const a = ours[i];
      const b = golden[i];
      if (a === undefined || b === null || b === undefined) continue;
      expect(a).toBe(b);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });
});

describe("Ichimoku vs pandas-ta-classic ichimoku(9,26,52)", () => {
  const def = getIndicator("ichimoku");
  if (def === undefined) throw new Error('indicateur "ichimoku" introuvable dans le registre');
  const { series } = computeIndicator(def, candles, {
    tenkan: 9,
    kijun: 26,
    senkou: 52,
    displacement: 26,
  });

  // Aucune exclusion nécessaire pour Ichimoku : le décalage (+displacement pour
  // les Senkou, -displacement pour Chikou) et les fenêtres roulantes (tenkan/
  // kijun/senkou) sont des calculs purement déterministes sans état récursif
  // ni lissage — les deux implémentations s'accordent bit-exactement dès leur
  // premier index commun défini, pour les 5 lignes (écart max observé : 0.0).
  it("tenkan : matches ITS_9", () => {
    expectSeriesCloseTo(getSeries(series, "tenkan"), ichimokuGolden.series.ITS_9, 6);
  });
  it("kijun : matches IKS_26", () => {
    expectSeriesCloseTo(getSeries(series, "kijun"), ichimokuGolden.series.IKS_26, 6);
  });
  it("spanA (Senkou A) : matches ISA_9", () => {
    expectSeriesCloseTo(getSeries(series, "spanA"), ichimokuGolden.series.ISA_9, 6);
  });
  it("spanB (Senkou B) : matches ISB_26", () => {
    expectSeriesCloseTo(getSeries(series, "spanB"), ichimokuGolden.series.ISB_26, 6);
  });
  it("chikou : matches ICS_26", () => {
    expectSeriesCloseTo(getSeries(series, "chikou"), ichimokuGolden.series.ICS_26, 6);
  });
});

describe("PSAR vs pandas-ta-classic psar(0.02, 0.2)", () => {
  const def = getIndicator("psar");
  if (def === undefined) throw new Error('indicateur "psar" introuvable dans le registre');
  const { series } = computeIndicator(def, candles, { step: 0.02, max: 0.2 });

  it("psar : matches PSARl/PSARs combinés (21 premiers points exclus — amorçage de tendance divergent)", () => {
    // pandas-ta-classic détermine la tendance initiale via une comparaison
    // directionnelle haut/bas (style +DM/-DM sur les 2 premières bougies),
    // alors que notre implémentation la déduit de close[1] vs close[0] (cf.
    // commentaire de psar.ts). Ce sont deux conventions défendables (Wilder ne
    // fige pas ce choix arbitraire d'amorçage) qui peuvent désigner une
    // tendance de départ opposée sur les toutes premières bougies.
    // Investigation numérique (voir rapport tâche 18) : les deux séries
    // divergent effectivement de l'index 1 à 21 (écart jusqu'à ~617 en valeur
    // absolue), mais se resynchronisent EXACTEMENT (écart 0.0, vérifié de
    // façon exhaustive) dès qu'un renversement réel de tendance survient dans
    // les deux moteurs — à partir de l'index 22 jusqu'à la fin de la fixture
    // (299). 21 premiers points exclus, écart max observé ensuite : 0.0.
    const gl = psarGolden.series["PSARl_0.02_0.2"];
    const gs = psarGolden.series["PSARs_0.02_0.2"];
    const combined: Array<number | null> = gl.map((v, i) => (v !== null ? v : gs[i] ?? null));
    expectSeriesCloseTo(getSeries(series, "psar"), combined, 6, 22);
  });
});
