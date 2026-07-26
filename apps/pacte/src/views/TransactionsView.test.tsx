import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDemoState } from "../data/demo";
import { transactionImportMessage, TransactionsView } from "./TransactionsView";

describe("transactionImportMessage", () => {
  it("distingue un réimport intégral d'un ajout réel", () => {
    expect(transactionImportMessage(0)).toBe(
      "Aucun nouveau mouvement : toutes les lignes étaient déjà dans le journal.",
    );
    expect(transactionImportMessage(1)).toBe("1 mouvement a été ajouté au journal.");
    expect(transactionImportMessage(3)).toBe("3 mouvements ont été ajoutés au journal.");
  });
});

describe("TransactionsView", () => {
  it("rend le journal filtrable et les deux chemins d'ajout sans API navigateur", () => {
    const markup = renderToStaticMarkup(
      <TransactionsView
        defaultCurrency="CHF"
        onImportTransactions={() => ({ ok: true, changed: 1 })}
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
