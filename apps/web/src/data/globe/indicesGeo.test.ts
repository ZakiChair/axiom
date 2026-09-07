import { describe, expect, it } from "vitest";
import { extraireSeriesGeo, parseGscpi } from "../../../../../shared/geo-series";

function bloc(names: string[], start: string, values: unknown[] = [100, 120]) {
  return `<script type="application/json">${JSON.stringify({ x: { data: names.map(name => ({ name, x: [start, "2026-08-01"], y: values })) } })}</script>`;
}
describe("indices géopolitiques : contrats des sources", () => {
  it("choisit le groupe GPR mensuel récent complet, pas le quotidien ni l'historique 1900", () => {
    const names = ["GPR", "GPR Threats", "GPR Acts"];
    const html = '<script>throw new Error("jamais exécuté")</script>' + bloc(["GPR Daily"], "1985-01-01") + bloc(names, "1900-01-01") + bloc(names, "1985-01-01");
    const result = extraireSeriesGeo(html, "gpr");
    expect(result.map(s => s.id)).toEqual(["gpr", "gpr-menaces", "gpr-actes"]);
    expect(result[0]?.points[0]?.time).toBe(Date.UTC(1985, 0, 1));
    expect(result[0]?.points.at(-1)?.value).toBe(120);
  });
  it("refuse un contrat changé, ambigu ou une valeur absente plutôt que zéro", () => {
    expect(() => extraireSeriesGeo(bloc(["GPR"], "1985-01-01"), "gpr")).toThrow();
    const tpu = bloc(["TPU Monthly"], "1960-01-01");
    expect(() => extraireSeriesGeo(tpu + tpu, "tpu")).toThrow();
    expect(extraireSeriesGeo(bloc(["TPU Monthly"], "1960-01-01", [null, 0]), "tpu")[0]?.points).toEqual([{ time: Date.UTC(2026, 7, 1), value: 0 }]);
  });
  it("prend la dernière édition GSCPI datée sans remplir ses trous avec une ancienne", () => {
    const r = parseGscpi("Date,Sep-26,Aug-26,Note\r\n31-Jul-2026,0.94,0.79,x\r\n31-Aug-2026,1.06,#N/A,x\r\n30-Jun-2026,#N/A,1.20,x\r\n");
    expect(r.millesime).toBe("2026-09");
    expect(r.points.map(p => p.value)).toEqual([0.94, 1.06]);
    expect(r.points[0]?.time).toBe(Date.UTC(2026, 6, 1));
  });
  it("GSCPI conserve zéro/négatif mais rejette dates et chiffres invalides", () => {
    expect(parseGscpi("Date,Sep-26\n31-Jan-2026,-1\n28-Feb-2026,0\n31-Feb-2026,99\n31-Mar-2026,\n30-Apr-2026,NaN").points.map(p => p.value)).toEqual([-1, 0]);
    expect(() => parseGscpi("HTML,une erreur")).toThrow();
  });
});
