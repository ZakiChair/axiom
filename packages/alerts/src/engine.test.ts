/**
 * @axiom/alerts — engine.test.ts
 *
 * Tests déterministes du moteur d'alertes. Chaque scénario thread la def à travers
 * une SÉQUENCE d'évaluations (le moteur retourne les defs mises à jour) pour vérifier
 * le cycle armé → déclenché → ré-armé, le calibrage anti-déclenchement-immédiat, les
 * bords exacts (prix == niveau) et les conditions d'indicateur.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import { evaluerAlertes } from "./engine";
import type { AlertDef, Condition, ContexteAlerte } from "./types";

/** Bougie plate (open=high=low=close) au temps `time`. */
function candle(time: number, close: number): Candle {
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

/** Fabrique une def de test (arme undefined = jamais évaluée). */
function def(condition: Condition, over: Partial<AlertDef> = {}): AlertDef {
  return {
    id: "a1",
    symbol: "BTCUSDT",
    source: "binance",
    condition,
    actif: true,
    declenchements: [],
    ...over,
  };
}

/**
 * Pilote une def à travers une liste de contextes ; renvoie, à chaque étape, un
 * booléen « a déclenché » + la def finale (threadée entre les étapes).
 */
function piloter(defInit: AlertDef, ctxs: ContexteAlerte[]): { fires: boolean[]; defFinale: AlertDef } {
  let courante = defInit;
  const fires: boolean[] = [];
  for (const ctx of ctxs) {
    const res = evaluerAlertes([courante], ctx);
    const suivante = res.defs[0];
    if (suivante) courante = suivante;
    fires.push(res.declenchements.length > 0);
  }
  return { fires, defFinale: courante };
}

/** Contexte prix-seul (pas de bougies) à un instant fictif. */
function ctxPrix(dernierPrix: number, prixPrecedent?: number): ContexteAlerte {
  return { maintenant: 0, dernierPrix, prixPrecedent };
}

describe("prix-croise — sens hausse", () => {
  it("calibre sans déclencher puis déclenche au franchissement montant, se ré-arme sous le niveau", () => {
    const { fires, defFinale } = piloter(def({ type: "prix-croise", niveau: 100, sens: "hausse" }), [
      ctxPrix(90), // calibrage (sous le niveau) → armé, pas de déclenchement
      ctxPrix(105), // franchit à la hausse → DÉCLENCHE
      ctxPrix(110), // toujours au-dessus → rien (désarmé)
      ctxPrix(95), // repasse sous le niveau → ré-armement
      ctxPrix(101), // franchit à nouveau → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, true, false, false, true]);
    expect(defFinale.declenchements).toHaveLength(2); // deux horodatages consignés
  });

  it("ne déclenche PAS immédiatement si la condition est déjà vraie à la création", () => {
    const { fires } = piloter(def({ type: "prix-croise", niveau: 100, sens: "hausse" }), [
      ctxPrix(150), // déjà au-dessus → calibrage désarmé, PAS de déclenchement
      ctxPrix(160), // toujours au-dessus → rien
      ctxPrix(90), // repasse dessous → ré-armement
      ctxPrix(120), // franchit → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, false, false, true]);
  });

  it("déclenche au bord exact (prix == niveau, >=)", () => {
    const { fires } = piloter(def({ type: "prix-croise", niveau: 100, sens: "hausse" }), [
      ctxPrix(99), // sous → armé
      ctxPrix(100), // exactement au niveau → >= vrai → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, true]);
  });
});

describe("prix-croise — sens baisse", () => {
  it("déclenche au franchissement descendant et se ré-arme au-dessus", () => {
    const { fires } = piloter(def({ type: "prix-croise", niveau: 100, sens: "baisse" }), [
      ctxPrix(110), // au-dessus → armé
      ctxPrix(95), // franchit à la baisse → DÉCLENCHE
      ctxPrix(90), // toujours dessous → rien
      ctxPrix(105), // repasse au-dessus → ré-armement
      ctxPrix(99), // franchit à nouveau → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, true, false, false, true]);
  });
});

describe("prix-croise — sens les-deux (bidirectionnel via prix précédent)", () => {
  it("ne déclenche pas sans prix précédent, puis sur chaque franchissement des deux côtés", () => {
    const { fires } = piloter(def({ type: "prix-croise", niveau: 100, sens: "les-deux" }), [
      ctxPrix(105), // pas de prix précédent → pas de front détectable
      ctxPrix(110, 105), // 105→110 : pas de franchissement du niveau 100
      ctxPrix(95, 110), // 110→95 : franchit 100 à la baisse → DÉCLENCHE
      ctxPrix(101, 95), // 95→101 : franchit 100 à la hausse → DÉCLENCHE
      ctxPrix(100, 99), // 99→100 : franchit (>=) → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, false, true, true, true]);
  });
});

describe("variation-pct", () => {
  // Fenêtre 60 s ; ancrage sur la dernière bougie CLÔTURÉE (120000), cible = 60000 : la
  // référence est la clôture de la bougie ouverte en 60000 (elle a clôturé en 120000).
  // Les trois bougies étant à 100, réf=100. pct = (prix-100)/100*100.
  const candles = [candle(0, 100), candle(60_000, 100), candle(120_000, 100)];
  function ctxVar(dernierPrix: number): ContexteAlerte {
    return { maintenant: 180_000, dernierPrix, candles };
  }

  it("déclenche à la hausse (seuil +5%) puis se ré-arme sous le seuil", () => {
    const { fires } = piloter(def({ type: "variation-pct", fenetreMs: 60_000, seuilPct: 5 }), [
      ctxVar(100), // pct 0 → calibrage
      ctxVar(106), // pct +6 ≥ +5 → DÉCLENCHE
      ctxVar(107), // pct +7 → rien (désarmé)
      ctxVar(100), // pct 0 → ré-armement
      ctxVar(106), // pct +6 → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, true, false, false, true]);
  });

  it("déclenche à la baisse avec un seuil négatif", () => {
    const { fires } = piloter(def({ type: "variation-pct", fenetreMs: 60_000, seuilPct: -5 }), [
      ctxVar(100), // pct 0 → calibrage
      ctxVar(94), // pct -6 ≤ -5 → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, true]);
  });

  it("prend la bougie CLÔTURÉE à la cible, pas celle encore ouverte (fenêtre == TF)", () => {
    // Régression : `time` est l'OUVERTURE. Avec TF 1 h et fenêtre 1 h, comparer à la clôture
    // de la dernière bougie du tableau reviendrait à comparer le prix à lui-même (pct = 0,
    // alerte structurellement morte). La référence correcte est la clôture de la bougie
    // ouverte un TF plus tôt (elle a clôturé à l'ouverture de la dernière).
    const H = 3_600_000;
    const { fires } = piloter(def({ type: "variation-pct", fenetreMs: H, seuilPct: -10 }), [
      // Avant la chute : tout à 100 → pct 0 → calibrage (armé, aucun déclenchement).
      {
        maintenant: 2 * H,
        dernierPrix: 100,
        candles: [candle(0, 100), candle(H, 100)],
      },
      // La bougie ouverte en 2H a clôturé à 90 (−10 %) ; ancrage = 2H → référence =
      // clôture de la bougie ouverte en H (= 100), donc pct = −10 ≤ −10 → DÉCLENCHE.
      {
        maintenant: 3 * H,
        dernierPrix: 90,
        candles: [candle(0, 100), candle(H, 100), candle(2 * H, 90)],
      },
    ]);
    expect(fires).toEqual([false, true]);
  });

  it("ne s'évalue pas tant que la fenêtre n'est pas couverte par les bougies", () => {
    // Ancrage = 60 000 (dernière bougie clôturée), fenêtre 120 s → cible = -60 000 :
    // aucune bougie n'a un time <= -60 000 → non évaluable.
    const courtes = [candle(0, 100), candle(60_000, 100)];
    const ctx: ContexteAlerte = { maintenant: 120_000, dernierPrix: 200, candles: courtes };
    const res = evaluerAlertes([def({ type: "variation-pct", fenetreMs: 120_000, seuilPct: 5 })], ctx);
    expect(res.declenchements).toHaveLength(0);
    expect(res.modifie).toBe(false); // def inchangée (arme reste undefined)
  });

  it("ancre la référence sur l'horloge des BOUGIES, pas sur celle de la machine", () => {
    // TF 60 s ; dernière bougie CLÔTURÉE ouverte en 120 000 (elle a clôturé à 180 000).
    // Clôtures distinctes pour que le décalage d'une bougie soit visible : 80 / 100 / 90.
    const cs = [candle(0, 80), candle(60_000, 100), candle(120_000, 90)];
    const cond: Condition = { type: "variation-pct", fenetreMs: 60_000, seuilPct: -10 };
    const armee = def(cond, { arme: true });

    // Horloge JUSTE (maintenant = instant exact de la clôture) : réf = 100 → pct = −10.
    const exact = evaluerAlertes([armee], { maintenant: 180_000, dernierPrix: 90, candles: cs });
    // Horloge de la MACHINE en retard de 3,5 s : la référence ne doit PAS glisser d'une bougie.
    const enRetard = evaluerAlertes([armee], { maintenant: 176_500, dernierPrix: 90, candles: cs });

    expect(exact.declenchements[0]?.valeur).toBeCloseTo(-10);
    expect(enRetard.declenchements[0]?.valeur).toBeCloseTo(-10);
  });
});

describe("indicateur-seuil (SMA length 3 >= 10)", () => {
  // SMA = moyenne des 3 dernières clôtures. On passe des tableaux complets et on thread la def.
  function ctxSma(closes: number[]): ContexteAlerte {
    return {
      maintenant: closes.length,
      dernierPrix: closes[closes.length - 1] ?? 0,
      candles: closes.map((c, i) => candle(i, c)),
    };
  }
  const cond: Condition = {
    type: "indicateur-seuil",
    indicateurId: "sma",
    params: { length: 3 },
    output: "sma",
    comparateur: ">=",
    valeur: 10,
  };

  it("calibre, déclenche quand la SMA franchit le seuil, se ré-arme quand elle repasse dessous", () => {
    const { fires } = piloter(def(cond), [
      ctxSma([8, 8, 8]), // SMA=8 (<10) → calibrage
      ctxSma([8, 8, 8, 14]), // SMA dernière=(8+8+14)/3=10 → ≥10 → DÉCLENCHE
      ctxSma([8, 8, 8, 14, 14]), // SMA=(8+14+14)/3=12 → rien (désarmé)
      ctxSma([8, 8, 8, 14, 14, 2, 2, 2]), // SMA=2 → ré-armement
      ctxSma([8, 8, 8, 14, 14, 2, 2, 2, 20, 20, 20]), // SMA=20 → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, true, false, false, true]);
  });

  it("ignore une sortie inconnue (non évaluable, def inchangée)", () => {
    const res = evaluerAlertes(
      [def({ ...cond, output: "inexistant" })],
      ctxSma([1, 2, 3, 4])
    );
    expect(res.modifie).toBe(false);
  });
});

describe("indicateur-croisement (MACD macd × signal)", () => {
  // Série sinusoïdale (amplitude 30, période 25) : la ligne MACD oscille clairement
  // autour de sa signal → croisements nets (une rampe linéaire donnerait MACD ≡ signal).
  // On calcule la série de référence puis on vérifie que le moteur reproduit EXACTEMENT
  // ces croisements (hors première évaluation = calibrage), une seule fois chacun.
  const closes: number[] = [];
  for (let i = 0; i < 150; i++) closes.push(100 + 30 * Math.sin((i * 2 * Math.PI) / 25));
  const candles = closes.map((c, i) => candle(i, c));

  const macdDef = getIndicator("macd");
  const full = macdDef ? computeIndicator(macdDef, candles, {}) : undefined;
  const A = full?.series.macd ?? [];
  const B = full?.series.signal ?? [];

  /** Indices de croisement (les deux séries définies aux positions i-1 et i). */
  function croisements(filtreHaut?: boolean, filtreBas?: boolean): number[] {
    const out: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const a0 = A[i - 1];
      const b0 = B[i - 1];
      const a1 = A[i];
      const b1 = B[i];
      if (a0 === undefined || b0 === undefined || a1 === undefined || b1 === undefined) continue;
      const haut = a0 <= b0 && a1 > b1;
      const bas = a0 >= b0 && a1 < b1;
      if ((filtreHaut && haut) || (filtreBas && bas) || (!filtreHaut && !filtreBas && (haut || bas))) {
        out.push(i);
      }
    }
    return out;
  }

  /** Première position où macd ET signal sont définis (fin du warmup). */
  function firstBoth(): number {
    for (let i = 0; i < candles.length; i++) {
      if (A[i] !== undefined && B[i] !== undefined) return i;
    }
    return candles.length;
  }

  /** Pilote le moteur en alimentant candles[0..i] pour i croissant. */
  function fires(cond: Condition): number[] {
    let courante = def(cond);
    const out: number[] = [];
    const start = firstBoth();
    for (let i = start; i < candles.length; i++) {
      const ctx: ContexteAlerte = {
        maintenant: i,
        dernierPrix: closes[i] ?? 0,
        candles: candles.slice(0, i + 1),
      };
      const res = evaluerAlertes([courante], ctx);
      const suivante = res.defs[0];
      if (suivante) courante = suivante;
      if (res.declenchements.length > 0) out.push(i);
    }
    return out;
  }

  it("reproduit les croisements (les-deux) sauf celui de la barre de calibrage", () => {
    // La 1re évaluation non-nulle (i = firstBoth+1) sert de calibrage → on l'exclut.
    const seuilCalibrage = firstBoth() + 1;
    const attendus = croisements().filter((i) => i > seuilCalibrage);
    const obtenus = fires({
      type: "indicateur-croisement",
      indicateurId: "macd",
      params: {},
      outputA: "macd",
      outputB: "signal",
      sens: "les-deux",
    });
    expect(obtenus).toEqual(attendus);
    expect(obtenus.length).toBeGreaterThan(0); // le retournement produit au moins un croisement
  });

  it("filtre sur le sens (baisse) : uniquement les croisements descendants", () => {
    const seuilCalibrage = firstBoth() + 1;
    const attendus = croisements(false, true).filter((i) => i > seuilCalibrage);
    const obtenus = fires({
      type: "indicateur-croisement",
      indicateurId: "macd",
      params: {},
      outputA: "macd",
      outputB: "signal",
      sens: "baisse",
    });
    expect(obtenus).toEqual(attendus);
  });
});

describe("funding-extreme", () => {
  function ctxFund(rate: number, z?: number): ContexteAlerte {
    return {
      maintenant: 1,
      dernierPrix: 100,
      fundingRate: rate,
      fundingZScore: z,
    };
  }

  it("calibre puis déclenche sur |rate| ≥ seuilAbs (long-crowded)", () => {
    const cond: Condition = {
      type: "funding-extreme",
      seuilAbs: 0.001,
      sens: "long-crowded",
    };
    const { fires } = piloter(def(cond), [
      ctxFund(0.0001), // sous seuil → calibrage armé
      ctxFund(0.002), // long extrême → DÉCLENCHE
      ctxFund(0.003), // toujours extrême → rien
      ctxFund(0.0001), // sous seuil → ré-arme
      ctxFund(0.001), // bord exact → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, true, false, false, true]);
  });

  it("filtre short-crowded (rate négatif) et ignore le côté opposé", () => {
    const cond: Condition = {
      type: "funding-extreme",
      seuilAbs: 0.001,
      sens: "short-crowded",
    };
    const { fires } = piloter(def(cond), [
      ctxFund(0.0001), // positif non short → armé
      ctxFund(0.002), // long extrême mais sens short → rien
      ctxFund(-0.002), // short extrême → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, false, true]);
  });

  it("déclenche via |z| ≥ zSeuil (défaut 2) sans seuilAbs", () => {
    const cond: Condition = { type: "funding-extreme", sens: "les-deux" };
    const { fires } = piloter(def(cond), [
      ctxFund(0.0001, 0.5), // |z|<2 → calibrage
      ctxFund(0.0001, 2.5), // |z|≥2 → DÉCLENCHE
      ctxFund(-0.0001, -3), // toujours extrême → rien
      ctxFund(0.0001, 0), // z retombe → ré-arme
      ctxFund(0.0001, -2), // bord |z|=2 → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, true, false, false, true]);
  });

  it("non évaluable sans rate, ou sans critère (ni z ni seuilAbs)", () => {
    const cond: Condition = { type: "funding-extreme", sens: "les-deux" };
    // pas de fundingRate
    expect(evaluerAlertes([def(cond)], { maintenant: 0, dernierPrix: 1 }).modifie).toBe(false);
    // rate sans z ni seuilAbs
    expect(
      evaluerAlertes([def(cond)], { maintenant: 0, dernierPrix: 1, fundingRate: 0.01 }).modifie
    ).toBe(false);
  });
});

describe("cvd-spot-perp-div", () => {
  function ctxCvd(
    kind: ContexteAlerte["cvdDivergenceKind"]
  ): ContexteAlerte {
    return { maintenant: 1, dernierPrix: 100, cvdDivergenceKind: kind };
  }

  it("calibre, déclenche sur kind match, se ré-arme quand null", () => {
    const cond: Condition = { type: "cvd-spot-perp-div", kind: "spotUp_perpDown" };
    const { fires } = piloter(def(cond), [
      ctxCvd(null), // pas de div → calibrage armé
      ctxCvd("spotUp_perpDown"), // match → DÉCLENCHE
      ctxCvd("spotUp_perpDown"), // toujours → rien
      ctxCvd(null), // claire → ré-arme
      ctxCvd("spotUp_perpDown"), // → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, true, false, false, true]);
  });

  it("les-deux accepte les deux kinds ; filtre l'autre kind", () => {
    const filtre: Condition = { type: "cvd-spot-perp-div", kind: "spotDown_perpUp" };
    const { fires: f1 } = piloter(def(filtre), [
      ctxCvd(null),
      ctxCvd("spotUp_perpDown"), // pas le bon kind
      ctxCvd("spotDown_perpUp"), // match
    ]);
    expect(f1).toEqual([false, false, true]);

    const lesDeux: Condition = { type: "cvd-spot-perp-div", kind: "les-deux" };
    const { fires: f2 } = piloter(def(lesDeux), [
      ctxCvd(null),
      ctxCvd("spotUp_perpDown"),
    ]);
    expect(f2).toEqual([false, true]);
  });

  it("non évaluable si cvdDivergenceKind absent", () => {
    const res = evaluerAlertes(
      [def({ type: "cvd-spot-perp-div", kind: "les-deux" })],
      { maintenant: 0, dernierPrix: 1 }
    );
    expect(res.modifie).toBe(false);
  });
});

describe("liq-cascade", () => {
  const cond: Condition = { type: "liq-cascade", seuilUsdParMin: 5_000_000 };
  function ctxLiq(liqUsdParMin: number): ContexteAlerte {
    return { maintenant: 1, dernierPrix: 100, liqUsdParMin };
  }

  it("calibre puis déclenche au franchissement du seuil, se ré-arme sous le seuil", () => {
    const { fires, defFinale } = piloter(def(cond), [
      ctxLiq(0), // calme → calibrage armé
      ctxLiq(6_000_000), // cascade → DÉCLENCHE
      ctxLiq(9_000_000), // toujours au-dessus → rien (désarmée)
      ctxLiq(100_000), // retombe → ré-armement
      ctxLiq(5_000_000), // bord exact (≥) → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, true, false, false, true]);
    expect(defFinale.declenchements).toHaveLength(2);
  });

  it("ne déclenche PAS immédiatement si une cascade est déjà en cours à la création", () => {
    const { fires } = piloter(def(cond), [
      ctxLiq(8_000_000), // déjà ≥ seuil → calibrage désarmé, PAS de déclenchement
      ctxLiq(7_000_000), // toujours au-dessus → rien
      ctxLiq(1_000_000), // repasse dessous → ré-armement
      ctxLiq(6_000_000), // nouvelle cascade → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, false, false, true]);
  });

  it("non évaluable si liqUsdParMin absent (def inchangée, référence conservée)", () => {
    const d = def(cond);
    const res = evaluerAlertes([d], { maintenant: 0, dernierPrix: 1 });
    expect(res.defs[0]).toBe(d);
    expect(res.modifie).toBe(false);
  });
});

describe("regime-seuil", () => {
  const cond: Condition = { type: "regime-seuil", comparateur: "<=", valeur: -1.2 };
  function ctxReg(regimeScore: number): ContexteAlerte {
    return { maintenant: 1, dernierPrix: 0, regimeScore };
  }

  it("calibre puis déclenche au franchissement du seuil, se ré-arme au re-franchissement inverse", () => {
    const { fires, defFinale } = piloter(def(cond), [
      ctxReg(0.3), // au-dessus du seuil → calibrage armé
      ctxReg(-1.5), // score ≤ −1.2 → DÉCLENCHE
      ctxReg(-1.8), // toujours sous le seuil → rien (désarmée)
      ctxReg(-0.4), // repasse au-dessus → ré-armement
      ctxReg(-1.2), // bord exact (≤) → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, true, false, false, true]);
    expect(defFinale.declenchements).toHaveLength(2);
  });

  it("ne déclenche PAS immédiatement si le seuil est déjà franchi à la création", () => {
    const { fires } = piloter(def(cond), [
      ctxReg(-1.6), // déjà ≤ seuil → calibrage désarmé, PAS de déclenchement
      ctxReg(-1.7), // toujours sous le seuil → rien
      ctxReg(0.5), // repasse au-dessus → ré-armement
      ctxReg(-1.4), // franchit à nouveau → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, false, false, true]);
  });

  it("non évaluable si regimeScore absent (def inchangée, référence conservée)", () => {
    const d = def(cond);
    const res = evaluerAlertes([d], { maintenant: 0, dernierPrix: 0 });
    expect(res.defs[0]).toBe(d);
    expect(res.modifie).toBe(false);
  });
});

describe("whale-flux", () => {
  const cond: Condition = { type: "whale-flux", seuilUsd: 10_000_000, direction: "tous" };
  /** Contexte whale : liste (usd, direction) des mouvements de la fenêtre récente. */
  function ctxWhale(
    mouvements: Array<{ usd: number; direction: "depot" | "retrait" | "interne" | "inconnu" }>,
  ): ContexteAlerte {
    return { maintenant: 1, dernierPrix: 0, whaleMouvements: mouvements };
  }

  it("calibre puis déclenche sur un transfert ≥ seuil, se ré-arme fenêtre redevenue calme", () => {
    const { fires, defFinale } = piloter(def(cond), [
      ctxWhale([]), // fenêtre vide → calibrage armé
      ctxWhale([{ usd: 12_000_000, direction: "inconnu" }]), // gros transfert → DÉCLENCHE
      ctxWhale([{ usd: 12_000_000, direction: "inconnu" }]), // même fenêtre → rien (désarmée)
      ctxWhale([{ usd: 2_000_000, direction: "depot" }]), // fenêtre calme → ré-armement
      ctxWhale([{ usd: 10_000_000, direction: "retrait" }]), // bord exact (≥) → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, true, false, false, true]);
    expect(defFinale.declenchements).toHaveLength(2);
  });

  it("ne déclenche PAS immédiatement si un gros transfert est déjà dans la fenêtre à la création", () => {
    const { fires } = piloter(def(cond), [
      ctxWhale([{ usd: 50_000_000, direction: "depot" }]), // déjà ≥ seuil → calibrage désarmé
      ctxWhale([]), // fenêtre vidée → ré-armement
      ctxWhale([{ usd: 11_000_000, direction: "interne" }]), // nouveau transfert → DÉCLENCHE
    ]);
    expect(fires).toEqual([false, false, true]);
  });

  it("filtre par direction (dépôt seul) et rapporte le max de la direction filtrée", () => {
    const depot: Condition = { type: "whale-flux", seuilUsd: 5_000_000, direction: "depot" };
    const { fires, defFinale } = piloter(def(depot), [
      ctxWhale([]), // calibrage armé
      // Retrait énorme mais AUCUN dépôt ≥ seuil → rien.
      ctxWhale([{ usd: 80_000_000, direction: "retrait" }]),
      // Dépôt 6 M + retrait 80 M → déclenche sur le DÉPÔT (valeur = 6 M).
      ctxWhale([
        { usd: 80_000_000, direction: "retrait" },
        { usd: 6_000_000, direction: "depot" },
      ]),
    ]);
    expect(fires).toEqual([false, false, true]);
    // La valeur journalisée est le max de la direction filtrée, pas le max global.
    expect(defFinale.declenchements).toHaveLength(1);
  });

  it("non évaluable si whaleMouvements absent (def inchangée, référence conservée)", () => {
    const d = def(cond);
    const res = evaluerAlertes([d], { maintenant: 0, dernierPrix: 0 });
    expect(res.defs[0]).toBe(d);
    expect(res.modifie).toBe(false);
  });
});

describe("filtrage du lot", () => {
  it("laisse les defs inactives inchangées (même référence)", () => {
    const inactive = def({ type: "prix-croise", niveau: 100, sens: "hausse" }, { actif: false });
    const res = evaluerAlertes([inactive], ctxPrix(150));
    expect(res.defs[0]).toBe(inactive); // référence conservée
    expect(res.modifie).toBe(false);
  });
});
