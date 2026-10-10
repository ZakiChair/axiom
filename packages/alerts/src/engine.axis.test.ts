/**
 * @axiom/alerts — engine.axis.test.ts
 *
 * Preuve des lots « bougie clôturée décidée » et « sorties masquées » d'AXIS
 * (9 octobre 2026) : une alerte `indicateur-seuil` sur la sortie masquée
 * `stratAxis.etat`, évaluée bougie par bougie sur des préfixes croissants de la
 * fixture dorée (toutes bougies `closed: true`, comme les klines servies au
 * runtime), se déclenche exactement aux signaux connus — sans bougie de retard
 * (`fin = n−1` quand la source dit la dernière bougie clôturée), sans tirer à
 * la création quand on est déjà à plat (calibration `arme` à la première
 * évaluation).
 *
 * Faits de la fixture (300 bougies BTCUSDT-1h, `emaTendance: 50`, dérivés dans
 * packages/indicators/src/strategy/stratAxis.test.ts) : achats aux bougies
 * 60, 107 et 280 (280 encore ouvert en fin de série), ventes à 88 et 139,
 * premier score défini à i=49.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import { evaluerAlertes } from "./engine";
import type { AlertDef, Condition, ContexteAlerte } from "./types";
import fixtureRaw from "../../indicators/src/golden/fixture-ohlcv.json";

/** Fixture dorée partagée, toutes bougies dites clôturées (comme `candlesCloturees` du runtime). */
const candles = (fixtureRaw as Candle[]).map((c) => ({ ...c, closed: true }));

const PARAMS = { emaTendance: 50 };

/** Indices où la série masquée `etat` change, en relisant le calcul de l'indicateur. */
const transitionsEtat = (): { achats: number[]; ventes: number[] } => {
  const def = getIndicator("stratAxis")!;
  const etat = computeIndicator(def, candles, PARAMS).series.etat ?? [];
  const achats: number[] = [];
  const ventes: number[] = [];
  for (let i = 1; i < etat.length; i++) {
    if (etat[i - 1] === undefined || etat[i] === etat[i - 1]) continue;
    (etat[i] === 1 ? achats : ventes).push(i);
  }
  return { achats, ventes };
};

/** Pilote une def sur les préfixes croissants ; renvoie les indices de déclenchement. */
function declenchements(condition: Condition, premierIndice: number): number[] {
  let courante: AlertDef = {
    id: "axis",
    symbol: "BTCUSDT",
    source: "binance",
    condition,
    actif: true,
    declenchements: [],
  };
  const tires: number[] = [];
  for (let i = premierIndice; i < candles.length; i++) {
    const ctx: ContexteAlerte = {
      maintenant: i,
      dernierPrix: candles[i]!.close,
      candles: candles.slice(0, i + 1),
    };
    const res = evaluerAlertes([courante], ctx);
    if (res.defs[0]) courante = res.defs[0];
    if (res.declenchements.length > 0) tires.push(i);
  }
  return tires;
}

describe("indicateur-seuil sur stratAxis.etat (sortie masquée, bougies clôturées)", () => {
  const achat: Condition = {
    type: "indicateur-seuil",
    indicateurId: "stratAxis",
    params: PARAMS,
    output: "etat",
    comparateur: ">=",
    valeur: 1,
  };
  const vente: Condition = { ...achat, comparateur: "<=", valeur: 0 };
  const { achats, ventes } = transitionsEtat();

  it("les signaux de la fixture dorée sont bien 60/107/280 (achats) et 88/139 (ventes)", () => {
    // Garde-fou des tests ci-dessous : si la fixture ou le calcul bougent, c'est ici.
    expect(achats).toEqual([60, 107, 280]);
    expect(ventes).toEqual([88, 139]);
  });

  it("etat >= 1 : calibre à plat, tire exactement aux achats 60/107/280, se désarme et se réarme à plat", () => {
    // Évaluation à partir de i=49 (premier score) : l'état vaut 0 → calibrage
    // armé sans déclenchement, puis un tir par achat (désarmé tant que l'état
    // tient, réarmé quand l'état revient à 0 après la vente).
    expect(declenchements(achat, 49)).toEqual(achats);
  });

  it("etat <= 0 : ne tire PAS à la création (déjà à plat) puis tire aux ventes 88/139", () => {
    // Première évaluation à i=49 : etat = 0 satisfait <= 0 → calibrage désarmé,
    // aucun tir ; l'état passe à 1 à l'achat (réarmement) et les ventes tirent.
    expect(declenchements(vente, 49)).toEqual(ventes);
  });
});

describe("ContexteAlerte.aux — référence du garde-fou de régime (10 octobre 2026)", () => {
  const achat: Condition = {
    type: "indicateur-seuil",
    indicateurId: "stratAxis",
    params: PARAMS, // regimeBtc omis → défaut 100
    output: "etat",
    comparateur: ">=",
    valeur: 1,
  };
  /** Même pilote avec ctx.aux. */
  function declenchementsAux(condition: Condition, aux: { refClose: Array<number | undefined> }, premierIndice: number): number[] {
    let courante: AlertDef = {
      id: "axis", symbol: "BTCUSDT", source: "binance", condition, actif: true, declenchements: [],
    };
    const tires: number[] = [];
    for (let i = premierIndice; i < candles.length; i++) {
      const tranche = candles.slice(0, i + 1);
      const res = evaluerAlertes([courante], {
        maintenant: i,
        dernierPrix: candles[i]!.close,
        candles: tranche,
        aux: { refClose: aux.refClose.slice(0, i + 1) },
      });
      if (res.defs[0]) courante = res.defs[0];
      if (res.declenchements.length > 0) tires.push(i);
    }
    return tires;
  }

  it("référence toujours sous son EMA → le garde-fou refuse les entrées post-amorce (seul l'achat de 60, avant l'EMA, passe)", () => {
    const dessous = candles.map((_c, i) => 5000 - i);
    expect(declenchementsAux(achat, { refClose: dessous }, 49)).toEqual([60]);
  });

  it("référence toujours au-dessus de son EMA → les mêmes achats que sans aux (60/107/280)", () => {
    const dessus = candles.map((_c, i) => 1000 + i * 10);
    expect(declenchementsAux(achat, { refClose: dessus }, 49)).toEqual([60, 107, 280]);
  });
});
