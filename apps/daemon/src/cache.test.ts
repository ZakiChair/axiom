import { describe, expect, test } from "bun:test";
import { cleCache, ttlMsPourChemin, TTL_SECONDES_PAR_PREFIXE } from "./cache";

describe("ttlMsPourChemin", () => {
  test("TTL par préfixe connu (converti en ms)", () => {
    expect(ttlMsPourChemin("/fredapi/series/observations")).toBe(3600 * 1000);
    expect(ttlMsPourChemin("/coinalyzeapi/open-interest")).toBe(30 * 1000);
    expect(ttlMsPourChemin("/tdapi/time_series")).toBe(60 * 1000);
    expect(ttlMsPourChemin("/mexcapi/api/v3/ping")).toBe(10 * 1000);
    expect(ttlMsPourChemin("/ethscanapi/v2/api")).toBe(60 * 1000);
  });

  test("préfixe exact (sans sous-chemin) matche aussi", () => {
    expect(ttlMsPourChemin("/mexcapi")).toBe(10 * 1000);
  });

  test("chemin inconnu → 0 (pas de cache)", () => {
    expect(ttlMsPourChemin("/health")).toBe(0);
    expect(ttlMsPourChemin("/mexcapifaux")).toBe(0); // pas un vrai préfixe
  });

  test("les constantes de TTL sont celles documentées", () => {
    expect(TTL_SECONDES_PAR_PREFIXE).toEqual({
      "/fredapi": 3600,
      "/coinalyzeapi": 30,
      "/tdapi": 60,
      "/mexcapi": 10,
      "/ethscanapi": 60,
    });
  });
});

describe("cleCache", () => {
  test("préfixe la méthode au chemin+query", () => {
    expect(cleCache("GET", "/mexcapi/api/v3/ping")).toBe("GET /mexcapi/api/v3/ping");
    expect(cleCache("GET", "/tdapi/time_series?symbol=AAPL")).toBe(
      "GET /tdapi/time_series?symbol=AAPL",
    );
  });

  test("expurge la VALEUR d'une clé perso (apikey/api_key) mais garde sa présence", () => {
    expect(cleCache("GET", "/ethscanapi/v2/api?chainid=1&apikey=SECRET123")).toBe(
      "GET /ethscanapi/v2/api?chainid=1&apikey=***",
    );
    expect(cleCache("GET", "/fredapi/series?api_key=PERSO&id=WM2NS")).toBe(
      "GET /fredapi/series?api_key=***&id=WM2NS",
    );
    // Avec et sans clé → entrées DISTINCTES (réponse Etherscan complète vs dégradée).
    expect(cleCache("GET", "/ethscanapi/v2/api?chainid=1&apikey=X")).not.toBe(
      cleCache("GET", "/ethscanapi/v2/api?chainid=1"),
    );
    // Deux clés perso différentes → même entrée (même donnée amont, mono-utilisateur).
    expect(cleCache("GET", "/ethscanapi/v2/api?apikey=A")).toBe(
      cleCache("GET", "/ethscanapi/v2/api?apikey=B"),
    );
  });

  test("des query différentes donnent des clés différentes", () => {
    expect(cleCache("GET", "/x?a=1")).not.toBe(cleCache("GET", "/x?a=2"));
  });
});
