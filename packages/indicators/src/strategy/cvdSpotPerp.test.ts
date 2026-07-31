/**
 * @axiom/indicators — orderflow/cvdSpotPerp.test.ts
 *
 * Astuce des fixtures : deltas alternés [3, 1] (ou leurs négatifs / ×10). Toute
 * fenêtre de 20 valeurs consécutives alternées contient exactement dix 3 et dix
 * 1 → moyenne 2, variance population = 1, écart-type = 1 EXACTEMENT (calcul
 * flottant exact). La normalisation (CVD / stdev) devient donc l'identité : la
 * série normalisée égale le CVD brut, ce qui permet des valeurs attendues
 * calculées à la main. Sur ×10, le stdev vaut 10 et le CVD ×10 → même série
 * normalisée (invariance d'échelle).
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { cvdSpotPerp } from "./cvdSpotPerp";

const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

/** Bougie neutre ; buy/sell optionnels pour piloter le delta agresseur spot. */
function c(buy?: number, sell?: number): Candle {
  return { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1, buyVolume: buy, sellVolume: sell };
}

/** n bougies dont le delta spot alterne [a, b] (buy = valeur, sell = 0). */
function candlesAlt(n: number, a: number, b: number): Candle[] {
  return Array.from({ length: n }, (_, i) => c(i % 2 === 0 ? a : b, 0));
}

/** Série perpDelta alternée [a, b]. */
function perpAlt(n: number, a: number, b: number): Array<number | undefined> {
  return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? a : b));
}

describe("cvdSpotPerp", () => {
  describe("cumul / rebase", () => {
    it("cumule les deltas depuis la 1re bougie ; normalisation identité (stdev=1) → CVD brut attendu", () => {
      // 24 bougies, delta spot alterné [3, 1]. fenetre=20, lissage=1.
      // CVD (cumul) : paires (3,1) somment 4 ; index 19 (10 paires) = 40, puis
      // +3, +1, +3, +1 → 43, 44, 47, 48. stdev fenêtre = 1 → normalisé = CVD.
      const candles = candlesAlt(24, 3, 1);
      const { series } = cvdSpotPerp.calc(candles, { fenetre: 20, lissage: 1 }, baseCtx);
      // Warm-up : < 20 deltas dans la fenêtre → undefined.
      for (let i = 0; i < 19; i++) expect(series.cvdSpot?.[i]).toBeUndefined();
      expect(series.cvdSpot?.slice(19)).toEqual([40, 43, 44, 47, 48]);
    });

    it("rebase : le cumul est relatif à la 1re bougie CHARGÉE (décalage si on tronque en tête)", () => {
      const full = candlesAlt(24, 3, 1);
      const sliced = full.slice(4); // on retire 2 paires (cumul décalé de 8)
      const resFull = cvdSpotPerp.calc(full, { fenetre: 20, lissage: 1 }, baseCtx);
      const resSliced = cvdSpotPerp.calc(sliced, { fenetre: 20, lissage: 1 }, baseCtx);
      // Même bougie sous-jacente : plein index 23 = 48 ; tronqué index 19 = 40 (rebasé de 8).
      expect(resFull.series.cvdSpot?.[23]).toBe(48);
      expect(resSliced.series.cvdSpot?.[19]).toBe(40);
    });

    it("warm-up = 20 points fixe, indépendant de fenetre (fenetre=100, 24 bougies → défini dès l'index 19)", () => {
      // Lecture (A) : plancher de 20 échantillons, fenêtre plafonnée à `fenetre`.
      // À l'index 19, exactement 20 deltas alternés → stdev=1 → normalisé = CVD = 40.
      const candles = candlesAlt(24, 3, 1);
      const { series } = cvdSpotPerp.calc(candles, { fenetre: 100, lissage: 1 }, baseCtx);
      expect(series.cvdSpot?.[18]).toBeUndefined(); // 19 points < 20
      expect(series.cvdSpot?.[19]).toBe(40); // 20 points
    });
  });

  describe("invariance d'échelle (×10)", () => {
    it("×10 sur les volumes d'une jambe → même série normalisée", () => {
      const base = cvdSpotPerp.calc(candlesAlt(24, 3, 1), { fenetre: 20, lissage: 1 }, baseCtx);
      const x10 = cvdSpotPerp.calc(candlesAlt(24, 30, 10), { fenetre: 20, lissage: 1 }, baseCtx);
      for (let i = 19; i < 24; i++) {
        expect(x10.series.cvdSpot?.[i]).toBeCloseTo(base.series.cvdSpot?.[i] as number, 9);
      }
    });
  });

  describe("divergence signée", () => {
    it("spot achète / perp vend → histogramme positif et croissant", () => {
      // Spot delta [3, 1] (achat) ; perp delta [-3, -1] (vente). stdev=1 des deux côtés.
      const candles = candlesAlt(24, 3, 1);
      const perpDelta = perpAlt(24, -3, -1);
      const { series } = cvdSpotPerp.calc(candles, { fenetre: 20, lissage: 1 }, { ...baseCtx, aux: { perpDelta } });
      // cvdSpotNorm = +40.. ; cvdPerpNorm = -40.. ; divergence = spot - perp = 80, 86, 88, 94, 96.
      expect(series.divergence?.slice(19)).toEqual([80, 86, 88, 94, 96]);
      const div = series.divergence?.slice(19) as number[];
      for (const d of div) expect(d).toBeGreaterThan(0);
      for (let i = 1; i < div.length; i++) expect(div[i]).toBeGreaterThan(div[i - 1] as number);
    });

    it("perp démarre à mi-série → les DEUX cumuls s'ancrent au même index, divergence sans offset", () => {
      // Spot delta [3,1] défini sur les 44 bougies ; perp delta [3,1] IDENTIQUE mais
      // défini seulement à partir de l'index 4 (undefined avant → perp ne couvre pas
      // le début, cas lookback < chart). Ancre commune = index 4 : le cumul spot est
      // rebasé là aussi, donc spot et perp deviennent la MÊME suite → divergence = 0.
      //
      // Ancien code (chaque jambe depuis SON 1er défini) : le cumul spot embarquait
      // [3,1,3,1] = 8 avant l'index 4, tandis que le perp partait de 0 → offset CONSTANT
      // de +8 sur cvdSpot ; après normalisation (stdev=1 des deux côtés) la divergence
      // aurait valu +8 partout au lieu de 0.
      const candles = candlesAlt(44, 3, 1);
      const perpDelta: Array<number | undefined> = Array.from({ length: 44 }, (_, i) =>
        i < 4 ? undefined : i % 2 === 0 ? 3 : 1
      );
      const { series } = cvdSpotPerp.calc(
        candles,
        { fenetre: 20, lissage: 1 },
        { ...baseCtx, aux: { perpDelta } }
      );
      // Warm-up depuis l'ancre (index 4) : 20 deltas → défini dès l'index 23.
      expect(series.divergence?.[22]).toBeUndefined();
      for (let i = 23; i < 44; i++) expect(series.divergence?.[i]).toBe(0);
      // La ligne spot est bien rebasée sur l'ancre : à l'index 23 (20 deltas alternés
      // depuis l'index 4), CVD = dix 3 + dix 1 = 40, stdev=1 → 40 (pas 48 comme si
      // cumulée depuis l'index 0).
      expect(series.cvdSpot?.[23]).toBe(40);
      expect(series.cvdPerp?.[23]).toBe(40);
    });
  });

  describe("dégradations (jamais de throw, jamais de NaN)", () => {
    it("perpDelta absent → cvdPerp / divergence undefined, cvdSpot tracé", () => {
      const candles = candlesAlt(24, 3, 1);
      expect(() => cvdSpotPerp.calc(candles, { fenetre: 20, lissage: 1 }, baseCtx)).not.toThrow();
      const { series } = cvdSpotPerp.calc(candles, { fenetre: 20, lissage: 1 }, baseCtx);
      expect(series.cvdPerp).toEqual(new Array(24).fill(undefined));
      expect(series.divergence).toEqual(new Array(24).fill(undefined));
      expect(series.cvdSpot?.[23]).toBe(48); // spot toujours tracé
    });

    it("aux présent mais sans perpDelta (autre clé) → cvdPerp / divergence undefined", () => {
      const candles = candlesAlt(24, 3, 1);
      const { series } = cvdSpotPerp.calc(candles, { fenetre: 20, lissage: 1 }, { ...baseCtx, aux: { oi: new Array(24).fill(1) } });
      expect(series.cvdPerp).toEqual(new Array(24).fill(undefined));
      expect(series.divergence).toEqual(new Array(24).fill(undefined));
    });

    it("bougies sans taker (pas de buy/sell) et sans perp → tout undefined", () => {
      const candles = Array.from({ length: 24 }, () => c()); // buy/sell undefined
      const { series } = cvdSpotPerp.calc(candles, { fenetre: 20, lissage: 1 }, baseCtx);
      expect(series.cvdSpot).toEqual(new Array(24).fill(undefined));
      expect(series.cvdPerp).toEqual(new Array(24).fill(undefined));
      expect(series.divergence).toEqual(new Array(24).fill(undefined));
    });

    it("stdev nul (deltas constants) → normalisation undefined (pas de division par zéro)", () => {
      // buy=5, sell=0 partout → delta constant 5 → stdev fenêtre = 0.
      const candles = Array.from({ length: 24 }, () => c(5, 0));
      const { series } = cvdSpotPerp.calc(candles, { fenetre: 20, lissage: 1 }, baseCtx);
      expect(series.cvdSpot).toEqual(new Array(24).fill(undefined));
    });

    it("volume non fini (NaN) ne fuit jamais en sortie", () => {
      const candles = candlesAlt(24, 3, 1);
      candles[10] = c(NaN, 0);
      const { series } = cvdSpotPerp.calc(candles, { fenetre: 20, lissage: 1 }, baseCtx);
      for (const v of series.cvdSpot ?? []) expect(Number.isNaN(v)).toBe(false);
    });
  });

  describe("lissage = 1 = deltas bruts", () => {
    it("normalisé (lissage=1) = somme cumulée directe des deltas bruts (stdev=1)", () => {
      const candles = candlesAlt(24, 3, 1);
      const { series } = cvdSpotPerp.calc(candles, { fenetre: 20, lissage: 1 }, baseCtx);
      // Référence : cumul direct de (buy - sell), sans EMA.
      let acc = 0;
      const cumul: number[] = candles.map((k) => (acc += (k.buyVolume ?? 0) - (k.sellVolume ?? 0)));
      for (let i = 19; i < 24; i++) expect(series.cvdSpot?.[i]).toBe(cumul[i]);
    });

    it("lissage > 1 lisse réellement (série distincte du brut)", () => {
      const brut = cvdSpotPerp.calc(candlesAlt(24, 3, 1), { fenetre: 20, lissage: 1 }, baseCtx);
      const lisse = cvdSpotPerp.calc(candlesAlt(24, 3, 1), { fenetre: 20, lissage: 5 }, baseCtx);
      expect(lisse.series.cvdSpot?.[23]).not.toBe(brut.series.cvdSpot?.[23]);
    });
  });

  describe("marqueurs de divergence (v2.1)", () => {
    it("sens opposés soutenus → marqueurs pane --up ancrés sur la jambe spot", () => {
      // 60 bougies, delta spot alterné [1, 2] (stdev > 0), perp exactement opposé
      // [-1, -2] : après lissage EMA (défaut 3) la jambe perp normalisée est
      // l'opposée exacte de la spot → mismatch de signe soutenu.
      // Warm-up : EMA-3 amorcée à l'index 2, il faut MIN_POINTS_STDEV=20 deltas
      // lissés dans la fenêtre → cvdSpot/cvdPerp définis à partir de l'index 21 ;
      // le Δ de divergence sur fenetreDiv=5 exige les DEUX bornes définies →
      // premier marqueur possible à l'index 26.
      const candles = candlesAlt(60, 1, 2);
      const perpDelta = perpAlt(60, -1, -2);
      const { series, annotations } = cvdSpotPerp.calc(
        candles,
        { fenetre: 100, lissage: 3, fenetreDiv: 5 },
        { ...baseCtx, aux: { perpDelta } }
      );
      const marqueurs = annotations?.marqueurs ?? [];
      expect(marqueurs.length).toBeGreaterThan(0);
      expect(Math.min(...marqueurs.map((m) => m.idx))).toBeGreaterThanOrEqual(26);
      for (const m of marqueurs) {
        expect(m.forme).toBe("triangleHaut");
        expect(m.couleur).toBe("--up");
        expect(m.cible).toBe("pane");
        expect(m.valeur).toBe(series.cvdSpot?.[m.idx]);
        expect(m.info).toMatch(/^Divergence spot\/perp \(5 bougies\)/);
      }
    });

    it("miroir : spot vend / perp achète → marqueurs triangleBas --down", () => {
      // Même fixture retournée (sell-only côté spot, donc delta négatif ; candlesAlt
      // ne peut pas la produire, il fige sell=0) : mêmes |deltas|, donc même stdev.
      const candles = Array.from({ length: 60 }, (_v, i) => c(0, i % 2 === 0 ? 1 : 2));
      const perpDelta = perpAlt(60, 1, 2);
      const { series, annotations } = cvdSpotPerp.calc(
        candles,
        { fenetre: 100, lissage: 3, fenetreDiv: 5 },
        { ...baseCtx, aux: { perpDelta } }
      );
      const marqueurs = annotations?.marqueurs ?? [];
      expect(marqueurs.length).toBeGreaterThan(0);
      for (const m of marqueurs) {
        expect(m.forme).toBe("triangleBas");
        expect(m.couleur).toBe("--down");
        expect(m.cible).toBe("pane");
        expect(m.valeur).toBe(series.cvdSpot?.[m.idx]);
      }
      // Le signe négatif n'est pas préfixé par le formateur (branche v <= 0).
      expect(marqueurs[0]?.info).toContain("Δspot -");
    });

    it("même direction (spot et perp achètent) → aucune annotation", () => {
      const candles = candlesAlt(60, 1, 2);
      const perpDelta = perpAlt(60, 1, 2);
      const { annotations } = cvdSpotPerp.calc(
        candles,
        { fenetre: 100, lissage: 3, fenetreDiv: 5 },
        { ...baseCtx, aux: { perpDelta } }
      );
      expect(annotations).toBeUndefined();
    });

    it("perp absent → aucune annotation", () => {
      const candles = candlesAlt(60, 1, 2);
      const { annotations } = cvdSpotPerp.calc(candles, { fenetreDiv: 5 }, baseCtx);
      expect(annotations).toBeUndefined();
    });
  });

  it("métadonnées conformes à la spec", () => {
    expect(cvdSpotPerp.id).toBe("cvdSpotPerp");
    expect(cvdSpotPerp.category).toBe("strategy");
    expect(cvdSpotPerp.pane).toBe("separate");
    expect(cvdSpotPerp.aux).toEqual(["perpDelta"]);
    expect(cvdSpotPerp.precision).toBe(2);
    expect(cvdSpotPerp.inputs).toEqual([
      { key: "fenetre", name: expect.any(String), type: "number", default: 100, min: 20, max: 500 },
      { key: "lissage", name: expect.any(String), type: "number", default: 3, min: 1, max: 50 },
      { key: "fenetreDiv", name: expect.any(String), type: "number", default: 14, min: 2, max: 100 },
    ]);
    expect(cvdSpotPerp.outputs.map((o) => o.key)).toEqual(["cvdSpot", "cvdPerp", "divergence"]);
    expect(cvdSpotPerp.outputs.map((o) => o.style)).toEqual(["line", "line", "histogram"]);
  });
});
