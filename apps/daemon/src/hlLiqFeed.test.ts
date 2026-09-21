/**
 * hlLiqFeed — « minage officiel partiel » des liquidations Hyperliquid : mapping coin,
 * parse des fills `liquidation` (convention de côté figée : contrepartie B→long/A→short,
 * liquidé lui-même B→short/A→long), extraction du maker d'un trade, seaux de volume,
 * classement + hystérésis de rotation, delta de souscriptions, couverture, ingestion de
 * messages (dédup par tid), santé — et UN test d'intégration du feed (WsFactice +
 * horloge factice + base :memory:), pattern wsLoop.test.ts.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { assurerTableLiquidations, type LiqFil } from "./liquidations";
import {
  ADRESSE_HLP_LIQUIDATOR,
  ajouterAuSeau,
  choisirSuivis,
  classementMakers,
  coinHl,
  couverture,
  creerFeedLiquidationsHl,
  DELAI_PREMIERE_ROTATION_MS,
  deltaSouscriptions,
  elaguer,
  FENETRE_MAKERS_MS,
  HEARTBEAT_HL,
  ingererMessageHl,
  makerDuTrade,
  majSymbolesHl,
  NB_MAKERS_SUIVIS,
  parseFillHl,
  reinitialiserSanteHl,
  santeCollecteurHl,
  TAILLE_SEAU_MS,
  TOLERANCE_RANG,
  type SeauxMakers,
} from "./hlLiqFeed";
import type { HorlogeWs } from "./wsLoop";

const VAULT = ADRESSE_HLP_LIQUIDATOR;
const LIQUIDE = "0xcb02837caaee310c178501855b63bf7f4f4b1f8b";
const MAKER = "0x1111111111111111111111111111111111111111";
const COINS = new Set(["BTC", "HMSTR"]);

beforeEach(() => reinitialiserSanteHl());

describe("coinHl", () => {
  it("mappe les cotations USDT/USDC/USD (la plus longue d'abord)", () => {
    expect(coinHl("BTCUSDT")).toBe("BTC");
    expect(coinHl("BTCUSDC")).toBe("BTC");
    expect(coinHl("BTCUSD")).toBe("BTC");
    expect(coinHl("ethusdt")).toBe("ETH"); // casse normalisée
  });
  it("applique les alias 1000× (1000PEPEUSDT → kPEPE)", () => {
    expect(coinHl("1000PEPEUSDT")).toBe("kPEPE");
    expect(coinHl("1000SHIBUSDT")).toBe("kSHIB");
  });
  it("null pour cotation inconnue, symbole synthétique ou chaîne vide", () => {
    expect(coinHl("BTCEUR")).toBeNull();
    expect(coinHl("BTC|ETH")).toBeNull();
    expect(coinHl("")).toBeNull();
    expect(coinHl("USDT")).toBeNull(); // base vide
  });
});

describe("parseFillHl (convention de côté figée)", () => {
  it("fill RÉEL du vault (backstop, side A, contrepartie) → SHORT liquidé", () => {
    const fill = {
      coin: "HMSTR", px: "0.000255", sz: "13385820.0", side: "A",
      time: 1787375624383, tid: 802203254918732,
      liquidation: { liquidatedUser: LIQUIDE, markPx: "0.000231", method: "backstop" },
    };
    const p = parseFillHl(fill, VAULT, COINS);
    expect(p).not.toBeNull();
    expect(p?.coin).toBe("HMSTR");
    expect(p?.tid).toBe(802203254918732);
    expect(p?.liq.venue).toBe("hyperliquid");
    expect(p?.liq.side).toBe("short");
    expect(p?.liq.price).toBeCloseTo(0.000255, 10);
    expect(p?.liq.usd).toBeCloseTo(0.000255 * 13385820, 6);
  });

  it("fill RÉEL du LIQUIDÉ lui-même (market, side B) → SHORT liquidé", () => {
    const fill = {
      coin: "HMSTR", px: "0.000243", sz: "4000000.0", side: "B",
      time: 1787375603606, tid: 203417169627148,
      liquidation: { liquidatedUser: LIQUIDE, markPx: "0.000226", method: "market" },
    };
    expect(parseFillHl(fill, LIQUIDE, COINS)?.liq.side).toBe("short");
  });

  it("maker contrepartie side « B » (elle achète) → LONG liquidé", () => {
    const fill = {
      coin: "BTC", px: "65000", sz: "0.5", side: "B", time: 1, tid: 7,
      liquidation: { liquidatedUser: LIQUIDE, markPx: "64000", method: "market" },
    };
    expect(parseFillHl(fill, MAKER, COINS)?.liq.side).toBe("long");
  });

  it("sans liquidation, sans liquidatedUser ou coin non surveillé → null", () => {
    const base = { coin: "BTC", px: "1", sz: "1", side: "B", time: 1, tid: 1 };
    expect(parseFillHl(base, MAKER, COINS)).toBeNull();
    expect(parseFillHl({ ...base, liquidation: { method: "market" } }, MAKER, COINS)).toBeNull();
    expect(
      parseFillHl(
        { ...base, coin: "DOGE", liquidation: { liquidatedUser: LIQUIDE } },
        MAKER,
        COINS,
      ),
    ).toBeNull();
  });

  it("casse d'adresse différente → reconnu comme le LIQUIDÉ lui-même", () => {
    const fill = {
      coin: "BTC", px: "1", sz: "1", side: "A", time: 1, tid: 1,
      liquidation: { liquidatedUser: LIQUIDE.toUpperCase().replace("0X", "0x") },
    };
    // adresseSuivie === liquidatedUser (casse ignorée) et side "A" → LONG liquidé.
    expect(parseFillHl(fill, LIQUIDE, COINS)?.liq.side).toBe("long");
  });

  it("rejette px/sz non finis ou ≤ 0, side hors A/B, time/tid non finis", () => {
    const base = {
      coin: "BTC", side: "B", time: 1, tid: 1,
      liquidation: { liquidatedUser: LIQUIDE },
    };
    expect(parseFillHl({ ...base, px: "0", sz: "1" }, MAKER, COINS)).toBeNull();
    expect(parseFillHl({ ...base, px: "x", sz: "1" }, MAKER, COINS)).toBeNull();
    expect(parseFillHl({ ...base, px: "1", sz: "-1" }, MAKER, COINS)).toBeNull();
    expect(parseFillHl({ ...base, px: "1", sz: "1", side: "C" }, MAKER, COINS)).toBeNull();
    expect(parseFillHl({ ...base, px: "1", sz: "1", time: "x" }, MAKER, COINS)).toBeNull();
    expect(parseFillHl({ ...base, px: "1", sz: "1", tid: "x" }, MAKER, COINS)).toBeNull();
    expect(parseFillHl(null, MAKER, COINS)).toBeNull();
  });
});

describe("makerDuTrade", () => {
  it("taker acheteur (B) → maker = users[1] (vendeur) ; taker vendeur (A) → users[0]", () => {
    const acheteur = "0x" + "a".repeat(40);
    const vendeur = "0x" + "b".repeat(40);
    const trade = {
      coin: "BTC", side: "B", px: "65000", sz: "0.1", time: 5,
      users: [acheteur, vendeur],
    };
    const m = makerDuTrade(trade);
    expect(m?.maker).toBe(vendeur);
    expect(m?.usd).toBeCloseTo(6500, 6);
    expect(makerDuTrade({ ...trade, side: "A" })?.maker).toBe(acheteur);
  });
  it("rejette users malformés et px/sz invalides", () => {
    const base = { coin: "BTC", side: "B", px: "1", sz: "1", time: 1 };
    expect(makerDuTrade({ ...base, users: ["0x1"] })).toBeNull();
    expect(makerDuTrade({ ...base, users: ["zz", "0x1"] })).toBeNull();
    expect(makerDuTrade({ ...base, users: ["0x1", "0x2"], px: "0" })).toBeNull();
    expect(makerDuTrade(null)).toBeNull();
  });
});

describe("seaux de makers (ajouterAuSeau / elaguer / classementMakers)", () => {
  const A = "0xaaaa", B = "0xbbbb";
  it("cumule par seau d'1 min, élague hors fenêtre, classe décroissant", () => {
    const seaux: SeauxMakers = new Map();
    const t0 = 10_000_000;
    ajouterAuSeau(seaux, t0, A, 100);
    ajouterAuSeau(seaux, t0 + 1000, A, 50); // même seau
    ajouterAuSeau(seaux, t0 + TAILLE_SEAU_MS, B, 300); // seau suivant
    ajouterAuSeau(seaux, t0 - FENETRE_MAKERS_MS - TAILLE_SEAU_MS, B, 999); // hors fenêtre
    const now = t0 + TAILLE_SEAU_MS + 1;
    elaguer(seaux, now, FENETRE_MAKERS_MS);
    expect(seaux.size).toBe(2); // le seau entièrement sorti a disparu
    const classement = classementMakers(seaux, now, FENETRE_MAKERS_MS);
    expect(classement).toEqual([
      { maker: B, usd: 300 },
      { maker: A, usd: 150 },
    ]);
  });

  it("le vault HLP Liquidator est exclu du classement (suivi à part)", () => {
    const seaux: SeauxMakers = new Map();
    ajouterAuSeau(seaux, 1_000, ADRESSE_HLP_LIQUIDATOR, 10_000);
    ajouterAuSeau(seaux, 1_000, A, 5);
    expect(classementMakers(seaux, 2_000, FENETRE_MAKERS_MS)).toEqual([{ maker: A, usd: 5 }]);
  });
});

describe("choisirSuivis (hystérésis)", () => {
  it("ensemble stable : un suivi dans la tolérance n'est pas remplacé", () => {
    const classement = ["m1", "m2", "m3", "m4"];
    const suivis = ["m4", "m3"]; // m4 rang 3 < k+tolerance (2+5)
    expect(choisirSuivis(classement, suivis, 2, 5)).toEqual(["m3", "m4"]);
  });
  it("un maker sorti du top k+tolerance perd sa place au mieux classé", () => {
    const classement = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"];
    const suivis = ["m1", "m8"]; // m8 rang 7 ≥ k+tolerance (2+5) → remplacé par m2
    expect(choisirSuivis(classement, suivis, 2, 5)).toEqual(["m1", "m2"]);
  });
  it("classement plus court que k → on garde tout ce qui existe", () => {
    expect(choisirSuivis(["m1"], ["m9"], 9, 5)).toEqual(["m1"]); // m9 hors classement → rang ∞
    expect(choisirSuivis([], [], 9, 5)).toEqual([]);
  });
  it("constantes : 9 makers + tolérance 5 (10 adresses HL au total avec le vault)", () => {
    expect(NB_MAKERS_SUIVIS).toBe(9);
    expect(TOLERANCE_RANG).toBe(5);
    expect(JSON.parse(HEARTBEAT_HL)).toEqual({ method: "ping" });
  });
});

describe("deltaSouscriptions", () => {
  it("retirer = absents des nouveaux ; ajouter = nouveaux non suivis", () => {
    expect(deltaSouscriptions(["a", "b"], ["b", "c"])).toEqual({ retirer: ["a"], ajouter: ["c"] });
    expect(deltaSouscriptions(["a"], ["a"])).toEqual({ retirer: [], ajouter: [] });
  });
});

describe("couverture", () => {
  it("Σ usd des suivis / Σ total ; null si fenêtre vide", () => {
    const seaux: SeauxMakers = new Map();
    ajouterAuSeau(seaux, 1_000, "0xa", 30);
    ajouterAuSeau(seaux, 1_000, "0xb", 70);
    expect(couverture(seaux, new Set(["0xa"]), 2_000, FENETRE_MAKERS_MS)).toBeCloseTo(0.3, 9);
    expect(couverture(new Map(), new Set(["0xa"]), 2_000, FENETRE_MAKERS_MS)).toBeNull();
  });
});

describe("ingererMessageHl", () => {
  it("JSON illisible / ack / pong → false, sans horodater", () => {
    expect(ingererMessageHl("pas json")).toBe(false);
    expect(ingererMessageHl(JSON.stringify({ channel: "subscriptionResponse" }))).toBe(false);
    expect(ingererMessageHl(JSON.stringify({ channel: "pong" }))).toBe(false);
    expect(santeCollecteurHl().dernierMessageTs).toBe(0);
  });

  it("channel error → dernière erreur de santé, false", () => {
    expect(ingererMessageHl(JSON.stringify({ channel: "error", data: "boom" }))).toBe(false);
    expect(santeCollecteurHl().derniereErreur).toBe("boom");
  });

  it("trades → seaux + horodatage (message de DONNÉES)", () => {
    majSymbolesHl(["BTCUSDT"]);
    const avant = Date.now();
    const ok = ingererMessageHl(
      JSON.stringify({
        channel: "trades",
        data: [{ coin: "BTC", side: "B", px: "100", sz: "2", time: 5, users: ["0xt", MAKER] }],
      }),
    );
    expect(ok).toBe(true);
    expect(santeCollecteurHl().dernierMessageTs).toBeGreaterThanOrEqual(avant);
    // Le contenu du seau est vérifié de bout en bout par le test d'intégration du feed
    // (trades → classementMakers → souscription userFills du maker à la rotation).
  });

  it("userFills → liquidation insérée pour CHAQUE symbole du coin, dédup par tid", () => {
    majSymbolesHl(["BTCUSDT"]);
    const insertions: Array<{ symbole: string; lot: LiqFil[] }> = [];
    const feed = creerFeedLiquidationsHl({
      inserer: (symbole, lot) => insertions.push({ symbole, lot }),
    });
    const msg = JSON.stringify({
      channel: "userFills",
      data: {
        user: VAULT,
        fills: [
          {
            coin: "BTC", px: "65000", sz: "0.5", side: "A", time: 9, tid: 42,
            liquidation: { liquidatedUser: LIQUIDE, markPx: "64000", method: "backstop" },
          },
          { coin: "BTC", px: "1", sz: "1", side: "B", time: 9, tid: 43 }, // sans liquidation → ignoré
        ],
      },
    });
    expect(ingererMessageHl(msg)).toBe(true);
    expect(ingererMessageHl(msg)).toBe(true); // tid 42 déjà vu → pas de doublon
    expect(insertions).toHaveLength(1);
    expect(insertions[0]?.symbole).toBe("BTCUSDT");
    expect(insertions[0]?.lot[0]?.venue).toBe("hyperliquid");
    expect(insertions[0]?.lot[0]?.side).toBe("short");
    expect(santeCollecteurHl().derniereLiqTs).toBeGreaterThan(0);
    feed.arreter();
  });
});

// ─────────────────────────── Intégration : feed + WS factice + base :memory: ───────────────────────────

class HorlogeFactice implements HorlogeWs {
  t = 0;
  private seq = 1;
  private minuteurs: Array<{ id: number; echeance: number; fn: () => void; periode?: number }> = [];
  now = (): number => this.t;
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = this.seq++;
    this.minuteurs.push({ id, echeance: this.t + ms, fn });
    return id;
  };
  clearTimeout = (id: unknown): void => {
    this.minuteurs = this.minuteurs.filter((m) => m.id !== id);
  };
  setInterval = (fn: () => void, ms: number): unknown => {
    const id = this.seq++;
    this.minuteurs.push({ id, echeance: this.t + ms, fn, periode: ms });
    return id;
  };
  clearInterval = (id: unknown): void => this.clearTimeout(id);
  avancer(ms: number): void {
    const fin = this.t + ms;
    for (;;) {
      const prochain = this.minuteurs
        .filter((m) => m.echeance <= fin)
        .sort((a, b) => a.echeance - b.echeance)[0];
      if (!prochain) break;
      this.t = prochain.echeance;
      if (prochain.periode !== undefined) prochain.echeance = this.t + prochain.periode;
      else this.minuteurs = this.minuteurs.filter((m) => m.id !== prochain.id);
      prochain.fn();
    }
    this.t = fin;
  }
}

class WsFactice {
  static instances: WsFactice[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  ferme = false;
  envois: string[] = [];
  constructor(public url: string) {
    WsFactice.instances.push(this);
  }
  send(d: string): void {
    this.envois.push(d);
  }
  close(): void {
    if (this.ferme) return;
    this.ferme = true;
    this.onclose?.();
  }
  ouvrir(): void {
    this.onopen?.();
  }
  message(d: string): void {
    this.onmessage?.({ data: d });
  }
}

describe("creerFeedLiquidationsHl — intégration (WS factice + base :memory:)", () => {
  it("ouverture → souscriptions trades+vault ; trades→seaux ; rotation→userFills makers ; fill→base", () => {
    WsFactice.instances = [];
    const horloge = new HorlogeFactice();
    horloge.t = 1_000_000;
    const db = new Database(":memory:");
    assurerTableLiquidations(db);
    const feed = creerFeedLiquidationsHl({
      horloge,
      creerWs: (url) => new WsFactice(url) as unknown as WebSocket,
      inserer: (symbole, lot) => {
        const st = db.query(
          "INSERT OR IGNORE INTO liquidations (symbole, venue, t, side, price, qty, usd) VALUES (?,?,?,?,?,?,?)",
        );
        for (const l of lot) st.run(symbole, l.venue, l.t, l.side, l.price, l.qty, l.usd);
      },
    });

    feed.setSymboles(["BTCUSDT"]);
    expect(WsFactice.instances).toHaveLength(1);
    const ws = WsFactice.instances[0]!;
    ws.ouvrir();
    // Souscriptions à l'ouverture : trades BTC + userFills du vault (aucun maker encore).
    expect(ws.envois).toContain(
      JSON.stringify({ method: "subscribe", subscription: { type: "trades", coin: "BTC" } }),
    );
    expect(ws.envois).toContain(
      JSON.stringify({
        method: "subscribe",
        subscription: { type: "userFills", user: ADRESSE_HLP_LIQUIDATOR },
      }),
    );

    // Trades → seaux des makers (MAKER fait 2× le volume de l'autre).
    const autre = "0x2222222222222222222222222222222222222222";
    ws.message(
      JSON.stringify({
        channel: "trades",
        data: [
          { coin: "BTC", side: "B", px: "100", sz: "2", time: horloge.t, users: ["0xt", MAKER] },
          { coin: "BTC", side: "B", px: "100", sz: "1", time: horloge.t, users: ["0xt", autre] },
        ],
      }),
    );

    // Rotation forcée (1re rotation à DELAI_PREMIERE_ROTATION_MS) → userFills des makers.
    horloge.avancer(DELAI_PREMIERE_ROTATION_MS);
    expect(ws.envois).toContain(
      JSON.stringify({ method: "subscribe", subscription: { type: "userFills", user: MAKER } }),
    );
    expect(ws.envois).toContain(
      JSON.stringify({ method: "subscribe", subscription: { type: "userFills", user: autre } }),
    );
    expect(santeCollecteurHl().adressesSuivies).toBe(3); // 2 makers + vault
    expect(santeCollecteurHl().couverture).toBeCloseTo(1, 9);

    // Fill liquidation du maker (contrepartie, side B → LONG liquidé) → ligne en base.
    ws.message(
      JSON.stringify({
        channel: "userFills",
        data: {
          user: MAKER,
          fills: [
            {
              coin: "BTC", px: "65000", sz: "0.25", side: "B", time: horloge.t, tid: 777,
              liquidation: { liquidatedUser: LIQUIDE, markPx: "64900", method: "market" },
            },
          ],
        },
      }),
    );
    const lignes = db
      .query("SELECT * FROM liquidations WHERE symbole = 'BTCUSDT' AND venue = 'hyperliquid'")
      .all() as Array<{ side: string; price: number }>;
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.side).toBe("long");
    expect(lignes[0]?.price).toBe(65000);

    feed.arreter();
    db.close();
  });
});
