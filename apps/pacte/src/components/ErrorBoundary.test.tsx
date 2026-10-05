import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ErrorRecovery } from "./ErrorBoundary";

describe("frontière d’erreur", () => {
  it("permet d’exporter la valeur locale brute avant de recharger", () => {
    const markup = renderToStaticMarkup(<ErrorRecovery rawState="{secours" />);

    expect(markup).toContain("Le registre n’a pas pu s’ouvrir");
    expect(markup).toContain("Exporter les données brutes");
    expect(markup).toContain("Recharger la page");
  });
});
