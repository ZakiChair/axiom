import { afterEach, describe, expect, it } from "vitest";
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

  it("proxyReq : repli .env injecté seulement sans Bearer valide ; proxyRes : réponse forcée privée", () => {
    process.env.CRYPTOQUANT_API_KEY = "CLEENV";
    const gestionnaires = new Map<string, (...args: unknown[]) => void>();
    configPour().server?.proxy?.["/cqapi"]?.configure?.(
      { on: (evenement, gestionnaire) => { gestionnaires.set(evenement, gestionnaire); } },
      {},
    );
    const requeteAmont = (authorization?: string) => {
      const entetes = new Map<string, string>();
      if (authorization !== undefined) entetes.set("authorization", authorization);
      return {
        entetes,
        getHeader: (nom: string) => entetes.get(nom.toLowerCase()),
        setHeader: (nom: string, valeur: string) => {
          entetes.set(nom.toLowerCase(), valeur);
        },
      };
    };
    const sansEntete = requeteAmont();
    const invalide = requeteAmont("Basic x");
    const perso = requeteAmont("Bearer perso");
    for (const requete of [sansEntete, invalide, perso]) gestionnaires.get("proxyReq")?.(requete);
    expect(sansEntete.entetes.get("authorization")).toBe("Bearer CLEENV");
    expect(invalide.entetes.get("authorization")).toBe("Bearer CLEENV");
    expect(perso.entetes.get("authorization")).toBe("Bearer perso");

    const reponseAmont: { headers: Record<string, string> } = {
      headers: { "cache-control": "public, max-age=600", "x-ratelimit-remaining": "9" },
    };
    gestionnaires.get("proxyRes")?.(reponseAmont);
    expect(reponseAmont.headers["cache-control"]).toBe("private, no-store");
    expect(reponseAmont.headers["x-ratelimit-remaining"]).toBe("9");
    expect(gestionnaires.has("error")).toBe(true);
  });
});
