/**
 * Infobulles d'AXIS avec le stop suiveur (test du 8 octobre 2026 sur 151 alts
 * jamais vues, 4h, 2023-2026, scripts/axis/rapport-v3-2026-10-08.md : verdict
 * DÉFAVORABLE). Suites pré-déclarées du manifeste v3 appliquées : le défaut
 * reste stopAtr = 0 (textes d'avant le test, au caractère près) ; à stopAtr = 3,
 * l'infobulle ajoute l'échec chiffré ; à tout autre réglage > 0, « hors du
 * test ». Les textes attendus sont lus dans le résultat de la campagne
 * (champ `formulations`), dont l'empreinte SHA-256 est épinglée ; les textes de
 * base par unité viennent du résultat figé du test des unités (voir
 * indicators.axisUnites.test.ts).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Candle, IndicatorDef, Timeframe } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";

const brutV3 = readFileSync(new URL("../../../../scripts/axis/resultat-v3-2026-10-08.json", import.meta.url), "utf8");
const v3 = JSON.parse(brutV3) as {
  essai: boolean;
  mode: string;
  verdict: string;
  formulations: {
    infobulle4hStop3: string;
    modeleStopActif: string | null;
    modeleAutreUnite: string | null;
    reglageHorsTest: string;
    sansStop: string;
    texteBase: string;
  };
};
const ut = JSON.parse(readFileSync(new URL("../../../../scripts/axis/resultat-ut-2026-10-08.json", import.meta.url), "utf8")) as {
  formulations: Record<string, { signaux: string; qualification: string }>;
};
const axis = getIndicator("stratAxis") as IndicatorDef;

// Fixture dorée partagée (300 bougies, EMA de tendance 50 : achat à 60, vente à 88 ;
// avec stopAtr 3, la seconde position sort par le stop à 137 — stratAxis.test.ts).
const fixture = JSON.parse(
  readFileSync(new URL("../../../../packages/indicators/src/golden/fixture-ohlcv.json", import.meta.url), "utf8")
) as Candle[];
const infos = (timeframe: Timeframe | undefined, stopAtr: number) =>
  (computeIndicator(axis, fixture, { emaTendance: 50, regimeBtc: 0, stopAtr }, undefined, timeframe).annotations?.marqueurs ?? []).map(
    (m) => m.info ?? ""
  );

/** Gabarit du résultat rempli : {texteBase} par le texte de l'unité, {k} par le réglage. */
const remplir = (modele: string, texteBase: string, k: number): string =>
  modele.replace("{texteBase}", texteBase).replace("{k}", String(k));
// Le 4h n'est pas une clé du test des unités (déjà testé) : sa base est le texteBase du résultat v3.
// À regimeBtc 0, la suite commune v5 ajoute « sans garde-fou » entre le texte de base et le suffixe v3.
const SANS_REGIME = " ; sans garde-fou de régime (réglage) : signaux de la v2 testée";
const signauxBase = (u: string): string => (u === "4h" ? v3.formulations.texteBase : ut.formulations[u]!.signaux) + SANS_REGIME;

describe("AXIS — infobulles du stop suiveur (test v3, DÉFAVORABLE)", () => {
  it("résultat de la campagne : fichier figé, campagne réelle, verdict DÉFAVORABLE", () => {
    expect(createHash("sha256").update(brutV3.replace(/\r\n/g, "\n")).digest("hex")).toBe(
      "1b41e026b1011055f1e8ee18046b21b1eed144ce3a7ac9db8225190ad3e0a7eb"
    );
    expect(v3.essai).toBe(false);
    expect(v3.mode).toBe("--campagne");
    expect(v3.verdict).toBe("DEFAVORABLE");
    // Le modèle d'infobulle FAVORABLE n'existe pas : le verdict ne l'a pas produit.
    expect(v3.formulations.modeleAutreUnite).toBeNull();
    expect(v3.formulations.modeleStopActif).toContain("{texteBase} ; stop suiveur {k} × ATR 14 actif : test du 8 octobre 2026 échoué");
  });

  it("4h et unité absente, stopAtr 3 : l'échec chiffré du résultat, au caractère près", () => {
    for (const u of ["4h", undefined] as const) {
      const attendu = `${v3.formulations.texteBase}${SANS_REGIME}${v3.formulations.infobulle4hStop3.slice(v3.formulations.texteBase.length)}`;
      expect(attendu.startsWith(`${v3.formulations.texteBase}${SANS_REGIME} ; stop suiveur 3 × ATR 14 actif : `)).toBe(true);
      for (const info of infos(u, 3)) expect(info.endsWith(` — ${attendu}`)).toBe(true);
    }
  });

  it.each(["1h", "2h", "1d", "1w"] as const)("%s, stopAtr 3 : texte de l'unité + l'échec chiffré", (u) => {
    const attendu = remplir(v3.formulations.modeleStopActif!, signauxBase(u), 3);
    expect(attendu).toContain(signauxBase(u));
    for (const info of infos(u, 3)) expect(info.endsWith(` — ${attendu}`)).toBe(true);
  });

  it("1M (non mesurable), stopAtr 3 : même suffixe d'échec après le « non mesuré »", () => {
    const attendu = remplir(v3.formulations.modeleStopActif!, signauxBase("1M"), 3);
    expect(signauxBase("1M")).toContain("non mesuré (historique trop court");
    for (const info of infos("1M", 3)) expect(info.endsWith(` — ${attendu}`)).toBe(true);
  });

  it("stopAtr 0 (le défaut, conservé après le verdict) : textes et calcul identiques au caractère près", () => {
    for (const u of [undefined, "4h", "1h"] as const) {
      const avecZero = computeIndicator(axis, fixture, { emaTendance: 50, stopAtr: 0, regimeBtc: 0 }, undefined, u);
      const sans = computeIndicator(axis, fixture, { emaTendance: 50, regimeBtc: 0 }, undefined, u);
      expect(JSON.stringify(avecZero)).toBe(JSON.stringify(sans));
      // La formulation « sans stop (réglage) » n'existe qu'en cas de FAVORABLE (manifeste, suites.communes) :
      // DÉFAVORABLE ⇒ elle n'apparaît nulle part.
      for (const info of infos(u, 0)) expect(info).not.toContain("sans stop (réglage)");
    }
  });

  it("autre multiplicateur (2.5) : « réglage hors du test », chiffres du résultat", () => {
    const attendu = remplir(v3.formulations.reglageHorsTest, signauxBase("4h"), 2.5);
    expect(attendu).toContain("2.5 × ATR 14 : réglage hors du test du 8 octobre 2026 (3 × ATR 14 mesuré)");
    for (const info of infos(undefined, 2.5)) expect(info.endsWith(` — ${attendu}`)).toBe(true);
  });

  it("la sortie par stop du chart porte l'étiquette « Stop » et nomme le niveau franchi", () => {
    const r = computeIndicator(axis, fixture, { emaTendance: 50, regimeBtc: 0, stopAtr: 3 }, undefined, "4h");
    const stop = (r.annotations?.marqueurs ?? []).find((m) => m.idx === 137);
    expect(stop?.info?.startsWith("AXIS stop fort — score")).toBe(true);
    expect(stop?.info).toContain("close sous le stop suiveur (61016.78)");
    expect(r.annotations?.labels?.some((l) => l.texte.startsWith("Stop fort "))).toBe(true);
    // Sans stop, aucune étiquette « Stop ».
    const r0 = computeIndicator(axis, fixture, { emaTendance: 50, regimeBtc: 0 }, undefined, "4h");
    expect(r0.annotations?.labels?.some((l) => l.texte.startsWith("Stop")) ?? false).toBe(false);
  });
});
