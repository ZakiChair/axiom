/**
 * Tests des helpers PURS du panneau Alertes : construction de la condition
 * `indicateur-croisement` (formulaire) et cible de navigation d'un déclenchement ; depuis le
 * 12 novembre 2026, sorties proposées à l'alerte de seuil, profondeur d'historique demandée par
 * une def, état d'évaluation affiché dans la liste et note du formulaire (au caractère près).
 */
import { describe, expect, it } from "vitest";
import { decrireAlerte, decrireCondition, validerComposite, type AlertDef, type Condition } from "@axiom/alerts";
import { INDICATORS, getIndicator } from "@axiom/indicators";
import {
  amorceAlerte,
  amorceAtteinte,
  cibleAlerte,
  construireConditionCroisement,
  construireConditionSeuil,
  evaluationAlerte,
  explicationMuette,
  INDICATEURS_CROISEMENT,
  INDICATEURS_SEUIL,
  noteAlerteSeuil,
  sansMarche,
  SORTIES_PRIX_STRATEGIE,
  sortiesAlerte,
  texteEvaluation,
} from "./alertsPanel.util";

/** Def minimale pour les tests de cible de navigation. */
function def(id: string, symbol: string, source: AlertDef["source"]): AlertDef {
  return {
    id,
    symbol,
    source,
    condition: { type: "prix-croise", niveau: 1, sens: "hausse" },
    actif: true,
    declenchements: [],
  };
}

describe("INDICATEURS_CROISEMENT", () => {
  it("ne retient que des indicateurs sur bougies seules avec au moins deux sorties", () => {
    expect(INDICATEURS_CROISEMENT.length).toBeGreaterThan(0);
    for (const d of INDICATEURS_CROISEMENT) {
      expect(d.outputs.length).toBeGreaterThanOrEqual(2);
      expect(d.aux === undefined || d.aux.length === 0).toBe(true);
    }
  });

  it("contient MACD (cas d'usage de référence : macd × signal)", () => {
    expect(INDICATEURS_CROISEMENT.map((d) => d.id)).toContain("macd");
  });

  it("exclut le volume piégé : longs ≥ 0 ≥ shorts par construction, aucun croisement réel", () => {
    // « hausse » se déclenchait à tort à chaque sortie d'un état 0/0, « baisse » jamais.
    expect(INDICATEURS_CROISEMENT.map((d) => d.id)).not.toContain("trappedVolume");
  });
});

describe("construireConditionCroisement", () => {
  it("construit la condition attendue par le moteur", () => {
    expect(construireConditionCroisement("macd", "macd", "signal", "hausse")).toEqual({
      type: "indicateur-croisement",
      indicateurId: "macd",
      params: {},
      outputA: "macd",
      outputB: "signal",
      sens: "hausse",
    });
  });

  it("refuse deux fois la même sortie (croisement d'une série avec elle-même)", () => {
    expect(construireConditionCroisement("macd", "macd", "macd", "hausse")).toBeNull();
  });

  it("refuse un indicateur inconnu", () => {
    expect(construireConditionCroisement("inconnu", "a", "b", "hausse")).toBeNull();
  });

  it("refuse une sortie absente de l'indicateur", () => {
    expect(construireConditionCroisement("macd", "macd", "fantome", "baisse")).toBeNull();
  });

  it("produit un libellé lisible via decrireCondition", () => {
    const c = construireConditionCroisement("macd", "macd", "signal", "hausse");
    expect(c).not.toBeNull();
    expect(decrireCondition(c!)).toBe("macd : macd croise à la hausse signal");
  });
});

describe("cibleAlerte", () => {
  it("retrouve symbole et source de la def d'un déclenchement", () => {
    const defs = [def("a1", "BTCUSDT", "binance"), def("a2", "ETHUSDT", "bybit")];
    expect(cibleAlerte(defs, "a2")).toEqual({ symbol: "ETHUSDT", source: "bybit" });
  });

  it("renvoie null si la def a été supprimée depuis le déclenchement", () => {
    expect(cibleAlerte([def("a1", "BTCUSDT", "binance")], "disparue")).toBeNull();
  });

  it("renvoie null pour une alerte baleines : son symbole est l'actif surveillé, pas un marché", () => {
    const baleines: AlertDef = { ...def("w1", "USDT", "binance"), condition: { type: "whale-flux", seuilUsd: 10_000_000, direction: "tous" } };
    expect(sansMarche(baleines.condition)).toBe(true);
    expect(cibleAlerte([baleines], "w1")).toBeNull();
    // Les alertes globales portent BTCUSDT, qui est un marché : elles gardent leur cible.
    const regime: AlertDef = { ...def("r1", "BTCUSDT", "binance"), condition: { type: "regime-seuil", comparateur: "<=", valeur: -1 } };
    const onchain: AlertDef = { ...def("o1", "BTCUSDT", "binance"), condition: { type: "onchain-seuil", metrique: "mvrv-z", comparateur: ">=", valeur: 3 } };
    for (const d of [regime, onchain, def("p1", "BTCUSDT", "binance")]) {
      expect(sansMarche(d.condition)).toBe(false);
      expect(cibleAlerte([d], d.id)).toEqual({ symbol: "BTCUSDT", source: "binance" });
    }
  });
});

describe("validerComposite", () => {
  it("accepte 2–4 sous-conditions atomiques, refuse whale-flux / les-deux / n=1", () => {
    const prix = { type: "prix-croise" as const, niveau: 100, sens: "hausse" as const };
    const fund = { type: "funding-extreme" as const, sens: "short-crowded" as const, zSeuil: 2 };
    expect(validerComposite([prix, fund])).toBe(true);
    expect(validerComposite([prix])).toBe(false);
    expect(validerComposite([{ type: "prix-croise", niveau: 1, sens: "les-deux" }, fund])).toBe(false);
    expect(validerComposite([prix, { type: "whale-flux", seuilUsd: 1, direction: "tous" }])).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────
// Phase 2 d'AXIS (12 novembre 2026) : sorties nommées, profondeur d'historique, état d'évaluation.
// ───────────────────────────────────────────────────────────────────────────────────────────

/** Les six stratégies de divergence dont la sortie est un oscillateur lisible au seuil. */
const DIVERGENCES = ["rsiDivergence", "macdDivergence", "stochDivergence", "mfiDivergence", "obvDivergence", "cvdDivergence"];
const SANS_AUX = INDICATORS.filter((d) => !d.aux || d.aux.length === 0);

describe("sortiesAlerte", () => {
  it("AXIS S/R : sorties nommées avec comparateur et valeur posés d'office, puis sorties brutes « Non mesuré · »", () => {
    expect(sortiesAlerte(getIndicator("stratAxisSr")!)).toEqual([
      { cle: "achat", libelle: "Signal d'achat", output: "etat", prereglage: { comparateur: ">=", valeur: 1 } },
      { cle: "vente", libelle: "Signal de vente", output: "etat", prereglage: { comparateur: "<=", valeur: 0 } },
      { cle: "reactionSupport", libelle: "Non mesuré · réaction sur support fort", output: "reactionSupport", prereglage: { comparateur: ">=", valeur: 1 }, nonMesuree: "precoce" },
      { cle: "reactionResistance", libelle: "Non mesuré · réaction sur résistance forte", output: "reactionResistance", prereglage: { comparateur: ">=", valeur: 1 }, nonMesuree: "precoce" },
      { cle: "score", libelle: "Non mesuré · Score (−6 à +6)", output: "score", nonMesuree: "brute" },
      { cle: "support", libelle: "Non mesuré · Support actif proche", output: "support", nonMesuree: "brute" },
      { cle: "resistance", libelle: "Non mesuré · Résistance active proche", output: "resistance", nonMesuree: "brute" },
    ]);
  });

  it("AXIS : signal d'achat, signal de vente, puis le score ; pas de réaction (il n'a pas ces sorties)", () => {
    expect(sortiesAlerte(getIndicator("stratAxis")!)).toEqual([
      { cle: "achat", libelle: "Signal d'achat", output: "etat", prereglage: { comparateur: ">=", valeur: 1 } },
      { cle: "vente", libelle: "Signal de vente", output: "etat", prereglage: { comparateur: "<=", valeur: 0 } },
      { cle: "score", libelle: "Non mesuré · Score (−6 à +6)", output: "score", nonMesuree: "brute" },
    ]);
  });

  it("le libellé d'alerte d'une sortie nommée est celui que son nom annonce", () => {
    const libelles = (id: string) => sortiesAlerte(getIndicator(id)!).filter((s) => s.prereglage).map((s) =>
      decrireAlerte({ condition: construireConditionSeuil(id, s.cle, ">", "")!, timeframe: "4h" }));
    expect(libelles("stratAxisSr")).toEqual([
      "AXIS S/R test 4h ≈ EMA 200 seule · signal d'achat",
      "AXIS S/R test 4h ≈ EMA 200 seule · signal de vente",
      "AXIS S/R non mesuré · réaction sur support fort",
      "AXIS S/R non mesuré · réaction sur résistance forte",
    ]);
    expect(libelles("stratAxis")).toEqual(["AXIS test 4h ≈ EMA 200 seule · signal d'achat", "AXIS test 4h ≈ EMA 200 seule · signal de vente"]);
  });

  it("aucune sortie proposée pour AXIS ou AXIS S/R sans mention : mesurée par son statut, ou « Non mesuré · »", () => {
    for (const id of ["stratAxis", "stratAxisSr"]) {
      for (const s of sortiesAlerte(getIndicator(id)!)) {
        if (s.output === "etat") expect(s.nonMesuree).toBeUndefined();
        else {
          expect(s.nonMesuree).toBeDefined();
          expect(s.libelle.startsWith("Non mesuré · ")).toBe(true);
        }
      }
    }
  });

  it("autres indicateurs : le nom de chaque sortie, sans préréglage", () => {
    expect(sortiesAlerte(getIndicator("rsi")!)).toEqual([{ cle: "rsi", libelle: "RSI", output: "rsi" }]);
    expect(sortiesAlerte(getIndicator("macd")!).map((s) => s.cle)).toEqual(getIndicator("macd")!.outputs.map((o) => o.key));
    for (const s of sortiesAlerte(getIndicator("macd")!)) expect(s.prereglage).toBeUndefined();
  });

  it("stratégies : prixEntree, prixSignal et stop ne sont jamais proposés ; les six divergences gardent leur sortie", () => {
    for (const d of SANS_AUX.filter((x) => x.category === "strategy")) {
      for (const s of sortiesAlerte(d)) expect(SORTIES_PRIX_STRATEGIE.has(s.output), `${d.id}.${s.output}`).toBe(false);
    }
    for (const id of DIVERGENCES) expect(sortiesAlerte(getIndicator(id)!).map((s) => s.output)).toEqual(getIndicator(id)!.outputs.map((o) => o.key));
    expect(DIVERGENCES.map((id) => sortiesAlerte(getIndicator(id)!)[0]?.output)).toEqual(["rsi", "osc", "k", "mfi", "obv", "cvd"]);
    // Une sortie « stop » ou « prix… » hors stratégie n'est pas concernée.
    expect(sortiesAlerte(getIndicator("rsi")!)).toHaveLength(1);
  });

  it("toute sortie non masquée d'une stratégie du registre est soit une sortie de prix exclue, soit celle d'une divergence", () => {
    // Garde-fou : une stratégie nouvelle qui exposerait un prix sous une autre clé ferait échouer ce test.
    for (const d of SANS_AUX.filter((x) => x.category === "strategy")) {
      for (const o of d.outputs.filter((x) => x.masquee !== true)) {
        expect(SORTIES_PRIX_STRATEGIE.has(o.key) || DIVERGENCES.includes(d.id), `${d.id}.${o.key}`).toBe(true);
      }
    }
  });
});

describe("INDICATEURS_SEUIL", () => {
  it("AXIS S/R puis AXIS en tête, puis l'ordre du registre", () => {
    expect(INDICATEURS_SEUIL.slice(0, 2).map((d) => d.id)).toEqual(["stratAxisSr", "stratAxis"]);
    const reste = INDICATEURS_SEUIL.slice(2).map((d) => d.id);
    expect(reste).toEqual(SANS_AUX.map((d) => d.id).filter((id) => reste.includes(id)));
    expect(new Set(INDICATEURS_SEUIL.map((d) => d.id)).size).toBe(INDICATEURS_SEUIL.length);
  });

  it("les 20 stratégies dont la seule sortie est le prix d'entrée ne sont plus proposées ; rien d'autre ne disparaît", () => {
    const absents = SANS_AUX.filter((d) => !INDICATEURS_SEUIL.includes(d));
    expect(absents).toHaveLength(20);
    for (const d of absents) {
      expect(d.category).toBe("strategy");
      expect(d.outputs.map((o) => o.key)).toEqual(["prixEntree"]);
    }
    expect(INDICATEURS_SEUIL).toHaveLength(SANS_AUX.length - 20);
    for (const id of [...DIVERGENCES, "rsi", "macd", "stratAxis", "stratAxisSr"]) expect(INDICATEURS_SEUIL.map((d) => d.id)).toContain(id);
  });

  it("aucun indicateur à série auxiliaire obligatoire (le runtime n'en injecte pas)", () => {
    for (const d of INDICATEURS_SEUIL) expect(d.aux === undefined || d.aux.length === 0).toBe(true);
  });
});

describe("construireConditionSeuil", () => {
  it("sortie nommée : comparateur et valeur du préréglage, quels que soient ceux du formulaire", () => {
    expect(construireConditionSeuil("stratAxisSr", "reactionSupport", "<", "")).toEqual({
      type: "indicateur-seuil", indicateurId: "stratAxisSr", params: {}, output: "reactionSupport", comparateur: ">=", valeur: 1,
    });
    expect(construireConditionSeuil("stratAxis", "vente", ">", "42")).toEqual({
      type: "indicateur-seuil", indicateurId: "stratAxis", params: {}, output: "etat", comparateur: "<=", valeur: 0,
    });
  });

  it("sortie brute : comparateur et valeur saisis ; saisie vide ou non numérique → null", () => {
    expect(construireConditionSeuil("rsi", "rsi", ">", "70")).toEqual({
      type: "indicateur-seuil", indicateurId: "rsi", params: {}, output: "rsi", comparateur: ">", valeur: 70,
    });
    expect(construireConditionSeuil("stratAxisSr", "score", ">=", "5")).toMatchObject({ output: "score", comparateur: ">=", valeur: 5 });
    expect(construireConditionSeuil("rsi", "rsi", ">", "")).toBeNull();
    expect(construireConditionSeuil("rsi", "rsi", ">", "  ")).toBeNull();
    expect(construireConditionSeuil("rsi", "rsi", ">", "abc")).toBeNull();
    expect(construireConditionSeuil("rsi", "rsi", ">", "0")).toMatchObject({ valeur: 0 });
  });

  it("indicateur ou entrée inconnus, sortie de prix d'une stratégie → null", () => {
    expect(construireConditionSeuil("inconnu", "x", ">", "1")).toBeNull();
    expect(construireConditionSeuil("rsi", "fantome", ">", "1")).toBeNull();
    expect(construireConditionSeuil("stratAxisSr", "prixSignal", ">", "0")).toBeNull();
    expect(construireConditionSeuil("stratAxis", "stop", ">", "0")).toBeNull();
  });
});

describe("explicationMuette", () => {
  const seuil = (indicateurId: string, output: string): Condition =>
    ({ type: "indicateur-seuil", indicateurId, params: {}, output, comparateur: ">", valeur: 0 });

  it("def existante sur une sortie de prix d'AXIS : expliquée, avec le remède", () => {
    expect(explicationMuette(seuil("stratAxisSr", "prixSignal"))).toBe(
      "Muette : « Prix d'achat » est un prix, gardé après la sortie de position ; un seuil dessus ne suit pas les signaux. Recréez l'alerte sur « Signal d'achat ».",
    );
    expect(explicationMuette(seuil("stratAxis", "stop"))).toContain("« Stop suiveur »");
  });

  it("stratégie sans sortie de signal : expliquée, sans remède inventé", () => {
    const fabrique = SANS_AUX.find((d) => d.category === "strategy" && d.outputs.length === 1 && d.outputs[0]?.key === "prixEntree")!;
    const texte = explicationMuette(seuil(fabrique.id, "prixEntree"));
    expect(texte).toMatch(/^Muette : « .+ » est un prix, gardé après la sortie de position ; un seuil dessus ne suit pas les signaux\.$/);
  });

  it("null pour tout le reste : sortie de signal, divergence, indicateur ordinaire, autre type de condition", () => {
    expect(explicationMuette(seuil("stratAxisSr", "etat"))).toBeNull();
    expect(explicationMuette(seuil("stratAxisSr", "reactionSupport"))).toBeNull();
    expect(explicationMuette(seuil("rsiDivergence", "rsi"))).toBeNull();
    expect(explicationMuette(seuil("rsi", "rsi"))).toBeNull();
    expect(explicationMuette({ type: "prix-croise", niveau: 1, sens: "hausse" })).toBeNull();
  });
});

describe("amorceAlerte et amorceAtteinte", () => {
  const seuil = (indicateurId: string, output: string): Condition =>
    ({ type: "indicateur-seuil", indicateurId, params: {}, output, comparateur: ">=", valeur: 1 });

  it("amorce déclarée par l'indicateur : 3 000 pour AXIS S/R, 1 500 pour AXIS, 0 sinon", () => {
    expect(amorceAlerte({ condition: seuil("stratAxisSr", "reactionSupport") })).toBe(3000);
    expect(amorceAlerte({ condition: seuil("stratAxis", "etat") })).toBe(1500);
    expect(amorceAlerte({ condition: seuil("rsi", "rsi") })).toBe(0);
    expect(amorceAlerte({ condition: seuil("inconnu", "x") })).toBe(0);
    expect(amorceAlerte({ condition: { type: "prix-croise", niveau: 1, sens: "hausse" } })).toBe(0);
    expect(amorceAlerte({ condition: { type: "variation-pct", fenetreMs: 60_000, seuilPct: 5 } })).toBe(0);
    expect(amorceAlerte({ condition: { type: "indicateur-croisement", indicateurId: "stratAxisSr", params: {}, outputA: "support", outputB: "resistance", sens: "hausse" } })).toBe(3000);
  });

  it("composite : la plus grande amorce de ses sous-conditions", () => {
    const composite = (...conditions: Condition[]): Condition => ({ type: "composite", conditions } as Condition);
    expect(amorceAlerte({ condition: composite({ type: "prix-croise", niveau: 1, sens: "hausse" }, seuil("stratAxis", "etat")) })).toBe(1500);
    expect(amorceAlerte({ condition: composite(seuil("stratAxis", "etat"), seuil("stratAxisSr", "etat")) })).toBe(3000);
    expect(amorceAlerte({ condition: composite({ type: "prix-croise", niveau: 1, sens: "hausse" }, seuil("rsi", "rsi")) })).toBe(0);
  });

  it("amorceAtteinte : dès que le tampon compte l'amorce ; toujours vrai sans amorce", () => {
    const axisSr = { condition: seuil("stratAxisSr", "reactionSupport") };
    expect(amorceAtteinte(axisSr, 2999)).toBe(false);
    expect(amorceAtteinte(axisSr, 3000)).toBe(true);
    expect(amorceAtteinte(axisSr, 3001)).toBe(true);
    expect(amorceAtteinte({ condition: seuil("rsi", "rsi") }, 0)).toBe(true);
  });
});

describe("evaluationAlerte et texteEvaluation", () => {
  // AXIS affiché sur la vue principale : le graphe a chargé son amorce, 1 500 bougies.
  const graphe = { exchange: "binance" as const, symbol: "BTCUSDT", timeframe: "4h" as const, bougies: 1500, indicateurs: ["stratAxis"] };
  const base = { source: "binance" as const, symbol: "BTCUSDT", timeframe: "4h" as const };
  const axis: Condition = { type: "indicateur-seuil", indicateurId: "stratAxis", params: {}, output: "etat", comparateur: ">=", valeur: 1 };
  const axisSr: Condition = { type: "indicateur-seuil", indicateurId: "stratAxisSr", params: {}, output: "reactionSupport", comparateur: ">=", valeur: 1 };
  const rsi: Condition = { type: "indicateur-seuil", indicateurId: "rsi", params: {}, output: "rsi", comparateur: ">", valeur: 70 };

  it("ici : le graphe principal affiche l'actif et l'unité, et le tampon a l'amorce", () => {
    expect(evaluationAlerte({ ...base, condition: axis }, graphe, false)).toEqual({ etat: "ici" });
    expect(evaluationAlerte({ ...base, condition: rsi }, { ...graphe, bougies: 2 }, false)).toEqual({ etat: "ici" });
    // Def héritée, sans unité : évaluée sur l'unité affichée.
    expect(evaluationAlerte({ ...base, timeframe: undefined, condition: rsi }, graphe, false)).toEqual({ etat: "ici" });
    expect(texteEvaluation({ etat: "ici" })).toBeNull();
  });

  it("hors graphe : autre actif, autre source ou autre unité", () => {
    for (const autre of [{ ...graphe, symbol: "ETHUSDT" }, { ...graphe, exchange: "bybit" as const }, { ...graphe, timeframe: "1h" as const }]) {
      expect(evaluationAlerte({ ...base, condition: axis }, autre, false)).toEqual({ etat: "hors-graphe" });
    }
    expect(texteEvaluation({ etat: "hors-graphe" })).toBe("hors graphe");
  });

  it("historique insuffisant : tampon plus court que l'amorce, au caractère près", () => {
    // AXIS S/R n'est pas sur la vue principale (seul AXIS l'est) : l'afficher fera charger ses 3 000 bougies.
    const evaluation = evaluationAlerte({ ...base, condition: axisSr }, graphe, false);
    expect(evaluation).toEqual({ etat: "historique", bougies: 1500, amorce: 3000, aAfficher: true });
    expect(texteEvaluation(evaluation)).toBe("historique insuffisant : 1500 sur 3000, affichez l'indicateur");
    expect(evaluationAlerte({ ...base, condition: axisSr }, { ...graphe, bougies: 3000 }, false)).toEqual({ etat: "ici" });
  });

  it("historique insuffisant, indicateur DÉJÀ affiché (chargement en cours, source à sec) : pas de remède qui ne peut pas marcher", () => {
    // Place qui ne sert que 1 200 bougies, AXIS affiché : le tampon s'arrête là, quoi que fasse l'opérateur.
    const aSec = evaluationAlerte({ ...base, condition: axis }, { ...graphe, bougies: 1200 }, false);
    expect(aSec).toEqual({ etat: "historique", bougies: 1200, amorce: 1500, aAfficher: false });
    expect(texteEvaluation(aSec)).toBe("historique insuffisant : 1200 sur 1500");
    // Frontière de l'amorce : une bougie de moins suffit à ne pas évaluer.
    expect(evaluationAlerte({ ...base, condition: axis }, { ...graphe, bougies: 1499 }, false)).toEqual({ etat: "historique", bougies: 1499, amorce: 1500, aAfficher: false });
    // Le même tampon sans AXIS sur la vue principale : là, l'afficher est le remède.
    const absent = evaluationAlerte({ ...base, condition: axis }, { ...graphe, bougies: 1200, indicateurs: ["rsi"] }, false);
    expect(texteEvaluation(absent)).toBe("historique insuffisant : 1200 sur 1500, affichez l'indicateur");
    // AXIS S/R affiché avec AXIS, source à sec à 2 000 bougies : rien à conseiller non plus.
    const srAffiche = evaluationAlerte({ ...base, condition: axisSr }, { ...graphe, bougies: 2000, indicateurs: ["stratAxis", "stratAxisSr"] }, false);
    expect(texteEvaluation(srAffiche)).toBe("historique insuffisant : 2000 sur 3000");
  });

  it("composite portant une condition de bougie : mêmes états ; sans condition de bougie : jamais « hors graphe »", () => {
    const composite: Condition = { type: "composite", conditions: [{ type: "prix-croise", niveau: 1, sens: "hausse" }, axisSr as Extract<Condition, { type: "indicateur-seuil" }>] };
    expect(evaluationAlerte({ ...base, condition: composite }, { ...graphe, symbol: "ETHUSDT" }, false)).toEqual({ etat: "hors-graphe" });
    expect(evaluationAlerte({ ...base, condition: composite }, graphe, false)).toEqual({ etat: "historique", bougies: 1500, amorce: 3000, aAfficher: true });
    // Composite AXIS + AXIS S/R, AXIS seul affiché sous son amorce : il reste AXIS S/R à afficher.
    const deux: Condition = { type: "composite", conditions: [axis as Extract<Condition, { type: "indicateur-seuil" }>, axisSr as Extract<Condition, { type: "indicateur-seuil" }>] };
    expect(evaluationAlerte({ ...base, condition: deux }, { ...graphe, bougies: 1200 }, false)).toEqual({ etat: "historique", bougies: 1200, amorce: 3000, aAfficher: true });
    expect(evaluationAlerte({ ...base, condition: deux }, { ...graphe, bougies: 1200, indicateurs: ["stratAxisSr", "stratAxis"] }, false))
      .toEqual({ etat: "historique", bougies: 1200, amorce: 3000, aAfficher: false });
    for (const condition of [
      { type: "prix-croise", niveau: 1, sens: "hausse" },
      { type: "funding-extreme", sens: "les-deux", zSeuil: 2 },
      { type: "regime-seuil", comparateur: "<=", valeur: -1 },
    ] as Condition[]) {
      expect(evaluationAlerte({ ...base, timeframe: undefined, condition }, { ...graphe, symbol: "ETHUSDT" }, false)).toEqual({ etat: "ici" });
    }
  });

  it("exception du daemon : sur Binance, une def 1m ou sans unité hors graphe reste évaluée par lui", () => {
    const ailleurs = { ...graphe, symbol: "ETHUSDT" };
    expect(evaluationAlerte({ ...base, timeframe: "1m", condition: rsi }, ailleurs, true)).toEqual({ etat: "ici" });
    expect(evaluationAlerte({ ...base, timeframe: undefined, condition: rsi }, ailleurs, true)).toEqual({ etat: "ici" });
    // Le daemon n'évalue ni le 4h, ni une autre source ; sans lui, rien n'évalue hors graphe.
    expect(evaluationAlerte({ ...base, timeframe: "4h", condition: rsi }, ailleurs, true)).toEqual({ etat: "hors-graphe" });
    expect(evaluationAlerte({ ...base, source: "bybit", timeframe: "1m", condition: rsi }, ailleurs, true)).toEqual({ etat: "hors-graphe" });
    expect(evaluationAlerte({ ...base, timeframe: "1m", condition: rsi }, ailleurs, false)).toEqual({ etat: "hors-graphe" });
  });

  it("exception du daemon : pas pour un composite réservé au front (CVD, régime), que le daemon écarte", () => {
    const ailleurs = { ...graphe, symbol: "ETHUSDT" };
    const variation = { type: "variation-pct", fenetreMs: 60_000, seuilPct: 1 } as const;
    const composite = (reservee: Extract<Condition, { type: "cvd-spot-perp-div" | "regime-seuil" }>): Condition =>
      ({ type: "composite", conditions: [reservee, variation] });
    for (const timeframe of ["1m", undefined] as const) {
      const cvd = { ...base, symbol: "ETHUSDT", timeframe, condition: composite({ type: "cvd-spot-perp-div", kind: "les-deux" }) };
      const regime = { ...base, symbol: "ETHUSDT", timeframe, condition: composite({ type: "regime-seuil", comparateur: "<=", valeur: -1 }) };
      // Même def que le daemon refuse (`evaluableDaemon`) : hors graphe, rien ne l'évalue.
      expect(evaluationAlerte(cvd, graphe, true)).toEqual({ etat: "hors-graphe" });
      expect(evaluationAlerte(regime, graphe, true)).toEqual({ etat: "hors-graphe" });
      // Un composite sans condition réservée garde l'exception.
      const ordinaire: Condition = { type: "composite", conditions: [{ type: "prix-croise", niveau: 1, sens: "hausse" }, variation] };
      expect(evaluationAlerte({ ...base, timeframe, condition: ordinaire }, ailleurs, true)).toEqual({ etat: "ici" });
    }
  });
});

describe("noteAlerteSeuil", () => {
  const marche = { symbol: "BTCUSDT", source: "binance" as const, timeframe: "4h" as const };
  const note = (id: string, cle: string, valeur = "", daemon = false, indicateursAffiches: string[] = []): string[] => {
    const sortie = sortiesAlerte(getIndicator(id)!).find((s) => s.cle === cle);
    return noteAlerteSeuil(construireConditionSeuil(id, cle, ">", valeur), sortie, marche, { daemonAlertes: daemon, indicateursAffiches });
  };

  it("réaction sur zone forte : portée, libellé exact, réserve du signal précoce, historique, réglages, ce qui ne sonne pas", () => {
    expect(note("stratAxisSr", "reactionSupport")).toEqual([
      "Évaluée à chaque clôture 4h, application ouverte sur BTCUSDT 4h.",
      "Libellé : AXIS S/R non mesuré · réaction sur support fort",
      "Signal précoce non mesuré — lecture indicative, jamais une promesse. Sonne aux bougies de réaction ; un signal confirmé sur la même bougie n'a pas de triangle creux.",
      "Évaluée seulement quand le graphe a chargé 3000 bougies : affichez AXIS S/R.",
      "Réglages par défaut de l'indicateur, pas ceux de l'instance du graphe.",
      "Rien ne sonne application fermée ou téléphone verrouillé.",
    ]);
  });

  it("signal d'achat d'AXIS : le libellé porte le statut de mesure, aucune réserve de signal précoce", () => {
    expect(note("stratAxis", "achat")).toEqual([
      "Évaluée à chaque clôture 4h, application ouverte sur BTCUSDT 4h.",
      "Libellé : AXIS test 4h ≈ EMA 200 seule · signal d'achat",
      "Évaluée seulement quand le graphe a chargé 1500 bougies : affichez AXIS.",
      "Réglages par défaut de l'indicateur, pas ceux de l'instance du graphe.",
      "Rien ne sonne application fermée ou téléphone verrouillé.",
    ]);
  });

  it("sortie brute d'AXIS S/R : « non mesuré » dans le libellé et dans la note", () => {
    expect(note("stratAxisSr", "score", "5")).toEqual([
      "Évaluée à chaque clôture 4h, application ouverte sur BTCUSDT 4h.",
      "Libellé : AXIS S/R non mesuré · Score (−6 à +6) > 5",
      "Sortie non mesurée — lecture indicative, jamais une promesse.",
      "Évaluée seulement quand le graphe a chargé 3000 bougies : affichez AXIS S/R.",
      "Réglages par défaut de l'indicateur, pas ceux de l'instance du graphe.",
      "Rien ne sonne application fermée ou téléphone verrouillé.",
    ]);
  });

  it("saisie incomplète : pas de libellé inventé ; indicateur ordinaire : ni réserve ni historique", () => {
    expect(note("rsi", "rsi")).toEqual([
      "Évaluée à chaque clôture 4h, application ouverte sur BTCUSDT 4h.",
      "Réglages par défaut de l'indicateur, pas ceux de l'instance du graphe.",
      "Rien ne sonne application fermée ou téléphone verrouillé.",
    ]);
    expect(note("rsi", "rsi", "70")).toEqual([
      "Évaluée à chaque clôture 4h, application ouverte sur BTCUSDT 4h.",
      "Libellé : rsi(rsi) > 70",
      "Réglages par défaut de l'indicateur, pas ceux de l'instance du graphe.",
      "Rien ne sonne application fermée ou téléphone verrouillé.",
    ]);
  });

  it("indicateur déjà sur la vue principale : l'historique demandé est dit sans « affichez … »", () => {
    expect(note("stratAxis", "achat", "", false, ["stratAxis"])).toEqual([
      "Évaluée à chaque clôture 4h, application ouverte sur BTCUSDT 4h.",
      "Libellé : AXIS test 4h ≈ EMA 200 seule · signal d'achat",
      "Évaluée seulement quand le graphe a chargé 1500 bougies.",
      "Réglages par défaut de l'indicateur, pas ceux de l'instance du graphe.",
      "Rien ne sonne application fermée ou téléphone verrouillé.",
    ]);
    // AXIS affiché ne dispense pas d'afficher AXIS S/R pour une alerte d'AXIS S/R.
    expect(note("stratAxisSr", "reactionSupport", "", false, ["stratAxis"])[3]).toBe("Évaluée seulement quand le graphe a chargé 3000 bougies : affichez AXIS S/R.");
  });

  it("daemon local présent : il n'est dit sonner que pour l'alerte qu'il évalue, 1m sur Binance", () => {
    const sortie = sortiesAlerte(getIndicator("stratAxis")!).find((s) => s.cle === "achat");
    const derniere = (source: "binance" | "bybit", timeframe: "1m" | "4h" | "1h", daemonAlertes: boolean): string | undefined =>
      noteAlerteSeuil(construireConditionSeuil("stratAxis", "achat", ">", ""), sortie, { symbol: "BTCUSDT", source, timeframe }, { daemonAlertes, indicateursAffiches: [] }).at(-1);
    expect(derniere("binance", "1m", true)).toBe("Application fermée : seul le daemon local sonne, en 1m sur Binance.");
    // Alerte 4h, ou hors Binance : le daemon ne l'évalue pas, rien ne sonne application fermée.
    const rien = "Rien ne sonne application fermée ou téléphone verrouillé : le daemon local n'évalue que le 1m sur Binance.";
    expect(derniere("binance", "4h", true)).toBe(rien);
    expect(derniere("binance", "1h", true)).toBe(rien);
    expect(derniere("bybit", "1m", true)).toBe(rien);
    // Sans daemon (téléphone, Vercel) : la phrase nue, quelle que soit l'alerte.
    expect(derniere("binance", "1m", false)).toBe("Rien ne sonne application fermée ou téléphone verrouillé.");
    expect(derniere("binance", "4h", false)).toBe("Rien ne sonne application fermée ou téléphone verrouillé.");
  });

  it("chaque note d'AXIS ou d'AXIS S/R dit « non mesuré » ou porte un statut de mesure, dans toutes les unités", () => {
    for (const id of ["stratAxis", "stratAxisSr"]) {
      for (const s of sortiesAlerte(getIndicator(id)!)) {
        for (const timeframe of ["1m", "1h", "4h", "1d", "1w"] as const) {
          const lignes = noteAlerteSeuil(construireConditionSeuil(id, s.cle, ">=", "1"), s, { symbol: "ETHUSDT", source: "binance", timeframe }, { daemonAlertes: false, indicateursAffiches: [] });
          const libelle = lignes.find((l) => l.startsWith("Libellé : "))!;
          expect(libelle, `${id}.${s.cle} ${timeframe}`).toMatch(/non mesuré|test échoué|test 4h ≈ EMA 200 seule/);
          expect(lignes[0]).toBe(`Évaluée à chaque clôture ${timeframe}, application ouverte sur ETHUSDT ${timeframe}.`);
        }
      }
    }
  });
});

describe("cibleAlerte — unité de la def", () => {
  it("rend aussi l'unité quand la def en porte une", () => {
    const d: AlertDef = { ...def("a3", "BTCUSDT", "binance"), timeframe: "4h" };
    expect(cibleAlerte([d], "a3")).toEqual({ symbol: "BTCUSDT", source: "binance", timeframe: "4h" });
    expect(cibleAlerte([def("a1", "BTCUSDT", "binance")], "a1")).not.toHaveProperty("timeframe");
  });
});
