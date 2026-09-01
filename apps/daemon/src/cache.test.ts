import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  cleCache,
  compterEntrees,
  ecrireCache,
  lireCache,
  purgerExpires,
  ttlMsPourChemin,
  TTL_SECONDES_PAR_PREFIXE,
} from "./cache";

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

// ─────────────────────────── Accès SQLite (base injectée :memory:) ───────────────────────────

/** Base :memory: avec le schéma `cache` de db.ts — aucun effet de bord disque. */
function baseMemoire(): Database {
  const d = new Database(":memory:");
  d.run(`CREATE TABLE cache (
    cle TEXT PRIMARY KEY,
    corps BLOB NOT NULL,
    contentType TEXT NOT NULL,
    expireA INTEGER NOT NULL
  )`);
  return d;
}

describe("lireCache / ecrireCache (base injectée)", () => {
  test("aller-retour : une entrée écrite est relue avant expiration", () => {
    const d = baseMemoire();
    ecrireCache("GET /tdapi/x", new TextEncoder().encode("{}"), "application/json", 60_000, d);
    const hit = lireCache("GET /tdapi/x", d);
    expect(hit).not.toBeNull();
    expect(hit?.contentType).toBe("application/json");
    expect(new TextDecoder().decode(hit?.corps)).toBe("{}");
    expect(compterEntrees(d)).toBe(1);
  });

  test("entrée expirée : miss + purge PARESSEUSE à la relecture", () => {
    const d = baseMemoire();
    ecrireCache("GET /tdapi/perime", new Uint8Array([1]), "text/plain", -1, d); // déjà expirée
    expect(lireCache("GET /tdapi/perime", d)).toBeNull();
    expect(compterEntrees(d)).toBe(0); // supprimée par la relecture
  });
});

describe("purgerExpires (base injectée)", () => {
  test("purge de MASSE des expirées jamais relues, épargne les vivantes", () => {
    const d = baseMemoire();
    // Deux entrées expirées à clé unique (patron réel : Coinalyze met `to=now` dans la
    // query → clé nouvelle à chaque poll, jamais relue → la purge paresseuse de
    // lireCache ne les atteint jamais).
    ecrireCache("GET /coinalyzeapi/oi?to=1", new Uint8Array([1]), "text/plain", -1, d);
    ecrireCache("GET /coinalyzeapi/oi?to=2", new Uint8Array([2]), "text/plain", -1, d);
    ecrireCache("GET /coinalyzeapi/oi?to=3", new Uint8Array([3]), "text/plain", 60_000, d);
    expect(purgerExpires(d)).toBe(2);
    expect(compterEntrees(d)).toBe(1);
    expect(lireCache("GET /coinalyzeapi/oi?to=3", d)).not.toBeNull();
  });
});
