/**
 * Message de l'overlay « Données indisponibles » (échec du backfill des bougies).
 *
 * Cas ajouté le 2026-09-14 : un testeur situé dans une région que Binance refuse
 * (États-Unis…) reçoit HTTP 451 sur le backfill REST. Le message générique
 * « La source n’a pas pu fournir l’historique demandé » + « Réessayer » ne lui laisse
 * aucune issue alors que Coinbase et Kraken restent accessibles (vérifié en production
 * sous un blocage simulé). Le routage étant automatique, le message nomme la cause sans
 * proposer un sélecteur manuel supprimé.
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

  it("quota Twelve Data : le prochain créneau annoncé par la file s'affiche tel quel, et lui seul", () => {
    expect(dataLoadErrorMessage(new Error("Quota Twelve Data : prochain créneau dans 50 s"))).toBe("Quota Twelve Data : prochain créneau dans 50 s");
    expect(dataLoadErrorMessage(new Error("Quota Twelve Data : prochain créneau dans 50 s <corps fournisseur arbitraire>"))).toBe(GENERIQUE);
  });

  it("plafond journalier Twelve Data : la reprise à minuit UTC est annoncée", () => {
    expect(dataLoadErrorMessage(new Error("Twelve Data: quota journalier Twelve Data épuisé (800 crédits) — reset à minuit UTC")))
      .toBe("Quota journalier Twelve Data épuisé : reprise à minuit UTC.");
  });

  it("HTTP 451 : explique le refus régional et l’absence de source compatible accessible", () => {
    const msg = dataLoadErrorMessage(new Error("Binance REST 451 Unavailable For Legal Reasons"));
    expect(msg).toContain("451");
    expect(msg).toContain("région");
    expect(msg).toContain("compatible");
    expect(msg).not.toMatch(/menu|changez|Coinbase|Kraken/i);
  });

  it.each([
    "Twelve Data: **apikey** parameter is missing or invalid",
    "Twelve Data: API key is invalid",
    "Twelve Data: clé API absente",
  ])("une clé Twelve Data inutilisable indique les Réglages : %s", (erreur) => {
    const msg = dataLoadErrorMessage(new Error(erreur));
    expect(msg).toContain("Twelve Data");
    expect(msg).toContain("Réglages");
    expect(msg).toContain("clé personnelle");
  });

  it.each([
    "Twelve Data: This instrument is available starting with the Grow or Venture plan.",
    "Twelve Data: This symbol is available starting with Grow or Venture plan. Upgrade API key=SECRET_SENTINEL at https://example.invalid/billing",
  ])("explique l'accès Grow/Venture sans afficher le corps fournisseur : %s", (erreur) => {
    expect(dataLoadErrorMessage(new Error(erreur))).toBe(
      "Cet historique nécessite un abonnement Twelve Data Grow ou Venture.",
    );
  });

  it.each([
    "Twelve Data: This endpoint requires a paid subscription.",
    "Twelve Data: A higher plan is required to access this symbol.",
    "Twelve Data: abonnement requis pour cet actif.",
  ])("explique un abonnement requis sans inventer son niveau : %s", (erreur) => {
    expect(dataLoadErrorMessage(new Error(erreur))).toBe(
      "Cet historique nécessite un abonnement Twelve Data incluant cet actif.",
    );
  });

  it("ne transforme pas les autres erreurs ou une simple mention de plan en restriction d'abonnement", () => {
    expect(dataLoadErrorMessage(new Error("Other source: available starting with the Grow or Venture plan."))).toBe(GENERIQUE);
    expect(dataLoadErrorMessage(new Error("Twelve Data: unexpected response, plan=SECRET_SENTINEL"))).toBe(GENERIQUE);
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
