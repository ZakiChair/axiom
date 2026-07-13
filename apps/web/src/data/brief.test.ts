import { describe, expect, it } from "vitest";
import type { Declenchement } from "@axiom/alerts";
import {
  alertesDeclencheesDuJour,
  assemblerSession,
  briefEnMarkdown,
  deltaOiPct,
  evenementsDuJour,
  evenementsEcoPasses,
  ligneDepuisTicker,
  top5News,
  tradesClosDuJour,
  type DonneesBrief,
  type EvenementBrief,
  type SessionBrief,
} from "./brief";
import type { EcoEvent } from "./eco";
import type { NewsItem } from "./news";
import type { Position } from "../store/portfolio";

// ─────────────────────────── deltaOiPct ───────────────────────────

describe("deltaOiPct", () => {
  it("calcule la variation du premier au dernier point", () => {
    expect(deltaOiPct([{ oiUsd: 100 }, { oiUsd: 110 }])).toBeCloseTo(10);
    expect(deltaOiPct([{ oiUsd: 200 }, { oiUsd: 150 }, { oiUsd: 180 }])).toBeCloseTo(-10);
  });

  it("renvoie null sous 2 points, base nulle ou valeurs non finies", () => {
    expect(deltaOiPct([])).toBeNull();
    expect(deltaOiPct([{ oiUsd: 100 }])).toBeNull();
    expect(deltaOiPct([{ oiUsd: 0 }, { oiUsd: 50 }])).toBeNull();
    expect(deltaOiPct([{ oiUsd: NaN }, { oiUsd: 50 }])).toBeNull();
    expect(deltaOiPct([{ oiUsd: 100 }, { oiUsd: NaN }])).toBeNull();
  });
});

// ─────────────────────────── evenementsDuJour ───────────────────────────

/** Construit un EcoEvent minimal valide pour les tests. */
function eco(partial: Partial<EcoEvent> & Pick<EcoEvent, "time" | "impact">): EcoEvent {
  return {
    id: `id-${partial.time}`,
    country: "USD",
    title: "CPI",
    source: "fred",
    ...partial,
  };
}

describe("evenementsDuJour", () => {
  // Référence locale : 9 juillet 2026, 12:00 (construit en heure LOCALE, comme le filtre).
  const now = new Date(2026, 6, 9, 12, 0, 0).getTime();

  it("ne garde que les évènements FORT impact du MÊME jour, triés chronologiquement", () => {
    const events: EcoEvent[] = [
      eco({ time: new Date(2026, 6, 9, 16, 30, 0).getTime(), impact: "high", title: "NFP" }),
      eco({ time: new Date(2026, 6, 9, 8, 30, 0).getTime(), impact: "high", title: "CPI" }),
      eco({ time: new Date(2026, 6, 9, 10, 0, 0).getTime(), impact: "medium", title: "PPI" }), // impact écarté
      eco({ time: new Date(2026, 6, 10, 8, 30, 0).getTime(), impact: "high", title: "Demain" }), // jour écarté
    ];
    const res = evenementsDuJour(events, now);
    expect(res.map((e) => e.titre)).toEqual(["CPI", "NFP"]);
    expect(res[0]?.pays).toBe("USD");
  });

  it("propage timeApprox (défaut false)", () => {
    const events: EcoEvent[] = [
      eco({ time: new Date(2026, 6, 9, 9, 0, 0).getTime(), impact: "high", timeApprox: true }),
      eco({ time: new Date(2026, 6, 9, 14, 0, 0).getTime(), impact: "high" }),
    ];
    const res = evenementsDuJour(events, now);
    expect(res[0]?.timeApprox).toBe(true);
    expect(res[1]?.timeApprox).toBe(false);
  });

  it("renvoie une liste vide s'il n'y a aucun évènement du jour", () => {
    expect(evenementsDuJour([], now)).toEqual([]);
  });
});

// ─────────────────────────── top5News ───────────────────────────

/** Construit un NewsItem minimal. */
function news(id: string, time: number): NewsItem {
  return { id, title: `titre ${id}`, link: "", time, source: "coindesk", summary: "" };
}

describe("top5News", () => {
  it("retourne les 5 titres les plus récents, triés du plus récent au plus ancien", () => {
    const items: NewsItem[] = [
      news("a", 100),
      news("b", 700),
      news("c", 300),
      news("d", 600),
      news("e", 500),
      news("f", 200),
      news("g", 400),
    ];
    const res = top5News(items);
    expect(res.map((n) => n.id)).toEqual(["b", "d", "e", "g", "c"]);
    expect(res[0]).toEqual({ id: "b", titre: "titre b", source: "coindesk", time: 700 });
  });

  it("tolère moins de 5 items", () => {
    expect(top5News([news("a", 1)]).length).toBe(1);
    expect(top5News([]).length).toBe(0);
  });
});

// ─────────────────────────── ligneDepuisTicker ───────────────────────────

describe("ligneDepuisTicker", () => {
  it("mappe un ticker présent en prix + variation", () => {
    expect(
      ligneDepuisTicker("BTCUSDT", { symbol: "BTCUSDT", lastPrice: "108432.1", priceChangePercent: "1.24" }),
    ).toEqual({ symbole: "BTCUSDT", prix: 108_432.1, variation24h: 1.24 });
  });

  it("renvoie null (« — ») pour un symbole absent — repli par symbole en échec", () => {
    expect(ligneDepuisTicker("XXXUSDT", undefined)).toEqual({
      symbole: "XXXUSDT",
      prix: null,
      variation24h: null,
    });
  });

  it("renvoie null pour des champs non numériques", () => {
    expect(ligneDepuisTicker("BAD", { symbol: "BAD", lastPrice: "n/a", priceChangePercent: "x" })).toEqual({
      symbole: "BAD",
      prix: null,
      variation24h: null,
    });
  });
});

// ─────────────────────────── Session (review) ───────────────────────────

/** Position minimale pour les tests de review. */
function pos(partial: Partial<Position> & Pick<Position, "id" | "statut">): Position {
  return {
    symbole: "BTCUSDT",
    source: "binance",
    direction: "long",
    taille: 1,
    prixEntree: 100,
    dateEntree: 0,
    ...partial,
  };
}

describe("tradesClosDuJour", () => {
  const now = new Date(2026, 6, 9, 18, 0, 0).getTime();
  const midi = new Date(2026, 6, 9, 12, 0, 0).getTime();
  const hier = new Date(2026, 6, 8, 15, 0, 0).getTime();

  it("ne garde que les clôtures du jour civil local, triées chrono", () => {
    const positions: Position[] = [
      pos({
        id: "a",
        statut: "clos",
        prixSortie: 110,
        dateSortie: midi + 2 * 3600_000,
        direction: "long",
      }),
      pos({
        id: "b",
        statut: "clos",
        prixSortie: 90,
        dateSortie: midi,
        direction: "long",
        symbole: "ETHUSDT",
      }),
      pos({ id: "c", statut: "clos", prixSortie: 120, dateSortie: hier }), // hier
      pos({ id: "d", statut: "ouvert" }), // ouvert
    ];
    const res = tradesClosDuJour(positions, now);
    expect(res.map((t) => t.symbole)).toEqual(["ETHUSDT", "BTCUSDT"]);
    expect(res[0]?.pnlNet).toBeCloseTo(-10); // long 100→90
    expect(res[1]?.pnlNet).toBeCloseTo(10); // long 100→110
  });

  it("ignore une clôture sans prix de sortie", () => {
    expect(
      tradesClosDuJour([pos({ id: "x", statut: "clos", dateSortie: midi })], now),
    ).toEqual([]);
  });
});

describe("alertesDeclencheesDuJour", () => {
  const now = new Date(2026, 6, 9, 18, 0, 0).getTime();
  const matin = new Date(2026, 6, 9, 9, 15, 0).getTime();
  const hier = new Date(2026, 6, 8, 20, 0, 0).getTime();

  it("filtre le journal au jour civil et trie croissante", () => {
    const journal: Declenchement[] = [
      { alertId: "1", ts: matin + 3600_000, message: "Plus tard", valeur: 2 },
      { alertId: "2", ts: matin, message: "Matin", valeur: 1 },
      { alertId: "3", ts: hier, message: "Hier", valeur: 0 },
    ];
    const res = alertesDeclencheesDuJour(journal, now);
    expect(res.map((a) => a.message)).toEqual(["Matin", "Plus tard"]);
  });
});

describe("evenementsEcoPasses", () => {
  const now = new Date(2026, 6, 9, 12, 0, 0).getTime();
  it("ne garde que time ≤ now", () => {
    const events: EvenementBrief[] = [
      { time: now - 1000, pays: "USD", titre: "passé", timeApprox: false },
      { time: now, pays: "EUR", titre: "pile", timeApprox: false },
      { time: now + 1000, pays: "USD", titre: "futur", timeApprox: false },
    ];
    expect(evenementsEcoPasses(events, now).map((e) => e.titre)).toEqual(["passé", "pile"]);
  });
});

describe("assemblerSession", () => {
  const now = new Date(2026, 6, 9, 18, 0, 0).getTime();
  const midi = new Date(2026, 6, 9, 12, 0, 0).getTime();

  it("agrège PnL / W-L et propage eco null", () => {
    const positions: Position[] = [
      pos({ id: "w", statut: "clos", prixSortie: 110, dateSortie: midi }), // +10
      pos({
        id: "l",
        statut: "clos",
        prixSortie: 95,
        dateSortie: midi + 1000,
        symbole: "ETHUSDT",
      }), // -5
    ];
    const s = assemblerSession(positions, [], null, now);
    expect(s.pnlRealise).toBeCloseTo(5);
    expect(s.gagnants).toBe(1);
    expect(s.perdants).toBe(1);
    expect(s.ecoPasses).toBeNull();
  });
});

// ─────────────────────────── briefEnMarkdown ───────────────────────────

/** Session vide (aucune activité) pour les tests markdown. */
function sessionVide(): SessionBrief {
  return {
    tradesClos: [],
    pnlRealise: 0,
    gagnants: 0,
    perdants: 0,
    alertes: [],
    ecoPasses: [],
  };
}

describe("briefEnMarkdown", () => {
  const now = new Date(2026, 6, 9, 8, 30, 0).getTime();

  it("compose un markdown complet avec toutes les sections", () => {
    const donnees: DonneesBrief = {
      session: {
        tradesClos: [
          {
            symbole: "BTCUSDT",
            direction: "long",
            pnlNet: 250,
            pnlPct: 2.5,
            dateSortie: now - 3600_000,
            prixEntree: 100_000,
            prixSortie: 102_500,
          },
        ],
        pnlRealise: 250,
        gagnants: 1,
        perdants: 0,
        alertes: [{ alertId: "a1", ts: now - 1800_000, message: "Prix franchit 100000", valeur: 100_001 }],
        ecoPasses: [{ time: now - 7200_000, pays: "USD", titre: "CPI", timeApprox: false }],
      },
      watchlist: [{ symbole: "BTCUSDT", prix: 108_432.1, variation24h: 1.24 }],
      derivs: [
        {
          symbole: "BTC",
          fundingActuel: 0.0001,
          fundingPredit: 0.00012,
          prochainReglement: now + 3 * 60 * 60 * 1000,
          deltaOiPct: 2.4,
        },
      ],
      etf: [
        { actif: "btc", disponible: true, total: 212_000_000, jour: "2026-07-08" },
        { actif: "sol", disponible: false, total: null, jour: null, raison: "clé absente" },
      ],
      eco: [{ time: now + 4 * 60 * 60 * 1000, pays: "USD", titre: "CPI", timeApprox: false }],
      news: [{ id: "n1", titre: "Titre récent", source: "coindesk", time: now - 12 * 60 * 1000 }],
      fearGreed: { value: 62, classification: "Greed", time: now },
      dvol: [{ devise: "BTC", valeur: 48.3 }],
    };
    const md = briefEnMarkdown(donnees, now);
    expect(md).toContain("# BRIEF — Point marché");
    expect(md).toContain("## Session (review)");
    expect(md).toContain("**PnL réalisé**");
    expect(md).toContain("BTCUSDT long");
    expect(md).toContain("Prix franchit 100000");
    expect(md).toContain("### Événements éco passés");
    expect(md).toContain("## Watchlist (overnight)");
    expect(md).toContain("BTCUSDT");
    expect(md).toContain("+1.24%");
    expect(md).toContain("## Dérivés");
    expect(md).toContain("ΔOI 24 h +2.40%");
    expect(md).toContain("## Flux ETF (veille)");
    expect(md).toContain("(2026-07-08)");
    expect(md).toContain("SOL · indisponible");
    expect(md).toContain("CPI");
    expect(md).toContain("Fear & Greed : 62 (Greed)");
    expect(md).toContain("Titre récent");
    expect(md).toContain("## Volatilité (DVOL)");
    expect(md).toContain("BTC · 48.3 %");
  });

  it("tolère toutes les sections absentes (null) sans lever", () => {
    const vide: DonneesBrief = {
      session: null,
      watchlist: null,
      derivs: null,
      etf: null,
      eco: null,
      news: null,
      fearGreed: null,
      dvol: null,
    };
    const md = briefEnMarkdown(vide, now);
    // Les titres de section restent présents, chaque corps signale l'indisponibilité.
    expect(md).toContain("## Session (review)");
    expect(md).toContain("## Watchlist (overnight)");
    expect(md).toContain("## Dérivés");
    expect(md).toContain("## Volatilité (DVOL)");
    // 6 sections réseau + session = 7
    expect((md.match(/_Section indisponible._/g) ?? []).length).toBe(7);
    expect(md).not.toContain("Fear & Greed :");
  });

  it("marque « passé » un évènement éco déjà écoulé et « dans … » un évènement futur", () => {
    const donnees: DonneesBrief = {
      session: null,
      watchlist: null,
      derivs: null,
      etf: null,
      eco: [
        { time: now - 2 * 60 * 60 * 1000, pays: "USD", titre: "CPI passé", timeApprox: false },
        { time: now, pays: "EUR", titre: "Pile maintenant", timeApprox: false },
        { time: now + 2 * 60 * 60 * 1000, pays: "USD", titre: "NFP à venir", timeApprox: false },
      ],
      news: null,
      fearGreed: null,
      dvol: null,
    };
    const md = briefEnMarkdown(donnees, now);
    expect(md).toContain("CPI passé · passé");
    expect(md).toContain("Pile maintenant · passé");
    expect(md).toContain("NFP à venir · dans 2 h 00");
    expect(md).not.toContain("imminent");
  });

  it("affiche l'absence d'évènement éco et de watchlist explicitement", () => {
    const donnees: DonneesBrief = {
      session: sessionVide(),
      watchlist: [],
      derivs: null,
      etf: null,
      eco: [],
      news: [],
      fearGreed: null,
      dvol: null,
    };
    const md = briefEnMarkdown(donnees, now);
    expect(md).toContain("_Aucun trade clôturé aujourd'hui._");
    expect(md).toContain("_Aucune alerte déclenchée aujourd'hui._");
    expect(md).toContain("_Aucun symbole dans la watchlist._");
    expect(md).toContain("_Aucun événement à fort impact aujourd'hui._");
    expect(md).toContain("_Aucune actualité._");
  });
});
