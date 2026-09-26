/**
 * @axiom/indicators — derivatives/stablecoinPrint.test.ts
 *
 * Impression de stablecoins : variation nette QUOTIDIENNE du stock circulant valorisé en USD
 * (ctx.aux.stablecoins, DefiLlama). Unité 1d uniquement ; une valeur reportée à l'identique
 * n'est pas une nouvelle observation (jamais de 0 inventé) ; le jour en cours, partiel, est
 * isolé et exclu de la moyenne.
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { stablecoinPrint } from "./stablecoinPrint";
import { supportsIndicatorTimeframe } from "../timeframes";

const JOUR = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);
const baseCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };
const jours = (n: number, enCours = false): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: T0 + i * JOUR, open: 1, high: 1, low: 1, close: 1, volume: 1, ...(enCours && i === n - 1 ? { closed: false } : {}) }));

describe("stablecoinPrint (impression de stablecoins, Δ offre / jour)", () => {
  it("hausse nette en --up, baisse nette en --down, première bougie sans référence, moyenne glissante", () => {
    const stablecoins = [300e9, 301.5e9, 301e9, 302e9];
    const r = stablecoinPrint.calc(jours(4), { lissage: 2 }, { ...baseCtx, aux: { stablecoins } });
    expect(r.series.hausse).toEqual([undefined, 1.5e9, undefined, 1e9]);
    expect(r.series.baisse).toEqual([undefined, undefined, -0.5e9, undefined]);
    expect(r.series.moyenne).toEqual([undefined, undefined, 0.5e9, 0.25e9]);
  });

  it("valeur reportée à l'identique (jour non publié) : aucune barre, pas un 0 ; le jour suivant est ramené par jour", () => {
    const stablecoins = [300e9, 301e9, 301e9, 303e9];
    const r = stablecoinPrint.calc(jours(4), { lissage: 2 }, { ...baseCtx, aux: { stablecoins } });
    expect(r.series.hausse).toEqual([undefined, 1e9, undefined, 1e9]);
    expect(r.series.baisse).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("jour en cours (bougie non clôturée) : barre « partiel » à part, hors hausse/baisse et hors moyenne", () => {
    const stablecoins = [300e9, 301e9, 302e9, 301.3e9];
    const r = stablecoinPrint.calc(jours(4, true), { lissage: 2 }, { ...baseCtx, aux: { stablecoins } });
    expect(r.series.partiel).toEqual([undefined, undefined, undefined, -0.7e9]);
    expect(r.series.baisse?.[3]).toBeUndefined();
    expect(r.series.moyenne?.[3]).toBe(1e9); // moyenne des jours clos (1 et 1), reportée
  });

  it("libellés : variation de l'offre, jamais « émission » (règle mint/burn du contrat)", () => {
    const noms = stablecoinPrint.outputs.map((o) => o.name).join(" ");
    expect(noms).toContain("Hausse nette de l'offre");
    expect(noms).toContain("Baisse nette de l'offre");
    expect(noms).not.toMatch(/mission|ontraction|mint|burn/i);
    expect(stablecoinPrint.name).toBe("Impression de stablecoins (Δ offre / jour)");
  });

  it("unité 1d seulement : l'alignement quotidien ne sait ni l'intrajournalier (anticipation) ni la semaine (période précédente)", () => {
    expect(stablecoinPrint.minTimeframe).toBe("1d");
    expect(supportsIndicatorTimeframe("stablecoinPrint", "1d")).toBe(true);
    for (const tf of ["1h", "4h", "3d", "1w", "1M"] as const) expect(supportsIndicatorTimeframe("stablecoinPrint", tf), tf).toBe(false);
    // La série auxiliaire couvre 90 jours : une moyenne plus longue ne s'afficherait jamais.
    expect(stablecoinPrint.inputs[0]).toMatchObject({ key: "lissage", max: 60 });
  });

  it("aux absent → séries vides, jamais de throw ; métadonnées", () => {
    const r = stablecoinPrint.calc(jours(3), {}, baseCtx);
    expect(r.series.hausse).toEqual([undefined, undefined, undefined]);
    expect(stablecoinPrint).toMatchObject({ id: "stablecoinPrint", category: "derivatives", pane: "separate", aux: ["stablecoins"] });
  });
});
