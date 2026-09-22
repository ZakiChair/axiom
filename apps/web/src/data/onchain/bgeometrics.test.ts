import { describe, expect, it } from "vitest";
import {
  BG_LIMITE_HEURE,
  BG_LIMITE_JOUR,
  cleActive,
  cleStockageQuota,
  limiteQuota,
  parseBgeometrics,
  parseOiFutures,
} from "./bgeometrics";

describe("parseBgeometrics", () => {
  it("écarte lignes invalides, timestamps absents et valeurs vides ; déduplique par date", () => {
    const serie = parseBgeometrics([null, 0, { unixTs: null, sopr: 1 }, { unixTs: "", sopr: 1 },
      { unixTs: 200, sopr: "" }, { unixTs: 100, sopr: true }, { unixTs: 100, sopr: 2 }, { unixTs: 100, sopr: 3 }], "sopr");
    expect(serie.points).toEqual([{ time: 100000, value: 3 }]);
  });
  // bitcoin-data.com renvoie parfois la CHAÎNE "NaN" ou null pour un jour manquant ;
  // unixTs est en SECONDES.
  const json = [
    { d: "2026-06-01", unixTs: 1780272000, mvrvZscore: 0.6694 },
    { d: "2026-06-02", unixTs: 1780358400, mvrvZscore: "NaN" },
    { d: "2026-06-03", unixTs: 1780444800, mvrvZscore: 0.3399 },
    { d: "2026-06-04", unixTs: 1780531200, mvrvZscore: null },
  ];

  it("ignore les valeurs \"NaN\" et null", () => {
    const serie = parseBgeometrics(json, "mvrvZscore");
    expect(serie.points.map((p) => p.value)).toEqual([0.6694, 0.3399]);
  });

  it("convertit unixTs (secondes) en ms et expose le dernier point", () => {
    const serie = parseBgeometrics(json, "mvrvZscore");
    expect(serie.points[0]?.time).toBe(1780272000 * 1000);
    expect(serie.dernier?.value).toBe(0.3399);
    expect(serie.dernier?.time).toBe(1780444800 * 1000);
  });

  it("tolère une réponse non-tableau", () => {
    expect(parseBgeometrics(null, "sopr").points).toEqual([]);
    expect(parseBgeometrics({ error: "x" }, "sopr").dernier).toBeUndefined();
  });

  // etf-flow-btc : format RÉEL où `unixTs` ET `etfFlow` sont des CHAÎNES, valeurs négatives
  // possibles (sorties nettes). Le parseur générique doit les convertir sans changement.
  it("parse etf-flow-btc (unixTs et etfFlow en chaînes, négatifs conservés)", () => {
    const flux = [
      { d: "2026-07-13", unixTs: "1783900800", etfFlow: "-7695.58482896" },
      { d: "2026-07-17", unixTs: "1784246400", etfFlow: "2069.90690004" },
      { d: "2026-07-18", unixTs: "1784332800", etfFlow: "NaN" },
    ];
    const serie = parseBgeometrics(flux, "etfFlow");
    expect(serie.points.map((p) => p.value)).toEqual([-7695.58482896, 2069.90690004]);
    expect(serie.points[0]?.time).toBe(1783900800 * 1000);
    expect(serie.dernier?.value).toBe(2069.90690004);
  });
});

describe("parseOiFutures", () => {
  // open-interest-futures : clés d'exchange DYNAMIQUES en chaînes, certaines null, plus un
  // champ de synthèse `openInterestFutures` (à traiter comme n'importe quel champ ≠ d/unixTs).
  const json = [
    {
      d: "2026-06-01",
      unixTs: "1780272000",
      binance: "10374485447.8862",
      bybit: "4541992271.3879",
      dydx: null,
      openInterestFutures: null,
    },
    {
      d: "2026-06-02",
      unixTs: "1780358400",
      binance: "10098061555.0847",
      kraken: "NaN",
    },
  ];

  it("ventile par exchange (Number sur chaînes), exclut d/unixTs, écarte null et \"NaN\"", () => {
    const jours = parseOiFutures(json);
    expect(jours).toHaveLength(2);
    expect(jours[0]?.d).toBe("2026-06-01");
    expect(jours[0]?.parExchange).toEqual({
      binance: 10374485447.8862,
      bybit: 4541992271.3879,
    });
    expect(jours[1]?.parExchange).toEqual({ binance: 10098061555.0847 });
    // Ni `dydx` (null), ni `openInterestFutures` (null), ni `kraken` ("NaN") ne survivent.
    expect(jours[0]?.parExchange).not.toHaveProperty("dydx");
    expect(jours[0]?.parExchange).not.toHaveProperty("openInterestFutures");
    expect(jours[1]?.parExchange).not.toHaveProperty("kraken");
  });

  it("ignore une ligne sans aucun exchange exploitable et tolère un non-tableau", () => {
    expect(parseOiFutures([{ d: "2026-06-03", unixTs: "1", dydx: null }])).toEqual([]);
    expect(parseOiFutures(null)).toEqual([]);
    expect(parseOiFutures({ error: "x" })).toEqual([]);
  });
});

describe("quota BGeometrics", () => {
  // Instant fixe (UTC) pour vérifier le format des clés de stockage sans dépendre de l'heure.
  const instant = new Date("2026-07-23T21:20:00.000Z");

  it("clé horaire (YYYY-MM-DD-HH) quand une clé est active", () => {
    expect(cleStockageQuota(true, instant)).toBe("axiom:onchain:bg:count:2026-07-23-21");
  });

  it("clé journalière (YYYY-MM-DD) sans clé active (quota IP)", () => {
    expect(cleStockageQuota(false, instant)).toBe("axiom:onchain:bg:count:2026-07-23");
  });

  it("limite : 10/heure si clé active, 15/jour sinon", () => {
    expect(limiteQuota(true)).toBe(BG_LIMITE_HEURE);
    expect(limiteQuota(false)).toBe(BG_LIMITE_JOUR);
  });

  // NB : le cas « aucune clé » dépend de BG_CLE_ENV_PRESENTE (booléen `define` dérivé du
  // .env chargé par Vite/vitest) → non déterministe selon la présence du .env. On n'assure
  // ici que la branche indépendante du define : une clé personnelle rend TOUJOURS actif.
  it("une clé personnelle non vide rend le quota actif (indépendant du repli .env)", () => {
    expect(cleActive("ma-cle-perso")).toBe(true);
  });
});

// ───────── Lot 2 : métriques de cycle (champs réels sondés le 2026-09-22) ─────────
describe("défs BGeometrics Lot 2", () => {
  it("parse le champ JSON propre à chaque endpoint (stamps s → ms)", async () => {
    const { BG_STH_MVRV, BG_LTH_MVRV, BG_NRPL_USD, BG_VDD_MULTIPLE, BG_AVIV } =
      await import("./bgeometrics");
    const defs = [
      [BG_STH_MVRV, 1.06],
      [BG_LTH_MVRV, 1.55],
      [BG_NRPL_USD, -129_445_415.71],
      [BG_VDD_MULTIPLE, 0.6575],
      [BG_AVIV, 0.974769],
    ] as const;
    for (const [def, valeur] of defs) {
      const serie = parseBgeometrics(
        [{ d: "2026-09-15", unixTs: 1789430400, [def.champ]: valeur }],
        def.champ,
      );
      expect(serie.points).toEqual([{ time: 1789430400 * 1000, value: valeur }]);
    }
  });

  it("embargo J-7 posé sauf sur vddMultiple (réponse `/last` fraîche au sondage)", async () => {
    const m = await import("./bgeometrics");
    expect(m.BG_STH_MVRV.embargo).toBe(true);
    expect(m.BG_LTH_MVRV.embargo).toBe(true);
    expect(m.BG_NRPL_USD.embargo).toBe(true);
    expect(m.BG_AVIV.embargo).toBe(true);
    expect(m.BG_VDD_MULTIPLE.embargo).toBeUndefined();
  });

  it("fenetreJours 1460 élargit `startday` à ~4 ans ; défaut = 120 j", async () => {
    const { construireUrl } = await import("./bgeometrics");
    const joursDe = (url: string) => {
      const q = new URL(url, "https://axiom.test").searchParams;
      const debut = Date.parse(`${q.get("startday")}T00:00:00Z`);
      const fin = Date.parse(`${q.get("endday")}T00:00:00Z`);
      return (fin - debut) / 86_400_000;
    };
    expect(joursDe(construireUrl("sth-mvrv", 1460))).toBe(1460);
    expect(joursDe(construireUrl("mvrv-zscore"))).toBe(120); // défaut inchangé
    expect(construireUrl("aviv", 1460)).toContain("/bgapi/v1/aviv?");
  });

  it("fenetreJours est bien renseigné sur les 5 nouvelles défs uniquement", async () => {
    const m = await import("./bgeometrics");
    const nouvelles = [m.BG_STH_MVRV, m.BG_LTH_MVRV, m.BG_NRPL_USD, m.BG_VDD_MULTIPLE, m.BG_AVIV];
    for (const def of nouvelles) expect(def.fenetreJours).toBe(1460);
    // Les définitions historiques n'ont pas été élargies (quota = par requête, pas par jour).
    expect(m.BG_MVRV.fenetreJours).toBeUndefined();
    expect(m.BG_SUPPLY_PROFIT.fenetreJours).toBeUndefined();
  });
});
