/**
 * Recherche FRANÇAISE du catalogue (B4). Le catalogue est en sigles anglais alors que
 * tout le terminal est en français : « moyenne mobile » renvoyait ZÉRO résultat sur
 * 152 entrées (vérifié dans le navigateur avant correctif).
 */
import { describe, expect, it } from "vitest";
import { getIndicator } from "@axiom/indicators";
import { ALIAS_INDICATEURS, correspondAlias, normaliser } from "./indicateurAlias";

describe("normaliser", () => {
  it("retire accents et casse", () => {
    expect(normaliser("Moyenne Mobile Exponentielle")).toBe("moyenne mobile exponentielle");
    expect(normaliser("écart-type")).toBe("ecart type");
  });

  it("ramène tirets, apostrophes et espaces multiples à un espace simple", () => {
    expect(normaliser("sur-achat   sur’vente")).toBe("sur achat sur vente");
  });

  it("tolère une chaîne vide", () => {
    expect(normaliser("   ")).toBe("");
  });
});

describe("correspondAlias", () => {
  it("trouve les moyennes mobiles par leur nom français", () => {
    const q = normaliser("moyenne mobile");
    expect(correspondAlias("ema", q)).toBe(true);
    expect(correspondAlias("sma", q)).toBe(true);
    expect(correspondAlias("rsi", q)).toBe(false);
  });

  it("trouve un indicateur par un terme partiel", () => {
    expect(correspondAlias("bollinger", normaliser("bandes"))).toBe(true);
    expect(correspondAlias("rsi", normaliser("surachat"))).toBe(true);
  });

  it("ignore les accents de la requête", () => {
    expect(correspondAlias("historicalVol", normaliser("volatilité réalisée"))).toBe(true);
  });

  it("ne matche rien sur une requête vide (sinon tout le catalogue remonterait)", () => {
    expect(correspondAlias("ema", "")).toBe(false);
  });

  it("ignore un defId sans alias", () => {
    expect(correspondAlias("defInexistant", normaliser("moyenne"))).toBe(false);
  });
});

describe("table d'alias", () => {
  it("ne référence QUE des defId réels du registre", () => {
    const inconnus = Object.keys(ALIAS_INDICATEURS).filter((id) => getIndicator(id) === undefined);
    expect(inconnus, `defId absents du registre : ${inconnus.join(", ")}`).toEqual([]);
  });

  it("n'a que des termes déjà normalisés (sinon ils seraient introuvables)", () => {
    const mauvais: string[] = [];
    for (const [id, termes] of Object.entries(ALIAS_INDICATEURS)) {
      for (const t of termes) if (normaliser(t) !== t) mauvais.push(`${id}: « ${t} »`);
    }
    expect(mauvais, `termes non normalisés : ${mauvais.join(", ")}`).toEqual([]);
  });

  it("couvre la famille des moyennes mobiles, la plus cherchée", () => {
    for (const id of ["sma", "ema", "wma", "hma"]) {
      expect(correspondAlias(id, normaliser("moyenne mobile")), id).toBe(true);
    }
  });
});
