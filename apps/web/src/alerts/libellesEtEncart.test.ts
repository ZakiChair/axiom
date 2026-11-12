/**
 * Un même évènement d'AXIS se lit à deux endroits : le LIBELLÉ de son alerte (liste, avis à
 * l'écran, journal, relais du daemon : `decrireAlerte` de @axiom/alerts) et le TEXTE de son
 * marqueur, écrit sous le doigt dans l'encart du téléphone (`texteEncart`). Les deux ont été
 * écrits par deux lots distincts (12 novembre 2026) : ce test tient qu'ils disent la même chose,
 * sur le cas de référence BTCUSDT 4h (3 000 bougies closes), bougie par bougie.
 *
 * Doctrine : l'alerte ne dit jamais mieux que le graphe. Un signal précoce est « non mesuré » des
 * deux côtés ; un signal confirmé porte le même statut de mesure des deux côtés.
 */
import { describe, expect, it } from "vitest";
import type { AnnotationsIndicateur, Candle, Timeframe } from "@axiom/types";
import { decrireAlerte, type Condition } from "@axiom/alerts";
import { computeIndicator, getIndicator, statutAxis } from "@axiom/indicators";
import fixtureBtc from "../../../../packages/indicators/src/strategy/fixtures/btcusdt-4h-3000.json";
import { texteEncart } from "../chart/candleReadout";

type LigneFixture = [time: number, open: number, high: number, low: number, close: number, volume: number, buyVolume: number];
const BTC: Candle[] = (fixtureBtc.bougies as LigneFixture[]).map(([time, open, high, low, close, volume, buyVolume]) => ({
  time, open, high, low, close, volume, buyVolume, sellVolume: volume - buyVolume, closed: true,
}));

function calculer(defId: string, unite: Timeframe = "4h"): { series: Record<string, Array<number | undefined>>; annotations: AnnotationsIndicateur } {
  const resultat = computeIndicator(getIndicator(defId)!, BTC, {}, { refClose: BTC.map((c) => c.close) }, unite);
  return { series: resultat.series, annotations: resultat.annotations ?? {} };
}

const seuil = (indicateurId: string, output: string, comparateur: ">=" | "<=", valeur: number): Condition =>
  ({ type: "indicateur-seuil", indicateurId, params: {}, output, comparateur, valeur });
/** Bougies où la sortie vaut 1. */
const aUn = (serie: Array<number | undefined> | undefined): number[] => (serie ?? []).flatMap((v, i) => (v === 1 ? [i] : []));

const NON_MESURE = "non mesuré";

describe("alerte et encart : un même évènement, la même mention", () => {
  const sr = calculer("stratAxisSr");
  const marqueursSr = (sr.annotations.marqueurs ?? []).filter((m) => m.info !== undefined);

  it.each([
    ["reactionSupport", "réaction sur support fort"],
    ["reactionResistance", "réaction sur résistance forte"],
  ] as const)("réaction d'AXIS S/R (%s) : « non mesuré » et le même nom d'évènement, dans le libellé comme sous le doigt", (sortie, evenement) => {
    const libelle = decrireAlerte({ condition: seuil("stratAxisSr", sortie, ">=", 1), timeframe: "4h" });
    expect(libelle).toBe(`AXIS S/R ${NON_MESURE} · ${evenement}`);
    const bougies = aUn(sr.series[sortie]);
    expect(bougies.length).toBeGreaterThan(0);
    let triangles = 0;
    for (const idx of bougies) {
      const creux = marqueursSr.filter((m) => m.idx === idx && m.creux === true);
      // Une réaction sur une bougie de signal confirmé n'a pas de triangle creux : rien à comparer.
      if (creux.length === 0) continue;
      triangles += creux.length;
      for (const marqueur of creux) {
        // L'encart rend ce texte en entier : sa réserve ouvre, l'évènement suit.
        const sousLeDoigt = texteEncart(marqueur.info!);
        expect(sousLeDoigt).toBe(marqueur.info);
        expect(sousLeDoigt.startsWith(`AXIS S/R signal précoce ${NON_MESURE} — lecture indicative, jamais une promesse — ${evenement} `)).toBe(true);
      }
    }
    // Témoin : la comparaison a porté sur presque toutes les réactions.
    expect(triangles).toBeGreaterThan(bougies.length - 5);
  });

  it.each(["stratAxis", "stratAxisSr"] as const)("signal confirmé de %s en 4h : le statut du libellé est celui que l'encart écrit après le score", (defId) => {
    const { series, annotations } = calculer(defId);
    const nom = getIndicator(defId)!.name;
    const statut = statutAxis("4h", false, false);
    const achat = decrireAlerte({ condition: seuil(defId, "etat", ">=", 1), timeframe: "4h" });
    const vente = decrireAlerte({ condition: seuil(defId, "etat", "<=", 0), timeframe: "4h" });
    expect(achat).toBe(`${nom} ${statut} · signal d'achat`);
    expect(vente).toBe(`${nom} ${statut} · signal de vente`);
    const etat = series.etat ?? [];
    // Fronts de la sortie « etat » : l'alerte d'achat tire au passage à 1, celle de vente au retour à 0.
    const fronts = etat.flatMap((v, i) => (i > 0 && v !== undefined && etat[i - 1] !== undefined && v !== etat[i - 1] ? [{ idx: i, achat: v === 1 }] : []));
    expect(fronts.length).toBeGreaterThan(10);
    const confirmes = (annotations.marqueurs ?? []).filter((m) => m.info !== undefined && m.creux !== true && (m.couleur === "--up" || m.couleur === "--down"));
    for (const front of fronts) {
      const marqueur = confirmes.find((m) => m.idx === front.idx);
      expect(marqueur, `aucun signal confirmé dessiné à la bougie ${front.idx}`).toBeDefined();
      const sousLeDoigt = texteEncart(marqueur!.info!);
      // Tête de l'encart : « AXIS achat … — score +5/6 · <statut> — … » ; même sens, même statut.
      const [tete, mesure] = sousLeDoigt.split(" — ");
      expect(tete).toMatch(front.achat ? /^AXIS achat/ : /^AXIS vente/);
      expect(mesure).toMatch(new RegExp(`^score [+-]?\\d/6 · ${statut.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    }
  });

  it("hors 4h et sans unité : le libellé ne dit jamais mieux que le graphe", () => {
    // Autre unité : le statut du libellé est celui de l'infobulle calculée dans cette unité.
    for (const unite of ["1h", "1d", "1w"] as const) {
      const statut = statutAxis(unite, false, false);
      expect(decrireAlerte({ condition: seuil("stratAxis", "etat", ">=", 1), timeframe: unite })).toBe(`AXIS ${statut} · signal d'achat`);
      const confirmes = (calculer("stratAxis", unite).annotations.marqueurs ?? []).filter((m) => m.creux !== true && (m.couleur === "--up" || m.couleur === "--down"));
      expect(confirmes.length).toBeGreaterThan(0);
      for (const m of confirmes) expect(texteEncart(m.info!).split(" — ")[1]).toContain(statut);
      expect(statut).not.toContain("test 4h");
    }
    // Sans unité, l'alerte est évaluée sur l'unité affichée, quelle qu'elle soit : elle ne reprend
    // pas « test 4h », même si le graphe est en 4h au moment où elle sonne.
    expect(decrireAlerte({ condition: seuil("stratAxis", "etat", ">=", 1) })).toBe("AXIS non mesuré hors 4h · signal d'achat");
    // Une réaction reste « non mesuré » dans toute unité.
    for (const unite of [undefined, "1h", "4h", "1w"] as const) {
      expect(decrireAlerte({ condition: seuil("stratAxisSr", "reactionSupport", ">=", 1), timeframe: unite })).toContain(NON_MESURE);
    }
  });
});
