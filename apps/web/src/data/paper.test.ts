/**
 * Tests de la logique PURE du paper trading (data/paper.ts). Chaque valeur attendue est
 * calculée À LA MAIN et justifiée en commentaire (pas d'oracle circulaire).
 *
 * Pièges centraux couverts :
 *  - sens des 4 traversées (limit long/short, stop long/short) ;
 *  - TP/SL d'une position (long/short), avec SL prioritaire quand les deux « encadrent » le last ;
 *  - comptabilité du solde : frais 0.05 %/côté, notionnel JAMAIS débité, pas de double compte
 *    des frais d'entrée (aller-retour complet chiffré à la main) ;
 *  - fusion par symbol+direction (renfort au prix moyen ; long+short coexistent, pas de netting) ;
 *  - référence identique quand rien n'est actif sur le symbole (perf) ;
 *  - executions bornées aux 50 dernières ; solde négatif possible.
 */
import { describe, expect, it } from "vitest";
import {
  cloturerPosition,
  evaluerTick,
  evaluerTickDetaille,
  FRAIS_TAKER,
  pnlLatent,
  tradeJournalDepuisCloture,
  type EtatPaper,
  type ExecutionPaper,
  type OrdrePaper,
  type PositionPaper,
} from "./paper";

/** État neutre : solde 10 000, aucune position/ordre/exécution. Surcharges via `p`. */
function etat(p: Partial<EtatPaper> = {}): EtatPaper {
  return {
    solde: p.solde ?? 10_000,
    ordres: p.ordres ?? [],
    positions: p.positions ?? [],
    executions: p.executions ?? [],
  };
}

/** Ordre avec défauts neutres (les champs non pertinents au test sont posés à null). */
function ordre(p: Partial<OrdrePaper>): OrdrePaper {
  return {
    id: p.id ?? "o1",
    symbol: p.symbol ?? "BTCUSDT",
    direction: p.direction ?? "long",
    type: p.type ?? "market",
    prixLimite: "prixLimite" in p ? (p.prixLimite ?? null) : null,
    prixStop: "prixStop" in p ? (p.prixStop ?? null) : null,
    taille: p.taille ?? 1,
    tp: "tp" in p ? (p.tp ?? null) : null,
    sl: "sl" in p ? (p.sl ?? null) : null,
    creeTs: p.creeTs ?? 1_000,
  };
}

/** Position avec défauts neutres. */
function position(p: Partial<PositionPaper>): PositionPaper {
  return {
    id: p.id ?? "p1",
    symbol: p.symbol ?? "BTCUSDT",
    direction: p.direction ?? "long",
    taille: p.taille ?? 1,
    prixEntree: p.prixEntree ?? 100,
    tp: "tp" in p ? (p.tp ?? null) : null,
    sl: "sl" in p ? (p.sl ?? null) : null,
    ouvertTs: p.ouvertTs ?? 1_000,
  };
}

describe("FRAIS_TAKER", () => {
  it("vaut 0.05 % (0.0005)", () => {
    expect(FRAIS_TAKER).toBe(0.0005);
  });
});

describe("evaluerTick — perf : référence identique si rien d'actif sur le symbole", () => {
  it("tick d'un AUTRE symbole → MÊME objet (référence identique)", () => {
    // Ordre + position sur ETHUSDT ; tick sur BTCUSDT → rien à faire → même référence.
    const e = etat({
      ordres: [ordre({ symbol: "ETHUSDT", type: "limit", prixLimite: 50 })],
      positions: [position({ symbol: "ETHUSDT" })],
    });
    const r = evaluerTick(e, "BTCUSDT", 100, 2_000);
    expect(r).toBe(e); // identité stricte
  });

  it("aucun ordre ni position sur le symbole → MÊME objet", () => {
    const e = etat();
    const r = evaluerTick(e, "BTCUSDT", 100, 2_000);
    expect(r).toBe(e);
  });

  it("un ordre existe sur le symbole → NOUVEL objet (jamais l'ancien)", () => {
    const e = etat({ ordres: [ordre({ type: "market" })] });
    const r = evaluerTick(e, "BTCUSDT", 100, 2_000);
    expect(r).not.toBe(e);
  });
});

describe("evaluerTick — préservation CROSS-SYMBOLE (invariant du moteur multi-symbole)", () => {
  it("un tick sur A qui EXÉCUTE (chemin nouvel-objet) laisse INTACTS ordres/positions de B", () => {
    // Symbole A (BTC) : un market qui ouvre → chemin nouvel-objet garanti (r !== e).
    // Symbole B (ETH) : un ordre limit EN ATTENTE + une position ouverte, tous deux hors du tick A.
    // Invariant load-bearing : le moteur multi-symbole tique symbole par symbole ; un tick A ne doit
    // JAMAIS toucher l'état de B (mêmes RÉFÉRENCES d'objets conservées, aucune mutation).
    const ordreB = ordre({ id: "oB", symbol: "ETHUSDT", type: "limit", prixLimite: 50, direction: "long" });
    const posB = position({ id: "pB", symbol: "ETHUSDT", direction: "long", prixEntree: 40, tp: 999, sl: 10 });
    const e = etat({
      ordres: [ordre({ id: "oA", symbol: "BTCUSDT", type: "market", taille: 1 }), ordreB],
      positions: [posB],
    });

    const r = evaluerTick(e, "BTCUSDT", 100, 2_000);

    expect(r).not.toBe(e); // A a exécuté → nouvel objet d'état
    expect(r.positions.some((p) => p.symbol === "BTCUSDT")).toBe(true); // position A créée

    // B strictement intact : mêmes objets (référence), non mutés, toujours présents.
    expect(r.ordres.find((o) => o.id === "oB")).toBe(ordreB);
    expect(r.positions.find((p) => p.id === "pB")).toBe(posB);
  });
});

describe("evaluerTick — ordre market", () => {
  it("market long rempli à `last` : frais exacts débités, position créée, exécution ouverture", () => {
    // taille=2, last=100 → frais = 2×100×0.0005 = 0.10 ; solde 10000 → 9999.90.
    const e = etat({ ordres: [ordre({ id: "oM", direction: "long", type: "market", taille: 2 })] });
    const r = evaluerTick(e, "BTCUSDT", 100, 2_000);

    expect(r.ordres).toHaveLength(0); // consommé
    expect(r.positions).toHaveLength(1);
    const pos = r.positions[0]!;
    expect(pos.id).toBe("oM"); // id de position = id de l'ordre (déterministe/pur)
    expect(pos.direction).toBe("long");
    expect(pos.taille).toBe(2);
    expect(pos.prixEntree).toBe(100);
    expect(pos.ouvertTs).toBe(2_000);
    expect(r.solde).toBeCloseTo(9_999.9, 10);

    expect(r.executions).toHaveLength(1);
    const ex = r.executions[0]!;
    expect(ex.genre).toBe("ouverture");
    expect(ex.prix).toBe(100);
    expect(ex.taille).toBe(2);
    expect(ex.fraisUsd).toBeCloseTo(0.1, 10);
    expect(ex.pnlUsd).toBeNull(); // ouverture : pas de PnL
    expect(ex.ts).toBe(2_000);
  });

  it("market : le TP/SL de l'ordre est reporté sur la position créée", () => {
    const e = etat({ ordres: [ordre({ type: "market", tp: 110, sl: 95 })] });
    const r = evaluerTick(e, "BTCUSDT", 100, 2_000);
    expect(r.positions[0]!.tp).toBe(110);
    expect(r.positions[0]!.sl).toBe(95);
  });
});

describe("evaluerTick — ordre limit (sens de traversée)", () => {
  it("limit long NON rempli tant que last > prixLimite", () => {
    // On achète MOINS cher : rempli seulement si last ≤ limite. last=101 > 100 → rien.
    const e = etat({ ordres: [ordre({ direction: "long", type: "limit", prixLimite: 100 })] });
    const r = evaluerTick(e, "BTCUSDT", 101, 2_000);
    expect(r.ordres).toHaveLength(1); // reste en attente
    expect(r.positions).toHaveLength(0);
    expect(r.executions).toHaveLength(0);
  });

  it("limit long rempli à la traversée AU prix limite (pas à `last`)", () => {
    // last=99 ≤ 100 → rempli à 100 (le prix LIMITE), frais = 1×100×0.0005 = 0.05.
    const e = etat({ ordres: [ordre({ direction: "long", type: "limit", prixLimite: 100 })] });
    const r = evaluerTick(e, "BTCUSDT", 99, 2_000);
    expect(r.ordres).toHaveLength(0);
    expect(r.positions[0]!.prixEntree).toBe(100); // AU niveau limite, pas 99
    expect(r.executions[0]!.prix).toBe(100);
    expect(r.executions[0]!.fraisUsd).toBeCloseTo(0.05, 10);
    expect(r.solde).toBeCloseTo(9_999.95, 10);
  });

  it("limit short rempli si last ≥ prixLimite, au prix limite", () => {
    // Short : on vend PLUS cher → rempli si last ≥ limite. last=105 ≥ 100 → rempli à 100.
    const e = etat({ ordres: [ordre({ direction: "short", type: "limit", prixLimite: 100 })] });
    const r = evaluerTick(e, "BTCUSDT", 105, 2_000);
    expect(r.positions[0]!.direction).toBe("short");
    expect(r.positions[0]!.prixEntree).toBe(100);
  });

  it("limit short NON rempli si last < prixLimite", () => {
    const e = etat({ ordres: [ordre({ direction: "short", type: "limit", prixLimite: 100 })] });
    const r = evaluerTick(e, "BTCUSDT", 99, 2_000);
    expect(r.ordres).toHaveLength(1);
    expect(r.positions).toHaveLength(0);
  });
});

describe("evaluerTick — ordre stop (déclenchement en cassure, puis market le même tick)", () => {
  it("stop long déclenché si last ≥ prixStop → rempli à `last` le même tick", () => {
    // Entrée en cassure haussière : last=105 ≥ stop=104 → devient market → rempli à 105.
    const e = etat({ ordres: [ordre({ direction: "long", type: "stop", prixStop: 104 })] });
    const r = evaluerTick(e, "BTCUSDT", 105, 2_000);
    expect(r.ordres).toHaveLength(0);
    expect(r.positions).toHaveLength(1);
    expect(r.positions[0]!.prixEntree).toBe(105); // market → à `last`
    expect(r.executions[0]!.genre).toBe("ouverture");
    expect(r.executions[0]!.prix).toBe(105);
  });

  it("stop long NON déclenché si last < prixStop", () => {
    const e = etat({ ordres: [ordre({ direction: "long", type: "stop", prixStop: 104 })] });
    const r = evaluerTick(e, "BTCUSDT", 103, 2_000);
    expect(r.ordres).toHaveLength(1); // reste en attente
    expect(r.positions).toHaveLength(0);
  });

  it("stop short déclenché si last ≤ prixStop → rempli à `last`", () => {
    // Cassure baissière : last=95 ≤ stop=96 → devient market → rempli à 95.
    const e = etat({ ordres: [ordre({ direction: "short", type: "stop", prixStop: 96 })] });
    const r = evaluerTick(e, "BTCUSDT", 95, 2_000);
    expect(r.positions[0]!.direction).toBe("short");
    expect(r.positions[0]!.prixEntree).toBe(95);
  });

  it("stop short NON déclenché si last > prixStop", () => {
    const e = etat({ ordres: [ordre({ direction: "short", type: "stop", prixStop: 96 })] });
    const r = evaluerTick(e, "BTCUSDT", 97, 2_000);
    expect(r.ordres).toHaveLength(1);
    expect(r.positions).toHaveLength(0);
  });
});

describe("evaluerTick — fusion (renfort au prix moyen pondéré)", () => {
  it("market même symbole+direction qu'une position → renfort, prix moyen exact", () => {
    // Position 2@100 + fill 1@130 → taille 3, prix moyen = (2×100 + 1×130)/3 = 330/3 = 110.
    const e = etat({
      positions: [position({ id: "pos", direction: "long", taille: 2, prixEntree: 100 })],
      ordres: [ordre({ id: "oR", direction: "long", type: "market", taille: 1 })],
    });
    const r = evaluerTick(e, "BTCUSDT", 130, 2_000);
    expect(r.positions).toHaveLength(1);
    expect(r.positions[0]!.id).toBe("pos"); // conserve l'id existant
    expect(r.positions[0]!.taille).toBe(3);
    expect(r.positions[0]!.prixEntree).toBeCloseTo(110, 10);
    expect(r.executions[0]!.genre).toBe("renfort");
    expect(r.executions[0]!.pnlUsd).toBeNull();
  });

  it("renfort : TP/SL de l'ordre ÉCRASENT ceux de la position s'ils sont non null", () => {
    const e = etat({
      positions: [position({ id: "pos", direction: "long", taille: 1, prixEntree: 100, tp: 200, sl: 90 })],
      ordres: [ordre({ direction: "long", type: "market", taille: 1, tp: 150 })], // sl null → conservé
    });
    const r = evaluerTick(e, "BTCUSDT", 100, 2_000);
    expect(r.positions[0]!.tp).toBe(150); // écrasé
    expect(r.positions[0]!.sl).toBe(90); // conservé (ordre.sl null)
  });

  it("fill de direction OPPOSÉE → seconde position (long et short coexistent, pas de netting)", () => {
    const e = etat({
      positions: [position({ id: "pL", direction: "long", taille: 1, prixEntree: 100 })],
      ordres: [ordre({ id: "oS", direction: "short", type: "market", taille: 1 })],
    });
    const r = evaluerTick(e, "BTCUSDT", 100, 2_000);
    expect(r.positions).toHaveLength(2); // pas de compensation
    expect(r.positions.map((p) => p.direction).sort()).toEqual(["long", "short"]);
  });

  it("un market ET un limit ouvrent le même symbole+direction ce tick : le MARKET ouvre (étape 2 avant étape 3)", () => {
    // Ordres dans l'ordre [limit, market], mais l'étape 2 (markets) précède l'étape 3 (limits) :
    // le market (oMkt) OUVRE la position → id oMkt, tp 120 ; le limit (oLim) RENFORCE → tp écrasé à 130.
    // last=100 : market rempli à 100 ; limit long rempli si last ≤ 100 → à 100. Taille finale 2, prix 100.
    const e = etat({
      ordres: [
        ordre({ id: "oLim", direction: "long", type: "limit", prixLimite: 100, taille: 1, tp: 130 }),
        ordre({ id: "oMkt", direction: "long", type: "market", taille: 1, tp: 120 }),
      ],
    });
    const r = evaluerTick(e, "BTCUSDT", 100, 2_000);
    expect(r.positions).toHaveLength(1);
    expect(r.positions[0]!.id).toBe("oMkt"); // le MARKET a ouvert (étape 2)
    expect(r.positions[0]!.taille).toBe(2);
    expect(r.positions[0]!.tp).toBe(130); // le limit a renforcé APRÈS → son tp écrase
    expect(r.executions[0]!.genre).toBe("ouverture"); // market d'abord
    expect(r.executions[1]!.genre).toBe("renfort"); // limit ensuite
  });
});

describe("evaluerTick — TP/SL des positions", () => {
  it("TP long touché : clôture AU niveau tp, PnL = (tp − entree)×taille − frais sortie, solde crédité", () => {
    // Position 1@100, tp=110 ; last=112 ≥ 110 → clôture À 110.
    // brut = (110−100)×1 = 10 ; frais sortie = 1×110×0.0005 = 0.055 ; pnl = 10 − 0.055 = 9.945.
    const e = etat({ solde: 10_000, positions: [position({ direction: "long", taille: 1, prixEntree: 100, tp: 110 })] });
    const r = evaluerTick(e, "BTCUSDT", 112, 2_000);
    expect(r.positions).toHaveLength(0); // clôture totale
    const ex = r.executions[0]!;
    expect(ex.genre).toBe("tp");
    expect(ex.prix).toBe(110); // AU niveau
    expect(ex.fraisUsd).toBeCloseTo(0.055, 10);
    expect(ex.pnlUsd).toBeCloseTo(9.945, 10);
    expect(r.solde).toBeCloseTo(10_009.945, 10); // solde += pnlUsd
  });

  it("TP long NON touché si last < tp", () => {
    const e = etat({ positions: [position({ direction: "long", prixEntree: 100, tp: 110 })] });
    const r = evaluerTick(e, "BTCUSDT", 109, 2_000);
    expect(r.positions).toHaveLength(1);
    expect(r.executions).toHaveLength(0);
  });

  it("SL long touché si last ≤ sl : clôture AU niveau sl, PnL signé négatif", () => {
    // Position 1@100, sl=95 ; last=94 ≤ 95 → clôture À 95.
    // brut = (95−100)×1 = −5 ; frais sortie = 1×95×0.0005 = 0.0475 ; pnl = −5 − 0.0475 = −5.0475.
    const e = etat({ solde: 10_000, positions: [position({ direction: "long", taille: 1, prixEntree: 100, sl: 95 })] });
    const r = evaluerTick(e, "BTCUSDT", 94, 2_000);
    const ex = r.executions[0]!;
    expect(ex.genre).toBe("sl");
    expect(ex.prix).toBe(95);
    expect(ex.pnlUsd).toBeCloseTo(-5.0475, 10);
    expect(r.solde).toBeCloseTo(9_994.9525, 10);
  });

  it("TP short touché si last ≤ tp : PnL positif (short gagnant = prix qui BAISSE)", () => {
    // Short 1@100, tp=90 ; last=88 ≤ 90 → clôture À 90.
    // brut = (100−90)×1 = 10 (signe short) ; frais sortie = 1×90×0.0005 = 0.045 ; pnl = 10 − 0.045 = 9.955.
    const e = etat({ solde: 10_000, positions: [position({ direction: "short", taille: 1, prixEntree: 100, tp: 90 })] });
    const r = evaluerTick(e, "BTCUSDT", 88, 2_000);
    const ex = r.executions[0]!;
    expect(ex.genre).toBe("tp");
    expect(ex.prix).toBe(90);
    expect(ex.pnlUsd).toBeCloseTo(9.955, 10);
    expect(r.solde).toBeCloseTo(10_009.955, 10);
  });

  it("SL short touché si last ≥ sl : PnL négatif", () => {
    // Short 1@100, sl=105 ; last=106 ≥ 105 → clôture À 105.
    // brut = (100−105)×1 = −5 ; frais sortie = 1×105×0.0005 = 0.0525 ; pnl = −5 − 0.0525 = −5.0525.
    const e = etat({ solde: 10_000, positions: [position({ direction: "short", taille: 1, prixEntree: 100, sl: 105 })] });
    const r = evaluerTick(e, "BTCUSDT", 106, 2_000);
    const ex = r.executions[0]!;
    expect(ex.genre).toBe("sl");
    expect(ex.prix).toBe(105);
    expect(ex.pnlUsd).toBeCloseTo(-5.0525, 10);
  });

  it("TP ET SL vrais dans le même tick → SL exécuté (hypothèse pessimiste, discriminant)", () => {
    // Config artificielle (les deux booléens vrais est impossible avec des niveaux bien formés) :
    // long, tp=99, sl=101, last=100 → last≥tp (100≥99) ✓ ET last≤sl (100≤101) ✓ → SL prioritaire.
    const e = etat({ positions: [position({ direction: "long", taille: 1, prixEntree: 100, tp: 99, sl: 101 })] });
    const r = evaluerTick(e, "BTCUSDT", 100, 2_000);
    expect(r.executions).toHaveLength(1);
    expect(r.executions[0]!.genre).toBe("sl");
    expect(r.executions[0]!.prix).toBe(101); // clôture AU niveau sl
  });
});

describe("evaluerTick — comptabilité bout-en-bout (aller-retour complet)", () => {
  it("open long 1@100 puis clôture au TP 110 : solde final = 10000 − 0.05 + 9.945 = 10009.895", () => {
    // Tick 1 (ouverture market) : frais entrée = 1×100×0.0005 = 0.05 → solde 9999.95.
    let e: EtatPaper = etat({ solde: 10_000, ordres: [ordre({ type: "market", taille: 1, tp: 110 })] });
    e = evaluerTick(e, "BTCUSDT", 100, 1_000);
    expect(e.solde).toBeCloseTo(9_999.95, 10);
    expect(e.executions[0]!.genre).toBe("ouverture");
    expect(e.executions[0]!.pnlUsd).toBeNull();

    // Tick 2 (TP touché) : brut 10, frais sortie 0.055, pnl 9.945 → solde += 9.945 = 10009.895.
    e = evaluerTick(e, "BTCUSDT", 112, 2_000);
    expect(e.positions).toHaveLength(0);
    expect(e.solde).toBeCloseTo(10_009.895, 10); // brut 10 − les DEUX frais (0.05 + 0.055)
    // Net vérifié : 10 − 0.105 = 9.895 de gain net sur 10000.
  });

  it("solde peut devenir négatif (aucun clamp)", () => {
    // Perte massive : position 1@100, sl=1 ; last=0.5 → brut = (1−100) = −99, frais 1×1×0.0005 = 0.0005.
    const e = etat({ solde: 10, positions: [position({ direction: "long", taille: 1, prixEntree: 100, sl: 1 })] });
    const r = evaluerTick(e, "BTCUSDT", 0.5, 2_000);
    // pnl = −99 − 0.0005 = −99.0005 ; solde = 10 − 99.0005 = −89.0005.
    expect(r.solde).toBeCloseTo(-89.0005, 10);
  });
});

describe("evaluerTick — executions bornées aux 50 dernières", () => {
  it("après ajout, on ne conserve que les 50 dernières exécutions", () => {
    // 50 exécutions préexistantes + 1 ouverture ce tick → tronqué à 50, la plus ancienne tombe.
    const anciennes: ExecutionPaper[] = Array.from({ length: 50 }, (_, i) => ({
      ts: i, symbol: "BTCUSDT", genre: "ouverture", direction: "long",
      taille: 1, prix: 1, fraisUsd: 0, pnlUsd: null,
    }));
    const e = etat({ executions: anciennes, ordres: [ordre({ type: "market" })] });
    const r = evaluerTick(e, "BTCUSDT", 100, 9_999);
    expect(r.executions).toHaveLength(50);
    expect(r.executions[0]!.ts).toBe(1); // ts=0 (la plus ancienne) évincée
    expect(r.executions[49]!.ts).toBe(9_999); // la nouvelle en dernier
  });
});

describe("evaluerTickDetaille — clôtures TP/SL exposées (raccord pont EXPY du moteur T2)", () => {
  it("clôture TP : expose la position AVANT retrait + l'exécution (état identique à evaluerTick)", () => {
    const pos = position({ id: "pT", direction: "long", taille: 1, prixEntree: 100, tp: 110, sl: 90, ouvertTs: 1_000 });
    const e = etat({ positions: [pos] });
    const { etat: r, clotures } = evaluerTickDetaille(e, "BTCUSDT", 112, 2_000);

    expect(r.positions).toHaveLength(0); // clôturée dans l'état
    expect(clotures).toHaveLength(1);
    expect(clotures[0]!.position).toBe(pos); // MÊME objet position, avant retrait (prixEntree/sl/ouvertTs intacts)
    expect(clotures[0]!.exec.genre).toBe("tp");
    expect(clotures[0]!.exec.prix).toBe(110);
    // Cohérence avec le raccourci historique.
    expect(evaluerTick(e, "BTCUSDT", 112, 2_000)).toEqual(r);
  });

  it("ouverture/renfort (aucune clôture) → clotures vide", () => {
    const e = etat({ ordres: [ordre({ type: "market" })] });
    const { clotures } = evaluerTickDetaille(e, "BTCUSDT", 100, 2_000);
    expect(clotures).toHaveLength(0);
  });

  it("rien d'actif sur le symbole → même état, clotures vide", () => {
    const e = etat({ positions: [position({ symbol: "ETHUSDT" })] });
    const { etat: r, clotures } = evaluerTickDetaille(e, "BTCUSDT", 100, 2_000);
    expect(r).toBe(e);
    expect(clotures).toHaveLength(0);
  });
});

describe("cloturerPosition", () => {
  it("clôture manuelle au prix donné : genre cloture-manuelle, frais sortie, solde crédité", () => {
    // Position 2@100 ; clôture à 120 → brut = (120−100)×2 = 40 ; frais = 2×120×0.0005 = 0.12 ; pnl = 39.88.
    const e = etat({ solde: 10_000, positions: [position({ id: "pC", direction: "long", taille: 2, prixEntree: 100 })] });
    const r = cloturerPosition(e, "pC", 120, 3_000);
    expect(r.positions).toHaveLength(0);
    const ex = r.executions[r.executions.length - 1]!;
    expect(ex.genre).toBe("cloture-manuelle");
    expect(ex.prix).toBe(120);
    expect(ex.taille).toBe(2);
    expect(ex.fraisUsd).toBeCloseTo(0.12, 10);
    expect(ex.pnlUsd).toBeCloseTo(39.88, 10);
    expect(ex.ts).toBe(3_000);
    expect(r.solde).toBeCloseTo(10_039.88, 10);
  });

  it("id inconnu → état inchangé (référence identique)", () => {
    const e = etat({ positions: [position({ id: "pC" })] });
    const r = cloturerPosition(e, "inconnu", 120, 3_000);
    expect(r).toBe(e);
  });

  it("est PURE : l'état d'entrée n'est pas muté", () => {
    const e = etat({ positions: [position({ id: "pC", taille: 2, prixEntree: 100 })] });
    cloturerPosition(e, "pC", 120, 3_000);
    expect(e.positions).toHaveLength(1); // intact
    expect(e.solde).toBe(10_000);
  });
});

describe("pnlLatent", () => {
  it("long : signé, sans frais", () => {
    // (110 − 100) × 2 = 20.
    expect(pnlLatent(position({ direction: "long", taille: 2, prixEntree: 100 }), 110)).toBeCloseTo(20, 10);
  });
  it("short : gagnant quand le prix baisse", () => {
    // (100 − 90) × 2 = 20.
    expect(pnlLatent(position({ direction: "short", taille: 2, prixEntree: 100 }), 90)).toBeCloseTo(20, 10);
  });
  it("long en perte : négatif", () => {
    expect(pnlLatent(position({ direction: "long", taille: 1, prixEntree: 100 }), 95)).toBeCloseTo(-5, 10);
  });
});

describe("tradeJournalDepuisCloture", () => {
  it("mappe direction/entree/sortie/taille, stopInitial = sl, tag paper, note = genre", () => {
    const p = position({ direction: "long", taille: 2, prixEntree: 100, sl: 95, ouvertTs: 1_000 });
    const ex: ExecutionPaper = {
      ts: 3_000, symbol: "BTCUSDT", genre: "tp", direction: "long",
      taille: 2, prix: 110, fraisUsd: 0.11, pnlUsd: 19.89,
    };
    const tj = tradeJournalDepuisCloture(p, ex);
    expect(tj).not.toHaveProperty("id"); // Omit<TradeJournal, "id">
    expect(tj.symbol).toBe("BTCUSDT");
    expect(tj.direction).toBe("long");
    expect(tj.entree).toBe(100);
    expect(tj.sortie).toBe(110);
    expect(tj.taille).toBe(2);
    expect(tj.stopInitial).toBe(95); // p.sl
    expect(tj.ouvertTs).toBe(1_000);
    expect(tj.fermeTs).toBe(3_000); // exec.ts
    expect(tj.tags).toEqual(["paper"]);
    expect(tj.note).toBe("tp"); // = genre
  });

  it("sl null → stopInitial = prixEntree (R sera null en aval, documenté)", () => {
    const p = position({ direction: "short", prixEntree: 100, sl: null });
    const ex: ExecutionPaper = {
      ts: 3_000, symbol: "BTCUSDT", genre: "cloture-manuelle", direction: "short",
      taille: 1, prix: 90, fraisUsd: 0.045, pnlUsd: 9.955,
    };
    const tj = tradeJournalDepuisCloture(p, ex);
    expect(tj.stopInitial).toBe(100); // prixEntree
    expect(tj.note).toBe("cloture-manuelle");
  });
});
