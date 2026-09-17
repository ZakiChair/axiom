import { readFileSync } from "node:fs";
import {
  createServer as createHttpServer,
  request as httpRequest,
  validateHeaderValue,
  type IncomingHttpHeaders,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ProxyOptions, type ViteDevServer } from "vite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import viteConfig from "../vite.config";

type Bypass = (req: { url?: string; method?: string; headers: Record<string, string | undefined> }, res: ReponseFactice) => unknown;
interface ReponseFactice {
  statusCode: number;
  writableEnded: boolean;
  setHeader: (nom: string, valeur: string) => void;
  end: (corps: string) => void;
}

function bypassPour(prefixe: string): Bypass {
  const usine = viteConfig as unknown as (env: { mode: string }) => { server?: { proxy?: Record<string, { bypass?: Bypass }> } };
  const bypass = usine({ mode: "test" }).server?.proxy?.[prefixe]?.bypass;
  if (!bypass) throw new Error(`bypass ${prefixe} absent`);
  return bypass;
}

function reponse(): ReponseFactice & { corps: string; entetes: Map<string, string> } {
  const entetes = new Map<string, string>();
  return {
    statusCode: 200,
    writableEnded: false,
    corps: "",
    entetes,
    setHeader(nom, valeur) { entetes.set(nom, valeur); },
    end(corps) { this.corps = corps; this.writableEnded = true; },
  };
}

describe("gardes proxy Vite — aucun relais après refus", () => {
  it.each([
    ["POST", "/defillamapro/emissions", "CLESECRETE", 405],
    ["GET", "/defillamapro/emissions", undefined, 401],
    ["GET", "/defillamapro/api/entities", "CLESECRETE", 404],
  ])("retourne une URL après le refus Pro %s %s", (method, url, key, status) => {
    const res = reponse();
    const retour = bypassPour("/defillamapro")({ url, method, headers: { "x-defillama-pro-key": key } }, res);
    expect(res.statusCode).toBe(status);
    expect(res.writableEnded).toBe(true);
    expect(retour).toBe(url);
  });

  it("coupe une archive Binance funding hors allowlist exacte", () => {
    const url = "/extapi/data.binance.vision/data/futures/um/monthly/fundingRate/SOLUSDT/SOLUSDT-fundingRate-2026-08.zip";
    const res = reponse();
    const retour = bypassPour("/extapi/data.binance.vision")({ url, method: "GET", headers: {} }, res);
    expect(res.statusCode).toBe(403);
    expect(res.writableEnded).toBe(true);
    expect(retour).toBe(url);
  });
});

describe("garde /sosoapi — aucune requête sortante sans clé", () => {
  const cleInitiale = process.env.SOSOVALUE_API_KEY;
  afterEach(() => {
    if (cleInitiale === undefined) delete process.env.SOSOVALUE_API_KEY;
    else process.env.SOSOVALUE_API_KEY = cleInitiale;
  });

  it("répond 401 localement quand aucune clé n'est disponible", () => {
    // Sans clé, l'amont répond 401 à coup sûr : on ne laisse pas partir la requête.
    // C'est ce qui évite les lignes « [vite] http proxy error » au terminal, Vite
    // enregistrant son propre logger d'erreur APRÈS `configure`.
    process.env.SOSOVALUE_API_KEY = "";
    const url = "/sosoapi/openapi/v2/etf/currentEtfDataMetrics";
    const res = reponse();

    const retour = bypassPour("/sosoapi")({ url, method: "POST", headers: {} }, res);

    expect(res.statusCode).toBe(401);
    expect(res.writableEnded).toBe(true);
    expect(retour).toBe(url); // coupe le relais, comme les autres gardes du fichier
  });

  it("laisse relayer dès qu'une clé de Réglages accompagne la requête", () => {
    process.env.SOSOVALUE_API_KEY = "";
    const res = reponse();

    const retour = bypassPour("/sosoapi")(
      { url: "/sosoapi/openapi/v2/etf/currentEtfDataMetrics", method: "POST", headers: { "x-soso-api-key": "CLESECRETE" } },
      res,
    );

    expect(res.writableEnded).toBe(false);
    expect(retour).toBeUndefined();
  });

  it("laisse relayer quand la clé vient de .env", () => {
    process.env.SOSOVALUE_API_KEY = "CLEENV";
    const res = reponse();

    const retour = bypassPour("/sosoapi")(
      { url: "/sosoapi/openapi/v2/etf/currentEtfDataMetrics", method: "POST", headers: {} },
      res,
    );

    expect(res.writableEnded).toBe(false);
    expect(retour).toBeUndefined();
  });
});

describe("build Vite", () => {
  it("émet le manifeste utilisé par le contrôle de budget", () => {
    const usine = viteConfig as unknown as (env: { mode: string }) => { build?: { manifest?: boolean } };
    expect(usine({ mode: "production" }).build?.manifest).toBe(true);
  });
});

// ─────────────────────────── /cqapi — CryptoQuant BASIC ───────────────────────────

interface ProxyFactice {
  on: (evenement: string, gestionnaire: (...args: unknown[]) => void) => void;
}

interface EntreeProxyFactice {
  target?: string;
  followRedirects?: boolean;
  timeout?: number;
  proxyTimeout?: number;
  bypass?: Bypass;
  rewrite?: (chemin: string) => string;
  configure?: (proxy: ProxyFactice, options: object) => void;
}

interface ConfigFactice {
  define?: Record<string, string>;
  server?: { proxy?: Record<string, EntreeProxyFactice> };
}

function configPour(): ConfigFactice {
  const usine = viteConfig as unknown as (env: { mode: string }) => ConfigFactice;
  return usine({ mode: "test" });
}

function rewritePour(prefixe: string): (chemin: string) => string {
  const rewrite = configPour().server?.proxy?.[prefixe]?.rewrite;
  if (!rewrite) throw new Error(`rewrite ${prefixe} absent`);
  return rewrite;
}

/** Écouteurs branchés par `configure` sur l'entrée `/cqapi`, pour l'environnement courant. */
function gestionnairesCq(): Map<string, (...args: unknown[]) => void> {
  const gestionnaires = new Map<string, (...args: unknown[]) => void>();
  configPour().server?.proxy?.["/cqapi"]?.configure?.(
    { on: (evenement, gestionnaire) => { gestionnaires.set(evenement, gestionnaire); } },
    {},
  );
  return gestionnaires;
}

/**
 * Requête sortante factice (ClientRequest) : en-têtes en minuscules ; `setHeader` valide la
 * valeur comme Node (ERR_INVALID_CHAR sur CR/LF).
 */
function requeteAmont(entetesInitiaux: Record<string, string> = {}) {
  const entetes = new Map<string, string>(Object.entries(entetesInitiaux));
  return {
    entetes,
    getHeader: (nom: string) => entetes.get(nom.toLowerCase()),
    setHeader: (nom: string, valeur: string) => {
      validateHeaderValue(nom, valeur);
      entetes.set(nom.toLowerCase(), valeur);
    },
    removeHeader: (nom: string) => {
      entetes.delete(nom.toLowerCase());
    },
  };
}

describe("proxy /cqapi — CryptoQuant BASIC (licence personnelle)", () => {
  const URL_VALIDE = "/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30";
  const cleInitiale = process.env.CRYPTOQUANT_API_KEY;
  const vercelInitial = process.env.VERCEL;
  afterEach(() => {
    // process.env prime sur apps/web/.env dans loadEnv : chaque test fixe sa valeur, puis on restaure.
    if (cleInitiale === undefined) delete process.env.CRYPTOQUANT_API_KEY;
    else process.env.CRYPTOQUANT_API_KEY = cleInitiale;
    if (vercelInitial === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercelInitial;
  });

  it("build Vercel : drapeau faux même si la variable est posée, valeur jamais exposée", () => {
    process.env.VERCEL = "1";
    process.env.CRYPTOQUANT_API_KEY = "CLE-TEST-SECRETE";
    const define = configPour().define;
    expect(define?.__CQ_CLE_ENV__).toBe("false");
    expect(JSON.stringify(define)).not.toContain("CLE-TEST-SECRETE");
  });

  it("local : drapeau vrai avec une clé .env, faux sans", () => {
    delete process.env.VERCEL;
    process.env.CRYPTOQUANT_API_KEY = "CLE-TEST-SECRETE";
    const avecCle = configPour().define;
    expect(avecCle?.__CQ_CLE_ENV__).toBe("true");
    expect(JSON.stringify(avecCle)).not.toContain("CLE-TEST-SECRETE");
    process.env.CRYPTOQUANT_API_KEY = "";
    expect(configPour().define?.__CQ_CLE_ENV__).toBe("false");
  });

  it.each([
    ["POST", URL_VALIDE, "Bearer CLE-TEST-SECRETE", 405],
    ["GET", URL_VALIDE, undefined, 401],
    ["GET", URL_VALIDE, "Basic CLE-TEST-SECRETE", 401],
    ["GET", "/cqapi/v1/btc/exchange-flows/reserve?exchange=all_exchange&window=day", "Bearer CLE-TEST-SECRETE", 404],
    ["GET", "/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&from=20260901", "Bearer CLE-TEST-SECRETE", 404],
    ["GET", "/cqapi//v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30", "Bearer CLE-TEST-SECRETE", 404],
  ])("sans .env : refuse localement %s %s (%s → %i)", (method, url, authorization, status) => {
    process.env.CRYPTOQUANT_API_KEY = "";
    const res = reponse();
    const retour = bypassPour("/cqapi")({ url, method, headers: { authorization } }, res);
    expect(res.statusCode).toBe(status);
    expect(res.writableEnded).toBe(true);
    expect(res.entetes.get("cache-control")).toBe("private, no-store");
    expect(res.entetes.get("allow")).toBe(status === 405 ? "GET" : undefined);
    expect(res.corps).not.toContain("CLE-TEST-SECRETE");
    expect(retour).toBe(url);
  });

  /** Ensemble du daemon relu dans sa source (import cross-package interdit) : aucune dérive possible. */
  function destinationsInterditesDaemon(): string[] {
    const source = readFileSync(new URL("../../daemon/src/proxy.ts", import.meta.url), "utf8");
    const bloc = /const DESTINATIONS_NAVIGATION_INTERDITES\b[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(source)?.[1] ?? "";
    return [...bloc.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
  }

  it("refuse en 403 navigation, cross-site et destination active AVANT la méthode, même avec le repli .env", () => {
    process.env.CRYPTOQUANT_API_KEY = "CLEENV";
    const destinations = destinationsInterditesDaemon();
    expect(destinations).toEqual(
      expect.arrayContaining(["document", "iframe", "frame", "script", "worker", "sharedworker", "serviceworker", "object", "embed", "style"]),
    );
    const cas: Array<{ method: string; headers: Record<string, string | undefined> }> = [
      { method: "GET", headers: { "sec-fetch-mode": "navigate" } },
      { method: "GET", headers: { "sec-fetch-mode": " Navigate " } },
      { method: "GET", headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" } },
      { method: "GET", headers: { "sec-fetch-site": "CROSS-SITE", authorization: "Bearer CLE-TEST-SECRETE" } },
      // Ordre : la garde passe avant le 405 (et avant le 401, vérifié plus bas).
      { method: "POST", headers: { "sec-fetch-mode": "navigate" } },
      { method: "DELETE", headers: { "sec-fetch-site": "cross-site" } },
      ...destinations.map((dest) => ({ method: "GET", headers: { "sec-fetch-dest": dest, authorization: "Bearer CLE-TEST-SECRETE" } })),
      { method: "GET", headers: { "sec-fetch-dest": " IFRAME " } },
    ];
    for (const { method, headers } of cas) {
      const res = reponse();
      const retour = bypassPour("/cqapi")({ url: URL_VALIDE, method, headers }, res);
      expect(res.statusCode, `${method} ${JSON.stringify(headers)}`).toBe(403);
      expect(res.writableEnded).toBe(true);
      expect(res.entetes.get("content-type")).toBe("application/json; charset=utf-8");
      expect(res.entetes.get("cache-control")).toBe("private, no-store");
      expect(res.entetes.has("allow")).toBe(false);
      expect(JSON.parse(res.corps)).toEqual({ erreur: "navigation CryptoQuant interdite" });
      expect(retour).toBe(URL_VALIDE);
    }
    // Sans clé ni repli, la garde passe aussi avant le 401.
    process.env.CRYPTOQUANT_API_KEY = "";
    const sansCle = reponse();
    bypassPour("/cqapi")({ url: URL_VALIDE, method: "GET", headers: { "sec-fetch-site": "cross-site" } }, sansCle);
    expect(sansCle.statusCode).toBe(403);
  });

  it("laisse relayer un fetch du front (same-origin, same-site ou none ; dest empty)", () => {
    process.env.CRYPTOQUANT_API_KEY = "CLEENV";
    for (const site of ["same-origin", "same-site", "none", undefined]) {
      const res = reponse();
      const retour = bypassPour("/cqapi")(
        { url: URL_VALIDE, method: "GET", headers: { "sec-fetch-site": site, "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" } },
        res,
      );
      expect(retour).toBeUndefined();
      expect(res.writableEnded).toBe(false);
    }
  });

  it("avec le seul repli .env : un chemin hors liste reste refusé (404) et n'est jamais relayé", () => {
    process.env.CRYPTOQUANT_API_KEY = "CLEENV";
    const url = "/cqapi/v1/btc/market-indicator/mvrv?window=day";
    const res = reponse();
    const retour = bypassPour("/cqapi")({ url, method: "GET", headers: {} }, res);
    expect(res.statusCode).toBe(404);
    expect(res.writableEnded).toBe(true);
    expect(retour).toBe(url);
  });

  it("laisse relayer un GET valide porteur d'un Bearer personnel, ou couvert par le repli .env", () => {
    process.env.CRYPTOQUANT_API_KEY = "";
    const perso = reponse();
    expect(
      bypassPour("/cqapi")({ url: URL_VALIDE, method: "GET", headers: { authorization: "Bearer CLE-TEST-SECRETE" } }, perso),
    ).toBeUndefined();
    expect(perso.writableEnded).toBe(false);
    process.env.CRYPTOQUANT_API_KEY = "CLEENV";
    const repli = reponse();
    expect(bypassPour("/cqapi")({ url: URL_VALIDE, method: "GET", headers: {} }, repli)).toBeUndefined();
    expect(repli.writableEnded).toBe(false);
  });

  it("réécrit vers la liste fermée (query normalisée) et neutralise tout le reste", () => {
    const rewrite = rewritePour("/cqapi");
    expect(rewrite(URL_VALIDE)).toBe("/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30");
    expect(rewrite("/cqapi/v1/btc/miner-data/companies?limit=30&window=day&miner=mara")).toBe(
      "/v1/btc/miner-data/companies?miner=mara&window=day&limit=30",
    );
    expect(rewrite("/cqapi/v1/btc/exchange-flows/reserve?window=day")).toBe("/__axiom_refuse__");
  });

  it("vise le seul hôte CryptoQuant, sans suivre de redirection, avec des délais bornés", () => {
    const entree = configPour().server?.proxy?.["/cqapi"];
    expect(entree?.target).toBe("https://api.cryptoquant.com");
    expect(entree?.followRedirects).toBe(false);
    expect(entree?.timeout).toBe(15_000);
    expect(entree?.proxyTimeout).toBe(15_000);
  });

  it.each([
    ["espace interne", "abc def"],
    ["saut de ligne développé par dotenv", "abc\ndef"],
    ["retour chariot", "abc\rdef"],
    ["NBSP", "abc def"],
    ["U+200B", "abc​def"],
    ["en-tête de plus de 512 caractères", "x".repeat(506)],
  ])("clé .env invalide (%s) : traitée comme absente — drapeau faux, 401 local, aucune injection", (_cas, cle) => {
    delete process.env.VERCEL;
    process.env.CRYPTOQUANT_API_KEY = cle;
    expect(configPour().define?.__CQ_CLE_ENV__).toBe("false");

    const res = reponse();
    const retour = bypassPour("/cqapi")({ url: URL_VALIDE, method: "GET", headers: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(res.writableEnded).toBe(true);
    expect(retour).toBe(URL_VALIDE);

    // Même si une requête atteignait l'amont (Bearer personnel invalide), rien n'est injecté.
    const requete = requeteAmont({ authorization: "Basic x" });
    const sansEntete = requeteAmont();
    expect(() => {
      gestionnairesCq().get("proxyReq")?.(requete);
      gestionnairesCq().get("proxyReq")?.(sansEntete);
    }).not.toThrow();
    expect(requete.entetes.get("authorization")).toBe("Basic x");
    expect(sansEntete.entetes.has("authorization")).toBe(false);
  });

  it("clé .env valide à la borne (505 caractères) : drapeau vrai et repli injecté", () => {
    delete process.env.VERCEL;
    process.env.CRYPTOQUANT_API_KEY = "x".repeat(505);
    expect(configPour().define?.__CQ_CLE_ENV__).toBe("true");
    const requete = requeteAmont();
    gestionnairesCq().get("proxyReq")?.(requete);
    expect(requete.entetes.get("authorization")).toBe(`Bearer ${"x".repeat(505)}`);
  });

  it("proxyReq : repli .env injecté seulement sans Bearer valide ; proxyRes : réponse forcée privée", () => {
    process.env.CRYPTOQUANT_API_KEY = "CLEENV";
    const gestionnaires = gestionnairesCq();
    const sansEntete = requeteAmont();
    const invalide = requeteAmont({ authorization: "Basic x" });
    const perso = requeteAmont({ authorization: "Bearer perso" });
    for (const requete of [sansEntete, invalide, perso]) gestionnaires.get("proxyReq")?.(requete);
    expect(sansEntete.entetes.get("authorization")).toBe("Bearer CLEENV");
    expect(invalide.entetes.get("authorization")).toBe("Bearer CLEENV");
    expect(perso.entetes.get("authorization")).toBe("Bearer perso");

    const reponseAmont = reponseAmontFactice(200, { "cache-control": "public, max-age=600", "x-ratelimit-remaining": "9" });
    const locale = reponseLocaleFactice();
    gestionnaires.get("proxyRes")?.(reponseAmont, {}, locale);
    expect(reponseAmont.headers["cache-control"]).toBe("private, no-store");
    expect(reponseAmont.headers["x-ratelimit-remaining"]).toBe("9");
    expect(locale.headersSent).toBe(false);
    expect(gestionnaires.has("error")).toBe(true);
  });

  it("proxyReq : retire cookie et referer du navigateur, garde le Bearer personnel", () => {
    process.env.CRYPTOQUANT_API_KEY = "";
    const requete = requeteAmont({
      authorization: "Bearer perso",
      cookie: "username-localhost-8888=secret",
      referer: "http://localhost:5173/des",
      accept: "application/json",
    });
    gestionnairesCq().get("proxyReq")?.(requete);
    expect(requete.entetes.has("cookie")).toBe(false);
    expect(requete.entetes.has("referer")).toBe(false);
    expect(requete.entetes.get("authorization")).toBe("Bearer perso");
    expect(requete.entetes.get("accept")).toBe("application/json");
  });

  it.each([300, 301, 302, 303, 304, 307, 308])("proxyRes : un %i amont devient un 502 JSON local, sans Location", (statut) => {
    process.env.CRYPTOQUANT_API_KEY = "CLEENV";
    const amont = reponseAmontFactice(statut, {
      location: "https://ailleurs.example/x",
      "set-cookie": "s=1",
      "x-ratelimit-remaining": "8",
    });
    const locale = reponseLocaleFactice();
    gestionnairesCq().get("proxyRes")?.(amont, {}, locale);
    expect(locale.statusCode).toBe(502);
    expect(locale.headersSent).toBe(true);
    expect(locale.finished).toBe(true);
    expect(locale.entetes).toEqual({ "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" });
    expect(JSON.parse(locale.corps)).toEqual({ erreur: "redirection amont CryptoQuant refusée" });
    expect(locale.corps).not.toContain("CLEENV");
    expect(amont.vidange).toBe(true);
  });

  it("proxyRes : retire set-cookie d'une réponse relayée (200 et 429)", () => {
    for (const statut of [200, 429]) {
      const amont = reponseAmontFactice(statut, { "set-cookie": "s=1", "x-ratelimit-reset": "6" });
      const locale = reponseLocaleFactice();
      gestionnairesCq().get("proxyRes")?.(amont, {}, locale);
      expect(amont.headers["set-cookie"]).toBeUndefined();
      expect(amont.headers["cache-control"]).toBe("private, no-store");
      expect(amont.headers["x-ratelimit-reset"]).toBe("6");
      expect(locale.headersSent).toBe(false);
      expect(locale.finished).toBe(false);
      expect(amont.vidange).toBe(false);
    }
  });
});

// Intégration : le middleware proxy RÉEL de Vite (http-proxy embarqué) devant un amont local.
// Seule la cible change (http://127.0.0.1:<port>) ; bypass, rewrite et écouteurs sont ceux de
// vite.config.ts. Prouve que répondre dans l'écouteur `proxyRes` bloque le relais du statut,
// des en-têtes (Location, Set-Cookie) et du corps amont.
describe("proxy /cqapi — middleware Vite réel devant un amont local", () => {
  interface Recu {
    url: string;
    headers: IncomingHttpHeaders;
  }
  const recus: Recu[] = [];
  let amont: Server;
  let frontal: Server;
  let vite: ViteDevServer;
  let portFrontal = 0;
  const cleInitiale = process.env.CRYPTOQUANT_API_KEY;

  beforeAll(async () => {
    amont = createHttpServer((req, res) => {
      recus.push({ url: req.url ?? "", headers: req.headers });
      if ((req.url ?? "").startsWith("/v2/market/cq/spot/trade")) {
        res.writeHead(302, { location: "https://ailleurs.example/x", "set-cookie": "amont=1", "content-type": "text/html" });
        res.end("<p>corps amont de redirection</p>");
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "public, max-age=600",
        "set-cookie": "amont=1",
        "x-ratelimit-remaining": "9",
      });
      res.end(JSON.stringify({ status: { code: 200 } }));
    });
    await new Promise<void>((ok) => amont.listen(0, "127.0.0.1", ok));
    const portAmont = (amont.address() as AddressInfo).port;

    process.env.CRYPTOQUANT_API_KEY = "CLEENV-INTEGRATION";
    const entree = configPour().server?.proxy?.["/cqapi"];
    if (!entree) throw new Error("entrée /cqapi absente");
    vite = await createServer({
      configFile: false,
      root: dirname(fileURLToPath(import.meta.url)),
      logLevel: "silent",
      optimizeDeps: { noDiscovery: true, include: [] },
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
        proxy: { "/cqapi": { ...entree, target: `http://127.0.0.1:${portAmont}` } as ProxyOptions },
      },
    });
    frontal = createHttpServer(vite.middlewares);
    await new Promise<void>((ok) => frontal.listen(0, "127.0.0.1", ok));
    portFrontal = (frontal.address() as AddressInfo).port;
  });

  afterAll(async () => {
    if (cleInitiale === undefined) delete process.env.CRYPTOQUANT_API_KEY;
    else process.env.CRYPTOQUANT_API_KEY = cleInitiale;
    await vite?.close();
    await new Promise<void>((ok) => (frontal ? frontal.close(() => ok()) : ok()));
    await new Promise<void>((ok) => (amont ? amont.close(() => ok()) : ok()));
  });

  function appeler(chemin: string, entetes: Record<string, string>): Promise<{ statut: number; entetes: IncomingHttpHeaders; corps: string }> {
    return new Promise((ok, ko) => {
      const req = httpRequest({ host: "127.0.0.1", port: portFrontal, path: chemin, method: "GET", headers: entetes }, (res) => {
        let corps = "";
        res.setEncoding("utf8");
        res.on("data", (morceau: string) => { corps += morceau; });
        res.on("end", () => ok({ statut: res.statusCode ?? 0, entetes: res.headers, corps }));
      });
      req.on("error", ko);
      req.end();
    });
  }

  const NAVIGATEUR = { cookie: "session=secret", referer: "http://localhost:5173/des", "sec-fetch-site": "same-origin", "sec-fetch-dest": "empty" };

  it("302 amont : 502 JSON local, ni Location, ni Set-Cookie, ni corps amont ; un seul appel, sans cookie ni referer", async () => {
    recus.length = 0;
    const rep = await appeler("/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30", NAVIGATEUR);
    expect(rep.statut).toBe(502);
    expect(rep.entetes.location).toBeUndefined();
    expect(rep.entetes["set-cookie"]).toBeUndefined();
    expect(rep.entetes["cache-control"]).toBe("private, no-store");
    expect(rep.entetes["content-type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(rep.corps)).toEqual({ erreur: "redirection amont CryptoQuant refusée" });
    expect(rep.corps).not.toContain("corps amont");
    expect(rep.corps).not.toContain("CLEENV-INTEGRATION");
    expect(recus).toHaveLength(1);
    expect(recus[0]?.url).toBe("/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30");
    expect(recus[0]?.headers.authorization).toBe("Bearer CLEENV-INTEGRATION");
    expect(recus[0]?.headers.cookie).toBeUndefined();
    expect(recus[0]?.headers.referer).toBeUndefined();
  });

  it("200 amont : corps et quota relayés, réponse privée, Set-Cookie retiré", async () => {
    recus.length = 0;
    const rep = await appeler("/cqapi/v2/market/cq/swap/trade?symbol=eth_all&window=day&limit=30", {
      ...NAVIGATEUR,
      authorization: "Bearer perso-integration",
    });
    expect(rep.statut).toBe(200);
    expect(JSON.parse(rep.corps)).toEqual({ status: { code: 200 } });
    expect(rep.entetes["x-ratelimit-remaining"]).toBe("9");
    expect(rep.entetes["cache-control"]).toBe("private, no-store");
    expect(rep.entetes["set-cookie"]).toBeUndefined();
    expect(recus).toHaveLength(1);
    expect(recus[0]?.headers.authorization).toBe("Bearer perso-integration");
    expect(recus[0]?.headers.cookie).toBeUndefined();
  });

  it("navigation et cross-site : 403 local, aucun appel amont", async () => {
    recus.length = 0;
    const url = "/cqapi/v2/market/cq/swap/trade?symbol=eth_all&window=day&limit=30";
    expect((await appeler(url, { "sec-fetch-mode": "navigate" })).statut).toBe(403);
    expect((await appeler(url, { "sec-fetch-site": "cross-site", "sec-fetch-dest": "image" })).statut).toBe(403);
    expect(recus).toHaveLength(0);
  });
});

/** Réponse amont factice (IncomingMessage) : statut, en-têtes mutables, vidange observable. */
function reponseAmontFactice(statusCode: number, headers: Record<string, string>) {
  const amont = {
    statusCode,
    headers: { ...headers } as Record<string, string | undefined>,
    vidange: false,
    resume() {
      amont.vidange = true;
      return amont;
    },
  };
  return amont;
}

/** Réponse locale factice (ServerResponse) : `writeHead`/`end` comme Node. */
function reponseLocaleFactice() {
  const locale = {
    statusCode: 200,
    headersSent: false,
    finished: false,
    writableEnded: false,
    entetes: {} as Record<string, string>,
    corps: "",
    setHeader(nom: string, valeur: string) {
      locale.entetes[nom.toLowerCase()] = valeur;
    },
    writeHead(statut: number, entetes: Record<string, string> = {}) {
      locale.statusCode = statut;
      for (const [nom, valeur] of Object.entries(entetes)) locale.entetes[nom.toLowerCase()] = valeur;
      locale.headersSent = true;
      return locale;
    },
    end(corps = "") {
      locale.corps = corps;
      locale.headersSent = true;
      locale.finished = true;
      locale.writableEnded = true;
      return locale;
    },
  };
  return locale;
}
