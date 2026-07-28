/**
 * @axiom/indicators — strategy/candidatsChampion.test.ts
 *
 * Contrat des six candidats de la campagne v2.3. Le rôle de ces tests n'est PAS
 * de re-dériver des indicateurs déjà couverts (Supertrend, ADX, TTM, Ichimoku,
 * MACD, PSAR ont chacun leur suite, golden comprise) mais de garantir que la
 * COMPOSITION est branchée dans le bon sens et que chaque branche existe.
 *
 * Fixture unique de 400 bougies en cinq régimes ENCHAÎNÉS (générés, pas
 * littéraux) : range en dents de scie (0-79, ADX effondré) → compression
 * (80-119, squeeze TTM armé) → tendance haussière (120-199) → tendance
 * baissière (200-279) → 2e compression (280-319) → reprise baissière (320-399).
 * La longueur est imposée par l'Ichimoku : `spanB` demande 52 bougies PUIS un
 * décalage de 26 — le candidat (4) n'a donc aucun état avant l'indice 77, et
 * les « 60 bougies » du brief ne suffiraient pas à l'évaluer.
 *
 * Cette structure est ce qui rend les tests non tautologiques : chaque candidat
 * y produit à la fois des longs, des shorts ET des flats. Un filtre débranché
 * (ADX, RSI, kumo, direction Supertrend) supprimerait les flats ; une
 * comparaison inversée échangerait longs et shorts. Les deux sont détectés.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { closeOf, highOf, lowOf, rma, rollingHighest, rollingLowest, trueRange } from "../utils";
import { specStrategie } from "../utils-fabrique-strategie";
import { CANDIDATS_CHAMPION } from "./candidatsChampion";

/** Cinq régimes enchaînés (cf. docblock). Prix toujours > 0 (min low 74,7). */
function fixture(): Candle[] {
  const out: Candle[] = [];
  let prix = 100;
  for (let i = 0; i < 400; i++) {
    let pas: number;
    let amp: number;
    if (i < 80) {
      pas = (i % 4 < 2 ? 1 : -1) * 1.5; // dents de scie : deux hausses, deux baisses
      amp = 0.8;
    } else if (i < 120) {
      pas = i % 2 === 0 ? 0.06 : -0.05; // closes quasi immobiles, mèches courtes
      amp = 0.12;
    } else if (i < 200) {
      pas = 1.8 + (i % 3) * 0.3;
      amp = 2.0;
    } else if (i < 280) {
      pas = -(1.0 + (i % 3) * 0.2);
      amp = 1.4;
    } else if (i < 320) {
      pas = i % 2 === 0 ? 0.06 : -0.05; // 2e compression, plus bas
      amp = 0.12;
    } else {
      pas = -(1.0 + (i % 3) * 0.2);
      amp = 1.4;
    }
    const open = prix;
    const close = prix + pas;
    out.push({
      time: 1_700_000_000_000 + i * 3_600_000,
      open,
      high: Math.max(open, close) + amp,
      low: Math.min(open, close) - amp,
      close,
      volume: 10 + (i % 7),
    });
    prix = close;
  }
  return out;
}

const CANDLES = fixture();

describe("CANDIDATS_CHAMPION", () => {
  it("expose les 6 candidats du spec §3, dans l'ordre du rapport", () => {
    expect(CANDIDATS_CHAMPION.map((c) => c.id)).toEqual([
      "candSupertrendAdx",
      "candMmRsi",
      "candDonchianTrailing",
      "candSqueezeKumo",
      "candMacdSupertrend",
      "candPsarAdx",
    ]);
  });

  it("ne s'enregistre PAS dans la map des specs (aucun defStrategie appelé)", () => {
    // Garde de portée : le champion ne devient un def qu'en Task 7, une fois la
    // campagne tranchée. Un `defStrategie` glissé ici polluerait le registre.
    for (const c of CANDIDATS_CHAMPION) expect(specStrategie(c.id)).toBeUndefined();
  });

  for (const cand of CANDIDATS_CHAMPION) {
    describe(cand.id, () => {
      const etats = cand.position(CANDLES);

      it("renvoie une série alignée sur les bougies", () => {
        expect(etats).toHaveLength(CANDLES.length);
      });

      it("le warm-up est un PRÉFIXE d'undefined (aucun trou après le 1er état)", () => {
        const premier = etats.findIndex((e) => e !== undefined);
        expect(premier).toBeGreaterThan(0); // aucun candidat ne décide dès la 1re bougie
        expect(etats.slice(premier).some((e) => e === undefined)).toBe(false);
      });

      it("produit des longs, des shorts ET des flats sur les cinq régimes", () => {
        expect(etats.filter((e) => e === 1).length).toBeGreaterThan(0);
        expect(etats.filter((e) => e === -1).length).toBeGreaterThan(0);
        expect(etats.filter((e) => e === 0).length).toBeGreaterThan(0);
      });
    });
  }
});

describe("candDonchianTrailing — sortie trailing ATR recomposée", () => {
  const etats = CANDIDATS_CHAMPION[2]!.position(CANDLES);

  const transitions: string[] = [];
  for (let i = 1; i < etats.length; i++) {
    const prev = etats[i - 1];
    const cur = etats[i];
    if (prev !== undefined && cur !== undefined && prev !== cur) transitions.push(`${i}:${prev}->${cur}`);
  }

  it("n'effectue que trois transitions sur la fixture (comptes figés)", () => {
    expect(transitions).toEqual(["120:0->1", "210:1->0", "320:0->-1"]);
  });

  it("entre long à 120 sur une VRAIE cassure du canal des 20 précédentes", () => {
    const hh = rollingHighest(highOf(CANDLES), 20);
    expect(closeOf(CANDLES)[120]!).toBeGreaterThan(hh[119]!);
    expect(closeOf(CANDLES)[119]!).toBeLessThanOrEqual(hh[118]!);
  });

  it("sort à 210 parce que la clôture passe SOUS le trailing, pas avant", () => {
    // Recomposition indépendante : plus-haut atteint depuis l'entrée (120) et
    // ATR(14) Wilder, tous deux calculés ici via les cœurs importés.
    const highs = highOf(CANDLES);
    const closes = closeOf(CANDLES);
    const atr = rma(trueRange(CANDLES), 14);
    const extreme = (fin: number) => Math.max(...highs.slice(120, fin + 1));

    const trail210 = extreme(210) - 3 * atr[210]!;
    const trail209 = extreme(209) - 3 * atr[209]!;
    expect(closes[210]!).toBeLessThan(trail210); // déclenche
    expect(closes[209]!).toBeGreaterThanOrEqual(trail209); // pas encore

    // Valeurs figées (dérivées de la fixture, garde anti-dérive) :
    expect(extreme(210)).toBeCloseTo(269.9, 4);
    expect(atr[210]!).toBeCloseTo(4.9165, 3);
    expect(closes[210]!).toBeCloseTo(254.7, 4);
    expect(trail210).toBeCloseTo(255.15, 2);
  });

  it("cette sortie n'est PAS une cassure du canal opposé", () => {
    // Sans cette garde, un simple « close < plus-bas 20 » expliquerait aussi le
    // flat à 210 — or il en est loin (254,7 contre un canal bas à 240,7).
    const ll = rollingLowest(lowOf(CANDLES), 20);
    expect(closeOf(CANDLES)[210]!).toBeGreaterThan(ll[209]!);
  });
});
