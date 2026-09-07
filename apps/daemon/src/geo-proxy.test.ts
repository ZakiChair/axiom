import { afterEach, describe, expect, spyOn, test } from "bun:test";
import dns from "node:dns/promises";
import vercel from "../../../api/proxy";
import { traiterExtapi } from "./proxy";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { geoProxyDevMiddleware } from "../../web/vite.geo-proxy";

const origine = "https://axiom.test/extapi/";
const gpr = "www.matteoiacoviello.com/gpr.htm";
const tpu = "www.matteoiacoviello.com/tpu.htm";
const gscpi = "www.newyorkfed.org/medialibrary/research/interactives/data/gscpi/gscpi_interactive_data.csv";
const html = '<h1>HTML à ne jamais servir</h1><script type="application/json">' + JSON.stringify({ x: { data: [
  { name: "GPR", x: ["1985-01-01"], y: [100] },
  { name: "GPR Threats", x: ["1985-01-01"], y: [120] },
  { name: "GPR Acts", x: ["1985-01-01"], y: [80] },
] } }) + "</script>";
const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => { for (const s of spies.splice(0)) s.mockRestore(); });

for (const mode of ["daemon", "vercel", "vite"] as const) {
  const appeler = async (path: string, repondre: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => {
    const req = new Request(origine + path);
    if (mode === "daemon") return traiterExtapi(req, new URL(req.url), {
      fetchImpl: repondre, resoudreHote: async () => ["8.8.8.8"],
      lireCacheImpl: () => null, ecrireCacheImpl: () => {},
    });
    spies.push(spyOn(dns, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never));
    spies.push(spyOn(globalThis, "fetch").mockImplementation(repondre as unknown as typeof fetch));
    if (mode === "vite") {
      const entrant = new IncomingMessage(new Socket());
      entrant.url = `/extapi/${path}`;
      entrant.method = "GET";
      entrant.headers = {};
      const sortant = new ServerResponse(entrant);
      let sortie = "";
      sortant.end = ((body: unknown) => { sortie = String(body); return sortant; }) as typeof sortant.end;
      await geoProxyDevMiddleware(entrant, sortant, () => { throw new Error("route spécialisée échappée au middleware"); });
      const headers = new Headers();
      for (const [key, value] of Object.entries(sortant.getHeaders())) if (value !== undefined) headers.set(key, String(value));
      return new Response(sortie, { status: sortant.statusCode, headers });
    }
    return vercel.fetch(req);
  };
  describe(`géo spécialisé ${mode}`, () => {
    test.each(["www.stat-search.boj.or.jp/api/v1/getDataCode?format=json", "api.mospi.gov.in/api/plfs/getData?Format=JSON"])("relaie le JSON statistique en GET sans Origin : %s", async path => {
      const rep = await appeler(path, async (_url, init) => {
        expect(init?.method).toBe("GET");
        expect(new Headers(init?.headers).has("origin")).toBe(false);
        return Response.json({ data: [5.1] });
      });
      expect(rep.status).toBe(200);
      expect(await rep.json()).toEqual({ data: [5.1] });
    });
    test("GPR : retourne seulement les séries extraites en JSON", async () => {
      const rep = await appeler(gpr, async () => new Response(html, { headers: { "content-type": "text/html" } }));
      expect(rep.status).toBe(200);
      expect(rep.headers.get("content-type")).toContain("application/json");
      const texte = await rep.text();
      expect(texte).not.toContain("<h1>");
      expect(JSON.parse(texte)).toEqual([
        { id: "gpr", nom: "GPR", points: [{ time: 473385600000, value: 100 }] },
        { id: "gpr-menaces", nom: "GPR Threats", points: [{ time: 473385600000, value: 120 }] },
        { id: "gpr-actes", nom: "GPR Acts", points: [{ time: 473385600000, value: 80 }] },
      ]);
    });
    test("TPU : contrat mensuel et date d'origine", async () => {
      const doc = '<script type="application/json">' + JSON.stringify({ x: { data: [
        { name: "TPU Monthly", x: ["1960-01-01"], y: [42] },
      ] } }) + "</script>";
      const rep = await appeler(tpu, async () => new Response(doc, { headers: { "content-type": "text/html" } }));
      expect(rep.status).toBe(200);
      expect(await rep.json()).toEqual([{ id: "tpu", nom: "TPU Monthly", points: [{ time: -315619200000, value: 42 }] }]);
    });
    test("GSCPI : relaie le CSV officiel uniquement", async () => {
      const rep = await appeler(gscpi, async () => new Response("Date,Sep-26\n31-Aug-2026,1.06", { headers: { "content-type": "text/csv" } }));
      expect(rep.status).toBe(200);
      expect(await rep.text()).toBe("Date,Sep-26\n31-Aug-2026,1.06");
    });
    test.each(["www.matteoiacoviello.com/autre.htm", "www.newyorkfed.org/autre.csv", "api.mospi.gov.in/autre", "www.stat-search.boj.or.jp/autre"])("chemin hors périmètre %s : aucun fetch", async (path) => {
      let appels = 0;
      const rep = await appeler(path, async () => { appels++; return new Response(html); });
      expect(rep.status).toBe(403);
      expect(appels).toBe(0);
    });
    test("une redirection GPR vers TPU ne contourne pas le chemin fixé", async () => {
      let appels = 0;
      const rep = await appeler(gpr, async () => { appels++; return new Response(null, { status: 302, headers: { location: "/tpu.htm" } }); });
      expect(rep.status).toBe(502);
      expect(appels).toBe(1);
    });
    test("HTML sans contrat : erreur JSON, jamais le document", async () => {
      const rep = await appeler(gpr, async () => new Response("<h1>maintenance confidentielle</h1>", { headers: { "content-type": "text/html" } }));
      expect(rep.status).toBe(502);
      expect(rep.headers.get("content-type")).toContain("application/json");
      expect(await rep.text()).not.toContain("maintenance confidentielle");
    });
    test("16 Mio : rejette et annule le corps avant lecture annoncée", async () => {
      let annule = false;
      const body = new ReadableStream({ cancel() { annule = true; } }, { highWaterMark: 0 });
      const rep = await appeler(gpr, async () => new Response(body, { headers: { "content-type": "text/html", "content-length": "16777217" } }));
      expect(rep.status).toBe(502);
      expect(annule).toBe(true);
    });
  });
}
