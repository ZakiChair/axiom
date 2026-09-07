import { afterEach, describe, expect, spyOn, test } from "bun:test";
import dns from "node:dns/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import vercel from "../../../api/proxy";
import { geoProxyDevMiddleware } from "../../web/vite.geo-proxy";
import { construireRequetesNbs, NBS_HOST, NBS_CHEMIN } from "../../../shared/nbs-series";
import { traiterExtapi, type FetchExtapi } from "./proxy";

const chemin = `/extapi/${NBS_HOST}${NBS_CHEMIN}`;
const valide = construireRequetesNbs("ppi-aa", Date.UTC(2025, 0), Date.UTC(2025, 11))[0]!;
const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => { for (const s of spies.splice(0)) s.mockRestore(); });
for (const mode of ["daemon", "vercel", "vite"] as const) {
  async function appeler(body: string, repondre: FetchExtapi, path = chemin, method = "POST", contentType = "application/json") {
    const headers = { "content-type": contentType };
    const req = new Request(`https://axiom.test${path}`, { method, headers, ...(method === "POST" ? { body } : {}) });
    if (mode === "daemon") return traiterExtapi(req, new URL(req.url), {
      fetchImpl: repondre, resoudreHote: async () => ["8.8.8.8"], lireCacheImpl: () => null, ecrireCacheImpl: () => {},
    });
    spies.push(spyOn(dns, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never));
    spies.push(spyOn(globalThis, "fetch").mockImplementation(repondre as typeof fetch));
    if (mode === "vercel") return vercel.fetch(req);
    const entrant = new IncomingMessage(new Socket());
    entrant.url = path; entrant.method = method; entrant.headers = headers;
    if (method === "POST") entrant.push(Buffer.from(body));
    entrant.push(null);
    const sortant = new ServerResponse(entrant);
    let sortie = "";
    sortant.end = ((valeur: unknown) => { sortie = String(valeur); return sortant; }) as typeof sortant.end;
    await geoProxyDevMiddleware(entrant, sortant, () => { throw new Error("NBS échappé au middleware"); });
    return new Response(sortie, { status: sortant.statusCode });
  }
  describe(`NBS officiel ${mode}`, () => {
    test("relaie uniquement le corps statistique validé", async () => {
      let appels = 0;
      const rep = await appeler(JSON.stringify(valide), async (url, init) => {
        appels++;
        expect(String(url)).toBe(`https://${NBS_HOST}${NBS_CHEMIN}`);
        expect(init?.method).toBe("POST");
        expect(JSON.parse(await new Response(init?.body).text())).toEqual(valide);
        return Response.json({ data: [103.5] });
      });
      expect(rep.status).toBe(200); expect(appels).toBe(1);
    });
    test.each(["{}", "null", "{", JSON.stringify({ ...valide, indicatorIds: ["arbitraire"] }), JSON.stringify({ ...valide, dts: ["202501MM-209912MM"] })])("refuse un corps hors contrat avant fetch : %s", async body => {
      let appels = 0;
      expect((await appeler(body, async () => { appels++; return Response.json({}); })).status).toBe(400);
      expect(appels).toBe(0);
    });
    test("refuse un autre chemin, une query, GET et un type non JSON", async () => {
      let appels = 0; const fetcher = async () => { appels++; return Response.json({}); };
      expect((await appeler(JSON.stringify(valide), fetcher, `/extapi/${NBS_HOST}/autre`)).status).toBeGreaterThanOrEqual(400);
      expect((await appeler(JSON.stringify(valide), fetcher, `${chemin}?action=autre`)).status).toBe(400);
      expect((await appeler("", fetcher, chemin, "GET")).status).toBe(405);
      expect((await appeler(JSON.stringify(valide), fetcher, chemin, "POST", "text/plain")).status).toBe(415);
      expect(appels).toBe(0);
    });
    test("borne le corps réel à 64 Kio", async () => {
      let appels = 0;
      expect((await appeler(" ".repeat(65_537), async () => { appels++; return Response.json({}); })).status).toBe(413);
      expect(appels).toBe(0);
    });
    test.each([301, 307])("refuse la redirection %i même vers le même chemin", async status => {
      let appels = 0;
      expect((await appeler(JSON.stringify(valide), async () => { appels++; return new Response(null, { status, headers: { location: NBS_CHEMIN } }); })).status).toBe(502);
      expect(appels).toBe(1);
    });
  });
}

test("HEAD GPR valide un amont HTML sans tenter de parser son corps vide", async () => {
  spies.push(spyOn(dns, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never));
  spies.push(spyOn(globalThis, "fetch").mockImplementation((async (_url, init) => {
    expect(init?.method).toBe("HEAD");
    return new Response(null, { headers: { "content-type": "text/html" } });
  }) as typeof fetch));
  const rep = await vercel.fetch(new Request("https://axiom.test/extapi/www.matteoiacoviello.com/gpr.htm", { method: "HEAD" }));
  expect(rep.status).toBe(200); expect(rep.headers.get("content-type")).toContain("application/json"); expect(await rep.text()).toBe("");
});
