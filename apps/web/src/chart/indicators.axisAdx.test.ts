/**
 * Infobulles d'AXIS avec le filtre ADX à l'entrée (test du 9 octobre 2026 sur
 * 123 paires USDT jamais vues, cotées 2023-2025, 4h, suivies jusqu'en 2026,
 * scripts/axis/rapport-v4-2026-10-09.md : verdict DÉFAVORABLE). Suites
 * pré-déclarées du manifeste v4 appliquées : le défaut reste adxEntree = 0
 * (textes d'avant le test, au caractère près) ; à adxEntree = 25, l'infobulle
 * ajoute l'échec chiffré ; à tout autre réglage > 0, « hors du test ». Les
 * textes attendus sont lus dans le résultat de la campagne (champ
 * `formulations`), dont l'empreinte SHA-256 est épinglée ; les textes de base
 * par unité viennent du résultat figé du test des unités (voir
 * indicators.axisUnites.test.ts) ; la mention du stop (test v3) suit celle du
 * filtre (voir indicators.axisStop.test.ts).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Candle, IndicatorDef, Timeframe } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";

const brutV4 = readFileSync(new URL("../../../../scripts/axis/resultat-v4-2026-10-09.json", import.meta.url), "utf8");
const v4 = JSON.parse(brutV4) as {
  essai: boolean;
  mode: string;
  verdict: string;
  symboles: { total: number; disponibles: number };
  formulations: {
    infobulle4hAdx25: string;
    modeleFiltreActif: string | null;
    modeleAutreUnite: string | null;
    reglageHorsTest: string;
    sansFiltre: string;
    texteBase: string;
    k: number;
  };
};
const v3 = JSON.parse(readFileSync(new URL("../../../../scripts/axis/resultat-v3-2026-10-08.json", import.meta.url), "utf8")) as {
  formulations: { infobulle4hStop3: string; texteBase: string };
};
const ut = JSON.parse(readFileSync(new URL("../../../../scripts/axis/resultat-ut-2026-10-08.json", import.meta.url), "utf8")) as {
  formulations: Record<string, { signaux: string; qualification: string }>;
};
const axis = getIndicator("stratAxis") as IndicatorDef;

// Fixture dorée partagée (300 bougies, EMA de tendance 50 : achats à 60, 107 et 280 sans filtre ;
// avec adxEntree 25, les deux premiers achats attendent l'ADX : 73 et 112 — stratAxis.test.ts).
const fixture = JSON.parse(
  readFileSync(new URL("../../../../packages/indicators/src/golden/fixture-ohlcv.json", import.meta.url), "utf8")
) as Candle[];
const marqueurs = (timeframe: Timeframe | undefined, params: Record<string, number>) =>
  (computeIndicator(axis, fixture, { emaTendance: 50, regimeBtc: 0, ...params }, undefined, timeframe).annotations?.marqueurs ?? []).filter(
    (m) => m.couleur !== "--accent"
  );
const infos = (timeframe: Timeframe | undefined, adxEntree: number, stopAtr = 0) =>
  marqueurs(timeframe, { adxEntree, stopAtr }).map((m) => m.info ?? "");

/** Gabarit du résultat rempli : {texteBase} par le texte de l'unité, {k} par le réglage. */
const remplir = (modele: string, texteBase: string, k: number): string =>
  modele.replace("{texteBase}", texteBase).replace("{k}", String(k));
// Le 4h n'est pas une clé du test des unités (déjà testé) : sa base est le texteBase du résultat v4.
// À regimeBtc 0, la suite commune v5 ajoute « sans garde-fou » entre le texte de base et les suffixes v4/v3.
const SANS_REGIME = " ; sans garde-fou de régime (réglage) : signaux de la v2 testée";
const signauxBase = (u: string): string => (u === "4h" ? v4.formulations.texteBase : ut.formulations[u]!.signaux) + SANS_REGIME;

describe("AXIS — infobulles du filtre ADX à l'entrée (test v4, DÉFAVORABLE)", () => {
  it("résultat de la campagne : fichier figé, campagne réelle, 123 cellules, verdict DÉFAVORABLE", () => {
    expect(createHash("sha256").update(brutV4.replace(/\r\n/g, "\n")).digest("hex")).toBe(
      "251f020d10a90205ef9c7f963a808336124eb338bca1d455a4c1201a73e4a5db"
    );
    expect(v4.essai).toBe(false);
    expect(v4.mode).toBe("--campagne");
    expect(v4.verdict).toBe("DEFAVORABLE");
    expect(v4.symboles).toMatchObject({ total: 123, disponibles: 123 });
    expect(v4.formulations.k).toBe(25);
    // Même texte de base 4h que le test du stop : les deux suites s'enchaînent sur la même phrase.
    expect(v4.formulations.texteBase).toBe(v3.formulations.texteBase);
    // Le modèle d'infobulle FAVORABLE n'existe pas : le verdict ne l'a pas produit.
    expect(v4.formulations.modeleAutreUnite).toBeNull();
    expect(v4.formulations.modeleFiltreActif).toContain("{texteBase} ; filtre ADX 14 ≥ {k} à l'entrée actif : test du 9 octobre 2026 échoué");
  });

  it("4h et unité absente, adxEntree 25 : l'échec chiffré du résultat, au caractère près", () => {
    for (const u of ["4h", undefined] as const) {
      const attendu = `${v4.formulations.texteBase}${SANS_REGIME}${v4.formulations.infobulle4hAdx25.slice(v4.formulations.texteBase.length)}`;
      expect(attendu.startsWith(`${v4.formulations.texteBase}${SANS_REGIME} ; filtre ADX 14 ≥ 25 à l'entrée actif : `)).toBe(true);
      const textes = infos(u, 25);
      expect(textes.length).toBeGreaterThan(0);
      for (const info of textes) expect(info.endsWith(` — ${attendu}`)).toBe(true);
    }
  });

  it.each(["1h", "2h", "1d", "1w"] as const)("%s, adxEntree 25 : texte de l'unité + l'échec chiffré", (u) => {
    const attendu = remplir(v4.formulations.modeleFiltreActif!, signauxBase(u), 25);
    expect(attendu).toContain(signauxBase(u));
    for (const info of infos(u, 25)) expect(info.endsWith(` — ${attendu}`)).toBe(true);
  });

  it("1M (non mesurable), adxEntree 25 : même suffixe d'échec après le « non mesuré »", () => {
    const attendu = remplir(v4.formulations.modeleFiltreActif!, signauxBase("1M"), 25);
    expect(signauxBase("1M")).toContain("non mesuré (historique trop court");
    for (const info of infos("1M", 25)) expect(info.endsWith(` — ${attendu}`)).toBe(true);
  });

  it("adxEntree 0 (le défaut, conservé après le verdict) : textes et calcul identiques au caractère près", () => {
    for (const u of [undefined, "4h", "1h"] as const) {
      const avecZero = computeIndicator(axis, fixture, { emaTendance: 50, adxEntree: 0, regimeBtc: 0 }, undefined, u);
      const sans = computeIndicator(axis, fixture, { emaTendance: 50, regimeBtc: 0 }, undefined, u);
      expect(JSON.stringify(avecZero)).toBe(JSON.stringify(sans));
      // La formulation « sans filtre ADX (réglage) » n'existe qu'en cas de FAVORABLE (manifeste, suites.communes) :
      // DÉFAVORABLE ⇒ elle n'apparaît nulle part, et aucune infobulle ne nomme le filtre.
      for (const info of infos(u, 0)) {
        expect(info).not.toContain("sans filtre ADX (réglage)");
        expect(info).not.toContain("filtre ADX");
        // regimeBtc 0 = le réglage choisi : la suite commune le dit.
        expect(info).toContain("sans garde-fou de régime (réglage)");
      }
    }
    expect(axis.inputs.find((i) => i.key === "adxEntree")?.default).toBe(0);
  });

  it("autre seuil (30) : « réglage hors du test », chiffres du résultat", () => {
    const attendu = remplir(v4.formulations.reglageHorsTest, signauxBase("4h"), 30);
    expect(attendu).toContain("filtre ADX 14 ≥ 30 à l'entrée : réglage hors du test du 9 octobre 2026 (≥ 25 mesuré)");
    for (const info of infos(undefined, 30)) expect(info.endsWith(` — ${attendu}`)).toBe(true);
  });

  it("filtre 25 et stop 3 ensemble : la mention du filtre précède celle du stop (ordre des suites)", () => {
    const attendu = `${v4.formulations.texteBase}${SANS_REGIME}${v4.formulations.infobulle4hAdx25.slice(v4.formulations.texteBase.length)}${v3.formulations.infobulle4hStop3.slice(v3.formulations.texteBase.length)}`;
    expect(attendu).toContain("à l'entrée actif : test du 9 octobre 2026 échoué");
    expect(attendu).toContain(" ; stop suiveur 3 × ATR 14 actif : test du 8 octobre 2026 échoué");
    const textes = infos("4h", 25, 3);
    expect(textes.length).toBeGreaterThan(0);
    for (const info of textes) expect(info.endsWith(` — ${attendu}`)).toBe(true);
  });

  it("le filtre retarde les achats de la fixture (60 → 73, 107 → 112) et l'infobulle d'achat nomme l'ADX", () => {
    const sans = marqueurs("4h", {}).map((m) => m.idx);
    const avec = marqueurs("4h", { adxEntree: 25 }).map((m) => m.idx);
    expect(sans).toEqual([60, 88, 107, 139, 280]);
    expect(avec).toEqual([73, 88, 112, 139, 280]);
    const achat = marqueurs("4h", { adxEntree: 25 }).find((m) => m.idx === 73);
    expect(achat?.info).toContain("close au-dessus de l'EMA 50, ADX 14 25.2 ≥ 25");
    for (const m of marqueurs("4h", {})) expect(m.info).not.toContain("ADX 14");
  });
});
