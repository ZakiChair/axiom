/**
 * Tests du collecteur opt-in de la heatmap HL (hlLiqHeat.ts) : fonctions pures,
 * cycle d'instantané sur base :memory:, route /hl/liqheat sur base injectée.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  agregerNiveaux,
  assurerTableHlHeat,
  couvertureOi,
  cycleInstantane,
  demarrerBoucleHlHeat,
  deserialiserNiveaux,
  lireDrapeauCollecte,
  parserOiParCoin,
  parseRequeteHeat,
  PAS_MIN_MS,
  PERIODE_INSTANTANE_MS,
  reinitialiserHlHeat,
  RETENTION_HL_HEAT_MS,
  santeHlHeat,
  serialiserNiveaux,
  sousEchantillonner,
  traiterHlHeat,
} from "./hlLiqHeat";
import type { HorlogeWs } from "./wsLoop";
import {
  assurerTableKv,
  obtenirInstantane,
  reinitialiserHl,
  URL_INFO,
  URL_LEADERBOARD,
  type InstantaneHL,
  type NiveauLiqHL,
} from "./hyperliquid";

const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);
const A1 = "0x1111111111111111111111111111111111111111";

function baseTest(): Database {
  const d = new Database(":memory:");
  assurerTableKv(d);
  assurerTableHlHeat(d);
  return d;
}

function nv(px: number, side: "long" | "short", usd: number): NiveauLiqHL {
  return { px, side, valueUsd: usd, entryPx: px, lev: 3, addr: A1 };
}

describe("lireDrapeauCollecte (pure, tolérante)", () => {
  test("absent / corrompu / faux → false ; { actif: true } → true", () => {
    const d = baseTest();
    expect(lireDrapeauCollecte(d)).toBe(false); // clé absente
    d.query("INSERT INTO kv (namespace, cle, valeur, majA) VALUES ('hl', 'heat', 'pas-json', 1)").run();
    expect(lireDrapeauCollecte(d)).toBe(false); // JSON corrompu
    d.query("INSERT OR REPLACE INTO kv (namespace, cle, valeur, majA) VALUES ('hl', 'heat', ?, 2)").run(
      JSON.stringify({ actif: false }),
    );
    expect(lireDrapeauCollecte(d)).toBe(false);
    d.query("INSERT OR REPLACE INTO kv (namespace, cle, valeur, majA) VALUES ('hl', 'heat', ?, 3)").run(
      JSON.stringify({ actif: true, majTs: 0 }),
    );
    expect(lireDrapeauCollecte(d)).toBe(true);
    // Table kv absente → false (jamais d'exception).
    const dVide = new Database(":memory:");
    expect(lireDrapeauCollecte(dVide)).toBe(false);
  });
});

describe("parserOiParCoin (pure)", () => {
  test("oiUsd = openInterest × markPx par coin ; valeurs non finies écartées", () => {
    const json = [
      { universe: [{ name: "BTC" }, { name: "ETH" }, { name: "SOL" }] },
      [
        { openInterest: "45570", markPx: "86000" },
        { openInterest: "abc", markPx: "3000" }, // non fini → écarté
        { openInterest: "100", markPx: "180" },
      ],
    ];
    const m = parserOiParCoin(json);
    expect(m.get("BTC")).toBeCloseTo(45570 * 86000);
    expect(m.has("ETH")).toBe(false);
    expect(m.get("SOL")).toBe(18_000);
  });

  test("entrée inattendue → Map vide", () => {
    expect(parserOiParCoin(null).size).toBe(0);
    expect(parserOiParCoin({}).size).toBe(0);
    expect(parserOiParCoin([{ universe: [] }]).size).toBe(0);
  });
});

describe("serialiserNiveaux / deserialiserNiveaux (pures)", () => {
  test("tri px croissant, side01 0=long/1=short, round-trip", () => {
    const texte = serialiserNiveaux([nv(200, "short", 30), nv(100, "long", 10), nv(150, "short", 20)]);
    expect(JSON.parse(texte)).toEqual([
      [100, 0, 10],
      [150, 1, 20],
      [200, 1, 30],
    ]);
    expect(deserialiserNiveaux(texte)).toEqual([
      { px: 100, side01: 0, usd: 10 },
      { px: 150, side01: 1, usd: 20 },
      { px: 200, side01: 1, usd: 30 },
    ]);
  });

  test("désérialisation tolérante : corrompu → [], éléments malformés écartés", () => {
    expect(deserialiserNiveaux("pas json")).toEqual([]);
    expect(deserialiserNiveaux("{}")).toEqual([]);
    expect(deserialiserNiveaux(JSON.stringify([[1, 0, 5], [2], ["x", 1, 3], [3, 7, 1]]))).toEqual([
      { px: 1, side01: 0, usd: 5 },
    ]);
  });
});

describe("agregerNiveaux / couvertureOi (pures)", () => {
  test("sommes et compteurs par côté", () => {
    expect(agregerNiveaux([nv(1, "long", 100), nv(2, "long", 50), nv(3, "short", 70)])).toEqual({
      longUsd: 150,
      shortUsd: 70,
      nLong: 2,
      nShort: 1,
    });
  });

  test("couverture = (long + short) / (2 × oi), bornée [0,1], null sans oi", () => {
    expect(couvertureOi(100, 60, 1000)).toBeCloseTo(0.08);
    expect(couvertureOi(3000, 0, 1000)).toBe(1); // bornée à 1
    expect(couvertureOi(10, 10, null)).toBeNull();
    expect(couvertureOi(10, 10, 0)).toBeNull();
    expect(couvertureOi(10, 10, -5)).toBeNull();
  });
});

describe("sousEchantillonner (pure)", () => {
  test("dernier ts par seau floor(ts/pas), ordre croissant", () => {
    const lignes = [
      { ts: 1_000 },
      { ts: 2_000 }, // même seau 0 que ts=1000 avec pas=5000 → écarté
      { ts: 6_000 }, // seau 1
      { ts: 11_000 }, // seau 2
    ];
    expect(sousEchantillonner(lignes, 5_000).map((l) => l.ts)).toEqual([2_000, 6_000, 11_000]);
    expect(sousEchantillonner(lignes, null)).toHaveLength(4);
  });
});

describe("parseRequeteHeat (pure)", () => {
  test("défauts : depuis = now − rétention, jusqua = now, pas = null", () => {
    expect(parseRequeteHeat(new URLSearchParams(), T0)).toEqual({
      depuis: T0 - RETENTION_HL_HEAT_MS,
      jusqua: T0,
      pas: null,
    });
  });

  test("pas < PAS_MIN → PAS_MIN ; non numérique → null ; numérique conservé", () => {
    expect(parseRequeteHeat(new URLSearchParams("pas=60"), T0).pas).toBe(PAS_MIN_MS);
    expect(parseRequeteHeat(new URLSearchParams("pas=abc"), T0).pas).toBeNull();
    expect(parseRequeteHeat(new URLSearchParams("pas=600000"), T0).pas).toBe(600_000);
    const r = parseRequeteHeat(new URLSearchParams("depuis=1000&jusqua=2000"), T0);
    expect([r.depuis, r.jusqua]).toEqual([1_000, 2_000]);
  });
});

describe("cycleInstantane (base :memory: + fetch factice)", () => {
  const inst: InstantaneHL = {
    ts: T0,
    adressesScannees: 480,
    parCoin: new Map([
      ["BTC", [nv(80_000, "long", 400_000), nv(95_000, "short", 250_000)]],
      // ETH : aucune position dans l'instantané → ligne à niveaux "[]".
    ]),
  };

  /** fetch factice : répond uniquement à metaAndAssetCtxs. */
  const fetchMeta = (async (_e: RequestInfo | URL, init?: RequestInit) => {
    const corps = JSON.parse(String(init?.body ?? "{}")) as { type?: string };
    if (corps.type !== "metaAndAssetCtxs") throw new Error(`type inattendu ${corps.type}`);
    return new Response(
      JSON.stringify([
        { universe: [{ name: "BTC" }, { name: "ETH" }, { name: "SOL" }] },
        [
          { openInterest: "10", markPx: "100" }, // BTC oi = 1000
          { openInterest: "5", markPx: "10" }, // ETH oi = 50
          { openInterest: "2", markPx: "3" },
        ],
      ]),
    );
  }) as typeof fetch;

  test("une ligne par coin surveillé (vide incluse), OI joint, santé à jour", async () => {
    const d = baseTest();
    const n = await cycleInstantane(d, {
      fetchImpl: fetchMeta,
      now: T0,
      symboles: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "PASMAPPABLE|X"],
      instantane: inst,
    });
    expect(n).toBe(3); // BTCUSDT, ETHUSDT, SOLUSDT → BTC/ETH/SOL ; le 4e non mappable ignoré
    const lignes = d.query("SELECT * FROM hl_liq_instantanes ORDER BY coin").all() as Array<{
      coin: string;
      niveaux: string;
      long_usd: number;
      short_usd: number;
      n_long: number;
      n_short: number;
      oi_usd: number | null;
      adresses: number;
    }>;
    expect(lignes.map((l) => l.coin)).toEqual(["BTC", "ETH", "SOL"]);
    const btc = lignes[0]!;
    expect(JSON.parse(btc.niveaux)).toEqual([
      [80_000, 0, 400_000],
      [95_000, 1, 250_000],
    ]);
    expect([btc.long_usd, btc.short_usd, btc.n_long, btc.n_short]).toEqual([400_000, 250_000, 1, 1]);
    expect(btc.oi_usd).toBe(1_000);
    expect(btc.adresses).toBe(480);
    // ETH : instantané vide MAIS ligne présente (l'absence de positions est une information).
    expect(JSON.parse(lignes[1]!.niveaux)).toEqual([]);
    expect(lignes[1]!.oi_usd).toBe(50);
    const s = santeHlHeat();
    expect(s.dernierInstantaneTs).toBe(T0);
    expect(s.derniereErreur).toBeNull();
    expect(s.coins).toEqual(["BTC", "ETH", "SOL"]);
    expect(s.adresses).toBe(480);
    reinitialiserHlHeat();
  });

  test("purge de rétention : lignes > 14 j supprimées, au plus 1×/24 h", async () => {
    const d = baseTest();
    assurerTableHlHeat(d);
    d.query(
      "INSERT INTO hl_liq_instantanes (ts, coin, niveaux, long_usd, short_usd, n_long, n_short, oi_usd, adresses) VALUES (?, 'BTC', '[]', 0, 0, 0, 0, NULL, 0)",
    ).run(T0 - RETENTION_HL_HEAT_MS - 1_000); // vieille ligne hors rétention
    await cycleInstantane(d, { fetchImpl: fetchMeta, now: T0, symboles: ["BTCUSDT"], instantane: inst });
    const restantes = d.query("SELECT COUNT(*) AS n FROM hl_liq_instantanes").get() as { n: number };
    expect(restantes.n).toBe(1); // la vieille ligne a été purgée, la nouvelle insérée
    reinitialiserHlHeat();
  });

  test("instantané indisponible (pool null) → 0 ligne, erreur en santé", async () => {
    const d = baseTest();
    const fetchKo = (async () => new Response("ko", { status: 500 })) as unknown as typeof fetch;
    const n = await cycleInstantane(d, { fetchImpl: fetchKo, now: T0, symboles: ["BTCUSDT"] });
    expect(n).toBe(0);
    expect((d.query("SELECT COUNT(*) AS n FROM hl_liq_instantanes").get() as { n: number }).n).toBe(0);
    expect(santeHlHeat().derniereErreur).toContain("indisponible");
    reinitialiserHlHeat();
  });

  test("un instantané sans observation ou à date incohérente ne peut pas entrer dans l'archive", async () => {
    for (const invalide of [
      { ...inst, adressesScannees: 0 },
      { ...inst, ts: Number.NaN },
      { ...inst, ts: -1 },
      { ...inst, ts: T0 + 1 },
    ]) {
      reinitialiserHlHeat();
      const d = baseTest();
      const n = await cycleInstantane(d, {
        fetchImpl: fetchMeta, now: T0, symboles: ["BTCUSDT"], instantane: invalide,
      });
      expect(n).toBe(0);
      expect((d.query("SELECT COUNT(*) AS n FROM hl_liq_instantanes").get() as { n: number }).n).toBe(0);
      expect(santeHlHeat().dernierInstantaneTs).toBe(0);
      expect(santeHlHeat().derniereErreur).not.toBeNull();
      d.close();
    }
    reinitialiserHlHeat();
  });
});

describe("acquisition HL → archive SQLite (sans instantané injecté)", () => {
  let d: Database;

  beforeEach(() => {
    reinitialiserHl();
    reinitialiserHlHeat();
    d = baseTest();
  });

  afterEach(() => {
    d.close();
    reinitialiserHl();
    reinitialiserHlHeat();
  });

  function compte(px: number | null = 80_000): Response {
    return Response.json({
      assetPositions: px === null ? [] : [{ position: {
        coin: "BTC", szi: "1", liquidationPx: String(px), positionValue: "90000",
        entryPx: "85000", leverage: { type: "cross", value: 3 },
      } }],
    });
  }

  /** Seul l'amont HTTP est simulé ; cache, acquisition, cycle et SQLite restent réels. */
  function amont(repondreCompte: () => Response | Promise<Response>): typeof fetch {
    return (async (entree: RequestInfo | URL, init?: RequestInit) => {
      if (String(entree) === URL_LEADERBOARD) {
        return Response.json({ leaderboardRows: [{ ethAddress: A1, accountValue: "100000" }] });
      }
      if (String(entree) !== URL_INFO) throw new Error(`URL inattendue : ${String(entree)}`);
      const corps = JSON.parse(String(init?.body ?? "{}")) as { type?: string };
      if (corps.type === "clearinghouseState") return repondreCompte();
      if (corps.type === "metaAndAssetCtxs") {
        return Response.json([
          { universe: [{ name: "BTC" }, { name: "ETH" }] },
          [{ openInterest: "10", markPx: "90000" }, { openInterest: "20", markPx: "3000" }],
        ]);
      }
      throw new Error(`type inattendu : ${corps.type}`);
    }) as typeof fetch;
  }

  function archives(): Array<{ ts: number; coin: string; niveaux: string; adresses: number }> {
    return d.query("SELECT ts, coin, niveaux, adresses FROM hl_liq_instantanes ORDER BY ts, coin").all() as
      Array<{ ts: number; coin: string; niveaux: string; adresses: number }>;
  }

  test("une panne après cache ne crée aucun point et conserve la date du dernier succès", async () => {
    await cycleInstantane(d, { fetchImpl: amont(() => compte()), now: T0, symboles: ["BTCUSDT"] });
    const n = await cycleInstantane(d, {
      fetchImpl: amont(() => new Response("indisponible", { status: 503 })),
      now: T0 + 600_000,
      symboles: ["BTCUSDT"],
    });

    expect(n).toBe(0);
    expect(archives()).toEqual([{ ts: T0, coin: "BTC", niveaux: "[[80000,0,90000]]", adresses: 1 }]);
    expect(santeHlHeat().dernierInstantaneTs).toBe(T0);
    expect(santeHlHeat().derniereErreur).toContain("indisponible");
  });

  test("la reprise après panne archive les nouvelles positions et efface l'erreur", async () => {
    await cycleInstantane(d, { fetchImpl: amont(() => compte()), now: T0, symboles: ["BTCUSDT"] });
    await cycleInstantane(d, {
      fetchImpl: amont(() => new Response("indisponible", { status: 503 })),
      now: T0 + 600_000,
      symboles: ["BTCUSDT"],
    });
    const n = await cycleInstantane(d, {
      fetchImpl: amont(() => compte(82_000)), now: T0 + 1_200_000, symboles: ["BTCUSDT"],
    });

    expect(n).toBe(1);
    expect(archives()).toEqual([
      { ts: T0, coin: "BTC", niveaux: "[[80000,0,90000]]", adresses: 1 },
      { ts: T0 + 1_200_000, coin: "BTC", niveaux: "[[82000,0,90000]]", adresses: 1 },
    ]);
    expect(santeHlHeat().dernierInstantaneTs).toBe(T0 + 1_200_000);
    expect(santeHlHeat().derniereErreur).toBeNull();
  });

  test("un compte interrogé sans positions reste une observation vide valide pour chaque coin", async () => {
    const n = await cycleInstantane(d, {
      fetchImpl: amont(() => compte(null)), now: T0, symboles: ["BTCUSDT", "ETHUSDT"],
    });
    expect(n).toBe(2);
    expect(archives()).toEqual([
      { ts: T0, coin: "BTC", niveaux: "[]", adresses: 1 },
      { ts: T0, coin: "ETH", niveaux: "[]", adresses: 1 },
    ]);
    expect(santeHlHeat().derniereErreur).toBeNull();
  });

  test("un collecteur rejoignant une acquisition UI en panne ne reçoit pas son repli périmé", async () => {
    await cycleInstantane(d, { fetchImpl: amont(() => compte()), now: T0, symboles: ["BTCUSDT"] });
    const reponse = Promise.withResolvers<Response>();
    const requetePartie = Promise.withResolvers<void>();
    const fetchImpl = amont(() => {
      requetePartie.resolve();
      return reponse.promise;
    });
    const lectureUi = obtenirInstantane(d, fetchImpl, T0 + 600_000);
    await requetePartie.promise;
    const collecte = cycleInstantane(d, { fetchImpl, now: T0 + 600_001, symboles: ["BTCUSDT"] });
    reponse.resolve(new Response("indisponible", { status: 503 }));

    expect((await lectureUi)?.ts).toBe(T0);
    expect(await collecte).toBe(0);
    expect(archives().map((l) => l.ts)).toEqual([T0]);
    expect(santeHlHeat().dernierInstantaneTs).toBe(T0);
    expect(santeHlHeat().derniereErreur).toContain("indisponible");
  });

  test("un scan UI lent rejoint par le collecteur garde sa date d'observation, sans seuil d'âge", async () => {
    const reponse = Promise.withResolvers<Response>();
    const requetePartie = Promise.withResolvers<void>();
    const fetchImpl = amont(() => {
      requetePartie.resolve();
      return reponse.promise;
    });
    const lectureUi = obtenirInstantane(d, fetchImpl, T0);
    await requetePartie.promise;
    // Horloges logiques séparées : le scan commencé par l'UI peut précéder largement
    // le cycle qui le rejoint. Il est neuf, même si sa construction prend du temps.
    const collecte = cycleInstantane(d, {
      fetchImpl, now: T0 + 10 * PERIODE_INSTANTANE_MS, symboles: ["BTCUSDT"],
    });
    reponse.resolve(compte());

    expect((await lectureUi)?.ts).toBe(T0);
    expect(await collecte).toBe(1);
    expect(archives()).toEqual([{ ts: T0, coin: "BTC", niveaux: "[[80000,0,90000]]", adresses: 1 }]);
    expect(santeHlHeat().dernierInstantaneTs).toBe(T0);
    expect(santeHlHeat().derniereErreur).toBeNull();
  });

  test("chaque cycle relit les symboles au départ, sans attendre le prochain poll KV", async () => {
    d.query("INSERT INTO kv (namespace, cle, valeur, majA) VALUES ('hl', 'heat', ?, 1)").run(JSON.stringify({ actif: true }));
    d.query("INSERT INTO kv (namespace, cle, valeur, majA) VALUES ('liq', 'symboles', ?, 1)").run(JSON.stringify(["BTCUSDT"]));
    let maintenant = T0;
    const intervalles = new Map<number, () => void>();
    let prochainId = 0;
    const horloge: HorlogeWs = {
      now: () => maintenant,
      setTimeout: () => ++prochainId,
      clearTimeout: () => {},
      setInterval: (fn, ms) => { intervalles.set(ms, fn); return ++prochainId; },
      clearInterval: () => {},
    };
    const arreter = demarrerBoucleHlHeat({ d, fetchImpl: amont(() => compte()), horloge });
    try {
      await Bun.sleep(0);
      expect(archives().map((l) => l.coin)).toEqual(["BTC"]);
      d.query("UPDATE kv SET valeur = ? WHERE namespace = 'liq' AND cle = 'symboles'").run(JSON.stringify(["ETHUSDT"]));
      maintenant += PERIODE_INSTANTANE_MS;
      intervalles.get(PERIODE_INSTANTANE_MS)!();
      await Bun.sleep(0);
      expect(archives().filter((l) => l.ts === maintenant).map((l) => l.coin)).toEqual(["ETH"]);
    } finally {
      arreter();
    }
  });
});

describe("GET /hl/liqheat/:coin (base injectée)", () => {
  function dAvecLignes(): Database {
    const d = baseTest();
    const ins = d.prepare(
      "INSERT INTO hl_liq_instantanes (ts, coin, niveaux, long_usd, short_usd, n_long, n_short, oi_usd, adresses) VALUES (?, 'BTC', ?, ?, ?, ?, ?, ?, ?)",
    );
    // 3 lignes : ts 0 et 2000 dans le MÊME seau de pas=300000, ts 600000 dans le suivant.
    ins.run(0, "[[80000,0,400000]]", 400_000, 0, 1, 0, 1_000, 480);
    ins.run(2_000, "[[81000,0,410000]]", 410_000, 0, 1, 0, 1_000, 480);
    ins.run(600_000, "[[82000,1,300000]]", 0, 300_000, 0, 1, 1_000, 480);
    return d;
  }

  test("pas=300000 → dernier instantané de chaque seau + couverture + collecte", async () => {
    reinitialiserHlHeat();
    const d = dAvecLignes();
    const url = new URL("http://x/hl/liqheat/BTC?pas=300000&depuis=0&jusqua=9999999");
    const res = traiterHlHeat(new Request(url), url, d, T0);
    expect(res.status).toBe(200);
    const corps = (await res.json()) as {
      coin: string;
      pas: number;
      collecte: { premierTs: number; actif: boolean; periodeMs: number; retentionMs: number };
      instantanes: Array<{ ts: number; longUsd: number; oiUsd: number; couverture: number; niveaux: number[][] }>;
    };
    expect(corps.coin).toBe("BTC");
    expect(corps.pas).toBe(300_000);
    expect(corps.instantanes.map((i) => i.ts)).toEqual([2_000, 600_000]); // dernier par seau
    expect(corps.instantanes[0]!.couverture).toBe(1); // 410000/(2×1000)=205 → bornée à 1
    expect(corps.instantanes[0]!.niveaux).toEqual([[81_000, 0, 410_000]]);
    expect(corps.collecte.premierTs).toBe(0);
    expect(corps.collecte.periodeMs).toBe(PERIODE_INSTANTANE_MS);
  });

  test("sans pas : les 3 lignes brutes ; coin inconnu → liste vide et premierTs null", async () => {
    reinitialiserHlHeat();
    const d = dAvecLignes();
    const res = traiterHlHeat(new Request("http://x/hl/liqheat/BTC?depuis=0"), new URL("http://x/hl/liqheat/BTC?depuis=0"), d, T0);
    expect(((await res.json()) as { instantanes: unknown[] }).instantanes).toHaveLength(3);
    const uVide = new URL("http://x/hl/liqheat/DOGE");
    const corpsVide = (await traiterHlHeat(new Request(uVide), uVide, d, T0).json()) as {
      instantanes: unknown[];
      collecte: { premierTs: number | null };
    };
    expect(corpsVide.instantanes).toEqual([]);
    expect(corpsVide.collecte.premierTs).toBeNull();
  });
});
