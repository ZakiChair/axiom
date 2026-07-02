import { describe, expect, it } from "vitest";
import { parseBgeometrics } from "./bgeometrics";

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
