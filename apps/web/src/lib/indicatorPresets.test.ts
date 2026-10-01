import { beforeEach, describe, expect, it } from "vitest";
import { getIndicator } from "@axiom/indicators";
import { indicatorsStore } from "../store/indicators";
import { chartCapaciteStore } from "../store/chartCapacite";
import { indicatorSetsStore } from "../store/indicatorSets";
import { PRESETS_ANALYSE, planifierPreset, ajouterPreset, annulerAjoutPreset } from "./indicatorPresets";

const intraday = PRESETS_ANALYSE.find((p) => p.id === "intraday")!;
const swing = PRESETS_ANALYSE.find((p) => p.id === "swing")!;

beforeEach(() => {
  indicatorsStore.setState({ indicators: [] });
  indicatorSetsStore.setState({ jeux: [] });
  chartCapaciteStore.setState({ paneMax: 5 });
});

describe("préréglages d’analyse", () => {
  it.each(["polyvalent", "intraday", "swing"])("%s est ajoutable sans clé, avec une seule pane et sans remplacer les indicateurs déjà actifs", (id) => {
    const preset = PRESETS_ANALYSE.find((p) => p.id === id)!;
    indicatorsStore.getState().add("rsi");
    const avant = indicatorsStore.getState().indicators[0];
    const resultat = ajouterPreset(preset);
    expect(resultat.instances).toHaveLength(2);
    const apres = indicatorsStore.getState().indicators;
    expect(apres[0]).toBe(avant);
    expect(apres.slice(1).filter((i) => getIndicator(i.defId)?.pane === "separate")).toHaveLength(1);
    expect(apres.slice(1).every((i) => !getIndicator(i.defId)?.aux?.length)).toBe(true);
  });

  it("reconnaît les défauts absents ou invalides après résolution et ne duplique pas les configurations", () => {
    indicatorsStore.getState().setAll([
      { defId: "ema", params: {} },
      { defId: "narrowRange", params: { length: Number.NaN } },
    ]);
    const avant = indicatorsStore.getState().indicators;
    expect(ajouterPreset(intraday).instances).toEqual([]);
    expect(indicatorsStore.getState().indicators).toBe(avant);
  });

  it("préserve une EMA différente et ne rajoute que la configuration manquante au second ajout", () => {
    indicatorsStore.getState().add("ema");
    expect(ajouterPreset(swing).instances).toHaveLength(2);
    expect(indicatorsStore.getState().indicators.map((i) => [i.defId, i.params.length])).toEqual([
      ["ema", 20], ["ema", 50], ["rollingDrawdown", 100],
    ]);
    expect(ajouterPreset(swing).instances).toEqual([]);
    const repli = indicatorsStore.getState().indicators.find((i) => i.defId === "rollingDrawdown")!;
    indicatorsStore.getState().remove(repli.instanceId);
    expect(ajouterPreset(swing).instances).toHaveLength(1);
  });

  it("refuse tout le groupe si sa pane dépasse la capacité, sans ajouter même l’EMA", () => {
    indicatorsStore.getState().add("rsi");
    chartCapaciteStore.setState({ paneMax: 1 });
    const avant = indicatorsStore.getState().indicators;
    expect(planifierPreset(intraday, avant, 1).raison).toContain("1 panneau");
    expect(ajouterPreset(intraday).instances).toEqual([]);
    expect(indicatorsStore.getState().indicators).toBe(avant);
  });

  it("autorise uniquement l’overlay manquant lorsque la pane du préréglage est déjà présente au plafond", () => {
    indicatorsStore.getState().add("narrowRange");
    chartCapaciteStore.setState({ paneMax: 1 });
    expect(ajouterPreset(intraday).instances).toHaveLength(1);
    expect(indicatorsStore.getState().indicators.map((i) => i.defId)).toEqual(["narrowRange", "ema"]);
  });

  it("conserve le comportement existant lorsque la capacité du graphe n’est pas encore mesurée", () => {
    chartCapaciteStore.setState({ paneMax: 0 });
    expect(ajouterPreset(intraday).instances).toHaveLength(2);
  });

  it("annule seulement les identités ajoutées, en préservant ajouts ultérieurs et jeux personnels", () => {
    indicatorsStore.getState().add("ema");
    indicatorSetsStore.getState().enregistrer("Mon étude", indicatorsStore.getState().indicators);
    const jeux = indicatorSetsStore.getState().jeux;
    const ajout = ajouterPreset(intraday);
    expect(ajout.instances).toHaveLength(1);
    indicatorsStore.getState().add("rsi");
    const rsi = indicatorsStore.getState().indicators.at(-1)!;
    annulerAjoutPreset(ajout.instances);
    expect(indicatorsStore.getState().indicators.map((i) => i.defId)).toEqual(["ema", "rsi"]);
    expect(indicatorsStore.getState().indicators.at(-1)).toBe(rsi);
    expect(indicatorSetsStore.getState().jeux).toBe(jeux);
  });

  it("l’annulation préserve une instance personnelle recréée avec le même ID", () => {
    const ajout = ajouterPreset(intraday);
    const ema = indicatorsStore.getState().indicators.find((i) => i.defId === "ema")!;
    indicatorsStore.getState().remove(ema.instanceId);
    indicatorsStore.getState().add("ema");
    const personnelle = indicatorsStore.getState().indicators.find((i) => i.defId === "ema")!;
    expect(personnelle.instanceId).toBe(ema.instanceId);
    annulerAjoutPreset(ajout.instances);
    expect(indicatorsStore.getState().indicators).toEqual([personnelle]);
  });

  it("l’annulation préserve les réglages modifiés après l’ajout", () => {
    const ajout = ajouterPreset(intraday);
    const ema = indicatorsStore.getState().indicators.find((i) => i.defId === "ema")!;
    indicatorsStore.getState().updateParams(ema.instanceId, { length: 35 });
    annulerAjoutPreset(ajout.instances);
    expect(indicatorsStore.getState().indicators.map((i) => [i.defId, i.params.length])).toEqual([["ema", 35]]);
  });
});
