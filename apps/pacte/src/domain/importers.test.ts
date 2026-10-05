import { describe, expect, it } from "vitest";

import { extractContractHints, parseTransactionCsv } from "./importers";

const defaults = { currency: "CHF" as const, importedAt: "2026-07-26T00:00:00.000Z" };

describe("parseTransactionCsv", () => {
  it("importe un CSV français séparé par des points-virgules", () => {
    const result = parseTransactionCsv(
      "Date;Libellé;Montant;Devise\n15.07.2026;ALPINE MOBILE;49,90;CHF",
      defaults,
    );

    expect(result.transactions[0]).toMatchObject({
      date: "2026-07-15",
      amount: 49.9,
      currency: "CHF",
      importedAt: defaults.importedAt,
    });
    expect(result.skippedRows).toBe(0);
  });

  it("importe les colonnes anglaises, les virgules décimales anglaises et les guillemets", () => {
    const result = parseTransactionCsv(
      'Date,Description,Amount,Currency\n2026-07-16,"ALPINE, MOBILE",49.90,EUR',
      defaults,
    );

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      date: "2026-07-16",
      label: "ALPINE, MOBILE",
      amount: 49.9,
      currency: "EUR",
    });
  });

  it("respecte le signe débit positif et crédit négatif dans des colonnes séparées", () => {
    const result = parseTransactionCsv(
      "Date\tLibellé\tDébit\tCrédit\n2026-07-17\tFACTURE\t89,90\t\n2026-07-18\tREMBOURSEMENT\t\t12,50",
      defaults,
    );

    expect(result.transactions.map(({ amount }) => amount)).toEqual([89.9, -12.5]);
  });

  it("ignore les dates invalides, les doublons internes et les lignes vides", () => {
    const result = parseTransactionCsv(
      "Date;Libellé;Montant\n\n31.02.2026;INVALIDE;10,00\n15.07.2026;ALPINE;49,90\n15.07.2026;ALPINE;49,90",
      defaults,
    );

    expect(result.transactions).toHaveLength(1);
    expect(result.skippedRows).toBe(3);
    expect(result.warnings).toHaveLength(2);
  });

  it("isole une date hors calendrier sans annuler les lignes suivantes", () => {
    const result = parseTransactionCsv(
      "Date;Libellé;Montant\n99.99.2026;DATE CASSÉE;10,00\n15.07.2026;LIGNE VALIDE;12,50",
      defaults,
    );

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      date: "2026-07-15",
      label: "LIGNE VALIDE",
      amount: 12.5,
    });
    expect(result.skippedRows).toBe(1);
  });

  it("ignore les montants nuls ou au-delà de la borne métier", () => {
    const result = parseTransactionCsv(
      "Date;Libellé;Montant\n15.07.2026;ZÉRO;0\n16.07.2026;EXTRÊME;1000000000.01\n17.07.2026;VALIDE;-42,00",
      defaults,
    );

    expect(result.transactions.map(({ label, amount }) => ({ label, amount }))).toEqual([
      { label: "VALIDE", amount: -42 },
    ]);
    expect(result.skippedRows).toBe(2);
  });

  it("génère le même identifiant pour la même empreinte normalisée", () => {
    const first = parseTransactionCsv("Date;Libellé;Montant\n15.07.2026; ALPINE  MOBILE ;49,90", defaults);
    const second = parseTransactionCsv("Date;Libellé;Montant\n15.07.2026;alpine mobile;49.90", defaults);

    expect(first.transactions[0]?.id).toBe(second.transactions[0]?.id);
  });
});

describe("extractContractHints", () => {
  it("extrait le montant, la devise et le préavis d'un texte contractuel", () => {
    expect(extractContractHints("Prime mensuelle CHF 89.90. Préavis 30 jours.")).toMatchObject({
      amount: 89.9,
      currency: "CHF",
      noticeDays: 30,
    });
  });

  it("associe la devise au montant contractuel correspondant", () => {
    expect(extractContractHints("Frais CHF. Prime EUR 89.90.")).toMatchObject({
      amount: 89.9,
      currency: "EUR",
    });
  });

  it("ne préremplit pas des indices hors bornes métier", () => {
    expect(extractContractHints(
      "Prime CHF 1000000000.01. Préavis 3651 jours.",
    )).toEqual({ currency: "CHF" });
  });
});
