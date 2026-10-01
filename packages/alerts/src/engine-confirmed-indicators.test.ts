import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { evaluerAlertes } from "./engine";
import type { AlertDef, Condition, ConditionSimple } from "./types";

const candle = (time: number, close: number): Candle => ({ time, open: close, high: close, low: close, close, volume: 1 });
const barreNR = (i: number, high: number, low: number): Candle => ({ ...candle(i * 60_000, (high + low) / 2), high, low });
const nr = [barreNR(0, 110, 100), barreNR(1, 109, 101), barreNR(2, 110, 102)];
const dd = [100, 80, 80].map((close, i) => candle(i * 60_000, close));
let close = 100;
const acf = [0, -0.01, 0.01, -0.01, 0.01].map((r, i) => { close *= Math.exp(r); return candle(i * 60_000, close); });

const cas: Array<{
  nom: string; id: string; output: string; length: number; candles: Candle[];
  invalide: Candle; reprise: Candle[]; vraie: Pick<Extract<Condition, { type: "indicateur-seuil" }>, "comparateur" | "valeur">;
}> = [
  { nom: "NR bougie non clôturée", id: "narrowRange", output: "nr", length: 2, candles: nr,
    invalide: { ...barreNR(3, 110, 102), closed: false }, reprise: [barreNR(4, 110, 102), barreNR(5, 110, 102)], vraie: { comparateur: ">=", valeur: 1 } },
  { nom: "ACF pas irrégulier", id: "returnAutocorrelation", output: "acf", length: 4, candles: acf,
    invalide: candle(360_000, acf[4]!.close), reprise: [-0.01, 0, -0.01, 0].map((r, i) => candle(420_000 + i * 60_000, acf[4]!.close * Math.exp(r))), vraie: { comparateur: "<", valeur: -0.5 } },
  { nom: "repli clôture nulle", id: "rollingDrawdown", output: "drawdown", length: 3, candles: dd,
    invalide: candle(180_000, 0), reprise: [100, 80, 80].map((c, i) => candle(240_000 + i * 60_000, c)), vraie: { comparateur: "<", valeur: -10 } },
];

function alerte(condition: ConditionSimple, composite: boolean, arme?: boolean): AlertDef {
  return { id: "confirmée", symbol: "BTCUSDT", source: "binance", actif: true, arme, declenchements: [],
    condition: composite ? { type: "composite", conditions: [{ type: "prix-croise", sens: "hausse", niveau: 1 }, condition] } : condition };
}
function evaluer(def: AlertDef, candles: Candle[]) {
  return evaluerAlertes([def], { maintenant: candles.length * 60_000, dernierPrix: 100, candles });
}

describe.each([false, true])("nouveaux indicateurs confirmés — composite=%s", (composite) => {
  it.each(cas.flatMap((c) => [true, false, undefined].flatMap((arme) => [true, false].map((satisfaite) => ({ ...c, arme, satisfaite })))))
  ("$nom, arme=$arme, ancien seuil satisfait=$satisfaite : aucune reprise d'une valeur ancienne", (c) => {
    const condition: ConditionSimple = { type: "indicateur-seuil", indicateurId: c.id, params: { length: c.length }, output: c.output,
      ...(c.satisfaite ? c.vraie : { comparateur: ">", valeur: 2 }) };
    const def = alerte(condition, composite, c.arme);
    const r = evaluer(def, [...c.candles, c.invalide]);
    expect(r.declenchements).toEqual([]);
    expect(r.modifie).toBe(false);
    expect(r.defs[0]).toBe(def); // ni calibrage, ni réarmement, ni mutation.
  });

  it.each(cas)("$nom : reste armée pendant le trou puis déclenche quand la fenêtre redevient valide", (c) => {
    const condition: ConditionSimple = { type: "indicateur-seuil", indicateurId: c.id, params: { length: c.length }, output: c.output, ...c.vraie };
    const def = alerte(condition, composite, true);
    const trou = [...c.candles, c.invalide];
    expect(evaluer(def, trou).defs[0]).toBe(def);
    for (let i = 1; i < c.reprise.length; i++) {
      expect(evaluer(def, [...trou, ...c.reprise.slice(0, i)]).defs[0]).toBe(def);
    }
    const r = evaluer(def, [...trou, ...c.reprise]);
    expect(r.declenchements).toHaveLength(1);
    expect(r.defs[0]?.arme).toBe(false);
  });

  const croisement: ConditionSimple = { type: "indicateur-croisement", indicateurId: "narrowRange", params: { length: 2 }, outputA: "nr", outputB: "inside", sens: "hausse" };
  it("détecte un vrai croisement NR/Inside sur les deux indices courants, sans le rejouer après une bougie ouverte", () => {
    const def = alerte(croisement, composite, true);
    expect(evaluer(def, nr).declenchements).toHaveLength(1); // 1=1 puis 1>0.
    const resultat = evaluer(def, [...nr, { ...barreNR(3, 110, 102), closed: false }]);
    expect(resultat.declenchements).toEqual([]);
    expect(resultat.defs[0]).toBe(def);
  });

  it.each(cas.flatMap((c) => [false, undefined].map((arme) => ({ ...c, arme }))))
  ("$nom : un croisement indisponible ne calibre ni ne réarme (arme=$arme)", (c) => {
    const condition: ConditionSimple = { type: "indicateur-croisement", indicateurId: c.id, params: { length: c.length }, outputA: c.output, outputB: c.output, sens: "les-deux" };
    // Deux résultats déjà calculables pour que le comportement historique recule.
    const prets = [...c.candles, ...c.reprise.map((b, i) => ({ ...b, time: (c.candles.length + i) * 60_000 }))];
    const candles = [...prets, { ...prets.at(-1)!, time: prets.length * 60_000, closed: false }];
    const def = alerte(condition, composite, c.arme);
    const r = evaluer(def, candles);
    expect(r.declenchements).toEqual([]);
    expect(r.modifie).toBe(false);
    expect(r.defs[0]).toBe(def);
  });

  it("un croisement ne calibre pas si seule la dernière paire est définie", () => {
    const def = alerte(croisement, composite);
    expect(evaluer(def, nr.slice(0, 2)).defs[0]).toBe(def);
  });
});

describe("compatibilité de la lecture historique des anciens indicateurs", () => {
  it.each([false, true])("ROC garde sa dernière valeur disponible (composite=%s)", (composite) => {
    // Le zéro rend le dernier ROC absent, mais l'ancien moteur lit encore −100 %.
    const candles = [100, 200, 0, 0].map((c, i) => candle(i * 60_000, c));
    const condition: ConditionSimple = { type: "indicateur-seuil", indicateurId: "roc", params: { length: 1 }, output: "roc", comparateur: "<=", valeur: -100 };
    const r = evaluer(alerte(condition, composite, true), candles);
    expect(r.declenchements).toHaveLength(1);
  });
});
