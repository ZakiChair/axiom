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
