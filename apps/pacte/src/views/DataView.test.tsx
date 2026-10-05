import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDemoState } from "../data/demo";
import {
  acquireImportLock,
  createStateExport,
  DataView,
  parseBackupText,
  releaseImportLock,
} from "./DataView";

describe("portabilité du coffre", () => {
  it("construit un export JSON daté et réimportable", () => {
    const state = createDemoState();
    const backup = createStateExport(state, new Date(2026, 6, 26, 0, 30));

    expect(backup.name).toBe("pacte-sauvegarde-2026-07-26.json");
    expect(backup.type).toBe("application/json;charset=utf-8");
    expect(parseBackupText(backup.content)).toEqual({ ok: true, state });
  });

  it("refuse une seconde acquisition tant que l'import courant détient le verrou", () => {
    const lock = { current: false };

    expect(acquireImportLock(lock)).toBe(true);
    expect(acquireImportLock(lock)).toBe(false);
    releaseImportLock(lock);
    expect(acquireImportLock(lock)).toBe(true);
  });

  it("refuse un JSON illisible ou un état hors schéma", () => {
    expect(parseBackupText("{invalide")).toEqual({
      ok: false,
      error: "Le fichier ne contient pas un JSON lisible.",
    });
    expect(parseBackupText('{"schemaVersion":2}')).toEqual({
      ok: false,
      error: "Cette sauvegarde ne correspond pas au format PACTE V1.",
    });
  });
});

describe("DataView", () => {
  it("explique la portée locale et distingue les trois remplacements destructifs", () => {
    const markup = renderToStaticMarkup(
      <DataView
        onReplaceState={() => ({ ok: true, changed: 1 })}
        onResetEmpty={() => ({ ok: true, changed: 1 })}
        onRestoreDemo={() => ({ ok: true, changed: 1 })}
        state={createDemoState()}
      />,
    );

    expect(markup).toContain('aria-labelledby="data-title"');
    expect(markup).toContain("Stockage local non chiffré");
    expect(markup).toContain("Exporter la sauvegarde");
    expect(markup).toContain("Importer une sauvegarde");
    expect(markup).toContain("Restaurer la démonstration");
    expect(markup).toContain("Créer un coffre vide");
  });
});
