/**
 * Tests du store d'indicateurs multi-instances (Mission 1.E) : helpers purs
 * (hash de params, libellé, migration) et actions du store (add/remove/duplicate/
 * updateParams/setAll). Valeurs expliquées en commentaire.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { getIndicator } from "@axiom/indicators";
import {
  computeKey,
  defaultParams,
  formatInstanceLabel,
  indicatorsStore,
  migratePersistedIndicators,
  shortHash,
} from "./indicators";

beforeEach(() => {
  indicatorsStore.setState({ indicators: [] });
});

describe("shortHash / computeKey", () => {
  it("est déterministe et indépendant de l'ordre des clés", () => {
    // Mêmes paires clé=valeur, ordre d'insertion différent → même hash.
    const a = shortHash({ fast: 12, slow: 26, signal: 9 });
    const b = shortHash({ signal: 9, slow: 26, fast: 12 });
    expect(a).toBe(b);
  });

  it("diffère quand un paramètre change", () => {
    expect(shortHash({ length: 20 })).not.toBe(shortHash({ length: 50 }));
  });

  it("computeKey préfixe le defId", () => {
    // Deux instances de même config partagent la clé de calcul (mémoïsation chart).
    expect(computeKey("ema", { length: 20 })).toBe(`ema::${shortHash({ length: 20 })}`);
    expect(computeKey("ema", { length: 20 })).not.toBe(computeKey("sma", { length: 20 }));
  });
});

describe("formatInstanceLabel", () => {
  it("compose « nom (params) » pour les paramètres numériques", () => {
    const ema = getIndicator("ema");
    if (!ema) throw new Error("def ema absente du registre");
    expect(formatInstanceLabel(ema, { length: 20 })).toBe("EMA (20)");

    const macd = getIndicator("macd");
    if (!macd) throw new Error("def macd absente du registre");
    // Ordre des inputs préservé : fast, slow, signal.
    expect(formatInstanceLabel(macd, { fast: 12, slow: 26, signal: 9 })).toBe("MACD (12, 26, 9)");
  });

  it("retombe sur le nom seul quand l'indicateur n'a pas d'input", () => {
    const vwap = getIndicator("vwap");
    if (!vwap) throw new Error("def vwap absente du registre");
    expect(formatInstanceLabel(vwap, {})).toBe("VWAP");
  });
});

describe("migratePersistedIndicators (fonction PURE)", () => {
  it("rejette une entrée non-tableau", () => {
    expect(migratePersistedIndicators(null)).toEqual([]);
    expect(migratePersistedIndicators({ defId: "ema" })).toEqual([]);
  });

  it("filtre les defId disparus du registre et backfille les params manquants", () => {
    const out = migratePersistedIndicators([
      { defId: "sma", params: { length: 42 } }, // conservé, params tels quels
      { defId: "indicateur-fantome" }, // filtré (absent du registre)
      { defId: "ema" }, // params manquants → défauts
    ]);
    expect(out.map((i) => i.defId)).toEqual(["sma", "ema"]);
    expect(out[0]?.params).toEqual({ length: 42 });
    expect(out[1]?.params).toEqual(defaultParams("ema"));
    // Chaque instance reçoit un instanceId basé sur son defId.
    expect(out[0]?.instanceId.startsWith("sma-")).toBe(true);
    expect(out[1]?.instanceId.startsWith("ema-")).toBe(true);
  });

  it("préserve un instanceId déjà présent et dédoublonne les collisions", () => {
    const out = migratePersistedIndicators([
      { defId: "ema", params: { length: 20 }, instanceId: "ema-perso" },
      { defId: "ema", params: { length: 20 } }, // même config → collision de base
    ]);
    // Le 1er garde son id explicite ; le 2e (même hash) reçoit un suffixe d'unicité.
    expect(out[0]?.instanceId).toBe("ema-perso");
    expect(out[1]?.instanceId).not.toBe(out[0]?.instanceId);
    expect(new Set(out.map((i) => i.instanceId)).size).toBe(2);
  });
});

describe("actions du store", () => {
  it("add crée une instance aux params par défaut avec un instanceId unique", () => {
    const s = indicatorsStore.getState();
    s.add("ema");
    s.add("ema"); // deuxième EMA(20) : coexiste, instanceId distinct
    const list = indicatorsStore.getState().indicators;
    expect(list).toHaveLength(2);
    expect(list.every((i) => i.defId === "ema")).toBe(true);
    expect(list[0]?.params).toEqual(defaultParams("ema"));
    expect(list[0]?.instanceId).not.toBe(list[1]?.instanceId);
    expect(new Set(list.map((i) => i.instanceId)).size).toBe(2);
  });

  it("add ignore un defId inconnu", () => {
    indicatorsStore.getState().add("defId-inexistant");
    expect(indicatorsStore.getState().indicators).toHaveLength(0);
  });

  it("updateParams change les params en gardant l'instanceId (identité stable)", () => {
    const s = indicatorsStore.getState();
    s.add("ema");
    const before = indicatorsStore.getState().indicators[0];
    if (!before) throw new Error("instance absente");
    s.updateParams(before.instanceId, { length: 50 });
    const after = indicatorsStore.getState().indicators[0];
    expect(after?.instanceId).toBe(before.instanceId); // instanceId INCHANGÉ
    expect(after?.params).toEqual({ length: 50 });
  });

  it("duplicate clone les params avec un nouvel instanceId, inséré juste après", () => {
    const s = indicatorsStore.getState();
    s.add("sma"); // idx 0
    s.add("rsi"); // idx 1
    const sma = indicatorsStore.getState().indicators[0];
    if (!sma) throw new Error("instance sma absente");
    s.duplicate(sma.instanceId);
    const list = indicatorsStore.getState().indicators;
    // Le clone est inséré en position 1 (juste après l'original), avant le rsi.
    expect(list.map((i) => i.defId)).toEqual(["sma", "sma", "rsi"]);
    expect(list[1]?.instanceId).not.toBe(list[0]?.instanceId);
    expect(list[1]?.params).toEqual(list[0]?.params);
  });

  it("remove supprime l'instance ciblée uniquement", () => {
    const s = indicatorsStore.getState();
    s.add("ema");
    s.add("sma");
    const target = indicatorsStore.getState().indicators[0];
    if (!target) throw new Error("instance absente");
    s.remove(target.instanceId);
    const list = indicatorsStore.getState().indicators;
    expect(list).toHaveLength(1);
    expect(list[0]?.defId).toBe("sma");
  });

  it("setAll réattribue des instanceId uniques à une liste sans identité", () => {
    indicatorsStore.getState().setAll([
      { defId: "ema", params: { length: 20 } },
      { defId: "ema", params: { length: 20 } }, // même config → suffixe d'unicité
    ]);
    const list = indicatorsStore.getState().indicators;
    expect(list).toHaveLength(2);
    expect(new Set(list.map((i) => i.instanceId)).size).toBe(2);
  });
});

describe("reorder", () => {
  it("réordonne selon la liste d'instanceId fournie", () => {
    indicatorsStore.setState({
      indicators: [
        { instanceId: "a", defId: "rsi", params: {} , couleurIdx: 0 },
        { instanceId: "b", defId: "macd", params: {} , couleurIdx: 0 },
        { instanceId: "c", defId: "ema", params: {} , couleurIdx: 0 },
      ],
    });
    indicatorsStore.getState().reorder(["c", "a", "b"]);
    expect(indicatorsStore.getState().indicators.map((i) => i.instanceId)).toEqual(["c", "a", "b"]);
  });

  it("ajoute en fin toute instance absente de l'ordre fourni (garde-fou)", () => {
    indicatorsStore.setState({
      indicators: [
        { instanceId: "a", defId: "rsi", params: {} , couleurIdx: 0 },
        { instanceId: "b", defId: "macd", params: {} , couleurIdx: 0 },
      ],
    });
    indicatorsStore.getState().reorder(["b"]);
    expect(indicatorsStore.getState().indicators.map((i) => i.instanceId)).toEqual(["b", "a"]);
  });

  it("ignore les ids inconnus dans l'ordre fourni", () => {
    indicatorsStore.setState({ indicators: [{ instanceId: "a", defId: "rsi", params: {} , couleurIdx: 0 }] });
    indicatorsStore.getState().reorder(["inconnu", "a"]);
    expect(indicatorsStore.getState().indicators.map((i) => i.instanceId)).toEqual(["a"]);
  });
});

describe("toggle — bascule ⌘K non destructive (B6)", () => {
  beforeEach(() => {
    indicatorsStore.setState({ indicators: [] });
  });

  it("ajoute une instance quand aucune n'existe", () => {
    indicatorsStore.getState().toggle("ema");
    expect(indicatorsStore.getState().indicators.map((i) => i.defId)).toEqual(["ema"]);
  });

  it("ne retire QUE la dernière instance — trois EMA réglées ne disparaissent plus d'une frappe", () => {
    const s = indicatorsStore.getState();
    s.add("ema");
    s.add("ema");
    s.add("ema");
    const ids = indicatorsStore.getState().indicators.map((i) => i.instanceId);
    indicatorsStore.getState().toggle("ema");
    expect(indicatorsStore.getState().indicators.map((i) => i.instanceId)).toEqual(ids.slice(0, 2));
  });

  it("retire la dernière instance du def même si d'autres defs la suivent dans la liste", () => {
    const s = indicatorsStore.getState();
    s.add("ema");
    s.add("rsi");
    indicatorsStore.getState().toggle("ema");
    expect(indicatorsStore.getState().indicators.map((i) => i.defId)).toEqual(["rsi"]);
  });

  it("aller-retour complet : toggle ×2 revient à l'état de départ (une instance près)", () => {
    indicatorsStore.getState().toggle("rsi");
    indicatorsStore.getState().toggle("rsi");
    expect(indicatorsStore.getState().indicators).toEqual([]);
  });
});
