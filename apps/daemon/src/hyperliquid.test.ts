import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  agregerParCoin,
  assurerTableKv,
  chargerPool,
  construireInstantane,
  enregistrerHl,
  extraireTopAdresses,
  parserEtatCompte,
  reinitialiserHl,
  SEUIL_VALEUR_USD,
  traiterHl,
  URL_INFO,
  URL_LEADERBOARD,
  type NiveauLiqHL,
  type PositionLiq,
} from "./hyperliquid";
import { Routeur } from "./router";

const T0 = Date.UTC(2026, 7, 10, 12, 0, 0);
const A1 = "0x1111111111111111111111111111111111111111";
const A2 = "0x2222222222222222222222222222222222222222";
const A3 = "0x3333333333333333333333333333333333333333";

function baseTest(): Database {
  const d = new Database(":memory:");
  assurerTableKv(d);
  return d;
}

/** Position brute HL (forme clearinghouseState) avec surcharges. */
function pos(patch: Record<string, unknown> = {}): unknown {
  return {
    position: {
      coin: "BTC",
      szi: "6.18756",
      entryPx: "65032.2",
      liquidationPx: "31342.31",
      positionValue: "402414.15",
      leverage: { type: "cross", value: 3 },
      ...patch,
    },
  };
}

function etat(positions: unknown[]): unknown {
  return { marginSummary: { accountValue: "59828738.33" }, assetPositions: positions };
}

/** Stub de fetch : leaderboard + POST /info par adresse. Journalise les appels. */
function stubHl(options: {
  adresses?: string[];
  etats?: Record<string, unknown>;
  leaderboardKo?: boolean;
  infoKo?: string[];
}): { fetchImpl: typeof fetch; appels: string[] } {
  const appels: string[] = [];
  const adresses = options.adresses ?? [A1, A2];
  const fetchImpl = (async (entree: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entree);
    if (url === URL_LEADERBOARD) {
      appels.push("leaderboard");
      if (options.leaderboardKo) throw new Error("amont injoignable");
      return new Response(
        JSON.stringify({
          leaderboardRows: adresses.map((a, i) => ({ ethAddress: a, accountValue: String(1000 - i) })),
        }),
      );
    }
    if (url === URL_INFO) {
      const corps = JSON.parse(String(init?.body ?? "{}")) as { user?: string };
      const user = corps.user ?? "";
      appels.push(`info:${user}`);
      if (options.infoKo?.includes(user)) throw new Error("adresse en échec");
      return new Response(JSON.stringify(options.etats?.[user] ?? etat([])));
    }
    throw new Error(`URL inattendue : ${url}`);
  }) as typeof fetch;
  return { fetchImpl, appels };
}

describe("extraireTopAdresses (pure)", () => {
  test("trie par accountValue NUMÉRIQUE décroissant et tronque au top N", () => {
    // Piège : en tri lexicographique "9" passerait avant "10000000".
    const donnees = {
      leaderboardRows: [
        { ethAddress: A1, accountValue: "9" },
        { ethAddress: A2, accountValue: "10000000.5" },
        { ethAddress: A3, accountValue: "500" },
      ],
    };
    expect(extraireTopAdresses(donnees, 3)).toEqual([A2, A3, A1]);
    expect(extraireTopAdresses(donnees, 2)).toEqual([A2, A3]);
  });

  test("ignore les lignes malformées (adresse invalide, accountValue absent/non numérique)", () => {
    const donnees = {
      leaderboardRows: [
        { ethAddress: "pas-une-adresse", accountValue: "999999" },
        { ethAddress: A1, accountValue: null },
        { ethAddress: A2, accountValue: "abc" },
        { ethAddress: A3, accountValue: "42" },
        { accountValue: "12345" },
      ],
    };
    expect(extraireTopAdresses(donnees, 150)).toEqual([A3]);
  });

  test("JSON inattendu → tableau vide (jamais d'exception)", () => {
    expect(extraireTopAdresses(null, 150)).toEqual([]);
    expect(extraireTopAdresses({}, 150)).toEqual([]);
    expect(extraireTopAdresses({ leaderboardRows: "nope" }, 150)).toEqual([]);
  });
});

describe("parserEtatCompte (pure)", () => {
  test("parse un long : chaînes numériques converties, side=long, lev scalaire", () => {
    const r = parserEtatCompte(etat([pos()]), A1);
    expect(r).toEqual([
      {
        coin: "BTC",
        niveau: { px: 31342.31, side: "long", valueUsd: 402414.15, entryPx: 65032.2, lev: 3, addr: A1 },
      },
    ]);
  });

  test("szi négatif → side=short", () => {
    const r = parserEtatCompte(etat([pos({ szi: "-2.5" })]), A1);
    expect(r[0]?.niveau.side).toBe("short");
  });

  test("liquidationPx null → position écartée", () => {
    expect(parserEtatCompte(etat([pos({ liquidationPx: null })]), A1)).toEqual([]);
  });

  test("liquidationPx ≤ 0 ou non fini → position écartée", () => {
    expect(parserEtatCompte(etat([pos({ liquidationPx: "0" })]), A1)).toEqual([]);
    expect(parserEtatCompte(etat([pos({ liquidationPx: "-12" })]), A1)).toEqual([]);
    expect(parserEtatCompte(etat([pos({ liquidationPx: "NaN" })]), A1)).toEqual([]);
  });

  test("seuil positionValue : 1000 passe, 999,99 est écarté", () => {
    expect(SEUIL_VALEUR_USD).toBe(1000);
    expect(parserEtatCompte(etat([pos({ positionValue: "1000" })]), A1)).toHaveLength(1);
    expect(parserEtatCompte(etat([pos({ positionValue: "999.99" })]), A1)).toEqual([]);
  });

  test("szi nul ou coin absent → position écartée ; état inattendu → tableau vide", () => {
    expect(parserEtatCompte(etat([pos({ szi: "0" })]), A1)).toEqual([]);
    expect(parserEtatCompte(etat([pos({ coin: undefined })]), A1)).toEqual([]);
    expect(parserEtatCompte(null, A1)).toEqual([]);
    expect(parserEtatCompte({ assetPositions: "nope" }, A1)).toEqual([]);
  });

  test("plusieurs positions dans un même état → une entrée par coin retenu", () => {
    const r = parserEtatCompte(etat([pos(), pos({ coin: "kPEPE", szi: "-1" }), pos({ coin: "SOL", liquidationPx: null })]), A2);
    expect(r.map((p) => p.coin)).toEqual(["BTC", "kPEPE"]);
  });
});

describe("agregerParCoin (pure)", () => {
  test("regroupe les niveaux par coin (casse préservée)", () => {
    const n = (addr: string): NiveauLiqHL => ({ px: 1, side: "long", valueUsd: 2000, entryPx: 2, lev: 3, addr });
    const positions: PositionLiq[] = [
      { coin: "BTC", niveau: n(A1) },
      { coin: "kPEPE", niveau: n(A2) },
      { coin: "BTC", niveau: n(A3) },
    ];
    const m = agregerParCoin(positions);
    expect(m.get("BTC")?.map((v) => v.addr)).toEqual([A1, A3]);
    expect(m.get("kPEPE")).toHaveLength(1);
    expect(m.get("KPEPE")).toBeUndefined();
  });
});

describe("chargerPool (kv namespace hl, TTL 6 h)", () => {
  test("premier appel : télécharge, persiste { adresses, ts } et renvoie le pool", async () => {
    const d = baseTest();
    const { fetchImpl, appels } = stubHl({ adresses: [A1, A2] });
    expect(await chargerPool(d, fetchImpl, T0)).toEqual([A1, A2]);
    expect(appels).toEqual(["leaderboard"]);
    const ligne = d.query("SELECT valeur FROM kv WHERE namespace = ? AND cle = ?").get("hl", "pool") as { valeur: string };
    expect(JSON.parse(ligne.valeur)).toEqual({ adresses: [A1, A2], ts: T0 });
  });

  test("pool frais (< 6 h) : AUCUN re-téléchargement des 34 Mo", async () => {
    const d = baseTest();
    const s1 = stubHl({ adresses: [A1, A2] });
    await chargerPool(d, s1.fetchImpl, T0);
    const s2 = stubHl({ adresses: [A3] });
    expect(await chargerPool(d, s2.fetchImpl, T0 + 5 * 3_600_000)).toEqual([A1, A2]);
    expect(s2.appels).toEqual([]);
  });

  test("pool périmé + amont en échec : réutilise le pool persisté périmé", async () => {
    const d = baseTest();
    await chargerPool(d, stubHl({ adresses: [A1, A2] }).fetchImpl, T0);
    const s = stubHl({ leaderboardKo: true });
    expect(await chargerPool(d, s.fetchImpl, T0 + 7 * 3_600_000)).toEqual([A1, A2]);
    expect(s.appels).toEqual(["leaderboard"]);
  });

  test("aucun pool persisté + amont en échec → tableau vide (pas d'exception)", async () => {
    const d = baseTest();
    expect(await chargerPool(d, stubHl({ leaderboardKo: true }).fetchImpl, T0)).toEqual([]);
  });
});

describe("construireInstantane (concurrence bornée, échecs isolés)", () => {
  test("agrège tous les coins et ne compte que les adresses ayant répondu", async () => {
    const { fetchImpl, appels } = stubHl({
      etats: {
        [A1]: etat([pos()]),
        [A2]: etat([pos({ coin: "ETH", szi: "-3", liquidationPx: "4200.5" })]),
      },
      infoKo: [A3],
    });
    const inst = await construireInstantane([A1, A2, A3], fetchImpl, T0);
    expect(inst.ts).toBe(T0);
    expect(inst.adressesScannees).toBe(2); // A3 a échoué → ignorée, pas d'échec global
    expect(inst.parCoin.get("BTC")?.map((n) => n.addr)).toEqual([A1]);
    expect(inst.parCoin.get("ETH")?.[0]?.side).toBe("short");
    expect(appels.filter((a) => a.startsWith("info:"))).toHaveLength(3);
  });

  test("ne dépasse jamais 8 requêtes en vol", async () => {
    let enVol = 0;
    let maxEnVol = 0;
    const fetchImpl = (async (_entree: RequestInfo | URL) => {
      enVol += 1;
      maxEnVol = Math.max(maxEnVol, enVol);
      await new Promise((r) => setTimeout(r, 1));
      enVol -= 1;
      return new Response(JSON.stringify(etat([])));
    }) as typeof fetch;
    const adresses = Array.from({ length: 20 }, (_, i) => `0x${String(i).padStart(40, "0")}`);
    const inst = await construireInstantane(adresses, fetchImpl, T0);
    expect(maxEnVol).toBeLessThanOrEqual(8);
    expect(inst.adressesScannees).toBe(20);
  });
});

describe("GET /hl/liqlevels/:coin", () => {
  test("réponse { ts, coin, adressesScannees, niveaux } et cache 5 min partagé entre coins", async () => {
    reinitialiserHl();
    const d = baseTest();
    const { fetchImpl, appels } = stubHl({
      adresses: [A1, A2],
      etats: { [A1]: etat([pos(), pos({ coin: "ETH", liquidationPx: "4200.5" })]), [A2]: etat([pos({ szi: "-1" })]) },
    });
    const url = new URL("http://x/hl/liqlevels/BTC");
    const res = await traiterHl(new Request(url), url, d, T0, fetchImpl);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const corps = (await res.json()) as { ts: number; coin: string; adressesScannees: number; niveaux: NiveauLiqHL[] };
    expect(corps).toEqual({
      ts: T0,
      coin: "BTC",
      adressesScannees: 2,
      niveaux: [
        { px: 31342.31, side: "long", valueUsd: 402414.15, entryPx: 65032.2, lev: 3, addr: A1 },
        { px: 31342.31, side: "short", valueUsd: 402414.15, entryPx: 65032.2, lev: 3, addr: A2 },
      ],
    });
    const nbAppels = appels.length;

    // /ETH juste après : servi par le même instantané → AUCUN appel HL supplémentaire.
    const urlEth = new URL("http://x/hl/liqlevels/ETH");
    const resEth = await traiterHl(new Request(urlEth), urlEth, d, T0 + 60_000, fetchImpl);
    const corpsEth = (await resEth.json()) as { coin: string; niveaux: NiveauLiqHL[]; ts: number };
    expect(corpsEth.coin).toBe("ETH");
    expect(corpsEth.ts).toBe(T0); // horodatage de l'instantané, pas de la requête
    expect(corpsEth.niveaux).toHaveLength(1);
    expect(appels.length).toBe(nbAppels);
  });

  test("coin sans niveau → tableau vide (200)", async () => {
    reinitialiserHl();
    const d = baseTest();
    const { fetchImpl } = stubHl({ adresses: [A1], etats: { [A1]: etat([pos()]) } });
    const url = new URL("http://x/hl/liqlevels/DOGE");
    const res = await traiterHl(new Request(url), url, d, T0, fetchImpl);
    expect(res.status).toBe(200);
    expect((await res.json()) as { niveaux: unknown[] }).toMatchObject({ coin: "DOGE", niveaux: [] });
  });

  test("aucun pool disponible (amont KO, rien de persisté) → 503", async () => {
    reinitialiserHl();
    const d = baseTest();
    const url = new URL("http://x/hl/liqlevels/BTC");
    const res = await traiterHl(new Request(url), url, d, T0, stubHl({ leaderboardKo: true }).fetchImpl);
    expect(res.status).toBe(503);
    // Un 503 ne doit RIEN figer : la requête suivante retente l'amont.
    const s = stubHl({ adresses: [A1], etats: { [A1]: etat([pos()]) } });
    const res2 = await traiterHl(new Request(url), url, d, T0, s.fetchImpl);
    expect(res2.status).toBe(200);
    expect(s.appels).toContain("leaderboard");
  });

  test("cache expiré (> 5 min) → nouvel instantané", async () => {
    reinitialiserHl();
    const d = baseTest();
    const { fetchImpl, appels } = stubHl({ adresses: [A1], etats: { [A1]: etat([pos()]) } });
    const url = new URL("http://x/hl/liqlevels/BTC");
    await traiterHl(new Request(url), url, d, T0, fetchImpl);
    const nb = appels.length;
    const res = await traiterHl(new Request(url), url, d, T0 + 6 * 60_000, fetchImpl);
    expect(((await res.json()) as { ts: number }).ts).toBe(T0 + 6 * 60_000);
    expect(appels.length).toBeGreaterThan(nb);
    expect(appels.filter((a) => a === "leaderboard")).toHaveLength(1); // pool encore frais
  });

  test("cold-start simultané : un SEUL instantané construit (pas de rafale)", async () => {
    reinitialiserHl();
    const d = baseTest();
    const { fetchImpl, appels } = stubHl({ adresses: [A1, A2], etats: { [A1]: etat([pos()]) } });
    const u1 = new URL("http://x/hl/liqlevels/BTC");
    const u2 = new URL("http://x/hl/liqlevels/ETH");
    await Promise.all([
      traiterHl(new Request(u1), u1, d, T0, fetchImpl),
      traiterHl(new Request(u2), u2, d, T0, fetchImpl),
    ]);
    expect(appels.filter((a) => a === "leaderboard")).toHaveLength(1);
    expect(appels.filter((a) => a.startsWith("info:"))).toHaveLength(2);
  });

  test("gardes : 405 hors GET, 404 chemin inconnu, 400 coin manquant", async () => {
    reinitialiserHl();
    const u = new URL("http://x/hl/liqlevels/BTC");
    expect((await traiterHl(new Request(u, { method: "POST" }), u)).status).toBe(405);
    const uInconnu = new URL("http://x/hl/nimporte");
    expect((await traiterHl(new Request(uInconnu), uInconnu)).status).toBe(404);
    const uVide = new URL("http://x/hl/liqlevels");
    expect((await traiterHl(new Request(uVide), uVide)).status).toBe(400);
  });

  test("enregistrerHl branche le préfixe /hl sur le routeur", async () => {
    const routeur = new Routeur();
    enregistrerHl(routeur);
    const u = new URL("http://x/hl/liqlevels/BTC");
    // POST : la route matche et répond 405 AVANT tout accès base/réseau.
    const res = await routeur.gerer(new Request(u, { method: "POST" }), u);
    expect(res?.status).toBe(405);
    const uAutre = new URL("http://x/autre");
    expect(await routeur.gerer(new Request(uAutre), uAutre)).toBeNull();
  });
});
