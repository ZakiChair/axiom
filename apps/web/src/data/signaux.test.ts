/**
 * Tests des détecteurs de setups (data/signaux.ts) — valeurs attendues justifiées
 * en commentaire, fixtures construites à la main (pivots vérifiables à l'œil).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Candle, IndicatorDef } from "@axiom/types";
import { computeIndicator, detecterRetournementsAxis, getIndicator } from "@axiom/indicators";
import {
  agregerSignaux,
  pivotsLocaux,
  selectionEchantillon,
  signalDivergenceFondamentale,
  signalDivergenceRsi,
  signalFundingExtreme,
  signalPositionnement,
  signalQuadrantOiPrix,
  signalRetournementAxis,
  type SignalDetecte,
} from "./signaux";
import type { ScreenerRow } from "./screener";

// ─────────────────────────── Quadrant OI × Prix ───────────────────────────

describe("signalQuadrantOiPrix — 4 quadrants du doc 02 B1", () => {
  it("prix ↑ + OI ↑ = build-up long (haussier)", () => {
    const s = signalQuadrantOiPrix(5, 8);
    expect(s?.libelle).toBe("Build-up long");
    expect(s?.direction).toBe("haussier");
  });

  it("prix ↓ + OI ↑ = build-up short (baissier)", () => {
    const s = signalQuadrantOiPrix(-4, 6);
    expect(s?.libelle).toBe("Build-up short");
    expect(s?.direction).toBe("baissier");
  });

  it("prix ↑ + OI ↓ = short squeeze (haussier, fragile)", () => {
    const s = signalQuadrantOiPrix(6, -5);
    expect(s?.libelle).toBe("Short squeeze");
    expect(s?.direction).toBe("haussier");
    expect(s?.detail).toContain("fragile");
  });

  it("prix ↓ + OI ↓ = dé-leveraging (baissier)", () => {
    const s = signalQuadrantOiPrix(-3, -7);
    expect(s?.libelle).toBe("Dé-leveraging");
    expect(s?.direction).toBe("baissier");
  });

  it("sous les seuils (|Δprix| < 2 ou |ΔOI| < 3) : null (bruit)", () => {
    expect(signalQuadrantOiPrix(1.9, 10)).toBeNull();
    expect(signalQuadrantOiPrix(5, 2.9)).toBeNull();
  });

  it("valeurs non finies : null", () => {
    expect(signalQuadrantOiPrix(Number.NaN, 5)).toBeNull();
    expect(signalQuadrantOiPrix(5, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("porte la fiabilité « échantillonné » (futures data, pas un feed universel)", () => {
    expect(signalQuadrantOiPrix(5, 8)?.fiabilite).toBe("échantillonné");
  });
});

// ─────────────────────────── Funding extrême ───────────────────────────

/** 60 points alternés ±0.0001 (moyenne 0, écart-type 0.0001) + un dernier point. */
function histAvecDernier(dernier: number): number[] {
  const hist: number[] = [];
  for (let i = 0; i < 30; i++) hist.push(0.0001, -0.0001);
  hist.push(dernier);
  return hist;
}

describe("signalFundingExtreme — z-score temporel contrarian", () => {
  it("funding très positif (z = +20) : crowded long → BAISSIER contrarian", () => {
    // z = (0.002 − 0) / 0.0001 = 20 ≥ 2.
    const s = signalFundingExtreme(histAvecDernier(0.002));
    expect(s?.libelle).toBe("Funding crowded long");
    expect(s?.direction).toBe("baissier");
    expect(s?.fiabilite).toBe("fiable");
  });

  it("funding très négatif : crowded short → HAUSSIER contrarian", () => {
    const s = signalFundingExtreme(histAvecDernier(-0.002));
    expect(s?.libelle).toBe("Funding crowded short");
    expect(s?.direction).toBe("haussier");
  });

  it("|z| < 2 : null (pas un extrême)", () => {
    // z = 0.00015 / 0.0001 = 1.5.
    expect(signalFundingExtreme(histAvecDernier(0.00015))).toBeNull();
  });

  it("fenêtre incomplète (< 61 points) : null", () => {
    expect(signalFundingExtreme(histAvecDernier(0.002).slice(1))).toBeNull();
  });

  it("écart-type nul (funding constant) : null, pas de division par zéro", () => {
    const constant = new Array<number>(61).fill(0.0001);
    expect(signalFundingExtreme(constant)).toBeNull();
  });
});

// ─────────────────────────── Pivots ───────────────────────────

describe("pivotsLocaux", () => {
  //         idx : 0    1    2    3    4    5    6    7    8
  const serie = [1, 2, 5, 2, 1, 0.5, 0.2, 0.5, 1];

  it("détecte un maximum local strict (k voisins de chaque côté)", () => {
    expect(pivotsLocaux(serie, "haut", 2)).toEqual([{ index: 2, value: 5 }]);
  });

  it("détecte un minimum local strict", () => {
    expect(pivotsLocaux(serie, "bas", 2)).toEqual([{ index: 6, value: 0.2 }]);
  });

  it("un plateau (voisin égal) n'est pas un pivot strict", () => {
    expect(pivotsLocaux([1, 2, 5, 5, 2, 1, 0], "haut", 2)).toEqual([]);
  });

  it("les bords (moins de k voisins) sont exclus", () => {
    // 9 est le max global mais en bord de série.
    expect(pivotsLocaux([9, 1, 2, 3, 2, 1], "haut", 2)).toEqual([{ index: 3, value: 3 }]);
  });
});

// ─────────────────────────── Divergence RSI / prix ───────────────────────────

// Deux pivots hauts de prix : 110 (idx 10) puis 112 (idx 20) — plus-haut plus haut.
const CLOSES_HH = [
  100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 109, 108, 107, 106, 105, 106,
  107, 108, 109, 112, 111, 110, 109, 108, 107, 106,
];
// Deux pivots bas de prix : 90 (idx 10) puis 88 (idx 20) — plus-bas plus bas.
const CLOSES_LL = [
  100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 91, 92, 93, 94, 95, 94, 93, 92, 91, 88,
  89, 90, 91, 92, 93, 94,
];

/** RSI plat à 50 sauf aux deux indices de pivots (10 et 20). */
function rsiAvec(r10: number, r20: number): number[] {
  const rsi = new Array<number>(27).fill(50);
  rsi[10] = r10;
  rsi[20] = r20;
  return rsi;
}

describe("signalDivergenceRsi — pivots prix vs RSI", () => {
  it("plus-haut prix + RSI en retrait = divergence baissière", () => {
    const s = signalDivergenceRsi(CLOSES_HH, rsiAvec(70, 62));
    expect(s?.libelle).toBe("Divergence RSI baissière");
    expect(s?.direction).toBe("baissier");
    expect(s?.fiabilite).toBe("heuristique");
  });

  it("plus-bas prix + RSI en reprise = divergence haussière", () => {
    const s = signalDivergenceRsi(CLOSES_LL, rsiAvec(30, 38));
    expect(s?.direction).toBe("haussier");
  });

  it("RSI qui CONFIRME le prix (pas de divergence) : null", () => {
    // Plus-haut prix ET plus-haut RSI → tendance saine, pas un setup.
    expect(signalDivergenceRsi(CLOSES_HH, rsiAvec(62, 70))).toBeNull();
  });

  it("pivot final trop ancien (> 15 bougies) : null — setup périmé", () => {
    // 16 bougies plates ajoutées après le pivot idx 20 → distance 22 > 15.
    const rassis = [...CLOSES_HH, ...new Array<number>(16).fill(105)];
    const rsi = [...rsiAvec(70, 62), ...new Array<number>(16).fill(50)];
    expect(signalDivergenceRsi(rassis, rsi)).toBeNull();
  });

  it("série trop courte : null", () => {
    expect(signalDivergenceRsi([1, 2, 3], [50, 50, 50])).toBeNull();
  });
});

// ─────────────────────────── Positionnement ───────────────────────────

describe("signalPositionnement — top traders vs foule", () => {
  it("top/foule ≥ 1.25 : top traders longs (haussier)", () => {
    const s = signalPositionnement(1.0, 1.3);
    expect(s?.libelle).toBe("Top traders longs vs foule");
    expect(s?.direction).toBe("haussier");
    expect(s?.fiabilite).toBe("bruité");
  });

  it("top/foule ≤ 0.8 : top traders shorts (baissier)", () => {
    expect(signalPositionnement(1.5, 1.0)?.direction).toBe("baissier");
  });

  it("alignés (ratio dans [0.8, 1.25]) : null", () => {
    expect(signalPositionnement(1.0, 1.1)).toBeNull();
  });

  it("ratios invalides (≤ 0, non finis) : null", () => {
    expect(signalPositionnement(0, 1.3)).toBeNull();
    expect(signalPositionnement(1.0, Number.NaN)).toBeNull();
  });
});

// ─────────────────────────── Confluence ───────────────────────────

const BASE = { symbol: "TESTUSDT", lastPrice: 1, priceChangePct24h: 3, volumeUsd24h: 1e8 };

function sig(direction: "haussier" | "baissier", poids: number): SignalDetecte {
  return { id: "quadrant", direction, libelle: "x", detail: "y", fiabilite: "fiable", poids };
}

describe("agregerSignaux — score et direction agrégée", () => {
  it("aucun signal : null (le symbole n'apparaît pas dans l'inbox)", () => {
    expect(agregerSignaux(BASE, [null, null])).toBeNull();
  });

  it("score = Σ poids ; direction = signe de la somme signée", () => {
    // +2 (haussier) − 1 (baissier) = +1 → haussier ; score total 3.
    const ligne = agregerSignaux(BASE, [sig("haussier", 2), null, sig("baissier", 1)]);
    expect(ligne?.score).toBe(3);
    expect(ligne?.direction).toBe("haussier");
    expect(ligne?.signaux).toHaveLength(2);
  });

  it("équilibre parfait : direction « mixte »", () => {
    expect(agregerSignaux(BASE, [sig("haussier", 2), sig("baissier", 2)])?.direction).toBe("mixte");
  });
});

// ─────────────────────────── Échantillon ───────────────────────────

function row(symbol: string, volume: number, funding?: number): ScreenerRow {
  return {
    symbol,
    quote: "USDT",
    lastPrice: 1,
    priceChangePct24h: 0,
    volumeUsd24h: volume,
    ...(funding !== undefined ? { fundingPct: funding } : {}),
  };
}

describe("selectionEchantillon — top liquides à perp ∪ watchlist", () => {
  const univers = [
    row("AUSDT", 300, 0.01),
    row("BUSDT", 200, 0.01),
    row("CUSDT", 100, 0.01),
    row("SPOTONLY", 500), // pas de perp (funding absent) → exclu
    row("WLUSDT", 10, 0.01),
  ];

  it("filtre au perp, trie par volume et coupe au cap", () => {
    const sel = selectionEchantillon(univers, [], 2, 10);
    expect(sel.map((r) => r.symbol)).toEqual(["AUSDT", "BUSDT"]);
  });

  it("ajoute la watchlist présente dans l'univers perp, sans doublon", () => {
    const sel = selectionEchantillon(univers, ["WLUSDT", "AUSDT", "HORSUNIVERS"], 2, 10);
    expect(sel.map((r) => r.symbol)).toEqual(["AUSDT", "BUSDT", "WLUSDT"]);
  });

  it("respecte le plafond total (watchlist tronquée)", () => {
    const sel = selectionEchantillon(univers, ["WLUSDT", "CUSDT"], 2, 3);
    expect(sel).toHaveLength(3);
  });
});

// ─────────────────────────── Divergence fondamentale ───────────────────────────

describe("signalDivergenceFondamentale — Revenus vs Prix & Low-Float", () => {
  it("détecte une accumulation fondamentale (revenus solides + P/S bas + repli du prix)", () => {
    const s = signalDivergenceFondamentale({
      deltaPrix24hPct: -3.8,
      revenus24hUsd: 45_000,
      frais24hUsd: 120_000,
      croissanceFlux7jPct: 24,
      ratioPs: 11.5,
      ratioPf: 4.3,
      floatPct: 72,
      ratioFdvTvl: 1.2,
    });
    expect(s?.id).toBe("divergence-fondamentale");
    expect(s?.direction).toBe("haussier");
    expect(s?.libelle).toBe("Accumulation revenus vs prix");
    expect(s?.poids).toBe(2);
  });

  it("détecte une surchauffe low-float (float < 25 %, hausse rapide, multiples tendus)", () => {
    const s = signalDivergenceFondamentale({
      deltaPrix24hPct: 9.2,
      revenus24hUsd: 100,
      frais24hUsd: 400,
      croissanceFlux7jPct: null,
      ratioPs: null,
      ratioPf: 220,
      floatPct: 12.4,
      ratioFdvTvl: 14.0,
    });
    expect(s?.id).toBe("divergence-fondamentale");
    expect(s?.direction).toBe("baissier");
    expect(s?.libelle).toBe("Surchauffe low-float");
    expect(s?.poids).toBe(2);
  });
});

// Revue du 6 novembre 2026, constat IND-1 : les retournements d'AXIS n'ont été soumis à aucune campagne, et leur
// score sort aussi sur du bruit pur. EQS ne les dit plus « fiables », ne leur donne plus le poids le plus lourd de
// l'inbox, et n'écrit plus le score en « % » (ce n'est pas une probabilité).
describe("signalRetournementAxis — conversion en signal EQS", () => {
  const entree = (sens: "achat" | "vente", scoreConfiance: number, prixEntree = 100) => ({
    sens,
    scoreConfiance,
    rsi: 31.4,
    prixEntree,
    stopInvalidation: prixEntree * 0.96,
    cible1R: prixEntree * 1.04,
    cible2R: prixEntree * 1.08,
    resume: `Retournement ${sens === "achat" ? "ACHAT" : "VENTE"} (${scoreConfiance}/100) : rebond RSI + divergence haussière`,
  });

  it("convertit un retournement achat (80/100) en signal haussier heuristique de poids 1, score sur 100", () => {
    const s = signalRetournementAxis(entree("achat", 80));
    expect(s).toEqual({
      id: "retournement-axis",
      direction: "haussier",
      libelle: "AXIS ↺ Achat (80/100)",
      detail: "Retournement ACHAT (80/100) : rebond RSI + divergence haussière · entrée 100.00 · invalidation 96.00 · cibles 1R 104.00 / 2R 108.00",
      fiabilite: "heuristique",
      poids: 1,
    });
  });

  it("convertit un retournement vente (65/100) en signal baissier heuristique de poids 1", () => {
    const s = signalRetournementAxis({
      sens: "vente",
      scoreConfiance: 65,
      rsi: 68.2,
      prixEntree: 50,
      stopInvalidation: 52,
      cible1R: 48,
      cible2R: 46,
      resume: "Retournement VENTE (65/100) : repli RSI + rejet mèche haute",
    });
    expect(s?.id).toBe("retournement-axis");
    expect(s?.direction).toBe("baissier");
    expect(s?.libelle).toBe("AXIS ↺ Vente (65/100)");
    expect(s?.poids).toBe(1);
    expect(s?.fiabilite).toBe("heuristique");
  });

  it("quel que soit le score (60 à 100) : jamais « fiable », jamais plus lourd qu'un autre signal, aucun « % »", () => {
    for (const score of [60, 74, 75, 85, 100]) {
      for (const sens of ["achat", "vente"] as const) {
        const s = signalRetournementAxis(entree(sens, score));
        expect(s?.fiabilite, `${sens} ${score}`).toBe("heuristique");
        expect(s?.poids, `${sens} ${score}`).toBe(1);
        expect(s?.libelle, `${sens} ${score}`).toBe(`AXIS ↺ ${sens === "achat" ? "Achat" : "Vente"} (${score}/100)`);
        expect(`${s?.libelle} ${s?.detail}`).not.toContain("%");
      }
    }
    // Dans l'inbox, un retournement seul pèse 1 : il passe après un funding extrême réglé (donnée exacte, poids 2).
    const ligne = agregerSignaux(
      { symbol: "XUSDT", lastPrice: 1, priceChangePct24h: 0, volumeUsd24h: 1 },
      [signalRetournementAxis(entree("achat", 100))],
    );
    expect(ligne?.score).toBe(1);
  });

  it("prix sous un centime : quatre chiffres significatifs, au lieu de « 0.0000 »", () => {
    const s = signalRetournementAxis(entree("achat", 80, 0.00001234));
    expect(s?.detail.endsWith(" · entrée 0.00001234 · invalidation 0.00001185 · cibles 1R 0.00001283 / 2R 0.00001333")).toBe(true);
  });

  it("mêmes prix, au caractère près, que l'infobulle du retournement sur le graphe (fixture dorée, prix × 2^-24 et × 1)", () => {
    const fixture = JSON.parse(
      readFileSync(new URL("../../../../packages/indicators/src/golden/fixture-ohlcv.json", import.meta.url), "utf8"),
    ) as Candle[];
    const axis = getIndicator("stratAxis") as IndicatorDef;
    for (const k of [1, 2 ** -24]) {
      const bougies = fixture.map((c) => ({ ...c, open: c.open * k, high: c.high * k, low: c.low * k, close: c.close * k }));
      const dernier = detecterRetournementsAxis(bougies).at(-1)!;
      const graphe = (computeIndicator(axis, bougies, { detecterRetournements: true }).annotations?.marqueurs ?? []).find(
        (m) => m.idx === dernier.idx && m.couleur === "--text-dim",
      );
      const prixDe = (texte: string | undefined): string[] =>
        / · entrée (\S+) · invalidation (\S+) · cibles? 1R (\S+) \/ 2R (\S+)$/.exec(texte ?? "")?.slice(1) ?? [];
      const eqs = prixDe(signalRetournementAxis(dernier)?.detail);
      expect(eqs, String(k)).toHaveLength(4);
      expect(eqs, String(k)).toEqual(prixDe(graphe?.info));
      if (k < 1) for (const p of eqs) expect(p).toMatch(/^0\.00\d{4}$/);
    }
  });

  it("retourne null sous le seuil de 60/100 ou si absent", () => {
    expect(signalRetournementAxis(null)).toBeNull();
    expect(
      signalRetournementAxis({
        sens: "achat",
        scoreConfiance: 45,
        rsi: 40,
        prixEntree: 10,
        stopInvalidation: 9,
        cible1R: 11,
        cible2R: 12,
        resume: "Faible",
      }),
    ).toBeNull();
  });
});
