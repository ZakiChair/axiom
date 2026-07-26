import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDemoState } from "../data/demo";
import {
  CsvPreview,
  transactionImportMessage,
  transactionOrigin,
  TransactionsView,
} from "./TransactionsView";

describe("transactionImportMessage", () => {
  it("distingue un réimport intégral d'un ajout réel", () => {
    expect(transactionImportMessage(0)).toBe(
      "Aucun nouveau mouvement : toutes les lignes étaient déjà dans le journal.",
    );
    expect(transactionImportMessage(1)).toBe("1 mouvement a été ajouté au journal.");
    expect(transactionImportMessage(3)).toBe("3 mouvements ont été ajoutés au journal.");
  });
});

describe("transactionOrigin", () => {
  it("distingue la saisie manuelle, l'import CSV et le registre initial", () => {
    expect(transactionOrigin({
      id: "transaction-manual-1",
      date: "2026-07-26",
      label: "MANUEL",
      amount: 10,
      currency: "CHF",
      importedAt: "2026-07-26T12:00:00.000Z",
    })).toEqual({ label: "Saisie manuelle", className: "origin-manual" });
    expect(transactionOrigin({
      id: "transaction:csv",
      date: "2026-07-26",
      label: "CSV",
      amount: 10,
      currency: "CHF",
      importedAt: "2026-07-26T12:00:00.000Z",
    })).toEqual({ label: "Import CSV", className: "origin-csv" });
    expect(transactionOrigin(createDemoState().transactions[0]!)).toEqual({
      label: "Registre initial",
      className: "origin-initial",
    });
  });
});

describe("TransactionsView", () => {
  it("rend le journal filtrable et les deux chemins d'ajout sans API navigateur", () => {
    const markup = renderToStaticMarkup(
      <TransactionsView
        contracts={createDemoState().contracts}
        defaultCurrency="CHF"
        onAssignContract={() => ({ ok: true, changed: 1 })}
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
    expect(markup).toContain("Rattachement");
    expect(markup).toContain('aria-label="Rattachement de PRLV ALPINE MOBILE"');
  });

  it("borne le journal rendu et annonce les lignes restantes", () => {
    const base = createDemoState().transactions[0]!;
    const transactions = Array.from({ length: 251 }, (_, index) => ({
      ...base,
      id: `transaction-${index}`,
      label: `LIGNE ${index}`,
    }));
    const markup = renderToStaticMarkup(
      <TransactionsView
        contracts={createDemoState().contracts}
        defaultCurrency="CHF"
        onAssignContract={() => ({ ok: true, changed: 1 })}
        onImportTransactions={() => ({ ok: true, changed: 1 })}
        transactions={transactions}
      />,
    );

    expect(markup).toContain("250 mouvements affichés sur 251");
    expect(markup).not.toContain("LIGNE 250");
  });

  it("offre un rattachement modifiable pour chaque ligne de l’aperçu CSV", () => {
    const state = createDemoState();
    const transaction = {
      ...state.transactions[0]!,
      id: "transaction-preview",
      contractId: undefined,
    };
    const markup = renderToStaticMarkup(
      <CsvPreview
        contracts={state.contracts}
        onAssign={() => undefined}
        result={{ transactions: [transaction], skippedRows: 0, warnings: [] }}
      />,
    );

    expect(markup).toContain('aria-label="Contrat pour PRLV ALPINE MOBILE"');
    expect(markup).toContain("Alpine Mobile");
    expect(markup).toContain("Non rattaché");
  });
});
