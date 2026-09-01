import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import {
  adresseDepuisTopic,
  assurerTableWhales,
  ecrireDernierBloc,
  fenetreBlocs,
  insererMouvements,
  LIMITE_MAX,
  lireDernierBloc,
  montantNetBtc,
  mouvementsRecents,
  nombreHex,
  parseLatestBlock,
  parseLogsEtherscan,
  parseRequeteWhales,
  parseTxBtc,
  pollEtherscan,
  purgerMouvements,
  quantiteDepuisData,
  resultatGetLogs,
  TOKENS_ETH,
  TOPIC_TRANSFER,
  traiterWhales,
  versMouvementBtc,
  versMouvementErc20,
  type MouvementWhale,
  type TxBtc,
} from "./whales";

const T0 = Date.UTC(2026, 7, 20, 12, 0, 0);
/** Adresse BTC de la liste curée (Binance cold) — sert aux cas de direction. */
const BTC_BINANCE = "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo";
/** Adresse ETH de la liste curée (Binance 14). */
const ETH_BINANCE = "0x28c6c06298d514db089934071355e5743bf21d60";

// ─────────────────────────── BTC ───────────────────────────

describe("parseTxBtc", () => {
  const txBrute = {
    hash: "abc123",
    time: 1_755_000_000, // secondes epoch → ms attendu
    inputs: [{ prev_out: { addr: "1Emetteur", value: 50 } }, { prev_out: { addr: "1Emetteur" } }],
    out: [
      { addr: "1Destinataire", value: 200_000_000 },
      { addr: "1Emetteur", value: 40_000_000 },
      { value: 1 }, // sortie sans adresse (OP_RETURN) : écartée
    ],
  };

  it("parse une tx de rawblock (secondes → ms, entrées dédoublonnées, sorties adressées)", () => {
    const tx = parseTxBtc(txBrute);
    expect(tx).toEqual({
      hash: "abc123",
      t: 1_755_000_000_000,
      entrees: ["1Emetteur"],
      sorties: [
        { addr: "1Destinataire", valueSat: 200_000_000 },
        { addr: "1Emetteur", valueSat: 40_000_000 },
      ],
    });
  });

  it("écarte les corps illisibles (hash absent/vide, non-objet)", () => {
    expect(parseTxBtc({ time: 1 })).toBeNull();
    expect(parseTxBtc(null)).toBeNull();
    expect(parseTxBtc({ hash: "" })).toBeNull();
  });
});

describe("parseLatestBlock", () => {
  const HASH = "00000000000000000002194a80ef7f78197c4c6deecaae1898b6482fff2c662b";

  it("extrait hash + hauteur, rejette hash non-hex ou hauteur invalide", () => {
    expect(parseLatestBlock({ hash: HASH, height: 964_101 })).toEqual({ hash: HASH, height: 964_101 });
    expect(parseLatestBlock({ hash: "xyz", height: 1 })).toBeNull();
    expect(parseLatestBlock({ hash: HASH, height: 0 })).toBeNull();
    expect(parseLatestBlock(null)).toBeNull();
  });
});

describe("montantNetBtc", () => {
  it("exclut le change (sorties vers une adresse d'entrée) et pointe la plus grosse sortie nette", () => {
    const tx: TxBtc = {
      hash: "h",
      t: T0,
      entrees: ["1Emetteur"],
      sorties: [
        { addr: "1Petit", valueSat: 100_000_000 }, // 1 BTC
        { addr: "1Gros", valueSat: 300_000_000 }, // 3 BTC
        { addr: "1Emetteur", valueSat: 50_000_000 }, // change : exclu
      ],
    };
    expect(montantNetBtc(tx)).toEqual({ qtyBtc: 4, versPrincipal: "1Gros" });
  });

  it("consolidation vers soi-même → montant net nul", () => {
    const tx: TxBtc = {
      hash: "h",
      t: T0,
      entrees: ["1A", "1B"],
      sorties: [{ addr: "1A", valueSat: 500_000_000 }],
    };
    expect(montantNetBtc(tx)).toEqual({ qtyBtc: 0, versPrincipal: null });
  });
});

describe("versMouvementBtc", () => {
  const tx: TxBtc = {
    hash: "h1",
    t: T0,
    entrees: ["1Emetteur"],
    sorties: [{ addr: "1Destinataire", valueSat: 2_000_000_000 }], // 20 BTC
  };

  it("filtre sous le seuil et calcule le notionnel au prix injecté", () => {
    // 20 BTC × 100 000 $ = 2 M$ ≥ seuil 1 M$.
    const m = versMouvementBtc(tx, 100_000, 1_000_000);
    expect(m?.usd).toBe(2_000_000);
    expect(m?.qty).toBe(20);
    expect(m?.direction).toBe("inconnu");
    // 20 BTC × 40 000 $ = 800 k$ < seuil.
    expect(versMouvementBtc(tx, 40_000, 1_000_000)).toBeNull();
  });

  it("sans prix exploitable → null (aucune collecte avant le premier poll)", () => {
    expect(versMouvementBtc(tx, 0, 1_000_000)).toBeNull();
    expect(versMouvementBtc(tx, Number.NaN, 1_000_000)).toBeNull();
  });

  it("étiquette un retrait quand une entrée est un exchange connu", () => {
    const retrait: TxBtc = { ...tx, entrees: ["1Inconnue", BTC_BINANCE] };
    const m = versMouvementBtc(retrait, 100_000, 1_000_000);
    expect(m?.deLabel).toBe("Binance (cold)");
    expect(m?.de).toBe(BTC_BINANCE); // l'entrée étiquetée devient la source affichée
    expect(m?.direction).toBe("retrait");
  });

  it("tx sans entrée adressée (coinbase) → null", () => {
    expect(versMouvementBtc({ ...tx, entrees: [] }, 100_000, 1_000_000)).toBeNull();
  });
});

// ─────────────────────────── ETH ───────────────────────────

describe("nombreHex / adresseDepuisTopic / quantiteDepuisData", () => {
  it("nombreHex accepte hex (« 0x » = 0), décimal, et rejette le reste", () => {
    expect(nombreHex("0x1a")).toBe(26);
    expect(nombreHex("0x")).toBe(0);
    expect(nombreHex("42")).toBe(42);
    expect(nombreHex(7)).toBe(7);
    expect(nombreHex("xyz")).toBeNull();
    expect(nombreHex(undefined)).toBeNull();
  });

  it("adresseDepuisTopic extrait les 20 derniers octets en minuscules", () => {
    const topic = `0x000000000000000000000000${ETH_BINANCE.slice(2).toUpperCase()}`;
    expect(adresseDepuisTopic(topic)).toBe(ETH_BINANCE);
    expect(adresseDepuisTopic("0x1234")).toBeNull();
  });

  it("quantiteDepuisData convertit le hex 32 octets selon les décimales", () => {
    // 5 000 000 × 10^6 unités USDT = 5e12 = 0x48c27395000.
    expect(quantiteDepuisData("0x0000000000000000000000000000000000000000000000000000048c27395000", 6)).toBe(
      5_000_000,
    );
    expect(quantiteDepuisData("0x", 6)).toBe(0);
    expect(quantiteDepuisData("pas-un-hex", 6)).toBeNull();
  });
});

describe("parseLogsEtherscan", () => {
  const topicDe = "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const topicVers = `0x000000000000000000000000${ETH_BINANCE.slice(2)}`;
  const log = {
    transactionHash: "0xtx1",
    logIndex: "0x2",
    timeStamp: "0x68a8f5c0", // hex secondes
    topics: [TOPIC_TRANSFER, topicDe, topicVers],
    data: "0x0000000000000000000000000000000000000000000000000000048c27395000", // 5 M USDT
  };

  it("parse un log Transfer valide (hex → nombres, adresses minuscules)", () => {
    const logs = parseLogsEtherscan({ status: "1", result: [log] }, 6);
    expect(logs).toEqual([
      {
        txHash: "0xtx1",
        logIndex: 2,
        t: Number.parseInt("68a8f5c0", 16) * 1000,
        de: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        vers: ETH_BINANCE,
        qty: 5_000_000,
      },
    ]);
  });

  it("écarte les topics étrangers et les entrées illisibles ; « No records » → []", () => {
    const mauvaisTopic = { ...log, topics: ["0xdeadbeef", topicDe, topicVers] };
    expect(parseLogsEtherscan({ status: "1", result: [mauvaisTopic, null, { x: 1 }] }, 6)).toEqual([]);
    expect(parseLogsEtherscan({ status: "0", message: "No records found", result: [] }, 6)).toEqual([]);
    expect(parseLogsEtherscan({ status: "0", result: "Max rate limit reached" }, 6)).toEqual([]);
  });
});

describe("versMouvementErc20", () => {
  const log = {
    txHash: "0xtx1",
    logIndex: 3,
    t: T0,
    de: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    vers: ETH_BINANCE,
    qty: 5_000_000,
  };

  it("filtre au seuil (peg 1 $) et étiquette un dépôt vers un exchange connu", () => {
    const m = versMouvementErc20(log, "USDT", 1_000_000);
    expect(m).toEqual({
      id: "0xtx1-3",
      t: T0,
      chain: "eth",
      asset: "USDT",
      qty: 5_000_000,
      usd: 5_000_000,
      de: log.de,
      vers: ETH_BINANCE,
      deLabel: null,
      versLabel: "Binance",
      direction: "depot",
    });
    expect(versMouvementErc20({ ...log, qty: 999_999 }, "USDT", 1_000_000)).toBeNull();
  });
});

describe("fenetreBlocs", () => {
  it("sans curseur : fenêtre bornée à maxBlocs jusqu'au bloc courant", () => {
    expect(fenetreBlocs(null, 1_000, 25)).toEqual({ de: 976, a: 1_000 });
  });
  it("reprend au bloc suivant, plafonne le rattrapage (trou assumé)", () => {
    expect(fenetreBlocs(990, 1_000, 25)).toEqual({ de: 991, a: 1_000 });
    expect(fenetreBlocs(100, 1_000, 25)).toEqual({ de: 976, a: 1_000 }); // saute en avant
  });
  it("à jour ou bloc courant illisible → null", () => {
    expect(fenetreBlocs(1_000, 1_000, 25)).toBeNull();
    expect(fenetreBlocs(5, 0, 25)).toBeNull();
  });
});

// ─────────────────────────── Requête + stockage + route ───────────────────────────

describe("parseRequeteWhales", () => {
  it("borne la limite, parse minUsd et normalise l'asset en majuscules", () => {
    const p = new URLSearchParams("limite=999999&minUsd=5000000&asset=usdt");
    expect(parseRequeteWhales(p)).toEqual({ limite: LIMITE_MAX, minUsd: 5_000_000, asset: "USDT" });
    expect(parseRequeteWhales(new URLSearchParams())).toEqual({ limite: 200, minUsd: 0, asset: null });
  });
});

/** Mouvement de test (BTC, direction inconnue) à l'horodatage donné. */
function mouvement(id: string, t: number, over: Partial<MouvementWhale> = {}): MouvementWhale {
  return {
    id,
    t,
    chain: "btc",
    asset: "BTC",
    qty: 20,
    usd: 2_000_000,
    de: "1A",
    vers: "1B",
    deLabel: null,
    versLabel: null,
    direction: "inconnu",
    ...over,
  };
}

describe("stockage whale_moves", () => {
  it("insère idempotent (OR IGNORE), relit par actif, purge par rétention", () => {
    const d = new Database(":memory:");
    assurerTableWhales(d);
    const m1 = mouvement("id1", T0);
    const m2 = mouvement("id2", T0 + 1_000, { asset: "USDT", chain: "eth", direction: "depot" });
    insererMouvements(d, [m1, m2]);
    insererMouvements(d, [m1]); // doublon : ignoré
    expect(mouvementsRecents(d, "btc", 0)).toEqual([m1]); // asset insensible à la casse (normalisé)
    expect(mouvementsRecents(d, "USDT", 0)).toEqual([m2]);
    expect(mouvementsRecents(d, "USDT", T0 + 2_000)).toEqual([]);

    purgerMouvements(d, T0 + 500); // ne garde que m2
    expect(mouvementsRecents(d, "BTC", 0)).toEqual([]);
    expect(mouvementsRecents(d, "USDT", 0)).toEqual([m2]);
  });
});

describe("traiterWhales — GET /whales/recent", () => {
  function requete(query = ""): { req: Request; url: URL } {
    const url = new URL(`http://127.0.0.1:8787/whales/recent${query}`);
    return { req: new Request(url, { method: "GET" }), url };
  }

  it("renvoie les mouvements t décroissant, filtrés par minUsd/asset, avec la santé", async () => {
    const d = new Database(":memory:");
    assurerTableWhales(d);
    insererMouvements(d, [
      mouvement("id1", T0, { usd: 2_000_000 }),
      mouvement("id2", T0 + 1_000, { usd: 9_000_000 }),
      mouvement("id3", T0 + 2_000, { asset: "USDT", usd: 3_000_000 }),
    ]);
    const { req, url } = requete("?minUsd=2500000&asset=BTC");
    const res = traiterWhales(req, url, d);
    expect(res.status).toBe(200);
    const corps = (await res.json()) as { mouvements: MouvementWhale[]; sante: { clePresente: boolean } };
    expect(corps.mouvements.map((m) => m.id)).toEqual(["id2"]);
    expect(typeof corps.sante.clePresente).toBe("boolean");
  });

  it("405 hors GET, 404 hors /recent", async () => {
    const url = new URL("http://127.0.0.1:8787/whales/recent");
    const post = traiterWhales(new Request(url, { method: "POST" }), url, new Database(":memory:"));
    expect(post.status).toBe(405);
    const mauvaise = new URL("http://127.0.0.1:8787/whales/autre");
    const res = traiterWhales(new Request(mauvaise, { method: "GET" }), mauvaise, new Database(":memory:"));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────── Poll Etherscan (fetch injecté, convention traiterHl) ───────────────────────────

/** Stub fetch Etherscan : eth_blockNumber + getLogs par contrat. Journalise les URLs. */
function stubEth(scenario: {
  blockNumber: string;
  parContrat: Record<string, unknown>;
}): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = (async (entree: RequestInfo | URL) => {
    const u = String(entree);
    urls.push(u);
    if (u.includes("eth_blockNumber")) return new Response(JSON.stringify({ result: scenario.blockNumber }));
    const contrat = new URL(u).searchParams.get("address") ?? "";
    return new Response(JSON.stringify(scenario.parContrat[contrat] ?? { status: "1", result: [] }));
  }) as typeof fetch;
  return { fetchImpl, urls };
}

describe("resultatGetLogs", () => {
  it("laisse passer un tableau (logs ou « No records found ») et jette sur erreur en chaîne", () => {
    expect(resultatGetLogs({ status: "1", result: [{ x: 1 }] })).toEqual([{ x: 1 }]);
    expect(resultatGetLogs({ status: "0", message: "No records found", result: [] })).toEqual([]);
    expect(() => resultatGetLogs({ status: "0", result: "Max rate limit reached" })).toThrow(
      "Max rate limit reached",
    );
    expect(() => resultatGetLogs({ status: "0", message: "NOTOK" })).toThrow("NOTOK");
    expect(() => resultatGetLogs(null)).toThrow("réponse illisible");
  });
});

describe("pollEtherscan — erreurs Etherscan en HTTP 200", () => {
  it("result en chaîne : curseur NON avancé (fenêtre rejouée), erreur portée en santé", async () => {
    const d = new Database(":memory:");
    assurerTableWhales(d);
    ecrireDernierBloc(d, 90);
    const usdt = TOKENS_ETH[0]?.contrat ?? "";
    const { fetchImpl } = stubEth({
      blockNumber: "0x64", // bloc 100 → fenêtre 91..100
      parContrat: { [usdt]: { status: "0", result: "Max rate limit reached" } },
    });
    await pollEtherscan("cle-test", d, fetchImpl, 0);
    expect(lireDernierBloc(d)).toBe(90); // AVANT le fix : 100 (fenêtre 91..100 perdue en silence)
    const url = new URL("http://127.0.0.1:8787/whales/recent");
    const corps = (await traiterWhales(new Request(url), url, d).json()) as {
      sante: { erreurEth: string | null };
    };
    expect(corps.sante.erreurEth).toContain("Max rate limit reached");
  });
});
