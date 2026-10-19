/**
 * @axiom/indicators — strategy/stratAxisSr.test.ts
 *
 * Tests dédiés à `stratAxisSr` (« AXIS S/R ») : variante d'AXIS dotée de la
 * détection causale et de la projection des futures zones de support et de
 * résistance (`zonesSrAxis`), des sorties masquées `support` et `resistance`,
 * et du filtre d'entrée `margeResistanceAtr`, tandis que `stratAxis` (« AXIS »)
 * demeure strictement inchangée (sans zones S/R).
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { getIndicator } from "../registry";
import { supportsIndicatorTimeframe, TIMEFRAME_REQUIS } from "../timeframes";
import { rma, trueRange } from "../utils";
import { etatsStrategie, specStrategie } from "../utils-fabrique-strategie";
import fixtureRaw from "../golden/fixture-ohlcv.json";
import { AMORCE_AXIS, ATR_STOP_PERIODE, REGIME_TESTE, fluxAxis, stratAxis } from "./stratAxis";
import {
  MAX_POOL_ZONES_AXIS,
  MAX_ZONES_SR_DEFAUT,
  PIVOT_SR_DEFAUT,
  ZONE_SR_ATR_DEFAUT,
  positionAxisSr,
  stratAxisSr,
  textesAxisSr,
  zonesSrAxis,
} from "./stratAxisSr";

const candles = fixtureRaw as Candle[];
const EMA50 = { emaTendance: 50 };

function resume(candlesEntree: Candle[], params: Record<string, number | boolean> = {}): string {
  const res = computeIndicator(stratAxisSr, candlesEntree, params);
  return (res.annotations?.marqueurs ?? [])
    .filter((m) => m.couleur !== "--accent")
    .map((m) => `${m.idx}${m.forme === "triangleHaut" ? "▲" : "▼"}`)
    .join(" ");
}

describe("stratAxisSr — contrat et séparation d'avec stratAxis", () => {
  it("enregistrée sous stratAxisSr (« AXIS S/R »), 21 inputs, 6 sorties dont 4 masquées, tandis que stratAxis reste à 17 inputs et 4 sorties", () => {
    expect(getIndicator("stratAxisSr")).toBe(stratAxisSr);
    expect(stratAxisSr.name).toBe("AXIS S/R");
    expect(stratAxisSr.category).toBe("strategy");
    expect(stratAxisSr.pane).toBe("overlay");
    expect(stratAxisSr.amorceBougies).toBe(AMORCE_AXIS);
    expect(stratAxisSr.auxFacultatives).toEqual(["oi", "refClose"]);
    expect(stratAxisSr.minTimeframe).toBeUndefined();
    expect(TIMEFRAME_REQUIS.stratAxisSr).toBeUndefined();
    expect(supportsIndicatorTimeframe("stratAxisSr", "4h")).toBe(true);
    expect(specStrategie("stratAxisSr")?.position).toBe(positionAxisSr);

    // stratAxis reste la version sans S/R (17 inputs, 4 sorties).
    expect(stratAxis.inputs).toHaveLength(17);
    expect(stratAxis.outputs).toHaveLength(4);
    expect(stratAxisSr.inputs).toHaveLength(21);
    expect(stratAxisSr.inputs.slice(-4)).toEqual([
      { key: "pivotSr", name: "Pivots S/R (bougies gauche/droite)", type: "number", default: PIVOT_SR_DEFAUT, min: 2, max: 50 },
      { key: "zoneSrAtr", name: "Largeur de zone S/R (× ATR 14)", type: "number", default: ZONE_SR_ATR_DEFAUT, min: 0.1, max: 5 },
      { key: "maxZonesSr", name: "Zones S/R futures tracées (0 = sans)", type: "number", default: MAX_ZONES_SR_DEFAUT, min: 0, max: 12 },
      { key: "margeResistanceAtr", name: "Marge sous résistance à l'entrée (× ATR 14, 0 = sans)", type: "number", default: 0, min: 0, max: 10 },
    ]);
    expect(stratAxisSr.outputs).toEqual([
      { key: "prixSignal", name: "Prix d'achat", style: "line" },
      { key: "stop", name: "Stop suiveur", style: "line" },
      { key: "etat", name: "État (1 acheté, 0 à plat)", style: "line", masquee: true },
      { key: "score", name: "Score (−6 à +6)", style: "line", masquee: true },
      { key: "support", name: "Support actif proche", style: "line", masquee: true },
      { key: "resistance", name: "Résistance active proche", style: "line", masquee: true },
    ]);
    expect(PIVOT_SR_DEFAUT).toBe(5);
    expect(ZONE_SR_ATR_DEFAUT).toBe(0.5);
    expect(MAX_ZONES_SR_DEFAUT).toBe(4);
    expect(MAX_POOL_ZONES_AXIS).toBe(24);
  });

  it("aux défauts (margeResistanceAtr 0), stratAxisSr produit exactement les mêmes signaux, labels et séries du cœur que stratAxis, les zones S/R en plus", () => {
    const sansSr = computeIndicator(stratAxis, candles, EMA50);
    const avecSr = computeIndicator(stratAxisSr, candles, EMA50);
    expect(avecSr.series.prixSignal).toEqual(sansSr.series.prixSignal);
    expect(avecSr.series.stop).toEqual(sansSr.series.stop);
    expect(avecSr.series.etat).toEqual(sansSr.series.etat);
    expect(avecSr.series.score).toEqual(sansSr.series.score);
    expect(avecSr.annotations?.marqueurs).toEqual(sansSr.annotations?.marqueurs);
    expect(avecSr.annotations?.labels).toEqual(sansSr.annotations?.labels);
    expect(sansSr.annotations?.rubans).toBeUndefined();
    expect(sansSr.annotations?.segments).toBeUndefined();
    expect(avecSr.annotations?.rubans).toHaveLength(MAX_ZONES_SR_DEFAUT);
    expect(avecSr.annotations?.segments).toHaveLength(MAX_ZONES_SR_DEFAUT);
  });
});

describe("zonesSrAxis et filtre margeResistanceAtr", () => {
  const atr = rma(trueRange(candles), ATR_STOP_PERIODE);
  const flux = fluxAxis(candles, undefined, 20, 6);

  it("zonesSrAxis : confirmation causale à p + g, fusion des touches, rejets sur volume fort, inversion de polarité S↔R", () => {
    const base: Candle[] = Array.from({ length: 22 }, (_v, i) => ({
      time: i * 3_600_000,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 10,
    }));
    base[5] = { ...base[5]!, high: 110, close: 105 };
    base[12] = { ...base[12]!, high: 110.2, close: 105, volume: 80 };
    base[17] = { ...base[17]!, open: 115, high: 121, low: 114, close: 120 };
    base[18] = { ...base[18]!, open: 119, high: 120, low: 118, close: 119 };
    base[19] = { ...base[19]!, open: 119, high: 120, low: 118, close: 119 };
    base[20] = { ...base[20]!, open: 119, high: 120, low: 118, close: 119 };

    const fBase = fluxAxis(base, undefined, 5, 6);
    const atrBase = rma(trueRange(base), 3);
    expect(zonesSrAxis(base, fBase, atrBase, 3, 0.5, 1.5, 4, 7).zones).toEqual([]);
    const z8 = zonesSrAxis(base, fBase, atrBase, 3, 0.5, 1.5, 4, 8).zones;
    expect(z8).toHaveLength(1);
    expect(z8[0]).toMatchObject({ nature: "resistance", deIdx: 5, confirmationIdx: 8, touches: 1, inversions: 0 });
    const z15 = zonesSrAxis(base, fBase, atrBase, 3, 0.5, 1.5, 4, 15).zones;
    expect(z15[0]).toMatchObject({ nature: "resistance", deIdx: 5, touches: 2, rejetsVolume: 1, inversions: 0 });
    expect(z15[0]!.niveau).toBeCloseTo(110.1, 4);
    const z20 = zonesSrAxis(base, fBase, atrBase, 3, 0.5, 1.5, 4, 20);
    const inv = z20.zones.find((z) => z.deIdx === 5);
    expect(inv).toMatchObject({ nature: "support", touches: 2, rejetsVolume: 1, inversions: 1 });
    expect(z20.support[20]).toBeCloseTo(110.1, 4);
  });

  it("fixture dorée : support ≤ close < resistance partout où définis, projetés en rubans et segments jusqu'au bord droit", () => {
    const res = computeIndicator(stratAxisSr, candles, EMA50);
    const sup = res.series.support ?? [];
    const resist = res.series.resistance ?? [];
    expect(sup).toHaveLength(candles.length);
    expect(resist).toHaveLength(candles.length);
    for (let i = 0; i < candles.length - 1; i++) {
      const c = candles[i]!.close;
      if (sup[i] !== undefined) expect(sup[i]!).toBeLessThanOrEqual(c);
      if (resist[i] !== undefined) expect(resist[i]!).toBeGreaterThan(c);
      if (sup[i] !== undefined && resist[i] !== undefined) expect(sup[i]!).toBeLessThan(resist[i]!);
    }
    expect(sup[candles.length - 1]).toBe(sup[candles.length - 2]);
    expect(resist[candles.length - 1]).toBe(resist[candles.length - 2]);

    const rubans = res.annotations?.rubans ?? [];
    const segments = res.annotations?.segments ?? [];
    expect(rubans).toHaveLength(MAX_ZONES_SR_DEFAUT);
    expect(segments).toHaveLength(MAX_ZONES_SR_DEFAUT);
    expect(rubans.filter((r) => r.couleur === "--up")).toHaveLength(2);
    expect(rubans.filter((r) => r.couleur === "--down")).toHaveLength(2);
    for (let k = 0; k < rubans.length; k++) {
      const r = rubans[k]!;
      const s = segments[k]!;
      expect(r.deIdx + r.hauts.length - 1).toBe(candles.length - 1);
      expect(s.deIdx).toBe(r.deIdx);
      expect(s.aIdx).toBe(candles.length - 1);
      expect(s.trait).toBe("pointille");
      expect(s.cible).toBe("prix");
      expect(r.info).toMatch(/^AXIS zone de (support|résistance) future \[/);
    }
    const sansTrace = computeIndicator(stratAxisSr, candles, { ...EMA50, maxZonesSr: 0 });
    expect(sansTrace.annotations?.rubans).toBeUndefined();
    expect(sansTrace.annotations?.segments).toBeUndefined();
    expect(sansTrace.series.support).toEqual(sup);
    expect(sansTrace.series.resistance).toEqual(resist);
  });

  it("margeResistanceAtr : 0 = équivalence exacte ; > 0 retarde les achats sous résistance proche et nomme la marge en ATR", () => {
    const base = computeIndicator(stratAxisSr, candles, EMA50);
    const explicite0 = computeIndicator(stratAxisSr, candles, { ...EMA50, margeResistanceAtr: 0 });
    expect(JSON.stringify(explicite0)).toBe(JSON.stringify(base));

    const sr = zonesSrAxis(candles, flux, atr);
    expect((sr.resistanceBas[107]! - candles[107]!.close) / atr[107]!).toBeCloseTo(0.265, 2);
    expect((sr.resistanceBas[60]! - candles[60]!.close) / atr[60]!).toBeCloseTo(0.661, 2);
    expect((sr.resistanceBas[280]! - candles[280]!.close) / atr[280]!).toBeCloseTo(5.766, 2);
    expect(resume(candles, { ...EMA50, margeResistanceAtr: 0.5 })).toBe("60▲ 88▼ 108▲ 139▼ 280▲");
    expect(resume(candles, { ...EMA50, margeResistanceAtr: 1 })).toBe("72▲ 88▼ 126▲ 139▼ 280▲");

    const r05 = computeIndicator(stratAxisSr, candles, { ...EMA50, margeResistanceAtr: 0.5 });
    const achat60 = r05.annotations?.marqueurs?.find((m) => m.idx === 60);
    expect(achat60?.info).toContain(", résistance 61390.46 à 0.7 × ATR ≥ 0.5");
    expect(achat60?.info).toContain(" ; filtre S/R (marge sous résistance ≥ 0.5 × ATR 14) : réglage hors des tests figés — non mesuré");
    expect(textesAxisSr("4h", 0, 0, REGIME_TESTE, 0.5).signaux.endsWith(" ; filtre S/R (marge sous résistance ≥ 0.5 × ATR 14) : réglage hors des tests figés — non mesuré")).toBe(true);
    expect(etatsStrategie("stratAxisSr", candles, { ...EMA50, margeResistanceAtr: 0.5 })).toEqual(r05.series.etat);
  });

  it("causalité stricte : un préfixe ou un futur altéré ne change jamais support, resistance ni etat", () => {
    const params = { ...EMA50, margeResistanceAtr: 0.5 };
    const complet = computeIndicator(stratAxisSr, candles, params);
    for (const k of [60, 108, 139, 240, 280]) {
      const prefixe = computeIndicator(stratAxisSr, candles.slice(0, k + 1), params);
      expect(prefixe.series.support?.slice(0, k), `support préfixe ${k}`).toEqual(complet.series.support?.slice(0, k));
      expect(prefixe.series.resistance?.slice(0, k), `resistance préfixe ${k}`).toEqual(complet.series.resistance?.slice(0, k));
      expect(prefixe.series.etat?.slice(0, k), `etat préfixe ${k}`).toEqual(complet.series.etat?.slice(0, k));
      const alterees = candles.map((c, i) => (i <= k ? c : { ...c, high: 1e12 + i, low: 1, close: 1e12 - i, volume: 1e12 }));
      const futur = computeIndicator(stratAxisSr, alterees, params);
      expect(futur.series.support?.slice(0, k + 1), `support futur ${k}`).toEqual(complet.series.support?.slice(0, k + 1));
      expect(futur.series.resistance?.slice(0, k + 1), `resistance futur ${k}`).toEqual(complet.series.resistance?.slice(0, k + 1));
      expect(futur.series.etat?.slice(0, k + 1), `etat futur ${k}`).toEqual(complet.series.etat?.slice(0, k + 1));
    }
  });
});
