import { describe, expect, it } from "vitest";
import { cheminCryptoQuantAmont } from "../../../../../shared/cryptoquant-proxy";
import {
  SERIES_MINEURS, SERIES_TAKER, cheminSerie, jourUtc, parserLignes,
  type LigneMineur, type LigneTaker,
} from "./cryptoquant";

const AUJ = "2026-09-16";
// Spot BTC du 2026-09-15 (spec §4.4) ; MARA du 2026-09-15 (spec §2 : 49,05 / 396,96 / 3,84 M$, reste illustratif).
const BTC = { datetime: "2026-09-15 00:00:00", symbol: "btc_all", trade_count: 12099486, base_volume: 156928.13,
  quote_volume: 12007360401.32, base_buy_volume: 77681.2, quote_buy_volume: 5944281632.44, base_sell_volume: 79246.93,
  quote_sell_volume: 6063078768.88, vwap: 76515.03, buy_ratio: 0.495, sell_ratio: 0.505, buy_sell_ratio: 0.9802,
  buy_count: 6133017, sell_count: 5966469 };
const L_BTC: LigneTaker = { n: 12099486, bv: 156928.13, qv: 12007360401.32, bbv: 77681.2, qbv: 5944281632.44,
  bsv: 79246.93, qsv: 6063078768.88, vwap: 76515.03, br: 0.495, bsr: 0.9802, bc: 6133017, sc: 5966469 };
const MARA = { date: "2026-09-15", coinbase_rewards: 48.9, other_mining_rewards: 0.15, total_rewards: 49.05,
  accumulated_monthly_rewards: 396.96, reported_production: null, report_accuracy: null, closing_usd: 78290,
  total_daily_rewards_closing_usd: 3840124.5, accumulated_monthly_rewards_closing_usd: 31077998.4 };
const L_MARA: LigneMineur = { r: 49.05, cr: 48.9, om: 0.15, cm: 396.96, usd: 3840124.5, cmu: 31077998.4, px: 78290, decl: null, prec: null };
const env = (data: unknown[], code = 200) => ({ status: { code }, result: { window: "day", data } });
const jours = (r: Array<{ jour: string }>) => r.map((x) => x.jour);

describe("CryptoQuant : catalogue", () => {
  it("13 séries, URL exactes acceptées telles quelles par la liste fermée, jamais from/to", () => {
    expect(SERIES_TAKER).toEqual(["taker:spot:btc", "taker:spot:eth", "taker:swap:btc", "taker:swap:eth"]);
    expect(SERIES_MINEURS).toEqual(["bitf", "cipher", "clsk", "core", "hive", "iren", "mara", "riot", "wulf"].map((id) => `mineur:${id}`));
    expect(cheminSerie("taker:swap:eth")).toBe("/cqapi/v2/market/cq/swap/trade?symbol=eth_all&window=day&limit=30");
    expect(cheminSerie("mineur:mara")).toBe("/cqapi/v1/btc/miner-data/companies?miner=mara&window=day&limit=30");
    for (const serie of [...SERIES_TAKER, ...SERIES_MINEURS]) {
      const url = new URL(cheminSerie(serie), "http://x");
      expect(url.searchParams.has("from") || url.searchParams.has("to")).toBe(false);
      expect(`/cqapi${cheminCryptoQuantAmont(url.pathname, url.search) ?? "REFUS"}`).toBe(cheminSerie(serie));
    }
    expect(jourUtc(Date.UTC(2026, 8, 16, 23, 59, 59))).toBe(AUJ);
  });
});

describe("CryptoQuant : parserLignes (I2)", () => {
  it("fixtures réelles → clés courtes, valeurs brutes, null conservés (jamais 0)", () => {
    expect(parserLignes("taker:spot:btc", env([BTC]), AUJ)).toEqual([{ jour: "2026-09-15", ligne: L_BTC }]);
    expect(parserLignes("mineur:mara", env([MARA]), AUJ)).toEqual([{ jour: "2026-09-15", ligne: L_MARA }]);
  });
  it("deux formats de date → même clé ; récent → ancien trié croissant, dédoublonné (dernier gagne)", () => {
    const data = [{ ...BTC, datetime: undefined, date: "2026-09-15" }, { ...BTC, datetime: "2026-09-14 00:00:00", vwap: 1 },
      { ...BTC, datetime: "2026-09-13 00:00:00" }, { ...BTC, datetime: "2026-09-14 00:00:00", vwap: 2 }];
    const r = parserLignes("taker:spot:btc", env(data), AUJ);
    expect(jours(r)).toEqual(["2026-09-13", "2026-09-14", "2026-09-15"]);
    expect((r[1]?.ligne as LigneTaker).vwap).toBe(2);
    expect(jours(parserLignes("mineur:mara", env([{ ...MARA, date: undefined, datetime: "2026-09-15 00:00:00" }]), AUJ))).toEqual(["2026-09-15"]);
  });
  it("aujourd'hui, futur, date invalide, ligne incomplète ignorés un par un", () => {
    const data = [{ ...BTC, datetime: "2026-09-17 00:00:00" }, { ...BTC, datetime: "2026-09-16 00:00:00" },
      { ...BTC, datetime: "2026-02-30 00:00:00" }, { ...BTC, datetime: "15/09/2026" },
      { ...BTC, datetime: "2026-09-14 00:00:00", vwap: null }, { ...BTC, datetime: "2026-09-13 00:00:00", buy_ratio: "NaN" }, null, BTC];
    expect(jours(parserLignes("taker:spot:btc", env(data), AUJ))).toEqual(["2026-09-15"]);
    expect(parserLignes("mineur:mara", env([{ ...MARA, total_rewards: null }]), AUJ)).toEqual([]);
  });
  it("status.code ≠ 200, data absent ou corps non objet → []", () => {
    expect(parserLignes("taker:spot:btc", env([BTC], 403), AUJ)).toEqual([]);
    expect(parserLignes("taker:spot:btc", { status: { code: 200 }, result: {} }, AUJ)).toEqual([]);
    expect(parserLignes("taker:spot:btc", { result: { data: [BTC] } }, AUJ)).toEqual([]);
    expect(parserLignes("taker:spot:btc", [BTC], AUJ)).toEqual([]);
  });
});
