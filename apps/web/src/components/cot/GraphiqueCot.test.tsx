import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GraphiqueCot, tracerLigne } from "./GraphiqueCot";
import { CotWindow } from "../CotWindow";
import { cotHistoriqueStore } from "../../store/cotHistorique";
import { parserHistorique, resoudreColonnes, type PointHistoriqueCot } from "../../data/cotHistorique";

// Le snapshot SSR de Zustand est figé à la création ; les fixtures visent ici l'état courant.
vi.mock("zustand", () => ({
  useStore: <T, U>(store: { getState: () => T }, select: (state: T) => U) => select(store.getState()),
}));

const SP = "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE";
const initial = cotHistoriqueStore.getState();
afterEach(() => cotHistoriqueStore.setState(initial, true));

const COLONNES = [
  "open_interest_all",
  "dealer_positions_long_all",
  "dealer_positions_short_all",
  "asset_mgr_positions_long",
  "asset_mgr_positions_short",
  "lev_money_positions_long",
  "lev_money_positions_short",
  "other_rept_positions_long",
  "other_rept_positions_short",
  "nonrept_positions_long_all",
  "nonrept_positions_short_all",
];

/** Rapport COHÉRENT si dealerShort = am − 300 000 (Σ longs = Σ shorts hors spreads). */
function rec(date: string, am: number, dealerShort: number) {
  return {
    market_and_exchange_names: SP,
    report_date_as_yyyy_mm_dd: `${date}T00:00:00.000`,
    open_interest_all: "2000000",
    dealer_positions_long_all: "100000",
    dealer_positions_short_all: String(dealerShort),
    asset_mgr_positions_long: String(am),
    asset_mgr_positions_short: "200000",
    lev_money_positions_long: "150000",
    lev_money_positions_short: "350000",
    other_rept_positions_long: "80000",
    other_rept_positions_short: "60000",
    nonrept_positions_long_all: "90000",
    nonrept_positions_short_all: "110000",
  };
}

function rendu(colonnes = COLONNES, records = [rec("2026-10-20", 900000, 600000), rec("2026-10-27", 950000, 650000)]) {
  const serie = parserHistorique(records, "tff", SP, resoudreColonnes("tff", new Set(colonnes)));
  cotHistoriqueStore.setState({ marche: SP, mode: "detaille", serie, ts: Date.now(), enCours: false, erreur: null, nonCouvert: false });
  return renderToStaticMarkup(<GraphiqueCot />).replace(/ | /g, " ");
}

describe("graphique COT — exposition par catégorie", () => {
  it("nomme toutes les catégories TFF et donne leurs chiffres du dernier rapport", () => {
    const html = rendu();
    for (const libelle of ["Dealers / intermédiaires", "Gérants d&#x27;actifs / institutionnels", "Fonds à effet de levier", "Autres déclarants", "Non déclarants"]) {
      expect(html).toContain(libelle);
    }
    expect(html).toContain("Exposition au 27 oct. 2026");
    expect(html).toContain("950 000"); // longs des gérants d'actifs
    expect(html).toContain("+750 000"); // net des gérants d'actifs
    expect(html).toContain("+50 000"); // Δ net des gérants d'actifs
    expect(html).toContain("+37,5 %"); // net/OI des gérants d'actifs
    expect(html).toContain("Open interest (tout le marché) : 2 000 000 contrats");
    expect(html).toContain('role="table" aria-label="Exposition par catégorie au dernier rapport"');
    expect(html).toContain('aria-pressed="true"');
  });

  it("annonce la cadence hebdomadaire et contrôle la cohérence", () => {
    const html = rendu();
    expect(html).toContain("Positions du 27 oct. 2026");
    expect(html).toMatch(/prochain rapport (ven\.|vendredi) 6 nov\. vers 15 h 30 \(New York\)/);
    expect(html).toContain("la somme des nets de toutes les catégories vaut 0 sur les 2 rapports");
    expect(html).toContain("Traders in Financial Futures (TFF)");
    expect(html).toContain('role="img"');
    expect(html).toContain("2 rapports du 20 oct. 2026 au 27 oct. 2026");
  });

  it("signale un rapport en retard plutôt que de se taire", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T09:00:00Z"));
    try {
      const html = rendu();
      expect(html).toContain("rapport du 3 nov. 2026 attendu, pas encore publié");
    } finally {
      vi.useRealTimers();
    }
  });

  it("une catégorie absente de la réponse est dite, jamais remplacée par zéro", () => {
    const html = rendu(COLONNES.filter((c) => !c.startsWith("other_rept")));
    expect(html).toContain("Autres déclarants (absente)");
    expect(html).toContain("Contrôle Σ des nets = 0 indisponible");
    expect(html).toContain("Absente(s) de la réponse CFTC : Autres déclarants.");
  });

  it("une incohérence Σ nets ≠ 0 est signalée", () => {
    const html = rendu(COLONNES, [rec("2026-10-20", 900000, 600000), { ...rec("2026-10-27", 950000, 650000), lev_money_positions_short: "300000" }]);
    expect(html).toContain("Σ des nets ≠ 0 sur 1/2 rapports");
    expect(html).toContain("Contrôle en échec : la somme des nets des catégories n&#x27;est pas nulle sur 1/2");
  });

  it("marché absent du rapport détaillé : message et piste Legacy", () => {
    cotHistoriqueStore.setState({ marche: SP, mode: "detaille", serie: null, ts: null, enCours: false, erreur: null, nonCouvert: true });
    const html = renderToStaticMarkup(<GraphiqueCot />).replace(/ | /g, " ");
    expect(html).toContain("n&#x27;apparaît pas dans le rapport Traders in Financial Futures (TFF)");
    expect(html).toContain("Essayez le rapport Legacy");
  });

  it("chargement et erreur sans série : états explicites", () => {
    cotHistoriqueStore.setState({ serie: null, enCours: true, erreur: null, nonCouvert: false });
    expect(renderToStaticMarkup(<GraphiqueCot />)).toContain("Lecture de l&#x27;historique CFTC");
    cotHistoriqueStore.setState({ serie: null, enCours: false, erreur: "Historique COT (CFTC) indisponible.", nonCouvert: false });
    expect(renderToStaticMarkup(<GraphiqueCot />)).toContain("Historique COT (CFTC) indisponible.");
  });

  it("le sélecteur propose les 14 marchés regroupés par famille", () => {
    const html = rendu();
    expect(html.match(/<option /g)).toHaveLength(14);
    expect(html).toContain('<optgroup label="Devises">');
    expect(html).toContain('<optgroup label="Crypto (CME)">');
  });
});

describe("fenêtre COT — onglets", () => {
  it("propose la synthèse et le graphique, et un accès au graphique par marché", () => {
    const html = renderToStaticMarkup(<CotWindow />);
    expect(html).toContain(">Synthèse<");
    expect(html).toContain(">Graphique<");
  });
});

describe("tracé d'une catégorie", () => {
  /** Contexte canvas minimal qui enregistre les appels de tracé. */
  function ctxEspion() {
    const appels: string[] = [];
    const ctx = {
      lineWidth: 2,
      strokeStyle: "#123456",
      fillStyle: "",
      beginPath: () => appels.push("begin"),
      moveTo: (x: number) => appels.push(`M${x}`),
      lineTo: (x: number) => appels.push(`L${x}`),
      stroke: () => appels.push("stroke"),
      arc: (x: number) => appels.push(`arc${x}`),
      fill: () => appels.push("fill"),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, appels };
  }
  const SEM = 7 * 86_400_000;
  const pt = (t: number, v: number | null): PointHistoriqueCot => ({ t, oi: 100, longs: [v ?? NaN], shorts: [0] });
  const valeur = (p: PointHistoriqueCot) => (Number.isFinite(p.longs[0]!) ? p.longs[0]! : null);
  const x = (t: number) => t / SEM;

  it("relie les rapports consécutifs et marque d'un point ceux sans voisin", () => {
    // 0-1 reliés ; 5 isolé (écart > 3 semaines) ; 6 absent ; 7 isolé (voisin absent).
    const points = [pt(0, 1), pt(SEM, 2), pt(5 * SEM, 3), pt(6 * SEM, null), pt(7 * SEM, 4)];
    const { ctx, appels } = ctxEspion();
    tracerLigne(ctx, points, 0, points.length - 1, valeur, x, (v) => v);
    expect(appels.filter((a) => a.startsWith("L"))).toEqual(["L1"]);
    expect(appels.filter((a) => a.startsWith("arc"))).toEqual(["arc5", "arc7"]);
    expect(ctx.fillStyle).toBe("#123456");
  });

  it("une série d'un seul rapport est visible", () => {
    const { ctx, appels } = ctxEspion();
    tracerLigne(ctx, [pt(0, 1)], 0, 0, valeur, x, (v) => v);
    expect(appels.filter((a) => a.startsWith("arc"))).toEqual(["arc0"]);
  });
});
