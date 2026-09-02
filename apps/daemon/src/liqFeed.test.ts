import { describe, expect, it } from "bun:test";
import type { AlertDef } from "@axiom/alerts";
import {
  creerRegistreCtVal,
  fusionnerSymbolesLiq,
  HEARTBEAT_BYBIT,
  HEARTBEAT_OKX,
  ingererMessage,
  OKX_INSTRUMENTS_URL,
  okxInstIdDaemon,
  parseBybitLiqDaemon,
  parseOkxLiqDaemon,
  reinitialiserSanteLiqFeed,
  santeLiqFeed,
  SYMBOLES_DEFAUT,
  symbolesSurveilles,
} from "./liqFeed";

describe("parseBybitLiqDaemon", () => {
  it("parse une entrée réelle Bybit (S=Sell → long liquidé, venue bybit)", () => {
    const liq = parseBybitLiqDaemon({ T: 1700000000000, s: "BTCUSDT", S: "Sell", v: "0.007", p: "65513.30" });
    expect(liq).not.toBeNull();
    expect(liq?.t).toBe(1700000000000);
    expect(liq?.venue).toBe("bybit");
    expect(liq?.side).toBe("long");
    expect(liq?.price).toBe(65513.3);
    expect(liq?.qty).toBe(0.007);
    expect(liq?.usd).toBeCloseTo(458.6, 1);
  });

  it("convention figée : S=Buy → short liquidé", () => {
    expect(parseBybitLiqDaemon({ T: 1, S: "Buy", v: "1", p: "10" })?.side).toBe("short");
  });

  it("rejette une entrée illisible (prix<=0, S invalide, non-objet)", () => {
    expect(parseBybitLiqDaemon({ T: 1, S: "Sell", v: "1", p: "0" })).toBeNull();
    expect(parseBybitLiqDaemon({ T: 1, S: "Long", v: "1", p: "10" })).toBeNull();
    expect(parseBybitLiqDaemon(null)).toBeNull();
    expect(parseBybitLiqDaemon("x")).toBeNull();
  });
});

describe("okxInstIdDaemon", () => {
  it("BTCUSDT → BTC-USDT-SWAP (instId perp OKX)", () => {
    expect(okxInstIdDaemon("BTCUSDT")).toBe("BTC-USDT-SWAP");
  });
  it("normalise la casse et l'espace (  ethusdt  → ETH-USDT-SWAP)", () => {
    expect(okxInstIdDaemon("  ethusdt  ")).toBe("ETH-USDT-SWAP");
  });
  it("null quand la cotation est inconnue (mapping OKX impossible)", () => {
    expect(okxInstIdDaemon("FOOZZZ")).toBeNull();
  });
});

describe("parseOkxLiqDaemon", () => {
  it("posSide « long » PRIORITAIRE ; sz en contrats → qty = sz × ctVal, venue okx", () => {
    const liq = parseOkxLiqDaemon({ posSide: "long", bkPx: "65000", sz: "20", ts: "1700000000000" }, 0.01);
    expect(liq).not.toBeNull();
    expect(liq?.t).toBe(1700000000000);
    expect(liq?.venue).toBe("okx");
    expect(liq?.side).toBe("long");
    expect(liq?.price).toBe(65000);
    expect(liq?.qty).toBeCloseTo(0.2, 10);
    expect(liq?.usd).toBeCloseTo(13000, 6);
  });

  it("posSide absent → repli sur side (sell→long liquidé, buy→short liquidé)", () => {
    expect(parseOkxLiqDaemon({ side: "sell", bkPx: "100", sz: "1", ts: "1" }, 0.01)?.side).toBe("long");
    expect(parseOkxLiqDaemon({ posSide: "net", side: "buy", bkPx: "100", sz: "1", ts: "1" }, 0.01)?.side).toBe(
      "short",
    );
  });

  it("rejette une entrée illisible (bkPx<=0, sz invalide, côté indéterminé, ctVal<=0, non-objet)", () => {
    expect(parseOkxLiqDaemon({ posSide: "long", bkPx: "0", sz: "1", ts: "1" }, 0.01)).toBeNull();
    expect(parseOkxLiqDaemon({ posSide: "long", bkPx: "1", sz: "x", ts: "1" }, 0.01)).toBeNull();
    expect(parseOkxLiqDaemon({ bkPx: "1", sz: "1", ts: "1" }, 0.01)).toBeNull();
    expect(parseOkxLiqDaemon({ posSide: "long", bkPx: "1", sz: "1", ts: "1" }, 0)).toBeNull();
    expect(parseOkxLiqDaemon(null, 0.01)).toBeNull();
    expect(parseOkxLiqDaemon("x", 0.01)).toBeNull();
  });
});

describe("symbolesSurveilles", () => {
  it("repli sur le défaut quand la valeur KV est absente ou invalide", () => {
    const defaut = [...SYMBOLES_DEFAUT];
    expect(symbolesSurveilles(undefined)).toEqual(defaut);
    expect(symbolesSurveilles(null)).toEqual(defaut);
    expect(symbolesSurveilles([])).toEqual(defaut);
  });

  it("normalise la liste KV en majuscules (dédoublonnée)", () => {
    expect(symbolesSurveilles(["dogeusdt"])).toEqual(["DOGEUSDT"]);
    expect(symbolesSurveilles(["btcusdt", "BTCUSDT", " ethusdt "])).toEqual(["BTCUSDT", "ETHUSDT"]);
  });
});

/** Def liq-cascade binance minimale pour les tests de fusion. */
function defCascade(symbol: string, actif = true): AlertDef {
  return {
    id: `liq-${symbol}`,
    symbol,
    source: "binance",
    condition: { type: "liq-cascade", seuilUsdParMin: 1_000_000 },
    actif,
    declenchements: [],
  };
}

describe("fusionnerSymbolesLiq", () => {
  it("union KV ∪ alertes liq-cascade actives, dédoublonnée et triée", () => {
    const defs = [defCascade("dogeusdt"), defCascade("BTCUSDT"), defCascade("XRPUSDT", false)];
    expect(fusionnerSymbolesLiq(["BTCUSDT", "ETHUSDT"], defs)).toEqual([
      "BTCUSDT",
      "DOGEUSDT",
      "ETHUSDT",
    ]);
  });

  it("KV absent/invalide → repli défaut ∪ alertes actives", () => {
    expect(fusionnerSymbolesLiq(undefined, [defCascade("DOGEUSDT")])).toEqual(
      [...SYMBOLES_DEFAUT, "DOGEUSDT"].sort(),
    );
  });

  it("aucune alerte liq-cascade → symboles KV seuls", () => {
    expect(fusionnerSymbolesLiq(["solusdt"], [])).toEqual(["SOLUSDT"]);
  });
});

// Le mécanisme d'armement (`armerHeartbeatWs`) vit désormais dans wsLoop.ts (E.3 : les
// DEUX sites d'appel liqFeed passent par la boucle PARTAGÉE, cf. wsLoop.test.ts pour le
// comportement d'armement/désarmement). Ne reste ici que le contrat de PAYLOAD par feed.
describe("constantes heartbeat", () => {
  it("payloads par feed figés (OKX chaîne « ping », Bybit {op:\"ping\"})", () => {
    expect(HEARTBEAT_OKX).toBe("ping"); // OKX attend la CHAÎNE « ping » (coupe à 30 s sinon)
    expect(JSON.parse(HEARTBEAT_BYBIT)).toEqual({ op: "ping" }); // Bybit v5 : {"op":"ping"}
  });
});

describe("creerRegistreCtVal", () => {
  const INST = "BTC-USDT-SWAP";

  /** Stub REST instruments OKX : échoue tant que `etat.ok` est false ; compte les appels. */
  function stubCtVal(): { fetchImpl: typeof fetch; etat: { ok: boolean; appels: number } } {
    const etat = { ok: false, appels: 0 };
    const fetchImpl = (async (entree: RequestInfo | URL) => {
      etat.appels += 1;
      expect(String(entree).startsWith(OKX_INSTRUMENTS_URL)).toBe(true);
      if (!etat.ok) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify({ code: "0", data: [{ instId: INST, ctVal: "0.01" }] }));
    }) as typeof fetch;
    return { fetchImpl, etat };
  }

  it("échec au démarrage puis retry NON forcé : le ctVal manquant est rechargé", async () => {
    const { fetchImpl, etat } = stubCtVal();
    const registre = creerRegistreCtVal(fetchImpl);
    await registre.charger([INST], false);
    expect(registre.get(INST)).toBeUndefined(); // échec absorbé (best-effort)
    expect(etat.appels).toBe(1);

    etat.ok = true;
    await registre.charger([INST], false); // retry : MANQUANT → refetch (le bug : seul le refresh 24 h retentait)
    expect(registre.get(INST)).toBe(0.01);
    expect(etat.appels).toBe(2);

    await registre.charger([INST], false); // présent, non forcé → AUCUN fetch (anti-spam au poll 60 s)
    expect(etat.appels).toBe(2);

    await registre.charger([INST], true); // forcé (refresh 24 h) → refetch
    expect(etat.appels).toBe(3);
  });
});

describe("santeLiqFeed (état des collecteurs)", () => {
  it("état initial : aucun message, aucune erreur, boucle non démarrée", () => {
    reinitialiserSanteLiqFeed();
    const s = santeLiqFeed();
    expect(s.demarreTs).toBe(0);
    expect(s.bybit).toEqual({ dernierMessageTs: 0, derniereErreur: null });
    expect(s.okx).toEqual({ dernierMessageTs: 0, derniereErreur: null });
  });

  it("un message de DONNÉES Bybit horodate le collecteur (même sans liquidation lisible)", () => {
    reinitialiserSanteLiqFeed();
    const avant = Date.now();
    expect(ingererMessage(JSON.stringify({ topic: "allLiquidation.BTCUSDT", data: [] }))).toBe(true);
    expect(santeLiqFeed().bybit.dernierMessageTs).toBeGreaterThanOrEqual(avant);
  });

  it("un ack de souscription n'horodate RIEN (c'est bien le silence qu'on mesure)", () => {
    reinitialiserSanteLiqFeed();
    expect(ingererMessage(JSON.stringify({ op: "subscribe", success: true }))).toBe(false);
    expect(santeLiqFeed().bybit.dernierMessageTs).toBe(0);
  });

  it("un ctVal OKX indisponible est enregistré comme dernière erreur du collecteur okx", async () => {
    reinitialiserSanteLiqFeed();
    const registre = creerRegistreCtVal((async () =>
      new Response("nope", { status: 500 })) as unknown as typeof fetch);
    await registre.charger(["BTC-USDT-SWAP"], false);
    expect(santeLiqFeed().okx.derniereErreur).toContain("BTC-USDT-SWAP");
  });
});
