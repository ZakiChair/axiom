/**
 * Jeux d'indicateurs nommés (B5) : le raccourci qui remplace le re-cochage de huit
 * lignes dans un panneau de 288 px.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ActiveIndicator } from "./indicators";
import {
  MAX_JEUX,
  idPourNom,
  indicatorSetsStore,
  migrerJeuxPersistes,
} from "./indicatorSets";

const inst = (defId: string, period: number): ActiveIndicator => ({
  instanceId: `${defId}-${period}`,
  defId,
  params: { period },
  couleurIdx: 0,
});

const etat = () => indicatorSetsStore.getState();
const noms = () => etat().jeux.map((j) => j.nom);

beforeEach(() => {
  indicatorSetsStore.setState({ jeux: [] });
});

describe("idPourNom", () => {
  it("dérive un id lisible, sans accent ni ponctuation", () => {
    expect(idPourNom("Setup Dérivés", [])).toBe("setup-derives");
    expect(idPourNom("  Swing / long  ", [])).toBe("swing-long");
  });

  it("suffixe en cas de collision", () => {
    expect(idPourNom("swing", ["swing"])).toBe("swing-2");
    expect(idPourNom("swing", ["swing", "swing-2"])).toBe("swing-3");
  });

  it("retombe sur un id valable quand le nom n'a aucun caractère utilisable", () => {
    expect(idPourNom("!!!", [])).toBe("jeu");
  });
});

describe("enregistrer", () => {
  it("enregistre les instances sous un nom", () => {
    etat().enregistrer("swing", [inst("ema", 20), inst("rsi", 14)]);
    expect(noms()).toEqual(["swing"]);
    expect(etat().jeux[0]?.instances).toHaveLength(2);
  });

  it("ignore un nom vide", () => {
    etat().enregistrer("   ", [inst("ema", 20)]);
    expect(etat().jeux).toHaveLength(0);
  });

  it("ÉCRASE un jeu de même nom au lieu d'en créer un homonyme", () => {
    etat().enregistrer("swing", [inst("ema", 20)]);
    etat().enregistrer("Swing", [inst("ema", 20), inst("rsi", 14)]);
    expect(etat().jeux).toHaveLength(1);
    expect(etat().jeux[0]?.instances).toHaveLength(2);
  });

  it("COPIE les instances : modifier le store d'origine ne réécrit pas le jeu", () => {
    const source = [inst("ema", 20)];
    etat().enregistrer("swing", source);
    const params = source[0]?.params as { period: number };
    params.period = 999;
    expect((etat().jeux[0]?.instances[0]?.params as { period: number }).period).toBe(20);
  });

  it("plafonne le nombre de jeux", () => {
    for (let i = 0; i < MAX_JEUX + 3; i++) etat().enregistrer(`jeu${i}`, [inst("ema", i)]);
    expect(etat().jeux).toHaveLength(MAX_JEUX);
  });
});

describe("supprimer / renommer", () => {
  it("supprime par id", () => {
    etat().enregistrer("swing", [inst("ema", 20)]);
    const id = etat().jeux[0]?.id;
    if (!id) throw new Error("jeu absent");
    etat().supprimer(id);
    expect(etat().jeux).toHaveLength(0);
  });

  it("renomme sans toucher aux instances", () => {
    etat().enregistrer("swing", [inst("ema", 20)]);
    const id = etat().jeux[0]?.id;
    if (!id) throw new Error("jeu absent");
    etat().renommer(id, "swing long");
    expect(noms()).toEqual(["swing long"]);
    expect(etat().jeux[0]?.instances).toHaveLength(1);
  });

  it("refuse un renommage vide", () => {
    etat().enregistrer("swing", [inst("ema", 20)]);
    const id = etat().jeux[0]?.id;
    if (!id) throw new Error("jeu absent");
    etat().renommer(id, "  ");
    expect(noms()).toEqual(["swing"]);
  });
});

describe("migrerJeuxPersistes", () => {
  it("rend une liste vide sur une entrée qui n'est pas un tableau", () => {
    expect(migrerJeuxPersistes(null)).toEqual([]);
    expect(migrerJeuxPersistes({ jeux: [] })).toEqual([]);
  });

  it("filtre les entrées mal formées plutôt que de faire confiance au JSON", () => {
    const migre = migrerJeuxPersistes([
      { id: "ok", nom: "Swing", instances: [] },
      { id: 42, nom: "Bad", instances: [] },
      { id: "sansInstances", nom: "Bad" },
      null,
      "texte",
    ]);
    expect(migre).toHaveLength(1);
    expect(migre[0]?.id).toBe("ok");
  });

  it("plafonne aussi à la restauration", () => {
    const brut = Array.from({ length: MAX_JEUX + 5 }, (_, i) => ({
      id: `j${i}`,
      nom: `J${i}`,
      instances: [],
    }));
    expect(migrerJeuxPersistes(brut)).toHaveLength(MAX_JEUX);
  });
});
