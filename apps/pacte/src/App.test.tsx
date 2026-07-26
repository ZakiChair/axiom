import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { Modal } from "./components/Modal";

describe("PACTE application shell", () => {
  it("renders the local dashboard and its semantic navigation without browser APIs", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('aria-label="Navigation principale"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('id="contenu-principal"');
    expect(markup).toContain("Coffre local");
    expect(markup).toContain("Bonjour, Foyer Démo");
  });
});

describe("Modal", () => {
  it("renders a named modal dialog with an explicit close control", () => {
    const markup = renderToStaticMarkup(
      <Modal title="Contrôle à confirmer" onClose={() => undefined}>
        <p>Éléments du contrôle.</p>
      </Modal>,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    const titleId = markup.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(titleId).toBeDefined();
    expect(markup).toContain(`id="${titleId}"`);
    expect(markup).toContain('aria-label="Fermer la fenêtre"');
  });
});
