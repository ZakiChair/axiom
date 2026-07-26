import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDemoState } from "../data/demo";
import { TransactionsView } from "./TransactionsView";

describe("TransactionsView", () => {
  it("rend le journal filtrable et les deux chemins d'ajout sans API navigateur", () => {
    const markup = renderToStaticMarkup(
      <TransactionsView
        defaultCurrency="CHF"
        onImportTransactions={() => undefined}
        transactions={createDemoState().transactions}
      />,
    );

    expect(markup).toContain('aria-labelledby="transactions-title"');
    expect(markup).toContain('for="transaction-filter"');
    expect(markup).toContain("Ajouter un mouvement");
    expect(markup).toContain("Importer un CSV");
    expect(markup).toContain("PRLV ALPINE MOBILE");
    expect(markup).toContain("Montant");
  });
});
