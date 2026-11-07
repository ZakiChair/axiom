/**
 * Tests de data/screenerRegles.ts : catalogue ouvert (flux, force relative), validation
 * (unités, fenêtre, causalité, séries aux), amorce, évaluation sur bougies closes,
 * causalité par préfixe, données absentes, parité avec les définitions du registre.
 * Fixtures déterministes, aucun réseau.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator, getIndicator, sma } from "@axiom/indicators";
import type { Operande } from "@axiom/backtest";
import {
  BUILTIN_PRESETS,
  deriveScalar,
  INDICATOR_FIELDS,
  type ConditionChamp,
  type ConditionRegle,
  type IndicatorCondition,
} from "./screener";
import {
  amorceCondition,
  besoinReference,
  caleSurReference,
  champParId,
  CHAMPS_SUPPLEMENTAIRES,
  evaluerCondition,
  FENETRE_MAX,
  instancesPourGraphe,
  libelleCondition,
  lireFenetre,
  PRESETS_DESCRIPTIFS,
  raisonCondition,
  raisonConditions,
  serieCondition,
  TOUS_LES_CHAMPS,
  uniteCondition,
  valeursChamp,
} from "./screenerRegles";

/** Générateur pseudo-aléatoire déterministe (LCG). */
function lcg(graine: number): () => number {
  let s = graine >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Bougies closes : marche aléatoire, volume taker renseigné. */
function bougies(n: number, graine = 7, pasMs = 14_400_000, depart = 100): Candle[] {
  const alea = lcg(graine);
  const out: Candle[] = [];
  let prix = depart;
  for (let i = 0; i < n; i++) {
    const open = prix;
    // Alternance de phases calmes et agitées : le squeeze TTM s'allume et s'éteint.
    const vol = Math.floor(i / 40) % 2 === 0 ? 0.004 : 0.03;
    const close = open * (1 + (alea() - 0.5) * 2 * vol);
    const high = Math.max(open, close) * (1 + alea() * vol);
    const low = Math.min(open, close) * (1 - alea() * vol);
    const volume = 1000 + alea() * 4000 + (i % 37 === 0 ? 20_000 : 0);
    const buyVolume = volume * (0.3 + alea() * 0.4);
    out.push({
      time: 1_700_000_000_000 + i * pasMs,
      open,
      high,
      low,
      close,
      volume,
      buyVolume,
      sellVolume: volume - buyVolume,
      closed: true,
    });
    prix = close;
  }
  return out;
}

const ind = (indicateurId: string, params: Record<string, number>, output: string): Operande => ({
  type: "indicateur",
  indicateurId,
  params,
  output,
});
const cst = (valeur: number): Operande => ({ type: "constante", valeur });
const close: Operande = { type: "prix", champ: "close" };

const regle = (condition: ConditionRegle["condition"], extra: Partial<ConditionRegle> = {}): ConditionRegle => ({
  kind: "regle",
  condition,
  ...extra,
});
const champ = (fieldId: string, op: ConditionChamp["op"], value: number, extra: Partial<ConditionChamp> = {}): ConditionChamp => ({
  kind: "indicator",
  fieldId,
  op,
  value,
  ...extra,
});

describe("catalogue ouvert", () => {
  it("chaque champ ajouté pointe une sortie existante du registre, ids uniques", () => {
    for (const spec of CHAMPS_SUPPLEMENTAIRES) {
      const def = getIndicator(spec.indicatorId);
      expect(def, spec.indicatorId).toBeDefined();
      expect(def?.outputs.some((o) => o.key === spec.output), `${spec.indicatorId}.${spec.output}`).toBe(true);
    }
    const ids = TOUS_LES_CHAMPS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(champParId("rsi")).toBe(INDICATOR_FIELDS[0]);
    expect(champParId("rsMansfield")?.tfImpose).toBe("1d");
  });

  it("unité : imposée par le champ, sinon celle de la condition, sinon celle du run", () => {
    expect(uniteCondition(champ("rsMansfield", ">", 0, { tf: "1h" }), "4h")).toBe("1d");
    expect(uniteCondition(champ("rsi", "<", 30, { tf: "1d" }), "4h")).toBe("1d");
    expect(uniteCondition(champ("rsi", "<", 30), "4h")).toBe("4h");
  });

  it("besoinReference ne vise que la force relative", () => {
    expect(besoinReference([champ("rsi", "<", 30)])).toBe(false);
    expect(besoinReference([champ("rsZ", ">", 1)])).toBe(true);
  });
});

describe("validation", () => {
  it("accepte un champ et une règle ordinaires", () => {
    expect(raisonCondition(champ("rsi", "<", 30), "4h")).toBeNull();
    expect(raisonCondition(regle({ type: "comparaison", gauche: close, comparateur: ">", droite: ind("ema", { length: 200 }, "ema") }), "4h")).toBeNull();
  });

  it("borne la fenêtre K et l'unité", () => {
    expect(raisonCondition(champ("rsi", "<", 30, { fenetre: 0 }), "4h")).toMatch(/fenêtre K/);
    expect(raisonCondition(champ("rsi", "<", 30, { fenetre: FENETRE_MAX + 1 }), "4h")).toMatch(/fenêtre K/);
    expect(raisonCondition(champ("rsi", "<", 30, { fenetre: 1.5 }), "4h")).toMatch(/fenêtre K/);
    expect(raisonCondition(champ("rsi", "<", 30, { tf: "1w" }), "4h")).toMatch(/unité 1w/);
  });

  it("refuse sorties non causales, séries aux, sorties inconnues et contrat d'unité", () => {
    expect(raisonCondition(regle({ type: "comparaison", gauche: ind("fractals", {}, "up"), comparateur: ">", droite: cst(0) }), "4h")).toMatch(/non causale/);
    expect(raisonCondition(regle({ type: "comparaison", gauche: ind("stratAxis", {}, "etat"), comparateur: ">", droite: cst(0) }), "4h")).toMatch(/auxiliaire|amorce/);
    expect(raisonCondition(regle({ type: "comparaison", gauche: ind("spreadZScore", {}, "z"), comparateur: ">", droite: cst(0) }), "4h")).toMatch(/auxiliaire/);
    expect(raisonCondition(regle({ type: "comparaison", gauche: ind("ema", {}, "nope"), comparateur: ">", droite: cst(0) }), "4h")).toMatch(/sortie inconnue/);
    const rvolH = regle({ type: "comparaison", gauche: ind("rvolSeasonal", {}, "rvol"), comparateur: ">", droite: cst(2) });
    expect(raisonCondition(rvolH, "4h")).toMatch(/1h/);
    expect(raisonCondition(rvolH, "1h")).toBeNull();
    expect(raisonCondition(champ("inconnu", ">", 0), "4h")).toMatch(/champ inconnu/);
    expect(raisonCondition(champ("cvdPente", ">", 0, { param: 500 }), "4h")).toMatch(/pente/);
    expect(raisonCondition(champ("rvol", ">", Number.NaN), "4h")).toMatch(/seuil/);
  });

  it("au plus une unité en plus de celle du run", () => {
    const st1d = regle({ type: "comparaison", gauche: ind("supertrend", { period: 10, multiplier: 3 }, "direction"), comparateur: ">", droite: cst(0) }, { tf: "1d" });
    expect(raisonConditions([champ("rsi", "<", 30), st1d], "4h")).toBeNull();
    expect(raisonConditions([champ("rsi", "<", 30, { tf: "1h" }), st1d], "4h")).toMatch(/Au plus une unité/);
    expect(raisonConditions([champ("rsi", "<", 30), champ("rsi", "<", 30, { fenetre: 0 })], "4h")).toMatch(/^Condition 2 :/);
  });
});

describe("amorce", () => {
  it("≈ 4 × la longueur pour les lissages, la fenêtre pour les moyennes finies, + K + 1", () => {
    expect(amorceCondition(regle({ type: "comparaison", gauche: close, comparateur: ">", droite: ind("ema", { length: 200 }, "ema") }), "4h")).toBe(802);
    expect(amorceCondition(champ("rsi", "<", 30, { param: 14, fenetre: 3 }), "4h")).toBe(56 + 3 + 1);
    expect(amorceCondition(champ("rsMansfield", ">", 0), "1d")).toBe(364 + 1 + 1);
    expect(amorceCondition(champ("cvdPente", ">", 0, { param: 5 }), "4h")).toBe(1 + 5 + 1 + 1);
  });

  it("RVOL saisonnier : historique en JOURS converti en bougies de l'unité (84 j = 2016 bougies 1h)", () => {
    // Opérande du catalogue (paramètres fixes : défauts du def, 84 jours).
    const rvolH = regle({ type: "comparaison", gauche: ind("rvolSeasonal", {}, "rvol"), comparateur: ">", droite: cst(2) });
    expect(amorceCondition(rvolH, "1h")).toBe(84 * 24 + 1 + 1);
    expect(amorceCondition(regle(rvolH.condition, { fenetre: 5 }), "1h")).toBe(84 * 24 + 5 + 1);
    const rvol30 = regle({ type: "comparaison", gauche: ind("rvolSeasonal", { jours: 30 }, "rvol"), comparateur: ">", droite: cst(2) });
    expect(amorceCondition(rvol30, "1h")).toBe(30 * 24 + 1 + 1);
    // Jamais pris pour un nombre de bougies (ancienne heuristique : 4 × 84 + 2 = 338).
    expect(amorceCondition(rvolH, "1h")).not.toBe(338);
  });
});

describe("RVOL saisonnier : amorce plafonnée = historique réduit, jamais une parité annoncée", () => {
  // 2500 bougies 1h, volume en dents de scie par heure UTC et en tendance sur les jours :
  // la moyenne des mêmes heures dépend de la profondeur d'historique.
  const H1 = 3_600_000;
  const longues: Candle[] = Array.from({ length: 2500 }, (_, i) => {
    const volume = 1000 + 40 * Math.floor(i / 24) + ((i * 7) % 24) * 30;
    return { time: 1_700_000_000_000 + i * H1, open: 1, high: 1, low: 1, close: 1, volume, closed: true };
  });
  const rvolH = regle({ type: "comparaison", gauche: ind("rvolSeasonal", {}, "rvol"), comparateur: ">", droite: cst(0) });

  it("une amorce complète (2018 bougies) redonne la valeur de l'historique long", () => {
    const complet = evaluerCondition(rvolH, longues, { tf: "1h" }).valeur!;
    const amorce = amorceCondition(rvolH, "1h");
    expect(evaluerCondition(rvolH, longues.slice(-amorce), { tf: "1h" }).valeur).toBeCloseTo(complet, 12);
  });

  it("999 bougies (plafond d'une requête) donnent une autre valeur : d'où la note « amorce plafonnée »", () => {
    const complet = evaluerCondition(rvolH, longues, { tf: "1h" }).valeur!;
    const plafonne = evaluerCondition(rvolH, longues.slice(-999), { tf: "1h" }).valeur!;
    expect(Math.abs(plafonne - complet) / complet).toBeGreaterThan(0.01);
  });
});

describe("évaluation sur bougies closes", () => {
  const candles = bougies(300);
  const ctx = { tf: "4h" as const };

  it("champs historiques : même valeur que deriveScalar sur la dernière bougie close", () => {
    for (const spec of INDICATOR_FIELDS) {
      const cond = champ(spec.id, ">", Number.NEGATIVE_INFINITY);
      const params: Record<string, number> = spec.paramKey && spec.defaultParam ? { [spec.paramKey]: spec.defaultParam } : {};
      const serie = computeIndicator(getIndicator(spec.indicatorId)!, candles, params).series[spec.output]!;
      const attendu = deriveScalar(spec, serie, candles[candles.length - 1]!.close);
      const lecture = evaluerCondition(cond, candles, ctx);
      expect(lecture.vraie, spec.id).toBe(true);
      expect(lecture.valeur, spec.id).toBeCloseTo(attendu!, 10);
    }
  });

  it("règle : comparaison close > EMA identique au calcul direct", () => {
    const ema = computeIndicator(getIndicator("ema")!, candles, { length: 50 }).series.ema!;
    const s = serieCondition(regle({ type: "comparaison", gauche: close, comparateur: ">", droite: ind("ema", { length: 50 }, "ema") }), candles, ctx);
    for (let i = 0; i < candles.length; i++) {
      const e = ema[i];
      expect(s.etat[i]).toBe(e === undefined ? undefined : candles[i]!.close > e);
    }
  });

  it("sortie de squeeze = croisement de `on` sous 0,5, aux transitions 1 → 0 du registre", () => {
    const on = computeIndicator(getIndicator("ttmSqueeze")!, candles, { length: 20, multBB: 2, multKC: 1.5 }).series.on!;
    const s = serieCondition(
      regle({ type: "croisement", a: ind("ttmSqueeze", { length: 20, multBB: 2, multKC: 1.5 }, "on"), b: cst(0.5), sens: "baisse" }),
      candles,
      ctx,
    );
    let transitions = 0;
    for (let i = 1; i < candles.length; i++) {
      const attendu = on[i - 1] === undefined || on[i] === undefined ? undefined : on[i - 1] === 1 && on[i] === 0;
      expect(s.etat[i], `bougie ${i}`).toBe(attendu);
      if (attendu === true) transitions++;
    }
    expect(transitions).toBeGreaterThan(0); // la fixture contient bien des sorties de squeeze
  });

  it("fenêtre K : vraie si au moins une des K dernières bougies l'est, la plus récente retenue", () => {
    const serie = { etat: [true, false, true, false, false], valeur: [1, 2, 3, 4, 5] };
    expect(lireFenetre(serie, 1)).toEqual({ vraie: false, valeur: 5 });
    expect(lireFenetre(serie, 2)).toEqual({ vraie: false, valeur: 5 });
    expect(lireFenetre(serie, 3)).toEqual({ vraie: true, valeur: 3, barresDepuis: 2 });
    expect(lireFenetre(serie, 50)).toEqual({ vraie: true, valeur: 3, barresDepuis: 2 });
    expect(lireFenetre({ etat: [], valeur: [] }, 3)).toEqual({ vraie: false, valeur: undefined });
  });

  it("flux : RVOL, taker net et pente CVD normalisée lus sur la bougie close", () => {
    const der = candles[candles.length - 1]!;
    const takerNet = evaluerCondition(champ("takerNet", ">", -101), candles, ctx);
    expect(takerNet.valeur).toBeCloseTo((100 * (der.buyVolume! - der.sellVolume!)) / der.volume, 10);
    const n = 3;
    const fen = candles.slice(-n);
    const attendu = (100 * fen.reduce((s, c) => s + c.buyVolume! - c.sellVolume!, 0)) / fen.reduce((s, c) => s + c.volume, 0);
    expect(evaluerCondition(champ("cvdPente", ">", -101, { param: n }), candles, ctx).valeur).toBeCloseTo(attendu, 8);
    const vols = candles.map((c) => c.volume);
    const moy = sma(vols, 20)[candles.length - 1]!;
    expect(evaluerCondition(champ("rvol", ">", 0), candles, ctx).valeur).toBeCloseTo(der.volume / moy, 10);
  });

  it("donnée absente = indisponible, jamais 0", () => {
    const sansTaker = candles.map(({ buyVolume: _b, sellVolume: _s, ...c }) => c);
    expect(evaluerCondition(champ("takerNet", ">", -101), sansTaker, ctx)).toEqual({ vraie: false, valeur: undefined });
    expect(evaluerCondition(champ("cvdPente", ">", -101), sansTaker, ctx)).toEqual({ vraie: false, valeur: undefined });
    // Un trou de volume taker n'invalide que les fenêtres qui le contiennent.
    const trou = candles.map((c, i) => (i === candles.length - 10 ? { ...c, buyVolume: undefined, sellVolume: undefined } : c));
    const v = valeursChamp(champ("cvdPente", ">", 0, { param: 3 }), trou, ctx);
    expect(v[candles.length - 10]).toBeUndefined();
    expect(v[candles.length - 8]).toBeUndefined();
    expect(v[candles.length - 7]).toBeDefined();
    // Référence indisponible : force relative non évaluée.
    expect(evaluerCondition(champ("rsZ", ">", -10), candles, { tf: "4h", ref: null }).valeur).toBeUndefined();
    expect(evaluerCondition(champ("rsMansfield", ">", -100), candles, { tf: "1d", ref: null }).valeur).toBeUndefined();
  });
});

describe("force relative", () => {
  const ref = bougies(500, 11, 86_400_000, 30_000);
  const actif = bougies(500, 23, 86_400_000, 2);
  const ctx = { tf: "1d" as const, ref };

  it("Mansfield = 100 × (rs ÷ SMA(rs, n) − 1) sur le ratio close ÷ référence", () => {
    const rs = actif.map((c, i) => c.close / ref[i]!.close);
    const moy = sma(rs, 364);
    const v = valeursChamp(champ("rsMansfield", ">", 0), actif, ctx);
    for (const i of [363, 400, 499]) expect(v[i]).toBeCloseTo(100 * (rs[i]! / moy[i]! - 1), 9);
    expect(v[362]).toBeUndefined();
  });

  it("test de construction : X = référence × c donne un Mansfield nul et un z ≈ 0 (spread plat)", () => {
    const x = ref.map((c) => ({ ...c, open: c.open * 3, high: c.high * 3, low: c.low * 3, close: c.close * 3 }));
    const m = evaluerCondition(champ("rsMansfield", ">=", -1e-9), x, ctx);
    expect(m.vraie).toBe(true);
    expect(Math.abs(m.valeur!)).toBeLessThan(1e-9);
    // spreadZScore ne rend « indéfini » qu'un spread EXACTEMENT plat : ln(3c) − ln(c)
    // garde un bruit d'arrondi, d'où un z minuscule plutôt qu'absent.
    expect(Math.abs(evaluerCondition(champ("rsZ", ">", -100), x, ctx).valeur ?? 0)).toBeLessThan(1e-6);
  });

  it("z de spreadZScore avec refClose aligné passé à computeIndicator", () => {
    const z = computeIndicator(getIndicator("spreadZScore")!, actif, { length: 100 }, { refClose: ref.map((c) => c.close) }).series.z!;
    expect(evaluerCondition(champ("rsZ", ">", -100), actif, ctx).valeur).toBeCloseTo(z[499]!, 10);
  });

  it("calage sur la référence : la dernière bougie lue a toujours sa bougie de référence", () => {
    // Référence en retard d'une bougie (chargée avant une clôture) : la dernière est retirée.
    const enRetard = caleSurReference(actif, ref.slice(0, -1));
    expect(enRetard.retirees).toBe(1);
    expect(enRetard.candles).toEqual(actif.slice(0, -1));
    // Référence à jour : bougies inchangées (même tableau, rien à recopier).
    expect(caleSurReference(actif, ref)).toEqual({ candles: actif, retirees: 0 });
    // Symbole arrêté plus tôt que la référence : rien à retirer.
    expect(caleSurReference(actif.slice(0, 300), ref).retirees).toBe(0);
    // Aucune heure commune : aucune bougie, jamais une référence d'une autre heure.
    expect(caleSurReference(actif, ref.map((c) => ({ ...c, time: c.time + 1 })))).toEqual({ candles: [], retirees: 500 });
    // Après calage, le z lu égale celui des deux séries appariées exactement.
    const zCale = evaluerCondition(champ("rsZ", ">", -100), enRetard.candles, { tf: "1d", ref: ref.slice(0, -1) }).valeur;
    const zExact = evaluerCondition(champ("rsZ", ">", -100), actif.slice(0, -1), { tf: "1d", ref: ref.slice(0, -1) }).valeur;
    expect(zCale).toBe(zExact);
  });

  it("référence plus courte que l'actif : valeurs seulement là où le ratio existe", () => {
    const courte = ref.slice(100);
    const v = valeursChamp(champ("rsMansfield", ">", 0, { param: 50 }), actif, { tf: "1d", ref: courte });
    expect(v.slice(0, 149).every((x) => x === undefined)).toBe(true);
    expect(v[149]).toBeDefined();
  });
});

describe("causalité par préfixe", () => {
  const candles = bougies(320, 5);
  const ref = bougies(320, 9, 14_400_000, 500);
  const conditions: IndicatorCondition[] = [
    champ("rsi", "<", 45, { fenetre: 3 }),
    champ("emaDist", ">", 0),
    champ("cvdPente", ">", 0, { param: 4 }),
    champ("rvol", ">", 1.5),
    champ("rsZ", ">", 0, { param: 50 }),
    champ("rsMansfield", ">", 0, { param: 60 }),
    regle({ type: "croisement", a: ind("ttmSqueeze", { length: 20, multBB: 2, multKC: 1.5 }, "on"), b: cst(0.5), sens: "baisse" }),
    regle({ type: "croisement", a: close, b: ind("ema", { length: 30 }, "ema"), sens: "hausse" }),
    regle({ type: "comparaison", gauche: ind("supertrend", { period: 10, multiplier: 3 }, "direction"), comparateur: ">", droite: cst(0) }),
    regle({ type: "comparaison", gauche: ind("narrowRange", { length: 7 }, "nr"), comparateur: ">=", droite: cst(1) }),
  ];

  it("l'état des N premières bougies ne change pas quand on en ajoute", () => {
    for (const cond of conditions) {
      const complet = serieCondition(cond, candles, { tf: "4h", ref });
      for (const n of [120, 200, 280]) {
        const prefixe = serieCondition(cond, candles.slice(0, n), { tf: "4h", ref: ref.slice(0, n) });
        expect(prefixe.etat, `${libelleCondition(cond, "4h")} @${n}`).toEqual(complet.etat.slice(0, n));
        expect(prefixe.valeur, `${libelleCondition(cond, "4h")} @${n}`).toEqual(complet.valeur.slice(0, n));
      }
    }
  });
});

describe("libellés et ouverture au graphe", () => {
  const st1d = regle({ type: "comparaison", gauche: ind("supertrend", { period: 10, multiplier: 3 }, "direction"), comparateur: ">", droite: cst(0) }, { tf: "1d" });

  it("libellés compacts avec unité propre et fenêtre", () => {
    expect(libelleCondition(st1d, "4h")).toBe("supertrend.direction(10, 3) > 0 [1d]");
    expect(libelleCondition(champ("rvol", ">=", 3, { param: 20, fenetre: 3 }), "4h")).toBe("RVOL(20) · 3 b.");
    expect(libelleCondition(regle({ type: "croisement", a: close, b: ind("ema", { length: 20 }, "ema"), sens: "hausse" }), "4h")).toBe("close croise ↑ ema(20)");
  });

  it("instances : conditions de l'unité du run seulement, sans doublon ni ratio", () => {
    const instances = instancesPourGraphe(
      [
        champ("rsi", "<", 30, { param: 14 }),
        champ("rsi", ">", 10, { param: 14 }),
        champ("cvdPente", ">", 0, { param: 3 }),
        champ("rsMansfield", ">", 0),
        regle({ type: "croisement", a: close, b: ind("ema", { length: 20 }, "ema"), sens: "hausse" }),
        st1d,
      ],
      "4h",
    );
    expect(instances).toEqual([
      { defId: "rsi", params: { length: 14 } },
      { defId: "cvd", params: {} },
      { defId: "ema", params: { length: 20 } },
    ]);
  });
});

describe("préréglages descriptifs", () => {
  it("valides sur leur unité, ids distincts des presets historiques, libellés honnêtes", () => {
    const ids = new Set(BUILTIN_PRESETS.map((p) => p.id));
    for (const p of PRESETS_DESCRIPTIFS) {
      expect(ids.has(p.id)).toBe(false);
      expect(raisonConditions(p.indicatorConditions, p.tf), p.id).toBeNull();
      expect(p.description).toMatch(/descriptif, non validé/);
    }
    const squeeze = PRESETS_DESCRIPTIFS.find((p) => p.id === "builtin:squeeze-4h-supertrend-1d")!;
    expect(new Set(squeeze.indicatorConditions.map((c) => uniteCondition(c, squeeze.tf)))).toEqual(new Set(["4h", "1d"]));
  });
});
