import { describe, expect, it } from "bun:test";
import { etiqueterAdresse, etiqueterDirection, LABELS_ETH } from "./whaleLabels";

describe("etiqueterAdresse", () => {
  it("ETH : insensible à la casse (checksum EIP-55 variable selon les sources)", () => {
    expect(etiqueterAdresse("eth", "0x28C6c06298d514Db089934071355E5743bf21d60")).toBe("Binance");
    expect(etiqueterAdresse("eth", "0x28c6c06298d514db089934071355e5743bf21d60")).toBe("Binance");
  });
  it("BTC : casse exacte (base58 sensible à la casse)", () => {
    expect(etiqueterAdresse("btc", "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo")).toBe("Binance (cold)");
    expect(etiqueterAdresse("btc", "34XP4VROCGJYM3XR7YCVPFHOCNXV4TWSEO")).toBeNull();
  });
  it("adresse inconnue → null", () => {
    expect(etiqueterAdresse("eth", "0x0000000000000000000000000000000000000001")).toBeNull();
  });
  it("les clés ETH de la liste sont déjà en minuscules (invariant de comparaison)", () => {
    for (const cle of Object.keys(LABELS_ETH)) expect(cle).toBe(cle.toLowerCase());
  });
});

describe("etiqueterDirection", () => {
  it("vers un exchange = dépôt ; depuis = retrait ; les deux = interne ; aucun = inconnu", () => {
    expect(etiqueterDirection(null, "Binance")).toBe("depot");
    expect(etiqueterDirection("Kraken", null)).toBe("retrait");
    expect(etiqueterDirection("Binance", "Binance (cold)")).toBe("interne");
    expect(etiqueterDirection(null, null)).toBe("inconnu");
  });
});
