import { describe, it, expect } from "vitest";
import { appendApiKeyIfAbsent } from "./apiKeyProxy";

describe("appendApiKeyIfAbsent", () => {
  it("ajoute la clé avec '&' quand une query existe déjà sans le param", () => {
    // Cas FRED typique : le front n'envoie PAS de clé → le proxy injecte celle du .env.
    const out = appendApiKeyIfAbsent(
      "/fred/series/observations?series_id=WM2NS&file_type=json",
      "api_key",
      "ENVKEY123"
    );
    expect(out).toBe("/fred/series/observations?series_id=WM2NS&file_type=json&api_key=ENVKEY123");
  });

  it("ajoute la clé avec '?' quand aucune query n'est présente", () => {
    const out = appendApiKeyIfAbsent("/v1/open-interest", "api_key", "ENVKEY123");
    expect(out).toBe("/v1/open-interest?api_key=ENVKEY123");
  });

  it("NE touche PAS le chemin si le param est déjà présent (override front prioritaire)", () => {
    // Le front a envoyé sa clé personnelle → le proxy doit la laisser intacte.
    const path = "/v1/open-interest?symbols=BTCUSDT_PERP.A&api_key=USERKEY";
    expect(appendApiKeyIfAbsent(path, "api_key", "ENVKEY123")).toBe(path);
  });

  it("détecte le param même s'il n'a pas de valeur (api_key=)", () => {
    // URLSearchParams.has('api_key') est vrai pour 'api_key=' → considéré comme fourni.
    const path = "/fred/series/observations?series_id=WM2NS&api_key=";
    expect(appendApiKeyIfAbsent(path, "api_key", "ENVKEY123")).toBe(path);
  });

  it("clé vide (.env absent) → chemin inchangé (l'amont renverra 401)", () => {
    const path = "/fred/series/observations?series_id=WM2NS";
    expect(appendApiKeyIfAbsent(path, "api_key", "")).toBe(path);
  });

  it("encode la valeur de la clé (défensif : caractères réservés d'URL)", () => {
    // Une clé contenant '&'/'=' doit être encodée pour ne pas casser la query.
    const out = appendApiKeyIfAbsent("/x?a=1", "api_key", "a&b=c");
    expect(out).toBe("/x?a=1&api_key=a%26b%3Dc");
  });
});
