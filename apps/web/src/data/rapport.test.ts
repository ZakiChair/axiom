/**
 * Tests du générateur de rapport HTML autonome (data/rapport.ts).
 *
 * Cible : `genererRapportHtml` — fonction PURE et déterministe. On verrouille les invariants
 * décidés par le contrôleur : sections conditionnelles présentes/absentes selon les données,
 * teintes inline (vert #16a34a / rouge #dc2626), AUCUNE URL externe (fichier isolé,
 * imprimable), et échappement HTML systématique des chaînes utilisateur (notes/tags/symboles).
 */
import { describe, expect, it } from "vitest";
import { genererRapportHtml, type DonneesRapport } from "./rapport";
import type { Exposition } from "../store/portfolio";
import type { StatsExpy, TradeJournal } from "./expy";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const expo: Exposition = {
  brute: 15000,
  nette: 5000,
  longue: 10000,
  courte: 5000,
  parActif: { BTCUSDT: 10000, ETHUSDT: -5000 },
};

const stats: StatsExpy = {
  n: 3,
  expectancy: 0.42,
  winRate: 0.66,
  profitFactor: 2.1,
  moyGain: 1.5,
  moyPerte: -0.8,
  meilleurR: 3.2,
  pireR: -1.1,
};

const tradeGagnant: TradeJournal = {
  id: "t1",
  symbol: "BTCUSDT",
  direction: "long",
  entree: 60000,
  stopInitial: 58000,
  taille: 0.1,
  sortie: 64000,
  ouvertTs: 1_700_000_000_000,
  fermeTs: 1_700_500_000_000,
  note: "cassure propre",
  tags: ["breakout"],
};

/** Rapport complet : toutes sections peuplées, une position perdante (teinte rouge). */
const complet: DonneesRapport = {
  genereTs: 1_700_600_000_000,
  periodeJours: 30,
  portefeuille: {
    positions: [
      {
        symbole: "BTCUSDT",
        direction: "long",
        taille: 0.1,
        prixEntree: 60000,
        prixCourant: 60000,
        pnlLatent: 250, // gain → vert
      },
      {
        symbole: "ETHUSDT",
        direction: "short",
        taille: 2,
        prixEntree: 3000,
        prixCourant: 3000,
        pnlLatent: -120, // perte → rouge
      },
    ],
    expo,
    pnlRealisePeriode: -340, // perte → rouge
  },
  risque: {
    var95Pct: 0.031,
    var99Pct: 0.055,
    cvar95Pct: 0.042,
    nJours: 90,
    varUsd95: 465,
    varUsd99: 825,
  },
  journal: { stats, trades: [tradeGagnant] },
  paper: null,
};

// ── Sections conditionnelles ────────────────────────────────────────────────

describe("genererRapportHtml — sections conditionnelles", () => {
  it("émet les titres de toutes les sections peuplées", () => {
    const html = genererRapportHtml(complet);
    expect(html).toContain("<h2>Portefeuille</h2>");
    expect(html).toContain("<h2>Risque</h2>");
    expect(html).toContain("<h2>Journal (EXPY)</h2>");
    // Le symbole et la période apparaissent bien.
    expect(html).toContain("BTCUSDT");
    expect(html).toContain("30");
  });

  it("omet Risque et Journal quand les données sont null", () => {
    const html = genererRapportHtml({ ...complet, risque: null, journal: null });
    expect(html).not.toContain("<h2>Risque</h2>");
    expect(html).not.toContain("<h2>Journal (EXPY)</h2>");
    // Le portefeuille reste toujours présent (section de base).
    expect(html).toContain("<h2>Portefeuille</h2>");
  });

  it("omet Paper trading quand paper est null (store non encore mergé)", () => {
    const html = genererRapportHtml(complet);
    expect(html).not.toContain("Paper trading");
  });

  it("émet Paper trading quand des données paper existent", () => {
    const html = genererRapportHtml({
      ...complet,
      paper: { executions: [], pnlPeriode: 50 },
    });
    expect(html).toContain("Paper trading");
  });
});

// ── Teintes inline (vert/rouge) ──────────────────────────────────────────────

describe("genererRapportHtml — teintes", () => {
  it("colore un gain en vert et une perte en rouge (constantes inline)", () => {
    const html = genererRapportHtml(complet);
    expect(html).toContain("#16a34a"); // gain latent BTC +250
    expect(html).toContain("#dc2626"); // perte latente ETH −120 / PnL réalisé −340
  });
});

// ── Autonomie : aucune URL externe ───────────────────────────────────────────

describe("genererRapportHtml — autonomie (imprimable, hors-ligne)", () => {
  it("ne contient AUCUNE URL externe (http/https)", () => {
    const html = genererRapportHtml(complet);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("ne référence aucune ressource distante (link/script src, @import)", () => {
    const html = genererRapportHtml(complet);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/\bsrc=/i);
    expect(html).not.toMatch(/@import/i);
  });
});

// ── Échappement HTML des chaînes utilisateur ─────────────────────────────────

describe("genererRapportHtml — échappement HTML", () => {
  const injecte: DonneesRapport = {
    ...complet,
    portefeuille: {
      ...complet.portefeuille,
      positions: [
        {
          symbole: "<script>alert('x')</script>",
          direction: "long",
          taille: 1,
          prixEntree: 100,
          prixCourant: 100,
          pnlLatent: 10,
        },
      ],
    },
    journal: {
      stats,
      trades: [
        {
          ...tradeGagnant,
          note: "<script>steal()</script>",
          tags: ["<img src=x onerror=1>"],
        },
      ],
    },
  };

  it("échappe les symboles, notes et tags utilisateur", () => {
    const html = genererRapportHtml(injecte);
    // Forme échappée POSITIVE présente (évite un test vide si le champ était supprimé).
    expect(html).toContain("&lt;script&gt;");
    // Aucune balise script utilisateur brute injectée.
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<script>steal");
    expect(html).not.toContain("<img src=x onerror=1>");
  });
});
