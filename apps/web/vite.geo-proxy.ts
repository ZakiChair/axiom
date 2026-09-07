import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import proxy from "../../api/proxy";
import { EXTAPI_HOTES_SPECIALISES } from "../../shared/extapi-hosts";

/** Réutilise le confinement de production, y compris la conversion HTML → séries JSON. */
export async function geoProxyDevMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
  if (!EXTAPI_HOTES_SPECIALISES.some((host) => (req.url ?? "").startsWith(`/extapi/${host}`))) { next(); return; }
  const abort = new AbortController();
  const fermer = () => { if (!res.writableEnded) abort.abort(); };
  res.once("close", fermer);
  try {
    const headers = new Headers();
    for (const [key, values] of Object.entries(req.headers)) {
      if (values === undefined) continue;
      for (const value of Array.isArray(values) ? values : [values]) headers.append(key, value);
    }
    const init: RequestInit & { duplex?: "half" } = { method: req.method, headers, signal: abort.signal };
    if (req.method !== "GET" && req.method !== "HEAD") {
      // Node/Bun exposent des déclarations BYOB différentes pour le même flux Web.
      init.body = Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>;
      init.duplex = "half";
    }
    const request = new Request(`http://127.0.0.1${req.url}`, init);
    const response = await proxy.fetch(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!res.headersSent) { res.statusCode = 502; res.setHeader("content-type", "application/json"); }
    res.end('{"erreur":"source géopolitique indisponible"}');
  } finally { res.off("close", fermer); }
}

export function geoProxyDev(): Plugin {
  return { name: "axiom-geo-proxy", configureServer(server) {
    server.middlewares.use((req, res, next) => { void geoProxyDevMiddleware(req, res, next); });
  } };
}
