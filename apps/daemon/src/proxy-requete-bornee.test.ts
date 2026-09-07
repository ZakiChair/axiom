import { describe, expect, test } from "bun:test";
import { traiterProxy, type RouteProxy } from "./proxy";

const route: RouteProxy = {
  prefix: "/sosoapi",
  target: "https://openapi.sosovalue.com",
  rewrite: (chemin) => chemin.replace(/^\/sosoapi/, ""),
};
const url = new URL("http://127.0.0.1:8787/sosoapi/openapi/v2/etf/currentEtfDataMetrics");

describe("corps entrant des proxys fixes", () => {
  test.each([301, 302, 303])("redirection %i du POST : GET sans corps ni Content-Type ensuite", async (statut) => {
    const appels: Array<{ method: string | undefined; corps: boolean; type: string | null }> = [];
    const rep = await traiterProxy(new Request(url, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }), url, route, {
      resoudreHote: async () => ["8.8.8.8"],
      fetchImpl: async (_input, init) => {
        appels.push({ method: init?.method, corps: init?.body !== undefined, type: new Headers(init?.headers).get("content-type") });
        return appels.length === 1
          ? new Response(null, { status: statut, headers: { location: "/resultat" } })
          : Response.json({ ok: true });
      },
    });
    expect(rep.status).toBe(200);
    expect(appels).toEqual([
      { method: "POST", corps: true, type: "application/json" },
      { method: "GET", corps: false, type: null },
    ]);
  });

  test.each([307, 308])("redirection %i : aucun POST vers un autre chemin", async (statut) => {
    let appels = 0;
    const rep = await traiterProxy(new Request(url, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }), url, route, {
      resoudreHote: async () => ["8.8.8.8"],
      fetchImpl: async () => {
        appels += 1;
        return appels === 1
          ? new Response(null, { status: statut, headers: { location: "/autre-action" } })
          : Response.json({});
      },
    });
    expect(rep.status).toBe(502);
    expect(appels).toBe(1);
    expect(await rep.text()).toContain("POST");
  });

  test("redirection 307 vers le même chemin : POST et corps conservés", async () => {
    const methodes: Array<string | undefined> = [];
    const rep = await traiterProxy(new Request(url, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }), url, route, {
      resoudreHote: async () => ["8.8.8.8"],
      fetchImpl: async (_input, init) => {
        methodes.push(init?.method);
        expect(init?.body).toBeDefined();
        return methodes.length === 1
          ? new Response(null, { status: 307, headers: { location: "/openapi/v2/etf/currentEtfDataMetrics?version=2" } })
          : Response.json({});
      },
    });
    expect(rep.status).toBe(200);
    expect(methodes).toEqual(["POST", "POST"]);
  });

  test("sans Content-Length : interrompt le flux au dépassement, avant lecture complète", async () => {
    let lus = 0;
    let annule = false;
    let appelsAmont = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (lus === 6) { c.close(); return; }
        lus += 1;
        c.enqueue(new Uint8Array(4).fill(65));
      },
      cancel() { annule = true; },
    });
    const req = new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    const rep = await traiterProxy(req, url, route, {
      tailleMaxRequete: 8,
      resoudreHote: async () => ["8.8.8.8"],
      fetchImpl: async () => { appelsAmont += 1; return Response.json({}); },
    });
    expect(rep.status).toBe(413);
    expect(appelsAmont).toBe(0);
    expect(annule).toBe(true);
    expect(lus).toBeLessThan(6);
  });

  test("un client qui ne termine pas son POST libère le lecteur au timeout", async () => {
    let controleur!: ReadableStreamDefaultController<Uint8Array>;
    let annule = false;
    const body = new ReadableStream<Uint8Array>({
      start(c) { controleur = c; },
      cancel() { annule = true; },
    });
    const req = new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    const travail = traiterProxy(req, url, route, {
      timeoutMs: 10,
      resoudreHote: async () => ["8.8.8.8"],
      fetchImpl: async () => Response.json({}),
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const rep = await Promise.race([
        travail,
        new Promise<Response>((resolve) => { timer = setTimeout(() => resolve(new Response(null, { status: 599 })), 250); }),
      ]);
      expect(rep.status).toBe(408);
      expect(annule).toBe(true);
      expect(body.locked).toBe(false);
    } finally {
      clearTimeout(timer);
      if (!annule) controleur.close();
      await travail.catch(() => {});
    }
  });
});
