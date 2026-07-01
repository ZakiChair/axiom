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
  // Fenêtre 60 s ; référence = clôture <= (maintenant - 60 000). Bougies aux temps 0/60000/120000
  // toutes à 100 → à maintenant=180000, cible=120000, réf=100. pct = (prix-100)/100*100.
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

  it("ne s'évalue pas tant que la fenêtre n'est pas couverte par les bougies", () => {
    // maintenant - fenetreMs = -30000 : aucune bougie n'a un time <= -30000 → non évaluable.
    const ctx: ContexteAlerte = { maintenant: 30_000, dernierPrix: 200, candles };
    const res = evaluerAlertes([def({ type: "variation-pct", fenetreMs: 60_000, seuilPct: 5 })], ctx);
    expect(res.declenchements).toHaveLength(0);
    expect(res.modifie).toBe(false); // def inchangée (arme reste undefined)
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

describe("filtrage du lot", () => {
  it("laisse les defs inactives inchangées (même référence)", () => {
    const inactive = def({ type: "prix-croise", niveau: 100, sens: "hausse" }, { actif: false });
    const res = evaluerAlertes([inactive], ctxPrix(150));
    expect(res.defs[0]).toBe(inactive); // référence conservée
    expect(res.modifie).toBe(false);
  });
});
