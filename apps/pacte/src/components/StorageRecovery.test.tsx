import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  createRawRecoveryExport,
  StorageRecovery,
} from "./StorageRecovery";

describe("récupération du coffre corrompu", () => {
  it("prépare un export brut fidèle sans interpréter ni réécrire son contenu", () => {
    const raw = '{"schemaVersion":1,"contracts":[';

    expect(createRawRecoveryExport(raw, new Date(2026, 6, 26, 0, 30))).toEqual({
      name: "pacte-recuperation-brute-2026-07-26.txt",
      content: raw,
      type: "text/plain;charset=utf-8",
    });
  });

  it("présente une issue bloquante avec export et restauration explicitement séparés", () => {
    const markup = renderToStaticMarkup(
      <StorageRecovery
        onRestoreDemo={() => ({ ok: true, changed: 1 })}
        rawState="{corrompu"
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Coffre local à récupérer");
    expect(markup).toContain("Exporter la valeur brute");
    expect(markup).toContain("Restaurer la démonstration");
    expect(markup).toContain("confirmation");
  });
});
