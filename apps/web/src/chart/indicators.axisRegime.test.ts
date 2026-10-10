/**
 * Infobulles d'AXIS avec le garde-fou de régime BTC (test du 10 octobre 2026 sur
 * 139 paires USDT spot KuCoin jamais vues, cotées 2019-2024, 4h, suivies jusqu'au
 * 2026-10-10, scripts/axis/rapport-v5-2026-10-10.md : verdict FAVORABLE). Suites
 * pré-déclarées du manifeste v5 appliquées : le défaut du chart est devenu
 * regimeBtc = 100 (le réglage mesuré) — en 4h et sans unité, l'infobulle ajoute
 * la mesure ; dans les autres unités, « non mesuré en {u} » ; à regimeBtc = 0,
 * « sans garde-fou de régime (réglage) : signaux de la v2 testée » ; à tout autre
 * réglage > 0, « hors du test ». Les textes attendus sont lus dans le résultat de
 * la campagne (champ `formulations`), dont l'empreinte SHA-256 est épinglée ; les
 * textes de base par unité viennent du résultat figé du test des unités ; la
 * mention du régime précède celle du filtre ADX, qui précède celle du stop.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Candle, IndicatorDef, Timeframe } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";

const brutV5 = readFileSync(new URL("../../../../scripts/axis/resultat-v5-2026-10-10.json", import.meta.url), "utf8");
const v5 = JSON.parse(brutV5) as {
  essai: boolean;
  mode: string;
  verdict: string;
  symboles: { total: number; disponibles: number };
  formulations: {
    infobulle4hRegime100: string;
    modeleGardeFouActif: string | null;
    modeleAutreUnite: string | null;
    reglageHorsTest: string;
    sansGardeFou: string;
    texteBase: string;
    k: number;
    placeholders: Record<string, string>;
  };
};
const v4 = JSON.parse(readFileSync(new URL("../../../../scripts/axis/resultat-v4-2026-10-09.json", import.meta.url), "utf8")) as {
  formulations: { infobulle4hAdx25: string; modeleFiltreActif: string | null; texteBase: string };
};
const v3 = JSON.parse(readFileSync(new URL("../../../../scripts/axis/resultat-v3-2026-10-08.json", import.meta.url), "utf8")) as {
  formulations: { infobulle4hStop3: string; texteBase: string };
};
const ut = JSON.parse(readFileSync(new URL("../../../../scripts/axis/resultat-ut-2026-10-08.json", import.meta.url), "utf8")) as {
  formulations: Record<string, { signaux: string }>;
};
const axis = getIndicator("stratAxis") as IndicatorDef;

// Fixture dorée partagée (300 bougies, EMA de tendance 50 : achats à 60, 107 et 280 — stratAxis.test.ts).
const fixture = JSON.parse(
  readFileSync(new URL("../../../../packages/indicators/src/golden/fixture-ohlcv.json", import.meta.url), "utf8")
) as Candle[];
const marqueurs = (timeframe: Timeframe | undefined, params: Record<string, number>, aux?: { refClose: Array<number | undefined> }) =>
  (computeIndicator(axis, fixture, { emaTendance: 50, ...params }, aux, timeframe).annotations?.marqueurs ?? []).filter(
    (m) => m.couleur !== "--accent"
  );
const infos = (timeframe: Timeframe | undefined, regimeBtc: number, stopAtr = 0, adxEntree = 0) =>
  marqueurs(timeframe, { regimeBtc, stopAtr, adxEntree }).map((m) => m.info ?? "");

/** Gabarit du résultat rempli : {texteBase} par le texte de l'unité, {k} par le réglage. */
const remplir = (modele: string, texteBase: string, k: number): string =>
  modele.replace("{texteBase}", texteBase).replace("{k}", String(k));
const signauxBase = (u: string): string => (u === "4h" ? v5.formulations.texteBase : ut.formulations[u]!.signaux);

describe("AXIS — infobulles du garde-fou de régime BTC (test v5, FAVORABLE)", () => {
  it("résultat de la campagne : fichier figé, campagne réelle, 141 cellules dont 139 disponibles, verdict FAVORABLE", () => {
    expect(createHash("sha256").update(brutV5.replace(/\r\n/g, "\n")).digest("hex")).toBe(
      "321c84d1583d0fed321ff48d6d04b3d38ae567c9b8c8a25f80c1019deb9a8bcc"
    );
    expect(v5.essai).toBe(false);
    expect(v5.mode).toBe("--campagne");
    expect(v5.verdict).toBe("FAVORABLE");
    expect(v5.symboles).toMatchObject({ total: 141, disponibles: 139 });
    expect(v5.formulations.k).toBe(100);
    expect(v5.formulations.texteBase).toBe(v4.formulations.texteBase);
    // FAVORABLE : le modèle « autre unité » existe, le modèle d'échec non.
    expect(v5.formulations.modeleGardeFouActif).toBeNull();
    expect(v5.formulations.modeleAutreUnite).toBe("{texteUnite} ; garde-fou de régime BTC (référence > EMA 100) non mesuré en {u}");
  });

  it("4h et unité absente, regimeBtc 100 (le défaut) : la mesure FAVORABLE du résultat, au caractère près", () => {
    const attendu = v5.formulations.infobulle4hRegime100;
    expect(attendu.startsWith(`${v5.formulations.texteBase} ; garde-fou de régime BTC (référence > EMA 100) : sur données jamais vues (139 paires USDT KuCoin 4h cotées 2019-2024`)).toBe(true);
    for (const u of ["4h", undefined] as const) {
      const textes = infos(u, 100);
      expect(textes.length).toBeGreaterThan(0);
      for (const info of textes) expect(info.endsWith(` — ${attendu}`)).toBe(true);
      // Réglage omis = défaut du chart = 100.
      expect(marqueurs(u, {}).map((m) => m.info)).toEqual(textes);
    }
  });

  it.each(["1h", "2h", "1d", "1w"] as const)("%s, regimeBtc 100 : texte de l'unité + « non mesuré en {u} » (modèle du résultat)", (u) => {
    const attendu = v5.formulations.modeleAutreUnite!.replace("{texteUnite}", signauxBase(u)).replace("{u}", u);
    expect(attendu).toBe(`${signauxBase(u)} ; garde-fou de régime BTC (référence > EMA 100) non mesuré en ${u}`);
    for (const info of infos(u, 100)) expect(info.endsWith(` — ${attendu}`)).toBe(true);
  });

  it("1M (non mesurable), regimeBtc 100 : même mention après le « non mesuré » de l'unité", () => {
    expect(signauxBase("1M")).toContain("non mesuré (historique trop court");
    const fin = `${signauxBase("1M")} ; garde-fou de régime BTC (référence > EMA 100) non mesuré en 1M`;
    for (const info of infos("1M", 100)) expect(info.endsWith(` — ${fin}`)).toBe(true);
  });

  it("regimeBtc 0 : « sans garde-fou de régime (réglage) : signaux de la v2 testée », et positions de la v2", () => {
    const attendu = v5.formulations.sansGardeFou;
    expect(attendu).toBe(`${v5.formulations.texteBase} ; sans garde-fou de régime (réglage) : signaux de la v2 testée`);
    for (const info of infos(undefined, 0)) expect(info.endsWith(` — ${attendu}`)).toBe(true);
    // Avec référence ou sans, à 0 : positions identiques (la v2 exacte).
    const ref = fixture.map((_c, i) => 1000 + i * 3);
    const pSans = computeIndicator(axis, fixture, { emaTendance: 50, regimeBtc: 0 }).series.etat;
    const pAvec = computeIndicator(axis, fixture, { emaTendance: 50, regimeBtc: 0 }, { refClose: ref }).series.etat;
    expect(pAvec).toEqual(pSans);
  });

  it("autre période (50) : « réglage hors du test », chiffres du résultat", () => {
    const attendu = remplir(v5.formulations.reglageHorsTest, v5.formulations.texteBase, 50);
    expect(attendu).toContain("garde-fou de régime (référence > EMA 50) : réglage hors du test du 10 octobre 2026 (EMA 100 mesurée)");
    for (const info of infos(undefined, 50)) expect(info.endsWith(` — ${attendu}`)).toBe(true);
  });

  it("régime 100 + filtre ADX 25 + stop 3 : l'ordre des mentions est régime, puis ADX, puis stop", () => {
    const attendu =
      v5.formulations.infobulle4hRegime100 +
      v4.formulations.infobulle4hAdx25!.slice(v4.formulations.texteBase.length) +
      v3.formulations.infobulle4hStop3.slice(v3.formulations.texteBase.length);
    expect(attendu.indexOf("garde-fou de régime")).toBeLessThan(attendu.indexOf("filtre ADX"));
    expect(attendu.indexOf("filtre ADX")).toBeLessThan(attendu.indexOf("stop suiveur"));
    for (const info of marqueurs("4h", { regimeBtc: 100, adxEntree: 25, stopAtr: 3 }).map((m) => m.info ?? "")) {
      expect(info.endsWith(` — ${attendu}`)).toBe(true);
    }
  });

  it("achat : référence servie → « référence X > EMA 100 Y » ; absente → « non appliqué », positions de la v2", () => {
    const refCroissante = fixture.map((_c, i) => 1000 + i * 10);
    const avec = marqueurs(undefined, { regimeBtc: 100 }, { refClose: refCroissante });
    const achatAvec = avec.find((m) => m.info?.startsWith("AXIS achat") && /, référence [0-9]/.test(m.info ?? ""));
    expect(achatAvec?.info).toContain("référence ");
    expect(achatAvec?.info).toContain("> EMA 100 ");
    const sans = marqueurs(undefined, { regimeBtc: 100 });
    for (const m of sans.filter((x) => x.info?.startsWith("AXIS achat"))) {
      expect(m.info).toContain("garde-fou de régime non appliqué (référence indisponible)");
    }
    // Positions à 100 sans aux = positions à 0 (référence indisponible → condition de la v2).
    const p100 = computeIndicator(axis, fixture, { emaTendance: 50, regimeBtc: 100 }).series.etat;
    const p0 = computeIndicator(axis, fixture, { emaTendance: 50, regimeBtc: 0 }).series.etat;
    expect(p100).toEqual(p0);
  });
});
