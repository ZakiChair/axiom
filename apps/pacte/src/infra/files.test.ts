import { describe, expect, it } from "vitest";

import { importFileMetadata, readImportFile } from "./files";

describe("readImportFile", () => {
  it("lit directement le contenu des fichiers CSV et EML", async () => {
    const file = new File(["Date;Libellé\n2026-07-15;ALPINE"], "transactions.csv", {
      type: "text/csv",
    });

    await expect(readImportFile(file)).resolves.toBe("Date;Libellé\n2026-07-15;ALPINE");
  });

  it("décrit un e-mail par son nom et un type utile sans conserver son binaire", () => {
    const eml = new File(["Subject: Contrat"], "confirmation.eml", { type: "" });

    expect(importFileMetadata(eml)).toEqual({
      name: "confirmation.eml",
      type: "message/rfc822",
    });
  });

  it("extrait les chaînes littérales d'un PDF et interprète leurs échappements", async () => {
    const pdf = new File(["BT (Prime \\(mensuelle\\)\\nCHF 89.90) Tj ET"], "contrat.pdf", {
      type: "application/pdf",
    });

    await expect(readImportFile(pdf)).resolves.toBe("Prime (mensuelle)\nCHF 89.90");
  });

  it("demande une saisie manuelle lorsqu'aucun texte ne peut être extrait", async () => {
    const pdf = new File(["%PDF-1.7\nstream\u0000\u0001"], "scan.pdf", { type: "application/pdf" });

    await expect(readImportFile(pdf)).rejects.toThrow("saisie manuelle");
  });
});
