import { afterEach, describe, expect, spyOn, test } from "bun:test";
import dns from "node:dns/promises";
import proxy from "../../../api/proxy";

const endpoint = "https://axiom.test/sosoapi/openapi/v2/etf/currentEtfDataMetrics";
const headers = { "content-type": "application/json" };
const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => { for (const s of spies.splice(0)) s.mockRestore(); });

function amont(repondre: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  spies.push(spyOn(dns, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never));
  spies.push(spyOn(globalThis, "fetch").mockImplementation(repondre as typeof fetch));
}

describe("Vercel : confinement POST", () => {
  test("refuse un autre chemin SoSoValue avant tout envoi", async () => {
    let appels = 0;
    amont(async () => { appels++; return Response.json({}); });
    const rep = await proxy.fetch(new Request("https://axiom.test/sosoapi/autre-action", { method: "POST", headers, body: "{}" }));
    expect(rep.status).toBe(405);
    expect(appels).toBe(0);
  });

  test("interrompt un corps segmenté dès 64 Kio dépassés", async () => {
    let blocs = 0;
    let annule = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) { if (blocs === 20) { c.close(); return; } blocs++; c.enqueue(new Uint8Array(16 * 1024)); },
      cancel() { annule = true; },
    }, { highWaterMark: 0 });
    const rep = await proxy.fetch(new Request(endpoint, { method: "POST", headers, body }));
    expect(rep.status).toBe(413);
    expect(annule).toBe(true);
    expect(blocs).toBeLessThanOrEqual(6);
    expect(body.locked).toBe(false);
  });

  test.each(["65537", "99999999999999999999999999"])("Content-Length %s trop grand : annule sans tirer le flux", async (longueur) => {
    let blocs = 0;
    let annule = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) { blocs++; c.close(); }, cancel() { annule = true; },
    }, { highWaterMark: 0 });
    const rep = await proxy.fetch(new Request(endpoint, { method: "POST", headers: { ...headers, "content-length": longueur }, body }));
    expect(rep.status).toBe(413);
    expect(blocs).toBe(0);
    expect(annule).toBe(true);
  });

  test("déconnexion client pendant un corps incomplet : annule et libère le lecteur", async () => {
    let annule = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { annule = true; } });
    const controller = new AbortController();
    const travail = proxy.fetch(new Request(endpoint, { method: "POST", headers, body, signal: controller.signal }));
    controller.abort();
    const rep = await travail;
    expect(rep.status).toBe(502);
    expect(annule).toBe(true);
    expect(body.locked).toBe(false);
  });

  test.each([301, 302, 303])("redirection %i : GET sans corps ni Content-Type", async (status) => {
    const appels: Array<{ method: string | undefined; body: boolean; type: string | null }> = [];
    amont(async (_url, init) => {
      appels.push({ method: init?.method, body: init?.body !== undefined, type: new Headers(init?.headers).get("content-type") });
      return appels.length === 1 ? new Response(null, { status, headers: { location: "/resultat" } }) : Response.json({});
    });
    const rep = await proxy.fetch(new Request(endpoint, { method: "POST", headers, body: "{}" }));
    expect(rep.status).toBe(200);
    expect(appels).toEqual([
      { method: "POST", body: true, type: "application/json" }, { method: "GET", body: false, type: null },
    ]);
  });

  test.each([307, 308])("redirection %i vers un autre chemin : ne relaie pas le corps", async (status) => {
    let appels = 0;
    amont(async () => ++appels === 1 ? new Response(null, { status, headers: { location: "/autre-action" } }) : Response.json({}));
    const rep = await proxy.fetch(new Request(endpoint, { method: "POST", headers, body: "{}" }));
    expect(rep.status).toBe(502);
    expect(appels).toBe(1);
  });

  test("307 même chemin : conserve les octets et POST", async () => {
    const corps: string[] = [];
    amont(async (_url, init) => {
      expect(init?.method).toBe("POST");
      corps.push(await new Response(init?.body).text());
      return corps.length === 1 ? new Response(null, { status: 307, headers: { location: "/openapi/v2/etf/currentEtfDataMetrics?v=2" } }) : Response.json({});
    });
    expect((await proxy.fetch(new Request(endpoint, { method: "POST", headers, body: '{"asset":"BTC"}' }))).status).toBe(200);
    expect(corps).toEqual(['{"asset":"BTC"}', '{"asset":"BTC"}']);
  });
});
