import { describe, expect, it } from "vitest";
import {
  BG_LIMITE_HEURE,
  BG_LIMITE_JOUR,
  cleActive,
  cleStockageQuota,
  limiteQuota,
  parseBgeometrics,
} from "./bgeometrics";

describe("parseBgeometrics", () => {
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
