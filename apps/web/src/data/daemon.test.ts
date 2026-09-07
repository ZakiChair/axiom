/**
 * Tests du client daemon : restauration pilotée par le front et validation stricte
 * du handshake `/health` avant tout envoi de données locales.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collecteurLiqMuet,
  isAxiomHealth,
  normaliserUrlDaemonDev,
  parseSanteCollecteurs,
  SEUIL_COLLECTEUR_MUET_MS,
  URL_DAEMON_DEV_DEFAUT,
  venuesMuettes,
} from "./daemon";

const HEALTH_COMPLET = {
  ok: true,
  service: "axiomd",
  apiVersion: 1,
  capabilities: ["kv", "candles", "alerts", "replay", "globe", "snapshots", "proxy"],
  version: "0.1.0",
};

function jsonResponse(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Mock localStorage en mémoire (environnement de test Node, pas de DOM ici). */
function installMockLocalStorage(): Storage {
  const data = new Map<string, string>();
  const mock: Storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  };
  (globalThis as { localStorage?: Storage }).localStorage = mock;
  return mock;
}

describe("création de snapshot et travail personnel", () => {
  beforeEach(() => { vi.resetModules(); installMockLocalStorage(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete (globalThis as { localStorage?: Storage }).localStorage; });

  it("fige les valeurs locales actuelles avant le POST, sans credentials, et supprime une ancienne clé absente", async () => {
    const { creerSnapshot } = await import("./daemon");
    localStorage.setItem("axiom:notes:v1", '{"notes":["récente"]}');
    localStorage.setItem("axiom:expy:v1", "[]");
    localStorage.setItem("axiom:api-key:fred", "personnelle");
    const kv = new Map<string, unknown>([["axiom:drawings:v1", "ancien dessin"]]);
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/health")) return jsonResponse(HEALTH_COMPLET);
      if (url.endsWith("/kv/snapshots")) {
        expect(kv.get("axiom:notes:v1")).toBe('{"notes":["récente"]}');
        expect(kv.get("axiom:expy:v1")).toBe("[]");
        expect(kv.has("axiom:drawings:v1")).toBe(false);
        expect(kv.has("axiom:api-key:fred")).toBe(false);
        expect(kv.get("@perimetre:v1")).toContain("axiom:notes:v1");
        return jsonResponse({ id: 8, ts: 10, taille: 100 });
      }
      const cle = decodeURIComponent(url.split("/").at(-1)!);
      if (init?.method === "DELETE") kv.delete(cle);
      else kv.set(cle, JSON.parse(String(init?.body)));
      return jsonResponse({ majA: 10, supprime: true });
    }));
    expect(await creerSnapshot()).toEqual({ id: 8, ts: 10, taille: 100 });
  });

  it("n'annonce ni ne crée un snapshot si une écriture de l'état local échoue", async () => {
    const { creerSnapshot } = await import("./daemon");
    localStorage.setItem("axiom:notes:v1", "précieux");
    let cree = false;
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      if (String(input).endsWith("/health")) return jsonResponse(HEALTH_COMPLET);
      if (String(input).endsWith("/kv/snapshots")) { cree = true; return jsonResponse({ id: 8, ts: 10, taille: 100 }); }
      return jsonResponse({}, 507);
    }));
    expect(await creerSnapshot()).toBeNull();
    expect(cree).toBe(false);
  });

  it("miroir personnel : coalesce la dernière valeur et refuse toute clé hors périmètre", async () => {
    const daemon = await import("./daemon");
    const kv = new Map<string, unknown>();
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      if (String(input).endsWith("/health")) return jsonResponse(HEALTH_COMPLET);
      kv.set(decodeURIComponent(String(input).split("/").at(-1)!), JSON.parse(String(init?.body)));
      return jsonResponse({ majA: 10 });
    }));
    await daemon.detectDaemon("kv");
    vi.useFakeTimers();
    daemon.miroiterTravailPersonnel("axiom:notes:v1", "première");
    daemon.miroiterTravailPersonnel("axiom:notes:v1", "dernière");
    daemon.miroiterTravailPersonnel("axiom:api-key:fred", "personnelle");
    await vi.advanceTimersByTimeAsync(450);
    expect(kv.get("axiom:notes:v1")).toBe("dernière");
    expect(kv.has("axiom:api-key:fred")).toBe(false);
  });
});

describe("restaurerSnapshot (client daemon)", () => {
  let localStorage: Storage;
  let restaurerSnapshot: typeof import("./daemon").restaurerSnapshot;

  beforeEach(async () => {
    vi.resetModules();
    ({ restaurerSnapshot } = await import("./daemon"));
    localStorage = installMockLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("snapshot vide : retire aussi les clés apparues depuis et préserve credentials et thème", async () => {
    localStorage.setItem("axiom:watchlist:v1", "watchlist récente");
    localStorage.setItem("axiom:indicatorSets:v1", "sets récents");
    localStorage.setItem("axiom:notes:v1", "note récente");
    localStorage.setItem("axiom:api-key:fred", "personnelle");
    localStorage.setItem("axiom:theme:v1", "dark");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(HEALTH_COMPLET))
      .mockResolvedValueOnce(jsonResponse({ entrees: [
        { namespace: "persist", cle: "@perimetre:v1", valeur: ["axiom:notes:v1"] },
      ] })));
    expect(await restaurerSnapshot(1)).toBe(true);
    expect(localStorage.getItem("axiom:watchlist:v1")).toBeNull();
    expect(localStorage.getItem("axiom:indicatorSets:v1")).toBeNull();
    expect(localStorage.getItem("axiom:notes:v1")).toBeNull();
    expect(localStorage.getItem("axiom:api-key:fred")).toBe("personnelle");
    expect(localStorage.getItem("axiom:theme:v1")).toBe("dark");
  });

  it("restaure les séries d'indicateurs et tout le travail personnel sérialisé", async () => {
    const cles = ["indicatorSets", "notes", "drawings", "expy", "portfolio", "alerts", "workspaces"];
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(HEALTH_COMPLET))
      .mockResolvedValueOnce(jsonResponse({ entrees: cles.map((cle) => ({
        namespace: "persist", cle: `axiom:${cle}:v1`, valeur: `ancien ${cle}`,
      })) })));
    expect(await restaurerSnapshot(1)).toBe(true);
    for (const cle of cles) expect(localStorage.getItem(`axiom:${cle}:v1`)).toBe(`ancien ${cle}`);
  });

  it("quota local : résultat faux, état local antérieur conservé", async () => {
    localStorage.setItem("axiom:chartState:v1", "ancien");
    localStorage.setItem("axiom:notes:v1", "précieux");
    const set = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (key, value) => {
      if (value === "trop gros") throw new DOMException("quota", "QuotaExceededError");
      set(key, value);
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(HEALTH_COMPLET))
      .mockResolvedValueOnce(jsonResponse({ entrees: [
        { namespace: "persist", cle: "axiom:chartState:v1", valeur: "nouveau" },
        { namespace: "persist", cle: "axiom:notes:v1", valeur: "trop gros" },
      ] })));
    expect(await restaurerSnapshot(1)).toBe(false);
    expect(localStorage.getItem("axiom:chartState:v1")).toBe("ancien");
    expect(localStorage.getItem("axiom:notes:v1")).toBe("précieux");
  });

  it("réponse mal formée : résultat faux sans purge locale", async () => {
    localStorage.setItem("axiom:notes:v1", "précieux");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(HEALTH_COMPLET))
      .mockResolvedValueOnce(jsonResponse({ ok: true })));
    expect(await restaurerSnapshot(1)).toBe(false);
    expect(localStorage.getItem("axiom:notes:v1")).toBe("précieux");
  });

  it("valeur couverte corrompue : ne l'interprète pas comme une suppression", async () => {
    localStorage.setItem("axiom:chartState:v1", "précieux");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(HEALTH_COMPLET))
      .mockResolvedValueOnce(jsonResponse({ entrees: [{ namespace: "persist", cle: "axiom:chartState:v1", valeur: null }] })));
    expect(await restaurerSnapshot(1)).toBe(false);
    expect(localStorage.getItem("axiom:chartState:v1")).toBe("précieux");
  });

  it("attend une écriture déjà partie et bloque les miroirs pendant la restauration", async () => {
    const daemon = await import("./daemon");
    let finirPut!: (r: Response) => void;
    let restaurations = 0;
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      if (String(input).endsWith("/health")) return jsonResponse(HEALTH_COMPLET);
      if (init?.method === "PUT") return new Promise<Response>((resolve) => { finirPut = resolve; });
      restaurations++;
      return jsonResponse({ entrees: [] });
    }));
    await daemon.detectDaemon("kv");
    const put = daemon.kvPut("persist", "axiom:notes:v1", "édition en vol");
    const restore = restaurerSnapshot(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(restaurations).toBe(0);
    finirPut(jsonResponse({ majA: 10 }));
    await put;
    expect(await restore).toBe(true);
    expect(await daemon.kvPut("persist", "axiom:notes:v1", "debounce ancien")).toBeNull();
    expect(restaurations).toBe(1);
  });

  it("réécrit les entrées persist dans localStorage et ignore les autres namespaces", async () => {
    localStorage.setItem("axiom:chartState:v1", '{"symbol":"ETHUSDT"}');
    localStorage.setItem("axiom:alerts:v1", '{"defs":[],"journal":[]}');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(HEALTH_COMPLET))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        id: 3,
        entrees: [
          { namespace: "persist", cle: "axiom:chartState:v1", valeur: '{"symbol":"BTCUSDT"}' },
          { namespace: "persist", cle: "axiom:api-key:evil", valeur: "injectée" },
          { namespace: "alerts", cle: "defs", valeur: [] },
        ],
      }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await restaurerSnapshot(3)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/health");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/kv/snapshots/3/restore");
    expect(localStorage.getItem("axiom:chartState:v1")).toBe('{"symbol":"BTCUSDT"}');
    expect(localStorage.getItem("axiom:api-key:evil")).toBeNull();
    expect(localStorage.getItem("defs")).toBeNull();
    expect(localStorage.getItem("axiom:alerts:v1")).toBe('{"defs":[],"journal":[]}');
  });

  it("réponse non-ok : conserve localStorage et renvoie false", async () => {
    localStorage.setItem("axiom:chartState:v1", '{"symbol":"ETHUSDT"}');
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(jsonResponse(HEALTH_COMPLET))
        .mockResolvedValueOnce(jsonResponse({}, 404)),
    );

    expect(await restaurerSnapshot(9)).toBe(false);
    expect(localStorage.getItem("axiom:chartState:v1")).toBe('{"symbol":"ETHUSDT"}');
  });

  it("refuse la restauration si le daemon n'annonce pas snapshots", async () => {
    localStorage.setItem("axiom:chartState:v1", '{"symbol":"ETHUSDT"}');
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({ ...HEALTH_COMPLET, capabilities: ["kv"] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await restaurerSnapshot(3)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("axiom:chartState:v1")).toBe('{"symbol":"ETHUSDT"}');
  });
});

describe("liquidations (client daemon)", () => {
  let liquidationsGet: typeof import("./daemon").liquidationsGet;
  let liquidationsPush: typeof import("./daemon").liquidationsPush;

  beforeEach(async () => {
    vi.resetModules();
    ({ liquidationsGet, liquidationsPush } = await import("./daemon"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GET : sonde d'abord puis renvoie le tableau de la réponse {liquidations:[...]}", async () => {
    const healthLiq = {
      ...HEALTH_COMPLET,
      capabilities: [...HEALTH_COMPLET.capabilities, "liquidations"],
    };
    const lignes = [
      { t: 1000, venue: "binance", side: "long", price: 42000, qty: 0.5, usd: 21000 },
      { t: 2000, venue: "bybit", side: "short", price: 41000, qty: 1, usd: 41000 },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(healthLiq))
      .mockResolvedValueOnce(jsonResponse({ symbole: "BTCUSDT", liquidations: lignes }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await liquidationsGet("BTCUSDT", { depuis: 500, limite: 10 })).toEqual(lignes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/health");
    const urlGet = String(fetchMock.mock.calls[1]?.[0]);
    expect(urlGet).toContain("/liquidations/BTCUSDT");
    expect(urlGet).toContain("depuis=500");
    expect(urlGet).toContain("limite=10");
  });

  it("GET : renvoie null si le daemon est absent (sonde échoue)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await liquidationsGet("BTCUSDT")).toBeNull();
  });

  it("GET : renvoie null si le daemon n'annonce pas la capability liquidations", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({ ...HEALTH_COMPLET, capabilities: ["kv"] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await liquidationsGet("BTCUSDT")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("PUSH : best-effort sans sonde, renvoie false si la réponse n'est pas ok", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({}, 500));
    vi.stubGlobal("fetch", fetchMock);

    const lot = [{ t: 1, venue: "binance", side: "long" as const, price: 1, qty: 1, usd: 1 }];
    expect(await liquidationsPush("BTCUSDT", lot)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/liquidations/BTCUSDT");
  });
});

describe("isAxiomHealth", () => {
  const valid = {
    ok: true,
    service: "axiomd",
    apiVersion: 1,
    capabilities: ["kv", "candles"],
    version: "0.1.0",
  };

  it("accepte uniquement le contrat axiomd courant", () => {
    expect(isAxiomHealth(valid)).toBe(true);
    expect(isAxiomHealth(valid, ["kv", "candles"])).toBe(true);
    expect(isAxiomHealth(valid, ["snapshots"])).toBe(false);
  });

  it("rejette un service étranger qui répond pourtant 200 /health", () => {
    expect(isAxiomHealth({ ...valid, service: "autre-service" })).toBe(false);
  });

  it("rejette une version de protocole incompatible ou un HTML déguisé", () => {
    expect(isAxiomHealth({ ...valid, apiVersion: 2 })).toBe(false);
    expect(isAxiomHealth("<!doctype html>")).toBe(false);
  });
});

describe("normaliserUrlDaemonDev", () => {
  it("utilise un repli loopback sûr et accepte un port local configuré", () => {
    expect(normaliserUrlDaemonDev(undefined)).toBe(URL_DAEMON_DEV_DEFAUT);
    expect(normaliserUrlDaemonDev("http://127.0.0.1:9191")).toBe("http://127.0.0.1:9191");
    expect(normaliserUrlDaemonDev(" http://localhost:9123/ ")).toBe("http://localhost:9123");
  });

  it("refuse une destination externe, HTTPS, userinfo, sous-chemin ou port nul", () => {
    for (const candidate of [
      "https://127.0.0.1:8787",
      "http://evil.example:8787",
      "http://evil@127.0.0.1:8787",
      "http://127.0.0.1:8787/api",
      "http://127.0.0.1:0",
    ]) {
      expect(normaliserUrlDaemonDev(candidate)).toBe(URL_DAEMON_DEV_DEFAUT);
    }
  });
});

describe("détection daemon sur Vercel", () => {
  afterEach(() => {
    vi.doUnmock("../lib/deployment");
    vi.unstubAllGlobals();
  });

  it("renvoie false sans lancer de sonde /health", async () => {
    vi.resetModules();
    vi.doMock("../lib/deployment", () => ({ IS_VERCEL: true }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { detectDaemon, daemonSupporte } = await import("./daemon");

    expect(await detectDaemon()).toBe(false);
    expect(await detectDaemon("kv")).toBe(false);
    expect(daemonSupporte("kv")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("santé des collecteurs de fond (liquidations)", () => {
  const SANTE_LIQ = {
    demarreTs: 1_000_000,
    bybit: { dernierMessageTs: 1_500_000, derniereErreur: null },
    okx: { dernierMessageTs: 0, derniereErreur: "ctVal BTC-USDT-SWAP : HTTP 500" },
  };

  it("parseSanteCollecteurs extrait collecteurs.liquidations et tolère les formes inattendues", () => {
    expect(parseSanteCollecteurs({ collecteurs: { liquidations: SANTE_LIQ } })).toEqual({
      demarreTs: 1_000_000,
      venues: {
        bybit: { dernierMessageTs: 1_500_000, derniereErreur: null },
        okx: { dernierMessageTs: 0, derniereErreur: "ctVal BTC-USDT-SWAP : HTTP 500" },
      },
    });
    // Daemon d'une version antérieure (aucune clé collecteurs) → null, pas de badge.
    expect(parseSanteCollecteurs({ ok: true })).toBeNull();
    expect(parseSanteCollecteurs(null)).toBeNull();
    expect(parseSanteCollecteurs({ collecteurs: { liquidations: { demarreTs: "x" } } })).toBeNull();
  });

  it("venuesMuettes : au-delà du seuil, bornée au démarrage du daemon", () => {
    const sante = parseSanteCollecteurs({ collecteurs: { liquidations: SANTE_LIQ } });
    // okx n'a jamais reçu : le « muet depuis » part du DÉMARRAGE, pas de 1970.
    const muettes = venuesMuettes(sante, 1_000_000 + SEUIL_COLLECTEUR_MUET_MS + 1);
    expect(muettes.map((m) => m.venue)).toEqual(["okx"]);
    expect(muettes[0]?.depuisMs).toBe(SEUIL_COLLECTEUR_MUET_MS + 1);
    // Juste sous le seuil : aucune venue muette (daemon fraîchement démarré compris).
    expect(venuesMuettes(sante, 1_000_000 + SEUIL_COLLECTEUR_MUET_MS)).toEqual([]);
  });

  it("collecteurLiqMuet : vrai seulement si TOUTES les venues sont muettes", () => {
    const sante = parseSanteCollecteurs({ collecteurs: { liquidations: SANTE_LIQ } });
    // okx est déjà muette, bybit non (dernier message pile au seuil) → pas de repli.
    expect(collecteurLiqMuet(sante, 1_500_000 + SEUIL_COLLECTEUR_MUET_MS)).toBe(false);
    // Une milliseconde plus tard, bybit bascule à son tour → collecteur ENTIÈREMENT muet.
    expect(collecteurLiqMuet(sante, 1_500_000 + SEUIL_COLLECTEUR_MUET_MS + 1)).toBe(true);
    expect(collecteurLiqMuet(null, Date.now())).toBe(false);
  });

  it("la sonde /health mémorise la santé des collecteurs (aucun appel réseau de plus)", async () => {
    vi.resetModules();
    const mod = await import("./daemon");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ...HEALTH_COMPLET, collecteurs: { liquidations: SANTE_LIQ } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(mod.santeLiquidationsDaemon()).toBeNull(); // avant toute sonde
    expect(await mod.detectDaemon()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mod.santeLiquidationsDaemon()?.venues.bybit?.dernierMessageTs).toBe(1_500_000);
    vi.unstubAllGlobals();
  });
});
