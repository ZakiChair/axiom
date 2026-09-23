import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { TradeJournal } from "../../data/expy";
import { ContexteResultats } from "./ContexteResultats";

const trade: TradeJournal = { id: "t", symbol: "BTCUSDT", source: "binance", decisionIds: [],
  direction: "long", entree: 100, stopInitial: 90, taille: 1, sortie: 110,
  ouvertTs: 1000, fermeTs: 2000, tags: [] };

describe("résultats EXPY sans capture", () => {
  it("montre l'effectif non prouvé, le R et les exclusions sans dimension sélectionnable", () => {
    const html = renderToStaticMarkup(<ContexteResultats trades={[trade, { ...trade, id: "historique", source: undefined }]} dossiers={[]} />);
    expect(html).toContain("Aucune dimension archivée");
    expect(html).toContain("Total 1 trade(s) fermé(s) sourcé(s)");
    expect(html).toContain("Contexte non prouvé : 1 trade(s)");
    expect(html).toContain("n R 1");
    expect(html).toContain("1 sans source");
  });
});
