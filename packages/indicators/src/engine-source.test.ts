/**
 * @axiom/indicators — engine-source.test.ts
 *
 * Test de CONFORMITÉ générique de l'input `source`.
 *
 * Contrat : tout `IndicatorDef` de `INDICATORS` qui déclare un input
 * `type: "source"` DOIT réellement consommer `ctx.source`. Autrement dit, le
 * calcul avec `{ source: "hlc3" }` doit DIFFÉRER de `{ source: "close" }` sur au
 * moins un point défini d'au moins une série de sortie. Le mode de défaillance
 * visé : un def qui déclare `source` mais lit `closeOf(candles)` dans son calc
 * (la source déclarée est alors ignorée — divergence silencieuse).
 *
 * Le filtre est DYNAMIQUE (parcourt `INDICATORS` au runtime, pas une liste en
 * dur) : tout futur def à source est automatiquement couvert.
 *
 * Fixture : 60 bougies synthétiques déterministes (aucun Date.now/Math.random)
 * où high≠close≠low. Les mèches sont ASYMÉTRIQUES et variables par bougie, si
 * bien que hlc3 = close + (mècheHaute − mècheBasse)/3 change de FORME et n'est
 * PAS une transformation affine de close — indispensable pour que les
 * indicateurs invariants d'échelle affine (RSI, QQE, Bêta/Corrélation sur
 * rendements log) divergent effectivement entre les deux sources.
 */

import { describe, expect, it } from "vitest";
import type { AuxSeries, Candle, IndicatorDef } from "@axiom/types";
import { computeIndicator } from "./engine";
import { INDICATORS } from "./registry";

/** 60 bougies synthétiques déterministes (high≠close≠low, tout positif). */
function buildFixture(): Candle[] {
  const n = 60;
  const candles: Candle[] = [];
  for (let i = 0; i < n; i++) {
    // Close : tendance douce + double oscillation incommensurable (jamais plat).
    const close = 100 + 0.3 * i + 10 * Math.sin(i / 5) + 3 * Math.sin(i / 2);
    // Mèches asymétriques et variables : hlc3 s'écarte de close d'un montant qui
    // change à chaque bougie (décalage additif non constant, pas un facteur d'échelle).
    const upWick = 1 + 2 * Math.abs(Math.sin(i / 3));
    const downWick = 1 + 2 * Math.abs(Math.cos(i / 4));
    const high = close + upWick;
    const low = close - downWick;
    const open = close - 0.4; // dans [low, high]
    const volume = 1000 + 20 * i + 100 * Math.abs(Math.sin(i));
    candles.push({ time: i * 60_000, open, high, low, close, volume });
  }
  return candles;
}

const CANDLES = buildFixture();

/**
 * Série de référence auxiliaire (refClose) pour les defs cross-asset : positive
 * et variable (variance > 0), sinon beta/corr resteraient undefined.
 */
const REF_CLOSE: number[] = CANDLES.map(
  (_, i) => 200 + 5 * Math.sin(i / 4) + 0.5 * i
);
const AUX: AuxSeries = { refClose: REF_CLOSE };

/**
 * Defs à input `source` qui dépendent AUSSI d'une série auxiliaire : sans elle,
 * leurs sorties calculées sont undefined partout (seules subsistent des lignes
 * de repère constantes, indépendantes de la source) → faux rouge. On leur
 * fournit une fixture aux minimale pour EXERCER réellement la source.
 */
const AUX_DEPENDENT = new Set<string>(["betaRef", "rollingCorrelation"]);

/**
 * Surcharges de paramètres pour rendre l'indicateur calculable sur 60 bougies
 * quand sa fenêtre par défaut est trop longue. N'affecte PAS la conformité :
 * la même fenêtre est tenue constante entre les deux sources comparées, seule
 * la source varie.
 */
const PARAM_OVERRIDES: Record<string, Record<string, number>> = {
  // priceZScore : length par défaut 100 > 60 bougies → z jamais défini. On tient
  // length=30 (fenêtre pleine dès l'index 29) pour les deux sources.
  priceZScore: { length: 30 },
};

/**
 * Defs à input `source` dont TOUTES les sorties sont des POINTS portant le PRIX au
 * pivot (high/low) : pour eux la source pilote la DÉTECTION (l'index où un point
 * apparaît), pas la VALEUR (toujours le prix à cet index) — la comparaison de
 * valeurs de ce test ne peut donc JAMAIS les départager, d'où un faux positif
 * « source ignorée ». Actuellement vide (rsiDivergence v2 sort une courbe qui
 * dépend directement de la source → il réintègre le .each ci-dessous) ; conservé
 * pour un futur def « points » du même genre.
 */
const POINT_VALUE_INVARIANTS = new Set<string>([]);

/** Un def déclare-t-il au moins un input de type "source" ? */
function declaresSource(def: IndicatorDef): boolean {
  return def.inputs.some((input) => input.type === "source");
}

/** Filtre DYNAMIQUE : tous les defs à input source du registre. */
const sourceDefs: IndicatorDef[] = INDICATORS.filter(declaresSource);

/** Defs à source dont la valeur de sortie DÉPEND de la source (comparables ici). */
const sourceValueDefs: IndicatorDef[] = sourceDefs.filter(
  (def) => !POINT_VALUE_INVARIANTS.has(def.id)
);

/**
 * Cherche un point défini où les deux séries divergent.
 * Retour : { differs, comparedDefined } — `comparedDefined` distingue « aucun
 * point défini comparé » (fenêtre trop longue / aux manquante) de « défini mais
 * identique » (vraie non-conformité).
 */
function seriesDiverge(
  a: Record<string, Array<number | undefined>>,
  b: Record<string, Array<number | undefined>>
): { differs: boolean; comparedDefined: number } {
  let comparedDefined = 0;
  for (const key of Object.keys(a)) {
    const sa = a[key];
    const sb = b[key];
    if (sa === undefined || sb === undefined) continue;
    const len = Math.min(sa.length, sb.length);
    for (let i = 0; i < len; i++) {
      const va = sa[i];
      const vb = sb[i];
      if (va === undefined || vb === undefined) continue;
      comparedDefined++;
      if (va !== vb) return { differs: true, comparedDefined };
    }
  }
  return { differs: false, comparedDefined };
}

describe("conformité de l'input source", () => {
  it("le filtre capture des defs (garde anti-test.each vide) et les repères connus", () => {
    // Un test.each sur une liste vide passerait au vert sans rien vérifier.
    expect(sourceDefs.length).toBeGreaterThan(0);
    const ids = sourceDefs.map((d) => d.id);
    for (const known of ["sma", "rsi", "bollinger"]) {
      expect(ids).toContain(known);
    }
  });

  it("tout def source+aux est géré dans AUX_DEPENDENT (liste assertée)", () => {
    // Garde-fou : un futur def qui déclare `source` ET des séries `aux` mais qui
    // n'est pas listé ici produirait des sorties all-undefined → rouge trompeur.
    for (const def of sourceDefs) {
      if ((def.aux?.length ?? 0) > 0) {
        expect(
          AUX_DEPENDENT.has(def.id),
          `def "${def.id}" déclare des séries aux mais n'est pas géré dans le test source`
        ).toBe(true);
      }
    }
  });

  it("l'ensemble points-invariants par source reste minimal et valide", () => {
    // Garde-fou symétrique de AUX_DEPENDENT : un futur def source réellement cassé
    // (déclare source mais lit closeOf) ne doit pas pouvoir se cacher en atterrissant
    // silencieusement ici. On fige la liste ET on exige que chaque exclu déclare bien
    // une source (sinon il n'aurait rien à faire dans ce test).
    expect([...POINT_VALUE_INVARIANTS].sort()).toEqual([]);
    for (const id of POINT_VALUE_INVARIANTS) {
      const def = INDICATORS.find((d) => d.id === id);
      expect(def, `def exclu "${id}" introuvable dans le registre`).toBeDefined();
      expect(
        def !== undefined && declaresSource(def),
        `def exclu "${id}" ne déclare pas de source`
      ).toBe(true);
    }
  });

  it.each(sourceValueDefs.map((def) => [def.id, def] as const))(
    "%s consomme réellement ctx.source (hlc3 ≠ close)",
    (id, def) => {
      const override = PARAM_OVERRIDES[id] ?? {};
      const aux = AUX_DEPENDENT.has(id) ? AUX : undefined;
      const close = computeIndicator(def, CANDLES, { ...override, source: "close" }, aux);
      const hlc3 = computeIndicator(def, CANDLES, { ...override, source: "hlc3" }, aux);

      const { differs, comparedDefined } = seriesDiverge(close.series, hlc3.series);
      expect(
        differs,
        `def "${id}" : source ignorée — ${
          comparedDefined === 0
            ? "aucun point défini comparé (fenêtre trop longue ou aux manquante)"
            : "hlc3 ≡ close sur tous les points définis (calc lit probablement closeOf(candles) au lieu de ctx.source)"
        }`
      ).toBe(true);
    }
  );
});
