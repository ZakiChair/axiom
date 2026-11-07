import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getIndicator } from "@axiom/indicators";
import type { ContexteIndicateur } from "../lib/indicatorUsability";
import { paramsAvecUnite, VueSelecteurUnite } from "./SelecteurUnite";

const BINANCE_1H: ContexteIndicateur = { exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" };

function rendu(defId: string, params: Record<string, number | boolean | string>, ctx = BINANCE_1H): string {
  return renderToStaticMarkup(<VueSelecteurUnite def={getIndicator(defId)!} params={params} ctx={ctx} onChange={() => {}} />);
}

describe("sélecteur d'unité de calcul", () => {
  it("propose l'unité du graphe et les unités supérieures admises", () => {
    const html = rendu("rsi", { length: 14 });
    expect(html).toContain("Unité de calcul");
    expect(html).toContain('<option value="" selected="">Graphe (1h)</option>');
    expect(html).toContain('<option value="4h">4h</option>');
    expect(html).toContain('<option value="1d">1d</option>');
    expect(html).not.toContain("1w");
  });

  it("unité choisie : lecture à la clôture expliquée ; redondance signalée pour une moyenne mobile", () => {
    const html = rendu("ema", { length: 50, unite: "4h" });
    expect(html).toContain('<option value="4h" selected="">4h</option>');
    expect(html).toContain("Lue à la clôture de chaque bougie 4h");
    expect(html).toContain("Graphe seulement (ni alertes ni backtest)");
    expect(html).toContain("Moyenne mobile : proche d&#x27;une période ×4 sur 1h.");
    expect(rendu("rsi", { length: 14, unite: "1d" })).not.toContain("Moyenne mobile");
  });

  it("unité posée mais refusée ici : gardée visible avec son motif, jamais effacée", () => {
    const html = rendu("ema", { length: 50, unite: "4h" }, { ...BINANCE_1H, timeframe: "4h" });
    expect(html).toContain('<option value="4h" selected="">4h (refusée)</option>');
    expect(html).toContain("Refusée sur ce graphe : Unité 4h non proposée sur un graphe 4h (1d, 1w).");
  });

  it("rien à proposer (stratégie, place exclue, unité sans couple) : aucun contrôle", () => {
    expect(rendu("stratAxis", {})).toBe("");
    expect(rendu("ema", { length: 20 }, { exchange: "twelvedata", symbol: "AAPL", timeframe: "1h" })).toBe("");
    expect(rendu("ema", { length: 20 }, { ...BINANCE_1H, timeframe: "1w" })).toBe("");
  });

  it("le choix pose ou retire la clé sans toucher aux autres paramètres", () => {
    expect(paramsAvecUnite({ length: 20 }, "1d")).toEqual({ length: 20, unite: "1d" });
    expect(paramsAvecUnite({ length: 20, unite: "1d" }, "4h")).toEqual({ length: 20, unite: "4h" });
    expect(paramsAvecUnite({ length: 20, unite: "1d" }, "")).toEqual({ length: 20 });
  });
});
