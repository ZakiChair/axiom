/**
 * @axiom/indicators — utils.test.ts
 *
 * Quantification des longueurs de fenêtre : une longueur fractionnaire (saisie
 * UI sans step, ex. 14.5) doit être arrondie à l'entier le plus proche, jamais
 * utilisée telle quelle — sinon `values[i - 14.5]` vaut undefined : la fenêtre
 * SMA ne se vide jamais (somme cumulée divergente) et EMA/RMA restent vides.
 */
import { describe, expect, it } from "vitest";
import {
  change,
  ema,
  rma,
  rollingHighest,
  rollingLowest,
  rollingSum,
  sma,
  stdev,
  wma,
} from "./utils";

const valeurs = Array.from({ length: 40 }, (_, i) => 100 + i);

describe("quantification des longueurs fractionnaires", () => {
  it("sma(14.5) === sma(15) — jamais de somme cumulée divergente", () => {
    expect(sma(valeurs, 14.5)).toEqual(sma(valeurs, 15));
  });

  it("ema/rma(14.5) non vides et égales à la version entière", () => {
    const e = ema(valeurs, 14.5);
    expect(e.some((v) => v !== undefined)).toBe(true);
    expect(e).toEqual(ema(valeurs, 15));
    expect(rma(valeurs, 14.5)).toEqual(rma(valeurs, 15));
  });

  it("helpers de fenêtre restants : wma/stdev/rollingSum/rollingHighest/rollingLowest", () => {
    expect(wma(valeurs, 9.5)).toEqual(wma(valeurs, 10));
    expect(stdev(valeurs, 9.5)).toEqual(stdev(valeurs, 10));
    expect(rollingSum(valeurs, 9.5)).toEqual(rollingSum(valeurs, 10));
    expect(rollingHighest(valeurs, 9.5)).toEqual(rollingHighest(valeurs, 10));
    expect(rollingLowest(valeurs, 9.5)).toEqual(rollingLowest(valeurs, 10));
  });

  it("change(10.5) === change(11) — 9e helper (différence roulante), non vide", () => {
    const c = change(valeurs, 10.5);
    expect(c.some((v) => v !== undefined)).toBe(true);
    expect(c).toEqual(change(valeurs, 11));
  });
});
