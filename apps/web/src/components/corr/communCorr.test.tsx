/**
 * Bandeau d'univers des onglets Rotation et Régime (rendu statique, env node) : les paires
 * écartées de la coupe sont listées avec leur raison, les paires de base BTC autres que
 * BTCUSDT sont signalées comme la référence (revue du 2026-11-07).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BandeauUnivers, seriesPourUnivers, type UniversTransversal } from "./communCorr";
import { classerUniversTransversal } from "../../data/rotationRelative";

function univers(symboles: string[]): UniversTransversal {
  const sourceDe = (s: string) =>
    s.endsWith("-PERP") ? ("hyperliquid" as const) : s === "GLD" ? ("twelvedata" as const) : ("binance" as const);
  return {
    id: "watchlist",
    ...classerUniversTransversal(symboles, sourceDe),
    libelle: "Watchlist",
    estTop: false,
    composeA: Date.UTC(2026, 10, 7, 9, 0),
  };
}

describe("BandeauUnivers", () => {
  it("liste les exclusions avec leur raison, les paires BTC comptées comme la référence et les hors crypto", () => {
    const u = univers(["ETHUSDT", "ETHBTC", "BTC-PERP", "BTCUSDT", "ADAEUR", "SOLUSDT", "GLD"]);
    const html = renderToStaticMarkup(<BandeauUnivers univers={u} nCharges={2} dernierJour={20_398} />);
    expect(html).toContain("2/2 alts");
    expect(html).toContain("BTC = référence (BTCUSDT)");
    expect(html).toContain("comptés comme la référence (pas des alts) : BTC-PERP.");
    expect(html).toContain("Hors crypto écartés : GLD.");
    expect(html).toContain("Écartés de la coupe (2)");
    expect(html).toContain("ETHBTC</span> — cotation BTC (non USD)");
    expect(html).toContain("ADAEUR</span> — cotation EUR (non USD)");
  });

  it("univers propre : aucune ligne d'exclusion", () => {
    const html = renderToStaticMarkup(
      <BandeauUnivers univers={univers(["ETHUSDT", "BTCUSDT"])} nCharges={1} dernierJour={null} />,
    );
    expect(html).not.toContain("Écartés");
    expect(html).not.toContain("comptés comme la référence");
  });
});

describe("seriesPourUnivers — jamais les séries d'un autre univers", () => {
  const series = new Map([["ETHUSDT", []]]);
  const pret = { statut: "pret" as const, series, chargeA: 1, signature: "ETHUSDT|SOLUSDT" };

  it("sert les séries chargées pour la même signature", () => {
    expect(seriesPourUnivers(pret, "ETHUSDT|SOLUSDT")).toBe(pret);
  });

  it("univers changé, effet pas encore relancé : « chargement », aucun résultat (donc rien de persisté)", () => {
    const vu = seriesPourUnivers(pret, "ETHUSDT|SOLUSDT|ADAUSDT");
    expect(vu).toEqual({ statut: "chargement", series: null, chargeA: null });
    expect(seriesPourUnivers({ ...pret, signature: null }, null).statut).toBe("chargement");
  });
});

describe("BandeauUnivers — figé ou non", () => {
  it("top N : figé jusqu'à « Recalculer » ; watchlist : suit la watchlist", () => {
    const w = univers(["ETHUSDT", "BTCUSDT"]);
    expect(renderToStaticMarkup(<BandeauUnivers univers={w} nCharges={1} dernierJour={null} />)).toContain("suit la watchlist");
    const top = renderToStaticMarkup(<BandeauUnivers univers={{ ...w, estTop: true }} nCharges={1} dernierJour={null} />);
    expect(top).toContain("figé jusqu&#x27;à « Recalculer »");
  });
});
