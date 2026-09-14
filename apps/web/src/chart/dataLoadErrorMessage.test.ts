/**
 * Message de l'overlay « Données indisponibles » (échec du backfill des bougies).
 *
 * Cas ajouté le 2026-09-14 : un testeur situé dans une région que Binance refuse
 * (États-Unis…) reçoit HTTP 451 sur le backfill REST. Le message générique
 * « La source n’a pas pu fournir l’historique demandé » + « Réessayer » ne lui laisse
 * aucune issue alors que Coinbase et Kraken restent accessibles (vérifié en production
 * sous un blocage simulé). Le message doit nommer la cause ET la parade (menu Source).
 */
import { describe, expect, it } from "vitest";
import { dataLoadErrorMessage } from "./dataLoadErrorMessage";

const GENERIQUE = "La source n’a pas pu fournir l’historique demandé.";

describe("dataLoadErrorMessage", () => {
  it("annulation : message court", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(dataLoadErrorMessage(err)).toBe("Chargement annulé.");
  });

  it("ErreurCcData : message de la source tel quel", () => {
    const err = new Error("CCData est injoignable ou bloqué par le navigateur.");
    err.name = "ErreurCcData";
    expect(dataLoadErrorMessage(err)).toBe("CCData est injoignable ou bloqué par le navigateur.");
  });

  it("HTTP 451 (région refusée) : nomme la cause, le menu Source et les sources vérifiées", () => {
    const msg = dataLoadErrorMessage(new Error("Binance REST 451 Unavailable For Legal Reasons"));
    expect(msg).toContain("451");
    expect(msg).toContain("« Source »");
    expect(msg).toContain("Coinbase");
    expect(msg).toContain("Kraken");
  });

  it("HTTP 451 sans statusText (HTTP/2) ou sur exchangeInfo : même message", () => {
    const attendu = dataLoadErrorMessage(new Error("Binance REST 451 Unavailable For Legal Reasons"));
    expect(dataLoadErrorMessage(new Error("Binance REST 451 "))).toBe(attendu);
    expect(dataLoadErrorMessage(new Error("Binance exchangeInfo 451 "))).toBe(attendu);
  });

  it("ne confond pas 451 avec un nombre qui le contient", () => {
    expect(dataLoadErrorMessage(new Error("Binance REST 500 x4511"))).toBe(GENERIQUE);
    expect(dataLoadErrorMessage(new Error("Binance REST 500 14510"))).toBe(GENERIQUE);
  });

  it("délai dépassé : message dédié", () => {
    expect(dataLoadErrorMessage(new Error("Backfill : délai dépassé"))).toBe(
      "La source n’a pas répondu dans le délai prévu.",
    );
  });

  it("autre erreur (429, réseau, valeur non-Error) : message générique", () => {
    expect(dataLoadErrorMessage(new Error("Binance REST 429 Too Many Requests"))).toBe(GENERIQUE);
    expect(dataLoadErrorMessage(new TypeError("Failed to fetch"))).toBe(GENERIQUE);
    expect(dataLoadErrorMessage("boom")).toBe(GENERIQUE);
  });
});
