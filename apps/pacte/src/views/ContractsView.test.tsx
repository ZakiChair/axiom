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
  });
});
