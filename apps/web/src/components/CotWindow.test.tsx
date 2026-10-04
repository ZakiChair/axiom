import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CotWindow } from "./CotWindow";
import { assemblerCategorie, cotStore } from "../store/cot";

// Le snapshot SSR de Zustand est figé à la création ; les fixtures visent ici l'état courant.
vi.mock("zustand", () => ({
  useStore: <T, U>(store: { getState: () => T }, select: (state: T) => U) => select(store.getState()),
}));

const initial = cotStore.getState();
afterEach(() => cotStore.setState(initial, true));

function rendu(categorie: "legacy" | "fonds" | "commerciaux" = "legacy") {
  const records = ["2026-06-09", "2026-06-23"].map((date, i) => ({
    market_and_exchange_names: "GOLD - COMMODITY EXCHANGE INC.",
    report_date_as_yyyy_mm_dd: date,
    noncomm_positions_long_all: i ? 217028 : 211127,
    noncomm_positions_short_all: i ? 35689 : 30907,
    m_money_positions_long_all: i ? 217028 : 211127,
    m_money_positions_short_all: i ? 35689 : 30907,
    prod_merc_positions_long: i ? 90000 : 100000,
    prod_merc_positions_short: i ? 150000 : 140000,
    open_interest_all: 352167,
  }));
  cotStore.setState({
    categorie, resume: assemblerCategorie({ legacy: records, disaggregated: records }, categorie),
    enCours: false, erreur: null,
  });
  return renderToStaticMarkup(<CotWindow />).replace(/\u202f|\u00a0/g, " ");
}

describe("résumé COT lisible sans survol", () => {
  it("montre les stocks exacts, les deux mouvements nets et la vraie période", () => {
    const html = rendu();
    expect(html).toContain("Longs · acheteurs");
    expect(html).toContain("Shorts · vendeurs");
    expect(html).toContain("217 028");
    expect(html).toContain("35 689");
    expect(html).toContain("Ajouts nets");
    expect(html).toContain("+5 901");
    expect(html).toContain("+4 782");
    expect(html).toContain("Net acheteur");
    expect(html).toContain("+1 119");
    expect(html).toContain("vs 9 juin 2026 (14 jours)");
    expect(html).not.toContain("cette semaine");
    expect(html).not.toMatch(/\d+ longs (ouverts|fermés)/);
    expect(html).toContain("flux bruts peuvent se compenser et restent inconnus");
    expect(html).toContain("Δ net = Δ longs − Δ shorts");
    expect(html).toContain("COT Index");
    expect(html).toContain("pas un percentile");
    expect(html).toContain("OI · tout le marché");
    expect(html).toContain("pas la somme longs + shorts");
  });

  it("rend la zone de rapports nommée, focusable et avec un focus visible", () => {
    const html = rendu();
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Rapports COT"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("focus-visible:ring-2");
  });

  it("respecte la sémantique des commerciaux et distingue leurs réductions/ajouts", () => {
    const html = rendu("commerciaux");
    expect(html).toContain("Net commercial (Producer / Asset Manager)");
    expect(html).not.toContain("Net spéculatif");
    expect(html).toContain("Réductions nettes");
    expect(html).toContain("−10 000");
    expect(html).toContain("+10 000");
    expect(html).toContain("Net vendeur");
    expect(html).not.toMatch(/signal (haussier|baissier)/);
  });

  it("une ancienne ligne affiche explicitement l'absence des stocks", () => {
    cotStore.setState({
      resume: { dateRapport: Date.parse("2026-06-23"), lignes: [{
        nom: "ancien", libelle: "Ancien rapport", categorie: "metal", nonCouvert: false,
        net: 10, delta: null, openInterest: NaN, dateRapport: Date.parse("2026-06-23"),
        serie: [{ t: Date.parse("2026-06-23"), net: 10, oi: NaN }],
      }] }, enCours: false, erreur: null,
    });
    const html = renderToStaticMarkup(<CotWindow />);
    expect(html.match(/Indisponible/g)).toHaveLength(3); // 2 stocks + note Index
    expect(html.match(/Variation indisponible/g)).toHaveLength(2);
    expect(html).toContain("comparaison indisponible");
    expect(html).not.toContain(">0</");
  });
});
