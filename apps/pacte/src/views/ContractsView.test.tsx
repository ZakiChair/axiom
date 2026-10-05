import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDemoState } from "../data/demo";
import { ContractsView } from "./ContractsView";

describe("ContractsView", () => {
  it("rend le registre filtrable, les clauses et les actions sans API navigateur", () => {
    const markup = renderToStaticMarkup(
      <ContractsView
        contracts={createDemoState().contracts}
        defaultCurrency="CHF"
        onAddContract={() => ({ ok: true, changed: 1 })}
        onRemoveContract={() => ({ ok: true, changed: 1 })}
      />,
    );

    expect(markup).toContain('aria-labelledby="contracts-title"');
    expect(markup).toContain('for="contract-filter"');
    expect(markup).toContain("Nouveau contrat");
    expect(markup).toContain("Alpine Mobile");
    expect(markup).toContain("Préavis");
    expect(markup).toContain("Alias marchand");
    expect(markup).toContain('aria-label="Retirer Alpine Mobile du registre"');
  });

  it("affiche les faits de résiliation, remboursement et provenance conservés", () => {
    const contract = {
      ...createDemoState().contracts[2]!,
      expectedRefund: { amount: 24.5, dueDate: "2026-08-15" },
      sourceFile: { name: "confirmation.eml", type: "message/rfc822" },
    };
    const markup = renderToStaticMarkup(
      <ContractsView
        contracts={[contract]}
        defaultCurrency="CHF"
        onAddContract={() => ({ ok: true, changed: 1 })}
        onRemoveContract={() => ({ ok: true, changed: 1 })}
      />,
    );

    expect(markup).toContain("Résilié le");
    expect(markup).toContain("Remboursement attendu");
    expect(markup).toContain("24.50");
    expect(markup).toContain("confirmation.eml");
    expect(markup).toContain("message/rfc822");
  });
});
