import { describe, expect, it } from "vitest";
import { cheminCryptoQuantAmont } from "../../../../../shared/cryptoquant-proxy";
import {
  SERIES_MINEURS, SERIES_TAKER, cheminSerie, decoderArchive, diagnostiquer, fusionner, jourUtc, parserLignes, unionArchives,
  type ArchiveCq, type LigneMineur, type LigneTaker,
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
  it("jours antérieurs à J-40 écartés (valeur zéro, epoch, J-41) ; J-40 et J-1 gardés", () => {
    const data = [{ ...BTC, datetime: "0001-01-01 00:00:00" }, { ...BTC, datetime: "1970-01-01 00:00:00" },
      { ...BTC, datetime: "2026-08-06 00:00:00" }, BTC];
    expect(jours(parserLignes("taker:spot:btc", env(data), AUJ))).toEqual(["2026-09-15"]);
    expect(jours(parserLignes("taker:spot:btc", env([{ ...BTC, datetime: "2026-08-07 00:00:00" }]), AUJ))).toEqual(["2026-08-07"]);
    expect(jours(parserLignes("mineur:mara", env([{ ...MARA, date: "1970-01-01" }, MARA]), AUJ))).toEqual(["2026-09-15"]);
  });
  it("status.code ≠ 200, data absent ou corps non objet → []", () => {
    expect(parserLignes("taker:spot:btc", env([BTC], 403), AUJ)).toEqual([]);
    expect(parserLignes("taker:spot:btc", { status: { code: 200 }, result: {} }, AUJ)).toEqual([]);
    expect(parserLignes("taker:spot:btc", { result: { data: [BTC] } }, AUJ)).toEqual([]);
    expect(parserLignes("taker:spot:btc", [BTC], AUJ)).toEqual([]);
  });
});

// --- Archive (tâche 10) ---
const J = (n: number): string => jourUtc(Date.UTC(2026, 8, 16) + n * 86_400_000); // J(-1) = hier
const plage = (de: number, a: number): string[] => Array.from({ length: a - de + 1 }, (_, i) => J(de + i));
const arch = (js: string[], majTs: number | null, vwap = 1): ArchiveCq =>
  ({ version: 1, serie: "taker:spot:btc", majTs, jours: Object.fromEntries(js.map((j) => [j, { ...L_BTC, vwap }])) });
const vwap = (a: ArchiveCq | null, j: string) => (a?.jours[j] as LigneTaker | undefined)?.vwap;

describe("CryptoQuant : fusionner et unionArchives (I1)", () => {
  it("{J-40..J-2} + {J-30..J-1} : J-1 ajouté, J-2..J-30 remplacés, J-31..J-40 conservés ; vide → inchangé", () => {
    const avant = arch(plage(-40, -2), 100);
    const apres = fusionner(avant, "taker:spot:btc", plage(-30, -1).map((jour) => ({ jour, ligne: { ...L_BTC, vwap: 2 } })), 500);
    expect(Object.keys(apres.jours)).toEqual(plage(-40, -1));
    expect([vwap(apres, J(-1)), vwap(apres, J(-30)), vwap(apres, J(-31)), apres.majTs]).toEqual([2, 2, 1, 500]);
    expect(fusionner(avant, "taker:spot:btc", [], 999)).toEqual(avant);
    expect(fusionner(null, "mineur:mara", [], 9)).toEqual({ version: 1, serie: "mineur:mara", majTs: null, jours: {} });
  });
  it("union : tous les jours, conflit → majTs le plus grand, null ignoré", () => {
    const local = arch([J(-3), J(-2)], 100, 1);
    const kv = arch([J(-2), J(-1)], 200, 2);
    const u = unionArchives(local, kv);
    expect([Object.keys(u?.jours ?? {}), vwap(u, J(-2)), u?.majTs]).toEqual([[J(-3), J(-2), J(-1)], 2, 200]);
    expect(vwap(unionArchives({ ...kv, majTs: 50 }, local), J(-2))).toBe(1);
    expect([unionArchives(null, kv), unionArchives(null, null)]).toEqual([kv, null]);
  });
});

describe("CryptoQuant : decoderArchive (I4)", () => {
  it("absente, illisible, version inconnue, série ou forme inattendue", () => {
    const d = (v: unknown) => decoderArchive(typeof v === "string" ? v : JSON.stringify(v), "taker:spot:btc").etat;
    expect(decoderArchive(null, "taker:spot:btc").etat).toBe("absente");
    expect([d("{pas du json"), d({ version: 2 }), d({ ...arch([], 1), serie: "taker:spot:eth" }), d({ version: 1, serie: "taker:spot:btc" })])
      .toEqual(["illisible", "versionInconnue", "illisible", "illisible"]);
  });
  it("version 1 : seul le jour invalide est ignoré ; null mineur conservés ; majTs invalide → null", () => {
    const brut = { ...arch([], 42), jours: { [J(-3)]: L_BTC, "2026-02-30": L_BTC, [J(-2)]: { ...L_BTC, vwap: "1" }, [J(-1)]: L_BTC } };
    expect(decoderArchive(JSON.stringify(brut), "taker:spot:btc"))
      .toEqual({ etat: "ok", archive: { ...arch([], 42), jours: { [J(-3)]: L_BTC, [J(-1)]: L_BTC } } });
    const mineur = { version: 1, serie: "mineur:mara", majTs: "hier", jours: { [J(-1)]: L_MARA, [J(-2)]: { ...L_MARA, usd: "3.8M" } } };
    expect(decoderArchive(JSON.stringify(mineur), "mineur:mara"))
      .toEqual({ etat: "ok", archive: { version: 1, serie: "mineur:mara", majTs: null, jours: { [J(-1)]: L_MARA } } });
  });
  it("jours ≥ aujourd'hui UTC ignorés au décodage, comme au parseur", () => {
    expect(decoderArchive(JSON.stringify(arch([J(-1), J(0), J(1)], 42)), "taker:spot:btc", AUJ))
      .toEqual({ etat: "ok", archive: arch([J(-1)], 42) });
    expect(diagnostiquer((decoderArchive(JSON.stringify(arch([J(-2), J(0), J(1)], 42)), "taker:spot:btc", AUJ) as { archive: ArchiveCq }).archive, AUJ))
      .toMatchObject({ dernier: J(-2), hierPresent: false });
  });
});

describe("CryptoQuant : diagnostiquer (I3)", () => {
  it("{J-60..J-45} puis {J-30..J-1} → début J-60, 14 perdus, 0 manquant ; sans J-10 → 1 manquant", () => {
    expect(diagnostiquer(arch([...plage(-60, -45), ...plage(-30, -1)], 1), AUJ))
      .toEqual({ debut: J(-60), dernier: J(-1), hierPresent: true, manquantsFenetre: [], perdus: plage(-44, -31), perime: false });
    expect(diagnostiquer(arch(plage(-30, -1).filter((j) => j !== J(-10)), 1), AUJ)).toMatchObject({ manquantsFenetre: [J(-10)], perdus: [] });
  });
  it("hier absent non compté ; périmé au-delà de 2 j ; archive vide → début null", () => {
    expect(diagnostiquer(arch(plage(-30, -2), 1), AUJ)).toMatchObject({ hierPresent: false, manquantsFenetre: [], perime: false });
    expect(diagnostiquer(arch(plage(-30, -3), 1), AUJ).perime).toBe(true);
    expect(diagnostiquer(null, AUJ)).toEqual({ debut: null, dernier: null, hierPresent: false, manquantsFenetre: [], perdus: [], perime: true });
  });
});
