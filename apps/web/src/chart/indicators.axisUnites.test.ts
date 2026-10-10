/**
 * Infobulles d'AXIS par unité de temps (test du 8 octobre 2026 sur les autres
 * unités, scripts/axis/rapport-ut-2026-10-08.md). Le chart transmet son unité
 * (`computeIndicator(…, timeframe)` → `ctx.timeframe`) ; pour chaque unité du
 * résultat, les textes affichés doivent être, au caractère près, ceux que le
 * runner a choisis selon les verdicts (scripts/axis/resultat-ut-2026-10-08.json,
 * champ `formulations`). 4h et unité absente (alertes, screener) gardent les
 * formulations des tests 4h.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Candle, IndicatorDef, Timeframe } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";

interface Formulations { signaux: string; fortAchat: string; forteVente: string; qualification: string }
const brut = readFileSync(new URL("../../../../scripts/axis/resultat-ut-2026-10-08.json", import.meta.url), "utf8");
const resultat = JSON.parse(brut) as {
  essai: boolean;
  unites: Array<{ unite: Timeframe }>;
  formulations: Record<string, Formulations>;
};
const axis = getIndicator("stratAxis") as IndicatorDef;
// Mention du défaut regimeBtc = 100 (verdict FAVORABLE du 10 octobre 2026) : mesurée en 4h,
// « non mesuré en {u} » ailleurs. Texte du résultat figé, comme le test croisé axisRegime.
const v5 = JSON.parse(readFileSync(new URL("../../../../scripts/axis/resultat-v5-2026-10-10.json", import.meta.url), "utf8")) as {
  formulations: { infobulle4hRegime100: string; texteBase: string };
};
const REGIME_4H = v5.formulations.infobulle4hRegime100.slice(v5.formulations.texteBase.length);
const REGIME = (unite: string): string =>
  unite === "4h" ? REGIME_4H : ` ; garde-fou de régime BTC (référence > EMA 100) non mesuré en ${unite}`;

// Fixture dorée partagée (300 bougies) : avec une EMA de tendance 50, achat à 60 et vente à 88
// (packages/indicators/src/strategy/stratAxis.test.ts).
const fixture = JSON.parse(
  readFileSync(new URL("../../../../packages/indicators/src/golden/fixture-ohlcv.json", import.meta.url), "utf8")
) as Candle[];
// Série déclinante, pic de volume ×50 toutes les 5 bougies : fort achat à delta taker en 300,
// forte vente à delta taker en 305, pics sans delta taker ailleurs.
const pics: Candle[] = Array.from({ length: 500 }, (_v, i) => {
  const c = 1000 - i * 0.5 + (i % 3) * 0.1;
  const taker = i === 300 ? { buyVolume: 40, sellVolume: 10 } : i === 305 ? { buyVolume: 10, sellVolume: 40 } : {};
  return { time: i * 3_600_000, open: c + 0.2, high: c + 1, low: c - 1, close: c, volume: i % 5 === 0 ? 50 : 1, ...taker };
});
const RESERVE_FILTRE = "filtre flux actif : signaux hors du test du 7 octobre 2026, non mesurés — jamais une promesse";

function infobulles(timeframe: Timeframe | undefined, params: Record<string, number | boolean> = {}) {
  const signaux = computeIndicator(axis, fixture, { emaTendance: 50, ...params }, undefined, timeframe).annotations?.marqueurs ?? [];
  const gros = computeIndicator(axis, pics, {}, undefined, timeframe).annotations?.marqueurs ?? [];
  const info = (liste: typeof gros, idx: number): string => liste.find((m) => m.idx === idx)?.info ?? "";
  return { achat: info(signaux, 60), vente: info(signaux, 88), fortAchat: info(gros, 300), forteVente: info(gros, 305), sansTaker: info(gros, 310) };
}
/** Fin de `texte` sur la longueur de `fin` : un écart s'affiche en entier dans le diff. */
const fin = (texte: string, attendu: string): string => texte.slice(-attendu.length);

describe("AXIS — infobulles par unité de temps", () => {
  it("résultat de la campagne : fichier figé, treize unités mesurées, quatre non mesurables", () => {
    // Empreinte consignée au journal de revue ; une conversion git des fins de ligne
    // (core.autocrlf) ne doit pas la casser.
    expect(createHash("sha256").update(brut.replace(/\r\n/g, "\n")).digest("hex")).toBe(
      "77b755815e1521ebd6137d1361bc0ccac98b089ae26570519513b7cc926058ec"
    );
    expect(resultat.essai).toBe(false);
    expect(resultat.unites.map((u) => u.unite)).toEqual(["1s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "6h", "12h", "1d", "3d", "1w"]);
    expect(Object.keys(resultat.formulations)).toEqual([...resultat.unites.map((u) => u.unite), "1M", "3M", "6M", "12M"]);
  });

  it.each(Object.entries(resultat.formulations))("%s : textes du runner au caractère près", (unite, f) => {
    const t = infobulles(unite as Timeframe);
    const signal = ` ; ${f.qualification}) — ${f.signaux}${REGIME(unite as string)}`;
    expect(fin(t.achat, signal)).toBe(signal);
    expect(fin(t.vente, signal)).toBe(signal);
    expect(fin(t.fortAchat, ` — ${f.fortAchat}`)).toBe(` — ${f.fortAchat}`);
    expect(fin(t.forteVente, ` — ${f.forteVente}`)).toBe(` — ${f.forteVente}`);
    // Sans delta taker, la population n'est pas celle des tests : garde inchangée.
    expect(fin(t.sansTaker, " — couche flux non mesurée")).toBe(" — couche flux non mesurée");
    // Le filtre flux est hors des tests dans toutes les unités.
    expect(fin(infobulles(unite as Timeframe, { filtreFlux: true }).vente, ` — ${RESERVE_FILTRE}${REGIME(unite as string)}`)).toBe(` — ${RESERVE_FILTRE}${REGIME(unite as string)}`);
  });

  it("4h et unité absente : formulations des tests 4h, inchangées", () => {
    const sans = infobulles(undefined);
    expect(infobulles("4h")).toEqual(sans);
    expect(sans.achat.endsWith(
      "(données jamais vues, 8 octobre 2026)) — test réussi sur données jamais vues (crypto 4h, 2017-2024), pas mieux qu'une EMA 200 seule sur 3/4 actifs — mesure passée, pas une promesse" +
        REGIME_4H
    )).toBe(true);
    expect(sans.fortAchat.endsWith(
      "(BNB/ADA/LINK/DOGE 4h, 2017-2026), +1.61 % en moyenne sur les 12 bougies suivantes (51 % de hausses, p ≤ 0.0005) — mesure passée, pas une promesse"
    )).toBe(true);
  });

  it.each(["5s", "15s"] as const)("%s (aucune source câblée) : « non mesuré » générique", (unite) => {
    const t = infobulles(unite);
    const signal = ` ; qualification descriptive, non mesurée en ${unite}) — en ${unite} : non mesuré — lecture indicative, jamais une promesse${REGIME(unite)}`;
    expect(fin(t.achat, signal)).toBe(signal);
    expect(fin(t.fortAchat, ` — couche flux non mesurée en ${unite}`)).toBe(` — couche flux non mesurée en ${unite}`);
    expect(fin(t.forteVente, ` — couche flux non mesurée en ${unite}`)).toBe(` — couche flux non mesurée en ${unite}`);
  });
});
