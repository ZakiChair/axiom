/** Source officielle NBS : un indicateur national, POST public de lecture via proxy borné. */
import { construireRequetesNbs, NBS_CHEMIN, NBS_HOST, type RequeteNbs, type SerieNbs } from "../../../../../shared/nbs-series";
import type { MacroSeries } from "./types";
import { extUrl } from "../extapi";
function champ(o: unknown, key: string): unknown { return o && typeof o === "object" ? (o as Record<string, unknown>)[key] : undefined; }
/** JSON NBS indexé par période ; cellules vides, autre indicateur/région/catalogue rejetés. */
export function parseSerieNbs(json: unknown, requete: RequeteNbs, serie: SerieNbs): MacroSeries {
  const data = champ(json, "data");
  if (champ(json, "success") === false || !Array.isArray(data)) throw new Error("NBS : données indisponibles");
  const points = new Map<number, number>();
  const [debutCode, finCode] = requete.dts[0].split("-");
  for (const periode of data) {
    const code = champ(periode, "code");
    const date = typeof code === "string" ? /^(\d{4})(0[1-9]|1[0-2])MM$/.exec(code) : null;
    const valeurs = champ(periode, "values");
    if (!date || !Array.isArray(valeurs) || typeof code !== "string" || code < debutCode! || code > finCode!) continue;
    for (const cellule of valeurs) {
      if (champ(cellule, "_id") !== requete.indicatorIds[0] || champ(cellule, "da") !== "000000000000" || champ(cellule, "catalogid") !== requete.cid) continue;
      const raw = champ(cellule, "value");
      if (typeof raw !== "number" && (typeof raw !== "string" || raw.trim() === "")) continue;
      const nombre = Number(raw);
      if (!Number.isFinite(nombre)) continue;
      const value = serie === "core-cpi-aa" || serie === "ppi-aa" ? Math.round((nombre - 100) * 1e8) / 1e8 : nombre;
      const time = Date.UTC(Number(date[1]), Number(date[2]) - 1, 1);
      if (points.has(time) && points.get(time) !== value) throw new Error("NBS : observations contradictoires");
      points.set(time, value);
    }
  }
  return [...points].map(([time, value]) => ({ time, value })).sort((a, b) => a.time - b.time);
}
export async function chargerSerieNbs(serie: SerieNbs, depuisMs: number, signal?: AbortSignal): Promise<MacroSeries> {
  const points: MacroSeries = [];
  const requetes = construireRequetesNbs(serie, depuisMs, Date.now());
  // Au plus deux catalogues core sur l'horizon usuel ; bornes distinctes, pas de double compte.
  for (const requete of requetes) {
    if (signal?.aborted) throw new DOMException("Annulé", "AbortError");
    const response = await fetch(extUrl(NBS_HOST, NBS_CHEMIN), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requete), signal });
    if (!response.ok) throw new Error(`NBS ${response.status}`);
    points.push(...parseSerieNbs(await response.json(), requete, serie));
  }
  return points.filter((p) => p.time >= depuisMs && p.time <= Date.now()).sort((a, b) => a.time - b.time);
}
