import { describe, expect, test } from "bun:test";
import { avecGardeErreur, Routeur } from "./router";

function req(chemin: string): [Request, URL] {
  const url = new URL(`http://127.0.0.1:8787${chemin}`);
  return [new Request(url), url];
}

describe("Routeur", () => {
  test("renvoie null quand aucune route ne matche", async () => {
    const r = new Routeur();
    expect(await r.gerer(...req("/inconnu"))).toBeNull();
  });

  test("enregistrerPrefixe matche le chemin exact ET les sous-chemins, pas un préfixe partiel", async () => {
    const r = new Routeur();
    r.enregistrerPrefixe("/kv", () => new Response("kv"));

    expect(await (await r.gerer(...req("/kv")))?.text()).toBe("kv"); // exact
    expect(await (await r.gerer(...req("/kv/a/b")))?.text()).toBe("kv"); // sous-chemin
    expect(await r.gerer(...req("/kvx"))).toBeNull(); // préfixe partiel → PAS un match
  });

  test("première route qui matche l'emporte (ordre d'enregistrement)", async () => {
    const r = new Routeur();
    r.enregistrerPrefixe("/kv/snapshots", () => new Response("snap"));
    r.enregistrerPrefixe("/kv", () => new Response("kv"));
    // /kv/snapshots doit primer sur le handler générique /kv (enregistré avant).
    expect(await (await r.gerer(...req("/kv/snapshots")))?.text()).toBe("snap");
    expect(await (await r.gerer(...req("/kv/autre")))?.text()).toBe("kv");
  });

  test("supporte un gestionnaire asynchrone et un prédicat libre", async () => {
    const r = new Routeur();
    r.enregistrer({
      correspond: (url) => url.searchParams.get("x") === "1",
      gerer: async () => new Response("async-ok"),
    });
    expect(await (await r.gerer(...req("/quelconque?x=1")))?.text()).toBe("async-ok");
    expect(await r.gerer(...req("/quelconque?x=2"))).toBeNull();
  });
});

describe("avecGardeErreur", () => {
  test("une exception du handler devient un 500 JSON conventionnel AVEC en-têtes CORS", async () => {
    const gerer = avecGardeErreur("kv", () => {
      throw new Error("SQLITE_FULL: database or disk is full");
    });
    const url = new URL("http://127.0.0.1:8787/kv/persist/x");
    const requete = new Request(url, {
      headers: { origin: "http://localhost:5173", host: "127.0.0.1:8787" },
    });
    const rep = await gerer(requete, url);
    expect(rep.status).toBe(500);
    expect(rep.headers.get("content-type")).toBe("application/json; charset=utf-8");
    // Sans CORS, le front dev (5173) verrait une erreur réseau opaque au lieu du 500.
    expect(rep.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(await rep.json()).toEqual({ erreur: "erreur interne kv" });
  });

  test("laisse passer telle quelle une réponse réussie (y compris asynchrone)", async () => {
    const gerer = avecGardeErreur("candles", async () => new Response("ok"));
    const url = new URL("http://127.0.0.1:8787/candles/binance/BTCUSDT/1m");
    expect(await (await gerer(new Request(url), url)).text()).toBe("ok");
  });
});
